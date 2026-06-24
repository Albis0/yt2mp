import { spawn } from "child_process";

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i;

const YOUTUBE_PLAYLIST_PATTERN =
  /^https?:\/\/(www\.|m\.)?youtube\.com\/(playlist\?|watch\?.*[&?]list=)/i;

export function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_PATTERN.test(url);
}

export function isPlaylistUrl(url: string): boolean {
  return YOUTUBE_PLAYLIST_PATTERN.test(url);
}

// electron/main.ts sets these to the bundled binaries' resolved paths
// (different in dev vs. packaged) before the Next server starts.
function ytdlpPath(): string {
  return process.env.YTDLP_PATH || "yt-dlp";
}

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export interface VideoFormat {
  format_id: string;
  ext: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
}

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  availableHeights: number[];
}

function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath(), args, { windowsHide: true });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(err);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function extractAvailableHeights(formats: VideoFormat[]): number[] {
  const heights = new Set<number>();
  for (const f of formats) {
    if (f.vcodec && f.vcodec !== "none" && f.height) {
      heights.add(f.height);
    }
  }
  return Array.from(heights).sort((a, b) => b - a);
}

export function parseVideoInfo(raw: string): VideoInfo {
  const data = JSON.parse(raw);
  const formats: VideoFormat[] = data.formats ?? [];

  return {
    id: data.id ?? "",
    title: data.title ?? "Unknown video",
    thumbnail: data.thumbnail ?? "",
    duration: data.duration ?? 0,
    uploader: data.uploader ?? "",
    availableHeights: extractAvailableHeights(formats),
  };
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await runYtDlp(["-J", "--no-playlist", url]);
  return parseVideoInfo(stdout);
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

// Uses --flat-playlist so yt-dlp only lists entries (one JSON line per video)
// instead of resolving full formats for every track up front — the "lazy
// loading" the user wants: the list appears instantly, and each track's real
// info/formats are only fetched when the user actually picks it to download.
export async function getPlaylistInfo(url: string): Promise<PlaylistInfo> {
  const { stdout } = await runYtDlp(["-J", "--flat-playlist", url]);
  const data = JSON.parse(stdout);
  const rawEntries: Record<string, unknown>[] = data.entries ?? [];

  const entries: PlaylistEntry[] = rawEntries.map((e) => ({
    id: String(e.id ?? ""),
    title: String(e.title ?? "Unknown track"),
    url:
      typeof e.url === "string"
        ? e.url
        : `https://www.youtube.com/watch?v=${e.id}`,
    duration: typeof e.duration === "number" ? e.duration : 0,
    uploader: String(e.uploader ?? e.channel ?? ""),
  }));

  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? "Playlist"),
    entries,
  };
}

// Resolves free-text search queries (e.g. "song name artist") to a real
// video, the same way typing into YouTube's search bar would — no API key,
// no link required. yt-dlp's ytsearch1: pseudo-URL returns the top match.
export async function searchVideoInfo(query: string): Promise<VideoInfo> {
  const { stdout } = await runYtDlp(["-J", `ytsearch1:${query}`]);
  const data = JSON.parse(stdout);
  const first = Array.isArray(data.entries) ? data.entries[0] : data;
  return parseVideoInfo(JSON.stringify(first));
}

export type DownloadFormat = "mp3" | "mp4";

export function buildYtDlpAudioArgs(url: string): string[] {
  return ["-f", "bestaudio", "--no-playlist", "-o", "-", url];
}

export function buildYtDlpVideoArgs(url: string, quality?: string): string[] {
  const height = quality ? parseInt(quality, 10) : undefined;
  const formatSelector =
    height && Number.isFinite(height)
      ? `best[height<=${height}][ext=mp4]/best[height<=${height}]`
      : "best[ext=mp4]/best";

  // A single pre-muxed "best" stream is required (not bestvideo+bestaudio),
  // since separate streams can't be merged while piping through stdout.
  return ["-f", formatSelector, "--no-playlist", "-o", "-", url];
}

/**
 * yt-dlp's own ffmpeg post-processing (audio extraction, muxing) only works
 * against real files, not stdout pipes. To stream a real MP3, we pipe
 * yt-dlp's raw audio bytes into a dedicated ffmpeg process that transcodes
 * on the fly.
 */
export function spawnMp3Stream(url: string) {
  const ytdlp = spawn(ytdlpPath(), buildYtDlpAudioArgs(url), { windowsHide: true });
  const ffmpeg = spawn(
    ffmpegPath(),
    ["-i", "pipe:0", "-vn", "-f", "mp3", "-b:a", "192k", "pipe:1"],
    { windowsHide: true }
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.on("error", (err) => ffmpeg.emit("error", err));

  return ffmpeg;
}

export function spawnMp4Stream(url: string, quality?: string) {
  return spawn(ytdlpPath(), buildYtDlpVideoArgs(url, quality), { windowsHide: true });
}
