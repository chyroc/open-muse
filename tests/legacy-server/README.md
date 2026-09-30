# Migration regression harness

This test-only snapshot keeps the previous server-backed behavior available for
protocol, ownership, approval, and migration regression checks. It is not an
application backend, has no executable entry point, and is never imported by
`src/`, bundled into `dist/`, or packaged into native apps.

Current direct-client behavior is covered in `tests/client.test.ts` and native
UI tests. Shared adapters and environment payloads are exercised by both suites.
