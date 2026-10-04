import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import type { WebhookList } from "../shared/webhooks";
import { backgroundClient, type BackgroundClient } from "./background-client";
import { Sheet } from "./MusePages";
import { LarkConnectSheet } from "./LarkConnectSheet";
import { AppIcon } from "./AppIcons";
import { RowChevron } from "./SettingsHome";
import "./channels-sheet.css";

// The hook that carries the person's Lark bot messages. Its name marks it in
// the account's webhook list.
export const larkChannelName = "Lark message channel";

// Message channels: talk to the assistant from another app. The page lists
// the channels as Connected or Available; each opens its own page, where it
// is connected and disconnected. Lark is the one channel here: the person's own Lark bot posts its messages to an incoming
// webhook, they reach the main chat, and the assistant answers in Lark as
// the bot once it has confirmed the sender is the person. The hook's address
// is shown once, when the channel is connected. The bot belongs to the
// person's Lark app, so a person who has not connected Lark yet does that
// first, in the same sheet as Connectors.
export function ChannelsSheet({
  onClose,
  onDraft,
  service = backgroundClient,
}: {
  client?: unknown;
  onClose: () => void;
  // Puts text in the main chat composer for the person to review and send.
  onDraft: (text: string) => void;
  service?: BackgroundClient;
}) {
  const [data, setData] = useState<WebhookList>();
  const [address, setAddress] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [larkSetup, setLarkSetup] = useState(false);
  const [open, setOpen] = useState(false);
  const alive = useRef(true);
  const account = service.configured();
  const load = async () => {
    const list = await service.webhooks();
    if (alive.current) setData(list);
  };
  useEffect(() => {
    alive.current = true;
    if (account)
      void (async () => {
        try {
          if (!service.connected()) await service.restore();
          if (alive.current && service.accountConnected()) await load();
        } catch (e) {
          if (alive.current) setError((e as Error).message);
        }
      })();
    return () => {
      alive.current = false;
    };
  }, [service]);
  const hook = data?.webhooks.find((item) => item.name === larkChannelName);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      await load().catch(() => {});
      if (alive.current) setBusy(false);
    }
  }
  const connect = () =>
    run(async () => {
      if ((await service.larkConnection()).phase !== "connected") {
        setLarkSetup(true);
        return;
      }
      await createHook();
    });
  const createHook = async () => {
    // A new address replaces an earlier one whose secret is gone.
    if (hook) await service.revokeWebhook(hook.id);
    const created = await service.createWebhook(larkChannelName);
    setAddress(`${created.url}?token=${encodeURIComponent(created.secret)}`);
    setCopied(false);
  };
  const disconnect = () => {
    if (
      !hook ||
      !confirm(
        t(
          "Disconnect Lark? Messages to your Lark bot stop reaching your assistant at once.",
        ),
      )
    )
      return;
    void run(async () => {
      await service.revokeWebhook(hook.id);
      setAddress(undefined);
    });
  };
  const ready = data && data.ready.mainChat && data.ready.background;
  const status = !account
    ? t("Needs an Open Muse account")
    : !data
      ? t("Loading…")
      : !hook
        ? t("Not connected")
        : hook.last_delivery_at
          ? t("Connected · last message {time}", {
              time: new Date(hook.last_delivery_at).toLocaleString(
                formatLocale(),
                {
                  dateStyle: "medium",
                  timeStyle: "short",
                },
              ),
            })
          : t("Connected · waiting for the first message");
  const readyNote = t(
    "Messages arrive once background work has started for your account and Deliver even when Open Muse is closed is on in Upcoming.",
  );
  const icon = (
    <span className="channel-icon app-icon" aria-hidden="true">
      <AppIcon id="lark" />
    </span>
  );
  return (
    <Sheet title={t("Message channels")} onClose={onClose} grouped>
      <p className="channels-intro">
        {t("Chat with your assistant from other messaging apps.")}
      </p>
      <h3 className="settings-group-title">
        {hook ? t("Connected") : t("Available")}
      </h3>
      <ul className="settings-list">
        <li>
          <button className="settings-list-row" onClick={() => setOpen(true)}>
            {icon}
            <span>{t("Lark")}</span>
            <RowChevron />
          </button>
        </li>
      </ul>
      {open && (
        <Sheet title="" onClose={() => setOpen(false)} grouped>
          {larkSetup && (
            <LarkConnectSheet
              name={t("Your assistant")}
              service={service}
              onConnected={() => void run(createHook)}
              onClose={() => setLarkSetup(false)}
            />
          )}
          <div className="channel-detail">
            {/* The channel itself: its app, where it stands, and what
              connecting it means; connecting waits at the foot. */}
            <div className="channel-hero">
              <span className="channel-hero-icon" aria-hidden="true">
                <AppIcon id="lark" />
              </span>
              <h2>{t("Lark")}</h2>
              {(hook || !account) && (
                <p className="channel-hero-status">{status}</p>
              )}
              <p>
                {t("Once connected, you can message your assistant from Lark.")}
              </p>
              <p>
                {t(
                  "Your assistant only reads the messages sent to your bot, never your other Lark chats, and acts on them only after confirming they come from your own Lark account. You can disconnect at any time.",
                )}
              </p>
            </div>
            {error && (
              <p className="settings-footnote" role="alert">
                {error}
              </p>
            )}
            {hook && data && !ready && (
              <p className="settings-footnote">{readyNote}</p>
            )}
            {address && (
              <section className="channel-setup">
                <h3>{t("Finish in Lark")}</h3>
                <p>
                  {t(
                    "This address is shown only now. Copy it, or let your assistant set Lark up with it.",
                  )}
                </p>
                <button
                  className="channel-address"
                  onClick={() =>
                    void navigator.clipboard?.writeText(address).then(
                      () => setCopied(true),
                      () => {},
                    )
                  }
                >
                  <code>{address}</code>
                  <span>
                    <Copy size={15} aria-hidden="true" />
                    {copied ? t("Copied") : t("Copy")}
                  </span>
                </button>
                <ol>
                  <li>
                    {t(
                      "In the Lark developer console, open the app your assistant uses with lark-cli and turn on its bot.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Under Events and callbacks, send events to this address and add the event for receiving messages (im.message.receive_v1). Leave the encrypt key empty.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Publish the app version, then send your bot a message in Lark.",
                    )}
                  </li>
                </ol>
                <button
                  className="button primary"
                  onClick={() =>
                    onDraft(
                      t(
                        "Set up my Lark message channel: for the Lark app you use with lark-cli, turn on the bot, send its message events (im.message.receive_v1) to {address} with no encrypt key, and publish it. Tell me what I still need to do in the Lark console.",
                        { address },
                      ),
                    )
                  }
                >
                  {t("Ask my assistant to set it up")}
                </button>
              </section>
            )}
            {hook && !address && (
              <ul className="settings-list channel-actions">
                <li>
                  <button
                    className="settings-list-row"
                    disabled={busy}
                    onClick={() => void connect()}
                  >
                    <span className="settings-row-text">
                      {t("Get a new address")}
                      <small>
                        {t(
                          "The current address stops working. Use the new one in Lark.",
                        )}
                      </small>
                    </span>
                  </button>
                </li>
                <li>
                  <button
                    className="settings-list-row settings-destructive"
                    disabled={busy}
                    onClick={disconnect}
                  >
                    <span>{t("Disconnect Lark")}</span>
                  </button>
                </li>
              </ul>
            )}
            {!hook && (
              <div className="channel-detail-foot">
                {data && !ready && <p>{readyNote}</p>}
                <button
                  className="channel-connect"
                  disabled={!account || !data || busy}
                  onClick={() => void connect()}
                >
                  {busy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    t("Connect")
                  )}
                </button>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}
