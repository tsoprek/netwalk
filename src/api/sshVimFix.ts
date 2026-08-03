// Remote VIMINIT that disables the newer xterm probes (bracketed paste,
// cursor-style request, focus events, kitty-keyboard, etc.) that wedge vim
// 9.x inside xterm.js. This is opt-in for SSH sessions only; local shells
// must not inherit it globally because macOS /usr/bin/vi can break when
// VIMINIT is set.
//
// The double form (`set ...` up front, plus an `autocmd VimEnter * set ...`)
// is deliberate: VIMINIT runs before vimrc, but a user's vimrc or plugin
// might re-enable any of these termcaps. VimEnter fires after all rc/plugin
// loading so the second `set` is the final word.
const VIM_TERMCAP_VARS =
  "t_BE= t_BD= t_PS= t_PE= t_u7= t_RV= t_8f= t_8b= t_RF= t_RB= t_RC=";
export const REMOTE_VIM_TERMCAP_RESET =
  `set ${VIM_TERMCAP_VARS} | autocmd VimEnter * set ${VIM_TERMCAP_VARS}`;

/// Single-quoted POSIX-sh string. The list above contains no single quotes,
/// so a literal wrap is safe.
const REMOTE_VIM_SHELL_CMD =
  `VIMINIT='${REMOTE_VIM_TERMCAP_RESET}' exec \${SHELL:-/bin/sh} -l`;

/// Append `-t <destination> <remote-shell-cmd>` to an in-progress ssh argv,
/// where the remote command exports our VIMINIT and re-execs the user's
/// login shell. Without the wrapper, vim on the remote box can hang because
/// we can't forward env vars across SSH without server-side `AcceptEnv`.
///
/// **Do not use for network hardware** (routers / switches / firewalls /
/// other CLI-only devices). They don't have `$SHELL` or `exec` and reject
/// the wrapper command outright, which kills the SSH session. Use
/// `pushSshDestPlain` for those.
export function pushSshDestWithVimFix(args: string[], destination: string): void {
  args.push("-t", destination, REMOTE_VIM_SHELL_CMD);
}

/// Append just the SSH destination — no remote command, no `-t`. For
/// network gear and other devices whose CLI parser would choke on the
/// vim-fix wrapper.
export function pushSshDestPlain(args: string[], destination: string): void {
  args.push(destination);
}
