import type { Platform } from "@/lib/api";

/// The tab strip. "ai" is not a platform — it is the free-text search entry
/// point — but it sits in the same strip because from the user's point of
/// view it is just another way to start, and splitting it into a separate
/// control would mean two competing mode switches on one screen.
export type TabId = Platform | "ai";

interface TabDef {
  id: TabId;
  label: string;
  /// Brand mark, drawn as inline SVG so the tab strip needs no network and
  /// no icon font. Each is a recognisable silhouette rather than a faithful
  /// logo — at 15px the details of a real logo turn to mud anyway.
  icon: () => React.ReactElement;
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z"
      />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.6 5.8a4.8 4.8 0 0 1-1-2.8h-3.3v13.2a2.9 2.9 0 1 1-2-2.8v-3.3a6.2 6.2 0 1 0 5.3 6.1V9.4a8 8 0 0 0 4.7 1.5V7.6a4.8 4.8 0 0 1-3.7-1.8z"
      />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.8-.1zm0 3.1a6.7 6.7 0 1 0 0 13.4 6.7 6.7 0 0 0 0-13.4zm0 11a4.3 4.3 0 1 1 0-8.6 4.3 4.3 0 0 1 0 8.6zm6.9-11.3a1.6 1.6 0 1 1-3.1 0 1.6 1.6 0 0 1 3.1 0z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.2 2.3h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9.1L.9 2.3h7l4.8 6.4 5.5-6.4zm-1.2 18h1.9L7.1 4.2H5.1L17 20.3z"
      />
    </svg>
  );
}

function TwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.3 1.7 1.7 6v14.6h5V24h2.8l2.9-3.4h4.3l5.4-5.4V1.7H4.3zm15.9 12.2-3.1 3.1h-4.9l-2.7 2.7v-2.7H5.3V3.6h14.9v10.3zm-4.1-6.7v5.4h-2V7.2h2zm-5.4 0v5.4h-2V7.2h2z"
      />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2l2.2 6.1L20.4 10l-6.2 2.2L12 18.4 9.8 12.2 3.6 10l6.2-1.9L12 2zm6.6 12.2l1 2.7 2.8 1-2.8 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7z"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0zm-2.8 5.7a4 4 0 0 1 0-5.7l2.8-2.8 1.4 1.4-2.8 2.9a2 2 0 0 0 2.8 2.8l2.9-2.8 1.4 1.4-2.8 2.8a4 4 0 0 1-5.7 0zm8.5-8.5-1.4-1.4 2.8-2.9a2 2 0 0 0-2.8-2.8l-2.9 2.8-1.4-1.4 2.8-2.8a4 4 0 0 1 5.7 5.7l-2.8 2.8z"
      />
    </svg>
  );
}

/// Order matters: the sites people reach for most sit leftmost. "Any link"
/// is last because it is the catch-all, and AI search sits beside it since
/// both are "I don't have a specific site in mind" entry points.
export const TABS: TabDef[] = [
  { id: "youtube", label: "YouTube", icon: YouTubeIcon },
  { id: "tiktok", label: "TikTok", icon: TikTokIcon },
  { id: "instagram", label: "Instagram", icon: InstagramIcon },
  { id: "twitter", label: "X", icon: XIcon },
  { id: "twitch", label: "Twitch", icon: TwitchIcon },
  { id: "other", label: "Any link", icon: LinkIcon },
  { id: "ai", label: "AI search", icon: SparkIcon },
];

interface PlatformTabsProps {
  active: TabId;
  onSelect: (id: TabId) => void;
  /// Tabs whose downloads are known to be failing right now, shown with a
  /// warning dot. Being honest up front beats letting someone paste a link
  /// and hit a wall.
  degraded?: Partial<Record<TabId, string>>;
}

export default function PlatformTabs({ active, onSelect, degraded }: PlatformTabsProps) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Source">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        const warning = degraded?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={warning ?? tab.label}
            className={`tab tab-${tab.id}${isActive ? " tab-active" : ""}`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="tab-icon">
              <Icon />
            </span>
            <span className="tab-label">{tab.label}</span>
            {warning ? (
              <span className="tab-warn" aria-hidden="true">
                !
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
