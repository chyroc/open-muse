# Development and commit conventions

## Local checks

Run `npm run check` and `npm run build` before committing. When changing native bridges or resources, also verify the corresponding platform build; state explicitly which checks were not run, and do not substitute mock tests for cloud or device acceptance.

## Commit format

Use Conventional Commits:

```text
type(scope): short description
```

Common types are `feat`, `fix`, `refactor`, `test`, `docs`, and `chore`. Each commit should cover one topic, split in dependency order; do not mix build artifacts, personal config, or unrelated changes into feature commits.

## What to commit

- Commit only application source, necessary build configuration, reproducible tests, and public docs.
- Do not commit credentials, sessions, databases, private server addresses, internal docs, personal paths, device logs, or installers.
- Keep screenshots, raw research material, and cloud acceptance attachments in ignored local directories; public verification records retain only the method, results, and boundaries.
- Use public sources for dependencies; retain copyright and license notices required by third parties.
- Stage files individually, and check `git diff --cached` and `git diff --cached --check` before committing.

Docs focus on current features and usage, not internal work history unrelated to using the app. Real cloud tests require explicit authorization and use non-destructive cases.
