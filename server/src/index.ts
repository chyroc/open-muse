import { edgeFetch } from "./fetch";
import { checkOrigin, verifiedAccount } from "./auth";
import { deleteAccount } from "./account-deletion";
import { backgroundReady, HttpError, json, maEndpoint, type Env } from "./env";
import { Repository } from "./repository";
import { validateTime } from "./schedule";
import { tick } from "./jobs";
import { ConnectionStore, credentialStorageReady } from "./connection";
import { backgroundWorkspaceSchema } from "../../shared/background-connection";
import { ArkRemote } from "./ark";
import { AccountCredentials, rewrapRetiredKeys } from "./account";
import { AccountWorkspaces } from "./workspace";
import { accountCredentialSchema } from "../../shared/account-credential";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import { externalScheduler, TRIGGER_PATH, verifyTrigger } from "./trigger";
import { UpcomingDelivery, upcomingInput } from "./upcoming";
import { AccountDevices, deviceInput, validDeviceId } from "./devices";
import { BrowserViews, relay } from "./browser";
import { LarkStates, MAX_LARK_STATE, sandboxState, tokenOwner } from "./lark";
import { LarkConnections } from "./lark-connect";
import { AccountSync, pullInput, pushInput } from "./sync";
import { SYNC_LIMITS } from "../../shared/account-sync";
import { ProactiveClaims } from "./claims";
import { claimInput } from "../../shared/proactive";
import { health, heartbeat } from "./health";
import { exportAccount } from "./account-export";
import {
  AccountWebhooks,
  receiveWebhook,
  webhookIngress,
  webhookInput,
} from "./webhooks";

async function runScheduler(env: Env) {
  // Resealing under a rotated key runs in bounded batches each tick, so a
  // rotation completes without user action.
  await heartbeat(env, async () => {
    await rewrapRetiredKeys(env).catch(() => {});
    await tick(env);
  });
}

