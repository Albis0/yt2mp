// In-memory store for yt-dlp's own download/merge progress, keyed by the
// download id the client generates. MP4 downloads run to a temp file before
// any byte of the response streams out (see lib/ytdlp.ts's
// downloadMp4ToFile), so there's no way to report progress through the
// download response itself — the client polls GET /api/download-progress
// instead while the real download/merge is happening server-side.
const progress = new Map<string, number>();

export function setDownloadProgress(id: string, percent: number): void {
  progress.set(id, percent);
}

export function getDownloadProgress(id: string): number | null {
  return progress.get(id) ?? null;
}

export function clearDownloadProgress(id: string): void {
  progress.delete(id);
}
