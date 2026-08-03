//! Pseudo-terminal hosting for the in-app terminal tabs.
//!
//! Each spawned process gets a `PtyId`. The frontend writes to it via
//! `pty_write`, resizes via `pty_resize`, kills via `pty_kill`, and listens
//! for output on the Tauri event `pty://<id>/data` (binary bytes as a
//! Vec<u8>). When the child exits we emit `pty://<id>/exit` with the status
//! code (or -1 on signal/unknown) and drop the entry from the registry.

use std::collections::{HashMap, VecDeque};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use parking_lot::Mutex;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serialport::{DataBits, FlowControl, Parity, StopBits};
use tauri::{AppHandle, Emitter};

const REPLAY_CAPACITY: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct PtyReplay {
    sequence: u64,
    bytes: VecDeque<u8>,
}

#[derive(Clone, serde::Serialize)]
pub struct PtyDataChunk {
    pub sequence: u64,
    pub data: String,
}

#[derive(serde::Serialize)]
pub struct PtySnapshot {
    pub sequence: u64,
    pub data: String,
}

pub type PtyId = u64;

struct Pty {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Box<dyn Write + Send>,
    /// Keep the child handle alive so we can kill it on demand. Stored in an
    /// option because `kill()` consumes nothing but we want to clear after.
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    replay: Arc<Mutex<PtyReplay>>,
    closed: Arc<AtomicBool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialOptions {
    pub path: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub flow_control: String,
}

#[derive(Default)]
pub struct PtyRegistry {
    inner: Arc<Mutex<HashMap<PtyId, Pty>>>,
    next_id: Arc<Mutex<PtyId>>,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of native PTYs that would be interrupted by replacing the main
    /// renderer. Renderer recovery must never close these implicitly.
    pub fn active_count(&self) -> usize {
        self.inner.lock().len()
    }

    fn next(&self) -> PtyId {
        let mut g = self.next_id.lock();
        *g += 1;
        *g
    }

    /// Spawn `cmd` with `args` in a fresh PTY of the given size. Returns the
    /// id used by the frontend to drive it.
    ///
    /// `transcript_path`, when Some, is the absolute path of a file the
    /// reader thread appends to as bytes arrive from the PTY. ANSI escape
    /// sequences are stripped so the log is plain-text and grep-friendly.
    /// Parent directories are created on demand. Write failures are logged
    /// once and then silently ignored so a broken disk doesn't kill the
    /// terminal stream.
    pub fn spawn(
        &self,
        app: AppHandle,
        cmd: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: Vec<(String, String)>,
        cols: u16,
        rows: u16,
        transcript_path: Option<String>,
    ) -> Result<PtyId> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("openpty")?;

        let mut builder = CommandBuilder::new(&cmd);
        for a in &args {
            builder.arg(a);
        }
        if let Some(cwd) = cwd {
            builder.cwd(cwd);
        }
        for (k, v) in env {
            builder.env(k, v);
        }
        // Reasonable default — most lab gear expects xterm.
        builder.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(builder)
            .with_context(|| format!("spawn {cmd}"))?;
        // The slave side is owned by the child; drop our handle so EOF
        // propagates when the child exits.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().context("clone pty reader")?;
        let writer = pair.master.take_writer().context("take pty writer")?;

        let id = self.next();
        let registry = self.inner.clone();
        let app_for_reader = app.clone();
        let replay = Arc::new(Mutex::new(PtyReplay::default()));
        let replay_for_reader = replay.clone();

        // Open the transcript file once up front so a bad path fails loudly
        // at spawn time rather than silently dropping output.
        let mut transcript = match transcript_path.as_deref() {
            Some(p) if !p.is_empty() => {
                let path = PathBuf::from(p);
                if let Some(parent) = path.parent() {
                    if !parent.as_os_str().is_empty() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                }
                match OpenOptions::new().create(true).append(true).open(&path) {
                    Ok(f) => Some(f),
                    Err(e) => {
                        tracing::warn!(id, path = %path.display(), error = %e, "transcript open failed");
                        None
                    }
                }
            }
            _ => None,
        };

