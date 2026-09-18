import { useEffect, useRef, useState } from "react";
import {
  convertToMp3,
  fileSize,
  formatBytes,
  formatDuration,
  onDownloadProgress,
  pickMediaFiles,
  revealFile,
  saveACopy,
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
///
/// A row is not "a source file" — it is one slot in the list, which starts out
/// holding the file you picked and afterwards holds the MP3 that replaced it.
/// That is the whole point of the tab: you put a file in, and the MP3 is what
/// comes back out. Keeping the original visible next to its own output would
/// leave the user to work out which of the two rows is the one they wanted.
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
  /// True while the save dialog is open for this row.
  saving: boolean;
  /// Where the user last saved a copy, so the row can confirm it.
  savedTo: string | null;
  /// Set once the MP3 exists. From here on the row shows the MP3's name and
  /// size, and the original is remembered only so a failed save can still say
  /// what it came from.
  converted: ConvertedInfo | null;
}

/// What the row shows after the conversion — the MP3, not the source.
interface ConvertedInfo {
  path: string;
  name: string;
  sizeBytes: number | null;
}

/// The name to show for a converted file, taken from the path it was actually
/// written to.
///
/// Deliberately not computed from the source name. The obvious version of this
/// — swap the extension for ".mp3" — is right until it is not: converting an
/// MP3 cannot overwrite its own source, so the backend writes "song (2).mp3",
/// and if *that* name is taken too it writes "(3)". A predicted name would
/// then label a row with a file that is not the one behind it, and the Show
/// button would open a different file than the row claims to be.
///
/// The backend already returns the real path. Reading the name off it cannot
/// disagree with what is on disk.
function mp3NameFor(outputPath: string): string {
  const cut = Math.max(outputPath.lastIndexOf("\\"), outputPath.lastIndexOf("/"));
  const name = cut >= 0 ? outputPath.slice(cut + 1) : outputPath;
  // A path that somehow ends in a separator would leave nothing to show; the
  // whole path is a poor label but an honest one.
  return name || outputPath;
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
    saving: false,
    savedTo: null,
    converted: null,
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

      // The row stops being the source file here and becomes the MP3. Both
      // its name and its size come from the file that was actually written,
      // never from a prediction about it: a row that names a file it does not
      // point at is the one kind of wrong nobody would think to check.
      const mp3Name = mp3NameFor(outputPath);
      const mp3Size = await fileSize(outputPath).catch(() => null);

      patch(row.path, {
        running: false,
        done: true,
        percent: 100,
        stage: "Done",
        outputPath,
        converted: { path: outputPath, name: mp3Name, sizeBytes: mp3Size },
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

  /// Saves a finished MP3 somewhere the user chooses. The file already exists
  /// beside the original, so this is a copy — cancelling leaves everything as
  /// it was, which is why a closed dialog is not treated as an error.
  async function download(row: Row) {
    if (!row.converted) return;
    patch(row.path, { saving: true, error: null });
    try {
      const saved = await saveACopy(row.converted.path, row.converted.name);
      patch(row.path, { saving: false, savedTo: saved ?? null });
    } catch (err) {
      patch(row.path, {
        saving: false,
        error: typeof err === "string" ? err : "Couldn't save that file.",
      });
    }
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
          Pick any audio or video file and press Convert. The file in the list
          turns into the MP3, ready to download wherever you want it. Nothing is
          uploaded — the conversion runs on this computer.
        </p>
      ) : (
        <ul className="convert-list">
          {rows.map((row) => (
            <li className="convert-item" key={row.path}>
              {/* Once converted the row *is* the MP3: it shows the MP3's
                  name and size, not the source file's. The original is gone
                  from the list because it is no longer the thing on offer. */}
              <div className="convert-meta">
                <span
                  className="convert-name"
                  title={row.converted ? row.converted.path : row.path}
                >
                  {row.converted ? row.converted.name : row.name}
                </span>
                <span className="convert-sub">
                  {row.unreadable
                    ? row.unreadable
                    : !row.hasAudio
                      ? "No sound in this file"
                      : row.converted
                        ? [
                            "MP3",
                            row.duration !== null
                              ? formatDuration(row.duration)
                              : null,
                            row.converted.sizeBytes !== null
                              ? formatBytes(row.converted.sizeBytes)
                              : null,
                            row.savedTo ? "Saved" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
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
                    {/* No progress bar on a finished row: the bar answered
                        "how far along", and that question is closed. What is
                        live now is the MP3 and what can be done with it. */}
                    <button
                      type="button"
                      className="convert-download-btn"
                      onClick={() => download(row)}
                      disabled={row.saving}
                    >
                      {row.saving ? "Saving…" : "Download"}
                    </button>
                    {row.outputPath ? (
                      <button
                        type="button"
                        className="dl-ctrl-btn"
                        onClick={() => revealFile(row.savedTo ?? row.outputPath!)}
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
