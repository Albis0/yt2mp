import { useEffect, useRef, useState } from "react";
import {
  convertFile,
  discardConverted,
  fileSize,
  formatBytes,
  formatDuration,
  formatEta,
  onDownloadProgress,
  pickMediaFile,
  probeFiles,
  revealFile,
  saveConverted,
  stopDownload,
  type ConvertTarget,
  type FileKind,
  type PickedFile,
  type SourceInfo,
  type Transfer,
} from "@/lib/api";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { StopGlyph } from "@/components/DownloadRow";
import ErrorNote from "@/components/ErrorNote";

/// The converter, as three steps on one screen: a file goes in, a format is
/// picked, the converted file comes out with a Download button.
///
/// One file at a time, on purpose. The question on this screen is "what can
/// this file become", and the answer depends on the file: a song can't become
/// a GIF, a photo can't become an MP3. A list of files would need a format
/// per row or a format that fits none of them.
///
/// The converted file waits in the app's own folder until Download is
/// pressed, so converting to three formats to compare them leaves nothing
/// behind but the one that was kept.

interface Format {
  id: ConvertTarget;
  label: string;
  hint: string;
}

const GROUPS: { kind: FileKind; title: string; formats: Format[] }[] = [
  {
    kind: "video",
    title: "Video",
    formats: [
      { id: "mp4", label: "MP4", hint: "Plays everywhere" },
      { id: "mkv", label: "MKV", hint: "Keeps every track" },
      { id: "webm", label: "WebM", hint: "For the web" },
      { id: "mov", label: "MOV", hint: "Apple and editors" },
      { id: "avi", label: "AVI", hint: "Older players and TVs" },
      { id: "gif", label: "GIF", hint: "Short loop, no sound" },
    ],
  },
  {
    kind: "audio",
    title: "Audio",
    formats: [
      { id: "mp3", label: "MP3", hint: "Plays everywhere" },
      { id: "m4a", label: "M4A", hint: "Apple, small" },
      { id: "wav", label: "WAV", hint: "Uncompressed" },
      { id: "flac", label: "FLAC", hint: "Lossless, smaller" },
      { id: "ogg", label: "OGG", hint: "Open format" },
      { id: "opus", label: "Opus", hint: "Smallest" },
    ],
  },
  {
    kind: "image",
    title: "Image",
    formats: [
      { id: "png", label: "PNG", hint: "Lossless" },
      { id: "jpg", label: "JPG", hint: "Small, for photos" },
      { id: "webp", label: "WebP", hint: "Smallest, for the web" },
    ],
  },
];

const LABEL: Record<ConvertTarget, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.formats.map((f) => [f.id, f.label]))
) as Record<ConvertTarget, string>;

/// Mirrors `Target::accepts` in convert.rs: what a file of this kind can
/// become. Rust checks again before converting.
function accepts(target: ConvertTarget, file: SourceInfo): boolean {
  const audioOut = ["mp3", "m4a", "wav", "flac", "ogg", "opus"].includes(target);
  const imageOut = ["png", "jpg", "webp"].includes(target);
  if (file.kind === "video") return !imageOut && (!audioOut || file.hasAudio);
  if (file.kind === "audio") return audioOut || target === "mp4";
  return imageOut;
}

/// The hint changes where the same format means something different for
/// this file: an MP4 made from a song is a video with a still picture.
function hintFor(format: Format, file: SourceInfo): string {
  if (file.kind === "audio" && format.id === "mp4") return "Video with a black picture";
  if (file.kind === "video" && !file.hasAudio && ["mp4", "mkv", "webm", "mov", "avi"].includes(format.id))
    return `${format.hint}, silent`;
  return format.hint;
}

const CODECS: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  mpeg4: "MPEG-4",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  pcm_s16le: "PCM",
  png: "PNG",
  mjpeg: "JPEG",
  webp: "WebP",
  gif: "GIF",
};

/// The groups in the order this file wants them: its own kind first, so a
/// song opens on the audio formats and a video on the video ones.
function groupsFor(file: SourceInfo) {
  return [...GROUPS].sort((a, b) => Number(b.kind === file.kind) - Number(a.kind === file.kind));
}

