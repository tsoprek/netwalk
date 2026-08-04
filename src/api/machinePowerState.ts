export type MachinePowerState = "on" | "off" | "suspended";

/// Normalize the state spellings emitted by vCenter, AutoPilot's cached
/// inventory, and CML so every ConnCat view renders the same power status.
export function machinePowerState(state?: string | null): MachinePowerState | null {
  const normalized = String(state ?? "").trim().toUpperCase();
  if (["POWERED_ON", "ON", "BOOTED", "STARTED", "RUNNING"].includes(normalized)) return "on";
  if (["POWERED_OFF", "OFF", "STOPPED"].includes(normalized)) return "off";
  if (["SUSPENDED", "PAUSED"].includes(normalized)) return "suspended";
  return null;
}
