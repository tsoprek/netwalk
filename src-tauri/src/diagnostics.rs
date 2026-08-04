use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::{
    filter::Targets, layer::Context, prelude::*, registry::LookupSpan, Layer,
};

pub const CHANNELS: &[(&str, &str, &str)] = &[
    (
        "core_ui",
        "Core and UI",
        "Application lifecycle, UI errors, and configuration.",
    ),
    (
        "api",
        "Local service calls",
        "Local command and proxy lifecycle metadata.",
    ),
    (
        "enrollment_updates",
        "Application lifecycle",
        "Startup, platform, and renderer lifecycle.",
    ),
    (
        "ssh_tunnel",
        "SSH, tunnels, and terminals",
        "Connection lifecycle only; terminal content is excluded.",
    ),
    (
        "browse_proxy",
        "Browser proxy",
        "Loopback Browse requests, upstream response framing, and connection failures; cookies and bodies are excluded.",
    ),
    (
        "rdp",
        "RDP",
        "RDP launch, tunnel, and connection lifecycle.",
    ),
    (
        "sftp",
        "SFTP",
        "Session and transfer metadata; file contents are excluded.",
    ),
];
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_LOG_FILES: usize = 5;
const MAX_BUNDLE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_JSON_BODY: usize = 8 * 1024;
const MAX_PENDING_LOG_RECORDS: usize = 4096;
const LOG_BASENAME: &str = "conncat";
const LEGACY_LOG_BASENAME: &str = "catwalk";

fn diagnostic_log_paths(dir: &Path, basename: &str) -> Vec<PathBuf> {
    let mut paths = vec![dir.join(format!("{basename}.jsonl"))];
    paths.extend((1..MAX_LOG_FILES).map(|index| dir.join(format!("{basename}.{index}.jsonl"))));
    paths
}

