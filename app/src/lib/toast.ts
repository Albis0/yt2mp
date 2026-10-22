/// Short-lived notes in the corner of the window: an update is ready, a
/// setting was saved, an action has to wait.
///
/// A module-level store rather than React context, so anything can raise one
/// — the updater, a settings handler, a guard in App — without threading a
/// callback through every component in between.

import { useSyncExternalStore } from "react";

export type Tone = "info" | "ok" | "warn" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface Toast {
  id: string;
  tone: Tone;
  title: string;
  body?: string;
  actions?: ToastAction[];
  /// A bar along the bottom. `null` means running with no known end;
  /// leaving it out means no bar at all.
  progress?: number | null;
  /// Stays until closed. Anything with a question in it (an update offer) or
  /// a job in flight (its progress) is sticky; a confirmation is not.
  sticky?: boolean;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/// Shows a toast, or replaces the one with the same id in place — so a
/// progress toast updates rather than stacking a new card per percent.
export function toast(t: Omit<Toast, "id"> & { id?: string }): string {
  const id = t.id ?? crypto.randomUUID();
  const next = { ...t, id };
  const at = toasts.findIndex((x) => x.id === id);
  toasts =
    at === -1
      ? [...toasts, next].slice(-4)
      : toasts.map((x, i) => (i === at ? next : x));
  emit();
  return id;
}

export function dismissToast(id: string) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}

/// The text of a rejected Tauri command, or the fallback. Commands reject
/// with a plain string; anything else is a bug and says nothing useful.
export function reason(err: unknown, fallback: string): string {
  return typeof err === "string" && err.trim() ? err : fallback;
}
