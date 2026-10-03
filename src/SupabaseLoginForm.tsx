import { useState } from "react";
import { t } from "../shared/i18n";

type Mode = "sign-in" | "register" | "reset";

export function SupabaseLoginForm({
  busy,
  onSignIn,
  onSignUp,
  onRequestReset,
  onReset,
}: {
  busy: boolean;
  onSignIn(email: string, password: string): Promise<void>;
  // Resolves true once a registration was submitted, so the form can offer
  // sign-in next instead of a second registration.
  onSignUp(email: string, password: string): Promise<boolean>;
  // Resolves true once the provider accepted the request for a code.
  onRequestReset(email: string): Promise<boolean>;
  onReset(email: string, code: string, password: string): Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [mode, setMode] = useState<Mode>("sign-in"),
    [consent, setConsent] = useState(false),
    [codeSent, setCodeSent] = useState(false);
  const register = mode === "register",
    reset = mode === "reset";
  const switchTo = (next: Mode) => {
    setMode(next);
    setPassword("");
    setCode("");
    setConsent(false);
    setCodeSent(false);
  };
  const clear = () => {
    setPassword("");
    setCode("");
  };
  return (
    <form
      className="background-form"
      aria-label={t("Open Muse account login")}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (reset && !codeSent) {
          void onRequestReset(email.trim()).then(setCodeSent, () => {});
          return;
        }
        if (reset) {
          void onReset(email.trim(), code.trim(), password).then(clear, clear);
          return;
        }
        if (register && !consent) return;
        const action = register ? onSignUp : onSignIn;
        void action(email.trim(), password).then(
          (submitted) => {
            setPassword("");
            if (submitted) setMode("sign-in");
          },
          () => setPassword(""),
        );
      }}
    >
      <p className="background-note">
        {reset
          ? codeSent
            ? t(
                "If an account uses this email, a code is on its way. Enter it with your new password.",
              )
            : t(
                "Enter your account email and we'll send a code to reset your password.",
              )
          : t(
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
          disabled={busy || (reset && codeSent)}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {reset && codeSent && (
        <label className="field">
          {t("Code from the email")}
          <input
            value={code}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      )}
      {(!reset || codeSent) && (
        <label className="field">
          {reset ? t("New password") : t("Account password")}
          <input
            type="password"
            value={password}
            required
            minLength={8}
            maxLength={1024}
            autoComplete={
              register || reset ? "new-password" : "current-password"
            }
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      )}
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
            (reset && !codeSent
              ? false
              : password.length < 8 || (reset && !code.trim())) ||
            (register && !consent)
          }
        >
          {reset
            ? codeSent
              ? t("Set new password and sign in")
              : t("Send code")
            : register
              ? t("Create Open Muse account")
              : t("Sign in to Open Muse")}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => switchTo(register || reset ? "sign-in" : "register")}
        >
          {reset
            ? t("Back to sign in")
            : register
              ? t("Use an existing account")
              : t("Create an account instead")}
        </button>
      </div>
      {mode === "sign-in" && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => switchTo("reset")}
        >
          {t("Forgot password?")}
        </button>
      )}
    </form>
  );
}
