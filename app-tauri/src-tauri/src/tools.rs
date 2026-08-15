//! Fetching and updating the three external binaries the app drives.
//!
//! These used to be bundled into the installer via `bundle.resources`, which
//! made every release a ~120 MB download even when the app's own code changed
//! by four megabytes. Worse, it tied yt-dlp's version to yt2mp's: when a site
//! changed and yt-dlp shipped a fix the same day, users had no way to get it
//! without a whole new app release.
//!
//! So they live in `app_data_dir()/tools/` instead, fetched once on first run
//! and updatable on their own. `binaries::resolve` looks here first.
//!
//! Downloads are written to a `.part` file and renamed only once complete —
//! a half-written yt-dlp that `resolve()` would happily try to execute is a
//! much more confusing failure than a missing one.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// quickjs-ng, not Bellard's original: yt-dlp targets the -ng fork's `qjs`
/// for its player-challenge solver. The old Linux CI fetched Bellard's build
/// while the local script fetched -ng, so the two environments were running
/// different runtimes. This constant is now the only place it is decided.
/// Only read by the test below, which is the point: it is the declared value
/// that the hard-coded URLs are checked against.
#[cfg_attr(not(test), allow(dead_code))]
const QUICKJS_VERSION: &str = "v0.16.1";

/// One binary yt2mp needs, and where to get it for this platform.
struct Tool {
    /// File name on disk, without the platform extension.
    base: &'static str,
    /// Human name for progress messages.
    label: &'static str,
    url: &'static str,
    /// Set when the download is an archive the binary must be pulled out of.
    /// `None` means the URL serves the executable directly.
    archive: Option<Archive>,
    /// Rough download size, only used to make the progress bar honest before
    /// the server sends a Content-Length.
    approx_mb: u64,
}

// Each variant is constructed on exactly one platform, so the other is
// genuinely dead code there — the allow keeps that from being a warning on
// both targets.
#[derive(Clone, Copy, PartialEq)]
#[allow(dead_code)]
enum Archive {
    /// ffmpeg on Windows: a .zip with the binary at
    /// `ffmpeg-*/bin/ffmpeg.exe`.
    ZipFfmpeg,
    /// ffmpeg on Linux: a .tar.xz with the binary at `ffmpeg-*/ffmpeg`.
    TarFfmpeg,
}

#[cfg(windows)]
fn tools() -> Vec<Tool> {
    vec![
        Tool {
            base: "yt-dlp",
            label: "yt-dlp",
            url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
            archive: None,
            approx_mb: 17,
        },
        Tool {
            base: "qjs",
            label: "JavaScript runtime",
            url: concat!(
                "https://github.com/quickjs-ng/quickjs/releases/download/",
                "v0.16.1",
                "/qjs-windows-x86_64.exe"
            ),
            archive: None,
            approx_mb: 2,
        },
        Tool {
            base: "ffmpeg",
            label: "ffmpeg",
            url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
            archive: Some(Archive::ZipFfmpeg),
            approx_mb: 40,
        },
    ]
}

#[cfg(not(windows))]
fn tools() -> Vec<Tool> {
    vec![
        Tool {
            base: "yt-dlp",
            label: "yt-dlp",
            url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
            archive: None,
            approx_mb: 17,
        },
        Tool {
            base: "qjs",
            label: "JavaScript runtime",
            url: concat!(
                "https://github.com/quickjs-ng/quickjs/releases/download/",
                "v0.16.1",
                "/qjs-linux-x86_64"
            ),
            archive: None,
            approx_mb: 2,
        },
        Tool {
            base: "ffmpeg",
            label: "ffmpeg",
            url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
            archive: Some(Archive::TarFfmpeg),
            approx_mb: 30,
        },
    ]
}

/// `concat!` needs string literals, so the quickjs version is spelled inside
/// the URLs as well as in QUICKJS_VERSION. This test fails the build if the
/// two ever drift, which would otherwise surface as a 404 at first run on a
/// user's machine rather than here.
#[cfg(test)]
mod version_guard {
    use super::*;

