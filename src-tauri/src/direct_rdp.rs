use std::collections::HashMap;
use std::fs;
use std::io::{BufRead as _, BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _, Manager as _};
use zeroize::{Zeroize, ZeroizeOnDrop};

const EVENT_NAME: &str = "catwalk://direct-rdp-event";
const TRUST_FILE: &str = "rdp-certificate-pins.json";

#[derive(Clone)]
pub struct DirectRdpState {
    inner: Arc<DirectRdpInner>,
}

struct DirectRdpInner {
    sessions: Mutex<HashMap<String, SessionProcess>>,
    legacy_sessions: Mutex<HashMap<String, LegacySessionProcess>>,
    active_destinations: Mutex<HashMap<String, String>>,
    pins_path: PathBuf,
    pins_lock: Mutex<()>,
}

struct SessionProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    destination: String,
}

struct LegacySessionProcess {
    child: Arc<Mutex<Child>>,
    disconnect_requested: Arc<AtomicBool>,
    destination: String,
}

struct DestinationReservation {
    inner: Arc<DirectRdpInner>,
    destination: String,
    session_id: String,
    committed: bool,
}

impl DestinationReservation {
    fn new(
        state: &DirectRdpState,
        destination: String,
        session_id: String,
    ) -> Result<Self, String> {
        let mut destinations = state
            .inner
            .active_destinations
            .lock()
            .map_err(|_| "RDP destination lock poisoned".to_string())?;
        if destinations.contains_key(&destination) {
            return Err(format!(
                "An RDP connection to {destination} is already opening or connected."
            ));
        }
        destinations.insert(destination.clone(), session_id.clone());
        drop(destinations);
        Ok(Self {
            inner: state.inner.clone(),
            destination,
            session_id,
            committed: false,
        })
    }

    fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for DestinationReservation {
    fn drop(&mut self) {
        if !self.committed {
            release_destination(&self.inner, &self.destination, &self.session_id);
        }
    }
}

fn release_destination(inner: &DirectRdpInner, destination: &str, session_id: &str) {
    if let Ok(mut destinations) = inner.active_destinations.lock() {
        if destinations.get(destination).map(String::as_str) == Some(session_id) {
            destinations.remove(destination);
        }
    }
}

#[derive(Default)]
struct LegacyExitDiagnostics {
    expected_remote_close: bool,
    user_closed: bool,
    last_error: Option<String>,
}

impl LegacyExitDiagnostics {
    fn observe(&mut self, line: &str) {
        if is_expected_freerdp_user_close(line) {
            self.user_closed = true;
            return;
        }
        if is_expected_freerdp_remote_close(line) {
            self.expected_remote_close = true;
            return;
        }
        if is_noisy_freerdp_terminal_error(line) {
            return;
        }
        if line.contains("[ERROR]") {
            self.last_error = Some(line.trim().to_string());
        }
    }

    fn failure(&self) -> (&'static str, String) {
        if self.expected_remote_close {
            return (
                "remote_session_closed",
                "The RDP server ended the session immediately after connection. Check the account and the server-side desktop session, then try again.".to_string(),
            );
        }
        let detail = self
            .last_error
            .as_deref()
            .unwrap_or("FreeRDP exited before reporting a detailed connection error.");
        let lower = detail.to_ascii_lowercase();
        let (code, summary) = if lower.contains("logon")
            || lower.contains("authentication")
            || lower.contains("credentials")
            || lower.contains("access denied")
        {
            (
                "authentication_failed",
                "FreeRDP could not authenticate with the RDP server.",
            )
        } else if lower.contains("certificate")
            || lower.contains("x509")
            || lower.contains("cert_verify")
        {
            (
                "certificate_failed",
                "FreeRDP could not verify the RDP server certificate.",
            )
        } else {
            (
                "network_failed",
                "ConneCat FreeRDP could not complete the RDP connection.",
            )
        };
        (code, summary.to_string())
    }
}

fn legacy_exit_succeeded(
    process_succeeded: bool,
    requested_disconnect: bool,
    diagnostics: &LegacyExitDiagnostics,
    elapsed: Duration,
) -> bool {
    process_succeeded
        || requested_disconnect
        || diagnostics.user_closed
        || (diagnostics.expected_remote_close && elapsed >= Duration::from_secs(15))
}

fn is_expected_freerdp_user_close(line: &str) -> bool {
    line.contains("ERRCONNECT_CONNECT_CANCELLED")
        || line.contains("Connection aborted by user")
        || line.contains("ERRCONNECT_USER_CANCELED")
}

fn is_expected_freerdp_remote_close(line: &str) -> bool {
    [
        "ERRINFO_LOGOFF_BY_USER",
        "ERRINFO_RPC_INITIATED_LOGOFF",
        "ERRINFO_RPC_INITIATED_DISCONNECT",
    ]
    .iter()
    .any(|marker| line.contains(marker))
}

fn is_noisy_freerdp_terminal_error(line: &str) -> bool {
    line.contains("com.freerdp.utils.passphrase")
        && (line.contains("tcsetattr")
            || line.contains("tcgetattr")
            || line.contains("Inappropriate ioctl for device"))
}

fn is_high_frequency_freerdp_event_trace(line: &str) -> bool {
    line.contains("SDL_EVENT_USER_UPDATE") || line.contains("SDL_EVENT_MOUSE_MOTION")
}

fn is_verbose_ironrdp_diagnostic(line: &str) -> bool {
    line.contains(" DEBUG ") || line.contains(" TRACE ")
}

fn is_freerdp_connected_line(line: &str) -> bool {
    line.contains("[gdi_init_ex]")
        || line.contains("Local framebuffer format")
        || line.contains("RDPDR_USER_LOGGEDON_PDU")
        || line.contains("Accepting resumed PAKID_CORE_USER_LOGGEDON")
        // FreeRDP emits this server status after a successful automatic
        // reconnect. The desktop can already be usable without repeating the
        // initial GDI/RDPDR log lines, so this is the authoritative signal for
        // clearing ConneCat's reconnect notice.
        || line.contains("AutoReconnectStatus: 0x00000000")
}

fn is_freerdp_reconnecting_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("auto reconnect")
        || lower.contains("auto-reconnect")
        || lower.contains("attempting reconnect")
        || lower.contains("reconnecting")
}

fn is_freerdp_network_disconnect_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    [
        "network disconnect",
        "bio_read returned a system error",
        "errconnect_connect_transport_failed",
        "errconnect_dns_name_not_found",
        "couldn't get socket ip address",
        "connectlayer",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn should_emit_freerdp_reconnecting(line: &str, user_closed: bool) -> bool {
    is_freerdp_reconnecting_line(line) || (!user_closed && is_freerdp_network_disconnect_line(line))
}

fn viewer_negotiation_failure(
    line: &str,
    security_mode: RdpSecurityMode,
) -> Option<(&'static str, &'static str)> {
    if !matches!(security_mode, RdpSecurityMode::Nla) {
        return None;
    }
    if line.contains("FailureCode(1)") {
        return Some((
            "security_protocol_unsupported",
            "The RDP server requires Enhanced RDP Security with TLS. ConneCat will retry using TLS.",
        ));
    }
    if line.contains("FailureCode(2)") {
        return Some((
            "security_protocol_unsupported",
            "The RDP server only supports Standard RDP Security.",
        ));
    }
    None
}

#[derive(Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    #[zeroize(skip)]
    session_id: String,
    #[zeroize(skip)]
    connection_id: String,
    #[zeroize(skip)]
    title: String,
    #[zeroize(skip)]
    host: String,
    #[zeroize(skip)]
    port: u16,
    username: String,
    domain: String,
    password: String,
    #[serde(default)]
    #[zeroize(skip)]
    security_mode: RdpSecurityMode,
    #[serde(default)]
    #[zeroize(skip)]
    quality_profile: RdpQualityProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[zeroize(skip)]
    theme: Option<RdpWindowTheme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[zeroize(skip)]
    width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[zeroize(skip)]
    height: Option<u16>,
    #[serde(default)]
    #[zeroize(skip)]
    resolution_override: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpWindowTheme {
    mode: String,
    #[serde(default)]
    background: String,
    #[serde(default)]
    surface: String,
    #[serde(default)]
    border: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    muted: String,
    titlebar: String,
    accent: String,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum RdpSecurityMode {
    #[default]
    Nla,
    Tls,
    Rdp,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum RdpQualityProfile {
    #[default]
    Balanced,
    LowBandwidth,
    VeryLowBandwidth,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ParentCommand<'a> {
    CertificateDecision {
        fingerprint: &'a str,
        decision: &'a str,
    },
    Disconnect,
}

impl DirectRdpState {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("create ConneCat app data directory: {error}"))?;
        Ok(Self {
            inner: Arc::new(DirectRdpInner {
                sessions: Mutex::new(HashMap::new()),
                legacy_sessions: Mutex::new(HashMap::new()),
                active_destinations: Mutex::new(HashMap::new()),
                pins_path: app_data_dir.join(TRUST_FILE),
                pins_lock: Mutex::new(()),
            }),
        })
    }

    fn write_command(&self, session_id: &str, command: &ParentCommand<'_>) -> Result<(), String> {
        let sessions = self
            .inner
            .sessions
            .lock()
            .map_err(|_| "RDP session lock poisoned".to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "RDP session is no longer active".to_string())?;
        let mut stdin = session
            .stdin
            .lock()
            .map_err(|_| "RDP input lock poisoned".to_string())?;
        serde_json::to_writer(&mut *stdin, command)
            .map_err(|error| format!("encode RDP command: {error}"))?;
        stdin
            .write_all(b"\n")
            .map_err(|error| format!("write RDP command: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("flush RDP command: {error}"))
    }

    pub fn terminate_all(&self) {
        if let Ok(mut sessions) = self.inner.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.child.lock().map(|mut child| child.kill());
            }
        }
        if let Ok(mut sessions) = self.inner.legacy_sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.child.lock().map(|mut child| child.kill());
            }
        }
    }

    /// Includes both connected processes and destinations still being opened.
    /// A poisoned lock is treated as active so renderer recovery fails safe.
    pub fn active_count(&self) -> usize {
        let sessions = self
            .inner
            .sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(1);
        let legacy = self
            .inner
            .legacy_sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(1);
        let destinations = self
            .inner
            .active_destinations
            .lock()
            .map(|destinations| destinations.len())
            .unwrap_or(1);
        sessions.max(destinations) + legacy
    }
}

