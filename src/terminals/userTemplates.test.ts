import { afterEach, describe, expect, it } from "vitest";
import {
  USER_TEMPLATES_KEY,
  USER_TEMPLATE_GROUPS_KEY,
  deleteUserTemplateGroup,
  listUserTemplates,
  listUserTemplateGroups,
  moveUserTemplate,
  renameUserTemplateGroup,
  reorderUserTemplateGroups,
  saveUserTemplate,
  saveUserTemplateGroup,
  setUserTemplateGroupSharing,
} from "./userTemplates";

afterEach(() => {
  localStorage.removeItem(USER_TEMPLATES_KEY);
  localStorage.removeItem(USER_TEMPLATE_GROUPS_KEY);
});

describe("user template sharing", () => {
  it("defaults new templates to private and preserves sharing during edits", () => {
    const created = saveUserTemplate({ name: "Show clock", body: "show clock" });
    expect(created.sharing).toEqual({ scope: "private", users: [] });

    saveUserTemplate({
      ...created,
      sharing: { scope: "users", users: ["Alice", "alice", " bob "] },
    });
    const shared = listUserTemplates()[0];
    expect(shared.sharing).toEqual({ scope: "users", users: ["alice", "bob"] });

    saveUserTemplate({ id: shared.id, name: "Show time", body: shared.body });
    expect(listUserTemplates()[0].sharing).toEqual({ scope: "users", users: ["alice", "bob"] });
  });

  it("persists empty groups and migrates templates when groups change", () => {
    saveUserTemplateGroup("Routing");
    saveUserTemplate({ name: "Show OSPF", body: "show ip ospf", subcategory: "Routing" });
    expect(listUserTemplateGroups()).toEqual(["Routing"]);

    renameUserTemplateGroup("Routing", "Routing protocols");
    expect(listUserTemplateGroups()).toEqual(["Routing protocols"]);
    expect(listUserTemplates()[0].subcategory).toBe("Routing protocols");

    deleteUserTemplateGroup("Routing protocols");
    expect(listUserTemplateGroups()).toEqual([]);
    expect(listUserTemplates()[0].subcategory).toBeUndefined();
  });

  it("deduplicates discovered and previously stored group names", () => {
    localStorage.setItem(USER_TEMPLATE_GROUPS_KEY, JSON.stringify(["Routing", "routing", " Routing "]));
    localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify([
      { id: "one", category: "My templates", name: "One", body: "show one", subcategory: "Routing", createdAt: "1", updatedAt: "1" },
      { id: "two", category: "My templates", name: "Two", body: "show two", subcategory: "routing", createdAt: "1", updatedAt: "2" },
      { id: "three", category: "My templates", name: "Three", body: "show three", subcategory: "Security", createdAt: "1", updatedAt: "3" },
      { id: "four", category: "My templates", name: "Four", body: "show four", subcategory: "Security", createdAt: "1", updatedAt: "4" },
    ]));

    expect(listUserTemplateGroups()).toEqual(["Routing", "Security"]);
  });

  it("uses one canonical group name and migrates case variants together", () => {
    saveUserTemplateGroup("Routing");
    const created = saveUserTemplate({ name: "Show routes", body: "show ip route", subcategory: "routing" });
    expect(created.subcategory).toBe("Routing");

    localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify([
      ...listUserTemplates(),
      { id: "legacy", category: "My templates", name: "Legacy", body: "show run", subcategory: "ROUTING", createdAt: "1", updatedAt: "1" },
    ]));
    renameUserTemplateGroup("Routing", "Layer 3");
    expect(listUserTemplates().map((template) => template.subcategory)).toEqual(["Layer 3", "Layer 3"]);

    deleteUserTemplateGroup("layer 3");
    expect(listUserTemplateGroups()).toEqual([]);
    expect(listUserTemplates().every((template) => template.subcategory == null)).toBe(true);
  });

  it("applies sharing to every template in one group only", () => {
    saveUserTemplate({ name: "Routes", body: "show route", subcategory: "Routing" });
    saveUserTemplate({ name: "OSPF", body: "show ospf", subcategory: "routing" });
    saveUserTemplate({ name: "ACLs", body: "show acl", subcategory: "Security" });

    const shared = setUserTemplateGroupSharing("ROUTING", { scope: "users", users: ["Alice", "alice"] });
    expect(shared).toHaveLength(2);
    expect(shared.every((template) => template.sharing?.scope === "users")).toBe(true);
    expect(shared.every((template) => template.sharing?.users.join() === "alice")).toBe(true);
    expect(listUserTemplates().find((template) => template.name === "ACLs")?.sharing?.scope).toBe("private");
  });

  it("persists reordered groups", () => {
    saveUserTemplateGroup("Routing");
    saveUserTemplateGroup("Security");
    saveUserTemplateGroup("Operations");

    reorderUserTemplateGroups("Operations", "Routing", "before");
    expect(listUserTemplateGroups()).toEqual(["Operations", "Routing", "Security"]);

    reorderUserTemplateGroups("Operations", "Security", "after");
    expect(listUserTemplateGroups()).toEqual(["Routing", "Security", "Operations"]);
  });

  it("reorders templates and moves them between groups", () => {
    const first = saveUserTemplate({ name: "First", body: "first", subcategory: "Routing" });
    const second = saveUserTemplate({ name: "Second", body: "second", subcategory: "Routing" });
    const third = saveUserTemplate({ name: "Third", body: "third", subcategory: "Security" });

    moveUserTemplate(first.id, "Routing", second.id, "before");
    expect(listUserTemplates().filter((template) => template.subcategory === "Routing").map((template) => template.id))
      .toEqual([first.id, second.id]);

    moveUserTemplate(second.id, "Security", third.id, "after");
    expect(listUserTemplates().filter((template) => template.subcategory === "Security").map((template) => template.id))
      .toEqual([third.id, second.id]);
    expect(listUserTemplates().find((template) => template.id === second.id)?.subcategory).toBe("Security");
  });
});
