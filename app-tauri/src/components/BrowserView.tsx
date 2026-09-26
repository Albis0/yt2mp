import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  clearVisits,
  coverPage,
  forgetVisit,
  go,
  hostOf,
  iconFor,
  loadVisits,
  navigate,
  onFocusAddress,
  searchQuery,
  setBounds,
  shownAddress,
  suggest,
  toAddress,
  topSites,
  SEARCH,
  type Tab,
  type Visit,
} from "@/lib/browser";
import { downloadTarget, type DownloadTarget } from "@/lib/sources";
import { TABS, type TabId } from "@/components/SourceRail";
import {
  InstagramLogo,
  SpotifyLogo,
  TikTokLogo,
  TwitchLogo,
  XLogo,
  YouTubeLogo,
} from "@/components/BrandLogos";
import { GlobeIcon } from "@/components/BrowserStrip";

const LOGOS: Partial<Record<TabId, () => React.ReactElement>> = {
  youtube: YouTubeLogo,
  spotify: SpotifyLogo,
  tiktok: TikTokLogo,
  instagram: InstagramLogo,
  twitter: XLogo,
  twitch: TwitchLogo,
};

interface Props {
  tab: Tab;
  onDownload: (target: DownloadTarget) => void;
}

/// Toolbar and page area for the tab in front. The page itself is a native
/// webview laid over `.browser-page`; what is drawn here shows only where
/// there is no page yet (a new tab, an address that failed) or while the
/// suggestions list needs the space.
export default function BrowserView({ tab, onDownload }: Props) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The webview follows the page area: every size or position change is
  // sent across, including the window being resized or maximised.
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      setBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(el);
    window.addEventListener("resize", send);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", send);
    };
  }, []);

  useEffect(() => {
    onFocusAddress(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  // A different tab in front is a different address; whatever was being
  // typed belonged to the last one.
  useEffect(() => {
    setDraft(null);
  }, [tab.id]);

  const typing = draft !== null && draft.trim() !== "" && draft !== tab.url;
  const rows = useMemo(() => (typing ? suggestRows(draft!) : []), [typing, draft]);

  // The suggestions need the page area, and nothing drawn here can sit on
  // top of a native webview, so the page steps aside while they are open.
  const covered = typing && tab.live;
  useEffect(() => {
    if (!covered) return;
    coverPage(true);
    return () => coverPage(false);
  }, [covered, tab.id]);

  function submit(target?: string) {
    const value = target ?? rows[pick]?.url ?? draft ?? "";
    if (!value.trim()) return;
    setDraft(null);
    inputRef.current?.blur();
    navigate(tab.id, value);
  }

  const target = tab.url ? downloadTarget(tab.url) : null;
  const TargetLogo = target?.sure ? LOGOS[target.tab] : undefined;
  const targetLabel = target ? (TABS.find((t) => t.id === target.tab)?.label ?? "Link") : "";
  const secure = tab.url.startsWith("https://");

  return (
    <div className="browser">
      <div className="browser-bar">
        <ToolButton label="Back (Alt+Left)" disabled={!tab.canBack} onClick={() => go(tab.id, "back")}>
          <path d="M15 18l-6-6 6-6" />
        </ToolButton>
        <ToolButton
          label="Forward (Alt+Right)"
          disabled={!tab.canForward}
          onClick={() => go(tab.id, "forward")}
        >
          <path d="M9 18l6-6-6-6" />
        </ToolButton>
        {tab.loading && tab.live ? (
          <ToolButton label="Stop" onClick={() => go(tab.id, "stop")}>
            <path d="M6 6l12 12M18 6L6 18" />
          </ToolButton>
        ) : (
          <ToolButton label="Reload (F5)" disabled={!tab.live} onClick={() => go(tab.id, "reload")}>
            <path d="M20 12a8 8 0 1 1-2.34-5.66" />
            <path d="M20 4v5h-5" />
          </ToolButton>
        )}

        <form
          className={`omnibox${draft !== null ? " omnibox-on" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="omnibox-icon" aria-hidden="true">
            {draft !== null || !tab.url ? <SearchIcon /> : secure ? <LockIcon /> : <GlobeIcon />}
          </span>
          <input
            ref={inputRef}
            className="omnibox-input"
            value={draft ?? (tab.url ? shownAddress(tab.url) : "")}
            placeholder="Search Google or type an address"
            spellCheck={false}
            autoComplete="off"
            aria-label="Address and search bar"
            onFocus={(e) => {
              if (draft === null) setDraft(tab.url);
              // Selecting on the next frame: selecting during focus loses
              // to the click that caused it.
              const el = e.currentTarget;
              requestAnimationFrame(() => el.select());
            }}
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              setDraft(e.target.value);
              setPick(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(null);
                e.currentTarget.blur();
              } else if (e.key === "ArrowDown" && rows.length) {
                e.preventDefault();
                setPick((p) => (p + 1) % rows.length);
              } else if (e.key === "ArrowUp" && rows.length) {
                e.preventDefault();
                setPick((p) => (p - 1 + rows.length) % rows.length);
              }
            }}
          />
          {tab.error && draft === null ? (
            <span className="omnibox-error" title={tab.error}>
              {tab.error}
            </span>
          ) : null}
        </form>

        <button
          type="button"
          className={`browser-dl${target?.sure ? ` browser-dl-sure page-${target.tab}` : ""}`}
          disabled={!target}
          title={
            !target
              ? "Open a page to download from it"
              : target.sure
                ? `Download this with yt2mp (${targetLabel})`
                : `Try this page in yt2mp's ${targetLabel} tab`
          }
          onClick={() => target && onDownload(target)}
        >
          <span className="browser-dl-icon" aria-hidden="true">
            {TargetLogo ? <TargetLogo /> : <DownloadIcon />}
          </span>
          Download
        </button>
      </div>

      <div className="browser-page" ref={pageRef}>
        {typing ? (
          <Suggestions
            rows={rows}
            pick={pick}
            onPick={(url) => submit(url)}
            onHover={setPick}
          />
        ) : !tab.url ? (
          <NewTab onGo={(value) => navigate(tab.id, value)} />
        ) : !tab.live && tab.error ? (
          <div className="browser-fail">
            <p className="browser-fail-title">This page couldn't be opened</p>
            <p className="browser-fail-body">{tab.error}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface Row {
  url: string;
  title: string;
  kind: "search" | "go" | "history";
}

function suggestRows(draft: string): Row[] {
  const text = draft.trim();
  const address = toAddress(text) ?? "";
  const first: Row = address.startsWith(SEARCH)
    ? { url: address, title: text, kind: "search" }
    : { url: address, title: address.replace(/^https?:\/\//, ""), kind: "go" };
  const past = suggest(text)
    .filter((v) => v.url !== first.url)
    .map((v): Row => ({ url: v.url, title: v.title, kind: "history" }));
  return [first, ...past];
}

function Suggestions({
  rows,
  pick,
  onPick,
  onHover,
}: {
  rows: Row[];
  pick: number;
  onPick: (url: string) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul className="suggest" role="listbox">
      {rows.map((row, i) => {
        const query = row.kind === "history" ? searchQuery(row.url) : null;
        const icon = row.kind === "history" && !query ? iconFor(row.url) : null;
        return (
          <li
            key={row.kind + row.url}
            role="option"
            aria-selected={i === pick}
            className={`suggest-row${i === pick ? " suggest-on" : ""}`}
            // Before the field's blur, which would close the list first.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(row.url);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="suggest-icon" aria-hidden="true">
              {row.kind === "search" || query ? (
                <SearchIcon />
              ) : icon ? (
                <img src={icon} alt="" />
              ) : (
                <GlobeIcon />
              )}
            </span>
            {row.kind === "search" ? (
              <span className="suggest-main">
                {row.title} <span className="suggest-dim">— Google search</span>
              </span>
            ) : query ? (
              <span className="suggest-main">
                {query} <span className="suggest-dim">— searched before</span>
              </span>
            ) : (
              <>
                <span className="suggest-main">{row.title || shownAddress(row.url)}</span>
                {row.kind === "history" ? (
                  <span className="suggest-url">{shownAddress(row.url)}</span>
                ) : null}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/// What an empty tab shows: a search field, the sites visited most, and
/// the latest history with a way to remove it.
function NewTab({ onGo }: { onGo: (value: string) => void }) {
  const [value, setValue] = useState("");
  const [, refresh] = useState(0);
  const sites = topSites();
  const recent = loadVisits().slice(0, 12);
  return (
    <div className="ntp">
      <form
        className="ntp-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onGo(value);
        }}
      >
        <span className="ntp-search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search Google or type an address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Search Google or type an address"
        />
      </form>

      {sites.length ? (
        <div className="ntp-sites">
          {sites.map((site) => (
            <button
              key={site.url}
              type="button"
              className="ntp-site"
              title={site.url}
              onClick={() => onGo(site.url)}
            >
              <span className="ntp-site-icon" aria-hidden="true">
                <SiteMark url={site.url} />
              </span>
              <span className="ntp-site-name">{hostOf(site.url)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="ntp-hint">
          Open YouTube, Spotify, TikTok or any site here. On a video, song or post, press
          Download and yt2mp takes it from there.
        </p>
      )}

      {recent.length ? (
        <section className="ntp-recent">
          <div className="ntp-recent-head">
            <h2>History</h2>
            <button
              type="button"
              className="ntp-clear"
              onClick={() => {
                clearVisits();
                refresh((n) => n + 1);
              }}
            >
              Clear history
            </button>
          </div>
          <ul>
            {recent.map((v) => (
              <RecentRow
                key={v.url}
                visit={v}
                onGo={onGo}
                onRemove={() => {
                  forgetVisit(v.url);
                  refresh((n) => n + 1);
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RecentRow({
  visit,
  onGo,
  onRemove,
}: {
  visit: Visit;
  onGo: (url: string) => void;
  onRemove: () => void;
}) {
  const query = searchQuery(visit.url);
  return (
    <li className="ntp-row">
      <button type="button" className="ntp-row-main" onClick={() => onGo(visit.url)}>
        <span className="ntp-row-icon" aria-hidden="true">
          {query ? <SearchIcon /> : <SiteMark url={visit.url} />}
        </span>
        <span className="ntp-row-title">{query ?? (visit.title || shownAddress(visit.url))}</span>
        <span className="ntp-row-host">{query ? "Google" : hostOf(visit.url)}</span>
        <span className="ntp-row-when">{ago(visit.last)}</span>
      </button>
      <button
        type="button"
        className="ntp-row-remove"
        aria-label="Remove from history"
        title="Remove from history"
        onClick={onRemove}
      >
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}

function SiteMark({ url }: { url: string }) {
  const icon = iconFor(url);
  if (icon) return <img src={icon} alt="" />;
  const letter = hostOf(url).charAt(0).toUpperCase() || "?";
  return <span className="site-letter">{letter}</span>;
}

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : new Date(at).toLocaleDateString();
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="tool-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