    #[test]
    fn quickjs_urls_match_the_declared_version() {
        let url = tools()
            .into_iter()
            .find(|t| t.base == "qjs")
            .expect("qjs is one of the tools")
            .url;
        assert!(
            url.contains(QUICKJS_VERSION),
            "quickjs URL {url} does not contain {QUICKJS_VERSION} — update both"
        );
    }
}

pub fn binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Where downloaded tools live. Kept out of the install directory on purpose:
/// on Windows the app installs per-user under Program Files-style paths that
/// an updater may replace wholesale, and re-downloading 120 MB on every app
/// update is exactly what this change exists to avoid.
pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("tools"))
}

#[derive(Serialize, Clone)]
pub struct ToolsStatus {
    /// True when every required binary is present.
    pub ready: bool,
    /// Binaries still missing, by label — drives the first-run copy.
    pub missing: Vec<String>,
    /// Installed yt-dlp version, when it can be read.
    pub ytdlp_version: Option<String>,
}

#[derive(Serialize, Clone)]
struct ToolProgress {
    /// Which binary is being fetched right now.
    label: String,
    /// 0-100 across the whole set, not just the current file, so the bar
    /// never restarts.
    percent: f64,
    stage: String,
}

fn emit(app: &AppHandle, label: &str, percent: f64, stage: &str) {
    let _ = app.emit(
        "tools-progress",
        ToolProgress {
            label: label.to_string(),
            percent: percent.clamp(0.0, 100.0),
            stage: stage.to_string(),
        },
    );
}

/// Which binaries are missing, plus the installed yt-dlp version if we have
/// one. Cheap enough to call on every settings open.
pub async fn status(app: &AppHandle) -> ToolsStatus {
    let Some(root) = dir(app) else {
        return ToolsStatus {
            ready: false,
            missing: tools().iter().map(|t| t.label.to_string()).collect(),
            ytdlp_version: None,
        };
    };

    let mut missing = Vec::new();
    for t in tools() {
        // A binary counts as present if it is anywhere resolve() would find
        // it — the tools folder, or a dev checkout's src-tauri/resources.
        //
        // `resolve` returns a bare name ("yt-dlp") as its last resort, meaning
        // "hope it is on PATH". That must NOT count as installed: a developer
        // machine with a system-wide yt-dlp would report ready while ffmpeg
        // and the JS runtime were both absent, and the first-run download
        // would never be offered.
        let resolved = crate::binaries::resolve_now(app, t.base);
        let present = root.join(binary_name(t.base)).exists()
            || (resolved.is_absolute() && resolved.exists());
        if !present {
            missing.push(t.label.to_string());
        }
    }

    let ready = missing.is_empty();

    ToolsStatus {
        ytdlp_version: if ready { ytdlp_version().await } else { None },
        ready,
        missing,
    }
}

