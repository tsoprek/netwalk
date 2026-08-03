
export type RemoteAccessUsageKind =
  | "rdp_lab"
  | "vm_console"
  | "cml_console"
  | "browser";

const CONTEXT = {
  rdp_lab: {
    component_id: "catwalk.rdp",
    feature_id: "rdp",
    metadata: { protocol: "guacamole-rdp" },
  },
  vm_console: {
    component_id: "catwalk.console",
    feature_id: "console",
    metadata: { protocol: "webmks", device_kind: "vm" },
  },
  cml_console: {
    component_id: "catwalk.cml",
    feature_id: "cml",
    metadata: { protocol: "cml-console", device_kind: "cml" },
  },
  browser: {
    component_id: "catwalk.browser",
    feature_id: "browser",
    metadata: { protocol: "browser" },
  },
} as const;

export function trackRemoteAccessUsage(
  kind: RemoteAccessUsageKind,
  actionId: "connection.start" | "connection.success" | "connection.failure" | "connection.end",
  outcome: "started" | "success" | "failure",
  durationSeconds?: number,
): void {
  void kind;
  void actionId;
  void outcome;
  void durationSeconds;
}
