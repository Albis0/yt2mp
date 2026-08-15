// The one place the version is written on the site side. Everything below is
// derived from it, so a release bump can never leave a filename pointing at a
// build that no longer exists.
//
// `scripts/version.mjs` rewrites this single line and the matching fields in
// app-tauri/package.json, app-tauri/src-tauri/Cargo.toml and the root
// package.json together. Do not hand-edit one of them.
export const VERSION = "0.6.4";

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
// These cannot be known until the artifact exists. CI does NOT write them
// back — it only embeds its own hash in latest.json — so they are measured by
// hand from the file GitHub actually serves:
//
//   curl -sL https://github.com/Albis0/yt2mp/releases/latest/download/\
//     yt2mp_<VERSION>_x64-setup.exe | sha256sum
//
// Measure the *downloaded* artifact, never a local build. NSIS output is not
// reproducible: the same commit built twice yields a different hash, so a
// locally measured value describes a file nobody can download. Re-running the
// release workflow on an existing tag replaces the artifact and invalidates
// this value too.
//
// `null` means "no verified artifact for this version yet", and the page
// omits the verification block rather than vouching for something it cannot
// check.
export const INSTALLER_SHA256: string | null =
    "22e6b540955c1e43a42e9af06eb594c033450d534a2f07110c3ebd2f41ff94cf";

// 46.8 MB: ffmpeg, yt-dlp and the JS runtime ship inside the installer, so a
// fresh install works offline with nothing to fetch on first run. The app can
// still update yt-dlp on its own afterwards, which is what fixes a site that
// suddenly stops working.
export const INSTALLER_SIZE: string | null = "46.8 MB";

// Sites the app can download from, in the order the app's own tabs present
// them. Single source for the page copy and the structured data.
export const SITES = ["YouTube", "TikTok", "Instagram", "X", "Twitch"] as const;
