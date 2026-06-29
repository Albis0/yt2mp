// Primary download: GitHub Releases. Fast CDN, no size warnings, and "latest"
// always points at the newest published release.
export const GITHUB_URL =
    "https://github.com/Albis0/yt2mp/releases/latest/download/yt2mp.Setup.0.4.0.exe";

// Linux build: a portable AppImage attached to the same GitHub Release. Runs
// on any x64 distro without installation — mark executable and launch.
export const LINUX_URL =
    "https://github.com/Albis0/yt2mp/releases/latest/download/yt2mp-0.4.0.AppImage";

// Mirror: Google Drive. The installer is large enough that Drive shows a
// "can't scan for viruses" page on the normal link; the
// drive.usercontent.google.com host with confirm=t serves the .exe directly.
export const DRIVE_URL =
    "https://drive.usercontent.google.com/download?id=1SyviZ2N7pS1c18FEn9k79c5owUun2v4s&export=download&confirm=t";

// Canonical origin the site is served from — single source for canonical
// URLs, the sitemap, robots, and absolute OG/Twitter image URLs.
export const SITE_URL = "https://yt2mp.onrender.com";

export const REPO_URL = "https://github.com/Albis0/yt2mp";
export const LICENSE_URL = "https://github.com/Albis0/yt2mp/blob/main/LICENSE";
export const ISSUES_URL = "https://github.com/Albis0/yt2mp/issues";
export const METADEFENDER_URL =
    "https://metadefender.com/results/file/YnpJMk1EWXlNekZKTUZkVVR6Rk9WV28xWkVsd1YwWlBZMGhNX21kYWFzYTdlMGQ0Y2U1Ng/threats-prevented";

export const VERSION = "0.4.0";
export const INSTALLER_NAME = "yt2mp Setup 0.4.0.exe";
export const INSTALLER_SHA256 =
    "fc1bea614a94e51d9960887ed9088d1a879c6601c690cfdc8c18e44907e351cc";
