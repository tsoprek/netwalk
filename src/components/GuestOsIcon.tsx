/// Compact device-type / guest-OS icon for ConneCat's list and focus views.
/// Resolves the icon in this priority order:
///   1. `deviceType` (HW/CML): cisco_router, cisco_switch, cisco_firewall,
///      linux_ubuntu, linux_rocky, linux_rhel, linux_debian, linux_alpine,
///      linux_generic, windows_server, iosv, iosvl2, nxosv, asav, …
///   2. `fullName` (VM guest_os_full_name): substring match for ubuntu /
///      rocky / rhel / centos / debian / suse / alpine.
///   3. `family` (VM guest_os_family): LINUX / WINDOWS / DARWIN / SOLARIS.
///
/// `size="lg"` returns a larger tile + label suitable for the focus card;
/// the default `"sm"` is a single-line chip for list rows.
type Size = "sm" | "lg";

interface Props {
  family?: string | null;
  fullName?: string | null;
  osType?: string | null;
  deviceType?: string | null;
  size?: Size;
  /// Optional pixel tile override for `size="lg"`. Lets the parent
  /// auto-size the icon to fit the remaining card space.
  tile?: number;
  /// When false (default), only renders if we can identify the device.
  /// Set to true to always render a generic "?" tile for unknowns.
  showUnknown?: boolean;
}

interface Kind {
  key: string;
  label: string;
  /// Brand background for the icon tile.
  bg: string;
}

const PRIMARY_BLUE = "#1976d2";

/// Selectable values for the user-facing "Type / OS icon" override.
/// Mirrors the canonical list in ce-lab-frontend's `DeviceIcon.js` so the
/// two surfaces share the same vocabulary. `value: ""` means "auto-detect".
export const DEVICE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "cisco_router", label: "Cisco router" },
  { value: "cisco_switch", label: "Cisco switch" },
  { value: "cisco_firewall", label: "Cisco firewall (ASA/FTD)" },
  { value: "cisco_nxos", label: "Cisco Nexus (NX-OS)" },
  { value: "cisco_sdwan", label: "Cisco SD-WAN" },
  { value: "linux_ubuntu", label: "Linux \u2014 Ubuntu" },
  { value: "linux_rocky", label: "Linux \u2014 Rocky" },
  { value: "linux_rhel", label: "Linux \u2014 RHEL / CentOS" },
  { value: "linux_debian", label: "Linux \u2014 Debian" },
  { value: "linux_alpine", label: "Linux \u2014 Alpine" },
  { value: "linux_generic", label: "Linux \u2014 generic" },
  { value: "windows_server", label: "Windows server" },
];

