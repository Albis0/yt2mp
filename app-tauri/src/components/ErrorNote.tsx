import { ToneIcon } from "@/components/Toaster";

/// Splits a message into a headline and the rest, at the first sentence.
/// The backend writes errors as "What happened. What to do." — the first
/// half is what someone scans for, the second is what they read once they
/// know it applies to them.
function split(message: string): [string, string | null] {
  const text = message.trim();
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text);
  const head = m ? m[1] : text;
  return [head.replace(/\.$/, ""), m ? m[2] : null];
}

/// The inline error under an entry form: what went wrong with the thing just
/// asked for. Stays until dismissed or replaced — unlike a toast, it is about
/// what is on screen right now.
export default function ErrorNote({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  const [title, body] = split(message);
  return (
    <div className="note note-error" role="alert">
      <span className="note-icon" aria-hidden="true">
        <ToneIcon tone="error" />
      </span>
      <div className="note-text">
        <p className="note-title">{title}</p>
        {body ? <p className="note-body selectable">{body}</p> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="note-close" aria-label="Dismiss" onClick={onDismiss}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
