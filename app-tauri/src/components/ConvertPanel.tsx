import { useEffect, useRef, useState } from "react";
import {
  convertFile,
  fileSize,
  formatBytes,
  formatDuration,
  onDownloadProgress,
  pickMediaFiles,
  probeFiles,
  revealFile,
  saveACopy,
  stopDownload,
  type ConvertTarget,
  type PickedFile,
  type SourceInfo,
} from "@/lib/api";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { StopGlyph } from "@/components/DownloadRow";

/// The converter: files already on the user's disk, no network involved.
///
/// Every other tab starts from a link and ends with a save dialog. This one is
/// the mirror image — the file is already theirs, and the result belongs
/// beside it. So there is no dialog per file: a converter that asks twenty
/// times to convert twenty files is a converter people use once.
///
/// The list is the whole interface. Each row carries its own state, so one
/// file failing never stops the rest, and a row that failed says why on the
/// row rather than in a banner that could belong to any of them.
///
/// Two targets, one switch. The switch sits above the list rather than on each
/// row because the reason someone opens this tab is to turn a pile of files
/// into one thing — picking audio-or-video once is the choice they actually
/// meant to make, and the same reasoning the page-scan list follows.

/// What a row is currently set to become.
/// The two outputs, described by what you get rather than by codec: the
/// question someone on this screen has is "which one do I want".
const TARGETS: { id: ConvertTarget; label: string; hint: string }[] = [
  { id: "mp3", label: "MP3", hint: "Audio only — the sound from any audio or video file" },
  { id: "mp4", label: "MP4", hint: "Video that plays anywhere — audio files get a still picture" },
];

/// One file in the list, with whatever has happened to it so far.
///
/// A row is not "a source file" — it is one slot in the list, which starts out
/// holding the file you picked and afterwards holds the file that replaced it.
/// That is the whole point of the tab: you put a file in, and the converted
/// one is what comes back out. Keeping the original visible next to its own
/// output would leave the user to work out which of the two rows is the one
/// they wanted.
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
  /// True when there is a picture in the file. Only ever descriptive — a
  /// soundless file cannot become an MP3, but a pictureless one becomes a
  /// perfectly good MP4.
  hasVideo: boolean;
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
  /// Set once the converted file exists. From here on the row shows that
  /// file's name and size, and the original is remembered only so a failed
  /// save can still say what it came from.
  converted: ConvertedInfo | null;
}

/// What the row shows after the conversion — the new file, not the source.
interface ConvertedInfo {
  path: string;
  name: string;
  sizeBytes: number | null;
  /// What it was converted to. Stored per row rather than read from the
  /// panel's switch: flipping the switch after converting five files must not
  /// relabel those five rows as something they are not.
  target: ConvertTarget;
}

/// The name to show for a converted file, taken from the path it was actually
/// written to.
///
/// Deliberately not computed from the source name. The obvious version of this
/// — swap the extension — is right until it is not: converting an MP4 to MP4
/// cannot overwrite its own source, so the backend writes "clip (2).mp4", and
/// if *that* name is taken too it writes "(3)". A predicted name would then
/// label a row with a file that is not the one behind it, and the Show button
/// would open a different file than the row claims to be.
///
/// The backend already returns the real path. Reading the name off it cannot
/// disagree with what is on disk.
function convertedNameFor(outputPath: string): string {
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
    hasVideo: info.hasVideo,
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
      hasVideo: false,
    }),
    unreadable: reason,
  };
}

/// Whether this row can produce the chosen target at all.
///
/// The only real restriction is sound: no audio means no MP3, because the
/// result would be a valid, empty, useless file. There is deliberately no
/// matching rule for video — an MP3 turned into an MP4 is a black-screen
/// video, which is exactly what someone facing an upload form that only takes
/// video is after.
function canProduce(row: Row, target: ConvertTarget): boolean {
  if (row.unreadable) return false;
  return target === "mp3" ? row.hasAudio : true;
}

/// Why a row cannot be converted to the chosen target, in the user's terms.
/// Null when there is nothing wrong with it.
function refusal(row: Row, target: ConvertTarget): string | null {
  if (row.unreadable) return row.unreadable;
  if (target === "mp3" && !row.hasAudio) return "No sound in this file";
  return null;
}

/// True when a row is ready to be converted — able to produce the target and
/// not already done. Stopped and failed rows count as ready again, since
/// retrying is the obvious next thing to want.
function isConvertible(row: Row, target: ConvertTarget): boolean {
  return canProduce(row, target) && !row.done && !row.running;
}

interface ConvertPanelProps {
  /// Raised whenever a conversion starts or finishes, so the app can block tab
  /// switching while work is in flight — the same rule downloads follow.
  onBusyChange: (busy: boolean) => void;
}

