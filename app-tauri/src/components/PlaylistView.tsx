import { useEffect, useRef, useState } from "react";
import {
  fetchInfo,
  formatDuration,
  onDownloadProgress,
  pickFolder,
  startDownload,
  stopDownload,
  type DownloadFormat,
  type DownloadProgress,
  type Platform,
  type PlaylistInfo,
  type VideoInfo,
} from "@/lib/api";

/** Progress of a "download the whole thing" run. */
interface BulkState {
  format: DownloadFormat;
  dir: string;
  /** Index of the track being fetched or downloaded right now. */
  index: number;
  total: number;
  done: number;
  failed: { title: string; reason: string }[];
  /** Set when the user asks to stop; checked between tracks. */
  cancelled: boolean;
  finished: boolean;
}

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
  const [bulk, setBulk] = useState<BulkState | null>(null);

  // The queue loop reads this to decide whether to keep going. State alone
  // would not work: the loop captures the value from the render it started in,
  // so pressing Stop would not be seen until the next track had already begun.
  const cancelRef = useRef(false);
  // Lets Stop kill the transfer that is running right now, not just prevent
  // the next one.
  const activeIdRef = useRef<string | null>(null);
  // Survives unmount: navigating away mid-run must not leave a queue running
  // against a component that no longer exists.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  /**
   * Downloads every track in order, into one folder chosen up front.
   *
   * Sequential on purpose. Running these in parallel would open a dozen
   * connections to the same host, which is the fastest way to get the address
   * rate-limited — and a rate-limited mix fails *every* remaining track rather
   * than one.
   */
  async function downloadAll(format: DownloadFormat) {
    const dir = await pickFolder();
    // Closing the folder dialog means "no", so nothing starts.
    if (!dir) return;

    cancelRef.current = false;
    const entries = playlist.entries;
    setBulk({
      format,
      dir,
      index: 0,
      total: entries.length,
      done: 0,
      failed: [],
      cancelled: false,
      finished: false,
    });

    for (let i = 0; i < entries.length; i++) {
      if (cancelRef.current || !aliveRef.current) break;
      const entry = entries[i];
      setBulk((b) => (b ? { ...b, index: i } : b));

      try {
        // Each track's real URL has to be resolved anyway; --flat-playlist
        // only gives ids and titles.
        const data = await fetchInfo(entry.url, "link");
        if (cancelRef.current || !aliveRef.current) break;
        if (data.kind !== "video") {
          throw "Could not load this track.";
        }

        const downloadId = crypto.randomUUID();
        activeIdRef.current = downloadId;
        const unsubscribe = onDownloadProgress(downloadId, (progress) =>
          setTracks((t) => ({
            ...t,
            [entry.id]: {
              ...(t[entry.id] ?? {
                loading: false,
                error: null,
                info: data.video,
                download: null,
              }),
              download: {
                id: downloadId,
                format,
                progress,
                done: false,
                error: null,
              },
            },
          }))
        );

        try {
          await startDownload({
            id: downloadId,
            url: entry.url,
            format,
            title: data.video.title,
            intoDir: dir,
          });
          setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
          setTracks((t) => ({
            ...t,
            [entry.id]: {
              ...t[entry.id],
              download: { ...t[entry.id]!.download!, done: true },
            },
          }));
          onDownloaded(
            entry.id,
            entry.url,
            data.video.title,
            data.video.thumbnail,
            format,
            data.video.platform
          );
        } finally {
          unsubscribe();
          activeIdRef.current = null;
        }
      } catch (err) {
        const reason = typeof err === "string" ? err : "Download failed.";
        // Stopping the current track stops the run; it is the same button.
        if (reason === "Download stopped") {
          cancelRef.current = true;
          break;
        }
        // One bad track must not end the mix — it is recorded and the queue
        // moves on, which is the whole point of an unattended download.
        setBulk((b) =>
          b
            ? { ...b, failed: [...b.failed, { title: entry.title, reason }] }
            : b
        );
        setTracks((t) => ({
          ...t,
          [entry.id]: {
            loading: false,
            error: null,
            info: t[entry.id]?.info ?? null,
            download: {
              id: "",
              format,
              progress: { percent: 0, stage: "" },
              done: false,
              error: reason,
            },
          },
        }));
      }
    }

    if (aliveRef.current) {
      setBulk((b) =>
        b ? { ...b, finished: true, cancelled: cancelRef.current } : b
      );
    }
  }

  function stopAll() {
    cancelRef.current = true;
    if (activeIdRef.current) stopDownload(activeIdRef.current);
    setBulk((b) => (b ? { ...b, cancelled: true } : b));
  }

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

  const running = !!bulk && !bulk.finished;

  return (
    <div className="playlist-view">
      <div className="playlist-head">
        <h2 className="playlist-title">{playlist.title}</h2>
        <span className="playlist-count">{playlist.entries.length} tracks</span>
      </div>

      {running ? (
        <div className="bulk-bar">
          <div className="bulk-line">
            <span className="bulk-text">
              Downloading {bulk!.index + 1} of {bulk!.total} as{" "}
              {bulk!.format.toUpperCase()}
            </span>
            <button type="button" className="dl-ctrl-btn dl-ctrl-btn-stop" onClick={stopAll}>
              Stop
            </button>
          </div>
          <div className="bulk-track">{playlist.entries[bulk!.index]?.title}</div>
          <div className="bulk-meter">
            <div
              className="bulk-meter-fill"
              style={{ width: `${(bulk!.index / bulk!.total) * 100}%` }}
            />
          </div>
        </div>
      ) : bulk?.finished ? (
        <div className="bulk-bar">
          <div className="bulk-line">
            <span className="bulk-text">
              {bulk.cancelled ? "Stopped" : "Finished"} — {bulk.done} of{" "}
              {bulk.total} saved
              {bulk.failed.length > 0 ? `, ${bulk.failed.length} failed` : ""}
            </span>
            <button
              type="button"
              className="dl-ctrl-btn"
              onClick={() => setBulk(null)}
            >
              Dismiss
            </button>
          </div>
          {bulk.failed.length > 0 ? (
            <ul className="bulk-failed">
              {bulk.failed.map((f, i) => (
                <li key={i}>
                  <span className="bulk-failed-title">{f.title}</span> — {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="bulk-actions">
          <span className="bulk-actions-label">Download everything</span>
          <button
            type="button"
            className="format-btn format-btn-audio"
            onClick={() => downloadAll("mp3")}
          >
            <span className="format-label">All as MP3</span>
          </button>
          <button
            type="button"
            className="format-btn"
            onClick={() => downloadAll("mp4")}
          >
            <span className="format-label">All as MP4</span>
          </button>
          <span className="bulk-actions-note">Asks once where to save.</span>
        </div>
      )}
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
                        disabled={busy || running}
                      >
                        <span className="format-label">MP3</span>
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => download(entry.id, entry.url, "mp4")}
                        disabled={busy || running}
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
