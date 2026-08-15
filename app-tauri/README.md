# yt2mp — desktop app (Tauri)

A MP3/MP4 downloader for YouTube, TikTok, Instagram, X and Twitch, rebuilt on
Tauri. It replaced an earlier Electron build, which was removed from the repo
once this one shipped; the comparisons below are kept because they are the
reasons the rewrite happened, not a description of anything still in the tree.

## Supported sites

URL validation is deliberately shallow: the app works out which site a link
belongs to, and **yt-dlp decides whether it can actually be downloaded**. Any
of yt-dlp's ~1750 extractors will work if you paste a link — the five below
are the ones with specific handling (badge, preview behaviour, tailored error
messages).

| Site | Status (verified 2026-08-13) | Notes |
|---|---|---|
| YouTube | Works, up to 4K | Inline preview, playlists, AI search |
| X (Twitter) | Works, 1080p verified | Video tweets only |
| Twitch | Works, VODs + clips | Long VODs are where pause/resume earns its place |
| Instagram | **Needs browser cookies** | Logged-out requests get "empty media response" |
| TikTok | **Currently broken upstream** | yt-dlp returns "Unexpected response from webpage request" on both stable and nightly. Not an app bug — it resolves when yt-dlp patches the extractor. |

Only YouTube supports an inline preview and AI search. For the other sites the
thumbnail opens the original post in the user's real browser, and free-text
search is not offered (yt-dlp's search pseudo-URLs are effectively
YouTube-only).

### Browser cookies (optional, for Instagram)

Instagram refuses most media to logged-out clients. If you want those posts,
opt into sharing a browser's cookies by adding a line to `src-tauri/.env`:

```
YT2MP_COOKIES_FROM=firefox
```

Accepted: `brave`, `chrome`, `chromium`, `edge`, `firefox`, `opera`, `safari`,
`vivaldi` — optionally with a profile (`chrome:Default`).

This is **opt-in on purpose**: reading a browser's cookie store means using
someone's live login session, so it never happens by default. Note that
Chromium-based browsers lock their cookie database while running, so you may
need to close the browser first; the app reports that specifically when it
happens.

## Why this exists

The Electron version shipped a 215 MB installer and ran four processes: the
Electron main process, a renderer, a GPU process, and a **bundled Next.js
server on a localhost port** that the app made HTTP requests to itself. An MP4
was written to a temp file by yt-dlp, streamed over that localhost HTTP hop,
and written to disk a second time.

This version has one process of its own, no HTTP server, no port negotiation
at startup, and yt-dlp writes straight to the destination the user picked.

## Measured results

| | Electron (0.4.1) | Tauri (0.5.0) |
|---|---|---|
| Installer | 215 MB | **46 MB** |
| App binary | ~120 MB of runtime | **4.3 MB** |
| Own processes | 4 (main, renderer, GPU, Next server) | **1** |
| Frontend bundle | Next.js standalone server | 208 KB JS + 10 KB CSS |

**On memory, be realistic.** Tauri uses the system WebView (WebView2 on
Windows), which *is* Chromium — it is not bundled in the download, but it
still runs. Measured at idle: the yt2mp process itself is ~26 MB, and
WebView2 adds ~460 MB across its own process group. The install-size win is
real and large; a runtime-memory win is not something this rewrite delivers,
because the web UI still needs a browser engine to render it.

## Bundled binaries (not in git)

Three binaries live in `src-tauri/resources/` and are gitignored (too large
for the repo):

| Binary | Size | Why |
|---|---|---|
| `ffmpeg.exe` | ~103 MB | merging DASH video+audio, MP3 encoding |
| `yt-dlp.exe` | ~18 MB | the actual extraction and download |
| `qjs.exe` | ~2 MB | JavaScript runtime — see below |

Download them with:

```bash
bun run fetch:binaries
```

### The JavaScript runtime is not optional

yt-dlp needs a JS runtime to solve YouTube's player challenges (EJS). Without
one, extraction does not merely lose the high-quality formats — it fails with
`n challenge solving failed` and returns **only storyboard images**, so every
download becomes impossible.

