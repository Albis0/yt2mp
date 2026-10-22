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

## Finding videos on a page

The **Find on page** tab takes a page that is not itself a video — an article,
a lesson, a listing — and looks through it for anything downloadable. Two
passes, because they cost very different amounts of time and the screen says
which one is running:

**Looking at the page** hands the URL to yt-dlp as-is and lets its generic
extractor find an embedded player. One request, a few seconds. Measured, it
answers "Unsupported URL" on most pages and returns at most one item on the
rest, so finding nothing here is the normal outcome rather than a failure.

**Going through every link** fetches the page, harvests every `href` and `src`
out of it, and asks yt-dlp which of them it recognises — all in one process,
via a batch file. It is only run when asked for.

This is not a crawler, for one measured reason: `--use-extractors
default,-generic` makes yt-dlp reject an unrecognised URL *by its shape alone*,
with no network request. 300 links off a Wikipedia article were rejected in
1.5 seconds having contacted nothing. Only links already pointing at a known
media site cost a real request, at roughly 1.2s each.

Two things the harvest has to do that are not obvious, both found by measuring
rather than reasoning:

- **HTML entities are decoded first.** `href="...?v=x&amp;t=1"` is the correct
  way to write that link, so this is what a well-formed page looks like, not a
  malformed one.
- **`"videoId":"..."` is read out of embedded JSON.** A YouTube channel page
  carries no `href` for its videos at all; they exist only in the page's JSON.
  Without this the tab found nothing on exactly the pages people would try it
  on first.

A playlist or channel link sitting in a page's footer is capped at five
entries. Uncapped, one such link expanded a 30-video page into 609 rows.

## Converting files you already have

The **To MP3** tab is the one entry point with no link in it: pick files
already on disk and each comes back as an MP3 beside the original, at the same
192 kbps the download path uses. Nothing is uploaded — the bundled ffmpeg does
the work locally.

There is no accepted-formats list on purpose. ffmpeg decodes what it decodes,
and every picked file is probed before anything runs, so a file it cannot read
says so on its own row rather than failing halfway through a queue. Files with
no audio track are listed and refused for the same reason.

Once a file converts, its row stops being the source file and becomes the MP3:
the name, size and Download button all belong to the new file. Keeping the
original alongside its own output would leave two rows to tell apart, and the
source is still in the folder either way. Download saves a copy wherever you
choose; the MP3 stays beside the original regardless, so the row keeps working
afterwards.

Conversions share the download path's registry and progress channel, so Stop
works identically. There is no Pause: a local conversion is CPU-bound and
finishes in seconds to a couple of minutes, which is not long enough for a
control anyone would reach for — unlike a multi-gigabyte download, where
walking away mid-transfer is a real scenario.

## How it works

- `src-tauri/src/convert.rs` — the To MP3 tab's backend: probing a file with
  ffmpeg, parsing its `-progress` output, and turning ffmpeg's errors into
  something worth showing. No network is involved anywhere in this path.
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

91 tests covering URL validation, playlist detection, filename sanitising,
progress-line parsing, the format-selector chain, browser detection, the MP3
converter, and the page scanner's link harvesting. Two of them drive the
bundled ffmpeg end to end — they build a fixture, convert it, and check the
result is real audio — and skip themselves with a note when the binaries have
not been fetched yet.

Two further tests go out to the live internet and are `#[ignore]`d, so CI never
fails because a site was slow or a page changed:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture
```

They are worth running by hand after touching the scanner. One of them caught
a bug that made the feature find nothing at all: `--ignore-errors` makes yt-dlp
exit non-zero whenever *any* input failed, which in a batch harvested from a
page is always, and the non-zero path was discarding stdout — throwing away 52
real results from a scan that had worked.
