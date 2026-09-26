import { useEffect, useRef, useState } from "react";
import {
  fetchInfo,
  formatDuration,
  onDownloadProgress,
  downloadFolder,
  startDownload,
  stopDownload,
  type DownloadFormat,
  type DownloadProgress,
  type Platform,
  type PlaylistInfo,
  type VideoInfo,
} from "@/lib/api";
import DownloadRow, { type RowState } from "@/components/DownloadRow";

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
  /** Where it was saved, once it was. */
  filePath: string | null;
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
  /** Raised while anything here is downloading, so the app keeps this screen
   *  (and its Stop buttons) up until it is done. */
  onBusyChange: (busy: boolean) => void;
}

// Each track only fetches its own real info (formats, thumbnail) the moment
// the user expands it — the playlist itself loads instantly via
// --flat-playlist, so opening a 200-track playlist doesn't mean waiting on
// 200 yt-dlp calls up front.
export default function PlaylistView({
  playlist,
  onDownloaded,
  onBusyChange,
}: PlaylistViewProps) {
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
      // The queue stops between tracks, but the track in flight would carry
      // on with nothing left on screen to stop it.
      if (activeIdRef.current) stopDownload(activeIdRef.current);
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
    // The download folder, asked for only if nothing has been downloaded yet.
    // Closing that dialog means "no", so nothing starts.
    let dir: string | null;
    try {
      dir = await downloadFolder();
    } catch {
      return;
    }
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
                filePath: null,
              },
            },
          }))
        );

        try {
          const filePath = await startDownload({
            id: downloadId,
            url: entry.url,
            format,
            title: data.video.title,
            intoDir: dir,
          });
          setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
          // Built from scratch rather than spread from the row: when no
          // progress event had arrived yet the row did not exist, and
          // spreading it threw, turning a saved track into a "failed" one.
          setTracks((t) => ({
            ...t,
            [entry.id]: {
              loading: false,
              error: null,
              info: t[entry.id]?.info ?? data.video,
              download: {
                id: downloadId,
                format,
                progress: { percent: 100, stage: "Saved" },
                done: true,
                error: null,
                filePath,
              },
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
              filePath: null,
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
          filePath: null,
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
      const filePath = await startDownload({
        id: downloadId,
        url,
        format,
        title: track.info.title,
      });
      setTracks((t) => ({
        ...t,
        [id]: { ...t[id], download: { ...t[id].download!, done: true, filePath } },
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

  /// A track's row for one format. Only the format that was last started
  /// carries a state; the other stays a plain option.
  function rowState(dl: TrackDownload | null, format: DownloadFormat): RowState {
    if (!dl || dl.format !== format) return { at: "idle" };
    if (dl.error === "Download stopped") return { at: "cancelled" };
    if (dl.error === "Save cancelled") return { at: "idle" };
    if (dl.error) return { at: "failed", error: dl.error };
    if (dl.done) return { at: "done", filePath: dl.filePath };
    return { at: "running", progress: dl.progress };
  }

  const running = !!bulk && !bulk.finished;
  const anyTrackBusy = Object.values(tracks).some(
    (t) => !!t.download && !t.download.done && !t.download.error
  );
  const busy = running || anyTrackBusy;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

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
          <span className="bulk-actions-note">Saves to your download folder.</span>
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
                    <div className="dllist playlist-formats">
                      {(["mp3", "mp4"] as const).map((f) => (
                        <DownloadRow
                          key={f}
                          label={f === "mp3" ? "MP3" : "MP4"}
                          tags={f === "mp3" ? ["192 kbps"] : ["Best"]}
                          state={rowState(track.download, f)}
                          onStart={() => download(entry.id, entry.url, f)}
                          onCancel={() => track.download && stopDownload(track.download.id)}
                          locked={(busy && track.download?.format !== f) || running}
                        />
                      ))}
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
