// Offscreen parent for console host elements while no Consoles page is mounted.
// WMKS / xterm / Guacamole roots stay in the live DOM here and are reparented
// into the viewport when their tab is active.
let stash: HTMLDivElement | null = null;

export function getConsoleStash(): HTMLDivElement {
  if (stash && document.body.contains(stash)) return stash;
  const s = document.createElement("div");
  s.setAttribute("data-catwalk-console-stash", "1");
  s.style.position = "fixed";
  s.style.left = "-99999px";
  s.style.top = "0";
  s.style.width = "1280px";
  s.style.height = "800px";
  s.style.overflow = "hidden";
  s.style.pointerEvents = "none";
  document.body.appendChild(s);
  stash = s;
  return s;
}