impl Drop for DirectRdpInner {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.child.lock().map(|mut child| child.kill());
            }
        }
        if let Ok(mut sessions) = self.legacy_sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.child.lock().map(|mut child| child.kill());
            }
        }
    }
}

fn normalized_target(host: &str, port: u16) -> String {
    let host = host.trim().trim_matches(['[', ']']).to_lowercase();
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn read_pins(path: &Path) -> HashMap<String, String> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_pin(path: &Path, host: &str, port: u16, fingerprint: &str) -> Result<(), String> {
    let mut pins = read_pins(path);
    pins.insert(
        normalized_target(host, port),
        fingerprint.to_ascii_uppercase(),
    );
    let bytes = serde_json::to_vec_pretty(&pins)
        .map_err(|error| format!("encode RDP trust store: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| format!("write RDP trust store: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("replace RDP trust store: {error}"))
}

fn valid_fingerprint(fingerprint: &str) -> bool {
    fingerprint.len() == 64 && fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn viewer_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CATWALK_RDP_VIEWER_PATH").map(PathBuf::from) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "CATWALK_RDP_VIEWER_PATH does not exist: {}",
            path.display()
        ));
    }
    let executable =
        std::env::current_exe().map_err(|error| format!("locate ConneCat executable: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "ConneCat executable has no parent directory".to_string())?;
    let candidates = [
        directory.join("catwalk-rdp-viewer"),
        directory.join("catwalk-rdp-viewer.exe"),
        directory.join("catwalk-rdp-viewer-aarch64-apple-darwin"),
        directory.join("catwalk-rdp-viewer-x86_64-apple-darwin"),
        directory.join("catwalk-rdp-viewer-x86_64-pc-windows-msvc.exe"),
    ];
    candidates.into_iter().find(|path| path.is_file()).ok_or_else(|| "ConneCat RDP viewer is not installed. Reinstall or update ConneCat, or select System RDP client in this Connection.".to_string())
}

fn viewer_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn show_certificate_prompt_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!(
            target: "catwalk_client::direct_rdp",
            "Could not find the main ConneCat window for the RDP certificate prompt"
        );
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    // The separate native viewer is normally the foreground window. Keeping
    // ConneCat temporarily above it makes the trust decision impossible to
    // miss; the certificate command removes this flag immediately.
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
}

pub fn release_certificate_prompt_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(false);
    }
}

fn freerdp_candidates(
    override_path: Option<PathBuf>,
    executable_dir: Option<&Path>,
) -> Vec<PathBuf> {
    if let Some(path) = override_path {
        return vec![path];
    }
    let mut candidates = Vec::new();
    let mut add_directory = |directory: PathBuf| {
        for executable in [
            "catwalk-freerdp.exe",
            "wfreerdp.exe",
            "wfreerdp3.exe",
            "sdl-freerdp.exe",
            "sdl-freerdp3.exe",
            "catwalk-freerdp",
            "sdl-freerdp",
            "sdl-freerdp3",
        ] {
            candidates.push(directory.join(executable));
        }
    };
    if let Some(directory) = executable_dir {
        add_directory(directory.to_path_buf());
    }
    add_directory(PathBuf::from("/opt/homebrew/bin"));
    add_directory(PathBuf::from("/usr/local/bin"));
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            add_directory(directory);
        }
    }
    for program_files in ["ProgramFiles", "ProgramFiles(x86)"]
        .into_iter()
        .filter_map(std::env::var_os)
    {
        let directory = PathBuf::from(program_files).join("FreeRDP").join("bin");
        add_directory(directory);
    }
    if let Some(chocolatey) = std::env::var_os("ChocolateyInstall") {
        let root = PathBuf::from(chocolatey);
        add_directory(root.join("bin"));
        add_directory(root.join("lib").join("freerdp").join("tools"));
    }
    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        let scoop = PathBuf::from(user_profile).join("scoop");
        add_directory(scoop.join("shims"));
        add_directory(
            scoop
                .join("apps")
                .join("freerdp")
                .join("current")
                .join("bin"),
        );
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let root = PathBuf::from(local_app_data);
        add_directory(root.join("Programs").join("FreeRDP").join("bin"));
        add_directory(root.join("Microsoft").join("WinGet").join("Links"));
    }
    candidates.dedup();
    candidates
}

fn freerdp_path() -> Result<PathBuf, String> {
    let override_path = std::env::var_os("CATWALK_FREERDP_PATH").map(PathBuf::from);
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let candidates = freerdp_candidates(override_path.clone(), executable_dir.as_deref());
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return Ok(path);
    }
    if let Some(path) = override_path {
        return Err(format!(
            "CATWALK_FREERDP_PATH does not exist: {}",
            path.display()
        ));
    }
    #[cfg(target_os = "windows")]
    return Err("ConneCat FreeRDP was not found. Windows development and release builds include it automatically; set CATWALK_FREERDP_PATH only to test a custom patched wfreerdp.exe. IronRDP remains available as the bundled ConneCat client.".into());

    #[cfg(not(target_os = "windows"))]
    Err("ConneCat FreeRDP is not installed. Install FreeRDP (brew install freerdp), then try again or open this Connection with the system RDP client.".into())
}

fn freerdp_prefers_dark_chrome(theme: Option<&RdpWindowTheme>) -> bool {
    !theme.is_some_and(|theme| theme.mode.eq_ignore_ascii_case("light"))
}

#[cfg(any(target_os = "windows", test))]
fn parse_theme_rgb(value: &str) -> Option<u32> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        return match hex.len() {
            3 => {
                let mut digits = hex.chars();
                let r = digits.next()?.to_digit(16)? as u32;
                let g = digits.next()?.to_digit(16)? as u32;
                let b = digits.next()?.to_digit(16)? as u32;
                Some((r * 0x11 << 16) | (g * 0x11 << 8) | (b * 0x11))
            }
            6 => u32::from_str_radix(hex, 16).ok(),
            _ => None,
        };
    }
    let components = value
        .strip_prefix("rgb(")?
        .strip_suffix(')')?
        .split(',')
        .map(|component| component.trim().parse::<u8>().ok())
        .collect::<Option<Vec<_>>>()?;
    (components.len() == 3).then(|| {
        (u32::from(components[0]) << 16)
            | (u32::from(components[1]) << 8)
            | u32::from(components[2])
    })
}

