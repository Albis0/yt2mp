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

type Mode = "link" | "ai";

// AI mode chains a Groq call (rewriting the request, with up to 5 key
// retries) and then a yt-dlp search — that's a genuinely multi-step,
// multi-second wait, so the button walks through what's actually happening
// instead of sitting on one static word the whole time.
const AI_LOADING_PHRASES = [
  "Reading your request…",
  "Asking AI to turn it into a search…",
  "Still waiting on AI (retrying a key)…",
  "Searching YouTube for a match…",
];

export default function DownloadForm() {
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>({});
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  useEffect(() => {
    // localStorage isn't available during SSR, so we load history after mount
    // rather than in an initializer (keeps server/client markup in sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadHistory());
  }, []);

  async function fetchInfo(targetUrl: string, targetMode: Mode) {
    const clean = targetUrl.trim();
    setError(null);
    setInfo(null);
    setPlaylist(null);
    setDownloads({});
    if (!clean) return;

    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);
    setLoadingPhrase(0);

    // AI mode genuinely takes longer (Groq, then yt-dlp's search) — step the
    // phrase forward so the button visibly progresses instead of sitting on
    // one word for the whole wait.
    const phraseTimer =
      targetMode === "ai"
        ? setInterval(() => {
            setLoadingPhrase((p) => Math.min(p + 1, AI_LOADING_PHRASES.length - 1));
          }, 2500)
        : null;

    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: clean, mode: targetMode }),
        signal: controller.signal,
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
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Cancelled.");
      } else {
        setError("Could not reach the downloader. Try again.");
      }
    } finally {
      if (phraseTimer) clearInterval(phraseTimer);
      setLoading(false);
      setAbortController(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchInfo(url, mode);
  }

  function cancelFetch() {
    abortController?.abort();
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setUrl("");
    setError(null);
    setInfo(null);
    setPlaylist(null);
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
    // History always stores resolved YouTube URLs, regardless of which mode
    // found them, so replaying always goes through link mode.
    setMode("link");
    setUrl(item.url);
    fetchInfo(item.url, "link");
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
    <div className={`app-shell mode-${mode}`}>
      <div className="mode-switch" role="tablist" aria-label="Search mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "link"}
          className={`mode-btn mode-btn-link${mode === "link" ? " mode-btn-active" : ""}`}
          onClick={() => switchMode("link")}
        >
          YouTube link
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ai"}
          className={`mode-btn mode-btn-ai${mode === "ai" ? " mode-btn-active" : ""}`}
          onClick={() => switchMode("ai")}
        >
          AI search
        </button>
      </div>

      <form className="download-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder={
            mode === "ai"
              ? "Describe the song or video you want…"
              : "Paste a YouTube or playlist link…"
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="url-input"
          autoFocus
          spellCheck={false}
        />
        <button type="submit" className={`submit-btn${loading ? " submit-btn-loading" : ""}`} disabled={loading}>
          {loading ? (
            <>
              <span className="submit-spinner" aria-hidden="true" />
              {mode === "ai" ? AI_LOADING_PHRASES[loadingPhrase] : "Fetching…"}
            </>
          ) : (
            "Fetch"
          )}
        </button>
        {loading ? (
          <button type="button" className="cancel-btn" onClick={cancelFetch}>
            Cancel
          </button>
        ) : null}
      </form>

      {error ? (
        <p className={error === "Cancelled." ? "cancel-text" : "error-text"}>{error}</p>
      ) : null}

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
