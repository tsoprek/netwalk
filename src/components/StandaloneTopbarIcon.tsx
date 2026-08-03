export type StandaloneTopbarIconName =
  | "brand"
  | "connections"
  | "sessions"
  | "remote-access"
  | "templates"
  | "notes"
  | "identities"
  | "settings";

export default function StandaloneTopbarIcon({
  name,
  size = 21,
}: {
  name: StandaloneTopbarIconName;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    "data-standalone-topbar-icon": name,
  };
  const secondary = { opacity: 0.65, strokeWidth: 1.35 };

  if (name === "brand") {
    return (
      <svg {...common}>
        <path d="M3.5 8 7 3.5l3 2h4l3-2L20.5 8v8a5 5 0 0 1-5 5h-7a5 5 0 0 1-5-5Z" />
        <circle {...secondary} cx="8.5" cy="11.5" r="1.15" />
        <circle {...secondary} cx="15.5" cy="11.5" r="1.15" />
        <circle {...secondary} cx="12" cy="16" r="1.15" />
        <path {...secondary} d="m9.4 12.4 1.8 2.5m3.4-2.5-1.8 2.5" />
      </svg>
    );
  }
  if (name === "connections") {
    return (
      <svg {...common}>
        <circle cx="5" cy="12" r="2.5" />
        <circle cx="19" cy="6" r="2.5" />
        <circle cx="19" cy="18" r="2.5" />
        <path {...secondary} d="m7.3 11 9.2-4m-9.2 6 9.2 4" />
      </svg>
    );
  }
  if (name === "sessions") {
    return (
      <svg {...common}>
        <rect x="2.5" y="4" width="19" height="16" rx="3" />
        <path d="M2.5 8h19" />
        <path {...secondary} d="m7 11 3 2.5L7 16m6 0h4" />
      </svg>
    );
  }
  if (name === "remote-access") {
    return (
      <svg {...common}>
        <rect x="2.5" y="3.5" width="19" height="14" rx="3" />
        <path d="M8 21h8m-4-3.5V21" />
        <path {...secondary} d="M7 11h7m-2.5-3L15 11l-3.5 3M18 7.5c1.5 1.6 1.5 5.4 0 7" />
      </svg>
    );
  }
  if (name === "templates") {
    return (
      <svg {...common}>
        <path d="m12 2.5 9 4.5-9 4.5L3 7Z" />
        <path d="m3 12 9 4.5 9-4.5M3 17l9 4.5 9-4.5" />
        <path {...secondary} d="M9.5 7 12 8.2 14.5 7 12 5.8Z" />
      </svg>
    );
  }
  if (name === "notes") {
    return (
      <svg {...common}>
        <path d="M5 2.5h9l5 5V21.5H5Z" />
        <path d="M14 2.5v5h5" />
        <path {...secondary} d="M8.5 12h7M8.5 16h5m5-3 .7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7Z" />
      </svg>
    );
  }
  if (name === "identities") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <circle {...secondary} cx="17.5" cy="12.5" r="2.5" />
        <path {...secondary} d="M19.5 14.5 22 17v2h-2v2h-2v-3l-2-2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle {...secondary} cx="9" cy="6" r="2" />
      <circle {...secondary} cx="15" cy="12" r="2" />
      <circle {...secondary} cx="8" cy="18" r="2" />
    </svg>
  );
}
