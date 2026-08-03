//! Tauri client library.

mod browse_proxy;
mod diagnostics;
mod direct_rdp;
mod launcher;
mod pty;
mod renderer_lifecycle;
mod sftp;

use serde::Serialize;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};

#[cfg(all(debug_assertions, target_os = "macos"))]
fn install_macos_dev_icon() -> Result<(), String> {
    use objc2::{AllocAnyThread as _, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    const DEV_ICON: &[u8] = include_bytes!("../icons-standalone/icon.png");
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "Tauri setup did not run on the macOS main thread".to_string())?;
    let application = NSApplication::sharedApplication(marker);
    let data = NSData::with_bytes(DEV_ICON);
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| "macOS could not decode the Terminal Cat development icon".to_string())?;
    // SAFETY: AppKit retains the image. Tauri invokes setup on the main thread
    // after NSApplication has been initialized.
    unsafe { application.setApplicationIconImage(Some(&image)) };
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OnePasswordLogin {
    username: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OnePasswordItemOption {
    title: String,
    vault_name: String,
    item_reference: String,
}

fn onepassword_item_reference(value: &str) -> Result<String, String> {
    let reference = value.trim().trim_end_matches('/');
    let path = reference
        .strip_prefix("op://")
        .ok_or_else(|| "1Password item reference must start with op://".to_string())?;
    if path.split('/').filter(|part| !part.is_empty()).count() != 2 {
        return Err("Use an item reference in the form op://Vault/Item".into());
    }
    Ok(reference.to_string())
}

fn first_existing_executable(
    paths: impl IntoIterator<Item = std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
    paths.into_iter().find_map(|path| {
        if !path.is_file() {
            return None;
        }
        // Homebrew exposes `op` through a versioned Caskroom symlink. Resolve
        // it before spawning so GUI-launched applications execute the stable
        // target directly instead of depending on shell-style path discovery.
        Some(std::fs::canonicalize(&path).unwrap_or(path))
    })
}

fn onepassword_executable() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    let executable_name = "op.exe";
    #[cfg(not(target_os = "windows"))]
    let executable_name = "op";

    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    candidates.extend([
        std::path::PathBuf::from("/opt/homebrew/bin/op"),
        std::path::PathBuf::from("/usr/local/bin/op"),
        std::path::PathBuf::from("/opt/local/bin/op"),
        std::path::PathBuf::from("/usr/bin/op"),
    ]);
    #[cfg(target_os = "linux")]
    candidates.extend([
        std::path::PathBuf::from("/usr/local/bin/op"),
        std::path::PathBuf::from("/usr/bin/op"),
        std::path::PathBuf::from("/snap/bin/op"),
    ]);
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::PathBuf::from(home);
        candidates.push(home.join(".local/bin").join(executable_name));
        candidates.push(home.join("bin").join(executable_name));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates
            .extend(std::env::split_paths(&path).map(|directory| directory.join(executable_name)));
    }

    let candidate_count = candidates.len();
    let discovered = first_existing_executable(candidates);
    let metadata_fallback = discovered.is_none();
    let executable = discovered.unwrap_or_else(|| {
        // Some macOS GUI launch contexts return false for metadata checks on
        // Homebrew paths even though the executable can still be spawned. Do
        // not turn that false negative into a PATH-only lookup: optimistically
        // use the standard Homebrew location for the build architecture.
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            std::path::PathBuf::from("/opt/homebrew/bin/op")
        }
        #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
        {
            std::path::PathBuf::from("/usr/local/bin/op")
        }
        #[cfg(not(target_os = "macos"))]
        {
            std::path::PathBuf::from(executable_name)
        }
    });
    tracing::debug!(
        target: "catwalk_client::ssh_onepassword",
        executable = %executable.display(),
        candidate_count,
        metadata_fallback,
        executable_exists = executable.exists(),
        executable_is_file = executable.is_file(),
        "1Password CLI executable selected"
    );
    executable
}

fn onepassword_command() -> std::process::Command {
    let executable = onepassword_executable();
    let mut command = std::process::Command::new(executable);
    command.env_remove("OP_SERVICE_ACCOUNT_TOKEN");
    command
}

fn onepassword_cli_not_found_message() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "1Password CLI is not installed or is not available in PATH. Install it with `brew install 1password-cli`, then restart ConneCat."
    }
    #[cfg(target_os = "windows")]
    {
        "1Password CLI is not installed or is not available in PATH. Install it with `winget install 1password-cli`, then restart ConneCat."
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "1Password CLI is not installed or is not available in PATH. Install the 1Password CLI for your operating system, then restart ConneCat."
    }
}

