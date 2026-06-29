// If ELECTRON_RUN_AS_NODE is set in the user's environment (it can get left
// behind by dev tooling and persists at User scope on Windows), double-clicking
// the .exe launches it as plain Node instead of the Electron runtime — no
// window ever appears and the process exits silently. Detect that here, before
// importing anything from "electron" (which would just be a path string in node
// mode), and relaunch ourselves with the variable stripped so the real Electron
// runtime takes over.
if (process.env.ELECTRON_RUN_AS_NODE) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("child_process") as typeof import("child_process");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // In a packaged app process.argv is [exe, mainScript, ...]; in `electron .`
  // dev mode it's [electron.exe, ".", ...]. Re-pass argv[1:] so both relaunch
  // the same entry point, just with the env var stripped. Detach + unref so we
  // can exit immediately and let the real Electron process own the window.
  const child = cp.spawn(process.execPath, process.argv.slice(1), {
    env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  process.exit(0);
}

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import { Readable } from "stream";
import type { StartDownloadArgs } from "./preload";

// On some Windows GPU drivers an Electron window reports visible=true but
// paints nothing (blank/black/invisible) because GPU compositing fails. Forcing
// software rendering avoids that whole class of "window opens but you can't see
// it" bugs, at a negligible cost for a tiny UI like this.
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let logFile = "";

// Tracks in-flight downloads by the id the renderer generates, so
// cancel/pause/stop can act on the right fetch/write pair when multiple
// downloads (e.g. two playlist tracks) are running at once.
interface ActiveDownload {
  abort: AbortController;
  writeStream: fs.WriteStream;
  filePath: string;
  // Pause holds incoming bytes here instead of writing them, without killing
  // the underlying fetch/yt-dlp pipeline — resume just flushes and continues.
  paused: boolean;
  pendingChunks: Buffer[];
  nodeStream?: Readable;
}
const activeDownloads = new Map<string, ActiveDownload>();

// __dirname at runtime is electron/dist (this file is compiled there), so
// the project root (where resources/ and .next/ live) is two levels up.
const PROJECT_ROOT = path.join(__dirname, "..", "..");

function log(message: string) {
  console.log(message);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // best-effort logging only
  }
}

// yt-dlp/ffmpeg ship as .exe on Windows and as plain ELF binaries on Linux.
// Resolve the platform-correct name so the same code spawns the right file.
function binaryName(base: "yt-dlp" | "ffmpeg"): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function resourcePath(fileName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(PROJECT_ROOT, "resources", fileName);
}

// extraResources copies files without preserving the executable bit, so on
// Linux/macOS the bundled binaries land as non-executable and spawn fails with
// EACCES. Restore +x best-effort; a no-op on Windows.
function ensureExecutable(filePath: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (err) {
    log(`[chmod] could not mark ${filePath} executable: ${(err as Error).message}`);
  }
}

// Reads GROQ_KEYS=a,b,c out of a .env file next to the binaries (packaged) or
// the project root (dev) — keeping it out of source so it never ends up in a
// commit. Missing file just means AI search falls back to the raw query.
function loadGroqKeys(): string {
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, ".env")
    : path.join(PROJECT_ROOT, ".env.local");
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/^GROQ_KEYS=(.*)$/m);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

// Ask the OS for a free port by binding to :0, then releasing it. Avoids a
// third-party dependency (which got pruned out of the asar at package time).
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine a free port")));
      }
    });
  });
}

function standaloneServerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(PROJECT_ROOT, ".next", "standalone", "server.js");
}

