// The bridge to Rust. Replaces the Electron build's window.yt2mp preload
// bridge *and* its fetch("/api/...") calls — there is no HTTP server in this
// app, so both collapse into plain command invocations.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type DownloadFormat = "mp3" | "mp4";

export interface QualityOption {
  height: number;
  /** Estimated size of the final merged file, or null if yt-dlp reported none. */
  estimatedBytes: number | null;
}

/** Sites the UI has specific handling for. "other" is anything else yt-dlp
 *  supports — there are ~1750 extractors, and those still work. */
export type Platform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "twitter"
  | "twitch"
  | "other";

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "X",
  twitch: "Twitch",
  other: "Link",
};

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  availableHeights: number[];
  qualities: QualityOption[];
  audioEstimatedBytes: number | null;
  platform: Platform;
  /** Whether this can be played inline. Decided in Rust (platform.rs) so the
   *  rule lives in one place rather than being duplicated here. */
  canEmbed: boolean;
  /** yt-dlp's resolved page URL — survives short links (vm.tiktok.com, t.co). */
  webpageUrl: string;
}

/**
 * Pause/resume only appears above this size. Suspending a transfer is worth
 * the extra controls on a multi-gigabyte 4K download, where walking away
 * mid-transfer is a real scenario; on a three-minute MP3 that finishes in
 * seconds the buttons are noise. Below the threshold the UI offers Stop only.
 */
export const PAUSE_THRESHOLD_BYTES = 1024 ** 3; // 1 GB

/**
 * Whether a download of this size should offer pause/resume. Unknown sizes
 * (null) count as small — better to omit a control than to show one that
 * turns out to be pointless on a short download.
 */
export function supportsPause(estimatedBytes: number | null): boolean {
  return estimatedBytes !== null && estimatedBytes >= PAUSE_THRESHOLD_BYTES;
}

export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration: number;
  uploader: string;
}

export interface PlaylistInfo {
  id: string;
  title: string;
  entries: PlaylistEntry[];
}

export type InfoResult =
  | { kind: "video"; video: VideoInfo }
  | { kind: "playlist"; playlist: PlaylistInfo };

export interface DownloadProgress {
  percent: number;
  stage: string;
}

export type Mode = "link" | "ai";

/** Resolves a link or an AI-search phrase into something downloadable. */
export function fetchInfo(url: string, mode: Mode): Promise<InfoResult> {
  return invoke<InfoResult>("fetch_info", { url, mode });
}

export interface StartDownloadArgs {
  id: string;
  url: string;
  format: DownloadFormat;
  quality?: number;
  title: string;
  /**
   * Save straight into this folder instead of opening the save dialog. Set
   * only by the whole-playlist download, which asks for a folder once up
   * front — a dialog per track would make a 40-song mix 40 prompts.
   *
   * The name is derived from the title, and a clash gets " (2)" appended
   * rather than overwriting.
   */
  intoDir?: string;
}

/**
 * Opens the native save dialog and downloads to the chosen path. Resolves
 * with the final file path. Rejects with "Save cancelled" if the user closes
 * the dialog, or "Download stopped" if they stop it mid-transfer — both are
 * deliberate user actions, and the UI treats them as such rather than as
 * failures.
 */
export function startDownload(args: StartDownloadArgs): Promise<string> {
  return invoke<string>("start_download", {
    id: args.id,
    url: args.url,
    format: args.format,
    quality: args.quality ?? null,
    title: args.title,
    intoDir: args.intoDir ?? null,
  });
}

/**
 * Asks for a folder, once, before a playlist download starts. Resolves with
 * null if the user closes the dialog.
 */
export function pickFolder(): Promise<string | null> {
  return invoke<string | null>("pick_folder");
}

export function stopDownload(id: string): Promise<void> {
  return invoke("stop_download", { id });
}

/**
 * Suspends the download's yt-dlp process. The transfer stays open and its
 * partial output stays on disk, so resuming continues rather than restarting.
 * Only offered on downloads above PAUSE_THRESHOLD_BYTES.
 */
export function pauseDownload(id: string): Promise<void> {
  return invoke("pause_download", { id });
}

export function resumeDownload(id: string): Promise<void> {
  return invoke("resume_download", { id });
}

/** Opens the containing folder in the system file manager. */
export function revealFile(path: string): Promise<void> {
  return invoke("reveal_file", { path });
}

/// Settings that persist between runs.
export interface Settings {
  /** Browser to borrow cookies from, or null to share nothing. */
  cookiesFrom: string | null;
}

/// Rust uses snake_case on the wire; these two functions are the only place
/// that difference exists, so the rest of the UI never sees it.
export async function getSettings(): Promise<Settings> {
  const raw = await invoke<{ cookies_from: string | null }>("get_settings");
  return { cookiesFrom: raw.cookies_from };
}

