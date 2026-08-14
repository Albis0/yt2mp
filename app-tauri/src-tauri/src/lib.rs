//! yt2mp — Tauri backend.
//!
//! Replaces the Electron build's three-layer arrangement (renderer → preload
//! bridge → main process → localhost Next server → yt-dlp) with two layers:
//! the webview calls a command, Rust runs yt-dlp. There is no HTTP server, no
//! second Node process, and no port to negotiate at startup.

mod binaries;
mod browsers;
mod groq;
mod platform;
mod settings;
mod suspend;
mod tools;
mod ytdlp;

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use ytdlp::Control;

/// Tracks in-flight downloads so pause/resume/stop can act on the right one
/// when several are running at once (e.g. two playlist tracks).
#[derive(Default)]
struct Downloads {
    inner: Mutex<HashMap<String, tokio::sync::watch::Sender<Control>>>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum InfoResult {
    Video { video: ytdlp::VideoInfo },
    Playlist { playlist: ytdlp::PlaylistInfo },
}

/// Resolves a link (single item or collection) or, in AI mode, a
/// Groq-rewritten search query.
///
/// URL validation is deliberately shallow: this checks only that the input
/// looks like a link and works out which site it belongs to. Deciding whether
/// a URL is actually downloadable is yt-dlp's job — it ships ~1750 extractors,
/// and re-implementing per-site URL shapes here would reject valid links the
/// moment a site changed one.
#[tauri::command]
async fn fetch_info(url: String, mode: String) -> Result<InfoResult, String> {
    let clean = url.trim().to_string();
    if clean.is_empty() {
        return Err(if mode == "ai" {
            "Describe what you're looking for.".into()
        } else {
            "Paste a link to get started.".into()
        });
    }

    // AI mode never touches URL parsing — it always goes through Groq to turn
    // the request into a search query, then ytsearch1 (YouTube only).
    if mode == "ai" {
        let query = groq::refine_search_query(&clean).await;
        let video = ytdlp::search_video_info(&query)
            .await
            .map_err(|_| "No results found for that search.".to_string())?;
        return Ok(InfoResult::Video { video });
    }

    let Some(detected) = platform::detect(&clean) else {
        return Err("That doesn't look like a link. Paste a URL, or switch to AI search.".into());
    };

    if platform::is_collection(&clean, detected) {
        let playlist = ytdlp::get_playlist_info(&clean, detected)
            .await
            .map_err(|e| platform::explain_error(&e, detected))?;
        return Ok(InfoResult::Playlist { playlist });
    }

    let video = ytdlp::get_video_info(&clean, detected)
        .await
        .map_err(|e| platform::explain_error(&e, detected))?;
    Ok(InfoResult::Video { video })
}

/// Turns a video title into a filename that is safe on Windows/macOS/Linux.
/// Falls back to a timestamped name so two downloads never silently overwrite
/// each other.
fn safe_file_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .filter(|c| !c.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let cleaned: String = cleaned.chars().take(120).collect();
    let cleaned = cleaned.trim_end_matches(['.', ' ']).to_string();

    if !cleaned.is_empty() {
        return cleaned;
    }

    format!(
        "yt2mp-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    )
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    id: String,
    percent: f64,
    stage: String,
}

/// Opens a native save dialog, then downloads straight to the chosen path.
///
/// Unlike the Electron build, nothing is buffered and nothing is written
/// twice: yt-dlp writes to the destination itself. Progress is pushed to the
/// UI as events rather than polled over HTTP.
#[tauri::command]
async fn start_download(
    app: AppHandle,
    downloads: State<'_, Downloads>,
    id: String,
    url: String,
    format: String,
    quality: Option<u32>,
    title: String,
) -> Result<String, String> {
    let Some(detected) = platform::detect(&url) else {
        return Err("That doesn't look like a link.".into());
    };
    if format != "mp3" && format != "mp4" {
        return Err("Format must be mp3 or mp4.".into());
    }

    let ext = if format == "mp3" { "mp3" } else { "mp4" };
    let default_name = format!("{}.{}", safe_file_name(&title), ext);

    let downloads_dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // The dialog plugin's blocking API is used from inside a spawned task so
    // the async command itself never blocks the IPC thread.
    let file_path = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let default_name = default_name.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(&default_name)
                .set_directory(&downloads_dir)
                .add_filter(if ext == "mp3" { "Audio" } else { "Video" }, &[ext])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| format!("Save dialog failed: {e}"))?;

    let Some(file_path) = file_path else {
        return Err("Save cancelled".into());
    };

    let dest: PathBuf = file_path
        .into_path()
        .map_err(|e| format!("Invalid save location: {e}"))?;

    // Control channel: the command holds the receiver, the map holds the
    // sender so pause/resume/stop can signal it by id.
    //
    // The lock is taken and released inside its own scope on purpose: holding
    // a std MutexGuard across the .await below would make this future non-Send
    // and Tauri would refuse to spawn it.
    let (tx, rx) = tokio::sync::watch::channel(Control::Run);
    {
        downloads.inner.lock().unwrap().insert(id.clone(), tx);
    }

    let emit_id = id.clone();
    let result = ytdlp::download_to_path(
        &url,
        &format,
        quality,
        &dest,
        detected,
        rx,
        |percent, stage| {
            let _ = app.emit(
                "download:progress",
                ProgressEvent {
                    id: emit_id.clone(),
                    percent,
                    stage: stage.to_string(),
                },
            );
        },
    )
    .await;

    downloads.inner.lock().unwrap().remove(&id);

    match result {
        Ok(()) => Ok(dest.to_string_lossy().into_owned()),
        Err(e) => {
            // Clean up a partial file rather than leaving a corrupt download
            // behind. Covers both a stop and a real failure.
            let _ = std::fs::remove_file(&dest);
            // "Download stopped" is a deliberate user action the UI matches
            // on by exact text — it must not be rewritten into a site
            // explanation.
            if e == "Download stopped" {
                Err(e)
            } else {
                Err(platform::explain_error(&e, detected))
            }
        }
    }
}

fn signal(downloads: &State<'_, Downloads>, id: &str, control: Control) {
    if let Some(tx) = downloads.inner.lock().unwrap().get(id) {
        let _ = tx.send(control);
    }
}

/// Kills an in-flight download and deletes its partial file. There is no
/// byte-offset to resume from afterwards (yt-dlp/ffmpeg re-transcode from
/// scratch every run), so the UI offers "Restart" rather than "Resume".
#[tauri::command]
fn stop_download(downloads: State<'_, Downloads>, id: String) {
    signal(&downloads, &id, Control::Stop);
}

/// Suspends the download's yt-dlp process, holding the transfer open without
/// buffering anything in memory. Only offered on large downloads — see
/// PAUSE_THRESHOLD_BYTES.
#[tauri::command]
fn pause_download(downloads: State<'_, Downloads>, id: String) {
    signal(&downloads, &id, Control::Pause);
}

#[tauri::command]
fn resume_download(downloads: State<'_, Downloads>, id: String) {
    signal(&downloads, &id, Control::Run);
}

/// Opens the finished file's containing folder in the system file manager.
#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// The stored settings, for the settings screen to render.
#[tauri::command]
fn get_settings() -> settings::Settings {
    settings::get()
}

/// Persists settings. Returns what was actually stored, which may differ from
/// what was sent if a value was rejected — the UI shows the stored value so
/// it can never claim a setting took effect when it did not.
#[tauri::command]
fn save_settings(next: settings::Settings) -> Result<settings::Settings, String> {
    settings::save(next)
}

/// Browsers found on this machine, forks included.
#[tauri::command]
fn detected_browsers() -> Vec<browsers::Browser> {
    browsers::detect()
}

/// The name to show for a saved choice, since settings store the yt-dlp
/// argument rather than a label.
#[tauri::command]
fn browser_label(arg: String) -> Option<String> {
    browsers::label_for(&arg)
}

/// One browser's result during the auto-check.
#[derive(Serialize, Clone)]
struct ProbeStep {
    label: String,
    arg: String,
    outcome: ytdlp::ProbeOutcome,
}

/// Posts used to tell "signed in" from "not signed in". They have to be ones
/// Instagram gates behind a login, otherwise every browser would pass and the
/// check would prove nothing.
///
/// More than one, because a single hard-coded reel can be deleted at any time
/// and a deleted post fails for every browser — which would look exactly like
/// "none of your browsers is signed in" and send the user chasing a problem
/// they do not have.
const PROBE_URLS: [&str; 2] = [
    "https://www.instagram.com/reel/DAqU8ZBRtvW/",
    "https://www.instagram.com/reel/C8k9y0RtqXm/",
];

/// Tries every installed browser against a login-gated post and saves the
/// first one that works.
///
/// This exists because asking the user which browser they are signed into is
/// a question they often cannot answer — people have four browsers and no
/// memory of which one has Instagram open. Pressing one button and being told
/// the answer is the whole point.
///
/// Progress is emitted per browser so the UI can show the check happening
/// rather than freezing for the length of several network round-trips.
#[tauri::command]
async fn find_working_browser(app: AppHandle) -> Result<Vec<ProbeStep>, String> {
    let found = browsers::detect();
    if found.is_empty() {
        return Err("No browser was found on this computer.".into());
    }

    let mut steps: Vec<ProbeStep> = Vec::new();
    let mut winner: Option<String> = None;

    for browser in found {
        let _ = app.emit("login:probing", browser.label.clone());

        // Try the next post only when the previous one gave a verdict that
        // could be the post's own fault rather than the browser's.
        let mut outcome = ytdlp::ProbeOutcome::Failed {
            reason: "No probe ran.".into(),
        };
        for url in PROBE_URLS {
            outcome = ytdlp::probe_browser(&browser.arg, url).await;
            match outcome {
                // A locked cookie store is about the browser, and a working
                // one needs no second opinion — both are final.
                ytdlp::ProbeOutcome::Works | ytdlp::ProbeOutcome::Locked => break,
                _ => continue,
            }
        }

        let step = ProbeStep {
            label: browser.label.clone(),
            arg: browser.arg.clone(),
            outcome: outcome.clone(),
        };
        steps.push(step.clone());
        let _ = app.emit("login:probed", step);

        // Stop at the first success — continuing would only spend the user's
        // time confirming that other browsers also work.
        if outcome == ytdlp::ProbeOutcome::Works {
            winner = Some(browser.arg);
            break;
        }
    }

    // The stored setting always reflects what the check just proved. Leaving a
    // previously-chosen browser saved after it demonstrably failed is how the
    // panel ends up claiming "Currently using Zen" directly above a row saying
    // Zen did not work.
    settings::save(settings::Settings {
        cookies_from: winner,
    })?;

    Ok(steps)
}

/// Whether the external tools are present, and which yt-dlp is installed.
#[tauri::command]
async fn tools_status(app: AppHandle) -> tools::ToolsStatus {
    tools::status(&app).await
}

/// Downloads whatever is missing. Safe to call repeatedly: anything already
/// on disk is left alone, so a retry after a failed first run resumes rather
/// than starting over.
#[tauri::command]
async fn ensure_tools(app: AppHandle) -> Result<tools::ToolsStatus, String> {
    tools::ensure(&app, Vec::new()).await
}

/// Re-downloads yt-dlp on its own. This is how a user fixes a site that has
/// broken upstream without waiting for a yt2mp release.
#[tauri::command]
async fn update_ytdlp(app: AppHandle) -> Result<tools::ToolsStatus, String> {
    tools::update_ytdlp(&app).await
}

/// The running version, for the settings panel and the update check. Read
/// from the bundle rather than a constant so it cannot disagree with what was
/// actually installed.
#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Provides relaunch() so the app can restart itself into the new
        // version after an update installs.
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(Downloads::default())
        .setup(|app| {
            binaries::init(app.handle());
            groq::init(app.handle().path().resource_dir().ok());
            settings::init(app.handle().path().app_config_dir().ok());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_info,
            start_download,
            stop_download,
            pause_download,
            resume_download,
            reveal_file,
            get_settings,
            save_settings,
            detected_browsers,
            browser_label,
            find_working_browser,
            tools_status,
            ensure_tools,
            update_ytdlp,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running yt2mp");
}

#[cfg(test)]
mod tests {
    use super::*;

    // URL detection and per-site behaviour are tested in platform.rs, which
    // owns them now.

    #[test]
    fn strips_characters_windows_rejects() {
        assert_eq!(safe_file_name("a/b:c*d?e\"f<g>h|i"), "abcdefghi");
    }

    #[test]
    fn collapses_whitespace_and_trims_trailing_dots() {
        assert_eq!(safe_file_name("  hello   world...  "), "hello world");
    }

    #[test]
    fn empty_title_falls_back_to_timestamp() {
        assert!(safe_file_name("///").starts_with("yt2mp-"));
    }
}
