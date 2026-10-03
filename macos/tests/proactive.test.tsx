import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../../src/api";
import type { UpcomingDelivery } from "../../shared/upcoming";
import { CheckInSwitch } from "../ui/CheckInSwitch";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

const delivery = (patch: Partial<UpcomingDelivery>): UpcomingDelivery => ({
  enabled: true,
  session_id: "main",
  language: "en",
  since: 1,
  revision: 1,
  state: "active",
  checkins: false,
  goal_followups: false,
  time_zone: "Europe/Berlin",
  ...patch,
});
function stub(value: UpcomingDelivery, supported = true) {
  const setClosedFollowUps = vi.fn(
    async (change: { checkins?: boolean; goal_followups?: boolean }) => ({
      ...value,
      ...change,
    }),
  );
  const client = {
    signedIn: () => true,
    checkInState: async () => ({ enabled: true, records: [] }),
    setCheckIn: vi.fn(async () => undefined),
    upcomingDeliverySupported: () => supported,
    upcomingDelivery: vi.fn(async () => value),
    setClosedFollowUps,
  } as unknown as Client;
  return { client, setClosedFollowUps };
}
async function mount(client: Client) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<CheckInSwitch client={client} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const row = (label: string) =>
  [...host!.querySelectorAll("label")].find((item) =>
    item.textContent?.startsWith(label),
  );

describe("Check-ins while the apps are closed", () => {
  it("offers both switches, off by default, once delivery while closed is on", async () => {
    const { client, setClosedFollowUps } = stub(delivery({}));
    await mount(client);
    const checkins = row("Check in even when Open Muse is closed")!;
    const goals = row("Follow up on goals")!;
    expect(checkins.textContent).toContain("may be billed");
    expect(goals.textContent).toContain("may be billed");
    const input = checkins.querySelector<HTMLInputElement>("input")!;
    expect(input.checked).toBe(false);
    expect(goals.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
    await act(async () => input.click());
    expect(setClosedFollowUps).toHaveBeenCalledWith({ checkins: true });
    expect(input.checked).toBe(true);
  });

  it("stays hidden without delivery while closed or an account", async () => {
    await mount(stub(delivery({ enabled: false })).client);
    expect(row("Check in even when Open Muse is closed")).toBeUndefined();
    await act(async () => root!.unmount());
    root = undefined;
    await mount(stub(delivery({}), false).client);
    expect(row("Follow up on goals")).toBeUndefined();
  });
});
