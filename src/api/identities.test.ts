//! Resolver + migration tests for identities.ts. The resolver is the only
//! nontrivial piece of the identities feature, so it gets thorough coverage
//! across every combination of scope, mode, source, and last-used state.
import { beforeEach, describe, expect, it } from "vitest";
import {
  addGroup,
  addIdentity,
  countIdentityUsage,
  effectiveUsernames,
  getCurrentUserIdentityId,
  getGroupAssignment,
  getGroupDeviceIds,
  getPrimaryUsername,
  listGroups,
  mergeServerIdentities,
  migrateLegacyDeviceOverrides,
  recordLastUsedIdentity,
  removeGroup,
  removeIdentity,
  resolveIdentities,
  updateGroup,
  updateIdentity,
  upsertAssignment,
  __resetIdentitiesForTests,
  type Group,
  type Identity,
} from "./identities";

function lit(username: string, label?: string): Identity {
  return addIdentity({ kind: "literal", username, source: "manual", label });
}

beforeEach(() => {
  __resetIdentitiesForTests();
});

// ---------------------------------------------------------------------------
// Defaults / built-in current-user

describe("default behavior (case 1: current user everywhere)", () => {
  it("returns current user as primary when nothing is configured", () => {
    expect(getPrimaryUsername("dev-1", "fallback", { currentUser: "tsoprek" })).toBe(
      "tsoprek",
    );
  });

  it("returns fallback when current user is null and no config", () => {
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: null })).toBe("admin");
  });

  it("returns a single-element list with via='default' when nothing configured", () => {
    const list = resolveIdentities("dev-1", "admin", { currentUser: "alice" });
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe("alice");
    expect(list[0].via).toBe("default");
    expect(list[0].identity.kind).toBe("current-user");
  });

  it("uses a BookMe VM server default ahead of the current ConneCat user", () => {
    expect(getPrimaryUsername("vm-42", "admin", {
      currentUser: "alice",
      serverDefaultUsername: "cloud-user",
    })).toBe("cloud-user");
  });

  it("lets an explicit device identity override the BookMe VM default", () => {
    const identity = lit("operator");
    upsertAssignment({
      scope: { kind: "device", deviceId: "vm-42" },
      identities: [{ identityId: identity.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("vm-42", "admin", {
      currentUser: "alice",
      serverDefaultUsername: "cloud-user",
    })).toBe("operator");
  });

  it("uses the CE-Infra VM default ahead of a global identity", () => {
    const global = lit("alice");
    upsertAssignment({
      scope: { kind: "global" },
      identities: [{ identityId: global.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("vm-42", "admin", {
      currentUser: "alice",
      serverDefaultUsername: "cloud-user",
    })).toBe("cloud-user");
    expect(effectiveUsernames("vm-42", "admin", {
      currentUser: "alice",
      serverDefaultUsername: "cloud-user",
    })).toEqual(["cloud-user", "alice"]);
  });

  it("current-user identity id is the same well-known constant", () => {
    expect(getCurrentUserIdentityId()).toBe("__current_user__");
  });

  it("current-user identity is non-deletable", () => {
    removeIdentity(getCurrentUserIdentityId());
    // Still resolvable.
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: "alice" })).toBe(
      "alice",
    );
  });
});

// ---------------------------------------------------------------------------
// Device scope (case 5 single-machine override)

describe("device scope", () => {
  it("device assignment wins over default current-user", () => {
    const ident = lit("tealab");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: "tsoprek" })).toBe(
      "tealab",
    );
  });

  it("device assignment does not leak to other devices", () => {
    const ident = lit("tealab");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-2", "admin", { currentUser: "tsoprek" })).toBe(
      "tsoprek",
    );
  });

  it("multiple identities on a device come back in priority order", () => {
    const a = lit("alpha");
    const b = lit("beta");
    const c = lit("gamma");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [
        { identityId: b.id, priority: 1 },
        { identityId: a.id, priority: 0 },
        { identityId: c.id, priority: 2 },
      ],
      source: "self",
    });
    expect(effectiveUsernames("dev-1", "admin", { currentUser: null })).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("removing an identity strips it from any assignment", () => {
    const a = lit("alpha");
    const b = lit("beta");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [
        { identityId: a.id, priority: 0 },
        { identityId: b.id, priority: 1 },
      ],
      source: "self",
    });
    removeIdentity(a.id);
    expect(effectiveUsernames("dev-1", "admin", { currentUser: null })).toEqual([
      "beta",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Session scope (highest priority)

describe("session scope", () => {
  it("session assignment wins over device assignment", () => {
    const devIdent = lit("dev-user");
    const sessIdent = lit("sess-user");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: devIdent.id, priority: 0 }],
      source: "self",
    });
    upsertAssignment({
      scope: { kind: "session", sessionId: "sess-A" },
      identities: [{ identityId: sessIdent.id, priority: 0 }],
      source: "self",
    });
    expect(
      getPrimaryUsername("dev-1", "admin", { currentUser: null, sessionId: "sess-A" }),
    ).toBe("sess-user");
  });

  it("session-scope is ignored when no sessionId in ctx", () => {
    const devIdent = lit("dev-user");
    const sessIdent = lit("sess-user");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: devIdent.id, priority: 0 }],
      source: "self",
    });
    upsertAssignment({
      scope: { kind: "session", sessionId: "sess-A" },
      identities: [{ identityId: sessIdent.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: null })).toBe("dev-user");
  });
});