fn onepassword_output(mut command: std::process::Command) -> Result<Vec<u8>, String> {
    // Do not log arguments: item and vault identifiers can appear there. The
    // executable and process metadata are sufficient to diagnose discovery and
    // launch failures without exposing credential references.
    let executable = command.get_program().to_string_lossy().into_owned();
    let output = command.output().map_err(|error| {
        tracing::warn!(
            target: "catwalk_client::ssh_onepassword",
            executable = %executable,
            executable_exists = std::path::Path::new(&executable).exists(),
            executable_is_file = std::path::Path::new(&executable).is_file(),
            error_kind = ?error.kind(),
            raw_os_error = ?error.raw_os_error(),
            "Failed to start 1Password CLI"
        );
        if error.kind() == std::io::ErrorKind::NotFound {
            onepassword_cli_not_found_message().to_string()
        } else {
            format!("failed to start 1Password CLI: {error}")
        }
    })?;
    if !output.status.success() {
        tracing::warn!(
            target: "catwalk_client::ssh_onepassword",
            executable = %executable,
            exit_code = ?output.status.code(),
            stderr_bytes = output.stderr.len(),
            "1Password CLI exited unsuccessfully"
        );
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "1Password did not authorize the credential request".into()
        } else {
            format!("1Password: {detail}")
        });
    }
    tracing::debug!(
        target: "catwalk_client::ssh_onepassword",
        executable = %executable,
        stdout_bytes = output.stdout.len(),
        "1Password CLI request completed"
    );
    Ok(output.stdout)
}

fn onepassword_login_from_item(value: &serde_json::Value) -> Result<OnePasswordLogin, String> {
    let fields = value
        .get("fields")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "1Password returned an invalid Login item".to_string())?;
    let field = |name: &str| {
        fields.iter().find_map(|field| {
            let matches = field
                .get("id")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|id| id.eq_ignore_ascii_case(name))
                || field
                    .get("label")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|label| label.eq_ignore_ascii_case(name));
            matches
                .then(|| field.get("value").and_then(serde_json::Value::as_str))
                .flatten()
        })
    };
    let username = field("username")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "1Password item has an empty username field".to_string())?;
    let password = field("password")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "1Password item has an empty password field".to_string())?;
    Ok(OnePasswordLogin {
        username: username.to_string(),
        password: password.to_string(),
    })
}

fn onepassword_error_code(error: &str) -> &'static str {
    let error = error.to_ascii_lowercase();
    if error.contains("not installed") || error.contains("not available in path") {
        "cli_not_found"
    } else if error.contains("no 1password cli account") {
        "desktop_integration_unavailable"
    } else if error.contains("authorize") || error.contains("authentication") {
        "authorization_failed"
    } else if error.contains("invalid account list") {
        "invalid_account_response"
    } else if error.contains("invalid item list") {
        "invalid_item_response"
    } else if error.contains("item reference") {
        "invalid_item_reference"
    } else if error.contains("empty username") {
        "username_missing"
    } else if error.contains("empty password") {
        "password_missing"
    } else if error.contains("failed to start") {
        "cli_start_failed"
    } else {
        "cli_request_failed"
    }
}

#[tauri::command]
async fn onepassword_list_logins(
    account: Option<String>,
) -> Result<Vec<OnePasswordItemOption>, String> {
    let started = std::time::Instant::now();
    let has_account_selector = account
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    tracing::info!(
        target: "catwalk_client::ssh_onepassword",
        operation = "list_login_items",
        has_account_selector,
        "1Password Login item listing requested"
    );
    let result: Result<Vec<OnePasswordItemOption>, String> =
        tauri::async_runtime::spawn_blocking(move || {
            let mut command = onepassword_command();
            command.args(["item", "list", "--categories", "Login", "--format", "json"]);
            if let Some(account) = account
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                command.args(["--account", account]);
            }
            let value: serde_json::Value = serde_json::from_slice(&onepassword_output(command)?)
                .map_err(|_| "1Password returned an invalid item list".to_string())?;
            Ok(onepassword_login_items(&value))
        })
        .await
        .map_err(|error| format!("1Password item lookup failed: {error}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok(items) => tracing::info!(
            target: "catwalk_client::ssh_onepassword",
            operation = "list_login_items",
            duration_ms,
            item_count = items.len(),
            "1Password Login item listing completed"
        ),
        Err(error) => tracing::warn!(
            target: "catwalk_client::ssh_onepassword",
            operation = "list_login_items",
            duration_ms,
            error_code = onepassword_error_code(error),
            "1Password Login item listing failed"
        ),
    }
    result
}

fn onepassword_login_items(value: &serde_json::Value) -> Vec<OnePasswordItemOption> {
    let mut items = value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?;
            let title = item.get("title")?.as_str()?;
            let vault = item.get("vault")?;
            let vault_id = vault.get("id")?.as_str()?;
            let vault_name = vault
                .get("name")
                .and_then(|name| name.as_str())
                .unwrap_or("Vault");
            Some(OnePasswordItemOption {
                title: title.to_string(),
                vault_name: vault_name.to_string(),
                item_reference: format!("op://{vault_id}/{id}"),
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        left.vault_name
            .to_lowercase()
            .cmp(&right.vault_name.to_lowercase())
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
    });
    items
}

