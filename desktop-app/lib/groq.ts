// Free Groq API keys, base64-split so a plain `grep -r gsk_` over the
// unpacked app doesn't immediately turn one up. This does NOT make the keys
// unextractable — anyone willing to read this file gets them in seconds —
// it only raises the bar above "trivial automated scraping," which is the
// actual threat model for free throwaway keys.
const ENCODED_KEYS: string[] = []; // keys removed from history, see GROQ_KEYS env var

function decode(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

let cursor = 0;

// Without a timeout, a single unresponsive key can hang the whole chain —
// fetch has no default deadline, so 5 stuck keys in a row means minutes of
// silent "Fetching…" instead of falling back to the raw search query.
const REQUEST_TIMEOUT_MS = 6000;

async function callGroq(messages: { role: string; content: string }[]): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < ENCODED_KEYS.length; attempt++) {
    const key = decode(ENCODED_KEYS[cursor % ENCODED_KEYS.length]);
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
// unreachable or every key is rate-limited.
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
