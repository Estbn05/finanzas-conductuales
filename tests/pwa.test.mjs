import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest has mobile install metadata and required PNG icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  const iconSizes = manifest.icons.map((icon) => icon.sizes);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./?pwa-cleanup=20260610-pwa-cleanup");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.orientation, "portrait-primary");
  assert.ok(iconSizes.includes("192x192"));
  assert.ok(iconSizes.includes("512x512"));
});

test("service worker removes stale PWA caches and unregisters itself", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");

  assert.ok(worker.includes('CACHE_PREFIX = "finanzas-conductuales-"'));
  assert.ok(worker.includes('CLEANUP_RELEASE = "20260610-pwa-cleanup"'));
  assert.ok(worker.includes("caches.delete(key)"));
  assert.ok(worker.includes("self.registration.unregister()"));
  assert.ok(worker.includes('includeUncontrolled: true'));
  assert.equal(worker.includes('addEventListener("fetch"'), false);
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

test("authenticated new users get a three-step financial onboarding", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

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
  assert.ok(app.includes("renderOnboardingCategoryRow(0, { example: true })"));
  assert.ok(app.includes("data-add-onboarding-category"));
  assert.ok(app.includes("data-remove-onboarding-category"));
  assert.ok(app.includes("categoryList.insertAdjacentHTML"));
  assert.equal(app.includes('["Transporte", "weekly"]'), false);
  assert.equal(app.includes('["Comida", "monthly"]'), false);
  assert.ok(styles.includes(".onboarding-add-category"));
  assert.ok(styles.includes(".onboarding-category-add"));
  assert.match(styles, /\.onboarding-form input,[\s\S]*\.onboarding-form select\s*{[\s\S]*-webkit-appearance: none/);
  assert.ok(styles.includes("-webkit-text-fill-color: #101614 !important"));
  assert.ok(styles.includes("-webkit-text-fill-color: #e8f5ee !important"));
});

test("authentication gates onboarding and signed-in users can close their session", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const syncClient = await readFile(new URL("../sync-client.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("function shouldShowAuthGate()"));
  assert.ok(app.includes("function renderAuthGate()"));
  assert.ok(app.includes("AUTH_STARTUP_TIMEOUT_MS = 5_000"));
  assert.ok(app.includes("function recoverAuthStartup()"));
  assert.equal(app.includes('data-action="recover-auth"'), false);
  assert.equal(app.includes('data-action="reload-app"'), false);
  assert.ok(app.indexOf("if (shouldShowAuthGate())") < app.indexOf("const plan = calculatePlan();"));
  assert.ok(app.includes('data-cloud-mode="signup">Crear cuenta'));
  assert.ok(app.includes('data-cloud-mode="signin">Ya tengo cuenta: iniciar sesion'));
  assert.ok(app.includes('data-action="cloud-sign-out">Cerrar sesion'));
  assert.ok(app.includes("function clearLocalUserState()"));
  assert.ok(app.includes("previousEmail !== nextEmail"));
  assert.ok(app.includes("cloudState.sessionReady = true"));
  const pullCloud = app.slice(app.indexOf("async function pullCloudAfterLogin"), app.indexOf("function scheduleCloudSave"));
  assert.equal(pullCloud.includes("cloudState.sessionReady = false"), false);
  assert.ok(syncClient.includes("CLOUD_TIMEOUT_MS = 10_000"));
  assert.ok(syncClient.includes("withCloudTimeout"));
  assert.ok(syncClient.includes("Comprobar la sesion"));
  assert.ok(styles.includes(".auth-gate"));
  assert.ok(styles.includes(".auth-card"));
  assert.equal(styles.includes(".auth-recovery-actions"), false);
});

test("static startup fallback retries automatically without manual controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(html.includes('class="startup-fallback"'));
  assert.ok(html.includes('const retryKey = "finanzas-startup-retry"'));
  assert.ok(html.includes("window.location.reload()"));
  assert.ok(html.includes("window.pwaCleanupReady"));
  assert.ok(html.includes("registration.unregister()"));
  assert.ok(html.includes("caches.delete(key)"));
  assert.ok(html.includes('await import("./app.js?v=20260610-pwa-cleanup")'));
  assert.equal(html.includes("Continuar al acceso"), false);
  assert.equal(html.includes("Recargar aplicacion"), false);
  assert.equal(html.includes('onclick="window.location.reload()"'), false);
  assert.ok(styles.includes(".startup-fallback-card"));
});

test("money inputs format thousands while preserving numeric calculations", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("bindMoneyInputs();"));
  assert.ok(app.includes('input[type="number"][step="1000"], input[data-money-input="true"]'));
  assert.ok(app.includes('input.dataset.moneyInput = "true"'));
  assert.ok(app.includes("formatMoneyInputValue"));
  assert.ok(app.includes("parseNumberText"));
  assert.ok(app.includes('new Intl.NumberFormat("es-CO"'));
  assert.ok(styles.includes('.quick-amount input[data-money-input="true"]'));
});

