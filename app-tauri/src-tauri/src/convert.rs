//! Converting a file already on disk to another format: video, audio or
//! image, fifteen targets in all.
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
//! Every target shares one code path. They differ in the streams they keep,
//! the encoders they run, and whether the streams already in the file can be
//! carried over as they are — so [`Target`] carries those differences and
//! everything else below is shared.

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

/// The picture generated for a source that has none.
///
/// Small and static, because it carries no information — it exists so the
/// file is a video. 640x360 at 2fps costs almost nothing after x264 sees how
/// little changes between frames, and every player accepts it.
const BLANK_PICTURE: &str = "color=c=black:s=640x360:r=2";

/// How long a generated picture runs when nothing can say how long the sound
/// is. Only reached for a file that reports no duration and whose second
/// probe also fails, which in practice means a stream rather than a file.
/// Generous enough not to truncate anything ordinary, finite enough that the
/// conversion always ends.
const UNKNOWN_LENGTH_CAP: f64 = 60.0 * 60.0;

/// What the user asked the file to become.
///
/// Named by what people call the files, not by codec: someone picking "OGG"
/// wants a .ogg that plays, not a lecture on Vorbis. What goes inside is
/// the container's usual codec unless [`Options::video_codec`] picks another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    // Video
    Mp4,
    Mkv,
    Webm,
    Mov,
    Avi,
    Flv,
    Wmv,
    Ts,
    Mpg,
    #[serde(rename = "3gp")]
    ThreeGp,
    Ogv,
    // Moving pictures without sound
    Gif,
    Apng,
    #[serde(rename = "webpanim")]
    WebpAnim,
    // Audio
    Mp3,
    M4a,
    Aac,
    Wav,
    Flac,
    Alac,
    Ogg,
    Opus,
    Wma,
    Aiff,
    Ac3,
    Mp2,
    Amr,
    // Image
    Png,
    Jpg,
    Webp,
    Avif,
    Bmp,
    Tiff,
    Ico,
}

/// Every target, in the order the UI lists them. Tests walk this.
#[cfg(test)]
pub const ALL_TARGETS: &[Target] = {
    use Target::*;
    &[
        Mp4, Mkv, Webm, Mov, Avi, Flv, Wmv, Ts, Mpg, ThreeGp, Ogv, Gif, Apng, WebpAnim, Mp3, M4a,
        Aac, Wav, Flac, Alac, Ogg, Opus, Wma, Aiff, Ac3, Mp2, Amr, Png, Jpg, Webp, Avif, Bmp, Tiff,
        Ico,
    ]
};

/// What a file is, as far as converting it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Has a moving picture (sound optional).
    Video,
    /// Sound only. Cover art in an MP3 or M4A doesn't make it a video.
    Audio,
    /// One still picture.
    Image,
}

/// The picture codecs a video target can carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    H264,
    H265,
    Av1,
    Vp9,
    Vp8,
    Prores,
    Mpeg4,
    Wmv2,
    Mpeg2,
    Theora,
}

impl VideoCodec {
    /// ffmpeg's name for a stream in this codec, as the probe reports it.
    fn stream_name(self) -> &'static str {
        match self {
            VideoCodec::H264 => "h264",
            VideoCodec::H265 => "hevc",
            VideoCodec::Av1 => "av1",
            VideoCodec::Vp9 => "vp9",
            VideoCodec::Vp8 => "vp8",
            VideoCodec::Prores => "prores",
            VideoCodec::Mpeg4 => "mpeg4",
            VideoCodec::Wmv2 => "wmv2",
            VideoCodec::Mpeg2 => "mpeg2video",
            VideoCodec::Theora => "theora",
        }
    }
}

/// One knob for how hard to compress, instead of a CRF number per codec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    /// Keep what can be kept (copy the streams when nothing else changes),
    /// otherwise encode at a high, sensible quality.
    #[default]
    Auto,
    High,
    Medium,
    Small,
}

impl Quality {
    /// Picks one of four values: auto, high, medium, small.
    fn pick<T: Copy>(self, v: [T; 4]) -> T {
        v[self as usize]
    }
}

/// Everything besides the format that can be changed about a conversion.
/// All of it is optional; the defaults give the same file as before.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// None: the container's usual codec.
    pub video_codec: Option<VideoCodec>,
    pub quality: Quality,
    /// Largest picture height for a video (never upscaled).
    pub height: Option<u32>,
    pub fps: Option<f64>,
    /// Clockwise degrees: 90, 180 or 270.
    pub rotate: Option<u16>,
    /// Trim, in seconds from the start of the file.
    pub start: Option<f64>,
    pub end: Option<f64>,
    /// Drop the sound from a video.
    pub mute: bool,
    /// kbps, for the lossy sound formats.
    pub audio_bitrate: Option<u32>,
    pub channels: Option<u8>,
    pub sample_rate: Option<u32>,
    /// Even out loudness (EBU R128) so quiet and loud files match.
    pub normalize: bool,
    /// Longest side of a picture, for images (never upscaled).
    pub image_size: Option<u32>,
}

impl Options {
    /// Nothing asked for that would need the streams re-encoded.
    fn changes_nothing(&self) -> bool {
        self.quality == Quality::Auto
            && self.height.is_none()
            && self.fps.is_none()
            && self.rotate.is_none()
            && self.start.is_none()
            && self.end.is_none()
            && !self.mute
            && self.audio_bitrate.is_none()
            && self.channels.is_none()
            && self.sample_rate.is_none()
            && !self.normalize
            && self.image_size.is_none()
    }
}

