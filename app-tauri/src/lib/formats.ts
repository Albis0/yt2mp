// The converter's formats, as the UI lists them. Mirrors `Target` in
// src-tauri/src/convert.rs; Rust checks everything again before converting.

import type { ConvertTarget, FileKind, SourceInfo, VideoCodec } from "@/lib/api";

export interface Format {
  id: ConvertTarget;
  label: string;
  hint: string;
}

export interface FormatGroup {
  id: "video" | "animation" | "audio" | "image";
  title: string;
  formats: Format[];
}

export const GROUPS: FormatGroup[] = [
  {
    id: "video",
    title: "Video",
    formats: [
      { id: "mp4", label: "MP4", hint: "Plays everywhere" },
      { id: "mkv", label: "MKV", hint: "Keeps every track" },
      { id: "webm", label: "WebM", hint: "For the web" },
      { id: "mov", label: "MOV", hint: "Apple and editing" },
      { id: "avi", label: "AVI", hint: "Older players, TVs" },
      { id: "ts", label: "TS", hint: "Broadcast, streams" },
      { id: "mpg", label: "MPEG", hint: "DVD-era MPEG-2" },
      { id: "wmv", label: "WMV", hint: "Old Windows players" },
      { id: "flv", label: "FLV", hint: "Old Flash players" },
      { id: "3gp", label: "3GP", hint: "Old phones" },
      { id: "ogv", label: "OGV", hint: "Open, Theora" },
    ],
  },
  {
    id: "animation",
    title: "Animation",
    formats: [
      { id: "gif", label: "GIF", hint: "Loops, no sound" },
      { id: "webpanim", label: "WebP", hint: "Animated, small" },
      { id: "apng", label: "APNG", hint: "Better colours" },
    ],
  },
  {
    id: "audio",
    title: "Audio",
    formats: [
      { id: "mp3", label: "MP3", hint: "Plays everywhere" },
      { id: "m4a", label: "M4A", hint: "Apple, small" },
      { id: "wav", label: "WAV", hint: "Uncompressed" },
      { id: "flac", label: "FLAC", hint: "Lossless" },
      { id: "alac", label: "ALAC", hint: "Apple lossless" },
      { id: "opus", label: "Opus", hint: "Smallest" },
      { id: "ogg", label: "OGG", hint: "Open, Vorbis" },
      { id: "aac", label: "AAC", hint: "Raw AAC" },
      { id: "wma", label: "WMA", hint: "Windows Media" },
      { id: "aiff", label: "AIFF", hint: "Mac uncompressed" },
      { id: "ac3", label: "AC3", hint: "Dolby Digital" },
      { id: "mp2", label: "MP2", hint: "Broadcast" },
      { id: "amr", label: "AMR", hint: "Phone voice" },
    ],
  },
  {
    id: "image",
    title: "Image",
    formats: [
      { id: "png", label: "PNG", hint: "Lossless" },
      { id: "jpg", label: "JPG", hint: "Photos, small" },
      { id: "webp", label: "WebP", hint: "Web, smaller" },
      { id: "avif", label: "AVIF", hint: "Smallest" },
      { id: "bmp", label: "BMP", hint: "Uncompressed" },
      { id: "tiff", label: "TIFF", hint: "Print, archives" },
      { id: "ico", label: "ICO", hint: "Windows icon" },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.formats);
const inGroup = (id: FormatGroup["id"]) =>
  new Set(GROUPS.find((g) => g.id === id)!.formats.map((f) => f.id));
const VIDEO = inGroup("video");
const AUDIO = inGroup("audio");
const IMAGE = inGroup("image");
const ANIMATION = inGroup("animation");

export function formatHint(id: ConvertTarget): string {
  return ALL.find((x) => x.id === id)!.hint;
}

export function formatLabel(id: ConvertTarget): string {
  const f = ALL.find((x) => x.id === id)!;
  return id === "webpanim" ? "Animated WebP" : f.label;
}

export const isVideo = (t: ConvertTarget) => VIDEO.has(t);
export const isAudio = (t: ConvertTarget) => AUDIO.has(t);
export const isImage = (t: ConvertTarget) => IMAGE.has(t);
export const isAnimation = (t: ConvertTarget) => ANIMATION.has(t);

/// What a file can become. Mirrors `Target::accepts`.
export function accepts(target: ConvertTarget, file: SourceInfo): boolean {
  if (file.kind === "video") return !AUDIO.has(target) || file.hasAudio;
  if (file.kind === "audio")
    return AUDIO.has(target) || ["mp4", "mkv", "mov", "webm"].includes(target);
  return IMAGE.has(target) || target === "gif";
}

/// Whether picking `target` for the whole list should change this file.
/// Everything it can become, except the two odd ones that need picking on
/// purpose: a still from a video, and a video made from a song.
export function natural(target: ConvertTarget, file: SourceInfo): boolean {
  if (!accepts(target, file)) return false;
  if (file.kind === "video" && IMAGE.has(target)) return false;
  if (file.kind === "audio" && VIDEO.has(target)) return false;
  return true;
}

/// The hint, adjusted where the same format means something different for
/// this file.
export function hintFor(format: Format, kind: FileKind | null): string {
  if (kind === "audio" && VIDEO.has(format.id)) return "With a black picture";
  if (kind === "video" && IMAGE.has(format.id)) return "A still from the video";
  return format.hint;
}

/// Groups in the order a file of `kind` wants them: its own kind first.
export function groupsFor(kind: FileKind | null): FormatGroup[] {
  const own: Record<FileKind, FormatGroup["id"]> = { video: "video", audio: "audio", image: "image" };
  if (!kind) return GROUPS;
  return [...GROUPS].sort((a, b) => Number(b.id === own[kind]) - Number(a.id === own[kind]));
}

/// The format a new file starts on: the first one it can become that isn't
/// what it already is.
export function firstPick(file: SourceInfo): ConvertTarget | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const same = (id: ConvertTarget) => id === ext || (id === "jpg" && ext === "jpeg") || (id === "mpg" && ext === "mpeg");
  const offered = groupsFor(file.kind)
    .flatMap((g) => g.formats)
    .filter((f) => accepts(f.id, file));
  return (offered.find((f) => !same(f.id)) ?? offered[0])?.id ?? null;
}

export const CODEC_LABELS: Record<VideoCodec, string> = {
  h264: "H.264",
  h265: "H.265 (HEVC)",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  prores: "ProRes",
  mpeg4: "MPEG-4",
  wmv2: "WMV",
  mpeg2: "MPEG-2",
  theora: "Theora",
};

/// Picture codecs a container can hold, its usual one first. Mirrors
/// `Target::video_codecs`.
export function videoCodecs(target: ConvertTarget): VideoCodec[] {
  switch (target) {
    case "mp4":
      return ["h264", "h265", "av1"];
    case "mkv":
      return ["h264", "h265", "av1", "vp9"];
    case "webm":
      return ["vp9", "av1", "vp8"];
    case "mov":
      return ["h264", "h265", "prores"];
    case "ts":
      return ["h264", "h265"];
    default:
      return [];
  }
}

const STREAM_NAMES: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  prores: "ProRes",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  alac: "ALAC",
  pcm_s16le: "PCM",
  pcm_s24le: "PCM",
  ac3: "AC3",
  png: "PNG",
  mjpeg: "JPEG",
  webp: "WebP",
  gif: "GIF",
  bmp: "BMP",
  tiff: "TIFF",
};

export function codecName(codec: string | null): string | null {
  if (!codec) return null;
  return STREAM_NAMES[codec] ?? codec.toUpperCase();
}
