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

  assert.match(worker, /CACHE_NAME = "finanzas-conductuales-v37"/);
  assert.ok(worker.includes('"./index.html"'));
  assert.ok(worker.includes('"./app.js"'));
  assert.ok(worker.includes('"./finance-core.js"'));
  assert.ok(worker.includes('"./sync-client.js"'));
  assert.ok(worker.includes('"./sync-config.js"'));
  assert.ok(worker.includes('"./assets/icon-512.png"'));
});

test("mobile-first shell prioritizes free money and fast expense registration", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(app, /const DEFAULT_VIEW = "today"/);
  assert.ok(app.includes('class="expense-fab"'));
  assert.ok(app.includes('class="bottom-nav"'));
  assert.ok(app.includes('class="drawer-scrim"'));
  assert.ok(app.includes('data-action="open-expense"'));
  assert.ok(app.includes('data-action="close-expense"'));
  assert.ok(app.includes('class="quick-expense-panel"'));
  assert.ok(app.includes('id="transaction-form"'));
  assert.ok(app.includes('data-choice-value="${escapeAttr(option.value)}"'));
  assert.ok(app.includes("money-location-chips"));
  assert.ok(app.includes("Cuenta"));
  assert.ok(app.includes("Efectivo"));
  assert.ok(app.includes("Total real"));

  const todayView = app
    .slice(app.indexOf("function renderToday"), app.indexOf("function renderTransactionLabeler"))
    .split("const today = todayKey();")[0];
  assert.ok(todayView.includes("Categorias del periodo"));
  assert.equal(todayView.includes("Movimientos del periodo"), false);
  assert.equal(todayView.includes("Fondo inicial"), false);
  assert.equal(todayView.includes("Pago recomendado"), false);

  assert.ok(styles.includes(".expense-fab"));
  assert.ok(styles.includes(".bottom-nav"));
  assert.ok(styles.includes(".quick-expense-panel"));
  assert.ok(styles.includes(".money-location-chips"));
  assert.match(styles, /\.money-bar strong\s*{[\s\S]*font-size: 2\.38rem/);
  assert.match(styles, /\.bar\s*{[\s\S]*height: 4px/);
  assert.ok(styles.includes("@media (prefers-color-scheme: dark)"));
});

test("new users get a three-step onboarding without account registration", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes('id="onboarding-form"'));
  assert.ok(app.includes("Paso 1 de 3"));
  assert.ok(app.includes("Paso 2 de 3"));
  assert.ok(app.includes("Paso 3 de 3"));
  assert.ok(app.includes("¿Cuanto recibes y cada cuanto?"));
  assert.ok(app.includes("¿Donde tienes ese dinero?"));
  assert.ok(app.includes("¿Para que separas plata normalmente?"));
  assert.ok(app.includes("Cuenta + efectivo debe sumar"));
  assert.ok(app.includes("handleOnboardingSubmit"));
  assert.ok(app.includes("onboardingCategories"));
});

test("behavioral finance, cloud sync, undo and backup features remain available", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes("Gasto registrado."));
  assert.ok(app.includes("Deshacer?"));
  assert.ok(app.includes('"undo-snackbar"'));
  assert.ok(app.includes("savingsPercent"));
  assert.ok(app.includes("finanzas-${todayKey()}.json"));
  assert.ok(app.includes("window.confirm"));
  assert.ok(app.includes("stateUpdatedTime"));
  assert.ok(app.includes("cloudRecordUpdatedTime"));
  assert.ok(app.includes("hasMeaningfulLocalData"));
  assert.ok(app.includes("BACKUP_KEY"));
  assert.ok(app.includes("saveLocalBackup"));
  assert.ok(app.includes('"restore-latest-backup"'));
  assert.ok(app.includes("Nube</strong> pendiente"));
  assert.ok(app.includes("liquiditySummary"));
  assert.ok(app.includes("adjustLiquidity"));
  assert.ok(app.includes("validateTransactionDraft"));
  assert.ok(app.includes("remove-transaction"));
  assert.ok(app.includes("clearCurrentPeriodExtras"));
  assert.ok(app.includes("reconcileLiquidity"));
  assert.ok(app.includes("renderTransactionHistory"));
  assert.ok(!app.includes("state.transactions = []"));
});