// ---------------------------------------------------------------------------
// Group scope (cases 2, 3, 4)

function group(
  id: string,
  name: string,
  mode: Group["mode"] = "pinned",
  source: Group["source"] = "server",
): Group {
  return {
    id,
    name,
    source,
    mode,
    memberQuery: { kind: "static", deviceIds: [] },
  };
}

describe("group scope — pinned mode (case 2 + 4)", () => {
  it("pinned group identities follow priority order", () => {
    const tealab = lit("tealab");
    const root = lit("root");
    const g = group("g-lab", "Lab Shared VMs");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [
        { identityId: tealab.id, priority: 0 },
        { identityId: root.id, priority: 1 },
      ],
      source: "admin",
    });
    expect(
      effectiveUsernames("dev-1", "admin", {
        currentUser: null,
        groupMembership: [g],
      }),
    ).toEqual(["tealab", "root"]);
  });

  it("device assignment overrides group primary", () => {
    const tealab = lit("tealab");
    const root = lit("root");
    const personal = lit("alice");
    const g = group("g-lab", "Lab Shared VMs");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [
        { identityId: tealab.id, priority: 0 },
        { identityId: root.id, priority: 1 },
      ],
      source: "admin",
    });
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: personal.id, priority: 0 }],
      source: "self",
    });
    const list = effectiveUsernames("dev-1", "admin", {
      currentUser: null,
      groupMembership: [g],
    });
    // Device entries first, then group entries (dedup if any overlap).
    expect(list[0]).toBe("alice");
    expect(list).toContain("tealab");
    expect(list).toContain("root");
  });
});

