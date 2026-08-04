// Command templates for the terminal — predefined CLI snippets the user
// can paste into a live tab or broadcast to every member of a group.
// Each template carries a body with `{{variable}}` placeholders and a
// list of typed variables; the TemplatePicker UI prompts for any
// declared variable (using the default), then substitutes and sends.
//
// Bundled templates are the offline fallback.


export interface TemplateVar {
  /// Placeholder name as it appears in the body, without the {{}}.
  key: string;
  /// Human-friendly label shown in the picker.
  label: string;
  /// Optional default value pre-populated in the picker. Strings with
  /// no useful default should be `""` so the user is forced to type.
  default?: string;
  /// Optional short hint shown beneath the field.
  hint?: string;
  /// When true, the value is treated as a secret in the picker (masked
  /// input). The body is still substituted as plain text.
  secret?: boolean;
  /// When true, multi-line input is accepted (textarea). Default false.
  multiline?: boolean;
}

export interface CommandTemplate {
  id: string;
  category: string;          // top-level grouping ("Switch", "Router")
  subcategory?: string;      // optional sub-grouping ("App hosting")
  name: string;              // shown in the menu
  description?: string;      // optional one-liner shown in the picker
  /// CLI body to send. Lines are sent one at a time with a small inter-line
  /// pause so devices that can't take a flood (older IOS, console-mode
  /// switches) don't drop commands. Supports `{{varKey}}` placeholders.
  body: string;
  /// Variables declared by the body. The picker prompts in this order.
  variables?: TemplateVar[];
  /// Optional inter-line delay in ms when sending. Default 60ms gives
  /// network OSes plenty of time to echo and accept the next line. Set
  /// to 0 for paste-as-block behaviour.
  lineDelayMs?: number;
}

// ───────────────────────── Switch ────────────────────────────────

const SWITCH_SNMPV2: CommandTemplate = {
  id: "switch-snmpv2",
  category: "Switch",
  name: "SNMPv2c",
  description: "Configure read-only SNMPv2c community + contact/location and restrict to a manager ACL.",
  variables: [
    { key: "community", label: "Read-only community", default: "public", secret: true },
    { key: "manager_ip", label: "SNMP manager IPv4", default: "" },
    { key: "contact", label: "snmp-server contact", default: "noc@example.com" },
    { key: "location", label: "snmp-server location", default: "Lab" },
  ],
  body: `configure terminal
ip access-list standard SNMP-MGRS
 permit {{manager_ip}}
 deny any log
exit
snmp-server community {{community}} RO SNMP-MGRS
snmp-server contact {{contact}}
snmp-server location {{location}}
snmp-server enable traps
snmp-server host {{manager_ip}} version 2c {{community}}
end
write memory
`,
};

const SWITCH_SNMPV3: CommandTemplate = {
  id: "switch-snmpv3",
  category: "Switch",
  name: "SNMPv3 (authPriv)",
  description: "Configure SNMPv3 user/group with SHA auth + AES priv, restricted to a manager ACL.",
  variables: [
    { key: "snmp_user", label: "SNMPv3 user", default: "snmpadmin" },
    { key: "snmp_group", label: "SNMPv3 group", default: "SNMP-RO" },
    { key: "auth_pass", label: "Auth password (SHA)", default: "", secret: true },
    { key: "priv_pass", label: "Privacy password (AES-128)", default: "", secret: true },
    { key: "manager_ip", label: "SNMP manager IPv4", default: "" },
    { key: "contact", label: "snmp-server contact", default: "noc@example.com" },
    { key: "location", label: "snmp-server location", default: "Lab" },
  ],
  body: `configure terminal
ip access-list standard SNMP-MGRS
 permit {{manager_ip}}
 deny any log
exit
snmp-server contact {{contact}}
snmp-server location {{location}}
snmp-server view SNMP-VIEW iso included
snmp-server group {{snmp_group}} v3 priv read SNMP-VIEW access SNMP-MGRS
snmp-server user {{snmp_user}} {{snmp_group}} v3 auth sha {{auth_pass}} priv aes 128 {{priv_pass}}
snmp-server enable traps
snmp-server host {{manager_ip}} version 3 priv {{snmp_user}}
end
write memory
`,
};

