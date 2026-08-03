export type NotesIconName =
  | "stacked"
  | "side-by-side"
  | "grid"
  | "navigation-left"
  | "navigation-right"
  | "sync"
  | "backup"
  | "import"
  | "history"
  | "find"
  | "previous"
  | "next"
  | "match-case"
  | "chevron-down"
  | "send-to-notes"
  | "send-to-session"
  | "broadcast"
  | "new-device"
  | "local-shell"
  | "group"
  | "ssh"
  | "rdp"
  | "sftp"
  | "browse"
  | "console"
  | "power"
  | "power-on"
  | "power-off"
  | "suspend"
  | "restart"
  | "reset"
  | "serial-console"
  | "booking"
  | "configure"
  | "cancel-booking"
  | "reconnect"
  | "paste"
  | "ctrl-alt-del"
  | "rename"
  | "delete"
  | "save"
  | "cancel"
  | "add"
  | "remove"
  | "choose"
  | "tunnel"
  | "test"
  | "legend"
  | "up"
  | "new-folder"
  | "upload"
  | "download"
  | "settings"
  | "help"
  | "warning"
  | "preview"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-justify"
  | "indent"
  | "outdent"
  | "new-case"
  | "announcements"
  | "lab"
  | "connections"
  | "sessions"
  | "remote-access"
  | "detach-window"
  | "templates"
  | "notes"
  | "book"
  | "identities";

const SESSION_CONNECTION_ICONS = new Set<NotesIconName>([
  "new-device", "local-shell", "group", "ssh", "rdp", "sftp", "browse",
  "console", "serial-console", "booking", "cancel-booking", "reconnect",
  "tunnel", "test", "lab", "connections", "sessions", "remote-access",
  "detach-window", "identities",
]);

