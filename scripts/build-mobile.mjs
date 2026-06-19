import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(projectRoot, "www");

const runtimeEntries = [
  "index.html",
  "styles.css",
  "app.js",
  "finance-core.js",
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

console.log(`Mobile web assets copied to ${outputDir}`);
