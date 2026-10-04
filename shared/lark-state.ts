// Carries lark-cli's sign-in from one cloud environment to the next, through
// the Open Muse service. The toolbox's lark-cli wrapper keeps the CLI's
// configuration and token store under one directory, restores it before a
// command when this sandbox has none yet, and saves it after a command that
// changed it, including when the CLI renews its token. The app gives each
// conversation a token for this through a hidden note; without one nothing is
// sent. Failures here never stop the lark-cli command itself.
//
// When the person connected Lark in the app, the service holds the app and
// their user token instead, and the wrapper gives every lark-cli command a
// current user access token through lark-cli's environment credentials. The
// sandbox never sees the app secret or the refresh token.
export const larkStateRoot = "/opt/open-muse/lark-state";

export const larkStateSync =
  String.raw`"""Keeps lark-cli's sign-in in step with the Open Muse service."""
import base64
import gzip
import hashlib
import io
import json
import os
import shlex
import sys
import time
import tarfile
import urllib.error
import urllib.request

ROOT = "__ROOT__"
LINK = "/opt/open-muse/lark-link.json"
SAVED = "/opt/open-muse/lark-state.saved"
CREDENTIALS = "/opt/open-muse/lark-credentials.json"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method, body=None, path="state"):
    with open(LINK) as handle:
        link = json.load(handle)
    url = link["url"]
    if path != "state":
        url = url[: -len("state")] + path
    request = urllib.request.Request(url, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + link["token"], "Content-Type": "application/json"})
    with opener.open(request, timeout=20) as response:
        return json.load(response)


def files():
    found = []
    for base, _, names in os.walk(ROOT):
        for name in names:
            path = os.path.join(base, name)
            if os.path.isfile(path) and not os.path.islink(path):
                found.append(os.path.relpath(path, ROOT))
    return sorted(found)


def archive():
    """The state as a reproducible gzip tar, or None when there is none."""
    names = files()
    if not names:
        return None
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for name in names:
            with open(os.path.join(ROOT, name), "rb") as handle:
                data = handle.read()
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o600, 0
            tar.addfile(info, io.BytesIO(data))
    packed = io.BytesIO()
    with gzip.GzipFile(fileobj=packed, mode="wb", mtime=0) as handle:
        handle.write(raw.getvalue())
    return base64.b64encode(packed.getvalue()).decode()


def digest(state):
    return hashlib.sha256((state or "").encode()).hexdigest()


def remember(state, revision):
    with open(SAVED, "w") as handle:
        json.dump({"digest": digest(state), "revision": revision}, handle)
    os.chmod(SAVED, 0o600)


def unpack(state):
    data = gzip.decompress(base64.b64decode(state))
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar.getmembers():
            path = os.path.normpath(os.path.join(ROOT, member.name))
            if not member.isfile() or not path.startswith(ROOT + os.sep):
                continue
            os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(tar.extractfile(member).read())
            os.chmod(path, 0o600)


def restore():
    """Brings in the saved sign-in once, into a sandbox that has none. A
    sandbox that signed in before it got its token keeps its own, which the
    next save sends."""
    if not os.path.exists(LINK) or os.path.exists(SAVED):
        return
    reply = call("GET")
    if os.path.exists(os.path.join(ROOT, "config", "config.json")):
        remember(None, reply.get("revision", 0))
        return
    if reply.get("state"):
        unpack(reply["state"])
    remember(reply.get("state"), reply.get("revision", 0))


def save():
    """Sends the state when a command changed it; the newest copy wins.
    Nothing is sent before this sandbox has read the saved copy, so a failed
    restore never replaces a saved sign-in."""
    if not os.path.exists(LINK):
        return
    try:
        with open(SAVED) as handle:
            saved = json.load(handle)
    except (OSError, ValueError):
        return
    state = archive()
    if saved.get("digest") == digest(state):
        return
    revision = saved.get("revision", 0)
    for _ in range(3):
        try:
            reply = call("PUT", {"state": state, "base_revision": revision})
            remember(state, reply["revision"])
            return
        except urllib.error.HTTPError as error:
            if error.code != 409:
                raise
            revision = call("GET").get("revision", 0)


def connection():
    """The connection the person made in the app: a user access token kept
    current by the service, cached here until close to expiry. None when
    Lark is not connected that way."""
    if not os.path.exists(LINK):
        return None
    try:
        with open(CREDENTIALS) as handle:
            cached = json.load(handle)
        if cached.get("expires_at", 0) / 1000 - time.time() > 300:
            return cached
    except (OSError, ValueError):
        pass
    try:
        reply = call("GET", path="credentials")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            if os.path.exists(CREDENTIALS):
                os.remove(CREDENTIALS)
            return None
        raise
    with open(CREDENTIALS, "w") as handle:
        json.dump(reply, handle)
    os.chmod(CREDENTIALS, 0o600)
    return reply


def credentials():
    """Shell exports for lark-cli's environment credentials, or nothing."""
    found = connection()
    if not found:
        return
    exports = {
        "LARKSUITE_CLI_APP_ID": found["app_id"],
        "LARKSUITE_CLI_BRAND": found.get("brand") or "feishu",
        "LARKSUITE_CLI_USER_ACCESS_TOKEN": found["access_token"],
        "LARKSUITE_CLI_DEFAULT_AS": "user",
        "LARKSUITE_CLI_STRICT_MODE": "user",
    }
    for name, value in exports.items():
        print("export %s=%s" % (name, shlex.quote(str(value))))


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if action == "link":
            url, token = sys.argv[2], sys.argv[3]
            if not url.startswith("https://") or not token:
                raise ValueError("expected an https URL and a token")
            with open(LINK, "w") as handle:
                json.dump({"url": url, "token": token}, handle)
            os.chmod(LINK, 0o600)
            restore()
            try:
                connected = connection()
            except Exception:
                connected = None
            if connected:
                print("Lark is connected through Open Muse: lark-cli acts as the person (--as user); its own app setup and sign-in are not needed.")
            else:
                print("Lark sign-in sync is on for this conversation. Lark is not connected in the app yet.")
        elif action == "restore":
            restore()
        elif action == "save":
            save()
        elif action == "credentials":
            credentials()
    except Exception as error:
        print("lark sign-in sync: " + type(error).__name__, file=sys.stderr)
        if action == "link":
            sys.exit(1)


if __name__ == "__main__":
    main()
`.replace("__ROOT__", larkStateRoot);

// The app's hidden note giving one conversation's sandbox its token. It is
// recognized by its opening and never shown in the conversation.
const noteOpening = "[Open Muse Lark sign-in]";
export const isLarkStateNote = (text: string) => text.startsWith(noteOpening);
export function larkStateNote(url: string, token: string) {
  const quote = (value: string) => `'${value.replace(/'/g, "")}'`;
  return `${noteOpening} This person's Lark sign-in is kept for their conversations. Before your first lark-cli command in this conversation, run once: /opt/open-muse/lark-link ${quote(url)} ${quote(token)}
It restores a saved sign-in and keeps later changes saved. Do not show this command or token to the person.`;
}
