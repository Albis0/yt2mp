//! AI search and the Spotify match check, on Groq.
//!
//! The shared keys are not in this app. A request without a key of the
//! person's own goes to the project's server (web/lib/ai.ts), which holds the
//! keys, counts the allowance, and answers. A key of their own goes straight
//! to Groq, from this machine, and is not counted.
//!
//! The server's address is the site's; YT2MP_AI_URL points a dev build at a
//! local copy of it.

use crate::quota::{self, Access, Use};
use serde_json::json;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Emitter;

/// The person's own key has no rotation to do, but `complete` wants a cursor.
static OWN_CURSOR: AtomicUsize = AtomicUsize::new(0);

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Lets this module tell the window when an allowance runs out.
pub fn set_app(handle: tauri::AppHandle) {
    let _ = APP.set(handle);
}

/// Tells the window, once per window of 24 hours, that a daily allowance is
/// spent and what the app does instead.
fn notice(kind: Use) {
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "ai:limit",
            match kind {
                Use::Search => "search",
                Use::Verify => "verify",
            },
        );
    }
}

/// Why the server gave no answer.
enum Remote {
    /// This install's allowance (or its address's) is spent.
    Limit,
    Failed(String),
}

/// When the server last failed to answer (unix seconds, 0 for never). A site
/// that is asleep or down would otherwise cost every track of a playlist its
/// own wait.
static DOWN_SINCE: AtomicU64 = AtomicU64::new(0);
const COOL_OFF: u64 = 120;
/// A free instance that has gone to sleep takes a while to wake; past this the
/// feature gives up and the app carries on without it.
const SERVER_TIMEOUT: Duration = Duration::from_secs(8);

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn server_down() -> bool {
    let since = DOWN_SINCE.load(Ordering::Relaxed);
    since != 0 && now().saturating_sub(since) < COOL_OFF
}

async fn ask_server(path: &str, mut payload: serde_json::Value) -> Result<String, Remote> {
    let base =
        std::env::var("YT2MP_AI_URL").unwrap_or_else(|_| "https://yt2mp.onrender.com".into());
    payload["install"] = json!(quota::install_id());
    let failed = |why: String| {
        DOWN_SINCE.store(now(), Ordering::Relaxed);
        Remote::Failed(why)
    };
    let client = reqwest::Client::builder()
        .timeout(SERVER_TIMEOUT)
        .build()
        .map_err(|e| Remote::Failed(e.to_string()))?;
    let res = client
        .post(format!("{}/api/ai/{path}", base.trim_end_matches('/')))
        .json(&payload)
        .send()
        .await
        .map_err(|e| failed(e.to_string()))?;
    match res.status().as_u16() {
        200..=299 => {
            let value: serde_json::Value = res.json().await.map_err(|e| failed(e.to_string()))?;
            match value.get("text").and_then(|t| t.as_str()) {
                Some(text) => {
                    DOWN_SINCE.store(0, Ordering::Relaxed);
                    Ok(text.to_string())
                }
                None => Err(failed("The AI server sent nothing back".into())),
            }
        }
        429 => Err(Remote::Limit),
        s => Err(failed(format!(
            "The AI server answered with an error ({s})"
        ))),
    }
}

/// Runs one request under the allowance: the person's own key if they have
/// one, otherwise the server with a use set aside. `Err("limit")` means the
/// allowance is spent and nothing was sent.
async fn metered(
    kind: Use,
    direct: &serde_json::Value,
    path: &str,
    payload: serde_json::Value,
) -> Result<String, String> {
    match quota::reserve(kind) {
        Access::Own(key) => complete(&[key], &OWN_CURSOR, direct).await,
        Access::Shared => {
            if server_down() {
                quota::refund(kind);
                return Err("The AI server is not answering".into());
            }
            match ask_server(path, payload).await {
                Ok(text) => Ok(text),
                Err(Remote::Limit) => {
                    if quota::exhaust(kind) {
                        notice(kind);
                    }
                    Err("limit".into())
                }
                Err(Remote::Failed(why)) => {
                    quota::refund(kind);
                    Err(why)
                }
            }
        }
        Access::Spent { first } => {
            if first {
                notice(kind);
            }
            Err("limit".into())
        }
    }
}

