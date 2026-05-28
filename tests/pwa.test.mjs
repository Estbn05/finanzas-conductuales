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

  assert.match(worker, /CACHE_NAME = "finanzas-conductuales-v7"/);
  assert.ok(worker.includes('"./index.html"'));
  assert.ok(worker.includes('"./app.js"'));
  assert.ok(worker.includes('"./finance-core.js"'));
  assert.ok(worker.includes('"./sync-client.js"'));
  assert.ok(worker.includes('"./sync-config.js"'));
  assert.ok(worker.includes('"./assets/icon-512.png"'));
});

test("navigation opens on expense registration with a vertical collapsible menu", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(app, /const DEFAULT_VIEW = "spending"/);
  assert.ok(app.indexOf('id: "spending", label: "Registrar gasto"') < app.indexOf('id: "today", label: "Inicio"'));
  assert.ok(app.includes('data-action="toggle-menu"'));
  assert.match(styles, /\.nav-panel\s*{[\s\S]*max-height: 0/);
  assert.match(styles, /\.nav-panel\.is-open\s*{[\s\S]*max-height: 430px/);
});
