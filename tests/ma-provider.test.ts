import { describe, expect, it, vi } from "vitest";
import { ArkClient } from "../shared/ark";
import { digest } from "../shared/crypto";
import { arkProvider, claudeProvider, maProvider } from "../shared/ma-provider";
import { accountWorkspaceKey } from "../shared/workspace-key";
import { agentSpec, DEFAULT_MODEL } from "../shared/workspace-spec";
import { MA, MA_BASE_URL } from "../src/direct/transport";

const credential = { apiKey: "test-ma-key-0123456789", project: "team" };
function client(provider = arkProvider, response = () => Response.json({})) {
  const fetcher = vi.fn<typeof fetch>(async () => response());
  const ark = new ArkClient(
    {
      arkBaseUrl: provider.baseUrl,
      arkKey: credential.apiKey,
      project: credential.project,
      provider,
    },
    fetcher,
  );
  const sent = (n = 0) => {
    const [url, init] = fetcher.mock.calls[n];
    return { url: String(url), headers: new Headers(init?.headers), init };
  };
  return { ark, fetcher, sent };
}

describe("Managed Agents backends", () => {
  it("uses Volcano Ark unless configured otherwise", () => {
    expect(maProvider(undefined)).toBe(arkProvider);
    expect(maProvider("")).toBe(arkProvider);
    expect(maProvider("claude")).toBe(claudeProvider);
    expect(() => maProvider("openai")).toThrow("Unknown");
    expect(() => maProvider("toString")).toThrow("Unknown");
    expect(MA).toBe(arkProvider);
    expect(MA_BASE_URL).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });

  it("keeps Ark requests exactly as before", async () => {
    const f = client();
    await f.ark.request("/agents?limit=1");
    const { url, headers } = f.sent();
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/agents?limit=1");
    expect(headers.get("Authorization")).toBe(`Bearer ${credential.apiKey}`);
    expect(headers.get("X-Project-Name")).toBe("team");
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.has("anthropic-beta")).toBe(false);
  });

  it("keeps Ark workspace keys and agents unchanged", () => {
    expect(accountWorkspaceKey("key", "project", "owner")).toBe(
      digest(
        JSON.stringify([
          "https://ark.cn-beijing.volces.com/api/v3",
          "key",
          "project",
          "muse-account",
          "owner",
        ]),
      ),
    );
    expect(
      accountWorkspaceKey("key", "project", "owner", claudeProvider),
    ).not.toBe(accountWorkspaceKey("key", "project", "owner"));
    expect(agentSpec(DEFAULT_MODEL).tools[0].type).toBe(
      "agent_toolset_20260701",
    );
    expect(DEFAULT_MODEL).toBe(arkProvider.defaultModel);
  });

  it("speaks the Claude Managed Agents API with its own headers", async () => {
    const f = client(claudeProvider);
    await f.ark.request("/sessions/s1/events?order=asc");
    await f.ark.request("/memory_stores/m1/memories");
    await f.ark.stream("s1", new AbortController().signal);
    const first = f.sent(0);
    expect(first.url).toBe(
      "https://api.anthropic.com/v1/sessions/s1/events?order=asc",
    );
    expect(first.headers.get("x-api-key")).toBe(credential.apiKey);
    expect(first.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(first.headers.get("anthropic-beta")).toBe(
      "managed-agents-2026-04-01",
    );
    expect(first.headers.get("anthropic-dangerous-direct-browser-access")).toBe(
      "true",
    );
    // Projects are an Ark concept.
    expect(first.headers.has("Authorization")).toBe(false);
    expect(first.headers.has("X-Project-Name")).toBe(false);
    expect(f.sent(1).headers.get("anthropic-beta")).toBe(
      "agent-memory-2026-07-22",
    );
    expect(f.sent(2).url).toBe(
      "https://api.anthropic.com/v1/sessions/s1/events/stream",
    );
    expect(f.sent(2).headers.get("x-api-key")).toBe(credential.apiKey);
    expect(agentSpec("claude-opus-5-5", claudeProvider).tools[0].type).toBe(
      "agent_toolset_20260401",
    );
  });

  it("leaves out Ark-only conversation models on Claude", async () => {
    const selection = {
      agent: "agent_1",
      environment_id: "env_1",
      model: { id: "doubao-seed-2-1-pro-260915", reasoning_effort: "high" },
    };
    const reply = () => Response.json({ id: "sesn_1" });
    const ark = client(arkProvider, reply);
    await ark.ark.create("Hello", "general", selection);
    expect(JSON.parse(String(ark.sent().init?.body)).agent).toEqual({
      type: "agent_with_overrides",
      id: "agent_1",
      model: selection.model,
    });
    const claude = client(claudeProvider, reply);
    await claude.ark.create("Hello", "general", selection);
    expect(JSON.parse(String(claude.sent().init?.body)).agent).toBe("agent_1");
  });

  it("reports each backend's own request ID and name", async () => {
    const failing = (header: string) => () =>
      new Response("{}", {
        status: 400,
        headers: { [header]: "req_0123456789" },
      });
    await expect(
      client(arkProvider, failing("x-request-id")).ark.request("/agents"),
    ).rejects.toThrow(
      /^Ark request failed \(HTTP 400; Request ID req_0123456789/,
    );
    await expect(
      client(claudeProvider, failing("request-id")).ark.request("/agents"),
    ).rejects.toThrow(
      /^Claude request failed \(HTTP 400; Request ID req_0123456789/,
    );
  });
});
