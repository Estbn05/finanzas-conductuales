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

  assert.match(worker, /CACHE_NAME = "finanzas-conductuales-v15"/);
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
  assert.ok(app.includes('class="money-bar '));
  assert.ok(app.includes('class="menu-tools"'));
  assert.ok(app.indexOf("<h2>Registrar gasto</h2>") < app.indexOf("<h2>Lo que va usado</h2>"));
  assert.ok(app.indexOf("<h2>Registrar gasto</h2>") < app.indexOf("<h2>Reservar del periodo</h2>"));
  assert.ok(app.indexOf("<h2>Registrar gasto</h2>") < app.indexOf("<h2>Sumar al presupuesto</h2>"));
  assert.ok(app.includes('id="extra-budget-form"'));
  assert.ok(app.includes('id="diagnosis-form" class="diagnosis-form" novalidate'));
  assert.ok(app.includes('<button class="btn primary" type="submit">Guardar plan</button>'));
  assert.ok(app.includes('name="payday" type="number" min="0" max="28"'));
  assert.ok(app.includes("Usa 0 si no tienes un dia fijo."));
  assert.ok(app.includes('name="cadence"'));
  assert.ok(app.includes("Libre / sin clasificar"));
  assert.ok(!app.includes("const TODAY"));
  assert.ok(app.includes("getCategoryStatus(state, todayKey())"));
  assert.ok(!app.includes("<h1>${headerTitle()}</h1>"));
  assert.ok(!app.includes("<strong>${streak}</strong>"));
  assert.match(styles, /\.nav-panel\s*{[\s\S]*max-height: 0/);
  assert.match(styles, /\.nav-panel\.is-open\s*{[\s\S]*max-height: 620px/);
  assert.match(styles, /\.nav-list\s*{[\s\S]*grid-template-columns: 1fr/);
});
