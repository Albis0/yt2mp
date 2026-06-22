# yt2mp — desktop app

The actual YouTube → MP3/MP4 downloader, packaged as a Windows desktop app
(Electron + a bundled Next.js server). It runs entirely on the user's machine,
so there are no server memory limits and no YouTube bot-detection issues (the
user's own IP is clean — no cookies or PO tokens needed).

The repo root is a separate project: a small landing page that links to the
installer. This folder has its own `package.json` / `node_modules` and is
ignored by the root Render deploy.

## Bundled binaries (not in git)

`yt-dlp.exe` and `ffmpeg.exe` live in `resources/` and are gitignored (too large
for the repo — ~18MB and ~100MB). Download them before building:

- **yt-dlp.exe** — https://github.com/yt-dlp/yt-dlp/releases/latest → `yt-dlp.exe`
- **ffmpeg.exe** — https://www.gyan.dev/ffmpeg/builds/ (essentials build) → extract `bin/ffmpeg.exe`

Place both in `resources/`:

```
desktop-app/resources/yt-dlp.exe
desktop-app/resources/ffmpeg.exe
```

## Develop

```bash
bun install
bun run electron:dev      # builds Next, compiles electron, launches the app
```

## Build the installer

```bash
bun run electron:build    # produces release/yt2mp Setup x.y.z.exe
```

The app icon is generated from `assets/icon.png` into `build/icon.ico` by
`scripts/make-icon.js` (runs automatically as part of `electron:build`).

## How it works

- `electron/main.ts` — starts the bundled Next.js standalone server on a free
  local port, then opens a `BrowserWindow` pointed at it. Passes the bundled
  `yt-dlp.exe` / `ffmpeg.exe` paths to the server via `YTDLP_PATH` / `FFMPEG_PATH`.
- `app/api/info` and `app/api/download` — call yt-dlp/ffmpeg as subprocesses.
- `lib/ytdlp.ts` — argument building and process spawning.
