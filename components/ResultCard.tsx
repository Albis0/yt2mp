"use client";

import type {VideoInfo} from "@/lib/ytdlp";

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface ResultCardProps {
    info: VideoInfo;
    url: string;
}

export default function ResultCard({info, url}: ResultCardProps) {
    const downloadHref = (format: "mp3" | "mp4", quality?: number) => {
        const params = new URLSearchParams({url, format});
        if (quality) params.set("quality", String(quality));
        return `/api/download?${params.toString()}`;
    };

    // Capped at 720p: higher resolutions need more memory to transcode/stream
    // than the free-tier host this runs on can spare.
    const topHeights = info.availableHeights.filter((h) => h <= 720).slice(0, 4);

    return (
        <div className="result-card">
            <div className="result-thumb">
                {info.thumbnail ?
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={info.thumbnail} alt={info.title} />
                :   null}
            </div>
            <div className="result-meta">
                <h2 className="result-title">{info.title}</h2>
                <p className="result-sub">
                    {info.uploader} · {formatDuration(info.duration)}
                </p>
                <div className="format-grid">
                    <a className="format-btn format-btn-audio" href={downloadHref("mp3")}>
                        Download MP3
                    </a>
                    {topHeights.length > 0 ?
                        topHeights.map((h) => (
                            <a key={h} className="format-btn" href={downloadHref("mp4", h)}>
                                MP4 {h}p
                            </a>
                        ))
                    :   <a className="format-btn" href={downloadHref("mp4")}>
                            Download MP4
                        </a>
                    }
                </div>
            </div>
        </div>
    );
}
