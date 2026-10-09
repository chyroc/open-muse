import { initializeLanguage } from "../../shared/i18n";
import { createRoot } from "react-dom/client";
import { Client } from "../../src/api";
import { backgroundClient } from "../../src/background-client";
import { DesktopApp } from "./DesktopApp";
import { QuickChat } from "./QuickChat";
import { SettingsWindow } from "./SettingsWindow";
import { isSettingsRoute } from "./settings";
import { initializeAppearance } from "./appearance";
import { restoreInBackground } from "./startup";
import { nativeCredentials } from "./credentials";
import { installWindowDrag } from "./windowDrag";
import "./theme.css";
import "./desktop.css";
import "./documents.css";
import "./feed.css";
import "./ideas.css";
import "./goals.css";
import "./quick.css";

initializeLanguage();
initializeAppearance();
installWindowDrag();
// Messages tell the companion they come from the Mac, so it reaches for the
// Mac's own tools, such as its calendar, instead of the iPhone's.
const client = new Client({
  vault: nativeCredentials,
  account: backgroundClient,
  surface: "mac",
});
// The native shell opens the settings window on its own route, so one bundle
// serves both windows without the workspace rendering behind it.
const settingsWindow = isSettingsRoute(location.hash);
const quickWindow = /^#\/quick$/.test(location.hash);
const root = createRoot(document.getElementById("root")!);
// The window renders before the Keychain answer arrives. A pending or denied
// authorization leaves the app usable and disconnected instead of blank, and
// the saved credential is untouched either way.
root.render(
  settingsWindow ? (
    <SettingsWindow client={client} />
  ) : quickWindow ? (
    <QuickChat client={client} />
  ) : (
    <DesktopApp client={client} />
  ),
);
void restoreInBackground(client);
