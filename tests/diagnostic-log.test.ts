import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ArkClient } from "../shared/ark";
import {
  failureLines,
  recentFailures,
  recordFailure,
} from "../shared/diagnostic-log";
import { reportText } from "../src/ReportSheet";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

const key = "ark-secret-key-000000000001";
const ark = (response: () => Promise<Response>) =>
  new ArkClient(
    { arkBaseUrl: "https://ark.test/api/v3", arkKey: key, project: "" },
    response,
  );

describe("Recent failed requests", () => {
  it("keeps only the request, status, code, and request ID", () => {
    vi.stubGlobal("localStorage", storage());
    recordFailure(
      {
        via: "ark",
        request: "POST /agents",
        status: 404,
        code: "NotFound",
        requestId: "20261011-req-0001",
      },
      Date.UTC(2026, 9, 11, 7, 0, 0),
    );
    // Anything outside the narrow patterns is dropped, never kept as text.
    recordFailure({
      via: "service",
      request: "GET /v1/status",
      status: 0,
      code: "has spaces and a key " + key,
      requestId: "short",
      detail: "Ark said: <secret> & more",
    });
    recordFailure({
      via: "ark",
      request: "GET /sessions/a note a person wrote",
      status: 500,
    });
    expect(recentFailures()).toEqual([
      {
        at: Date.UTC(2026, 9, 11, 7, 0, 0),
        via: "ark",
        request: "POST /agents",
        status: 404,
        code: "NotFound",
        requestId: "20261011-req-0001",
      },
      expect.objectContaining({
        via: "service",
        request: "GET /v1/status",
        status: 0,
      }),
    ]);
    expect(recentFailures()[1]).not.toHaveProperty("code");
    expect(recentFailures()[1]).not.toHaveProperty("detail");
    expect(failureLines()[0]).toBe(
      "2026-10-11T07:00:00Z ark POST /agents HTTP 404 NotFound request 20261011-req-0001",
    );
    expect(failureLines()[1]).toMatch(/service GET \/v1\/status no answer$/);
    expect(JSON.stringify(recentFailures())).not.toContain(key);
  });

  it("keeps the last twenty", () => {
    vi.stubGlobal("localStorage", storage());
    for (let i = 0; i < 25; i++)
      recordFailure({ via: "ark", request: "GET /agents", status: 500 + i });
    const kept = recentFailures();
    expect(kept).toHaveLength(20);
    expect(kept[0].status).toBe(505);
    expect(kept.at(-1)!.status).toBe(524);
  });

  it("does nothing where there is no local storage", () => {
    expect(() =>
      recordFailure({ via: "ark", request: "GET /agents", status: 500 }),
    ).not.toThrow();
    expect(recentFailures()).toEqual([]);
  });

  it("records a refused Ark request with its IDs left out, and carries a diagnostic for the service to relay", async () => {
    vi.stubGlobal("localStorage", storage());
    const error = (await ark(async () =>
      Response.json(
        { error: { code: "NotFound", message: `no agent for ${key}` } },
        { status: 404, headers: { "x-request-id": "20261011-req-0002" } },
      ),
    )
      .request("/agents/agent-20261011074430-5aua6", { method: "POST" })
      .catch((error: ApiError) => error)) as ApiError;
    expect(error.diagnostic).toBe(
      "POST /agents/:id; HTTP 404; NotFound; Request ID 20261011-req-0002",
    );
    expect(recentFailures()).toEqual([
      expect.objectContaining({
        via: "ark",
        request: "POST /agents/:id",
        status: 404,
        code: "NotFound",
        requestId: "20261011-req-0002",
      }),
    ]);
    expect(JSON.stringify(recentFailures())).not.toContain("5aua6");
  });

  it("records a request that got no answer", async () => {
    vi.stubGlobal("localStorage", storage());
    await ark(async () => {
      const error = new Error("No answer");
      error.name = "NetworkError";
      throw error;
    })
      .request("/sessions/sesn-1/events?limit=10")
      .catch(() => undefined);
    expect(recentFailures()).toEqual([
      expect.objectContaining({
        request: "GET /sessions/:id/events",
        status: 0,
        code: "NetworkError",
      }),
    ]);
  });

  it("adds them to a problem report", () => {
    const text = reportText("It failed.", [], "iOS 27.0.1", [
      "2026-10-11T07:00:00Z ark POST /agents HTTP 404 NotFound",
    ]);
    expect(text).toContain(
      "Recent failed requests:\n2026-10-11T07:00:00Z ark POST /agents HTTP 404 NotFound",
    );
    expect(reportText("x", [], "iOS", [])).not.toContain("Recent failed");
  });
});
