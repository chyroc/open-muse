import { describe, expect, it } from "vitest";
import { digest } from "../../shared/crypto";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import type { Client } from "../../src/api";
import { MA_BASE_URL } from "../../src/direct/transport";
import { macOwner } from "../ui/owner";

const client = (account?: string) =>
  ({
    identity: {
      value: { apiKey: "shared-key", project: "p" },
      accountOwner: () => account,
    },
  }) as unknown as Client;

describe("Mac local record scope", () => {
  it("keeps the device scope when no account is signed in", () => {
    expect(macOwner(client())).toBe(
      digest(JSON.stringify([MA_BASE_URL, "shared-key", "p"])),
    );
  });
  it("separates accounts that share one Ark key", () => {
    const first = macOwner(client("muse_user_a"));
    const second = macOwner(client("muse_user_b"));
    expect(first).not.toBe(second);
    expect(first).not.toBe(macOwner(client()));
    // The same scope the shared client and the service use for the account.
    expect(first).toBe(accountWorkspaceKey("shared-key", "p", "muse_user_a"));
  });
  it("has no scope while disconnected", () => {
    expect(
      macOwner({ identity: { value: undefined } } as unknown as Client),
    ).toBe("disconnected");
  });
});
