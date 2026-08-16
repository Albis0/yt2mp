import { useEffect, useState } from "react";
import {
  fetchInfo,
  onDownloadProgress,
  pauseDownload,
  resumeDownload,
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
import FirstRun from "@/components/FirstRun";
import UpdateBanner from "@/components/UpdateBanner";
import { toolsStatus, type ToolsStatus } from "@/lib/api";
import { look, type Available } from "@/lib/updater";
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
  paused: boolean;
  /** Drives whether pause/resume is offered at all — see supportsPause. */
  estimatedBytes: number | null;
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
  other: "Paste any link — yt-dlp handles around 1750 sites.",
  ai: "Describe what you're after and yt2mp finds it on YouTube.",
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
  other: "Paste any link — yt-dlp supports ~1750 sites",
  ai: "Describe the song or video you want…",
};

/// Tabs with a caveat worth stating before the user hits it. Empty string
/// means no notice.
const TAB_NOTICES: Partial<Record<TabId, string>> = {
  tiktok:
    "TikTok downloads are broken upstream right now — yt-dlp can't read its pages. It'll start working again on a yt-dlp update, with no change here.",
  instagram:
    "Instagram is currently refusing yt-dlp even with a working login, so most posts fail right now — this is upstream, not something a setting here fixes. It'll start working again on a yt-dlp update (Settings → Updates). Setting up a browser login is still worth doing: it's needed for private and follower-only posts once Instagram accepts requests again.",
  ai: "AI search looks on YouTube only. For the other sites, paste a link.",
};

/// Tabs whose downloads are known to be failing, surfaced as a dot on the
/// tab itself so it's visible before anyone commits to typing.
const DEGRADED_TABS: Partial<Record<TabId, string>> = {
  tiktok: "Currently broken upstream in yt-dlp",
  // Measured: with a session Instagram accepts, every path still fails —
  // a post with HTTP 400, a profile with "unable to extract data" — while
  // instagram.com loads fine in a browser. Marking the tab is more honest
  // than letting someone paste a link and hit a wall, and it stops the
  // failure reading as "my login is set up wrong".
  instagram: "Instagram is refusing yt-dlp right now",
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
  const [update, setUpdate] = useState<Available | null>(null);

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
      look().then(setUpdate).catch(() => {});
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
    loadInfo(url, mode);
  }

  /// True while any transfer is still running. Two things check it: switching
  /// tabs (which would hide a live download's Stop button) and installing an
  /// update (which would kill the transfer outright).
  const downloadInProgress = Object.values(downloads).some(
    (d) => !d.done && !d.error && !d.stopped
  );

  function switchTab(next: TabId) {
    if (next === tab) return;

    // An in-flight download keeps running in Rust regardless of what the UI
    // shows, so clearing the board while one is going would hide a live
    // transfer with no way to get back to its Stop button. Leaving the tab is
    // allowed; wiping the evidence is not.
    if (downloadInProgress) {
      setError("Finish or stop the download in progress before switching tabs.");
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

    // The size estimate for this specific button: the matching quality's
    // merged size for MP4, or the audio stream's size for MP3.
    const estimatedBytes =
      format === "mp3"
        ? info.audioEstimatedBytes
        : (info.qualities.find((q) => q.height === quality)?.estimatedBytes ??
          info.qualities[0]?.estimatedBytes ??
          null);

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
        paused: false,
        estimatedBytes,
      },
    }));

    // Rust reports "Paused"/"Downloading" as the stage when a suspend or
    // resume actually took effect, so the button state follows the process
    // rather than optimistically flipping on click.
    const unsubscribe = onDownloadProgress(id, (progress) =>
      setDownloads((d) =>
        d[key]
          ? {
              ...d,
              [key]: {
                ...d[key],
                progress,
                paused: progress.stage === "Paused",
              },
            }
          : d
      )
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

  function handlePause(key: string) {
    const dl = downloads[key];
    if (!dl) return;
    pauseDownload(dl.id);
  }

  function handleResume(key: string) {
    const dl = downloads[key];
    if (!dl) return;
    resumeDownload(dl.id);
  }

  // Stopped downloads can't resume from a byte offset (yt-dlp/ffmpeg
  // re-transcode from scratch every run) — restart starts a fresh download.
  function handleRestart(key: string) {
    const dl = downloads[key];
    if (!dl) return;
    beginDownload(dl.format, dl.quality);
  }

  function replayHistory(item: HistoryItem) {
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
  const bare = !info && !playlist && history.length === 0;
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
            <span className="chrome-title">yt2mp</span>
          </div>
        <button
          type="button"
          className="chrome-btn"
          aria-label={
            theme === "system"
              ? "Theme: following the system. Switch to light."
              : theme === "light"
                ? "Theme: light. Switch to dark."
                : "Theme: dark. Follow the system."
          }
          title="Theme"
          // Cycles system → light → dark → system, so every state including
          // "follow the system" is reachable from the chrome without opening
          // settings. The same three states are named explicitly in the
          // settings modal for anyone who wants to pick directly.
          onClick={() =>
            setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"))
          }
        >
          {resolveTheme(theme) === "dark" ? (
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" fill="currentColor" />
              <path
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={`chrome-btn${settingsOpen ? " chrome-btn-on" : ""}`}
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4zm7.4-1.3a7.6 7.6 0 0 0 0-1.8l1.7-1.3a.5.5 0 0 0 .1-.6l-1.6-2.8a.5.5 0 0 0-.6-.2l-2 .8a7.4 7.4 0 0 0-1.5-.9l-.3-2.1a.5.5 0 0 0-.5-.4h-3.2a.5.5 0 0 0-.5.4l-.3 2.1c-.6.2-1 .5-1.5.9l-2-.8a.5.5 0 0 0-.6.2L4.5 9.2a.5.5 0 0 0 .1.6l1.7 1.3a7.6 7.6 0 0 0 0 1.8l-1.7 1.3a.5.5 0 0 0-.1.6l1.6 2.8c.1.2.4.3.6.2l2-.8c.5.4.9.7 1.5.9l.3 2.1c0 .2.2.4.5.4h3.2c.3 0 .5-.2.5-.4l.3-2.1c.6-.2 1-.5 1.5-.9l2 .8c.2.1.5 0 .6-.2l1.6-2.8a.5.5 0 0 0-.1-.6l-1.7-1.3z"
            />
          </svg>
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
      {update && !needsTools ? (
        <UpdateBanner
          update={update}
          busy={downloadInProgress}
          onDismiss={() => setUpdate(null)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
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
          {bare ? (
            <div className="entry-head">
              <h1 className="entry-title">{tabLabel}</h1>
              <p className="entry-lead">{TAB_LEADS[tab]}</p>
            </div>
          ) : null}

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

          {TAB_NOTICES[tab] ? (
            <p className={`tab-notice${DEGRADED_TABS[tab] ? " tab-notice-warn" : ""}`}>
              {TAB_NOTICES[tab]}
            </p>
          ) : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {info ? (
          <ResultCard
            info={info}
            downloads={downloads}
            onDownload={beginDownload}
            onStop={handleStop}
            onRestart={handleRestart}
            onPause={handlePause}
            onResume={handleResume}
          />
        ) : null}

        {playlist ? (
          <PlaylistView
            playlist={playlist}
            onDownloaded={handlePlaylistTrackDownloaded}
          />
        ) : null}

        <HistoryList
          history={history}
          onReplay={replayHistory}
          onRemove={(id) => setHistory(removeHistory(id))}
          onClear={() => setHistory(clearHistory())}
        />
      </main>
      )}
        </div>
      </div>
    </div>
  );
}