#[tauri::command]
async fn onepassword_resolve_login(
    item_reference: String,
    account: Option<String>,
) -> Result<OnePasswordLogin, String> {
    let started = std::time::Instant::now();
    let has_account_selector = account
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    tracing::info!(
        target: "catwalk_client::ssh_onepassword",
        operation = "resolve_login",
        has_account_selector,
        "1Password Login resolution requested"
    );
    let result: Result<OnePasswordLogin, String> =
        tauri::async_runtime::spawn_blocking(move || {
            let item = onepassword_item_reference(&item_reference)?;
            let mut parts = item.trim_start_matches("op://").splitn(2, '/');
            let vault = parts.next().unwrap_or_default();
            let item_id = parts.next().unwrap_or_default();
            let mut command = onepassword_command();
            command.args(["item", "get", item_id, "--vault", vault, "--format", "json"]);
            if let Some(account) = account
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                command.args(["--account", account]);
            }
            let value: serde_json::Value = serde_json::from_slice(&onepassword_output(command)?)
                .map_err(|_| "1Password returned an invalid Login item".to_string())?;
            onepassword_login_from_item(&value)
        })
        .await
        .map_err(|error| format!("1Password credential lookup failed: {error}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok(_) => tracing::info!(
            target: "catwalk_client::ssh_onepassword",
            operation = "resolve_login",
            duration_ms,
            "1Password Login resolution completed"
        ),
        Err(error) => tracing::warn!(
            target: "catwalk_client::ssh_onepassword",
            operation = "resolve_login",
            duration_ms,
            error_code = onepassword_error_code(error),
            "1Password Login resolution failed"
        ),
    }
    result
}

#[tauri::command]
fn diagnostics_status(
    manager: State<'_, std::sync::Arc<diagnostics::DiagnosticsManager>>,
) -> diagnostics::Status {
    manager.status()
}

#[tauri::command]
fn diagnostics_set_local(
    manager: State<'_, std::sync::Arc<diagnostics::DiagnosticsManager>>,
    channels: Vec<String>,
) -> Result<diagnostics::Status, String> {
    manager.set_local(channels)
}

#[tauri::command]
fn diagnostics_event(
    manager: State<'_, std::sync::Arc<diagnostics::DiagnosticsManager>>,
    channel: String,
    level: String,
    target: String,
    message: String,
    fields: serde_json::Value,
) {
    manager.event(&channel, &level, &target, &message, fields);
}

#[tauri::command]
fn diagnostics_export(
    manager: State<'_, std::sync::Arc<diagnostics::DiagnosticsManager>>,
    destination: String,
    platform: String,
) -> Result<u64, String> {
    manager.bundle(
        std::path::Path::new(&destination),
        env!("CARGO_PKG_VERSION"),
        &platform,
    )
}

#[tauri::command]
fn diagnostics_clear_logs(
    manager: State<'_, std::sync::Arc<diagnostics::DiagnosticsManager>>,
) -> Result<diagnostics::Status, String> {
    manager.clear_logs()
}

/// Authoritative OS + arch for this build. macOS WebView's
/// `navigator.platform` / `navigator.userAgent` always say
/// `MacIntel` / `Intel Mac OS X` even on Apple Silicon (Apple freezes
/// the UA for web compat), so JS-side detection can't distinguish
/// `x86_64` from `aarch64`. Read it from Rust's compile-time consts
/// instead — the DMG is built per-arch, so this is correct by definition.
#[derive(serde::Serialize)]
struct ClientPlatform {
    os: String,
    arch: String,
}

#[tauri::command]
fn client_platform() -> ClientPlatform {
    // Normalize to the same labels the portal heartbeat audit expects
    // (`macos-aarch64`, `windows-x86_64`, `linux-x86_64`, …).
    let arch = match std::env::consts::ARCH {
        "aarch64" | "arm64" => "aarch64",
        other => other,
    };
    ClientPlatform {
        os: std::env::consts::OS.to_string(),
        arch: arch.to_string(),
    }
}

#[tauri::command]
async fn open_untrusted_browser_proxy(
    upstream_base: String,
    resolve_to_loopback: Option<bool>,
    public_base: Option<String>,
) -> Result<browse_proxy::BrowserProxy, String> {
    browse_proxy::open(
        upstream_base,
        resolve_to_loopback.unwrap_or(false),
        public_base,
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn probe_host(host: String, port: u16) -> Result<(), String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect((host.as_str(), port)),
    )
    .await
    .map_err(|_| format!("connection to {host}:{port} timed out"))?
    .map(|_| ())
    .map_err(|error| format!("could not connect to {host}:{port}: {error}"))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Defence in depth: refuse anything that isn't http(s) so a stray
    // call can't shell out to `file://` or custom URL handlers.
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(format!("refusing to open non-http url: {url}"));
    }
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&url).spawn()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&url).spawn()
    };
    result
        .map(|_| ())
        .map_err(|e| format!("failed to open url: {e}"))
}

