import { useEffect, useRef, useState } from "react";
import {
  formatDuration,
  onDownloadProgress,
  scanPageDeep,
  scanPageQuick,
  startDownload,
  stopDownload,
  type DownloadFormat,
  type Found,
  type DownloadProgress,
} from "@/lib/api";
import DownloadRow, { type RowState } from "@/components/DownloadRow";

/// Finding downloadable things on a page that is not itself a video page.
///
/// Every other tab starts from a link that *is* the thing you want. This one
/// starts from a link that merely contains things you want — an article with
/// embeds, a course page, a listing.
///
/// Two passes, and the user is told which is running, because they cost very
/// different amounts of time:
///
///   quick — hands the page to the extractor as-is. Seconds. Finds an
///           embedded player when there is an obvious one, which on most
///           pages means it finds nothing at all. That is normal, not a
///           failure, and the screen says so rather than showing an error.
///
///   deep  — fetches the page, pulls out every link, and asks the extractor
///           which ones it recognises. Slower, so it is never run without
///           being asked for.
///
/// The waiting copy is the part that matters most here. A scan that says
/// "Loading…" for forty seconds is indistinguishable from one that has hung,
/// and this one legitimately takes that long — so each stage says what it is
/// doing and roughly how long that lasts.

type Phase =
  | { at: "idle" }
  | { at: "quick" }
  | { at: "deep" }
  | { at: "results"; deepDone: boolean }
  | { at: "empty"; deepDone: boolean }
  | { at: "error"; message: string };

/// One result, plus whatever has happened to it since.
interface Item {
  found: Found;
  id: string | null;
  progress: DownloadProgress;
  running: boolean;
  done: boolean;
  /** Stopped by the user; the row offers a fresh start. */
  stopped: boolean;
  savedPath: string | null;
  error: string | null;
}

function itemOf(found: Found): Item {
  return {
    found,
    id: null,
    progress: { percent: 0, stage: "" },
    running: false,
    done: false,
    stopped: false,
    savedPath: null,
    error: null,
  };
}

function rowState(item: Item): RowState {
  if (item.running) return { at: "running", progress: item.progress };
  if (item.done) return { at: "done", filePath: item.savedPath };
  if (item.error) return { at: "failed", error: item.error };
  if (item.stopped) return { at: "cancelled" };
  return { at: "idle" };
}

/// Where a result came from, in words the person reading it can act on.
/// "generic extractor" and "iframe" are true and useless; what they want to
/// know is whether this was the video the page was built around or one of the
/// links scattered through it.
function originLabel(found: Found): string {
  return found.how === "embedded" ? "Playing on the page" : "Linked from the page";
}

interface ScanPanelProps {
  /// Raised while a download from this screen is running, so the app blocks
  /// tab switching the same way it does everywhere else.
  onBusyChange: (busy: boolean) => void;
}

