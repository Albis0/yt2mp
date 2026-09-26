//! yt2mp — Tauri backend.
//!
//! Replaces the Electron build's three-layer arrangement (renderer → preload
//! bridge → main process → localhost Next server → yt-dlp) with two layers:
//! the webview calls a command, Rust runs yt-dlp. There is no HTTP server, no
//! second Node process, and no port to negotiate at startup.

mod binaries;
mod browsers;
mod cache_node;
mod convert;
mod groq;
mod platform;
mod scan;
mod settings;
mod tools;
mod ytdlp;

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

    // Windows keeps these names for devices, with any extension: a video
    // titled "CON" or "nul" cannot be saved as CON.mp3 at all.
    if is_reserved_on_windows(&cleaned) {
        return format!("{cleaned}_");
    }

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

fn is_reserved_on_windows(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit())
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    id: String,
    percent: f64,
    stage: String,
    /// Bytes and pace, while a download is actually moving data. Absent for
    /// conversions and for stages that move none (starting, merging).
    #[serde(skip_serializing_if = "Option::is_none")]
    transfer: Option<ytdlp::Transfer>,
}

/// Preferred window size, in logical pixels, on a screen large enough for it.
const PREFERRED_W: f64 = 900.0;
const PREFERRED_H: f64 = 760.0;

/// Shrink the window to fit the screen it opens on, and re-centre it.
///
/// The configured 900x760 is a good size at 1080p and does not fit a 1366x768
/// laptop at all: 760px of window plus a taskbar exceeds the 768px screen, so
/// the bottom of the app — including whatever the user was reaching for —
/// ends up under the taskbar or off-screen entirely, on a window with no
/// title bar to drag it back by.
///
/// Work-area rather than full screen size, so the taskbar is already excluded
/// rather than guessed at. Only ever shrinks: on a large monitor this leaves
/// the configured size alone.
fn fit_window_to_screen(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // No monitor information is a reason to leave the window as configured,
    // not to guess at a size.
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let avail_w = area.size.width as f64 / scale;
    let avail_h = area.size.height as f64 / scale;

    // Leave a margin so the window reads as a window rather than something
    // wedged into the screen edge to edge.
    let w = PREFERRED_W.min(avail_w - 40.0);
    let h = PREFERRED_H.min(avail_h - 40.0);

    if w >= PREFERRED_W && h >= PREFERRED_H {
        return;
    }

    // Never below the minimums the layout needs to stay usable; on a screen
    // smaller than that, a window running off the edge is still better than
    // one whose contents overlap.
    let w = w.max(560.0);
    let h = h.max(480.0);

    let _ = window.set_size(tauri::LogicalSize::new(w, h));
    let _ = window.center();
}

/// Destinations that downloads still running have claimed. A download only
/// appears at its final name once it is complete, so the disk alone cannot
/// say that a name is taken: two downloads of the same title into the same
/// folder would both pick "Song.mp3" and the second would replace the first.
static CLAIMED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// A destination reserved for one download, released when dropped.
struct Claim {
    path: PathBuf,
}

impl Claim {
    /// The first free name for `desired`, free both on disk and among the
    /// downloads still running.
    fn new(desired: &Path) -> Self {
        let mut claimed = CLAIMED.lock().unwrap();
        let path = free_path(desired, |p| p.exists() || claimed.iter().any(|c| c == p));
        claimed.push(path.clone());
        Self { path }
    }
}

impl Drop for Claim {
    fn drop(&mut self) {
        CLAIMED.lock().unwrap().retain(|c| c != &self.path);
    }
}

/// Returns a path that does not exist yet, adding " (2)", " (3)" … before the
/// extension.
///
/// Only used for whole-playlist downloads. The save dialog asks about
/// overwriting on its own, but a playlist saving unattended has no one to ask
/// — and mixes really do repeat titles, so without this a 40-track mix with
/// two "Intro" entries would silently end up with 39 files.
fn unique_path(desired: &Path) -> PathBuf {
    free_path(desired, Path::exists)
}