#[tauri::command]
fn launch_ssh_host(
    username: String,
    host: String,
    port: u16,
    terminal_app: Option<String>,
    key_path: Option<String>,
    keepalive_seconds: Option<u32>,
    local_forwards: Option<Vec<String>>,
) -> Result<(), String> {
    launcher::launch_ssh_host(
        &username,
        &host,
        port,
        terminal_app.as_deref(),
        key_path.as_deref(),
        keepalive_seconds,
        local_forwards.as_deref().unwrap_or(&[]),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_sftp_host(
    username: String,
    host: String,
    port: u16,
    terminal_app: Option<String>,
    key_path: Option<String>,
    keepalive_seconds: Option<u32>,
) -> Result<(), String> {
    launcher::launch_sftp_host(
        &username,
        &host,
        port,
        terminal_app.as_deref(),
        key_path.as_deref(),
        keepalive_seconds,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_rdp_host(username: String, host: String, port: u16) -> Result<(), String> {
    launcher::launch_rdp_host(&username, &host, port).map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_direct_rdp(
    app: AppHandle,
    state: State<'_, direct_rdp::DirectRdpState>,
    request: direct_rdp::LaunchRequest,
) -> Result<String, String> {
    direct_rdp::launch(app, state.inner().clone(), request)
}

#[tauri::command]
fn launch_legacy_rdp(
    app: AppHandle,
    state: State<'_, direct_rdp::DirectRdpState>,
    request: direct_rdp::LaunchRequest,
) -> Result<String, String> {
    direct_rdp::launch_legacy(app, state.inner().clone(), request)
}

#[tauri::command]
fn direct_rdp_certificate_decision(
    app: AppHandle,
    state: State<'_, direct_rdp::DirectRdpState>,
    session_id: String,
    fingerprint: String,
    decision: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    let result = direct_rdp::certificate_decision(
        state.inner().clone(),
        session_id,
        fingerprint,
        decision,
        host,
        port,
    );
    direct_rdp::release_certificate_prompt_window(&app);
    result
}

#[tauri::command]
fn disconnect_direct_rdp(
    state: State<'_, direct_rdp::DirectRdpState>,
    session_id: String,
) -> Result<(), String> {
    direct_rdp::disconnect(state.inner().clone(), session_id)
}

#[tauri::command]
fn detect_terminals() -> Vec<String> {
    launcher::detect()
}

#[tauri::command]
fn detect_sftp_guis() -> Vec<launcher::SftpGuiApp> {
    launcher::detect_sftp_guis()
}

#[tauri::command]
fn launch_sftp_gui_host(
    app_id: String,
    username: String,
    host: String,
    port: u16,
    key_path: Option<String>,
) -> Result<(), String> {
    launcher::launch_sftp_gui_host(&app_id, &username, &host, port, key_path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_connect(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    host: String,
    port: u16,
    username: String,
    key_path: Option<String>,
    password: Option<String>,
) -> Result<u64, String> {
    let (session, handle) = sftp::connect(
        &host,
        port,
        &username,
        key_path.as_deref(),
        password.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(sftp::register(&registry, session, handle))
}

#[tauri::command]
async fn sftp_list(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    path: String,
) -> Result<Vec<sftp::SftpEntry>, String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    sftp::list(s, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_realpath(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    path: String,
) -> Result<String, String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    sftp::realpath(s, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_download(
    app: AppHandle,
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    remote: String,
    local: String,
    transfer_id: String,
) -> Result<u64, String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    let cancelled = registry
        .begin_transfer(id, &transfer_id)
        .map_err(|e| e.to_string())?;
    let result = sftp::download(s, &remote, &local, cancelled, |transferred, total| {
        let _ = app.emit(
            "sftp://transfer-progress",
            serde_json::json!({
                "transferId": transfer_id,
                "transferred": transferred,
                "total": total,
            }),
        );
    })
    .await;
    registry.finish_transfer(&transfer_id);
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_upload(
    app: AppHandle,
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    local: String,
    remote: String,
    transfer_id: String,
) -> Result<u64, String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    let cancelled = registry
        .begin_transfer(id, &transfer_id)
        .map_err(|e| e.to_string())?;
    let result = sftp::upload(s, &local, &remote, cancelled, |transferred, total| {
        let _ = app.emit(
            "sftp://transfer-progress",
            serde_json::json!({
                "transferId": transfer_id,
                "transferred": transferred,
                "total": total,
            }),
        );
    })
    .await;
    registry.finish_transfer(&transfer_id);
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn sftp_cancel_transfer(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    transfer_id: String,
) -> bool {
    registry.cancel_transfer(&transfer_id)
}

#[tauri::command]
async fn sftp_mkdir(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    path: String,
) -> Result<(), String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    sftp::mkdir(s, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_remove(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    sftp::remove(s, &path, is_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_rename(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
    from: String,
    to: String,
) -> Result<(), String> {
    let s = sftp::get(&registry, id).map_err(|e| e.to_string())?;
    sftp::rename(s, &from, &to).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_disconnect(
    registry: tauri::State<'_, std::sync::Arc<sftp::SftpRegistry>>,
    id: u64,
) -> Result<(), String> {
    let (closed, cancelled_transfers) = registry.close(id).await;
    tracing::info!(
        session_id = id,
        session_found = closed,
        cancelled_transfers,
        "SFTP session disconnected"
    );
    Ok(())
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    registry: State<'_, pty::PtyRegistry>,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<Vec<(String, String)>>,
    cols: u16,
    rows: u16,
    transcript_path: Option<String>,
) -> Result<u64, String> {
    registry
        .spawn(
            app,
            cmd,
            args,
            cwd,
            env.unwrap_or_default(),
            cols,
            rows,
            transcript_path,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn serial_ports() -> Result<Vec<String>, String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|port| port.port_name).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn serial_open(
    app: AppHandle,
    registry: State<'_, pty::PtyRegistry>,
    options: pty::SerialOptions,
    transcript_path: Option<String>,
) -> Result<u64, String> {
    registry
        .open_serial(app, options, transcript_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn pty_write(registry: State<'_, pty::PtyRegistry>, id: u64, data: Vec<u8>) -> Result<(), String> {
    registry.write(id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(
    registry: State<'_, pty::PtyRegistry>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.resize(id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(registry: State<'_, pty::PtyRegistry>, id: u64) -> Result<(), String> {
    registry.kill(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_snapshot(
    registry: State<'_, pty::PtyRegistry>,
    id: u64,
) -> Result<pty::PtySnapshot, String> {
    registry.snapshot(id).map_err(|e| e.to_string())
}

/// Ask Windows 11's compositor to round the native window frame. This keeps
/// native resizing, shadows and snap layouts intact; unsupported Windows
/// versions simply ignore the best-effort DWM call.
#[cfg(target_os = "windows")]
fn enable_rounded_window_corners(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: u32 = 2;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            value_size: u32,
        ) -> i32;
    }

    if let Ok(hwnd) = window.hwnd() {
        let preference = DWMWCP_ROUND;
        // SAFETY: `hwnd` belongs to this live Tauri window and `preference`
        // remains valid for the duration of the synchronous DWM call.
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                (&preference as *const u32).cast(),
                std::mem::size_of_val(&preference) as u32,
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webview2_for_remote_desktop();
    let app = tauri::Builder::default()
        .plugin(webview_recovery_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let diagnostics = diagnostics::DiagnosticsManager::new(app.handle())
                .map_err(std::io::Error::other)?;
            diagnostics::install_tracing(diagnostics.clone());
            app.manage(diagnostics);
            app.manage(pty::PtyRegistry::new());
            app.manage(std::sync::Arc::new(sftp::SftpRegistry::new()));
            app.manage(renderer_lifecycle::RendererLifecycleState::default());
            let direct_rdp = direct_rdp::DirectRdpState::new(
                app.path().app_data_dir().map_err(std::io::Error::other)?,
            )
            .map_err(std::io::Error::other)?;
            app.manage(direct_rdp);

            #[cfg(target_os = "windows")]
            install_windows_desktop_session_recovery(app.handle().clone());

            #[cfg(target_os = "windows")]
            {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.set_decorations(false);
                    enable_rounded_window_corners(&main);
                }
            }

            Ok(())
        })
        // Suppress the raw WebKit/WebView2 "Look Up / Translate / Inspect /
        // Copy Link with Highlight" context menu across the whole app. This
        // applies to BOTH the main window (tab bar, toolbars, Notes editor,
        // console viewport) AND the native child "engine" webviews that render
        // the RDP/VM/CML/browser surfaces. A JS-only suppressor was unreliable
        // because the engine webviews do not always reload with the latest
        // bundle; injecting from Rust on every page load guarantees it runs
        // regardless of the JS bundle state. `<input>`/`<textarea>` are exempt
        // so credential fields keep the native copy/paste menu. Our own React
        // context menus (e.g. Notes "Send to session") still work because we
        // only call preventDefault here, never stopPropagation.
        .on_page_load(|webview, _payload| {
            let _ = webview.eval(
                r#"(function(){
                    try {
                        if (window.__cwCtxSuppressed) return;
                        window.__cwCtxSuppressed = true;
                        document.addEventListener('contextmenu', function(e){
                            var t = e.target;
                            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
                            e.preventDefault();
                        }, true);
                    } catch (e) {}
                })();"#,
            );
        })
        // Re-emit native OS file drops so the React side can route them to
        // the SFTP browser's drop zone. Tauri otherwise consumes these events
        // and the webview never sees a JS `drop` with file paths.
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) = event {
                let payload = serde_json::json!({
                    "paths": paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
                    "x": position.x,
                    "y": position.y,
                });
                let _ = window.emit("catwalk://os-file-drop", payload);
            }
            if matches!(event, WindowEvent::Destroyed) && window.label() == "main" {
                if let Some(state) = window.try_state::<direct_rdp::DirectRdpState>() {
                    state.terminate_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            renderer_lifecycle::renderer_lifecycle_status,
            renderer_lifecycle::renderer_lifecycle_reset_main,
            diagnostics_status,
            diagnostics_set_local,
            diagnostics_event,
            diagnostics_export,
            diagnostics_clear_logs,
            onepassword_resolve_login,
            onepassword_list_logins,
            open_untrusted_browser_proxy,
            probe_host,
            open_url,
            launch_ssh_host,
            launch_sftp_host,
            launch_rdp_host,
            launch_direct_rdp,
            launch_legacy_rdp,
            direct_rdp_certificate_decision,
            disconnect_direct_rdp,
            detect_terminals,
            detect_sftp_guis,
            launch_sftp_gui_host,
            sftp_connect,
            sftp_list,
            sftp_realpath,
            sftp_download,
            sftp_upload,
            sftp_cancel_transfer,
            sftp_mkdir,
            sftp_remove,
            sftp_rename,
            sftp_disconnect,
            pty_spawn,
            serial_ports,
            serial_open,
            pty_write,
            pty_resize,
            pty_kill,
            pty_snapshot,
            client_platform
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // Tauri installs the configured development icon during its own Ready
        // handler. Apply the Terminal Cat icon afterward so development uses
        // the same standalone branding as packaged builds.
        #[cfg(all(debug_assertions, target_os = "macos"))]
        if matches!(_event, tauri::RunEvent::Ready) {
            match install_macos_dev_icon() {
                Ok(()) => tracing::debug!("installed Terminal Cat Tauri development icon"),
                Err(error) => tracing::warn!(%error, "could not install Tauri development icon"),
            }
        }
    });
}

/// WebView2 hardware acceleration can retain a stale DirectComposition device
/// whenever the Windows display session is replaced. ConneCat may start on the
/// physical console and only later receive an incoming RDP connection, so the
/// startup `SESSIONNAME` cannot reliably predict whether this transition will
/// happen. Software rendering must be selected before Tauri creates its first
/// WebView2 environment.
#[cfg(target_os = "windows")]
fn configure_webview2_for_remote_desktop() {
    const VARIABLE: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    let existing = std::env::var(VARIABLE).unwrap_or_default();
    if existing
        .split_whitespace()
        .any(|arg| arg == "--disable-gpu")
    {
        return;
    }
    let arguments = if existing.trim().is_empty() {
        "--disable-gpu".to_string()
    } else {
        format!("{} --disable-gpu", existing.trim())
    };
    std::env::set_var(VARIABLE, arguments);
}

#[cfg(not(target_os = "windows"))]
fn configure_webview2_for_remote_desktop() {}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WindowsDesktopSessionState {
    remote: bool,
    connect_state: Option<i32>,
}

#[cfg(any(target_os = "windows", test))]
const WTS_ACTIVE: i32 = 0;
#[cfg(any(target_os = "windows", test))]
const WINDOWS_DESKTOP_RECOVERY_STABLE_SAMPLES: u8 = 10;

#[cfg(any(target_os = "windows", test))]
fn windows_desktop_session_changed(
    previous: WindowsDesktopSessionState,
    current: WindowsDesktopSessionState,
) -> bool {
    previous.remote != current.remote
        || matches!(
            (previous.connect_state, current.connect_state),
            (Some(before), Some(after)) if before != after
        )
}

#[cfg(any(target_os = "windows", test))]
fn windows_desktop_session_recovery_ready(
    previous: WindowsDesktopSessionState,
    current: WindowsDesktopSessionState,
    stable_samples: u8,
) -> bool {
    windows_desktop_session_changed(previous, current)
        && current.connect_state == Some(WTS_ACTIVE)
        && stable_samples >= WINDOWS_DESKTOP_RECOVERY_STABLE_SAMPLES
}

/// WebView2 does not always raise `ProcessFailed` when Windows moves an
/// already-running desktop app between the physical console and RDP, or when
/// an existing RDP session disconnects and reconnects. In that failure mode
/// the renderer remains alive but no longer paints or accepts input, so the
/// application looks frozen and the normal renderer recovery callback cannot
/// help. Watch the native desktop-session state and reload each ConneCat window
/// only after the new active desktop has remained stable for five seconds.
///
/// Do not reload while entering a disconnected state. Windows is still
/// rebuilding WebView2's UI and text-service plumbing during that transition,
/// and a reload queued after the old two-sample/one-second debounce could leave
/// the Tauri UI thread blocked in WaitOnAddress after an RDP reconnect.
#[cfg(target_os = "windows")]
fn install_windows_desktop_session_recovery(app: AppHandle) {
    if let Err(error) = std::thread::Builder::new()
        .name("catwalk-session-watch".into())
        .spawn(move || {
            let mut stable = windows_desktop_session_state();
            let mut candidate: Option<(WindowsDesktopSessionState, u8)> = None;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let current = windows_desktop_session_state();
                if !windows_desktop_session_changed(stable, current) {
                    candidate = None;
                    continue;
                }

                let samples = match candidate {
                    Some((state, samples)) if state == current => samples.saturating_add(1),
                    _ => 1,
                };
                candidate = Some((current, samples));
                if samples < WINDOWS_DESKTOP_RECOVERY_STABLE_SAMPLES {
                    continue;
                }

                let recover = windows_desktop_session_recovery_ready(stable, current, samples);
                stable = current;
                candidate = None;
                if !recover {
                    tracing::debug!(
                        target: "catwalk_client::webview2",
                        current_remote = current.remote,
                        current_connect_state = current.connect_state,
                        "Windows desktop session stabilized without an active WebView2 recovery"
                    );
                    continue;
                }

                tracing::warn!(
                    target: "catwalk_client::webview2",
                    current_remote = current.remote,
                    current_connect_state = current.connect_state,
                    stable_samples = samples,
                    "Windows active desktop stabilized; reloading WebView2"
                );
                for (label, window) in app.webview_windows() {
                    if let Err(error) = window.reload() {
                        tracing::error!(
                            target: "catwalk_client::webview2",
                            webview = %label,
                            error = %error,
                            "failed to reload WebView2 after Windows desktop session change"
                        );
                    }
                }
            }
        })
    {
        tracing::error!(
            target: "catwalk_client::webview2",
            error = %error,
            "failed to start Windows desktop session watcher"
        );
    }
}

#[cfg(target_os = "windows")]
fn windows_desktop_session_state() -> WindowsDesktopSessionState {
    use std::ffi::c_void;

    const SM_REMOTESESSION: i32 = 0x1000;
    const WTS_CONNECT_STATE: i32 = 8;

    #[link(name = "user32")]
    extern "system" {
        fn GetSystemMetrics(index: i32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn ProcessIdToSessionId(process_id: u32, session_id: *mut u32) -> i32;
    }
    #[link(name = "wtsapi32")]
    extern "system" {
        fn WTSQuerySessionInformationW(
            server: *mut c_void,
            session_id: u32,
            info_class: i32,
            buffer: *mut *mut c_void,
            bytes_returned: *mut u32,
        ) -> i32;
        fn WTSFreeMemory(memory: *mut c_void);
    }

    let remote = unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 };
    let mut session_id = 0_u32;
    let connect_state = unsafe {
        if ProcessIdToSessionId(std::process::id(), &mut session_id) == 0 {
            None
        } else {
            let mut buffer: *mut c_void = std::ptr::null_mut();
            let mut bytes = 0_u32;
            let succeeded = WTSQuerySessionInformationW(
                std::ptr::null_mut(),
                session_id,
                WTS_CONNECT_STATE,
                &mut buffer,
                &mut bytes,
            ) != 0;
            let state =
                if succeeded && !buffer.is_null() && bytes >= std::mem::size_of::<i32>() as u32 {
                    Some(*(buffer.cast::<i32>()))
                } else {
                    None
                };
            if !buffer.is_null() {
                // WTS allocates the returned buffer even when its contents are
                // unusable; every non-null result must be released.
                WTSFreeMemory(buffer);
            }
            state
        }
    };
    WindowsDesktopSessionState {
        remote,
        connect_state,
    }
}

fn webview_recovery_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("webview-recovery")
        .on_webview_ready(|webview| {
            #[cfg(target_os = "windows")]
            install_webview2_recovery(webview);
            #[cfg(not(target_os = "windows"))]
            let _ = webview;
        })
        .build()
}

#[cfg(any(target_os = "windows", test))]
fn webview_recovery_should_reload(
    is_unresponsive: bool,
    is_renderer_exit: bool,
    consecutive_unresponsive: &mut u8,
) -> bool {
    if is_unresponsive {
        *consecutive_unresponsive = consecutive_unresponsive.saturating_add(1);
        return *consecutive_unresponsive >= 2;
    }

    *consecutive_unresponsive = 0;
    is_renderer_exit
}

#[cfg(target_os = "windows")]
fn install_webview2_recovery<R: tauri::Runtime>(webview: tauri::Webview<R>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND,
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };
    use webview2_com::ProcessFailedEventHandler;

    const DIAGNOSTIC_TARGET: &str = "catwalk_client::webview2";
    let label = webview.label().to_string();
    let setup_label = label.clone();
    let result = webview.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                tracing::warn!(
                    target: DIAGNOSTIC_TARGET,
                    webview = %setup_label,
                    error = %error,
                    "could not access WebView2 core for failure recovery"
                );
                return;
            }
        };
        let mut consecutive_unresponsive = 0_u8;
        let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Err(error) = unsafe { args.ProcessFailedKind(&mut kind) } {
                tracing::warn!(
                    target: DIAGNOSTIC_TARGET,
                    webview = %label,
                    error = %error,
                    "could not read WebView2 process failure kind"
                );
                return Ok(());
            }

            tracing::warn!(
                target: DIAGNOSTIC_TARGET,
                webview = %label,
                failure_kind = kind.0,
                "WebView2 process failure detected"
            );

            let reload = webview_recovery_should_reload(
                kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
                kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
                &mut consecutive_unresponsive,
            );

            if reload {
                consecutive_unresponsive = 0;
                if let Some(sender) = sender {
                    match unsafe { sender.Reload() } {
                        Ok(()) => tracing::warn!(
                            target: DIAGNOSTIC_TARGET,
                            webview = %label,
                            failure_kind = kind.0,
                            "reloading WebView2 after process failure"
                        ),
                        Err(error) => tracing::error!(
                            target: DIAGNOSTIC_TARGET,
                            webview = %label,
                            failure_kind = kind.0,
                            error = %error,
                            "failed to reload WebView2 after process failure"
                        ),
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0_i64;
        if let Err(error) = unsafe { core.add_ProcessFailed(&handler, &mut token) } {
            tracing::warn!(
                target: DIAGNOSTIC_TARGET,
                webview = %setup_label,
                error = %error,
                "could not register WebView2 process failure handler"
            );
        }
    });
    if let Err(error) = result {
        tracing::warn!(
            target: DIAGNOSTIC_TARGET,
            webview = %webview.label(),
            error = %error,
            "could not schedule WebView2 failure recovery setup"
        );
    }
}

#[cfg(test)]
mod webview_recovery_tests {
    use super::{
        webview_recovery_should_reload, windows_desktop_session_changed,
        windows_desktop_session_recovery_ready, WindowsDesktopSessionState,
        WINDOWS_DESKTOP_RECOVERY_STABLE_SAMPLES,
    };

    #[test]
    fn reloads_only_after_two_consecutive_unresponsive_events() {
        let mut consecutive = 0;

        assert!(!webview_recovery_should_reload(
            true,
            false,
            &mut consecutive
        ));
        assert_eq!(consecutive, 1);
        assert!(webview_recovery_should_reload(
            true,
            false,
            &mut consecutive
        ));
    }

    #[test]
    fn renderer_exit_reloads_immediately_and_other_events_reset_the_count() {
        let mut consecutive = 1;

        assert!(!webview_recovery_should_reload(
            false,
            false,
            &mut consecutive
        ));
        assert_eq!(consecutive, 0);
        assert!(webview_recovery_should_reload(
            false,
            true,
            &mut consecutive
        ));
    }

    #[test]
    fn reloads_when_console_changes_to_rdp_or_wts_connection_state_changes() {
        let console = WindowsDesktopSessionState {
            remote: false,
            connect_state: Some(0),
        };
        let remote = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(0),
        };
        let disconnected = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(4),
        };

        assert!(windows_desktop_session_changed(console, remote));
        assert!(windows_desktop_session_changed(remote, disconnected));
        assert!(!windows_desktop_session_changed(remote, remote));
    }

    #[test]
    fn waits_for_a_stable_active_desktop_before_session_recovery() {
        let disconnected = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(4),
        };
        let active = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(0),
        };

        assert!(!windows_desktop_session_recovery_ready(
            disconnected,
            active,
            WINDOWS_DESKTOP_RECOVERY_STABLE_SAMPLES - 1,
        ));
        assert!(windows_desktop_session_recovery_ready(
            disconnected,
            active,
            WINDOWS_DESKTOP_RECOVERY_STABLE_SAMPLES,
        ));
    }

    #[test]
    fn never_reloads_webview2_while_the_desktop_is_disconnecting() {
        let active = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(0),
        };
        let disconnected = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(4),
        };

        assert!(!windows_desktop_session_recovery_ready(
            active,
            disconnected,
            u8::MAX,
        ));
    }

    #[test]
    fn ignores_transient_wts_query_failures() {
        let known = WindowsDesktopSessionState {
            remote: true,
            connect_state: Some(0),
        };
        let unavailable = WindowsDesktopSessionState {
            remote: true,
            connect_state: None,
        };

        assert!(!windows_desktop_session_changed(known, unavailable));
        assert!(!windows_desktop_session_changed(unavailable, known));
    }
}

#[cfg(test)]
mod onepassword_tests {
    use super::{
        first_existing_executable, onepassword_cli_not_found_message, onepassword_error_code,
        onepassword_item_reference, onepassword_login_from_item, onepassword_login_items,
    };

    #[test]
    fn reports_platform_specific_cli_install_instructions() {
        let message = onepassword_cli_not_found_message();
        assert!(message.contains("1Password CLI is not installed or is not available in PATH"));
        assert!(message.contains("restart ConneCat"));
        #[cfg(target_os = "macos")]
        assert!(message.contains("brew install 1password-cli"));
        #[cfg(target_os = "windows")]
        assert!(message.contains("winget install 1password-cli"));
    }

    #[cfg(unix)]
    #[test]
    fn resolves_homebrew_style_cli_symlinks_before_spawning() {
        use std::os::unix::fs::symlink;

        let directory = std::env::temp_dir().join(format!(
            "catwalk-onepassword-cli-test-{}",
            uuid::Uuid::new_v4()
        ));
        let target = directory.join("Caskroom/1password-cli/2.35.0/op");
        let link = directory.join("bin/op");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::fs::write(&target, b"test executable").unwrap();
        symlink(&target, &link).unwrap();

        let resolved = first_existing_executable([link]).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&target).unwrap());

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn accepts_only_item_level_secret_references() {
        assert_eq!(
            onepassword_item_reference(" op://Infrastructure/Linux host/ ").unwrap(),
            "op://Infrastructure/Linux host"
        );
        assert!(onepassword_item_reference("Infrastructure/Linux host").is_err());
        assert!(onepassword_item_reference("op://Infrastructure/Linux host/password").is_err());
    }

    #[test]
    fn maps_login_metadata_to_stable_secret_references() {
        let value = serde_json::json!([{
            "id": "item-id",
            "title": "Linux host",
            "vault": { "id": "vault-id", "name": "Infrastructure" }
        }]);
        let items = onepassword_login_items(&value);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Linux host");
        assert_eq!(items[0].vault_name, "Infrastructure");
        assert_eq!(items[0].item_reference, "op://vault-id/item-id");
    }

    #[test]
    fn reports_sanitized_onepassword_failure_codes() {
        assert_eq!(
            onepassword_error_code("No 1Password CLI account is available"),
            "desktop_integration_unavailable"
        );
        assert_eq!(
            onepassword_error_code("CLI failed for op://Secret Vault/Private Server"),
            "cli_request_failed"
        );
    }

    #[test]
    fn reads_username_and_password_from_one_item_response() {
        let value = serde_json::json!({
            "fields": [
                { "id": "username", "label": "username", "value": " lab-user " },
                { "id": "password", "label": "password", "value": "secret" }
            ]
        });
        let login = onepassword_login_from_item(&value).unwrap();
        assert_eq!(login.username, "lab-user");
        assert_eq!(login.password, "secret");
    }
}
