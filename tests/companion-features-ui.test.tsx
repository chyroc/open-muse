import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../shared/types";
import type { Client } from "../src/api";
import { HealthRequestCard } from "../src/HealthRequestCard";
import { UpcomingPanel } from "../src/UpcomingPanel";
import { CheckInSettings } from "../src/CheckInSettings";

afterEach(() => vi.unstubAllGlobals());

const client = (signedIn: boolean, delivery = false) =>
  ({
    signedIn: () => signedIn,
    upcomingDeliverySupported: () => delivery,
  }) as unknown as Client;
const request = (input: unknown): AgentEvent => ({
  id: "call",
  type: "agent.custom_tool_use",
  name: "health_read",
  input,
});
const steps = request({
  metric: "steps",
  start: new Date(2026, 9, 1).toISOString(),
  end: new Date(2026, 9, 2).toISOString(),
});
const render = (event: AgentEvent) =>
  renderToStaticMarkup(
    <HealthRequestCard
      client={client(true)}
      session="main"
      event={event}
      name="Kit"
      onAnswered={() => {}}
    />,
  );

describe("Apple Health request card", () => {
  it("offers Share only where the iPhone's Health reader exists", () => {
    const elsewhere = render(steps);
    expect(elsewhere).toContain("Share Apple Health data?");
    expect(elsewhere).toContain("Steps · Oct 1");
    expect(elsewhere).toContain("Open Open Muse on your iPhone");
    expect(elsewhere).toContain("Don’t share");
    expect(elsewhere).not.toContain(">Share<");
    vi.stubGlobal("webkit", {
      messageHandlers: { museHealth: { postMessage: vi.fn() } },
    });
    const phone = render(steps);
    expect(phone).toContain("Only this summary is shared");
    expect(phone).toContain(">Share<");
  });

  it("lets an invalid request be dismissed without offering to share", () => {
    vi.stubGlobal("webkit", {
      messageHandlers: { museHealth: { postMessage: vi.fn() } },
    });
    const html = render(request({ metric: "steps" }));
    expect(html).toContain("Invalid request");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain(">Share<");
  });
});

describe("Upcoming delivery while closed", () => {
  it("is offered only to accounts the service can deliver for, off until loaded", () => {
    const account = renderToStaticMarkup(
      <UpcomingPanel client={client(true, true)} name="Kit" />,
    );
    expect(account).toContain("Deliver even when Open Muse is closed");
    expect(account).toMatch(/<input type="checkbox" disabled=""/);
    expect(account).toContain("may be billed");
    const local = renderToStaticMarkup(
      <UpcomingPanel client={client(true)} name="Kit" />,
    );
    expect(local).not.toContain("Deliver even when Open Muse is closed");
    expect(local).toContain("There are no push notifications yet.");
  });
});

describe("Signed-out companion settings", () => {
  it("explains Upcoming and hides the check-in toggle", () => {
    const html = renderToStaticMarkup(
      <UpcomingPanel client={client(false)} name="Kit" />,
    );
    expect(html).toContain("Nothing upcoming");
    expect(html).toContain("Connect to MA to keep reminders");
    expect(
      renderToStaticMarkup(<CheckInSettings client={client(false)} />),
    ).toBe("");
  });
});
