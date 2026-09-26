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
  /// The site's own logo in its own colours (see BrandLogos.tsx), or for the
  /// entries that are not a site, a tile of the app's own (see `Tile`).
  icon: () => React.ReactElement;
}

/// The entries that are not a site have no logo to borrow, so they get one
/// of their own built to sit beside the real ones: a filled tile in the tab's
/// colour with a white mark, the same weight and footprint as a brand icon.
/// A thin grey line glyph next to five full-colour logos read as a smaller,
/// lesser kind of item.
function Tile({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill={color} />
      <g
        transform="translate(4.5 4.5) scale(0.625)"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  );
}

function LinkIcon() {
  return (
    <Tile color="#2F6FED">
      <path d="M10 14a4.6 4.6 0 0 0 6.5 0l3.2-3.2a4.6 4.6 0 0 0-6.5-6.5l-1.3 1.3" />
      <path d="M14 10a4.6 4.6 0 0 0-6.5 0l-3.2 3.2a4.6 4.6 0 0 0 6.5 6.5l1.3-1.3" />
    </Tile>
  );
}

function SparkIcon() {
  return (
    <Tile color="#C8871A">
      <path
        fill="#fff"
        stroke="none"
        d="M12 2l2.2 6.1L20.4 10l-6.2 2.2L12 18.4 9.8 12.2 3.6 10l6.2-1.9L12 2zm6.6 12.2l1 2.7 2.8 1-2.8 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7z"
      />
    </Tile>
  );
}

/// Two arrows passing each other: one thing becoming another. This is the
/// one tab that never goes near the network, so it is not another link or
/// download mark.
function ConvertIcon() {
  return (
    <Tile color="#1F9D5C">
      <path d="M3.5 8h15.5M15 4l4 4-4 4" />
      <path d="M20.5 16H5M9 12l-4 4 4 4" />
    </Tile>
  );
}

/// A magnifier: looking inside a page for what it holds.
function ScanIcon() {
  return (
    <Tile color="#D0691F">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </Tile>
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
  { id: "other", label: "Any link", short: "Link", icon: LinkIcon },
  { id: "ai", label: "AI search", short: "AI", icon: SparkIcon },
  { id: "convert", label: "Convert", short: "Convert", icon: ConvertIcon },
  { id: "scan", label: "Find on page", short: "Find", icon: ScanIcon },
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
            <span className="rail-icon">
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
