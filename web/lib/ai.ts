// The AI behind the desktop app's AI search and Spotify check.
//
// The Groq keys live here, in this server's environment, and nowhere in the
// app: an installer carries nothing worth extracting. GROQ_KEYS runs the
// search; GROQ_VERIFY_KEYS (falling back to GROQ_KEYS) runs the Spotify check,
// so a night of playlists cannot eat the search's rate limit. Both are
// comma-separated, and a key that is rejected or rate limited hands over to
// the next.
//
// Each install gets 5 of each per rolling 24 hours, counted here. Two caps
// stand behind that, because an install id is whatever the caller says it is:
// one per address and one for the whole service, so a script minting ids
// cannot drain the Groq account.
//
// shortcut: the counters are in memory. A restart or a redeploy resets them
// (the free instance has no disk); a store like Redis is the upgrade if that
// ever matters.

import { NextResponse, type NextRequest } from "next/server";

type Kind = "search" | "verify";

const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const DAY = 24 * 60 * 60 * 1000;
const PER_INSTALL = 5;
const PER_ADDRESS = Number(process.env.AI_PER_ADDRESS) || 20;
const SERVICE = Number(process.env.AI_DAILY_TOTAL) || 2500;

interface Window {
  start: number;
  search: number;
  verify: number;
}

const installs = new Map<string, Window>();
const addresses = new Map<string, Window>();
let service: Window = { start: 0, search: 0, verify: 0 };

const cursor: Record<Kind, number> = { search: 0, verify: 0 };

function keys(kind: Kind): string[] {
  const own = kind === "verify" ? process.env.GROQ_VERIFY_KEYS : undefined;
  const raw = own?.trim() ? own : (process.env.GROQ_KEYS ?? "");
  return raw
    .split(",")
    .map((k) => k.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/// The window an id is counted in, started or restarted as needed.
function windowOf(map: Map<string, Window>, id: string, now: number): Window {
  let w = map.get(id);
  if (!w || now - w.start >= DAY) {
    w = { start: now, search: 0, verify: 0 };
    map.set(id, w);
    // Spent windows would otherwise pile up for as long as the server lives.
    if (map.size > 20_000) {
      for (const [k, v] of map) if (now - v.start >= DAY) map.delete(k);
    }
  }
  return w;
}

/// Sets one use aside for this install, or says the allowance is spent.
function reserve(install: string, address: string, kind: Kind): Window[] | null {
  const now = Date.now();
  if (now - service.start >= DAY) service = { start: now, search: 0, verify: 0 };
  const mine = windowOf(installs, install, now);
  const there = windowOf(addresses, address, now);
  if (mine[kind] >= PER_INSTALL) return null;
  if (there.search + there.verify >= PER_ADDRESS) return null;
  if (service.search + service.verify >= SERVICE) return null;
  for (const w of [mine, there, service]) w[kind] += 1;
  return [mine, there, service];
}

/// A use that never got an answer is not the person's.
function refund(held: Window[], kind: Kind) {
  for (const w of held) w[kind] = Math.max(0, w[kind] - 1);
}

/// One chat request, rotating through the keys until one answers.
async function complete(kind: Kind, body: object): Promise<string | null> {
  const list = keys(kind);
  for (let i = 0; i < list.length; i++) {
    const key = list[cursor[kind]++ % list.length];
    try {
      const res = await fetch(GROQ, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue; // 401 dead, 429 busy, 5xx down: next key
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.trim()) return text.trim();
    } catch {
      // Timeout or network: next key.
    }
  }
  return null;
}

const SEARCH_PROMPT =
  "Convert the user's request into a short, precise YouTube search query " +
  "(artist + song/video title, no extra words). Reply with only the query, nothing else.";

const VERIFY_PROMPT =
  "You match a Spotify track to YouTube Music search results. " +
  "Pick the result that is the same recording: same song, same main artist, " +
  "the original studio version. A cover, live, remix, sped up, slowed, " +
  "karaoke or instrumental version is NOT the same unless the Spotify title " +
  "says so too. Featured artists may be listed differently. Lengths within a " +
  'few seconds are normal. Reply with JSON only: {"match": <number>} or ' +
  '{"match": null} if none is the same recording.';

const short = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

/// The address a request came from. Render sits behind Cloudflare, which
/// states it; the first hop of the chain is the fallback.
function addressOf(req: NextRequest): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

export async function handle(req: NextRequest, kind: Kind): Promise<NextResponse> {
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const install = typeof input.install === "string" && /^[A-Za-z0-9-]{16,64}$/.test(input.install)
    ? input.install
    : null;

  let body: object | null = null;
  if (install && kind === "search") {
    const text = short(input.text, 300);
    if (text) {
      body = {
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: SEARCH_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        // The model reasons before it answers, and the reasoning counts here.
        max_completion_tokens: 200,
        reasoning_effort: "low",
      };
    }
  } else if (install) {
    const track = short(input.track, 300);
    const list = input.candidates;
    if (
      track &&
      Array.isArray(list) &&
      list.length > 0 &&
      list.length <= 12 &&
      list.every((c) => short(c, 300))
    ) {
      const numbered = list.map((c, i) => `${i + 1}. ${c}`).join("\n");
      body = {
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: VERIFY_PROMPT },
          { role: "user", content: `Spotify track: ${track}\n\nYouTube Music results:\n${numbered}` },
        ],
        temperature: 0,
        max_completion_tokens: 200,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      };
    }
  }
  if (!body || !install) return NextResponse.json({ error: "bad request" }, { status: 400 });

  if (keys(kind).length === 0) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const held = reserve(install, addressOf(req), kind);
  if (!held) return NextResponse.json({ error: "limit" }, { status: 429 });

  const text = await complete(kind, body);
  if (text === null) {
    refund(held, kind);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  return NextResponse.json({ text });
}
