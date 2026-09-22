//! Converting a file already on disk to MP3 or MP4.
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
//!
//! Two targets, one code path. MP3 throws the picture away and keeps the
//! sound; MP4 keeps both. They differ only in the arguments handed to ffmpeg
//! and in what a source without a video stream means — so [`Target`] carries
//! that difference and everything else below is shared.

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

/// Audio bitrate inside an MP4. AAC at 192k is transparent enough for the same
/// reason 192k MP3 is, and matches what the download path muxes.
const VIDEO_AUDIO_BITRATE: &str = "192k";

/// x264's quality knob. 20 is a notch better than the library default of 23 —
/// a re-encode is lossy no matter what, and this is the tab people reach for
/// to make a file that plays somewhere, not to squeeze the last megabyte out.
const CRF: &str = "20";

/// The picture generated for a source that has none.
///
/// Small and static, because it carries no information — it exists so the
/// file is a video. 640x360 at 2fps costs almost nothing after x264 sees how
/// little changes between frames, and every player accepts it.
const BLANK_PICTURE: &str = "color=c=black:s=640x360:r=2";

/// What the user asked the file to become.
///
/// The only thing that genuinely differs between the two: which streams
/// survive, which encoders run, and what a source without a picture means. A
/// silent video is still a perfectly good MP4; a silent anything is a useless
/// MP3, which is why `needs_audio` is not simply true for both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Mp3,
    Mp4,
}

impl Target {
    /// The extension the output carries.
    pub fn extension(self) -> &'static str {
        match self {
            Target::Mp3 => "mp3",
            Target::Mp4 => "mp4",
        }
    }

    /// Shown on a row, and used in error text. Not a MIME type and not a
    /// codec — the words someone picking a file would use.
    pub fn label(self) -> &'static str {
        match self {
            Target::Mp3 => "MP3",
            Target::Mp4 => "MP4",
        }
    }

    /// Whether a source with no audio stream can produce this at all.
    ///
    /// MP3 from a silent file would be a valid, empty, pointless file, so the
    /// UI refuses it up front. MP4 from a silent file is just a silent video,
    /// which is a normal thing to want — a screen recording with the mic off
    /// converts fine and must not be refused.
    pub fn needs_audio(self) -> bool {
        matches!(self, Target::Mp3)
    }

    /// The encoding arguments, between the input and the output path.
    ///
    /// Deliberately not "copy" for MP4. Stream-copying would be instant and
    /// would also be a lie: the reason someone converts to MP4 is that the
    /// file they have does not play where they need it to, and copying a VP9
    /// or AV1 stream into an MP4 container reproduces exactly that problem in
    /// a new wrapper. H.264 and AAC are what actually play everywhere.
    ///
    /// `+faststart` moves the index to the front so the file starts playing
    /// before it has fully downloaded — the difference between a file that
    /// works on the web and one that only works locally.
    ///
    /// `-shortest` only appears when a picture had to be generated: the
    /// generated one runs forever, so without it the encode never ends.
    fn ffmpeg_args(self, generated_picture: bool) -> Vec<&'static str> {
        match self {
            Target::Mp3 => vec![
                // -vn drops any video stream: cover art in an MP4 would
                // otherwise be carried into the MP3 as a video track and some
                // players choke on it.
                "-vn",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                BITRATE,
            ],
            Target::Mp4 => {
                let mut args = vec![
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    CRF,
                    // yuv420p is the pixel format every player understands. A
                    // source in 10-bit or 4:4:4 encodes happily without this
                    // and then refuses to play on half the devices people own.
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    VIDEO_AUDIO_BITRATE,
                    "-movflags",
                    "+faststart",
                ];
                if generated_picture {
                    // The generated picture is an endless stream; the sound
                    // is what says when the file is over.
                    args.push("-shortest");
                }
                args
            }
        }
    }
}

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
    /// these for MP3 rather than letting ffmpeg fail on them later.
    pub has_audio: bool,
    /// True when there is a picture in the file.
    ///
    /// Not a gate, unlike `has_audio`: an MP3 asked to become an MP4 is a
    /// legitimate thing to do (it produces a black-screen video, which is what
    /// some upload forms want), so this only drives what the row says about
    /// what it is offering.
    pub has_video: bool,
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
        has_audio: has_stream(&text, "Audio:"),
        has_video: has_stream(&text, "Video:"),
    })
}

