import { useState } from "react";
import type { ConvertOptions, ConvertTarget, VideoCodec } from "@/lib/api";
import { CODEC_LABELS, isAnimation, isAudio, isImage, isVideo, videoCodecs } from "@/lib/formats";

/// The converter's settings, for every file in the list. Only the sections
/// that apply to the formats in use are shown: nobody converting songs needs
/// a frame-rate menu.
///
/// Every setting starts at "leave it as it is", and while they all are the
/// converter copies streams instead of re-encoding wherever it can.

interface Props {
  options: ConvertOptions;
  onChange: (next: ConvertOptions) => void;
  /// The formats the list will produce, to decide which sections show.
  targets: ConvertTarget[];
  /// The one format picked for everything, if there is one: the video codec
  /// menu depends on the container.
  format: ConvertTarget | null;
  disabled: boolean;
}

const QUALITIES: { id: NonNullable<ConvertOptions["quality"]>; label: string }[] = [
  { id: "auto", label: "Original" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "small", label: "Small file" },
];

export default function ConvertSettings({ options, onChange, targets, format, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const set = (change: Partial<ConvertOptions>) => onChange({ ...options, ...change });

  const picture = targets.some((t) => isVideo(t) || isAnimation(t));
  const video = targets.some(isVideo);
  const sound = targets.some((t) => isVideo(t) || isAudio(t));
  const image = targets.some(isImage);
  const timed = targets.some((t) => !isImage(t));
  const codecs = format && isVideo(format) ? videoCodecs(format) : [];

  const changed = summary(options);

  return (
    <div className={`conv-settings${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="conv-settings-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="conv-settings-title">Settings</span>
        <span className="conv-settings-sum">{changed.length ? changed.join(" · ") : "Original quality, nothing changed"}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div className="conv-settings-body">
          <Field label="Quality">
            <div className="seg" role="radiogroup" aria-label="Quality">
              {QUALITIES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  role="radio"
                  aria-checked={(options.quality ?? "auto") === q.id}
                  className={`seg-btn${(options.quality ?? "auto") === q.id ? " is-on" : ""}`}
                  onClick={() => set({ quality: q.id })}
                  disabled={disabled}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </Field>

          {picture ? (
            <div className="conv-settings-grid">
              {codecs.length > 1 ? (
                <Field label="Video codec">
                  <Select
                    value={options.videoCodec ?? ""}
                    onChange={(v) => set({ videoCodec: (v || null) as VideoCodec | null })}
                    disabled={disabled}
                    options={[
                      ["", `${CODEC_LABELS[codecs[0]]} (usual)`],
                      ...codecs.slice(1).map((c) => [c, CODEC_LABELS[c]] as [string, string]),
                    ]}
                  />
                </Field>
              ) : null}
              <Field label="Resolution">
                <Select
                  value={String(options.height ?? "")}
                  onChange={(v) => set({ height: v ? Number(v) : null })}
                  disabled={disabled}
                  options={[
                    ["", "Original"],
                    ["2160", "4K (2160p)"],
                    ["1440", "1440p"],
                    ["1080", "1080p"],
                    ["720", "720p"],
                    ["480", "480p"],
                    ["360", "360p"],
                    ["240", "240p"],
                  ]}
                />
              </Field>
              <Field label="Frame rate">
                <Select
                  value={String(options.fps ?? "")}
                  onChange={(v) => set({ fps: v ? Number(v) : null })}
                  disabled={disabled}
                  options={[
                    ["", "Original"],
                    ["60", "60 fps"],
                    ["30", "30 fps"],
                    ["25", "25 fps"],
                    ["24", "24 fps"],
                    ["15", "15 fps"],
                    ["10", "10 fps"],
                  ]}
                />
              </Field>
              <Field label="Rotate">
                <Select
                  value={String(options.rotate ?? "")}
                  onChange={(v) => set({ rotate: v ? (Number(v) as 90 | 180 | 270) : null })}
                  disabled={disabled}
                  options={[
                    ["", "No"],
                    ["90", "90° right"],
                    ["270", "90° left"],
                    ["180", "Upside down"],
                  ]}
                />
              </Field>
            </div>
          ) : null}

          {timed ? (
            <div className="conv-settings-grid">
              <Field label="Start at" hint="e.g. 1:30">
                <TimeInput value={options.start ?? null} onChange={(start) => set({ start })} disabled={disabled} />
              </Field>
              <Field label="End at" hint="empty = to the end">
                <TimeInput value={options.end ?? null} onChange={(end) => set({ end })} disabled={disabled} />
              </Field>
            </div>
          ) : null}

          {sound ? (
            <div className="conv-settings-grid">
              <Field label="Audio bitrate">
                <Select
                  value={String(options.audioBitrate ?? "")}
                  onChange={(v) => set({ audioBitrate: v ? Number(v) : null })}
                  disabled={disabled}
                  options={[
                    ["", "Automatic"],
                    ["320", "320 kbps"],
                    ["256", "256 kbps"],
                    ["192", "192 kbps"],
                    ["160", "160 kbps"],
                    ["128", "128 kbps"],
                    ["96", "96 kbps"],
                    ["64", "64 kbps"],
                  ]}
                />
              </Field>
              <Field label="Channels">
                <Select
                  value={String(options.channels ?? "")}
                  onChange={(v) => set({ channels: v ? (Number(v) as 1 | 2) : null })}
                  disabled={disabled}
                  options={[
                    ["", "Original"],
                    ["2", "Stereo"],
                    ["1", "Mono"],
                  ]}
                />
              </Field>
              <Field label="Sample rate">
                <Select
                  value={String(options.sampleRate ?? "")}
                  onChange={(v) => set({ sampleRate: v ? Number(v) : null })}
                  disabled={disabled}
                  options={[
                    ["", "Original"],
                    ["48000", "48 kHz"],
                    ["44100", "44.1 kHz"],
                    ["32000", "32 kHz"],
                    ["22050", "22 kHz"],
                    ["16000", "16 kHz"],
                  ]}
                />
              </Field>
            </div>
          ) : null}

          {sound || video ? (
            <div className="conv-toggles">
              {sound ? (
                <Toggle
                  label="Even out the volume"
                  hint="Quiet and loud files come out equally loud"
                  on={!!options.normalize}
                  onChange={(normalize) => set({ normalize })}
                  disabled={disabled}
                />
              ) : null}
              {video ? (
                <Toggle
                  label="Remove the sound"
                  hint="Videos come out silent"
                  on={!!options.mute}
                  onChange={(mute) => set({ mute })}
                  disabled={disabled}
                />
              ) : null}
            </div>
          ) : null}

          {image ? (
            <div className="conv-settings-grid">
              <Field label="Picture size" hint="longest side">
                <Select
                  value={String(options.imageSize ?? "")}
                  onChange={(v) => set({ imageSize: v ? Number(v) : null })}
                  disabled={disabled}
                  options={[
                    ["", "Original"],
                    ["4096", "4096 px"],
                    ["2048", "2048 px"],
                    ["1920", "1920 px"],
                    ["1024", "1024 px"],
                    ["512", "512 px"],
                    ["256", "256 px"],
                    ["128", "128 px"],
                    ["64", "64 px"],
                  ]}
                />
              </Field>
            </div>
          ) : null}

          {changed.length ? (
            <button type="button" className="conv-reset" onClick={() => onChange({})} disabled={disabled}>
              Reset everything
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/// The settings that differ from "as it is", in a few words each.
function summary(o: ConvertOptions): string[] {
  const out: string[] = [];
  if (o.quality && o.quality !== "auto") out.push(QUALITIES.find((q) => q.id === o.quality)!.label + " quality");
  if (o.videoCodec) out.push(CODEC_LABELS[o.videoCodec]);
  if (o.height) out.push(`${o.height}p`);
  if (o.fps) out.push(`${o.fps} fps`);
  if (o.rotate) out.push(`turned ${o.rotate}°`);
  if (o.start || o.end) out.push(`${o.start ? clock(o.start) : "0:00"}–${o.end ? clock(o.end) : "end"}`);
  if (o.audioBitrate) out.push(`${o.audioBitrate} kbps`);
  if (o.channels) out.push(o.channels === 1 ? "mono" : "stereo");
  if (o.sampleRate) out.push(`${o.sampleRate / 1000} kHz`);
  if (o.normalize) out.push("volume evened");
  if (o.mute) out.push("no sound");
  if (o.imageSize) out.push(`${o.imageSize} px`);
  return out;
}

export function clock(seconds: number): string {
  const s = Math.round(seconds * 10) / 10;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const sec = (rest < 10 ? "0" : "") + (Number.isInteger(rest) ? rest : rest.toFixed(1));
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/// "90", "1:30", "1:02:03" → seconds; null for empty or nonsense.
export function parseClock(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function TimeInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(value != null ? clock(value) : "");
  const [bad, setBad] = useState(false);
  return (
    <input
      className={`conv-input${bad ? " is-bad" : ""}`}
      value={text}
      placeholder="0:00"
      spellCheck={false}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseClock(e.target.value);
        const ok = parsed !== null || !e.target.value.trim();
        setBad(!ok);
        if (ok) onChange(parsed);
      }}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="conv-field">
      <span className="conv-field-label">
        {label}
        {hint ? <span className="conv-field-hint"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
  groups,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: [string, string][];
  groups?: { title: string; options: [string, string][] }[];
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span className={`conv-select${className ? ` ${className}` : ""}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={ariaLabel}>
        {options?.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.title} label={g.title}>
            {g.options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Chevron open={false} />
    </span>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`conv-toggle${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <span className="conv-toggle-track" aria-hidden="true">
        <span className="conv-toggle-knob" />
      </span>
      <span className="conv-toggle-text">
        <span className="conv-toggle-label">{label}</span>
        <span className="conv-toggle-hint">{hint}</span>
      </span>
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chev${open ? " is-open" : ""}`}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
