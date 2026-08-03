import type { ConsoleTab } from "./ConsolesContextCore";

export type ConsoleHealthState = "active" | "idle" | "exited";

export interface ConsoleSessionHealth {
  state: ConsoleHealthState;
  label: string;
  detail: string;
}

export function consoleSessionHealth(tab: Pick<ConsoleTab, "status" | "error" | "disconnected">): ConsoleSessionHealth {
  if (tab.disconnected || tab.error) {
    return {
      state: "exited",
      label: "Disconnected",
      detail: tab.error || tab.status || "Session disconnected.",
    };
  }
  if (/^connected(?:\.|\s|$)/i.test(tab.status)) {
    return {
      state: "active",
      label: "Connected",
      detail: tab.status || "Session connected.",
    };
  }
  return {
    state: "idle",
    label: "Connecting",
    detail: tab.status || "Waiting to connect.",
  };
}
