import { useEffect, useRef, useState } from "react";
import {
  convertFile,
  discardConverted,
  fileSize,
  formatBytes,
  formatDuration,
  formatEta,
  onDownloadProgress,
  pickMediaFiles,
  probeFiles,
  revealFile,
  saveConverted,
  stopDownload,
  type ConvertOptions,
  type ConvertTarget,
  type FileKind,
  type PickedFile,
  type SourceInfo,
  type Transfer,
} from "@/lib/api";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { StopGlyph } from "@/components/DownloadRow";
import ErrorNote from "@/components/ErrorNote";
import ConvertSettings, { Select } from "@/components/ConvertSettings";
import {
  accepts,
  codecName,
  firstPick,
  formatHint,
  formatLabel,
  groupsFor,
  hintFor,
  natural,
} from "@/lib/formats";

/// The converter: any number of files in, each to the format picked for it,
/// one after another, then downloaded.
///
/// Files are converted one at a time, in the order they were added. Running
/// several ffmpeg processes at once would make them fight for the same
/// processor and finish no sooner. Files dropped while the queue is running
/// join the end of it.
///
/// A converted file waits in the app's own folder until Download is pressed,
/// so converting to three formats to compare them leaves behind only the one
/// that was kept.

type Status = "idle" | "queued" | "running" | "done" | "failed" | "stopped";

interface Row {
  key: string;
  path: string;
  name: string;
  /// Null when the file could not be read; `error` says why.
  info: SourceInfo | null;
  target: ConvertTarget | null;
  status: Status;
  runId: string | null;
  progress: { percent: number; stage: string; transfer?: Transfer } | null;
  result: { path: string; name: string; sizeBytes: number | null; target: ConvertTarget; savedTo: string | null } | null;
  error: string | null;
  saving: boolean;
}

const OPTIONS_KEY = "yt2mp.convert.options.v1";
const FORMAT_KEY = "yt2mp.convert.format.v1";

function loadOptions(): ConvertOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
    // Trimming is about one file, not a preference to keep for the next.
    return raw && typeof raw === "object" ? { ...raw, start: null, end: null } : {};
  } catch {
    return {};
  }
}

function loadFormat(): ConvertTarget | null {
  try {
    return (localStorage.getItem(FORMAT_KEY) as ConvertTarget | null) || null;
  } catch {
    return null;
  }
}

function newKey() {
  return crypto.randomUUID();
}

