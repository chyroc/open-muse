import { describe, expect, it, vi } from "vitest";
import { exportBackgroundConfiguration } from "../src/direct/background-export";
import type { DirectAuth } from "../src/direct/auth";
import type { DirectWorkspace } from "../src/direct/workspace";
import type { DirectIdentity } from "../src/direct/identity";
import type { ArkClient } from "../shared/ark";

function fixture() {
  const auth = {
    value: {
      apiKey: "test-existing-app-api-key",
      project: "test-project",
      accessKeyId: "private-access-key",
      secretKey: "private-secret-key",
      sessionToken: "private-session-token",
      refreshToken: "private-refresh-token",
      apiKeyId: "private-key-id",
      expiresAt: 100,
    },
  };
  const workspace = {
    selection: vi.fn(async () => ({
      agent: "agent-current",
      environment_id: "env-current",
    })),
  };
  const companion = { storeId: vi.fn(async () => "memory-current") };
  const ark = {
    request: vi.fn(async () => ({ id: "agent-current", version: 7 })),
  };
  const run = (confirm = true) =>
    exportBackgroundConfiguration(
      confirm,
      auth as unknown as DirectAuth,
      workspace as unknown as DirectWorkspace,
      companion as unknown as DirectIdentity,
      ark as unknown as ArkClient,
    );
  return { auth, workspace, companion, ark, run };
}
describe("Explicit export of existing Ark workspace", () => {
  it("exports only the current data-plane key and prepared resource references", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({
      apiKey: f.auth.value.apiKey,
      project: "test-project",
      agentId: "agent-current",
      agentVersion: 7,
      environmentId: "env-current",
      memoryStoreId: "memory-current",
    });
    expect(f.ark.request).toHaveBeenCalledExactlyOnceWith(
      "/agents/agent-current",
    );
    const result = JSON.stringify(await f.run());
    for (const value of [
      "private-access-key",
      "private-secret-key",
      "private-refresh-token",
      "private-session-token",
      "private-key-id",
    ])
      expect(result).not.toContain(value);
  });
  it("does not read credentials or access Ark before explicit consent", async () => {
    const f = fixture();
    await expect(f.run(false)).rejects.toThrow("Confirm uploading");
    expect(f.workspace.selection).not.toHaveBeenCalled();
    expect(f.ark.request).not.toHaveBeenCalled();
  });
  it("does not create a separate workspace or memory store", async () => {
    const f = fixture();
    f.workspace.selection.mockRejectedValue(
      new Error("Prepare your workspace first"),
    );
    await expect(f.run()).rejects.toThrow("Prepare your workspace");
    expect(f.ark.request).not.toHaveBeenCalled();
    const missing = fixture();
    missing.companion.storeId.mockResolvedValue(undefined as unknown as string);
    await expect(missing.run()).rejects.toThrow("personal memory");
    expect(missing.ark.request).not.toHaveBeenCalled();
  });
  it("rejects login changes during export", async () => {
    const f = fixture();
    f.ark.request.mockImplementationOnce(async () => {
      f.auth.value = { ...f.auth.value, apiKey: "test-other-app-api-key" };
      return { id: "agent-current", version: 7 };
    });
    await expect(f.run()).rejects.toThrow("login changed");
  });
  it("rejects mismatched resources and malformed versions without echoing credentials", async () => {
    const f = fixture();
    f.ark.request.mockResolvedValueOnce({ id: "agent-wrong", version: 7 });
    await expect(f.run()).rejects.toThrow("did not match");
    f.ark.request.mockResolvedValueOnce({ id: "agent-current", version: 0 });
    await expect(f.run()).rejects.toThrow("workspace is incomplete");
  });
});