function classify(family?: string | null, fullName?: string | null, deviceType?: string | null): Kind | null {
  const dt = (deviceType || "").toLowerCase();
  // 1) Hardware device types — explicit wins.
  if (dt === "cisco_router") return { key: "cisco_router", label: "Router", bg: PRIMARY_BLUE };
  if (dt === "cisco_switch") return { key: "cisco_switch", label: "Switch", bg: PRIMARY_BLUE };
  if (dt === "cisco_firewall") return { key: "cisco_firewall", label: "Firewall", bg: PRIMARY_BLUE };
  if (dt === "cisco_nxos") return { key: "cisco_switch", label: "Nexus", bg: PRIMARY_BLUE };
  if (dt === "cisco_sdwan") return { key: "cisco_router", label: "SD-WAN", bg: PRIMARY_BLUE };
  if (/(^|[-_])cat[-_]?sdwan(?:[-_]|$)/.test(dt) || /(^|[-_])sd[-_]?wan(?:[-_]|$)/.test(dt)) {
    return { key: "cisco_router", label: "SD-WAN", bg: PRIMARY_BLUE };
  }
  if (/(^|[-_])teva(?:[-_]|$)/.test(dt)) return { key: "ubuntu", label: "Ubuntu", bg: "#e95420" };
  if (dt === "linux_ubuntu") return { key: "ubuntu", label: "Ubuntu", bg: "#e95420" };
  if (
    dt === "linux_rocky"
    || /(^|[-_])rocky(?:[-_]linux)?(?:[-_]|$)/.test(dt)
  ) {
    return { key: "rocky", label: "Rocky Linux", bg: "#10b981" };
  }
  if (dt === "linux_rhel") return { key: "rhel", label: "RHEL", bg: "#cc0000" };
  if (dt === "linux_debian") return { key: "debian", label: "Debian", bg: "#a81d33" };
  if (dt === "linux_alpine") return { key: "alpine", label: "Alpine", bg: "#0d597f" };
  if (dt === "linux_generic" || dt === "linux_server") return { key: "tux", label: "Linux", bg: "#555" };
  if (dt === "windows_server") return { key: "windows", label: "Windows", bg: "#0078d4" };

  // CML node definitions. More specific switch/firewall definitions must
  // precede the broad IOS/router match.
  if (
    /(^|[-_])(iosvl2|iol[-_]?l2|nxosv|nxos|cat9kv|cat9000v|unmanaged[-_]?switch)([-_]|$)/.test(dt)
    || dt.startsWith("iosvl2")
    || dt.startsWith("iol-l2")
    || dt.startsWith("nxos")
    || dt.startsWith("cat9")
    || dt.includes("switch")
  ) {
    return { key: "cisco_switch", label: "Switch", bg: PRIMARY_BLUE };
  }
  if (
    /(^|[-_])(asav|ftdv?|firepower)([-_]|$)/.test(dt)
    || dt.startsWith("asa")
    || dt.startsWith("ftd")
    || dt.includes("firewall")
  ) {
    return { key: "cisco_firewall", label: "Firewall", bg: PRIMARY_BLUE };
  }
  if (
    /(^|[-_])(iosv|iosxe|iosxr|iosxrv|xrv|csr1000v|c8000v|cat8000v|iol|vios|router)([-_]|$)/.test(dt)
    || dt.startsWith("ios")
    || dt.startsWith("xrv")
    || dt.startsWith("iol")
    || dt.startsWith("csr")
    || dt.startsWith("c8")
    || dt.startsWith("cat8")
  ) {
    return { key: "cisco_router", label: "Router", bg: PRIMARY_BLUE };
  }
  if (dt.includes("ubuntu")) return { key: "ubuntu", label: "Ubuntu", bg: "#e95420" };
  if (dt.includes("alpine")) return { key: "alpine", label: "Alpine", bg: "#0d597f" };
  if (dt.includes("debian")) return { key: "debian", label: "Debian", bg: "#a81d33" };
  if (/(^|[-_])(linux|server|desktop)([-_]|$)/.test(dt)) {
    return { key: "tux", label: "Linux", bg: "#555" };
  }
  if (dt.includes("windows")) return { key: "windows", label: "Windows", bg: "#0078d4" };

  // 2) VM guest_os_full_name — distro substring match.
  const full = (fullName || "").toLowerCase();
  if (/(^|[-_/\s])teva(?:[-_/\s]|$)/.test(full)) return { key: "ubuntu", label: "Ubuntu", bg: "#e95420" };
  if (/(^|[-_/\s])(?:cat[-_]?sdwan|sd[-_]?wan)(?:[-_/\s]|$)/.test(full)) {
    return { key: "cisco_router", label: "SD-WAN", bg: PRIMARY_BLUE };
  }
  if (full.includes("ubuntu")) return { key: "ubuntu", label: "Ubuntu", bg: "#e95420" };
  if (full.includes("rocky")) return { key: "rocky", label: "Rocky", bg: "#10b981" };
  if (full.includes("rhel") || full.includes("red hat") || full.includes("redhat")) return { key: "rhel", label: "RHEL", bg: "#cc0000" };
  if (full.includes("centos")) return { key: "centos", label: "CentOS", bg: "#932279" };
  if (full.includes("debian")) return { key: "debian", label: "Debian", bg: "#a81d33" };
  if (full.includes("suse")) return { key: "suse", label: "SUSE", bg: "#0c322c" };
  if (full.includes("alpine")) return { key: "alpine", label: "Alpine", bg: "#0d597f" };
  if (full.includes("oracle")) return { key: "rhel", label: "Oracle", bg: "#f80000" };
  if (full.includes("fedora")) return { key: "fedora", label: "Fedora", bg: "#294172" };

  // 3) VM family.
  const fam = (family || "").toUpperCase();
  if (fam === "WINDOWS" || full.includes("windows")) return { key: "windows", label: "Windows", bg: "#0078d4" };
  if (fam === "DARWIN" || full.includes("mac os") || full.includes("macos")) return { key: "macos", label: "macOS", bg: "#333" };
  if (fam === "SOLARIS" || full.includes("solaris")) return { key: "solaris", label: "Solaris", bg: "#ff8c00" };
  if (full.includes("freebsd") || full.includes("bsd")) return { key: "bsd", label: "BSD", bg: "#990000" };
  if (fam === "LINUX" || full.includes("linux")) return { key: "tux", label: "Linux", bg: "#555" };
  return null;
}

// ── Inline SVG glyphs (24×24 viewBox). Ported from the legacy
// ce-lab-frontend DeviceIcon so HW and VM rows look identical.
// Each glyph fills the tile and uses white strokes/fills against the
// `bg` color set by `classify` above.

