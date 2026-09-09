import { useEffect, useRef, useState } from "react";
import {
  convertToMp3,
  formatBytes,
  formatDuration,
  onDownloadProgress,
  pickMediaFiles,
  revealFile,
  stopDownload,
  type SourceInfo,
} from "@/lib/api";

/// The MP3 converter: files already on the user's disk, no network involved.
///
/// Every other tab starts from a link and ends with a save dialog. This one is
/// the mirror image — the file is already theirs, and the MP3 belongs beside
/// it. So there is no dialog per file: a converter that asks twenty times to
/// convert twenty files is a converter people use once.
///
/// The list is the whole interface. Each row carries its own state, so one
/// file failing never stops the rest, and a row that failed says why on the
/// row rather than in a banner that could belong to any of them.

/// One file in the list, with whatever has happened to it so far.
interface Row {
  /// Absolute path. Doubles as the row key — the same file cannot be queued
  /// twice, which is the behaviour people expect from a drop list.
  path: string;
  name: string;
  sizeBytes: number | null;
  duration: number | null;
  /// False when the file carries no audio. Kept in the list rather than
  /// dropped, so the user can see which of their files was refused and why.
  hasAudio: boolean;
  /// Set when the file could not be read at all — the reason is shown as-is.
  unreadable: string | null;
  /// Per-attempt id, needed so stop targets the right conversion.
  id: string | null;
  percent: number;
  stage: string;
  running: boolean;
  done: boolean;
  outputPath: string | null;
  error: string | null;
  stopped: boolean;
}

function rowFromSource(info: SourceInfo): Row {
  return {
    path: info.path,
    name: info.name,
    sizeBytes: info.sizeBytes,
    duration: info.duration,
    hasAudio: info.hasAudio,
    unreadable: null,
    id: null,
    percent: 0,
    stage: "Waiting",
    running: false,
    done: false,
    outputPath: null,
    error: null,
    stopped: false,
  };
}

/// A row for a file that could not be read. It still appears in the list:
/// picking five files and silently getting four rows is worse than a fifth row
/// saying what was wrong.
function rowFromBad(path: string, name: string, reason: string): Row {
  return {
    ...rowFromSource({
      path,
      name,
      sizeBytes: null,
      duration: null,
      hasAudio: false,
    }),
    unreadable: reason,
  };
}

/// True when a row is ready to be converted — readable, has sound, and has not
/// already been done. Stopped and failed rows count as ready again, since
/// retrying is the obvious next thing to want.
function isConvertible(row: Row): boolean {
  return !row.unreadable && row.hasAudio && !row.done && !row.running;
}

interface ConvertPanelProps {
  /// Raised whenever a conversion starts or finishes, so the app can block tab
  /// switching while work is in flight — the same rule downloads follow.
  onBusyChange: (busy: boolean) => void;
}