fn channel_log_filename(channel: &str) -> &'static str {
    match channel {
        "api" => "local-service-api.jsonl",
        "enrollment_updates" => "application-lifecycle.jsonl",
        "ssh_tunnel" => "ssh-tunnels-terminals.jsonl",
        "browse_proxy" => "browser-proxy.jsonl",
        "rdp" => "rdp.jsonl",
        "sftp" => "sftp.jsonl",
        _ => "core-ui.jsonl",
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct LocalConfig {
    #[serde(default)]
    channels: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteCommand {
    pub request_id: String,
    #[serde(default = "default_remote_action")]
    pub action: String,
    #[serde(default)]
    pub channels: BTreeSet<String>,
    pub duration_minutes: u64,
    pub expires_at: String,
    #[serde(default)]
    pub max_bundle_bytes: Option<u64>,
}

fn default_remote_action() -> String {
    "collect".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelInfo {
    pub key: String,
    pub label: String,
    pub description: String,
    pub local_enabled: bool,
    pub remote_enabled: bool,
    pub effective_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub channels: Vec<ChannelInfo>,
    pub log_bytes: u64,
    pub max_log_bytes: u64,
    pub active_remote_request_id: Option<String>,
}

pub struct DiagnosticsManager {
    dir: PathBuf,
    local: Mutex<LocalConfig>,
    remote: Mutex<Option<RemoteCommand>>,
    log_io: Arc<Mutex<()>>,
    log_tx: mpsc::SyncSender<LogCommand>,
}

enum LogCommand {
    Append(Vec<u8>),
    Flush(mpsc::SyncSender<()>),
}

impl DiagnosticsManager {
    pub fn new(app: &AppHandle) -> Result<Arc<Self>, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("diagnostics");
        fs::create_dir_all(&dir).map_err(|e| format!("create diagnostics directory: {e}"))?;
        let local = read_json::<LocalConfig>(&dir.join("config.json")).unwrap_or_default();
        let remote = read_json::<RemoteCommand>(&dir.join("active-remote.json"));
        Ok(Arc::new(Self::with_state(dir, local, remote)?))
    }

    fn with_state(
        dir: PathBuf,
        local: LocalConfig,
        remote: Option<RemoteCommand>,
    ) -> Result<Self, String> {
        let log_io = Arc::new(Mutex::new(()));
        let (log_tx, log_rx) = mpsc::sync_channel(MAX_PENDING_LOG_RECORDS);
        let writer_dir = dir.clone();
        let writer_io = Arc::clone(&log_io);
        thread::Builder::new()
            .name("conncat-diagnostics-writer".into())
            .spawn(move || {
                while let Ok(command) = log_rx.recv() {
                    match command {
                        LogCommand::Append(bytes) => {
                            let _ = append_log_record(&writer_dir, &writer_io, &bytes);
                        }
                        LogCommand::Flush(done) => {
                            let _ = done.send(());
                        }
                    }
                }
            })
            .map_err(|error| format!("start diagnostics writer: {error}"))?;
        Ok(Self {
            dir,
            local: Mutex::new(local),
            remote: Mutex::new(remote),
            log_io,
            log_tx,
        })
    }

    pub fn status(&self) -> Status {
        let local = self.local.lock().unwrap().channels.clone();
        let remote_guard = self.remote.lock().unwrap();
        let remote = remote_guard
            .as_ref()
            .map(|r| r.channels.clone())
            .unwrap_or_default();
        Status {
            channels: CHANNELS
                .iter()
                .map(|(key, label, description)| ChannelInfo {
                    key: (*key).into(),
                    label: (*label).into(),
                    description: (*description).into(),
                    local_enabled: local.contains(*key),
                    remote_enabled: remote.contains(*key),
                    effective_enabled: local.contains(*key) || remote.contains(*key),
                })
                .collect(),
            log_bytes: self.log_bytes(),
            max_log_bytes: MAX_LOG_BYTES * MAX_LOG_FILES as u64,
            active_remote_request_id: remote_guard.as_ref().map(|r| r.request_id.clone()),
        }
    }

    pub fn set_local(&self, channels: Vec<String>) -> Result<Status, String> {
        let valid: BTreeSet<&str> = CHANNELS.iter().map(|c| c.0).collect();
        let channels: BTreeSet<String> = channels
            .into_iter()
            .filter(|c| valid.contains(c.as_str()))
            .collect();
        let config = LocalConfig { channels };
        write_json_atomic(&self.dir.join("config.json"), &config)?;
        *self.local.lock().unwrap() = config;
        Ok(self.status())
    }

    #[cfg(test)]
    fn start_remote(&self, command: RemoteCommand) -> Result<(), String> {
        let mut guard = self.remote.lock().unwrap();
        if guard.as_ref().map(|r| r.request_id.as_str()) == Some(command.request_id.as_str()) {
            return Ok(());
        }
        write_json_atomic(&self.dir.join("active-remote.json"), &command)?;
        *guard = Some(command);
        Ok(())
    }

    #[cfg(test)]
    fn finish_remote(&self, request_id: &str) {
        let mut guard = self.remote.lock().unwrap();
        if guard.as_ref().map(|r| r.request_id.as_str()) == Some(request_id) {
            *guard = None;
            let _ = fs::remove_file(self.dir.join("active-remote.json"));
        }
    }

    fn enabled(&self, channel: &str) -> bool {
        self.local.lock().unwrap().channels.contains(channel)
            || self
                .remote
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|r| r.channels.contains(channel))
    }

    pub fn event(&self, channel: &str, level: &str, target: &str, message: &str, fields: Value) {
        let verbose = matches!(
            level.to_ascii_lowercase().as_str(),
            "debug" | "trace" | "info"
        );
        if verbose && !self.enabled(channel) {
            return;
        }
        let mut fields = redact_value(fields, None);
        if channel == "api" {
            let encoded = serde_json::to_vec(&fields).unwrap_or_default();
            if encoded.len() > MAX_JSON_BODY {
                fields = json!({"detail": "[truncated: API diagnostic fields exceeded 8 KiB]"});
            }
        }
        let record = json!({
            "timestamp_ms": now_ms(), "level": level.to_ascii_lowercase(), "channel": channel,
            "target": target, "message": redact_string(message), "fields": fields,
        });
        if let Ok(mut bytes) = serde_json::to_vec(&record) {
            bytes.push(b'\n');
            // Never make a high-volume child process wait on filesystem I/O.
            // Bundle and clear operations explicitly flush this FIFO first.
            let _ = self.log_tx.try_send(LogCommand::Append(bytes));
        }
    }

    fn flush_pending(&self) -> Result<(), String> {
        let (done_tx, done_rx) = mpsc::sync_channel(0);
        self.log_tx
            .send(LogCommand::Flush(done_tx))
            .map_err(|_| "diagnostics writer stopped".to_string())?;
        done_rx
            .recv()
            .map_err(|_| "diagnostics writer stopped before flushing".to_string())
    }

    pub fn clear_logs(&self) -> Result<Status, String> {
        self.flush_pending()?;
        let guard = self
            .log_io
            .lock()
            .map_err(|_| "diagnostics log lock poisoned".to_string())?;
        for path in diagnostic_log_paths(&self.dir, LOG_BASENAME)
            .into_iter()
            .chain(diagnostic_log_paths(&self.dir, LEGACY_LOG_BASENAME))
        {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "remove diagnostics log {}: {error}",
                        path.display()
                    ));
                }
            }
        }
        drop(guard);
        Ok(self.status())
    }

    fn log_paths(&self) -> Vec<PathBuf> {
        // New ConnCat logs are listed first (newest set), followed by legacy
        // Catwalk logs. component_logs reverses the combined list so an
        // upgrade exports the older legacy records before current records.
        let mut out = diagnostic_log_paths(&self.dir, LOG_BASENAME);
        out.extend(diagnostic_log_paths(&self.dir, LEGACY_LOG_BASENAME));
        out.into_iter().filter(|p| p.is_file()).collect()
    }

    fn log_bytes(&self) -> u64 {
        self.log_paths()
            .iter()
            .filter_map(|p| fs::metadata(p).ok())
            .map(|m| m.len())
            .sum()
    }

    fn component_logs(&self) -> Result<BTreeMap<String, Vec<u8>>, String> {
        let valid_channels: BTreeSet<&str> = CHANNELS.iter().map(|channel| channel.0).collect();
        let mut output: BTreeMap<String, Vec<u8>> = CHANNELS
            .iter()
            .map(|(key, _, _)| ((*key).to_string(), Vec::new()))
            .collect();

        // Rotated files are newest-first. Read them oldest-first so every
        // component file has a natural chronological order.
        for path in self.log_paths().into_iter().rev() {
            let contents = fs::read(&path)
                .map_err(|error| format!("read diagnostic log {}: {error}", path.display()))?;
            for line in contents.split_inclusive(|byte| *byte == b'\n') {
                if line.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                let channel = serde_json::from_slice::<Value>(line)
                    .ok()
                    .and_then(|record| {
                        record
                            .get("channel")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                    .filter(|channel| valid_channels.contains(channel.as_str()))
                    .unwrap_or_else(|| "core_ui".to_string());
                let component = output.entry(channel).or_default();
                component.extend_from_slice(line);
                if !line.ends_with(b"\n") {
                    component.push(b'\n');
                }
            }
        }
        Ok(output)
    }

    pub fn bundle(
        &self,
        destination: &Path,
        app_version: &str,
        platform: &str,
    ) -> Result<u64, String> {
        self.flush_pending()?;
        let _guard = self
            .log_io
            .lock()
            .map_err(|_| "diagnostics log lock poisoned".to_string())?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let file = fs::File::create(destination).map_err(|e| format!("create bundle: {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let status = self.status();
        let log_files: Map<String, Value> = CHANNELS
            .iter()
            .map(|(key, _, _)| {
                (
                    (*key).to_string(),
                    Value::String(format!("logs/{}", channel_log_filename(key))),
                )
            })
            .collect();
        let manifest = json!({
            "schema_version": 2, "generated_at_ms": now_ms(), "app_version": app_version,
            "platform": platform, "channels": status.channels, "log_bytes": status.log_bytes,
            "max_bundle_bytes": MAX_BUNDLE_BYTES, "log_files": log_files,
            "exclusions": ["terminal input/output", "file contents", "screenshots", "clipboard", "credentials", "private keys"],
        });
        zip.start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        zip.start_file("logs/README.txt", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(
            b"ConnCat diagnostics are separated by component. Each JSONL file is chronological and contains one redacted event per line.\n",
        )
        .map_err(|e| e.to_string())?;
        for (channel, contents) in self.component_logs()? {
            zip.start_file(format!("logs/{}", channel_log_filename(&channel)), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&contents).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        let size = fs::metadata(destination).map_err(|e| e.to_string())?.len();
        if size > MAX_BUNDLE_BYTES {
            let _ = fs::remove_file(destination);
            return Err("diagnostic bundle exceeds 50 MiB limit".into());
        }
        Ok(size)
    }
}

fn append_log_record(dir: &Path, log_io: &Mutex<()>, bytes: &[u8]) -> Result<(), String> {
    let _guard = log_io
        .lock()
        .map_err(|_| "diagnostics log lock poisoned".to_string())?;
    let path = dir.join(format!("{LOG_BASENAME}.jsonl"));
    let size = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size + bytes.len() as u64 > MAX_LOG_BYTES {
        rotate_logs(dir)?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|error| format!("write diagnostics log: {error}"))
}

fn rotate_logs(dir: &Path) -> Result<(), String> {
    let oldest = dir.join(format!("{LOG_BASENAME}.{}.jsonl", MAX_LOG_FILES - 1));
    let _ = fs::remove_file(oldest);
    for index in (1..MAX_LOG_FILES - 1).rev() {
        let from = dir.join(format!("{LOG_BASENAME}.{index}.jsonl"));
        let to = dir.join(format!("{LOG_BASENAME}.{}.jsonl", index + 1));
        if from.exists() {
            fs::rename(from, to).map_err(|error| error.to_string())?;
        }
    }
    let current = dir.join(format!("{LOG_BASENAME}.jsonl"));
    if current.exists() {
        fs::rename(current, dir.join(format!("{LOG_BASENAME}.1.jsonl")))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn install_tracing(manager: Arc<DiagnosticsManager>) {
    let _ = GLOBAL.set(manager);
    // Cap noisy third-party crates at INFO so hyper/reqwest TRACE stops
    // filling core_ui. ConnCat targets keep TRACE for debug channels.
    let filter = Targets::new()
        .with_default(Level::INFO)
        .with_target("conncat", Level::TRACE)
        .with_target("conncat_client", Level::TRACE)
        .with_target("catwalk", Level::TRACE)
        .with_target("catwalk_client", Level::TRACE)
        .with_target("catwalk_shared", Level::TRACE)
        .with_target("webview", Level::TRACE);
    let _ = tracing_subscriber::registry()
        .with(DiagnosticsLayer.with_filter(filter))
        .try_init();
}

static GLOBAL: OnceLock<Arc<DiagnosticsManager>> = OnceLock::new();

struct DiagnosticsLayer;
impl<S> Layer<S> for DiagnosticsLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let Some(manager) = GLOBAL.get() else {
            return;
        };
        let meta = event.metadata();
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);
        let channel = channel_for_target(meta.target());
        let level = match *meta.level() {
            Level::ERROR => "error",
            Level::WARN => "warn",
            Level::INFO => "info",
            Level::DEBUG => "debug",
            Level::TRACE => "trace",
        };
        let message = visitor.message.take().unwrap_or_default();
        manager.event(
            channel,
            level,
            meta.target(),
            &message,
            Value::Object(visitor.fields),
        );
    }
}

#[derive(Default)]
struct FieldVisitor {
    message: Option<String>,
    fields: Map<String, Value>,
}
impl tracing::field::Visit for FieldVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let value = format!("{value:?}");
        if field.name() == "message" {
            self.message = Some(value.trim_matches('"').to_string());
        } else {
            self.fields
                .insert(field.name().into(), Value::String(value));
        }
    }
}

fn channel_for_target(target: &str) -> &'static str {
    let target = target.to_ascii_lowercase();
    if target.contains("sftp") {
        "sftp"
    } else if target.contains("browse_proxy") {
        "browse_proxy"
    } else if target.contains("rdp") {
        "rdp"
    } else if target.contains("tunnel") || target.contains("pty") || target.contains("ssh") {
        "ssh_tunnel"
    } else if target.contains("update") || target.contains("identity") || target.contains("enroll")
    {
        "enrollment_updates"
    } else if target.contains("http") || target.contains("broker") {
        "api"
    } else {
        "core_ui"
    }
}

fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "password",
        "token",
        "secret",
        "authorization",
        "cookie",
        "private_key",
        "credential",
        "api_key",
        "csr",
        "pem",
    ]
    .iter()
    .any(|part| key.contains(part))
}

