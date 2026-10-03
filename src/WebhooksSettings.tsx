import { formatLocale, t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Copy, Webhook as WebhookIcon } from "lucide-react";
import type { WebhookList } from "../shared/webhooks";
import { backgroundClient, type BackgroundClient } from "./background-client";
import "./background.css";
import "./webhooks.css";

type Created = { id: string; name: string; url: string; secret: string };

// The hook's secret in the URL, for senders that cannot set headers (Lark).
export const tokenUrl = (created: Created) =>
  `${created.url}?token=${encodeURIComponent(created.secret)}`;

// A compact card: create a hook, see its secret once, list hooks with their
// last event, and revoke one after confirming.
export function WebhooksView({
  data,
  created,
  name,
  confirming,
  busy,
  error,
  copied,
  onName,
  onCreate,
  onDone,
  onCopy,
  onRevoke,
  onConfirm,
  onCancel,
}: {
  data?: WebhookList;
  created?: Created;
  name: string;
  confirming?: string;
  busy: boolean;
  error: string;
  copied?: string;
  onName: (value: string) => void;
  onCreate: () => void;
  onDone: () => void;
  onCopy: (value: string, label: string) => void;
  onRevoke: (id: string) => void;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}) {
  const last = (at: number | null) =>
    at
      ? t("Last event {time}", {
          time: new Date(at).toLocaleString(formatLocale()),
        })
      : t("No events yet");
  return (
    <section
      className="settings-card background-panel webhooks-panel"
      aria-label={t("Webhooks")}
    >
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <WebhookIcon size={21} />
        </div>
        <div>
          <h2>{t("Webhooks")}</h2>
          <p>
            {t(
              "Let other services, such as Lark or your scripts, send events to your companion.",
            )}
          </p>
        </div>
      </div>
      {data && (!data.ready.background || !data.ready.mainChat) && (
        <p className="background-note" role="status">
          {!data.ready.background
            ? t(
                "Events are refused until background work is allowed in While you're away.",
              )
            : t(
                "Events are refused until delivery while Open Muse is closed is on in Upcoming.",
              )}
        </p>
      )}
      {created ? (
        <div className="webhook-created" role="status">
          <h3>{t("“{name}” is ready", { name: created.name })}</h3>
          <p className="background-note">
            {t(
              "Copy the secret now; it is shown only once. Send it as a Bearer token, or use the address with the token for services that cannot set headers.",
            )}
          </p>
          {(
            [
              [t("Address"), created.url],
              [t("Secret"), created.secret],
              [t("Address with token"), tokenUrl(created)],
            ] as const
          ).map(([label, value]) => (
            <div className="webhook-value" key={label}>
              <span>{label}</span>
              <code>{value}</code>
              <button
                className="button secondary"
                aria-label={t("Copy {label}", { label })}
                onClick={() => onCopy(value, label)}
              >
                <Copy size={15} />
                {copied === label ? t("Copied") : t("Copy")}
              </button>
            </div>
          ))}
          <div className="background-actions">
            <button className="button primary" onClick={onDone}>
              {t("I've saved it")}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="background-form webhook-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <label className="field">
            {t("Webhook name")}
            <input
              value={name}
              maxLength={60}
              placeholder={t("For example, Lark events")}
              disabled={busy}
              onChange={(event) => onName(event.target.value)}
            />
          </label>
          <div className="background-actions">
            <button
              type="submit"
              className="button primary"
              disabled={busy || !name.trim()}
            >
              {t("Create webhook")}
            </button>
          </div>
        </form>
      )}
      {data && data.webhooks.length > 0 && (
        <ul className="webhook-list" aria-label={t("Your webhooks")}>
          {data.webhooks.map((hook) => (
            <li key={hook.id}>
              <div>
                <strong>{hook.name}</strong>
                <span>{last(hook.last_delivery_at)}</span>
              </div>
              {confirming === hook.id ? (
                <div className="webhook-confirm">
                  <p>
                    {t(
                      "Revoke “{name}”? Services using it stop reaching your companion at once.",
                      { name: hook.name },
                    )}
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={onCancel}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => onRevoke(hook.id)}
                  >
                    {t("Revoke")}
                  </button>
                </div>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy}
                  aria-label={t("Revoke {name}", { name: hook.name })}
                  onClick={() => onConfirm(hook.id)}
                >
                  {t("Revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && !data.webhooks.length && !created && (
        <p className="background-note">{t("No webhooks yet.")}</p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// Shown only in account builds with a signed-in Open Muse account.
export function WebhooksSettings({
  service = backgroundClient,
}: {
  service?: BackgroundClient;
}) {
  const [connected, setConnected] = useState(false);
  const [data, setData] = useState<WebhookList>();
  const [created, setCreated] = useState<Created>();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string>();
  const alive = useRef(true);
  const lock = useRef(false);
  const load = async () => {
    const list = await service.webhooks();
    if (alive.current) setData(list);
  };
  // Writes are sent once; the list is read again afterwards either way.
  const action = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      await load().catch(() => {});
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (service.configured())
      void (async () => {
        try {
          if (!service.connected()) await service.restore();
          if (!alive.current || !service.accountConnected()) return;
          setConnected(true);
          await load();
        } catch (e) {
          if (alive.current) setError((e as Error).message);
        }
      })();
    return () => {
      alive.current = false;
    };
  }, [service]);
  if (!service.configured() || !connected) return null;
  return (
    <WebhooksView
      data={data}
      created={created}
      name={name}
      confirming={confirming}
      busy={busy}
      error={error}
      copied={copied}
      onName={setName}
      onCreate={() =>
        void action(async () => {
          const result = await service.createWebhook(name);
          if (!alive.current) return;
          setCreated(result);
          setName("");
        })
      }
      onDone={() => {
        setCreated(undefined);
        setCopied(undefined);
      }}
      onCopy={(value, label) =>
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            if (alive.current) setCopied(label);
          })
          .catch(() => {})
      }
      onConfirm={setConfirming}
      onCancel={() => setConfirming(undefined)}
      onRevoke={(id) =>
        void action(async () => {
          await service.revokeWebhook(id);
          if (alive.current) setConfirming(undefined);
        })
      }
    />
  );
}
