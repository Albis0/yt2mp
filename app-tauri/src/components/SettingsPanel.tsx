import { useEffect, useState } from "react";
import {
  browserLabel,
  detectedBrowsers,
  findWorkingBrowser,
  getSettings,
  onLoginProbing,
  saveSettings,
  type Browser,
  type ProbeStep,
  appVersion,
  toolsStatus,
  updateYtdlp,
} from "@/lib/api";
import { look, install, openReleasePage, type Available } from "@/lib/updater";
import type { ThemePref } from "@/lib/theme";

const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/// The login setting.
///
/// There is no password field here on purpose. Instagram treats a password
/// login from an unrecognised client as suspicious and locks accounts over
/// it, and an app asking for someone's social password is the exact shape of
/// a phishing screen. Borrowing the session from a browser the user is
/// already signed into reaches the same posts without the app ever handling a
/// credential.
///
/// The primary control is one button. Asking "which browser are you signed
/// into?" is a question most people cannot answer — they have four browsers
/// and no memory of which one has Instagram open. Testing each one and
/// reporting the answer is faster than making them guess. The manual list
/// stays available underneath for anyone who wants to override the result.
export default function SettingsPanel({
  onClose,
  theme,
  onThemeChange,
}: {
  onClose: () => void;
  theme: ThemePref;
  onThemeChange: (t: ThemePref) => void;
}) {
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [choiceLabel, setChoiceLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProbeStep[]>([]);
  const [showManual, setShowManual] = useState(false);

  const [version, setVersion] = useState<string | null>(null);
  const [ytdlp, setYtdlp] = useState<string | null>(null);
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [ytdlpNote, setYtdlpNote] = useState<string | null>(null);

  const [update, setUpdate] = useState<Available | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    appVersion().then(setVersion).catch(() => {});
    toolsStatus()
      .then((s) => setYtdlp(s.ytdlpVersion))
      .catch(() => {});
  }, []);

  /// Re-downloads yt-dlp. This is the fix for "TikTok stopped working" — the
  /// extractor breaks upstream, yt-dlp ships a fix within days, and before
  /// this button existed the only way to get it was a whole new yt2mp build.
  async function runYtdlpUpdate() {
    setYtdlpBusy(true);
    setYtdlpNote(null);
    const before = ytdlp;
    try {
      const s = await updateYtdlp();
      setYtdlp(s.ytdlpVersion);
      setYtdlpNote(
        s.ytdlpVersion && s.ytdlpVersion !== before
          ? `Updated to ${s.ytdlpVersion}.`
          : "Already on the newest version."
      );
    } catch (err) {
      setYtdlpNote(
        typeof err === "string" ? err : "Could not update yt-dlp just now."
      );
    } finally {
      setYtdlpBusy(false);
    }
  }

  async function checkForUpdate() {
    setUpdateBusy(true);
    setUpdateNote(null);
    try {
      const found = await look();
      setUpdate(found);
      if (!found) setUpdateNote("yt2mp is up to date.");
    } catch {
      setUpdateNote("Could not check for updates. Are you online?");
    } finally {
      setUpdateBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([getSettings(), detectedBrowsers()])
      .then(async ([settings, found]) => {
        setChoice(settings.cookiesFrom);
        setBrowsers(found);
        if (settings.cookiesFrom) {
          setChoiceLabel(await browserLabel(settings.cookiesFrom));
        }
        setLoaded(true);
      })
      .catch(() => {
        setStatus("Could not read the current settings.");
        setLoaded(true);
      });
  }, []);

  async function runCheck() {
    setChecking(true);
    setSteps([]);
    setStatus(null);
    // Live per-browser progress: the check runs several network round-trips
    // and a frozen button for that long reads as a hang.
    const stop = onLoginProbing(setProbing);
    try {
      const result = await findWorkingBrowser();
      setSteps(result);

      const winner = result.find((s) => s.outcome.status === "works");
      if (winner) {
        setChoice(winner.arg);
        setChoiceLabel(winner.label);
        setStatus(`Signed in with ${winner.label}. Instagram should work now.`);
      } else {
        // The backend clears the stored browser when nothing passed, so the
        // panel must not keep showing the old one as active.
        setChoice(null);
        setChoiceLabel(null);
        setStatus(summarizeFailure(result));
      }
    } catch (err) {
      setStatus(typeof err === "string" ? err : "The check could not run.");
    } finally {
      stop();
      setProbing(null);
      setChecking(false);
    }
  }

  /// Turns "nothing worked" into the specific reason, because the fix differs
  /// completely between them: a locked browser needs closing, an absent login
  /// needs signing in, and an upstream block needs waiting.
  function summarizeFailure(result: ProbeStep[]): string {
    const blocked = result.filter(
      (s) => s.outcome.status === "signedinbutblocked"
    );
    const locked = result.filter((s) => s.outcome.status === "locked");

    // Stated first because it is the one case where the user is already
    // logged in and every "sign in again" instruction would be wrong.
    if (blocked.length > 0) {
      const names = blocked.map((s) => s.label).join(" and ");
      return `Your ${names} login was found and accepted, but Instagram is refusing the download request itself. This is a fault on Instagram's side that yt-dlp has to catch up with — signing in again will not help. It usually starts working after a yt-dlp update.`;
    }
    if (locked.length > 0 && locked.length === result.length) {
      return `Close ${locked
        .map((s) => s.label)
        .join(" and ")} and run the check again — a running browser locks its own session file.`;
    }
    if (locked.length > 0) {
      return `No browser was signed in to Instagram. ${locked
        .map((s) => s.label)
        .join(" and ")} could not be read while running — close it and retry, or sign in to Instagram in one of your browsers.`;
    }
    return "None of your browsers is signed in to Instagram. Sign in to Instagram in any browser, then run the check again.";
  }

  async function choose(next: string | null) {
    // Render what was actually stored rather than what was clicked, so the
    // panel can never show a setting as active when saving it failed.
    try {
      const stored = await saveSettings({ cookiesFrom: next });
      setChoice(stored.cookiesFrom);
      setChoiceLabel(
        stored.cookiesFrom ? await browserLabel(stored.cookiesFrom) : null
      );
      setStatus(
        stored.cookiesFrom ? null : "Not using any browser session."
      );
    } catch (err) {
      setStatus(typeof err === "string" ? err : "Could not save that.");
    }
  }

  const activeLabel = choiceLabel ?? choice;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        // Clicking the backdrop closes; clicking inside the card must not.
        if (e.target === e.currentTarget && !checking) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="settings-head">
          <h2 className="settings-title">Settings</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            disabled={checking}
          >
            Done
          </button>
        </div>

        <div className="settings-section">
          <span className="settings-label">Appearance</span>
          <div className="theme-switch" role="group" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`theme-opt${theme === opt.id ? " theme-opt-on" : ""}`}
                aria-pressed={theme === opt.id}
                onClick={() => onThemeChange(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <span className="settings-label">Downloading tools</span>
          <p className="settings-body">
            yt-dlp is what reads each site. Sites change often and break it;
            updating it here usually fixes a tab that stopped working, without
            waiting for a new version of yt2mp.
          </p>
          <p className="settings-active">
            yt-dlp <span className="num">{ytdlp ?? "not installed"}</span>
          </p>
          <button
            type="button"
            className="settings-primary"
            onClick={runYtdlpUpdate}
            disabled={ytdlpBusy}
          >
            {ytdlpBusy ? (
              <>
                <span className="submit-spinner" aria-hidden="true" />
                Updating yt-dlp…
              </>
            ) : (
              "Update yt-dlp"
            )}
          </button>
          {ytdlpNote ? <p className="settings-status">{ytdlpNote}</p> : null}
        </div>

        <div className="settings-section">
          <span className="settings-label">Version</span>
          <p className="settings-active">
            yt2mp <span className="num">{version ?? "…"}</span>
          </p>
          {update ? (
            <>
              <p className="settings-body">
                Version <span className="num">{update.version}</span> is
                available.
              </p>
              <button
                type="button"
                className="settings-primary"
                onClick={() =>
                  update.canInstall ? install(update) : openReleasePage()
                }
              >
                {update.canInstall ? "Install it now" : "Get it from GitHub"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="settings-choice"
              onClick={checkForUpdate}
              disabled={updateBusy}
            >
              {updateBusy ? "Checking…" : "Check for updates"}
            </button>
          )}
          {updateNote ? <p className="settings-status">{updateNote}</p> : null}
        </div>

        <div className="settings-section">
          <span className="settings-label">Instagram &amp; TikTok login</span>
          <p className="settings-body">
            These sites hide most posts from logged-out visitors. yt2mp can
            borrow the login from a browser you are already signed into.
          </p>

        <button
          type="button"
          className="settings-primary"
          onClick={runCheck}
          disabled={checking || !loaded || browsers.length === 0}
        >
          {checking ? (
            <>
              <span className="submit-spinner" aria-hidden="true" />
              {probing ? `Trying ${probing}…` : "Checking…"}
            </>
          ) : (
            "Find my login automatically"
          )}
        </button>

        {loaded && browsers.length === 0 ? (
          <p className="settings-body settings-body-dim">
            No browser was found on this computer.
          </p>
        ) : null}

        {activeLabel ? (
          <p className="settings-active">
            Currently using <strong>{activeLabel}</strong>
          </p>
        ) : (
          <p className="settings-body settings-body-dim">
            Not using any browser session.
          </p>
        )}

        {status ? <p className="settings-status">{status}</p> : null}

        {/* Per-browser results: without them "nothing worked" is unactionable,
            because the user cannot tell a locked browser from a missing login. */}
        {steps.length > 0 ? (
          <ul className="probe-list">
            {steps.map((s) => (
              <li key={s.arg} className="probe-row">
                <span className={`probe-mark probe-${s.outcome.status}`}>
                  {s.outcome.status === "works"
                    ? "✓"
                    : s.outcome.status === "signedinbutblocked"
                      ? "!"
                      : "×"}
                </span>
                <span className="probe-name">{s.label}</span>
                <span className="probe-note">{describe(s.outcome)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          className="settings-link"
          onClick={() => setShowManual((v) => !v)}
        >
          {showManual ? "Hide manual choice" : "Choose a browser myself"}
        </button>

        {showManual ? (
          <div className="settings-choices">
            <button
              type="button"
              className={`settings-choice${choice === null ? " settings-choice-on" : ""}`}
              onClick={() => choose(null)}
            >
              Off
            </button>
            {browsers.map((b) => (
              <button
                key={b.arg}
                type="button"
                className={`settings-choice${choice === b.arg ? " settings-choice-on" : ""}`}
                onClick={() => choose(b.arg)}
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : null}

          <p className="settings-body settings-body-dim">
            Your password is never entered here. The session is read from this
            computer and sent only to the site it belongs to — downloads from
            YouTube, X and Twitch never carry it.
          </p>
        </div>
      </div>
    </div>
  );
}

function describe(outcome: ProbeStep["outcome"]): string {
  switch (outcome.status) {
    case "works":
      return "signed in";
    case "notsignedin":
      return "not signed in to Instagram";
    case "locked":
      return "close this browser and retry";
    case "signedinbutblocked":
      return "signed in, but Instagram refused the request";
    case "failed":
      return outcome.reason;
  }
}
