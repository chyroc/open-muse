import { initializeLanguage, t } from "../../shared/i18n";
import { createRoot } from "react-dom/client";
import { Client } from "../../src/api";
import { DesktopApp } from "./DesktopApp";
import { nativeCredentials } from "./credentials";
import "./desktop.css";
import "./documents.css";
import "./feed.css";
import "./ideas.css";
import "./goals.css";

initializeLanguage();
const client = new Client({ vault: nativeCredentials });
const root = createRoot(document.getElementById("root")!);
async function start() {
  root.render(
    <main className="startup-error" role="status">
      <h1>{t("Opening your workspace")}</h1>
      <p>
        {t(
          "Restoring your saved connection from macOS Keychain. If macOS asks, review the access request to continue.",
        )}
      </p>
    </main>,
  );
  try {
    await client.restore();
    root.render(<DesktopApp client={client} />);
  } catch (error) {
    root.render(
      <main className="startup-error">
        <h1>{t("Could not open your workspace")}</h1>
        <p>{(error as Error).message}</p>
        <button onClick={() => void start()}>{t("Try again")}</button>
      </main>,
    );
  }
}
void start();
