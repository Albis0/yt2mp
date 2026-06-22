import {NextRequest} from "next/server";
import {isValidYoutubeUrl, spawnMp3Stream, spawnMp4Stream, type DownloadFormat} from "@/lib/ytdlp";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const url = searchParams.get("url");
    const format = searchParams.get("format") as DownloadFormat | null;
    const quality = searchParams.get("quality") ?? undefined;

    if (!url || !isValidYoutubeUrl(url)) {
        return new Response("Please enter a valid YouTube link.", {status: 400});
    }

    if (format !== "mp3" && format !== "mp4") {
        return new Response("Format must be mp3 or mp4.", {status: 400});
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

    return new Response(stream, {
        headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="download.${ext}"`,
            "Cache-Control": "no-store",
        },
    });
}