#[cfg(target_os = "macos")]
fn branded_macos_freerdp_path(app: &AppHandle, executable: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::symlink;

    const PROD_ICON: &[u8] = include_bytes!("../freerdp-icons/paw-purple.icns");
    const DEV_ICON: &[u8] = include_bytes!("../freerdp-icons/halloween.icns");

    let development_edition = cfg!(debug_assertions)
        || app
            .config()
            .identifier
            .to_ascii_lowercase()
            .contains("beta");
    let (edition, bundle_identifier, icon) = if development_edition {
        ("development", "io.catwalk.freerdp.development", DEV_ICON)
    } else {
        ("production", "io.catwalk.freerdp", PROD_ICON)
    };
    let contents = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("resolve ConneCat FreeRDP cache directory: {error}"))?
        .join("freerdp-launchers")
        .join(edition)
        .join("ConneCat FreeRDP.app")
        .join("Contents");
    let macos = contents.join("MacOS");
    let resources = contents.join("Resources");
    fs::create_dir_all(&macos)
        .and_then(|()| fs::create_dir_all(&resources))
        .map_err(|error| format!("create branded ConneCat FreeRDP bundle: {error}"))?;
    fs::write(resources.join("ConneCatFreeRDP.icns"), icon)
        .map_err(|error| format!("write branded ConneCat FreeRDP icon: {error}"))?;
    fs::write(
        contents.join("Info.plist"),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>ConneCat FreeRDP</string>
  <key>CFBundleExecutable</key><string>ConneCatFreeRDP</string>
  <key>CFBundleIconFile</key><string>ConneCatFreeRDP.icns</string>
  <key>CFBundleIdentifier</key><string>{bundle_identifier}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>ConneCat FreeRDP</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
"#
        ),
    )
    .map_err(|error| format!("write branded ConneCat FreeRDP bundle metadata: {error}"))?;

    let launcher = macos.join("ConneCatFreeRDP");
    if fs::symlink_metadata(&launcher).is_ok() {
        fs::remove_file(&launcher)
            .map_err(|error| format!("refresh branded ConneCat FreeRDP launcher: {error}"))?;
    }
    let executable = executable
        .canonicalize()
        .map_err(|error| format!("resolve FreeRDP executable: {error}"))?;
    symlink(&executable, &launcher)
        .map_err(|error| format!("link branded ConneCat FreeRDP launcher: {error}"))?;
    tracing::debug!(
        target: "catwalk_client::direct_rdp",
        edition,
        source = %executable.display(),
        launcher = %launcher.display(),
        "Prepared branded macOS FreeRDP application"
    );
    Ok(launcher)
}

#[cfg(target_os = "windows")]
fn install_windows_freerdp_window(
    app: &AppHandle,
    process_id: u32,
    theme: Option<&RdpWindowTheme>,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, LoadImageW, SendMessageW, HICON, ICON_BIG,
        ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, WM_SETICON,
    };

    const PROD_ICON: &[u8] = include_bytes!("../freerdp-icons/paw-purple.ico");
    const DEV_ICON: &[u8] = include_bytes!("../freerdp-icons/halloween.ico");
    let dark_chrome = freerdp_prefers_dark_chrome(theme);
    let caption_rgb = theme
        .and_then(|theme| parse_theme_rgb(&theme.titlebar))
        .unwrap_or(if dark_chrome { 0x1e293b } else { 0xf8fafc });
    let border_rgb = theme
        .and_then(|theme| parse_theme_rgb(&theme.accent))
        .unwrap_or(0x38bdf8);

    let development_edition = cfg!(debug_assertions)
        || app
            .config()
            .identifier
            .to_ascii_lowercase()
            .contains("beta");
    let (edition, icon) = if development_edition {
        ("development", DEV_ICON)
    } else {
        ("production", PROD_ICON)
    };
    let icon_path = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("resolve ConneCat FreeRDP cache directory: {error}"))?
        .join("freerdp-launchers")
        .join(edition)
        .join("ConneCatFreeRDP.ico");
    let parent = icon_path
        .parent()
        .ok_or_else(|| "resolve branded ConneCat FreeRDP icon directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create branded ConneCat FreeRDP icon directory: {error}"))?;
    fs::write(&icon_path, icon)
        .map_err(|error| format!("write branded ConneCat FreeRDP icon: {error}"))?;

    let path = icon_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: `path` is NUL-terminated and lives through the LoadImageW call.
    let icon = unsafe {
        LoadImageW(
            std::ptr::null_mut(),
            path.as_ptr(),
            IMAGE_ICON,
            0,
            0,
            LR_LOADFROMFILE,
        )
    } as HICON;
    if icon.is_null() {
        return Err("load branded ConneCat FreeRDP Windows icon".into());
    }

    struct WindowIconContext {
        process_id: u32,
        icon: HICON,
        dark_chrome: i32,
        caption: u32,
        border: u32,
        text: u32,
        found: bool,
    }

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: HWND,
            attribute: u32,
            value: *const core::ffi::c_void,
            value_size: u32,
        ) -> i32;
    }

    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    fn colorref(rgb: u32) -> u32 {
        ((rgb & 0xff) << 16) | (rgb & 0x00ff00) | ((rgb >> 16) & 0xff)
    }

    unsafe extern "system" fn set_icon(hwnd: HWND, parameter: LPARAM) -> BOOL {
        // SAFETY: EnumWindows passes the pointer supplied below for the
        // duration of this synchronous enumeration.
        let context = unsafe { &mut *(parameter as *mut WindowIconContext) };
        let mut window_process_id = 0u32;
        // SAFETY: `hwnd` is supplied by EnumWindows and the process-id pointer
        // is valid for this call.
        unsafe { GetWindowThreadProcessId(hwnd, &mut window_process_id) };
        if window_process_id == context.process_id {
            // SAFETY: WM_SETICON accepts an HICON in LPARAM. The icon remains
            // loaded for the ConneCat process lifetime after this handoff.
            unsafe {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG as WPARAM, context.icon as LPARAM);
                SendMessageW(
                    hwnd,
                    WM_SETICON,
                    ICON_SMALL as WPARAM,
                    context.icon as LPARAM,
                );
            }
            for (attribute, value) in [
                (DWMWA_USE_IMMERSIVE_DARK_MODE, context.dark_chrome as u32),
                (DWMWA_CAPTION_COLOR, context.caption),
                (DWMWA_BORDER_COLOR, context.border),
                (DWMWA_TEXT_COLOR, context.text),
            ] {
                // Unsupported Windows versions retain their normal system
                // title bar while newer versions adopt the ConneCat chrome.
                unsafe {
                    DwmSetWindowAttribute(
                        hwnd,
                        attribute,
                        (&value as *const u32).cast(),
                        core::mem::size_of::<u32>() as u32,
                    );
                }
            }
            context.found = true;
        }
        TRUE
    }

    // Raw Win32 handles are not `Send`; transfer the stable handle value and
    // reconstruct its typed representation inside the worker.
    let icon_address = icon as usize;
    std::thread::spawn(move || {
        let mut context = WindowIconContext {
            process_id,
            icon: icon_address as HICON,
            dark_chrome: i32::from(dark_chrome),
            caption: colorref(caption_rgb),
            border: colorref(border_rgb),
            text: colorref(if dark_chrome { 0xf8fafc } else { 0x111827 }),
            found: false,
        };
        let mut found_any = false;
        for _ in 0..50 {
            context.found = false;
            // SAFETY: the callback is synchronous and receives a valid pointer
            // to `context` for this enumeration.
            unsafe {
                EnumWindows(
                    Some(set_icon),
                    (&mut context as *mut WindowIconContext) as LPARAM,
                )
            };
            found_any |= context.found;
            // Keep scanning after the first match: FreeRDP may create its
            // console/helper window before the actual desktop window.
            std::thread::sleep(Duration::from_millis(100));
        }
        if found_any {
            tracing::debug!(
                target: "catwalk_client::direct_rdp",
                process_id,
                edition,
                "Installed branded Windows FreeRDP window icon and ConneCat title-bar theme"
            );
        } else {
            tracing::warn!(
                target: "catwalk_client::direct_rdp",
                process_id,
                edition,
                "FreeRDP window did not appear in time for branded icon handoff"
            );
        }
    });
    Ok(())
}

