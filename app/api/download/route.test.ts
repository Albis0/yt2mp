import { describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { Readable } from "stream";
import { EventEmitter } from "events";

function fakeProc(chunks: string[]) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: () => void;
  };
  proc.stdout = Readable.from(chunks.map((c) => Buffer.from(c)));
  proc.stderr = Readable.from([]);
  proc.kill = mock();
  return proc;
}

const spawnMp3StreamMock = mock();
const spawnMp4StreamMock = mock();

mock.module("@/lib/ytdlp", () => ({
  isValidYoutubeUrl: (url: string) =>
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=|^https?:\/\/youtu\.be\//.test(url),
  spawnMp3Stream: spawnMp3StreamMock,
  spawnMp4Stream: spawnMp4StreamMock,
}));

const { GET } = await import("./route");

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/download?${query}`);
}

describe("GET /api/download", () => {
  test("rejects an invalid YouTube URL with 400", async () => {
    const res = await GET(getRequest("url=https://evil.com&format=mp3"));
    expect(res.status).toBe(400);
  });

  test("rejects a missing url with 400", async () => {
    const res = await GET(getRequest("format=mp3"));
    expect(res.status).toBe(400);
  });

  test("rejects an unsupported format with 400", async () => {
    const res = await GET(
      getRequest("url=https://youtu.be/abc&format=wav")
    );
    expect(res.status).toBe(400);
  });

  test("streams mp3 audio with the correct headers", async () => {
    spawnMp3StreamMock.mockReturnValue(fakeProc(["fake-mp3-bytes"]));

    const res = await GET(getRequest("url=https://youtu.be/abc&format=mp3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Content-Disposition")).toContain("download.mp3");

    const body = await res.text();
    expect(body).toBe("fake-mp3-bytes");
    expect(spawnMp3StreamMock).toHaveBeenCalledWith("https://youtu.be/abc");
  });

  test("streams mp4 video with the correct headers and forwards quality", async () => {
    spawnMp4StreamMock.mockReturnValue(fakeProc(["fake-mp4-bytes"]));

    const res = await GET(
      getRequest("url=https://youtu.be/abc&format=mp4&quality=360")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Disposition")).toContain("download.mp4");

    const body = await res.text();
    expect(body).toBe("fake-mp4-bytes");
    expect(spawnMp4StreamMock).toHaveBeenCalledWith("https://youtu.be/abc", "360");
  });
});