The Electron build solved this by pointing yt-dlp at its own Electron binary
running in Node mode (`ELECTRON_RUN_AS_NODE=1`). A Tauri app has no Node
runtime to reuse, so one has to ship. yt-dlp supports `deno`, `node`, `bun`
and `quickjs`; **quickjs is ~2 MB where deno is ~100 MB**, and it solves the
challenge correctly — verified against a 4K video, which lists every DASH
format up to 2160p60 with it and none at all without it.

## Develop

```bash
bun install
bun run tauri:dev
```

On Windows the Rust build needs the MSVC toolchain in the environment. If
`cargo` fails with `LNK1181: cannot open input file 'dbghelp.lib'`, the
Windows SDK library path is not set — run the build from a shell where
`VC\Auxiliary\Build\vcvars64.bat` has been sourced.

## Build the installer

```bash
bun run tauri:build   # → src-tauri/target/release/bundle/nsis/yt2mp_x.y.z_x64-setup.exe
```

## AI search setup (optional)

AI search needs Groq API keys, which are **never committed to source**. Create
`src-tauri/.env`:

```
GROQ_KEYS=gsk_xxx,gsk_yyy,gsk_zzz
```

Comma-separated — if one key is rate-limited (429) or rejected (401), the app
rotates to the next. If `GROQ_KEYS` is missing or every key fails, AI search
falls back to searching your raw text directly instead of breaking.

## How it works

- `src-tauri/src/lib.rs` — the IPC commands the UI calls (`fetch_info`,
  `start_download`, `pause_download`, `resume_download`, `stop_download`,
  `reveal_file`), plus filename sanitising and the in-flight download registry.
- `src-tauri/src/platform.rs` — which site a URL belongs to and what that
  implies (embed or not, search or not, login-prone or not), plus turning
  yt-dlp's CLI-shaped errors into messages a user can act on. Notably, an
  extractor breaking against a site change is reported as such rather than as
  "check your link", which would send the user chasing a non-problem.
- `src-tauri/src/ytdlp.rs` — argument building, process spawning, progress
  parsing. The MP4 format-selector chain is carried over verbatim from the
  Electron build: it walks past mp4-only and m4a-only selectors before
  settling for the pre-muxed fallback, because a selector locked to
  `[ext=mp4]` skips every VP9/AV1 DASH stream and silently delivers 360p while
  the UI claims 2160p. That bug shipped once; the test suite guards it now.
- `src-tauri/src/suspend.rs` — pause/resume, implemented by suspending the
  yt-dlp process at the OS level (thread suspension on Windows, SIGSTOP on
  Unix). Nothing is buffered in memory, however long the pause lasts.
- `src-tauri/src/binaries.rs` — resolving the three bundled binaries in dev
  vs. packaged layouts.
- `src-tauri/src/groq.rs` — AI search with key rotation and a 6s timeout.

### Pause is only offered above 1 GB

The Electron build offered pause on every download, implemented by holding
incoming bytes in the main process's memory while keeping the HTTP connection
alive — which grew memory without bound the longer a download sat paused.

Here pause suspends the yt-dlp process instead, so nothing accumulates. It is
shown only when the estimated file size is at least 1 GB
(`PAUSE_THRESHOLD_BYTES` in `src/lib/api.ts`): on a three-minute MP3 that
finishes in seconds the controls are noise, and on a multi-gigabyte 4K
download walking away mid-transfer is a real scenario. Size estimates come
from yt-dlp's own `filesize`/`filesize_approx`, summed across the video and
audio streams that will be merged.

**Known limit:** YouTube's CDN can time out a stalled connection on its own. A
pause of a few minutes resumes cleanly; one left for an hour may fail on
resume, at which point the download reports an error and the user restarts it.
That is inherent to pausing a live transfer.

## Tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

11 unit tests covering URL validation, playlist detection, filename
sanitising, progress-line parsing, and the format-selector chain.
