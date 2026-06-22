"use client";

import type { HistoryItem } from "@/lib/history";

interface HistoryListProps {
  history: HistoryItem[];
  onReplay: (item: HistoryItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? "s" : ""} ago`;
}

export default function HistoryList({
  history,
  onReplay,
  onRemove,
  onClear,
}: HistoryListProps) {
  if (history.length === 0) {
    return (
      <section className="history">
        <div className="history-head">
          <h3>History</h3>
        </div>
        <p className="history-empty">
          Your downloads show up here. Click one to grab it again.
        </p>
      </section>
    );
  }

  return (
    <section className="history">
      <div className="history-head">
        <h3>History</h3>
        <button type="button" className="history-clear" onClick={onClear}>
          Clear all
        </button>
      </div>
      <ul className="history-list">
        {history.map((item) => (
          <li className="history-item" key={item.id}>
            <button
              type="button"
              className="history-main"
              onClick={() => onReplay(item)}
              title="Fetch again"
            >
              <span className="history-thumb">
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail} alt="" />
                ) : null}
              </span>
              <span className="history-text">
                <span className="history-title">{item.title}</span>
                <span className="history-sub">
                  <span className="history-badge">
                    {item.format.toUpperCase()}
                    {item.quality ? ` ${item.quality}p` : ""}
                  </span>
                  {timeAgo(item.at)}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="history-remove"
              onClick={() => onRemove(item.id)}
              aria-label="Remove from history"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
