import { createRoot } from "react-dom/client";
import { Client } from "../../src/api";
import { DesktopApp } from "./DesktopApp";
import { nativeCredentials } from "./credentials";
import "./desktop.css";

const client = new Client({ vault: nativeCredentials });
const root = createRoot(document.getElementById("root")!);
async function start() {
  root.render(
    <main className="startup-error" role="status">
      <h1>Opening your workspace</h1>
      <p>
        Restoring your saved connection from macOS Keychain. If macOS asks,
        review the access request to continue.
      </p>
    </main>,
  );
  try {
    await client.restore();
    root.render(<DesktopApp client={client} />);
  } catch (error) {
    root.render(
      <main className="startup-error">
        <h1>Could not open your workspace</h1>
        <p>{(error as Error).message}</p>
        <button onClick={() => void start()}>Try again</button>
      </main>,
    );
  }
}
void start();
