import type { SharedUserTemplate } from "./userTemplates";

const EMPTY: SharedUserTemplate[] = [];

export function listSharedTemplates(): SharedUserTemplate[] { return EMPTY; }
export async function refreshSharedTemplates(): Promise<SharedUserTemplate[]> { return EMPTY; }
export function subscribeSharedTemplates(_listener: () => void): () => void { return () => {}; }
