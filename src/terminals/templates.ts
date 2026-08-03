// Command templates for the terminal — predefined CLI snippets the user
// can paste into a live tab or broadcast to every member of a group.
// Each template carries a body with `{{variable}}` placeholders and a
// list of typed variables; the TemplatePicker UI prompts for any
// declared variable (using the default), then substitutes and sends.
//
// Bundled templates are the offline fallback. A server-managed catalog from
// CE-Apps can override matching IDs and append new templates.


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
  category: string;          // top-level grouping ("Cisco Switch", "Cisco Router")
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

const TE_VARS_COMMON: TemplateVar[] = [
  { key: "te_token", label: "ThousandEyes account token", default: "", secret: true,
    hint: "From the ThousandEyes UI → Cloud & Enterprise Agents → Agent Settings" },
  { key: "te_hostname", label: "Agent hostname", default: "te-agent-01",
    hint: "Shown in the ThousandEyes UI; must be unique" },
  { key: "dns_ip", label: "DNS server", default: "8.8.8.8" },
];

const TE_STATIC_VARS: TemplateVar[] = [
  { key: "te_ip", label: "Agent IPv4 address", default: "", hint: "Must be reachable from your network" },
  { key: "te_netmask", label: "Netmask", default: "255.255.255.0" },
  { key: "te_gateway", label: "Default gateway", default: "" },
];

const SWITCH_APP_GIG_VARS: TemplateVar[] = [
  { key: "appgig_intf", label: "AppGigabitEthernet interface", default: "AppGigabitEthernet1/0/1",
    hint: "Catalyst 9300/9400 expose AppGigabit; check `show interfaces app`" },
  { key: "vlan_id", label: "VLAN ID for agent", default: "100" },
];

// ───────────────────────── Cisco Switch ─────────────────────────────

const SWITCH_TE_MGMT: CommandTemplate = {
  id: "cisco-switch-te-mgmt",
  category: "Cisco Switch",
  subcategory: "App hosting",
  name: "ThousandEyes over management interface",
  description:
    "Enables IOx and runs the ThousandEyes Enterprise Agent docker app on the dedicated management interface (GigabitEthernet0/0 or equivalent).",
  variables: [...TE_VARS_COMMON],
  body: `configure terminal
iox
exit
app-hosting appid thousandeyes
 app-vnic management guest-interface 0
 app-resource docker
  prepend-pkg-opts
  run-opts 1 "-e TEAGENT_ACCOUNT_TOKEN={{te_token}}"
  run-opts 2 "--hostname={{te_hostname}}"
 name-server0 {{dns_ip}}
exit
app-hosting install appid thousandeyes package flash:thousandeyes.tar
app-hosting start appid thousandeyes
end
write memory
`,
};

const SWITCH_TE_APPGIG_DHCP: CommandTemplate = {
  id: "cisco-switch-te-appgig-dhcp",
  category: "Cisco Switch",
  subcategory: "App hosting",
  name: "ThousandEyes over AppGig (DHCP)",
  description:
    "Configures an AppGigabitEthernet trunk and runs the agent with a DHCP-assigned address inside the chosen VLAN.",
  variables: [...SWITCH_APP_GIG_VARS, ...TE_VARS_COMMON],
  body: `configure terminal
interface {{appgig_intf}}
 switchport mode trunk
 switchport trunk allowed vlan {{vlan_id}}
exit
iox
exit
app-hosting appid thousandeyes
 app-vnic AppGigabitEthernet trunk
  vlan {{vlan_id}} guest-interface 0
 app-resource docker
  prepend-pkg-opts
  run-opts 1 "-e TEAGENT_ACCOUNT_TOKEN={{te_token}}"
  run-opts 2 "--hostname={{te_hostname}}"
 name-server0 {{dns_ip}}
exit
app-hosting install appid thousandeyes package flash:thousandeyes.tar
app-hosting start appid thousandeyes
end
write memory
`,
};

