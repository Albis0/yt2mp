//! yt-dlp invocation: argument building, process spawning, and output parsing.
//!
//! Port of the Electron build's `lib/ytdlp.ts`. The format-selector chain and
//! progress parsing are carried over intact — they were the result of real
//! bugs (quality buttons silently delivering 360p) and none of that logic
//! changes just because the caller is Rust now.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::binaries::{ffmpeg_path, qjs_path, ytdlp_path};

/// Without a deadline, a yt-dlp call stuck on a slow or dead network path
/// hangs the "Fetching…" UI indefinitely instead of surfacing an error the
/// user can act on.
///
/// Raised from 25s once extraction started querying two player clients (see
/// `player_client_args`). That takes ~10s on a fast connection here, and 25s
/// left no room for anything slower — a fetch that works fine but reports
/// "took too long to respond" is the worst of both.
pub const INFO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// Per-browser budget when testing logins. Several browsers are tried in a
/// row, so one slow attempt must not hold up the whole check.
pub const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Long enough for a 4K video on a slow connection, short enough that a stuck
/// download surfaces an error instead of hanging forever.
pub const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Spawning a console subprocess on Windows flashes a black window on every
/// call unless CREATE_NO_WINDOW is set. Equivalent to Node's `windowsHide`.
#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    // tokio::process::Command exposes creation_flags directly, so the std
    // CommandExt trait is not needed (and importing it would be dead code).
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

