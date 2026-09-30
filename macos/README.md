# Open Muse for macOS

The Mac app uses AppKit and a dedicated bundled WebView workspace. It does not
load the mobile UI, host a web server, or depend on Node at runtime. It reuses the
direct MA client and its identity-scoped storage, streaming recovery, conversation
continuation, and approval policy. Credentials remain in the existing Mac Keychain
service; existing IndexedDB data stays at the same `muse://app` origin.

## Build and check

```sh
node scripts/build-macos.mjs
npx vitest run --config macos/vitest.config.ts
```

The signed local app is `.build/macos/Open Muse.app`. The build type-checks
`macos/tsconfig.json`, builds only `macos/ui`, and compiles the native host.
`npm run macos:build` also runs the repository's shared web build before the
Mac-specific build. No iOS or Android build is needed.

## Desktop workspace

- A 74-point navigation rail, continuous main chat, searchable side-chat drawer,
  assistant activity/approval panel, and a bottom-aligned message composer.
- Return sends; Shift-Return inserts a newline; IME composition does not submit.
- Command-N opens a side-chat draft; Command-K searches conversations;
  Command-comma opens settings; Command-1 returns to the main chat.
- Opening or searching a chat does not create a cloud session. The first explicit
  send prepares the MA workspace; unconfirmed writes are not automatically retried.
- Closing the window keeps the app running; clicking its Dock icon restores it.

This is an incremental desktop implementation, not a verified one-to-one clone.
Feed, ideas, goals, library, identity editing, attachments, dictation, desktop
automation, and proactive scheduling still need their Mac-specific implementation
and acceptance checks. The UI identifies unfinished surfaces. No mock replies are
included in the app. Real cloud verification requires an authorized connection.
