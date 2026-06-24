"use client";

import { useEffect, useState } from "react";
import type { PlaylistInfo, VideoInfo } from "@/lib/ytdlp";
import {
  downloadWithProgress,
  type DownloadFormat,
  type DownloadProgress,
} from "@/lib/download";
import {
  addHistory,
  clearHistory,
  loadHistory,
  removeHistory,
  type HistoryItem,
} from "@/lib/history";
import ResultCard from "./ResultCard";
import HistoryList from "./HistoryList";
import PlaylistView from "./PlaylistView";

type InfoResponse =
  | { kind: "video"; video: VideoInfo }
  | { kind: "playlist"; playlist: PlaylistInfo };

// A single in-flight or finished download, keyed so the UI can show a progress
// bar per format button without them interfering.
export interface ActiveDownload {
  key: string; // `${format}-${quality ?? "auto"}`
  format: DownloadFormat;
  quality?: number;
  progress: DownloadProgress;
  done: boolean;
  error: string | null;
}

export default function DownloadForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>({});
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    // localStorage isn't available during SSR, so we load history after mount
    // rather than in an initializer (keeps server/client markup in sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadHistory());
  }, []);

  async function fetchInfo(targetUrl: string) {
    const clean = targetUrl.trim();
    setError(null);
    setInfo(null);
    setPlaylist(null);
    setDownloads({});
    if (!clean) return;

    setLoading(true);
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: clean }),
      });
      const data: InfoResponse & { error?: string } = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      if (data.kind === "playlist") {
        setPlaylist(data.playlist);
      } else {
        setInfo(data.video);
      }
    } catch {
      setError("Could not reach the downloader. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchInfo(url);
  }

  async function startDownload(format: DownloadFormat, quality?: number) {
    if (!info) return;
    const key = `${format}-${quality ?? "auto"}`;

    setDownloads((d) => ({
      ...d,
      [key]: {
        key,
        format,
        quality,
        progress: { receivedBytes: 0, totalBytes: null, percent: 0 },
        done: false,
        error: null,
      },
    }));

    try {
      await downloadWithProgress(
        { url: url.trim(), format, quality, title: info.title },
        (progress) =>
          setDownloads((d) => ({
            ...d,
            [key]: { ...d[key], progress },
          }))
      );
      setDownloads((d) => ({ ...d, [key]: { ...d[key], done: true } }));
      const next = addHistory({
        videoId: info.id,
        url: url.trim(),
        title: info.title,
        thumbnail: info.thumbnail,
        format,
        quality,
      });
      setHistory(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed.";
      setDownloads((d) => ({ ...d, [key]: { ...d[key], error: message } }));
    }
  }

  function replayHistory(item: HistoryItem) {
    setUrl(item.url);
    // Re-fetch info so the preview and current format options are fresh, then
    // the user can download again from the card.
    fetchInfo(item.url);
  }

  function handlePlaylistTrackDownloaded(
    videoId: string,
    trackUrl: string,
    title: string,
    thumbnail: string,
    format: DownloadFormat
  ) {
    const next = addHistory({ videoId, url: trackUrl, title, thumbnail, format });
    setHistory(next);
  }

  return (
    <div className="app-shell">
      <form className="download-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Paste a YouTube/playlist link, or describe what you want…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="url-input"
          autoFocus
          spellCheck={false}
        />
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? "Fetching…" : "Fetch"}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      {info ? (
        <ResultCard
          info={info}
          downloads={downloads}
          onDownload={startDownload}
        />
      ) : null}

      {playlist ? (
        <PlaylistView playlist={playlist} onDownloaded={handlePlaylistTrackDownloaded} />
      ) : null}

      <HistoryList
        history={history}
        onReplay={replayHistory}
        onRemove={(id) => setHistory(removeHistory(id))}
        onClear={() => setHistory(clearHistory())}
      />
    </div>
  );
}
