// Embedded in the native bundle and written only inside the cloud sandbox.
export const chromeVersion = "154.0.8037.57";
// SHA-256 of the archives downloaded directly from the official release URLs.
export const chromeChecksums = {
  linux64: "ceee2972074d441ea7c4ba8bcc0eaab77e7e87680f6653d73d3065851fe10302",
  "linux-arm64":
    "da83171e552650df34272a9c51f62182bae88d467d1ac19c92dd97917dfa0bca",
};

export const chromeDownload = String.raw`case "$(uname -m)" in
  x86_64) chrome_platform=linux64; chrome_sha=__LINUX64_SHA__ ;;
  aarch64|arm64) chrome_platform=linux-arm64; chrome_sha=__ARM64_SHA__ ;;
  *) printf '%s\n' 'Unsupported Chrome architecture' >&2; exit 1 ;;
esac
chrome_archive=/opt/open-muse/chrome-download.zip
verify_chrome() {
  printf '%s  %s\n' "$chrome_sha" "$1" | sha256sum --check --status
}
download_chrome() {
  curl --fail --silent --show-error --location --retry 1 --connect-timeout 10 \
    --max-time 120 --speed-limit 65536 --speed-time 20 "$1" -o "$chrome_archive.partial" &&
    verify_chrome "$chrome_archive.partial" && mv "$chrome_archive.partial" "$chrome_archive"
}
if ! [ -f "$chrome_archive" ] || ! verify_chrome "$chrome_archive"; then
  printf '%s\n' 'Downloading Chrome from the public CDN with pinned SHA-256 verification.'
  if ! download_chrome "https://cdn.npmmirror.com/binaries/chrome-for-testing/__CHROME_VERSION__/$chrome_platform/chrome-$chrome_platform.zip"; then
    printf '%s\n' 'CDN download or checksum failed; trying the official release URL.'
    download_chrome "https://storage.googleapis.com/chrome-for-testing-public/__CHROME_VERSION__/$chrome_platform/chrome-$chrome_platform.zip"
  fi
fi
verify_chrome "$chrome_archive"
unzip -oq "$chrome_archive" -d /opt/open-muse
ln -sfn "/opt/open-muse/chrome-$chrome_platform" /opt/open-muse/chrome
`
  .replaceAll("__CHROME_VERSION__", chromeVersion)
  .replace("__LINUX64_SHA__", chromeChecksums.linux64)
  .replace("__ARM64_SHA__", chromeChecksums["linux-arm64"]);