fn redact_value(value: Value, key: Option<&str>) -> Value {
    if key.is_some_and(sensitive_key) {
        return Value::String("[redacted]".into());
    }
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| {
                    let redacted = redact_value(v, Some(&k));
                    (k, redacted)
                })
                .collect(),
        ),
        Value::Array(items) => {
            Value::Array(items.into_iter().map(|v| redact_value(v, None)).collect())
        }
        Value::String(s) => Value::String(redact_string(&s)),
        other => other,
    }
}

fn redact_string(value: &str) -> String {
    if value.contains("BEGIN PRIVATE KEY") || value.contains("BEGIN CERTIFICATE REQUEST") {
        return "[redacted]".into();
    }
    let mut sanitized = value.to_string();
    for marker in [
        "password=",
        "password:",
        "token=",
        "token:",
        "secret=",
        "secret:",
        "api_key=",
        "api-key=",
    ] {
        let mut cursor = 0;
        loop {
            let lower = sanitized.to_ascii_lowercase();
            let Some(relative) = lower[cursor..].find(marker) else {
                break;
            };
            let start = cursor + relative;
            let value_start = start + marker.len();
            let end = sanitized[value_start..]
                .char_indices()
                .find(|(_, c)| c.is_whitespace() || matches!(c, '&' | ',' | ';'))
                .map(|(offset, _)| value_start + offset)
                .unwrap_or(sanitized.len());
            sanitized.replace_range(value_start..end, "[redacted]");
            cursor = value_start + "[redacted]".len();
            if cursor >= sanitized.len() {
                break;
            }
        }
    }
    let mut words = sanitized.split_whitespace().peekable();
    let mut out = Vec::new();
    while let Some(word) = words.next() {
        if word.eq_ignore_ascii_case("bearer") {
            out.push("Bearer".to_string());
            if words.next().is_some() {
                out.push("[redacted]".into());
            }
        } else if word.matches('.').count() == 2 && word.len() > 40 {
            out.push("[redacted-token]".into());
        } else {
            out.push(word.to_string());
        }
    }
    out.join(" ")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let mut data = Vec::new();
    fs::File::open(path).ok()?.read_to_end(&mut data).ok()?;
    serde_json::from_slice(&data).ok()
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> (Arc<DiagnosticsManager>, PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("conncat-diagnostics-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let manager =
            DiagnosticsManager::with_state(dir.clone(), LocalConfig::default(), None).unwrap();
        (Arc::new(manager), dir)
    }

    #[test]
    fn recursively_redacts_sensitive_data() {
        let input = json!({"password": "nope", "nested": {"access_token": "abc", "safe": "ok"}});
        let out = redact_value(input, None);
        assert_eq!(out["password"], "[redacted]");
        assert_eq!(out["nested"]["access_token"], "[redacted]");
        assert_eq!(out["nested"]["safe"], "ok");
        assert_eq!(
            redact_string("GET /x?token=abc&safe=1"),
            "GET /x?token=[redacted]&safe=1"
        );
    }

    #[test]
    fn maps_native_targets_to_channels() {
        assert!(!CHANNELS.iter().any(|channel| channel.0 == "vm_cml_console"));
        assert_eq!(channel_for_target("conncat_client::sftp"), "sftp");
        assert_eq!(channel_for_target("conncat_client::tunnel"), "ssh_tunnel");
        assert_eq!(
            channel_for_target("conncat_client::browse_proxy"),
            "browse_proxy"
        );
        assert_eq!(
            channel_for_target("conncat_client::updates"),
            "enrollment_updates"
        );
        assert_eq!(channel_for_target("conncat_client::console"), "core_ui");
    }

    #[test]
    fn local_and_remote_channels_are_merged_without_overwriting_local() {
        let (manager, dir) = manager();
        manager.set_local(vec!["api".into()]).unwrap();
        manager
            .start_remote(RemoteCommand {
                request_id: "request-1".into(),
                action: "collect".into(),
                channels: BTreeSet::from(["rdp".into()]),
                duration_minutes: 5,
                expires_at: "2099-01-01T00:00:00Z".into(),
                max_bundle_bytes: None,
            })
            .unwrap();
        let status = manager.status();
        assert!(
            status
                .channels
                .iter()
                .find(|c| c.key == "api")
                .unwrap()
                .effective_enabled
        );
        assert!(
            status
                .channels
                .iter()
                .find(|c| c.key == "rdp")
                .unwrap()
                .effective_enabled
        );
        manager.finish_remote("request-1");
        let status = manager.status();
        assert!(
            status
                .channels
                .iter()
                .find(|c| c.key == "api")
                .unwrap()
                .local_enabled
        );
        assert!(
            !status
                .channels
                .iter()
                .find(|c| c.key == "rdp")
                .unwrap()
                .effective_enabled
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_remote_commands_default_to_collection() {
        let command: RemoteCommand = serde_json::from_value(json!({
            "request_id": "legacy-request",
            "channels": ["api"],
            "duration_minutes": 5,
            "expires_at": "2099-01-01T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(command.action, "collect");
    }

    #[test]
    fn bundle_contains_manifest_and_redacted_logs() {
        let (manager, dir) = manager();
        manager.set_local(vec!["api".into(), "rdp".into()]).unwrap();
        fs::write(
            dir.join("catwalk.jsonl"),
            b"{\"channel\":\"core_ui\",\"message\":\"legacy diagnostic retained\"}\n",
        )
        .unwrap();
        manager.event(
            "api",
            "debug",
            "test",
            "request",
            json!({"password": "bad", "safe": "ok"}),
        );
        manager.event("rdp", "debug", "test", "RDP connection started", json!({}));
        let path = dir.join("bundle.zip");
        manager.bundle(&path, "1.2.3", "macos-aarch64").unwrap();
        let file = fs::File::open(&path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("manifest.json").is_ok());
        let mut bundled_readme = String::new();
        archive
            .by_name("logs/README.txt")
            .unwrap()
            .read_to_string(&mut bundled_readme)
            .unwrap();
        assert!(bundled_readme.contains("ConnCat diagnostics"));
        assert!(archive.by_name("logs/vm-cml-consoles.jsonl").is_err());
        let mut core_log = String::new();
        archive
            .by_name("logs/core-ui.jsonl")
            .unwrap()
            .read_to_string(&mut core_log)
            .unwrap();
        assert!(core_log.contains("legacy diagnostic retained"));
        let mut api_log = String::new();
        archive
            .by_name("logs/local-service-api.jsonl")
            .unwrap()
            .read_to_string(&mut api_log)
            .unwrap();
        assert!(api_log.contains("[redacted]"));
        assert!(!api_log.contains("\"bad\""));
        assert!(!api_log.contains("RDP connection started"));
        let mut rdp_log = String::new();
        archive
            .by_name("logs/rdp.jsonl")
            .unwrap()
            .read_to_string(&mut rdp_log)
            .unwrap();
        assert!(rdp_log.contains("RDP connection started"));
        assert!(!rdp_log.contains("\"password\""));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn clearing_logs_preserves_configuration_and_accepts_new_events() {
        let (manager, dir) = manager();
        manager.set_local(vec!["api".into()]).unwrap();
        manager.event("api", "debug", "test", "before clear", json!({}));
        fs::write(dir.join("catwalk.1.jsonl"), b"old legacy rotated log\n").unwrap();
        fs::write(dir.join("conncat.1.jsonl"), b"old current rotated log\n").unwrap();

        let status = manager.clear_logs().unwrap();
        assert_eq!(status.log_bytes, 0);
        assert!(dir.join("config.json").is_file());
        assert!(!dir.join("catwalk.jsonl").exists());
        assert!(!dir.join("catwalk.1.jsonl").exists());
        assert!(!dir.join("conncat.jsonl").exists());
        assert!(!dir.join("conncat.1.jsonl").exists());

        manager.event("api", "debug", "test", "after clear", json!({}));
        manager.flush_pending().unwrap();
        assert!(fs::read_to_string(dir.join("conncat.jsonl"))
            .unwrap()
            .contains("after clear"));
        let _ = fs::remove_dir_all(dir);
    }
}