/// `unique_path` with the test for "taken" supplied by the caller.
fn free_path(desired: &Path, taken: impl Fn(&Path) -> bool) -> PathBuf {
    if !taken(desired) {
        return desired.to_path_buf();
    }
    let dir = desired.parent().unwrap_or(Path::new("."));
    let stem = desired
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let ext = desired
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    for n in 2..1000 {
        let candidate = dir.join(if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        });
        if !taken(&candidate) {
            return candidate;
        }
    }
    desired.to_path_buf()
}

/// The folder a whole playlist saves into: the download folder, asked for
/// here if this is the first download. Called once before the queue starts,
/// so a first-time playlist asks a single time rather than per track.
#[tauri::command]
async fn download_folder(app: AppHandle) -> Result<Option<String>, String> {
    Ok(download_folder_or_ask(&app)
        .await?
        .map(|d| d.to_string_lossy().into_owned()))
}

/// Opens a file picker for the converter tab and reports what was chosen.
///
/// No extension filter is offered on purpose: the tab's promise is that
/// whatever you put in comes out as an MP3, and a filter listing twelve
/// extensions would both misrepresent that and hide a working file whose
/// extension nobody thought to include. ffmpeg decides what it can read, and
/// [`convert::probe`] reports the verdict per file before anything runs.
///
/// Files that cannot be read are returned as errors rather than dropped, so
/// the UI can say which file it refused and why instead of silently picking
/// up four of the five files someone selected.
#[tauri::command]
async fn pick_media_files(app: AppHandle) -> Result<Vec<ProbedFile>, String> {
    let start_dir = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .unwrap_or_else(|_| PathBuf::from("."));

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_directory(&start_dir)
                .blocking_pick_files()
        }
    })
    .await
    .map_err(|e| format!("File dialog failed: {e}"))?;

    let Some(picked) = picked else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for entry in picked {
        let Ok(path) = entry.into_path() else { continue };
        out.push(match convert::probe(&path).await {
            Ok(info) => ProbedFile::Ok { info },
            Err(reason) => ProbedFile::Bad {
                path: path.to_string_lossy().into_owned(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                reason,
            },
        });
    }

    Ok(out)
}

/// Saves an already-converted file somewhere else, via the save dialog.
///
/// The converter writes beside the original because that is what makes it
/// usable on twenty files at once. This is the escape hatch for the one file
/// someone wants somewhere specific — it copies rather than moves, so the
/// list's own row keeps working afterwards.
///
/// The dialog's filter is taken from the file's own extension rather than
/// being fixed to MP3: offering "MP3 audio" while saving an MP4 would have
/// the dialog append `.mp3` to a video on the platforms that enforce their
/// filter, producing a file that will not open.
#[tauri::command]
async fn save_a_copy(app: AppHandle, path: String, name: String) -> Result<Option<String>, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("That file isn't where it was — it may have been moved.".into());
    }

    let start_dir = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .unwrap_or_else(|_| PathBuf::from("."));

    // Whatever the file already is. An unknown extension gets no filter at
    // all, which is better than a wrong one.
    let extension = source
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());

    let chosen = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let mut dialog = app
                .dialog()
                .file()
                .set_directory(&start_dir)
                .set_file_name(&name);

            if let Some(extension) = extension.as_deref() {
                let label = match extension {
                    "mp3" => "MP3 audio",
                    "mp4" => "MP4 video",
                    other => return dialog.add_filter(other, &[other]).blocking_save_file(),
                };
                dialog = dialog.add_filter(label, &[extension]);
            }

            dialog.blocking_save_file()
        }
    })
    .await
    .map_err(|e| format!("Save dialog failed: {e}"))?;

    // Closing the dialog is a decision, not a failure: None travels back as a
    // plain result so the UI leaves the row exactly as it was.
    let Some(chosen) = chosen else {
        return Ok(None);
    };

    let dest = chosen
        .into_path()
        .map_err(|_| "That save location can't be used.".to_string())?;

    if dest == source {
        return Ok(Some(dest.to_string_lossy().into_owned()));
    }

    tokio::fs::copy(&source, &dest)
        .await
        .map_err(|_| "Couldn't save it there. Try another folder.".to_string())?;

    Ok(Some(dest.to_string_lossy().into_owned()))
}

