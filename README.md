# Open Muse

**A personal AI agent that remembers, follows up, and gets things done — on your iPhone, on your Mac, and on a cloud computer that keeps working when you close the app.**

English | [简体中文](README.zh-CN.md) | [Website](https://getopenmuse.com)

<table>
  <tr>
    <td width="16%"><img src="docs/images/ios-chat.png" alt="A short weekend plan in a side chat, ending with one question"></td>
    <td width="16%"><img src="docs/images/ios-menu.png" alt="Long-press menu on a reply with reactions, Reply, Copy, Select, Share and Save to Library"></td>
    <td width="16%"><img src="docs/images/ios-ideas.png" alt="Ideas: ready-made tasks to hand to the assistant"></td>
    <td width="16%"><img src="docs/images/ios-goals.png" alt="Goals with categories to start a new goal"></td>
    <td width="16%"><img src="docs/images/ios-connectors.png" alt="Connectors: Apple Health, Calendar, Reminders, Contacts and Lark"></td>
    <td width="16%"><img src="docs/images/ios-appearance.png" alt="Appearance: chat theme, avatar size and light or dark mode"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Plans, then asks.</b> A short plan and one question to tailor it.</sub></td>
    <td align="center"><sub><b>Long-press a reply.</b> React, reply, copy, share, or save it to your Library.</sub></td>
    <td align="center"><sub><b>Ideas to start from.</b> Ready-made tasks your assistant can take on.</sub></td>
    <td align="center"><sub><b>Goals that grow.</b> Pick a category and get a plan that keeps improving.</sub></td>
    <td align="center"><sub><b>Connect what you use.</b> Apple Health, Calendar, Reminders, Contacts and Lark.</sub></td>
    <td align="center"><sub><b>Make it yours.</b> Bubble colors, avatar size, light or dark.</sub></td>
  </tr>
  <tr>
    <td width="16%"><img src="docs/images/memory.png" alt="A weekly reminder and a saved preference, with the assistant's editable SOUL and MEMORY"></td>
    <td width="16%"><img src="docs/images/approval.png" alt="An approval card before the assistant uses the Mac"></td>
    <td width="16%"><img src="docs/images/feed.png" alt="A personal Feed with sources"></td>
    <td width="16%"><img src="docs/images/declined.png" alt="After a declined request, the assistant answers in the chat instead"></td>
    <td width="16%"><img src="docs/images/quick-chat.png" alt="Quick Chat over any app"></td>
    <td width="16%"><img src="docs/images/computer-use-settings.png" alt="Computer use settings"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Remembers and reminds.</b> One sentence sets a weekly reminder and saves a preference to memory you can open.</sub></td>
    <td align="center"><sub><b>Uses your Mac — after asking.</b> Allow once, allow for this chat, or decline.</sub></td>
    <td align="center"><sub><b>A Feed of your own.</b> Morning updates on the topics you choose, each with a source.</sub></td>
    <td align="center"><sub><b>No means no.</b> Decline, and it keeps its hands off and helps in the chat instead.</sub></td>
    <td align="center"><sub><b>Always at hand.</b> A small chat card over whatever you are doing.</sub></td>
    <td align="center"><sub><b>You set the limits.</b> Permissions, blocked apps and folders, all in one place.</sub></td>
  </tr>
</table>

## Built on Managed Agents

Open Muse is a client for a **Managed Agents (MA)** service: a hosted agent loop with persisted, versioned agents, an isolated cloud environment, sessions that stream events, and memory stores. Each workspace gets one agent, one environment, and one memory store, and every conversation is an MA session. The apps call the MA API directly with your own key; Open Muse runs no model proxy.

| Backend | Status |
| --- | --- |
| [Volcano Ark Managed Agents](https://www.volcengine.com/product/ark) | Default and reference backend. Everything in this README is built and verified on it. |
| [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) | Alternative backend with the same resource model, included to keep the backend replaceable. Ark-only features, such as choosing a model per conversation from the Ark catalog and project-scoped keys, are left out. Not verified end to end. |

The backend is chosen at build time with `VITE_MUSE_MA_PROVIDER` (`ark` by default, or `claude`) and, for the Open Muse service, with `MA_PROVIDER`; the two must match. Every difference between backends lives in [`shared/ma-provider.ts`](shared/ma-provider.ts).

## What it can do

**Your health, on demand (iPhone).** Ask "how was my workout today?" or "how did I sleep this week compared to last?" and Open Muse reads Apple Health right then — steps, active energy, exercise minutes, distance, heart rate, resting heart rate, sleep, workouts, and weight. Until you connect Apple Health in the app, every read asks you first; once connected, reads happen right away, and **Disconnect** in Connectors goes back to asking. It never makes up a number it could not read.

**Your Mac, hands-on.** With your permission, the assistant looks at the screen, opens apps, files and links, clicks, types, scrolls, and uses shortcuts — in any app, whether or not it has an API. It can also read your Calendar and approximate location. Every action waits for your approval unless you allow it for the chat or choose **Always allow** in settings, and apps or folders you block stay out of reach.

**Lark (Feishu), end to end.** The cloud computer comes with the Lark CLI and its official skills. Sign in once from **Connectors**, then ask in plain language: brief me before my next meeting, turn today's group chat into tasks, find a time that works for three people and book a room, turn yesterday's meeting notes into a doc.

**A cloud computer that keeps working.** Every workspace runs on Volcano Ark Managed Agents with its own isolated Linux sandbox: web search, a real Chrome browser, a terminal with Python and Node, and files. Ask for a price comparison with screenshots as evidence, a PDF report, or a quick script to analyze a spreadsheet — then close the app. The work continues and is waiting when you come back.

**It remembers, and it follows up.**
- Picks a name and a personality with you, and keeps what matters in memory you can read and edit.
- Turns goals into plans with steps, and checks in on them.
- Reminds you once, daily, weekly, or monthly — in the chat, and as notifications on iPhone.
- Prepares a personal **Feed** and **Ideas** from your goals and recent conversations.

**One assistant, every device.** Start on your iPhone, continue on your Mac. Health data is read on the iPhone that has it; Mac actions run on the Mac. Conversations, memory, goals, and reminders follow your Open Muse account.

## Built to be trusted

- **Asks before touching your devices.** Using your Mac or reading Apple Health waits for your OK unless you choose to allow it ahead of time; Calendar and location always ask, one call at a time. Cloud tools run inside your own isolated sandbox.
- **No pretend answers.** Without a working connection the app says so. It never generates a simulated reply, and a write whose result is uncertain is checked, not repeated.
- **Your key, your workspace.** The apps call Volcano Ark directly with your own API key. With an Open Muse account the key is stored encrypted for your account and held only in memory on your devices; accounts that share a key still get separate workspaces, memory, and history.
- **Memory you can see.** Your assistant's name, persona, and remembered facts are plain documents you can open, edit, or clear.

## Apps

| Platform | Status |
| --- | --- |
| iPhone | Primary app: chat, Apple Health, attachments, reminders, and notifications |
| Mac | Native shell: computer use, Calendar and location, Quick Chat, dictation, and voice conversation |
| Web | Mobile-first web app for chat, Feed, Ideas, Goals, and Library |
| Android | The iPhone app on Android 9+: Health Connect (Android 14+), Calendar and Contacts, attachments, reminders, and notifications; tested on one phone. [Download](https://getopenmuse.com/#android) |

English and Simplified Chinese are built in; the apps follow your system language.

## Get started

You need a [Volcano Ark](https://www.volcengine.com/product/ark) API key with access to Managed Agents. Build an app, open **Settings → Connect to Ark MA**, and paste the key. The first conversation sets up your agent, its cloud environment, and its memory automatically. Cloud calls are billed to your Ark account.

```bash
npm ci
npm run dev           # web app on http://127.0.0.1:4310
npm run macos:build   # Mac app in .build/macos/
npm run ios:build     # iOS Simulator app
```

Requires Node.js 22.21+ and, for the Apple apps, Xcode.

## Documentation

- [Development](docs/development.md) — building, running, account builds, native projects, and project layout
- [How it works](docs/how-it-works.md) — accounts, storage and security, conversations, memory, goals, reminders, Feed and Ideas
- [Cloud environment toolbox](docs/environment-toolbox.md) — the browser and Lark tooling in the sandbox
- [Verification](docs/verification.md) — what has been tested on which platform
- [Open Muse service](server/README.md) — accounts, encrypted keys, and background work
- [Contributing](CONTRIBUTING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
