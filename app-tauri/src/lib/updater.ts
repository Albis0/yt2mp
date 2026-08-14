/// Checking for, and installing, a new version of yt2mp.
///
/// The app never installs anything without being told to. A check that finds
/// something shows a strip under the tabs; nothing happens until the user
/// presses Update. Declining is remembered so the same version is not offered
/// on every launch.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

const SKIP_KEY = "yt2mp.skippedVersion";
const RELEASES_URL = "https://github.com/Albis0/yt2mp/releases/latest";

export interface Available {
  version: string;
  notes: string | null;
  /// False when this build cannot replace itself — a Linux AppImage that was
  /// not launched through the AppImage runtime, chiefly. The UI offers a
  /// download link instead of an Update button in that case.
  canInstall: boolean;
  /// Held so install() can act on the same object check() returned.
  handle: Update;
}

/// A version the user explicitly dismissed with "Skip". Cleared automatically
/// once a version newer than the skipped one appears, so skipping once does
/// not opt out of updates forever.
function skipped(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

export function skipVersion(version: string) {
  try {
    localStorage.setItem(SKIP_KEY, version);
  } catch {
    // A webview with storage disabled just means the prompt comes back next
    // launch, which is not worth surfacing an error over.
  }
}

/// Linux AppImages can only replace themselves when running as an AppImage —
/// the updater rewrites the file at $APPIMAGE, which is unset for an extracted
/// binary or a dev build. Rather than offering an Update button that would
/// fail, those users get a link to the release.
///
/// There is no direct way to read $APPIMAGE from the webview, so this keys off
/// the platform: Windows always self-updates, Linux is treated as
/// link-only. That is conservative in one direction only — a Linux user who
/// could have self-updated is sent to a download page, which works.
async function canSelfInstall(): Promise<boolean> {
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    return (await platform()) === "windows";
  } catch {
    // The os plugin is optional; if it is not there, assume the common case.
    return true;
  }
}

/// Looks for a newer version. Resolves null when there is nothing to offer —
/// including when the check fails, because a machine that is simply offline
/// should not produce an error on launch.
export async function look(): Promise<Available | null> {
  let update: Update | null = null;
  try {
    update = await check();
  } catch {
    return null;
  }
  if (!update) return null;
  if (update.version === skipped()) return null;

  return {
    version: update.version,
    notes: update.body ?? null,
    canInstall: await canSelfInstall(),
    handle: update,
  };
}

/// Downloads and installs, then restarts into the new version.
///
/// On Windows the installer closes the app itself partway through, so the
/// relaunch below is only reached on platforms that do not — it is not dead
/// code, and it must not be relied on for the process to actually exit.
export async function install(
  update: Available,
  onProgress?: (percent: number | null) => void
): Promise<void> {
  let total = 0;
  let received = 0;

  await update.handle.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(total > 0 ? 0 : null);
        break;
      case "Progress":
        received += event.data.chunkLength;
        // Some servers send no content length; report indeterminate rather
        // than a bar that jumps to a made-up number.
        onProgress?.(total > 0 ? (received / total) * 100 : null);
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });

  await relaunch();
}

/// Opens the release page — the Linux path, and the "what changed?" link.
export function openReleasePage(): Promise<void> {
  return openUrl(RELEASES_URL);
}
