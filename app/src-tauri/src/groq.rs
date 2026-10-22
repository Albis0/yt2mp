//! AI search: turns a free-text request into a clean YouTube search query.
//!
//! Keys come from GROQ_KEYS (comma-separated) at runtime, never hardcoded —
//! GitHub's push protection blocks commits containing real Groq keys even
//! base64-encoded, and a checked-in key is a checked-in key regardless of how
//! it is wrapped. The key file is read from the resource directory in a
//! packaged app, or the crate directory in dev.

use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

static KEYS: OnceLock<Vec<String>> = OnceLock::new();
static CURSOR: AtomicUsize = AtomicUsize::new(0);

/// A second set, used only to check Spotify matches. Kept apart so a busy
/// evening of playlist downloads cannot use up the AI search's rate limit,
/// and the other way round.
static VERIFY_KEYS: OnceLock<Vec<String>> = OnceLock::new();
static VERIFY_CURSOR: AtomicUsize = AtomicUsize::new(0);

/// Without a timeout, a single unresponsive key can hang the whole chain —
/// several stuck keys in a row would mean minutes of silent "Fetching…"
/// instead of falling back to the raw query.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);

/// Reads `GROQ_KEYS=a,b,c` out of a .env file. Missing file just means AI
/// search falls back to searching the raw text.
pub fn init(resource_dir: Option<std::path::PathBuf>, config_dir: Option<std::path::PathBuf>) {
    let mut candidates = Vec::new();
    // The one place on an installed machine a person can put their own keys:
    // the release does not ship any, and must not.
    if let Some(dir) = config_dir {
        candidates.push(dir.join(".env"));
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join(".env"));
        candidates.push(dir.join("resources").join(".env"));
    }
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".env"),
    );
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(".env.local"),
    );

    let mut keys = Vec::new();
    let mut verify = Vec::new();

    // An explicit environment variable wins over any file, which keeps CI and
    // `cargo run` overrides simple.
    if let Ok(raw) = std::env::var("GROQ_KEYS") {
        keys = split_keys(&raw);
    }
    if let Ok(raw) = std::env::var("GROQ_VERIFY_KEYS") {
        verify = split_keys(&raw);
    }

    for path in &candidates {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };

        if keys.is_empty() {
            if let Some(raw) = content
                .lines()
                .find_map(|l| l.trim().strip_prefix("GROQ_KEYS="))
            {
                keys = split_keys(raw);
            }
        }
        if verify.is_empty() {
            if let Some(raw) = content
                .lines()
                .find_map(|l| l.trim().strip_prefix("GROQ_VERIFY_KEYS="))
            {
                verify = split_keys(raw);
            }
        }

        // The same file also carries the optional browser-cookie setting that
        // ytdlp.rs reads (Instagram in particular needs it). Promoting it to
        // the environment here keeps .env as the single place a user
        // configures the app, rather than adding a second mechanism.
        if std::env::var("YT2MP_COOKIES_FROM").is_err() {
            if let Some(raw) = content
                .lines()
                .find_map(|l| l.trim().strip_prefix("YT2MP_COOKIES_FROM="))
            {
                let value = raw.trim().trim_matches('"');
                if !value.is_empty() {
                    std::env::set_var("YT2MP_COOKIES_FROM", value);
                }
            }
        }
    }

    let _ = KEYS.set(keys);
    let _ = VERIFY_KEYS.set(verify);
}

fn split_keys(raw: &str) -> Vec<String> {
    raw.trim()
        .trim_matches('"')
        .split(',')
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .collect()
}

fn keys() -> &'static [String] {
    KEYS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

/// The Spotify check's own keys, or the AI search's until it has some.
fn verify_keys() -> &'static [String] {
    match VERIFY_KEYS.get().map(|v| v.as_slice()) {
        Some(own) if !own.is_empty() => own,
        _ => keys(),
    }
}

/// Whether Spotify matches can be checked by the model at all.
pub fn can_verify() -> bool {
    !verify_keys().is_empty()
}

async fn call_groq(input: &str) -> Result<String, String> {
    let body = json!({
        "model": "llama-3.1-8b-instant",
        "messages": [
            {
                "role": "system",
                "content": "Convert the user's request into a short, precise YouTube search query (artist + song/video title, no extra words). Reply with only the query, nothing else."
            },
            { "role": "user", "content": input }
        ],
        "temperature": 0.2,
        "max_tokens": 60
    });
    complete(keys(), &CURSOR, &body).await
}