impl Target {
    /// The extension the output carries.
    pub fn extension(self) -> &'static str {
        use Target::*;
        match self {
            Mp4 => "mp4",
            Mkv => "mkv",
            Webm => "webm",
            Mov => "mov",
            Avi => "avi",
            Flv => "flv",
            Wmv => "wmv",
            Ts => "ts",
            Mpg => "mpg",
            ThreeGp => "3gp",
            Ogv => "ogv",
            Gif => "gif",
            Apng => "apng",
            WebpAnim => "webp",
            Mp3 => "mp3",
            M4a | Alac => "m4a",
            Aac => "aac",
            Wav => "wav",
            Flac => "flac",
            Ogg => "ogg",
            Opus => "opus",
            Wma => "wma",
            Aiff => "aiff",
            Ac3 => "ac3",
            Mp2 => "mp2",
            Amr => "amr",
            Png => "png",
            Jpg => "jpg",
            Webp => "webp",
            Avif => "avif",
            Bmp => "bmp",
            Tiff => "tiff",
            Ico => "ico",
        }
    }

    /// Shown in messages.
    pub fn label(self) -> &'static str {
        use Target::*;
        match self {
            Mp4 => "MP4",
            Mkv => "MKV",
            Webm => "WebM",
            Mov => "MOV",
            Avi => "AVI",
            Flv => "FLV",
            Wmv => "WMV",
            Ts => "TS",
            Mpg => "MPEG",
            ThreeGp => "3GP",
            Ogv => "OGV",
            Gif => "GIF",
            Apng => "APNG",
            WebpAnim => "animated WebP",
            Mp3 => "MP3",
            M4a => "M4A",
            Aac => "AAC",
            Wav => "WAV",
            Flac => "FLAC",
            Alac => "ALAC",
            Ogg => "OGG",
            Opus => "Opus",
            Wma => "WMA",
            Aiff => "AIFF",
            Ac3 => "AC3",
            Mp2 => "MP2",
            Amr => "AMR",
            Png => "PNG",
            Jpg => "JPG",
            Webp => "WebP",
            Avif => "AVIF",
            Bmp => "BMP",
            Tiff => "TIFF",
            Ico => "ICO",
        }
    }

    /// Video out, with sound when the source has some.
    pub fn is_video(self) -> bool {
        use Target::*;
        matches!(
            self,
            Mp4 | Mkv | Webm | Mov | Avi | Flv | Wmv | Ts | Mpg | ThreeGp | Ogv
        )
    }

    /// A picture that moves but has no sound.
    pub fn is_animation(self) -> bool {
        matches!(self, Target::Gif | Target::Apng | Target::WebpAnim)
    }

    pub fn is_audio(self) -> bool {
        use Target::*;
        matches!(
            self,
            Mp3 | M4a | Aac | Wav | Flac | Alac | Ogg | Opus | Wma | Aiff | Ac3 | Mp2 | Amr
        )
    }

    pub fn is_image(self) -> bool {
        use Target::*;
        matches!(self, Png | Jpg | Webp | Avif | Bmp | Tiff | Ico)
    }

    /// Whether a source with no audio stream can produce this at all.
    pub fn needs_audio(self) -> bool {
        self.is_audio()
    }

    /// Whether a file of `kind` can become this.
    ///
    /// - A video becomes any video, an animation, its sound (if it has any),
    ///   or a still picture taken from it.
    /// - Sound becomes other sound, or a video with a still black picture,
    ///   which is what upload forms that only take video want.
    /// - A still picture becomes another still picture, or a GIF.
    pub fn accepts(self, kind: Kind, has_audio: bool) -> bool {
        match kind {
            Kind::Video => !self.needs_audio() || has_audio,
            Kind::Audio => {
                self.is_audio()
                    || matches!(self, Target::Mp4 | Target::Mkv | Target::Mov | Target::Webm)
            }
            Kind::Image => self.is_image() || self == Target::Gif,
        }
    }

    /// The picture codecs this container can hold; the first is its usual one.
    pub fn video_codecs(self) -> &'static [VideoCodec] {
        use VideoCodec::*;
        match self {
            Target::Mp4 => &[H264, H265, Av1],
            Target::Mkv => &[H264, H265, Av1, Vp9],
            Target::Webm => &[Vp9, Av1, Vp8],
            Target::Mov => &[H264, H265, Prores],
            Target::Ts => &[H264, H265],
            Target::Flv | Target::ThreeGp => &[H264],
            Target::Avi => &[Mpeg4],
            Target::Wmv => &[Wmv2],
            Target::Mpg => &[Mpeg2],
            Target::Ogv => &[Theora],
            _ => &[],
        }
    }

    /// The codec actually used: the one asked for if this container can hold
    /// it, otherwise the container's usual one.
    fn video_codec(self, asked: Option<VideoCodec>) -> Option<VideoCodec> {
        let allowed = self.video_codecs();
        asked
            .filter(|c| allowed.contains(c))
            .or_else(|| allowed.first().copied())
    }

    /// Whether the index is moved to the front so the file starts playing
    /// before it has fully downloaded.
    fn faststart(self) -> bool {
        matches!(
            self,
            Target::Mp4 | Target::Mov | Target::M4a | Target::Alac | Target::ThreeGp
        )
    }
}

/// The sound codec for a target (a sound format, or the sound inside a
/// video), with its bitrates for auto/high/medium/small in kbps, or None
/// for lossless ones.
fn audio_codec(target: Target, video: Option<VideoCodec>) -> (&'static str, Option<[u32; 4]>) {
    use Target::*;
    const AAC: Option<[u32; 4]> = Some([192, 256, 128, 80]);
    match target {
        Mp3 | Avi => ("libmp3lame", Some([192, 320, 160, 96])),
        Webm => ("libopus", Some([128, 192, 112, 64])),
        Opus => ("libopus", Some([160, 192, 112, 64])),
        Ogg | Ogv => ("libvorbis", Some([192, 256, 128, 80])),
        Wma | Wmv => ("wmav2", Some([192, 256, 128, 64])),
        Mpg | Mp2 => ("mp2", Some([256, 320, 192, 128])),
        Ac3 => ("ac3", Some([384, 448, 256, 160])),
        Wav => ("pcm_s16le", None),
        Aiff => ("pcm_s16be", None),
        Flac => ("flac", None),
        Alac => ("alac", None),
        Amr => ("libopencore_amrnb", None),
        ThreeGp => ("aac", Some([96, 128, 64, 48])),
        // ProRes is for editing, and editors want uncompressed sound with it.
        Mov if video == Some(VideoCodec::Prores) => ("pcm_s16le", None),
        _ => ("aac", AAC),
    }
}

/// The software encoder for a picture codec at a quality.
fn video_codec_args(codec: VideoCodec, q: Quality, target: Target) -> Vec<String> {
    let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<String>>();
    let mut args = match codec {
        VideoCodec::H264 => s(&[
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            q.pick(["20", "18", "23", "28"]),
            // yuv420p is the pixel format every player understands. A source
            // in 10-bit or 4:4:4 encodes happily without this and then
            // refuses to play on half the devices people own.
            "-pix_fmt",
            "yuv420p",
        ]),
        VideoCodec::H265 => s(&[
            "-c:v",
            "libx265",
            "-preset",
            "fast",
            "-crf",
            q.pick(["24", "21", "27", "31"]),
            "-pix_fmt",
            "yuv420p",
            "-x265-params",
            "log-level=error",
        ]),
        // AV1 and VP9 at realtime speed: their default settings take many
        // times the length of the video, which nobody waits for on a desktop.
        VideoCodec::Av1 => s(&[
            "-c:v",
            "libaom-av1",
            "-usage",
            "realtime",
            "-cpu-used",
            "8",
            "-row-mt",
            "1",
            "-crf",
            q.pick(["32", "27", "36", "42"]),
            "-b:v",
            "0",
            "-pix_fmt",
            "yuv420p",
        ]),
        VideoCodec::Vp9 => s(&[
            "-c:v",
            "libvpx-vp9",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-row-mt",
            "1",
            "-crf",
            q.pick(["32", "27", "36", "42"]),
            "-b:v",
            "0",
            "-pix_fmt",
            "yuv420p",
        ]),
        VideoCodec::Vp8 => s(&[
            "-c:v",
            "libvpx",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-crf",
            q.pick(["10", "6", "16", "26"]),
            "-b:v",
            q.pick(["4M", "8M", "2M", "1M"]),
            "-pix_fmt",
            "yuv420p",
        ]),
        VideoCodec::Prores => s(&[
            "-c:v",
            "prores_ks",
            "-profile:v",
            q.pick(["3", "3", "2", "0"]),
            "-pix_fmt",
            "yuv422p10le",
        ]),
        // MPEG-4 Part 2, tagged Xvid: what "AVI" means to every player and TV
        // that still asks for one.
        VideoCodec::Mpeg4 => s(&[
            "-c:v",
            "mpeg4",
            "-q:v",
            q.pick(["3", "2", "5", "9"]),
            "-vtag",
            "xvid",
        ]),
        VideoCodec::Wmv2 => s(&["-c:v", "wmv2", "-b:v", q.pick(["4M", "6M", "2500k", "1M"])]),
        VideoCodec::Mpeg2 => s(&["-c:v", "mpeg2video", "-q:v", q.pick(["3", "2", "5", "9"])]),
        VideoCodec::Theora => s(&["-c:v", "libtheora", "-q:v", q.pick(["7", "9", "5", "3"])]),
    };
    // Apple's players only play H.265 in MP4/MOV when it is tagged hvc1.
    if codec == VideoCodec::H265 && matches!(target, Target::Mp4 | Target::Mov) {
        args.extend(s(&["-tag:v", "hvc1"]));
    }
    args
}