        // Background reader: PTY -> Tauri event. Runs until the child closes
        // its end (EOF) or read errors.
        std::thread::Builder::new()
            .name(format!("pty-{id}-reader"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                let mut transcript_buf: Vec<u8> = Vec::new();
                let mut transcript_failed = false;
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if let Some(f) = transcript.as_mut() {
                                if !transcript_failed {
                                    transcript_buf.clear();
                                    strip_ansi_into(&buf[..n], &mut transcript_buf);
                                    if !transcript_buf.is_empty() {
                                        if let Err(e) = f.write_all(&transcript_buf) {
                                            tracing::warn!(id, error = %e, "transcript write failed; disabling");
                                            transcript_failed = true;
                                        }
                                    }
                                }
                            }
                            let chunk = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                            let sequenced = {
                                let mut replay = replay_for_reader.lock();
                                replay.sequence += 1;
                                replay.bytes.extend(&buf[..n]);
                                while replay.bytes.len() > REPLAY_CAPACITY {
                                    replay.bytes.pop_front();
                                }
                                PtyDataChunk { sequence: replay.sequence, data: chunk.clone() }
                            };
                            // Emitting a base64 string is ~5x cheaper than
                            // emitting Vec<u8> because Tauri serializes
                            // byte vectors as JSON arrays of numbers
                            // (`[123, 45, ...]`) \u2014 a single character
                            // becomes 3\u20134 bytes on the IPC wire. Base64
                            // is one byte per character and decodes in O(n)
                            // on the JS side.
                            if app_for_reader
                                .emit(&format!("pty://{id}/data"), chunk)
                                .is_err()
                            {
                                break;
                            }
                            let _ = app_for_reader.emit(&format!("pty://{id}/data-sequenced"), sequenced);
                        }
                        Err(e) => {
                            tracing::warn!(id, error = %e, "pty read error");
                            break;
                        }
                    }
                }
                if let Some(mut f) = transcript.take() {
                    let _ = f.flush();
                }
                // Tell the UI the session has ended. Wait briefly for the
                // child to reap so we can report exit status.
                let status_code = {
                    let mut guard = registry.lock();
                    if let Some(mut pty) = guard.remove(&id) {
                        match pty.child.as_mut().map(|child| child.wait()) {
                            Some(Ok(s)) => s.exit_code() as i32,
                            Some(Err(_)) => -1,
                            None => 0,
                        }
                    } else {
                        -1
                    }
                };
                let _ = app_for_reader.emit(&format!("pty://{id}/exit"), status_code);
            })
            .context("spawn reader thread")?;

        let pty = Pty {
            master: Some(pair.master),
            writer,
            child: Some(child),
            replay,
            closed: Arc::new(AtomicBool::new(false)),
        };
        self.inner.lock().insert(id, pty);
        Ok(id)
    }

    pub fn open_serial(
        &self,
        app: AppHandle,
        options: SerialOptions,
        transcript_path: Option<String>,
    ) -> Result<PtyId> {
        let data_bits = match options.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            8 => DataBits::Eight,
            value => return Err(anyhow!("unsupported serial data bits: {value}")),
        };
        let parity = match options.parity.as_str() {
            "none" => Parity::None,
            "odd" => Parity::Odd,
            "even" => Parity::Even,
            value => return Err(anyhow!("unsupported serial parity: {value}")),
        };
        let stop_bits = match options.stop_bits {
            1 => StopBits::One,
            2 => StopBits::Two,
            value => return Err(anyhow!("unsupported serial stop bits: {value}")),
        };
        let flow_control = match options.flow_control.as_str() {
            "none" => FlowControl::None,
            "software" => FlowControl::Software,
            "hardware" => FlowControl::Hardware,
            value => return Err(anyhow!("unsupported serial flow control: {value}")),
        };
        let port = serialport::new(&options.path, options.baud_rate)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(stop_bits)
            .flow_control(flow_control)
            .timeout(std::time::Duration::from_millis(100))
            .open()
            .with_context(|| format!("open serial port {}", options.path))?;
        let mut reader = port.try_clone().context("clone serial port")?;
        let id = self.next();
        let registry = self.inner.clone();
        let replay = Arc::new(Mutex::new(PtyReplay::default()));
        let replay_for_reader = replay.clone();
        let closed = Arc::new(AtomicBool::new(false));
        let closed_for_reader = closed.clone();
        let app_for_reader = app.clone();
        let mut transcript = transcript_path.as_deref().and_then(|p| {
            if p.is_empty() { return None; }
            let path = PathBuf::from(p);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match OpenOptions::new().create(true).append(true).open(&path) {
                Ok(file) => Some(file),
                Err(error) => {
                    tracing::warn!(id, path = %path.display(), %error, "serial transcript open failed");
                    None
                }
            }
        });

        self.inner.lock().insert(
            id,
            Pty {
                master: None,
                writer: port,
                child: None,
                replay,
                closed,
            },
        );

        std::thread::Builder::new()
            .name(format!("serial-{id}-reader"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                let mut transcript_buf = Vec::new();
                loop {
                    if closed_for_reader.load(Ordering::Relaxed) {
                        break;
                    }
                    match reader.read(&mut buf) {
                        Ok(0) => continue,
                        Ok(n) => {
                            if let Some(file) = transcript.as_mut() {
                                transcript_buf.clear();
                                strip_ansi_into(&buf[..n], &mut transcript_buf);
                                let _ = file.write_all(&transcript_buf);
                            }
                            let chunk = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                            let sequenced = {
                                let mut replay = replay_for_reader.lock();
                                replay.sequence += 1;
                                replay.bytes.extend(&buf[..n]);
                                while replay.bytes.len() > REPLAY_CAPACITY {
                                    replay.bytes.pop_front();
                                }
                                PtyDataChunk {
                                    sequence: replay.sequence,
                                    data: chunk.clone(),
                                }
                            };
                            if app_for_reader
                                .emit(&format!("pty://{id}/data"), chunk)
                                .is_err()
                            {
                                break;
                            }
                            let _ = app_for_reader
                                .emit(&format!("pty://{id}/data-sequenced"), sequenced);
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => continue,
                        Err(error) => {
                            tracing::warn!(id, %error, "serial read error");
                            break;
                        }
                    }
                }
                registry.lock().remove(&id);
                let _ = app_for_reader.emit(&format!("pty://{id}/exit"), 0);
            })
            .context("spawn serial reader thread")?;
        Ok(id)
    }

    pub fn write(&self, id: PtyId, data: &[u8]) -> Result<()> {
        let mut guard = self.inner.lock();
        let pty = guard
            .get_mut(&id)
            .ok_or_else(|| anyhow!("unknown pty {id}"))?;
        pty.writer.write_all(data).context("pty write")?;
        Ok(())
    }

    pub fn resize(&self, id: PtyId, cols: u16, rows: u16) -> Result<()> {
        let guard = self.inner.lock();
        let pty = guard.get(&id).ok_or_else(|| anyhow!("unknown pty {id}"))?;
        if let Some(master) = pty.master.as_ref() {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .context("pty resize")?;
        }
        Ok(())
    }

    pub fn kill(&self, id: PtyId) -> Result<()> {
        let mut guard = self.inner.lock();
        if let Some(mut pty) = guard.remove(&id) {
            pty.closed.store(true, Ordering::Relaxed);
            if let Some(child) = pty.child.as_mut() {
                let _ = child.kill();
            }
        }
        Ok(())
    }

    pub fn snapshot(&self, id: PtyId) -> Result<PtySnapshot> {
        let guard = self.inner.lock();
        let pty = guard.get(&id).ok_or_else(|| anyhow!("unknown pty {id}"))?;
        let replay = pty.replay.lock();
        let bytes: Vec<u8> = replay.bytes.iter().copied().collect();
        Ok(PtySnapshot {
            sequence: replay.sequence,
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        })
    }
}