export default function ScanPanel({ onBusyChange }: ScanPanelProps) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<DownloadFormat>("mp3");

  // The URL that produced the results on screen. Kept separate from the input
  // so editing the box does not make "Search deeper" scan a different page
  // than the one whose empty result prompted it.
  const scannedUrl = useRef("");

  function patch(url: string, next: Partial<Item>) {
    setItems((list) =>
      list.map((i) => (i.found.url === url ? { ...i, ...next } : i))
    );
  }

  // Derived from the rows, not set around each download: with two running,
  // the first to finish used to clear the flag while the second was still
  // going, and switching tabs then hid its Stop button.
  const downloading = items.some((i) => i.running);
  useEffect(() => {
    onBusyChange(downloading);
  }, [downloading, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  async function runQuick(e: React.FormEvent) {
    e.preventDefault();
    const clean = url.trim();
    // A new search replaces the list, and a running download's row with it.
    if (!clean || downloading) return;

    scannedUrl.current = clean;
    setItems([]);
    setPhase({ at: "quick" });

    try {
      const found = await scanPageQuick(clean);
      if (found.length > 0) {
        setItems(found.map(itemOf));
        setPhase({ at: "results", deepDone: false });
      } else {
        // Nothing found is the expected answer for most pages. Offering the
        // deep pass here is the whole point of splitting the two.
        setPhase({ at: "empty", deepDone: false });
      }
    } catch (err) {
      setPhase({
        at: "error",
        message: typeof err === "string" ? err : "That page couldn't be searched.",
      });
    }
  }

  async function runDeep() {
    const clean = scannedUrl.current || url.trim();
    if (!clean || downloading) return;

    setPhase({ at: "deep" });
    try {
      const found = await scanPageDeep(clean);
      setItems(found.map(itemOf));
      setPhase(
        found.length > 0
          ? { at: "results", deepDone: true }
          : { at: "empty", deepDone: true }
      );
    } catch (err) {
      setPhase({
        at: "error",
        message: typeof err === "string" ? err : "That page couldn't be searched.",
      });
    }
  }

  async function grab(item: Item) {
    const id = crypto.randomUUID();
    patch(item.found.url, {
      id,
      running: true,
      progress: { percent: 0, stage: "Starting" },
      stopped: false,
      error: null,
    });

    const unsubscribe = onDownloadProgress(id, (p) =>
      patch(item.found.url, { progress: p })
    );

    try {
      const savedPath = await startDownload({
        id,
        url: item.found.url,
        format,
        title: item.found.title,
      });
      patch(item.found.url, {
        running: false,
        done: true,
        savedPath,
      });
    } catch (err) {
      const message = typeof err === "string" ? err : "That download failed.";
      patch(item.found.url, {
        running: false,
        // Cancelling the folder dialog or stopping a transfer are decisions,
        // not failures, and neither deserves red text.
        stopped: message === "Download stopped",
        error:
          message === "Save cancelled" || message === "Download stopped"
            ? null
            : message,
      });
    } finally {
      unsubscribe();
    }
  }

  const searching = phase.at === "quick" || phase.at === "deep";

  return (
    <section className="scan">
      <form className="scan-form" onSubmit={runQuick}>
        <input
          type="text"
          className="url-input"
          placeholder="Paste the address of a page that has videos on it"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={searching}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="submit-btn"
          disabled={searching || downloading || !url.trim()}
          title={downloading ? "Finish or stop the downloads below first" : undefined}
        >
          {searching ? (
            <>
              <span className="submit-spinner" aria-hidden="true" />
              Searching…
            </>
          ) : (
            "Search page"
          )}
        </button>
      </form>

      {phase.at === "idle" ? (
        <p className="scan-lead">
          For pages that aren't a video themselves — an article, a lesson, a
          listing. Paste the address of the page and this looks through it for
          anything that can be downloaded.
        </p>
      ) : null}

      {/* The waiting copy. Each stage says what is happening and how long it
          tends to take, because both passes are long enough that silence
          reads as a hang. */}
      {phase.at === "quick" ? (
        <div className="scan-wait">
          <p className="scan-wait-title">Looking at the page…</p>
          <p className="scan-wait-sub">
            Checking whether there's a video playing on it. Usually a few
            seconds.
          </p>
        </div>
      ) : null}

      {phase.at === "deep" ? (
        <div className="scan-wait">
          <p className="scan-wait-title">Going through every link on the page…</p>
          <p className="scan-wait-sub">
            Reading the page, then checking each link on it to see if anything
            can be downloaded. This one can take a minute — it's working, you
            can leave it.
          </p>
        </div>
      ) : null}

      {phase.at === "error" ? <p className="error-text">{phase.message}</p> : null}

      {phase.at === "empty" ? (
        <div className="scan-empty">
          {phase.deepDone ? (
            <>
              <p className="scan-wait-title">Nothing downloadable on that page.</p>
              <p className="scan-wait-sub">
                Both the page and every link on it were checked. Either there's
                no video there, or it's on a site this can't read. If you can
                see the video playing, try copying its own link and using the
                Any link tab.
              </p>
            </>
          ) : (
            <>
              <p className="scan-wait-title">Nothing playing directly on that page.</p>
              <p className="scan-wait-sub">
                That's normal — most pages link to their videos rather than
                playing them. Searching deeper reads the page and checks every
                link on it, which takes longer but finds a lot more.
              </p>
              <button type="button" className="submit-btn" onClick={runDeep}>
                Search deeper
              </button>
            </>
          )}
        </div>
      ) : null}

      {phase.at === "results" ? (
        <>
          <div className="scan-summary">
            <span className="scan-count">
              {items.length} {items.length === 1 ? "thing" : "things"} found
            </span>

            {/* One format switch for the whole list rather than per row: the
                reason someone scans a page is to take several things off it,
                and choosing audio-or-video once is the choice they meant. */}
            <div className="scan-format" role="group" aria-label="Download as">
              <button
                type="button"
                className={`scan-format-btn${format === "mp3" ? " is-on" : ""}`}
                onClick={() => setFormat("mp3")}
              >
                MP3
              </button>
              <button
                type="button"
                className={`scan-format-btn${format === "mp4" ? " is-on" : ""}`}
                onClick={() => setFormat("mp4")}
              >
                Video
              </button>
            </div>

            {!phase.deepDone ? (
              <button
                type="button"
                className="scan-deeper-btn"
                onClick={runDeep}
                disabled={downloading}
              >
                Search deeper
              </button>
            ) : null}
          </div>

          <div className="dllist scan-list">
            {items.map((item) => (
              <DownloadRow
                key={item.found.url}
                label={item.found.title}
                tags={item.found.site ? [item.found.site] : []}
                sub={[
                  originLabel(item.found),
                  item.found.duration > 0 ? formatDuration(item.found.duration) : null,
                  item.found.uploader || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                state={rowState(item)}
                onStart={() => grab(item)}
                onCancel={() => item.id && stopDownload(item.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
