"use client";

import { useState } from "react";
import type { VideoInfo } from "@/lib/ytdlp";
import { formatBytes, type DownloadFormat } from "@/lib/download";
import type { ActiveDownload } from "./DownloadForm";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface ResultCardProps {
  info: VideoInfo;
  downloads: Record<string, ActiveDownload>;
  onDownload: (format: DownloadFormat, quality?: number) => void;
}

function ProgressBar({ dl }: { dl: ActiveDownload }) {
  if (dl.error) {
    return <span className="dl-status dl-status-error">Failed — {dl.error}</span>;
  }
  const { percent, receivedBytes, totalBytes } = dl.progress;
  const label = dl.done
    ? "Saved"
    : percent !== null
      ? `${Math.floor(percent)}%`
      : formatBytes(receivedBytes);
  return (
    <div className="dl-progress">
      <div className="dl-track">
        <div
          className={`dl-fill${dl.done ? " dl-fill-done" : ""}${percent === null ? " dl-fill-indeterminate" : ""}`}
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
      <span className="dl-status">
        {label}
        {totalBytes && !dl.done ? ` · ${formatBytes(totalBytes)}` : ""}
      </span>
    </div>
  );
}

export default function ResultCard({ info, downloads, onDownload }: ResultCardProps) {
  const [playing, setPlaying] = useState(false);
  const topHeights = info.availableHeights.slice(0, 4);

  const mp3Key = "mp3-auto";
  const mp3Dl = downloads[mp3Key];

  return (
    <div className="result-card">
      <div className="result-preview">
        {playing && info.id ? (
          <iframe
            className="result-embed"
            src={`https://www.youtube.com/embed/${info.id}?autoplay=1&rel=0`}
            title={info.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="result-thumb"
            onClick={() => setPlaying(true)}
            disabled={!info.id}
            aria-label="Play preview"
          >
            {info.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={info.thumbnail} alt="" />
            ) : null}
            <span className="play-overlay" aria-hidden="true">
              <span className="play-triangle" />
            </span>
          </button>
        )}
      </div>

      <div className="result-meta">
        <h2 className="result-title">{info.title}</h2>
        <p className="result-sub">
          {info.uploader ? `${info.uploader} · ` : ""}
          {formatDuration(info.duration)}
          {info.id ? (
            <>
              {" · "}
              <a
                className="result-yt-link"
                href={`https://www.youtube.com/watch?v=${info.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube
              </a>
            </>
          ) : null}
        </p>

        <div className="format-section">
          <div className="format-row">
            <button
              type="button"
              className="format-btn format-btn-audio"
              onClick={() => onDownload("mp3")}
              disabled={!!mp3Dl && !mp3Dl.done && !mp3Dl.error}
            >
              <span className="format-label">MP3</span>
              <span className="format-hint">audio</span>
            </button>
            {mp3Dl ? <ProgressBar dl={mp3Dl} /> : null}
          </div>

          <div className="format-group-label">Video</div>
          <div className="format-grid">
            {(topHeights.length > 0 ? topHeights : [undefined]).map((h, i) => {
              const key = `mp4-${h ?? "auto"}`;
              const dl = downloads[key];
              const busy = !!dl && !dl.done && !dl.error;
              return (
                <div className="format-row" key={key + i}>
                  <button
                    type="button"
                    className="format-btn"
                    onClick={() => onDownload("mp4", h)}
                    disabled={busy}
                  >
                    <span className="format-label">{h ? `${h}p` : "MP4"}</span>
                    <span className="format-hint">mp4</span>
                  </button>
                  {dl ? <ProgressBar dl={dl} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
