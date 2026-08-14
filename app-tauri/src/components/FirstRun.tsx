import { useEffect, useState } from "react";
import { ensureTools, onToolsProgress, type ToolsStatus } from "@/lib/api";

/// Shown once, on the first launch after install, while the three binaries
/// yt2mp drives are fetched.
///
/// They used to ride inside the installer, which made every app update a
/// ~120 MB download for the sake of a few megabytes of changed code. Moving
/// them out is what makes updates quick — and it lets yt-dlp be updated on its
/// own when a site breaks, which is the far more common need.
///
/// The cost of that trade is this screen, so it states the size up front
/// rather than showing a bar and hoping nobody minds.
export default function FirstRun({
  onReady,
}: {
  onReady: (status: ToolsStatus) => void;
}) {
  const [percent, setPercent] = useState(0);
  const [stage, setStage] = useState("Starting");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);

  async function start() {
    setError(null);
    setRunning(true);
    setPercent(0);
    setStage("Starting");
    try {
      const status = await ensureTools();
      onReady(status);
    } catch (err) {
      setError(typeof err === "string" ? err : "The download did not finish.");
      setRunning(false);
    }
  }

  useEffect(() => {
    const stop = onToolsProgress((p) => {
      setPercent(p.percent);
      setStage(p.stage);
    });
    start();
    return stop;
    // Deliberately runs once: this component is only mounted when the tools
    // are missing, and start() is re-invoked by the retry button instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="firstrun">
      <div className="firstrun-card">
        <h2 className="firstrun-title">Getting yt2mp ready</h2>
        <p className="firstrun-text">
          yt2mp uses ffmpeg and yt-dlp to do the actual downloading. They are
          about 120&nbsp;MB together and are fetched now, once, instead of
          riding inside every update.
        </p>

        {error ? (
          <>
            <p className="firstrun-error">{error}</p>
            <p className="firstrun-text firstrun-dim">
              Nothing was left half-finished — anything that did download is
              kept, so trying again picks up where this stopped.
            </p>
            <button type="button" className="settings-primary" onClick={start}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="firstrun-track">
              <div
                className="firstrun-fill"
                style={{ width: `${Math.max(percent, 2)}%` }}
              />
            </div>
            <p className="firstrun-status">
              <span className="num">{Math.floor(percent)}%</span>
              <span className="firstrun-stage">{stage}</span>
            </p>
          </>
        )}

        {running && !error ? (
          <p className="firstrun-text firstrun-dim">
            This only happens once. Later updates to yt2mp are a few megabytes.
          </p>
        ) : null}
      </div>
    </div>
  );
}