const SWITCH_NETFLOW: CommandTemplate = {
  id: "switch-netflow",
  category: "Switch",
  name: "NetFlow export",
  description: "Flexible NetFlow record, exporter, and per-interface monitor using NetFlow v9.",
  variables: [
    { key: "collector_ip", label: "Collector IP", default: "" },
    { key: "collector_port", label: "Collector UDP port", default: "9995" },
    { key: "source_intf", label: "Exporter source interface", default: "Vlan1" },
    { key: "monitor_intf", label: "Interface(s) to monitor (comma-separated)", default: "GigabitEthernet1/0/1" },
    { key: "active_timeout", label: "Active timeout (s)", default: "60" },
    { key: "inactive_timeout", label: "Inactive timeout (s)", default: "15" },
  ],
  body: `configure terminal
flow record FLOW-RECORD
 match ipv4 source address
 match ipv4 destination address
 match transport source-port
 match transport destination-port
 match ipv4 protocol
 match ipv4 tos
 collect counter bytes
 collect counter packets
 collect timestamp absolute first
 collect timestamp absolute last
 collect interface input
 collect interface output
exit
flow exporter FLOW-EXPORTER
 destination {{collector_ip}}
 source {{source_intf}}
 transport udp {{collector_port}}
 export-protocol netflow-v9
 template data timeout 60
exit
flow monitor FLOW-MONITOR
 record FLOW-RECORD
 exporter FLOW-EXPORTER
 cache timeout active {{active_timeout}}
 cache timeout inactive {{inactive_timeout}}
exit
! Apply to the interface(s) you want to monitor:
interface {{monitor_intf}}
 ip flow monitor FLOW-MONITOR input
 ip flow monitor FLOW-MONITOR output
end
write memory
`,
};

// ───────────────────────── Router ────────────────────────────────

const ROUTER_SNMPV2: CommandTemplate = {
  id: "router-snmpv2",
  category: "Router",
  name: "SNMPv2c",
  description: "Read-only SNMPv2c community restricted to a manager ACL.",
  variables: [
    { key: "community", label: "Read-only community", default: "public", secret: true },
    { key: "manager_ip", label: "SNMP manager IPv4", default: "" },
    { key: "contact", label: "snmp-server contact", default: "noc@example.com" },
    { key: "location", label: "snmp-server location", default: "Lab" },
  ],
  body: `configure terminal
ip access-list standard SNMP-MGRS
 permit {{manager_ip}}
 deny any log
exit
snmp-server community {{community}} RO SNMP-MGRS
snmp-server contact {{contact}}
snmp-server location {{location}}
snmp-server enable traps
snmp-server host {{manager_ip}} version 2c {{community}}
end
write memory
`,
};

const ROUTER_SNMPV3: CommandTemplate = {
  id: "router-snmpv3",
  category: "Router",
  name: "SNMPv3 (authPriv)",
  description: "SNMPv3 user with SHA auth + AES privacy, manager ACL.",
  variables: [
    { key: "snmp_user", label: "SNMPv3 user", default: "snmpadmin" },
    { key: "snmp_group", label: "SNMPv3 group", default: "SNMP-RO" },
    { key: "auth_pass", label: "Auth password (SHA)", default: "", secret: true },
    { key: "priv_pass", label: "Privacy password (AES-128)", default: "", secret: true },
    { key: "manager_ip", label: "SNMP manager IPv4", default: "" },
    { key: "contact", label: "snmp-server contact", default: "noc@example.com" },
    { key: "location", label: "snmp-server location", default: "Lab" },
  ],
  body: `configure terminal
ip access-list standard SNMP-MGRS
 permit {{manager_ip}}
 deny any log
exit
snmp-server contact {{contact}}
snmp-server location {{location}}
snmp-server view SNMP-VIEW iso included
snmp-server group {{snmp_group}} v3 priv read SNMP-VIEW access SNMP-MGRS
snmp-server user {{snmp_user}} {{snmp_group}} v3 auth sha {{auth_pass}} priv aes 128 {{priv_pass}}
snmp-server enable traps
snmp-server host {{manager_ip}} version 3 priv {{snmp_user}}
end
write memory
`,
};

