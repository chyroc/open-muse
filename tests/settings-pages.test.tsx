import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../shared/i18n";
import { AboutSheet } from "../src/AboutSheet";
import { AccountSheet } from "../src/AccountSheet";
import { ChannelsSheet, larkChannelName } from "../src/ChannelsSheet";
import { DevicesSheet, lastSeen } from "../src/DevicesSheet";
import {
  ensureBackgroundWork,
  resetBackgroundDefault,
} from "../src/background-default";
import type { BackgroundClient } from "../src/background-client";
import type { Client } from "../src/api";

const schedule = {
  enabled: false,
  timezone: "",
  local_time: "",
  next_run_at: null,
  revision: 1,
};
function service(status: Record<string, unknown>) {
  let current = { ...status };
  return {
    configured: () => true,
    connected: () => true,
    restore: vi.fn(async () => {}),
    accountOwner: () => "muse_user_one",
    refresh: vi.fn(async () => ({ status: current })),
    syncConfiguration: vi.fn(async () => {
      current = { ...current, connection: { configured: true } };
    }),
    saveSchedule: vi.fn(async (value: unknown) => value),
  };
}
const client = {
  signedIn: () => true,
  backgroundConfiguration: vi.fn(),
  accountCredentialRevision: () => 1,
} as unknown as Pick<
  Client,
  "backgroundConfiguration" | "accountCredentialRevision" | "signedIn"
>;

describe("Background work on by default", () => {
  beforeEach(resetBackgroundDefault);

  it("allows background work and schedules the daily Feed once", async () => {
    const s = service({
      backgroundReady: true,
      credentialStorageReady: true,
      connection: { configured: false },
      schedule,
    });
    const shell = s as unknown as BackgroundClient;
    expect(await ensureBackgroundWork(client, shell, 0)).toBe(true);
    expect(s.syncConfiguration).toHaveBeenCalledTimes(1);
    expect(s.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, local_time: "08:00" }),
    );
    // Checked at most hourly per account.
    expect(await ensureBackgroundWork(client, shell, 1000)).toBe(false);
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves an enabled schedule and a service without background alone", async () => {
    const on = service({
      backgroundReady: true,
      credentialStorageReady: true,
      connection: { configured: true },
      schedule: { ...schedule, enabled: true, local_time: "07:30" },
    });
    expect(
      await ensureBackgroundWork(client, on as unknown as BackgroundClient, 0),
    ).toBe(false);
    expect(on.saveSchedule).not.toHaveBeenCalled();
    resetBackgroundDefault();
    const off = service({
      backgroundReady: false,
      credentialStorageReady: true,
      schedule,
    });
    expect(
      await ensureBackgroundWork(client, off as unknown as BackgroundClient, 0),
    ).toBe(false);
    expect(off.syncConfiguration).not.toHaveBeenCalled();
  });
});

describe("Settings pages", () => {
  it("shows About with the build version", () => {
    const html = renderToStaticMarkup(<AboutSheet onClose={() => {}} />);
    expect(html).toContain("Open Muse");
    // A build names its commit; without one it says so.
    expect(html).toMatch(/Version ([0-9a-f]{7}|Development build)/);
    expect(html).not.toContain("0.2.0");
    expect(t("Version {version}", { version: "abc1234" }, "zh-CN")).toBe(
      "版本 abc1234",
    );
  });

  it("lists this device and describes others before signing in", () => {
    const html = renderToStaticMarkup(<DevicesSheet onClose={() => {}} />);
    expect(html).toContain("This device");
    expect(html).toContain("Other devices");
    expect(html).toContain(
      "Devices signed in to your Open Muse account appear here once you sign in.",
    );
    // Each device opens its details; removing one happens there.
    expect(html).toContain('class="row-chevron"');
    expect(html).not.toContain("Remove");
    expect(t("Last seen", {}, "zh-CN")).toBe("最后上线");
    expect(lastSeen(0, 30_000)).toBe("Online");
  });

  it("offers Lark as the message channel", () => {
    const html = renderToStaticMarkup(
      <ChannelsSheet onClose={() => {}} onDraft={() => {}} />,
    );
    expect(html).toContain("Message channels");
    expect(html).toContain("Lark");
    // Lark is listed as available and opens its own page, where it connects.
    expect(html).toContain("Available");
    expect(html).toContain('class="row-chevron"');
    expect(html).not.toContain("never your other Lark chats");
    expect(larkChannelName).toBe("Lark message channel");
    expect(t("Disconnect Lark", {}, "zh-CN")).toBe("断开飞书");
  });

  it("puts removing the key and the account behind red buttons", () => {
    const html = renderToStaticMarkup(
      <AccountSheet
        client={{ auth: async () => ({ ready: false }) } as unknown as Client}
        onClose={() => {}}
        onChanged={() => {}}
        service={
          {
            accountOwner: () => "muse_user_abc",
            accountEmail: () => "person@example.com",
            configured: () => false,
            accountConfigured: () => true,
          } as unknown as BackgroundClient
        }
      />,
    );
    expect(html).toContain("person@example.com");
    expect(html).toContain("Account ID: abc");
    expect(html).toContain("settings-destructive");
    expect(html).toContain("Delete account");
    // No checkbox consent and no separate Start button.
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Start something new");
  });
});
