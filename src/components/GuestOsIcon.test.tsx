import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuestOsIcon, { DEVICE_TYPE_OPTIONS } from "./GuestOsIcon";

describe("Rocky Linux device icon", () => {
  it("is available as a dedicated manual OS type", () => {
    expect(DEVICE_TYPE_OPTIONS).toContainEqual({
      value: "linux_rocky",
      label: "Linux — Rocky",
    });
  });

  it("uses the Rocky icon for explicit and auto-detected guests", () => {
    const explicit = renderToStaticMarkup(<GuestOsIcon deviceType="linux_rocky" />);
    const rawType = renderToStaticMarkup(<GuestOsIcon deviceType="rocky" />);
    const versionedType = renderToStaticMarkup(<GuestOsIcon deviceType="rocky-linux-9" />);
    const detected = renderToStaticMarkup(<GuestOsIcon family="LINUX" fullName="Rocky Linux 9 (64-bit)" />);
    expect(explicit).toContain('title="linux_rocky"');
    expect(rawType).toContain('title="rocky"');
    expect(versionedType).toContain('title="rocky-linux-9"');
    expect(detected).toContain('title="Rocky Linux 9 (64-bit)"');
    expect(explicit).toContain('data-icon-kind="rocky"');
    expect(rawType).toContain('data-icon-kind="rocky"');
    expect(versionedType).toContain('data-icon-kind="rocky"');
    expect(detected).toContain('data-icon-kind="rocky"');
  });

  it("uses Autopilot's structured guest OS type", () => {
    const detected = renderToStaticMarkup(<GuestOsIcon osType="RHEL9_64GUEST" />);
    expect(detected).toContain('title="RHEL9_64GUEST"');
    expect(detected).toContain('data-icon-kind="rhel"');
  });
});

describe("CML node-definition icons", () => {
  it("maps common CML router, switch, firewall, and Linux definitions", () => {
    const router = renderToStaticMarkup(<GuestOsIcon deviceType="iosv" />);
    const switchNode = renderToStaticMarkup(<GuestOsIcon deviceType="iosvl2" />);
    const firewall = renderToStaticMarkup(<GuestOsIcon deviceType="asav" />);
    const linux = renderToStaticMarkup(<GuestOsIcon deviceType="ubuntu-22-04" />);

    expect(router).toContain('title="iosv"');
    expect(router).toContain('data-icon-kind="network_router"');
    expect(switchNode).toContain('title="iosvl2"');
    expect(switchNode).toContain('data-icon-kind="network_switch"');
    expect(firewall).toContain('title="asav"');
    expect(firewall).toContain('data-icon-kind="network_firewall"');
    expect(linux).toContain('title="ubuntu-22-04"');
    expect(linux).toContain('data-icon-kind="ubuntu"');
  });

  it("maps CML SD-WAN definitions and TEVA Ubuntu appliances", () => {
    const manager = renderToStaticMarkup(<GuestOsIcon deviceType="cat-sdwan-manager" />);
    const teva = renderToStaticMarkup(<GuestOsIcon deviceType="TEVA" />);
    const legacyTeva = renderToStaticMarkup(<GuestOsIcon fullName="SD-WAN/teva-0" />);

    expect(manager).toContain('title="cat-sdwan-manager"');
    expect(manager).toContain("<circle");
    expect(teva).toContain('title="TEVA"');
    expect(teva).toContain('data-icon-kind="ubuntu"');
    expect(legacyTeva).toContain('data-icon-kind="ubuntu"');
  });

  it("shows a fallback tile for an unknown CML definition when requested", () => {
    const hidden = renderToStaticMarkup(<GuestOsIcon deviceType="custom-cml-node" />);
    const fallback = renderToStaticMarkup(
      <GuestOsIcon deviceType="custom-cml-node" showUnknown />,
    );

    expect(hidden).toBe("");
    expect(fallback).toContain('title="custom-cml-node"');
  });
});

describe("vendor-neutral connection icons", () => {
  it("offers network, hardware, infrastructure, and OS choices", () => {
    const values = new Set(DEVICE_TYPE_OPTIONS.map((option) => option.value));
    for (const value of [
      "network_router",
      "network_l3_switch",
      "network_switch",
      "network_firewall",
      "network_wireless",
      "network_load_balancer",
      "hardware_server",
      "hardware_workstation",
      "infrastructure_cloud",
      "infrastructure_container",
      "infrastructure_database",
      "infrastructure_storage",
      "windows_desktop",
      "windows_server",
      "macos",
      "linux_generic",
      "bsd",
      "solaris",
    ]) {
      expect(values.has(value), value).toBe(true);
    }
  });

  it("auto-detects representative multi-vendor and infrastructure descriptors", () => {
    const cases = [
      ["veos", "network_l3_switch"],
      ["vyos-router", "network_router"],
      ["pfsense-firewall", "network_firewall"],
      ["wireless-access-point", "network_wireless"],
      ["haproxy-load-balancer", "network_load_balancer"],
      ["kubernetes-pod", "container"],
      ["postgresql-database", "database"],
      ["nas-storage", "storage"],
    ];

    for (const [descriptor, kind] of cases) {
      const icon = renderToStaticMarkup(<GuestOsIcon deviceType={descriptor} />);
      expect(icon).toContain(`data-icon-kind="${kind}"`);
    }
  });
});