export default function ConvertPanel({ onBusyChange }: ConvertPanelProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  // Convert-all walks the list one file at a time; this lets the loop see
  // stops and removals that happened after it started, without restarting the
  // effect on every progress tick.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const busy = rows.some((r) => r.running);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const pending = rows.filter(isConvertible);
  const converted = rows.filter((r) => r.done).length;

  function patch(path: string, next: Partial<Row>) {
    setRows((list) =>
      list.map((r) => (r.path === path ? { ...r, ...next } : r))
    );
  }

  async function addFiles() {
    setPickError(null);
    setPicking(true);
    try {
      const picked = await pickMediaFiles();
      if (picked.length === 0) return;

      setRows((list) => {
        const seen = new Set(list.map((r) => r.path));
        const added: Row[] = [];
        for (const file of picked) {
          const path = file.kind === "ok" ? file.info.path : file.path;
          // Re-picking a file that is already listed is a no-op rather than a
          // duplicate row: the list is keyed by path, and two rows for one
          // file would race each other writing the same MP3.
          if (seen.has(path)) continue;
          seen.add(path);
          added.push(
            file.kind === "ok"
              ? rowFromSource(file.info)
              : rowFromBad(file.path, file.name, file.reason)
          );
        }
        return [...list, ...added];
      });
    } catch (err) {
      setPickError(typeof err === "string" ? err : "Could not open the file picker.");
    } finally {
      setPicking(false);
    }
  }

  /// Converts one row. Resolves when it is finished either way, so the
  /// convert-all loop can await it and keep the queue sequential — running
  /// several ffmpeg processes at once would just make them contend for the
  /// same CPU and finish no sooner.
  async function convertRow(row: Row): Promise<void> {
    const id = crypto.randomUUID();
    patch(row.path, {
      id,
      running: true,
      percent: 0,
      stage: "Starting",
      error: null,
      stopped: false,
    });

    const unsubscribe = onDownloadProgress(id, (p) =>
      patch(row.path, { percent: p.percent, stage: p.stage })
    );

    try {
      const outputPath = await convertToMp3({
        id,
        path: row.path,
        duration: row.duration,
      });
      patch(row.path, {
        running: false,
        done: true,
        percent: 100,
        stage: "Done",
        outputPath,
      });
    } catch (err) {
      const message = typeof err === "string" ? err : "Conversion failed.";
      patch(row.path, {
        running: false,
        // Stop is a deliberate action, not a failure — the row says "Stopped"
        // and offers another go rather than showing red error text.
        stopped: message === "Conversion stopped",
        error: message === "Conversion stopped" ? null : message,
      });
    } finally {
      unsubscribe();
    }
  }

  async function convertAll() {
    // Snapshot the queue up front, then re-check each row against current
    // state before starting it: a file removed or already converted while the
    // queue was running must not be picked up.
    for (const queued of rowsRef.current.filter(isConvertible)) {
      const current = rowsRef.current.find((r) => r.path === queued.path);
      if (!current || !isConvertible(current)) continue;
      await convertRow(current);
    }
  }

  function stopRow(row: Row) {
    if (row.id) stopDownload(row.id);
  }

  function removeRow(path: string) {
    setRows((list) => list.filter((r) => r.path !== path));
  }

  function clearFinished() {
    setRows((list) => list.filter((r) => !r.done));
  }

  return (
    <section className="convert">
      <div className="convert-actions">
        <button
          type="button"
          className="submit-btn"
          onClick={addFiles}
          disabled={picking}
        >
          {picking ? (
            <>
              <span className="submit-spinner" aria-hidden="true" />
              Reading files…
            </>
          ) : (
            "Choose files"
          )}
        </button>

        {pending.length > 0 ? (
          <button
            type="button"
            className="convert-all-btn"
            onClick={convertAll}
            disabled={busy}
          >
            {busy
              ? "Converting…"
              : `Convert ${pending.length} file${pending.length > 1 ? "s" : ""}`}
          </button>
        ) : null}

        {converted > 0 && !busy ? (
          <button type="button" className="history-clear" onClick={clearFinished}>
            Clear finished
          </button>
        ) : null}
      </div>

      {pickError ? <p className="error-text">{pickError}</p> : null}

      {rows.length === 0 ? (
        <p className="convert-empty">
          Pick any audio or video file and it comes back as an MP3, saved next
          to the original. Nothing is uploaded — the conversion runs on this
          computer.
        </p>
      ) : (
        <ul className="convert-list">
          {rows.map((row) => (
            <li className="convert-item" key={row.path}>
              <div className="convert-meta">
                <span className="convert-name" title={row.path}>
                  {row.name}
                </span>
                <span className="convert-sub">
                  {row.unreadable
                    ? row.unreadable
                    : !row.hasAudio
                      ? "No sound in this file"
                      : [
                          row.duration !== null
                            ? formatDuration(row.duration)
                            : null,
                          row.sizeBytes !== null
                            ? formatBytes(row.sizeBytes)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                </span>
              </div>

              <div className="convert-state">
                {row.done ? (
                  <>
                    <div className="dl-track">
                      <div className="dl-fill dl-fill-done" />
                    </div>
                    <span className="dl-status">Saved</span>
                    {row.outputPath ? (
                      <button
                        type="button"
                        className="dl-ctrl-btn"
                        onClick={() => revealFile(row.outputPath!)}
                      >
                        Show
                      </button>
                    ) : null}
                  </>
                ) : row.running ? (
                  <>
                    <div className="dl-track">
                      <div
                        className="dl-fill"
                        style={{ width: `${row.percent}%` }}
                      />
                    </div>
                    <span className="dl-status">
                      {row.percent > 0 ? `${Math.floor(row.percent)}%` : row.stage}
                    </span>
                    <button
                      type="button"
                      className="dl-ctrl-btn dl-ctrl-btn-stop"
                      onClick={() => stopRow(row)}
                    >
                      Stop
                    </button>
                  </>
                ) : row.error ? (
                  <>
                    <span className="dl-status dl-status-error">{row.error}</span>
                    <button
                      type="button"
                      className="dl-ctrl-btn"
                      onClick={() => convertRow(row)}
                    >
                      Try again
                    </button>
                  </>
                ) : row.stopped ? (
                  <>
                    <span className="dl-status">Stopped</span>
                    <button
                      type="button"
                      className="dl-ctrl-btn"
                      onClick={() => convertRow(row)}
                    >
                      Restart
                    </button>
                  </>
                ) : row.unreadable || !row.hasAudio ? null : (
                  <button
                    type="button"
                    className="dl-ctrl-btn"
                    onClick={() => convertRow(row)}
                    disabled={busy}
                  >
                    Convert
                  </button>
                )}

                {/* Removing is always available except mid-conversion, where
                    it would leave a running ffmpeg with no row to stop it. */}
                {row.running ? null : (
                  <button
                    type="button"
                    className="convert-remove"
                    aria-label={`Remove ${row.name}`}
                    title="Remove from the list"
                    onClick={() => removeRow(row.path)}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