/// True when ffmpeg's banner lists a stream of the given kind.
///
/// The banner prints one `Stream #0:0: Video: h264 ...` line per stream, so
/// the kind has to be looked for on a line that is a stream line. Searching
/// the whole text for "Video:" on its own would match ffmpeg's own diagnostic
/// chatter and report a picture in a file that has none.
fn has_stream(text: &str, kind: &str) -> bool {
    text.lines()
        .filter(|l| l.trim_start().starts_with("Stream #"))
        .any(|l| l.contains(kind))
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
/// tool's name means nothing to someone who just wanted a converted file.
/// Unlike the download path there is no network and no site involved, so the
/// set of things that can go wrong is small and local.
pub fn explain(raw: &str, name: &str, target: Target) -> String {
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
        return format!("There isn't enough free space to save the {}.", target.label());
    }
    if lower.contains("does not contain any stream") || lower.contains("output file is empty") {
        // Only an MP3 can fail for want of sound. A silent source makes a
        // perfectly good MP4, so blaming the audio there would send the user
        // looking for a problem that is not the one they have.
        return match target {
            Target::Mp3 => format!("{name} has no sound in it."),
            Target::Mp4 => format!("Nothing in {name} could be converted."),
        };
    }

    // x264 and AAC ship inside the bundled ffmpeg, but a system ffmpeg on
    // PATH is frequently built without them. Said as a missing capability
    // rather than as ffmpeg's "Unknown encoder 'libx264'", which reads like a
    // typo the user made.
    if lower.contains("unknown encoder") {
        return format!("This copy of the converter can't make {}s.", target.label());
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
        return format!("Could not convert {name} to {}.", target.label());
    }

    let mut msg: String = last.chars().take(180).collect();
    if !msg.ends_with('.') {
        msg.push('.');
    }
    msg
}

/// Converts one file to `target` at `dest`, reporting 0-100 as it goes.
///
/// `total_seconds` is the source duration, used to turn ffmpeg's elapsed time
/// into a percentage. When it is unknown the callback still fires with the
/// stage, so the row shows work happening rather than a bar frozen at zero.
///
/// `control` carries stop from the UI. There is no pause: a local conversion
/// is CPU-bound and finishes in seconds to a couple of minutes, so suspending
/// it would be a control nobody has time to reach — unlike a multi-gigabyte
/// download, where walking away mid-transfer is a real scenario.
///
/// `source_has_video` decides whether a picture has to be generated for an
/// MP4. Passing it in rather than probing here keeps this function free of
/// its own ffmpeg call — the caller has already probed the file.
pub async fn convert<F>(
    source: &Path,
    dest: &Path,
    target: Target,
    source_has_video: bool,
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

    // An MP4 asked for from a file with no picture has to be *given* one.
    //
    // Without this ffmpeg quietly drops -c:v — there is no video to apply it
    // to — and writes an MP4 holding nothing but an audio track. That file
    // opens, plays, and is rejected by every upload form that wants a video,
    // which is the exact reason someone converts an audio file to MP4 in the
    // first place. Measured, not assumed: the first version of this shipped
    // that file and called it done.
    let generated_picture = target == Target::Mp4 && !source_has_video;

    let mut cmd = crate::ytdlp::base_command(ffmpeg());
    cmd.args(["-hide_banner", "-nostdin", "-y"]);

    if generated_picture {
        // The generated picture comes first so it is input 0 and the real
        // file is input 1; -shortest then ends the encode when the sound does.
        cmd.args(["-f", "lavfi", "-i", BLANK_PICTURE]);
    }

    cmd.arg("-i")
        .arg(source)
        .args(target.ffmpeg_args(generated_picture))
        // Machine-readable progress on stdout, so stderr stays purely the
        // error channel and the two never have to be untangled.
        .args(["-progress", "pipe:1", "-loglevel", "error"])
        .arg(dest);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the converter ({e})."))?;

    let stdout = child.stdout.take().ok_or("Could not read the converter's output")?;
    let mut reader = BufReader::new(stdout).lines();

    // Video re-encoding is slow enough that "Converting" alone leaves people
    // wondering whether it is stuck, so the stage says which job is running.
    let stage = match target {
        Target::Mp3 => "Converting",
        Target::Mp4 => "Encoding video",
    };
    on_progress(0.0, stage);

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
                                on_progress(last_percent, stage);
                            }
                        } else if line.starts_with("out_time=") {
                            // No duration to divide by — keep the stage
                            // moving so the row does not look stalled.
                            on_progress(last_percent, stage);
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
        return Err(explain(&stderr, &name, target));
    }

    on_progress(100.0, "Done");
    Ok(())
}