function describe(file: SourceInfo): string {
  const kind = file.kind === "video" ? "Video" : file.kind === "audio" ? "Audio" : "Image";
  const codecs = [codecName(file.kind === "audio" ? null : file.videoCodec), codecName(file.audioCodec)]
    .filter(Boolean)
    .join(" + ");
  return [
    kind,
    file.duration !== null && file.kind !== "image" ? formatDuration(file.duration) : null,
    file.width && file.height ? `${file.width}×${file.height}` : null,
    codecs || null,
    file.sizeBytes !== null ? formatBytes(file.sizeBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface ConvertPanelProps {
  /// Raised while anything is converting, so the app can block switching
  /// tabs, the same rule downloads follow.
  onBusyChange: (busy: boolean) => void;
}

export default function ConvertPanel({ onBusyChange }: ConvertPanelProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [format, setFormat] = useState<ConvertTarget | null>(loadFormat);
  const [options, setOptions] = useState<ConvertOptions>(loadOptions);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const formatRef = useRef(format);
  formatRef.current = format;
  const runnerRef = useRef(false);

  useEffect(() => {
    onBusyChange(running);
  }, [running, onBusyChange]);

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
      if (format) localStorage.setItem(FORMAT_KEY, format);
    } catch {
      // Remembering settings is a convenience.
    }
  }, [options, format]);

  function patch(key: string, change: Partial<Row>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  /// New files join the list. While the queue is running they join the
  /// queue too: dropping more files onto a running converter means "these
  /// as well".
  function add(picked: PickedFile[]) {
    const joinQueue = runnerRef.current;
    const fresh: Row[] = [];
    const known = new Set(rowsRef.current.filter((r) => r.status !== "done").map((r) => r.path));
    for (const file of picked) {
      const path = file.kind === "ok" ? file.info.path : file.path;
      if (known.has(path)) continue;
      known.add(path);
      if (file.kind === "bad") {
        fresh.push({
          key: newKey(), path, name: file.name, info: null, target: null, status: "failed",
          runId: null, progress: null, result: null, error: file.reason, saving: false,
        });
        continue;
      }
      const wanted = formatRef.current;
      const target = wanted && natural(wanted, file.info) ? wanted : firstPick(file.info);
      fresh.push({
        key: newKey(), path, name: file.info.name, info: file.info, target,
        status: joinQueue && target ? "queued" : "idle",
        runId: null, progress: null, result: null, error: null, saving: false,
      });
    }
    if (!fresh.length) return;
    setRows((list) => [...list, ...fresh]);
    // A first file sets the list's format if none was chosen yet.
    if (!formatRef.current) {
      const first = fresh.find((r) => r.target);
      if (first) setFormat(first.target);
    }
  }

  async function choose() {
    setError(null);
    setReading(true);
    try {
      add(await pickMediaFiles());
    } catch (err) {
      setError(typeof err === "string" ? err : "Could not open the file picker.");
    } finally {
      setReading(false);
    }
  }

  // Files dropped anywhere on the window while this tab is open.
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
          setError(null);
          setReading(true);
          try {
            add(await probeFiles(e.paths));
          } catch (err) {
            setError(typeof err === "string" ? err : "Could not read those files.");
          } finally {
            setReading(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// Picking a format for the list sets it on every file that can take it
  /// and isn't busy. A finished file picked for a new format goes back to
  /// waiting, and its unsaved result is thrown away.
  function pickFormat(next: ConvertTarget) {
    setFormat(next);
    setRows((list) =>
      list.map((r) => {
        if (!r.info || r.status === "running" || r.status === "queued" || !natural(next, r.info)) return r;
        if (r.target === next) return r;
        return retarget(r, next);
      })
    );
  }

  function retarget(r: Row, next: ConvertTarget): Row {
    if (r.result && !r.result.savedTo) discardConverted(r.result.path).catch(() => {});
    return { ...r, target: next, status: "idle", result: null, error: null, progress: null };
  }

  async function convertRow(row: Row) {
    if (!row.info || !row.target) return;
    const id = crypto.randomUUID();
    const target = row.target;
    if (row.result && !row.result.savedTo) discardConverted(row.result.path).catch(() => {});
    patch(row.key, { status: "running", runId: id, error: null, result: null, progress: { percent: 0, stage: "Starting" } });
    const unsubscribe = onDownloadProgress(id, (p) =>
      patch(row.key, { progress: { percent: p.percent, stage: p.stage, transfer: p.transfer } })
    );
    try {
      const path = await convertFile({
        id,
        path: row.path,
        target,
        options: optionsRef.current,
        duration: row.info.duration,
      });
      const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
      patch(row.key, {
        status: "done",
        runId: null,
        progress: null,
        result: {
          path,
          name: path.slice(cut + 1),
          sizeBytes: await fileSize(path).catch(() => null),
          target,
          savedTo: null,
        },
      });
    } catch (err) {
      const message = typeof err === "string" ? err : "Conversion failed.";
      const stopped = message === "Conversion stopped";
      patch(row.key, {
        status: stopped ? "stopped" : "failed",
        runId: null,
        progress: null,
        error: stopped ? null : message,
      });
    } finally {
      unsubscribe();
    }
  }

  /// Works through the queue, one file at a time, until nothing is queued.
  /// Reads the list afresh each turn, so files added or removed while it
  /// runs are seen.
  async function runQueue() {
    if (runnerRef.current) return;
    runnerRef.current = true;
    setRunning(true);
    // Each queued file is taken once. The list is read afresh every turn,
    // but a finished file's new status may not have landed in it yet.
    const taken = new Set<string>();
    try {
      for (;;) {
        const next = rowsRef.current.find((r) => r.status === "queued" && !taken.has(r.key));
        if (!next) break;
        taken.add(next.key);
        await convertRow(next);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      runnerRef.current = false;
      setRunning(false);
    }
  }

  function queue(keys: string[]) {
    const set = new Set(keys);
    const list = rowsRef.current.map((r) =>
      set.has(r.key) && r.info && r.target && r.status !== "running" ? { ...r, status: "queued" as Status } : r
    );
    rowsRef.current = list;
    setRows(list);
    runQueue();
  }

  function convertAll() {
    queue(
      rowsRef.current
        .filter((r) => r.info && r.target && (r.status === "idle" || r.status === "stopped" || (r.status === "failed" && r.info)))
        .map((r) => r.key)
    );
  }

  /// Stops the file converting now and takes everything else off the queue.
  function stopAll() {
    const list = rowsRef.current.map((r) => (r.status === "queued" ? { ...r, status: "idle" as Status } : r));
    rowsRef.current = list;
    setRows(list);
    const current = list.find((r) => r.status === "running");
    if (current?.runId) stopDownload(current.runId);
  }

  function remove(row: Row) {
    if (row.status === "running") return;
    if (row.result && !row.result.savedTo) discardConverted(row.result.path).catch(() => {});
    setRows((list) => list.filter((r) => r.key !== row.key));
  }

  async function download(row: Row) {
    if (!row.result) return;
    patch(row.key, { saving: true });
    try {
      const savedTo = await saveConverted(row.result.path);
      const current = rowsRef.current.find((r) => r.key === row.key);
      if (current?.result) patch(row.key, { saving: false, result: { ...current.result, savedTo: savedTo ?? null } });
      else patch(row.key, { saving: false });
    } catch (err) {
      patch(row.key, { saving: false, error: typeof err === "string" ? err : "Couldn't save that file." });
    }
  }

  async function downloadAll() {
    setSavingAll(true);
    try {
      for (const row of rowsRef.current.filter((r) => r.status === "done" && r.result && !r.result.savedTo)) {
        await download(row);
      }
    } finally {
      setSavingAll(false);
    }
  }

  function clearFinished() {
    setRows((list) =>
      list.filter((r) => {
        const finished = r.status === "done" || (r.status === "failed" && !r.info);
        if (finished && r.result && !r.result.savedTo) discardConverted(r.result.path).catch(() => {});
        return !finished;
      })
    );
  }

  // What is on the list, for the format grid and the settings.
  const readable = rows.filter((r) => r.info);
  const kinds = new Set<FileKind>(readable.map((r) => r.info!.kind));
  const mainKind: FileKind | null = readable[0]?.info?.kind ?? null;
  const targets = [...new Set(readable.map((r) => r.target).filter(Boolean) as ConvertTarget[])];
  const waiting = rows.filter((r) => r.info && r.target && (r.status === "idle" || r.status === "stopped" || r.status === "failed"));
  const queued = rows.filter((r) => r.status === "queued").length;
  const finished = rows.filter((r) => r.status === "done");
  const unsaved = finished.filter((r) => r.result && !r.result.savedTo);

  return (
    <section className="convert">
      {rows.length === 0 ? (
        <div className={`conv-drop${dragging ? " is-over" : ""}`}>
          <span className="conv-drop-icon" aria-hidden="true">
            <DropGlyph />
          </span>
          <span className="conv-drop-title">{dragging ? "Drop them" : "Drop files here"}</span>
          <span className="conv-drop-hint">Videos, songs, pictures — as many as you like</span>
          <button type="button" className="submit-btn conv-drop-btn" onClick={choose} disabled={reading}>
            {reading ? (
              <>
                <span className="submit-spinner" aria-hidden="true" />
                Reading…
              </>
            ) : (
              "Choose files"
            )}
          </button>
        </div>
      ) : (
        <>
          <ul className="conv-queue">
            {rows.map((row) => (
              <QueueRow
                key={row.key}
                row={row}
                onTarget={(t) => setRows((list) => list.map((r) => (r.key === row.key ? retarget(r, t) : r)))}
                onConvert={() => queue([row.key])}
                onStop={() => row.runId && stopDownload(row.runId)}
                onUnqueue={() => patch(row.key, { status: "idle" })}
                onRemove={() => remove(row)}
                onDownload={() => download(row)}
              />
            ))}
          </ul>

          <div className={`conv-drop conv-drop-compact${dragging ? " is-over" : ""}`}>
            <span className="conv-drop-title">{dragging ? "Drop to add them" : "Drop more files here"}</span>
            <button type="button" className="dl-ctrl-btn" onClick={choose} disabled={reading}>
              {reading ? "Reading…" : "Add files"}
            </button>
          </div>

          <div className="conv-footer">
            <div className="conv-footer-left">
              {finished.length && !running ? (
                <button type="button" className="history-clear" onClick={clearFinished}>
                  Clear finished
                </button>
              ) : running ? (
                <span className="conv-count">
                  {queued ? `Converting · ${queued} more in the queue` : "Converting the last one"}
                </span>
              ) : null}
            </div>
            {unsaved.length ? (
              <button type="button" className="btn" onClick={downloadAll} disabled={savingAll}>
                {savingAll ? "Saving…" : unsaved.length === 1 ? "Download" : `Download all (${unsaved.length})`}
              </button>
            ) : null}
            {running ? (
              <button type="button" className="btn" onClick={stopAll}>
                Stop
              </button>
            ) : (
              <button type="button" className="submit-btn" onClick={convertAll} disabled={waiting.length === 0}>
                {waiting.length === 0
                  ? finished.length
                    ? "All converted"
                    : "Nothing to convert"
                  : waiting.length === 1
                    ? `Convert to ${formatLabel(waiting[0].target!)}`
                    : `Convert ${waiting.length} files`}
              </button>
            )}
          </div>

          {/* One pick for the whole list. It changes every file it suits;
              each row's own menu can still pick something else. */}
          <div className="convert-step">
            <span className="convert-step-label">
              {readable.length > 1 ? "Convert all to" : "Convert to"}
              {format ? (
                <span className="conv-picked">
                  {" "}
                  · {formatLabel(format)} — {formatHint(format)}
                </span>
              ) : null}
            </span>
            {groupsFor(mainKind).map((group) => {
              const formats = group.formats.filter((f) => readable.some((r) => natural(f.id, r.info!)));
              if (!formats.length) return null;
              return (
                <div className="conv-group" key={group.id}>
                  <span className="conv-group-title">{group.title}</span>
                  <div className="conv-pills" role="radiogroup" aria-label={`${group.title} formats`}>
                    {formats.map((f) => {
                      const takers = readable.filter((r) => natural(f.id, r.info!)).length;
                      const partial = readable.length > 1 && takers < readable.length;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={format === f.id}
                          className={`conv-pill${format === f.id ? " is-on" : ""}`}
                          onClick={() => pickFormat(f.id)}
                          title={
                            (kinds.size === 1 ? hintFor(f, mainKind) : f.hint) +
                            (partial ? ` · ${takers} of ${readable.length} files` : "")
                          }
                        >
                          {f.label}
                          {partial ? (
                            <span className="conv-pill-count">
                              {takers}/{readable.length}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <ConvertSettings
            options={options}
            onChange={setOptions}
            targets={targets}
            format={format}
            disabled={false}
          />
        </>
      )}

      {error ? <ErrorNote message={error} onDismiss={() => setError(null)} /> : null}

    </section>
  );
}

function QueueRow({
  row,
  onTarget,
  onConvert,
  onStop,
  onUnqueue,
  onRemove,
  onDownload,
}: {
  row: Row;
  onTarget: (t: ConvertTarget) => void;
  onConvert: () => void;
  onStop: () => void;
  onUnqueue: () => void;
  onRemove: () => void;
  onDownload: () => void;
}) {
  const info = row.info;
  const saved = row.result?.savedTo
    ? row.result.savedTo.slice(Math.max(row.result.savedTo.lastIndexOf("\\"), row.result.savedTo.lastIndexOf("/")) + 1)
    : null;
  const busy = row.status === "running" || row.status === "queued";

  return (
    <li className={`conv-row conv-row-${row.status}`}>
      <span className={`conv-row-icon${row.status === "done" ? " is-done" : ""}`} aria-hidden="true">
        {row.status === "done" ? <CheckGlyph /> : info ? <KindGlyph kind={info.kind} /> : <span className="conv-row-n">!</span>}
      </span>

      <div className="conv-row-text">
        <span className="conv-row-name" title={row.path}>
          {row.status === "done" && row.result ? saved ?? row.result.name : row.name}
        </span>
        <span className="conv-row-meta">
          {row.status === "done" && row.result
            ? [
                formatLabel(row.result.target),
                row.result.sizeBytes !== null ? formatBytes(row.result.sizeBytes) : null,
                row.result.savedTo ? "Saved to your download folder" : "Ready to download",
              ]
                .filter(Boolean)
                .join(" · ")
            : row.status === "running" && row.progress
              ? row.progress.percent > 0
                ? [
                    `${Math.floor(row.progress.percent)}%`,
                    row.progress.stage,
                    row.progress.transfer?.downloaded ? formatBytes(row.progress.transfer.downloaded) : null,
                    row.progress.transfer?.eta != null ? formatEta(row.progress.transfer.eta) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : `${row.progress.stage}…`
              : row.error
                ? <span className="conv-row-error">{row.error}</span>
                : info
                  ? describe(info)
                  : null}
        </span>
        {row.status === "running" && row.progress ? (
          <div className={`dlrow-track${row.progress.percent > 0 ? "" : " is-waiting"}`}>
            <div className="dlrow-fill" style={{ width: `${row.progress.percent}%` }} />
          </div>
        ) : null}
      </div>

      <div className="conv-row-side">
        {info && row.target && row.status !== "done" ? (
          <Select
            className="conv-row-format"
            ariaLabel={`Format for ${row.name}`}
            value={row.target}
            onChange={(v) => onTarget(v as ConvertTarget)}
            disabled={busy}
            groups={groupsFor(info.kind)
              .map((g) => ({
                title: g.title,
                options: g.formats
                  .filter((f) => accepts(f.id, info))
                  .map((f) => [f.id, formatLabel(f.id)] as [string, string]),
              }))
              .filter((g) => g.options.length)}
          />
        ) : null}

        {row.status === "running" ? (
          <button type="button" className="dlrow-icon dlrow-cancel" onClick={onStop} aria-label="Cancel" title="Cancel">
            <StopGlyph />
          </button>
        ) : row.status === "queued" ? (
          <button type="button" className="dl-ctrl-btn" onClick={onUnqueue} title="Take it off the queue">
            Queued
          </button>
        ) : row.status === "done" && row.result ? (
          row.result.savedTo ? (
            <button type="button" className="dl-ctrl-btn" onClick={() => revealFile(row.result!.savedTo!)}>
              Show
            </button>
          ) : (
            <button type="button" className="conv-row-download" onClick={onDownload} disabled={row.saving}>
              {row.saving ? "Saving…" : "Download"}
            </button>
          )
        ) : info && row.target ? (
          <button type="button" className="dl-ctrl-btn" onClick={onConvert}>
            {row.status === "failed" || row.status === "stopped" ? "Try again" : "Convert"}
          </button>
        ) : null}

        {row.status === "running" ? null : (
          <button
            type="button"
            className="conv-row-remove"
            aria-label={`Remove ${row.name}`}
            title="Remove from the list"
            onClick={onRemove}
          >
            <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}

function DropGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M12 15.5v-11M7.5 9 12 4.5 16.5 9M4.5 15.5v2.2c0 1.3 1 2.3 2.3 2.3h10.4c1.3 0 2.3-1 2.3-2.3v-2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KindGlyph({ kind }: { kind: FileKind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "video" ? (
        <>
          <rect x="3" y="5" width="13" height="14" rx="2.5" />
          <path d="M16 10l5-3v10l-5-3" />
        </>
      ) : kind === "audio" ? (
        <>
          <path d="M9 18V5l11-2v13" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle cx="9" cy="10" r="1.8" />
          <path d="M21 16l-5-5-9 9" />
        </>
      )}
    </svg>
  );
}

