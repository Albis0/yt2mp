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
  checkYtdlp,
} from "@/lib/api";
import { look, install, openReleasePage, type Available } from "@/lib/updater";
import type { ThemePref } from "@/lib/theme";

const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/// The panel's three pages.
///
/// One scrolling column was the previous shape, and it did not fit: the card
/// ran past the bottom of the window, so the last paragraph was always cut in
/// half and a scrollbar sat down the right edge of a settings dialog. Three
/// short pages fit without scrolling at any window size this app supports, and
/// each page holds one subject, so nothing has to be skimmed past.
type PageId = "general" | "updates" | "accounts";

const PAGES: { id: PageId; label: string; icon: () => React.ReactElement }[] = [
  { id: "general", label: "General", icon: GeneralIcon },
  { id: "updates", label: "Updates", icon: UpdatesIcon },
  { id: "accounts", label: "Accounts", icon: AccountsIcon },
];

function GeneralIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M12 3.4v2.1M12 18.5v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3.4 12h2.1M18.5 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"
      />
    </svg>
  );
}

function UpdatesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4v10m0 0 3.6-3.6M12 14l-3.6-3.6M4.5 16.5v1.8A1.7 1.7 0 0 0 6.2 20h11.6a1.7 1.7 0 0 0 1.7-1.7v-1.8"
      />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M4.8 20a7.2 7.2 0 0 1 14.4 0"
      />
    </svg>
  );
}

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
  const [page, setPage] = useState<PageId>("general");
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [choiceLabel, setChoiceLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProbeStep[]>([]);

  const [version, setVersion] = useState<string | null>(null);
  const [ytdlp, setYtdlp] = useState<string | null>(null);
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [ytdlpNote, setYtdlpNote] = useState<string | null>(null);
  /// Set only once a check has actually found a newer yt-dlp. Until then the
  /// button offers to look, exactly like the app's own update check — it does
  /// not re-download 17 MB to discover nothing changed.
  const [ytdlpNewer, setYtdlpNewer] = useState<string | null>(null);

  const [update, setUpdate] = useState<Available | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    appVersion().then(setVersion).catch(() => {});
    toolsStatus()
      .then((s) => setYtdlp(s.ytdlpVersion))
      .catch(() => {});
  }, []);

  /// Looks for a newer yt-dlp without downloading it. Mirrors the app's own
  /// update check so both rows in this panel behave the same way: ask first,
  /// then offer. The old button always re-downloaded 17 MB and only then said
  /// whether it had been necessary.
  async function runYtdlpCheck() {
    setYtdlpBusy(true);
    setYtdlpNote(null);
    setYtdlpNewer(null);
    try {
      const found = await checkYtdlp();
      if (found.current) setYtdlp(found.current);
      if (found.updateAvailable && found.latest) {
        setYtdlpNewer(found.latest);
      } else if (found.latest) {
        setYtdlpNote("Already on the newest version.");
      } else {
        setYtdlpNote("Could not read the newest version number.");
      }
    } catch (err) {
      setYtdlpNote(
        typeof err === "string" ? err : "Could not check for a new yt-dlp."
      );
    } finally {
      setYtdlpBusy(false);
    }
  }

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
      setYtdlpNewer(null);
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
      return `Your ${names} login was found and accepted, but Instagram is refusing the requests themselves — it rate-limits a device that has asked for too much too quickly. Signing in again will not help, and neither will switching browsers: the block is on your connection, not your account. It clears on its own, usually within a few hours.`;
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
      <div className="prefs" role="dialog" aria-modal="true" aria-label="Settings">
        {/* Sidebar. The same shape as the app's own source rail, so the window
            has one navigation idiom rather than two. */}
        <nav className="prefs-nav" role="tablist" aria-orientation="vertical">
          <span className="prefs-nav-title">Settings</span>
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={page === p.id}
                className={`prefs-tab${page === p.id ? " prefs-tab-on" : ""}`}
                onClick={() => setPage(p.id)}
              >
                <Icon />
                {p.label}
              </button>
            );
          })}
        </nav>

        <div className="prefs-main">
          <div className="prefs-body" role="tabpanel">
            {page === "general" ? (
              <>
                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Theme</span>
                    <span className="prefs-field-hint">
                      Follows your system unless you pick one.
                    </span>
                  </div>
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

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Version</span>
                    <span className="prefs-field-hint">
                      The build running right now.
                    </span>
                  </div>
                  <span className="prefs-value num">{version ?? "…"}</span>
                </div>
              </>
            ) : null}

            {page === "updates" ? (
              <>
                {/* Two rows of one shape: what it is, what version, one
                    control. Both check before they download. */}
                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">yt2mp</span>
                    <span className="prefs-field-hint">
                      {updateNote ?? "The app itself."}
                    </span>
                  </div>
                  <div className="prefs-field-control">
                    <span className="prefs-value num">{version ?? "…"}</span>
                    {update ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          update.canInstall ? install(update) : openReleasePage()
                        }
                      >
                        {update.canInstall
                          ? `Update to ${update.version}`
                          : "Get it from GitHub"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={checkForUpdate}
                        disabled={updateBusy}
                      >
                        {updateBusy ? "Checking…" : "Check"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">yt-dlp</span>
                    <span className="prefs-field-hint">
                      {ytdlpNote ?? "Reads the sites. Update it when one breaks."}
                    </span>
                  </div>
                  <div className="prefs-field-control">
                    <span className="prefs-value num">
                      {ytdlp ?? "missing"}
                    </span>
                    {ytdlpNewer ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={runYtdlpUpdate}
                        disabled={ytdlpBusy}
                      >
                        {ytdlpBusy ? (
                          <>
                            <span className="submit-spinner" aria-hidden="true" />
                            Updating…
                          </>
                        ) : (
                          `Update to ${ytdlpNewer}`
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={runYtdlpCheck}
                        disabled={ytdlpBusy}
                      >
                        {ytdlpBusy ? "Checking…" : "Check"}
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : null}

            {page === "accounts" ? (
              <>
                <p className="prefs-intro">
                  Instagram and TikTok hide most posts from logged-out visitors.
                  yt2mp can borrow the login from a browser you already use.
                </p>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Browser session</span>
                    <span className="prefs-field-hint">
                      {activeLabel ? (
                        <>
                          Using <strong>{activeLabel}</strong>
                        </>
                      ) : (
                        "Not set up yet"
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={runCheck}
                    disabled={checking || !loaded || browsers.length === 0}
                  >
                    {checking ? (
                      <>
                        <span className="submit-spinner" aria-hidden="true" />
                        {probing ? `Trying ${probing}…` : "Checking…"}
                      </>
                    ) : (
                      "Find it for me"
                    )}
                  </button>
                </div>

                {status ? <p className="prefs-note">{status}</p> : null}

                {/* Per-browser results: without them "nothing worked" is
                    unactionable, because a locked browser and a missing login
                    need completely different fixes. */}
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

                {/* The manual list doubles as the answer to "why isn't my
                    browser supported?" — it is the browsers found on this
                    computer, not the browsers the app knows about. */}
                <div className="prefs-field prefs-field-stack">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Or pick one yourself</span>
                    <span className="prefs-field-hint">
                      {loaded && browsers.length === 0
                        ? "No browser found on this computer."
                        : "Found on this computer. Chrome, Brave, Opera and others show up here once installed."}
                    </span>
                  </div>
                  {browsers.length > 0 ? (
                    <div className="chips">
                      <button
                        type="button"
                        className={`chip${choice === null ? " chip-on" : ""}`}
                        onClick={() => choose(null)}
                      >
                        Off
                      </button>
                      {browsers.map((b) => (
                        <button
                          key={b.arg}
                          type="button"
                          className={`chip${choice === b.arg ? " chip-on" : ""}`}
                          onClick={() => choose(b.arg)}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <p className="prefs-fine">
                  No password is ever entered here. The session stays on this
                  computer and is sent only to the site it belongs to.
                </p>
              </>
            ) : null}
          </div>

          {/* Done sits on the card's own footer rather than beside the title:
              it is the way out of the dialog, and it should be in the same
              place no matter which page is open. */}
          <div className="prefs-foot">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={checking}
            >
              Done
            </button>
          </div>
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
      return "signed in — Instagram is rate-limiting this device";
    case "failed":
      return outcome.reason;
  }
}