/// Returns what was actually stored, which may differ from what was sent if a
/// value was rejected — callers should render the result rather than assume
/// their input took effect.
export async function saveSettings(next: Settings): Promise<Settings> {
  const raw = await invoke<{ cookies_from: string | null }>("save_settings", {
    next: { cookies_from: next.cookiesFrom },
  });
  return { cookiesFrom: raw.cookies_from };
}

/// A browser installed on this machine.
export interface Browser {
  /** Display name, e.g. "Zen". */
  label: string;
  /** The yt-dlp argument identifying it; also what gets stored in settings. */
  arg: string;
  /** Chromium-family browsers lock their cookie store while running. */
  chromium: boolean;
}

export function detectedBrowsers(): Promise<Browser[]> {
  return invoke<Browser[]>("detected_browsers");
}

/// The display name for a saved choice, since settings hold the raw argument.
export function browserLabel(arg: string): Promise<string | null> {
  return invoke<string | null>("browser_label", { arg });
}

/// What happened when one browser was tested against a login-gated post.
export type ProbeOutcome =
  | { status: "works" }
  | { status: "notsignedin" }
  | { status: "locked" }
  | { status: "signedinbutblocked" }
  | { status: "failed"; reason: string };

export interface ProbeStep {
  label: string;
  arg: string;
  outcome: ProbeOutcome;
}

/// Tries every installed browser and saves the first one that is signed in.
/// Resolves with what each browser did, so the UI can explain the result.
export function findWorkingBrowser(): Promise<ProbeStep[]> {
  return invoke<ProbeStep[]>("find_working_browser");
}

/// Fires as each browser is about to be tested, carrying its name.
export function onLoginProbing(callback: (label: string) => void): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  listen<string>("login:probing", (e) => callback(e.payload)).then((fn) => {
    if (cancelled) {
      fn();
      return;
    }
    unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/// State of the three external binaries (yt-dlp, ffmpeg, the JS runtime).
/// They are downloaded on first run rather than bundled, so the UI has to be
/// able to ask whether they are there yet.
export interface ToolsStatus {
  ready: boolean;
  /// Labels of what is still missing, for the first-run copy.
  missing: string[];
  ytdlpVersion: string | null;
}

interface RawToolsStatus {
  ready: boolean;
  missing: string[];
  ytdlp_version: string | null;
}

function toToolsStatus(raw: RawToolsStatus): ToolsStatus {
  return {
    ready: raw.ready,
    missing: raw.missing,
    ytdlpVersion: raw.ytdlp_version,
  };
}

export async function toolsStatus(): Promise<ToolsStatus> {
  return toToolsStatus(await invoke<RawToolsStatus>("tools_status"));
}

/// Downloads whatever is missing. Anything already present is left alone, so
/// this is safe to retry after a failed or interrupted first run.
export async function ensureTools(): Promise<ToolsStatus> {
  return toToolsStatus(await invoke<RawToolsStatus>("ensure_tools"));
}

/// Re-downloads yt-dlp on its own — the fix for a site that broke upstream.
export async function updateYtdlp(): Promise<ToolsStatus> {
  return toToolsStatus(await invoke<RawToolsStatus>("update_ytdlp"));
}

/// What a check against yt-dlp's releases found. Rust serialises this in
/// camelCase already, so there is no snake_case shape to convert.
export interface YtdlpCheck {
  current: string | null;
  latest: string | null;
  /// True only when both versions are known and differ — an unknown answer is
  /// never reported as "an update is waiting".
  updateAvailable: boolean;
}

/// Asks whether a newer yt-dlp exists without downloading it, so the button
/// can offer an update rather than always re-fetching 17 MB to find out.
export function checkYtdlp(): Promise<YtdlpCheck> {
  return invoke<YtdlpCheck>("check_ytdlp");
}

/// The running app version, read from the bundle rather than a constant so it
/// always matches what was actually installed.
export function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

export interface ToolProgress {
  label: string;
  percent: number;
  stage: string;
}

/// Progress while the tools download. Same shape as download progress, but on
/// its own channel so a first-run fetch and a video download never collide.
export function onToolsProgress(
  callback: (p: ToolProgress) => void
): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  listen<ToolProgress>("tools-progress", (e) => callback(e.payload)).then(
    (fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    }
  );

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

interface ProgressEvent {
  id: string;
  percent: number;
  stage: string;
}

/**
 * Subscribes to progress for one download id. Rust pushes these as events, so
 * unlike the Electron build there is no polling loop against a progress
 * endpoint. Returns an unsubscribe function.
 */
export function onDownloadProgress(
  id: string,
  callback: (p: DownloadProgress) => void
): () => void {
  // listen() is async but callers want a synchronous unsubscribe, so the
  // handle is captured once it resolves and a flag covers the window where
  // unsubscribe is called before that happens.
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  listen<ProgressEvent>("download:progress", (event) => {
    if (event.payload.id !== id) return;
    callback({ percent: event.payload.percent, stage: event.payload.stage });
  }).then((fn) => {
    if (cancelled) {
      fn();
      return;
    }
    unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
