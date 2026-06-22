// Next.js standalone output doesn't include .next/static or public/ —
// the server needs them copied in manually for static assets to resolve.
// https://nextjs.org/docs/app/api-reference/config/next-config-js/output
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standaloneRoot = path.join(root, ".next", "standalone");

fs.cpSync(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"), {
  recursive: true,
});

if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(standaloneRoot, "public"), {
    recursive: true,
  });
}

// Next 16's standalone file tracer misses some Turbopack runtime files —
// notably app-route-turbo.runtime.prod.js, which API routes require at runtime.
// Copy the whole compiled/next-server dir so none are missing.
const nextServerSrc = path.join(root, "node_modules", "next", "dist", "compiled", "next-server");
const nextServerDest = path.join(
  standaloneRoot,
  "node_modules",
  "next",
  "dist",
  "compiled",
  "next-server"
);
if (fs.existsSync(nextServerSrc)) {
  fs.cpSync(nextServerSrc, nextServerDest, { recursive: true });
}

console.log("Copied .next/static, public/, and next-server runtimes into the standalone output.");
