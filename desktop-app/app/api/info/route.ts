import { NextRequest, NextResponse } from "next/server";
import {
  getPlaylistInfo,
  getVideoInfo,
  isPlaylistUrl,
  isValidYoutubeUrl,
  searchVideoInfo,
} from "@/lib/ytdlp";

export async function POST(req: NextRequest) {
  let url: string | undefined;

  try {
    const body = await req.json();
    url = body?.url;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { error: "Please enter a YouTube link or search query." },
      { status: 400 }
    );
  }

  const clean = url.trim();

  if (isPlaylistUrl(clean)) {
    try {
      const playlist = await getPlaylistInfo(clean);
      return NextResponse.json({ kind: "playlist", playlist });
    } catch (err) {
      console.error("getPlaylistInfo failed:", err);
      return NextResponse.json(
        { error: "Could not fetch playlist info. Check that the link is correct." },
        { status: 502 }
      );
    }
  }

  if (isValidYoutubeUrl(clean)) {
    try {
      const info = await getVideoInfo(clean);
      return NextResponse.json({ kind: "video", video: info });
    } catch (err) {
      console.error("getVideoInfo failed:", err);
      return NextResponse.json(
        { error: "Could not fetch video info. Check that the link is correct." },
        { status: 502 }
      );
    }
  }

  // Not a recognizable YouTube URL — treat it as a search query instead of
  // rejecting it, so users can type a song name instead of hunting for a link.
  try {
    const info = await searchVideoInfo(clean);
    return NextResponse.json({ kind: "video", video: info });
  } catch (err) {
    console.error("searchVideoInfo failed:", err);
    return NextResponse.json(
      { error: "No results found for that search." },
      { status: 502 }
    );
  }
}