/// The path a source file should become: same folder, same name, new
/// extension.
///
/// Converting in place is what people expect from a converter — the file came
/// from somewhere they chose, and the result belongs beside it. A save dialog
/// per file would make converting twenty files twenty prompts, which is the
/// same reason whole-playlist downloads ask for a folder once.
pub fn default_dest(source: &Path, target: Target) -> PathBuf {
    source.with_extension(target.extension())
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
        assert_eq!(
            default_dest(&src, Target::Mp3),
            PathBuf::from("/music/Some Song.mp3")
        );
    }

    /// A file with two dots keeps everything up to the last one, so
    /// "mix.final.wav" does not become "mix.mp3" and overwrite a sibling.
    #[test]
    fn only_the_last_extension_is_replaced() {
        let src = PathBuf::from("/a/mix.final.wav");
        assert_eq!(
            default_dest(&src, Target::Mp3),
            PathBuf::from("/a/mix.final.mp3")
        );
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
            let msg = explain(raw, "song.wav", Target::Mp3);
            let lower = msg.to_ascii_lowercase();
            for word in ["ffmpeg", "libmp3lame", "codec:a", "av_interleaved"] {
                assert!(!lower.contains(word), "message leaks {word:?}: {msg}");
            }
        }
    }

    #[test]
    fn a_missing_file_says_so_by_name() {
        let msg = explain("song.wav: No such file or directory", "song.wav", Target::Mp3);
        assert!(msg.contains("song.wav"), "{msg}");
        assert!(!msg.contains("No such file"), "leaks the raw wording: {msg}");
    }

    /// An unrecognised failure still shows ffmpeg's own last line rather than
    /// a vague "something went wrong", which would be less useful.
    #[test]
    fn an_unknown_error_keeps_ffmpegs_last_line() {
        let msg = explain("Something very specific went wrong", "a.wav", Target::Mp4);
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

    /// True when the resolved ffmpeg carries the named encoder.
    ///
    /// A distro ffmpeg is routinely built without libmp3lame, and even more
    /// often without libx264. A converter that cannot produce its output is
    /// exactly what these tests exist to catch, but on a machine whose ffmpeg
    /// simply lacks the encoder that is a fact about the machine rather than a
    /// broken tab — so it skips instead of failing.
    fn has_encoder(ffmpeg: &Path, encoder: &str) -> bool {
        std::process::Command::new(ffmpeg)
            .args(["-hide_banner", "-encoders"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(encoder))
            .unwrap_or(false)
    }

    /// Every encoder a target needs. Checked together, because an ffmpeg with
    /// x264 but no AAC would get halfway through an MP4 and fail on the audio.
    fn can_encode(ffmpeg: &Path, target: Target) -> bool {
        match target {
            Target::Mp3 => has_encoder(ffmpeg, "libmp3lame"),
            Target::Mp4 => has_encoder(ffmpeg, "libx264") && has_encoder(ffmpeg, "aac"),
        }
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
            if !can_encode(&ff, Target::Mp3) {
                eprintln!("skipping: this ffmpeg has no libmp3lame");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-roundtrip");
            let _ = std::fs::create_dir_all(&dir);
            // A failure here is a real failure, not a reason to skip. The
            // earlier version returned quietly, which is how an ffmpeg without
            // the fixture's video encoder read as "nothing to test" instead of
            // "this machine cannot build the fixture" - the test went green
            // having done nothing.
            let source = make_fixture(&dir)
                .await
                .expect("ffmpeg is present, so it must be able to build the fixture");

            let info = probe(&source).await.expect("the fixture probes");
            assert!(info.has_audio, "the fixture has a tone in it");
            assert!(info.has_video, "the fixture has a picture in it");
            let duration = info.duration.expect("mp4 reports a duration");
            assert!((duration - 5.0).abs() < 0.2, "expected ~5s, got {duration}");
            assert!(info.size_bytes.unwrap_or(0) > 0);

            let dest = default_dest(&source, Target::Mp3);
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);

            // Progress must actually arrive and must end at 100 - a bar that
            // stays at zero is the failure this catches.
            let mut seen: Vec<f64> = Vec::new();
            convert(
                &source,
                &dest,
                Target::Mp3,
                info.has_video,
                info.duration,
                rx,
                |p, _| seen.push(p),
            )
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
            // -vn has to have actually dropped the picture. Without it the
            // fixture's video rides along into the MP3 as a stream that some
            // players refuse outright.
            assert!(!out.has_video, "the mp3 carries no picture");

            let _ = std::fs::remove_dir_all(&dir);
        }

        /// The video path, end to end. The unit tests above can prove which
        /// arguments are chosen but not that ffmpeg accepts them or that what
        /// comes out plays - and every interesting way this breaks (no x264,
        /// an argument order ffmpeg rejects, an MP4 with no picture in it)
        /// looks fine until a real encode runs.
        #[tokio::test]
        async fn a_real_file_converts_to_playable_video() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !can_encode(&ff, Target::Mp4) {
                eprintln!("skipping: this ffmpeg cannot encode H.264 + AAC");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-video");
            let _ = std::fs::create_dir_all(&dir);
            let source = make_fixture(&dir)
                .await
                .expect("ffmpeg is present, so it must be able to build the fixture");

            let info = probe(&source).await.expect("the fixture probes");

            // The fixture is already .mp4, so this is the self-collision case
            // - exactly what the caller's unique_path() exists for. Writing to
            // the source path would truncate the file ffmpeg is reading.
            let dest = dir.join("out.mp4");
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);

            let mut seen: Vec<f64> = Vec::new();
            convert(
                &source,
                &dest,
                Target::Mp4,
                info.has_video,
                info.duration,
                rx,
                |p, _| seen.push(p),
            )
            .await
            .expect("the conversion succeeds");

            assert!(dest.exists(), "an mp4 was written");
            assert_eq!(seen.last().copied(), Some(100.0), "ends at 100: {seen:?}");

            // Both streams have to survive. An MP4 that lost its picture is
            // the silent failure this tab would otherwise ship: the file
            // exists, opens, and is wrong.
            let out = probe(&dest).await.expect("the mp4 probes");
            assert!(out.has_video, "the mp4 carries a picture");
            assert!(out.has_audio, "the mp4 carries sound");

            let _ = std::fs::remove_dir_all(&dir);
        }

        /// A source with no picture still has to produce an MP4, because that
        /// is a thing people do - an audio file that an upload form will only
        /// take as video. A silent source must not be refused or crash.
        #[tokio::test]
        async fn a_silent_source_is_still_allowed_to_become_video() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !can_encode(&ff, Target::Mp4) {
                eprintln!("skipping: this ffmpeg cannot encode H.264 + AAC");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-silent");
            let _ = std::fs::create_dir_all(&dir);

            // A picture with no sound, which is what a screen recording made
            // with the microphone off looks like.
            let source = dir.join("mute.mkv");
            let mut cmd = crate::ytdlp::base_command(ffmpeg());
            cmd.args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(["-f", "lavfi", "-i", "color=c=red:s=320x240:d=3"])
                .args(["-c:v", "mpeg4"])
                .arg(&source);
            cmd.output().await.expect("the fixture builds");

            let info = probe(&source).await.expect("the fixture probes");
            assert!(!info.has_audio, "this fixture is deliberately silent");
            assert!(info.has_video);

            let dest = default_dest(&source, Target::Mp4);
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);
            convert(
                &source,
                &dest,
                Target::Mp4,
                info.has_video,
                info.duration,
                rx,
                |_, _| {},
            )
            .await
            .expect("a silent source still converts to video");

            let out = probe(&dest).await.expect("the mp4 probes");
            assert!(out.has_video, "the picture survived");

            let _ = std::fs::remove_dir_all(&dir);
        }

        /// An audio file asked to become an MP4 must come out with a picture
        /// in it.
        ///
        /// This is the case the first version of this feature got wrong. With
        /// no video among its inputs ffmpeg silently ignores -c:v and writes
        /// an MP4 holding only an audio track: it opens, it plays, and every
        /// upload form that wants a video rejects it — which is the entire
        /// reason someone converts an audio file to MP4. Exit code 0, a file
        /// on disk, a row saying "Done", and the wrong result.
        ///
        /// Nothing short of probing the output catches it.
        #[tokio::test]
        async fn an_audio_file_becomes_a_video_with_a_picture_in_it() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !can_encode(&ff, Target::Mp4) || !can_encode(&ff, Target::Mp3) {
                eprintln!("skipping: this ffmpeg is missing an encoder");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-audio-to-video");
            let _ = std::fs::create_dir_all(&dir);

            let source = dir.join("song.mp3");
            let mut cmd = crate::ytdlp::base_command(ffmpeg());
            cmd.args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=3"])
                .args(["-c:a", "libmp3lame"])
                .arg(&source);
            cmd.output().await.expect("the fixture builds");

            let info = probe(&source).await.expect("the fixture probes");
            assert!(info.has_audio);
            assert!(!info.has_video, "an mp3 has no picture");

            let dest = default_dest(&source, Target::Mp4);
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);
            convert(
                &source,
                &dest,
                Target::Mp4,
                info.has_video,
                info.duration,
                rx,
                |_, _| {},
            )
            .await
            .expect("an audio file converts to video");

            let out = probe(&dest).await.expect("the mp4 probes");
            assert!(
                out.has_video,
                "a picture was generated - without one this is an audio file                  wearing an mp4 extension"
            );
            assert!(out.has_audio, "the sound survived");

            // -shortest has to have ended it. The generated picture runs
            // forever, so a file much longer than its sound means the encode
            // was bounded by the timeout rather than by the audio.
            let length = out.duration.expect("an mp4 reports a duration");
            assert!(
                (length - 3.0).abs() < 1.0,
                "expected ~3s, got {length} - the generated picture did not stop"
            );

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
            if !can_encode(&ff, Target::Mp3) {
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

/// The names the converter produces. This is the pairing the UI depends on —
/// the row shows the name of the file that was actually written, so a
/// disagreement here puts a wrong name on screen.
///
/// Paths are built with PathBuf rather than written as literals: a Windows
/// literal has no separator at all on Linux, so the whole string becomes one
/// filename and the test asserts something different there than it does here.
/// That is exactly how these first went red in CI while passing locally.
#[cfg(test)]
mod naming {
    use super::*;

    fn in_a_folder(name: &str) -> PathBuf {
        let mut p = PathBuf::from("music");
        p.push(name);
        p
    }

    #[test]
    fn the_extension_is_replaced_not_appended() {
        let got = default_dest(&in_a_folder("My Song.flac"), Target::Mp3);
        assert_eq!(got.file_name().unwrap(), "My Song.mp3");
    }

    /// Only the last dot is an extension. "my.clip.v2.mkv" becoming "my.mp3"
    /// would rename the user's file out from under them.
    #[test]
    fn only_the_final_segment_is_treated_as_an_extension() {
        let got = default_dest(&in_a_folder("my.clip.v2.mkv"), Target::Mp3);
        assert_eq!(got.file_name().unwrap(), "my.clip.v2.mp3");
    }

    #[test]
    fn a_file_with_no_extension_gains_one() {
        let got = default_dest(&in_a_folder("recording"), Target::Mp3);
        assert_eq!(got.file_name().unwrap(), "recording.mp3");
    }

    /// Converting an MP3 resolves to the source itself, which is what makes
    /// the caller's unique_path() guard load-bearing rather than decorative.
    #[test]
    fn converting_an_mp3_collides_with_its_own_source() {
        let source = in_a_folder("already.mp3");
        assert_eq!(default_dest(&source, Target::Mp3), source);
    }

    /// The same collision exists on the video side, and is the one people
    /// will actually hit: an MP4 is by far the most common thing to drop in,
    /// and "make this MP4 an MP4" is what re-encoding a file that will not
    /// play looks like from the user's side.
    #[test]
    fn converting_an_mp4_to_mp4_collides_with_its_own_source() {
        let source = in_a_folder("clip.mp4");
        assert_eq!(default_dest(&source, Target::Mp4), source);
    }

    /// The folder must survive, or the output would land somewhere other than
    /// beside its source.
    #[test]
    fn the_output_stays_in_the_sources_folder() {
        let got = default_dest(&in_a_folder("song.wav"), Target::Mp3);
        assert_eq!(got.parent(), Some(Path::new("music")));
    }

    /// Each target claims its own extension, so the same source converted
    /// twice produces two files rather than one overwriting the other.
    #[test]
    fn the_two_targets_never_write_to_the_same_path() {
        let source = in_a_folder("clip.mkv");
        let audio = default_dest(&source, Target::Mp3);
        let video = default_dest(&source, Target::Mp4);
        assert_ne!(audio, video);
        assert_eq!(audio.file_name().unwrap(), "clip.mp3");
        assert_eq!(video.file_name().unwrap(), "clip.mp4");
    }

    /// A silent file is a dead end for MP3 and a normal input for MP4. Getting
    /// this backwards would either refuse valid screen recordings or hand
    /// someone an empty MP3 and call it done.
    #[test]
    fn only_the_audio_target_requires_sound() {
        assert!(Target::Mp3.needs_audio());
        assert!(!Target::Mp4.needs_audio());
    }
}
