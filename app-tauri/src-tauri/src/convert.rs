//! Converting a file already on disk to MP3.
//!
//! Everything else in this app starts from a URL: yt-dlp extracts, downloads
//! and hands ffmpeg a stream. This path has no network in it at all — the user
//! picks a file that is already theirs and ffmpeg re-encodes it. The bundled
//! ffmpeg is the same binary the download path already merges with, so this
//! adds a feature without adding a dependency.
//!
//! "Whatever you put in" is the whole point, so nothing here maintains a list
//! of accepted formats. ffmpeg decodes what it decodes; a file it cannot read
//! fails with a message saying so, which is a better answer than an extension
//! allow-list that rejects a working file because nobody thought of `.opus`.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::binaries::ffmpeg_path;

/// Where this module's ffmpeg comes from.
///
/// Normally [`ffmpeg_path`], which reads the cache `binaries::init` fills at
/// startup. Tests override it, because that cache is only ever populated by a
/// running Tauri app: under `cargo test` it stays empty and resolves to the
/// bare name "ffmpeg". An earlier version of the tests below checked for an
/// absolute path and, finding none, skipped themselves on every machine —
/// passing while testing nothing.
#[cfg(not(test))]
fn ffmpeg() -> PathBuf {
    ffmpeg_path()
}

#[cfg(test)]
fn ffmpeg() -> PathBuf {
    tests::test_ffmpeg().unwrap_or_else(ffmpeg_path)
}

/// Long enough for a feature-length video's audio track on a slow machine,
/// short enough that a wedged ffmpeg surfaces an error instead of hanging the
/// row forever. Conversion is CPU-bound and local, so this needs nowhere near
/// the download path's hour.
pub const CONVERT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60 * 30);

/// MP3 bitrate. Matches the download path's `--audio-quality 192K`, so a track
/// converted from a local file and the same track downloaded directly come out
/// at the same quality rather than differing by which route was taken.
const BITRATE: &str = "192k";

/// What ffprobe could tell us about a file before converting it.
///
/// Sent to the UI so a row can show what the user actually picked rather than
/// just a file name — and so a file with no audio at all is caught before a
/// conversion runs and fails three minutes later.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    /// Absolute path, which is also the id the UI keys its rows by.
    pub path: String,
    /// Just the file name, for display.
    pub name: String,
    /// Size on disk, or None if it could not be read.
    pub size_bytes: Option<u64>,
    /// Duration in seconds, when ffprobe reported one. Live streams and some
    /// containers genuinely have no duration, which is not an error.
    pub duration: Option<f64>,
    /// False when the file carries no audio stream. The UI refuses to queue
    /// these rather than letting ffmpeg fail on them later.
    pub has_audio: bool,
}

/// Reads what ffmpeg thinks of a file.
///
/// ffprobe is a separate binary and this app bundles only ffmpeg, so the probe
/// runs ffmpeg itself with no output file. ffmpeg then reports the streams it
/// found on stderr and exits non-zero ("At least one output file must be
/// specified") — that non-zero exit is the expected path here, not a failure,
/// so the status is deliberately ignored and only the stderr text is read.
pub async fn probe(path: &Path) -> Result<SourceInfo, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    if !path.is_file() {
        return Err(format!("{name} is not a file any more."));
    }

    let size_bytes = std::fs::metadata(path).ok().map(|m| m.len());

    let mut cmd = crate::ytdlp::base_command(ffmpeg());
    cmd.args(["-hide_banner", "-i"]).arg(path);

    let output = tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| format!("Took too long to read {name}."))?
        .map_err(|e| format!("Could not read {name} ({e})."))?;

    let text = String::from_utf8_lossy(&output.stderr);

    // "Invalid data found when processing input" is ffmpeg's verdict on a file
    // it cannot decode at all. Said plainly, because the point of this tab is
    // that anything can go in — when something genuinely cannot, the user
    // needs to know it is the file and not a setting they missed.
    if text.contains("Invalid data found when processing input") {
        return Err(format!("{name} isn't a media file this can read."));
    }

    Ok(SourceInfo {
        path: path.to_string_lossy().into_owned(),
        name,
        size_bytes,
        duration: parse_duration(&text),
        has_audio: text.contains("Stream #") && text.contains("Audio:"),
        })
}

