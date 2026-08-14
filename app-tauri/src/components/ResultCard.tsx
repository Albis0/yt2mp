import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  formatBytes,
  formatDuration,
  PLATFORM_LABELS,
  revealFile,
  supportsPause,
  type DownloadFormat,
  type VideoInfo,
} from "@/lib/api";
import type { ActiveDownload } from "@/App";

interface ResultCardProps {
  info: VideoInfo;
  downloads: Record<string, ActiveDownload>;
  onDownload: (format: DownloadFormat, quality?: number) => void;
  onStop: (key: string) => void;
  onRestart: (key: string) => void;
  onPause: (key: string) => void;
  onResume: (key: string) => void;
}

function ProgressBar({
  dl,
  onStop,
  onRestart,
  onPause,
  onResume,
}: {
  dl: ActiveDownload;
  onStop: () => void;
  onRestart: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  // Stop is a deliberate user action, not a failure — and "Save cancelled"
  // (closing the native dialog) isn't a real failure either. Both get a
  // neutral status plus a clear next action instead of red error text.
  if (dl.stopped) {
    return (
      <div className="dl-progress">
        <span className="dl-status">Stopped</span>
        <button type="button" className="dl-ctrl-btn" onClick={onRestart}>
          Restart
        </button>
      </div>
    );
  }

  if (dl.error) {
    const isCancelled = dl.error === "Save cancelled";
    return (
      <span className={isCancelled ? "dl-status" : "dl-status dl-status-error"}>
        {isCancelled ? "Cancelled" : `Failed — ${dl.error}`}
      </span>
    );
  }

  if (dl.done) {
    return (
      <div className="dl-progress">
        <div className="dl-track">
          <div className="dl-fill dl-fill-done" />
        </div>
        <span className="dl-status">Saved</span>
        {dl.filePath ? (
          <button
            type="button"
            className="dl-ctrl-btn"
            onClick={() => revealFile(dl.filePath!)}
          >
            Show
          </button>
        ) : null}
      </div>
    );
  }

  const { percent, stage } = dl.progress;
  // Pause is only worth offering on downloads large enough that walking away
  // mid-transfer is a real scenario — see supportsPause.
  const canPause = supportsPause(dl.estimatedBytes);
  return (
    <div className="dl-progress">
      <div className="dl-track">
        <div
          className={`dl-fill${dl.paused ? " dl-fill-paused" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="dl-status">
        {dl.paused ? "Paused" : percent > 0 ? `${Math.floor(percent)}%` : stage}
        {dl.estimatedBytes ? ` · ${formatBytes(dl.estimatedBytes)}` : ""}
      </span>
      <div className="dl-controls">
        {canPause ? (
          dl.paused ? (
            <button type="button" className="dl-ctrl-btn" onClick={onResume}>
              Resume
            </button>
          ) : (
            <button type="button" className="dl-ctrl-btn" onClick={onPause}>
              Pause
            </button>
          )
        ) : null}
        <button
          type="button"
          className="dl-ctrl-btn dl-ctrl-btn-stop"
          onClick={onStop}
        >
          Stop
        </button>
      </div>
    </div>
  );
}

export default function ResultCard({
  info,
  downloads,
  onDownload,
  onStop,
  onRestart,
  onPause,
  onResume,
}: ResultCardProps) {
  const [playing, setPlaying] = useState(false);
  const topQualities = info.qualities.slice(0, 4);
  const canEmbed = info.canEmbed;
  const platformLabel = PLATFORM_LABELS[info.platform];

  const mp3Key = "mp3-auto";
  const mp3Dl = downloads[mp3Key];

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
        <span className={`platform-badge platform-${info.platform}`}>
          {platformLabel}
        </span>
      </div>

      <div className="result-meta">
        <h2 className="result-title">{info.title}</h2>
        <p className="result-sub">
          {info.uploader ? `${info.uploader} · ` : ""}
          {info.duration > 0 ? formatDuration(info.duration) : "—"}
        </p>

        <div className="format-section">
          <div className="format-group-label">Audio</div>
          <div className="format-row">
            <button
              type="button"
              className="format-btn format-btn-audio"
              onClick={() => onDownload("mp3")}
              disabled={!!mp3Dl && !mp3Dl.done && !mp3Dl.error}
            >
              <span className="format-label">MP3</span>
              <span className="format-hint">
                {info.audioEstimatedBytes
                  ? formatBytes(info.audioEstimatedBytes)
                  : "audio"}
              </span>
            </button>
            {mp3Dl ? (
              <ProgressBar
                dl={mp3Dl}
                onStop={() => onStop(mp3Key)}
                onRestart={() => onRestart(mp3Key)}
                onPause={() => onPause(mp3Key)}
                onResume={() => onResume(mp3Key)}
              />
            ) : null}
          </div>

          <div className="format-group-label">Video</div>
          <div className="format-grid">
            {(topQualities.length > 0
              ? topQualities
              : [{ height: 0, estimatedBytes: null }]
            ).map((q, i) => {
              const h = q.height || undefined;
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
                    {/* Right-aligned and tabular, so the sizes down the list
                        form a column that can be compared at a glance. */}
                    <span className="format-hint">
                      {q.estimatedBytes ? formatBytes(q.estimatedBytes) : "—"}
                    </span>
                  </button>
                  {dl ? (
                    <ProgressBar
                      dl={dl}
                      onStop={() => onStop(key)}
                      onRestart={() => onRestart(key)}
                      onPause={() => onPause(key)}
                      onResume={() => onResume(key)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
