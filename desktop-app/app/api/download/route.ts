import { NextRequest } from "next/server";
import {
  isValidYoutubeUrl,
  spawnMp3Stream,
  spawnMp4Stream,
  type DownloadFormat,
} from "@/lib/ytdlp";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const url = searchParams.get("url");
  const format = searchParams.get("format") as DownloadFormat | null;
  const quality = searchParams.get("quality") ?? undefined;
  const title = searchParams.get("title") ?? undefined;

  if (!url || !isValidYoutubeUrl(url)) {
    return new Response("Please enter a valid YouTube link.", { status: 400 });
  }

  if (format !== "mp3" && format !== "mp4") {
    return new Response("Format must be mp3 or mp4.", { status: 400 });
  }

  const proc = format === "mp3" ? spawnMp3Stream(url) : spawnMp4Stream(url, quality);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      proc.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      proc.stdout.on("end", () => {
        controller.close();
      });
      proc.on("error", (err) => {
        controller.error(err);
      });
      proc.stderr.on("data", () => {
        // yt-dlp progress/log info written to stderr; ignored for the response stream.
      });
    },
    cancel() {
      proc.kill();
    },
  });

  const ext = format === "mp3" ? "mp3" : "mp4";
  const contentType = format === "mp3" ? "audio/mpeg" : "video/mp4";
  const baseName = safeFileName(title);

  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(`${baseName}.${ext}`),
      "Cache-Control": "no-store",
    },
  });
}

// Turn a video title into a filename that's safe on Windows/macOS/Linux.
// Strips characters illegal in filenames, collapses whitespace, and trims
// length. If nothing usable remains, falls back to a non-repeating timestamp
// name so two downloads never silently overwrite each other.
function safeFileName(title?: string): string {
  const cleaned = (title ?? "")
    .replace(/[\\/:*?"<>|]/g, "") // characters illegal in Windows filenames
    .replace(/[\x00-\x1f]/g, "") // control characters
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, ""); // Windows dislikes trailing dots/spaces

  if (cleaned) return cleaned;

  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");
  return `yt2mp-${stamp}`;
}

// Build a Content-Disposition header that survives non-ASCII titles (Turkish
// characters, emoji, etc.) by providing both a plain ASCII fallback and the
// RFC 5987 UTF-8 encoded form browsers prefer.
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
