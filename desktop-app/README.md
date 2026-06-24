# yt2mp — desktop app

The actual YouTube → MP3/MP4 downloader, packaged as a Windows desktop app
(Electron + a bundled Next.js server). It runs entirely on the user's machine,
so there are no server memory limits and no YouTube bot-detection issues (the
user's own IP is clean — no cookies or PO tokens needed).

The repo root is a separate project: a small landing page that links to the
installer. This folder has its own `package.json` / `node_modules` and is
ignored by the root Render deploy.

## Features

- **Paste a link** — single video or a playlist link. Playlists load instantly
  (via `yt-dlp --flat-playlist`) and each track's real info/formats are only
  fetched when you expand it, so opening a 500-track playlist doesn't mean
  waiting on 500 yt-dlp calls.
- **AI search** — switch to AI mode and describe what you want instead of
  pasting a link (e.g. "that troye sivan song called rush"). A free Groq model
  rewrites the request into a clean search query, then yt-dlp's `ytsearch1:`
  finds the match — no API key cost to the user, no link required.
- **Pause / Resume / Stop** on every in-flight download. Pause holds incoming
  bytes in memory without killing the connection (instant resume); Stop kills
  the connection and deletes the partial file (since yt-dlp/ffmpeg re-transcode
  from scratch every run, there's no byte-offset resume after a real stop —
  "Restart" starts over).
- **History**, kept locally (`localStorage`), to re-fetch a past download.

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

## AI search setup (optional)

AI search needs Groq API keys, which are **never committed to source** (GitHub's
push protection blocks that, and a checked-in key is a checked-in key regardless
of encoding). Create `desktop-app/.env.local` for dev or `desktop-app/.env` for
a packaged build:

```
GROQ_KEYS=gsk_xxx,gsk_yyy,gsk_zzz
```

Comma-separated — if one key gets rate-limited (429) or rejected (401), the app
rotates to the next one automatically. If `GROQ_KEYS` is missing or every key
fails, AI search falls back to searching your raw text directly instead of
breaking. See `.env.example` for the format. `electron/main.ts` reads this file
and injects `GROQ_KEYS` into the bundled server's environment the same way it
injects `YTDLP_PATH`/`FFMPEG_PATH`; `scripts/after-pack.js` copies `.env` into
the packaged app's `resources/` folder if present.

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
  local port (binary search with exponential backoff, not a fixed poll
  interval), then opens a `BrowserWindow` pointed at it. Injects
  `YTDLP_PATH` / `FFMPEG_PATH` / `GROQ_KEYS` into the server's environment.
  Also owns the actual download: it opens a native Save dialog, fetches
  `/api/download` itself, and streams the response straight to disk with
  `fs.createWriteStream` — at no point does a multi-GB file sit fully
  buffered in the renderer's memory (the old approach, before this).
- `electron/preload.ts` — the only bridge between the renderer and main
  process (`contextIsolation: true`, no raw `ipcRenderer` exposed). Exposes
  `window.yt2mp.{startDownload, onDownloadProgress, cancelDownload,
  pauseDownload, resumeDownload, stopDownload}`.
- `lib/download.ts` — calls into `window.yt2mp` when running inside Electron;
  falls back to the old buffer-into-a-Blob approach when running in a plain
  browser tab (e.g. `bun run dev` outside Electron), so local web dev still
  works without a main process.
- `app/api/info` — resolves a link (single video or playlist) or, in AI mode,
  a Groq-rewritten search query, via `lib/ytdlp.ts` and `lib/groq.ts`.
- `app/api/download` — MP3 pipes yt-dlp's raw audio straight into ffmpeg and
  streams that process's stdout as the HTTP response. **MP4 can't work that
  way**: YouTube only serves a single pre-muxed (video+audio combined) stream
  up to 360p — every higher quality (480p, 720p, 1080p, 4K) is separate
  video-only and audio-only streams that must be downloaded and merged with
  ffmpeg, which needs a real seekable file, not a stdout pipe. So MP4
  downloads to a temp file via `yt-dlp --merge-output-format mp4` first, then
  that file is streamed and deleted. The actual file-write to the user's
  chosen location happens in `electron/main.ts`, not here.
- `lib/ytdlp.ts` — argument building, process spawning (with a timeout so a
  stuck yt-dlp call surfaces an error instead of hanging the UI forever), and
  playlist/search parsing.
