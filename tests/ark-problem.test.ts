import { describe, expect, it } from "vitest";
import { ApiError, ArkClient } from "../shared/ark";
import {
  arkProblem,
  arkProblemText,
  refusedModel,
} from "../shared/ark-problem";
import { t } from "../shared/i18n";

const refused = (status: number, body: object) =>
  new ArkClient(
    {
      arkBaseUrl: "https://ark.test/api/v3",
      arkKey: "secret-key-0001",
      project: "",
    },
    async () =>
      Response.json(body, {
        status,
        headers: { "x-request-id": "req-0123456789" },
      }),
  )
    .request("/agents", { method: "POST", body: "{}" })
    .catch((error: ApiError) => error) as Promise<ApiError>;
const modelMessage =
  'model.id: endpoint "doubao-seed-2-1-pro-260915" is invalid: get endpoint meta doubao-seed-2-1-pro-260915: the model or endpoint does not exist or you do not have access to it';

describe("Ark refusals", () => {
  it("tells why from the status, code, and message", () => {
    expect(arkProblem(400, "InvalidParameter", modelMessage)).toBe(
      "model_unavailable",
    );
    expect(arkProblem(404, "ModelNotOpen")).toBe("model_unavailable");
    expect(arkProblem(401, "AuthenticationError")).toBe("invalid_key");
    expect(arkProblem(403, "AccountOverdueError", "account overdue")).toBe(
      "account_overdue",
    );
    expect(arkProblem(429, "RateLimitExceeded")).toBe("rate_limited");
    expect(arkProblem(403, "AccessDenied")).toBe("access_denied");
    expect(arkProblem(404)).toBe("not_found");
    expect(arkProblem(400, "InvalidParameter", "name too long")).toBe(
      "rejected",
    );
    expect(arkProblem(502)).toBe("unavailable");
    expect(refusedModel(modelMessage)).toBe("doubao-seed-2-1-pro-260915");
  });
  it("leads with what to do and keeps the reference for support", async () => {
    const error = await refused(400, {
      error: { code: "InvalidParameter", message: modelMessage },
    });
    expect(error.problem).toBe("model_unavailable");
    expect(error.model).toBe("doubao-seed-2-1-pro-260915");
    expect(error.message).toMatch(
      /^Your Ark account cannot use the model doubao-seed-2-1-pro-260915 yet\. Enable it under Model activation/,
    );
    expect(error.message).toContain("HTTP 400");
    expect(error.message).toContain("Request ID req-0123456789");
    expect(error.message).not.toContain("you do not have access");
    const key = await refused(401, { error: { code: "AuthenticationError" } });
    expect(key.message).toMatch(/^Ark rejected this API key/);
  });
  it("never names the key as a model", async () => {
    const error = await refused(400, {
      error: {
        code: "InvalidParameter",
        message:
          'endpoint "secret-key-0001" is invalid: the model or endpoint does not exist or you do not have access to it',
      },
    });
    expect(error.model).toBeUndefined();
    expect(error.message).not.toContain("secret-key-0001");
  });
  it("names Ark in the selected language", () => {
    expect(
      t(
        "{service} rejected this API key. Check it, or use a different key.",
        { service: t("Ark", {}, "zh-CN") },
        "zh-CN",
      ),
    ).toBe("方舟拒绝了这个 API Key。请检查它，或换一个 Key。");
    expect(arkProblemText("rate_limited", { service: "Claude" })).toBe(
      "Claude is receiving too many requests right now. Try again in a moment.",
    );
  });
});
