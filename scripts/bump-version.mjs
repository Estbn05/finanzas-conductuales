// The web version lives in package.json. It also has to appear literally in every
// `?v=` cache-busting URL (static ES imports can't be built at runtime) and in the
// service worker's cache name, so this script rewrites all of them in one go.
//
//   npm run bump            -> 1.1.24 becomes 1.1.25
//   npm run bump -- 1.2.0   -> sets an explicit version
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const VERSIONED_FILES = [
  "index.html",
  "app.js",
  "state-model.js",
  "manifest.webmanifest",
  "service-worker.js"
];

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const packagePath = join(projectRoot, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  const current = pkg.version;
  const next = process.argv[2] || nextPatch(current);
  if (!VERSION_PATTERN.test(next)) {
    throw new Error(`Invalid version "${next}". Use MAJOR.MINOR.PATCH.`);
  }

  // Lookbehind instead of capture groups: only the number itself is replaced.
  const pattern = new RegExp(`(?<=\\?v=|APP_VERSION = "|\\$\\{CACHE_PREFIX\\})${escapeRegExp(current)}(?!\\d)`, "g");

  // Compute every file first so a failure never leaves the versions half-bumped.
  const updates = [];
  for (const file of VERSIONED_FILES) {
    const path = join(projectRoot, file);
    const before = await readFile(path, "utf8");
    const after = before.replace(pattern, next);
    if (after === before) {
      throw new Error(`${file} has no reference to version ${current}; is it out of sync?`);
    }
    updates.push([path, after]);
  }
  for (const [path, contents] of updates) {
    await writeFile(path, contents);
  }

  pkg.version = next;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Version ${current} -> ${next}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