async function startNextServer(): Promise<number> {
  const serverPath = standaloneServerPath();
  const ytdlpPath = resourcePath(binaryName("yt-dlp"));
  const ffmpegPath = resourcePath(binaryName("ffmpeg"));
  log(`Starting Next server from ${serverPath}`);
  log(`yt-dlp: ${ytdlpPath}`);
  log(`ffmpeg: ${ffmpegPath}`);
  ensureExecutable(ytdlpPath);
  ensureExecutable(ffmpegPath);

  if (!fs.existsSync(serverPath)) {
    throw new Error(`server.js not found at ${serverPath}`);
  }

  const port = await findFreePort();
  log(`Using port ${port}`);

  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ELECTRON_RUN_AS_NODE: "1",
      YTDLP_PATH: ytdlpPath,
      FFMPEG_PATH: ffmpegPath,
      GROQ_KEYS: loadGroqKeys(),
    },
    windowsHide: true,
  });

  serverProcess.stdout?.on("data", (chunk) => {
    log(`[next stdout] ${chunk.toString().trim()}`);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    log(`[next stderr] ${chunk.toString().trim()}`);
  });
  serverProcess.on("error", (err) => {
    log(`[next spawn error] ${err.message}`);
  });
  serverProcess.on("exit", (code, signal) => {
    log(`[next exit] code=${code} signal=${signal}`);
  });

  await waitForServer(port);
  serverPort = port;
  return port;
}

async function waitForServer(port: number, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Start polling fast (the common case — server binds in well under a
  // second) and back off multiplicatively so a slow start doesn't burn CPU
  // in a tight 250ms loop for the full 20s deadline.
  let delay = 50;
  const maxDelay = 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      if (res.ok || res.status === 404) return;
    } catch {
      // server not ready yet, keep polling
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }
  throw new Error("Next server did not become ready in time");
}

// Mirrors app/api/download/route.ts's safeFileName so the Save dialog's
// suggested name matches what the old auto-saved filename would have been.
function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, "");

  if (cleaned) return cleaned;

  const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");
  return `yt2mp-${stamp}`;
}

function buildDownloadUrl(args: StartDownloadArgs, id: string): string {
  const params = new URLSearchParams({ url: args.url, format: args.format, id });
  if (args.quality) params.set("quality", String(args.quality));
  if (args.title) params.set("title", args.title);
  return `http://127.0.0.1:${serverPort}/api/download?${params.toString()}`;
}

