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
};
