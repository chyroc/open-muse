import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundSettings } from "../../src/BackgroundSettings";
import type { BackgroundClient } from "../../src/background-client";
import type { BackgroundRun, BackgroundStatus } from "../../shared/background";

let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});

async function setup(withArk = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const status: BackgroundStatus = {
    connected: true,
    owner: "private-owner",
    backgroundReady: true,
    credentialStorageReady: true,
    connection: { configured: true, revision: 1, updatedAt: 10 },
    schedule: {
      enabled: false,
      timezone: "UTC",
      local_time: "09:00",
      next_run_at: null,
      revision: 2,
    },
  };
  const run: BackgroundRun = {
    id: "run-one",
    phase: "queued",
    session_id: null,
    error: null,
    created_at: 1,
    scheduled_for: 1,
  };
  const service = {
    origin: "https://background.example",
    configured: () => true,
    connected: vi.fn(() => true),
    pending: () => false,
    restore: vi.fn(async () => {}),
    cachedFeed: vi.fn(async () => ({ items: [], cursor: 0 })),
    refresh: vi.fn(async () => ({ status, runs: [], items: [] })),
    saveSchedule: vi.fn(async (schedule) => ({ ...schedule, revision: 3 })),
    generate: vi.fn(async () => run),
    syncConfiguration: vi.fn(async () => ({
      configured: true,
      revision: 2,
      updatedAt: 20,
    })),
    removeConfiguration: vi.fn(async () => ({
      configured: false,
      revision: 2,
      updatedAt: 20,
    })),
    disconnect: vi.fn(async () => {
      service.connected.mockReturnValue(false);
    }),
  };
  const client = { signedIn: () => true, backgroundConfiguration: vi.fn() };
  await act(async () => {
    root.render(
      <BackgroundSettings
        service={service as unknown as BackgroundClient}
        client={withArk ? client : undefined}
      />,
    );
  });
  return { service, status, run, client };
}

function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;
}
async function input(selector: string, value: string) {
  await act(async () => {
    const node = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Native background settings interactions", () => {
  it("does not sync on mount, refresh, or before explicit upload consent", async () => {
    const { service, client } = await setup(true);
    expect(service.syncConfiguration).not.toHaveBeenCalled();
    expect(button("Sync current Ark configuration").disabled).toBe(true);
    await act(async () => button("Refresh").click());
    expect(service.syncConfiguration).not.toHaveBeenCalled();
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(".background-authorization input")!
        .click(),
    );
    await act(async () => button("Sync current Ark configuration").click());
    expect(service.syncConfiguration).toHaveBeenCalledExactlyOnceWith(client);
    expect(button("Sync current Ark configuration").disabled).toBe(true);
    expect(host.textContent).toContain("Current Ark configuration synced");
  });
  it("separates remote revocation from device disconnection and requires confirmation", async () => {
    const { service } = await setup(true);
    expect(button("Remove uploaded Ark access").disabled).toBe(true);
    expect(host.textContent).toContain("not end-to-end encryption");
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(".background-remove-consent input")!
        .click(),
    );
    await act(async () => button("Remove uploaded Ark access").click());
    expect(service.removeConfiguration).toHaveBeenCalledOnce();
    expect(service.disconnect).not.toHaveBeenCalled();
    expect(host.textContent).toContain("the original Ark key remains valid");
  });
  it("requires explicit consent before enabling a daily schedule", async () => {
    const { service, status } = await setup();
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(button("Save schedule").disabled).toBe(true);
    expect(service.saveSchedule).not.toHaveBeenCalled();
    await act(async () => {
      host
        .querySelector<HTMLInputElement>(".background-consent input")!
        .click();
    });
    expect(button("Save schedule").disabled).toBe(false);
    await act(async () => button("Save schedule").click());
    expect(service.saveSchedule).toHaveBeenCalledExactlyOnceWith({
      ...status.schedule,
      enabled: true,
    });
  });

  it("preserves a draft during refresh and explicitly discards to latest state", async () => {
    const { service, status } = await setup();
    await input('input[type="time"]', "10:30");
    service.refresh.mockResolvedValue({
      status: {
        ...status,
        schedule: { ...status.schedule, local_time: "11:00", revision: 3 },
      },
      runs: [],
      items: [],
    });
    await act(async () => button("Refresh").click());
    expect(
      host.querySelector<HTMLInputElement>('input[type="time"]')!.value,
    ).toBe("10:30");
    await act(async () => button("Discard changes").click());
    expect(
      host.querySelector<HTMLInputElement>('input[type="time"]')!.value,
    ).toBe("11:00");
    expect(service.saveSchedule).not.toHaveBeenCalled();
  });

  it("blocks duplicate generation clicks and reports a reconciled result accurately", async () => {
    const { service, run } = await setup();
    let finish!: (value: BackgroundRun) => void;
    service.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      button("Generate once · may incur charges").click();
      button("Generate once · may incur charges").click();
    });
    expect(service.generate).toHaveBeenCalledTimes(1);
    expect(button("Remove this device connection").disabled).toBe(true);
    await act(async () => finish({ ...run, phase: "complete" }));
    expect(host.textContent).toContain("request is confirmed: complete");
    expect(host.textContent).not.toContain("The run is queued");
  });

  it("removes only the local connection, without silently pausing the schedule", async () => {
    const { service } = await setup();
    expect(host.textContent).toContain(
      "Signing out of Ark does not stop this schedule",
    );
    await act(async () => button("Remove this device connection").click());
    expect(service.disconnect).toHaveBeenCalledOnce();
    expect(service.saveSchedule).not.toHaveBeenCalled();
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
  });
});
