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

import { app, BrowserWindow, dialog } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";

// On some Windows GPU drivers an Electron window reports visible=true but
// paints nothing (blank/black/invisible) because GPU compositing fails. Forcing
// software rendering avoids that whole class of "window opens but you can't see
// it" bugs, at a negligible cost for a tiny UI like this.
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let logFile = "";

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

function resourcePath(fileName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(PROJECT_ROOT, "resources", fileName);
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
  log(`Starting Next server from ${serverPath}`);
  log(`yt-dlp: ${resourcePath("yt-dlp.exe")}`);
  log(`ffmpeg: ${resourcePath("ffmpeg.exe")}`);

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
      YTDLP_PATH: resourcePath("yt-dlp.exe"),
      FFMPEG_PATH: resourcePath("ffmpeg.exe"),
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
  return port;
}

async function waitForServer(port: number, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      if (res.ok || res.status === 404) return;
    } catch {
      // server not ready yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Next server did not become ready in time");
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
});
