// Narrow, typed bridge between the renderer and main process — exposes only
// the three methods download.ts needs, never raw ipcRenderer/fs, so the
// renderer can't reach arbitrary IPC channels even with contextIsolation off.
import { contextBridge, ipcRenderer } from "electron";

export interface StartDownloadArgs {
  url: string;
  format: "mp3" | "mp4";
  quality?: number;
  title: string;
}

export interface DownloadProgressEvent {
  id: string;
  receivedBytes: number;
  totalBytes: number | null;
}

contextBridge.exposeInMainWorld("yt2mp", {
  startDownload: (id: string, args: StartDownloadArgs): Promise<{ filePath: string }> =>
    ipcRenderer.invoke("download:start", id, args),

  onDownloadProgress: (callback: (p: DownloadProgressEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: DownloadProgressEvent) => callback(payload);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.removeListener("download:progress", listener);
  },

  cancelDownload: (id: string): void => {
    ipcRenderer.send("download:cancel", id);
  },

  // Pause: holds incoming bytes in memory and stops writing, but keeps the
  // underlying fetch/yt-dlp pipeline alive — cheap, near-instant resume.
  pauseDownload: (id: string): void => {
    ipcRenderer.send("download:pause", id);
  },
  resumeDownload: (id: string): void => {
    ipcRenderer.send("download:resume", id);
  },

  // Stop: actually kills the in-flight fetch and deletes the partial file.
  // There's no byte-offset resume here (yt-dlp/ffmpeg re-transcode from
  // scratch every run), so "resuming" a stopped download means starting over.
  stopDownload: (id: string): void => {
    ipcRenderer.send("download:stop", id);
  },
});