/// The graphics-card encoders, per codec, in the order they are tried.
const HARDWARE: &[(&str, VideoCodec)] = &[
    ("h264_nvenc", VideoCodec::H264),
    ("h264_qsv", VideoCodec::H264),
    ("h264_amf", VideoCodec::H264),
    ("hevc_nvenc", VideoCodec::H265),
    ("hevc_qsv", VideoCodec::H265),
    ("hevc_amf", VideoCodec::H265),
];

/// A graphics-card encoder's settings, giving roughly the software path's
/// quality at each level.
fn hardware_args(name: &str, q: Quality) -> Vec<String> {
    let cq = q.pick(["21", "19", "25", "30"]);
    let (qi, qp) = q.pick([("20", "22"), ("18", "20"), ("24", "26"), ("29", "31")]);
    let v: Vec<&str> = match name {
        n if n.ends_with("_nvenc") => vec![
            "-c:v", n, "-preset", "p5", "-rc", "vbr", "-cq", cq, "-b:v", "0", "-pix_fmt", "yuv420p",
        ],
        n if n.ends_with("_qsv") => vec![
            "-c:v",
            n,
            "-preset",
            "medium",
            "-global_quality",
            cq,
            "-pix_fmt",
            "nv12",
        ],
        n if n.ends_with("_amf") => vec![
            "-c:v", n, "-quality", "balanced", "-rc", "cqp", "-qp_i", qi, "-qp_p", qp, "-pix_fmt",
            "yuv420p",
        ],
        _ => vec![],
    };
    v.into_iter().map(String::from).collect()
}

static HARDWARE_FOUND: std::sync::Mutex<Vec<(VideoCodec, Option<&'static str>)>> =
    std::sync::Mutex::new(Vec::new());

/// Set when a graphics-card encode failed on a real file. The test encode
/// passing does not promise every file will (odd sizes, driver limits), and
/// once one has failed the rest of the session goes straight to software.
static HARDWARE_BROKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The first graphics-card encoder for `codec` that actually works here,
/// found once per codec.
///
/// Being listed by `ffmpeg -encoders` only means ffmpeg was built with it;
/// NVENC is listed on a machine with no NVIDIA card at all. So each one also
/// has to encode half a second of black before it is trusted.
async fn hardware_encoder(codec: VideoCodec) -> Option<&'static str> {
    if HARDWARE_BROKEN.load(std::sync::atomic::Ordering::Relaxed) {
        return None;
    }
    if let Some((_, found)) = HARDWARE_FOUND
        .lock()
        .unwrap()
        .iter()
        .find(|(c, _)| *c == codec)
    {
        return *found;
    }
    let listed = crate::ytdlp::base_command(ffmpeg())
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let mut found = None;
    for (name, c) in HARDWARE {
        if *c == codec && listed.contains(name) && hardware_works(name).await {
            found = Some(*name);
            break;
        }
    }
    HARDWARE_FOUND.lock().unwrap().push((codec, found));
    found
}

async fn hardware_works(name: &str) -> bool {
    let mut cmd = crate::ytdlp::base_command(ffmpeg());
    cmd.args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
        .arg("color=c=black:s=640x360:r=30:d=0.5")
        .args(hardware_args(name, Quality::Auto))
        .args(["-f", "null", "-"]);
    matches!(
        tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await,
        Ok(Ok(out)) if out.status.success()
    )
}

/// How one attempt at a conversion encodes, fastest first.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Plan {
    /// The streams are already what the target needs: moved into the new
    /// file as they are. Seconds instead of minutes, and no quality lost.
    Copy,
    /// The picture on the graphics card.
    Hardware(&'static str),
    /// The reference path, on the processor.
    Software,
}

/// Whether `info` can go to `target` without re-encoding (options aside).
///
/// MP4/MOV/TS: an 8-bit 4:2:0 H.264 picture with AAC or MP3 sound (or none)
/// is exactly what the software path would produce, so re-encoding it would
/// only cost time and quality. Anything else — VP9, AV1, 10-bit, Opus — is
/// what someone converts to MP4 to get rid of, and is encoded.
///
/// MKV holds anything, so a video always tries a copy first. WebM takes VP8,
/// VP9 or AV1 with Opus or Vorbis. A sound target copies when the sound is
/// already in that format.
fn can_copy(target: Target, info: &SourceInfo) -> bool {
    let audio = info.audio_codec.as_deref();
    let video = info.video_codec.as_deref();
    match target {
        Target::Mp4 | Target::Mov | Target::Ts => {
            video == Some("h264")
                && info.video_plays_everywhere
                && matches!(audio, None | Some("aac") | Some("mp3"))
        }
        Target::Mkv => info.kind == Kind::Video,
        Target::Webm => {
            matches!(video, Some("vp8") | Some("vp9") | Some("av1"))
                && matches!(audio, None | Some("opus") | Some("vorbis"))
        }
        Target::Mp3 => audio == Some("mp3"),
        Target::M4a | Target::Aac => audio == Some("aac"),
        Target::Flac => audio == Some("flac"),
        Target::Alac => audio == Some("alac"),
        Target::Ogg => audio == Some("vorbis"),
        Target::Opus => audio == Some("opus"),
        Target::Wav => audio == Some("pcm_s16le"),
        Target::Ac3 => audio == Some("ac3"),
        _ => false,
    }
}

/// A copy is only right when nothing asked for needs re-encoding, and the
/// picture codec asked for (if any) is the one already there.
fn copy_allowed(target: Target, opts: &Options, info: &SourceInfo) -> bool {
    opts.changes_nothing()
        && (info.kind != Kind::Video
            || !target.is_video()
            || opts.video_codec.is_none()
            || opts.video_codec.map(VideoCodec::stream_name) == info.video_codec.as_deref())
        && can_copy(target, info)
}

fn copy_args(target: Target) -> Vec<String> {
    let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match target {
        // The first picture and the first sound only: subtitle and data
        // streams from an MKV have no place in an MP4 and would fail the mux.
        Target::Mp4 | Target::Mov => s(&[
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
        ]),
        Target::Ts => s(&["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"]),
        // Every sound track: an MKV is where multi-language files live.
        Target::Mkv | Target::Webm => s(&["-map", "0:v:0", "-map", "0:a?", "-c", "copy"]),
        _ => s(&["-vn", "-map", "0:a:0", "-c:a", "copy"]),
    }
}

