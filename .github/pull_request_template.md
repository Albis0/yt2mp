## What this changes

<!-- What the change does, and why. If it fixes an issue, write "Fixes #123". -->

## Why

<!--
The reasoning, not the diff — the diff is right there. If this fixes a bug,
what was the actual cause? If it is a behaviour change, what made the old
behaviour wrong?
-->

## How it was tested

<!--
What you actually ran or clicked. "Fetched a 4K YouTube video and a 30-item
playlist on Windows" is worth more than "tested locally".
-->

- [ ] `cd app-tauri && bun run test:rust` passes
- [ ] `cd app-tauri && bun run build` passes
- [ ] `bun run build` passes from the repo root (only if the landing page changed)
- [ ] Tried it in the running app, not only in tests

## Checklist

- [ ] One logical change — no unrelated refactors bundled in
- [ ] No secrets in the diff (checked `git diff --cached`)
- [ ] Behaviour that could break in the field has a test that would have caught it
- [ ] No new telemetry, analytics, or outbound requests
- [ ] Version numbers untouched — releases are cut by the maintainer
