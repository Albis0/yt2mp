// Client-side download history, persisted in localStorage. Keeps enough to
// re-download a past item quickly (the source URL, chosen format/quality)
// plus what's needed to display it (title, thumbnail).

import type { Platform } from "./api";

export interface HistoryItem {
  id: string; // unique per download event
  videoId: string;
  url: string;
  title: string;
  thumbnail: string;
  format: "mp3" | "mp4";
  quality?: number;
  at: number; // epoch ms
  /** Optional: items saved before multi-platform support have no platform. */
  platform?: Platform;
}

const KEY = "yt2mp.history.v1";
const MAX = 100;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: HistoryItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    // storage full or unavailable — history is best-effort
  }
}

export function addHistory(entry: Omit<HistoryItem, "id" | "at">): HistoryItem[] {
  const items = loadHistory();
  const item: HistoryItem = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  const next = [item, ...items];
  save(next);
  return next;
}

export function removeHistory(id: string): HistoryItem[] {
  const next = loadHistory().filter((i) => i.id !== id);
  save(next);
  return next;
}

export function clearHistory(): HistoryItem[] {
  save([]);
  return [];
}
