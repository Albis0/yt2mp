import { NextRequest } from "next/server";
import fs from "fs";
import {
  isValidYoutubeUrl,
  spawnMp3Stream,
  downloadMp4ToFile,
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

  const baseName = safeFileName(title);

  if (format === "mp3") {
    const proc = spawnMp3Stream(url);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        proc.stdout.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        proc.stdout.on("end", () => controller.close());
        proc.on("error", (err) => controller.error(err));
        proc.stderr.on("data", () => {
          // yt-dlp progress/log info written to stderr; ignored for the response stream.
        });
      },
      cancel() {
        proc.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": contentDisposition(`${baseName}.mp3`),
        "Cache-Control": "no-store",
      },
    });
  }

  // MP4: video+audio above 360p are separate YouTube streams that yt-dlp has
  // to download and mux with ffmpeg into a real file first (can't be muxed
  // through a stdout pipe) — see lib/ytdlp.ts's downloadMp4ToFile. Once
  // that's done, stream the merged file's bytes and delete it.
  let filePath: string;
  try {
    filePath = await downloadMp4ToFile(url, quality);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed.";
    return new Response(message, { status: 502 });
  }

  const stats = fs.statSync(filePath);
  const fileStream = fs.createReadStream(filePath);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk) => {
        controller.enqueue(new Uint8Array(chunk as Buffer));
      });
      fileStream.on("end", () => {
        controller.close();
        fs.unlink(filePath, () => {});
      });
      fileStream.on("error", (err) => {
        controller.error(err);
        fs.unlink(filePath, () => {});
      });
    },
    cancel() {
      fileStream.destroy();
      fs.unlink(filePath, () => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stats.size),
      "Content-Disposition": contentDisposition(`${baseName}.mp4`),
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
