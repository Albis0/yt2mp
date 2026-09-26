import type { Platform } from "@/lib/api";
import {
  InstagramLogo,
  TikTokLogo,
  TwitchLogo,
  XLogo,
  YouTubeLogo,
} from "@/components/BrandLogos";

/// The source picker, as a vertical rail down the left edge.
///
/// It used to be a horizontal tab strip in a second row of window chrome.
/// Seven tabs need real width to stay readable, so that row cost 42px of
/// height on every screen — which is fine at 1080p and not fine on a 768px
/// laptop, where the app has ~700px of usable height to begin with. Moving
/// the picker to the side trades horizontal space (there is plenty; the
/// content column is capped anyway) for vertical space (there is never
/// enough).
///
/// "ai" and "convert" are not platforms — one is the free-text search entry
/// point, the other takes files already on disk and never touches the network.
/// Both belong in the same rail because from the user's point of view they are
/// just other ways to start, and a separate control would mean competing mode
/// switches on one screen.
export type TabId = Platform | "ai" | "convert" | "scan";

interface TabDef {
  id: TabId;
  label: string;
  /// What the rail shows under the icon. "Instagram" does not fit a 60px
  /// rail at a readable size, and a truncated word is worse than a short
  /// one that was chosen on purpose.
  short: string;
  /// The site's own logo in its own colours (see BrandLogos.tsx). Entries
  /// that are not a site — any link, AI, convert, find — have no brand, so
  /// they get a plain glyph in the label's colour instead.
  icon: () => React.ReactElement;
  /// True for those plain glyphs, which follow the text colour; a logo
  /// never does.
  glyph?: boolean;
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2l2.2 6.1L20.4 10l-6.2 2.2L12 18.4 9.8 12.2 3.6 10l6.2-1.9L12 2zm6.6 12.2l1 2.7 2.8 1-2.8 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7z"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0zm-2.8 5.7a4 4 0 0 1 0-5.7l2.8-2.8 1.4 1.4-2.8 2.9a2 2 0 0 0 2.8 2.8l2.9-2.8 1.4 1.4-2.8 2.8a4 4 0 0 1-5.7 0zm8.5-8.5-1.4-1.4 2.8-2.9a2 2 0 0 0-2.8-2.8l-2.9 2.8-1.4-1.4 2.8-2.8a4 4 0 0 1 5.7 5.7l-2.8 2.8z"
      />
    </svg>
  );
}

/// A music note over a downward arrow: something already in hand becoming an
/// audio file. Deliberately not another link or globe glyph — this is the one
/// tab that never goes near the network, and the icon should say so.
function ConvertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14.5 3v8.6a3.4 3.4 0 1 0 1.8 3V6.3h3.4V3h-5.2zM7.2 10.6V3.4H5.4v7.2H2.6L6.3 15l3.7-4.4H7.2z"
      />
    </svg>
  );
}

/// A magnifier over a page: looking *inside* something that is not itself a
/// video. The page outline is the point — every other icon in this rail stands
/// for a thing you already have the link to.
function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 2.5h8.5L19 8v3.1a5.6 5.6 0 0 0-1.8-.8V9h-4.7V4.3H6.8v15.4h4.6c.2.7.5 1.3.9 1.8H5a1.8 1.8 0 0 1-1.8-1.8V4.3A1.8 1.8 0 0 1 5 2.5zm10.6 9.7a4.2 4.2 0 0 1 3.3 6.8l2.4 2.4-1.3 1.3-2.4-2.4a4.2 4.2 0 1 1-2-8.1zm0 1.8a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"
      />
    </svg>
  );
}

/// Order matters: the sites people reach for most sit at the top. "Any link"
/// is near the end because it is the catch-all, and AI search sits beside it
/// since both are "I don't have a specific site in mind" entry points.
/// "Convert" is last: it is the only entry that takes no link at all, so it
/// belongs after everything that does rather than interrupting that run.
export const TABS: TabDef[] = [
  { id: "youtube", label: "YouTube", short: "YouTube", icon: YouTubeLogo },
  { id: "tiktok", label: "TikTok", short: "TikTok", icon: TikTokLogo },
  { id: "instagram", label: "Instagram", short: "Insta", icon: InstagramLogo },
  { id: "twitter", label: "X", short: "X", icon: XLogo },
  { id: "twitch", label: "Twitch", short: "Twitch", icon: TwitchLogo },
  { id: "other", label: "Any link", short: "Link", icon: LinkIcon, glyph: true },
  { id: "ai", label: "AI search", short: "AI", icon: SparkIcon, glyph: true },
  { id: "convert", label: "Convert", short: "Convert", icon: ConvertIcon, glyph: true },
  { id: "scan", label: "Find on page", short: "Find", icon: ScanIcon, glyph: true },
];

interface SourceRailProps {
  active: TabId;
  onSelect: (id: TabId) => void;
  /// Sources whose downloads are known to be failing right now, marked with a
  /// warning dot. Being honest up front beats letting someone paste a link
  /// and hit a wall.
  degraded?: Partial<Record<TabId, string>>;
}

export default function SourceRail({ active, onSelect, degraded }: SourceRailProps) {
  return (
    <nav
      className="rail"
      role="tablist"
      aria-label="Source"
      aria-orientation="vertical"
    >
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
            // The full name lives in the tooltip and the accessible name, so
            // the short label under the icon never has to carry it alone.
            title={warning ? `${tab.label} — ${warning}` : tab.label}
            aria-label={tab.label}
            className={`rail-item rail-${tab.id}${isActive ? " rail-item-active" : ""}`}
            onClick={() => onSelect(tab.id)}
          >
            <span className={`rail-icon${tab.glyph ? " rail-icon-glyph" : ""}`}>
              <Icon />
              {warning ? (
                <span className="rail-warn" aria-hidden="true">
                  !
                </span>
              ) : null}
            </span>
            <span className="rail-name">{tab.short}</span>
          </button>
        );
      })}
    </nav>
  );
}
