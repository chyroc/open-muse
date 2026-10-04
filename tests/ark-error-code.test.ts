import { describe, expect, it } from "vitest";
import { ApiError, ArkClient } from "../shared/ark";
import { zhCN } from "../shared/locales/zh-CN";

const ark = (body: object, status = 400) =>
  new ArkClient(
    {
      arkBaseUrl: "https://ark.test/api/v3",
      arkKey: "secret-key",
      project: "p",
    },
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

describe("Ark error codes", () => {
  it("keeps the backend's code on the error", async () => {
    const error = (await ark({
      error: {
        code: "RequiresActionRejected",
        message:
          "Invalid user.message event at events[0]: waiting on responses to events [sevt-1]",
        type: "Bad Request",
      },
    })
      .request("/sessions/s/events", { method: "POST", body: "{}" })
      .catch((reason: ApiError) => reason)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("RequiresActionRejected");
  });
  it("never takes the key for a code", async () => {
    const error = (await ark({ error: { code: "secret-key", message: "x" } })
      .request("/models")
      .catch((reason: ApiError) => reason)) as ApiError;
    expect(error.code).toBeUndefined();
    expect(error.message).not.toContain("secret-key");
  });
  it("translates the waiting-request message", () => {
    expect(
      zhCN[
        "Answer the request waiting in the chat first, then open the browser."
      ],
    ).toBeTruthy();
  });
});