const SWITCH_TE_APPGIG_STATIC: CommandTemplate = {
  id: "cisco-switch-te-appgig-static",
  category: "Cisco Switch",
  subcategory: "App hosting",
  name: "ThousandEyes over AppGig (Static IP)",
  description:
    "Configures an AppGigabitEthernet trunk and runs the agent with a static IPv4 address in the chosen VLAN.",
  variables: [...SWITCH_APP_GIG_VARS, ...TE_STATIC_VARS, ...TE_VARS_COMMON],
  body: `configure terminal
interface {{appgig_intf}}
 switchport mode trunk
 switchport trunk allowed vlan {{vlan_id}}
exit
iox
exit
app-hosting appid thousandeyes
 app-vnic AppGigabitEthernet trunk
  vlan {{vlan_id}} guest-interface 0
   guest-ipaddress {{te_ip}} netmask {{te_netmask}}
 app-default-gateway {{te_gateway}} guest-interface 0
 app-resource docker
  prepend-pkg-opts
  run-opts 1 "-e TEAGENT_ACCOUNT_TOKEN={{te_token}}"
  run-opts 2 "--hostname={{te_hostname}}"
 name-server0 {{dns_ip}}
exit
app-hosting install appid thousandeyes package flash:thousandeyes.tar
app-hosting start appid thousandeyes
end
write memory
`,
};

