import { useState } from "react";
import {
  install,
  openReleasePage,
  skipVersion,
  type Available,
} from "@/lib/updater";

/// A strip under the tabs, not a modal.
///
/// An update is worth mentioning; it is not worth interrupting someone who
/// opened the app to grab one video. Dismissing it costs one click and the
/// choice is remembered.
export default function UpdateBanner({
  update,
  busy,
  onDismiss,
}: {
  update: Available;
  /// True while a download is running. Installing would kill it, so the
  /// button explains itself instead of disappearing.
  busy: boolean;
  onDismiss: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setInstalling(true);
    setError(null);
    try {
      await install(update, setPercent);
      // Reached only if the app was not closed by the installer itself.
    } catch (err) {
      setError(typeof err === "string" ? err : "The update could not install.");
      setInstalling(false);
    }
  }

  if (installing) {
    return (
      <div className="updatebar">
        <span className="updatebar-text">
          {percent === null
            ? "Downloading the update…"
            : `Downloading the update — ${Math.floor(percent)}%`}
        </span>
        <span className="updatebar-note">
          yt2mp will restart on its own when this finishes.
        </span>
      </div>
    );
  }

  return (
    <div className="updatebar">
      <span className="updatebar-text">
        Version <span className="num">{update.version}</span> is available.
      </span>

      {error ? <span className="updatebar-error">{error}</span> : null}

      <div className="updatebar-actions">
        {update.canInstall ? (
          busy ? (
            // Refusing here is the whole point: a 4K download can be an hour
            // of transfer, and replacing the binary underneath it would throw
            // that away with no warning.
            <span className="updatebar-note">
              Finish your download first, then update.
            </span>
          ) : (
            <button type="button" className="updatebar-primary" onClick={run}>
              Update now
            </button>
          )
        ) : (
          // Linux AppImages can only replace themselves when launched through
          // the AppImage runtime. Rather than offer a button that would fail,
          // send people to the download.
          <button
            type="button"
            className="updatebar-primary"
            onClick={openReleasePage}
          >
            Get it from GitHub
          </button>
        )}

        <button type="button" className="updatebar-ghost" onClick={onDismiss}>
          Later
        </button>
        <button
          type="button"
          className="updatebar-ghost"
          onClick={() => {
            skipVersion(update.version);
            onDismiss();
          }}
        >
          Skip this one
        </button>
      </div>
    </div>
  );
}
