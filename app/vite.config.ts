import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Tauri serves the built frontend from dist/ as static files — there is no
// Node server in the packaged app at all (unlike the Electron build, which
// booted a whole Next standalone server on a local port just to answer its
// own fetches). Everything the UI used to reach over HTTP is now an IPC
// command into Rust.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // Tauri's dev server: fixed port so tauri.conf.json can point at it, and
  // no auto-open since the app window is the browser here.
  server: {
    port: 5173,
    strictPort: true,
    open: false,
    // src-tauri/ is Cargo's territory. Watching it is pointless (nothing in
    // there is served to the browser) and on Windows it is actively harmful:
    // the watcher opens target/debug/deps/*.dll while the linker is still
    // writing them, and Vite dies with EBUSY mid-build.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebView2 (Windows) and WebKitGTK (Linux) both handle modern output;
    // no need to down-level to ES5 the way a public web build would.
    target: "es2022",
    sourcemap: false,
  },
});