describe("group scope — any-of-pool mode (case 3: Microsoft VMs)", () => {
  it("default order is priority order when no last-used", () => {
    const admin = lit("msvm-admin");
    const tester = lit("msvm-tester");
    const dev = lit("msvm-dev");
    const g = group("g-ms", "Microsoft VMs", "any-of-pool");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [
        { identityId: admin.id, priority: 0 },
        { identityId: tester.id, priority: 1 },
        { identityId: dev.id, priority: 2 },
      ],
      source: "admin",
    });
    expect(
      effectiveUsernames("dev-1", "admin", {
        currentUser: null,
        groupMembership: [g],
      }),
    ).toEqual(["msvm-admin", "msvm-tester", "msvm-dev"]);
  });

  it("last-used identity is promoted to front for that device only", () => {
    const admin = lit("msvm-admin");
    const tester = lit("msvm-tester");
    const dev = lit("msvm-dev");
    const g = group("g-ms", "Microsoft VMs", "any-of-pool");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [
        { identityId: admin.id, priority: 0 },
        { identityId: tester.id, priority: 1 },
        { identityId: dev.id, priority: 2 },
      ],
      source: "admin",
    });
    recordLastUsedIdentity("dev-1", tester.id);
    expect(
      effectiveUsernames("dev-1", "admin", {
        currentUser: null,
        groupMembership: [g],
      }),
    ).toEqual(["msvm-tester", "msvm-admin", "msvm-dev"]);
    // dev-2 is untouched.
    expect(
      effectiveUsernames("dev-2", "admin", {
        currentUser: null,
        groupMembership: [g],
      }),
    ).toEqual(["msvm-admin", "msvm-tester", "msvm-dev"]);
  });

  it("pinned-mode group ignores last-used promotion", () => {
    const admin = lit("a");
    const tester = lit("b");
    const g = group("g-pin", "Pinned Group", "pinned");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [
        { identityId: admin.id, priority: 0 },
        { identityId: tester.id, priority: 1 },
      ],
      source: "admin",
    });
    recordLastUsedIdentity("dev-1", tester.id);
    expect(
      effectiveUsernames("dev-1", "admin", {
        currentUser: null,
        groupMembership: [g],
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("group scope — multiple groups, source tiebreak", () => {
  it("user-source group beats server-source group", () => {
    const a = lit("alpha");
    const b = lit("beta");
    const gServer = group("g-srv", "Server Group", "pinned", "server");
    const gUser = group("g-usr", "User Group", "pinned", "user");
    upsertAssignment({
      scope: { kind: "group", groupId: gServer.id },
      identities: [{ identityId: a.id, priority: 0 }],
      source: "admin",
    });
    upsertAssignment({
      scope: { kind: "group", groupId: gUser.id },
      identities: [{ identityId: b.id, priority: 0 }],
      source: "self",
    });
    expect(
      effectiveUsernames("dev-1", "admin", {
        currentUser: null,
        groupMembership: [gServer, gUser],
      }),
    ).toEqual(["beta", "alpha"]);
  });
});

// ---------------------------------------------------------------------------
// Global scope (lowest)

describe("global scope", () => {
  it("global assignment is fallback when no other scope matches", () => {
    const a = lit("globaluser");
    upsertAssignment({
      scope: { kind: "global" },
      identities: [{ identityId: a.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-99", "admin", { currentUser: null })).toBe(
      "globaluser",
    );
  });

  it("device-scope beats global", () => {
    const g = lit("globaluser");
    const d = lit("deviceuser");
    upsertAssignment({
      scope: { kind: "global" },
      identities: [{ identityId: g.id, priority: 0 }],
      source: "self",
    });
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: d.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: null })).toBe(
      "deviceuser",
    );
  });
});

// ---------------------------------------------------------------------------
// Dedupe + current-user expansion

describe("dedupe", () => {
  it("does not show the same username twice across tiers", () => {
    const dup = lit("tealab");
    const g = group("g-1", "G");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [{ identityId: dup.id, priority: 0 }],
      source: "admin",
    });
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: dup.id, priority: 0 }],
      source: "self",
    });
    const list = effectiveUsernames("dev-1", "admin", {
      currentUser: null,
      groupMembership: [g],
    });
    expect(list).toEqual(["tealab"]);
  });

  it("dedupes current-user against a literal with the same username", () => {
    const lit1 = lit("tsoprek");
    upsertAssignment({
      scope: { kind: "global" },
      identities: [{ identityId: lit1.id, priority: 0 }],
      source: "self",
    });
    // current-user resolves to "tsoprek" too; should appear only once.
    const list = effectiveUsernames("dev-1", "admin", { currentUser: "tsoprek" });
    expect(list).toEqual(["tsoprek"]);
  });

  it("skips identities with empty username (e.g. current-user with no login)", () => {
    const real = lit("real");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [
        { identityId: getCurrentUserIdentityId(), priority: 0 },
        { identityId: real.id, priority: 1 },
      ],
      source: "self",
    });
    expect(
      effectiveUsernames("dev-1", "admin", { currentUser: null }),
    ).toEqual(["real"]);
  });
});

// ---------------------------------------------------------------------------
// Migration

