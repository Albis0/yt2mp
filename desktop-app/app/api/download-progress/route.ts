import { NextRequest, NextResponse } from "next/server";
import { getDownloadProgress } from "@/lib/downloadProgress";

// Polled by the client while an MP4 download/merge is in flight (see
// app/api/download/route.ts) — that response doesn't emit any bytes until
// yt-dlp's temp-file download and ffmpeg merge are both done, so this is the
// only way to surface real progress before then.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const percent = getDownloadProgress(id);
  return NextResponse.json({ percent });
}
