"use client";

import { useState } from "react";
import type { PlaylistInfo, VideoInfo } from "@/lib/ytdlp";
import { downloadWithProgress, type DownloadFormat, type DownloadProgress } from "@/lib/download";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface TrackState {
  loading: boolean;
  error: string | null;
  info: VideoInfo | null;
  download: { format: DownloadFormat; progress: DownloadProgress; done: boolean; error: string | null } | null;
}

interface PlaylistViewProps {
  playlist: PlaylistInfo;
  onDownloaded: (videoId: string, url: string, title: string, thumbnail: string, format: DownloadFormat) => void;
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

    setTracks((t) => ({ ...t, [id]: { loading: true, error: null, info: null, download: null } }));
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || data.kind !== "video") {
        setTracks((t) => ({ ...t, [id]: { loading: false, error: data.error ?? "Could not load this track.", info: null, download: null } }));
        return;
      }
      setTracks((t) => ({ ...t, [id]: { loading: false, error: null, info: data.video, download: null } }));
    } catch {
      setTracks((t) => ({ ...t, [id]: { loading: false, error: "Could not reach the downloader.", info: null, download: null } }));
    }
  }

  async function download(id: string, url: string, format: DownloadFormat) {
    const track = tracks[id];
    if (!track?.info) return;

    setTracks((t) => ({
      ...t,
      [id]: { ...t[id], download: { format, progress: { receivedBytes: 0, totalBytes: null, percent: 0 }, done: false, error: null } },
    }));

    try {
      await downloadWithProgress(
        { url, format, title: track.info.title },
        (progress) =>
          setTracks((t) => ({
            ...t,
            [id]: { ...t[id], download: { ...t[id].download!, progress } },
          }))
      );
      setTracks((t) => ({ ...t, [id]: { ...t[id], download: { ...t[id].download!, done: true } } }));
      onDownloaded(id, url, track.info!.title, track.info!.thumbnail, format);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed.";
      setTracks((t) => ({ ...t, [id]: { ...t[id], download: { ...t[id].download!, error: message } } }));
    }
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
                    <p className="playlist-status playlist-status-error">{track.error}</p>
                  ) : track?.info ? (
                    <div className="playlist-formats">
                      <button
                        type="button"
                        className="format-btn format-btn-audio"
                        onClick={() => download(entry.id, entry.url, "mp3")}
                        disabled={!!track.download && !track.download.done && !track.download.error}
                      >
                        <span className="format-label">MP3</span>
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => download(entry.id, entry.url, "mp4")}
                        disabled={!!track.download && !track.download.done && !track.download.error}
                      >
                        <span className="format-label">MP4</span>
                      </button>
                      {track.download ? (
                        <span className="dl-status">
                          {track.download.error
                            ? `Failed — ${track.download.error}`
                            : track.download.done
                              ? "Saved"
                              : track.download.progress.percent !== null
                                ? `${Math.floor(track.download.progress.percent)}%`
                                : "Downloading…"}
                        </span>
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