describe("migration from legacy catwalk.deviceUser.* keys", () => {
  it("returns 0 and sets marker when no legacy keys exist", () => {
    expect(migrateLegacyDeviceOverrides()).toBe(0);
    // Re-run returns -1 (already migrated).
    expect(migrateLegacyDeviceOverrides()).toBe(-1);
  });

  it("migrates each legacy override into an identity + device assignment", () => {
    localStorage.setItem("catwalk.deviceUser.dev-1", "tealab");
    localStorage.setItem("catwalk.deviceUser.dev-2", "root");
    expect(migrateLegacyDeviceOverrides()).toBe(2);
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: "tsoprek" })).toBe(
      "tealab",
    );
    expect(getPrimaryUsername("dev-2", "admin", { currentUser: "tsoprek" })).toBe(
      "root",
    );
  });

  it("reuses a single identity when the same username appears on multiple devices", () => {
    localStorage.setItem("catwalk.deviceUser.dev-1", "tealab");
    localStorage.setItem("catwalk.deviceUser.dev-2", "tealab");
    migrateLegacyDeviceOverrides();
    // Only 1 literal identity for tealab (+ built-in current-user).
    const ids = (JSON.parse(localStorage.getItem("catwalk.identities.v1.identities")!) as Identity[])
      .filter((i) => i.kind === "literal");
    expect(ids).toHaveLength(1);
    expect(ids[0].username).toBe("tealab");
  });

  it("skips empty / whitespace-only legacy values", () => {
    localStorage.setItem("catwalk.deviceUser.dev-1", "   ");
    localStorage.setItem("catwalk.deviceUser.dev-2", "");
    expect(migrateLegacyDeviceOverrides()).toBe(0);
  });

  it("is idempotent (running twice doesn't double assignments)", () => {
    localStorage.setItem("catwalk.deviceUser.dev-1", "tealab");
    expect(migrateLegacyDeviceOverrides()).toBe(1);
    // Re-adding the legacy key + re-running does NOT migrate again.
    localStorage.setItem("catwalk.deviceUser.dev-1", "different");
    expect(migrateLegacyDeviceOverrides()).toBe(-1);
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: null })).toBe("tealab");
  });
});

// ---------------------------------------------------------------------------
// Fallback chain final safety net

describe("fallback safety net", () => {
  it("returns fallback string when current-user empty and no config", () => {
    expect(getPrimaryUsername("dev-1", "Administrator", { currentUser: null })).toBe(
      "Administrator",
    );
  });

  it("resolveIdentities returns synthetic literal entry for fallback case", () => {
    const list = resolveIdentities("dev-1", "Administrator", { currentUser: null });
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe("Administrator");
    expect(list[0].identity.kind).toBe("literal");
    expect(list[0].via).toBe("default");
  });

  it("returns the fallback when storage holds an unresolvable identity reference", () => {
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: "nonexistent-id", priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: "alice" })).toBe(
      "alice",
    );
  });

  it("reads broker.ts USERNAME_KEY when ctx.currentUser is omitted", () => {
    // ctx.currentUser absent → resolver falls back to localStorage broker key.
    localStorage.setItem("catwalk.username", "from-broker");
    expect(getPrimaryUsername("dev-1", "admin")).toBe("from-broker");
  });
});

describe("CRUD helpers (updateIdentity, countIdentityUsage)", () => {
  it("updateIdentity edits username in place; assignments still resolve", () => {
    const ident = lit("tsoprek", "Personal");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    });
    updateIdentity(ident.id, { username: "tom" });
    expect(getPrimaryUsername("dev-1", "admin")).toBe("tom");
  });

  it("updateIdentity edits label without touching username", () => {
    const ident = lit("alice", "Old");
    updateIdentity(ident.id, { label: "New label" });
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    });
    expect(getPrimaryUsername("dev-1", "admin")).toBe("alice");
  });

  it("updateIdentity is a no-op for the built-in current-user identity", () => {
    updateIdentity(getCurrentUserIdentityId(), { username: "hacked" });
    // current-user has no username, so the resolver falls through to ctx.currentUser.
    expect(getPrimaryUsername("dev-1", "admin", { currentUser: "alice" })).toBe("alice");
  });

  it("countIdentityUsage returns the number of assignments referencing the id", () => {
    const a = lit("alice");
    const b = lit("bob");
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-1" },
      identities: [{ identityId: a.id, priority: 0 }],
      source: "self",
    });
    upsertAssignment({
      scope: { kind: "device", deviceId: "dev-2" },
      identities: [
        { identityId: a.id, priority: 0 },
        { identityId: b.id, priority: 1 },
      ],
      source: "self",
    });
    expect(countIdentityUsage(a.id)).toBe(2);
    expect(countIdentityUsage(b.id)).toBe(1);
    expect(countIdentityUsage("nonexistent")).toBe(0);
  });
});

