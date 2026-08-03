import { describe, expect, it } from "vitest";
import { userFacingMessage } from "./userMessage";

describe("userFacingMessage", () => {
  it("turns a powered-off WebMKS response into a short VM state message", () => {
    expect(userFacingMessage(
      '502 Bad Gateway: {"msg":"WebMKS ticket failed: vCenter request failed POST /api/vcenter/vm/vm-14321/console/tickets (400): {\\"error_type\\":\\"NOT_ALLOWED_IN_CURRENT_STATE\\",\\"messages\\":[{\\"default_message\\":\\"Unable to obtain console ticket because the virtual machine is powered off.\\",\\"id\\":\\"com.vmware.api.vcenter.vm.console.tickets.not_allowed_in_current_state\\"},{\\"default_message\\":\\"The attempted operation cannot be performed in the current state (Powered off).\\",\\"id\\":\\"vmsg.InvalidPowerState.summary\\"}]}"}',
    )).toBe("VM is not powered on.");
  });

  it("extracts msg from an HTTP error payload", () => {
    expect(userFacingMessage(
      '429 Too Many Requests: {"code":"vcenter_ovf_concurrency_limit","deployment_limits":{"active":2},"msg":"Wait for one deployment to finish."}',
    )).toBe("Wait for one deployment to finish.");
  });

  it("extracts nested vCenter default messages", () => {
    expect(userFacingMessage(
      '502 Bad Gateway: {"error":{"messages":[{"default_message":"The selected image cannot be deployed."}]},"default_message":"Use another image."}',
    )).toBe("Use another image.");
  });

  it("removes HTTP status boilerplate from plain errors", () => {
    expect(userFacingMessage("429 - Too Many Requests: Try again shortly."))
      .toBe("Try again shortly.");
    expect(userFacingMessage("portal 503 Service Unavailable: Deployment service is offline."))
      .toBe("Deployment service is offline.");
  });

  it("leaves normal success and failure messages unchanged", () => {
    expect(userFacingMessage("Your VM is ready.")).toBe("Your VM is ready.");
    expect(userFacingMessage(new Error("The VM name already exists.")))
      .toBe("The VM name already exists.");
  });
});