fn freerdp_args(request: &LaunchRequest) -> Vec<String> {
    let target = normalized_target(&request.host, request.port);
    let security = match request.security_mode {
        RdpSecurityMode::Nla => "/sec:nla",
        RdpSecurityMode::Tls => "/sec:tls",
        RdpSecurityMode::Rdp => "/sec:rdp",
    };
    let (width, height) = freerdp_initial_size(request);
    let mut args = vec![
        format!("/v:{target}"),
        format!("/u:{}", request.username),
        format!("/t:ConneCat RDP — {}", request.title),
        format!("/size:{width}x{height}"),
        "/from-stdin:force".into(),
        security.into(),
        "/cert:tofu".into(),
        // Keep the compatibility switch used by the last known-working
        // macOS SDL-FreeRDP launch. The more specific FreeRDP 3
        // `/clipboard:direction-to:...` form is accepted by the parser but
        // did not activate clipboard synchronization in the SDL client.
        "+clipboard".into(),
        "+auto-reconnect".into(),
        "/auto-reconnect-max-retries:30".into(),
    ];
    args.push(match request.quality_profile {
        RdpQualityProfile::Balanced => "/network:lan".into(),
        RdpQualityProfile::LowBandwidth => "/network:broadband-low".into(),
        RdpQualityProfile::VeryLowBandwidth => "/network:modem".into(),
    });
    if !matches!(request.quality_profile, RdpQualityProfile::Balanced) {
        // FreeRDP's network hint alone does not consistently suppress costly
        // desktop effects on every server. Match IronRDP's reduced-effects
        // profiles explicitly, which is especially important for photographic
        // wallpapers over the unaccelerated NSCodec fallback.
        args.extend([
            "-wallpaper".into(),
            "-window-drag".into(),
            "-menu-anims".into(),
            "-themes".into(),
            "-fonts".into(),
        ]);
    }
    #[cfg(target_os = "macos")]
    args.extend([
        // Clipboard diagnostics report only format names, IDs, and byte
        // counts. They are needed for the macOS MIME conversion workaround
        // without recording clipboard contents. Keep the parent SDL category
        // at WARN: TRACE includes every repaint and pointer event, which can
        // fill the child output pipe and block SDL's macOS event loop while
        // RDP diagnostics are enabled.
        "/log-filters:com.freerdp.client.SDL:WARN,com.freerdp.client.sdl.cliprdr:TRACE,com.winpr.clipboard:DEBUG,com.freerdp.channels.cliprdr.client:TRACE".into(),
        // Keep SDL in a regular decorated window. Smart sizing scales the
        // remote desktop inside that fixed window without asking SDL to
        // recreate the macOS surface while the session is activating.
        "/smart-sizing".into(),
        "-toggle-fullscreen".into(),
        "/window-position:80x60".into(),
    ]);
    #[cfg(not(target_os = "macos"))]
    args.push("/dynamic-resolution".into());
    #[cfg(target_os = "windows")]
    args.extend([
        // Keep the nested client in an explicitly positioned decorated window
        // with accessible minimize/maximize/close controls.
        "-toggle-fullscreen".into(),
        "/window-position:80x60".into(),
    ]);
    if !request.domain.trim().is_empty() {
        args.push(format!("/d:{}", request.domain));
    }
    args
}

fn freerdp_initial_size(request: &LaunchRequest) -> (u16, u16) {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    // Do not match common MacBook logical screen sizes: SDL-FreeRDP promotes
    // a screen-sized surface into fullscreen on macOS and creates an
    // effectively unmanageable maximized window in a nested Windows session.
    let (default_width, default_height) = (1100, 700);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (default_width, default_height) = (1440, 900);
    let width = request.width.unwrap_or(default_width).max(640);
    let height = request.height.unwrap_or(default_height).max(480);
    if request.resolution_override {
        return (width.min(3840), height.min(2160));
    }
    #[cfg(target_os = "windows")]
    let (width, height) = (width.min(1100), height.min(700));
    match request.quality_profile {
        RdpQualityProfile::Balanced => {
            #[cfg(target_os = "macos")]
            {
                // Automatic sizing stays capped at 1440x900. Passing Retina's
                // physical 3840x2160 surface made FreeRDP decode over six
                // times as many pixels before smart-sizing them back down;
                // an explicit saved resolution bypasses this branch above.
                (width.min(1440), height.min(900))
            }
            #[cfg(not(target_os = "macos"))]
            {
                (width, height)
            }
        }
        RdpQualityProfile::LowBandwidth => (width.min(1024), height.min(768)),
        RdpQualityProfile::VeryLowBandwidth => (width.min(800), height.min(600)),
    }
}

fn freerdp_command(path: &Path, request: &LaunchRequest) -> Command {
    let mut command = Command::new(path);
    command
        .args(freerdp_args(request))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt as _;

        // Nested Windows RDP sessions can lose SDL raw-input keyboard events.
        // Force the regular focused-window message loop, matching SDL3's
        // documented compatibility path. The FreeRDP compatibility build also
        // disables AINPUT so pointer events use the patched core slow path.
        //
        // Do not use Direct3D for the nested viewer. SDL otherwise selects the
        // `direct3d` renderer, and its presentation path can stop servicing the
        // window when the outer RDP session receives a burst of changed pixels
        // (for example, opening or moving a remote application). The software
        // renderer keeps presentation on the SDL window thread and is fast
        // enough for ConneCat's bounded 1100x700 nested desktop.
        command
            .env("SDL_WINDOWS_RAW_KEYBOARD", "0")
            .env("SDL_WINDOWS_ENABLE_MESSAGELOOP", "1")
            .env("SDL_RENDER_DRIVER", "software");

        // Never let a FreeRDP sidecar own ConneCat's development console.
        // Console-mode FreeRDP builds may hide/detach their inherited console
        // when stdin is a credential pipe, which otherwise makes the
        // PowerShell running `tauri dev` disappear.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(target_os = "macos")]
    command
        .env("SDL_VIDEO_MAC_FULLSCREEN_SPACES", "0")
        .env("SDL_VIDEO_MAC_FULLSCREEN_MENU_VISIBILITY", "1")
        .env(
            "CATWALK_FREERDP_APPEARANCE",
            if freerdp_prefers_dark_chrome(request.theme.as_ref()) {
                "dark"
            } else {
                "light"
            },
        );
    command
}

