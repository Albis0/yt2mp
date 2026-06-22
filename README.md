# yt2mp

An ad-free, clean YouTube → MP3/MP4 download interface. Built with Next.js (App Router),
using [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg as the download engine.

> Open source, intended for personal use. Downloading YouTube content may violate
> YouTube's Terms of Service; use at your own responsibility.

## How it works

- `app/api/info` — given a YouTube link, fetches the title, thumbnail, duration and
  available video qualities (`yt-dlp -J`).
- `app/api/download` — streams the requested format (`mp3` or `mp4`) straight to the
  browser without writing to disk.
  - **MP3**: pulls yt-dlp's raw audio stream and pipes it live into an ffmpeg process
    (yt-dlp's own ffmpeg post-processing doesn't work over stdout pipes).
  - **MP4**: streams yt-dlp's single pre-muxed `best` format directly.

## Local development

This project uses [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

**yt-dlp** and **ffmpeg** must be installed and on your PATH before running the server:

```bash
pip install yt-dlp
# ffmpeg: https://ffmpeg.org/download.html
```

Test it at `http://localhost:3000`.

## Production build

```bash
bun run build
bun run start
```

## Running with Docker

The image bundles the Bun runtime, yt-dlp and ffmpeg — nothing needs to be installed on
the host machine.

```bash
docker build -t yt2mp .
docker run -p 3000:3000 yt2mp
```

Visit `http://localhost:3000`.

## Deployment

Since yt-dlp requires a long-running process, **serverless platforms like Vercel/Netlify
won't work**. Use a platform that supports Docker images with an always-on server:
Railway, Render, Fly.io, or your own VPS.

General flow (Railway example):
1. Push the repo to GitHub.
2. In Railway, choose "New Project → Deploy from GitHub repo".
3. Railway auto-detects the `Dockerfile` and builds it.
4. The `PORT` environment variable is provided automatically by Railway; the app already reads it.

## Notes / limitations

- No rate limiting — designed for personal/small-circle use. Add one if you expect
  public traffic at scale.
- The ad slot (`components/AdSidebar.tsx`) is currently an empty placeholder; drop in
  whatever ad code you want (AdSense, etc.). It's only visible on desktop and hidden on mobile.
- Only youtube.com / youtu.be links are accepted (see the regex in `lib/ytdlp.ts`).
