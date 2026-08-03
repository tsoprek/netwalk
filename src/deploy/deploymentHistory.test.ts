import { describe, expect, it } from "vitest";
import {
  deploymentIsActive,
  type VmDeploymentRecord,
  upsertDeploymentHistory,
} from "./deploymentHistory";

function record(id: number, status = "succeeded"): VmDeploymentRecord {
  return {
    id: String(id),
    vmName: `vm-${id}`,
    method: "preset",
    status,
    startedAt: new Date(id * 1000).toISOString(),
    updatedAt: new Date(id * 1000).toISOString(),
  };
}

describe("VM deployment history", () => {
  it("keeps the newest ten unique records", () => {
    let history: VmDeploymentRecord[] = [];
    for (let index = 1; index <= 12; index += 1) {
      history = upsertDeploymentHistory(history, record(index));
    }
    expect(history.map((item) => item.id)).toEqual(["12", "11", "10", "9", "8", "7", "6", "5", "4", "3"]);
  });

  it("recognizes statuses that still represent an active deployment", () => {
    expect(deploymentIsActive(record(1, "submitting"))).toBe(true);
    expect(deploymentIsActive(record(1, "running"))).toBe(true);
    expect(deploymentIsActive(record(1, "succeeded"))).toBe(false);
    expect(deploymentIsActive(record(1, "failed"))).toBe(false);
  });
});
