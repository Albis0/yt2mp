// Keys come from GROQ_KEYS (comma-separated) at runtime, never hardcoded —
// GitHub's push protection blocks commits containing real Groq keys even
// base64-encoded, and a checked-in key is a checked-in key regardless of how
// it's wrapped. In dev, set GROQ_KEYS in desktop-app/.env.local (gitignored).
// In the packaged app, electron/main.ts reads desktop-app/.env (copied into
// extraResources at build time, also gitignored) and injects it the same way
// it injects YTDLP_PATH/FFMPEG_PATH.
function loadKeys(): string[] {
  const raw = process.env.GROQ_KEYS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

let cursor = 0;

// Without a timeout, a single unresponsive key can hang the whole chain —
// fetch has no default deadline, so several stuck keys in a row means
// minutes of silent "Fetching…" instead of falling back to the raw query.
const REQUEST_TIMEOUT_MS = 6000;

async function callGroq(messages: { role: string; content: string }[]): Promise<string> {
  const keys = loadKeys();
  if (keys.length === 0) {
    throw new Error("No Groq keys configured (GROQ_KEYS is empty)");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[cursor % keys.length];
    cursor++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.2,
          max_tokens: 60,
        }),
        signal: controller.signal,
      });

      // Rate-limited or dead key — rotate to the next one instead of failing.
      if (res.status === 401 || res.status === 429) {
        lastError = new Error(`Groq key rejected (${res.status})`);
        continue;
      }

      if (!res.ok) {
        lastError = new Error(`Groq request failed (${res.status})`);
        continue;
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        lastError = new Error("Groq returned an empty response");
        continue;
      }
      return content.trim();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("All Groq keys exhausted");
}

// Turns a free-text request (e.g. "that one rush song by troye sivan") into a
// concise YouTube search query, so users don't have to phrase things like a
// search-engine query themselves. Falls back to the raw input if Groq is
// unreachable, unconfigured, or every key is rate-limited.
export async function refineSearchQuery(input: string): Promise<string> {
  try {
    const result = await callGroq([
      {
        role: "system",
        content:
          "Convert the user's request into a short, precise YouTube search query " +
          "(artist + song/video title, no extra words). Reply with only the query, nothing else.",
      },
      { role: "user", content: input },
    ]);
    return result.replace(/^["']|["']$/g, "");
  } catch {
    return input;
  }
}
