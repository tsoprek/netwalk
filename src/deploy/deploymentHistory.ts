export interface VmDeploymentRecord {
  id: string;
  jobId?: string;
  vmName: string;
  method: "preset" | "custom";
  status: string;
  message?: string | null;
  progress?: number | null;
  startedAt: string;
  updatedAt: string;
}

const HISTORY_KEY = "catwalk.vmDeploymentHistory.v1";
const ACTIVE_STATUSES = new Set(["submitting", "queued", "pending", "running"]);

export function deploymentIsActive(record: VmDeploymentRecord): boolean {
  return ACTIVE_STATUSES.has(record.status.trim().toLowerCase());
}

export function upsertDeploymentHistory(
  records: readonly VmDeploymentRecord[],
  record: VmDeploymentRecord,
): VmDeploymentRecord[] {
  return [record, ...records.filter((item) => item.id !== record.id)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 10);
}

export function loadDeploymentHistory(): VmDeploymentRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is VmDeploymentRecord => (
      item && typeof item.id === "string" && typeof item.vmName === "string"
      && typeof item.status === "string" && typeof item.startedAt === "string"
      && typeof item.updatedAt === "string"
    )).map((item) => deploymentIsActive(item) ? {
      ...item,
      status: "unknown",
      message: "ConneCat was restarted before the final job status was recorded.",
    } : item).slice(0, 10);
  } catch {
    return [];
  }
}

export function saveDeploymentHistory(records: readonly VmDeploymentRecord[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, 10)));
  } catch {
    // Deployment progress must not fail because browser storage is unavailable.
  }
}
