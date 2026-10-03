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
import os
import shutil
import sys
import time
import urllib.error
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


LIVE = "/tmp/open-muse-live"
# Lets the agent act in the tab the person is watching. It attaches to the
# open tab and leaves Chrome running when it closes.
LIVE_MODULE = """
import json
import urllib.error
import urllib.request
from collections import deque

import websocket
from muse_browser import Browser


class LiveBrowser(Browser):
    \"\"\"The browser the person is watching in the app; what you do here appears on their screen.\"\"\"

    def __init__(self, timeout=30):
        self.timeout = timeout
        self.sequence = 0
        self.events = deque(maxlen=256)
        self.process = None
        with open("/tmp/open-muse-live/endpoint.json") as state_file:
            state = json.load(state_file)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(state["endpoint"] + "/json/list", timeout=5) as response:
            targets = json.load(response)
        page = next(target for target in targets if target["id"] == state["target"])
        self.endpoint = state["endpoint"]
        self.socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=timeout,
            suppress_origin=True, http_no_proxy=["127.0.0.1", "localhost"])
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.call("Page.setLifecycleEventsEnabled", {"enabled": True})

    def close(self):
        if self.socket:
            try:
                self.socket.close()
            except OSError:
                pass
            self.socket = None
"""


def share(browser):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(browser.endpoint + "/json/list", timeout=5) as response:
        page = next(target for target in json.load(response) if target["type"] == "page")
    os.makedirs(LIVE, exist_ok=True)
    with open(LIVE + "/live_browser.py", "w") as module:
        module.write(LIVE_MODULE)
    with open(LIVE + "/endpoint.json", "w") as state:
        json.dump({"endpoint": browser.endpoint, "target": page["id"]}, state)


def log(message):
    print(time.strftime("%H:%M:%S"), message, file=sys.stderr, flush=True)


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
    try:
        with Browser() as browser:
            share(browser)
            relay_view(browser, relay, token, start)
    finally:
        shutil.rmtree(LIVE, ignore_errors=True)


def relay_view(browser, relay, token, start):
    browser.call("Emulation.setDeviceMetricsOverride",
        {"width": WIDTH, "height": HEIGHT, "deviceScaleFactor": 1, "mobile": False})
    if start != "about:blank":
        browser.call("Page.navigate", {"url": start})
    after, shown, blank = 0, None, 0
    failing_since = None
    deadline = time.monotonic() + 35 * 60
    while time.monotonic() < deadline:
        try:
            image = browser.call("Page.captureScreenshot",
                {"format": "jpeg", "quality": 60})["data"]
            blank = 0
        except RuntimeError:
            # A page between documents cannot be captured for a moment.
            blank += 1
            if blank >= 60:
                log("the page could not be captured; stopping")
                return
            time.sleep(0.5)
            continue
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
            failing_since = None
        except urllib.error.HTTPError as error:
            if error.code == 404:
                log("the view was replaced or removed; stopping")
                return
            failing_since = failing_since or time.monotonic()
            log("relay answered " + str(error.code))
        except Exception as error:
            failing_since = failing_since or time.monotonic()
            log("relay unreachable: " + type(error).__name__)
        if failing_since is not None:
            # Ride out short outages of the relay, then give up.
            if time.monotonic() - failing_since > 180:
                log("the relay stayed unreachable; stopping")
                return
            time.sleep(min(10, 1 + time.monotonic() - failing_since))
            continue
        shown = digest
        if not reply.get("open"):
            log("the view was closed; stopping")
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