test("opening an expense form does not trigger cloud sync or replace active forms", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes('const interfaceOnlyActions = new Set(['));
  assert.ok(app.includes('"open-expense"'));
  assert.ok(app.includes("!interfaceOnlyActions.has(action)"));
  assert.ok(app.includes("function renderCloudStatusChange()"));
  assert.ok(app.includes("quickExpenseOpen || state.showDiagnosis || pendingExtraAllocation"));
  assert.ok(app.includes("saveState({ sync: false, touch: false });"));
});

test("Android back navigation closes the quick expense form before leaving the app", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes('const QUICK_EXPENSE_HASH = "registrar-gasto"'));
  assert.ok(app.includes('window.addEventListener("popstate", syncQuickExpenseWithLocation)'));
  assert.ok(app.includes("window.location.hash = QUICK_EXPENSE_HASH"));
  assert.ok(app.includes("window.history.back();"));
  assert.ok(app.includes("function openQuickExpense()"));
  assert.ok(app.includes("function closeQuickExpense()"));
  assert.ok(app.includes("function isQuickExpenseLocation()"));
  assert.ok(app.includes("function seedQuickExpenseBackEntry()"));
  assert.ok(app.includes("window.history.replaceState(historyState"));
  assert.equal(app.includes("required autofocus"), false);
});

test("every form keeps readable controls in Android PWA themes", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(styles.includes("--field-bg: #ffffff"));
  assert.ok(styles.includes("--field-bg: #1d2421"));
  assert.ok(styles.includes("--field-text: #101614"));
  assert.ok(styles.includes("--field-text: #e8f5ee"));
  assert.match(styles, /input:not\(\[type="checkbox"\]\)[\s\S]*select,[\s\S]*textarea\s*{/);
  assert.ok(styles.includes("-webkit-text-fill-color: var(--field-text) !important"));
  assert.ok(styles.includes('input[type="date"]::-webkit-datetime-edit'));
  assert.ok(styles.includes("var(--field-arrow)"));
  assert.ok(styles.includes("input:-webkit-autofill"));
  assert.match(styles, /\.btn\.ghost\s*{[\s\S]*background: rgba\(255, 255, 255, 0\.06\)/);
  assert.match(styles, /\.quick-amount input\[data-money-input="true"\]\s*{[\s\S]*background: transparent !important/);
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

test("savings remains advisory and debt features are removed", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../finance-core.js", import.meta.url), "utf8");

  assert.ok(app.includes("Esta cifra es una recomendacion. No mueve dinero"));
  assert.ok(app.includes("suggestedPeriodSavings"));
  assert.ok(core.includes("savingsCapacityGap"));
  assert.ok(core.includes("savingsReserved"));
  assert.equal(/debt|deuda/i.test(app), false);
  assert.equal(/debt|deuda/i.test(core), false);
});
