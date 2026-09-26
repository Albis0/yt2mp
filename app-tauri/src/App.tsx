import { useEffect, useRef, useState } from "react";
import {
  fetchInfo,
  onDownloadProgress,
  startDownload,
  stopDownload,
  type DownloadFormat,
  type DownloadProgress,
  type Mode,
  type Platform,
  type PlaylistInfo,
  type VideoInfo,
} from "@/lib/api";
import {
  addHistory,
  clearHistory,
  loadHistory,
  removeHistory,
  type HistoryItem,
} from "@/lib/history";
import ResultCard from "@/components/ResultCard";
import HistoryList from "@/components/HistoryList";
import PlaylistView from "@/components/PlaylistView";
import SourceRail, { TABS, type TabId } from "@/components/SourceRail";
import WindowControls from "@/components/WindowControls";
import SettingsPanel from "@/components/SettingsPanel";
import ConvertPanel from "@/components/ConvertPanel";
import ScanPanel from "@/components/ScanPanel";
import FirstRun from "@/components/FirstRun";
import AppLogo from "@/components/AppLogo";
import Toaster, { ToneIcon } from "@/components/Toaster";
import ErrorNote from "@/components/ErrorNote";
import { toolsStatus, type ToolsStatus } from "@/lib/api";
import { look } from "@/lib/updater";
import { offerUpdate } from "@/lib/updateFlow";
import { toast } from "@/lib/toast";
import {
  apply as applyTheme,
  loadPref,
  onSystemChange,
  resolve as resolveTheme,
  savePref,
  type ThemePref,
} from "@/lib/theme";

/// A single in-flight or finished download, keyed so the UI can show a
/// progress bar per format button without them interfering.
export interface ActiveDownload {
  key: string; // `${format}-${quality ?? "auto"}`
  id: string; // unique per attempt — pause/stop target this, not key
  format: DownloadFormat;
  quality?: number;
  progress: DownloadProgress;
  done: boolean;
  filePath: string | null;
  error: string | null;
  stopped: boolean;
}

// AI mode chains a Groq call (with key rotation) and then a yt-dlp search —
// a genuinely multi-step, multi-second wait, so the button walks through
// what's actually happening instead of sitting on one static word.
const AI_LOADING_PHRASES = [
  "Reading your request…",
  "Asking AI to turn it into a search…",
  "Still waiting on AI (retrying a key)…",
  "Searching YouTube for a match…",
];

/// One line under the heading on an empty screen, saying what this source
/// takes. The rail already names the source; this says what to do with it,
/// which is the question someone opening the app actually has.
const TAB_LEADS: Record<TabId, string> = {
  youtube: "Paste a video or playlist link to pull the audio or the video.",
  tiktok: "Paste a TikTok link to save the clip.",
  instagram: "Paste a reel or post link to save it.",
  twitter: "Paste a post link to save the video in it.",
  twitch: "Paste a VOD or clip link to save it.",
  other: "Paste a link from almost any video site.",
  ai: "Describe what you're after and yt2mp finds it on YouTube.",
  convert: "Convert audio and video files to MP3 or MP4.",
  scan: "Paste a page address to find the videos on it.",
};

/// Per-tab copy. The placeholder shows the shape of link that tab expects,
/// which is faster to act on than a generic "paste a link" — people
/// recognise their own URLs.
const TAB_PLACEHOLDERS: Record<TabId, string> = {
  youtube: "youtube.com/watch?v=…  ·  or a playlist link",
  tiktok: "tiktok.com/@user/video/…",
  instagram: "instagram.com/reel/…",
  twitter: "x.com/user/status/…",
  twitch: "twitch.tv/videos/…  ·  or a clip link",
  other: "Paste any link",
  ai: "Describe the song or video you want…",
  // The convert tab has no input field — it uses a file picker instead — so
  // this is never rendered. It exists because the record is keyed by tab.
  convert: "",
  // Likewise: the scan tab carries its own input, with its own placeholder.
  scan: "",
};