fn wait_for_child(child: &Arc<Mutex<Child>>) -> Option<std::process::ExitStatus> {
    loop {
        let status = child.lock().ok()?.try_wait().ok()?;
        if status.is_some() {
            return status;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn validate(request: &LaunchRequest) -> Result<(), String> {
    if request.session_id.trim().is_empty() {
        return Err("RDP session id is required".into());
    }
    if request.host.trim().is_empty() || request.host.chars().any(char::is_whitespace) {
        return Err("Invalid RDP host".into());
    }
    if request.port == 0 {
        return Err("Invalid RDP port".into());
    }
    if request.username.trim().is_empty() {
        return Err("RDP username is required".into());
    }
    if request.password.is_empty() {
        return Err("RDP password is required".into());
    }
    Ok(())
}

pub fn launch(
    app: AppHandle,
    state: DirectRdpState,
    mut request: LaunchRequest,
) -> Result<String, String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err("ConneCat RDP is currently available on macOS and Windows only; select the System RDP client for this Connection.".into());

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        validate(&request)?;
        let session_id = request.session_id.clone();
        let destination = normalized_target(&request.host, request.port);
        let reservation =
            DestinationReservation::new(&state, destination.clone(), session_id.clone())?;
        tracing::info!(
            target: "catwalk_client::direct_rdp",
            session_id = %session_id,
            connection_id = %request.connection_id,
            host = %request.host,
            port = request.port,
            "Direct RDP launch requested"
        );
        let viewer = viewer_path()?;
        tracing::info!(
            target: "catwalk_client::direct_rdp",
            session_id = %session_id,
            viewer = %viewer.display(),
            "Direct RDP viewer resolved"
        );
        let mut child = viewer_command(&viewer)
            .spawn()
            .map_err(|error| format!("start ConneCat RDP viewer: {error}"))?;
        tracing::info!(
            target: "catwalk_client::direct_rdp",
            session_id = %session_id,
            pid = child.id(),
            "Direct RDP viewer started"
        );
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ConneCat RDP viewer has no input pipe".to_string())?;
        serde_json::to_writer(&mut stdin, &request)
            .map_err(|error| format!("encode RDP launch: {error}"))?;
        stdin
            .write_all(b"\n")
            .map_err(|error| format!("write RDP launch: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("flush RDP launch: {error}"))?;
        request.username.zeroize();
        request.domain.zeroize();
        request.password.zeroize();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "ConneCat RDP viewer has no event pipe".to_string())?;
        let stderr = child.stderr.take();
        let stdin = Arc::new(Mutex::new(stdin));
        let child = Arc::new(Mutex::new(child));
        state
            .inner
            .sessions
            .lock()
            .map_err(|_| "RDP session lock poisoned".to_string())?
            .insert(
                session_id.clone(),
                SessionProcess {
                    child: child.clone(),
                    stdin: stdin.clone(),
                    destination: destination.clone(),
                },
            );

        let event_app = app.clone();
        let event_state = state.clone();
        let event_session_id = session_id.clone();
        let viewer_failure_reported = Arc::new(AtomicBool::new(false));
        let event_failure_reported = viewer_failure_reported.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(mut event) = serde_json::from_str::<serde_json::Value>(&line) else {
                    tracing::warn!(
                        target: "catwalk_client::direct_rdp",
                        session_id = %event_session_id,
                        "Ignored malformed RDP viewer event"
                    );
                    continue;
                };
                if event.get("type").and_then(serde_json::Value::as_str) == Some("error")
                    && event_failure_reported.swap(true, Ordering::AcqRel)
                {
                    tracing::debug!(
                        target: "catwalk_client::direct_rdp",
                        session_id = %event_session_id,
                        "Ignored duplicate RDP viewer failure"
                    );
                    continue;
                }
                tracing::debug!(
                    target: "catwalk_client::direct_rdp",
                    session_id = %event_session_id,
                    event_type = event.get("type").and_then(serde_json::Value::as_str).unwrap_or("unknown"),
                    state = event.get("state").and_then(serde_json::Value::as_str).unwrap_or(""),
                    code = event.get("code").and_then(serde_json::Value::as_str).unwrap_or(""),
                    "Direct RDP viewer event"
                );
                if event.get("type").and_then(serde_json::Value::as_str)
                    == Some("certificate_challenge")
                {
                    let host = event
                        .get("host")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let port = event
                        .get("port")
                        .and_then(serde_json::Value::as_u64)
                        .and_then(|value| u16::try_from(value).ok())
                        .unwrap_or(3389);
                    let fingerprint = event
                        .get("fingerprint")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let saved = read_pins(&event_state.inner.pins_path)
                        .get(&normalized_target(host, port))
                        .cloned();
                    if saved
                        .as_deref()
                        .is_some_and(|pin| pin.eq_ignore_ascii_case(fingerprint))
                    {
                        let _ = event_state.write_command(
                            &event_session_id,
                            &ParentCommand::CertificateDecision {
                                fingerprint,
                                decision: "trust",
                            },
                        );
                        continue;
                    }
                    event["changed"] = serde_json::Value::Bool(saved.is_some());
                    let _ = event_app.emit(EVENT_NAME, event);
                    show_certificate_prompt_window(&event_app);
                    continue;
                }
                let _ = event_app.emit(EVENT_NAME, event);
            }
            // A viewer may exit while ConneCat is showing its certificate
            // challenge. Never leave the main window pinned above every other
            // application after that session is gone.
            release_certificate_prompt_window(&event_app);
            let destination = event_state
                .inner
                .sessions
                .lock()
                .ok()
                .and_then(|mut sessions| sessions.remove(&event_session_id))
                .map(|session| session.destination);
            if let Some(destination) = destination {
                release_destination(&event_state.inner, &destination, &event_session_id);
            }
            let _ = event_app.emit(
                EVENT_NAME,
                serde_json::json!({ "type": "closed", "sessionId": event_session_id }),
            );
        });
        if let Some(stderr) = stderr {
            let stderr_app = app.clone();
            let stderr_session_id = session_id.clone();
            let stderr_security_mode = request.security_mode;
            let stderr_failure_reported = viewer_failure_reported;
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if is_verbose_ironrdp_diagnostic(&line) {
                        tracing::debug!(target: "catwalk_client::direct_rdp", session_id = %stderr_session_id, message = %line, "RDP viewer diagnostic");
                    } else {
                        tracing::warn!(target: "catwalk_client::direct_rdp", session_id = %stderr_session_id, message = %line, "RDP viewer diagnostic");
                    }
                    if let Some((code, message)) =
                        viewer_negotiation_failure(&line, stderr_security_mode)
                    {
                        if stderr_failure_reported
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                        {
                            let _ = stderr_app.emit(
                                EVENT_NAME,
                                serde_json::json!({
                                    "type": "error",
                                    "sessionId": stderr_session_id,
                                    "code": code,
                                    "message": message,
                                }),
                            );
                        }
                    }
                }
            });
        }
        let wait_app = app;
        let wait_session_id = session_id.clone();
        std::thread::spawn(move || {
            let status = wait_for_child(&child);
            if status
                .as_ref()
                .is_some_and(std::process::ExitStatus::success)
            {
                tracing::info!(
                    target: "catwalk_client::direct_rdp",
                    session_id = %wait_session_id,
                    "Direct RDP viewer exited"
                );
            } else {
                tracing::warn!(
                    target: "catwalk_client::direct_rdp",
                    session_id = %wait_session_id,
                    exit_code = ?status.as_ref().and_then(|value| value.code()),
                    "Direct RDP viewer exited unsuccessfully"
                );
            }
            let _ = wait_app.emit(
                EVENT_NAME,
                serde_json::json!({
                    "type": "exit",
                    "sessionId": wait_session_id,
                    "success": status.as_ref().is_some_and(std::process::ExitStatus::success),
                    "code": status.and_then(|value| value.code()),
                }),
            );
        });
        reservation.commit();
        Ok(session_id)
    }
}