async function body(
  request: Request,
  limit = 4096,
): Promise<Record<string, unknown>> {
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
      if (size > limit) {
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

export async function handle(
  request: Request,
  env: Env,
  fetcher: typeof fetch = edgeFetch,
): Promise<Response> {
  let origin: string | null = null;
  let response: Response;
  try {
    const url = new URL(request.url);
    // Incoming webhooks are posted by external systems with any Origin or
    // none. Only this one route skips the origin check: it is authenticated
    // by the hook's own secret and never gets CORS headers.
    const hook = webhookIngress(url.pathname, request.method);
    origin = hook ? null : checkOrigin(request, env);
    if (request.method === "OPTIONS") {
      if (!origin) throw new HttpError(403, "An allowed origin is required.");
      response = new Response(null, { status: 204 });
    } else if (url.pathname === "/health" && request.method === "GET") {
      const result = await health(env);
      response = json(result.body, result.status);
    } else if (url.pathname === TRIGGER_PATH && request.method === "POST") {
      // Server-to-server only: no browser origin, no user identity.
      if (request.headers.has("Origin"))
        throw new HttpError(403, "This application origin is not allowed.");
      await verifyTrigger(request, env);
      await runScheduler(env);
      response = json({ ok: true });
    } else if (
      /^\/v1\/browser\/relay\/[\w-]{1,80}$/.test(url.pathname) &&
      request.method === "POST"
    ) {
      // The cloud browser helper in an MA sandbox, holding only its view's
      // token: server-to-server, no account session and no browser origin.
      if (request.headers.has("Origin"))
        throw new HttpError(403, "This application origin is not allowed.");
      const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(
        request.headers.get("Authorization") ?? "",
      )?.[1];
      response = json(
        await relay(
          env,
          url.pathname.split("/")[4],
          token ?? "",
          await body(request, 800_000),
          Date.now(),
        ),
      );
    } else if (
      url.pathname === "/v1/lark/sandbox/credentials" &&
      request.method === "GET"
    ) {
      // lark-cli in an MA sandbox asks for a current user token with the
      // conversation's token: server-to-server, no account session or origin.
      if (request.headers.has("Origin"))
        throw new HttpError(403, "This application origin is not allowed.");
      const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(
        request.headers.get("Authorization") ?? "",
      )?.[1];
      const owner = await tokenOwner(env, token ?? "", Date.now());
      response = json(
        await new LarkConnections(env, owner, fetcher).sandboxToken(),
      );
    } else if (url.pathname === "/v1/lark/sandbox/state") {
      // lark-cli in an MA sandbox, holding only the token the app issued for
      // its conversation: server-to-server, no account session or origin.
      if (request.headers.has("Origin"))
        throw new HttpError(403, "This application origin is not allowed.");
      if (request.method !== "GET" && request.method !== "PUT")
        throw new HttpError(404, "Endpoint not found.");
      const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(
        request.headers.get("Authorization") ?? "",
      )?.[1];
      response = json(
        await sandboxState(
          env,
          token ?? "",
          request.method,
          request.method === "PUT"
            ? await body(request, MAX_LARK_STATE + 1024)
            : undefined,
          Date.now(),
        ),
      );
    } else if (hook) {
      const result = await receiveWebhook(
        env,
        hook,
        request,
        Date.now(),
        fetcher,
      );
      response = json(
        result,
        "status" in result && result.status === "unconfirmed" ? 202 : 200,
      );
    } else {
      // Always a verified Open Muse account; see authenticate().
      const { owner, userId } = await verifiedAccount(request, env, fetcher);
      await new AccountCredentials(env, owner).seen(Date.now());
      const repo = new Repository(env.DB, owner);
      const connections = new ConnectionStore(env, owner);
      const ready = async () => {
        try {
          const connection = await connections.resolve();
          return Boolean(connection && backgroundReady(connection.env));
        } catch {
          return false;
        }
      };
      const binding = async () => {
        const connection = await connections.resolve();
        if (!connection || !backgroundReady(connection.env))
          throw new HttpError(
            409,
            "Background MA access is not configured or is disabled.",
          );
        return {
          revision: connection.revision,
          hash: await new ArkRemote(connection.env).fingerprint(),
        };
      };
      if (url.pathname === "/v1/status" && request.method === "GET") {
        response = json({
          connected: true,
          owner,
          backgroundReady: await ready(),
          credentialStorageReady: credentialStorageReady(env),
          account: {
            provider: "supabase",
            credential: await new AccountCredentials(env, owner).status(),
          },
          upcoming: await new UpcomingDelivery(env, owner).status(),
          connection: await connections.status(),
          schedule: await repo.schedule(),
        });
      } else if (
        url.pathname === "/v1/account/workspace/reconcile" &&
        request.method === "POST"
      ) {
        const input = await body(request);
        if (
          input.confirm !== true ||
          !Number.isSafeInteger(input.revision) ||
          !Number.isSafeInteger(input.credentialRevision) ||
          (input.mode !== undefined &&
            !["adopt", "discard"].includes(input.mode as string)) ||
          // Adopting names the values the user reviewed.
          (input.mode === "adopt") !==
            (typeof input.expected === "string" &&
              /^[a-f0-9]{64}$/.test(input.expected)) ||
          Object.keys(input).some(
            (key) =>
              ![
                "revision",
                "credentialRevision",
                "mode",
                "expected",
                "confirm",
              ].includes(key),
          )
        )
          throw new HttpError(400, "Confirm checking the workspace settings.");
        response = json(
          await new AccountWorkspaces(env, owner, fetcher).reconcile(
            input.revision as number,
            input.credentialRevision as number,
            (input.mode as "adopt" | "discard" | undefined) ?? "check",
            Date.now(),
            input.expected as string | undefined,
          ),
        );
      } else if (
        url.pathname === "/v1/account/workspace/compare" &&
        request.method === "POST"
      ) {
        const input = await body(request);
        if (
          input.confirm !== true ||
          !Number.isSafeInteger(input.revision) ||
          !Number.isSafeInteger(input.credentialRevision) ||
          Object.keys(input).some(
            (key) =>
              !["revision", "credentialRevision", "confirm"].includes(key),
          )
        )
          throw new HttpError(400, "Confirm checking the workspace settings.");
        response = json(
          await new AccountWorkspaces(env, owner, fetcher).compare(
            input.revision as number,
            input.credentialRevision as number,
          ),
        );
      } else if (
        url.pathname === "/v1/account/workspace/settings" &&
        request.method === "PUT"
      ) {
        const input = await body(request, 131072);
        if (
          input.confirm !== true ||
          !["agent", "environment"].includes(input.kind as string) ||
          !Number.isSafeInteger(input.revision) ||
          !Number.isSafeInteger(input.credentialRevision) ||
          Object.keys(input).some(
            (key) =>
              ![
                "kind",
                "changes",
                "revision",
                "credentialRevision",
                "confirm",
              ].includes(key),
          )
        )
          throw new HttpError(400, "Confirm a valid workspace change.");
        response = json(
          await new AccountWorkspaces(env, owner, fetcher).update(
            input.kind as "agent" | "environment",
            input.changes,
            input.revision as number,
            input.credentialRevision as number,
          ),
        );
      } else if (url.pathname === "/v1/account/workspace") {
        const workspaces = new AccountWorkspaces(env, owner, fetcher);
        if (request.method === "GET") response = json(await workspaces.read());
        else if (request.method === "POST") {
          const input = await body(request);
          if (
            input.confirm !== true ||
            !Number.isSafeInteger(input.credentialRevision) ||
            (input.replaceUnconfirmed !== undefined &&
              typeof input.replaceUnconfirmed !== "boolean") ||
            (input.resetSettings !== undefined &&
              typeof input.resetSettings !== "boolean") ||
            Object.keys(input).some(
              (key) =>
                ![
                  "credentialRevision",
                  "replaceUnconfirmed",
                  "resetSettings",
                  "confirm",
                ].includes(key),
            )
          )
            throw new HttpError(400, "Confirm preparing the workspace.");
          response = json(
            await workspaces.provision(
              input.credentialRevision as number,
              input.replaceUnconfirmed === true,
              input.resetSettings === true,
            ),
          );
        } else throw new HttpError(405, "Method not allowed.");
      } else if (url.pathname.startsWith("/v1/account/devices")) {
        const devices = new AccountDevices(env, owner);
        const id = /^\/v1\/account\/devices\/([^/]+)$/.exec(url.pathname)?.[1];
        if (url.pathname === "/v1/account/devices" && request.method === "GET")
          response = json(await devices.list());
        else if (id && request.method === "PUT")
          response = json(
            await devices.register(
              validDeviceId(id),
              deviceInput(await body(request, 1024)),
            ),
          );
        else if (id && request.method === "DELETE")
          response = json(await devices.forget(validDeviceId(id)));
        else throw new HttpError(404, "Endpoint not found.");
      } else if (url.pathname.startsWith("/v1/browser/views")) {
        const views = new BrowserViews(env, owner);
        const [, id, part] =
          /^\/v1\/browser\/views(?:\/([^/]+)(?:\/(frame|input))?)?$/.exec(
            url.pathname,
          ) ?? [];
        const now = Date.now();
        if (!id && !part && request.method === "POST")
          response = json(await views.open(now));
        else if (id && part === "frame" && request.method === "GET")
          response = json(
            await views.frame(
              id,
              Math.max(0, Number(url.searchParams.get("after")) || 0),
              now,
            ),
          );
        else if (id && part === "input" && request.method === "POST")
          response = json(
            await views.input(id, (await body(request, 8192)).events, now),
          );
        else if (id && !part && request.method === "DELETE")
          response = json(await views.close(id, now));
        else throw new HttpError(404, "Endpoint not found.");
      } else if (
        url.pathname === "/v1/lark/tokens" &&
        request.method === "POST"
      ) {
        response = json(await new LarkStates(env, owner).issue(Date.now()));
      } else if (url.pathname === "/v1/lark/connect") {
        const connection = new LarkConnections(env, owner, fetcher);
        if (request.method === "GET") response = json(await connection.status());
        else if (request.method === "POST")
          response = json(await connection.start());
        else if (request.method === "DELETE")
          response = json(await connection.disconnect());
        else throw new HttpError(404, "Endpoint not found.");
      } else if (url.pathname === "/v1/lark/state") {
        const states = new LarkStates(env, owner);
        if (request.method === "GET") response = json(await states.status());
        else if (request.method === "DELETE")
          response = json(await states.remove());
        else throw new HttpError(404, "Endpoint not found.");
      } else if (url.pathname.startsWith("/v1/account/webhooks")) {
        const webhooks = new AccountWebhooks(env, owner);
        const id = /^\/v1\/account\/webhooks\/([^/]+)$/.exec(
          url.pathname,
        )?.[1];
        if (url.pathname === "/v1/account/webhooks" && request.method === "GET")
          response = json(await webhooks.list(await ready()));
        else if (
          url.pathname === "/v1/account/webhooks" &&
          request.method === "POST"
        )
          response = json(
            await webhooks.create(webhookInput(await body(request, 1024))),
          );
        else if (id && request.method === "DELETE")
          response = json(await webhooks.revoke(id));
        else throw new HttpError(404, "Endpoint not found.");
      } else if (url.pathname === "/v1/account/sync") {
        const sync = new AccountSync(env, owner);
        if (request.method === "GET") {
          const input = pullInput(url.searchParams);
          response = json(await sync.pull(input.workspace, input.after));
        } else if (request.method === "PUT")
          response = json(
            await sync.push(
              pushInput(await body(request, SYNC_LIMITS.bodyBytes)),
            ),
          );
        else throw new HttpError(405, "Method not allowed.");
      } else if (url.pathname === "/v1/account/upcoming") {
        const upcoming = new UpcomingDelivery(env, owner, fetcher);
        if (request.method === "GET") response = json(await upcoming.read());
        else if (request.method === "PUT")
          response = json(await upcoming.save(upcomingInput(await body(request))));
        else throw new HttpError(405, "Method not allowed.");
      } else if (
        url.pathname === "/v1/account/claims" &&
        request.method === "POST"
      ) {
        const input = claimInput.safeParse(await body(request, 1024));
        if (!input.success)
          throw new HttpError(400, "Name a valid claim for a conversation.");
        response = json(
          await new ProactiveClaims(env, owner).claim(input.data),
        );
      } else if (
        url.pathname === "/v1/account/export" &&
        request.method === "GET"
      ) {
        response = json(await exportAccount(env, owner, Date.now()));
      } else if (url.pathname === "/v1/account" && request.method === "DELETE") {
        const input = await body(request);
        if (input.confirm !== true || Object.keys(input).length !== 1)
          throw new HttpError(400, "Confirm deleting the Open Muse account.");
        response = json(await deleteAccount(env, owner, userId));
      } else if (url.pathname === "/v1/account/credential") {
        const credentials = new AccountCredentials(env, owner);
        if (request.method === "GET") response = json(await credentials.read());
        else if (request.method === "PUT") {
          const input = await body(request, 4096);
          const credential = accountCredentialSchema.safeParse(
            input.credential,
          );
          if (
            input.confirm !== true ||
            !Number.isSafeInteger(input.revision) ||
            (input.revision as number) < 0 ||
            Object.keys(input).some(
              (key) => !["credential", "revision", "confirm"].includes(key),
            ) ||
            !credential.success
          )
            throw new HttpError(
              400,
              "Confirm saving a valid Ark API key and project.",
            );
          response = json(
            await credentials.save(
              credential.data,
              input.revision as number,
              Date.now(),
              fetcher,
            ),
          );
        } else if (request.method === "DELETE") {
          const input = await body(request);
          if (
            input.confirm !== true ||
            !Number.isSafeInteger(input.revision) ||
            (input.revision as number) < 0 ||
            Object.keys(input).some(
              (key) => !["revision", "confirm"].includes(key),
            )
          )
            throw new HttpError(400, "Confirm removing the saved Ark API key.");
          response = json(await credentials.remove(input.revision as number));
        } else throw new HttpError(405, "Method not allowed.");
      } else if (
        url.pathname === "/v1/connection" &&
        request.method === "PUT"
      ) {
        if (!credentialStorageReady(env))
          throw new HttpError(
            503,
            "Encrypted credential storage is not configured.",
          );
        const input = await body(request, 8192);
        const workspace = backgroundWorkspaceSchema.safeParse(
          input.workspace,
        );
        if (
          input.confirm !== true ||
          !Number.isSafeInteger(input.revision) ||
          (input.revision as number) < 0 ||
          !Number.isSafeInteger(input.credentialRevision) ||
          Object.keys(input).some(
            (key) =>
              ![
                "workspace",
                "credentialRevision",
                "revision",
                "confirm",
              ].includes(key),
          ) ||
          !workspace.success
        )
          throw new HttpError(
            400,
            "Confirm allowing background work for a valid workspace.",
          );
        const stored = await new AccountCredentials(env, owner).read();
        if (
          !stored.credential ||
          stored.revision !== input.credentialRevision
        )
          throw new HttpError(
            409,
            "Your Ark API key changed. Refresh before allowing background work.",
          );
        // Background sessions use the live agent and environment, so they
        // wait until the saved settings are confirmed again.
        if (
          (await new AccountWorkspaces(env, owner, fetcher).read()).settings
        )
          throw new HttpError(
            409,
            "Check the workspace settings before allowing background work.",
            "settings_review",
          );
        response = json(
          await connections.save(
            { ...stored.credential, ...workspace.data },
            input.revision as number,
            {
              credentialRevision: stored.revision,
              workspaceKey: accountWorkspaceKey(
                stored.credential.apiKey,
                stored.credential.project,
                owner,
                maEndpoint(env).provider,
              ),
            },
            Date.now(),
            fetcher,
          ),
        );
      } else if (
        url.pathname === "/v1/connection" &&
        request.method === "DELETE"
      ) {
        const input = await body(request);
        if (
          input.confirm !== true ||
          !Number.isSafeInteger(input.revision) ||
          (input.revision as number) < 0 ||
          Object.keys(input).some(
            (key) => !["revision", "confirm"].includes(key),
          )
        )
          throw new HttpError(
            400,
            "Confirm removing the uploaded configuration.",
          );
        response = json(await connections.remove(input.revision as number));
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
        if (input.enabled && (input.confirm !== true || !(await ready())))
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
            input.enabled ? await binding() : undefined,
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
        if (!(await ready()))
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
          await repo.enqueue(
            `manual:${key}`,
            Date.now(),
            Date.now(),
            false,
            await binding(),
          ),
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
        if ((await body(request)).confirm !== true || !(await ready()))
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
        ...(error instanceof HttpError && error.code
          ? { code: error.code, details: error.details }
          : {}),
      },
      error instanceof HttpError ? error.status : 500,
    );
  }
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
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
  fetch: (request, env) => handle(request, env),
  async scheduled(_event, env) {
    if (!externalScheduler(env)) await runScheduler(env);
  },
} satisfies ExportedHandler<Env>;
