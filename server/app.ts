import express from "express";
import { timingSafeEqual, randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ArkClient, ApiError } from "./ark";
import type { ServerConfig } from "./config";
import { Store } from "./store";
import type { AgentEvent } from "../shared/types";
import { pendingPermissions } from "../shared/types";
import { AuthStore } from "./auth";
import { OAuthProvider, isSSOCredentials } from "./oauth";
import { maRouter, type Runtime } from "./ma";
import { Workspaces } from "./workspace";
import { canAutoApprove } from "../shared/approval-policy";
import { annotateApproval, approvalKey } from "./approvals";
import { organizerRouter } from "./organizer";

const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user.message"),
    text: z.string().trim().min(1).max(16000),
  }),
  z.object({ type: z.literal("user.interrupt") }),
  z.object({
    type: z.literal("user.tool_confirmation"),
    tool_use_id: z.string().min(1).max(200),
    result: z.enum(["allow", "deny"]),
    automatic: z.literal(true).optional(),
  }),
]);

export async function createApp(
  config: ServerConfig,
  options: {
    ark?: ArkClient;
    oauth?: OAuthProvider;
    arkFactory?: (config: ServerConfig) => ArkClient;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  const store = new Store(config.dataDir, config.mode);
  await store.init();
  const ark = options.ark ?? new ArkClient(config);
  const auth = new AuthStore(config.dataDir, options.oauth);
  await auth.init();
  const runtimes = new Map<string, Promise<Runtime>>();
  const identityStores = new Map<string, Promise<Store>>();
  const defaultRuntime: Runtime = { config, store, ark };
  async function runtimeFor(token?: string): Promise<Runtime> {
    const credentials = auth.get(token);
    if (!credentials?.apiKey) return defaultRuntime;
    if (!runtimes.has(token!)) {
      const pending = (async () => {
        const runtimeConfig = {
          ...config,
          mode: "ark" as const,
          arkBaseUrl: config.ssoArkBaseUrl,
          arkKey: credentials.apiKey!,
          project: credentials.project ?? "",
          agentId: isSSOCredentials(credentials)
            ? (credentials.agentId ?? "")
            : "",
          environmentId: isSSOCredentials(credentials)
            ? (credentials.environmentId ?? "")
            : "",
        };
        const owner = createHash("sha256")
          .update(
            `${runtimeConfig.arkBaseUrl}\0${credentials.apiKey}${isSSOCredentials(credentials) ? "" : `\0${runtimeConfig.project}`}`,
          )
          .digest("hex");
        const namespace = `${isSSOCredentials(credentials) ? "sso" : "api-key"}-${owner}`;
        if (!identityStores.has(namespace)) {
          const loading = (async () => {
            const store = new Store(config.dataDir, namespace);
            await store.init();
            return store;
          })();
          identityStores.set(namespace, loading);
          loading.catch(() => identityStores.delete(namespace));
        }
        const runtimeStore = await identityStores.get(namespace)!;
        return {
          config: runtimeConfig,
          store: runtimeStore,
          ark:
            options.arkFactory?.(runtimeConfig) ?? new ArkClient(runtimeConfig),
          credentials,
        };
      })();
      runtimes.set(token!, pending);
      pending.catch(() => runtimes.delete(token!));
    }
    return runtimes.get(token!)!;
  }
  if (config.mode === "ark") {
    // Bind the registry to the upstream tenant config so switching credentials never exposes a previous session.
    const { createHash } = await import("node:crypto");
    const identity = createHash("sha256")
      .update(
        `${config.arkBaseUrl}\0${config.arkKey}\0${config.agentId}${config.project ? `\0${config.project}` : ""}`,
      )
      .digest("hex")
      .slice(0, 20);
    if (store.data.owner && store.data.owner !== identity)
      throw new Error("ARK identity changed: select another MUSE_DATA_DIR");
    store.data.owner = identity;
    await store.save();
  }

  const workspaces = new Workspaces(config.dataDir);
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const origin = req.headers.origin;
    const ownOrigin = `${req.protocol}://${req.headers.host}`;
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!config.accessToken && !localHosts.has(req.hostname))
      return res.status(403).json({
        error:
          "Only loopback addresses are allowed when no access token is set.",
      });
    if (origin) {
      if (
        !config.origins.includes(origin) &&
        !(origin === ownOrigin && localHosts.has(req.hostname))
      ) {
        return res.status(403).json({
          error: "Origin not allowed; configure MUSE_ALLOWED_ORIGINS.",
        });
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Muse-Session",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (req.path === "/config" || req.path === "/health") return next();
    if (config.accessToken) {
      const provided = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${config.accessToken}`);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      )
        return res
          .status(401)
          .json({ error: "Invalid access token; reconnect in Settings." });
    }
    next();
  });
  app.use("/api/ma", express.json({ limit: "20mb" }));
  app.use(express.json({ limit: "80kb" }));
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && !req.is("application/json"))
      return res
        .status(415)
        .json({ error: "Only application/json requests are accepted." });
    next();
  });
  app.use(
    "/api/auth",
    auth.router(
      (token) => {
        const runtime = runtimes.get(token);
        runtimes.delete(token);
        void runtime
          ?.then((r) => {
            workspaces.cancel(r);
            r.streams?.forEach((stream) => stream.abort());
          })
          .catch(() => {});
      },
      async (token) => {
        workspaces.start(await runtimeFor(token));
      },
      async (credentials) => {
        const keyConfig = {
          ...config,
          mode: "ark" as const,
          arkBaseUrl: config.ssoArkBaseUrl,
          arkKey: credentials.apiKey,
          project: credentials.project ?? "",
          agentId: "",
          environmentId: "",
        };
        const client =
          options.arkFactory?.(keyConfig) ?? new ArkClient(keyConfig);
        await client.request("/models");
      },
    ),
  );
  app.use("/api", async (req, res, next) => {
    const token = req.get("X-Muse-Session");
    const credentials = auth.get(token);
    if (
      credentials &&
      !credentials.apiKey &&
      !["/config", "/health", "/ma/capabilities"].includes(req.path)
    )
      throw new ApiError(
        409,
        "Login is not complete; select a project and create an API Key in Settings.",
      );
    res.locals.runtime = await runtimeFor(token);
    if ((res.locals.runtime as Runtime).config.mode !== "ark") {
      // Never expose old simulated history or fabricate results while signed out.
      if (
        req.method === "GET" &&
        ["/sessions", "/goals", "/library"].includes(req.path)
      )
        return res.json({ data: [] });
      if (!(
        req.method === "GET" &&
        ["/config", "/health", "/workspace", "/ma/capabilities"].includes(
          req.path,
        )
      ))
        throw new ApiError(
          401,
          "Connect to Ark MA with SSO or an API key in Settings before starting a task.",
        );
    }
    next();
  });
  app.use("/api/ma", maRouter(auth));
  app.use("/api", organizerRouter());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/workspace", (_req, res) =>
    res.json(workspaces.status(res.locals.runtime)),
  );
  app.post("/api/workspace/prepare", (_req, res) => {
    res.status(202).json(workspaces.start(res.locals.runtime));
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      mode: (res.locals.runtime as Runtime).config.mode,
      agentConfigured:
        (res.locals.runtime as Runtime).config.mode === "ark" &&
        workspaces.status(res.locals.runtime).state === "ready",
      authRequired: Boolean(config.accessToken),
    }),
  );
  const refreshes = new WeakMap<
    Store,
    { last: number; pending?: Promise<void> }
  >();
  app.get("/api/sessions", async (_req, res) => {
    const { config, store, ark } = res.locals.runtime as Runtime;
    const refresh = refreshes.get(store) ?? { last: 0 };
    refreshes.set(store, refresh);
    let statusRefresh = refresh.pending;
    const lastStatusRefresh = refresh.last;
    if (config.mode === "ark" && Date.now() - lastStatusRefresh > 5000) {
      statusRefresh ??= (async () => {
        const running = store.data.sessions.filter((session) =>
          ["running", "rescheduling"].includes(session.status),
        );
        for (let start = 0; start < running.length; start += 4) {
          await Promise.all(
            running.slice(start, start + 4).map(async (session) => {
              const remote = await ark.get(session.id);
              session.status = remote.status;
              session.updated_at = remote.updated_at;
            }),
          );
        }
        await store.save();
        refresh.last = Date.now();
      })().finally(() => {
        refresh.pending = undefined;
      });
      refresh.pending = statusRefresh;
    }
    if (statusRefresh) await statusRefresh;
    res.json({
      data: [...store.data.sessions].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      ),
    });
  });
  app.post("/api/sessions", async (req, res) => {
    const runtime = res.locals.runtime as Runtime;
    const { config, store, ark } = runtime;
    const input = z
      .object({
        title: z.string().trim().min(1).max(100),
        category: z
          .enum(["general", "research", "writing", "life", "code"])
          .default("general"),
      })
      .parse(req.body);
    const selection = workspaces.selection(runtime);
    if (!selection || workspaces.status(runtime).state !== "ready") {
      const status = workspaces.status(runtime);
      if (status.state === "idle") workspaces.start(runtime);
      throw new ApiError(
        409,
        status.state === "error"
          ? status.message
          : "Your personal workspace is being prepared. Check progress in Settings before starting a task.",
      );
    }
    await workspaces.syncToolPolicy(runtime);
    const session = await ark.create(input.title, input.category, selection);
    store.data.sessions.unshift(session);
    await store.save();
    res.status(201).json(session);
  });
  app.use("/api/sessions/:id", async (req, res, next) => {
    const { store } = res.locals.runtime as Runtime;
    const id = String(req.params.id);
    if (!/^[\w-]+$/.test(id))
      throw new ApiError(400, "Invalid session ID format.");
    if (!store.get(id))
      return res
        .status(404)
        .json({ error: "No task created by this app was found." });
    next();
  });
  app.get("/api/sessions/:id", async (req, res) => {
    const { config, store, ark } = res.locals.runtime as Runtime;
    const session = store.get(String(req.params.id))!;
    if (config.mode === "ark") {
      const remote = await ark.get(session.id);
      session.status = remote.status;
      session.updated_at = remote.updated_at;
      await store.save();
    }
    res.json(session);
  });
  app.get("/api/sessions/:id/events", async (req, res) => {
    const { config, store, ark } = res.locals.runtime as Runtime;
    const id = String(req.params.id);
    const page =
      typeof req.query.page === "string" ? req.query.page : undefined;
    if (page && page.length > 2048)
      throw new ApiError(400, "Pagination parameter is too long.");
    const result = await ark.events(id, page);
    res.json({
      ...result,
      data: result.data.map((event) => annotateApproval(store, id, event)),
    });
  });
  const runtimeLocks = new WeakMap<Store, Set<string>>();
  app.post("/api/sessions/:id/events", async (req, res) => {
    const { config, store, ark } = res.locals.runtime as Runtime;
    const input = messageSchema.parse(req.body);
    const id = String(req.params.id);
    const locks = runtimeLocks.get(store) ?? new Set<string>();
    runtimeLocks.set(store, locks);
    if (locks.has(id))
      throw new ApiError(
        409,
        "The previous operation is still being submitted; please try again later.",
      );
    locks.add(id);
    try {
      let event: Partial<AgentEvent> = {
        id: `evt-${randomUUID()}`,
        type: input.type,
      };
      let autoRecord:
        NonNullable<Store["data"]["autoApprovals"]>[string] | undefined;
      if (input.type === "user.message")
        event.content = [{ type: "text", text: input.text }];
      if (input.type === "user.tool_confirmation") {
        // Confirm only the tool the upstream is currently asking for; an arbitrary event id cannot be approved.
        const events: AgentEvent[] = [];
        {
          let page: string | undefined;
          const seen = new Set<string>();
          do {
            const batch = await ark.events(id, page);
            events.push(...batch.data);
            page = batch.next_page || undefined;
            if (page && seen.has(page))
              throw new ApiError(
                502,
                "Upstream pagination cursor repeated; please try again later.",
              );
            if (page) seen.add(page);
            if (events.length > 20000)
              throw new ApiError(
                413,
                "Session is too long to safely confirm the operation right now.",
              );
          } while (page);
        }
        const key = approvalKey(id, input.tool_use_id);
        const previous = store.data.autoApprovals?.[key];
        if (input.automatic) {
          if (input.result !== "allow")
            throw new ApiError(
              400,
              "Automatic approval only allows operations.",
            );
          // Check history first: a failure or timeout may already have been accepted upstream, so never resend or overwrite the user's denial.
          const confirmation = events.find(
            (item) =>
              item.type === "user.tool_confirmation" &&
              item.tool_use_id === input.tool_use_id,
          );
          if (confirmation)
            return res.json({
              data: [annotateApproval(store, id, confirmation)],
            });
          if (previous?.state === "confirmed")
            return res.json({
              data: [annotateApproval(store, id, previous.event)],
            });
        } else if (previous?.state === "confirmed") {
          throw new ApiError(
            409,
            "This operation was auto-approved; refresh the history.",
          );
        }
        const tool = pendingPermissions(events).find(
          (item) => item.id === input.tool_use_id,
        );
        if (!tool)
          throw new ApiError(
            409,
            "This operation was already handled or is no longer pending.",
          );
        if (input.automatic && !canAutoApprove(tool))
          throw new ApiError(
            403,
            "This tool is not on the auto-approval list; manual confirmation is required.",
          );
        if (input.automatic && previous)
          throw new ApiError(
            409,
            "The auto-approval submission is unconfirmed; refresh the history and handle it manually.",
          );
        event = {
          ...event,
          tool_use_id: tool.id,
          result: input.result,
          session_thread_id: tool.session_thread_id,
        };
        if (input.automatic) {
          autoRecord = {
            state: "sending",
            event: {
              ...event,
              id: event.id!,
              type: event.type!,
              created_at: new Date().toISOString(),
            },
          };
          store.data.autoApprovals ??= {};
          store.data.autoApprovals[key] = autoRecord;
          // Persist before the external request. Restarts, dropped streams, or lost responses never trigger a blind duplicate approval.
          await store.save();
        }
      }
      let result;
      try {
        result = await ark.send(id, event);
      } catch (error) {
        if (autoRecord) {
          autoRecord.state = "failed";
          await store.save();
        }
        throw error;
      }
      // Some upstream versions return only an acceptance envelope without the event list.
      result = {
        ...result,
        data: Array.isArray(result.data) ? result.data : [],
      };
      if (autoRecord) {
        autoRecord.state = "confirmed";
        autoRecord.event =
          result.data.find(
            (item) =>
              item.type === "user.tool_confirmation" &&
              item.tool_use_id === event.tool_use_id &&
              item.result === "allow",
          ) ?? autoRecord.event;
        if (!result.data.some((item) => item.id === autoRecord!.event.id))
          result = { ...result, data: [...result.data, autoRecord.event] };
      }
      const session = store.get(id)!;
      session.updated_at = new Date().toISOString();
      if (config.mode === "ark" && input.type !== "user.interrupt")
        session.status = "running";
      await store.save();
      res.json({
        ...result,
        data: result.data.map((item) => annotateApproval(store, id, item)),
      });
    } finally {
      locks.delete(id);
    }
  });

  app.get("/api/sessions/:id/events/stream", async (req, res) => {
    const runtime = res.locals.runtime as Runtime;
    const { config, ark, store } = runtime;
    const id = String(req.params.id);
    const abort = new AbortController();
    runtime.streams ??= new Set();
    runtime.streams.add(abort);
    res.on("close", () => abort.abort());
    // Rebuild the SSE connection periodically while the client backfills history, avoiding a permanently stalled connection.
    const lifetime = setTimeout(() => abort.abort(), 60_000);
    lifetime.unref();
    const start = () => {
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write(": connected\n\n");
    };
    const write = (event: AgentEvent) => {
      if (!res.destroyed)
        res.write(
          `data: ${JSON.stringify(annotateApproval(store, id, event))}\n\n`,
        );
      if (res.writableLength > 1_000_000) res.end();
    };
    try {
      const upstream = await ark.stream(id, abort.signal);
      if (
        !upstream.ok ||
        !upstream.body ||
        !upstream.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await upstream.body?.cancel();
        throw new ApiError(
          502,
          "The Ark event stream connection failed; recovery will use the history.",
        );
      }
      start();
      const { readSSE } = await import("../shared/sse");
      for await (const data of readSSE(upstream.body)) {
        if (data === "[DONE]") break;
        const event = JSON.parse(data) as AgentEvent;
        if (event.id && event.type) write(event);
      }
    } catch (error) {
      if (!res.headersSent && !abort.signal.aborted) throw error;
    } finally {
      runtime.streams.delete(abort);
      clearTimeout(lifetime);
      if (!res.destroyed && (res.headersSent || abort.signal.aborted))
        res.end();
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const dist = path.resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(dist, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return res.end();
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: "Input is invalid; check the content and length." });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Malformed request JSON." });
      if (error instanceof ApiError)
        return res.status(error.status).json({ error: error.message });
      if ((error as { type?: string })?.type === "entity.too.large")
        return res.status(413).json({ error: "Request body is too large." });
      res.status(500).json({
        error:
          "The service is temporarily unavailable; check the server configuration or try again later.",
      });
    },
  );
  return {
    app,
    store,
    close: () => {
      workspaces.close();
    },
  };
}
