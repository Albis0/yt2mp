//! Locating the bundled yt-dlp / ffmpeg binaries.
//!
//! In the Electron build these paths were resolved in the main process and
//! injected into a child Node server's environment (YTDLP_PATH/FFMPEG_PATH).
//! There is no child server any more, so resolution happens once here and the
//! rest of the app just asks for the path.

use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

// RwLock rather than OnceLock: the tools are downloaded after startup, so
// these have to be resolvable a second time. With OnceLock the first
// resolution — taken before the files existed — would stick, and the app
// would keep invoking a bare "yt-dlp" off PATH for the rest of the session.
static YTDLP: RwLock<Option<PathBuf>> = RwLock::new(None);
static FFMPEG: RwLock<Option<PathBuf>> = RwLock::new(None);
static QJS: RwLock<Option<PathBuf>> = RwLock::new(None);

/// yt-dlp/ffmpeg ship as `.exe` on Windows and as plain ELF binaries on Linux.
fn binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Resolves a bundled binary through Tauri's resource directory. In dev that
/// is `src-tauri/resources/`; in a packaged app it is the platform's resource
/// folder, both configured via `tauri.conf.json`'s `bundle.resources`.
/// Resolves a binary right now, bypassing the cache.
///
/// `tools::status` needs this: the cached path was worked out at startup, when
/// a just-downloaded binary did not exist yet, and the cache's PATH fallback
/// would make a missing tool look present.
pub fn resolve_now(app: &AppHandle, base: &str) -> PathBuf {
    resolve(app, base)
}

fn resolve(app: &AppHandle, base: &str) -> PathBuf {
    let name = binary_name(base);

    // Downloaded tools win over everything else. They are the normal case in a
    // packaged build (the binaries are no longer bundled into the installer)
    // and they are the only copy that "Update yt-dlp" can replace — a stale
    // bundled resource shadowing a freshly downloaded one would make that
    // button appear to do nothing.
    if let Some(tools) = crate::tools::dir(app) {
        let downloaded = tools.join(&name);
        if downloaded.exists() {
            return downloaded;
        }
    }

    if let Ok(dir) = app.path().resource_dir() {
        // Packaged layout: resources are copied in under `resources/`.
        let packaged = dir.join("resources").join(&name);
        if packaged.exists() {
            return packaged;
        }
        let flat = dir.join(&name);
        if flat.exists() {
            return flat;
        }
    }

    // Dev fallback: run from the crate directory, binaries sit in
    // src-tauri/resources/ next to the source.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(&name);
    if dev.exists() {
        return dev;
    }

    // Last resort: whatever is on PATH. Lets a developer with a system-wide
    // yt-dlp run the app without copying binaries in first.
    PathBuf::from(base)
}

/// Bundled binaries can lose the executable bit when copied into a package,
/// which makes spawn fail with EACCES on Linux/macOS. Restore it best-effort;
/// a no-op on Windows.
#[cfg(unix)]
fn ensure_executable(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.mode() & 0o111 == 0 {
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &PathBuf) {}

/// Resolves every binary and caches the result.
///
/// Called at startup and again after the tools are downloaded or updated, so
/// paths that pointed at nothing on the first pass become correct without a
/// restart.
pub fn init(app: &AppHandle) {
    let ytdlp = resolve(app, "yt-dlp");
    let ffmpeg = resolve(app, "ffmpeg");
    // The JavaScript runtime yt-dlp needs to solve YouTube's player
    // challenges — without it extraction returns only storyboard images.
    let qjs = resolve(app, "qjs");
    ensure_executable(&ytdlp);
    ensure_executable(&ffmpeg);
    ensure_executable(&qjs);
    *YTDLP.write().unwrap() = Some(ytdlp);
    *FFMPEG.write().unwrap() = Some(ffmpeg);
    *QJS.write().unwrap() = Some(qjs);
}

fn cached(slot: &RwLock<Option<PathBuf>>, fallback: &str) -> PathBuf {
    slot.read()
        .unwrap()
        .clone()
        .unwrap_or_else(|| PathBuf::from(fallback))
}

pub fn ytdlp_path() -> PathBuf {
    cached(&YTDLP, "yt-dlp")
}

pub fn ffmpeg_path() -> PathBuf {
    cached(&FFMPEG, "ffmpeg")
}

pub fn qjs_path() -> PathBuf {
    cached(&QJS, "qjs")
}
