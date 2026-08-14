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

/// Without a timeout, a single unresponsive key can hang the whole chain —
/// several stuck keys in a row would mean minutes of silent "Fetching…"
/// instead of falling back to the raw query.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);

/// Reads `GROQ_KEYS=a,b,c` out of a .env file. Missing file just means AI
/// search falls back to searching the raw text.
pub fn init(resource_dir: Option<std::path::PathBuf>) {
    let mut candidates = Vec::new();
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

    // An explicit environment variable wins over any file, which keeps CI and
    // `cargo run` overrides simple.
    if let Ok(raw) = std::env::var("GROQ_KEYS") {
        keys = split_keys(&raw);
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

async fn call_groq(input: &str) -> Result<String, String> {
    let keys = keys();
    if keys.is_empty() {
        return Err("No Groq keys configured".into());
    }

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

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

    let mut last_error = String::from("All Groq keys exhausted");

    // Rotate through the keys: a rate-limited (429) or dead (401) key moves
    // on to the next one instead of failing the request.
    for _ in 0..keys.len() {
        let idx = CURSOR.fetch_add(1, Ordering::Relaxed) % keys.len();
        let key = &keys[idx];

        let res = client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(key)
            .json(&body)
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
