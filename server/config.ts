import path from "node:path";
import type { Mode } from "../shared/types";

export interface ServerConfig {
  mode: Mode;
  host: string;
  port: number;
  arkBaseUrl: string;
  arkKey: string;
  project: string;
  agentId: string;
  environmentId: string;
  modelId: string;
  accessToken: string;
  origins: string[];
  dataDir: string;
  ssoArkBaseUrl: string;
}

export function loadConfig(env = process.env): ServerConfig {
  const mode = env.MUSE_MODE ?? "demo";
  if (mode !== "demo" && mode !== "ark")
    throw new Error("MUSE_MODE must be demo or ark");
  const host = env.HOST ?? "127.0.0.1";
  const accessToken = env.MUSE_ACCESS_TOKEN ?? "";
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    accessToken.length < 24
  ) {
    throw new Error(
      "Non-loopback HOST requires MUSE_ACCESS_TOKEN (at least 24 characters)",
    );
  }
  if (mode === "ark" && !env.ARK_API_KEY) {
    throw new Error(
      "ark mode requires ARK_API_KEY (or use SSO from demo mode)",
    );
  }
  const arkBaseUrl =
    env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
  if (
    new URL(arkBaseUrl).protocol !== "https:" ||
    new URL(arkBaseUrl).username ||
    new URL(arkBaseUrl).password ||
    new URL(arkBaseUrl).search ||
    new URL(arkBaseUrl).hash
  )
    throw new Error("ARK_BASE_URL requires HTTPS");
  return {
    mode,
    host,
    port: Number(env.PORT ?? 4311),
    arkBaseUrl: arkBaseUrl.replace(/\/$/, ""),
    arkKey: env.ARK_API_KEY ?? "",
    project: env.ARK_PROJECT_NAME ?? "",
    agentId: env.ARK_AGENT_ID ?? "",
    environmentId: env.ARK_ENVIRONMENT_ID ?? "",
    modelId: env.ARK_MODEL_ID ?? "",
    accessToken,
    origins: (
      env.MUSE_ALLOWED_ORIGINS ??
      "http://localhost:4310,http://127.0.0.1:4310,capacitor://localhost,https://localhost"
    )
      .split(",")
      .map((s) => s.trim()),
    dataDir: path.resolve(env.MUSE_DATA_DIR ?? ".data"),
    ssoArkBaseUrl: validateSSOBase(
      env.MUSE_SSO_ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    ),
  };
}

function validateSSOBase(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("MUSE_SSO_ARK_BASE_URL requires a clean HTTPS URL");
  return value.replace(/\/$/, "");
}
