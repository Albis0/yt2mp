import {NextRequest, NextResponse} from "next/server";
import {getVideoInfo, isValidYoutubeUrl} from "@/lib/ytdlp";

export async function POST(req: NextRequest) {
    let url: string | undefined;

    try {
        const body = await req.json();
        url = body?.url;
    } catch {
        return NextResponse.json({error: "Invalid request body."}, {status: 400});
    }

    if (!url || typeof url !== "string" || !isValidYoutubeUrl(url)) {
        return NextResponse.json({error: "Please enter a valid YouTube link."}, {status: 400});
    }

    try {
        const info = await getVideoInfo(url);
        return NextResponse.json(info);
    } catch (err) {
        console.error("getVideoInfo failed:", err);
        return NextResponse.json({error: "Could not fetch video info. Check that the link is correct."}, {status: 502});
    }
}
