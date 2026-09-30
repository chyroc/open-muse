import { authenticate, checkOrigin } from "./auth";
import { HttpError, json, type Env } from "./env";

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
      if (url.pathname === "/v1/status" && request.method === "GET") {
        await env.DB.prepare("SELECT 1").first();
        response = json({ connected: true, owner, backgroundReady: false });
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

export default { fetch: handle } satisfies ExportedHandler<Env>;
