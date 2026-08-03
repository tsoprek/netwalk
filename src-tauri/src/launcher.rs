//! Spawn the user's terminal pointed at `ssh user@127.0.0.1 -p <port>`.
//!
//! Supports a per-OS set of terminal/SSH clients. Pass `terminal_app` to pick
//! one explicitly; defaults to the OS default (Terminal on mac, OpenSSH on
//! Windows, first available emulator on Linux).
//!
//! `detect()` returns the list of clients we can find on this machine — used
//! by the UI to populate the picker.

use anyhow::{Context, Result};

#[cfg(target_os = "windows")]
fn windows_app_path(name: &str) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    let candidates: Vec<PathBuf> = match name {
        "PuTTY" => vec![
            PathBuf::from(r"C:\Program Files\PuTTY\putty.exe"),
            PathBuf::from(r"C:\Program Files (x86)\PuTTY\putty.exe"),
        ],
        "KiTTY" => vec![
            PathBuf::from(r"C:\Program Files\KiTTY\kitty.exe"),
            PathBuf::from(r"C:\Program Files (x86)\KiTTY\kitty.exe"),
            PathBuf::from(r"C:\KiTTY\kitty.exe"),
        ],
        "SecureCRT" => {
            let mut v: Vec<PathBuf> = Vec::new();
            for base in [
                r"C:\Program Files\VanDyke Software\SecureCRT",
                r"C:\Program Files (x86)\VanDyke Software\SecureCRT",
            ] {
                v.push(PathBuf::from(format!("{base}\\SecureCRT.exe")));
            }
            v
        }
        "WindowsTerminal" => vec![
            // wt.exe is on PATH when installed
            PathBuf::from("wt.exe"),
        ],
        "OpenSSH" => vec![PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh.exe")],
        _ => vec![],
    };
    for c in candidates {
        if c.is_absolute() {
            if c.exists() {
                return Some(c);
            }
        } else if which(&c).is_some() {
            return Some(c);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn which(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let name = exe.file_name()?.to_string_lossy().to_string();
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join(&name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

pub fn detect() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let mut v: Vec<String> = vec!["Terminal".into()];
        for app in ["iTerm", "Warp"] {
            let p = std::path::Path::new("/Applications").join(format!("{app}.app"));
            if p.exists() {
                v.push(app.into());
            }
        }
        v
    }
    #[cfg(target_os = "windows")]
    {
        let mut v: Vec<String> = Vec::new();
        for app in ["OpenSSH", "WindowsTerminal", "PuTTY", "KiTTY", "SecureCRT"] {
            if windows_app_path(app).is_some() {
                v.push(app.into());
            }
        }
        if v.is_empty() {
            v.push("OpenSSH".into());
        }
        v
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut v: Vec<String> = Vec::new();
        for t in ["gnome-terminal", "konsole", "xterm", "x-terminal-emulator"] {
            if std::process::Command::new("which")
                .arg(t)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                v.push(t.into());
            }
        }
        if v.is_empty() {
            v.push("xterm".into());
        }
        v
    }
}

pub fn launch_ssh_host(
    username: &str,
    host: &str,
    port: u16,
    terminal_app: Option<&str>,
    key_path: Option<&str>,
    keepalive_seconds: Option<u32>,
    local_forwards: &[String],
) -> Result<()> {
    #[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
    let key_arg = key_path
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| format!(" -i {}", shell_quote(p)))
        .unwrap_or_default();
    // OpenSSH keepalive options. PuTTY/KiTTY use `-K` instead and are
    // handled per-app below.
    #[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
    let keepalive_arg = keepalive_seconds
        .filter(|n| *n > 0)
        .map(|n| format!(" -o ServerAliveInterval={n} -o ServerAliveCountMax=3"))
        .unwrap_or_default();
    #[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
    let forward_arg = local_forward_args(local_forwards);
    #[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
    let cmd = format!("ssh{key_arg}{keepalive_arg}{forward_arg} -p {port} {username}@{host}");
    #[cfg(target_os = "macos")]
    {
        let app = terminal_app.unwrap_or("Terminal");
        let script = match app {
            "iTerm" | "iTerm2" => format!(
                r#"tell application "iTerm"
                    create window with default profile
                    tell current session of current window to write text "{cmd}"
                end tell"#
            ),
            "Warp" => format!(
                r#"tell application "Warp" to activate
                delay 0.3
                tell application "System Events" to keystroke "t" using command down
                delay 0.2
                tell application "System Events" to keystroke "{cmd}"
                tell application "System Events" to key code 36"#
            ),
            _ => format!(r#"tell application "Terminal" to do script "{cmd}""#),
        };
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .context("spawn osascript")?;
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let app = terminal_app.unwrap_or("OpenSSH");
        let key = key_path.map(str::trim).filter(|s| !s.is_empty());
        let keepalive_str = keepalive_seconds.filter(|n| *n > 0).map(|n| n.to_string());
        match app {
            "PuTTY" => {
                let exe = windows_app_path("PuTTY").context("PuTTY not found")?;
                let mut c = Command::new(exe);
                c.args([
                    "-ssh",
                    &format!("{username}@{host}"),
                    "-P",
                    &port.to_string(),
                ]);
                if let Some(k) = key {
                    c.args(["-i", k]);
                }
                if let Some(k) = keepalive_str.as_deref() {
                    c.args(["-K", k]);
                }
                for spec in normalized_local_forwards(local_forwards) {
                    c.args(["-L", &spec]);
                }
                c.spawn().context("spawn PuTTY")?;
            }
            "KiTTY" => {
                let exe = windows_app_path("KiTTY").context("KiTTY not found")?;
                let mut c = Command::new(exe);
                c.args([
                    "-ssh",
                    &format!("{username}@{host}"),
                    "-P",
                    &port.to_string(),
                ]);
                if let Some(k) = key {
                    c.args(["-i", k]);
                }
                if let Some(k) = keepalive_str.as_deref() {
                    c.args(["-K", k]);
                }
                for spec in normalized_local_forwards(local_forwards) {
                    c.args(["-L", &spec]);
                }
                c.spawn().context("spawn KiTTY")?;
            }
            "SecureCRT" => {
                let exe = windows_app_path("SecureCRT").context("SecureCRT not found")?;
                let mut c = Command::new(exe);
                c.args(["/T", "/SSH2", "/L", username, "/P", &port.to_string()]);
                if let Some(k) = key {
                    c.args(["/I", k]);
                }
                for spec in normalized_local_forwards(local_forwards) {
                    c.args(["/LOCAL", &spec]);
                }
                // SecureCRT keepalive is per-session config, not CLI; skipped.
                c.arg(host);
                c.spawn().context("spawn SecureCRT")?;
            }
            "WindowsTerminal" => {
                let mut c = Command::new("wt.exe");
                c.args(["new-tab", "ssh"]);
                if let Some(k) = key {
                    c.args(["-i", k]);
                }
                if let Some(k) = keepalive_str.as_deref() {
                    c.args([
                        "-o",
                        &format!("ServerAliveInterval={k}"),
                        "-o",
                        "ServerAliveCountMax=3",
                    ]);
                }
                for spec in normalized_local_forwards(local_forwards) {
                    c.args(["-L", &spec]);
                }
                c.args(["-p", &port.to_string(), &format!("{username}@{host}")]);
                c.spawn().context("spawn Windows Terminal")?;
            }
            _ => {
                let mut c = Command::new("cmd");
                c.args(["/C", "start", "", "cmd", "/K", "ssh"]);
                if let Some(k) = key {
                    c.args(["-i", k]);
                }
                if let Some(k) = keepalive_str.as_deref() {
                    c.args([
                        "-o",
                        &format!("ServerAliveInterval={k}"),
                        "-o",
                        "ServerAliveCountMax=3",
                    ]);
                }
                for spec in normalized_local_forwards(local_forwards) {
                    c.args(["-L", &spec]);
                }
                c.args(["-p", &port.to_string(), &format!("{username}@{host}")]);
                c.spawn().context("spawn cmd")?;
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = terminal_app;
        for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            if std::process::Command::new(term)
                .args(["-e", "sh", "-c", &cmd])
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }
        anyhow::bail!("no terminal emulator found; run manually: {cmd}");
    }

    Ok(())
}

/// Launch the platform's RDP client against `<host>:<port>`. On macOS this
/// writes a temporary `.rdp` file and opens it (Microsoft Remote Desktop
/// handles the rest). On Windows we hand the `.rdp` to `mstsc`. On Linux we
/// try `xfreerdp`.
pub fn launch_rdp_host(username: &str, host: &str, port: u16) -> Result<()> {
    let full = format!("{host}:{port}");

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        // `authentication level:i:0` + `enablecredsspsupport:i:0` are critical
        // for tunneled connections: mstsc otherwise tries NLA/CredSSP against
        // 127.0.0.1, the SPN doesn't match, and the connection is torn down
        // a second after the tunnel opens (target host then sees the broker
        // close the channel). Clipboard redirection is left off here because
        // its synchronous negotiation can freeze the whole Windows session
        // while the remote side is still on the cert-warning dialog; the
        // user can re-enable it from the in-session toolbar if needed.
        let rdp = format!(
            "full address:s:{full}\n\
             prompt for credentials:i:1\n\
             username:s:{username}\n\
             screen mode id:i:1\n\
             use multimon:i:0\n\
             session bpp:i:32\n\
             audiomode:i:0\n\
             redirectclipboard:i:0\n\
             redirectdrives:i:0\n\
             smart sizing:i:1\n\
             authentication level:i:0\n\
             enablecredsspsupport:i:0\n\
             negotiate security layer:i:1\n"
        );
        let safe_host = host.replace(|c: char| !c.is_alphanumeric(), "_");
        let path = std::env::temp_dir().join(format!("catwalk-{safe_host}-{port}.rdp"));
        std::fs::write(&path, rdp).context("write rdp file")?;

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .context("open rdp file (Microsoft Remote Desktop required)")?;
        }
        #[cfg(target_os = "windows")]
        {
            // Invoke mstsc.exe directly rather than `cmd /C start "" <path>`.
            // The shell-start path adds Mark-of-the-Web to the temp file,
            // which trips the "publisher can't be identified" modal and
            // makes Defender scan the file before mstsc even reads it —
            // visible to the user as the entire window freezing.
            std::process::Command::new("mstsc.exe")
                .arg(&path)
                .spawn()
                .context("spawn mstsc")?;
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xfreerdp")
            .arg(format!("/v:{full}"))
            .arg(format!("/u:{username}"))
            .arg("/cert:ignore")
            .spawn()
            .context("spawn xfreerdp (install freerdp)")?;
    }

    Ok(())
}

fn normalized_local_forwards(local_forwards: &[String]) -> Vec<String> {
    local_forwards
        .iter()
        .map(|s| s.trim())
        .filter(|s| {
            !s.is_empty()
                && !s
                    .chars()
                    .any(|c| c.is_whitespace() || c == '"' || c == '\\')
        })
        .map(str::to_string)
        .collect()
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn local_forward_args(local_forwards: &[String]) -> String {
    normalized_local_forwards(local_forwards)
        .iter()
        .map(|spec| format!(" -L {}", shell_quote(spec)))
        .collect::<String>()
}

/// Single-quote a path for /bin/sh so spaces and shell metacharacters survive.
/// Used when building command strings handed to osascript or `sh -c`.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn launch_sftp_host(
    username: &str,
    host: &str,
    port: u16,
    terminal_app: Option<&str>,
    key_path: Option<&str>,
    keepalive_seconds: Option<u32>,
) -> Result<()> {
    let key = key_path.map(str::trim).filter(|s| !s.is_empty());
    let key_arg = key
        .map(|p| format!(" -i {}", shell_quote(p)))
        .unwrap_or_default();
    let keepalive_arg = keepalive_seconds
        .filter(|n| *n > 0)
        .map(|n| format!(" -o ServerAliveInterval={n} -o ServerAliveCountMax=3"))
        .unwrap_or_default();
    let cmd = format!("sftp{key_arg}{keepalive_arg} -P {port} {username}@{host}");

    #[cfg(target_os = "macos")]
    {
        let app = terminal_app.unwrap_or("Terminal");
        let script = match app {
            "iTerm" | "iTerm2" => format!(
                r#"tell application "iTerm"
                    create window with default profile
                    tell current session of current window to write text "{cmd}"
                end tell"#
            ),
            "Warp" => format!(
                r#"tell application "Warp" to activate
                delay 0.3
                tell application "System Events" to keystroke "t" using command down
                delay 0.2
                tell application "System Events" to keystroke "{cmd}"
                tell application "System Events" to key code 36"#
            ),
            _ => format!(r#"tell application "Terminal" to do script "{cmd}""#),
        };
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .context("spawn osascript")?;
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let app = terminal_app.unwrap_or("OpenSSH");
        match app {
            "WindowsTerminal" => {
                let mut c = Command::new("wt.exe");
                c.args(["new-tab", "sftp"]);
                if let Some(k) = key {
                    c.args(["-i", k]);
                }
                c.args(["-P", &port.to_string(), &format!("{username}@{host}")]);
                c.spawn().context("spawn Windows Terminal")?;
            }
            _ => {
                Command::new("cmd")
                    .args(["/C", "start", "cmd", "/K", &cmd])
                    .spawn()
                    .context("spawn cmd")?;
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = terminal_app;
        for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            if std::process::Command::new(term)
                .args(["-e", "sh", "-c", &cmd])
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }
        anyhow::bail!("no terminal emulator found; run manually: {cmd}");
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// SFTP GUI launchers (Cyberduck / FileZilla / WinSCP). These open the user's
// installed graphical SFTP client pointed at the loopback tunnel. The key
// path is honored where the client supports it via CLI flags; FileZilla can
// only consume keys from its own settings, so we just open the URL there.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct SftpGuiApp {
    pub id: String,
    pub label: String,
}

pub fn detect_sftp_guis() -> Vec<SftpGuiApp> {
    let mut v: Vec<SftpGuiApp> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        for (id, label, app) in [
            ("cyberduck", "Cyberduck", "Cyberduck.app"),
            ("filezilla", "FileZilla", "FileZilla.app"),
            ("transmit", "Transmit", "Transmit.app"),
            ("forklift", "ForkLift", "ForkLift.app"),
        ] {
            if std::path::Path::new("/Applications").join(app).exists() {
                v.push(SftpGuiApp {
                    id: id.into(),
                    label: label.into(),
                });
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        for (id, label) in [("winscp", "WinSCP"), ("filezilla", "FileZilla")] {
            if windows_sftp_gui_path(id).is_some() {
                v.push(SftpGuiApp {
                    id: id.into(),
                    label: label.into(),
                });
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (id, label, bin) in [
            ("filezilla", "FileZilla", "filezilla"),
            ("nautilus", "Files (GVfs)", "nautilus"),
        ] {
            if std::process::Command::new("which")
                .arg(bin)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                v.push(SftpGuiApp {
                    id: id.into(),
                    label: label.into(),
                });
            }
        }
    }
    v
}

#[cfg(target_os = "windows")]
fn windows_sftp_gui_path(id: &str) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    let candidates: Vec<PathBuf> = match id {
        "winscp" => vec![
            PathBuf::from(r"C:\Program Files\WinSCP\WinSCP.exe"),
            PathBuf::from(r"C:\Program Files (x86)\WinSCP\WinSCP.exe"),
        ],
        "filezilla" => vec![
            PathBuf::from(r"C:\Program Files\FileZilla FTP Client\filezilla.exe"),
            PathBuf::from(r"C:\Program Files (x86)\FileZilla FTP Client\filezilla.exe"),
        ],
        _ => vec![],
    };
    candidates.into_iter().find(|c| c.exists())
}

pub fn launch_sftp_gui_host(
    app_id: &str,
    username: &str,
    host: &str,
    port: u16,
    key_path: Option<&str>,
) -> Result<()> {
    let key = key_path.map(str::trim).filter(|s| !s.is_empty());
    let url = format!("sftp://{username}@{host}:{port}");

    #[cfg(target_os = "macos")]
    {
        let app_name = match app_id {
            "cyberduck" => "Cyberduck",
            "filezilla" => "FileZilla",
            "transmit" => "Transmit",
            "forklift" => "ForkLift",
            other => other,
        };
        std::process::Command::new("open")
            .args(["-a", app_name, &url])
            .spawn()
            .with_context(|| format!("open {app_name}"))?;
        let _ = key; // GUIs on mac configure keys per-profile, not via CLI
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let exe = windows_sftp_gui_path(app_id).with_context(|| format!("{app_id} not found"))?;
        let mut c = Command::new(exe);
        c.arg(&url);
        if app_id == "winscp" {
            if let Some(k) = key {
                c.arg(format!("/privatekey={k}"));
            }
        }
        c.spawn().with_context(|| format!("spawn {app_id}"))?;
        let _ = key;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let bin = match app_id {
            "filezilla" => "filezilla",
            "nautilus" => "nautilus",
            _ => "xdg-open",
        };
        std::process::Command::new(bin)
            .arg(&url)
            .spawn()
            .with_context(|| format!("spawn {bin}"))?;
        let _ = key;
    }

    Ok(())
}
