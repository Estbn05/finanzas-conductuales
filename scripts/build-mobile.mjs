import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { transform } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(projectRoot, "www");

const runtimeEntries = [
  "index.html",
  "styles.css",
  "app.js",
  "finance-core.js",
  // app.js imports it at load time; leaving it out ships an APK that never boots.
  "state-model.js",
  "sync-client.js",
  "sync-config.js",
  "manifest.webmanifest",
  "service-worker.js",
  "assets",
  "vendor",
  "docs/screenshot-mobile.png",
  "docs/screenshot-desktop.png"
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of runtimeEntries) {
  const source = join(projectRoot, entry);
  const target = join(outputDir, entry);

  if (entry === "assets" || entry === "vendor") {
    await cp(source, target, { recursive: true });
    continue;
  }

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

// Minified inside the APK only; the source files stay readable. Transform, not bundle:
// every module keeps its own file and its "?v=" import URLs, exactly as in the source.
const minifiable = { "app.js": "js", "finance-core.js": "js", "state-model.js": "js", "sync-client.js": "js", "styles.css": "css" };
let before = 0;
let after = 0;
for (const [file, loader] of Object.entries(minifiable)) {
  const target = join(outputDir, file);
  const code = await readFile(target, "utf8");
  const result = await transform(code, { loader, minify: true, format: loader === "js" ? "esm" : undefined, target: "es2020", legalComments: "none" });
  await writeFile(target, result.code);
  before += code.length;
  after += result.code.length;
}

console.log(`Mobile web assets copied to ${outputDir} (minified ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB)`);