function Router({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="6" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M8.5 8.5l-2 2M15.5 15.5l2 -2M8.5 15.5l-2 -2M15.5 8.5l2 2"
        stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function Switch({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="9" width="18" height="7" rx="1.5" fill="none" stroke="#fff" strokeWidth="1.6" />
      {[7, 10, 13, 16, 19].map((cx) => <circle key={cx} cx={cx} cy="12.5" r="0.9" fill="#fff" />)}
      <path d="M5 9V6m14 3V6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function Firewall({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z"
        fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 11h6M9 14h6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function Tux({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <ellipse cx="12" cy="13" rx="6" ry="7" fill="#000" />
      <ellipse cx="12" cy="14" rx="4" ry="5" fill="#fff" />
      <circle cx="10" cy="9" r="1.1" fill="#fff" /><circle cx="14" cy="9" r="1.1" fill="#fff" />
      <circle cx="10" cy="9" r="0.5" fill="#000" /><circle cx="14" cy="9" r="0.5" fill="#000" />
      <path d="M11 11.5l1 1 1-1" stroke="#ff9800" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function Ubuntu({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="6.5" cy="12" r="1.5" fill="#fff" />
      <circle cx="14" cy="6.5" r="1.5" fill="#fff" />
      <circle cx="14" cy="17.5" r="1.5" fill="#fff" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}
function Rhel({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 15h12l-2-5H8z" fill="#fff" />
      <circle cx="9" cy="9" r="1.2" fill="#fff" /><circle cx="15" cy="9" r="1.2" fill="#fff" />
    </svg>
  );
}
function Rocky({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 18l5-7 4 4 3-4 4 7z" fill="#fff" />
    </svg>
  );
}
function Debian({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M14 7c-3 0-5 2-5 5s2 5 5 5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function Alpine({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 18l4-6 3 3 3-5 4 8z" fill="#fff" />
    </svg>
  );
}
function CentOs({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M11 3h2v8h8v2h-8v8h-2v-8H3v-2h8z" fill="#fff" />
    </svg>
  );
}
function Suse({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 4c4 0 7 3 7 7s-3 7-7 7-7-3-7-7 3-7 7-7zm-2 6a1 1 0 100 2 1 1 0 000-2z" fill="#fff" />
    </svg>
  );
}
function Fedora({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M14 6h-3a4 4 0 00-4 4v8h3v-6h4v-2h-4v-1c0-.8.7-1 1-1h3z" fill="#fff" />
    </svg>
  );
}
function Windows({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="8.5" height="8.5" fill="#fff" />
      <rect x="12.5" y="3" width="8.5" height="8.5" fill="#fff" />
      <rect x="3" y="12.5" width="8.5" height="8.5" fill="#fff" />
      <rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#fff" />
    </svg>
  );
}
function MacOs({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M15.5 13c0-2 1.6-3 1.6-3-.9-1.3-2.3-1.5-2.8-1.5-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.5-.7-1.3 0-2.5.7-3.1 1.9-1.3 2.3-.3 5.7 1 7.5.6.9 1.4 1.9 2.4 1.9.9 0 1.3-.6 2.5-.6s1.4.6 2.5.6c1 0 1.7-.9 2.3-1.8.7-1 1-2 1-2-1.5-.6-2-2.3-2-3z" fill="#fff" />
      <path d="M13 6.5c.5-.7.9-1.5.8-2.5-.8.1-1.7.6-2.2 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.7-.4 2.2-1.1z" fill="#fff" />
    </svg>
  );
}
function Bsd({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 4l8 4-8 12-8-12z" fill="#fff" />
    </svg>
  );
}
function Solaris({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="#fff" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line key={deg} x1="12" y1="2" x2="12" y2="6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"
          transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}
function Unknown({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M9 9.5c0-1.5 1.3-2.5 3-2.5s3 1 3 2.5c0 1.7-3 1.8-3 4"
        stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="17" r="1.1" fill="#fff" />
    </svg>
  );
}

const GLYPHS: Record<string, (p: { s: number }) => JSX.Element> = {
  cisco_router: Router,
  cisco_switch: Switch,
  cisco_firewall: Firewall,
  ubuntu: Ubuntu,
  rhel: Rhel,
  rocky: Rocky,
  centos: CentOs,
  debian: Debian,
  alpine: Alpine,
  suse: Suse,
  fedora: Fedora,
  tux: Tux,
  windows: Windows,
  macos: MacOs,
  solaris: Solaris,
  bsd: Bsd,
  unknown: Unknown,
};

export default function GuestOsIcon({
  family,
  fullName,
  osType,
  deviceType,
  size = "sm",
  tile: tileProp,
  showUnknown = false,
}: Props) {
  const osIdentity = [fullName, osType].filter(Boolean).join(" ");
  const kind = classify(family, osIdentity, deviceType) ?? (showUnknown
    ? { key: "unknown", label: "Unknown", bg: "#9e9e9e" }
    : null);
  if (!kind) return null;
  const Glyph = GLYPHS[kind.key] ?? Unknown;

  if (size === "lg") {
    const tile = Math.max(16, Math.min(96, tileProp ?? 40));
    const radius = Math.max(4, Math.round(tile * 0.3));
    return (
      <span
        title={fullName || osType || deviceType || kind.label}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: tile, height: tile, borderRadius: radius,
          background: kind.bg, color: "#fff",
        }}
      >
        <Glyph s={Math.round(tile * 0.7)} />
      </span>
    );
  }

  const tile = 18;
  return (
    <span
      title={fullName || osType || deviceType || kind.label}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: tile, height: tile, borderRadius: 5,
        background: kind.bg, color: "#fff",
        verticalAlign: "middle",
      }}
    >
      <Glyph s={Math.round(tile * 0.8)} />
    </span>
  );
}
