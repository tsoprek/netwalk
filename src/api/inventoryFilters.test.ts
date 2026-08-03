import { describe, expect, it } from "vitest";
import {
  classifyInventoryType,
  detectInventoryOs,
  inventoryOsOptions,
  matchesInventoryType,
} from "./inventoryFilters";

describe("inventory filters", () => {
  it("classifies CML and VMs before their OS or node definition", () => {
    expect(classifyInventoryType({ isCml: true, isVirtual: true, descriptors: ["iosv"] })).toBe("cml");
    expect(classifyInventoryType({ isVirtual: true, descriptors: ["cisco_router"] })).toBe("vm");
  });

  it("classifies physical switches and routers", () => {
    expect(classifyInventoryType({ descriptors: ["cisco_switch"] })).toBe("switch");
    expect(classifyInventoryType({ descriptors: ["c8000v router"] })).toBe("router");
    expect(classifyInventoryType({ descriptors: ["appliance"] })).toBe("hardware");
    expect(matchesInventoryType("hardware", "switch")).toBe(true);
    expect(matchesInventoryType("router", "switch")).toBe(false);
  });

  it("normalizes common OS and network operating-system names", () => {
    expect(detectInventoryOs("Cisco IOS-XE 17")?.value).toBe("ios");
    expect(detectInventoryOs("iox")?.label).toBe("IOS / IOS-XE");
    expect(detectInventoryOs("Red Hat Enterprise Linux 9")?.value).toBe("rhel");
    expect(detectInventoryOs("Ubuntu Linux (64-bit)")?.value).toBe("ubuntu");
    expect(detectInventoryOs("Rocky9-QD-1")?.value).toBe("rocky");
    expect(detectInventoryOs("Rocky9.8-2")?.value).toBe("rocky");
    expect(detectInventoryOs("Ubuntu24-5")?.value).toBe("ubuntu");
    expect(detectInventoryOs("RHEL9_64GUEST")?.value).toBe("rhel");
    expect(detectInventoryOs("cat-sdwan-manager")?.value).toBe("sdwan");
    expect(detectInventoryOs("SD-WAN/teva-0")?.value).toBe("ubuntu");
  });

  it("returns only OS families present in the inventory", () => {
    expect(inventoryOsOptions([
      ["linux_ubuntu"],
      ["Ubuntu Linux 24.04"],
      ["windows_server"],
      ["unknown appliance"],
    ])).toEqual([
      { value: "ubuntu", label: "Ubuntu" },
      { value: "windows", label: "Windows" },
    ]);
  });
});
