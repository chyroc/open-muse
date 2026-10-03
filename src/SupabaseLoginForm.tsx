import { useState } from "react";
import { t } from "../shared/i18n";

export function SupabaseLoginForm({
  busy,
  onSignIn,
  onSignUp,
}: {
  busy: boolean;
  onSignIn(email: string, password: string): Promise<void>;
  // Resolves true once a registration was submitted, so the form can offer
  // sign-in next instead of a second registration.
  onSignUp(email: string, password: string): Promise<boolean>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [register, setRegister] = useState(false),
    [consent, setConsent] = useState(false);
  return (
    <form
      className="background-form"
      aria-label={t("Open Muse account login")}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || (register && !consent)) return;
        const action = register ? onSignUp : onSignIn;
        void action(email.trim(), password).then(
          (submitted) => {
            setPassword("");
            if (submitted) setRegister(false);
          },
          () => setPassword(""),
        );
      }}
    >
      <p className="background-note">
        {t(
          "Sign in with your Open Muse account. Your Ark API key is saved to the account separately and is not used to identify you.",
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
            "Create an Open Muse account with this email. The Auth provider will receive the email and password.",
          )}
        </label>
      )}
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
          {register ? t("Create Open Muse account") : t("Sign in to Open Muse")}
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