/// Pulls `Duration: 00:03:42.51` out of ffmpeg's banner.
///
/// Returns None for "N/A", which ffmpeg prints for streams and some
/// containers. That is a fact about the file, not a failure to parse.
fn parse_duration(text: &str) -> Option<f64> {
    let rest = text.split("Duration:").nth(1)?.trim_start();
    let stamp = rest.split(',').next()?.trim();
    if stamp.starts_with("N/A") {
        return None;
    }

    let mut parts = stamp.split(':');
    let h: f64 = parts.next()?.trim().parse().ok()?;
    let m: f64 = parts.next()?.trim().parse().ok()?;
    let s: f64 = parts.next()?.trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Reads `time=00:01:23.45` out of a `-progress` line, as seconds.
///
/// ffmpeg's `-progress pipe:1` writes `key=value` lines, one per line, which
/// is why this path can parse progress without the carriage-return handling
/// the yt-dlp reader needs.
fn parse_progress_time(line: &str) -> Option<f64> {
    let value = line.strip_prefix("out_time=")?.trim();
    if value.starts_with("N/A") {
        return None;
    }
    let mut parts = value.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Turns ffmpeg's stderr into something worth showing.
///
/// Same rule as platform.rs: the raw text is written for a terminal, and the
/// tool's name means nothing to someone who just wanted an MP3. Unlike the
/// download path there is no network and no site involved, so the set of
/// things that can go wrong is small and local.
pub fn explain(raw: &str, name: &str) -> String {
    let lower = raw.to_ascii_lowercase();

    if lower.contains("invalid data found") || lower.contains("could not find codec") {
        return format!("{name} isn't a media file this can read.");
    }
    if lower.contains("no such file") {
        return format!("{name} isn't where it was — it may have been moved or deleted.");
    }
    if lower.contains("permission denied") {
        return format!("Windows wouldn't let this read {name}.");
    }
    if lower.contains("no space left") {
        return "There isn't enough free space to save the MP3.".into();
    }
    if lower.contains("does not contain any stream") || lower.contains("output file is empty") {
        return format!("{name} has no sound in it.");
    }

    // Nothing matched: ffmpeg's last line is still the most informative thing
    // available, minus the parts that only mean something in a terminal.
    let last = raw
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();

    if last.is_empty() {
        return format!("Could not convert {name}.");
    }

    let mut msg: String = last.chars().take(180).collect();
    if !msg.ends_with('.') {
        msg.push('.');
    }
    msg
}

/// Converts one file to MP3 at `dest`, reporting 0-100 as it goes.
///
/// `total_seconds` is the source duration, used to turn ffmpeg's elapsed time
/// into a percentage. When it is unknown the callback still fires with the
/// stage, so the row shows work happening rather than a bar frozen at zero.
///
/// `control` carries stop from the UI. There is no pause: a local conversion
/// is CPU-bound and finishes in seconds to a couple of minutes, so suspending
/// it would be a control nobody has time to reach — unlike a multi-gigabyte
/// download, where walking away mid-transfer is a real scenario.
pub async fn to_mp3<F>(
    source: &Path,
    dest: &Path,
    total_seconds: Option<f64>,
    mut control: tokio::sync::watch::Receiver<crate::ytdlp::Control>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64, &str) + Send,
{
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| source.to_string_lossy().into_owned());

    let mut cmd = crate::ytdlp::base_command(ffmpeg());
    cmd.args(["-hide_banner", "-nostdin", "-y", "-i"])
        .arg(source)
        // -vn drops any video stream: cover art in an MP4 would otherwise be
        // carried into the MP3 as a video track and some players choke on it.
        .args(["-vn", "-codec:a", "libmp3lame", "-b:a", BITRATE])
        // Machine-readable progress on stdout, so stderr stays purely the
        // error channel and the two never have to be untangled.
        .args(["-progress", "pipe:1", "-loglevel", "error"])
        .arg(dest);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the converter ({e})."))?;

    let stdout = child.stdout.take().ok_or("Could not read the converter's output")?;
    let mut reader = BufReader::new(stdout).lines();

    on_progress(0.0, "Converting");

    let deadline = tokio::time::sleep(CONVERT_TIMEOUT);
    tokio::pin!(deadline);

    let mut last_percent = 0.0f64;

    loop {
        tokio::select! {
            changed = control.changed() => {
                if changed.is_err() {
                    continue;
                }
                let requested = *control.borrow();
                if requested == crate::ytdlp::Control::Stop {
                    let _ = child.kill().await;
                    return Err("Conversion stopped".into());
                }
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                return Err(format!("Converting {name} took too long."));
            }
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if let (Some(done), Some(total)) =
                            (parse_progress_time(&line), total_seconds)
                        {
                            if total > 0.0 {
                                // Clamped below 100: the row reaches 100 when
                                // the process actually exits, not when ffmpeg
                                // reports the last timestamp.
                                last_percent = ((done / total) * 100.0).clamp(0.0, 99.0);
                                on_progress(last_percent, "Converting");
                            }
                        } else if line.starts_with("out_time=") {
                            // No duration to divide by — keep the stage
                            // moving so the row does not look stalled.
                            on_progress(last_percent, "Converting");
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("The converter stopped unexpectedly ({e})."))?;

    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut err) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf).await;
            stderr = String::from_utf8_lossy(&buf).into_owned();
        }
        return Err(explain(&stderr, &name));
    }

    on_progress(100.0, "Done");
    Ok(())
}

