# Backend design boundaries

This document records design boundaries and future expansion, not a feature
status checklist. See [README](README.md) for implemented behavior and setup, and [How it works](../docs/how-it-works.md) for the app side.

The application still connects directly to Volcano APIs. Keep that mode usable
without an Open Muse account or backend. The service owns application sync
and orchestration; it does not replace Ark Managed Agents (MA).

The target clients are iOS and macOS. Their UI assets remain bundled with the
apps; static website hosting and Web Push are out of scope. The service
exposes an HTTPS API and runs background coordination; it does not serve
the application UI. Web and Android work is not part of this plan.

## Placement decisions

| Capability                                   | Current implementation                                                                                                                                                    | Proposed placement                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Saved replies                                | Device-local IndexedDB in [`src/api.ts`](../src/api.ts); account builds sync it through `account_sync_items`                                                              | Workers API + D1, with explicit sync opt-in and original session/event references                                            |
| Feed/Ideas presentation                      | Local post indexes, likes, dismissed instructions, and discussion links in [`DirectInspiration`](../src/direct/inspiration.ts); account builds sync them                  | D1 for synced presentation records; MA events remain the source of generated content                                         |
| Conversation preferences                     | Local archive state, main-chat selection, and chapter links in [`Conversations`](../src/direct/conversations.ts); account builds sync archive state only                  | D1 eventually; shared main-chat coordination is a separate change, not a blind index upload                                  |
| Goals and personal documents                 | `GOALS.md`, `SOUL.md`, `MEMORY.md`, `IDENTITY.md`, and `FEED.md` in MA memory                                                                                             | Keep MA authoritative; do not create a second writable copy in D1                                                            |
| Periodic Feed and goal check-ins             | Scheduled Feed generation, check-ins, and goal follow-ups run from the scheduler tick for accounts that opt in; apps and service claim each message in `proactive_claims` | Workers Cron + durable job records in D1; add Queues or Workflows when needed                                                |
| Notifications and external events            | Incoming webhooks post one hidden message per event to the main chat; no APNs (needs a paid Apple developer account)                                                      | Workers for authenticated webhooks and APNs calls; separate iOS and macOS notification integration is also required          |
| App-owned attachments or exports             | No separate app object store; `GET /v1/account/export` returns what the service keeps for an account                                                                      | Consider R2 later if needed; do not duplicate existing MA files by default                                                   |
| Agent execution, sandbox, tools, and history | MA                                                                                                                                                                        | Keep in MA; do not move the execution loop, Chrome, or Lark CLI into a Worker                                                |
| Ark sign-in and device credentials           | [`DirectAuth`](../src/direct/auth.ts) and device credential storage                                                                                                       | Keep device-local for direct use and sync-only mode; background MA access requires a separate, explicit authorization design |

Current goals already use MA memory through
[`DirectGoals`](../src/direct/goals.ts). IndexedDB retains legacy goals and
migration bookkeeping, not a new cloud source of truth. A goal record is not a
scheduled job: completing or pausing a goal does not currently stop execution.

## Account sync

Account builds sync the model choice, saved replies, Feed and Ideas
presentation, and side-chat archive state through `account_sync_items`
(`GET`/`PUT /v1/account/sync`). Records already stored under the account's
workspace key belong to that account and upload on the first sync; local-mode
data never does. Each change waits in a device outbox with a stable mutation
ID; a stale write returns the server copy, and the device keeps only fields it
changed alone. Main-chat selection and continuation stay device-local:
proactive messages are coordinated with claims instead of synced state.
