// Which of the app's sources a link belongs to. Used by the link field (a
// pasted Instagram link moves to the Instagram tab) and by the browser's
// Download button (the page open in a tab goes to the right source).

import type { TabId } from "@/components/SourceRail";

function hostOf(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .split("@")
    .pop()!
    .split(":")[0]
    .toLowerCase();
}

/// Which tab a pasted URL belongs to, so pasting an Instagram link while the
/// YouTube tab is open switches to Instagram instead of silently downloading
/// under the wrong heading. Mirrors the host matching in src-tauri's
/// platform.rs — kept deliberately simple here because Rust still has the
/// authoritative say once the link is submitted.
export function tabForUrl(raw: string): TabId | null {
  const url = raw.trim();
  if (/^spotify:/i.test(url)) return "spotify";
  if (!/^https?:\/\//i.test(url)) return null;

  const host = hostOf(url);
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (["youtube.com", "youtu.be", "youtube-nocookie.com"].some(on)) return "youtube";
  if (["tiktok.com", "vm.tiktok.com"].some(on)) return "tiktok";
  if (["instagram.com", "instagr.am"].some(on)) return "instagram";
  if (["twitter.com", "x.com", "t.co"].some(on)) return "twitter";
  if (on("twitch.tv")) return "twitch";
  if (["open.spotify.com", "play.spotify.com", "spotify.link", "spotify.app.link"].some(on))
    return "spotify";
  return "other";
}

export interface DownloadTarget {
  tab: TabId;
  /// What to hand to the source's field. Usually the page address as it is;
  /// a YouTube video watched inside a playlist or a mix is sent as the video
  /// alone, because the video is what someone looking at it wants saved.
  url: string;
  /// The page is one thing that can be downloaded: a video, a post, a song,
  /// a playlist. A home page, a search or a profile is not, and the button
  /// stays quiet there.
  sure: boolean;
}

/// The paths that are a single downloadable thing, per source (TikTok and
/// Twitch also depend on the host, so they are checked in place). Anything
/// else on a known site (a feed, a channel, a search) is sent too if the
/// button is pressed, but the button does not call attention to itself.
const CONTENT: Partial<Record<TabId, RegExp>> = {
  youtube: /^\/(watch|shorts\/[\w-]+|live\/[\w-]+|playlist|embed\/[\w-]+)/,
  spotify: /^\/(intl-[a-z-]+\/)?(track|album|playlist)\/[A-Za-z0-9]+/,
  instagram: /^\/(([^/]+\/)?(p|reel|reels|tv)\/[\w-]+)/,
  twitter: /^\/[^/]+\/status\/\d+/,
};

export function downloadTarget(raw: string): DownloadTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const tab = tabForUrl(url.href);
  if (!tab) return null;

  const host = url.hostname.toLowerCase();
  let path = url.pathname;
  let sure: boolean;

  if (tab === "youtube") {
    if (host === "youtu.be") {
      sure = path.length > 1;
    } else if (path === "/watch") {
      const v = url.searchParams.get("v");
      sure = !!v;
      if (v) return { tab, url: `https://www.youtube.com/watch?v=${v}`, sure };
    } else {
      sure = CONTENT.youtube!.test(path) && (path !== "/playlist" || url.searchParams.has("list"));
    }
  } else if (tab === "tiktok") {
    // vm.tiktok.com/XXXX and vt.tiktok.com/XXXX are single-video short links.
    const short = host.startsWith("vm.") || host.startsWith("vt.");
    sure = short ? path.length > 1 : /^\/(@[^/]+\/video\/\d+|v\/\d+|t\/\w+|video\/\d+)/.test(path);
  } else if (tab === "twitch") {
    sure = host.startsWith("clips.")
      ? path.length > 1
      : /^\/(videos\/\d+|[^/]+\/clip\/[\w-]+|[^/]+\/v\/\d+)/.test(path);
  } else if (tab === "other") {
    sure = false;
  } else {
    path = path.replace(/\/+$/, "") || "/";
    sure = CONTENT[tab]?.test(path) ?? false;
  }
  return { tab, url: url.href, sure };
}
