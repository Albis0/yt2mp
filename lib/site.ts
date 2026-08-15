// The one place the version is written on the site side. Everything below is
// derived from it, so a release bump can never leave a filename pointing at a
// build that no longer exists.
//
// `scripts/version.mjs` rewrites this single line and the matching fields in
// app-tauri/package.json, app-tauri/src-tauri/Cargo.toml and the root
// package.json together. Do not hand-edit one of them.
export const VERSION = "0.6.2";

export const REPO_URL = "https://github.com/Albis0/yt2mp";
export const LICENSE_URL = "https://github.com/Albis0/yt2mp/blob/main/LICENSE";
export const ISSUES_URL = "https://github.com/Albis0/yt2mp/issues";

// Canonical origin the site is served from — single source for canonical
// URLs, the sitemap, robots, and absolute OG/Twitter image URLs.
export const SITE_URL = "https://yt2mp.onrender.com";

// Artifact filenames, exactly as the Tauri bundler names them. The app's
// updater also fetches from this release, so these must match what CI
// uploads.
export const INSTALLER_NAME = `yt2mp_${VERSION}_x64-setup.exe`;
export const APPIMAGE_NAME = `yt2mp_${VERSION}_amd64.AppImage`;

// Downloads come from GitHub Releases: fast CDN, no size warnings, and
// "latest" always resolves to the newest published release.
const RELEASE_DOWNLOAD = `${REPO_URL}/releases/latest/download`;
export const GITHUB_URL = `${RELEASE_DOWNLOAD}/${INSTALLER_NAME}`;
export const LINUX_URL = `${RELEASE_DOWNLOAD}/${APPIMAGE_NAME}`;

// Mirror: Google Drive. Kept here but NOT linked from the page.
//
// This file id still serves the old 0.4.1 Electron installer. A mirror handing
// out a different binary than the sha256 printed on the same page is worse
// than no mirror, so it stays unreferenced until a current build is uploaded
// and this id replaced.
export const DRIVE_URL =
    "https://drive.usercontent.google.com/download?id=1SyviZ2N7pS1c18FEn9k79c5owUun2v4s&export=download&confirm=t";

// sha256 and size of the Windows installer, measured from the built artifact.
//
// These cannot be known until the artifact exists, so they are measured from
// the built installer and updated together with VERSION. CI does NOT write
// them back today — it only embeds its own hash in latest.json — so bumping
// the version without re-measuring here leaves the page printing a hash that
// matches nothing, which is what happened before. `null` means "no verified
// artifact for this version yet", and the page omits the verification block
// rather than vouching for something it cannot check.
export const INSTALLER_SHA256: string | null =
    "bdd6239862353e5afab2f9f29c3e1f88507425736d5b2dfae7c5a73cf58e44f5";

// 2.7 MB, down from 45.9 MB: ffmpeg and yt-dlp are no longer bundled — the app
// fetches them on first run, which is also what keeps updates small.
export const INSTALLER_SIZE: string | null = "2.7 MB";

// Sites the app can download from, in the order the app's own tabs present
// them. Single source for the page copy and the structured data.
export const SITES = ["YouTube", "TikTok", "Instagram", "X", "Twitch"] as const;
