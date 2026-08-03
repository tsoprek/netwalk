import { describe, expect, it } from "vitest";
import {
  automaticRendererResetEligible,
  automaticRendererResetRoute,
  frontendRendererBlockers,
} from "./rendererLifecyclePolicy";

describe("renderer lifecycle policy", () => {
  it("reports all session, deployment, dialog, and dirty Settings blockers", () => {
    const blockers = frontendRendererBlockers({
      terminalTabs: 2,
      consoleTabs: 1,
      deploymentBusy: true,
      activeDeployments: 3,
      deploymentDialogs: true,
      settingsDirty: true,
      dialogOpen: true,
    });
    expect(blockers.map((item) => item.code)).toEqual([
      "terminal_tabs",
      "remote_tabs",
      "deployments",
      "deployment_dialog",
      "settings_dirty",
      "open_dialog",
    ]);
  });

  it("allows automatic recovery only under every exact condition", () => {
    const ready = {
      enabled: true,
      backgroundForMs: 300_000,
      route: "/connections",
      churnScore: 8,
      rateLimited: false,
      blockerCount: 0,
    };
    expect(automaticRendererResetEligible(ready)).toBe(true);
    for (const route of ["/connections", "/sessions", "/remote-access", "/templates", "/notes", "/identities", "/settings"]) {
      expect(automaticRendererResetRoute(route)).toBe(true);
      expect(automaticRendererResetEligible({ ...ready, route })).toBe(true);
    }
    expect(automaticRendererResetEligible({ ...ready, route: "/devices" })).toBe(false);
    expect(automaticRendererResetEligible({ ...ready, backgroundForMs: 299_999 })).toBe(false);
    expect(automaticRendererResetEligible({ ...ready, churnScore: 7 })).toBe(false);
    expect(automaticRendererResetEligible({ ...ready, rateLimited: true })).toBe(false);
    expect(automaticRendererResetEligible({ ...ready, blockerCount: 1 })).toBe(false);
  });
});
