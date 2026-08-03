export type TerminalHealthState = "active" | "idle" | "exited";

export type TerminalHealthInput = {
  exited: boolean;
  connectedAt: number;
  lastOutputAt: number;
  lastInputAt: number;
  exitCode?: number;
};

export type TerminalHealth = {
  state: TerminalHealthState;
  label: string;
  detail: string;
};

function ageLabel(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function terminalSessionHealth(tab: TerminalHealthInput, now = Date.now()): TerminalHealth {
  if (tab.exited) {
    return {
      state: "exited",
      label: "Exited",
      detail: `Process exited${tab.exitCode == null ? "" : ` with code ${tab.exitCode}`}. Reconnect to start a new session.`,
    };
  }
  const lastActivityAt = Math.max(tab.connectedAt, tab.lastOutputAt, tab.lastInputAt);
  const silentFor = now - lastActivityAt;
  const state: TerminalHealthState = silentFor < 60_000 ? "active" : "idle";
  const label = state === "active" ? "Active" : "Idle";
  return {
    state,
    label,
    detail: `${label} session. Last output ${ageLabel(tab.lastOutputAt, now)}; last input ${ageLabel(tab.lastInputAt, now)}.`,
  };
}