/// Strip CSI / OSC / single-character escape sequences from `src`, append
/// the remaining printable bytes (plus newlines / tabs) to `dst`. Conservative
/// state machine — we don't try to parse parameters, just skip until the
/// terminator byte. Good enough to make `ssh-session.log` readable in less.
fn strip_ansi_into(src: &[u8], dst: &mut Vec<u8>) {
    let mut i = 0;
    while i < src.len() {
        let b = src[i];
        if b == 0x1b {
            // ESC. Look at the next byte to classify.
            if i + 1 >= src.len() {
                break;
            }
            match src[i + 1] {
                b'[' => {
                    // CSI: ESC [ ... <final 0x40..=0x7e>
                    let mut j = i + 2;
                    while j < src.len() {
                        let c = src[j];
                        if (0x40..=0x7e).contains(&c) {
                            break;
                        }
                        j += 1;
                    }
                    i = j + 1;
                }
                b']' => {
                    // OSC: ESC ] ... BEL or ESC \
                    let mut j = i + 2;
                    while j < src.len() {
                        let c = src[j];
                        if c == 0x07 {
                            j += 1;
                            break;
                        }
                        if c == 0x1b && j + 1 < src.len() && src[j + 1] == b'\\' {
                            j += 2;
                            break;
                        }
                        j += 1;
                    }
                    i = j;
                }
                _ => {
                    // 2-byte escape like ESC ( B or single-char ESC + final.
                    i += 2;
                }
            }
            continue;
        }
        // Keep newlines, tabs, carriage returns, and printable bytes.
        // Drop the rest of the C0 control range.
        if b == b'\n' || b == b'\t' || b == b'\r' || b >= 0x20 {
            dst.push(b);
        }
        i += 1;
    }
}