/// Tabs with a caveat worth stating before the user hits it. Empty string
/// means no notice.
///
/// Written for the person using the app, not for someone who maintains it.
/// The earlier wording leaned on "yt-dlp", "upstream" and "Settings →
/// Updates" — three things that mean nothing to someone who just wants a
/// video. What they need is: is it me or is it them, is there anything I can
/// do, and will it come back. Nothing else belongs here.
const TAB_NOTICES: Partial<Record<TabId, string>> = {
  tiktok:
    "TikTok links not working? Check for updates in Settings.",
  ai: "AI search only looks on YouTube.",
};

/// Tabs whose downloads are known to be failing, surfaced as a dot on the
/// tab itself so it's visible before anyone commits to typing.
const DEGRADED_TABS: Partial<Record<TabId, string>> = {
  // TikTok is deliberately no longer marked degraded. Measured 2026-09-18:
  // the bundled downloader (2026.07.04) fails every link, and the current
  // one (2026.08.19) downloads them — it learned to answer TikTok's
  // challenge. So the tab is not broken, it is out of date, and the notice
  // says where the update button is. A warning dot that stays up after the
  // thing works is how people learn to ignore warning dots.
  // Instagram is no longer marked either. Re-measured 2026-09-26 with no
  // login: public posts and reels download again, and the ones that fail
  // are private or photo-only, which the error on the attempt now says.
};

/// Which tab a pasted URL belongs to, so pasting an Instagram link while the
/// YouTube tab is open switches to Instagram instead of silently downloading
/// under the wrong heading. Mirrors the host matching in src-tauri's
/// platform.rs — kept deliberately simple here because Rust still has the
/// authoritative say once the link is submitted.
function tabForUrl(raw: string): TabId | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const host = url
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .split("@")
    .pop()!
    .split(":")[0]
    .toLowerCase();

  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (["youtube.com", "youtu.be", "youtube-nocookie.com"].some(on)) return "youtube";
  if (["tiktok.com", "vm.tiktok.com"].some(on)) return "tiktok";
  if (["instagram.com", "instagr.am"].some(on)) return "instagram";
  if (["twitter.com", "x.com", "t.co"].some(on)) return "twitter";
  if (on("twitch.tv")) return "twitch";
  return "other";
}

