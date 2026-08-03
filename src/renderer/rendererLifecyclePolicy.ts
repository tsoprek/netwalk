import type { RendererBlocker } from "../api/rendererLifecycle";

export interface FrontendRendererState {
  terminalTabs: number;
  consoleTabs: number;
  deploymentBusy: boolean;
  activeDeployments: number;
  deploymentDialogs: boolean;
  settingsDirty: boolean;
  dialogOpen: boolean;
}

function active(code: string, count: number, label: string): RendererBlocker {
  return {
    code,
    count,
    message: count === 1 ? `1 ${label} is active` : `${count} ${label}s are active`,
  };
}

export function frontendRendererBlockers(state: FrontendRendererState): RendererBlocker[] {
  const blockers: RendererBlocker[] = [];
  if (state.terminalTabs > 0) blockers.push(active("terminal_tabs", state.terminalTabs, "terminal tab"));
  if (state.consoleTabs > 0) blockers.push(active("remote_tabs", state.consoleTabs, "remote console or SFTP tab"));
  if (state.deploymentBusy || state.activeDeployments > 0) {
    blockers.push(active("deployments", Math.max(1, state.activeDeployments), "deployment"));
  }
  if (state.deploymentDialogs) blockers.push(active("deployment_dialog", 1, "deployment dialog"));
  if (state.settingsDirty) blockers.push(active("settings_dirty", 1, "unsaved Settings change"));
  if (state.dialogOpen) blockers.push(active("open_dialog", 1, "dialog"));
  return blockers;
}

export interface AutoRendererResetState {
  enabled: boolean;
  backgroundForMs: number;
  route: string;
  churnScore: number;
  rateLimited: boolean;
  blockerCount: number;
}

const AUTOMATIC_RENDERER_RESET_ROUTES = new Set([
  "/connections",
  "/sessions",
  "/remote-access",
  "/identities",
  "/settings",
  "/templates",
  "/notes",
]);

export function automaticRendererResetRoute(route: string): boolean {
  return AUTOMATIC_RENDERER_RESET_ROUTES.has(route);
}

export function automaticRendererResetEligible(state: AutoRendererResetState): boolean {
  return state.enabled
    && state.backgroundForMs >= 5 * 60_000
    && automaticRendererResetRoute(state.route)
    && state.churnScore >= 8
    && !state.rateLimited
    && state.blockerCount === 0;
}
