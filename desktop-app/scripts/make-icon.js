// Generates build/icon.ico (multi-resolution) from assets/icon.png so
// electron-builder can brand the .exe, installer, and shortcuts. Windows .ico
// files embed several sizes; we render each with sharp, then pack them with
// png-to-ico.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const root = path.join(__dirname, "..");
const src = path.join(root, "assets", "icon.png");
const outDir = path.join(root, "build");
const outIco = path.join(outDir, "icon.ico");

const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(src)) {
    throw new Error(`Source icon not found at ${src}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(src).resize(size, size, { fit: "cover" }).png().toBuffer()
    )
  );

  const ico = await pngToIco(buffers);
  fs.writeFileSync(outIco, ico);

  // Also write a 512px PNG — electron-builder uses it as a fallback/source.
  await sharp(src).resize(512, 512, { fit: "cover" }).png().toFile(
    path.join(outDir, "icon.png")
  );

  console.log(`Wrote ${outIco} (${(ico.length / 1024).toFixed(1)} KB) and build/icon.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