/// Without a timeout, a single unresponsive key can hang the whole chain —
/// several stuck keys in a row would mean minutes of silent "Fetching…"
/// instead of falling back to the raw query.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);

/// Reads the optional `YT2MP_COOKIES_FROM` browser-cookie setting that
/// ytdlp.rs uses (Instagram in particular needs it) out of a .env file, and
/// promotes it to the environment. Keeping `.env` the one place a person
/// configures the app avoids a second mechanism. Groq keys are not read from
/// it: the shared ones live on the server.
pub fn init(resource_dir: Option<std::path::PathBuf>, config_dir: Option<std::path::PathBuf>) {
    if std::env::var("YT2MP_COOKIES_FROM").is_ok() {
        return;
    }
    let mut candidates = Vec::new();
    if let Some(dir) = config_dir {
        candidates.push(dir.join(".env"));
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join(".env"));
        candidates.push(dir.join("resources").join(".env"));
    }
    candidates.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".env"));
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(".env.local"),
    );

    for path in &candidates {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        if let Some(raw) = content
            .lines()
            .find_map(|l| l.trim().strip_prefix("YT2MP_COOKIES_FROM="))
        {
            let value = raw.trim().trim_matches('"');
            if !value.is_empty() {
                std::env::set_var("YT2MP_COOKIES_FROM", value);
                return;
            }
        }
    }
}

/// Whether Spotify matches are worth sending to the model: not while the
/// server is known to be down, which would put a wait on every track.
pub fn can_verify() -> bool {
    quota::own_key().is_some() || !server_down()
}

/// Asks Groq for its model list with the key, which costs nothing and fails
/// the same way a search would, so a mistyped or revoked key is caught when it
/// is saved and not on the next search.
pub async fn check_key(key: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get("https://api.groq.com/openai/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|_| "Could not reach Groq. Check your connection and try again.".to_string())?;
    match res.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err("Groq rejected that key. Check that you copied all of it.".into()),
        // A valid key that is simply busy is still a valid key.
        429 => Ok(()),
        s => Err(format!(
            "Groq answered with an error ({s}). Try again in a moment."
        )),
    }
}

/// The prompts below are the person's-own-key copies; the server has its own
/// (web/lib/ai.ts) and the two are kept the same.
async fn call_groq(input: &str) -> Result<String, String> {
    let body = json!({
        "model": "openai/gpt-oss-20b",
        "messages": [
            {
                "role": "system",
                "content": "Convert the user's request into a short, precise YouTube search query (artist + song/video title, no extra words). Reply with only the query, nothing else."
            },
            { "role": "user", "content": input }
        ],
        "temperature": 0.2,
        // The model reasons before it answers, and the reasoning counts here.
        "max_completion_tokens": 200,
        "reasoning_effort": "low"
    });
    metered(Use::Search, &body, "search", json!({ "text": input })).await
}

/// Sends one chat request, rotating through `keys` until one answers.
async fn complete(
    keys: &[String],
    cursor: &AtomicUsize,
    body: &serde_json::Value,
) -> Result<String, String> {
    if keys.is_empty() {
        return Err("No Groq key".into());
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
        "model": "openai/gpt-oss-120b",
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
        "max_completion_tokens": 200,
        "reasoning_effort": "low",
        "response_format": { "type": "json_object" }
    });

    let text = metered(
        Use::Verify,
        &body,
        "verify",
        json!({ "track": track, "candidates": candidates }),
    )
    .await?;
    parse_verdict(&text, candidates.len())
}

fn parse_verdict(text: &str, count: usize) -> Result<Verdict, String> {
    let value: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|e| format!("Unreadable verdict: {e}"))?;
    match value.get("match") {
        Some(serde_json::Value::Null) | None => Ok(Verdict::NoneMatch),
        Some(v) => match v
            .as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        {
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
        assert_eq!(
            parse_verdict(r#"{"match": null}"#, 5),
            Ok(Verdict::NoneMatch)
        );
        assert!(parse_verdict(r#"{"match": 9}"#, 5).is_err());
        assert!(parse_verdict("not json", 5).is_err());
    }
}
