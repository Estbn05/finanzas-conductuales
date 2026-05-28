import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest has mobile install metadata and required PNG icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  const iconSizes = manifest.icons.map((icon) => icon.sizes);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.orientation, "portrait-primary");
  assert.ok(iconSizes.includes("192x192"));
  assert.ok(iconSizes.includes("512x512"));
});

test("service worker caches the app shell needed for offline launch", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");

  assert.match(worker, /CACHE_NAME = "finanzas-conductuales-v6"/);
  assert.ok(worker.includes('"./index.html"'));
  assert.ok(worker.includes('"./app.js"'));
  assert.ok(worker.includes('"./finance-core.js"'));
  assert.ok(worker.includes('"./sync-client.js"'));
  assert.ok(worker.includes('"./sync-config.js"'));
  assert.ok(worker.includes('"./assets/icon-512.png"'));
});
