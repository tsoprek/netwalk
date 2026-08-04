//! Identities (connection users) — Phase 0 foundation.
//!
//! Three concepts: Identity (a known username), Scope (what an assignment
//! attaches to), Assignment (ordered identities for a scope). A `current-
//! user` identity is built-in, non-deletable, and resolves at connect time
//! to the logged-in ConnCat user (`getUsername()`).
//!
//! Phase 0 deliverables:
//!   - Types + localStorage layer.
//!   - `effectiveUsernames(deviceId, fallback)` resolver.
//!   - Migration from legacy `catwalk.deviceUser.*` per-device overrides.
//!   - No UI yet; existing connect callsites route through this module.
//!
//! Storage layout (all local, never synced in Phase 0):
//!   catwalk.identities.v1.identities     -> Identity[]
//!   catwalk.identities.v1.groups         -> Group[]
//!   catwalk.identities.v1.assignments    -> Assignment[]
//!   catwalk.identities.v1.lastUsed       -> { [deviceId]: identityId }
//!   catwalk.identities.v1.migrated       -> "1" once legacy migration ran

// ---------------------------------------------------------------------------
// Public types

/** A username we know about. `current-user` resolves at connect time; only
 *  `literal` identities carry an explicit username string. */
export interface Identity {
  id: string;
  kind: "current-user" | "literal";
  username?: string;
  label?: string;
  source: "manual" | "server";
  serverRef?: string;
  createdAt: number;
}

/** A thing an assignment can attach to. */
export type Scope =
  | { kind: "global" }
  | { kind: "group"; groupId: string }
  | { kind: "device"; deviceId: string }
  | { kind: "session"; sessionId: string };

/** Ordered identities for a scope. priority 0 = primary; rest are alternates. */
export interface Assignment {
  scope: Scope;
  identities: { identityId: string; priority: number }[];
  source: "admin" | "self";
  pushedAt?: number;
}

/** A named bundle of devices. Phase 2 lights up; Phase 0 just defines the
 *  shape so callers don't break when groups are introduced. */
export interface Group {
  id: string;
  name: string;
  source: "server" | "user";
  memberQuery:
    | { kind: "static"; deviceIds: string[] }
    | { kind: "all" }
    | { kind: "folder"; folderName: string }
    | { kind: "tag"; tag: string }
    | { kind: "autopilot-preset"; presetId: string };
  /** `pinned`: priority order is fixed. `any-of-pool`: per-device last-used
   *  wins over priority. */
  mode: "pinned" | "any-of-pool";
}

// ---------------------------------------------------------------------------
// Storage primitives

const NS = "catwalk.identities.v1";
const KEY_IDENTITIES = `${NS}.identities`;
const KEY_GROUPS = `${NS}.groups`;
const KEY_ASSIGNMENTS = `${NS}.assignments`;
const KEY_LAST_USED = `${NS}.lastUsed`;
const KEY_MIGRATED = `${NS}.migrated`;
const LEGACY_DEVICE_USER_PREFIX = "catwalk.deviceUser.";

const CURRENT_USER_ID = "__current_user__";
const CHANGE_EVENT = "catwalk:identities-changed";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota — silently drop; callers shouldn't crash on storage failures.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function newId(): string {
  // Crypto-grade IDs aren't required; we just need uniqueness within a
  // single browser profile. Math.random + base36 + timestamp suffix is
  // plenty for that.
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

// ---------------------------------------------------------------------------
// Built-in current-user identity (always present, non-deletable)

function builtInCurrentUser(): Identity {
  return {
    id: CURRENT_USER_ID,
    kind: "current-user",
    source: "manual",
    createdAt: 0,
    label: "Current ConnCat user",
  };
}

// ---------------------------------------------------------------------------
// Public accessors (Phase 0: read-only is enough for the resolver; mutators
// are provided so tests and Phase 1 UI can drive state).