/// Reads `yt-dlp --version`. Returns None if it cannot be run at all.
pub async fn ytdlp_version() -> Option<String> {
    // base_command already sets CREATE_NO_WINDOW on Windows, so this never
    // flashes a console window.
    let mut cmd = crate::ytdlp::base_command(crate::binaries::ytdlp_path());
    cmd.arg("--version");
    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

/// Downloads one URL to `dest`, reporting progress mapped into
/// [`base_percent`, `base_percent + span`].
async fn download(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    label: &str,
    base_percent: f64,
    span: f64,
    approx_bytes: u64,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        // These are large files on links that redirect; without a generous
        // timeout a slow connection fails halfway through ffmpeg.
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Could not start the download: {e}"))?;

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not reach the download server: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("{label} download failed with HTTP {}", res.status()));
    }

    // Content-Length is absent on some CDNs; fall back to the rough estimate
    // so the bar still moves rather than sitting at zero.
    let total = res.content_length().unwrap_or(approx_bytes).max(1);

    let part = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("Could not write to the tools folder: {e}"))?;

    let mut stream = res;
    let mut written: u64 = 0;
    loop {
        let chunk = stream
            .chunk()
            .await
            .map_err(|e| format!("{label} download was interrupted: {e}"))?;
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Could not write {label}: {e}"))?;
        written += chunk.len() as u64;
        let frac = (written as f64 / total as f64).min(1.0);
        emit(
            app,
            label,
            base_percent + frac * span,
            &format!("Downloading {label}"),
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Could not finish writing {label}: {e}"))?;
    drop(file);

    // Rename last: until this point a crash leaves only a .part file, which
    // resolve() ignores.
    tokio::fs::rename(&part, dest)
        .await
        .map_err(|e| format!("Could not save {label}: {e}"))?;

    set_executable(dest);
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) {}

/// Pulls the ffmpeg binary out of its archive and drops the rest.
///
/// `tar` handles both .zip and .tar.xz and ships with Windows 10 1803+ and
/// every Linux distro, which avoids pulling a zip crate in for one file.
async fn extract_ffmpeg(
    archive: &Path,
    root: &Path,
    kind: Archive,
    dest: &Path,
) -> Result<(), String> {
    let mut cmd = crate::ytdlp::base_command(PathBuf::from("tar"));
    cmd.arg("-xf").arg(archive).arg("-C").arg(root);
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Could not unpack ffmpeg: {e}"))?;
    if !out.status.success() {
        return Err("Could not unpack ffmpeg.".into());
    }

    // Find the extracted ffmpeg-* directory.
    let mut found: Option<PathBuf> = None;
    let mut entries = tokio::fs::read_dir(root)
        .await
        .map_err(|e| format!("Could not read the tools folder: {e}"))?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("ffmpeg") && entry.path().is_dir() {
            found = Some(entry.path());
            break;
        }
    }
    let Some(unpacked) = found else {
        return Err("ffmpeg unpacked, but its folder was not where expected.".into());
    };

    let inner = match kind {
        Archive::ZipFfmpeg => unpacked.join("bin").join("ffmpeg.exe"),
        Archive::TarFfmpeg => unpacked.join("ffmpeg"),
    };

    tokio::fs::rename(&inner, dest)
        .await
        .map_err(|e| format!("Could not move ffmpeg into place: {e}"))?;
    set_executable(dest);

    let _ = tokio::fs::remove_dir_all(&unpacked).await;
    let _ = tokio::fs::remove_file(archive).await;
    Ok(())
}

/// Whether one tool should be fetched this run.
///
/// Two distinct jobs share [`ensure`]: "set this machine up" (empty `force`,
/// fetch anything absent) and "update exactly these" (non-empty `force`, touch
/// nothing else). Kept as its own function so both rules can be tested without
/// a running app or a network.
fn wanted(base: &str, force: &[String], present: bool) -> bool {
    if force.is_empty() {
        !present
    } else {
        force.iter().any(|f| f == base)
    }
}

/// Downloads whatever is missing. Already-present binaries are left alone, so
/// this is safe to call on every launch and safe to retry after a failure.
///
/// `force` re-downloads the named tools even when present. When it is
/// non-empty it also **limits** the run to those tools: "update yt-dlp" must
/// fetch yt-dlp and nothing else. Without that limit the missing-file rule
/// below would sweep up every other absent tool — on a machine using a bundled
/// ffmpeg rather than a downloaded one, pressing "update yt-dlp" would quietly
/// start a 100 MB ffmpeg download and sit on "Updating…" for minutes.
pub async fn ensure(app: &AppHandle, force: Vec<String>) -> Result<ToolsStatus, String> {
    let root = dir(app).ok_or("Could not work out where to keep the tools.")?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Could not create the tools folder: {e}"))?;

    let all = tools();
    let needed: Vec<&Tool> = all
        .iter()
        .filter(|t| wanted(t.base, &force, root.join(binary_name(t.base)).exists()))
        .collect();

    if needed.is_empty() {
        return Ok(status(app).await);
    }

    // Weight each file's slice of the bar by its size, so the bar tracks bytes
    // rather than file count — otherwise ffmpeg (by far the largest) would
    // occupy the same third of the bar as the 2 MB runtime.
    let total_mb: u64 = needed.iter().map(|t| t.approx_mb).sum::<u64>().max(1);
    let mut done_mb: u64 = 0;

    for t in &needed {
        let base_percent = (done_mb as f64 / total_mb as f64) * 100.0;
        let span = (t.approx_mb as f64 / total_mb as f64) * 100.0;
        let dest = root.join(binary_name(t.base));
        let approx_bytes = t.approx_mb * 1024 * 1024;

        match t.archive {
            None => {
                download(app, t.url, &dest, t.label, base_percent, span, approx_bytes).await?;
            }
            Some(kind) => {
                // Archives download to a temp name, then get unpacked.
                let archive_path = root.join(if kind == Archive::ZipFfmpeg {
                    "_ffmpeg.zip"
                } else {
                    "_ffmpeg.tar.xz"
                });
                download(
                    app,
                    t.url,
                    &archive_path,
                    t.label,
                    base_percent,
                    span * 0.9,
                    approx_bytes,
                )
                .await?;
                emit(app, t.label, base_percent + span * 0.9, "Unpacking ffmpeg");
                extract_ffmpeg(&archive_path, &root, kind, &dest).await?;
            }
        }

        done_mb += t.approx_mb;
        emit(app, t.label, (done_mb as f64 / total_mb as f64) * 100.0, "Ready");
    }

    emit(app, "", 100.0, "Ready");

    // The paths were resolved at startup, when these files did not exist yet.
    crate::binaries::init(app);
    Ok(status(app).await)
}

