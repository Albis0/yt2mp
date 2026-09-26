import { useEffect, useRef, useState } from "react";
import { dismissToast, useToasts, type Toast, type Tone } from "@/lib/toast";

/// How long a non-sticky toast stays. Errors get longer: they are the ones
/// someone might need to read twice.
const LIFETIME: Record<Tone, number> = {
  info: 4200,
  ok: 4200,
  warn: 5500,
  error: 8000,
};

/// Length of the exit animation in styles.css (.toast-out).
const EXIT_MS = 160;

export default function Toaster() {
  const toasts = useToasts();
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<number | null>(null);

  function close() {
    setLeaving(true);
    window.setTimeout(() => dismissToast(toast.id), EXIT_MS);
  }

  // Counts down only while nobody is looking at it. A toast that vanishes
  // under the cursor mid-sentence is the one thing a toast must not do.
  const lives = !toast.sticky && toast.progress === undefined;
  useEffect(() => {
    if (!lives || hovered || leaving) return;
    timer.current = window.setTimeout(close, LIFETIME[toast.tone]);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // Restarting on title/body change gives an updated toast its full time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lives, hovered, leaving, toast.title, toast.body, toast.tone]);

  return (
    <div
      className={`toast toast-${toast.tone}${leaving ? " toast-out" : ""}`}
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="toast-icon" aria-hidden="true">
        <ToneIcon tone={toast.tone} />
      </span>
      <div className="toast-text">
        <p className="toast-title">{toast.title}</p>
        {toast.body ? <p className="toast-body selectable">{toast.body}</p> : null}
        {toast.actions?.length ? (
          <div className="toast-actions">
            {toast.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`toast-btn${a.primary ? " toast-btn-primary" : ""}`}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={close}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {toast.progress !== undefined ? (
        <span
          className={`toast-bar${toast.progress === null ? " toast-bar-wait" : ""}`}
          style={
            toast.progress === null
              ? undefined
              : { transform: `scaleX(${Math.max(0, Math.min(100, toast.progress)) / 100})` }
          }
        />
      ) : null}
    </div>
  );
}

/// One glyph per tone, drawn on the same 24 grid as the title bar icons.
export function ToneIcon({ tone }: { tone: Tone }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tone === "ok" ? (
        <>
          <circle cx="12" cy="12" r="9.25" />
          <path d="M8.2 12.3l2.6 2.6 5-5.4" />
        </>
      ) : tone === "warn" ? (
        <>
          <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9.5v4M12 17h.01" />
        </>
      ) : tone === "error" ? (
        <>
          <circle cx="12" cy="12" r="9.25" />
          <path d="M12 7.8v5M12 16.2h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9.25" />
          <path d="M12 11v5.2M12 7.8h.01" />
        </>
      )}
    </svg>
  );
}
