import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import type { SecureCredential } from "../../src/direct/vault";
import { Modal } from "./Chrome";

// Secrets the agent can use, kept in the account's MA vault. A value is sent
// once and never shown again; MA injects it into new conversations.
export function SecureStorage({ client }: { client: Client }) {
  const [items, setItems] = useState<SecureCredential[]>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [form, setForm] = useState({ name: "", value: "", hosts: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedIn = client.signedIn();
  const load = useCallback(() => {
    if (!signedIn) return;
    void client
      .secureCredentials()
      .then(setItems)
      .catch((failure: Error) => setError(failure.message));
  }, [client, signedIn]);
  useEffect(load, [load]);
  if (!signedIn) return null;
  const run = (request: Promise<SecureCredential[]>, done: () => void) => {
    setBusy(true);
    setError("");
    void request
      .then((value) => {
        setItems(value);
        done();
      })
      .catch((failure: Error) => {
        setError(failure.message);
        load();
      })
      .finally(() => setBusy(false));
  };
  const hosts = form.hosts
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    <>
      <h2>{t("Secrets for your assistant")}</h2>
      <div className="settings-group">
        {items?.map((item) => (
          <div className="settings-row settings-device-row" key={item.id}>
            <KeyRound size={16} />
            <div>
              <strong>{item.name}</strong>
              <p>
                {item.hosts.length
                  ? t("Only for {hosts}", { hosts: item.hosts.join(", ") })
                  : t("For any website")}
              </p>
            </div>
            {removing === item.id ? (
              <button
                className="settings-inline-button danger"
                disabled={busy}
                onClick={() =>
                  run(client.removeSecureCredential(item.id), () =>
                    setRemoving(undefined),
                  )
                }
              >
                {t("Confirm")}
              </button>
            ) : (
              <button
                className="settings-inline-button"
                onClick={() => setRemoving(item.id)}
              >
                {t("Remove")}
              </button>
            )}
          </div>
        ))}
        <div className="settings-row">
          <div>
            <p>
              {t(
                "Your assistant can use these in conversations started after you add them. A value is sent to your Ark project once and is never shown again.",
              )}
            </p>
          </div>
          <button
            className="settings-inline-button"
            disabled={!items}
            onClick={() => setAdding(true)}
          >
            {t("Add")}
          </button>
        </div>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {adding && (
        <Modal
          title={t("Add a secret")}
          onClose={() => !busy && setAdding(false)}
        >
          <form
            className="secret-form"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                client.addSecureCredential({
                  name: form.name.trim(),
                  value: form.value,
                  hosts,
                }),
                () => {
                  setAdding(false);
                  setForm({ name: "", value: "", hosts: "" });
                },
              );
            }}
          >
            <label>
              <span>{t("Name")}</span>
              <input
                value={form.name}
                placeholder="GITHUB_TOKEN"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={64}
                required
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
              <small>
                {t(
                  "Letters, digits and underscores. Your assistant sees it as an environment variable with this name.",
                )}
              </small>
            </label>
            <label>
              <span>{t("Value")}</span>
              <input
                type="password"
                value={form.value}
                maxLength={4096}
                required
                autoComplete="off"
                onChange={(event) =>
                  setForm({ ...form, value: event.target.value })
                }
              />
            </label>
            <label>
              <span>{t("Websites (optional)")}</span>
              <input
                value={form.hosts}
                placeholder="api.example.com"
                onChange={(event) =>
                  setForm({ ...form, hosts: event.target.value })
                }
              />
              <small>
                {t(
                  "Limit where it can be sent, separated by commas. Leave empty to allow any website.",
                )}
              </small>
            </label>
            <div className="feed-dialog-actions">
              <button
                type="button"
                className="pill-button"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="pill-button primary"
                disabled={busy || !form.name.trim() || !form.value}
              >
                {t("Save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
