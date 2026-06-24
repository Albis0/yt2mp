// electron-builder's extraResources special-cases anything named "node_modules"
// (it tries to dependency-tree-prune it instead of copying it verbatim), which
// silently drops most of the standalone Next server's node_modules. Copying it
// here, after packaging, with a plain recursive fs copy sidesteps that entirely.
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const projectRoot = path.join(__dirname, "..");
  const source = path.join(projectRoot, ".next", "standalone");
  const dest = path.join(context.appOutDir, "resources", "standalone");

  fs.cpSync(source, dest, { recursive: true });
  console.log(`[after-pack] Copied standalone server to ${dest}`);

  // .env holds GROQ_KEYS and is gitignored on purpose (push protection blocks
  // commits containing real API keys) — copy it in if present, so AI search
  // works in the packaged app; if it's missing, AI search just falls back to
  // raw ytsearch1 queries instead of failing the whole build.
  const envSource = path.join(projectRoot, ".env");
  const envDest = path.join(context.appOutDir, "resources", ".env");
  if (fs.existsSync(envSource)) {
    fs.copyFileSync(envSource, envDest);
    console.log(`[after-pack] Copied .env to ${envDest}`);
  } else {
    console.log("[after-pack] No .env found — AI search will use the raw query fallback");
  }
};
