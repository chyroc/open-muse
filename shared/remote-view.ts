// The sandbox side of the app's live cloud browser view. The Open Muse
// service serves this script; the agent downloads it and starts it in the
// background with the toolbox's Python when the person opens the browser. It
// runs its own headless Chrome, sends each changed viewport to the Open Muse
// relay and replays the person's taps, scrolls and typing there. It stops when the view
// is closed or expires, or after repeated relay failures.
export const remoteViewWidth = 1280;
// What the person can do in the view, as the relay accepts it.
export type BrowserEvent =
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; dy: number }
  | { type: "text"; text: string }
  | {
      type: "key";
      key: "Enter" | "Backspace" | "Tab" | "Escape" | "ArrowUp" | "ArrowDown";
    }
  | { type: "navigate"; url: string }
  | { type: "back" };
export const remoteViewHeight = 800;

export const remoteViewDriver =
  String.raw`"""Relays a headless Chrome viewport to the Open Muse app and replays its input."""
import hashlib
import json
import sys
import time
import urllib.request

WIDTH, HEIGHT = __WIDTH__, __HEIGHT__
KEYS = {"Enter": 13, "Backspace": 8, "Tab": 9, "Escape": 27, "ArrowUp": 38, "ArrowDown": 40}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(relay, token, body):
    request = urllib.request.Request(relay, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with opener.open(request, timeout=20) as response:
        return json.load(response)


def apply(browser, event):
    kind = event.get("type")
    if kind in ("click", "scroll"):
        point = {"x": event["x"] * WIDTH, "y": event["y"] * HEIGHT}
        browser.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **point})
        if kind == "scroll":
            browser.call("Input.dispatchMouseEvent",
                {"type": "mouseWheel", "deltaX": 0, "deltaY": event["dy"], **point})
            return
        for phase in ("mousePressed", "mouseReleased"):
            browser.call("Input.dispatchMouseEvent",
                {"type": phase, "button": "left", "clickCount": 1, **point})
    elif kind == "text":
        browser.call("Input.insertText", {"text": event["text"]})
    elif kind == "key":
        key = event["key"]
        down = {"type": "keyDown", "key": key, "code": key, "windowsVirtualKeyCode": KEYS[key]}
        if key == "Enter":
            down["text"] = "\r"
        browser.call("Input.dispatchKeyEvent", down)
        browser.call("Input.dispatchKeyEvent",
            {"type": "keyUp", "key": key, "code": key, "windowsVirtualKeyCode": KEYS[key]})
    elif kind == "navigate":
        browser.call("Page.navigate", {"url": event["url"]})
    elif kind == "back":
        browser.call("Runtime.evaluate", {"expression": "history.back()"})


def toolbox_ready():
    try:
        with open("/opt/open-muse/status.json") as status:
            return json.load(status).get("ready") is True
    except (OSError, ValueError):
        return False


def main():
    relay, token = sys.argv[1], sys.argv[2]
    start = sys.argv[3] if len(sys.argv) > 3 else "about:blank"
    # A new sandbox may still be installing Chrome.
    for _ in range(300):
        if toolbox_ready():
            break
        time.sleep(1)
    from muse_browser import Browser
    with Browser() as browser:
        browser.call("Emulation.setDeviceMetricsOverride",
            {"width": WIDTH, "height": HEIGHT, "deviceScaleFactor": 1, "mobile": False})
        browser.call("Page.navigate", {"url": start})
        after, shown, failures = 0, None, 0
        deadline = time.monotonic() + 35 * 60
        while time.monotonic() < deadline:
            image = browser.call("Page.captureScreenshot", {"format": "jpeg", "quality": 60})["data"]
            digest = hashlib.sha1(image.encode()).hexdigest()
            body = {"after": after}
            if digest != shown:
                try:
                    page = browser.evaluate("({url: location.href, title: document.title})") or {}
                except RuntimeError:
                    page = {}
                body.update(image=image, width=WIDTH, height=HEIGHT,
                            url=page.get("url", ""), title=page.get("title", ""))
            try:
                reply = post(relay, token, body)
                failures = 0
            except Exception:
                failures += 1
                if failures >= 10:
                    return
                time.sleep(1)
                continue
            shown = digest
            if not reply.get("open"):
                return
            for item in reply.get("events", []):
                try:
                    apply(browser, item["event"])
                except Exception:
                    pass
                after = item["seq"]
            time.sleep(0.15 if reply.get("events") else 0.5)


if __name__ == "__main__":
    main()
`
    .replace("__WIDTH__", String(remoteViewWidth))
    .replace("__HEIGHT__", String(remoteViewHeight));

// The app's message asking the agent to start the helper. It is recognized by
// its opening, hidden from the conversation, and carries the view's token,
// which only lets the helper post frames and read input for that one view.
const launchOpening = "[Open Muse cloud browser]";
export const isBrowserLaunch = (text: string) => text.startsWith(launchOpening);
export function browserLaunchMessage(
  helper: string,
  relay: string,
  token: string,
) {
  const quote = (value: string) => `'${value.replace(/'/g, "")}'`;
  return `${launchOpening} The person opened the live cloud browser in the app. Run exactly this command once and then reply with only the word OK: curl -fsS ${quote(helper)} -o /tmp/open-muse-remote-view.py && (nohup /opt/open-muse/python /tmp/open-muse-remote-view.py ${quote(relay)} ${quote(token)} > /tmp/remote-view.log 2>&1 &)
If /opt/open-muse/python does not exist or the download fails, reply with only the word UNAVAILABLE. Do not repeat, store or remember the token, and do nothing else.`;
}