export const browserDriver = String.raw`"""Small synchronous Chrome DevTools Protocol client; no browser framework."""
import argparse
import base64
from collections import deque
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import urllib.request
import websocket


class Browser:
    def __init__(self, timeout=30):
        self.timeout = timeout
        self.sequence = 0
        self.events = deque(maxlen=256)
        self.socket = None
        self.process = None
        self.profile = tempfile.TemporaryDirectory(prefix="muse-chrome-")
        self.log = tempfile.TemporaryFile()
        try:
            args = ["/opt/open-muse/chrome/chrome", "--headless=new",
                    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
                    "--user-data-dir=" + self.profile.name, "--no-first-run",
                    "--no-default-browser-check", "--disable-dev-shm-usage",
                    "--window-size=1440,1000", "about:blank"]
            # MA's root container is already isolated; never borrow a host profile.
            if os.geteuid() == 0:
                args.insert(1, "--no-sandbox")
            self.process = subprocess.Popen(args, stdin=subprocess.DEVNULL,
                                            stdout=self.log, stderr=self.log, start_new_session=True)
            deadline = time.monotonic() + timeout
            port_file = Path(self.profile.name, "DevToolsActivePort")
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("Chrome exited during startup; check installed system libraries")
                try:
                    port = int(port_file.read_text().splitlines()[0])
                    self.endpoint = "http://127.0.0.1:" + str(port)
                    with opener.open(self.endpoint + "/json/list", timeout=2) as response:
                        targets = json.load(response)
                    page = next(target for target in targets if target["type"] == "page")
                    self.socket = websocket.create_connection(page["webSocketDebuggerUrl"],
                        timeout=timeout, suppress_origin=True, http_no_proxy=["127.0.0.1", "localhost"])
                    break
                except (OSError, ValueError, IndexError, StopIteration):
                    time.sleep(0.1)
            if self.socket is None:
                raise TimeoutError("Chrome CDP startup timed out")
            self.call("Page.enable")
            self.call("Runtime.enable")
            self.call("Page.setLifecycleEventsEnabled", {"enabled": True})
        except BaseException:
            self.close()
            raise

    def _receive(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("CDP command timed out; inspect state before retrying an action")
        self.socket.settimeout(remaining)
        return json.loads(self.socket.recv())

    def call(self, method, params=None):
        """Send any CDP method, returning its result or raising on protocol errors."""
        self.sequence += 1
        request_id = self.sequence
        self.socket.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        deadline = time.monotonic() + self.timeout
        while True:
            message = self._receive(deadline)
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError("CDP " + method + ": " + str(message["error"]))
                return message.get("result", {})
            if "method" in message:
                self.events.append(message)

    def wait_event(self, method, predicate=lambda params: True):
        deadline = time.monotonic() + self.timeout
        while True:
            for event in list(self.events):
                if event.get("method") == method and predicate(event.get("params", {})):
                    self.events.remove(event)
                    return event.get("params", {})
            message = self._receive(deadline)
            if "method" in message:
                self.events.append(message)

    def navigate(self, url):
        result = self.call("Page.navigate", {"url": url})
        if result.get("errorText"):
            raise RuntimeError("Navigation failed: " + result["errorText"])
        loader = result.get("loaderId")
        if loader:
            self.wait_event("Page.lifecycleEvent", lambda p: p.get("loaderId") == loader and p.get("name") == "load")
        return self.evaluate("({title:document.title,url:location.href})")

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in result:
            raise RuntimeError("Page JavaScript failed: " + str(result["exceptionDetails"]))
        return result.get("result", {}).get("value")

    def wait(self, expression):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            result = self.evaluate(expression)
            if result:
                return result
            time.sleep(0.1)
        raise TimeoutError("Page condition timed out")

    def click(self, selector):
        point = self.evaluate("(() => { const e=document.querySelector(" + json.dumps(selector) + ");"
            "if(!e) throw Error('Element not found'); e.scrollIntoView({block:'center'});"
            "const r=e.getBoundingClientRect(); if(!r.width || !r.height) throw Error('Element not visible');"
            "return {x:r.x+r.width/2,y:r.y+r.height/2}; })()")
        for kind in ["mousePressed", "mouseReleased"]:
            self.call("Input.dispatchMouseEvent", {"type": kind, "button": "left", "clickCount": 1, **point})

    def screenshot(self, path):
        data = self.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
        Path(path).write_bytes(base64.b64decode(data["data"]))

    def pdf(self, path):
        data = self.call("Page.printToPDF", {"printBackground": True, "preferCSSPageSize": True})
        Path(path).write_bytes(base64.b64decode(data["data"]))

    def close(self):
        if self.socket:
            try:
                self.socket.close()
            except OSError:
                pass
            self.socket = None
        if self.process:
            try:
                if self.process.poll() is None:
                    os.killpg(self.process.pid, signal.SIGTERM)
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(self.process.pid, signal.SIGKILL)
                        self.process.wait(timeout=5)
            except ProcessLookupError:
                self.process.wait(timeout=5)
            finally:
                # Chrome's children can still be writing after its parent exits.
                # This group belongs only to the Popen session created above.
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            self.process = None
        self.log.close()
        for attempt in range(10):
            try:
                self.profile.cleanup()
                break
            except OSError:
                if attempt == 9:
                    raise
                time.sleep(0.1)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Headless Chrome via raw CDP; a fresh isolated browser per invocation")
    parser.add_argument("url")
    parser.add_argument("--screenshot")
    parser.add_argument("--pdf")
    args = parser.parse_args()
    with Browser() as browser:
        result = browser.navigate(args.url)
        if args.screenshot:
            browser.screenshot(args.screenshot)
        if args.pdf:
            browser.pdf(args.pdf)
        print(json.dumps(result))
`;
