//! In-app SFTP browser. Opens an SSH connection through the existing broker
//! loopback tunnel (or any host/port) and exposes simple list / get / put /
//! mkdir / delete primitives the React side can call via Tauri commands.
//!
//! Auth: tries the user-provided private key first, then falls back to the
//! supplied password if any. Host keys are accepted unconditionally — the
//! tunnel terminates on 127.0.0.1 and the broker authenticates the upstream
//! device for us.

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use parking_lot::Mutex;
use russh::client::{self, Handle, Handler};
use russh::keys::*;
use russh::Disconnect;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;

#[derive(Default)]
pub struct SftpRegistry {
    next_id: Mutex<u64>,
    sessions: Mutex<HashMap<u64, SessionEntry>>,
    transfers: Mutex<HashMap<String, ActiveTransfer>>,
}

struct SessionEntry {
    sftp: Arc<SftpSession>,
    handle: Arc<Handle<ClientHandler>>,
}

struct ActiveTransfer {
    session_id: u64,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: Option<u64>,
    pub mode: Option<u32>,
}

impl SftpRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn active_session_count(&self) -> usize {
        self.sessions.lock().len()
    }

    pub fn active_transfer_count(&self) -> usize {
        self.transfers.lock().len()
    }

    fn put(&self, sftp: SftpSession, handle: Handle<ClientHandler>) -> u64 {
        let mut id_g = self.next_id.lock();
        *id_g += 1;
        let id = *id_g;
        self.sessions.lock().insert(
            id,
            SessionEntry {
                sftp: Arc::new(sftp),
                handle: Arc::new(handle),
            },
        );
        id
    }

    fn get(&self, id: u64) -> Result<Arc<SftpSession>> {
        self.sessions
            .lock()
            .get(&id)
            .map(|e| e.sftp.clone())
            .ok_or_else(|| anyhow!("unknown sftp session {id}"))
    }

    pub async fn close(&self, id: u64) -> (bool, usize) {
        // Remove transfer registrations immediately so closing a large or
        // stalled transfer cannot keep registry state alive. Each worker owns
        // a clone of the cancellation flag and will observe it independently.
        let cancelled_transfers = {
            let mut transfers = self.transfers.lock();
            let mut cancelled = 0;
            transfers.retain(|_, transfer| {
                if transfer.session_id != id {
                    return true;
                }
                transfer.cancelled.store(true, Ordering::Relaxed);
                cancelled += 1;
                false
            });
            cancelled
        };

        // Never hold a registry lock across protocol shutdown awaits.
        let entry = self.sessions.lock().remove(&id);
        let Some(entry) = entry else {
            return (false, cancelled_transfers);
        };

        // Close the SFTP channel first, then explicitly ask russh to end the
        // SSH transport. Previously we relied on Arc/Drop timing, which made
        // session and tunnel teardown difficult to observe and could be
        // delayed by in-flight operations.
        let _ = entry.sftp.close().await;
        let _ = entry
            .handle
            .disconnect(
                Disconnect::ByApplication,
                "ConneCat SFTP session closed",
                "en",
            )
            .await;
        (true, cancelled_transfers)
    }

    pub fn begin_transfer(&self, session_id: u64, transfer_id: &str) -> Result<Arc<AtomicBool>> {
        let mut transfers = self.transfers.lock();
        if transfers.contains_key(transfer_id) {
            anyhow::bail!("transfer {transfer_id} is already active");
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        transfers.insert(
            transfer_id.to_string(),
            ActiveTransfer {
                session_id,
                cancelled: cancelled.clone(),
            },
        );
        Ok(cancelled)
    }

    pub fn finish_transfer(&self, transfer_id: &str) {
        self.transfers.lock().remove(transfer_id);
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> bool {
        let transfers = self.transfers.lock();
        let Some(transfer) = transfers.get(transfer_id) else {
            return false;
        };
        transfer.cancelled.store(true, Ordering::Relaxed);
        true
    }
}

pub struct ClientHandler;

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Tunnel terminates on loopback; broker has already authenticated
        // the upstream device. Accepting any key here is safe.
        Ok(true)
    }
}

pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    key_path: Option<&str>,
    password: Option<&str>,
) -> Result<(SftpSession, Handle<ClientHandler>)> {
    let config = Arc::new(client::Config {
        // `Some(Duration::from_secs(0))` is interpreted as "disconnect on first
        // idle tick" by russh and tears the session down before auth completes.
        // Leave it unset so the session lives as long as the SFTP page needs it.
        inactivity_timeout: None,
        ..Default::default()
    });

    let mut handle = client::connect(config, (host, port), ClientHandler)
        .await
        .map_err(|e| anyhow!("ssh connect {host}:{port}: {e}"))?;

    let mut authed = false;

    if let Some(path) = key_path.map(str::trim).filter(|s| !s.is_empty()) {
        let expanded = shellexpand::tilde(path).to_string();
        let key = load_secret_key(&expanded, None)
            .or_else(|_| load_secret_key(&expanded, password))
            .with_context(|| format!("load key {expanded}"))?;
        if handle
            .authenticate_publickey(username, Arc::new(key))
            .await
            .map_err(|e| anyhow!("publickey auth: {e}"))?
        {
            authed = true;
        }
    }

    if !authed {
        if let Some(pw) = password {
            if handle
                .authenticate_password(username, pw)
                .await
                .map_err(|e| anyhow!("password auth: {e}"))?
            {
                authed = true;
            }
        }
    }

    if !authed {
        anyhow::bail!("authentication failed for {username}");
    }

    let channel = handle
        .channel_open_session()
        .await
        .context("open ssh channel")?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .context("request sftp subsystem")?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .context("start sftp session")?;
    Ok((sftp, handle))
}

