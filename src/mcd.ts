import { z } from "zod";

type Handler = { postMessage(body: object): Promise<unknown> };
const handler = () =>
  (
    globalThis as {
      webkit?: { messageHandlers?: { museMcd?: Handler } };
    }
  ).webkit?.messageHandlers?.museMcd;

// Present only in the iPhone app, which signs in on McDonald's own page and
// keeps the resulting token in the Keychain.
export const mcdSupported = () => Boolean(handler());

// Whether this iPhone already holds a McDonald's token.
export async function mcdStatus() {
  const native = handler();
  if (!native) return "unavailable" as const;
  return z
    .enum(["connected", "none", "unavailable"])
    .parse(await native.postMessage({ operation: "status" }));
}

// Opens McDonald's sign-in page in the app. The person enters their phone
// number and the code McDonald's texts, then activates the MCP token on that
// page; the app reads it back and returns it here. An empty string means the
// person closed the page without finishing.
export async function connectMcd() {
  const native = handler();
  if (!native) throw new Error("McDonald's is not available here.");
  return z
    .string()
    .max(4096)
    .parse(await native.postMessage({ operation: "connect" }));
}

// The token kept on this iPhone, so it can be pushed to MA again if the
// workspace vault was reset. Empty when none is stored.
export async function mcdStoredToken() {
  const native = handler();
  if (!native) return "";
  return z
    .string()
    .max(4096)
    .parse(await native.postMessage({ operation: "token" }));
}

export async function disconnectMcd() {
  const native = handler();
  if (!native) return;
  await native.postMessage({ operation: "disconnect" });
}