/// The size of a file on disk, for showing the MP3 that replaced a source in
/// the converter list. None rather than an error: a missing size is worth
/// leaving blank, not worth a failure.
#[tauri::command]
async fn file_size(path: String) -> Option<u64> {
    tokio::fs::metadata(&path).await.ok().map(|m| m.len())
}

/// Looks for downloadable media on a page that is not itself a video page.
///
/// Split into two commands rather than one, because they cost different
/// things and the user is told which is running. `scan_page_quick` is a few
/// seconds and always safe; `scan_page_deep` fetches the page and tests its
/// links, and is only run when the user asks for it after the quick pass came
/// back empty.
#[tauri::command]
async fn scan_page_quick(url: String) -> Result<Vec<scan::Found>, String> {
    let clean = url.trim();
    if clean.is_empty() {
        return Err("Paste the address of the page you want to search.".into());
    }
    if platform::detect(clean).is_none() {
        return Err("That doesn't look like a link. Paste a page address.".into());
    }

    Ok(scan::quick(clean).await)
}

/// The deep pass. Returns the merged list, so the UI replaces its rows with
/// this rather than having to combine two results itself.
#[tauri::command]
async fn scan_page_deep(url: String) -> Result<Vec<scan::Found>, String> {
    let clean = url.trim();
    if clean.is_empty() {
        return Err("Paste the address of the page you want to search.".into());
    }
    if platform::detect(clean).is_none() {
        return Err("That doesn't look like a link. Paste a page address.".into());
    }

    let deep = scan::deep(clean).await?;
    Ok(scan::merge(scan::quick(clean).await, deep))
}

/// One picked file: either something convertible, or a named reason it is not.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ProbedFile {
    Ok { info: convert::SourceInfo },
    Bad { path: String, name: String, reason: String },
}

