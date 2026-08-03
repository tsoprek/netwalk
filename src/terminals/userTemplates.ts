// User-defined command templates persisted to localStorage. Same shape
// as the built-in CommandTemplate so the picker and menu layer don't
// need to special-case them — except every user template lives under
// the synthetic "My templates" category so the user can find and
// manage them easily.

import type { CommandTemplate, TemplateVar } from "./templates";

export const USER_TEMPLATES_KEY = "connecat.userTemplates";
export const USER_TEMPLATE_GROUPS_KEY = "connecat.templateGroups";
export const USER_TEMPLATE_CATEGORY = "My templates";

export interface TemplateSharing {
  scope: "private" | "everyone" | "users";
  users: string[];
}

export interface UserTemplate extends CommandTemplate {
  /// Wall-clock created/updated timestamps (ISO). Purely informational;
  /// used to sort the manager list newest-first.
  createdAt: string;
  updatedAt: string;
  sharing?: TemplateSharing;
}

export interface SharedUserTemplate extends UserTemplate {
  owner: string;
}

export function normalizeTemplateSharing(value: unknown): TemplateSharing {
  if (!value || typeof value !== "object") return { scope: "private", users: [] };
  const raw = value as Partial<TemplateSharing>;
  const scope = raw.scope === "everyone" || raw.scope === "users" ? raw.scope : "private";
  const users = scope === "users" && Array.isArray(raw.users)
    ? [...new Set(raw.users.map((user) => String(user).trim().toLowerCase()).filter(Boolean))]
    : [];
  return { scope, users };
}

function safeParse(raw: string | null): UserTemplate[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((t): t is UserTemplate =>
      t && typeof t.id === "string" && typeof t.name === "string" && typeof t.body === "string",
    );
  } catch {
    return [];
  }
}

export function listUserTemplates(): UserTemplate[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(USER_TEMPLATES_KEY)).map((template) => ({
    ...template,
    sharing: normalizeTemplateSharing(template.sharing),
  }));
}

function writeAll(items: UserTemplate[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(items));
}

