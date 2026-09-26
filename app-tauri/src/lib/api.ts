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

/** Bytes and pace while a download is moving data. */
export interface Transfer {
  /** Every stream so far, video and audio together. */
  downloaded: number;
  /** Bytes per second, when yt-dlp knows it. */
  speed: number | null;
  /** Seconds left on the stream being fetched, when known. */
  eta: number | null;
}

export interface DownloadProgress {
  percent: number;
  stage: string;
  /** Absent for stages that move no data: starting, merging, converting. */
  transfer?: Transfer;
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
 * The folder a playlist saves into: the download folder, asked for now if
 * this is the first download. Resolves with null if the user closes the
 * dialog.
 */
export function downloadFolder(): Promise<string | null> {
  return invoke<string | null>("download_folder");
}

/// A file on disk the converter can read.
export interface SourceInfo {
  /** Absolute path. Also the id the converter list keys its rows by. */
  path: string;
  name: string;
  sizeBytes: number | null;
  /** Seconds, or null when the container reports none — not an error. */
  duration: number | null;
  /** False when there is no audio stream; the UI refuses to queue those for MP3. */
  hasAudio: boolean;
  /**
   * True when the file has a picture in it.
   *
   * Not a gate, unlike `hasAudio`: an audio file asked to become an MP4 is a
   * legitimate thing to want, so this only drives what a row says about
   * itself.
   */
  hasVideo: boolean;
}

/**
 * What a converted file should become.
 *
 * Deliberately narrower than DownloadFormat, which this looks like but is
 * not: that one picks a stream to fetch from a site, this one picks an
 * encoder to run locally. Keeping them separate means adding a download
 * format later cannot silently offer a conversion target ffmpeg has no
 * arguments for.
 */
export type ConvertTarget = "mp3" | "mp4";

/// One picked file: convertible, or a named reason it is not.
///
/// Files that cannot be read come back as entries rather than being dropped,
/// so picking five files and getting four rows never happens silently — the
/// fifth says what was wrong with it.
export type PickedFile =
  | { kind: "ok"; info: SourceInfo }
  | { kind: "bad"; path: string; name: string; reason: string };

/**
 * Opens a file picker for the converter tab.
 *
 * No extension filter is offered: the tab's promise is that whatever goes in
 * comes out converted, and a filter listing a dozen extensions would both
 * misrepresent that and hide a working file nobody thought to include.
 * Resolves with an empty array if the dialog is closed.
 */
export function pickMediaFiles(): Promise<PickedFile[]> {
  return invoke<PickedFile[]>("pick_media_files");
}

/** Probes files dropped onto the window; folders and the like are skipped. */
export function probeFiles(paths: string[]): Promise<PickedFile[]> {
  return invoke<PickedFile[]>("probe_files", { paths });
}

/**
 * Converts one file already on disk, written beside the original.
 *
 * Resolves with the path that was actually written, which is not always the
 * predictable one: converting an MP4 to MP4 cannot overwrite its own source,
 * so the backend picks a free name. Callers must read the result rather than
 * computing it.
 *
 * Reports progress on the same channel as downloads, so `onDownloadProgress`
 * works here unchanged. Rejects with "Conversion stopped" when the user stops
 * it — a deliberate action, which the UI treats as such rather than a failure.
 */
export function convertFile(args: {
  id: string;
  path: string;
  target: ConvertTarget;
  duration: number | null;
}): Promise<string> {
  return invoke<string>("convert_file", {
    id: args.id,
    path: args.path,
    target: args.target,
    duration: args.duration,
  });
}

/**
 * Saves an already-converted file somewhere else, through the save dialog.
 *
 * Copies rather than moves, so the converter row keeps working afterwards.
 * Resolves with null when the dialog is closed — a decision, not a failure.
 */
export function saveACopy(path: string, name: string): Promise<string | null> {
  return invoke<string | null>("save_a_copy", { path, name });
}

/** Size of a file on disk, or null. Used to show the converted file's size. */
export function fileSize(path: string): Promise<number | null> {
  return invoke<number | null>("file_size", { path });
}

/// One thing a page scan turned up.
export interface Found {
  /** The link to hand to the normal download path. */
  url: string;
  title: string;
  /** Seconds, or 0 when the site did not say — common on a flat listing. */
  duration: number;
  uploader: string;
  /** The site it turned out to live on, e.g. "Youtube". */
  site: string;
  /** How it was found. Shown on the row so the list explains itself. */
  how: "embedded" | "linked";
}

/**
 * The quick pass: asks the extractor to look at the page as-is, which finds an
 * embedded player when there is an obvious one. A few seconds, one request.
 *
 * An empty result is the normal answer for most pages, not an error — it is
 * the signal for offering the deep scan.
 */
export function scanPageQuick(url: string): Promise<Found[]> {
  return invoke<Found[]>("scan_page_quick", { url });
}

/**
 * The deep pass: fetches the page, pulls out every link, and asks the
 * extractor which ones it recognises. Returns the merged list, quick results
 * included, so the caller replaces its rows with this.
 *
 * Slower and only run when the user asks for it.
 */
export function scanPageDeep(url: string): Promise<Found[]> {
  return invoke<Found[]>("scan_page_deep", { url });
}

export function stopDownload(id: string): Promise<void> {
  return invoke("stop_download", { id });
}

/** Opens the containing folder in the system file manager. */
export function revealFile(path: string): Promise<void> {
  return invoke("reveal_file", { path });
}

/// Settings that persist between runs.
export interface Settings {
  /** Browser to borrow cookies from, or null to share nothing. */
  cookiesFrom: string | null;
  /** Where downloads are saved without asking; null until the first one. */
  downloadDir: string | null;
}

interface RawSettings {
  cookies_from: string | null;
  download_dir: string | null;
}

/// Rust uses snake_case on the wire; this is the only place that difference
/// exists, so the rest of the UI never sees it.
function toSettings(raw: RawSettings): Settings {
  return { cookiesFrom: raw.cookies_from, downloadDir: raw.download_dir ?? null };
}

export async function getSettings(): Promise<Settings> {
  return toSettings(await invoke<RawSettings>("get_settings"));
}

/// Saves the cookie choice. Returns what was actually stored, which may differ
/// from what was sent if a value was rejected — callers should render the
/// result rather than assume their input took effect.
export async function saveSettings(next: Pick<Settings, "cookiesFrom">): Promise<Settings> {
  return toSettings(
    await invoke<RawSettings>("save_settings", {
      next: { cookies_from: next.cookiesFrom },
    })
  );
}

/// Picks a new download folder. Null when the dialog was closed.
export async function chooseDownloadDir(): Promise<Settings | null> {
  const raw = await invoke<RawSettings | null>("choose_download_dir");
  return raw ? toSettings(raw) : null;
}

/// Forgets the download folder, so the next download asks for one.
export async function forgetDownloadDir(): Promise<Settings> {
  return toSettings(await invoke<RawSettings>("forget_download_dir"));
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
  transfer?: Transfer;
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
    callback({
      percent: event.payload.percent,
      stage: event.payload.stage,
      transfer: event.payload.transfer,
    });
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

/** "4.2 MB/s" */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/** Time left, the way a person would say it: "13s left", "4 min left". */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h} h ${m} min left` : `${h} h left`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
