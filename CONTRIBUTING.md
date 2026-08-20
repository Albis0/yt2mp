# Contributing

Thanks for looking. This is a small project with one maintainer, so the most
useful thing you can do is make your change easy to evaluate.

## Before you write code

**Open an issue first for anything non-trivial.** A bug fix with a clear
reproduction can go straight to a PR. A new feature, a dependency, or a change
to how downloads work should be discussed first — not for ceremony, but because
a rejected 500-line PR wastes your evening, not the maintainer's.

Things unlikely to be accepted:

- Features that bypass a site's terms of service or exist to help with
  infringement. See the disclaimer in the [README](README.md).
- Telemetry, analytics, crash reporting, or anything that sends user data
  anywhere. The app talks to the sites you paste and to GitHub for updates.
  That is the whole list, and it stays that way.
- New runtime dependencies that duplicate what is already there.

## Repository layout

Two independent parts:

- **Root** — the Next.js landing page, deployed to Render from the root
  `Dockerfile`.
- **`app-tauri/`** — the Tauri desktop app, which does all the actual work.
  A Rust backend in `src-tauri/src/` and a React frontend in `src/`.

They share nothing but a version number, kept in step by `scripts/version.mjs`.

## Getting set up

This project uses [Bun](https://bun.sh). The desktop app also needs a Rust
toolchain and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your OS.

Landing page:

```bash
bun install
bun run dev          # http://localhost:3000
```

Desktop app:

```bash
cd app-tauri
bun install
bun run fetch:binaries   # downloads yt-dlp, ffmpeg and quickjs into resources/
bun run tauri:dev
```

`fetch:binaries` pulls ~115 MB and only needs running once. Without it the app
starts but cannot download anything.

## Before you open a PR

Run all three. CI runs them too, but finding out locally is faster:

```bash
cd app-tauri && bun run test:rust   # 58 tests
cd app-tauri && bun run build       # tsc --noEmit + vite build
bun run build                       # the landing page (from the repo root)
```

## What the code expects of you

- **Match the surrounding style.** The Rust and TypeScript here both use
  comments to explain *why* a thing is the way it is, not what the line does.
  Where a decision looks odd, there is usually a comment saying which bug
  caused it. Keep that habit; it is why the codebase is navigable.
- **Cover behaviour with a test where one is possible.** The Rust side has
  real coverage of the parts that break in the field — error classification,
  browser detection, format selection. A change to any of those should come
  with a test that would have failed before it.
- **Never commit secrets.** `app-tauri/src-tauri/.env` holds API keys and is
  gitignored. Check `git diff --cached` before committing.
- **One logical change per PR.** A fix plus an unrelated refactor is two PRs.

## Commit messages

Write what changed and why, in plain prose. The first line is a short summary
in the imperative ("Fetch Linux ffmpeg from a host that serves CI"), then a
blank line, then as much explanation as the change deserves. Look at
`git log` for the tone.

## Versions and releases

**Patch bumps only.** A release goes 0.7.1 → 0.7.2, never 0.8.0, regardless of
how large the change feels. `scripts/version.mjs` enforces this and refuses a
minor or major bump unless told explicitly. Only the repo owner decides those.

Contributors do not need to bump anything — releases are cut by the maintainer,
and `.github/workflows/release.yml` builds and signs the artifacts from a tag.

## Reporting bugs

Use the issue templates. The single most useful thing you can include is the
**exact error text the app showed you**, plus the app version from Settings.
For a download that failed, the link you pasted matters too — sites behave
differently for different content, and "a YouTube video" is not reproducible.
