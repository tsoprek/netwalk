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
