# yt2mp

A clean, ad-free YouTube → MP3 / MP4 downloader. The actual downloading runs as a
Windows desktop app **on your own computer** — no shared server, no upload limits,
no ads.

This repo has two independent parts:

- **Root** (this directory): a small Next.js landing page, deployed to Render. It only
  describes the project and links to the desktop app download — it does no downloading
  itself.
- **`desktop-app/`**: the Electron desktop app that does the actual work. See
  [desktop-app/README.md](desktop-app/README.md).

## Download

- **[Latest release](https://github.com/Albis0/yt2mp/releases/latest)** — grab the
  Windows installer (`yt2mp Setup x.y.z.exe`) and run it.
- A Google Drive mirror is linked on the landing page as a fallback.

## ⚠️ Disclaimer — use at your own risk

This is free, open-source software provided **"as is", without any warranty** (see the
[license](#license)). By downloading, building, or using it you agree that:

- **You are solely responsible** for how you use this tool and for any content you
  download with it.
- Downloading content from YouTube may violate
  [YouTube's Terms of Service](https://www.youtube.com/t/terms). Only download content
  you have the right to (e.g. your own uploads, public-domain, Creative Commons, or
  material you're otherwise permitted to save). Respect copyright law in your country.
- The authors and contributors are **not liable** for any misuse, data loss, account
  action, legal consequence, or damage arising from the use of this software.

This project is intended for personal use — for example saving your own videos or
content you're allowed to keep offline. It is **not** intended to facilitate copyright
infringement.

## 🛡️ Virus scan

Every release installer is scanned before publishing. The installer bundles
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) — both
well-known open-source tools — but because it's an unsigned `.exe` that spawns those
binaries, some antivirus engines may flag it heuristically (a false positive common to
yt-dlp wrappers).

- **MetaDefender Cloud:** [0/21 engines — no threats detected](https://metadefender.com/results/file/YnpJMk1EWXlNekZKTUZkVVR6Rk9WV28xWkVsd1YwWlBZMGhNX21kYWFzYTdlMGQ0Y2U1Ng/threats-prevented)
  (`yt2mp Setup 0.2.0.exe`, SHA256 `4f6056135aee5cb8df0647a24465d001090220621cb3b18c4444c490b8a23771`)
- **VirusTotal:** _coming soon_

If your browser or Windows SmartScreen warns about the download, that's the unsigned-exe
warning — you can verify the file yourself with the scan links above.

## License

Licensed under the **[GNU General Public License v3.0 or later](LICENSE)**.

In short: you're free to use, study, modify, and redistribute this software, but any
distributed derivative must also be open source under the GPL. (Translation: someone can
fork it, but they can't legally take it closed-source and wrap it in ads.)

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

## Deployment

Render builds the landing page from the root `Dockerfile` (a minimal bun image that
serves the static Next.js page on `$PORT`). Push to `main` and Render redeploys
automatically.

## Notes

- The ad slot (`components/AdSidebar.tsx`) is an empty placeholder; drop in whatever ad
  code you want. It's only visible on desktop and hidden on mobile.
