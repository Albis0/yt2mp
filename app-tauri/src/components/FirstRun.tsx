import { useEffect, useState } from "react";
import { ensureTools, onToolsProgress, type ToolsStatus } from "@/lib/api";

/// Recovery screen for a broken install.
///
/// The three binaries yt2mp drives ship inside the installer, so a normal
/// install never reaches this — `tools::status()` finds them next to the exe
/// and the app goes straight to the main window. This is what happens when
/// they are genuinely absent: a partial install, an antivirus quarantine, or
/// a user who deleted them.
///
/// It stays because the alternative is an app that silently cannot work. The
/// same download path also backs "Update yt-dlp", which is how a site that
/// stops working gets fixed without shipping a new release.
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
        <h2 className="firstrun-title">Repairing yt2mp</h2>
        <p className="firstrun-text">
          The tools yt2mp downloads with — ffmpeg and yt-dlp — are missing.
          They normally come with the app, so something removed them; an
          antivirus quarantine is the usual reason. Fetching them again now,
          about 120&nbsp;MB.
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
            If this keeps happening, add yt2mp to your antivirus exclusions.
          </p>
        ) : null}
      </div>
    </div>
  );
}
