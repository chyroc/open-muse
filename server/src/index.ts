import { authenticate, checkOrigin } from "./auth";
import { backgroundReady, HttpError, json, type Env } from "./env";
import { Repository } from "./repository";
import { validateTime } from "./schedule";
import { tick } from "./jobs";

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "Use an application/json request.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) throw new HttpError(400, "A JSON object is required.");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "A valid JSON object is required.");
  } finally {
    reader.releaseLock();
  }
}

export async function handle(request: Request, env: Env): Promise<Response> {
  let origin: string | null = null;
  let response: Response;
  try {
    origin = checkOrigin(request, env);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!origin) throw new HttpError(403, "An allowed origin is required.");
      response = new Response(null, { status: 204 });
    } else if (url.pathname === "/health" && request.method === "GET") {
      response = json({ ok: true, service: "open-muse-server" });
    } else {
      const owner = await authenticate(request, env);
      const repo = new Repository(env.DB, owner);
      if (url.pathname === "/v1/status" && request.method === "GET") {
        response = json({
          connected: true,
          owner,
          backgroundReady: backgroundReady(env),
          schedule: await repo.schedule(),
        });
      } else if (url.pathname === "/v1/schedule" && request.method === "PUT") {
        const input = await body(request);
        if (
          Object.keys(input).some(
            (k) =>
              ![
                "enabled",
                "timezone",
                "local_time",
                "revision",
                "confirm",
              ].includes(k),
          ) ||
          typeof input.enabled !== "boolean" ||
          !Number.isSafeInteger(input.revision) ||
          (input.revision as number) < 0
        )
          throw new HttpError(400, "Invalid schedule settings.");
        validateTime(input.timezone, input.local_time);
        if (input.enabled && (input.confirm !== true || !backgroundReady(env)))
          throw new HttpError(
            409,
            "Background authorization and explicit consent are required before enabling the schedule.",
          );
        response = json(
          await repo.saveSchedule(
            {
              enabled: input.enabled,
              timezone: input.timezone,
              local_time: input.local_time as string,
              revision: input.revision as number,
            },
            Date.now(),
          ),
        );
      } else if (url.pathname === "/v1/runs" && request.method === "POST") {
        const input = await body(request);
        if (
          input.confirm !== true ||
          Object.keys(input).some((k) => k !== "confirm")
        )
          throw new HttpError(
            400,
            "Confirm this background generation explicitly.",
          );
        if (!backgroundReady(env))
          throw new HttpError(
            409,
            "Background MA access is not configured or is disabled.",
          );
        const key = request.headers.get("Idempotency-Key") ?? "";
        if (!/^[\w-]{16,80}$/.test(key))
          throw new HttpError(
            400,
            "Provide a stable Idempotency-Key for this action.",
          );
        response = json(
          await repo.enqueue(`manual:${key}`, Date.now(), Date.now()),
          202,
        );
      } else if (url.pathname === "/v1/runs" && request.method === "GET") {
        response = json({ runs: await repo.runs() });
      } else if (url.pathname === "/v1/feed" && request.method === "GET") {
        const cursor = url.searchParams.get("after") ?? "0";
        if (!/^\d{1,15}$/.test(cursor))
          throw new HttpError(400, "Invalid feed cursor.");
        response = json(await repo.feed(Number(cursor)));
      } else if (
        /^\/v1\/runs\/[\w-]{1,80}\/recheck$/.test(url.pathname) &&
        request.method === "POST"
      ) {
        if ((await body(request)).confirm !== true || !backgroundReady(env))
          throw new HttpError(
            409,
            "Review and confirm before resuming checks.",
          );
        await repo.recheck(url.pathname.split("/")[3], Date.now());
        response = json({ ok: true });
      } else throw new HttpError(404, "Endpoint not found.");
    }
  } catch (error) {
    response = json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "The service could not complete this request.",
      },
      error instanceof HttpError ? error.status : 500,
    );
  }
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, OPTIONS",
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Idempotency-Key",
    );
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export default {
  fetch: handle,
  async scheduled(_event, env) {
    await tick(env);
  },
} satisfies ExportedHandler<Env>;
