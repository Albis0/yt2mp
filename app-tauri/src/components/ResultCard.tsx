import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatDuration, PLATFORM_LABELS, type DownloadFormat, type VideoInfo } from "@/lib/api";
import type { ActiveDownload } from "@/App";
import DownloadRow, { type RowState } from "@/components/DownloadRow";

interface ResultCardProps {
  info: VideoInfo;
  downloads: Record<string, ActiveDownload>;
  onDownload: (format: DownloadFormat, quality?: number) => void;
  onStop: (key: string) => void;
}

/// What a row shows for the download under its key, if any.
function rowStateOf(dl: ActiveDownload | undefined): RowState {
  if (!dl) return { at: "idle" };
  if (dl.stopped) return { at: "cancelled" };
  // Closing the folder dialog on a first download is a decision, not a
  // failure: the row simply goes back to how it was.
  if (dl.error === "Save cancelled") return { at: "idle" };
  if (dl.error) return { at: "failed", error: dl.error };
  if (dl.done) return { at: "done", filePath: dl.filePath };
  return { at: "running", progress: dl.progress };
}

/// The badge YouTube's own quality menu puts beside a resolution, so the
/// list reads the way the site's player does.
function resolutionTag(height: number): string | null {
  if (height >= 4320) return "8K";
  if (height >= 2160) return "4K";
  if (height >= 720) return "HD";
  return null;
}

export default function ResultCard({ info, downloads, onDownload, onStop }: ResultCardProps) {
  const [playing, setPlaying] = useState(false);
  const topQualities = info.qualities.slice(0, 4);
  const canEmbed = info.canEmbed;
  const platformLabel = PLATFORM_LABELS[info.platform];

  const mp3Key = "mp3-auto";
  const videoRows =
    topQualities.length > 0 ? topQualities : [{ height: 0, estimatedBytes: null }];

  return (
    <div className="result-card">
      <div className="result-preview">
        {canEmbed && playing && info.id ? (
          <iframe
            className="result-embed"
            src={`https://www.youtube.com/embed/${info.id}?autoplay=1&rel=0`}
            title={info.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          // Only YouTube can be played inline. For every other site the
          // thumbnail opens the original post in the user's real browser,
          // where they're already logged in if the site needs it.
          <button
            type="button"
            className="result-thumb"
            onClick={() =>
              canEmbed ? setPlaying(true) : info.webpageUrl && openUrl(info.webpageUrl)
            }
            disabled={!canEmbed && !info.webpageUrl}
            aria-label={canEmbed ? "Play preview" : `Open on ${platformLabel}`}
            title={canEmbed ? undefined : `Open on ${platformLabel}`}
          >
            {info.thumbnail ? <img src={info.thumbnail} alt="" /> : null}
            <span className="play-overlay" aria-hidden="true">
              {canEmbed ? (
                <span className="play-triangle" />
              ) : (
                <span className="open-glyph">↗</span>
              )}
            </span>
          </button>
        )}
        <span className={`platform-badge platform-${info.platform}`}>{platformLabel}</span>
      </div>

      <div className="result-meta">
        <h2 className="result-title">{info.title}</h2>
        <p className="result-sub">
          {info.uploader ? `${info.uploader} · ` : ""}
          {info.duration > 0 ? formatDuration(info.duration) : "—"}
        </p>

        <div className="format-section">
          <div className="format-group-label">Audio</div>
          <div className="dllist">
            <DownloadRow
              label="MP3"
              tags={["192 kbps"]}
              size={info.audioEstimatedBytes}
              state={rowStateOf(downloads[mp3Key])}
              onStart={() => onDownload("mp3")}
              onCancel={() => onStop(mp3Key)}
            />
          </div>

          <div className="format-group-label">Video</div>
          <div className="dllist">
            {videoRows.map((q) => {
              const h = q.height || undefined;
              const key = `mp4-${h ?? "auto"}`;
              const res = h ? resolutionTag(h) : null;
              return (
                <DownloadRow
                  key={key}
                  label={h ? `${h}p` : "Best"}
                  tags={res ? ["MP4", res] : ["MP4"]}
                  size={q.estimatedBytes}
                  state={rowStateOf(downloads[key])}
                  onStart={() => onDownload("mp4", h)}
                  onCancel={() => onStop(key)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
