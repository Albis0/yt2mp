import { useState } from "react";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  revealFile,
  type DownloadProgress,
} from "@/lib/api";

/// One downloadable thing, as a row: a quality on the result card, a track in
/// a playlist, a find on a scanned page. Every screen that downloads uses
/// this, so a download looks and behaves the same wherever it was started.
///
/// The whole row is the button. Its right edge carries the action as a
/// glyph — download, cancel, show — so there is always one obvious target,
/// but a click anywhere on the row does the same thing. The only other real
/// buttons are Cancel while it runs, Show once it is saved, and Details on
/// an error; they sit above the row's own hit area.

export type RowState =
  | { at: "idle" }
  | { at: "running"; progress: DownloadProgress }
  | { at: "done"; filePath: string | null }
  | { at: "failed"; error: string }
  /** Stopped by the user. Reads as a fresh start, with a quiet note. */
  | { at: "cancelled" };

interface DownloadRowProps {
  label: string;
  /** Small chips after the label: container, "4K", a bitrate. */
  tags?: string[];
  /** A second line under the label (a track's uploader, a find's origin). */
  sub?: string;
  /** The size promised before starting; also the total the bar counts to. */
  size?: number | null;
  state: RowState;
  onStart: () => void;
  onCancel: () => void;
  /** Disables starting (another run owns the queue); never disables Cancel. */
  locked?: boolean;
}

export default function DownloadRow({
  label,
  tags = [],
  sub,
  size = null,
  state,
  onStart,
  onCancel,
  locked = false,
}: DownloadRowProps) {
  const [details, setDetails] = useState(false);

  const running = state.at === "running";
  const done = state.at === "done";
  const failed = state.at === "failed";

  // What a click on the row means in each state. Running rows have no row
  // action: a stray click must never cancel a transfer.
  const act = running
    ? undefined
    : done
      ? () => state.filePath && revealFile(state.filePath)
      : onStart;
  const verb = done
    ? `Show ${label} in folder`
    : failed
      ? `Try ${label} again`
      : `Download ${label}`;

  return (
    <div className={`dlrow dlrow-${state.at}`}>
      {act ? (
        <button
          type="button"
          className="dlrow-hit"
          onClick={act}
          disabled={locked && !done}
          aria-label={verb}
          title={done && state.filePath ? state.filePath : undefined}
        />
      ) : null}

      <div className="dlrow-main">
        <div className="dlrow-head">
          <span className="dlrow-label">{label}</span>
          {tags.map((t) => (
            <span key={t} className="dlrow-tag">
              {t}
            </span>
          ))}
          {state.at === "cancelled" ? <span className="dlrow-note">Cancelled</span> : null}
        </div>

        {running ? (
          <Progress progress={state.progress} size={size} />
        ) : failed ? (
          <p className={`dlrow-error${details ? " is-open" : ""}`}>
            <AlertGlyph />
            <span className="dlrow-error-text selectable">{state.error}</span>
          </p>
        ) : sub ? (
          <span className="dlrow-sub">{sub}</span>
        ) : null}
      </div>

      <div className="dlrow-side">
        {running ? (
          <button
            type="button"
            className="dlrow-icon dlrow-cancel"
            onClick={onCancel}
            aria-label={`Cancel ${label}`}
            title="Cancel"
          >
            <StopGlyph />
          </button>
        ) : done ? (
          <>
            <span className="dlrow-saved">
              <CheckGlyph />
              Saved
            </span>
            <span className="dlrow-icon dlrow-go" aria-hidden="true">
              <FolderGlyph />
            </span>
          </>
        ) : failed ? (
          <>
            {state.error.length > 70 ? (
              <button
                type="button"
                className="dlrow-link"
                onClick={() => setDetails((v) => !v)}
                aria-expanded={details}
              >
                {details ? "Less" : "Details"}
              </button>
            ) : null}
            <span className="dlrow-retry" aria-hidden="true">
              <RetryGlyph />
              Try again
            </span>
          </>
        ) : (
          <>
            {size ? <span className="dlrow-size">{formatBytes(size)}</span> : null}
            <span className="dlrow-icon dlrow-go" aria-hidden="true">
              <DownloadGlyph />
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/// The bar and the line under it. A bar with nothing to measure yet
/// (starting, finding another server, merging) runs indeterminate rather
/// than sitting at zero, which reads as stuck.
function Progress({ progress, size }: { progress: DownloadProgress; size: number | null }) {
  const { percent, stage, transfer } = progress;
  const measuring = percent > 0 && percent < 100;

  const parts: string[] = [];
  if (transfer) {
    parts.push(`${Math.floor(percent)}%`);
    const total = size && size >= transfer.downloaded ? size : null;
    parts.push(
      total
        ? `${formatBytes(transfer.downloaded)} of ${formatBytes(total)}`
        : formatBytes(transfer.downloaded)
    );
    if (transfer.speed) parts.push(formatSpeed(transfer.speed));
    if (transfer.eta !== null && transfer.eta !== undefined) parts.push(formatEta(transfer.eta));
  } else {
    parts.push(measuring ? `${Math.floor(percent)}% · ${stage}` : `${stage}…`);
  }

  return (
    <div className="dlrow-progress">
      <div
        className={`dlrow-track${measuring || transfer ? "" : " is-waiting"}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(percent)}
      >
        <div className="dlrow-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="dlrow-meta">{parts.join(" · ")}</span>
    </div>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        className="dlrow-arrow"
        d="M8 2.5v7.2M4.8 6.6 8 9.8l3.2-3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StopGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.6" fill="currentColor" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="m3.5 8.4 2.8 2.8 6.2-6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M2.2 4.6c0-.7.5-1.2 1.2-1.2h2.8l1.4 1.5h5c.7 0 1.2.5 1.2 1.2v5.8c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="10.9" r=".95" fill="currentColor" />
    </svg>
  );
}

function RetryGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4M12.8 2.6v2.6h-2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
