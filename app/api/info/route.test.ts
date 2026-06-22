import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const getVideoInfoMock = mock();

mock.module("@/lib/ytdlp", () => ({
  getVideoInfo: getVideoInfoMock,
  isValidYoutubeUrl: (url: string) =>
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=|^https?:\/\/youtu\.be\//.test(url),
}));

const { POST } = await import("./route");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/info", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/info", () => {
  beforeEach(() => {
    getVideoInfoMock.mockReset();
  });
  afterEach(() => {
    getVideoInfoMock.mockReset();
  });

  test("rejects an invalid (non-YouTube) URL with 400", async () => {
    const res = await POST(postRequest({ url: "https://evil.com" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeTruthy();
    expect(getVideoInfoMock).not.toHaveBeenCalled();
  });

  test("rejects a missing url field with 400", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
  });

  test("rejects malformed JSON body with 400", async () => {
    const res = await POST(postRequest("not json"));
    expect(res.status).toBe(400);
  });

  test("returns video info for a valid URL", async () => {
    getVideoInfoMock.mockResolvedValue({
      title: "Some Video",
      thumbnail: "https://i.ytimg.com/vi/x/max.jpg",
      duration: 213,
      uploader: "Some Channel",
      availableHeights: [1080, 720],
    });

    const res = await POST(postRequest({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Some Video");
    expect(data.availableHeights).toEqual([1080, 720]);
  });

  test("returns 502 when getVideoInfo throws", async () => {
    getVideoInfoMock.mockRejectedValue(new Error("yt-dlp exploded"));

    const res = await POST(postRequest({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });
});