pub fn base_command(program: PathBuf) -> Command {
    let mut cmd = Command::new(program);
    hide_window(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

/// yt-dlp needs a JavaScript runtime to solve YouTube's player challenges
/// (EJS). Without one, extraction does not merely lose a few formats — it
/// fails with "n challenge solving failed" and returns *only* storyboard
/// images, so every download is impossible rather than just low quality.
///
/// The Electron build solved this by pointing yt-dlp at its own Electron
/// binary running in node mode (`ELECTRON_RUN_AS_NODE=1`). A Tauri app has no
/// Node runtime to reuse, so one has to ship. yt-dlp supports deno, node, bun
/// and quickjs; quickjs is by far the smallest at ~2MB (deno is ~100MB), and
/// it solves the challenge correctly — verified against a 4K video, which
/// lists every DASH format up to 2160p60 with it and none without it.
fn js_runtime_args() -> Vec<String> {
    let path = qjs_path();
    if path.exists() {
        vec![
            "--js-runtimes".into(),
            format!("quickjs:{}", path.to_string_lossy()),
        ]
    } else {
        // Without the bundled runtime yt-dlp falls back to its own defaults
        // (a system deno/node, if the user happens to have one). Extraction
        // will likely fail, but failing with yt-dlp's own diagnostic beats
        // passing a flag pointing at a file that is not there.
        Vec::new()
    }
}

/// Which YouTube player clients to extract from, in preference order.
///
/// Extraction succeeds against every client — title, duration and a full
/// format list with plausible sizes — and then the media request is refused.
/// The user sees a download that fails instantly on a file the app has just
/// offered them at 3.6 MB.
///
/// Measured against the same video, one client at a time:
///
/// | client | result | extract time |
/// |---|---|---|
/// | `default` (starts at `android_vr`) | **HTTP 403** | 10s |
/// | `ios` | **HTTP 403** | — |
/// | `web`, `web_safari`, `tv` | "Requested format is not available" | — |
/// | `mweb` | works | **31s** |
/// | `android` | works | 9s |
///
/// The three that report a missing format are caught in YouTube's SABR-only
/// experiment (yt-dlp#12482): the format is announced but no usable URL comes
/// with it. The 403s are clients whose media URLs YouTube no longer honours.
///
/// So: `android` first, `default` behind it as a safety net for the day
/// YouTube turns `android` off too.
///
/// **`mweb` is deliberately not in this list even though it works.** It takes
/// 31s to extract on its own and 43s combined, against an `INFO_TIMEOUT` of
/// 45s — every fetch would sit at the edge of timing out, and on a connection
/// slower than this one it would go over. A client that works but times out is
/// not a working client.
///
/// **Do not "improve" this by adding more fallbacks.** An earlier attempt
/// added `tv` and `web_safari` for exactly that reason and made things worse:
/// the selector then prefers *their* format, so the extra clients caused the
/// failure they were meant to prevent. Any change here needs measuring — both
/// that it downloads *and* how long extraction takes — against a video that
/// has not been fetched recently, since YouTube throttles repeat requests and
/// a throttled 403 looks identical to a broken client.
///
/// This tracks YouTube's current behaviour and will go stale. That is what
/// "Update yt-dlp" in Settings is for: upstream adjusts its client list far
/// faster than this app ships releases.
fn player_client_args() -> Vec<String> {
    vec![
        "--extractor-args".into(),
        "youtube:player_client=android,default".into(),
    ]
}

/// yt-dlp does NOT read any FFMPEG_LOCATION environment variable — the merge
/// step only finds the bundled ffmpeg via this CLI flag. (On Windows it
/// happens to work without it because process creation searches yt-dlp.exe's
/// own directory, but Linux spawn only searches PATH.)
fn ffmpeg_location_args() -> Vec<String> {
    vec![
        "--ffmpeg-location".into(),
        ffmpeg_path().to_string_lossy().into_owned(),
    ]
}

/// One selectable video quality, with the size it is expected to produce.
///
/// The estimate drives whether pause/resume is offered at all: holding a
/// download open is only worth the complexity on genuinely long transfers, so
/// the controls appear above a size threshold and stay out of the way below
/// it. Sizes come from yt-dlp's own `filesize`/`filesize_approx`, which are
/// per-stream — a merged MP4 is video + audio, so the best audio stream is
/// added on top of the video stream to get a realistic total.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QualityOption {
    pub height: u32,
    /// Estimated bytes for the final merged file. `None` when yt-dlp reported
    /// no size for the streams involved (live streams, some DASH manifests).
    #[serde(rename = "estimatedBytes")]
    pub estimated_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    pub duration: f64,
    pub uploader: String,
    #[serde(rename = "availableHeights")]
    pub available_heights: Vec<u32>,
    /// Per-height size estimates, highest quality first.
    pub qualities: Vec<QualityOption>,
    /// Estimated bytes for the MP3 path (best audio stream, re-encoded at
    /// 192 kbps — close enough to the source size for a threshold check).
    #[serde(rename = "audioEstimatedBytes")]
    pub audio_estimated_bytes: Option<u64>,
    /// Which site this came from — drives the badge and the canonical link
    /// the UI offers.
    pub platform: crate::platform::Platform,
    /// Whether the UI can play this inline. Decided here rather than in the
    /// frontend so the rule lives in one place.
    #[serde(rename = "canEmbed")]
    pub can_embed: bool,
    /// The page this media lives on. yt-dlp resolves redirects and short
    /// links (vm.tiktok.com, t.co), so this is the canonical URL even when
    /// the user pasted something shorter.
    #[serde(rename = "webpageUrl")]
    pub webpage_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub url: String,
    pub duration: f64,
    pub uploader: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlaylistInfo {
    pub id: String,
    pub title: String,
    pub entries: Vec<PlaylistEntry>,
}

/// Extra arguments needed by specific sites.
///
/// Instagram and TikTok serve different (often better) media to a mobile
/// browser than to a desktop one, and both are quicker to block a default
/// python-requests-shaped client. A regular browser user-agent avoids the
/// most common empty-response failures without pretending to be logged in.
fn platform_args(platform: crate::platform::Platform) -> Vec<String> {
    use crate::platform::Platform;
    let mut args = match platform {
        Platform::Instagram | Platform::TikTok => vec![
            "--user-agent".into(),
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) \
             AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                .into(),
        ],
        Platform::YouTube => player_client_args(),
        _ => Vec::new(),
    };

    // Instagram in particular refuses most media to logged-out clients
    // ("Instagram sent an empty media response"), and a user-agent alone does
    // not fix it. If the user has opted into sharing a browser's cookies,
    // pass them through — that is the only way those posts become
    // downloadable, and it uses the login they already have rather than
    // asking for credentials.
    // Cookies are only sent to sites that actually gate media behind a login.
    // YouTube, X and Twitch work fine logged out, and handing a site session
    // cookies it never needed widens what the app exposes for no benefit.
    if needs_login(platform) {
        if let Some(browser) = crate::settings::cookie_browser() {
            args.push("--cookies-from-browser".into());
            args.push(browser);
        }
    }

    args
}

/// Sites that refuse most media unless the request carries a login.
fn needs_login(platform: crate::platform::Platform) -> bool {
    use crate::platform::Platform;
    matches!(platform, Platform::Instagram | Platform::TikTok)
}

/// How a single browser fared when tested against a login-gated post.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase", tag = "status")]
pub enum ProbeOutcome {
    /// Cookies read, and the site served the post — this browser is signed in.
    Works,
    /// Cookies read fine, but the site still refused: not signed in there.
    NotSignedIn,
    /// The cookie store could not be read because the browser is running.
    Locked,
    /// The login was found and sent, but the site rejected the request itself.
    ///
    /// On Instagram this is almost always rate limiting. Instagram answers
    /// its own API with **HTTP 429** once a device has made too many
    /// requests, and yt-dlp surfaces that as a bare "HTTP Error 400: Bad
    /// Request" — verified live by calling the API directly with the same
    /// cookies, and with no cookies at all, both of which returned 429 while
    /// ordinary instagram.com pages still loaded.
    ///
    /// Kept separate from `NotSignedIn` because the advice is the opposite:
    /// signing in again cannot help, and waiting does.
    SignedInButBlocked,
    /// Anything else, carrying yt-dlp's own words.
    Failed { reason: String },
}

/// Classifies one browser by actually asking Instagram for a post with its
/// cookies attached.
///
/// A post is fetched rather than merely reading the cookie file, because "the
/// file was readable" and "the site accepts this session" are different
/// questions and only the second one matters. `--simulate` means nothing is
/// downloaded.
pub async fn probe_browser(browser: &str, url: &str) -> ProbeOutcome {
    let mut cmd = base_command(ytdlp_path());
    cmd.args(js_runtime_args());
    cmd.arg("--cookies-from-browser");
    cmd.arg(browser);
    cmd.args(["--simulate", "--no-warnings", "--print", "%(id)s", url]);

    let Ok(child) = cmd.spawn() else {
        return ProbeOutcome::Failed {
            reason: "Could not start yt-dlp.".into(),
        };
    };

    // Deliberately shorter than INFO_TIMEOUT: several browsers are probed in
    // sequence and one wedged attempt should not stall the whole run.
    let output = match tokio::time::timeout(PROBE_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            return ProbeOutcome::Failed {
                reason: format!("yt-dlp failed: {e}"),
            }
        }
        Err(_) => {
            return ProbeOutcome::Failed {
                reason: "Timed out.".into(),
            }
        }
    };

    if output.status.success() {
        return ProbeOutcome::Works;
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    if stderr.contains("could not copy") && stderr.contains("cookie database") {
        ProbeOutcome::Locked
    } else if stderr.contains("empty media response")
        || stderr.contains("login required")
        || stderr.contains("requested content is not available")
        || stderr.contains("not granting access")
    {
        ProbeOutcome::NotSignedIn
    } else if stderr.contains("http error 400")
        || stderr.contains("http error 401")
        || stderr.contains("http error 429")
        || stderr.contains("too many requests")
        || stderr.contains("video info extraction failed")
    {
        // The session was accepted as a session and then the API call was
        // refused — on Instagram, a 429 wearing a 400's clothes. Checked
        // before the generic branch so this does not surface as a raw
        // "HTTP Error 400" the user cannot act on.
        ProbeOutcome::SignedInButBlocked
    } else {
        let first = String::from_utf8_lossy(&output.stderr)
            .lines()
            .find(|l| l.to_ascii_lowercase().contains("error"))
            .unwrap_or("Could not use this browser.")
            .trim()
            .to_string();
        ProbeOutcome::Failed { reason: first }
    }
}

/// Runs yt-dlp to completion, capturing stdout. Errors carry yt-dlp's own
/// stderr so the UI can show something more useful than an exit code.
pub async fn run_ytdlp(
    args: Vec<String>,
    platform: crate::platform::Platform,
) -> Result<String, String> {
    let mut cmd = base_command(ytdlp_path());
    cmd.args(js_runtime_args());
    cmd.args(platform_args(platform));
    cmd.args(&args);

    let child = cmd.spawn().map_err(|e| {
        format!("Could not start yt-dlp ({e}). The bundled binary may be missing.")
    })?;

    let output = tokio::time::timeout(INFO_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "Timed out — yt-dlp took too long to respond.".to_string())?
        .map_err(|e| format!("yt-dlp failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("yt-dlp exited with {}", output.status)
        } else {
            crate::platform::explain_error(&stderr, platform)
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Collects the distinct video heights yt-dlp reported, highest first, so the
/// UI can offer real quality choices instead of a fixed list.
fn extract_available_heights(formats: &[serde_json::Value]) -> Vec<u32> {
    let mut heights: Vec<u32> = formats
        .iter()
        .filter(|f| {
            f.get("vcodec")
                .and_then(|v| v.as_str())
                .is_some_and(|v| v != "none")
        })
        .filter_map(|f| f.get("height").and_then(|h| h.as_u64()).map(|h| h as u32))
        .collect();
    heights.sort_unstable_by(|a, b| b.cmp(a));
    heights.dedup();
    heights
}

/// yt-dlp reports either an exact `filesize` or an estimated
/// `filesize_approx`, depending on whether the server sent a Content-Length.
/// Either is good enough for a threshold check.
fn format_size(format: &serde_json::Value) -> Option<u64> {
    format
        .get("filesize")
        .and_then(|v| v.as_u64())
        .or_else(|| format.get("filesize_approx").and_then(|v| v.as_u64()))
}

fn is_video_stream(f: &serde_json::Value) -> bool {
    f.get("vcodec")
        .and_then(|v| v.as_str())
        .is_some_and(|v| v != "none")
}

fn is_audio_stream(f: &serde_json::Value) -> bool {
    f.get("acodec")
        .and_then(|v| v.as_str())
        .is_some_and(|v| v != "none")
}

/// Largest audio-only stream, used as the audio half of a merged MP4 estimate
/// and as the MP3 estimate on its own.
fn best_audio_size(formats: &[serde_json::Value]) -> Option<u64> {
    formats
        .iter()
        .filter(|f| is_audio_stream(f) && !is_video_stream(f))
        .filter_map(format_size)
        .max()
}

/// Builds a size estimate per available height. For each height the largest
/// video stream is taken (yt-dlp's selector prefers the best one), then the
/// best audio stream is added since a merged MP4 carries both.
fn build_qualities(formats: &[serde_json::Value]) -> Vec<QualityOption> {
    let heights = extract_available_heights(formats);
    let audio = best_audio_size(formats);

    heights
        .into_iter()
        .map(|height| {
            let video = formats
                .iter()
                .filter(|f| is_video_stream(f))
                .filter(|f| {
                    f.get("height").and_then(|h| h.as_u64()).map(|h| h as u32) == Some(height)
                })
                .filter_map(format_size)
                .max();

            // A pre-muxed stream already contains audio, so adding the audio
            // stream on top would double-count. Those only exist at or below
            // 360p, where the threshold never triggers anyway, but the
            // estimate should still be honest.
            let premuxed = formats.iter().any(|f| {
                is_video_stream(f)
                    && is_audio_stream(f)
                    && f.get("height").and_then(|h| h.as_u64()).map(|h| h as u32) == Some(height)
            });

            let estimated_bytes = match (video, audio) {
                (Some(v), Some(a)) if !premuxed => Some(v + a),
                (Some(v), _) => Some(v),
                _ => None,
            };

            QualityOption {
                height,
                estimated_bytes,
            }
        })
        .collect()
}

/// A usable title, whatever the site calls it.
///
/// YouTube always sets `title`. TikTok, Instagram and X frequently do not —
/// a post has caption text rather than a title, and yt-dlp then synthesises
/// something like "Video by username" or leaves it empty. Falling back
/// through description and uploader keeps the result card and the suggested
/// filename meaningful instead of "Unknown video".
fn best_title(value: &serde_json::Value) -> String {
    let candidates = ["title", "fulltitle", "description", "uploader", "id"];

    for key in candidates {
        if let Some(text) = value.get(key).and_then(|v| v.as_str()) {
            let cleaned = text.trim();
            if cleaned.is_empty() {
                continue;
            }
            // A caption can be a whole paragraph; a title should not be. Cut
            // at the first line break, then clamp on a word boundary.
            let first_line = cleaned.lines().next().unwrap_or(cleaned).trim();
            if first_line.is_empty() {
                continue;
            }
            if first_line.chars().count() <= 100 {
                return first_line.to_string();
            }
            let truncated: String = first_line.chars().take(100).collect();
            let cut = truncated.rfind(' ').unwrap_or(truncated.len());
            return format!("{}…", truncated[..cut].trim_end());
        }
    }

    "Untitled".to_string()
}

/// yt-dlp exposes the best thumbnail as `thumbnail`, but some extractors only
/// populate the `thumbnails` array — take the last entry there, which is the
/// highest quality by yt-dlp's own ordering.
fn best_thumbnail(value: &serde_json::Value) -> String {
    if let Some(url) = value.get("thumbnail").and_then(|v| v.as_str()) {
        if !url.is_empty() {
            return url.to_string();
        }
    }

    value
        .get("thumbnails")
        .and_then(|t| t.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string()
}

fn parse_video_info(value: &serde_json::Value, platform: crate::platform::Platform) -> VideoInfo {
    let empty = Vec::new();
    let formats = value
        .get("formats")
        .and_then(|f| f.as_array())
        .unwrap_or(&empty);

    // Prefer yt-dlp's resolved page URL: it survives short links and
    // redirects (vm.tiktok.com/…, t.co/…), so history and the "open original"
    // link point somewhere durable.
    let webpage_url = value
        .get("webpage_url")
        .or_else(|| value.get("original_url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    VideoInfo {
        id: value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: best_title(value),
        thumbnail: best_thumbnail(value),
        duration: value.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
        uploader: value
            .get("uploader")
            .or_else(|| value.get("channel"))
            .or_else(|| value.get("uploader_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        available_heights: extract_available_heights(formats),
        qualities: build_qualities(formats),
        audio_estimated_bytes: best_audio_size(formats),
        platform,
        can_embed: platform.supports_embed(),
        webpage_url,
    }
}

pub async fn get_video_info(
    url: &str,
    platform: crate::platform::Platform,
) -> Result<VideoInfo, String> {
    let stdout = run_ytdlp(
        vec!["-J".into(), "--no-playlist".into(), url.to_string()],
        platform,
    )
    .await?;
    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Could not read video info: {e}"))?;

    // Some extractors return a playlist-shaped object even with
    // --no-playlist (an Instagram carousel post, a tweet with several
    // videos). Take the first real entry so the UI still has something to
    // show rather than an item with no formats at all.
    let target = value
        .get("entries")
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
        .unwrap_or(&value);

    Ok(parse_video_info(target, platform))
}

/// Uses `--flat-playlist` so yt-dlp only lists entries instead of resolving
/// full formats for every track up front: the list appears instantly, and
/// each track's real info is fetched only when the user expands it. Opening a
/// 500-track playlist does not mean waiting on 500 yt-dlp calls.
pub async fn get_playlist_info(
    url: &str,
    platform: crate::platform::Platform,
) -> Result<PlaylistInfo, String> {
    let stdout = run_ytdlp(
        vec!["-J".into(), "--flat-playlist".into(), url.to_string()],
        platform,
    )
    .await?;
    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Could not read playlist: {e}"))?;

    let entries = value
        .get("entries")
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .map(|e| {
                    let id = e.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let url = e
                        .get("url")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
                    PlaylistEntry {
                        id,
                        title: e
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown track")
                            .to_string(),
                        url,
                        duration: e.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        uploader: e
                            .get("uploader")
                            .or_else(|| e.get("channel"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(PlaylistInfo {
        id: value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Playlist")
            .to_string(),
        entries,
    })
}

/// Resolves a free-text search to a real video the same way typing into
/// YouTube's search bar would — no API key, no link required.
pub async fn search_video_info(query: &str) -> Result<VideoInfo, String> {
    // Search is YouTube-only: ytsearch: is the one search pseudo-URL that
    // matters here, so a search result is always a YouTube video.
    let stdout = run_ytdlp(
        vec!["-J".into(), format!("ytsearch1:{query}")],
        crate::platform::Platform::YouTube,
    )
    .await?;
    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Could not read search result: {e}"))?;

    let first = value
        .get("entries")
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
        .unwrap_or(&value);

    Ok(parse_video_info(first, crate::platform::Platform::YouTube))
}

/// YouTube only offers a single pre-muxed (video+audio combined) stream up to
/// 360p — every quality above that is video-only and audio-only DASH streams
/// that have to be downloaded separately and merged. Above 1080p those streams
/// are often VP9/AV1-only (no avc1/mp4), so a selector locked to `[ext=mp4]`
/// can skip every DASH stream and land on its last resort: the pre-muxed
/// 360p — the UI then shows "2160p" while the file arrives at 360p.
///
/// This chain prefers mp4/m4a (fast stream-copy merge, best player
/// compatibility) but walks through any-codec video and any-codec audio before
/// ever settling for the pre-muxed fallback.
pub fn build_video_format_selector(quality: Option<u32>) -> String {
    let cap = quality
        .map(|h| format!("[height<={h}]"))
        .unwrap_or_default();

    format!(
        "bestvideo{cap}[ext=mp4]+bestaudio[ext=m4a]/\
         bestvideo{cap}+bestaudio[ext=m4a]/\
         bestvideo{cap}+bestaudio/\
         best{cap}/\
         best"
    )
}

/// Matches yt-dlp's `--newline` progress format, e.g.
/// `[download]  34.5% of   29.01MiB at   20.51MiB/s ETA 00:00`
fn parse_progress_percent(line: &str) -> Option<f64> {
    let rest = line.split("[download]").nth(1)?.trim_start();
    let percent_str = rest.split('%').next()?.trim();
    percent_str.parse::<f64>().ok()
}

/// What a running download can be told to do from the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    Run,
    Pause,
    Stop,
}

/// Downloads straight to the user's chosen path.
///
/// This is the big structural win over the Electron build. There, an MP4 was
/// written to a temp file by yt-dlp, streamed over localhost HTTP to the main
/// process, and written to disk a second time — every byte hit the disk twice
/// and crossed an HTTP boundary in between. Here yt-dlp writes to the final
/// destination directly and the only thing crossing a boundary is a progress
/// number.
///
/// `on_progress` is called with yt-dlp's own parsed percentages. Two streams
/// download in sequence (video, then audio) before merging, so video is scaled
/// into 0-80% and audio into 80-95% — that way the bar does not visually
/// restart from zero partway through. The merge step reports no progress at
/// all, so it holds at 95 until completion.
///
/// `control` carries pause/resume/stop from the UI. Pause suspends the yt-dlp
/// process rather than buffering its output (see src/suspend.rs).
/// Audio format selectors to try, in order, when the previous one was refused.
///
/// YouTube gates individual formats rather than whole videos, and *which* ones
/// vary per video and per session. Measured within minutes of each other:
///
/// | format | 4-hour lofi mix | Despacito |
/// |---|---|---|
/// | 140 (m4a, 129k) | works | **403** |
/// | 251 (opus, 141k) | **403** | works |
/// | 139 (m4a, 49k) | works | works |
/// | 249 (opus, 53k) | works | **403** |
///
/// The two videos disagree on every high-bitrate format. That is why no single
/// selector can be correct — `bestaudio` picks one gated format on one video
/// and a different gated one on the next — and why this is a ladder rather
/// than a cleverer guess. Each rung names a *different* stream so a retry is
/// never the same request twice.
///
/// Quality only drops at the last rung, and all of these re-encode to the same
/// 192 kbps MP3, so the audible cost of falling through is near zero.
const AUDIO_FALLBACKS: [&str; 3] = [
    "bestaudio[ext=m4a]/bestaudio/best",
    "bestaudio[ext=webm]/bestaudio",
    "worstaudio/worst",
];

/// True when yt-dlp refused at the *media* request rather than at extraction.
///
/// Extraction succeeded, a format was chosen and announced with a real size,
/// and the byte request was then denied. That is the one failure a different
/// format can fix; everything else (no such video, no network, a dead link)
/// would fail identically on a retry and must surface immediately.
fn is_format_refusal(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("http error 403")
        || e.contains("forbidden")
        || e.contains("unable to download video data")
        || e.contains("requested format is not available")
}

pub async fn download_to_path<F>(
    url: &str,
    format: &str,
    quality: Option<u32>,
    dest: &PathBuf,
    platform: crate::platform::Platform,
    control: tokio::sync::watch::Receiver<Control>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64, &str) + Send,
{
    let selectors: Vec<String> = if format == "mp3" {
        AUDIO_FALLBACKS.iter().map(|s| s.to_string()).collect()
    } else {
        video_format_fallbacks(quality)
    };

    let mut last_err = String::new();
    for (attempt, selector) in selectors.iter().enumerate() {
        let result = download_once(
            url,
            format,
            selector,
            dest,
            platform,
            control.clone(),
            &mut on_progress,
        )
        .await;

        match result {
            Ok(()) => return Ok(()),
            Err(e) => {
                // A stop is the user's decision, not a failure to work around.
                if e == "Download stopped" {
                    return Err(e);
                }
                if !is_format_refusal(&e) {
                    return Err(crate::platform::explain_error(&e, platform));
                }
                // Nothing usable was produced; clear it before trying the next
                // stream so a half-written file can never be mistaken for the
                // finished download.
                let _ = std::fs::remove_file(dest);
                last_err = e;
                if attempt + 1 < selectors.len() {
                    on_progress(0.0, "Retrying with another stream");
                }
            }
        }
    }

    // Every stream this site offered was refused. Only now is it worth
    // translating: up to here the raw text was what decided each retry.
    Err(crate::platform::explain_error(&last_err, platform))
}

/// Video selectors to try in turn. Same reasoning as `AUDIO_FALLBACKS`: the
/// first prefers mp4/m4a, the second takes whatever other container exists,
/// the third gives up on quality to get *something*.
fn video_format_fallbacks(quality: Option<u32>) -> Vec<String> {
    let cap = quality
        .map(|h| format!("[height<={h}]"))
        .unwrap_or_default();
    vec![
        build_video_format_selector(quality),
        format!("bestvideo{cap}[ext=webm]+bestaudio[ext=webm]/bestvideo{cap}+bestaudio"),
        format!("best{cap}/best"),
    ]
}

/// One download attempt with one format selector.
#[allow(clippy::too_many_arguments)]
async fn download_once<F>(
    url: &str,
    format: &str,
    selector: &str,
    dest: &PathBuf,
    platform: crate::platform::Platform,
    control: tokio::sync::watch::Receiver<Control>,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(f64, &str) + Send,
{
    let mut cmd = base_command(ytdlp_path());
    cmd.args(js_runtime_args());
    cmd.args(platform_args(platform));

    if format == "mp3" {
        // yt-dlp's own post-processing extracts and re-encodes the audio with
        // the bundled ffmpeg. The Electron build piped raw audio through a
        // separate ffmpeg process into an HTTP response because it had to
        // stream over localhost; writing a real file lets yt-dlp do it in one
        // step, with correct metadata and no second process to babysit.
        cmd.args([
            "-f",
            selector,
            "--no-playlist",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "192K",
        ]);
    } else {
        cmd.args([
            "-f",
            selector,
            "--no-playlist",
            "--merge-output-format",
            "mp4",
        ]);
    }

    cmd.args(ffmpeg_location_args());

    // yt-dlp appends its own extension based on the final container, so the
    // output template is given without one and the result is moved into place
    // afterwards. Passing the exact destination would produce e.g.
    // "song.mp3.mp3" for the audio path.
    let stem = dest.with_extension("");
    cmd.args([
        "--newline",
        "--no-part",
        "-o",
        &format!("{}.%(ext)s", stem.to_string_lossy()),
        url,
    ]);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start yt-dlp ({e})."))?;

    let stdout = child.stdout.take().ok_or("Could not read yt-dlp output")?;
    let mut reader = BufReader::new(stdout).lines();

    let pid = child.id().ok_or("Could not track the download process")?;

    let mut streams_seen = 0u32;
    let mut last_percent_in_stream = 0.0f64;
    let mut last_percent_overall = 0.0f64;
    let mut paused = false;

    let deadline = tokio::time::sleep(DOWNLOAD_TIMEOUT);
    tokio::pin!(deadline);

    let mut control = control;

    loop {
        tokio::select! {
            changed = control.changed() => {
                if changed.is_err() {
                    // Sender dropped (the command returned) — nothing left to
                    // listen for, let the read loop finish normally.
                    continue;
                }
                // Copy the value out and drop the borrow guard immediately:
                // holding it across the .await below would make this future
                // non-Send, which Tauri's command handler rejects.
                let requested = *control.borrow();
                match requested {
                    Control::Stop => {
                        // A suspended process ignores kill on Windows until it
                        // is resumed, so always lift the suspension first.
                        if paused {
                            let _ = crate::suspend::resume_process(pid);
                        }
                        let _ = child.kill().await;
                        return Err("Download stopped".into());
                    }
                    Control::Pause if !paused => {
                        crate::suspend::suspend_process(pid)?;
                        paused = true;
                        on_progress(last_percent_overall, "Paused");
                    }
                    Control::Run if paused => {
                        crate::suspend::resume_process(pid)?;
                        paused = false;
                        on_progress(last_percent_overall, "Downloading");
                    }
                    _ => {}
                }
            }
            // A paused download makes no progress by definition, so the
            // timeout must not run while suspended — otherwise leaving one
            // paused would eventually kill it with a misleading "took too
            // long" error.
            _ = &mut deadline, if !paused => {
                let _ = child.kill().await;
                return Err("Timed out — download took too long.".into());
            }
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        // A new "Destination:" after real progress means
                        // yt-dlp moved on to the next stream (video → audio).
                        if line.contains("Destination:") && last_percent_in_stream > 0.0 {
                            streams_seen += 1;
                            last_percent_in_stream = 0.0;
                        }
                        if line.contains("Merging formats") {
                            last_percent_overall = 95.0;
                            on_progress(95.0, "Merging");
                            continue;
                        }
                        if let Some(percent) = parse_progress_percent(&line) {
                            last_percent_in_stream = percent;
                            let overall = if streams_seen == 0 {
                                percent / 100.0 * 80.0
                            } else {
                                80.0 + percent / 100.0 * 15.0
                            };
                            let overall = overall.min(95.0);
                            last_percent_overall = overall;
                            let stage = if streams_seen == 0 { "Downloading" } else { "Audio" };
                            on_progress(overall, stage);
                        }
                    }
                    Ok(None) => break,
                    Err(e) => return Err(format!("Could not read yt-dlp output: {e}")),
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("yt-dlp failed: {e}"))?;

    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut err) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let _ = err.read_to_string(&mut stderr).await;
        }
        // Raw stderr on purpose: the caller decides whether another format is
        // worth trying, and that decision reads yt-dlp's own words ("HTTP
        // Error 403"). Translating here once hid the status code from
        // `is_format_refusal`, so every retry was skipped and the ladder above
        // was dead code that still looked correct.
        let trimmed = stderr.trim();
        return Err(if trimmed.is_empty() {
            "Download failed.".to_string()
        } else {
            trimmed.to_string()
        });
    }

    // Move yt-dlp's actual output (whose extension it chose) onto the exact
    // path the user picked in the save dialog.
    let expected_ext = if format == "mp3" { "mp3" } else { "mp4" };
    let produced = stem.with_extension(expected_ext);
    if produced != *dest && produced.exists() {
        std::fs::rename(&produced, dest)
            .map_err(|e| format!("Could not save to the chosen location: {e}"))?;
    }

    if !dest.exists() {
        return Err("Download finished but the file is missing.".into());
    }

    on_progress(100.0, "Saved");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_line_parses_percent() {
        let line = "[download]  34.5% of   29.01MiB at   20.51MiB/s ETA 00:00";
        assert_eq!(parse_progress_percent(line), Some(34.5));
    }

    #[test]
    fn progress_line_parses_integer_percent() {
        assert_eq!(
            parse_progress_percent("[download] 100% of 5.00MiB in 00:01"),
            Some(100.0)
        );
    }

    #[test]
    fn non_progress_lines_are_ignored() {
        assert_eq!(parse_progress_percent("[info] Downloading 1 format(s)"), None);
        assert_eq!(parse_progress_percent(""), None);
    }

    /// The bug this guards against shipped once: a selector locked to
    /// [ext=mp4] skipped every VP9/AV1 DASH stream and silently fell back to
    /// the pre-muxed 360p, so a "2160p" button delivered 360p.
    #[test]
    fn video_selector_falls_back_past_mp4_only() {
        let sel = build_video_format_selector(Some(2160));
        assert!(sel.starts_with("bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]"));
        assert!(sel.contains("bestvideo[height<=2160]+bestaudio/"));
        assert!(sel.contains("best[height<=2160]"));
    }

    /// Sites other than YouTube often serve a single pre-muxed stream with no
    /// height metadata at all. A selector ending at `best[height<=N]` matches
    /// nothing there, so an uncapped `best` has to come last — otherwise a
    /// TikTok or Instagram download fails with "requested format not
    /// available" instead of just downloading the one format on offer.
    #[test]
    fn video_selector_ends_with_uncapped_best_for_non_dash_sites() {
        assert!(build_video_format_selector(Some(1080)).ends_with("/best"));
        assert!(build_video_format_selector(None).ends_with("/best"));
    }

    #[test]
    fn video_selector_without_quality_has_no_height_cap() {
        let sel = build_video_format_selector(None);
        assert!(!sel.contains("height"));
    }

    /// Cookies belong only to sites that gate media behind a login. Sending a
    /// browser session to YouTube, X or Twitch — none of which need it —
    /// would hand out the user's identity for nothing.
    #[test]
    fn only_login_gated_sites_receive_cookies() {
        use crate::platform::Platform;
        assert!(needs_login(Platform::Instagram));
        assert!(needs_login(Platform::TikTok));
        assert!(!needs_login(Platform::YouTube));
        assert!(!needs_login(Platform::Twitter));
        assert!(!needs_login(Platform::Twitch));
        assert!(!needs_login(Platform::Other));
    }

    /// "Signed in but refused" must not be reported as "not signed in": the
    /// advice for the two is opposite, and telling someone who is already
    /// logged in to log in again sends them chasing a problem they do not
    /// have. Observed live: Instagram answers an authenticated request with
    /// HTTP 400 while the same session works in the browser.
    #[test]
    fn http_400_is_not_mistaken_for_a_missing_login() {
        let blocked = "ERROR: [Instagram] X: Video info extraction failed: \
                       HTTP Error 400: Bad Request";
        let lower = blocked.to_ascii_lowercase();
        assert!(
            !lower.contains("empty media response"),
            "must not fall into the not-signed-in branch"
        );
        assert!(lower.contains("http error 400"));
    }

    /// Only a refusal at the media request is worth another format. A dead
    /// link or a missing video would fail identically on every rung, so
    /// retrying it just makes the user wait three times for the same answer.
    #[test]
    fn only_media_refusals_are_retried() {
        assert!(is_format_refusal(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        ));
        assert!(is_format_refusal("ERROR: Requested format is not available"));
        assert!(!is_format_refusal("ERROR: Video unavailable"));
        assert!(!is_format_refusal("ERROR: Unsupported URL: foo"));
        assert!(!is_format_refusal("Download stopped"));
    }

    /// Every rung has to name a different stream. Two rungs that resolve to
    /// the same format would send the identical refused request twice and
    /// call it a fallback.
    #[test]
    fn fallback_rungs_are_distinct() {
        let mut seen = std::collections::HashSet::new();
        for s in AUDIO_FALLBACKS {
            assert!(seen.insert(s), "duplicate audio selector: {s}");
        }
        let video = video_format_fallbacks(Some(1080));
        let mut seen_v = std::collections::HashSet::new();
        for s in &video {
            assert!(seen_v.insert(s.clone()), "duplicate video selector: {s}");
        }
    }

    /// The first audio rung must prefer m4a. It is the one that survives when
    /// YouTube gates the opus stream, which is the common case that made
    /// music downloads fail.
    #[test]
    fn first_audio_rung_prefers_m4a() {
        assert!(AUDIO_FALLBACKS[0].contains("m4a"));
        assert!(AUDIO_FALLBACKS[0].ends_with("/best"), "keeps a safety net");
    }

    /// A height cap the user asked for must survive into every video rung
    /// except the deliberate last-resort one.
    #[test]
    fn video_fallbacks_keep_the_quality_cap() {
        let v = video_format_fallbacks(Some(720));
        assert!(v[0].contains("height<=720"));
        assert!(v[1].contains("height<=720"));
    }

    /// Cookie sharing stays off until it is switched on, whatever else is
    /// configured. This is the guarantee that matters most in this file.
    #[test]
    fn no_cookie_flag_when_no_browser_is_chosen() {
        use crate::platform::Platform;
        struct EnvGuard;
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                std::env::remove_var("YT2MP_COOKIES_FROM");
            }
        }
        let _guard = EnvGuard;
        std::env::remove_var("YT2MP_COOKIES_FROM");

        let args = platform_args(Platform::Instagram);
        assert!(
            !args.iter().any(|a| a == "--cookies-from-browser"),
            "cookies must never be sent unless explicitly enabled"
        );
    }

    #[test]
    fn title_prefers_the_real_title_when_there_is_one() {
        let v = serde_json::json!({ "title": "Real Title", "description": "a caption" });
        assert_eq!(best_title(&v), "Real Title");
    }

    /// TikTok/Instagram posts frequently have no title — only caption text.
    /// Falling through to the description keeps the result card and the
    /// suggested filename meaningful instead of "Unknown video".
    #[test]
    fn title_falls_back_to_description_then_uploader() {
        let v = serde_json::json!({ "title": "", "description": "a caption here" });
        assert_eq!(best_title(&v), "a caption here");

        let v = serde_json::json!({ "uploader": "someuser" });
        assert_eq!(best_title(&v), "someuser");

        assert_eq!(best_title(&serde_json::json!({})), "Untitled");
    }

    /// A caption can be a whole paragraph; a title should be one line.
    #[test]
    fn title_takes_only_the_first_line_and_clamps_length() {
        let v = serde_json::json!({ "description": "first line\nsecond line" });
        assert_eq!(best_title(&v), "first line");

        let long = "word ".repeat(60);
        let v = serde_json::json!({ "description": long });
        let title = best_title(&v);
        assert!(title.chars().count() <= 101, "got {} chars", title.chars().count());
        assert!(title.ends_with('…'));
    }

    /// Some extractors populate only the `thumbnails` array, not `thumbnail`.
    #[test]
    fn thumbnail_falls_back_to_the_thumbnails_array() {
        let v = serde_json::json!({
            "thumbnails": [{ "url": "low.jpg" }, { "url": "high.jpg" }]
        });
        assert_eq!(best_thumbnail(&v), "high.jpg");

        let v = serde_json::json!({ "thumbnail": "direct.jpg" });
        assert_eq!(best_thumbnail(&v), "direct.jpg");

        assert_eq!(best_thumbnail(&serde_json::json!({})), "");
    }
}