function storedGroups(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(USER_TEMPLATE_GROUPS_KEY) || "[]");
    return Array.isArray(value)
      ? value.map((name) => String(name).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function writeGroups(groups: string[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(USER_TEMPLATE_GROUPS_KEY, JSON.stringify(groups));
}

function groupKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function listUserTemplateGroups(): string[] {
  const groups: string[] = [];
  const seen = new Set<string>();
  const add = (rawName: string) => {
    const name = rawName.trim();
    const key = groupKey(name);
    if (!name || seen.has(key)) return;
    seen.add(key);
    groups.push(name);
  };

  storedGroups().forEach(add);
  const discovered: string[] = [];
  for (const template of listUserTemplates()) {
    const name = template.subcategory?.trim() ?? "";
    const key = groupKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    discovered.push(name);
  }
  discovered.sort((a, b) => a.localeCompare(b));
  return [...groups, ...discovered];
}

export function saveUserTemplateGroup(rawName: string): string {
  const name = rawName.trim();
  if (!name) throw new Error("Group name is required.");
  const groups = listUserTemplateGroups();
  const existing = groups.find((group) => group.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  writeGroups([...groups, name]);
  return name;
}

export function renameUserTemplateGroup(currentName: string, rawName: string): string {
  const name = rawName.trim();
  if (!name) throw new Error("Group name is required.");
  const groups = listUserTemplateGroups();
  const currentKey = groupKey(currentName);
  const nextKey = groupKey(name);
  if (groups.some((group) => groupKey(group) !== currentKey && groupKey(group) === nextKey)) {
    throw new Error("A template group with that name already exists.");
  }
  writeGroups(groups.map((group) => groupKey(group) === currentKey ? name : group));
  const now = new Date().toISOString();
  writeAll(listUserTemplates().map((template) => groupKey(template.subcategory ?? "") === currentKey
    ? { ...template, subcategory: name, updatedAt: now }
    : template));
  return name;
}

export function deleteUserTemplateGroup(name: string): void {
  const key = groupKey(name);
  writeGroups(listUserTemplateGroups().filter((group) => groupKey(group) !== key));
  const now = new Date().toISOString();
  writeAll(listUserTemplates().map((template) => groupKey(template.subcategory ?? "") === key
    ? { ...template, subcategory: undefined, updatedAt: now }
    : template));
}

export function setUserTemplateGroupSharing(name: string, sharing: TemplateSharing): UserTemplate[] {
  const key = groupKey(name);
  const normalized = normalizeTemplateSharing(sharing);
  const now = new Date().toISOString();
  const items = listUserTemplates();
  let changed = false;
  const updated = items.map((template) => {
    if (groupKey(template.subcategory ?? "") !== key) return template;
    changed = true;
    return { ...template, sharing: normalized, updatedAt: now };
  });
  if (!changed) throw new Error("This group has no templates to share.");
  writeAll(updated);
  return updated.filter((template) => groupKey(template.subcategory ?? "") === key);
}

function newId(): string {
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UserTemplateInput {
  id?: string;
  name: string;
  subcategory?: string;
  description?: string;
  body: string;
  variables?: TemplateVar[];
  lineDelayMs?: number;
  sharing?: TemplateSharing;
}

export function saveUserTemplate(input: UserTemplateInput): UserTemplate {
  const now = new Date().toISOString();
  const items = listUserTemplates();
  const existingIdx = input.id ? items.findIndex((t) => t.id === input.id) : -1;
  const requestedGroup = input.subcategory?.trim() ?? "";
  const canonicalGroup = requestedGroup
    ? listUserTemplateGroups().find((group) => groupKey(group) === groupKey(requestedGroup)) ?? requestedGroup
    : "";
  const base: UserTemplate = {
    id: input.id ?? newId(),
    category: USER_TEMPLATE_CATEGORY,
    subcategory: canonicalGroup || undefined,
    name: input.name.trim() || "Untitled template",
    description: input.description?.trim() || undefined,
    body: input.body,
    variables: input.variables && input.variables.length > 0 ? input.variables : undefined,
    lineDelayMs: input.lineDelayMs,
    createdAt: existingIdx >= 0 ? items[existingIdx].createdAt : now,
    updatedAt: now,
    sharing: normalizeTemplateSharing(input.sharing ?? (existingIdx >= 0 ? items[existingIdx].sharing : undefined)),
  };
  if (existingIdx >= 0) items[existingIdx] = base;
  else items.unshift(base);
  writeAll(items);
  if (base.subcategory) saveUserTemplateGroup(base.subcategory);
  return base;
}

export function deleteUserTemplate(id: string): void {
  const items = listUserTemplates().filter((t) => t.id !== id);
  writeAll(items);
}

export type TemplateDropPlacement = "before" | "after";

export function reorderUserTemplateGroups(
  draggedGroup: string,
  targetGroup: string,
  placement: TemplateDropPlacement,
): void {
  const groups = listUserTemplateGroups();
  const draggedKey = groupKey(draggedGroup);
  const targetKey = groupKey(targetGroup);
  if (!draggedKey || draggedKey === targetKey) return;
  const draggedIndex = groups.findIndex((group) => groupKey(group) === draggedKey);
  if (draggedIndex < 0 || !groups.some((group) => groupKey(group) === targetKey)) return;
  const next = [...groups];
  const [dragged] = next.splice(draggedIndex, 1);
  const targetIndex = next.findIndex((group) => groupKey(group) === targetKey);
  next.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, dragged);
  writeGroups(next);
}

export function moveUserTemplate(
  draggedId: string,
  targetGroup: string,
  targetId?: string,
  placement: TemplateDropPlacement = "after",
): void {
  const items = listUserTemplates();
  const draggedIndex = items.findIndex((template) => template.id === draggedId);
  if (draggedIndex < 0 || targetId === draggedId) return;
  const canonicalGroup = targetGroup.trim()
    ? listUserTemplateGroups().find((group) => groupKey(group) === groupKey(targetGroup)) ?? targetGroup.trim()
    : "";
  const next = [...items];
  const [dragged] = next.splice(draggedIndex, 1);
  const moved = { ...dragged, subcategory: canonicalGroup || undefined };
  if (targetId) {
    const targetIndex = next.findIndex((template) => template.id === targetId);
    if (targetIndex >= 0) {
      next.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, moved);
      writeAll(next);
      if (canonicalGroup) saveUserTemplateGroup(canonicalGroup);
      return;
    }
  }
  let insertionIndex = next.length;
  for (let index = next.length - 1; index >= 0; index--) {
    if (groupKey(next[index].subcategory ?? "") === groupKey(canonicalGroup)) {
      insertionIndex = index + 1;
      break;
    }
  }
  next.splice(insertionIndex, 0, moved);
  writeAll(next);
  if (canonicalGroup) saveUserTemplateGroup(canonicalGroup);
}

/// Scan the body for `{{key}}` placeholders and return them in
/// first-seen order. Used by the editor to auto-derive variables from
/// what the user typed.
export function detectVariables(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}
