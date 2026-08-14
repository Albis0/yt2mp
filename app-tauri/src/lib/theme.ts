/// Theme preference: three states, not two.
///
/// "system" has to remain reachable — if the only options were light and dark,
/// choosing once would permanently opt the app out of the OS setting with no
/// way back.
///
/// Dark is the default rather than "system": this is a media tool people keep
/// open beside a video, where a bright window is the wrong neighbour for a
/// thumbnail. Anyone who wants it to follow the desktop can pick System.
export type ThemePref = "system" | "light" | "dark";

const KEY = "yt2mp.theme";

/// The resolved theme is what actually gets painted: "system" is looked up
/// against the OS at read time rather than being stored resolved, so a user
/// who changes their desktop theme sees the app follow without restarting.
export type Resolved = "light" | "dark";

export function loadPref(): ThemePref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Private mode or a locked-down webview — fall through to the default.
  }
  return "dark";
}

export function savePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Not being able to persist is not worth interrupting anyone over; the
    // choice still applies for this session.
  }
}

const query = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function resolve(pref: ThemePref): Resolved {
  if (pref !== "system") return pref;
  return query()?.matches ? "dark" : "light";
}

/// Writes the resolved theme onto <html>. The CSS keys off
/// [data-theme] rather than a media query so an explicit choice can override
/// the OS in both directions.
export function apply(resolved: Resolved) {
  document.documentElement.setAttribute("data-theme", resolved);
}

/// Fires when the OS theme changes. Only meaningful while the pref is
/// "system"; the caller is responsible for ignoring it otherwise.
export function onSystemChange(fn: () => void): () => void {
  const mq = query();
  if (!mq) return () => {};
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
