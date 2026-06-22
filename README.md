# yt2mp

This repo has two independent parts:

- **Root** (this directory): a small Next.js landing page, deployed to Render. It only
  describes the project and links to the desktop app download — it does no downloading
  itself.
- **`desktop-app/`**: the actual YouTube → MP3/MP4 downloader, an Electron app that runs
  entirely on the user's machine. See [desktop-app/README.md](desktop-app/README.md).

> Open source, intended for personal use. Downloading YouTube content may violate
> YouTube's Terms of Service; use at your own responsibility.

## Why split it this way

The download logic used to run server-side (Next.js API routes calling yt-dlp/ffmpeg),
deployed on Render's free tier. That ran into two problems that don't go away without
paying for a bigger instance:

1. **YouTube bot detection** — shared cloud IPs get blocked with "Sign in to confirm
   you're not a bot", requiring a PO-token server + cookie auth workaround.
2. **Memory limits** — the free instance OOM-killed under real download load even after
   trimming process memory.

Moving the actual download to a desktop app run by the user sidesteps both: the user's
own IP isn't flagged, and there's no shared memory budget to exceed.

## Local development (landing page)

This project uses [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Visit `http://localhost:3000`.

## Production build

```bash
bun run build
bun run start
```

## Deployment

Render builds this with its Node/Bun buildpack (no Dockerfile needed anymore — the
landing page has no yt-dlp/ffmpeg dependency). Push to `main` and Render redeploys
automatically.

## Notes

- The ad slot (`components/AdSidebar.tsx`) is currently an empty placeholder; drop in
  whatever ad code you want (AdSense, etc.). It's only visible on desktop and hidden on mobile.
- The "Download for Windows" button on the landing page points at this repo's GitHub
  Releases page — make sure a release with the built `.exe` exists before linking to it.