export default function NotesIcon({
  name,
  size = 18,
  color,
  presentationStyle,
}: {
  name: NotesIconName;
  size?: number;
  color?: string;
  presentationStyle?: "outline" | "rounded" | "sharp" | "filled" | "duotone";
}) {
  const category = SESSION_CONNECTION_ICONS.has(name) ? "session-connection" : "button";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    "data-notes-icon": name,
    "data-icon-category": category,
    ...(presentationStyle ? { "data-icon-presentation": presentationStyle } : {}),
    ...(color ? { style: { color } } : {}),
  };

  if (name === "stacked") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 12h18M8 6v3M8 15v3" /></svg>;
  if (name === "side-by-side") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 3v18M6 8h3M15 8h3" /></svg>;
  if (name === "grid") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 3v18M3 12h18" /></svg>;
  if (name === "navigation-left") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18M5.5 7h1M5.5 12h1M5.5 17h1" /></svg>;
  if (name === "navigation-right") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 3v18M17.5 7h1M17.5 12h1M17.5 17h1" /></svg>;
  if (name === "sync") return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5M6.1 8.5A7 7 0 0 1 18.7 7L20 12M4 12l1.3 5A7 7 0 0 0 17.9 15.5" /></svg>;
  if (name === "backup") return <svg {...common}><path d="M6 2.75h8l4 4V21H6zM14 2.75V7h4M12 9.5v7M9.25 13.75 12 16.5l2.75-2.75" /></svg>;
  if (name === "import") return <svg {...common}><path d="M6 2.75h8l4 4V21H6zM14 2.75V7h4M12 16.5v-7M9.25 12.25 12 9.5l2.75 2.75" /></svg>;
  if (name === "find") return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.25 15.25 4.5 4.5" /></svg>;
  if (name === "previous") return <svg {...common}><path d="m15 6-6 6 6 6" /></svg>;
  if (name === "next") return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
  if (name === "match-case") return <svg {...common}><path d="M3.5 18 8 6l4.5 12M5.3 13.2h5.4M14.5 12.5c.8-.7 1.7-1 2.7-1 2 0 3.3 1.2 3.3 3v3.5M20.5 15.2c-.8-.4-1.6-.6-2.5-.6-1.7 0-2.8.7-2.8 1.9 0 1.1.9 1.8 2.2 1.8 1.2 0 2.3-.6 3.1-1.6" /></svg>;
  if (name === "chevron-down") return <svg {...common}><path d="m7 9.5 5 5 5-5" /></svg>;
  if (name === "send-to-notes") return <svg {...common}><path d="M9 3h7l4 4v14H9M16 3v5h4M3 12h10M9 8l4 4-4 4" /></svg>;
  if (name === "send-to-session") return <svg {...common}><path d="M4 3h7l3 3v6H4zM11 3v4h3M8 17h12M15 13l5 4-5 4M4 17h7" /></svg>;
  if (name === "broadcast") return <svg {...common}><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" /></svg>;
  if (name === "new-device") return <svg {...common}><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8M12 17v4M12 6.5v7M8.5 10h7" /></svg>;
  if (name === "local-shell") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
  if (name === "group") return <svg {...common}><path d="M3 6h6l2 2h10v11H3zM15 11v5M12.5 13.5h5" /></svg>;
  if (name === "ssh") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
  if (name === "rdp") return <svg {...common}><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8M12 17v4M8 10h8M13 7l3 3-3 3" /></svg>;
  if (name === "sftp") return <svg {...common}><path d="M3 6h6l2 2h10v11H3zM12 11v6M9.5 13.5 12 11l2.5 2.5" /></svg>;
  if (name === "browse") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
  if (name === "console") return <svg {...common}><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8M12 17v4M12 6v4M8.8 8.1a5 5 0 1 0 6.4 0" /></svg>;
  if (name === "power") return <svg {...common}><path d="M7.05 6.5a8 8 0 1 0 9.9 0M12 3v9" /></svg>;
  if (name === "power-on") return <svg {...common}><path d="m8 5 11 7-11 7z" /></svg>;
  if (name === "power-off") return <svg {...common}><path d="M7.05 6.5a8 8 0 1 0 9.9 0M12 3v9" /></svg>;
  if (name === "suspend") return <svg {...common}><path d="M8 5v14M16 5v14" /></svg>;
  if (name === "restart") return <svg {...common}><path d="M20 7v5h-5M19 12a7 7 0 1 1-2-5" /></svg>;
  if (name === "reset") return <svg {...common}><path d="m13 2-7 11h6l-1 9 7-12h-6z" /></svg>;
  if (name === "serial-console") return <svg {...common}><path d="M7 7h10l2 4v5l-2 2H7l-2-2v-5zM9 7V4M15 7V4M9 12h.01M12 12h.01M15 12h.01M9 15h.01M12 15h.01M15 15h.01" /></svg>;
  if (name === "booking") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5" /></svg>;
  if (name === "configure") return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /><circle cx="14" cy="7" r="2" /><circle cx="6" cy="17" r="2" /></svg>;
  if (name === "cancel-booking") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M9 14l6 6M15 14l-6 6" /></svg>;
  if (name === "reconnect") return <svg {...common}><path d="M5 8h12M14 5l3 3-3 3M19 16H7M10 13l-3 3 3 3" /></svg>;
  if (name === "paste") return <svg {...common}><path d="M9 5V3h6v2M7 5h10v16H7zM10 9h4M10 13h4M10 17h3" /></svg>;
  if (name === "ctrl-alt-del") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M12 9h.01M17 9h.01M7 14h4M15 12l3 3M18 12l-3 3" /></svg>;
  if (name === "rename") return <svg {...common}><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16zM13.5 6.5l4 4M3 22h18" /></svg>;
  if (name === "delete") return <svg {...common}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg>;
  if (name === "save") return <svg {...common}><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-7h8v7" /></svg>;
  if (name === "cancel") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8.5 8.5 7 7M15.5 8.5l-7 7" /></svg>;
  if (name === "add") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
  if (name === "remove") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>;
  if (name === "choose") return <svg {...common}><path d="M3 6h6l2 2h10v11H3zM12 11v6M9.5 13.5 12 11l2.5 2.5" /></svg>;
  if (name === "tunnel") return <svg {...common}><path d="M4 18V9a8 8 0 0 1 16 0v9M8 18V9a4 4 0 0 1 8 0v9M3 18h6M15 18h6" /></svg>;
  if (name === "test") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
  if (name === "legend") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6M12 7.5h.01" /></svg>;
  if (name === "up") return <svg {...common}><path d="M12 20V5M6.5 10.5 12 5l5.5 5.5" /></svg>;
  if (name === "new-folder") return <svg {...common}><path d="M3 6h6l2 2h10v11H3zM15 11v5M12.5 13.5h5" /></svg>;
  if (name === "upload") return <svg {...common}><path d="M4 17v3h16v-3M12 16V4M7.5 8.5 12 4l4.5 4.5" /></svg>;
  if (name === "download") return <svg {...common}><path d="M4 17v3h16v-3M12 4v12M7.5 11.5 12 16l4.5-4.5" /></svg>;
  if (name === "settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21H9.55v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H2.4V9.55h.09A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V2.4h4.05v.09A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1 .4h.09v4.05H21a1.7 1.7 0 0 0-1.6 1.05z" /></svg>;
  if (name === "help") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 3.35 2.2c-.7.35-1.05.8-1.05 1.8M12 17h.01" /></svg>;
  if (name === "warning") return <svg {...common}><path d="M12 3 2.8 20h18.4zM12 9v5M12 17.5h.01" /></svg>;
  if (name === "preview") return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.75" /></svg>;
  if (name === "align-left") return <svg {...common}><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></svg>;
  if (name === "align-center") return <svg {...common}><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></svg>;
  if (name === "align-right") return <svg {...common}><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></svg>;
  if (name === "align-justify") return <svg {...common}><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>;
  if (name === "indent") return <svg {...common}><path d="M10 6h10M10 10h10M10 14h10M10 18h10M4 9l3 3-3 3" /></svg>;
  if (name === "outdent") return <svg {...common}><path d="M10 6h10M10 10h10M10 14h10M10 18h10M7 9l-3 3 3 3" /></svg>;
  if (name === "new-case") return <svg {...common}><path d="M6 3h9l4 4v14H6zM15 3v5h4M12 11v6M9 14h6" /></svg>;
  if (name === "announcements") return <svg {...common}><path d="M4 5h16v11H8l-4 4zM8 9h8M8 12.5h5" /></svg>;
  if (name === "lab") return <svg {...common}><rect x="4" y="3" width="16" height="6" rx="1.5" /><rect x="4" y="15" width="16" height="6" rx="1.5" /><path d="M8 6h.01M8 18h.01M16 6h1M16 18h1M12 9v6" /></svg>;
  if (name === "connections") return <svg {...common}><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8.6 10.5 6.8-3M8.6 13.5l6.8 3" /></svg>;
  if (name === "sessions") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
  if (name === "remote-access") return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M8 10h8M13 7l3 3-3 3" /></svg>;
  if (name === "detach-window") return <svg {...common}><rect x="3" y="8" width="13" height="12" rx="2" /><path d="M7 8V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M16 8h6v6M13 17l9-9" /></svg>;
  if (name === "templates") return <svg {...common}><path d="m12 3 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4" /></svg>;
  if (name === "notes") return <svg {...common}><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h7" /></svg>;
  if (name === "book") return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H4zM20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h3z" /></svg>;
  if (name === "identities") return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 11h5M18.5 8.5v5" /></svg>;
  return <svg {...common}><path d="M4.25 8.5A8.5 8.5 0 1 1 3.5 15M2.5 7.5h4v4M12 7v5l3.5 2" /></svg>;
}
