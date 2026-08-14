// Downloads the three binaries the app bundles but does not keep in git:
// yt-dlp (extraction), ffmpeg (merging/encoding), and quickjs (the JS runtime
// yt-dlp needs to solve YouTube's player challenges — without it extraction
// returns only storyboard images).
//
// Usage: bun run fetch:binaries

import { mkdir, writeFile, access, rename, rm, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const IS_WINDOWS = process.platform === "win32";
const OUT_DIR = path.join(ROOT, "src-tauri", "resources");

const exe = (name) => (IS_WINDOWS ? `${name}.exe` : name);

const QUICKJS_VERSION = "v0.16.1";

const targets = [
  {
    name: exe("yt-dlp"),
    url: IS_WINDOWS
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
  },
  {
    name: exe("qjs"),
    url: IS_WINDOWS
      ? `https://github.com/quickjs-ng/quickjs/releases/download/${QUICKJS_VERSION}/qjs-windows-x86_64.exe`
      : `https://github.com/quickjs-ng/quickjs/releases/download/${QUICKJS_VERSION}/qjs-linux-x86_64`,
  },
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
  if (!IS_WINDOWS) {
    const { chmod } = await import("node:fs/promises");
    await chmod(dest, 0o755);
  }
  return buffer.length;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    );
  });
}

// ffmpeg ships as an archive rather than a bare binary, so it needs
// extracting and the one file we want pulling out of it.
async function fetchFfmpeg() {
  const dest = path.join(OUT_DIR, exe("ffmpeg"));
  if (await exists(dest)) {
    console.log(`  ${exe("ffmpeg")} — already present, skipping`);
    return;
  }

  const tmp = path.join(OUT_DIR, IS_WINDOWS ? "_ffmpeg.zip" : "_ffmpeg.tar.xz");
  const url = IS_WINDOWS
    ? "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    : "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";

  console.log(`  ${exe("ffmpeg")} — downloading (this one is large)…`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`ffmpeg → HTTP ${res.status}`);
  await new Promise((resolve, reject) => {
    const file = createWriteStream(tmp);
    res.body.pipeTo(new WritableStream({
      write: (chunk) => new Promise((r) => file.write(chunk, r)),
      close: () => file.end(resolve),
      abort: reject,
    })).catch(reject);
  });

  console.log(`  ${exe("ffmpeg")} — extracting…`);
  if (IS_WINDOWS) {
    // tar has shipped with Windows since build 17063 and handles zip.
    await run("tar", ["-xf", tmp, "-C", OUT_DIR]);
  } else {
    await run("tar", ["-xf", tmp, "-C", OUT_DIR]);
  }

  // Find the extracted ffmpeg binary and move it up to resources/.
  const entries = await readdir(OUT_DIR, { withFileTypes: true });
  const dir = entries.find((e) => e.isDirectory() && e.name.startsWith("ffmpeg"));
  if (!dir) throw new Error("could not find the extracted ffmpeg directory");

  const inner = IS_WINDOWS
    ? path.join(OUT_DIR, dir.name, "bin", "ffmpeg.exe")
    : path.join(OUT_DIR, dir.name, "ffmpeg");

  await rename(inner, dest);
  await rm(path.join(OUT_DIR, dir.name), { recursive: true, force: true });
  await rm(tmp, { force: true });
  if (!IS_WINDOWS) {
    const { chmod } = await import("node:fs/promises");
    await chmod(dest, 0o755);
  }
  console.log(`  ${exe("ffmpeg")} — done`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Fetching binaries into ${OUT_DIR}\n`);

  for (const target of targets) {
    const dest = path.join(OUT_DIR, target.name);
    if (await exists(dest)) {
      console.log(`  ${target.name} — already present, skipping`);
      continue;
    }
    console.log(`  ${target.name} — downloading…`);
    const bytes = await download(target.url, dest);
    console.log(`  ${target.name} — done (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }

  await fetchFfmpeg();
  console.log("\nAll binaries ready.");
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