/// The format picked for a new file: the first one it can become that isn't
/// what it already is. A PNG's first offer being PNG would be a Convert
/// button that does nothing useful.
function firstPick(file: SourceInfo): ConvertTarget | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const same = (id: ConvertTarget) => id === ext || (id === "jpg" && ext === "jpeg");
  const offered = groupsFor(file)
    .flatMap((g) => g.formats)
    .filter((f) => accepts(f.id, file));
  return (offered.find((f) => !same(f.id)) ?? offered[0])?.id ?? null;
}

function codecName(codec: string | null): string | null {
  if (!codec) return null;
  return CODECS[codec] ?? codec.toUpperCase();
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

interface Progress {
  percent: number;
  stage: string;
  transfer?: Transfer;
}

interface Result {
  path: string;
  name: string;
  sizeBytes: number | null;
  target: ConvertTarget;
  /// Where Download put it, once it has.
  savedTo: string | null;
}

interface ConvertPanelProps {
  /// Raised while a conversion runs, so the app can block switching tabs,
  /// the same rule downloads follow.
  onBusyChange: (busy: boolean) => void;
}

export default function ConvertPanel({ onBusyChange }: ConvertPanelProps) {
  const [file, setFile] = useState<SourceInfo | null>(null);
  const [target, setTarget] = useState<ConvertTarget | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);

  const running = runId !== null;
  useEffect(() => {
    onBusyChange(running);
  }, [running, onBusyChange]);

  // The drop handler outlives renders; it reads the latest state through here.
  const runningRef = useRef(running);
  runningRef.current = running;
  const resultRef = useRef(result);
  resultRef.current = result;

  /// Takes the first file that was picked or dropped. A new file replaces
  /// the old one, and a converted file nobody downloaded goes with it.
  function take(picked: PickedFile | undefined | null) {
    if (!picked) return;
    if (picked.kind === "bad") {
      setError(picked.reason);
      return;
    }
    const old = resultRef.current;
    if (old && !old.savedTo) discardConverted(old.path).catch(() => {});
    setFile(picked.info);
    setResult(null);
    setProgress(null);
    setError(null);
    // A format is picked for it straight away, so Convert is ready at once;
    // anything else is one click away.
    setTarget(firstPick(picked.info));
  }

  async function choose() {
    setError(null);
    setReading(true);
    try {
      take(await pickMediaFile());
    } catch (err) {
      setError(typeof err === "string" ? err : "Could not open the file picker.");
    } finally {
      setReading(false);
    }
  }

  // A file dropped anywhere on the window while this tab is open.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const e = event.payload;
        if (runningRef.current) return;
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
            take((await probeFiles(e.paths.slice(0, 1)))[0]);
          } catch (err) {
            setError(typeof err === "string" ? err : "Could not read that file.");
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
  }, []);

  async function convert() {
    if (!file || !target || running) return;
    const old = resultRef.current;
    if (old && !old.savedTo) discardConverted(old.path).catch(() => {});
    const id = crypto.randomUUID();
    setRunId(id);
    setResult(null);
    setError(null);
    setProgress({ percent: 0, stage: "Starting" });
    const unsubscribe = onDownloadProgress(id, (p) =>
      setProgress({ percent: p.percent, stage: p.stage, transfer: p.transfer })
    );
    try {
      const path = await convertFile({ id, path: file.path, target, duration: file.duration });
      const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
      setResult({
        path,
        name: path.slice(cut + 1),
        sizeBytes: await fileSize(path).catch(() => null),
        target,
        savedTo: null,
      });
    } catch (err) {
      const message = typeof err === "string" ? err : "Conversion failed.";
      if (message !== "Conversion stopped") setError(message);
    } finally {
      unsubscribe();
      setRunId(null);
      setProgress(null);
    }
  }

  async function download() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const savedTo = await saveConverted(result.path);
      if (savedTo) setResult({ ...result, savedTo });
    } catch (err) {
      setError(typeof err === "string" ? err : "Couldn't save that file.");
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    if (result && !result.savedTo) discardConverted(result.path).catch(() => {});
    setFile(null);
    setTarget(null);
    setResult(null);
    setError(null);
  }

  const savedName = result?.savedTo
    ? result.savedTo.slice(Math.max(result.savedTo.lastIndexOf("\\"), result.savedTo.lastIndexOf("/")) + 1)
    : null;

  return (
    <section className="convert">
      {/* 1. The file. */}
      {!file ? (
        <div className={`conv-drop${dragging ? " is-over" : ""}`}>
          <span className="conv-drop-icon" aria-hidden="true">
            <DropGlyph />
          </span>
          <span className="conv-drop-title">{dragging ? "Drop it" : "Drop a file here"}</span>
          <span className="conv-drop-hint">Any video, song or picture</span>
          <button type="button" className="submit-btn conv-drop-btn" onClick={choose} disabled={reading}>
            {reading ? (
              <>
                <span className="submit-spinner" aria-hidden="true" />
                Reading…
              </>
            ) : (
              "Choose a file"
            )}
          </button>
        </div>
      ) : (
        <div className={`conv-file${dragging ? " is-over" : ""}`}>
          <span className={`conv-file-icon conv-kind-${file.kind}`} aria-hidden="true">
            <KindGlyph kind={file.kind} />
          </span>
          <div className="conv-file-text">
            <span className="conv-file-name" title={file.path}>
              {file.name}
            </span>
            <span className="conv-file-meta">{describe(file)}</span>
          </div>
          <button type="button" className="dl-ctrl-btn" onClick={choose} disabled={running || reading}>
            {reading ? "Reading…" : "Change"}
          </button>
        </div>
      )}

      {/* 2. What it becomes. Only what this file can be, grouped. */}
      {file ? (
        <div className="convert-step">
          <span className="convert-step-label">Convert to</span>
          {groupsFor(file).map((group) => {
            const formats = group.formats.filter((f) => accepts(f.id, file));
            if (!formats.length) return null;
            return (
              <div className="conv-group" key={group.kind}>
                <span className="conv-group-title">{group.title}</span>
                <div className="conv-formats" role="radiogroup" aria-label={`${group.title} formats`}>
                  {formats.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={target === f.id}
                      className={`conv-format${target === f.id ? " is-on" : ""}`}
                      onClick={() => setTarget(f.id)}
                      disabled={running}
                    >
                      <span className="conv-format-name">{f.label}</span>
                      <span className="conv-format-hint">{hintFor(f, file)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {file.kind === "video" && !file.hasAudio ? (
            <span className="conv-note">This video has no sound, so there are no audio formats.</span>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorNote message={error} onDismiss={() => setError(null)} /> : null}

      {/* 3. Convert, then the result. */}
      {file && running && progress ? (
        <div className="conv-run">
          <div className="convert-progress">
            <div className={`dlrow-track${progress.percent > 0 ? "" : " is-waiting"}`}>
              <div className="dlrow-fill" style={{ width: `${progress.percent}%` }} />
            </div>
            <span className="dlrow-meta">
              {progress.percent > 0
                ? [
                    `${Math.floor(progress.percent)}%`,
                    progress.stage,
                    progress.transfer?.downloaded ? formatBytes(progress.transfer.downloaded) : null,
                    progress.transfer?.eta != null ? formatEta(progress.transfer.eta) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : `${progress.stage}…`}
            </span>
          </div>
          <button
            type="button"
            className="dlrow-icon dlrow-cancel"
            onClick={() => runId && stopDownload(runId)}
            aria-label="Cancel"
            title="Cancel"
          >
            <StopGlyph />
          </button>
        </div>
      ) : file && result && result.target === target ? (
        <div className="conv-done">
          <span className="conv-done-icon" aria-hidden="true">
            <CheckGlyph />
          </span>
          <div className="conv-file-text">
            <span className="conv-file-name">{savedName ?? result.name}</span>
            <span className="conv-file-meta">
              {[
                LABEL[result.target],
                result.sizeBytes !== null ? formatBytes(result.sizeBytes) : null,
                result.savedTo ? "Saved to your download folder" : "Ready",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {result.savedTo ? (
            <>
              <button type="button" className="dl-ctrl-btn" onClick={() => revealFile(result.savedTo!)}>
                Show in folder
              </button>
              <button type="button" className="dl-ctrl-btn" onClick={startOver}>
                New file
              </button>
            </>
          ) : (
            <button type="button" className="submit-btn" onClick={download} disabled={saving}>
              {saving ? "Saving…" : "Download"}
            </button>
          )}
        </div>
      ) : file ? (
        <div className="conv-go">
          <button type="button" className="submit-btn" onClick={convert} disabled={!target}>
            {target ? `Convert to ${LABEL[target]}` : "Pick a format"}
          </button>
        </div>
      ) : null}
    </section>
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
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KindGlyph({ kind }: { kind: FileKind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
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