/// Converts one already-on-disk file to MP3 or MP4, beside the original.
///
/// Shares the download path's registry and its `download:progress` channel, so
/// the same stop button and the same progress plumbing work here — a converted
/// row and a downloaded row behave identically from the UI's side.
///
/// One command for both targets rather than two: everything around the
/// conversion — the registry entry, the progress channel, the collision guard,
/// deleting a half-written file — is identical, and only the arguments handed
/// to ffmpeg differ. Splitting it would duplicate all of that so the two
/// copies could drift.
#[tauri::command]
async fn convert_file(
    app: AppHandle,
    downloads: State<'_, Downloads>,
    id: String,
    path: String,
    target: convert::Target,
    duration: Option<f64>,
) -> Result<String, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("That file isn't where it was — it may have been moved.".into());
    }

    // Read the file as it is right now, not as it was when the user picked
    // it: the probe behind the row may be minutes old and the file can be
    // replaced on disk in between.
    //
    // Two things depend on the answer. An MP3 from a soundless file is a
    // valid, empty, useless file, so it is refused here as well as in the UI.
    // An MP4 from a pictureless file needs a picture generated for it, or
    // ffmpeg writes an MP4 containing only audio.
    let info = convert::probe(&source).await?;

    if target.needs_audio() && !info.has_audio {
        return Err(format!("{} has no sound in it.", info.name));
    }

    // Never write over the file being read: converting "song.mp3" to MP3, or
    // an MP4 to MP4, would otherwise truncate the source ffmpeg is still
    // decoding. The MP4 case is the common one — re-encoding a video that
    // will not play is most of why this target exists.
    let desired = convert::default_dest(&source, target);
    let dest = if desired == source {
        unique_path(&source.with_extension("").with_extension(target.extension()))
    } else {
        unique_path(&desired)
    };

    let (tx, rx) = tokio::sync::watch::channel(Control::Run);
    {
        downloads.inner.lock().unwrap().insert(id.clone(), tx);
    }

    let emit_id = id.clone();
    let result = convert::convert(
        &source,
        &dest,
        target,
        info.has_video,
        duration,
        rx,
        |percent, stage| {
            let _ = app.emit(
                "download:progress",
                ProgressEvent {
                    id: emit_id.clone(),
                    percent,
                    stage: stage.to_string(),
                    transfer: None,
                },
            );
        },
    )
    .await;

    downloads.inner.lock().unwrap().remove(&id);

    match result {
        Ok(()) => Ok(dest.to_string_lossy().into_owned()),
        Err(e) => {
            // A half-written file is worse than none: it plays, badly, and
            // looks like a finished file in the folder.
            let _ = std::fs::remove_file(&dest);
            Err(e)
        }
    }
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
    into_dir: Option<String>,
) -> Result<String, String> {
    let Some(detected) = platform::detect(&url) else {
        return Err("That doesn't look like a link.".into());
    };
    if format != "mp3" && format != "mp4" {
        return Err("Format must be mp3 or mp4.".into());
    }

    let ext = if format == "mp3" { "mp3" } else { "mp4" };
    let default_name = format!("{}.{}", safe_file_name(&title), ext);

    // `into_dir` is the whole-playlist path: the folder was chosen once, up
    // front, so each track saves without a dialog. Asking per track would mean
    // sitting through one prompt per song, which defeats the point of a
    // "download everything" button.
    //
    // Everything else goes to the saved download folder. The first download
    // asks for it; after that nothing asks, and Settings changes it.
    let dir: PathBuf = match into_dir {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            if !dir.is_dir() {
                return Err("That folder no longer exists.".into());
            }
            dir
        }
        None => match download_folder_or_ask(&app).await? {
            Some(dir) => dir,
            None => return Err("Save cancelled".into()),
        },
    };
    let claim = Claim::new(&dir.join(&default_name));
    let dest = claim.path.clone();

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
        |percent, stage, transfer| {
            let _ = app.emit(
                "download:progress",
                ProgressEvent {
                    id: emit_id.clone(),
                    percent,
                    stage: stage.to_string(),
                    transfer,
                },
            );
        },
    )
    .await;

    downloads.inner.lock().unwrap().remove(&id);
    // Released only now: the file is at its name (or never will be), so the
    // disk answers for it from here on.
    drop(claim);

    match result {
        Ok(()) => Ok(dest.to_string_lossy().into_owned()),
        Err(e) => {
            // Nothing to clean up here: the download worked under its own
            // name and removed its leftovers, and `dest` is never touched
            // unless it finished. Deleting it here once took the user's
            // previous file with it when they had chosen to replace one.
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

/// Held while the first download asks where downloads go, so pressing MP3 and
/// MP4 in quick succession opens one folder dialog rather than two. The
/// second waits, then finds the answer the first one saved.
static ASKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The saved download folder, or, when there is none yet, the one the user
/// picks now — which is then saved. `None` when they close the dialog.
async fn download_folder_or_ask(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    if let Some(dir) = settings::download_dir() {
        return Ok(Some(dir));
    }
    let _asking = ASKING.lock().await;
    if let Some(dir) = settings::download_dir() {
        return Ok(Some(dir));
    }
    let Some(dir) = ask_for_folder(app, "Where should downloads be saved?").await? else {
        return Ok(None);
    };
    settings::update(|s| s.download_dir = Some(dir.to_string_lossy().into_owned()))?;
    Ok(Some(dir))
}

/// A folder dialog opening on the current download folder, or on the
/// system's Downloads when there is none.
async fn ask_for_folder(app: &AppHandle, title: &'static str) -> Result<Option<PathBuf>, String> {
    let start = settings::download_dir()
        .or_else(|| app.path().download_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_title(title)
                .set_directory(&start)
                .blocking_pick_folder()
        }
    })
    .await
    .map_err(|e| format!("Folder dialog failed: {e}"))?;

    match picked {
        None => Ok(None),
        Some(p) => p
            .into_path()
            .map(Some)
            .map_err(|e| format!("Invalid folder: {e}")),
    }
}

