// The built-in browser's state: which tabs are open, which one is in front,
// and what each one shows. The webviews themselves live in Rust (tabs.rs);
// this side owns the list, the history and the tab strip.
//
// A module store read with useSyncExternalStore, like the toasts: the tab
// strip sits in the title bar, the toolbar and page in the body, and both
// need the same state without it being threaded through App.

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface Tab {
  id: string;
  /// "" for a new tab that has not been sent anywhere yet.
  url: string;
  title: string;
  icon: string | null;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  /// Whether its webview exists. Tabs restored from the last session are
  /// not live until they are first opened, so twenty remembered tabs cost
  /// nothing until someone looks at one.
  live: boolean;
  /// Why the last address typed into it could not be opened.
  error: string | null;
}

export interface Visit {
  url: string;
  title: string;
  visits: number;
  last: number;
}

interface State {
  tabs: Tab[];
  /// null while the app's own screen is in front.
  active: string | null;
}

const TABS_KEY = "yt2mp.browser.tabs.v1";
const ICONS_KEY = "yt2mp.browser.icons.v1";
const ICONS_MAX = 80;
const HISTORY_KEY = "yt2mp.browser.history.v1";
const HISTORY_MAX = 3000;
/// A remembered favicon larger than this is dropped rather than stored:
/// localStorage is small, and the icon comes back on the first visit anyway.
const ICON_MAX = 12_000;

let state: State = { tabs: restoreTabs(), active: null };
/// Recently closed tabs, most recent last, for Ctrl+Shift+T.
const closed: { url: string; title: string }[] = [];
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
  saveTabs();
}

function patch(id: string, change: Partial<Tab>) {
  set({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...change } : t)) });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useBrowser(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function getBrowser(): State {
  return state;
}

// ---------- persistence ----------

function restoreTabs(): Tab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t) => t && typeof t.id === "string" && typeof t.url === "string" && t.url)
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: typeof t.title === "string" ? t.title : "",
        icon: typeof t.icon === "string" ? t.icon : null,
        loading: false,
        canBack: false,
        canForward: false,
        live: false,
        error: null,
      }));
  } catch {
    return [];
  }
}

function saveTabs() {
  try {
    const keep = state.tabs
      .filter((t) => t.url)
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        icon: t.icon && t.icon.length <= ICON_MAX ? t.icon : null,
      }));
    localStorage.setItem(TABS_KEY, JSON.stringify(keep));
  } catch {
    // Best effort: a full storage loses the tab list, not the tabs.
  }
}

export function loadVisits(): Visit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveVisits(items: Visit[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    // History is best-effort, as in the download list.
  }
}

/// Counts a visit, or only refreshes the title when the address is the one
/// already on record (a title arrives after the address it belongs to).
function record(url: string, title: string, newVisit: boolean) {
  if (!/^https?:\/\//i.test(url)) return;
  const items = loadVisits();
  const at = items.findIndex((v) => v.url === url);
  const prev = at === -1 ? null : items[at];
  if (!newVisit && !prev) return;
  const entry: Visit = {
    url,
    title: title || prev?.title || "",
    visits: (prev?.visits ?? 0) + (newVisit ? 1 : 0),
    last: newVisit ? Date.now() : (prev?.last ?? Date.now()),
  };
  const rest = items.filter((_, i) => i !== at);
  saveVisits(newVisit ? [entry, ...rest] : items.map((v, i) => (i === at ? entry : v)));
}

export function forgetVisit(url: string) {
  saveVisits(loadVisits().filter((v) => v.url !== url));
}

export function clearVisits() {
  saveVisits([]);
}

/// Each site's icon, kept so the new tab page and the suggestions can show
/// the site's own mark rather than a letter.
function loadIcons(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ICONS_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

let icons = loadIcons();

function rememberIcon(url: string, icon: string) {
  const host = hostOf(url);
  if (!host || icon.length > ICON_MAX || icons[host] === icon) return;
  // Re-inserted so the most recent sites are the ones kept.
  const { [host]: _old, ...rest } = icons;
  const keys = Object.keys(rest);
  const kept = keys.slice(Math.max(0, keys.length - ICONS_MAX + 1));
  icons = Object.fromEntries([...kept.map((k) => [k, rest[k]]), [host, icon]]);
  try {
    localStorage.setItem(ICONS_KEY, JSON.stringify(icons));
  } catch {
    // Icons are decoration; losing them loses nothing.
  }
}

export function iconFor(url: string): string | null {
  return icons[hostOf(url)] ?? null;
}

// ---------- the address bar ----------

let addressFocus: () => void = () => {};

/// The toolbar registers how to put the caret in its address field; the
/// shortcuts and a new tab both ask for it.
export function onFocusAddress(fn: () => void) {
  addressFocus = fn;
}

/// Puts the caret in the address bar. The keyboard may be inside a page
/// (a shortcut pressed there), so the app's own webview takes focus first,
/// and the field is looked up a frame later, once a new tab's toolbar exists.
export function focusAddress() {
  getCurrentWebview()
    .setFocus()
    .catch(() => {})
    .finally(() => requestAnimationFrame(() => addressFocus()));
}

/// A new, empty tab with the caret ready in its address bar.
export function newTab() {
  openTab();
  focusAddress();
}

// ---------- addresses ----------

export const SEARCH = "https://www.google.com/search?q=";

/// What typing into the address bar means: an address if it looks like one,
/// otherwise a Google search for it.
export function toAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^(https?|file|about):/i.test(text)) return text;
  if (/\s/.test(text)) return SEARCH + encodeURIComponent(text);
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
  // A dot followed by a plausible top-level domain, before any path.
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return SEARCH + encodeURIComponent(text);
}

