import { edgeFetch } from "./fetch";
import { authenticate, checkOrigin } from "./auth";
import { backgroundReady, HttpError, json, type Env } from "./env";
import { Repository } from "./repository";
import { validateTime } from "./schedule";
import { tick } from "./jobs";
import { ConnectionStore, credentialStorageReady } from "./connection";
import {
  backgroundConfigurationSchema,
  backgroundWorkspaceSchema,
} from "../../shared/background-connection";
import { ArkRemote } from "./ark";
import { isSupabaseOwner } from "./supabase";
import { AccountCredentials, rewrapRetiredKeys } from "./account";
import { AccountWorkspaces } from "./workspace";
import { accountCredentialSchema } from "../../shared/account-credential";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import { externalScheduler, TRIGGER_PATH, verifyTrigger } from "./trigger";
import { UpcomingDelivery, upcomingInput } from "./upcoming";
import { AccountDevices, deviceInput, validDeviceId } from "./devices";

async function runScheduler(env: Env) {
  await rewrapRetiredKeys(env).catch(() => {});
  await tick(env);
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
    origin = checkOrigin(request, env);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!origin) throw new HttpError(403, "An allowed origin is required.");
      response = new Response(null, { status: 204 });
    } else if (url.pathname === "/health" && request.method === "GET") {
      response = json({ ok: true, service: "open-muse-server" });
    } else if (url.pathname === TRIGGER_PATH && request.method === "POST") {
      // Server-to-server only: no browser origin, no user identity.
      if (request.headers.has("Origin"))
        throw new HttpError(403, "This application origin is not allowed.");
      await verifyTrigger(request, env);
      await runScheduler(env);
      response = json({ ok: true });
    } else {
      const owner = await authenticate(request, env, fetcher);
      const account = isSupabaseOwner(owner);
      if (account) await new AccountCredentials(env, owner).seen(Date.now());
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
          ...(account
            ? {
                account: {
                  provider: "supabase",
                  credential: await new AccountCredentials(env, owner).status(),
                },
                upcoming: await new UpcomingDelivery(env, owner).status(),
              }
            : {}),
          connection: await connections.status(),
          schedule: await repo.schedule(),
        });
      } else if (
        url.pathname === "/v1/account/workspace/reconcile" &&
        request.method === "POST"
      ) {
        if (!account)
          throw new HttpError(
            403,
            "Sign in with an Open Muse account to change the workspace.",
          );
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
        if (!account)
          throw new HttpError(
            403,
            "Sign in with an Open Muse account to change the workspace.",
          );
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
        if (!account)
          throw new HttpError(
            403,
            "Sign in with an Open Muse account to change the workspace.",
          );
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
        if (!account)
          throw new HttpError(
            403,
            "Sign in with an Open Muse account to prepare a workspace.",
          );
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
        if (!account)
          throw new HttpError(403, "Sign in with an Open Muse account to list devices.");
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
      } else if (url.pathname === "/v1/account/upcoming") {
        if (!account)
          throw new HttpError(
            403,
            "Sign in with an Open Muse account to deliver reminders.",
          );
        const upcoming = new UpcomingDelivery(env, owner, fetcher);
        if (request.method === "GET") response = json(await upcoming.read());
        else if (request.method === "PUT")
          response = json(await upcoming.save(upcomingInput(await body(request))));
        else throw new HttpError(405, "Method not allowed.");
      } else if (url.pathname === "/v1/account/credential") {
        if (!account)
          throw new HttpError(
            403,
            "Sign in with an Open Muse account to store an Ark API key.",
          );
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
        if (account) {
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
              Date.now(),
              fetcher,
              {
                credentialRevision: stored.revision,
                workspaceKey: accountWorkspaceKey(
                  stored.credential.apiKey,
                  stored.credential.project,
                  owner,
                ),
              },
            ),
          );
        } else {
          const config = backgroundConfigurationSchema.safeParse(input.config);
          if (
            input.confirm !== true ||
            !Number.isSafeInteger(input.revision) ||
            (input.revision as number) < 0 ||
            Object.keys(input).some(
              (key) => !["config", "revision", "confirm"].includes(key),
            ) ||
            !config.success
          )
            throw new HttpError(
              400,
              "Confirm syncing a valid current Ark configuration.",
            );
          response = json(
            await connections.save(
              config.data,
              input.revision as number,
              Date.now(),
              fetcher,
            ),
          );
        }
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