/// Settings' "Change…": picks a new download folder and saves it. Returns the
/// stored settings, or `None` when the dialog was closed.
#[tauri::command]
async fn choose_download_dir(app: AppHandle) -> Result<Option<settings::Settings>, String> {
    let Some(dir) = ask_for_folder(&app, "Save downloads to").await? else {
        return Ok(None);
    };
    settings::update(|s| s.download_dir = Some(dir.to_string_lossy().into_owned())).map(Some)
}

/// Settings' "Ask next time": forgets the folder, so the next download asks.
#[tauri::command]
fn forget_download_dir() -> Result<settings::Settings, String> {
    settings::update(|s| s.download_dir = None)
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
    // Only the cookie source is edited through here. The download folder has
    // its own commands, and taking it from `next` would clear it whenever the
    // page saved a cookie choice without mentioning the folder.
    settings::update(|s| s.cookies_from = next.cookies_from)
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
    settings::update(|s| s.cookies_from = winner)?;

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

/// Asks whether a newer yt-dlp exists, without downloading anything. Lets the
/// settings panel behave like the app's own updater — look first, then offer.
#[tauri::command]
async fn check_ytdlp(app: AppHandle) -> Result<tools::YtdlpCheck, String> {
    tools::check_ytdlp(&app).await
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
            fit_window_to_screen(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_info,
            start_download,
            download_folder,
            pick_media_files,
            convert_file,
            scan_page_quick,
            scan_page_deep,
            save_a_copy,
            file_size,
            stop_download,
            reveal_file,
            get_settings,
            save_settings,
            detected_browsers,
            browser_label,
            find_working_browser,
            tools_status,
            ensure_tools,
            update_ytdlp,
            check_ytdlp,
            app_version,
            choose_download_dir,
            forget_download_dir
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

    /// Two downloads of the same title into one folder, both still running:
    /// neither file exists yet, so only the claim keeps them apart.
    #[test]
    fn running_downloads_never_share_a_destination() {
        let dir = std::env::temp_dir().join("yt2mp-claims");
        let _ = std::fs::create_dir_all(&dir);
        let want = dir.join("Same Title.mp3");
        let _ = std::fs::remove_file(&want);

        let first = Claim::new(&want);
        let second = Claim::new(&want);
        assert_eq!(first.path, want);
        assert_eq!(second.path, dir.join("Same Title (2).mp3"));

        drop(first);
        let third = Claim::new(&want);
        assert_eq!(third.path, want, "a released name is free again");
        drop((second, third));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unused_name_is_left_alone() {
        let dir = std::env::temp_dir().join("yt2mp-unique-free");
        let _ = std::fs::create_dir_all(&dir);
        let want = dir.join("song.mp3");
        let _ = std::fs::remove_file(&want);
        assert_eq!(unique_path(&want), want);
    }

    // Mixes really do repeat titles. Without this, the second "Intro" would
    // overwrite the first and a 40-track playlist would quietly yield 39 files.
    #[test]
    fn a_taken_name_gets_a_number_and_keeps_its_extension() {
        let dir = std::env::temp_dir().join("yt2mp-unique-taken");
        let _ = std::fs::create_dir_all(&dir);
        let first = dir.join("Intro.mp3");
        std::fs::write(&first, b"x").unwrap();

        let second = unique_path(&first);
        assert_eq!(second, dir.join("Intro (2).mp3"));

        std::fs::write(&second, b"x").unwrap();
        assert_eq!(unique_path(&first), dir.join("Intro (3).mp3"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn device_names_windows_reserves_are_made_saveable() {
        assert_eq!(safe_file_name("CON"), "CON_");
        assert_eq!(safe_file_name("nul"), "nul_");
        assert_eq!(safe_file_name("com1"), "com1_");
        assert_eq!(safe_file_name("Console"), "Console");
        assert_eq!(safe_file_name("COMA"), "COMA");
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
