import { spawn } from "child_process";

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i;

export function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_PATTERN.test(url);
}

// When set, authenticates yt-dlp as a logged-in user so requests aren't
// subject to the IP-based bot checks that hit shared cloud-host IPs.
function cookieArgs(): string[] {
  const cookiesFile = process.env.COOKIES_FILE;
  return cookiesFile ? ["--cookies", cookiesFile] : [];
}

// yt-dlp needs a JS runtime + the EJS challenge-solver script to solve
// YouTube's signature/n-challenge. Bun ships in the base image but isn't
// auto-detected, and the solver script itself is fetched on demand from GitHub.
function commonArgs(): string[] {
  return [
    ...cookieArgs(),
    "--js-runtimes",
    "bun:/usr/local/bin/bun",
    "--remote-components",
    "ejs:github",
  ];
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
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  availableHeights: number[];
}

function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { windowsHide: true });

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
    title: data.title ?? "Unknown video",
    thumbnail: data.thumbnail ?? "",
    duration: data.duration ?? 0,
    uploader: data.uploader ?? "",
    availableHeights: extractAvailableHeights(formats),
  };
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await runYtDlp([...commonArgs(), "-J", "--no-playlist", url]);
  return parseVideoInfo(stdout);
}

export type DownloadFormat = "mp3" | "mp4";

export function buildYtDlpAudioArgs(url: string): string[] {
  return [...commonArgs(), "-f", "bestaudio", "--no-playlist", "-o", "-", url];
}

export function buildYtDlpVideoArgs(url: string, quality?: string): string[] {
  const height = quality ? parseInt(quality, 10) : undefined;
  const formatSelector =
    height && Number.isFinite(height)
      ? `best[height<=${height}][ext=mp4]/best[height<=${height}]`
      : "best[ext=mp4]/best";

  // A single pre-muxed "best" stream is required (not bestvideo+bestaudio),
  // since separate streams can't be merged while piping through stdout.
  return [...commonArgs(), "-f", formatSelector, "--no-playlist", "-o", "-", url];
}

/**
 * yt-dlp's own ffmpeg post-processing (audio extraction, muxing) only works
 * against real files, not stdout pipes. To stream a real MP3, we pipe
 * yt-dlp's raw audio bytes into a dedicated ffmpeg process that transcodes
 * on the fly.
 */
export function spawnMp3Stream(url: string) {
  const ytdlp = spawn("yt-dlp", buildYtDlpAudioArgs(url), { windowsHide: true });
  const ffmpeg = spawn(
    "ffmpeg",
    ["-i", "pipe:0", "-vn", "-f", "mp3", "-b:a", "192k", "pipe:1"],
    { windowsHide: true }
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.on("error", (err) => ffmpeg.emit("error", err));

  return ffmpeg;
}

export function spawnMp4Stream(url: string, quality?: string) {
  return spawn("yt-dlp", buildYtDlpVideoArgs(url, quality), { windowsHide: true });
}
