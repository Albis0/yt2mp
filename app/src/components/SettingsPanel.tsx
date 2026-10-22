import { useEffect, useState } from "react";
import {
  browserLabel,
  chooseDownloadDir,
  forgetDownloadDir,
  detectedBrowsers,
  findWorkingBrowser,
  getSettings,
  onLoginProbing,
  saveSettings,
  type Browser,
  type ProbeStep,
  aiUsage,
  setGroqKey,
  type AiUsage,
  appVersion,
  toolsStatus,
  updateYtdlp,
  checkYtdlp,
} from "@/lib/api";
import { look, type Available } from "@/lib/updater";
import { installUpdate as runInstall } from "@/lib/updateFlow";
import { reason, toast } from "@/lib/toast";
import type { ThemePref } from "@/lib/theme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitHubLogo } from "@/components/BrandLogos";
import { TABS } from "@/components/SourceRail";
import { clearHistory } from "@/lib/history";
import { clearBrowsingData } from "@/lib/browser";
import { loadPrefs, resetPrefs, savePrefs, type Prefs, type SearchEngine } from "@/lib/prefs";

const REPO = "Albis0/yt2mp";

const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/// The panel's pages.
///
/// One scrolling column was the first shape, and it did not fit: the card ran
/// past the bottom of the window, so the last paragraph was always cut in half
/// and a scrollbar sat down the right edge of a settings dialog. Short pages
/// fit without scrolling at any window size this app supports, and each page
/// holds one subject, so nothing has to be skimmed past. "General" used to
/// hold the theme, the folder and the version together; it is now three pages
/// so each setting is found by what it is, not by where it was left.
type PageId =
  | "appearance"
  | "downloads"
  | "history"
  | "accounts"
  | "ai"
  | "browser"
  | "updates"
  | "about";

const PAGES: { id: PageId; label: string; icon: () => React.ReactElement }[] = [
  { id: "appearance", label: "Appearance", icon: AppearanceIcon },
  { id: "downloads", label: "Downloads", icon: DownloadsIcon },
  { id: "history", label: "History", icon: HistoryPageIcon },
  { id: "accounts", label: "Accounts", icon: AccountsIcon },
  { id: "ai", label: "AI", icon: AiIcon },
  { id: "browser", label: "Browser", icon: BrowserIcon },
  { id: "updates", label: "Updates", icon: UpdatesIcon },
  { id: "about", label: "About", icon: AboutIcon },
];

function DownloadsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h4l1.8 2.2h7.8a1.7 1.7 0 0 1 1.7 1.7v8.4a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z"
      />
    </svg>
  );
}

function HistoryPageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7.6V12l3 2"
      />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        d="M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z"
      />
    </svg>
  );
}

function BrowserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        d="M3.8 12h16.4M12 3.6c2.4 2.3 3.6 5.1 3.6 8.4s-1.2 6.1-3.6 8.4c-2.4-2.3-3.6-5.1-3.6-8.4S9.6 5.9 12 3.6z"
      />
    </svg>
  );
}

/// On and off as two buttons, the way the theme is chosen: both states are
/// always in view, which a bare switch does not give.
function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <div className="theme-switch" role="group" aria-label={label}>
      <button
        type="button"
        className={`theme-opt${on ? " theme-opt-on" : ""}`}
        aria-pressed={on}
        onClick={() => onChange(true)}
      >
        On
      </button>
      <button
        type="button"
        className={`theme-opt${on ? "" : " theme-opt-on"}`}
        aria-pressed={!on}
        onClick={() => onChange(false)}
      >
        Off
      </button>
    </div>
  );
}

