// Streaming download with progress. In the packaged Electron app, the actual
// download is handed off to the main process via IPC (window.yt2mp), which
// streams straight to disk with fs.createWriteStream — at no point does the
// full file sit in this renderer's JS heap, unlike the old approach of
// buffering every chunk into an array and building a Blob before saving
// (which held a multi-GB 4K video in memory twice before any byte hit disk).
// Falls back to the old Blob-based save when window.yt2mp isn't present
// (e.g. running `bun run dev` in a plain browser tab, outside Electron).
"use client";

export type DownloadFormat = "mp3" | "mp4";

export interface DownloadParams {
  url: string;
  format: DownloadFormat;
  quality?: number;
  title: string;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null; // null when the server doesn't send Content-Length
  percent: number | null; // 0..100, or null when total is unknown
}

interface Yt2mpBridge {
  startDownload: (
    id: string,
    args: DownloadParams
  ) => Promise<{ filePath: string }>;
  onDownloadProgress: (
    callback: (p: { id: string; receivedBytes: number; totalBytes: number | null }) => void
  ) => () => void;
  cancelDownload: (id: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  stopDownload: (id: string) => void;
}

declare global {
  interface Window {
    yt2mp?: Yt2mpBridge;
  }
}

function buildUrl({ url, format, quality, title }: DownloadParams): string {
  const params = new URLSearchParams({ url, format });
  if (quality) params.set("quality", String(quality));
  if (title) params.set("title", title);
  return `/api/download?${params.toString()}`;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

// Old path: buffers the whole response into memory before saving via a
// synthetic <a download> click. Only used outside Electron, where there's no
// main process to hand the real file-write off to.
async function downloadWithProgressBrowser(
  params: DownloadParams,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(buildUrl(params), { signal });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status})`);
  }

  const lenHeader = res.headers.get("Content-Length");
  const totalBytes = lenHeader ? parseInt(lenHeader, 10) : null;
  const fallbackName = `${params.title || "yt2mp"}.${params.format}`;
  const filename = filenameFromDisposition(
    res.headers.get("Content-Disposition"),
    fallbackName
  );

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  onProgress({ receivedBytes: 0, totalBytes, percent: totalBytes ? 0 : null });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress({
        receivedBytes: received,
        totalBytes,
        percent: totalBytes ? Math.min(100, (received / totalBytes) * 100) : null,
      });
    }
  }

  const blob = new Blob(chunks as BlobPart[], {
    type: params.format === "mp3" ? "audio/mpeg" : "video/mp4",
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);

  onProgress({ receivedBytes: received, totalBytes, percent: 100 });
}

// Real path: the main process opens a native Save dialog, fetches the same
// /api/download URL itself, and streams the response straight to disk.
async function downloadWithProgressElectron(
  bridge: Yt2mpBridge,
  id: string,
  params: DownloadParams,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  let totalBytes: number | null = null;

  const unsubscribe = bridge.onDownloadProgress((p) => {
    if (p.id !== id) return;
    totalBytes = p.totalBytes;
    onProgress({
      receivedBytes: p.receivedBytes,
      totalBytes: p.totalBytes,
      percent: p.totalBytes ? Math.min(100, (p.receivedBytes / p.totalBytes) * 100) : null,
    });
  });

  const onAbort = () => bridge.cancelDownload(id);
  signal?.addEventListener("abort", onAbort);

  try {
    onProgress({ receivedBytes: 0, totalBytes, percent: totalBytes ? 0 : null });
    await bridge.startDownload(id, params);
    onProgress({ receivedBytes: 0, totalBytes, percent: 100 });
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", onAbort);
  }
}

// Downloads with progress, saving the file when done. The caller-supplied id
// is reused for pause/resume/stop calls, so the UI can control an in-flight
// download by the same key it already tracks it under. Returns a promise
// that resolves once the file has been written.
export async function downloadWithProgress(
  id: string,
  params: DownloadParams,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (typeof window !== "undefined" && window.yt2mp) {
    return downloadWithProgressElectron(window.yt2mp, id, params, onProgress, signal);
  }
  return downloadWithProgressBrowser(params, onProgress, signal);
}

// Pause/resume/stop only do anything meaningful inside Electron — outside it
// (plain browser fallback), there's no main-process download to control, so
// these are quiet no-ops there.
export function pauseDownload(id: string): void {
  window.yt2mp?.pauseDownload(id);
}

export function resumeDownload(id: string): void {
  window.yt2mp?.resumeDownload(id);
}

export function stopDownload(id: string): void {
  window.yt2mp?.stopDownload(id);
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
