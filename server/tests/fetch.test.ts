import { describe, expect, it } from "vitest";
import { noRedirect } from "../src/fetch";

describe("Upstream fetch on Workers", () => {
  it("never asks the runtime to follow or reject redirects itself", async () => {
    const seen: RequestInit[] = [];
    const guarded = noRedirect(async (_input, init) => {
      seen.push(init ?? {});
      return new Response("{}", { status: 200 });
    });
    const response = await guarded("https://example.com/x", {
      redirect: "error",
      headers: { Authorization: "Bearer test" },
    });
    expect(response.status).toBe(200);
    expect(seen[0].redirect).toBe("manual");
    expect(new Headers(seen[0].headers).get("Authorization")).toBe(
      "Bearer test",
    );
  });

  it("fails a redirect response instead of following it", async () => {
    for (const status of [301, 302, 307, 308]) {
      const guarded = noRedirect(
        async () =>
          new Response(null, {
            status,
            headers: { Location: "https://elsewhere.example/" },
          }),
      );
      await expect(guarded("https://example.com/x")).rejects.toThrow(
        TypeError,
      );
    }
  });
});
