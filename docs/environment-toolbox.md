# Cloud environment toolbox

Open Muse provisions its cloud environments through MA `config.setup_script`. The setup script starts a background installer so package downloads do not block the sandbox's tool-readiness handshake. The browser is an isolated headless Google Chrome instance controlled directly through the Chrome DevTools Protocol (CDP). No separate browser agent, automation framework, model subscription, or additional model API key is required.

The default installation is deliberately small: Chrome, native CDP, Lark CLI and official skills. Supporting packages are limited to Chrome's system libraries, compact Latin/CJK fonts, download/extraction utilities, and two Python libraries: `websocket-client` for CDP and `PyYAML` for the skill index. Existing Python and Node runtimes are reused.

Office, OCR, data-science, plotting, media and extra development packages are not preinstalled. The agent checks available tools first and installs only the smallest dependency required by the current task, in a task-local virtual environment when applicable. Chrome already provides HTML-to-PDF output without a PDF library.

## Usage

1. Create a new task after updating the server. Existing app-owned environment and agent configurations are synchronized before the new session is created. A main chat whose app-owned instruction blocks are older continues into one linked session with the current text, pinned to its original agent version, model, tools and memory store, with its earlier history archived for context. Other existing sessions are not restarted or modified.
2. Run `/opt/open-muse/check` to verify Python imports, command availability, Chrome/CDP launch, clicking, valid PNG/PDF signatures, Lark CLI version/help, and installed skill files. Exit code 75 means installation is not ready. Poll the status file in short bounded intervals while its stage is `installing`; on `failed`, inspect `/opt/open-muse/setup.log` instead of starting duplicate installers.
3. Run CDP scripts with `/opt/open-muse/python`. This wrapper selects the isolated virtual environment and CDP helper module. It does not replace the system Python or Node installation.
4. Read `/opt/open-muse/status.json` for setup status. A stored `ready` result describes the last successful setup; the live check is authoritative if files or packages changed afterward.

## Deliverables and Library

MA exports files written to `/mnt/session/outputs` as session-scoped agent files. The agent instructions ask for every file the user should keep to be saved there with a descriptive name, one final verified copy per deliverable. Files elsewhere, such as `/workspace` or `/tmp`, are not exported. The iOS Library lists these exports for the connected identity's own sessions and opens them through short-lived signed URLs. MA sets an expiry on exported files, currently about seven days.

First-time provisioning downloads system packages, Python wheels, Chrome, Lark CLI and skills. It requires package repository access, root permissions in the cloud sandbox, adequate disk space, and Ubuntu 22.04 with Python 3.10+ and Node/npm/npx. Chrome packages support Linux x86-64 and ARM64. It can add several minutes to a cold start. The setup payload records readiness only after real browser/PDF and CLI/skills smoke tests pass. An unsuccessful setup must not be reported as an available capability.

The two Python dependencies are pinned in `shared/tooling.ts`, and the official Chrome for Testing version is pinned in `shared/browser-tooling.ts`. Lark uses the requested `@latest` installer; its resolved version and skill count are recorded by the check. Distribution packages follow their repositories. This is not a fully hermetic image. Setup uses an installation lock, a payload revision and a health check to avoid redundant installation on a healthy reused sandbox.

Chrome downloads prefer the public npm mirror CDN, with the official release URL as fallback. Both paths must match the SHA-256 recorded from the official architecture-specific archive before extraction. Downloads use a temporary filename, bounded timeouts and a low-speed cutoff; a failed or mismatched archive is never installed. A previously downloaded archive is reused only after the same checksum check. Updating Chrome requires updating both the version and the official checksums.

## Chrome and CDP

For one-shot capture, run `/opt/open-muse/browser https://example.com --screenshot /path/page.png --pdf /path/page.pdf`. For multi-step workflows, keep a single browser context:

```python
from muse_browser import Browser

with Browser() as browser:
    browser.navigate("https://example.com")
    print(browser.evaluate("document.title"))
    print(browser.call("Accessibility.getFullAXTree"))
    browser.screenshot("/path/page.png")
```

The helper uses `websocket-client` to send CDP commands directly. It includes navigation, condition waits, clicks, JavaScript evaluation, screenshots and PDF output; `call(method, params)` exposes the rest of CDP, including input and download controls. Each instance owns a temporary profile, a loopback-only random debugging port, bounded command waits and process cleanup. Chrome's `--no-sandbox` flag is used only when running as root inside the isolated MA container. No host browser or host login profile is accessed.

## Lark CLI and skills

Setup runs `npx --yes @larksuite/cli@latest install --lang en < /dev/null`. Before that command, it installs the official npm package without lifecycle scripts and bootstraps its binary from the public mirror already supported by the official installer, falling back to GitHub. The archive must match the package's published `checksums.txt`. This avoids the wizard's 120-second global-install timeout expiring before its slower GitHub download can reach the mirror fallback. The official wizard then installs the skills without configuring an app or starting login. The CLI lives under an isolated npm prefix and is accessible through `/opt/open-muse/lark-cli`; a `lark-cli` PATH link is added only when that command does not already exist. Both uppercase and lowercase npm prefix settings are scoped to the installer and wrapper so inherited sandbox settings cannot make the wizard inspect a different global installation directory.

The official installer places skills in the canonical user skills directory. `/opt/open-muse/lark-skills.json` indexes their names, descriptions and absolute `SKILL.md` paths. The agent prompt requires reading `lark-shared`, the relevant domain skill and its required references; installation alone does not make MA automatically load them. Downloaded third-party skill content is not vendored into this repository.

Account configuration and login are separate, user-authorized steps. Personal resources require user identity, minimum scopes and interactive authorization; CLI installation does not grant access. High-risk confirmation gates remain in force. Credentials are not included in setup or output artifacts, and persistence across fresh sessions is not guaranteed. When an update is requested, `lark-cli update` updates both CLI and skills; regenerate the index with `/opt/open-muse/python /opt/open-muse/index-lark-skills.py` afterward.

## Configuration preservation

Synchronization applies only to app-owned `cloud` environments and agents. It preserves networking, environment variables, output storage, custom package-manager settings, and custom setup code. A marked setup block and prompt section are replaced in place when the toolbox changes. Legacy managed APT entries are removed from the native package list when migrating the earlier synchronous setup; unrelated packages and custom pins remain in place. The reduced setup applies to new sessions. Existing sandbox packages are not uninstalled, and existing tasks are not interrupted. Unmarked custom scripts run before the toolbox block; an early `exit` or failure in custom code can prevent it from running. Malformed managed blocks stop the update rather than overwriting custom code.

The agent prompt explains tool selection, supported workflows, readiness checks, source citation, output verification, and safe handling of credentials and website content. Browser login, MFA, CAPTCHAs, external publishing and other account-bound actions remain subject to the user's task and authorization.

The agent must not claim optional capabilities are available until their dependencies and any required external services have been verified. Large downloads, account access and external writes remain subject to the current task's scope.
