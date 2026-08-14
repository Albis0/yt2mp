import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/// Minimise / maximise / close, drawn by us because the window has no native
/// decorations — the OS title bar was a bright strip that no theme could
/// reach, so it was removed and its three jobs re-implemented here.
///
/// The glyphs are 10x10 strokes rather than font characters: Segoe's window
/// glyphs are not available on Linux, and at this size a stroke is crisper
/// than any font would be.
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  // The maximise glyph has two states, and the window can also be maximised
  // by the OS (double-click on the drag region, Win+Up), so the state is read
  // back from the window rather than assumed from our own clicks.
  useEffect(() => {
    let alive = true;
    win.isMaximized().then((v) => alive && setMaximized(v));
    const unlisten = win.onResized(() => {
      win.isMaximized().then((v) => alive && setMaximized(v));
    });
    return () => {
      alive = false;
      unlisten.then((off) => off());
    };
  }, [win]);

  return (
    <div className="wincontrols">
      <button
        type="button"
        className="wc-btn"
        aria-label="Minimize"
        onClick={() => win.minimize()}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>

      <button
        type="button"
        className="wc-btn"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => win.toggleMaximize()}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path
              d="M2.5 2.5h5v5h-5zM0.5 7.5v-7h7"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="wc-btn wc-close"
        aria-label="Close"
        onClick={() => win.close()}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path
            d="M0 0l10 10M10 0L0 10"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
