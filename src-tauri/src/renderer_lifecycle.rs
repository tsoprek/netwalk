//! Guarded lifecycle replacement for the main macOS WKWebView.
//!
//! WebKit can retain large compositor backing stores after navigation and
//! resize churn. It does not expose a supported cache-trim API, so the only
//! reliable ownership boundary is the WebContent process itself. This module
//! replaces only the main webview while retaining the native window/process.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Webview};

use crate::{direct_rdp::DirectRdpState, pty::PtyRegistry, sftp::SftpRegistry};

const MAIN_LABEL: &str = "main";
const MAX_ROUTE_LENGTH: usize = 2_048;

#[derive(Debug, PartialEq, Eq)]
enum RecreateFailureAction {
    RestartApplication,
}

fn recreate_failure_action() -> RecreateFailureAction {
    RecreateFailureAction::RestartApplication
}

fn is_main_webview_label(label: &str) -> bool {
    label == MAIN_LABEL
}

#[derive(Default)]
pub struct RendererLifecycleState {
    reset_in_progress: AtomicBool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RendererBlocker {
    pub code: String,
    pub count: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererLifecycleStatus {
    pub supported: bool,
    pub reset_in_progress: bool,
    pub pty_count: usize,
    pub sftp_session_count: usize,
    pub sftp_transfer_count: usize,
    pub direct_rdp_count: usize,
    pub blockers: Vec<RendererBlocker>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererResetRequest {
    pub reset_id: String,
    pub reason: String,
    pub route: String,
    pub churn_score: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererResetResponse {
    pub accepted: bool,
    pub reset_id: String,
    pub blockers: Vec<RendererBlocker>,
    pub message: Option<String>,
}

fn blocker(code: &str, count: usize, singular: &str) -> RendererBlocker {
    RendererBlocker {
        code: code.to_string(),
        count,
        message: format!(
            "{count} {singular}{} active",
            if count == 1 { " is" } else { "s are" }
        ),
    }
}

fn native_blockers(
    pty_count: usize,
    sftp_session_count: usize,
    sftp_transfer_count: usize,
    direct_rdp_count: usize,
) -> Vec<RendererBlocker> {
    let mut blockers = Vec::new();
    if pty_count > 0 {
        blockers.push(blocker("native_pty", pty_count, "native terminal"));
    }
    if sftp_session_count > 0 {
        blockers.push(blocker("native_sftp", sftp_session_count, "SFTP session"));
    }
    if sftp_transfer_count > 0 {
        blockers.push(blocker(
            "native_sftp_transfer",
            sftp_transfer_count,
            "SFTP transfer",
        ));
    }
    if direct_rdp_count > 0 {
        blockers.push(blocker(
            "direct_rdp",
            direct_rdp_count,
            "Direct RDP session",
        ));
    }
    blockers
}

fn collect_status(
    lifecycle: &RendererLifecycleState,
    ptys: &PtyRegistry,
    sftp: &SftpRegistry,
    direct_rdp: &DirectRdpState,
) -> RendererLifecycleStatus {
    let pty_count = ptys.active_count();
    let sftp_session_count = sftp.active_session_count();
    let sftp_transfer_count = sftp.active_transfer_count();
    let direct_rdp_count = direct_rdp.active_count();
    RendererLifecycleStatus {
        supported: cfg!(target_os = "macos"),
        reset_in_progress: lifecycle.reset_in_progress.load(Ordering::Acquire),
        pty_count,
        sftp_session_count,
        sftp_transfer_count,
        direct_rdp_count,
        blockers: native_blockers(
            pty_count,
            sftp_session_count,
            sftp_transfer_count,
            direct_rdp_count,
        ),
    }
}

fn valid_route(route: &str) -> bool {
    !route.is_empty()
        && route.len() <= MAX_ROUTE_LENGTH
        && route.starts_with('/')
        && !route.starts_with("//")
        && !route.contains("://")
        && !route.contains(['\r', '\n'])
}

fn valid_reason(reason: &str) -> bool {
    matches!(reason, "manual" | "background_idle")
}

#[tauri::command]
pub fn renderer_lifecycle_status(
    lifecycle: State<'_, RendererLifecycleState>,
    ptys: State<'_, PtyRegistry>,
    sftp: State<'_, Arc<SftpRegistry>>,
    direct_rdp: State<'_, DirectRdpState>,
) -> RendererLifecycleStatus {
    collect_status(&lifecycle, &ptys, sftp.inner().as_ref(), &direct_rdp)
}

#[tauri::command]
pub fn renderer_lifecycle_reset_main(
    app: AppHandle,
    invoking_webview: Webview,
    lifecycle: State<'_, RendererLifecycleState>,
    ptys: State<'_, PtyRegistry>,
    sftp: State<'_, Arc<SftpRegistry>>,
    direct_rdp: State<'_, DirectRdpState>,
    request: RendererResetRequest,
) -> RendererResetResponse {
    let reject = |code: &str, message: &str| RendererResetResponse {
        accepted: false,
        reset_id: request.reset_id.clone(),
        blockers: vec![RendererBlocker {
            code: code.to_string(),
            count: 1,
            message: message.to_string(),
        }],
        message: Some(message.to_string()),
    };

    if !cfg!(target_os = "macos") {
        return reject(
            "unsupported_platform",
            "Renderer reset is available only on macOS.",
        );
    }
    if !is_main_webview_label(invoking_webview.label()) {
        return reject(
            "not_main_webview",
            "Only the main ConnCat renderer can be reset.",
        );
    }
    if !valid_route(&request.route) {
        return reject(
            "invalid_route",
            "The current route cannot be restored safely.",
        );
    }
    if !valid_reason(&request.reason) {
        return reject(
            "invalid_reason",
            "The renderer reset reason is not recognized.",
        );
    }

    let status = collect_status(&lifecycle, &ptys, sftp.inner().as_ref(), &direct_rdp);
    if !status.blockers.is_empty() {
        return RendererResetResponse {
            accepted: false,
            reset_id: request.reset_id,
            blockers: status.blockers,
            message: Some("Close active native sessions before reclaiming renderer memory.".into()),
        };
    }

    if lifecycle
        .reset_in_progress
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return reject(
            "reset_in_progress",
            "A renderer reset is already in progress.",
        );
    }

    tracing::info!(
        reset_id = %request.reset_id,
        reason = %request.reason,
        route = %request.route,
        churn_score = request.churn_score,
        pty_count = status.pty_count,
        sftp_session_count = status.sftp_session_count,
        sftp_transfer_count = status.sftp_transfer_count,
        direct_rdp_count = status.direct_rdp_count,
        "renderer reset accepted"
    );

    let reset_id = request.reset_id.clone();
    let scheduled_reset_id = reset_id.clone();
    tauri::async_runtime::spawn(async move {
        // Ensure the invoking IPC request has been serialized before its
        // webview is destroyed.
        std::thread::sleep(Duration::from_millis(150));
        if let Err(error) = recreate_main_webview(&app) {
            tracing::error!(
                reset_id = %scheduled_reset_id,
                %error,
                fallback = "application_restart",
                "renderer recreation failed; restarting ConnCat"
            );
            match recreate_failure_action() {
                RecreateFailureAction::RestartApplication => app.restart(),
            }
        }
        if let Some(state) = app.try_state::<RendererLifecycleState>() {
            state.reset_in_progress.store(false, Ordering::Release);
        }
        tracing::info!(
            reset_id = %scheduled_reset_id,
            result = "recreated",
            "renderer recreation completed"
        );
    });

    RendererResetResponse {
        accepted: true,
        reset_id,
        blockers: Vec::new(),
        message: None,
    }
}

#[cfg(target_os = "macos")]
fn recreate_main_webview(app: &AppHandle) -> Result<(), String> {
    use tauri::{PhysicalPosition, WebviewBuilder};

    let window = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main native window is missing".to_string())?;
    let old_webview = app
        .get_webview(MAIN_LABEL)
        .ok_or_else(|| "main webview is missing".to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| format!("read main window size: {error}"))?;
    let config = app
        .config()
        .app
        .windows
        .first()
        .ok_or_else(|| "main webview configuration is missing".to_string())?
        .clone();

    old_webview
        .close()
        .map_err(|error| format!("close old main webview: {error}"))?;
    std::thread::sleep(Duration::from_millis(100));

    let builder = WebviewBuilder::from_config(&config).auto_resize();
    window
        .add_child(builder, PhysicalPosition::new(0, 0), size)
        .map_err(|error| format!("attach replacement main webview: {error}"))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn recreate_main_webview(_app: &AppHandle) -> Result<(), String> {
    Err("renderer recreation is only supported on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_local_routes() {
        assert!(valid_route("/devices?view=list#selected"));
        assert!(!valid_route(""));
        assert!(!valid_route("https://example.test/devices"));
        assert!(!valid_route("//example.test/devices"));
        assert!(!valid_route("/devices\nignored"));
    }

    #[test]
    fn validates_the_main_webview_and_restart_fallback() {
        assert!(is_main_webview_label("main"));
        assert!(!is_main_webview_label("session-1"));
        assert_eq!(
            recreate_failure_action(),
            RecreateFailureAction::RestartApplication
        );
    }

    #[test]
    fn reports_every_native_blocker_count() {
        let blockers = native_blockers(2, 1, 3, 1);
        assert_eq!(blockers.len(), 4);
        assert_eq!(blockers[0].code, "native_pty");
        assert_eq!(blockers[0].count, 2);
        assert_eq!(blockers[3].code, "direct_rdp");
    }

    #[test]
    fn reset_guard_is_idempotent() {
        let state = RendererLifecycleState::default();
        assert!(state
            .reset_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
        assert!(state
            .reset_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err());
    }
}
