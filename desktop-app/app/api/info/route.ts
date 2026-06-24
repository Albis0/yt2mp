import { NextRequest, NextResponse } from "next/server";
import {
  getPlaylistInfo,
  getVideoInfo,
  isPlaylistUrl,
  isValidYoutubeUrl,
  searchVideoInfo,
} from "@/lib/ytdlp";
import { refineSearchQuery } from "@/lib/groq";

type Mode = "link" | "ai";

export async function POST(req: NextRequest) {
  let url: string | undefined;
  let mode: Mode = "link";

  try {
    const body = await req.json();
    url = body?.url;
    if (body?.mode === "ai") mode = "ai";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      {
        error:
          mode === "ai"
            ? "Describe what you're looking for."
            : "Please enter a YouTube link.",
      },
      { status: 400 }
    );
  }

  const clean = url.trim();

  // AI mode never touches yt-dlp's URL parsing directly — it always goes
  // through Groq to turn the request into a search query, then ytsearch1.
  if (mode === "ai") {
    try {
      const query = await refineSearchQuery(clean);
      const info = await searchVideoInfo(query);
      return NextResponse.json({ kind: "video", video: info });
    } catch (err) {
      console.error("searchVideoInfo failed:", err);
      return NextResponse.json(
        { error: "No results found for that search." },
        { status: 502 }
      );
    }
  }

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

  if (!isValidYoutubeUrl(clean)) {
    return NextResponse.json(
      { error: "Please enter a valid YouTube link, or switch to AI search." },
      { status: 400 }
    );
  }

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
