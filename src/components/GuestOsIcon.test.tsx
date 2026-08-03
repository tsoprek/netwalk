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
    expect(explicit).toContain("#10b981");
    expect(rawType).toContain("#10b981");
    expect(versionedType).toContain("#10b981");
    expect(detected).toContain("#10b981");
  });

  it("uses Autopilot's structured guest OS type", () => {
    const detected = renderToStaticMarkup(<GuestOsIcon osType="RHEL9_64GUEST" />);
    expect(detected).toContain('title="RHEL9_64GUEST"');
    expect(detected).toContain("#cc0000");
  });
});

describe("CML node-definition icons", () => {
  it("maps common CML router, switch, firewall, and Linux definitions", () => {
    const router = renderToStaticMarkup(<GuestOsIcon deviceType="iosv" />);
    const switchNode = renderToStaticMarkup(<GuestOsIcon deviceType="iosvl2" />);
    const firewall = renderToStaticMarkup(<GuestOsIcon deviceType="asav" />);
    const linux = renderToStaticMarkup(<GuestOsIcon deviceType="ubuntu-22-04" />);

    expect(router).toContain('title="iosv"');
    expect(router).toContain("<circle");
    expect(switchNode).toContain('title="iosvl2"');
    expect(switchNode).toContain("<rect");
    expect(firewall).toContain('title="asav"');
    expect(firewall).toContain('d="M12 3l8 3v5');
    expect(linux).toContain('title="ubuntu-22-04"');
    expect(linux).toContain("#e95420");
  });

  it("maps CML SD-WAN definitions and TEVA Ubuntu appliances", () => {
    const manager = renderToStaticMarkup(<GuestOsIcon deviceType="cat-sdwan-manager" />);
    const teva = renderToStaticMarkup(<GuestOsIcon deviceType="TEVA" />);
    const legacyTeva = renderToStaticMarkup(<GuestOsIcon fullName="SD-WAN/teva-0" />);

    expect(manager).toContain('title="cat-sdwan-manager"');
    expect(manager).toContain("<circle");
    expect(teva).toContain('title="TEVA"');
    expect(teva).toContain("#e95420");
    expect(legacyTeva).toContain("#e95420");
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