/// The MP3 path a source file should become: same folder, same name, `.mp3`.
///
/// Converting in place is what people expect from a converter — the file came
/// from somewhere they chose, and the result belongs beside it. A save dialog
/// per file would make converting twenty files twenty prompts, which is the
/// same reason whole-playlist downloads ask for a folder once.
pub fn default_dest(source: &Path) -> PathBuf {
    source.with_extension("mp3")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_is_read_from_the_banner() {
        let text = "  Duration: 00:03:42.51, start: 0.000000, bitrate: 128 kb/s";
        let secs = parse_duration(text).expect("a duration");
        assert!((secs - 222.51).abs() < 0.01, "got {secs}");
    }

    /// Streams and some containers report N/A. That is a fact about the file,
    /// not a parse failure, and it must not become a bogus 0-second duration —
    /// dividing progress by zero would peg the bar at 100 immediately.
    #[test]
    fn an_unknown_duration_is_none_not_zero() {
        assert_eq!(parse_duration("  Duration: N/A, bitrate: N/A"), None);
    }

    #[test]
    fn progress_time_is_read_as_seconds() {
        let secs = parse_progress_time("out_time=00:01:23.450000").expect("a time");
        assert!((secs - 83.45).abs() < 0.01, "got {secs}");
    }

    #[test]
    fn progress_ignores_other_keys_and_na() {
        assert_eq!(parse_progress_time("bitrate=192.0kbits/s"), None);
        assert_eq!(parse_progress_time("out_time=N/A"), None);
    }

    /// The output keeps the source's name and folder and only swaps the
    /// extension — a converter that scatters files somewhere else is a
    /// converter people lose files with.
    #[test]
    fn the_destination_sits_beside_the_source() {
        let src = PathBuf::from("/music/Some Song.flac");
        assert_eq!(default_dest(&src), PathBuf::from("/music/Some Song.mp3"));
    }

    /// A file with two dots keeps everything up to the last one, so
    /// "mix.final.wav" does not become "mix.mp3" and overwrite a sibling.
    #[test]
    fn only_the_last_extension_is_replaced() {
        let src = PathBuf::from("/a/mix.final.wav");
        assert_eq!(default_dest(&src), PathBuf::from("/a/mix.final.mp3"));
    }

    /// Same rule as the download path's errors: no tool names, no raw ffmpeg
    /// wording. Someone converting a file has no idea what "libmp3lame" is.
    #[test]
    fn errors_never_mention_the_tool() {
        let cases = [
            "Invalid data found when processing input",
            "song.txt: No such file or directory",
            "Permission denied",
            "av_interleaved_write_frame(): No space left on device",
        ];
        for raw in cases {
            let msg = explain(raw, "song.wav");
            let lower = msg.to_ascii_lowercase();
            for word in ["ffmpeg", "libmp3lame", "codec:a", "av_interleaved"] {
                assert!(!lower.contains(word), "message leaks {word:?}: {msg}");
            }
        }
    }

    #[test]
    fn a_missing_file_says_so_by_name() {
        let msg = explain("song.wav: No such file or directory", "song.wav");
        assert!(msg.contains("song.wav"), "{msg}");
        assert!(!msg.contains("No such file"), "leaks the raw wording: {msg}");
    }

    /// An unrecognised failure still shows ffmpeg's own last line rather than
    /// a vague "something went wrong", which would be less useful.
    #[test]
    fn an_unknown_error_keeps_ffmpegs_last_line() {
        let msg = explain("Something very specific went wrong", "a.wav");
        assert!(msg.starts_with("Something very specific went wrong"), "{msg}");
    }

    /// Everything above tests the parsing in isolation. These drive the real
    /// bundled ffmpeg end to end, because the parsers are only correct if they
    /// match what this exact binary actually prints — a banner or progress
    /// format that shifts upstream would pass every unit test above and still
    /// leave the tab showing a bar that never moves.
    ///
    /// Skipped rather than failed when ffmpeg is absent: a checkout without
    /// `bun run fetch:binaries` is a normal state, and failing there would
    /// report a missing download as a broken converter.
    /// The ffmpeg these tests drive, and the one `ffmpeg()` returns under
    /// `cfg(test)`.
    ///
    /// Deliberately NOT [`ffmpeg_path`]: that reads a cache filled by
    /// `binaries::init`, which needs a running Tauri app, so under `cargo
    /// test` it is always empty and resolves to the bare name "ffmpeg". The
    /// first version of these tests asked `ffmpeg_path().is_absolute()` and so
    /// skipped themselves on every machine — passing while testing nothing,
    /// which is worse than not existing at all.
    ///
    /// So: look where a checkout actually keeps it, then fall back to whatever
    /// is on PATH, which is what a CI runner has.
    pub(super) fn test_ffmpeg() -> Option<PathBuf> {
        let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };

        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name);
        if bundled.exists() {
            return Some(bundled);
        }

        // On PATH? Ask it to identify itself rather than scanning directories.
        let ok = std::process::Command::new("ffmpeg")
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        ok.then(|| PathBuf::from("ffmpeg"))
    }

    /// True when the resolved ffmpeg can actually encode MP3.
    ///
    /// A distro ffmpeg is routinely built without libmp3lame. A converter that
    /// cannot produce an MP3 is exactly what these tests exist to catch, but on
    /// a machine whose ffmpeg simply lacks the encoder that is a fact about the
    /// machine rather than a broken tab — so it skips instead of failing.
    fn has_mp3_encoder(ffmpeg: &Path) -> bool {
        std::process::Command::new(ffmpeg)
            .args(["-hide_banner", "-encoders"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("libmp3lame"))
            .unwrap_or(false)
    }

    mod with_real_ffmpeg {
        use super::*;

        /// Builds a five-second video with a tone in it, so the fixture
        /// exercises the same "video in, audio out" path the tab is for.
        ///
        /// Encoded with `mpeg4` and `aac`, not `libx264`: x264 is a separate
        /// library that a distro ffmpeg is frequently built without, and
        /// Ubuntu's is — which failed this test in CI while the bundled
        /// Windows build passed locally. mpeg4 is built into ffmpeg itself, so
        /// it is available wherever ffmpeg is. What the fixture needs is a
        /// video stream and an audio stream in one container; which codec
        /// draws the blue rectangle is beside the point.
        async fn make_fixture(dir: &Path) -> Option<PathBuf> {
            let source = dir.join("fixture.mp4");
            let mut cmd = crate::ytdlp::base_command(ffmpeg());
            cmd.args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=5"])
                .args(["-f", "lavfi", "-i", "color=c=blue:s=320x240:d=5"])
                .args(["-shortest", "-c:v", "mpeg4", "-c:a", "aac"])
                .arg(&source);
            let out = cmd.output().await.ok()?;
            out.status.success().then_some(source)
        }

        #[tokio::test]
        async fn a_real_file_probes_and_converts() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !has_mp3_encoder(&ff) {
                eprintln!("skipping: this ffmpeg has no libmp3lame");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-roundtrip");
            let _ = std::fs::create_dir_all(&dir);
            // A failure here is a real failure, not a reason to skip. The
            // earlier version returned quietly, which is how an ffmpeg without
            // the fixture's video encoder read as "nothing to test" instead of
            // "this machine cannot build the fixture" — the test went green
            // having done nothing.
            let source = make_fixture(&dir)
                .await
                .expect("ffmpeg is present, so it must be able to build the fixture");

            let info = probe(&source).await.expect("the fixture probes");
            assert!(info.has_audio, "the fixture has a tone in it");
            let duration = info.duration.expect("mp4 reports a duration");
            assert!(
                (duration - 5.0).abs() < 0.2,
                "expected ~5s, got {duration}"
            );
            assert!(info.size_bytes.unwrap_or(0) > 0);

            let dest = default_dest(&source);
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);

            // Progress must actually arrive and must end at 100 — a bar that
            // stays at zero is the failure this catches.
            let mut seen: Vec<f64> = Vec::new();
            to_mp3(&source, &dest, info.duration, rx, |p, _| seen.push(p))
                .await
                .expect("the conversion succeeds");

            assert!(dest.exists(), "an mp3 was written");
            assert!(
                std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0) > 0,
                "the mp3 is not empty"
            );
            assert_eq!(seen.last().copied(), Some(100.0), "ends at 100: {seen:?}");

            // The output has to be readable audio, not just a file that exists.
            let out = probe(&dest).await.expect("the mp3 probes");
            assert!(out.has_audio, "the mp3 carries audio");

            let _ = std::fs::remove_dir_all(&dir);
        }

        /// The tab's promise is "put anything in", so the one case that must
        /// stay honest is the file ffmpeg genuinely cannot read: it has to be
        /// named as such rather than surfacing as a failed conversion later.
        #[tokio::test]
        async fn a_file_that_is_not_media_is_refused_at_probe() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !has_mp3_encoder(&ff) {
                eprintln!("skipping: this ffmpeg has no libmp3lame");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-garbage");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join("not-really.wav");
            std::fs::write(&path, b"this is plain text, not audio").unwrap();

            let err = probe(&path).await.expect_err("garbage is refused");
            assert!(err.contains("not-really.wav"), "names the file: {err}");
            assert!(
                !err.to_ascii_lowercase().contains("ffmpeg"),
                "no tool name: {err}"
            );

            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