describe("Group CRUD (Phase 2)", () => {
  it("addGroup persists a user-sourced group", () => {
    const g = addGroup({
      name: "Microsoft VMs",
      source: "user",
      memberQuery: { kind: "static", deviceIds: ["dev-1", "dev-2"] },
      mode: "any-of-pool",
    });
    expect(g.id).toBeTruthy();
    expect(getGroupDeviceIds(g)).toEqual(["dev-1", "dev-2"]);
  });

  it("updateGroup edits name/mode/memberQuery on user groups", () => {
    const g = addGroup({
      name: "old",
      source: "user",
      memberQuery: { kind: "static", deviceIds: ["dev-1"] },
      mode: "pinned",
    });
    updateGroup(g.id, {
      name: "new",
      mode: "any-of-pool",
      memberQuery: { kind: "static", deviceIds: ["dev-1", "dev-2"] },
    });
    const a = lit("alice");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [{ identityId: a.id, priority: 0 }],
      source: "self",
    });
    // Resolver picks up the edited membership — dev-2 now belongs to the
    // group, so it resolves to "alice".
    expect(getPrimaryUsername("dev-2", "fallback", { currentUser: "me" })).toBe("alice");
  });

  it("updateGroup ignores edits to server-sourced groups", () => {
    const g = addGroup({
      name: "Admin pool",
      source: "server",
      memberQuery: { kind: "static", deviceIds: ["dev-1"] },
      mode: "pinned",
    });
    updateGroup(g.id, { name: "hijacked" });
    // listGroups shows the original name is preserved — server groups
    // are read-only via these mutators (Phase 3 sync owns them).
    const fetched = listGroups().find((x) => x.id === g.id);
    expect(fetched?.name).toBe("Admin pool");
  });

  it("removeGroup drops the group and its group-scope assignment", () => {
    const g = addGroup({
      name: "doomed",
      source: "user",
      memberQuery: { kind: "static", deviceIds: ["dev-1"] },
      mode: "pinned",
    });
    const a = lit("alice");
    upsertAssignment({
      scope: { kind: "group", groupId: g.id },
      identities: [{ identityId: a.id, priority: 0 }],
      source: "self",
    });
    expect(getGroupAssignment(g.id)).not.toBeNull();
    removeGroup(g.id);
    expect(getGroupAssignment(g.id)).toBeNull();
    // dev-1 no longer resolves through the deleted group → falls back to
    // current user.
    expect(getPrimaryUsername("dev-1", "fallback", { currentUser: "me" })).toBe("me");
  });

  it("removeGroup is a no-op for server-sourced groups", () => {
    const g = addGroup({
      name: "kept",
      source: "server",
      memberQuery: { kind: "static", deviceIds: [] },
      mode: "pinned",
    });
    removeGroup(g.id);
    const fetched = listGroups().find((x) => x.id === g.id);
    expect(fetched).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Phase 3: mergeServerIdentities — server-pushed identity groups.

describe("mergeServerIdentities (Phase 3)", () => {
  it("adds a server group + creates literal identities for its usernames", () => {
    const res = mergeServerIdentities({
      groups: [
        {
          id: "g_admins",
          name: "Administrators",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1", "d2"] },
          assignments: [
            { username: "root", label: "Root" },
            { username: "admin", label: "Admin" },
          ],
        },
      ],
    });
    expect(res).toEqual({ groupsAdded: 1, groupsUpdated: 0, groupsRemoved: 0 });

    const g = listGroups().find((x) => x.id === "g_admins")!;
    expect(g.name).toBe("Administrators");
    expect(g.source).toBe("server");
    expect(g.mode).toBe("pinned");
    expect(g.memberQuery).toEqual({ kind: "static", deviceIds: ["d1", "d2"] });

    // Resolver picks up the group via auto-inferred membership.
    expect(getPrimaryUsername("d1", "fallback")).toBe("root");
    expect(effectiveUsernames("d1", "fallback")).toEqual(["root", "admin"]);
  });

  it("never touches user-created groups or self-sourced assignments", () => {
    const ident = addIdentity({ kind: "literal", username: "alice", source: "manual" });
    const mine = addGroup({
      name: "Mine",
      source: "user",
      memberQuery: { kind: "static", deviceIds: ["d1"] },
      mode: "pinned",
    });
    upsertAssignment({
      scope: { kind: "group", groupId: mine.id },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    });
    upsertAssignment({
      scope: { kind: "device", deviceId: "d1" },
      identities: [{ identityId: ident.id, priority: 0 }],
      source: "self",
    });

    mergeServerIdentities({
      groups: [
        {
          id: "g_server",
          name: "Server group",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1"] },
          assignments: [{ username: "root" }],
        },
      ],
    });

    expect(listGroups().find((g) => g.id === mine.id)).toBeTruthy();
    expect(getGroupAssignment(mine.id)).toBeTruthy();
    // Device scope (source='self') wins over group scopes → alice stays primary.
    expect(getPrimaryUsername("d1", "fallback")).toBe("alice");
  });

  it("removes server groups dropped from the bundle but keeps user groups", () => {
    const mine = addGroup({
      name: "Mine",
      source: "user",
      memberQuery: { kind: "static", deviceIds: ["d1"] },
      mode: "pinned",
    });

    mergeServerIdentities({
      groups: [
        {
          id: "g_doomed",
          name: "Doomed",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1"] },
          assignments: [{ username: "root" }],
        },
      ],
    });
    expect(listGroups().some((g) => g.id === "g_doomed")).toBe(true);

    const res = mergeServerIdentities({ groups: [] });
    expect(res.groupsRemoved).toBe(1);
    expect(listGroups().some((g) => g.id === "g_doomed")).toBe(false);
    expect(listGroups().some((g) => g.id === mine.id)).toBe(true);
    // The orphan server-created identity is garbage-collected.
    // (We don't import listIdentities at top; getGroupAssignment is enough
    // to confirm the assignment row was dropped.)
    expect(getGroupAssignment("g_doomed")).toBeNull();
  });

  it("replaces group fields on update without changing source", () => {
    mergeServerIdentities({
      groups: [
        {
          id: "g1",
          name: "First",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1"] },
          assignments: [{ username: "root" }],
        },
      ],
    });
    const res = mergeServerIdentities({
      groups: [
        {
          id: "g1",
          name: "First Renamed",
          mode: "any-of-pool",
          memberQuery: { kind: "device-ids", value: ["d1", "d2"] },
          assignments: [{ username: "root" }, { username: "ops" }],
        },
      ],
    });
    expect(res).toEqual({ groupsAdded: 0, groupsUpdated: 1, groupsRemoved: 0 });

    const g = listGroups().find((x) => x.id === "g1")!;
    expect(g.name).toBe("First Renamed");
    expect(g.mode).toBe("any-of-pool");
    expect(g.source).toBe("server");
    expect(g.memberQuery).toEqual({ kind: "static", deviceIds: ["d1", "d2"] });

    const a = getGroupAssignment("g1")!;
    expect(a.identities).toHaveLength(2);
  });

  it("reuses an existing user-created literal identity by username", () => {
    const ident = addIdentity({ kind: "literal", username: "root", source: "manual" });
    mergeServerIdentities({
      groups: [
        {
          id: "g1",
          name: "G1",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1"] },
          assignments: [{ username: "root" }],
        },
      ],
    });
    const a = getGroupAssignment("g1")!;
    expect(a.identities[0].identityId).toBe(ident.id);
  });

  it("supports member-query kind 'all' so every device gets the group", () => {
    mergeServerIdentities({
      groups: [
        {
          id: "g_all",
          name: "Everywhere",
          mode: "pinned",
          memberQuery: { kind: "all" },
          assignments: [{ username: "root" }],
        },
      ],
    });
    expect(getPrimaryUsername("any-device-id", "fallback")).toBe("root");
    expect(getPrimaryUsername("other-device", "fallback")).toBe("root");
  });

  it("treats an empty bundle as a clean wipe of server-sourced rows", () => {
    mergeServerIdentities({
      groups: [
        {
          id: "g1",
          name: "G1",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1"] },
          assignments: [{ username: "root" }],
        },
        {
          id: "g2",
          name: "G2",
          mode: "pinned",
          memberQuery: { kind: "all" },
          assignments: [{ username: "ops" }],
        },
      ],
    });
    expect(listGroups().filter((g) => g.source === "server")).toHaveLength(2);

    const res = mergeServerIdentities({ groups: [] });
    expect(res.groupsRemoved).toBe(2);
    expect(listGroups().filter((g) => g.source === "server")).toHaveLength(0);
  });

  it("ignores blank-username assignment entries and survives missing groups field", () => {
    const res = mergeServerIdentities({
      groups: [
        {
          id: "g_partial",
          name: "Partial",
          mode: "pinned",
          memberQuery: { kind: "device-ids", value: ["d1"] },
          assignments: [
            { username: "" },
            { username: "  " },
            { username: "ok" },
          ],
        },
      ],
    });
    expect(res.groupsAdded).toBe(1);
    const a = getGroupAssignment("g_partial")!;
    expect(a.identities).toHaveLength(1);

    // Defensive: empty/malformed bundles don't throw.
    expect(() => mergeServerIdentities({ groups: undefined as unknown as never[] })).not.toThrow();
  });
});