/// The arguments for one attempt: those before the file's `-i` (where to
/// start and stop reading it) and those after it.
fn build_args(
    plan: Plan,
    target: Target,
    opts: &Options,
    info: &SourceInfo,
    generated_picture: bool,
) -> (Vec<String>, Vec<String>) {
    let mut before: Vec<String> = Vec::new();
    let mut after: Vec<String> = Vec::new();
    let push = |v: &mut Vec<String>, a: &[&str]| v.extend(a.iter().map(|x| x.to_string()));

    // Trim. Placed before the input: ffmpeg then seeks straight there, and
    // when encoding the cut is still exact to the frame.
    let still_from_video = target.is_image() && info.kind == Kind::Video;
    let start = opts.start.filter(|s| *s > 0.0).or_else(|| {
        // A still picture from a video is taken a tenth of the way in: the
        // first frame of most videos is black or a fade.
        still_from_video
            .then(|| info.duration.map(|d| (d * 0.1).min(10.0)))
            .flatten()
    });
    if let Some(start) = start {
        push(&mut before, &["-ss", &format!("{start:.3}")]);
    }
    if let Some(end) = opts.end.filter(|e| *e > 0.0 && Some(*e) > opts.start) {
        push(&mut before, &["-to", &format!("{end:.3}")]);
    }

    if plan == Plan::Copy {
        after.extend(copy_args(target));
        return (before, after);
    }

    let src = if generated_picture { "1" } else { "0" };
    let picture = !target.is_audio();
    let sound = (target.is_video() && !(opts.mute && !generated_picture)) || target.is_audio();

    // Streams. Explicit, because ffmpeg's own pick is "the best stream of
    // each kind", and for an MP3 with cover art the best video stream is the
    // cover. A still picture is the exception: an ICO holds one picture per
    // size, and ffmpeg's pick is the largest.
    if picture && !(info.kind == Kind::Image && !generated_picture) {
        push(&mut after, &["-map", "0:v:0"]);
    }
    if sound {
        push(
            &mut after,
            &[
                "-map",
                &format!("{src}:a:0{}", if target.is_audio() { "" } else { "?" }),
            ],
        );
    } else {
        push(&mut after, &["-an"]);
    }
    if !picture {
        push(&mut after, &["-vn"]);
    }

    // The picture.
    if picture {
        let mut filters: Vec<String> = Vec::new();
        match opts.rotate {
            Some(90) => filters.push("transpose=1".into()),
            Some(180) => filters.push("hflip,vflip".into()),
            Some(270) => filters.push("transpose=2".into()),
            _ => {}
        }
        if target.is_image() || (info.kind == Kind::Image && target == Target::Gif) {
            let limit = match target {
                // An icon holds at most 256x256.
                Target::Ico => Some(opts.image_size.unwrap_or(256).min(256)),
                _ => opts.image_size,
            };
            if let Some(side) = limit {
                filters.push(format!(
                    "scale='if(gte(iw,ih),min(iw,{side}),-1)':'if(gte(iw,ih),-1,min(ih,{side}))'"
                ));
            }
        } else {
            if let Some(fps) = opts.fps.or(target
                .is_animation()
                .then_some(if target == Target::Gif { 12.0 } else { 15.0 }))
            {
                filters.push(format!("fps={fps}"));
            }
            match opts.height {
                Some(h) => filters.push(format!("scale=-2:'min(ih,{h})'")),
                // Animations default to a size that keeps them animations
                // rather than hundred-megabyte files.
                None if target.is_animation() => {
                    filters.push("scale='min(640,iw)':-2:flags=lanczos".into())
                }
                None => {}
            }
            // Most codecs need even dimensions; a rotated or odd-sized source
            // would otherwise fail at the first frame.
            if target.is_video() && !generated_picture {
                filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
            }
        }

        let q = opts.quality;
        match target {
            Target::Gif => {
                // A palette made from the picture itself.
                filters.push(
                    "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
                        .into(),
                );
            }
            // JPEG has no transparency; the picture is laid on white first,
            // or a transparent PNG comes out with a black background.
            Target::Jpg => filters.push(
                "split[a][b];[a]drawbox=c=white:t=fill[bg];[bg][b]overlay=format=auto,format=yuvj444p"
                    .into(),
            ),
            _ => {}
        }
        if !filters.is_empty() {
            push(&mut after, &["-vf", &filters.join(",")]);
        }

        match target {
            Target::Gif => push(&mut after, &["-loop", "0"]),
            Target::Apng => push(
                &mut after,
                &["-c:v", "apng", "-plays", "0", "-pred", "mixed"],
            ),
            Target::WebpAnim => push(
                &mut after,
                &[
                    "-c:v",
                    "libwebp_anim",
                    "-loop",
                    "0",
                    "-quality",
                    q.pick(["80", "90", "70", "50"]),
                ],
            ),
            Target::Png => push(&mut after, &["-c:v", "png"]),
            Target::Jpg => push(
                &mut after,
                &["-c:v", "mjpeg", "-q:v", q.pick(["2", "1", "4", "8"])],
            ),
            Target::Webp => push(
                &mut after,
                &[
                    "-c:v",
                    "libwebp",
                    "-quality",
                    q.pick(["90", "96", "80", "60"]),
                ],
            ),
            Target::Avif => push(
                &mut after,
                &[
                    "-c:v",
                    "libaom-av1",
                    "-still-picture",
                    "1",
                    "-cpu-used",
                    "6",
                    "-crf",
                    q.pick(["24", "18", "30", "40"]),
                    "-pix_fmt",
                    "yuv420p",
                ],
            ),
            Target::Bmp => push(&mut after, &["-c:v", "bmp"]),
            Target::Tiff => push(
                &mut after,
                &["-c:v", "tiff", "-compression_algo", "deflate"],
            ),
            // An icon's PNG has to be 32-bit RGBA, or the ICO writer refuses it.
            Target::Ico => push(&mut after, &["-c:v", "png", "-pix_fmt", "rgba"]),
            _ => {
                let codec = target
                    .video_codec(opts.video_codec)
                    .unwrap_or(VideoCodec::H264);
                match plan {
                    Plan::Hardware(name) => after.extend(hardware_args(name, q)),
                    _ => after.extend(video_codec_args(codec, q, target)),
                }
            }
        }
        if target.is_image() {
            push(&mut after, &["-frames:v", "1"]);
            // The image2 writer (PNG, JPG, BMP, TIFF) writes one file only
            // when told there is one.
            if matches!(
                target,
                Target::Png | Target::Jpg | Target::Bmp | Target::Tiff
            ) {
                push(&mut after, &["-update", "1"]);
            }
        }
    }

    // The sound.
    if sound {
        let codec = target.video_codec(opts.video_codec);
        let (encoder, rates) = audio_codec(target, codec);
        push(&mut after, &["-c:a", encoder]);
        if let Some(rates) = rates {
            let kbps = opts
                .audio_bitrate
                .unwrap_or_else(|| opts.quality.pick(rates));
            push(&mut after, &["-b:a", &format!("{kbps}k")]);
        }
        if target == Target::Amr {
            // AMR is phone audio: 8 kHz, one channel, 12.2 kbps, nothing else.
            push(&mut after, &["-ar", "8000", "-ac", "1", "-b:a", "12.2k"]);
        } else {
            if let Some(ch) = opts.channels {
                push(&mut after, &["-ac", &ch.to_string()]);
            } else if matches!(target, Target::Mpg | Target::Mp2) {
                // MP2 has no layout for surround; five channels in fail.
                push(&mut after, &["-ac", "2"]);
            }
            match opts.sample_rate {
                Some(rate) => push(&mut after, &["-ar", &rate.to_string()]),
                // Opus only runs at 48 kHz; WMA and AC3 at the usual rates.
                None if encoder == "libopus" => push(&mut after, &["-ar", "48000"]),
                None => {}
            }
        }
        if opts.normalize {
            push(&mut after, &["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]);
        }
    }

    if target.faststart() {
        push(&mut after, &["-movflags", "+faststart"]);
    }
    if generated_picture {
        // Second line of defence. The generated picture is normally already
        // bounded with -t by the caller; this covers a source whose length
        // nothing could determine, where the sound is the only thing that
        // says when the file is over.
        push(&mut after, &["-shortest"]);
    }
    (before, after)
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
    /// True when there is a real picture in the file: a video, or an image.
    /// An MP3's cover art doesn't count; that file is still sound.
    pub has_video: bool,
    /// Video, sound or a still image: decides which targets are offered.
    pub kind: Kind,
    /// The picture's size, when there is one.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// The first real video stream's codec ("h264", "vp9"), not counting
    /// cover art. Shown on the file's card, and used to decide whether a
    /// conversion can copy.
    pub video_codec: Option<String>,
    /// Whether that stream is 8-bit 4:2:0, the pixel format every player
    /// handles. A 10-bit H.264 is still H.264 and still refuses to play on
    /// half the devices people own, so it cannot be copied as it is.
    #[serde(skip)]
    pub video_plays_everywhere: bool,
    /// The first audio stream's codec ("aac", "mp3", "opus").
    pub audio_codec: Option<String>,
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

    let has_audio = has_stream(&text, "Audio:");
    let picture = video_line(&text);
    let kind = if picture.is_some() && is_still_image(&text) {
        Kind::Image
    } else if picture.is_some() {
        Kind::Video
    } else if has_audio {
        Kind::Audio
    } else {
        return Err(format!("{name} has no sound or picture to convert."));
    };
    // An ICO holds one picture per size; the one that matters is the largest.
    let (width, height) = text
        .lines()
        .filter(|l| l.trim_start().starts_with("Stream #") && l.contains("Video:"))
        .filter(|l| !l.contains("(attached pic)"))
        .filter_map(picture_size)
        .max_by_key(|(w, h)| w * h)
        .unzip();

    Ok(SourceInfo {
        path: path.to_string_lossy().into_owned(),
        name,
        size_bytes,
        duration: parse_duration(&text),
        has_audio,
        has_video: picture.is_some(),
        kind,
        width,
        height,
        video_codec: stream_codec(&text, "Video:"),
        video_plays_everywhere: video_line(&text)
            .is_some_and(|l| l.contains("yuv420p") && !l.contains("yuv420p10")),
        audio_codec: stream_codec(&text, "Audio:"),
    })
}

/// A still picture: ffmpeg reads single images through its image "pipes"
/// (`png_pipe`, `jpeg_pipe`, `webp_pipe`) or the image2 demuxer. An animated
/// GIF is read by the `gif` demuxer and counts as video.
fn is_still_image(text: &str) -> bool {
    let format = text
        .lines()
        .find(|l| l.starts_with("Input #0"))
        .and_then(|l| l.split(',').nth(1))
        .map(|f| f.trim().to_string())
        .unwrap_or_default();
    if format.ends_with("_pipe") || format == "image2" || format == "ico" {
        return true;
    }
    // AVIF and HEIC are read by the MP4 reader. A picture codec with a
    // single frame's length and no sound is a still, whatever the reader.
    let single_frame = match parse_duration(text) {
        None => true,
        Some(d) => d <= 0.1,
    };
    single_frame
        && !has_stream(text, "Audio:")
        && video_line(text).is_some_and(|l| {
            [
                "png", "mjpeg", "webp", "bmp", "tiff", "gif", "av1", "hevc", "jpegxl", "jpeg2000",
                "qoi",
            ]
            .iter()
            .any(|c| l.contains(&format!("Video: {c}")))
        })
}

/// `… yuv420p(tv), 1920x1080 [SAR 1:1 …]` → (1920, 1080).
fn picture_size(line: &str) -> Option<(u32, u32)> {
    line.split([',', ' '])
        .filter_map(|part| {
            let (w, h) = part.trim().split_once('x')?;
            Some((w.parse().ok()?, h.parse().ok()?))
        })
        .find(|(w, h): &(u32, u32)| *w > 0 && *h > 0)
}

/// The first video stream line that is a real picture, not an MP3's cover.
fn video_line(text: &str) -> Option<&str> {
    text.lines()
        .filter(|l| l.trim_start().starts_with("Stream #"))
        .find(|l| l.contains("Video:") && !l.contains("(attached pic)"))
}

/// `Stream #0:0: Video: h264 (High) (avc1 / …)` → `h264`.
fn stream_codec(text: &str, kind: &str) -> Option<String> {
    let line = if kind == "Video:" {
        video_line(text)?
    } else {
        text.lines()
            .filter(|l| l.trim_start().starts_with("Stream #"))
            .find(|l| l.contains(kind))?
    };
    let codec = line
        .split(kind)
        .nth(1)?
        .trim_start()
        .split([' ', ','])
        .next()?;
    (!codec.is_empty()).then(|| codec.to_ascii_lowercase())
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
        return format!("{name} was moved or deleted.");
    }
    if lower.contains("permission denied") {
        return format!("Windows wouldn't let this read {name}.");
    }
    if lower.contains("no space left") {
        return format!(
            "There isn't enough free space to save the {}.",
            target.label()
        );
    }
    if lower.contains("does not contain any stream") || lower.contains("output file is empty") {
        // Only an MP3 can fail for want of sound. A silent source makes a
        // perfectly good MP4, so blaming the audio there would send the user
        // looking for a problem that is not the one they have.
        return if target.needs_audio() {
            format!("{name} has no sound in it.")
        } else {
            format!("Nothing in {name} could be converted.")
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

/// Converts one file to `target` at `dest` with `opts`, reporting 0-100 as it
/// goes.
///
/// `total_seconds` is the source duration, used to turn ffmpeg's elapsed time
/// into a percentage. When it is unknown the callback still fires with the
/// stage, so the row shows work happening rather than a bar frozen at zero.
///
/// `control` carries stop from the UI, the same single control a download
/// has.
pub async fn convert<F>(
    source: &Path,
    dest: &Path,
    target: Target,
    opts: &Options,
    total_seconds: Option<f64>,
    mut control: tokio::sync::watch::Receiver<crate::ytdlp::Control>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64, &str, Option<crate::ytdlp::Transfer>) + Send,
{
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| source.to_string_lossy().into_owned());
    let info = probe(source).await?;
    if !target.accepts(info.kind, info.has_audio) {
        return Err(format!("{name} can't become a {}.", target.label()));
    }

    // A video asked for from a file with no picture has to be *given* one.
    //
    // Without this ffmpeg quietly drops -c:v — there is no video to apply it
    // to — and writes an MP4 holding nothing but an audio track. That file
    // opens, plays, and is rejected by every upload form that wants a video,
    // which is the exact reason someone converts an audio file to MP4 in the
    // first place. Measured, not assumed: the first version of this shipped
    // that file and called it done.
    let generated_picture = target.is_video() && info.kind == Kind::Audio;

    // What the progress bar divides by: the trimmed length when trimming.
    let total_seconds = total_seconds.or(info.duration).map(|full| {
        let end = opts.end.filter(|e| *e > 0.0).unwrap_or(full).min(full);
        (end - opts.start.unwrap_or(0.0)).max(0.1)
    });

    // Fastest first; each later plan is the fallback for the one before.
    let mut plans = Vec::new();
    if !generated_picture && copy_allowed(target, opts, &info) {
        plans.push(Plan::Copy);
    }
    if target.is_video() {
        if let Some(codec) = target.video_codec(opts.video_codec) {
            if let Some(encoder) = hardware_encoder(codec).await {
                plans.push(Plan::Hardware(encoder));
            }
        }
    }
    plans.push(Plan::Software);

    for (i, plan) in plans.iter().enumerate() {
        let last = i + 1 == plans.len();
        match run_plan(
            *plan,
            source,
            dest,
            target,
            opts,
            &info,
            generated_picture,
            total_seconds,
            &name,
            &mut control,
            &mut on_progress,
        )
        .await
        {
            Ok(()) => {
                let size = std::fs::metadata(dest)
                    .ok()
                    .map(|m| crate::ytdlp::Transfer {
                        downloaded: m.len(),
                        speed: None,
                        eta: None,
                    });
                on_progress(100.0, "Done", size);
                return Ok(());
            }
            Err(Attempt::Final(message)) => return Err(message),
            Err(Attempt::Failed(stderr)) => {
                // A copy that ffmpeg would not mux, or a card that choked on
                // this file: the next plan starts from a clean slate.
                let _ = std::fs::remove_file(dest);
                if matches!(plan, Plan::Hardware(_)) {
                    HARDWARE_BROKEN.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                if last {
                    return Err(explain(&stderr, &name, target));
                }
            }
        }
    }
    unreachable!("the software plan is always last")
}

/// How one attempt ended, when it did not succeed.
enum Attempt {
    /// Stopped or timed out: the user's answer, not a reason to try again.
    Final(String),
    /// ffmpeg failed; its stderr, for the next plan or the error message.
    Failed(String),
}

#[allow(clippy::too_many_arguments)]
async fn run_plan<F>(
    plan: Plan,
    source: &Path,
    dest: &Path,
    target: Target,
    opts: &Options,
    info: &SourceInfo,
    generated_picture: bool,
    total_seconds: Option<f64>,
    name: &str,
    control: &mut tokio::sync::watch::Receiver<crate::ytdlp::Control>,
    on_progress: &mut F,
) -> Result<(), Attempt>
where
    F: FnMut(f64, &str, Option<crate::ytdlp::Transfer>) + Send,
{
    let mut cmd = crate::ytdlp::base_command(ffmpeg());
    cmd.args(["-hide_banner", "-nostdin", "-y"]);

    if generated_picture {
        // How long the generated picture must run.
        //
        // -shortest is not enough on its own, and that is measured rather
        // than assumed: the bundled Windows ffmpeg (9.0.1) ends the encode
        // with it, while the bundled Linux one (8.1) ignores it against an
        // endless lavfi input and ran a three-second song out to thirty
        // seconds. Same code, same arguments, two different files — and the
        // fallback has to hold on both, so it cannot be -shortest.
        //
        // -t makes the generated stream finite before -shortest is ever
        // consulted. A file whose length genuinely cannot be determined is
        // the one case with nothing to bound against; it gets a fixed cap
        // instead of an endless stream.
        let seconds = total_seconds
            .filter(|s| *s > 0.0)
            .unwrap_or(UNKNOWN_LENGTH_CAP);
        cmd.args(["-f", "lavfi", "-t", &format!("{seconds:.3}")]);

        // The generated picture comes first so it is input 0 and the real
        // file is input 1.
        cmd.args(["-i", BLANK_PICTURE]);
    }

    let (before, after) = build_args(plan, target, opts, info, generated_picture);
    cmd.args(before)
        .arg("-i")
        .arg(source)
        .args(after)
        // Machine-readable progress on stdout, so stderr stays purely the
        // error channel and the two never have to be untangled.
        .args(["-progress", "pipe:1", "-loglevel", "error"])
        .arg(dest);

    let mut child = cmd
        .spawn()
        .map_err(|e| Attempt::Final(format!("Could not start the converter ({e}).")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Attempt::Final("Could not read the converter's output".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    // Video re-encoding is slow enough that "Converting" alone leaves people
    // wondering whether it is stuck, so the stage says which job is running.
    let stage = match plan {
        Plan::Copy => "Copying",
        Plan::Hardware(_) => "Encoding video on the graphics card",
        Plan::Software if target.is_video() => "Encoding video",
        Plan::Software if target.is_animation() => "Making the animation",
        Plan::Software => "Converting",
    };
    on_progress(0.0, stage, None);

    let deadline = tokio::time::sleep(CONVERT_TIMEOUT);
    tokio::pin!(deadline);

    let started = std::time::Instant::now();
    let mut last_percent = 0.0f64;
    let mut written = 0u64;

    loop {
        tokio::select! {
            changed = control.changed() => {
                if changed.is_err() {
                    continue;
                }
                let requested = *control.borrow();
                if requested == crate::ytdlp::Control::Stop {
                    let _ = child.kill().await;
                    return Err(Attempt::Final("Conversion stopped".into()));
                }
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                return Err(Attempt::Final(format!("Converting {name} took too long.")));
            }
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        // ffmpeg reports the output's size so far; it rides
                        // along with the next time update.
                        if let Some(bytes) = line
                            .strip_prefix("total_size=")
                            .and_then(|v| v.trim().parse::<u64>().ok())
                        {
                            written = bytes;
                            continue;
                        }
                        if let (Some(done), Some(total)) =
                            (parse_progress_time(&line), total_seconds)
                        {
                            if total > 0.0 {
                                // Clamped below 100: the row reaches 100 when
                                // the process actually exits, not when ffmpeg
                                // reports the last timestamp.
                                last_percent = ((done / total) * 100.0).clamp(0.0, 99.0);
                                let eta = time_left(started.elapsed().as_secs_f64(), last_percent);
                                on_progress(last_percent, stage, transfer(written, eta));
                            }
                        } else if line.starts_with("out_time=") {
                            // No duration to divide by — keep the stage
                            // moving so the row does not look stalled.
                            on_progress(last_percent, stage, transfer(written, None));
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
        .map_err(|e| Attempt::Final(format!("The converter stopped unexpectedly ({e}).")))?;

    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut err) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf).await;
            stderr = String::from_utf8_lossy(&buf).into_owned();
        }
        return Err(Attempt::Failed(stderr));
    }
    Ok(())
}

fn transfer(written: u64, eta: Option<u64>) -> Option<crate::ytdlp::Transfer> {
    (written > 0 || eta.is_some()).then_some(crate::ytdlp::Transfer {
        downloaded: written,
        speed: None,
        eta,
    })
}

/// Seconds left, from how long the first part took. Not offered until there
/// is enough to go on: the first second of an encode includes starting up,
/// and a guess made from it swings wildly.
fn time_left(elapsed: f64, percent: f64) -> Option<u64> {
    (elapsed >= 2.0 && percent >= 1.0)
        .then(|| (elapsed * (100.0 - percent) / percent).round() as u64)
}

/// The path a source file should become: same folder, same name, new
/// extension.
///
/// Converting in place is what people expect from a converter — the file came
/// from somewhere they chose, and the result belongs beside it. A save dialog
/// per file would make converting twenty files twenty prompts, which is the
/// same reason whole-playlist downloads ask for a folder once.
/// The converted file's name: "yt2mp-" and the source's name, with the new
/// extension. "holiday.mov" becomes "yt2mp-holiday.mp4".
pub fn output_name(source: &Path, target: Target) -> String {
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "converted".into());
    format!("{}.{}", crate::branded(&stem), target.extension())
}

#[cfg(test)]
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
        let msg = explain(
            "song.wav: No such file or directory",
            "song.wav",
            Target::Mp3,
        );
        assert!(msg.contains("song.wav"), "{msg}");
        assert!(
            !msg.contains("No such file"),
            "leaks the raw wording: {msg}"
        );
    }

    /// An unrecognised failure still shows ffmpeg's own last line rather than
    /// a vague "something went wrong", which would be less useful.
    #[test]
    fn an_unknown_error_keeps_ffmpegs_last_line() {
        let msg = explain("Something very specific went wrong", "a.wav", Target::Mp4);
        assert!(
            msg.starts_with("Something very specific went wrong"),
            "{msg}"
        );
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
        let name = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };

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
            _ => true,
        }
    }

    fn info(video: Option<&str>, everywhere: bool, audio: Option<&str>) -> SourceInfo {
        SourceInfo {
            path: String::new(),
            name: String::new(),
            size_bytes: None,
            duration: None,
            has_audio: audio.is_some(),
            has_video: video.is_some(),
            kind: if video.is_some() {
                Kind::Video
            } else {
                Kind::Audio
            },
            width: None,
            height: None,
            video_codec: video.map(str::to_string),
            video_plays_everywhere: everywhere,
            audio_codec: audio.map(str::to_string),
        }
    }

    #[test]
    fn each_kind_of_file_is_offered_what_it_can_become() {
        use Target::*;
        assert!(Mp3.accepts(Kind::Video, true));
        assert!(
            !Mp3.accepts(Kind::Video, false),
            "a silent video makes no MP3"
        );
        assert!(
            Webm.accepts(Kind::Video, false),
            "a silent video is still a video"
        );
        assert!(Png.accepts(Kind::Video, true), "a still from a video");
        assert!(
            Mp4.accepts(Kind::Audio, true),
            "sound can become an MP4 with a picture"
        );
        assert!(!Gif.accepts(Kind::Audio, true));
        assert!(!Avi.accepts(Kind::Audio, true));
        assert!(Jpg.accepts(Kind::Image, false));
        assert!(Gif.accepts(Kind::Image, false));
        assert!(!Mp4.accepts(Kind::Image, false));
        assert!(!Mp3.accepts(Kind::Image, false));
    }

    #[test]
    fn the_file_kind_and_size_come_from_the_banner() {
        let png = "Input #0, png_pipe, from 'a.png':\n  Stream #0:0: Video: png, rgb24(pc), 200x120, 25 fps";
        assert!(is_still_image(png));
        let gif = "Input #0, gif, from 'a.gif':\n  Duration: 00:00:03.20, start: 0.000000\n  Stream #0:0: Video: gif, bgra, 480x270, 10 fps";
        assert!(!is_still_image(gif), "an animated GIF is a video");
        let ico = "Input #0, ico, from 'a.ico':\n  Duration: N/A\n  Stream #0:0: Video: png, rgba(pc), 16x16";
        assert!(is_still_image(ico), "an icon is a picture");
        let line = "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps";
        assert_eq!(picture_size(line), Some((1920, 1080)));
    }

    #[test]
    fn only_what_already_plays_everywhere_is_copied() {
        assert!(can_copy(
            Target::Mp4,
            &info(Some("h264"), true, Some("aac"))
        ));
        assert!(can_copy(Target::Mp4, &info(Some("h264"), true, None)));
        // What people convert to MP4 to get rid of.
        assert!(!can_copy(
            Target::Mp4,
            &info(Some("vp9"), true, Some("opus"))
        ));
        assert!(!can_copy(
            Target::Mp4,
            &info(Some("h264"), false, Some("aac"))
        ));
        assert!(!can_copy(
            Target::Mp4,
            &info(Some("h264"), true, Some("opus"))
        ));
        assert!(can_copy(Target::Mp3, &info(None, false, Some("mp3"))));
        assert!(!can_copy(Target::Mp3, &info(None, false, Some("aac"))));
    }

    #[test]
    fn codecs_are_read_and_cover_art_is_not_a_picture() {
        let banner = "  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 320 kb/s
                        Stream #0:1: Video: mjpeg (Baseline), yuvj420p, 600x600 (attached pic)
";
        assert_eq!(stream_codec(banner, "Audio:").as_deref(), Some("mp3"));
        assert_eq!(stream_codec(banner, "Video:"), None);

        let video = "  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080
                       Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo
";
        assert_eq!(stream_codec(video, "Video:").as_deref(), Some("h264"));
        assert!(video_line(video).is_some_and(|l| l.contains("yuv420p")));
    }

    #[test]
    fn time_left_waits_for_enough_to_go_on() {
        assert_eq!(time_left(1.0, 50.0), None);
        assert_eq!(time_left(10.0, 0.5), None);
        assert_eq!(time_left(10.0, 25.0), Some(30));
    }

    mod with_real_ffmpeg {
        use super::*;

        /// An H.264 + AAC MKV becomes an MP4 by copying, not encoding: the
        /// stage says so, and the result still has both streams.
        #[tokio::test]
        async fn a_file_that_already_plays_everywhere_is_copied() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !can_encode(&ff, Target::Mp4) {
                eprintln!("skipping: this ffmpeg has no libx264");
                return;
            }
            let dir = std::env::temp_dir().join("yt2mp-convert-copy");
            let _ = std::fs::create_dir_all(&dir);
            let source = dir.join("clip.mkv");
            let made = crate::ytdlp::base_command(ffmpeg())
                .args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=3"])
                .args(["-f", "lavfi", "-i", "color=c=blue:s=320x240:d=3"])
                .args([
                    "-shortest",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                ])
                .arg(&source)
                .output()
                .await
                .expect("ffmpeg runs");
            assert!(made.status.success(), "the fixture builds");

            let src = probe(&source).await.unwrap();
            let dest = default_dest(&source, Target::Mp4);
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);
            let mut stages: Vec<String> = Vec::new();
            convert(
                &source,
                &dest,
                Target::Mp4,
                &Options::default(),
                src.duration,
                rx,
                |_, s, _| {
                    if stages.last().map(String::as_str) != Some(s) {
                        stages.push(s.to_string());
                    }
                },
            )
            .await
            .expect("the copy succeeds");

            assert_eq!(
                stages.first().map(String::as_str),
                Some("Copying"),
                "{stages:?}"
            );
            let out = probe(&dest).await.unwrap();
            assert!(out.has_video && out.has_audio);
            assert_eq!(out.video_codec.as_deref(), Some("h264"));
            let _ = std::fs::remove_dir_all(&dir);
        }

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
                &Options::default(),
                info.duration,
                rx,
                |p, _, _| seen.push(p),
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
                &Options::default(),
                info.duration,
                rx,
                |p, _, _| seen.push(p),
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
                &Options::default(),
                info.duration,
                rx,
                |_, _, _| {},
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
                &Options::default(),
                info.duration,
                rx,
                |_, _, _| {},
            )
            .await
            .expect("an audio file converts to video");

            let out = probe(&dest).await.expect("the mp4 probes");
            assert!(
                out.has_video,
                "a picture was generated - without one this is an audio file wearing an mp4 extension"
            );
            assert!(out.has_audio, "the sound survived");

            // The generated picture has to have been stopped. It runs
            // forever, so a file longer than its sound means nothing bounded
            // it and the encode ran until something else gave up.
            //
            // This is the assertion that caught the Linux failure: the
            // bundled ffmpeg there ignored -shortest against an endless lavfi
            // input and turned three seconds of audio into thirty seconds of
            // video. Windows produced the right file from the same code.
            let length = out.duration.expect("an mp4 reports a duration");
            assert!(
                (length - 3.0).abs() < 1.0,
                "expected ~3s, got {length} - the generated picture did not stop"
            );

            let _ = std::fs::remove_dir_all(&dir);
        }

        /// The same conversion with the length unknown.
        ///
        /// `-t` cannot be used when nothing knows how long the source is, so
        /// this is the path that still rests on `-shortest`. It has to
        /// terminate and it has to produce a picture; if a future ffmpeg
        /// stops honouring `-shortest` here too, this is where it shows up
        /// rather than in a user's thirty-second file.
        #[tokio::test]
        async fn an_unknown_length_still_produces_a_bounded_video() {
            let Some(ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            if !can_encode(&ff, Target::Mp4) || !can_encode(&ff, Target::Mp3) {
                eprintln!("skipping: this ffmpeg is missing an encoder");
                return;
            }

            let dir = std::env::temp_dir().join("yt2mp-convert-unknown-length");
            let _ = std::fs::create_dir_all(&dir);

            let source = dir.join("song.mp3");
            let mut cmd = crate::ytdlp::base_command(ffmpeg());
            cmd.args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=3"])
                .args(["-c:a", "libmp3lame"])
                .arg(&source);
            cmd.output().await.expect("the fixture builds");

            probe(&source).await.expect("the fixture probes");

            let dest = dir.join("unknown.mp4");
            let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);

            // None, deliberately: this is what the caller passes when the
            // row behind it has no duration. The conversion has to recover
            // one rather than generating an endless picture — on the Linux
            // ffmpeg, -shortest does not stop that, and this test failing at
            // 31 seconds is how that was found.
            convert(
                &source,
                &dest,
                Target::Mp4,
                &Options::default(),
                None,
                rx,
                |_, _, _| {},
            )
            .await
            .expect("it converts without being told the length");

            let out = probe(&dest).await.expect("the mp4 probes");
            assert!(out.has_video, "a picture was still generated");
            let length = out.duration.expect("an mp4 reports a duration");
            assert!(
                (length - 3.0).abs() < 1.0,
                "expected the audio's own ~3s, got {length}s"
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

        /// The settings do what they say: trimmed length, turned and
        /// scaled picture, frame rate, codec, sound changes, no sound.
        #[tokio::test]
        async fn settings_change_the_file_the_way_they_say() {
            let Some(_ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            let dir = std::env::temp_dir().join("yt2mp-convert-settings");
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let source = make_fixture(&dir).await.expect("fixture");

            let run = |target: Target, opts: Options, name: &'static str| {
                let source = source.clone();
                let dest = dir.join(name);
                async move {
                    let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);
                    convert(&source, &dest, target, &opts, None, rx, |_, _, _| {})
                        .await
                        .unwrap_or_else(|e| panic!("{name}: {e}"));
                    probe(&dest).await.unwrap()
                }
            };

            let out = run(
                Target::Mp4,
                Options {
                    video_codec: Some(VideoCodec::H265),
                    quality: Quality::Small,
                    height: Some(120),
                    fps: Some(10.0),
                    rotate: Some(90),
                    start: Some(1.0),
                    end: Some(3.0),
                    channels: Some(1),
                    sample_rate: Some(22050),
                    normalize: true,
                    ..Options::default()
                },
                "a.mp4",
            )
            .await;
            assert_eq!(out.video_codec.as_deref(), Some("hevc"));
            // 320x240 turned is 240x320; at most 120 high is 90x120.
            assert_eq!((out.width, out.height), (Some(90), Some(120)));
            let d = out.duration.unwrap();
            assert!((d - 2.0).abs() < 0.3, "trimmed to 2s, got {d}");
            assert!(out.has_audio);

            let out = run(
                Target::Webm,
                Options {
                    video_codec: Some(VideoCodec::Av1),
                    mute: true,
                    ..Options::default()
                },
                "b.webm",
            )
            .await;
            assert_eq!(out.video_codec.as_deref(), Some("av1"));
            assert!(!out.has_audio, "muted");

            let out = run(
                Target::Mov,
                Options {
                    video_codec: Some(VideoCodec::Prores),
                    ..Options::default()
                },
                "c.mov",
            )
            .await;
            assert_eq!(out.video_codec.as_deref(), Some("prores"));

            let out = run(
                Target::Mp3,
                Options {
                    audio_bitrate: Some(64),
                    ..Options::default()
                },
                "d.mp3",
            )
            .await;
            assert_eq!(out.kind, Kind::Audio);
            assert!(
                out.size_bytes.unwrap() < 60_000,
                "64 kbps for 5s is about 40 KB"
            );

            let out = run(
                Target::Png,
                Options {
                    image_size: Some(100),
                    ..Options::default()
                },
                "e.png",
            )
            .await;
            assert_eq!((out.width, out.height), (Some(100), Some(75)));

            // A codec the container can't hold falls back to its usual one.
            let out = run(
                Target::Avi,
                Options {
                    video_codec: Some(VideoCodec::H265),
                    ..Options::default()
                },
                "f.avi",
            )
            .await;
            assert_eq!(out.video_codec.as_deref(), Some("mpeg4"));
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// Every target from every kind of source it is offered for, each
        /// output read back and checked for being the kind of file it claims.
        #[tokio::test]
        async fn every_format_converts_and_reads_back() {
            let Some(_ff) = test_ffmpeg() else {
                eprintln!("skipping: no ffmpeg on this machine");
                return;
            };
            let dir = std::env::temp_dir().join("yt2mp-convert-every");
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();

            let video = make_fixture(&dir).await.expect("video fixture");
            let make = |args: &'static [&'static str], name: &str| {
                let out = dir.join(name);
                async move {
                    let mut cmd = crate::ytdlp::base_command(ffmpeg());
                    cmd.args(["-hide_banner", "-loglevel", "error", "-y"])
                        .args(args)
                        .arg(&out);
                    assert!(
                        cmd.output().await.unwrap().status.success(),
                        "fixture {out:?}"
                    );
                    out
                }
            };
            let audio = make(
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=330:duration=3",
                    "-c:a",
                    "flac",
                ],
                "tone.flac",
            )
            .await;
            let image = make(
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=s=200x120",
                    "-frames:v",
                    "1",
                    "-update",
                    "1",
                ],
                "still.png",
            )
            .await;

            let v = probe(&video).await.unwrap();
            let a = probe(&audio).await.unwrap();
            let i = probe(&image).await.unwrap();
            assert_eq!(v.kind, Kind::Video);
            assert_eq!(a.kind, Kind::Audio);
            assert_eq!(i.kind, Kind::Image);
            assert_eq!((i.width, i.height), (Some(200), Some(120)));
            assert_eq!(v.video_codec.as_deref(), Some("mpeg4"));

            let all = ALL_TARGETS;
            let mut done = 0;
            for (src, info) in [(&video, &v), (&audio, &a), (&image, &i)] {
                for &target in all {
                    if !target.accepts(info.kind, info.has_audio) {
                        continue;
                    }
                    let dest = dir.join(format!(
                        "out-{:?}-{:?}.{}",
                        info.kind,
                        target,
                        target.extension()
                    ));
                    let (_tx, rx) = tokio::sync::watch::channel(crate::ytdlp::Control::Run);
                    let result = convert(
                        src,
                        &dest,
                        target,
                        &Options::default(),
                        info.duration,
                        rx,
                        |_, _, _| {},
                    )
                    .await;
                    // An ffmpeg built without one of the encoders (the CI
                    // runner's has no AMR) says so in these words and only
                    // then; every other failure is a real one.
                    if let Err(e) = &result {
                        if e.starts_with("This copy of the converter can't make") {
                            eprintln!("skipping {target:?}: {e}");
                            done += 1;
                            continue;
                        }
                    }
                    result.unwrap_or_else(|e| panic!("{:?} -> {target:?}: {e}", info.kind));
                    let out = probe(&dest)
                        .await
                        .unwrap_or_else(|e| panic!("{target:?} reads back: {e}"));
                    let expected = if target.is_audio() {
                        Kind::Audio
                    } else if target.is_image()
                        || (info.kind == Kind::Image && target == Target::Gif)
                    {
                        Kind::Image
                    } else {
                        Kind::Video
                    };
                    if target == Target::WebpAnim {
                        // ffmpeg reads WebP as a still picture, animated or not,
                        // and the fixture is one flat colour, which the encoder
                        // rightly stores as a single frame. So: a WebP file.
                        let bytes = std::fs::read(&dest).unwrap();
                        assert!(bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP");
                    } else {
                        assert_eq!(out.kind, expected, "{:?} -> {target:?}", info.kind);
                    }
                    if target.is_video() {
                        assert!(
                            out.has_audio,
                            "{:?} -> {target:?} kept the sound",
                            info.kind
                        );
                    }
                    done += 1;
                }
            }
            // Every target from a video (34), sound to sound or a video with a
            // picture (13 + 4), a picture to a picture or a GIF (7 + 1).
            assert_eq!(done, 34 + 17 + 8);
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
