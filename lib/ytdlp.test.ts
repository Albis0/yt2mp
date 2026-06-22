import { describe, expect, test } from "bun:test";
import {
  buildYtDlpAudioArgs,
  buildYtDlpVideoArgs,
  extractAvailableHeights,
  isValidYoutubeUrl,
  parseVideoInfo,
  type VideoFormat,
} from "./ytdlp";

describe("isValidYoutubeUrl", () => {
  test("accepts standard watch URLs", () => {
    expect(isValidYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  test("accepts youtu.be short links", () => {
    expect(isValidYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  test("accepts youtu.be links with tracking query params", () => {
    expect(isValidYoutubeUrl("https://youtu.be/lhfs1CzzUPM?si=l7OLzg9jNS4KHKSk")).toBe(true);
  });

  test("accepts shorts links", () => {
    expect(isValidYoutubeUrl("https://www.youtube.com/shorts/abc123")).toBe(true);
  });

  test("accepts mobile (m.) subdomain", () => {
    expect(isValidYoutubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  test("rejects non-YouTube domains", () => {
    expect(isValidYoutubeUrl("https://evil.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  test("rejects a bare domain with no video id", () => {
    expect(isValidYoutubeUrl("https://www.youtube.com/")).toBe(false);
  });

  test("rejects non-URL strings", () => {
    expect(isValidYoutubeUrl("not a url")).toBe(false);
  });

  test("rejects javascript: pseudo-protocol", () => {
    expect(isValidYoutubeUrl("javascript:alert(1)")).toBe(false);
  });

  test("rejects lookalike domains (youtube.com.evil.com)", () => {
    expect(isValidYoutubeUrl("https://youtube.com.evil.com/watch?v=x")).toBe(false);
  });
});

describe("extractAvailableHeights", () => {
  test("collects unique heights from video formats, sorted descending", () => {
    const formats: VideoFormat[] = [
      { format_id: "1", ext: "mp4", height: 360, vcodec: "avc1" },
      { format_id: "2", ext: "mp4", height: 1080, vcodec: "avc1" },
      { format_id: "3", ext: "mp4", height: 720, vcodec: "avc1" },
      { format_id: "4", ext: "mp4", height: 720, vcodec: "avc1" },
    ];
    expect(extractAvailableHeights(formats)).toEqual([1080, 720, 360]);
  });

  test("ignores audio-only formats (vcodec none)", () => {
    const formats: VideoFormat[] = [
      { format_id: "1", ext: "m4a", height: undefined, vcodec: "none", acodec: "mp4a" },
      { format_id: "2", ext: "mp4", height: 480, vcodec: "avc1" },
    ];
    expect(extractAvailableHeights(formats)).toEqual([480]);
  });

  test("ignores formats with no height", () => {
    const formats: VideoFormat[] = [{ format_id: "1", ext: "mp4", vcodec: "avc1" }];
    expect(extractAvailableHeights(formats)).toEqual([]);
  });

  test("returns an empty array for no formats", () => {
    expect(extractAvailableHeights([])).toEqual([]);
  });
});

describe("parseVideoInfo", () => {
  test("extracts title, thumbnail, duration, uploader and heights", () => {
    const raw = JSON.stringify({
      title: "Some Video",
      thumbnail: "https://i.ytimg.com/vi/x/max.jpg",
      duration: 213,
      uploader: "Some Channel",
      formats: [
        { format_id: "1", ext: "mp4", height: 720, vcodec: "avc1" },
        { format_id: "2", ext: "m4a", vcodec: "none" },
      ],
    });

    expect(parseVideoInfo(raw)).toEqual({
      title: "Some Video",
      thumbnail: "https://i.ytimg.com/vi/x/max.jpg",
      duration: 213,
      uploader: "Some Channel",
      availableHeights: [720],
    });
  });

  test("falls back to defaults when fields are missing", () => {
    const raw = JSON.stringify({});

    expect(parseVideoInfo(raw)).toEqual({
      title: "Unknown video",
      thumbnail: "",
      duration: 0,
      uploader: "",
      availableHeights: [],
    });
  });

  test("throws on invalid JSON", () => {
    expect(() => parseVideoInfo("not json")).toThrow();
  });
});

describe("buildYtDlpAudioArgs", () => {
  test("requests bestaudio and streams to stdout", () => {
    const args = buildYtDlpAudioArgs("https://youtu.be/abc");
    expect(args).toContain("-f");
    expect(args).toContain("bestaudio");
    expect(args).toContain("--no-playlist");
    expect(args.at(-1)).toBe("https://youtu.be/abc");
    expect(args).toContain("-o");
  });

  test("includes the bun js-runtime and ejs remote-component flags", () => {
    const args = buildYtDlpAudioArgs("https://youtu.be/abc");
    expect(args).toContain("--js-runtimes");
    expect(args).toContain("bun:/usr/local/bin/bun");
    expect(args).toContain("--remote-components");
    expect(args).toContain("ejs:github");
  });

  test("omits --cookies when COOKIES_FILE is not set", () => {
    delete process.env.COOKIES_FILE;
    const args = buildYtDlpAudioArgs("https://youtu.be/abc");
    expect(args).not.toContain("--cookies");
  });

  test("includes --cookies when COOKIES_FILE is set", () => {
    process.env.COOKIES_FILE = "/tmp/cookies.txt";
    const args = buildYtDlpAudioArgs("https://youtu.be/abc");
    expect(args).toContain("--cookies");
    expect(args).toContain("/tmp/cookies.txt");
    delete process.env.COOKIES_FILE;
  });
});

describe("buildYtDlpVideoArgs", () => {
  test("defaults to best mp4 when no quality is given", () => {
    const args = buildYtDlpVideoArgs("https://youtu.be/abc");
    const formatIndex = args.indexOf("-f");
    expect(args[formatIndex + 1]).toBe("best[ext=mp4]/best");
  });

  test("constrains to the requested height when quality is given", () => {
    const args = buildYtDlpVideoArgs("https://youtu.be/abc", "360");
    const formatIndex = args.indexOf("-f");
    expect(args[formatIndex + 1]).toBe(
      "best[height<=360][ext=mp4]/best[height<=360]"
    );
  });

  test("falls back to default selector for a non-numeric quality", () => {
    const args = buildYtDlpVideoArgs("https://youtu.be/abc", "not-a-number");
    const formatIndex = args.indexOf("-f");
    expect(args[formatIndex + 1]).toBe("best[ext=mp4]/best");
  });

  test("requests a single pre-muxed stream (no separate merge)", () => {
    const args = buildYtDlpVideoArgs("https://youtu.be/abc", "1080");
    expect(args).not.toContain("--merge-output-format");
  });
});