pub async fn list(sftp: Arc<SftpSession>, path: &str) -> Result<Vec<SftpEntry>> {
    let p = if path.is_empty() { "." } else { path };
    let mut entries: Vec<SftpEntry> = Vec::new();
    let read = sftp
        .read_dir(p)
        .await
        .with_context(|| format!("list {p}"))?;
    for e in read {
        let name = e.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = e.metadata();
        let abs = join_path(p, &name);
        entries.push(SftpEntry {
            name,
            path: abs,
            is_dir: meta.is_dir(),
            size: meta.size.unwrap_or(0),
            mtime: meta.mtime.map(|t| t as u64),
            mode: meta.permissions,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

pub async fn realpath(sftp: Arc<SftpSession>, path: &str) -> Result<String> {
    sftp.canonicalize(path)
        .await
        .with_context(|| format!("realpath {path}"))
}

pub async fn download<F>(
    sftp: Arc<SftpSession>,
    remote: &str,
    local: &str,
    cancelled: Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<u64>
where
    F: FnMut(u64, u64),
{
    let mut rf = sftp
        .open_with_flags(remote, OpenFlags::READ)
        .await
        .with_context(|| format!("open remote {remote}"))?;
    let size = rf
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0);
    let mut lf = tokio::fs::File::create(local)
        .await
        .with_context(|| format!("create local {local}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    let mut last_progress = Instant::now();
    on_progress(0, size);
    loop {
        if cancelled.load(Ordering::Relaxed) {
            drop(lf);
            drop(rf);
            let _ = tokio::fs::remove_file(local).await;
            anyhow::bail!("transfer cancelled");
        }
        let n = rf.read(&mut buf).await.context("read remote")?;
        if n == 0 {
            break;
        }
        lf.write_all(&buf[..n]).await.context("write local")?;
        total += n as u64;
        if total >= size || last_progress.elapsed() >= Duration::from_millis(200) {
            on_progress(total, size);
            last_progress = Instant::now();
        }
    }
    lf.flush().await.ok();
    if total < size || size == 0 {
        on_progress(total, size);
    }
    Ok(total)
}

pub async fn upload<F>(
    sftp: Arc<SftpSession>,
    local: &str,
    remote: &str,
    cancelled: Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<u64>
where
    F: FnMut(u64, u64),
{
    let mut lf = tokio::fs::File::open(local)
        .await
        .with_context(|| format!("open local {local}"))?;
    let size = lf
        .metadata()
        .await
        .with_context(|| format!("read local metadata {local}"))?
        .len();
    let mut rf = sftp
        .open_with_flags(
            remote,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
        .with_context(|| format!("create remote {remote}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    let mut last_progress = Instant::now();
    on_progress(0, size);
    loop {
        if cancelled.load(Ordering::Relaxed) {
            drop(rf);
            let _ = sftp.remove_file(remote).await;
            anyhow::bail!("transfer cancelled");
        }
        let n = lf.read(&mut buf).await.context("read local")?;
        if n == 0 {
            break;
        }
        rf.write_all(&buf[..n]).await.context("write remote")?;
        total += n as u64;
        if total >= size || last_progress.elapsed() >= Duration::from_millis(200) {
            on_progress(total, size);
            last_progress = Instant::now();
        }
    }
    rf.flush().await.ok();
    if total < size {
        on_progress(total, size);
    }
    Ok(total)
}

pub async fn mkdir(sftp: Arc<SftpSession>, path: &str) -> Result<()> {
    sftp.create_dir(path)
        .await
        .with_context(|| format!("mkdir {path}"))
}

pub async fn remove(sftp: Arc<SftpSession>, path: &str, is_dir: bool) -> Result<()> {
    if is_dir {
        sftp.remove_dir(path)
            .await
            .with_context(|| format!("rmdir {path}"))?;
    } else {
        sftp.remove_file(path)
            .await
            .with_context(|| format!("unlink {path}"))?;
    }
    Ok(())
}

pub async fn rename(sftp: Arc<SftpSession>, from: &str, to: &str) -> Result<()> {
    sftp.rename(from, to)
        .await
        .with_context(|| format!("rename {from} -> {to}"))
}

fn join_path(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{base}{name}")
    } else if base == "." {
        name.to_string()
    } else {
        format!("{base}/{name}")
    }
}

/// Public so commands can register the new session into the registry.
pub fn register(reg: &SftpRegistry, sftp: SftpSession, handle: Handle<ClientHandler>) -> u64 {
    reg.put(sftp, handle)
}

pub fn get(reg: &SftpRegistry, id: u64) -> Result<Arc<SftpSession>> {
    reg.get(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_can_be_cancelled_and_finished() {
        let registry = SftpRegistry::new();
        let cancelled = registry.begin_transfer(7, "transfer-1").unwrap();

        assert!(!cancelled.load(Ordering::Relaxed));
        assert!(registry.cancel_transfer("transfer-1"));
        assert!(cancelled.load(Ordering::Relaxed));

        registry.finish_transfer("transfer-1");
        assert!(!registry.cancel_transfer("transfer-1"));
    }

    #[tokio::test]
    async fn closing_session_cancels_its_transfers_only() {
        let registry = SftpRegistry::new();
        let first = registry.begin_transfer(7, "first").unwrap();
        let second = registry.begin_transfer(8, "second").unwrap();

        registry.close(7).await;

        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
    }
}
