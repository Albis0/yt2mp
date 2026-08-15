// Bumps the version everywhere at once.
//
//   bun scripts/version.mjs 0.6.1
//   bun scripts/version.mjs            # prints what each file currently says
//
// The version used to live in four files that were edited by hand, and they
// had already drifted: the site said 0.4.0 while the app said 0.5.0. That is
// harmless until an updater exists — then a wrong number means the app either
// re-offers an update forever or never offers one at all.
//
// tauri.conf.json is not in the list below: it reads "../package.json"
// directly, so the Tauri bundler picks up app-tauri/package.json on its own.
//
// RULE: bump the patch digit only. A release is 0.7.1, then 0.7.2 — never
// 0.8.0, no matter how large the change feels. The project reached 0.7.0 by
// minor-bumping ordinary fixes, which made the number meaningless. Only the
// repo owner decides a minor or major bump; this script refuses to make one
// unless it is told to explicitly with --minor / --major.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

// Each entry names one file, a regex that captures the version, and how to put
// a new one back. The regexes are deliberately narrow — `[package]` in
// Cargo.toml is matched by its section header so a dependency's version is
// never rewritten by accident.
const TARGETS = [
  {
    file: "app-tauri/package.json",
    find: /("version"\s*:\s*")([^"]+)(")/,
    what: "Tauri app package.json (also feeds tauri.conf.json)",
  },
  {
    file: "app-tauri/src-tauri/Cargo.toml",
    // Anchored to the [package] table: `\[package\]` then the first `version =`
    // that follows. Dependency versions live under other tables and are safe.
    find: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
    what: "Rust crate",
  },
  {
    file: "package.json",
    find: /("version"\s*:\s*")([^"]+)(")/,
    what: "landing site package.json",
  },
  {
    file: "lib/site.ts",
    find: /(export const VERSION\s*=\s*")([^"]+)(")/,
    what: "landing site (everything else on the page derives from this)",
  },
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function read(rel) {
  return readFile(path.join(ROOT, rel), "utf8");
}

// True when `next` is exactly one patch step above `current` — the only jump
// allowed without an explicit override.
function isPatchStep(current, next) {
  const c = current.split("-")[0].split(".").map(Number);
  const n = next.split("-")[0].split(".").map(Number);
  if (c.length !== 3 || n.length !== 3 || [...c, ...n].some(Number.isNaN)) return false;
  return n[0] === c[0] && n[1] === c[1] && n[2] === c[2] + 1;
}

async function main() {
  const args = process.argv.slice(2);
  const forced = args.includes("--minor") || args.includes("--major");
  const next = args.find((a) => !a.startsWith("--"));

  // No argument: report rather than change anything. Useful on its own for
  // checking whether the files have drifted apart again.
  if (!next) {
    console.log("Current versions:\n");
    let seen = null;
    let drifted = false;
    for (const t of TARGETS) {
      const body = await read(t.file);
      const m = body.match(t.find);
      const found = m ? m[2] : "(not found)";
      if (seen === null) seen = found;
      else if (found !== seen) drifted = true;
      console.log(`  ${found.padEnd(12)} ${t.file}`);
    }
    console.log(
      drifted
        ? "\nThese do not agree. Run this script with a version to sync them."
        : "\nAll in sync."
    );
    process.exit(drifted ? 1 : 0);
  }

  if (!SEMVER.test(next)) {
    console.error(`"${next}" is not a version like 1.2.3 or 1.2.3-rc1.`);
    process.exit(1);
  }

  // Read and match everything before writing anything: a half-applied bump is
  // worse than a failed one, because the next run would report "in sync"
  // against a version only some files carry.
  const edits = [];
  for (const t of TARGETS) {
    const body = await read(t.file);
    const m = body.match(t.find);
    if (!m) {
      console.error(`Could not find the version in ${t.file} — nothing written.`);
      process.exit(1);
    }
    edits.push({ ...t, body, from: m[2], next: body.replace(t.find, `$1${next}$3`) });
  }

  // Refuse anything but a single patch step. Checked against the app's own
  // version, after every file has been read, so a rejected bump writes nothing.
  const current = edits[0].from;
  if (!forced && current !== next && !isPatchStep(current, next)) {
    console.error(`Refusing ${current} → ${next}: only patch bumps are automatic.`);
    console.error(`The next release is ${current.split(".").slice(0, 2).join(".")}.${
      Number(current.split(".")[2].split("-")[0]) + 1
    }.`);
    console.error("A minor or major bump is the repo owner's call: pass --minor or --major.");
    process.exit(1);
  }

  for (const e of edits) {
    await writeFile(path.join(ROOT, e.file), e.next);
    const change = e.from === next ? "unchanged" : `${e.from} → ${next}`;
    console.log(`  ${e.file.padEnd(38)} ${change}`);
  }

  console.log(`\nNow at ${next}.`);
  console.log("The installer hash and size are written back by the release");
  console.log("workflow once the artifact exists — leave them alone.");
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
