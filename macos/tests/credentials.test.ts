import { describe, expect, it, vi } from "vitest";
import { macCredentials } from "../ui/credentials";

describe("Mac Keychain bridge", () => {
  it("waits for the actual OS decision instead of a five-second timer", async () => {
    vi.useFakeTimers();
    try {
      let reply!: (value: unknown) => void;
      const store = macCredentials(() => ({
        postMessage: () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      }));
      let finished = false;
      const read = store.read().then((value) => {
        finished = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(30000);
      expect(finished).toBe(false);
      reply("saved-credential-record");
      expect(await read).toBe("saved-credential-record");
    } finally {
      vi.useRealTimers();
    }
  });
  it("never falls back to browser storage when the native bridge is absent", async () => {
    await expect(macCredentials(() => undefined).read()).rejects.toThrow(
      "bridge is unavailable",
    );
  });
  it("requires a confirmed write and validates read responses", async () => {
    const invalid = macCredentials(() => ({ postMessage: async () => null }));
    await expect(invalid.read()).rejects.toThrow("invalid response");
    await expect(invalid.write("record")).rejects.toThrow("did not confirm");
    const postMessage = vi.fn(async () => true);
    await macCredentials(() => ({ postMessage })).write("");
    expect(postMessage).toHaveBeenCalledWith({ operation: "write", value: "" });
  });
});