pub fn launch_legacy(
    app: AppHandle,
    state: DirectRdpState,
    mut request: LaunchRequest,
) -> Result<String, String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err("ConneCat FreeRDP is currently available on macOS and Windows only; select the System RDP client for this Connection.".into());

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        validate(&request)?;
        let session_id = request.session_id.clone();
        let destination = normalized_target(&request.host, request.port);
        let reservation =
            DestinationReservation::new(&state, destination.clone(), session_id.clone())?;
        let freerdp = freerdp_path()?;
        #[cfg(target_os = "macos")]
        let freerdp = branded_macos_freerdp_path(&app, &freerdp)?;
        #[cfg(target_os = "macos")]
        let sizing = "smart";
        #[cfg(not(target_os = "macos"))]
        let sizing = "dynamic";
        tracing::info!(
            target: "catwalk_client::direct_rdp",
            session_id = %session_id,
            connection_id = %request.connection_id,
            host = %request.host,
            port = request.port,
            client = %freerdp.display(),
            initial_width = freerdp_initial_size(&request).0,
            initial_height = freerdp_initial_size(&request).1,
            windowed = true,
            decorations = true,
            sizing,
            clipboard = "text-bidirectional",
            "RDP launch requested through FreeRDP"
        );
        let started_at = Instant::now();
        let mut child = freerdp_command(&freerdp, &request)
            .spawn()
            .map_err(|error| format!("start ConneCat FreeRDP: {error}"))?;
        #[cfg(target_os = "windows")]
        if let Err(error) = install_windows_freerdp_window(&app, child.id(), request.theme.as_ref())
        {
            tracing::warn!(
                target: "catwalk_client::direct_rdp",
                session_id = %session_id,
                %error,
                "Could not install the branded Windows FreeRDP icon"
            );
        }
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ConneCat FreeRDP has no credential input pipe".to_string())?;
        stdin
            .write_all(request.password.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("send credentials to ConneCat FreeRDP: {error}"))?;
        drop(stdin);
        request.username.zeroize();
        request.domain.zeroize();
        request.password.zeroize();

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let disconnect_requested = Arc::new(AtomicBool::new(false));
        state
            .inner
            .legacy_sessions
            .lock()
            .map_err(|_| "Legacy RDP session lock poisoned".to_string())?
            .insert(
                session_id.clone(),
                LegacySessionProcess {
                    child: child.clone(),
                    disconnect_requested: disconnect_requested.clone(),
                    destination: destination.clone(),
                },
            );
        let _ = app.emit(
            EVENT_NAME,
            serde_json::json!({
                "type": "state",
                "sessionId": session_id,
                "state": "connecting",
                "message": "ConneCat FreeRDP is connecting…"
            }),
        );

        let connected_state = Arc::new(AtomicBool::new(false));
        if let Some(stdout) = stdout {
            let log_session_id = session_id.clone();
            let log_app = app.clone();
            let log_connected = connected_state.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if is_freerdp_connected_line(&line)
                        && log_connected
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                    {
                        let _ = log_app.emit(
                            EVENT_NAME,
                            serde_json::json!({
                                "type": "state",
                                "sessionId": log_session_id,
                                "state": "connected",
                                "message": "ConneCat FreeRDP connected"
                            }),
                        );
                    } else if is_freerdp_reconnecting_line(&line)
                        && log_connected
                            .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                    {
                        let _ = log_app.emit(
                            EVENT_NAME,
                            serde_json::json!({
                                "type": "state",
                                "sessionId": log_session_id,
                                "state": "reconnecting",
                                "message": "VPN or network unavailable. FreeRDP is reconnecting…"
                            }),
                        );
                    }
                    if !is_high_frequency_freerdp_event_trace(&line) {
                        tracing::debug!(target: "catwalk_client::direct_rdp", session_id = %log_session_id, message = %line, "FreeRDP diagnostic");
                    }
                }
            });
        }
        let stderr_handle = stderr.map(|stderr| {
            let log_session_id = session_id.clone();
            let log_app = app.clone();
            let log_connected = connected_state;
            std::thread::spawn(move || {
                let mut diagnostics = LegacyExitDiagnostics::default();
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    diagnostics.observe(&line);
                    if is_freerdp_connected_line(&line)
                        && log_connected
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                    {
                        let _ = log_app.emit(
                            EVENT_NAME,
                            serde_json::json!({
                                "type": "state",
                                "sessionId": log_session_id,
                                "state": "connected",
                                "message": "ConneCat FreeRDP connected"
                            }),
                        );
                    } else if should_emit_freerdp_reconnecting(&line, diagnostics.user_closed)
                        && log_connected
                            .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                    {
                        let _ = log_app.emit(
                            EVENT_NAME,
                            serde_json::json!({
                                "type": "state",
                                "sessionId": log_session_id,
                                "state": "reconnecting",
                                "message": "VPN or network unavailable. FreeRDP is reconnecting…"
                            }),
                        );
                    }
                    if !is_high_frequency_freerdp_event_trace(&line) {
                        tracing::warn!(target: "catwalk_client::direct_rdp", session_id = %log_session_id, message = %line, "FreeRDP diagnostic");
                    }
                }
                diagnostics
            })
        });

        let wait_app = app;
        let wait_inner = Arc::downgrade(&state.inner);
        let wait_session_id = session_id.clone();
        std::thread::spawn(move || {
            let status = wait_for_child(&child);
            let diagnostics = stderr_handle
                .and_then(|handle| handle.join().ok())
                .unwrap_or_default();
            let requested_disconnect = disconnect_requested.load(Ordering::Acquire);
            if let Some(inner) = wait_inner.upgrade() {
                let destination = inner
                    .legacy_sessions
                    .lock()
                    .ok()
                    .and_then(|mut sessions| sessions.remove(&wait_session_id))
                    .map(|session| session.destination);
                if let Some(destination) = destination {
                    release_destination(&inner, &destination, &wait_session_id);
                }
            }
            let process_succeeded = status
                .as_ref()
                .is_some_and(std::process::ExitStatus::success);
            let elapsed = started_at.elapsed();
            let success = legacy_exit_succeeded(
                process_succeeded,
                requested_disconnect,
                &diagnostics,
                elapsed,
            );
            if success {
                tracing::info!(
                    target: "catwalk_client::direct_rdp",
                    session_id = %wait_session_id,
                    exit_code = ?status.as_ref().and_then(|value| value.code()),
                    requested_disconnect,
                    remote_close = diagnostics.expected_remote_close,
                    elapsed_ms = elapsed.as_millis(),
                    "ConneCat FreeRDP closed"
                );
            } else {
                tracing::warn!(target: "catwalk_client::direct_rdp", session_id = %wait_session_id, exit_code = ?status.as_ref().and_then(|value| value.code()), "ConneCat FreeRDP exited unsuccessfully");
                let (code, message) = diagnostics.failure();
                let _ = wait_app.emit(
                    EVENT_NAME,
                    serde_json::json!({
                        "type": "error",
                        "sessionId": wait_session_id,
                        "code": code,
                        "message": message,
                    }),
                );
            }
            let _ = wait_app.emit(
                EVENT_NAME,
                serde_json::json!({
                    "type": "exit",
                    "sessionId": wait_session_id,
                    "success": success,
                    "code": status.and_then(|value| value.code()),
                }),
            );
        });
        reservation.commit();
        Ok(session_id)
    }
}

pub fn certificate_decision(
    state: DirectRdpState,
    session_id: String,
    fingerprint: String,
    decision: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    if !matches!(decision.as_str(), "connect_once" | "trust" | "cancel") {
        return Err("Invalid RDP certificate decision".into());
    }
    if !valid_fingerprint(&fingerprint) {
        return Err("Invalid RDP certificate fingerprint".into());
    }
    if decision == "trust" {
        let _guard = state
            .inner
            .pins_lock
            .lock()
            .map_err(|_| "RDP trust store lock poisoned".to_string())?;
        save_pin(&state.inner.pins_path, &host, port, &fingerprint)?;
    }
    state.write_command(
        &session_id,
        &ParentCommand::CertificateDecision {
            fingerprint: &fingerprint,
            decision: &decision,
        },
    )
}

