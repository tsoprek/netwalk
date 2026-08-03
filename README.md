# ConneCat

ConneCat is a local-first, standalone desktop workspace for SSH, local shells,
serial consoles, RDP, SFTP, command templates, notes, and identities.

It has no enrollment, broker, Lab inventory, server configuration, telemetry,
cloud note sync, or template sharing. Connections, notes, identities, settings,
and templates are stored locally on the device.

## Development

Prerequisites:

- Node.js 20+
- Rust stable
- Tauri 2 platform prerequisites
- `ssh` in `PATH` for SSH sessions
- `xfreerdp` in `PATH` for Linux RDP sessions

On Linux, install the Tauri/WebKit packages for your distribution. For
Debian/Ubuntu this normally includes:

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf build-essential curl wget file libssl-dev libudev-dev pkg-config
```

Then run:

```bash
npm install
npm run tauri dev
```

Frontend-only development:

```bash
npm run dev
```

Production checks:

```bash
npm test
npm run build
cargo check -p connecat-client
```

The repository includes a Linux GitHub Actions build check. Install your
distribution's FreeRDP package (for example `freerdp2-x11`) to launch RDP.

## Windows without development tools

Do not use `tauri dev` on the destination computer. Build the installer with
the **Windows installer** GitHub Actions workflow instead:

1. Open the repository's **Actions** tab on GitHub.
2. Select **Windows installer**, then choose **Run workflow**.
3. Open the completed workflow run and download the
   `connecat-windows-msi` artifact.
4. Extract the artifact and run the `.msi` on the Windows computer.

The Windows computer needs the Microsoft Edge WebView2 Runtime, which is
already included with supported Windows 10 and Windows 11 installations. It
does not need Node.js, Rust, Git, Visual Studio, or the Tauri CLI.