/// "5 h 12 min", "40 min": how long until the daily counters start again.
function timeLeft(secs: number): string {
  const mins = Math.max(1, Math.ceil(secs / 60));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} h ${mins % 60} min` : `${mins} min`;
}

const ENGINES: { id: SearchEngine; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "duckduckgo", label: "DuckDuckGo" },
  { id: "bing", label: "Bing" },
];

const KEEP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
];

function AboutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M12 11v5M12 8v.01"
      />
    </svg>
  );
}

function AppearanceIcon() {
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
  busy,
}: {
  onClose: () => void;
  theme: ThemePref;
  onThemeChange: (t: ThemePref) => void;
  /** A download or conversion is running. Installing an update restarts the
   *  app and replacing yt-dlp swaps the program a download is running on, so
   *  both wait until it is done, the same as the update banner does. */
  busy: boolean;
}) {
  const [page, setPage] = useState<PageId>("appearance");
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
  /// Set only once a check has actually found a newer yt-dlp. Until then the
  /// button offers to look, exactly like the app's own update check — it does
  /// not re-download 17 MB to discover nothing changed.
  const [ytdlpNewer, setYtdlpNewer] = useState<string | null>(null);

  const [update, setUpdate] = useState<Available | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [installing, setInstalling] = useState(false);

  const [downloadDir, setDownloadDir] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [browsingCleared, setBrowsingCleared] = useState(false);

  function setPref(change: Partial<Prefs>) {
    setPrefs(savePrefs(change));
  }

  /// Checks the key with Groq before keeping it, so a typo is caught here and
  /// not on the next search.
  async function saveKey() {
    setKeyBusy(true);
    try {
      setUsage(await setGroqKey(keyDraft));
      setKeyDraft("");
      toast({ tone: "ok", title: "Key saved", body: "AI now runs on your key, with no daily limit." });
    } catch (err) {
      toast({ tone: "error", title: "That key did not work", body: reason(err, "Try again.") });
    } finally {
      setKeyBusy(false);
    }
  }

  async function removeKey() {
    setKeyBusy(true);
    try {
      setUsage(await setGroqKey(null));
    } catch (err) {
      toast({ tone: "error", title: "Could not remove the key", body: reason(err, "Try again.") });
    } finally {
      setKeyBusy(false);
    }
  }

  useEffect(() => {
    appVersion().then(setVersion).catch(() => {});
    aiUsage().then(setUsage).catch(() => {});
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
    setYtdlpNewer(null);
    try {
      const found = await checkYtdlp();
      if (found.current) setYtdlp(found.current);
      if (found.updateAvailable && found.latest) {
        setYtdlpNewer(found.latest);
      } else if (found.latest) {
        toast({ tone: "ok", title: "yt-dlp is up to date" });
      } else {
        toast({ tone: "error", title: "Couldn't read the newest yt-dlp version" });
      }
    } catch (err) {
      toast({
        tone: "error",
        title: "Couldn't check for yt-dlp updates",
        body: reason(err, "Are you online?"),
      });
    } finally {
      setYtdlpBusy(false);
    }
  }

  /// Re-downloads yt-dlp. This is the fix for "TikTok stopped working" — the
  /// extractor breaks upstream, yt-dlp ships a fix within days, and before
  /// this button existed the only way to get it was a whole new yt2mp build.
  async function runYtdlpUpdate() {
    setYtdlpBusy(true);
    const before = ytdlp;
    try {
      const s = await updateYtdlp();
      setYtdlp(s.ytdlpVersion);
      setYtdlpNewer(null);
      toast(
        s.ytdlpVersion && s.ytdlpVersion !== before
          ? { tone: "ok", title: "yt-dlp updated", body: `Now on ${s.ytdlpVersion}.` }
          : { tone: "ok", title: "yt-dlp is up to date" }
      );
    } catch (err) {
      toast({
        tone: "error",
        title: "yt-dlp didn't update",
        body: reason(err, "Try again in a moment."),
      });
    } finally {
      setYtdlpBusy(false);
    }
  }

  /** Same flow as the toast's Update button: progress and any failure show
   *  up as a toast, so this only has to keep the button from being pressed
   *  twice. */
  async function installUpdate(found: Available) {
    setInstalling(true);
    const ok = await runInstall(found, () => busy);
    if (!ok) setInstalling(false);
  }

  async function checkForUpdate() {
    setUpdateBusy(true);
    try {
      const found = await look();
      setUpdate(found);
      if (!found) toast({ tone: "ok", title: "yt2mp is up to date" });
    } catch {
      toast({ tone: "error", title: "Couldn't check for updates", body: "Are you online?" });
    } finally {
      setUpdateBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([getSettings(), detectedBrowsers()])
      .then(async ([settings, found]) => {
        setChoice(settings.cookiesFrom);
        setDownloadDir(settings.downloadDir);
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
    //
    // The old wording promised this clears "usually within a few hours",
    // which was measured to be wrong: with a working session, every Instagram
    // path fails and each one fails differently (a post gives HTTP 400, a
    // profile gives "unable to extract data"), while instagram.com itself
    // still loads normally in a browser. That is Instagram refusing yt-dlp's
    // API, not a per-device rate limit, and it does not lift on a timer.
    // Promising it will is worse than saying nothing, so this now says what
    // is actually known and points at the only thing that has ever fixed it.
    // Kept short on purpose. This sits directly above the per-browser results,
    // which are the more useful half — a longer explanation pushed them out of
    // view and put a scrollbar on the page.
    //
    // No tool names here either: someone reading this wants to know whether
    // they broke something and what to press next, not which program is doing
    // the downloading.
    if (blocked.length > 0) {
      const names = blocked.map((s) => s.label).join(" and ");
      return `Your ${names} login works. Instagram is blocking downloads right now, so signing in again won't help.`;
    }
    if (locked.length > 0 && locked.length === result.length) {
      const names = locked.map((s) => s.label).join(" and ");
      const them = locked.length > 1 ? "them" : "it";
      return `Close ${names} (check the system tray too) and try again. The login can't be read while ${them === "them" ? "they're" : "it's"} open.`;
    }
    if (locked.length > 0) {
      const names = locked.map((s) => s.label).join(" and ");
      return `None of your browsers is signed in to Instagram. ${names} couldn't be checked while open; close ${locked.length > 1 ? "them" : "it"} and try again.`;
    }
    return "None of your browsers is signed in to Instagram. Sign in to Instagram in any browser, then check again.";
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

  async function changeDownloadDir() {
    try {
      const stored = await chooseDownloadDir();
      if (!stored) return;
      setDownloadDir(stored.downloadDir);
      toast({ tone: "ok", title: "Download folder changed", body: stored.downloadDir ?? undefined });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't use that folder", body: reason(err, "Pick another one.") });
    }
  }

  async function askNextTime() {
    try {
      const stored = await forgetDownloadDir();
      setDownloadDir(stored.downloadDir);
      toast({ tone: "info", title: "Your next download asks where to save" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save that", body: reason(err, "Try again.") });
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
            {page === "appearance" ? (
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

                <div className="prefs-field prefs-field-stack">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Open on</span>
                    <span className="prefs-field-hint">The tab you land on when yt2mp starts.</span>
                  </div>
                  <div className="chips">
                    {TABS.filter((tab) => tab.id !== "history").map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`chip${prefs.startTab === tab.id ? " chip-on" : ""}`}
                        onClick={() => setPref({ startTab: tab.id })}
                      >
                        {tab.short}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            {page === "downloads" ? (
              <>
                {/* Downloads save here without a dialog. The first download
                    asks for it; this is where it changes afterwards. */}
                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Download folder</span>
                    <span className="prefs-field-hint prefs-path" title={downloadDir ?? undefined}>
                      {downloadDir ?? "Not chosen yet. Your next download asks where to save."}
                    </span>
                  </div>
                  <div className="prefs-field-control">
                    {downloadDir ? (
                      <button type="button" className="btn" onClick={askNextTime}>
                        Ask next time
                      </button>
                    ) : null}
                    <button type="button" className="btn" onClick={changeDownloadDir}>
                      {downloadDir ? "Change…" : "Choose…"}
                    </button>
                  </div>
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Show the file when done</span>
                    <span className="prefs-field-hint">Opens its folder with the file selected.</span>
                  </div>
                  <Toggle
                    on={prefs.openWhenDone}
                    onChange={(v) => setPref({ openWhenDone: v })}
                    label="Show the file when done"
                  />
                </div>
              </>
            ) : null}

            {page === "about" ? (
              <>
                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Source code</span>
                    <span className="prefs-field-hint">
                      Releases and changelog.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn repo-link"
                    onClick={() => openUrl(`https://github.com/${REPO}`)}
                    title={`github.com/${REPO}`}
                  >
                    <GitHubLogo />
                    {REPO}
                  </button>
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

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Reset preferences</span>
                    <span className="prefs-field-hint">
                      Back to how yt2mp came. Your history and theme stay.
                    </span>
                  </div>
                  <button type="button" className="btn" onClick={() => setPrefs(resetPrefs())}>
                    Reset
                  </button>
                </div>
              </>
            ) : null}

            {page === "history" ? (
              <>
                <div className="prefs-field prefs-field-stack">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Keep the last</span>
                    <span className="prefs-field-hint">
                      Downloads remembered in the History tab. Off remembers nothing.
                    </span>
                  </div>
                  <div className="chips">
                    {KEEP_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className={`chip${prefs.historyKeep === o.value ? " chip-on" : ""}`}
                        onClick={() => setPref({ historyKeep: o.value })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Pictures</span>
                    <span className="prefs-field-hint">Show each video's picture in the list.</span>
                  </div>
                  <Toggle
                    on={prefs.historyThumbs}
                    onChange={(v) => setPref({ historyThumbs: v })}
                    label="Pictures in history"
                  />
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Clear history</span>
                    <span className="prefs-field-hint">
                      {historyCleared ? "Cleared." : "Removes every saved download from the list."}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={historyCleared}
                    onClick={() => {
                      clearHistory();
                      setHistoryCleared(true);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : null}

            {page === "ai" ? (
              <>
                <p className="prefs-intro">
                  AI search and the check of Spotify matches share a small daily allowance. A
                  Groq key of your own removes the limit.
                </p>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">AI search</span>
                    <span className="prefs-field-hint">
                      {usage?.ownKey
                        ? "No limit, on your key."
                        : usage && usage.resetsIn > 0
                          ? `Starts again in ${timeLeft(usage.resetsIn)}.`
                          : "Resets every 24 hours."}
                    </span>
                  </div>
                  <span className="prefs-value num">
                    {usage?.ownKey ? "∞" : usage ? `${usage.searchUsed} / ${usage.limit}` : "…"}
                  </span>
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Spotify check</span>
                    <span className="prefs-field-hint">
                      {usage?.ownKey
                        ? "No limit, on your key."
                        : "Past the limit, songs are matched without the check."}
                    </span>
                  </div>
                  <span className="prefs-value num">
                    {usage?.ownKey ? "∞" : usage ? `${usage.verifyUsed} / ${usage.limit}` : "…"}
                  </span>
                </div>

                <div className="prefs-field prefs-field-stack">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Your Groq key</span>
                    <span className="prefs-field-hint">
                      {usage?.ownKey ? (
                        <>
                          Using your key <strong>{usage.keyHint}</strong>
                        </>
                      ) : (
                        <>
                          Free at console.groq.com. It stays on this computer and is only sent to
                          Groq.
                        </>
                      )}
                    </span>
                  </div>
                  {usage?.ownKey ? (
                    <div className="prefs-input-row">
                      <button type="button" className="btn" onClick={removeKey} disabled={keyBusy}>
                        Remove key
                      </button>
                    </div>
                  ) : (
                    <form
                      className="prefs-input-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (keyDraft.trim()) saveKey();
                      }}
                    >
                      <input
                        type="password"
                        className="prefs-input"
                        placeholder="gsk_…"
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label="Groq API key"
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={keyBusy || !keyDraft.trim()}
                      >
                        {keyBusy ? "Checking…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openUrl("https://console.groq.com/keys")}
                      >
                        Get a key
                      </button>
                    </form>
                  )}
                </div>
              </>
            ) : null}

            {page === "browser" ? (
              <>
                <div className="prefs-field prefs-field-stack">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Search engine</span>
                    <span className="prefs-field-hint">
                      What the address bar searches with when you type words.
                    </span>
                  </div>
                  <div className="chips">
                    {ENGINES.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className={`chip${prefs.searchEngine === e.id ? " chip-on" : ""}`}
                        onClick={() => setPref({ searchEngine: e.id })}
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Recent pages on a new tab</span>
                    <span className="prefs-field-hint">
                      The list under the shortcuts. Off keeps the page to the search field and
                      the sites.
                    </span>
                  </div>
                  <Toggle
                    on={prefs.startHistory}
                    onChange={(v) => setPref({ startHistory: v })}
                    label="Recent pages on a new tab"
                  />
                </div>

                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Clear browsing data</span>
                    <span className="prefs-field-hint">
                      {browsingCleared
                        ? "Cleared."
                        : "Forgets visited pages, cookies and the cache, which signs you out of sites. Also the fix when a site (TikTok, say) shows Access denied. Starred sites stay."}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={browsingCleared}
                    onClick={() => {
                      clearBrowsingData();
                      setBrowsingCleared(true);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : null}

            {page === "updates" ? (
              <>
                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">Check when yt2mp starts</span>
                    <span className="prefs-field-hint">
                      A few seconds after launch, never before the window is usable.
                    </span>
                  </div>
                  <Toggle
                    on={prefs.checkOnLaunch}
                    onChange={(v) => setPref({ checkOnLaunch: v })}
                    label="Check for updates when yt2mp starts"
                  />
                </div>

                {/* Two rows of one shape: what it is, what version, one
                    control. Both check before they download. */}
                <div className="prefs-field">
                  <div className="prefs-field-text">
                    <span className="prefs-field-name">yt2mp</span>
                    <span className="prefs-field-hint">
                      The app itself.
                    </span>
                  </div>
                  <div className="prefs-field-control">
                    <span className="prefs-value num">{version ?? "…"}</span>
                    {update ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => installUpdate(update)}
                        disabled={installing || (busy && update.canInstall)}
                        title={
                          busy && update.canInstall
                            ? "Finish your download first, then update."
                            : undefined
                        }
                      >
                        {installing
                          ? "Updating…"
                          : update.canInstall
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
                    {/* The name stays as-is: it labels a version number, and
                        renaming it to something friendlier would make the
                        version meaningless. The line under it does the
                        explaining instead. */}
                    <span className="prefs-field-name">yt-dlp</span>
                    <span className="prefs-field-hint">
                      The part that fetches videos. Update it if a site stops working.
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
                        disabled={ytdlpBusy || busy}
                        title={busy ? "Finish your download first, then update." : undefined}
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
                        : "Browsers installed on this PC."}
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
                  yt2mp never asks for a password. Cookies are only sent to the
                  site they belong to.
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
      // Says *why* it could not be read. A bare "close this browser and
      // retry" reads as an arbitrary demand when a Firefox-family browser on
      // the same list was tested fine while open.
      return "open, close it and check again";
    case "signedinbutblocked":
      // Not "rate-limiting this device": measured, the block applies
      // generally, not to this connection's request rate.
      return "signed in, but Instagram is blocking downloads";
    case "failed":
      return outcome.reason;
  }
}