/// Re-downloads yt-dlp specifically.
///
/// This is the button that matters: when a site changes and downloads start
/// failing, yt-dlp usually ships a fix within days. Before this existed, the
/// only way to get that fix was a whole new yt2mp release.
pub async fn update_ytdlp(app: &AppHandle) -> Result<ToolsStatus, String> {
    ensure(app, vec!["yt-dlp".to_string()]).await
}

/// What a check against yt-dlp's releases found.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpCheck {
    /// The version installed right now, if yt-dlp can be run at all.
    pub current: Option<String>,
    /// The newest published version, if the check reached GitHub.
    pub latest: Option<String>,
    /// True only when both versions are known and they differ. Unknown stays
    /// false: offering an update we cannot justify is worse than saying the
    /// check failed.
    pub update_available: bool,
}

/// Asks GitHub what the newest yt-dlp release is and compares it with what is
/// installed.
///
/// Split out from [`update_ytdlp`] so the button can say *whether* there is
/// anything to do before doing it. Re-downloading a 17 MB binary to discover it
/// was already current is the behaviour this replaces.
///
/// yt-dlp tags its releases by date (`2026.08.14`), so a string comparison is
/// enough to know they differ — and "differ" is all that is claimed here. No
/// ordering is inferred: a pinned older build is still reported as a
/// difference, which is honest, rather than silently called up to date.
pub async fn check_ytdlp(_app: &AppHandle) -> Result<YtdlpCheck, String> {
    let current = ytdlp_version().await;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        // GitHub's API rejects requests without one.
        .user_agent("yt2mp")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .send()
        .await
        .map_err(|_| "Could not reach GitHub. Are you online?".to_string())?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub answered {} when asked for the newest yt-dlp.",
            resp.status().as_u16()
        ));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "GitHub's answer could not be read.".to_string())?;

    let latest = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches('v').to_string());

    let update_available = match (&current, &latest) {
        (Some(c), Some(l)) => c != l,
        _ => false,
    };

    Ok(YtdlpCheck {
        current,
        latest,
        update_available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// First run: nothing is installed, so everything absent gets fetched and
    /// anything already there is left alone.
    #[test]
    fn a_setup_run_fetches_only_what_is_missing() {
        let none: Vec<String> = Vec::new();
        assert!(wanted("yt-dlp", &none, false), "missing tools must be fetched");
        assert!(!wanted("ffmpeg", &none, true), "present tools must be left alone");
    }

    /// "Update yt-dlp" must fetch yt-dlp and nothing else.
    ///
    /// This is the regression that prompted the test: the old rule was
    /// "forced OR missing", so on a machine whose ffmpeg lives in the bundle
    /// rather than the tools folder, pressing "update yt-dlp" also started a
    /// 100 MB ffmpeg download and left the button on "Updating…" for minutes.
    #[test]
    fn updating_one_tool_never_drags_in_another() {
        let force = vec!["yt-dlp".to_string()];
        assert!(wanted("yt-dlp", &force, true), "the named tool is re-fetched even when present");
        assert!(
            !wanted("ffmpeg", &force, false),
            "an unrelated missing tool must NOT be pulled in by a targeted update"
        );
        assert!(!wanted("qjs", &force, false));
    }
}