const SWITCH_SNMPV2: CommandTemplate = {
  id: "cisco-switch-snmpv2",
  category: "Cisco Switch",
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
  id: "cisco-switch-snmpv3",
  category: "Cisco Switch",
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

const SWITCH_NETFLOW_TE: CommandTemplate = {
  id: "cisco-switch-netflow-te",
  category: "Cisco Switch",
  name: "NetFlow export → ThousandEyes",
  description: "Flexible NetFlow record + exporter + per-interface monitor; default v9 to the TE collector IP.",
  variables: [
    { key: "collector_ip", label: "ThousandEyes collector IP", default: "" },
    { key: "collector_port", label: "Collector UDP port", default: "9995" },
    { key: "source_intf", label: "Exporter source interface", default: "Vlan1" },
    { key: "monitor_intf", label: "Interface(s) to monitor (comma-separated)", default: "GigabitEthernet1/0/1" },
    { key: "active_timeout", label: "Active timeout (s)", default: "60" },
    { key: "inactive_timeout", label: "Inactive timeout (s)", default: "15" },
  ],
  body: `configure terminal
flow record TE-FLOW
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
flow exporter TE-EXPORTER
 destination {{collector_ip}}
 source {{source_intf}}
 transport udp {{collector_port}}
 export-protocol netflow-v9
 template data timeout 60
exit
flow monitor TE-MONITOR
 record TE-FLOW
 exporter TE-EXPORTER
 cache timeout active {{active_timeout}}
 cache timeout inactive {{inactive_timeout}}
exit
! Apply to the interface(s) you want to monitor:
interface {{monitor_intf}}
 ip flow monitor TE-MONITOR input
 ip flow monitor TE-MONITOR output
end
write memory
`,
};

// ───────────────────────── Cisco Router ─────────────────────────────

const ROUTER_TE_MGMT: CommandTemplate = {
  id: "cisco-router-te-mgmt",
  category: "Cisco Router",
  subcategory: "App hosting",
  name: "ThousandEyes over management interface",
  description:
    "Enables IOx and runs the ThousandEyes Enterprise Agent docker app on the dedicated management interface (GigabitEthernet0).",
  variables: [...TE_VARS_COMMON],
  body: `configure terminal
iox
exit
app-hosting appid thousandeyes
 app-vnic management guest-interface 0
 app-resource docker
  prepend-pkg-opts
  run-opts 1 "-e TEAGENT_ACCOUNT_TOKEN={{te_token}}"
  run-opts 2 "--hostname={{te_hostname}}"
 name-server0 {{dns_ip}}
exit
app-hosting install appid thousandeyes package flash:thousandeyes.tar
app-hosting start appid thousandeyes
end
write memory
`,
};

const ROUTER_TE_VIRTUAL_NAT: CommandTemplate = {
  id: "cisco-router-te-vpg-nat",
  category: "Cisco Router",
  subcategory: "App hosting",
  name: "ThousandEyes over virtual port + NAT",
  description:
    "Runs the agent on a VirtualPortGroup tied to a private subnet, with NAT overload toward the WAN so the agent can reach the cloud.",
  variables: [
    { key: "vpg_id", label: "VirtualPortGroup id", default: "0" },
    { key: "vpg_ip", label: "VirtualPortGroup IPv4", default: "192.168.100.1" },
    { key: "vpg_netmask", label: "VPG netmask", default: "255.255.255.0" },
    { key: "te_ip", label: "Agent guest IPv4", default: "192.168.100.2" },
    { key: "te_netmask", label: "Agent netmask", default: "255.255.255.0" },
    { key: "wan_intf", label: "WAN egress interface (NAT outside)", default: "GigabitEthernet0/0/0" },
    ...TE_VARS_COMMON,
  ],
  body: `configure terminal
iox
exit
interface VirtualPortGroup{{vpg_id}}
 ip address {{vpg_ip}} {{vpg_netmask}}
 ip nat inside
exit
interface {{wan_intf}}
 ip nat outside
exit
ip access-list standard TE-NAT
 permit {{te_ip}}
exit
ip nat inside source list TE-NAT interface {{wan_intf}} overload
app-hosting appid thousandeyes
 app-vnic gateway1 virtualportgroup {{vpg_id}} guest-interface 0
  guest-ipaddress {{te_ip}} netmask {{te_netmask}}
 app-default-gateway {{vpg_ip}} guest-interface 0
 app-resource docker
  prepend-pkg-opts
  run-opts 1 "-e TEAGENT_ACCOUNT_TOKEN={{te_token}}"
  run-opts 2 "--hostname={{te_hostname}}"
 name-server0 {{dns_ip}}
exit
app-hosting install appid thousandeyes package flash:thousandeyes.tar
app-hosting start appid thousandeyes
end
write memory
`,
};

const ROUTER_SNMPV2: CommandTemplate = {
  id: "cisco-router-snmpv2",
  category: "Cisco Router",
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
  id: "cisco-router-snmpv3",
  category: "Cisco Router",
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

const ROUTER_NETFLOW_TE: CommandTemplate = {
  id: "cisco-router-netflow-te",
  category: "Cisco Router",
  name: "NetFlow export → ThousandEyes",
  description: "Flexible NetFlow record/exporter/monitor; default v9 to the TE collector IP.",
  variables: [
    { key: "collector_ip", label: "ThousandEyes collector IP", default: "" },
    { key: "collector_port", label: "Collector UDP port", default: "9995" },
    { key: "source_intf", label: "Exporter source interface", default: "Loopback0" },
    { key: "monitor_intf", label: "Interface(s) to monitor", default: "GigabitEthernet0/0/0" },
    { key: "active_timeout", label: "Active timeout (s)", default: "60" },
    { key: "inactive_timeout", label: "Inactive timeout (s)", default: "15" },
  ],
  body: `configure terminal
flow record TE-FLOW
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
flow exporter TE-EXPORTER
 destination {{collector_ip}}
 source {{source_intf}}
 transport udp {{collector_port}}
 export-protocol netflow-v9
 template data timeout 60
exit
flow monitor TE-MONITOR
 record TE-FLOW
 exporter TE-EXPORTER
 cache timeout active {{active_timeout}}
 cache timeout inactive {{inactive_timeout}}
exit
interface {{monitor_intf}}
 ip flow monitor TE-MONITOR input
 ip flow monitor TE-MONITOR output
end
write memory
`,
};

export const COMMAND_TEMPLATES: CommandTemplate[] = [
  SWITCH_TE_MGMT,
  SWITCH_TE_APPGIG_DHCP,
  SWITCH_TE_APPGIG_STATIC,
  SWITCH_SNMPV2,
  SWITCH_SNMPV3,
  SWITCH_NETFLOW_TE,
  ROUTER_TE_MGMT,
  ROUTER_TE_VIRTUAL_NAT,
  ROUTER_SNMPV2,
  ROUTER_SNMPV3,
  ROUTER_NETFLOW_TE,
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