/// The query of a Google search page, so history can show a past search as
/// the words that were searched rather than as a long address.
export function searchQuery(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) || u.pathname !== "/search") return null;
    return u.searchParams.get("q");
  } catch {
    return null;
  }
}

/// What the address bar shows for a page: the whole address, minus the
/// scheme on ordinary https pages, the way browsers do now.
export function shownAddress(url: string): string {
  const query = searchQuery(url);
  if (query) return query;
  return url.replace(/^https:\/\//i, "").replace(/\/$/, "");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function tabLabel(tab: Tab): string {
  if (!tab.url) return "New tab";
  return tab.title || shownAddress(tab.url);
}

/// History and past searches matching what is being typed, best first.
export function suggest(input: string, limit = 7): Visit[] {
  const q = input.trim().toLowerCase();
  if (!q) return [];
  const now = Date.now();
  const scored: { v: Visit; score: number }[] = [];
  for (const v of loadVisits()) {
    const url = v.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
    const title = v.title.toLowerCase();
    const query = searchQuery(v.url)?.toLowerCase() ?? "";
    let match = 0;
    if (url.startsWith(q) || query.startsWith(q)) match = 3;
    else if (title.startsWith(q)) match = 2.5;
    else if (url.includes(q) || title.includes(q) || query.includes(q)) match = 1;
    if (!match) continue;
    const days = (now - v.last) / 86_400_000;
    scored.push({ v, score: match * 10 + Math.log2(1 + v.visits) * 3 - Math.min(days, 60) / 6 });
  }
  scored.sort((a, b) => b.score - a.score);
  // A page and the same page with a different tracking tail are one thing.
  const seen = new Set<string>();
  const out: Visit[] = [];
  for (const { v } of scored) {
    const key = searchQuery(v.url) ?? v.url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/// The most visited sites, one entry per site, for the new tab page.
export function topSites(limit = 8): Visit[] {
  const bySite = new Map<string, Visit>();
  for (const v of loadVisits()) {
    if (searchQuery(v.url)) continue;
    const host = hostOf(v.url);
    if (!host) continue;
    const had = bySite.get(host);
    if (!had) {
      bySite.set(host, { ...v, url: new URL(v.url).origin + "/", title: host });
    } else {
      had.visits += v.visits;
      had.last = Math.max(had.last, v.last);
    }
  }
  return [...bySite.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
}

// ---------- actions ----------

/// Tab commands run one after another. Each is async on the Rust side, and
/// two of them racing (hide for the suggestions, show again) could leave the
/// wrong page on screen.
let chain: Promise<unknown> = Promise.resolve();

function call(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  const next = chain.then(() => invoke(cmd, args));
  chain = next.catch(() => {});
  return next;
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function blank(id: string, url = ""): Tab {
  return {
    id,
    url,
    title: "",
    icon: null,
    loading: !!url,
    canBack: false,
    canForward: false,
    live: false,
    error: null,
  };
}

function failed(err: unknown): string {
  return typeof err === "string" && err ? err : "That page could not be opened.";
}

/// Opens a tab after `after` (or at the end) and brings it to the front.
export function openTab(url?: string, after?: string | null) {
  const tab = blank(newId(), url ?? "");
  const at = after ? state.tabs.findIndex((t) => t.id === after) : -1;
  const tabs = [...state.tabs];
  tabs.splice(at === -1 ? tabs.length : at + 1, 0, tab);
  set({ tabs });
  activate(tab.id);
  return tab.id;
}

export function activate(id: string | null) {
  const tab = id ? state.tabs.find((t) => t.id === id) : undefined;
  set({ active: tab ? tab.id : null });
  if (!tab || !tab.url) {
    call("tab_show", { id: null, focus: false }).catch(() => {});
    return;
  }
  if (tab.live) {
    call("tab_show", { id: tab.id, focus: true }).catch(() => {});
    return;
  }
  patch(tab.id, { live: true, loading: true, error: null });
  call("tab_open", { id: tab.id, url: tab.url, show: true }).catch((err) =>
    patch(tab.id, { live: false, loading: false, error: failed(err) })
  );
}

export function closeTab(id: string) {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at === -1) return;
  const tab = state.tabs[at];
  if (tab.url) closed.push({ url: tab.url, title: tab.title });
  if (closed.length > 25) closed.shift();
  if (tab.live) call("tab_close", { id }).catch(() => {});
  const tabs = state.tabs.filter((t) => t.id !== id);
  set({ tabs });
  if (state.active === id) {
    // The neighbour to the right takes its place, as in Chrome; the last tab
    // hands back to the app itself.
    const next = tabs[at] ?? tabs[at - 1] ?? null;
    activate(next ? next.id : null);
  }
}

export function reopenClosed() {
  const last = closed.pop();
  if (last) openTab(last.url);
}

export function navigate(id: string, input: string) {
  const url = toAddress(input);
  const tab = state.tabs.find((t) => t.id === id);
  if (!url || !tab) return;
  patch(id, { url, loading: true, error: null, title: tab.url ? tab.title : "" });
  if (tab.live) {
    pending.set(id, { to: url, from: tab.url });
    call("tab_navigate", { id, url }).catch((err) =>
      patch(id, { loading: false, error: failed(err) })
    );
    return;
  }
  patch(id, { live: true });
  call("tab_open", { id, url, show: state.active === id }).catch((err) =>
    patch(id, { live: false, loading: false, error: failed(err) })
  );
}

export function go(id: string, action: "back" | "forward" | "reload" | "stop") {
  call("tab_go", { id, action }).catch(() => {});
}

export function cycle(step: 1 | -1) {
  const tabs = state.tabs;
  if (!tabs.length) return;
  const at = state.active ? tabs.findIndex((t) => t.id === state.active) : -1;
  // The app itself sits before the first tab, so cycling passes through it.
  const slots = tabs.length + 1;
  const next = (((at + 1 + step) % slots) + slots) % slots;
  activate(next === 0 ? null : tabs[next - 1].id);
}

/// Moves the page in front out of the way (for the suggestions list, which
/// can't be drawn over it) and back.
export function coverPage(covered: boolean) {
  const tab = state.tabs.find((t) => t.id === state.active);
  if (!tab?.live) return;
  call("tab_show", { id: covered ? null : tab.id, focus: false }).catch(() => {});
}

/// The page area moved or changed size.
export function setBounds(rect: { x: number; y: number; width: number; height: number }) {
  call("tab_bounds", { bounds: rect }).catch(() => {});
}

// ---------- events from the tabs ----------

interface StateEvent {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
}

export type KeyName = "new" | "close" | "address" | "next" | "prev" | "reopen";

let keyHandler: (key: KeyName, id: string) => void = () => {};

/// App decides what the shortcuts do, because two of them (the address bar,
/// a new tab page) involve its own elements.
export function onTabKey(handler: (key: KeyName, id: string) => void) {
  keyHandler = handler;
}

let started = false;
/// The address each tab last counted as a visit.
const recorded = new Map<string, string>();
/// An address typed into a tab, and the page it was typed over.
const pending = new Map<string, { to: string; from: string }>();

/// Subscribes once to what the tabs report. Called when the app mounts.
export function startBrowser() {
  if (started) return;
  started = true;

  listen<StateEvent>("tab:state", ({ payload }) => {
    const tab = state.tabs.find((t) => t.id === payload.id);
    if (!tab || !tab.live) return;
    let url = payload.url && payload.url !== "about:blank" ? payload.url : tab.url;
    // Until the page that was asked for replaces the one on screen, the
    // address bar keeps showing what was asked for, not the page it is
    // leaving.
    const wanted = pending.get(tab.id);
    if (wanted) {
      if (payload.loading && (url === wanted.from || !payload.url)) url = wanted.to;
      else pending.delete(tab.id);
    }
    const moved = url !== tab.url;
    // One visit per address a tab settles on. The tab's own address is set
    // ahead of time when something is typed, so "moved" can't tell a new
    // visit on its own; what was last counted for the tab can.
    if (recorded.get(tab.id) !== url && (!payload.loading || moved)) {
      recorded.set(tab.id, url);
      record(url, payload.title, true);
    } else if (payload.title && payload.title !== tab.title) {
      record(url, payload.title, false);
    }
    patch(tab.id, {
      url,
      title: payload.title,
      loading: payload.loading,
      canBack: payload.canBack,
      canForward: payload.canForward,
      // A new site has a new icon, and until it arrives the old one is wrong.
      icon: moved && hostOf(url) !== hostOf(tab.url) ? null : tab.icon,
    });
  });

  listen<{ id: string; icon: string | null }>("tab:icon", ({ payload }) => {
    const tab = state.tabs.find((t) => t.id === payload.id);
    if (!tab) return;
    patch(tab.id, { icon: payload.icon });
    if (payload.icon) rememberIcon(tab.url, payload.icon);
  });

  listen<{ from: string; url: string }>("tab:popup", ({ payload }) => {
    openTab(payload.url, payload.from);
  });

  listen<{ id: string; key: KeyName }>("tab:key", ({ payload }) => {
    keyHandler(payload.key, payload.id);
  });
}