export function listIdentities(): Identity[] {
  const stored = readJson<Identity[]>(KEY_IDENTITIES, []);
  // current-user is conceptually always present, so the rest of the system
  // can reference it by id without worrying about absence.
  if (!stored.find((i) => i.id === CURRENT_USER_ID)) {
    return [builtInCurrentUser(), ...stored];
  }
  return stored;
}

export function listAssignments(): Assignment[] {
  return readJson<Assignment[]>(KEY_ASSIGNMENTS, []);
}

export function listGroups(): Group[] {
  return readJson<Group[]>(KEY_GROUPS, []);
}

export function getCurrentUserIdentityId(): string {
  return CURRENT_USER_ID;
}

/** Subscribe to any change in the identities store. Returns an unsubscriber. */
export function subscribeIdentities(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

// ---------------------------------------------------------------------------
// Mutators (kept minimal in Phase 0; full CRUD UI lands in Phase 1)

export function addIdentity(
  partial: Omit<Identity, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Identity {
  const all = listIdentities().filter((i) => i.id !== CURRENT_USER_ID);
  const ident: Identity = {
    id: partial.id ?? newId(),
    createdAt: partial.createdAt ?? Date.now(),
    ...partial,
  };
  all.push(ident);
  writeJson(KEY_IDENTITIES, all);
  return ident;
}

export function removeIdentity(id: string): void {
  if (id === CURRENT_USER_ID) return; // non-deletable
  const remaining = listIdentities().filter(
    (i) => i.id !== id && i.id !== CURRENT_USER_ID,
  );
  writeJson(KEY_IDENTITIES, remaining);
  // Also strip from any assignments so we don't dangle.
  const trimmed = listAssignments()
    .map((a) => ({
      ...a,
      identities: a.identities.filter((entry) => entry.identityId !== id),
    }))
    .filter((a) => a.identities.length > 0);
  writeJson(KEY_ASSIGNMENTS, trimmed);
}

/** In-place edit of a literal identity. The built-in current-user identity
 *  is immutable. Username dedupe is the caller's job (the page UI checks).
 *  Assignments referencing this id are not touched — they continue to
 *  resolve to the (now updated) username at connect time. */
export function updateIdentity(
  id: string,
  patch: Partial<Pick<Identity, "username" | "label">>,
): void {
  if (id === CURRENT_USER_ID) return;
  const all = listIdentities().filter((i) => i.id !== CURRENT_USER_ID);
  const idx = all.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const cur = all[idx];
  if (cur.kind !== "literal") return; // only literal identities are editable
  all[idx] = {
    ...cur,
    ...(patch.username !== undefined ? { username: patch.username.trim() } : {}),
    ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
  };
  writeJson(KEY_IDENTITIES, all);
}

/** Count how many assignments reference a given identity. Used by the
 *  Identities page to warn before deletion. */
export function countIdentityUsage(id: string): number {
  let n = 0;
  for (const a of listAssignments()) {
    if (a.identities.some((e) => e.identityId === id)) n += 1;
  }
  return n;
}

export function upsertAssignment(assignment: Assignment): void {
  const all = listAssignments().filter((a) => !sameScope(a.scope, assignment.scope));
  if (assignment.identities.length > 0) all.push(assignment);
  writeJson(KEY_ASSIGNMENTS, all);
}

export function removeAssignment(scope: Scope): void {
  const remaining = listAssignments().filter((a) => !sameScope(a.scope, scope));
  writeJson(KEY_ASSIGNMENTS, remaining);
}

// ---------------------------------------------------------------------------
// Group CRUD (Phase 2). Only `user`-sourced groups are mutable via these
// helpers — `server` groups arrive via the Phase 3 sync endpoint and are
// reconciled separately. Groups must always have at least one identity
// assignment (managed via `upsertAssignment` with `{kind:'group',groupId}`)
// to actually contribute to the resolver, but the group row itself can
// exist with zero assignments.

export function addGroup(
  partial: Omit<Group, "id"> & { id?: string },
): Group {
  const group: Group = {
    id: partial.id ?? newId(),
    name: partial.name,
    source: partial.source,
    memberQuery: partial.memberQuery,
    mode: partial.mode,
  };
  const all = listGroups();
  all.push(group);
  writeJson(KEY_GROUPS, all);
  return group;
}

export function updateGroup(
  id: string,
  patch: Partial<Pick<Group, "name" | "memberQuery" | "mode">>,
): void {
  const all = listGroups();
  const idx = all.findIndex((g) => g.id === id);
  if (idx < 0) return;
  if (all[idx].source !== "user") return; // server groups are read-only
  all[idx] = {
    ...all[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.memberQuery !== undefined ? { memberQuery: patch.memberQuery } : {}),
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
  };
  writeJson(KEY_GROUPS, all);
}

export function removeGroup(id: string): void {
  const all = listGroups();
  const target = all.find((g) => g.id === id);
  if (!target || target.source !== "user") return; // server groups are read-only
  writeJson(KEY_GROUPS, all.filter((g) => g.id !== id));
  // Drop any user-sourced assignment that targeted this group. Server-
  // sourced assignments (kind:'group') are also dropped because the group
  // itself is gone — defensive cleanup so the resolver never references a
  // dangling group id.
  const remainingAssignments = listAssignments().filter(
    (a) => !(a.scope.kind === "group" && a.scope.groupId === id),
  );
  writeJson(KEY_ASSIGNMENTS, remainingAssignments);
}

/** Read the group-scope Assignment for a given group id, or null if none.
 *  Used by the group editor to seed its identity-list state. */
export function getGroupAssignment(groupId: string): Assignment | null {
  return (
    listAssignments().find(
      (a) => a.scope.kind === "group" && a.scope.groupId === groupId,
    ) ?? null
  );
}

/** Convenience: list the device ids referenced by a static-member group.
 *  Returns [] for non-static queries (Phase 2 only ships static). */
export function getGroupDeviceIds(group: Group): string[] {
  if (group.memberQuery.kind === "static") return [...group.memberQuery.deviceIds];
  return [];
}

/** Infer which identity groups currently contain this device. */
export function groupsForDevice(deviceId: string | number): Group[] {
  const deviceKey = String(deviceId);
  return listGroups().filter((g) => {
    if (g.memberQuery.kind === "static") {
      return g.memberQuery.deviceIds.includes(deviceKey);
    }
    if (g.memberQuery.kind === "all") {
      return true;
    }
    return false; // folder/tag/autopilot-preset land in a later phase
  });
}

// ---------------------------------------------------------------------------
// Bridge helpers for legacy `getDeviceUsername`/`setDeviceUsername` callers
// (DeviceSettingsPanel, "Open SSH as <history>" menu items). These keep
// Phase 1 UI work decoupled from Phase 0 plumbing: any code that already
// thinks in terms of "the primary literal username for this device" can
// keep using broker.ts, and we just back it onto the identities store.

/** Read the device-scope Assignment for a device, or null if none. Used by
 *  the per-device identities picker in DeviceSettingsPanel to seed its
 *  initial state. */
export function getDeviceAssignment(deviceId: string | number): Assignment | null {
  const a = listAssignments().find(
    (x) => x.scope.kind === "device" && x.scope.deviceId === String(deviceId),
  );
  return a ?? null;
}

/** Read the session-scope assignment for a saved connection. */
export function getSessionAssignment(sessionId: string): Assignment | null {
  return listAssignments().find(
    (x) => x.scope.kind === "session" && x.scope.sessionId === sessionId,
  ) ?? null;
}

/** Resolve the effective primary username for a saved Connection.
 *
 * Connection-specific and global identity assignments are resolved at launch
 * time so identity edits take effect without rewriting every saved
 * Connection. An existing SavedSession username remains the compatibility
 * fallback; the current ConnCat user is used only when no saved username or
 * usable assignment exists. */
export function getSessionPrimaryUsername(
  sessionId: string,
  fallbackUsername: string,
  currentUser?: string | null,
): string {
  const identities = listIdentities();
  const assignments = listAssignments();
  const context = currentUser === undefined ? undefined : { currentUser };
  const scopedAssignments = [
    assignments.find(
      (assignment) => assignment.scope.kind === "session" && assignment.scope.sessionId === sessionId,
    ),
    assignments.find((assignment) => assignment.scope.kind === "global"),
  ];

  for (const assignment of scopedAssignments) {
    if (!assignment) continue;
    for (const entry of [...assignment.identities].sort((a, b) => a.priority - b.priority)) {
      const identity = identities.find((candidate) => candidate.id === entry.identityId);
      if (!identity) continue;
      const username = expandUsername(identity, context)?.trim() ?? "";
      if (username) return username;
    }
  }

  const fallback = fallbackUsername.trim();
  return fallback || getActiveCurrentUsername(context) || "";
}

/** Read the primary literal username for a device-scope assignment, or null
 *  if the device has no device-scope assignment (or its primary is the
 *  current-user identity, which is a different concept). */
export function getDeviceScopePrimaryLiteral(deviceId: string | number): string | null {
  const a = getDeviceAssignment(deviceId);
  if (!a) return null;
  const primary = [...a.identities].sort((x, y) => x.priority - y.priority)[0];
  if (!primary) return null;
  const ident = listIdentities().find((i) => i.id === primary.identityId);
  if (!ident || ident.kind !== "literal") return null;
  return (ident.username ?? "").trim() || null;
}

/** Find a literal identity by exact username match (trimmed), or null. */
export function findIdentityByUsername(username: string): Identity | null {
  const u = (username ?? "").trim();
  if (!u) return null;
  return (
    listIdentities().find((i) => i.kind === "literal" && (i.username ?? "") === u) ??
    null
  );
}

/** Set the device-scope primary literal username, creating/reusing an
 *  Identity row keyed by username. Empty string removes the assignment.
 *  Source is recorded as 'self' since this comes from user UI. */
export function setDeviceScopePrimaryLiteral(
  deviceId: string | number,
  username: string,
): void {
  const trimmed = (username ?? "").trim();
  if (!trimmed) {
    removeAssignment({ kind: "device", deviceId: String(deviceId) });
    return;
  }
  const identities = listIdentities();
  let ident = identities.find(
    (i) => i.kind === "literal" && (i.username ?? "") === trimmed,
  );
  if (!ident) {
    ident = addIdentity({
      kind: "literal",
      username: trimmed,
      source: "manual",
    });
  }
  upsertAssignment({
    scope: { kind: "device", deviceId: String(deviceId) },
    identities: [{ identityId: ident.id, priority: 0 }],
    source: "self",
  });
}

function sameScope(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "global" && b.kind === "global") return true;
  if (a.kind === "device" && b.kind === "device") return a.deviceId === b.deviceId;
  if (a.kind === "session" && b.kind === "session") return a.sessionId === b.sessionId;
  if (a.kind === "group" && b.kind === "group") return a.groupId === b.groupId;
  return false;
}

// ---------------------------------------------------------------------------
// Last-used memory (any-of-pool support; lit up in Phase 2 but trivial here)

export function getLastUsedIdentityId(deviceId: string | number): string | null {
  const map = readJson<Record<string, string>>(KEY_LAST_USED, {});
  return map[String(deviceId)] ?? null;
}

export function recordLastUsedIdentity(
  deviceId: string | number,
  identityId: string,
): void {
  const map = readJson<Record<string, string>>(KEY_LAST_USED, {});
  map[String(deviceId)] = identityId;
  writeJson(KEY_LAST_USED, map);
}

// ---------------------------------------------------------------------------
// Resolver — THE one nontrivial bit of this module
//
// Given a device (and optional session), return the ordered list of
// identities that should be offered for connection. Element 0 is the
// primary (used by "Open SSH"); the rest populate the `▾` dropdown.
//
// Priority of scopes (highest to lowest): session, device, group, server
// device default, global. The server default must beat the generic global
// current-user assignment or CE-Infra VM usernames would never take effect.
// `any-of-pool` groups: last-used identity for this device is promoted to
// the front of that group's contribution.
//
// Dedupe is by resolved username string after expanding `current-user` so
// we don't show the same effective user twice when, e.g., the user added
// a literal identity matching their current login.

export interface ResolveContext {
  /** When provided, session-scoped assignments override device-scoped ones. */
  sessionId?: string;
  /** When provided, groups that contain this device contribute. */
  groupMembership?: Group[];
  /** Override `getUsername()` lookup (for tests + deterministic call sites). */
  currentUser?: string | null;
  /** Server-managed default login for this device. Explicit session,
   * device, and group assignments take precedence; it wins over global. */
  serverDefaultUsername?: string | null;
}

export interface ResolvedIdentity {
  identity: Identity;
  /** Final username string after expanding `current-user`. */
  username: string;
  /** Where this identity originated, for UI provenance display. */
  via: "session" | "device" | "group" | "global" | "default";
  groupId?: string;
}

function getActiveCurrentUsername(ctx?: ResolveContext): string | null {
  if (ctx && "currentUser" in ctx) return ctx.currentUser ?? null;
  // Mirrors broker.ts USERNAME_KEY. Read directly to avoid an import cycle.
  try {
    const raw = localStorage.getItem("catwalk.username");
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

function expandUsername(ident: Identity, ctx?: ResolveContext): string | null {
  if (ident.kind === "current-user") {
    return getActiveCurrentUsername(ctx);
  }
  const u = (ident.username ?? "").trim();
  return u || null;
}

function lookupIdentity(id: string, identities: Identity[]): Identity | null {
  return identities.find((i) => i.id === id) ?? null;
}

/** Ordered ResolvedIdentity list for the given device.
 *
 *  Guarantees:
 *    - Always returns at least one entry. If nothing is configured the
 *      fallback is the `current-user` identity (or, if even that has no
 *      resolved username, a synthetic literal identity wrapping
 *      `fallbackUsername`).
 *    - Element 0 is what `getPrimaryUsername()` returns. */
export function resolveIdentities(
  deviceId: string | number,
  fallbackUsername: string,
  ctx: ResolveContext = {},
): ResolvedIdentity[] {
  const identities = listIdentities();
  const assignments = listAssignments();
  const deviceKey = String(deviceId);

  // Collect contributions per scope tier, highest-priority tier first.
  const tiers: ResolvedIdentity[][] = [];

  // 1. Session scope (only if session id supplied).
  if (ctx.sessionId) {
    const a = assignments.find(
      (x) => x.scope.kind === "session" && x.scope.sessionId === ctx.sessionId,
    );
    if (a) tiers.push(materialize(a, identities, "session", ctx));
  }

  // 2. Device scope.
  {
    const a = assignments.find(
      (x) => x.scope.kind === "device" && x.scope.deviceId === deviceKey,
    );
    if (a) tiers.push(materialize(a, identities, "device", ctx));
  }

  // 3. Groups containing this device. User-source groups win over server-
  //    source groups (ties broken by source). Within a tier, members are
  //    ordered by priority; any-of-pool promotes last-used to front.
  const groups = ctx.groupMembership ?? [];
  const lastUsedId = getLastUsedIdentityId(deviceKey);
  const orderedGroups = [...groups].sort((a, b) => {
    if (a.source === b.source) return 0;
    return a.source === "user" ? -1 : 1;
  });
  for (const g of orderedGroups) {
    const a = assignments.find(
      (x) => x.scope.kind === "group" && x.scope.groupId === g.id,
    );
    if (!a) continue;
    let contribution = materialize(a, identities, "group", ctx, g.id);
    if (g.mode === "any-of-pool" && lastUsedId) {
      const idx = contribution.findIndex((r) => r.identity.id === lastUsedId);
      if (idx > 0) {
        const [pinned] = contribution.splice(idx, 1);
        contribution.unshift(pinned);
      }
    }
    tiers.push(contribution);
  }

  // 4. Server-managed device default. This deliberately sits above global:
  // a global current-user identity is a generic fallback, while CE-Infra's
  // username is specific to this VM.
  const serverDefault = (ctx.serverDefaultUsername ?? "").trim();
  if (serverDefault) {
    tiers.push([{
      identity: {
        id: `__server_default__:${deviceKey}`,
        kind: "literal",
        username: serverDefault,
        label: "CE-Infra VM default",
        source: "server",
        createdAt: 0,
      },
      username: serverDefault,
      via: "default",
    }]);
  }

  // 5. Global scope.
  {
    const a = assignments.find((x) => x.scope.kind === "global");
    if (a) tiers.push(materialize(a, identities, "global", ctx));
  }

  // Flatten + dedupe by resolved username string.
  const seen = new Set<string>();
  const result: ResolvedIdentity[] = [];
  for (const tier of tiers) {
    for (const entry of tier) {
      if (seen.has(entry.username)) continue;
      seen.add(entry.username);
      result.push(entry);
    }
  }

  // Always offer at least one option.
  if (result.length === 0) {
    const cu = lookupIdentity(CURRENT_USER_ID, identities) ?? builtInCurrentUser();
    const expanded = expandUsername(cu, ctx);
    if (result.length === 0 && expanded) {
      result.push({ identity: cu, username: expanded, via: "default" });
    } else if (result.length === 0 && fallbackUsername.trim()) {
      result.push({
        identity: {
          id: "__fallback__",
          kind: "literal",
          username: fallbackUsername,
          source: "manual",
          createdAt: 0,
        },
        username: fallbackUsername,
        via: "default",
      });
    }
  }

  return result;
}

function materialize(
  a: Assignment,
  identities: Identity[],
  via: ResolvedIdentity["via"],
  ctx: ResolveContext,
  groupId?: string,
): ResolvedIdentity[] {
  const ordered = [...a.identities].sort((x, y) => x.priority - y.priority);
  const out: ResolvedIdentity[] = [];
  for (const entry of ordered) {
    const ident = lookupIdentity(entry.identityId, identities);
    if (!ident) continue;
    const username = expandUsername(ident, ctx);
    if (!username) continue;
    out.push({ identity: ident, username, via, groupId });
  }
  return out;
}

/** Shortcut used by connect callsites: returns the primary username string.
 *  Equivalent to `resolveIdentities(...)[0].username` with a guaranteed
 *  non-empty result (will return the fallback if storage and current-user
 *  are both empty). */
export function getPrimaryUsername(
  deviceId: string | number,
  fallbackUsername: string,
  ctx: ResolveContext = {},
): string {
  const list = resolveIdentities(deviceId, fallbackUsername, withInferredGroups(deviceId, ctx));
  return list[0]?.username || fallbackUsername;
}

/** Convenience: return just the username strings in resolution order. */
export function effectiveUsernames(
  deviceId: string | number,
  fallbackUsername: string,
  ctx: ResolveContext = {},
): string[] {
  return resolveIdentities(deviceId, fallbackUsername, withInferredGroups(deviceId, ctx)).map((r) => r.username);
}

/** Infer which groups contain this device based on `memberQuery`. Today only
 *  the `static` query is supported (Phase 2). Caller-supplied
 *  `ctx.groupMembership` takes precedence so tests stay deterministic and
 *  Phase 3 server-side membership pushes win when present. */
function withInferredGroups(
  deviceId: string | number,
  ctx: ResolveContext,
): ResolveContext {
  if (ctx.groupMembership) return ctx;
  return { ...ctx, groupMembership: groupsForDevice(deviceId) };
}

// ---------------------------------------------------------------------------
// Migration: legacy `catwalk.deviceUser.<id>` strings → Identity + Assignment

/** One-shot migration that walks localStorage for legacy per-device username
 *  overrides and converts them into Identities + per-device Assignments.
 *  Idempotent: a marker key prevents re-runs even if the user reinstates
 *  legacy keys (which they shouldn't). Returns the number of overrides
 *  migrated, or -1 if migration was already complete. */
export function migrateLegacyDeviceOverrides(): number {
  if (localStorage.getItem(KEY_MIGRATED) === "1") return -1;

  const legacyEntries: { deviceId: string; username: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LEGACY_DEVICE_USER_PREFIX)) continue;
    const deviceId = key.slice(LEGACY_DEVICE_USER_PREFIX.length);
    const value = localStorage.getItem(key);
    const trimmed = (value ?? "").trim();
    if (deviceId && trimmed) {
      legacyEntries.push({ deviceId, username: trimmed });
    }
  }

  if (legacyEntries.length === 0) {
    localStorage.setItem(KEY_MIGRATED, "1");
    return 0;
  }

  // Reuse existing literal identities by username, otherwise create new.
  const identities = listIdentities().filter((i) => i.id !== CURRENT_USER_ID);
  const assignments = listAssignments();
  const byUsername = new Map<string, Identity>();
  for (const i of identities) {
    if (i.kind === "literal" && i.username) byUsername.set(i.username, i);
  }

  let migrated = 0;
  for (const { deviceId, username } of legacyEntries) {
    let ident = byUsername.get(username);
    if (!ident) {
      ident = {
        id: newId(),
        kind: "literal",
        username,
        source: "manual",
        createdAt: Date.now(),
      };
      identities.push(ident);
      byUsername.set(username, ident);
    }
    // Replace any existing device-scope assignment to be safe.
    const idx = assignments.findIndex(
      (a) => a.scope.kind === "device" && a.scope.deviceId === deviceId,
    );
    const next: Assignment = {
      scope: { kind: "device", deviceId },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    };
    if (idx >= 0) assignments[idx] = next;
    else assignments.push(next);
    migrated++;
  }

  writeJson(KEY_IDENTITIES, identities);
  writeJson(KEY_ASSIGNMENTS, assignments);
  localStorage.setItem(KEY_MIGRATED, "1");
  return migrated;
}

// ---------------------------------------------------------------------------
// Phase 3: reconcile server-pushed identity groups.
//
// Contract: the bundle is the full set of admin-defined groups. We UPSERT
// each group by id (source='server'), UPSERT its group-scope Assignment
// (source='admin'), and DROP any local server-sourced rows that are no
// longer in the bundle. We never touch user-created groups or self-sourced
// assignments. Identity rows created here are tagged source='server' so we
// can garbage-collect orphans on later syncs; if the user already has a
// literal identity with the same username, we reuse it instead of cloning.

export interface ServerIdentityGroupInput {
  id: string;
  name: string;
  mode: "pinned" | "any-of-pool";
  memberQuery:
    | { kind: "device-ids"; value: string[] }
    | { kind: "all" };
  assignments: { username: string; label?: string; priority?: number }[];
}

export interface MergeServerIdentitiesResult {
  groupsAdded: number;
  groupsUpdated: number;
  groupsRemoved: number;
}

function mapServerMemberQuery(
  mq: ServerIdentityGroupInput["memberQuery"],
): Group["memberQuery"] {
  if (mq.kind === "device-ids") {
    return { kind: "static", deviceIds: Array.isArray(mq.value) ? mq.value.map(String) : [] };
  }
  return { kind: "all" };
}

export function mergeServerIdentities(
  bundle: { groups: ServerIdentityGroupInput[] },
): MergeServerIdentitiesResult {
  const incoming = Array.isArray(bundle?.groups) ? bundle.groups : [];
  const incomingIds = new Set(incoming.map((g) => g.id));

  const result: MergeServerIdentitiesResult = {
    groupsAdded: 0,
    groupsUpdated: 0,
    groupsRemoved: 0,
  };

  // --- 1) Drop local server-sourced groups not in the bundle.
  const existingGroups = listGroups();
  const survivingGroups: Group[] = [];
  const droppedServerIds = new Set<string>();
  for (const g of existingGroups) {
    if (g.source === "server" && !incomingIds.has(g.id)) {
      droppedServerIds.add(g.id);
      result.groupsRemoved += 1;
      continue;
    }
    survivingGroups.push(g);
  }

  // --- 2) Drop admin-sourced group-scope assignments for dropped groups,
  //         and also for groups we're about to replace below.
  const incomingIdSet = incomingIds;
  let assignments = listAssignments().filter((a) => {
    if (a.scope.kind !== "group") return true;
    if (droppedServerIds.has(a.scope.groupId)) return false;
    if (a.source === "admin" && incomingIdSet.has(a.scope.groupId)) return false;
    return true;
  });

  // --- 3) Upsert identities (by username) and groups + assignments for each
  //         incoming group.
  const identities = listIdentities().filter((i) => i.id !== CURRENT_USER_ID);
  const byUsername = new Map<string, Identity>();
  for (const i of identities) {
    if (i.kind === "literal" && i.username) byUsername.set(i.username, i);
  }

  const groupsById = new Map(survivingGroups.map((g) => [g.id, g]));

  for (const sg of incoming) {
    const existing = groupsById.get(sg.id);
    const mapped: Group = {
      id: sg.id,
      name: (sg.name ?? "").trim() || "Unnamed group",
      source: "server",
      memberQuery: mapServerMemberQuery(sg.memberQuery),
      mode: sg.mode === "any-of-pool" ? "any-of-pool" : "pinned",
    };
    if (existing) {
      groupsById.set(sg.id, mapped);
      result.groupsUpdated += 1;
    } else {
      groupsById.set(sg.id, mapped);
      result.groupsAdded += 1;
    }

    // Resolve / create identities for this group's assignments.
    const entries: { identityId: string; priority: number }[] = [];
    const incomingAssignments = Array.isArray(sg.assignments) ? sg.assignments : [];
    for (let i = 0; i < incomingAssignments.length; i++) {
      const a = incomingAssignments[i];
      const uname = (a?.username ?? "").trim();
      if (!uname) continue;
      let ident = byUsername.get(uname);
      if (!ident) {
        ident = {
          id: newId(),
          kind: "literal",
          username: uname,
          label: (a.label ?? "").trim() || undefined,
          source: "server",
          createdAt: Date.now(),
        };
        identities.push(ident);
        byUsername.set(uname, ident);
      } else if (a.label && (ident.label ?? "") === "" && ident.source === "server") {
        // Refresh the label on server-sourced identities so admin renames
        // propagate; never overwrite a user-supplied label.
        ident = { ...ident, label: a.label.trim() };
        const idx = identities.findIndex((x) => x.id === ident!.id);
        if (idx >= 0) identities[idx] = ident;
        byUsername.set(uname, ident);
      }
      const priority = Number.isInteger(a.priority) ? (a.priority as number) : i;
      entries.push({ identityId: ident.id, priority });
    }

    if (entries.length > 0) {
      assignments.push({
        scope: { kind: "group", groupId: sg.id },
        identities: entries,
        source: "admin",
        pushedAt: Date.now(),
      });
    }
  }

  // --- 4) Garbage-collect server-sourced identities that are no longer
  //         referenced anywhere. User-sourced identities are always kept.
  const referenced = new Set<string>();
  for (const a of assignments) for (const e of a.identities) referenced.add(e.identityId);
  const finalIdentities = identities.filter(
    (i) => i.source !== "server" || referenced.has(i.id),
  );

  // --- 5) Persist. Order matters only insofar as subscribers will see one
  //         change event per write — that's fine for our purposes.
  writeJson(KEY_GROUPS, Array.from(groupsById.values()));
  writeJson(KEY_ASSIGNMENTS, assignments);
  writeJson(KEY_IDENTITIES, finalIdentities);

  return result;
}

// ---------------------------------------------------------------------------
// Test-only helpers (named loudly so production code doesn't accidentally
// reach for them). Vitest tests import these to reset state between cases.

export function __resetIdentitiesForTests(): void {
  localStorage.removeItem(KEY_IDENTITIES);
  localStorage.removeItem(KEY_GROUPS);
  localStorage.removeItem(KEY_ASSIGNMENTS);
  localStorage.removeItem(KEY_LAST_USED);
  localStorage.removeItem(KEY_MIGRATED);
  // Strip any legacy device-user keys lingering from a previous test.
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LEGACY_DEVICE_USER_PREFIX)) stale.push(k);
  }
  for (const k of stale) localStorage.removeItem(k);
}