export default function App() {
  const [tab, setTab] = useState<TabId>("youtube");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>({});
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(loadPref);
  // null while the first check is in flight — the window stays empty for that
  // moment rather than flashing the main UI and then covering it.
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  // A conversion runs in Rust the same way a download does, so it has to block
  // the same things: switching tabs away from its Stop button, and installing
  // an update that would kill the process.
  const [converting, setConverting] = useState(false);
  // Downloads started from the page scanner and from a playlist. Each screen
  // owns its own rows, so each reports whether any of them is still running.
  // Kept apart from `converting` so the message names the right thing: the
  // scanner used to share that flag, and told people to finish a
  // "conversion" while they were downloading.
  const [scanBusy, setScanBusy] = useState(false);
  const [playlistBusy, setPlaylistBusy] = useState(false);

  // AI is the one tab that isn't a site — it takes free text rather than a URL.
  const mode: Mode = tab === "ai" ? "ai" : "link";

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Are the external binaries there? On a fresh install they are not, and the
  // first-run screen takes over until they are.
  useEffect(() => {
    toolsStatus()
      .then(setTools)
      // A failure here means the check itself broke, not that the tools are
      // missing. Assume ready rather than blocking a working app behind a
      // download screen it does not need.
      .catch(() => setTools({ ready: true, missing: [], ytdlpVersion: null }));
  }, []);

  // Look for a new version, a few seconds after launch. Deliberately not on
  // mount: opening the app should never wait on the network, and someone who
  // launched it to grab one video will be done before this ever fires.
  useEffect(() => {
    const timer = setTimeout(() => {
      look()
        .then((found) => {
          if (found) offerUpdate(found, () => busyRef.current);
        })
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Paint the resolved theme, and keep following the OS while the preference
  // is "system" — someone whose desktop switches to dark at sunset should see
  // the app switch with it, without restarting.
  useEffect(() => {
    applyTheme(resolveTheme(theme));
    savePref(theme);
    if (theme !== "system") return;
    return onSystemChange(() => applyTheme(resolveTheme("system")));
  }, [theme]);

  async function loadInfo(targetUrl: string, targetMode: Mode) {
    const clean = targetUrl.trim();
    setError(null);
    setInfo(null);
    setPlaylist(null);
    setDownloads({});
    if (!clean) return;

    setLoading(true);
    setLoadingPhrase(0);

    // AI mode genuinely takes longer — step the phrase forward so the button
    // visibly progresses instead of sitting on one word for the whole wait.
    const phraseTimer =
      targetMode === "ai"
        ? setInterval(() => {
            setLoadingPhrase((p) => Math.min(p + 1, AI_LOADING_PHRASES.length - 1));
          }, 2500)
        : null;

    try {
      const data = await fetchInfo(clean, targetMode);
      if (data.kind === "playlist") {
        setPlaylist(data.playlist);
      } else {
        setInfo(data.video);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : "Something went wrong.");
    } finally {
      if (phraseTimer) clearInterval(phraseTimer);
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Fetching clears the board, the same as switching tabs does, and a
    // running download's Stop button goes with it: the transfer carries on
    // in the background with nothing on screen to stop it.
    if (downloadInProgress) {
      waitForDownload("fetching another link");
      return;
    }
    loadInfo(url, mode);
  }

  /// True while any transfer is still running. Two things check it: switching
  /// tabs (which would hide a live download's Stop button) and installing an
  /// update (which would kill the transfer outright). A local conversion
  /// counts for both reasons, so it is folded in here rather than checked
  /// separately at each call site.
  const downloadInProgress =
    converting ||
    scanBusy ||
    playlistBusy ||
    Object.values(downloads).some((d) => !d.done && !d.error && !d.stopped);

  // The update toast outlives this render, so it asks through a ref.
  const busyRef = useRef(downloadInProgress);
  busyRef.current = downloadInProgress;

  /// Said as a toast, not in the error slot: nothing failed, and the error
  /// slot would push the running download's row down the screen.
  function waitForDownload(doing: string) {
    toast({
      id: "busy",
      tone: "warn",
      title: converting ? "A conversion is still running" : "A download is still running",
      body: `Let it finish, or stop it, before ${doing}.`,
    });
  }

  function switchTab(next: TabId) {
    if (next === tab) return;

    // An in-flight download keeps running in Rust regardless of what the UI
    // shows, so clearing the board while one is going would hide a live
    // transfer with no way to get back to its Stop button. Leaving the tab is
    // allowed; wiping the evidence is not.
    if (downloadInProgress) {
      waitForDownload("switching tabs");
      return;
    }

    setTab(next);
    setUrl("");
    setError(null);
    setInfo(null);
    setPlaylist(null);
    setDownloads({});
  }

  /// Typing or pasting a link from another site moves to that site's tab.
  /// The tab is a label for what you're doing, not a filter that rejects
  /// links — being told "wrong tab" for a URL the app can clearly handle
  /// would be pure friction.
  function handleUrlChange(next: string) {
    setUrl(next);
    if (tab === "ai") return; // AI takes prose, not URLs

    const detected = tabForUrl(next);
    // "other" is the catch-all; don't yank someone off a specific tab for it.
    if (detected && detected !== "other" && detected !== tab) {
      setTab(detected);
      setError(null);
    }
  }

  async function beginDownload(format: DownloadFormat, quality?: number) {
    if (!info) return;
    const key = `${format}-${quality ?? "auto"}`;
    const id = crypto.randomUUID();

    // Download must use the resolved page URL, not the raw input: in AI mode
    // the input is a search phrase rather than a URL, and a pasted short link
    // (vm.tiktok.com, t.co) is not what yt-dlp should be handed twice.
    // Falling back to a YouTube watch URL only makes sense for YouTube.
    const videoUrl =
      info.webpageUrl ||
      (info.platform === "youtube"
        ? `https://www.youtube.com/watch?v=${info.id}`
        : url.trim());

    setDownloads((d) => ({
      ...d,
      [key]: {
        key,
        id,
        format,
        quality,
        progress: { percent: 0, stage: "Starting" },
        done: false,
        filePath: null,
        error: null,
        stopped: false,
      },
    }));

    const unsubscribe = onDownloadProgress(id, (progress) =>
      setDownloads((d) => (d[key] ? { ...d, [key]: { ...d[key], progress } } : d))
    );

    try {
      const filePath = await startDownload({
        id,
        url: videoUrl,
        format,
        quality,
        title: info.title,
      });
      setDownloads((d) => ({ ...d, [key]: { ...d[key], done: true, filePath } }));
      setHistory(
        addHistory({
          videoId: info.id,
          url: videoUrl,
          title: info.title,
          thumbnail: info.thumbnail,
          format,
          quality,
          platform: info.platform,
        })
      );
    } catch (err) {
      const message = typeof err === "string" ? err : "Download failed.";
      setDownloads((d) => ({
        ...d,
        [key]: {
          ...d[key],
          error: message,
          stopped: message === "Download stopped",
        },
      }));
    } finally {
      unsubscribe();
    }
  }

  function handleStop(key: string) {
    const dl = downloads[key];
    if (!dl) return;
    stopDownload(dl.id);
  }

  function replayHistory(item: HistoryItem) {
    // Same reason as handleSubmit: this replaces whatever is on screen.
    if (downloadInProgress) {
      waitForDownload("fetching another link");
      return;
    }
    // History stores resolved page URLs whichever tab found them, so a replay
    // always goes through link mode — landing on the tab the item came from.
    setTab(item.platform ?? tabForUrl(item.url) ?? "other");
    setUrl(item.url);
    setError(null);
    setInfo(null);
    setPlaylist(null);
    setDownloads({});
    loadInfo(item.url, "link");
  }

  function handlePlaylistTrackDownloaded(
    videoId: string,
    trackUrl: string,
    title: string,
    thumbnail: string,
    format: DownloadFormat,
    platform: Platform
  ) {
    setHistory(
      addHistory({ videoId, url: trackUrl, title, thumbnail, format, platform })
    );
  }

  // Before the tools exist there is nothing the app can actually do, so the
  // first-run screen replaces the UI rather than sitting on top of it. The
  // chrome stays, because the window still needs to be movable and closable.
  const needsTools = tools !== null && !tools.ready;

  // Nothing fetched and nothing in history: the screen is otherwise a bare
  // input in a black field, so it gets a heading naming the active source and
  // a line saying what that source takes. Once there is a result or a history
  // list on screen the page has its own subject and the heading would just be
  // a second one competing with it.
  // The converter is never "bare": its own list is the subject of the screen
  // from the first file on, and centring it would move the whole list every
  // time a file was added.
  const bare =
    tab !== "convert" && tab !== "scan" && !info && !playlist && history.length === 0;
  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? "yt2mp";

  return (
    // The tab sets --accent for the whole window. Surfaces stay neutral in
    // every tab; only the controls that carry meaning take the colour.
    <div className={`page page-${tab}`}>
      {/* One title bar across the top, source rail down the left. The rail
          used to be a second chrome row, which cost 42px of height on every
          screen — the thing a 768px laptop has least of. */}
      <div className="chrome">
        <div className="chrome-bar">
          {/* Empty space drags the window. It has to come before the buttons
              so a click on one is never swallowed by the drag handler. */}
          <div className="chrome-drag" data-tauri-drag-region>
            <span className="chrome-title">
              <AppLogo size={18} />
              yt2mp
            </span>
          </div>
        <button
          type="button"
          className="chrome-btn"
          aria-label={
            resolveTheme(theme) === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
          title={resolveTheme(theme) === "dark" ? "Light theme" : "Dark theme"}
          // Flips what is on screen, every click. It used to cycle
          // system → light → dark → system, and on a dark desktop the
          // dark → system step changed nothing visible, so going from dark
          // to light took two clicks. "Follow the system" is still one pick
          // away in Settings.
          onClick={() => setTheme(resolveTheme(theme) === "dark" ? "light" : "dark")}
        >
          {resolveTheme(theme) === "dark" ? <MoonIcon /> : <SunIcon />}
        </button>
        <button
          type="button"
          className={`chrome-btn${settingsOpen ? " chrome-btn-on" : ""}`}
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <GearIcon />
          </button>
          <WindowControls />
        </div>
      </div>

      {/* The rail is hidden while the tools are still downloading: it is a
          source picker for a form that cannot run yet. */}
      <div className="body">
        {needsTools ? null : (
          <SourceRail active={tab} onSelect={switchTab} degraded={DEGRADED_TABS} />
        )}

        <div className="body-main">
      {settingsOpen ? (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
          busy={downloadInProgress}
        />
      ) : null}

      {needsTools ? <FirstRun onReady={setTools} /> : null}

      {/* Not merely hidden: the input below autofocuses, and a form that
          cannot work yet should not be holding the caret while the tools it
          depends on are still downloading. */}
      {/* With nothing fetched yet the shell centres itself: otherwise the
          entry field and an empty history sit in a small cluster at the top
          with the rest of the window left as dead space. Once a result or a
          playlist exists there is enough to fill the page and it goes back
          to flowing from the top. */}
      {needsTools ? null : (
      <main className={`app-shell${bare ? " app-shell-empty" : ""}`}>
        <div className="tab-panel" role="tabpanel">
          {/* The converter keeps its heading even once files are listed: it
              is not centred like the empty state, and without it the tab opens
              on a bare "Choose files" button that never says what the tab is
              for. */}
          {bare || tab === "convert" || tab === "scan" ? (
            <div className="entry-head">
              <h1 className="entry-title">{tabLabel}</h1>
              <p className="entry-lead">{TAB_LEADS[tab]}</p>
            </div>
          ) : null}

          {/* The converter takes files, not a link, so it replaces the entry
              form rather than sitting under it — an input that does nothing on
              this tab would be the most prominent dead control on screen. */}
          {tab === "convert" ? (
            <ConvertPanel onBusyChange={setConverting} />
          ) : tab === "scan" ? (
            <ScanPanel onBusyChange={setScanBusy} />
          ) : (
          <form className="download-form" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder={TAB_PLACEHOLDERS[tab]}
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="url-input"
              autoFocus
              spellCheck={false}
            />
            <button
              type="submit"
              className={`submit-btn${loading ? " submit-btn-loading" : ""}`}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="submit-spinner" aria-hidden="true" />
                  {mode === "ai" ? AI_LOADING_PHRASES[loadingPhrase] : "Fetching…"}
                </>
              ) : (
                "Fetch"
              )}
            </button>
          </form>
          )}

          {/* The notice is a warning about what is likely to happen. Once it
              has happened, the error below says the same thing about the
              actual attempt, and showing both stacks two paragraphs of nearly
              identical text on one screen. The error wins: it is about what
              the user just did. */}
          {TAB_NOTICES[tab] && !error ? (
            <div className={`note ${DEGRADED_TABS[tab] ? "note-warn" : "note-info"}`}>
              <span className="note-icon" aria-hidden="true">
                <ToneIcon tone={DEGRADED_TABS[tab] ? "warn" : "info"} />
              </span>
              <p className="note-text note-body">{TAB_NOTICES[tab]}</p>
            </div>
          ) : null}

          {/* Inside the entry column, so on the empty screen it is as wide
              as the field it is about rather than the whole window. */}
          {error ? <ErrorNote message={error} onDismiss={() => setError(null)} /> : null}
        </div>

        {info ? (
          <ResultCard
            info={info}
            downloads={downloads}
            onDownload={beginDownload}
            onStop={handleStop}
          />
        ) : null}

        {playlist ? (
          <PlaylistView
            playlist={playlist}
            onDownloaded={handlePlaylistTrackDownloaded}
            onBusyChange={setPlaylistBusy}
          />
        ) : null}

        {/* History replays a link through the download path, which the
            converter has no equivalent of — its files are already on disk and
            its list is right above. Showing it here would offer a "fetch
            again" button that jumps the user to a different tab. */}
        {tab === "convert" ? null : (
          <HistoryList
            history={history}
            onReplay={replayHistory}
            onRemove={(id) => setHistory(removeHistory(id))}
            onClear={() => setHistory(clearHistory())}
          />
        )}
      </main>
      )}
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/// The title bar's three glyphs, drawn as one set: same 24 grid, same
/// 1.8 stroke, round caps, so they sit beside the window controls as equals.
function ChromeIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SunIcon() {
  return (
    <ChromeIcon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </ChromeIcon>
  );
}

function MoonIcon() {
  return (
    <ChromeIcon>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </ChromeIcon>
  );
}

function GearIcon() {
  return (
    <ChromeIcon>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </ChromeIcon>
  );
}
