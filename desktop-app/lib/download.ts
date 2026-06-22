// Streaming download with progress. Instead of letting the browser handle an
// <a download> (which gives no progress and no completion signal), we fetch the
// stream ourselves, read it chunk by chunk to compute a percentage, then hand
// the finished blob to the browser to save. This is what powers the Chrome-like
// progress bar in the UI.
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

// Streams the download, reporting progress, and saves the file when done.
// Returns a promise that resolves once the file has been handed to the browser.
export async function downloadWithProgress(
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
