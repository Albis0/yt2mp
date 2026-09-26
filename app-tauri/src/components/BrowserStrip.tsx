import AppLogo from "@/components/AppLogo";
import { activate, closeTab, newTab, tabLabel, useBrowser, type Tab } from "@/lib/browser";
import { useToasts } from "@/lib/toast";

/// The tab strip in the title bar. The app itself is the first tab and
/// cannot be closed; every tab after it is a web page.
///
/// Pills rather than Chrome's trapezoids: the rest of the window is flat
/// rounded surfaces, and a second visual language in its top 40px would be
/// the first thing anyone noticed.
export default function BrowserStrip() {
  const { tabs, active } = useBrowser();
  // A toast raised while a page covers the window can't be seen until the
  // app is in front again, so its tab says one is waiting.
  const waiting = useToasts().length > 0 && active !== null;

  return (
    <div className="strip" role="tablist" aria-label="Tabs" data-tauri-drag-region>
      <button
        type="button"
        role="tab"
        aria-selected={active === null}
        className={`strip-app${active === null ? " strip-on" : ""}`}
        onClick={() => activate(null)}
        title="yt2mp"
      >
        <AppLogo size={18} />
        <span className="strip-app-name">yt2mp</span>
        {waiting ? <span className="strip-dot" aria-label="New notice" /> : null}
      </button>

      {tabs.map((tab) => (
        <StripTab key={tab.id} tab={tab} on={tab.id === active} />
      ))}

      <button
        type="button"
        className="strip-new"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={newTab}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function StripTab({ tab, on }: { tab: Tab; on: boolean }) {
  const label = tabLabel(tab);
  return (
    <div
      role="tab"
      aria-selected={on}
      tabIndex={0}
      className={`strip-tab${on ? " strip-on" : ""}`}
      title={label}
      onClick={() => activate(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") activate(tab.id);
      }}
      // Middle click closes, as in every browser.
      onAuxClick={(e) => {
        if (e.button === 1) closeTab(tab.id);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <span className="strip-icon" aria-hidden="true">
        {tab.loading ? (
          <span className="strip-spin" />
        ) : tab.icon ? (
          <img src={tab.icon} alt="" />
        ) : (
          <GlobeIcon />
        )}
      </span>
      <span className="strip-title">{label}</span>
      <button
        type="button"
        className="strip-close"
        aria-label={`Close ${label}`}
        title="Close tab (Ctrl+W)"
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
      >
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}