/// Sends one chat request, rotating through `keys` until one answers.
async fn complete(
    keys: &[String],
    cursor: &AtomicUsize,
    body: &serde_json::Value,
) -> Result<String, String> {
    if keys.is_empty() {
        return Err("No Groq keys configured".into());
    }

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_error = String::from("All Groq keys exhausted");

    // Rotate through the keys: a rate-limited (429) or dead (401) key moves
    // on to the next one instead of failing the request.
    for _ in 0..keys.len() {
        let idx = cursor.fetch_add(1, Ordering::Relaxed) % keys.len();
        let key = &keys[idx];

        let res = client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(key)
            .json(body)
            .send()
            .await;

        let res = match res {
            Ok(r) => r,
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };

        let status = res.status();
        if status == 401 || status == 429 {
            last_error = format!("Groq key rejected ({status})");
            continue;
        }
        if !status.is_success() {
            last_error = format!("Groq request failed ({status})");
            continue;
        }

        let value: serde_json::Value = match res.json().await {
            Ok(v) => v,
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };

        let content = value
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.trim().to_string());

        match content {
            Some(text) if !text.is_empty() => return Ok(text),
            _ => last_error = "Groq returned an empty response".into(),
        }
    }

    Err(last_error)
}

/// Refines the query, falling back to the raw input if Groq is unreachable,
/// unconfigured, or every key is rate-limited — the feature degrades instead
/// of breaking.
pub async fn refine_search_query(input: &str) -> String {
    match call_groq(input).await {
        Ok(text) => text.trim_matches(|c| c == '"' || c == '\'').to_string(),
        Err(_) => input.to_string(),
    }
}

/// The verdict on a set of YouTube Music candidates for one Spotify track.
#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// This candidate (0-based) is the same recording.
    Same(usize),
    /// None of them is: a cover, a live take, a different song.
    NoneMatch,
}

/// Asks the model which candidate, if any, is the track itself.
///
/// `track` and `candidates` are one-line descriptions ("Title — Artist —
/// Album — 3:34"). The model only chooses; the caller still checks the
/// chosen one's length, so a confident wrong answer cannot pull in a
/// ten-minute mix.
pub async fn verify_match(track: &str, candidates: &[String]) -> Result<Verdict, String> {
    let list = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{}. {c}", i + 1))
        .collect::<Vec<_>>()
        .join("\n");
    let body = json!({
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {
                "role": "system",
                "content": "You match a Spotify track to YouTube Music search results. \
                    Pick the result that is the same recording: same song, same main artist, \
                    the original studio version. A cover, live, remix, sped up, slowed, \
                    karaoke or instrumental version is NOT the same unless the Spotify title \
                    says so too. Featured artists may be listed differently. Lengths within a \
                    few seconds are normal. Reply with JSON only: {\"match\": <number>} or \
                    {\"match\": null} if none is the same recording."
            },
            {
                "role": "user",
                "content": format!("Spotify track: {track}\n\nYouTube Music results:\n{list}")
            }
        ],
        "temperature": 0,
        "max_tokens": 20,
        "response_format": { "type": "json_object" }
    });

    let text = complete(verify_keys(), &VERIFY_CURSOR, &body).await?;
    parse_verdict(&text, candidates.len())
}

fn parse_verdict(text: &str, count: usize) -> Result<Verdict, String> {
    let value: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|e| format!("Unreadable verdict: {e}"))?;
    match value.get("match") {
        Some(serde_json::Value::Null) | None => Ok(Verdict::NoneMatch),
        Some(v) => match v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) {
            Some(n) if n >= 1 && (n as usize) <= count => Ok(Verdict::Same(n as usize - 1)),
            _ => Err(format!("Verdict out of range: {text}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdicts_are_read_and_bounded() {
        assert_eq!(parse_verdict(r#"{"match": 2}"#, 5), Ok(Verdict::Same(1)));
        assert_eq!(parse_verdict(r#"{"match": "1"}"#, 5), Ok(Verdict::Same(0)));
        assert_eq!(parse_verdict(r#"{"match": null}"#, 5), Ok(Verdict::NoneMatch));
        assert!(parse_verdict(r#"{"match": 9}"#, 5).is_err());
        assert!(parse_verdict("not json", 5).is_err());
    }
}
