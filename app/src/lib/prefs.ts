// Preferences that only the window cares about, kept in localStorage like the
// theme and the history. Anything the Rust side has to act on (the download
// folder, the login source, the AI key) lives in its own settings instead.

import type { TabId } from "@/components/SourceRail";

export type SearchEngine = "google" | "duckduckgo" | "bing";

export interface Prefs {
  /** The tab the app opens on. */
  startTab: TabId;
  /** Show the video's picture beside each row of the history. */
  historyThumbs: boolean;
  /** How many past downloads to keep; 0 keeps none. */
  historyKeep: number;
  /** Show the finished file in its folder as soon as a download ends. */
  openWhenDone: boolean;
  /** Look for a new version a few seconds after launch. */
  checkOnLaunch: boolean;
  /** What the browser's address bar searches with. */
  searchEngine: SearchEngine;
  /** Show the recent pages under the shortcuts on a new tab. */
  startHistory: boolean;
}

const DEFAULTS: Prefs = {
  startTab: "youtube",
  historyThumbs: true,
  historyKeep: 100,
  openWhenDone: false,
  checkOnLaunch: true,
  searchEngine: "google",
  startHistory: true,
};

const KEY = "yt2mp.prefs.v1";

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Blocked or corrupt storage: the defaults are always safe.
  }
  return { ...DEFAULTS };
}

export function savePrefs(change: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisting is not worth interrupting anyone; it holds this session.
  }
  return next;
}

/// Back to the defaults. The theme and the history are not preferences and
/// stay as they are.
export function resetPrefs(): Prefs {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored that could be removed.
  }
  return { ...DEFAULTS };
}