// MP4 downloads don't emit response bytes until yt-dlp's temp-file
// download/merge finishes server-side, so the only way to show real
// progress during that wait is to poll the same id against
// /api/download-progress, which app/api/download/route.ts writes yt-dlp's
// stdout-parsed percentage into while it's working.
function pollMp4Progress(id: string, event: Electron.IpcMainInvokeEvent): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/download-progress?id=${id}`);
      const data = await res.json();
      if (typeof data.percent === "number") {
        event.sender.send("download:progress", {
          id,
          receivedBytes: 0,
          totalBytes: null,
          mergePercent: data.percent,
        });
      }
    } catch {
      // best-effort — a missed poll just means one stale progress update
    }
  }, 500);
}

function registerDownloadHandlers() {
  ipcMain.handle(
    "download:start",
    async (event, id: string, args: StartDownloadArgs) => {
      const ext = args.format === "mp3" ? "mp3" : "mp4";
      const defaultName = `${safeFileName(args.title || "yt2mp")}.${ext}`;

      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath("downloads"), defaultName),
      });
      if (canceled || !filePath) {
        throw new Error("Save cancelled");
      }

      const abort = new AbortController();
      const downloadUrl = buildDownloadUrl(args, id);
      log(`download:start url=${downloadUrl}`);

      // MP4's response doesn't start streaming until yt-dlp's temp-file
      // download/merge is done, so poll the merge progress in parallel with
      // the fetch instead of waiting for it to resolve first.
      const progressTimer = args.format === "mp4" ? pollMp4Progress(id, event) : null;

      let res: Response;
      try {
        res = await fetch(downloadUrl, { signal: abort.signal });
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        log(`download:start failed status=${res.status} body=${body}`);
        throw new Error(`Download failed (${res.status})`);
      }

      const lenHeader = res.headers.get("Content-Length");
      const totalBytes = lenHeader ? parseInt(lenHeader, 10) : null;

      const writeStream = fs.createWriteStream(filePath);
      const entry: ActiveDownload = {
        abort,
        writeStream,
        filePath,
        paused: false,
        pendingChunks: [],
      };
      activeDownloads.set(id, entry);

      let received = 0;
      const nodeStream = Readable.fromWeb(
        res.body as unknown as import("stream/web").ReadableStream<Uint8Array>
      );
      entry.nodeStream = nodeStream;

      // Driving the pipe manually (instead of nodeStream.pipe(writeStream))
      // is what makes pause possible: while paused, chunks are held in
      // pendingChunks and the readable side is paused too, instead of
      // letting Node's automatic backpressure handling write straight
      // through.
      nodeStream.on("data", (chunk: Buffer) => {
        received += chunk.length;
        event.sender.send("download:progress", { id, receivedBytes: received, totalBytes });
        if (entry.paused) {
          entry.pendingChunks.push(chunk);
          nodeStream.pause();
        } else {
          writeStream.write(chunk);
        }
      });

      try {
        await new Promise<void>((resolve, reject) => {
          nodeStream.on("end", () => writeStream.end());
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          nodeStream.on("error", reject);
        });
      } catch (err) {
        activeDownloads.delete(id);
        // Clean up a partial file rather than leaving a corrupt download behind.
        fs.unlink(filePath, () => {});
        throw err;
      }

      activeDownloads.delete(id);
      return { filePath };
    }
  );

  ipcMain.on("download:cancel", (_event, id: string) => {
    const entry = activeDownloads.get(id);
    if (!entry) return;
    entry.abort.abort();
    entry.writeStream.destroy();
    fs.unlink(entry.filePath, () => {});
    activeDownloads.delete(id);
  });

  ipcMain.on("download:pause", (_event, id: string) => {
    const entry = activeDownloads.get(id);
    if (entry) entry.paused = true;
  });

  ipcMain.on("download:resume", (_event, id: string) => {
    const entry = activeDownloads.get(id);
    if (!entry || !entry.paused) return;
    entry.paused = false;
    for (const chunk of entry.pendingChunks) {
      entry.writeStream.write(chunk);
    }
    entry.pendingChunks = [];
    entry.nodeStream?.resume();
  });

  // Stop actually kills the connection (unlike pause, which keeps it alive).
  // Reuses the same cleanup as cancel.
  ipcMain.on("download:stop", (_event, id: string) => {
    const entry = activeDownloads.get(id);
    if (!entry) return;
    entry.abort.abort();
    entry.writeStream.destroy();
    fs.unlink(entry.filePath, () => {});
    activeDownloads.delete(id);
  });
}

async function createWindow() {
  logFile = path.join(app.getPath("userData"), "main.log");
  log("App ready, starting up...");

  try {
    const port = await startNextServer();

    mainWindow = new BrowserWindow({
      width: 900,
      height: 720,
      center: true,
      backgroundColor: "#ffffff",
      // Show immediately so the window is never invisible while we wait on
      // events. We still re-center/focus once content is ready below.
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
    });

    mainWindow.webContents.on("dom-ready", () => log("webContents dom-ready"));
    mainWindow.webContents.on("did-finish-load", () =>
      log("webContents did-finish-load")
    );

    mainWindow.once("ready-to-show", () => {
      log("Window ready-to-show, presenting");
      mainWindow?.show();
      mainWindow?.center();
      mainWindow?.focus();
    });

    // Fallback: if ready-to-show never fires (e.g. load stalls), force-show
    // after a short delay so the user is never stuck staring at nothing.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        log("ready-to-show timeout — force showing window");
        mainWindow.show();
        mainWindow.center();
        mainWindow.focus();
      }
    }, 4000);

    mainWindow.webContents.on(
      "did-fail-load",
      (_e, errorCode, errorDescription, validatedURL) => {
        log(`did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
      }
    );

    log(`Loading URL http://127.0.0.1:${port}`);
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Fatal startup error: ${message}`);
    dialog.showErrorBox("yt2mp failed to start", `${message}\n\nLog file: ${logFile}`);
    app.quit();
  }
}

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.stack || err.message}`);
});

registerDownloadHandlers();
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
  for (const entry of activeDownloads.values()) {
    entry.abort.abort();
    entry.writeStream.destroy();
  }
});
