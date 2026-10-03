import { z } from "zod";
import type { IphoneRequest, IphoneSource } from "../shared/iphone-tools";
import { iphoneSource } from "../shared/iphone-tools";

type Handler = { postMessage(body: object): Promise<unknown> };
const handler = () =>
  (
    globalThis as {
      webkit?: { messageHandlers?: { musePersonal?: Handler } };
    }
  ).webkit?.messageHandlers?.musePersonal;

// Present only in the iPhone app, which registers the native reader for
// Calendar, Reminders, and Contacts.
export const personalSupported = () => Boolean(handler());

const state = z.enum(["allowed", "not-asked", "denied"]);
export type PersonalAccess = z.infer<typeof state> | "unavailable";

// Whether iOS lets this app read a source; asking shows the system sheet
// only the first time.
export async function personalAccess(
  source: IphoneSource,
): Promise<PersonalAccess> {
  const native = handler();
  if (!native) return "unavailable";
  return state.parse(await native.postMessage({ operation: "access", source }));
}
export async function connectPersonal(source: IphoneSource) {
  const native = handler();
  if (!native) throw new Error("This is only available on iPhone.");
  return state.parse(
    await native.postMessage({ operation: "authorize", source }),
  );
}

// Reads what one approved request asks for, as compact JSON for the agent.
export async function readPersonal(request: IphoneRequest) {
  const native = handler();
  if (!native) throw new Error("This is only available on iPhone.");
  const source = iphoneSource(request);
  if ((await personalAccess(source)) === "not-asked")
    await connectPersonal(source);
  const { source: _source, ...input } = request;
  const result = await native.postMessage({ operation: "read", source, input });
  return z.string().min(2).max(60000).parse(result);
}