export default function ConvertPanel({ onBusyChange }: ConvertPanelProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState<ConvertTarget>("mp3");
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  // Convert-all walks the list one file at a time; this lets the loop see
  // stops and removals that happened after it started, without restarting the
  // effect on every progress tick.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Same reason: the loop reads the target it started with rather than closing
  // over a stale one.
  const targetRef = useRef(target);
  targetRef.current = target;

  const busy = rows.some((r) => r.running);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const pending = rows.filter((r) => isConvertible(r, target));
  const converted = rows.filter((r) => r.done).length;

  function patch(path: string, next: Partial<Row>) {
    setRows((list) =>
      list.map((r) => (r.path === path ? { ...r, ...next } : r))
    );
  }

  /// Switching target clears what was already converted *as state*, not as
  /// files: the MP3s stay on disk, but a row still showing "Download" for an
  /// MP3 while the switch reads MP4 is a row lying about what pressing it
  /// gives you. Resetting to the source is honest, and re-converting is one
  /// press away.
  function changeTarget(next: ConvertTarget) {
    if (next === target || busy) return;
    setTarget(next);
    setRows((list) =>
      list.map((r) =>
        r.done || r.error || r.stopped
          ? {
              ...r,
              id: null,
              percent: 0,
              stage: "Waiting",
              done: false,
              outputPath: null,
              error: null,
              stopped: false,
              saving: false,
              savedTo: null,
              converted: null,
            }
          : r
      )
    );
  }

  /// Adds probed files to the list, skipping ones already in it.
  function addPicked(picked: PickedFile[]) {
    if (picked.length === 0) return;
    setRows((list) => {
        const seen = new Set(list.map((r) => r.path));
        const added: Row[] = [];
        for (const file of picked) {
          const path = file.kind === "ok" ? file.info.path : file.path;
          // Re-picking a file that is already listed is a no-op rather than a
          // duplicate row: the list is keyed by path, and two rows for one
          // file would race each other writing the same output.
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
  }

  async function addFiles() {
    setPickError(null);
    setPicking(true);
    try {
      addPicked(await pickMediaFiles());
    } catch (err) {
      setPickError(typeof err === "string" ? err : "Could not open the file picker.");
    } finally {
      setPicking(false);
    }
  }

  // Files dropped anywhere on the window while this tab is open. The window
  // hands over paths, not file contents, so they are probed in Rust exactly
  // like picked ones.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const e = event.payload;
        if (e.type === "enter" || e.type === "over") {
          setDragging(true);
        } else if (e.type === "leave") {
          setDragging(false);
        } else if (e.type === "drop") {
          setDragging(false);
          if (e.paths.length === 0) return;
          setPickError(null);
          setPicking(true);
          try {
            addPicked(await probeFiles(e.paths));
          } catch (err) {
            setPickError(typeof err === "string" ? err : "Could not read those files.");
          } finally {
            setPicking(false);
          }
        }
      })
      .then((fn) => {
        if (gone) fn();
        else stop = fn;
      })
      .catch(() => {});
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  /// Converts one row. Resolves when it is finished either way, so the
  /// convert-all loop can await it and keep the queue sequential — running
  /// several ffmpeg processes at once would just make them contend for the
  /// same CPU and finish no sooner. That matters more for video, where a
  /// single encode already uses every core it can get.
  async function convertRow(row: Row, to: ConvertTarget): Promise<void> {
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
      const outputPath = await convertFile({
        id,
        path: row.path,
        target: to,
        duration: row.duration,
      });

      // The row stops being the source file here and becomes the output. Both
      // its name and its size come from the file that was actually written,
      // never from a prediction about it: a row that names a file it does not
      // point at is the one kind of wrong nobody would think to check.
      const outName = convertedNameFor(outputPath);
      const outSize = await fileSize(outputPath).catch(() => null);

      patch(row.path, {
        running: false,
        done: true,
        percent: 100,
        stage: "Done",
        outputPath,
        converted: {
          path: outputPath,
          name: outName,
          sizeBytes: outSize,
          target: to,
        },
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
    // The target is read once, up front. Flipping the switch mid-queue must
    // not leave half the list as MP3s and half as MP4s with no way to tell
    // which is which — and the switch is disabled while the queue runs anyway.
    const to = targetRef.current;

    // Snapshot the queue, then re-check each row against current state before
    // starting it: a file removed or already converted while the queue was
    // running must not be picked up.
    for (const queued of rowsRef.current.filter((r) => isConvertible(r, to))) {
      const current = rowsRef.current.find((r) => r.path === queued.path);
      if (!current || !isConvertible(current, to)) continue;
      await convertRow(current, to);
    }
  }

  function stopRow(row: Row) {
    if (row.id) stopDownload(row.id);
  }

  /// Saves a finished file somewhere the user chooses. It already exists
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
      {/* 1. What the files become. Chosen first, because it decides what
          the list below can do — an MP3 needs sound in the file. Disabled
          mid-queue rather than hidden, so it still says which one is in
          use. */}
      <div className="convert-step">
        <span className="convert-step-label">Convert to</span>
        <div className="convert-targets" role="radiogroup" aria-label="Convert files to">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={target === t.id}
              className={`convert-option${target === t.id ? " is-on" : ""}`}
              onClick={() => changeTarget(t.id)}
              disabled={busy}
            >
              <span className="convert-option-name">{t.label}</span>
              <span className="convert-option-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. The files. The whole box takes a drop, and says so; the button
          is for anyone who would rather browse. Once files are listed it
          shrinks to one line, since its explaining is done. */}
      <div
        className={`convert-drop${dragging ? " is-over" : ""}${rows.length > 0 ? " is-compact" : ""}`}
      >
        <DropGlyph />
        <div className="convert-drop-text">
          <span className="convert-drop-title">
            {dragging
              ? "Drop to add them"
              : rows.length > 0
                ? "Drop more files here"
                : "Drop audio or video files here"}
          </span>
          {rows.length === 0 ? (
            <span className="convert-drop-hint">
              Any format ffmpeg can read. Converted files are saved next to the
              originals, and nothing is uploaded — it all runs on this computer.
            </span>
          ) : null}
        </div>
        <button type="button" className="btn" onClick={addFiles} disabled={picking}>
          {picking ? (
            <>
              <span className="submit-spinner" aria-hidden="true" />
              Reading…
            </>
          ) : rows.length > 0 ? (
            "Add files"
          ) : (
            "Choose files"
          )}
        </button>
      </div>

      {pickError ? <p className="error-text">{pickError}</p> : null}

      {rows.length === 0 ? null : (
        <ul className="convert-list">
          {rows.map((row) => {
            const why = refusal(row, target);
            return (
              <li className="convert-item" key={row.path}>
                {/* Once converted the row *is* the new file: it shows that
                    file's name and size, not the source's. The original is
                    gone from the list because it is no longer what is on
                    offer. */}
                <div className="convert-meta">
                  <span
                    className="convert-name"
                    title={row.converted ? row.converted.path : row.path}
                  >
                    {row.converted ? row.converted.name : row.name}
                  </span>
                  <span className="convert-sub">
                    {why
                      ? why
                      : row.converted
                        ? [
                            row.converted.target.toUpperCase(),
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
                            // Only worth saying when it changes what the
                            // output will be: a soundless file becoming an
                            // MP4 is fine, but the result is a silent video
                            // and nobody should find that out afterwards.
                            target === "mp4" && !row.hasAudio
                              ? "No sound — the video will be silent"
                              : null,
                            target === "mp4" && !row.hasVideo
                              ? "No picture — you'll get a black screen with the sound"
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
                          live now is the file and what can be done with it. */}
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
                      {/* The same bar and cancel control as a download row,
                          so a conversion reads as the same kind of work. */}
                      <div className="convert-progress">
                        <div
                          className={`dlrow-track${row.percent > 0 ? "" : " is-waiting"}`}
                        >
                          <div className="dlrow-fill" style={{ width: `${row.percent}%` }} />
                        </div>
                        <span className="dlrow-meta">
                          {row.percent > 0
                            ? `${Math.floor(row.percent)}% · ${row.stage}`
                            : `${row.stage}…`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="dlrow-icon dlrow-cancel"
                        onClick={() => stopRow(row)}
                        aria-label={`Cancel ${row.name}`}
                        title="Cancel"
                      >
                        <StopGlyph />
                      </button>
                    </>
                  ) : row.error ? (
                    <>
                      <span className="dl-status dl-status-error">{row.error}</span>
                      <button
                        type="button"
                        className="dl-ctrl-btn"
                        onClick={() => convertRow(row, target)}
                        disabled={busy}
                      >
                        Try again
                      </button>
                    </>
                  ) : row.stopped ? (
                    <>
                      <span className="dl-status">Cancelled</span>
                      <button
                        type="button"
                        className="dl-ctrl-btn"
                        onClick={() => convertRow(row, target)}
                        disabled={busy}
                      >
                        Try again
                      </button>
                    </>
                  ) : why ? null : (
                    <button
                      type="button"
                      className="dl-ctrl-btn"
                      onClick={() => convertRow(row, target)}
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
            );
          })}
        </ul>
      )}

      {/* 3. Go. Sits under the list it acts on, and names both how many
          files and what they become, so the button is its own summary. */}
      {rows.length > 0 ? (
        <div className="convert-footer">
          {converted > 0 && !busy ? (
            <button type="button" className="history-clear" onClick={clearFinished}>
              Clear finished
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="submit-btn"
            onClick={convertAll}
            disabled={busy || pending.length === 0}
          >
            {busy
              ? "Converting…"
              : pending.length > 0
                ? `Convert ${pending.length} file${pending.length > 1 ? "s" : ""} to ${target.toUpperCase()}`
                : "All converted"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function DropGlyph() {
  return (
    <svg className="convert-drop-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 3.5v11M7.5 10 12 14.5 16.5 10M4.5 15.5v2.2c0 1.3 1 2.3 2.3 2.3h10.4c1.3 0 2.3-1 2.3-2.3v-2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