pub fn disconnect(state: DirectRdpState, session_id: String) -> Result<(), String> {
    let viewer_destination = state
        .inner
        .sessions
        .lock()
        .map_err(|_| "RDP session lock poisoned".to_string())?
        .get(&session_id)
        .map(|session| session.destination.clone());
    if let Some(destination) = viewer_destination {
        let result = state.write_command(&session_id, &ParentCommand::Disconnect);
        if result.is_ok() {
            release_destination(&state.inner, &destination, &session_id);
        }
        return result;
    }
    let session = state
        .inner
        .legacy_sessions
        .lock()
        .map_err(|_| "Legacy RDP session lock poisoned".to_string())?
        .remove(&session_id)
        .ok_or_else(|| "RDP session is no longer active".to_string())?;
    session.disconnect_requested.store(true, Ordering::Release);
    release_destination(&state.inner, &session.destination, &session_id);
    let result = session
        .child
        .lock()
        .map_err(|_| "Legacy RDP process lock poisoned".to_string())?
        .kill()
        .map_err(|error| format!("disconnect ConneCat FreeRDP: {error}"));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_request() -> LaunchRequest {
        LaunchRequest {
            session_id: "s".into(),
            connection_id: "c".into(),
            title: "Test host".into(),
            host: "server".into(),
            port: 3389,
            username: "alice".into(),
            domain: String::new(),
            password: "secret".into(),
            security_mode: RdpSecurityMode::Nla,
            quality_profile: RdpQualityProfile::Balanced,
            theme: None,
            width: None,
            height: None,
            resolution_override: false,
        }
    }

    #[test]
    fn target_keys_are_case_and_bracket_insensitive() {
        assert_eq!(normalized_target("[FE80::1]", 3389), "[fe80::1]:3389");
        assert_eq!(
            normalized_target("Server.EXAMPLE ", 3390),
            "server.example:3390"
        );
    }

    #[test]
    fn validation_never_reports_password() {
        let request = LaunchRequest {
            session_id: "s".into(),
            connection_id: "c".into(),
            title: "t".into(),
            host: "bad host".into(),
            port: 3389,
            username: "u".into(),
            domain: "".into(),
            password: "secret".into(),
            security_mode: RdpSecurityMode::Nla,
            quality_profile: RdpQualityProfile::Balanced,
            theme: None,
            width: None,
            height: None,
            resolution_override: false,
        };
        assert!(!validate(&request).unwrap_err().contains("secret"));
    }

    #[test]
    fn pin_store_round_trip() {
        let dir = std::env::temp_dir().join(format!("catwalk-rdp-pins-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(TRUST_FILE);
        let fingerprint = "A".repeat(64);
        save_pin(&path, "Host", 3389, &fingerprint).unwrap();
        assert_eq!(
            read_pins(&path).get("host:3389").map(String::as_str),
            Some(fingerprint.as_str())
        );
        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn validates_sha256_fingerprints() {
        assert!(valid_fingerprint(&"01".repeat(32)));
        assert!(!valid_fingerprint("abc"));
        assert!(!valid_fingerprint(&"zz".repeat(32)));
    }

    #[test]
    fn viewer_command_has_no_argument_or_environment_secret_channel() {
        let command = viewer_command(Path::new("catwalk-rdp-viewer"));
        assert_eq!(command.get_args().count(), 0);
        assert_eq!(command.get_envs().count(), 0);
    }

    #[test]
    fn freerdp_launch_uses_stdin_for_password() {
        let request = LaunchRequest {
            session_id: "s".into(),
            connection_id: "c".into(),
            title: "Legacy host".into(),
            host: "server".into(),
            port: 3389,
            username: "alice".into(),
            domain: "LAB".into(),
            password: "never-in-arguments".into(),
            security_mode: RdpSecurityMode::Nla,
            quality_profile: RdpQualityProfile::Balanced,
            theme: None,
            width: None,
            height: None,
            resolution_override: false,
        };
        let command = freerdp_command(Path::new("sdl-freerdp"), &request);
        let args = command
            .get_args()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(args.contains("/from-stdin:force"));
        assert!(args.contains("/auto-reconnect-max-retries:30"));
        assert!(args.contains("+clipboard"));
        assert!(!args.contains("/clipboard:direction-to:"));
        assert!(args.contains(
            "/log-filters:com.freerdp.client.SDL:WARN,com.freerdp.client.sdl.cliprdr:TRACE,com.winpr.clipboard:DEBUG,com.freerdp.channels.cliprdr.client:TRACE"
        ));
        assert!(!args.contains("com.freerdp.client.SDL:TRACE"));
        assert!(args.contains("/sec:nla"));
        assert!(args.contains("/d:LAB"));
        assert!(!args.contains("never-in-arguments"));
        assert!(command.get_envs().all(|(name, value)| {
            !name
                .to_string_lossy()
                .to_ascii_lowercase()
                .contains("password")
                && value.is_none_or(|value| value != "never-in-arguments")
        }));
    }

    #[test]
    fn freerdp_reconnect_diagnostics_are_recognized() {
        assert!(is_freerdp_connected_line(
            "[WARN][com.freerdp.channels.rdpdr.client] - client supported RDPDR_USER_LOGGEDON_PDU"
        ));
        assert!(is_freerdp_connected_line(
            "[WARN][com.freerdp.channels.rdpdr.client] - Accepting resumed PAKID_CORE_USER_LOGGEDON in state RDPDR_CHANNEL_STATE_USER_LOGGEDON without repeated server capabilities."
        ));
        assert!(is_freerdp_connected_line(
            "[WARN][com.freerdp.core.rdp] - AutoReconnectStatus: 0x00000000"
        ));
        assert!(!is_freerdp_connected_line(
            "[WARN][com.freerdp.core.rdp] - AutoReconnectStatus: 0x00000001"
        ));
        assert!(!is_freerdp_reconnecting_line(
            "[INFO][com.freerdp.core] - Network disconnect!"
        ));
        assert!(should_emit_freerdp_reconnecting(
            "[INFO][com.freerdp.core] - Network disconnect!",
            false,
        ));
        assert!(is_freerdp_reconnecting_line(
            "[INFO][com.freerdp.core] - Auto-Reconnect: attempting reconnect"
        ));
        assert!(!should_emit_freerdp_reconnecting(
            "[INFO][com.freerdp.core] - Network disconnect!",
            true,
        ));
        assert!(should_emit_freerdp_reconnecting(
            "[ERROR][com.freerdp.core.transport] - BIO_read returned a system error 49: Can't assign requested address",
            false,
        ));
        assert!(should_emit_freerdp_reconnecting(
            "[ERROR][com.freerdp.core] - ERRCONNECT_DNS_NAME_NOT_FOUND [0x00020005]",
            false,
        ));
        assert!(!is_freerdp_reconnecting_line(
            "[INFO][com.freerdp.gdi] - Local framebuffer format PIXEL_FORMAT_BGRA32"
        ));
    }

    #[test]
    fn freerdp_repaint_and_pointer_motion_traces_are_not_persisted() {
        assert!(is_high_frequency_freerdp_event_trace(
            "[TRACE][com.freerdp.client.SDL] got event SDL_EVENT_USER_UPDATE"
        ));
        assert!(is_high_frequency_freerdp_event_trace(
            "[TRACE][com.freerdp.client.SDL] got event SDL_EVENT_MOUSE_MOTION"
        ));
        assert!(!is_high_frequency_freerdp_event_trace(
            "[TRACE][com.freerdp.client.sdl.cliprdr] clipboard format list"
        ));
    }

    #[test]
    fn ironrdp_debug_output_remains_opt_in_diagnostics() {
        assert!(is_verbose_ironrdp_diagnostic(
            "2026-08-02T12:00:00Z DEBUG catwalk_rdp_viewer::app: mouse event"
        ));
        assert!(is_verbose_ironrdp_diagnostic(
            "2026-08-02T12:00:00Z TRACE ironrdp_client::rdp: input event"
        ));
        assert!(!is_verbose_ironrdp_diagnostic(
            "2026-08-02T12:00:00Z ERROR ironrdp_client::rdp: transport failed"
        ));
    }

    #[test]
    fn freerdp_native_chrome_maps_dark_and_medium_to_dark_and_light_to_light() {
        let dark = RdpWindowTheme {
            mode: "dark".into(),
            background: "#0f172a".into(),
            surface: "#1e293b".into(),
            border: "#334155".into(),
            text: "#e2e8f0".into(),
            muted: "#94a3b8".into(),
            titlebar: "#1e293b".into(),
            accent: "rgb(56, 189, 248)".into(),
        };
        let medium = RdpWindowTheme {
            mode: "medium".into(),
            ..dark.clone()
        };
        let light = RdpWindowTheme {
            mode: "light".into(),
            background: "#f8fafc".into(),
            surface: "#ffffff".into(),
            border: "#cbd5e1".into(),
            text: "#0f172a".into(),
            muted: "#64748b".into(),
            titlebar: "#f8fafc".into(),
            accent: "#38bdf8".into(),
        };
        assert!(freerdp_prefers_dark_chrome(Some(&dark)));
        assert!(freerdp_prefers_dark_chrome(Some(&medium)));
        assert!(!freerdp_prefers_dark_chrome(Some(&light)));
        #[cfg(target_os = "macos")]
        {
            for (theme, expected) in [
                (dark.clone(), "dark"),
                (medium.clone(), "dark"),
                (light.clone(), "light"),
            ] {
                let mut request = valid_request();
                request.theme = Some(theme);
                let command = freerdp_command(Path::new("sdl-freerdp"), &request);
                assert!(command.get_envs().any(|(name, value)| {
                    name == "CATWALK_FREERDP_APPEARANCE"
                        && value.is_some_and(|value| value == expected)
                }));
            }
        }
        assert_eq!(parse_theme_rgb("#1e293b"), Some(0x1e293b));
        assert_eq!(parse_theme_rgb("#abc"), Some(0xaabbcc));
        assert_eq!(parse_theme_rgb("rgb(56, 189, 248)"), Some(0x38bdf8));
        assert_eq!(parse_theme_rgb("transparent"), None);
    }

    #[test]
    fn freerdp_respects_the_selected_security_transport() {
        let mut request = LaunchRequest {
            session_id: "s".into(),
            connection_id: "c".into(),
            title: "Windows host".into(),
            host: "server".into(),
            port: 3389,
            username: "alice".into(),
            domain: String::new(),
            password: "secret".into(),
            security_mode: RdpSecurityMode::Tls,
            quality_profile: RdpQualityProfile::Balanced,
            theme: None,
            width: None,
            height: None,
            resolution_override: false,
        };
        assert!(freerdp_args(&request).contains(&"/sec:tls".to_string()));
        request.security_mode = RdpSecurityMode::Rdp;
        assert!(freerdp_args(&request).contains(&"/sec:rdp".to_string()));
    }

    #[test]
    fn freerdp_candidate_override_is_exclusive() {
        let path = PathBuf::from("/custom/catwalk-freerdp");
        assert_eq!(freerdp_candidates(Some(path.clone()), None), vec![path]);
    }

    #[test]
    fn freerdp_candidates_include_current_windows_executable_names() {
        let directory = Path::new("/catwalk");
        let candidates = freerdp_candidates(None, Some(directory));
        assert!(candidates.contains(&directory.join("wfreerdp.exe")));
        assert!(candidates.contains(&directory.join("wfreerdp3.exe")));
        assert!(candidates.contains(&directory.join("sdl-freerdp3.exe")));
    }

    #[test]
    fn freerdp_user_logoff_is_only_clean_after_a_live_session() {
        let mut diagnostics = LegacyExitDiagnostics::default();
        diagnostics.observe("[ERROR][com.freerdp.core] - ERRINFO_LOGOFF_BY_USER [0x0001000C]");
        diagnostics.observe(
            "[ERROR][com.freerdp.utils.passphrase] - tcsetattr(TCSANOW) failed with Inappropriate ioctl for device",
        );

        assert!(diagnostics.expected_remote_close);
        assert!(diagnostics.last_error.is_none());
        assert!(!legacy_exit_succeeded(
            false,
            false,
            &diagnostics,
            Duration::from_secs(5)
        ));
        assert!(legacy_exit_succeeded(
            false,
            false,
            &diagnostics,
            Duration::from_secs(30)
        ));
        let (code, _) = diagnostics.failure();
        assert_eq!(code, "remote_session_closed");
    }

    #[test]
    fn freerdp_requested_disconnect_is_a_clean_close() {
        assert!(legacy_exit_succeeded(
            false,
            true,
            &LegacyExitDiagnostics::default(),
            Duration::ZERO
        ));
    }

    #[test]
    fn freerdp_window_close_is_a_clean_close_without_reconnect_warning() {
        let mut diagnostics = LegacyExitDiagnostics::default();
        diagnostics
            .observe("[ERROR][com.freerdp.core] - ERRCONNECT_CONNECT_CANCELLED [0x0002000B]");
        diagnostics.observe(
            "[INFO][com.freerdp.core] - client_auto_reconnect_ex: Connection aborted by user",
        );
        diagnostics.observe("[INFO][com.freerdp.core] - Network disconnect!");

        assert!(diagnostics.user_closed);
        assert!(diagnostics.last_error.is_none());
        assert!(legacy_exit_succeeded(
            false,
            false,
            &diagnostics,
            Duration::from_secs(1)
        ));
    }

    #[test]
    fn freerdp_gets_an_explicit_windowed_starting_size() {
        let request = valid_request();
        let args = freerdp_args(&request);
        #[cfg(target_os = "macos")]
        assert!(args.contains(&"/size:1100x700".to_string()));
        #[cfg(not(target_os = "macos"))]
        assert!(args.contains(&"/size:1440x900".to_string()));
        assert!(!args.contains(&"/f".to_string()));
        assert!(!args.contains(&"-f".to_string()));
        #[cfg(target_os = "macos")]
        {
            assert!(args.contains(&"/smart-sizing".to_string()));
            assert!(!args.contains(&"/dynamic-resolution".to_string()));
            assert!(!args.contains(&"-decorations".to_string()));
            assert!(args.contains(&"-toggle-fullscreen".to_string()));
            let command = freerdp_command(Path::new("sdl-freerdp"), &request);
            assert!(command.get_envs().any(|(name, value)| {
                name == "SDL_VIDEO_MAC_FULLSCREEN_SPACES" && value.is_some_and(|value| value == "0")
            }));
            assert!(command.get_envs().any(|(name, value)| {
                name == "SDL_VIDEO_MAC_FULLSCREEN_MENU_VISIBILITY"
                    && value.is_some_and(|value| value == "1")
            }));
        }
        #[cfg(target_os = "windows")]
        {
            let command = freerdp_command(Path::new("sdl-freerdp"), &request);
            assert!(command.get_envs().any(|(name, value)| {
                name == "SDL_RENDER_DRIVER" && value.is_some_and(|value| value == "software")
            }));
            assert!(command.get_envs().any(|(name, value)| {
                name == "SDL_WINDOWS_RAW_KEYBOARD" && value.is_some_and(|value| value == "0")
            }));
            assert!(command.get_envs().any(|(name, value)| {
                name == "SDL_WINDOWS_ENABLE_MESSAGELOOP" && value.is_some_and(|value| value == "1")
            }));
        }
    }

    #[test]
    fn freerdp_low_bandwidth_size_is_bounded() {
        let mut request = valid_request();
        request.width = Some(1920);
        request.height = Some(1080);
        request.quality_profile = RdpQualityProfile::VeryLowBandwidth;
        assert_eq!(freerdp_initial_size(&request), (800, 600));
    }

    #[test]
    fn freerdp_explicit_resolution_overrides_quality_size_cap() {
        let mut request = valid_request();
        request.width = Some(1920);
        request.height = Some(1080);
        request.quality_profile = RdpQualityProfile::LowBandwidth;
        request.resolution_override = true;
        assert_eq!(freerdp_initial_size(&request), (1920, 1080));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn freerdp_balanced_avoids_a_retina_sized_remote_framebuffer() {
        let mut request = valid_request();
        request.width = Some(3840);
        request.height = Some(2160);
        assert_eq!(freerdp_initial_size(&request), (1440, 900));
        let args = freerdp_args(&request);
        // FreeRDP 3.30 forcibly disables this option because its asynchronous
        // update proxy can lose frames. ConneCat's SDL compatibility patch
        // instead prevents repaint batches from starving native input events.
        assert!(!args.contains(&"+async-update".to_string()));
        assert!(args.contains(&"/network:lan".to_string()));
    }

    #[test]
    fn freerdp_low_bandwidth_disables_expensive_desktop_effects() {
        let mut request = valid_request();
        request.quality_profile = RdpQualityProfile::LowBandwidth;
        let args = freerdp_args(&request);
        for option in [
            "-wallpaper",
            "-window-drag",
            "-menu-anims",
            "-themes",
            "-fonts",
        ] {
            assert!(args.contains(&option.to_string()));
        }
        assert!(args.contains(&"/network:broadband-low".to_string()));
    }

    #[test]
    fn destination_reservation_blocks_duplicate_engines() {
        let dir = std::env::temp_dir().join(format!(
            "catwalk-rdp-destination-lock-{}",
            std::process::id()
        ));
        let state = DirectRdpState::new(dir.clone()).unwrap();
        let first =
            DestinationReservation::new(&state, "server:3389".into(), "session-1".into()).unwrap();
        let duplicate =
            DestinationReservation::new(&state, "server:3389".into(), "session-2".into());
        assert!(duplicate
            .err()
            .is_some_and(|error| error.contains("already opening or connected")));
        drop(first);
        assert!(
            DestinationReservation::new(&state, "server:3389".into(), "session-2".into()).is_ok()
        );
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn freerdp_failure_maps_to_a_structured_error() {
        let mut diagnostics = LegacyExitDiagnostics::default();
        diagnostics.observe(
            "[ERROR][com.freerdp.core] - ERRCONNECT_LOGON_FAILURE: Authentication failure",
        );

        let (code, message) = diagnostics.failure();
        assert_eq!(code, "authentication_failed");
        assert!(message.contains("could not authenticate"));
        assert!(!message.contains("ERRCONNECT_LOGON_FAILURE"));
    }

    #[test]
    fn freerdp_terminal_cleanup_noise_is_not_reported_as_the_failure() {
        let mut diagnostics = LegacyExitDiagnostics::default();
        diagnostics.observe(
            "[ERROR][com.freerdp.utils.passphrase] - tcsetattr(TCSANOW) failed with Inappropriate ioctl for device",
        );

        let (code, message) = diagnostics.failure();
        assert_eq!(code, "network_failed");
        assert!(!message.contains("tcsetattr"));
    }

    #[test]
    fn ironrdp_negotiation_diagnostic_triggers_the_correct_fallback() {
        assert_eq!(
            viewer_negotiation_failure(
                "Received connection failure code code=FailureCode(1)",
                RdpSecurityMode::Nla,
            ),
            Some((
                "security_protocol_unsupported",
                "The RDP server requires Enhanced RDP Security with TLS. ConneCat will retry using TLS.",
            ))
        );
        assert!(viewer_negotiation_failure(
            "Received connection failure code code=FailureCode(1)",
            RdpSecurityMode::Tls,
        )
        .is_none());
    }

    #[test]
    fn unset_dimensions_are_omitted_for_viewer_defaults() {
        let request = LaunchRequest {
            session_id: "s".into(),
            connection_id: "c".into(),
            title: "t".into(),
            host: "server".into(),
            port: 3389,
            username: "u".into(),
            domain: String::new(),
            password: "secret".into(),
            security_mode: RdpSecurityMode::Nla,
            quality_profile: RdpQualityProfile::Balanced,
            theme: None,
            width: None,
            height: None,
            resolution_override: false,
        };
        let value = serde_json::to_value(&request).unwrap();
        assert!(value.get("width").is_none());
        assert!(value.get("height").is_none());
        assert_eq!(value["password"], "secret");
    }
}
