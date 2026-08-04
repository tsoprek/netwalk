export type InventoryTypeFilter = "all" | "hardware" | "switch" | "router" | "vm" | "cml";
export type InventoryAssetType = Exclude<InventoryTypeFilter, "all">;

export interface InventoryOsOption {
  value: string;
  label: string;
}

const OS_LABELS: Record<string, string> = {
  ios: "IOS / IOS-XE",
  nxos: "NX-OS",
  sdwan: "SD-WAN",
  rhel: "RHEL",
  rocky: "Rocky Linux",
  ubuntu: "Ubuntu",
  debian: "Debian",
  centos: "CentOS",
  fedora: "Fedora",
  suse: "SUSE",
  alpine: "Alpine",
  windows: "Windows",
  macos: "macOS",
  solaris: "Solaris",
  bsd: "BSD",
  esxi: "VMware ESXi",
  linux: "Linux",
};

function normalizedText(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").trim().toLowerCase().replace(/[_/]/g, "-");
}

/** Return the narrowest useful device class for inventory filtering. */
export function classifyInventoryType({
  isCml = false,
  isVirtual = false,
  descriptors = [],
}: {
  isCml?: boolean;
  isVirtual?: boolean;
  descriptors?: Array<string | null | undefined>;
}): InventoryAssetType {
  if (isCml) return "cml";
  if (isVirtual) return "vm";

  const text = normalizedText(descriptors);
  if (
    /(^|[\s-])(switch|iosvl2|iol-l2|nxos|nx-os|cat9kv|cat9000v)([\s-]|$)/.test(text)
    || text.includes("network-switch")
  ) return "switch";
  if (
    /(^|[\s-])(router|iosv|iosxe|ios-xe|iosxr|ios-xr|csr1000v|c8000v|cat8000v|iol)([\s-]|$)/.test(text)
    || text.includes("network-router")
  ) return "router";
  return "hardware";
}

/** Hardware is an inclusive parent; Switch and Router are its narrower subsets. */
export function matchesInventoryType(filter: InventoryTypeFilter, type: InventoryAssetType): boolean {
  if (filter === "all") return true;
  if (filter === "hardware") return type === "hardware" || type === "switch" || type === "router";
  return filter === type;
}

/** Normalize broker guest names, CML definitions, and saved icon values. */
export function detectInventoryOs(...values: Array<string | null | undefined>): InventoryOsOption | null {
  const text = normalizedText(values);
  if (!text) return null;

  let value: string | null = null;
  if (/(^|[\s-])teva(?=$|[\s-]|\d)/.test(text)) value = "ubuntu";
  else if (/\b(cat-sdwan|sd-wan|sdwan)\b/.test(text) || text.includes("network-sdwan")) value = "sdwan";
  else if (/\b(nxos|nx-os|nxosv)\b/.test(text) || text.includes("network-nxos")) value = "nxos";
  else if (
    /\b(ios|iox|iosv|iosvl2|iosxe|ios-xe|iosxr|ios-xr|csr1000v|c8000v|cat8000v|iol)\b/.test(text)
    || text.includes("network-router")
    || text.includes("network-switch")
  ) value = "ios";
  else if (/(^|[\s-])ubuntu(?=$|[\s-]|\d)/.test(text)) value = "ubuntu";
  else if (/(^|[\s-])rocky(?:-linux)?(?=$|[\s-]|\d)/.test(text)) value = "rocky";
  else if (/(^|[\s-])(rhel|red[\s-]?hat|linux-rhel)(?=$|[\s-]|\d)/.test(text)) value = "rhel";
  else if (/(^|[\s-])centos(?=$|[\s-]|\d)/.test(text)) value = "centos";
  else if (/(^|[\s-])debian(?=$|[\s-]|\d)/.test(text)) value = "debian";
  else if (/(^|[\s-])fedora(?=$|[\s-]|\d)/.test(text)) value = "fedora";
  else if (/\b(suse|sles)\b/.test(text)) value = "suse";
  else if (/\b(alpine)\b/.test(text)) value = "alpine";
  else if (/(^|[\s-])(windows|win10|win11|windows-server)(?=$|[\s-]|\d)/.test(text)) value = "windows";
  else if (/\b(darwin|macos|mac-os)\b/.test(text)) value = "macos";
  else if (/\b(solaris)\b/.test(text)) value = "solaris";
  else if (/\b(freebsd|openbsd|netbsd|bsd)\b/.test(text)) value = "bsd";
  else if (/\b(esxi|vmware-esxi)\b/.test(text)) value = "esxi";
  else if (/\b(linux|linux-generic|linux-server)\b/.test(text)) value = "linux";

  return value ? { value, label: OS_LABELS[value] } : null;
}

export function inventoryOsOptions(
  values: Array<Array<string | null | undefined>>,
): InventoryOsOption[] {
  const found = new Map<string, InventoryOsOption>();
  for (const row of values) {
    const option = detectInventoryOs(...row);
    if (option) found.set(option.value, option);
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}
