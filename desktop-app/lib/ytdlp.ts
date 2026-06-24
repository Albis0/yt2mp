import { spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";

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

// Without a deadline, a yt-dlp call stuck on a slow/dead network path (info
// fetch, search) hangs the "Fetching…" UI indefinitely instead of surfacing
// an error the user can act on.
const YTDLP_TIMEOUT_MS = 25000;

function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath(), args, { windowsHide: true });

    // Collecting raw chunks and joining once at the end avoids repeated
    // string concatenation/decoding on every "data" event — matters for
    // large -J --flat-playlist dumps with hundreds of entries.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, YTDLP_TIMEOUT_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (timedOut) {
        reject(new Error("Timed out — yt-dlp took too long to respond."));
        return;
      }
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

// YouTube only offers a single pre-muxed (video+audio combined) stream up to
// 360p — every quality above that (480p, 720p, 1080p, 1440p, 4K) is video-only
// and audio-only DASH streams that have to be downloaded separately and
// merged. Asking for "best[height<=1080]" silently falls back to whatever
// the highest pre-muxed format is (360p), regardless of what quality the UI
// shows as selected — this format selector instead requests the real
// separate streams so the actual download matches the requested resolution.
export function buildYtDlpVideoArgs(url: string, quality?: string): string[] {
  const height = quality ? parseInt(quality, 10) : undefined;
  const formatSelector =
    height && Number.isFinite(height)
      ? `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`
      : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best";

  return ["-f", formatSelector, "--no-playlist", "--merge-output-format", "mp4"];
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

// Long enough for a 4K video on a slow connection, short enough that a stuck
// download surfaces an error instead of hanging the UI indefinitely.
const MP4_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

// Separate video+audio streams can't be muxed while piping through stdout —
// merging needs a real seekable output, so yt-dlp downloads both streams to
// a temp file and muxes them with ffmpeg itself (--merge-output-format mp4),
// and only once that's done do we open the result and stream it onward. The
// caller is responsible for deleting the returned path once it's done
// reading it.
export async function downloadMp4ToFile(url: string, quality?: string): Promise<string> {
  const tmpBase = path.join(os.tmpdir(), `yt2mp-${crypto.randomUUID()}`);
  const args = [
    ...buildYtDlpVideoArgs(url, quality),
    "-o",
    `${tmpBase}.%(ext)s`,
    url,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ytdlpPath(), args, {
      windowsHide: true,
      env: { ...process.env, FFMPEG_LOCATION: ffmpegPath() },
    });

    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, MP4_DOWNLOAD_TIMEOUT_MS);

    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Timed out — download took too long."));
        return;
      }
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderrChunks).toString("utf-8") || `yt-dlp exited with code ${code}`));
        return;
      }
      resolve();
    });
  });

  const finalPath = `${tmpBase}.mp4`;
  if (!fs.existsSync(finalPath)) {
    throw new Error("Download finished but the merged file is missing.");
  }
  return finalPath;
}
