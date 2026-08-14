import { useState } from "react";
import {
  fetchInfo,
  formatDuration,
  onDownloadProgress,
  startDownload,
  stopDownload,
  type DownloadFormat,
  type DownloadProgress,
  type Platform,
  type PlaylistInfo,
  type VideoInfo,
} from "@/lib/api";

interface TrackDownload {
  id: string;
  format: DownloadFormat;
  progress: DownloadProgress;
  done: boolean;
  error: string | null;
}

interface TrackState {
  loading: boolean;
  error: string | null;
  info: VideoInfo | null;
  download: TrackDownload | null;
}

interface PlaylistViewProps {
  playlist: PlaylistInfo;
  onDownloaded: (
    videoId: string,
    url: string,
    title: string,
    thumbnail: string,
    format: DownloadFormat,
    platform: Platform
  ) => void;
}

// Each track only fetches its own real info (formats, thumbnail) the moment
// the user expands it — the playlist itself loads instantly via
// --flat-playlist, so opening a 200-track playlist doesn't mean waiting on
// 200 yt-dlp calls up front.
export default function PlaylistView({ playlist, onDownloaded }: PlaylistViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Record<string, TrackState>>({});

  async function expand(id: string, url: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (tracks[id]?.info || tracks[id]?.loading) return;

    setTracks((t) => ({
      ...t,
      [id]: { loading: true, error: null, info: null, download: null },
    }));

    try {
      const data = await fetchInfo(url, "link");
      if (data.kind !== "video") {
        setTracks((t) => ({
          ...t,
          [id]: {
            loading: false,
            error: "Could not load this track.",
            info: null,
            download: null,
          },
        }));
        return;
      }
      setTracks((t) => ({
        ...t,
        [id]: { loading: false, error: null, info: data.video, download: null },
      }));
    } catch (err) {
      setTracks((t) => ({
        ...t,
        [id]: {
          loading: false,
          error: typeof err === "string" ? err : "Could not load this track.",
          info: null,
          download: null,
        },
      }));
    }
  }

  async function download(id: string, url: string, format: DownloadFormat) {
    const track = tracks[id];
    if (!track?.info) return;

    const downloadId = crypto.randomUUID();

    setTracks((t) => ({
      ...t,
      [id]: {
        ...t[id],
        download: {
          id: downloadId,
          format,
          progress: { percent: 0, stage: "Starting" },
          done: false,
          error: null,
        },
      },
    }));

    const unsubscribe = onDownloadProgress(downloadId, (progress) =>
      setTracks((t) =>
        t[id]?.download
          ? { ...t, [id]: { ...t[id], download: { ...t[id].download!, progress } } }
          : t
      )
    );

    try {
      await startDownload({
        id: downloadId,
        url,
        format,
        title: track.info.title,
      });
      setTracks((t) => ({
        ...t,
        [id]: { ...t[id], download: { ...t[id].download!, done: true } },
      }));
      onDownloaded(
        id,
        url,
        track.info.title,
        track.info.thumbnail,
        format,
        track.info.platform
      );
    } catch (err) {
      setTracks((t) => ({
        ...t,
        [id]: {
          ...t[id],
          download: {
            ...t[id].download!,
            error: typeof err === "string" ? err : "Download failed.",
          },
        },
      }));
    } finally {
      unsubscribe();
    }
  }

  function statusText(dl: TrackDownload): string {
    if (dl.error) {
      return dl.error === "Save cancelled"
        ? "Cancelled"
        : dl.error === "Download stopped"
          ? "Stopped"
          : `Failed — ${dl.error}`;
    }
    if (dl.done) return "Saved";
    return dl.progress.percent > 0
      ? `${Math.floor(dl.progress.percent)}%`
      : dl.progress.stage;
  }

  return (
    <div className="playlist-view">
      <div className="playlist-head">
        <h2 className="playlist-title">{playlist.title}</h2>
        <span className="playlist-count">{playlist.entries.length} tracks</span>
      </div>
      <ul className="playlist-list">
        {playlist.entries.map((entry, i) => {
          const track = tracks[entry.id];
          const isOpen = expanded === entry.id;
          const busy =
            !!track?.download && !track.download.done && !track.download.error;
          return (
            <li className="playlist-item" key={entry.id || i}>
              <button
                type="button"
                className="playlist-row"
                onClick={() => expand(entry.id, entry.url)}
              >
                <span className="playlist-index">{i + 1}</span>
                <span className="playlist-text">
                  <span className="playlist-track-title">{entry.title}</span>
                  <span className="playlist-track-sub">
                    {entry.uploader ? `${entry.uploader} · ` : ""}
                    {entry.duration ? formatDuration(entry.duration) : ""}
                  </span>
                </span>
                <span className="playlist-chevron">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen ? (
                <div className="playlist-expand">
                  {track?.loading ? (
                    <p className="playlist-status">Loading…</p>
                  ) : track?.error ? (
                    <p className="playlist-status playlist-status-error">
                      {track.error}
                    </p>
                  ) : track?.info ? (
                    <div className="playlist-formats">
                      <button
                        type="button"
                        className="format-btn format-btn-audio"
                        onClick={() => download(entry.id, entry.url, "mp3")}
                        disabled={busy}
                      >
                        <span className="format-label">MP3</span>
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => download(entry.id, entry.url, "mp4")}
                        disabled={busy}
                      >
                        <span className="format-label">MP4</span>
                      </button>
                      {track.download ? (
                        <>
                          <span className="dl-status">
                            {statusText(track.download)}
                          </span>
                          {busy ? (
                            <button
                              type="button"
                              className="dl-ctrl-btn dl-ctrl-btn-stop"
                              onClick={() => stopDownload(track.download!.id)}
                            >
                              Stop
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