const ROUTER_NETFLOW: CommandTemplate = {
  id: "router-netflow",
  category: "Router",
  name: "NetFlow export",
  description: "Flexible NetFlow record, exporter, and monitor using NetFlow v9.",
  variables: [
    { key: "collector_ip", label: "Collector IP", default: "" },
    { key: "collector_port", label: "Collector UDP port", default: "9995" },
    { key: "source_intf", label: "Exporter source interface", default: "Loopback0" },
    { key: "monitor_intf", label: "Interface(s) to monitor", default: "GigabitEthernet0/0/0" },
    { key: "active_timeout", label: "Active timeout (s)", default: "60" },
    { key: "inactive_timeout", label: "Inactive timeout (s)", default: "15" },
  ],
  body: `configure terminal
flow record FLOW-RECORD
 match ipv4 source address
 match ipv4 destination address
 match transport source-port
 match transport destination-port
 match ipv4 protocol
 match ipv4 tos
 collect counter bytes
 collect counter packets
 collect timestamp absolute first
 collect timestamp absolute last
 collect interface input
 collect interface output
exit
flow exporter FLOW-EXPORTER
 destination {{collector_ip}}
 source {{source_intf}}
 transport udp {{collector_port}}
 export-protocol netflow-v9
 template data timeout 60
exit
flow monitor FLOW-MONITOR
 record FLOW-RECORD
 exporter FLOW-EXPORTER
 cache timeout active {{active_timeout}}
 cache timeout inactive {{inactive_timeout}}
exit
interface {{monitor_intf}}
 ip flow monitor FLOW-MONITOR input
 ip flow monitor FLOW-MONITOR output
end
write memory
`,
};

export const COMMAND_TEMPLATES: CommandTemplate[] = [
  SWITCH_SNMPV2,
  SWITCH_SNMPV3,
  SWITCH_NETFLOW,
  ROUTER_SNMPV2,
  ROUTER_SNMPV3,
  ROUTER_NETFLOW,
];

export function preconfiguredCommandTemplates(): CommandTemplate[] {
  return COMMAND_TEMPLATES;
}

/// Substitute `{{key}}` placeholders in `body` using `values`. Missing
/// keys are left as `{{key}}` so the user can see what was forgotten
/// rather than silently sending empty strings.
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = values[k];
    return v == null ? m : v;
  });
}

/// Templates grouped by category > subcategory for menu rendering.
export interface TemplateMenuNode {
  category: string;
  groups: Array<{ subcategory?: string; templates: CommandTemplate[] }>;
}

export function groupTemplates(templates: CommandTemplate[]): TemplateMenuNode[] {
  const byCat = new Map<string, Map<string, CommandTemplate[]>>();
  for (const t of templates) {
    if (!byCat.has(t.category)) byCat.set(t.category, new Map());
    const subMap = byCat.get(t.category)!;
    const key = t.subcategory ?? "";
    if (!subMap.has(key)) subMap.set(key, []);
    subMap.get(key)!.push(t);
  }
  const out: TemplateMenuNode[] = [];
  for (const [category, subMap] of byCat) {
    const groups: TemplateMenuNode["groups"] = [];
    // Subcategoried items first, then loose items in original order.
    for (const [sub, list] of subMap) {
      if (sub === "") continue;
      groups.push({ subcategory: sub, templates: list });
    }
    if (subMap.has("")) groups.push({ templates: subMap.get("")! });
    out.push({ category, groups });
  }
  return out;
}

export function groupTemplatesForMenu(extras: CommandTemplate[] = []): TemplateMenuNode[] {
  return groupTemplates([...preconfiguredCommandTemplates(), ...extras]);
}
