import { useState } from "react";
import { t } from "../shared/i18n";

export function SupabaseLoginForm({
  busy,
  onSignIn,
  onSignUp,
}: {
  busy: boolean;
  onSignIn(email: string, password: string): Promise<void>;
  onSignUp(email: string, password: string): Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [register, setRegister] = useState(false),
    [consent, setConsent] = useState(false);
  return (
    <form
      className="background-form"
      aria-label={t("Muse account login")}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || (register && !consent)) return;
        const action = register ? onSignUp : onSignIn;
        void action(email.trim(), password).then(
          () => setPassword(""),
          () => setPassword(""),
        );
      }}
    >
      <h3>{t("Muse account")}</h3>
      <p className="background-note">
        {t(
          "Sign in with your own account, not an Ark API key. Your Muse identity is shared across your devices; Ark login remains separate.",
        )}
      </p>
      <label className="field">
        {t("Account email")}
        <input
          type="email"
          value={email}
          required
          maxLength={254}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="field">
        {t("Account password")}
        <input
          type="password"
          value={password}
          required
          minLength={8}
          maxLength={1024}
          autoComplete={register ? "new-password" : "current-password"}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {register && (
        <label className="background-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={busy}
          />
          {t(
            "Create a Muse account with this email. The Auth provider will receive the email and password.",
          )}
        </label>
      )}
      <p className="background-note">
        {t(
          "Account login trial only. Per-user Ark workspaces are not migrated yet, so credential uploads and background generation stay disabled.",
        )}
      </p>
      <div className="background-actions">
        <button
          className="button primary"
          disabled={
            busy ||
            !email.trim() ||
            password.length < 8 ||
            (register && !consent)
          }
        >
          {register ? t("Create Muse account") : t("Sign in to Muse")}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setRegister(!register);
            setPassword("");
            setConsent(false);
          }}
        >
          {register
            ? t("Use an existing account")
            : t("Create an account instead")}
        </button>
      </div>
    </form>
  );
}
