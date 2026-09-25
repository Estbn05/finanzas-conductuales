import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ASSET_VERSION = "1.1.20";

test("manifest has mobile install metadata and required PNG icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  const iconSizes = manifest.icons.map((icon) => icon.sizes);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.orientation, "portrait-primary");
  assert.ok(iconSizes.includes("192x192"));
  assert.ok(iconSizes.includes("512x512"));
  assert.ok(manifest.icons.every((icon) => icon.src.includes(`?v=${ASSET_VERSION}`)));
});

test("Android build includes native local notification support", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const androidManifest = await readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");

  assert.ok(pkg.dependencies["@capacitor/local-notifications"]);
  assert.ok(androidManifest.includes("android.permission.POST_NOTIFICATIONS"));
});

test("service worker caches the app shell and serves an offline navigation fallback", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");

  assert.ok(worker.includes('CACHE_PREFIX = "finanzas-conductuales-"'));
  assert.ok(worker.includes("CACHE_NAME"));
  assert.ok(worker.includes("cache.addAll(APP_SHELL)"));
  assert.ok(worker.includes(`app.js?v=${ASSET_VERSION}`));
  assert.ok(worker.includes('addEventListener("notificationclick"'));
  assert.ok(worker.includes('request.mode === "navigate"'));
  assert.ok(worker.includes("fetch(request)"));
  assert.ok(worker.includes("caches.delete(key)"));
  assert.ok(worker.includes("self.clients.claim()"));
  assert.ok(worker.includes('addEventListener("message"'));
  assert.ok(worker.includes('"SKIP_WAITING"'));
  assert.ok(worker.includes("self.skipWaiting()"));
  assert.ok(worker.includes("addEventListener(\"fetch\""));
  assert.ok(worker.includes('request.mode === "navigate"'));
  assert.equal(worker.includes("self.registration.unregister()"), false);
});

test("mobile-first shell prioritizes free money and fast expense registration", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(app, /const DEFAULT_VIEW = "today"/);
  assert.ok(app.includes('class="bottom-nav"'));
  assert.ok(app.includes('class="drawer-scrim"'));
  assert.ok(app.includes('{ id: "calendar", label: "Calendario", icon: "04" }'));
  assert.ok(app.includes('{ id: "movements", label: "Movimientos", icon: "05" }'));
  assert.ok(app.includes('data-action="open-expense"'));
  assert.ok(app.includes('data-action="close-expense"'));
  assert.ok(app.includes('data-action="set-theme"'));
  const setThemeAction = app.slice(app.indexOf('"set-theme": () => {'), app.indexOf('"remove-calendar-event":'));
  assert.ok(setThemeAction.includes("saveState();"));
  assert.equal(setThemeAction.includes("sync: false"), false);
  assert.ok(app.includes("function renderBrandMark()"));
  assert.ok(app.includes(`finance-core.js?v=${ASSET_VERSION}`));
  assert.ok(app.includes(`sync-client.js?v=${ASSET_VERSION}`));
  assert.ok(app.includes('class="brand-mark-icon"'));
  assert.equal(app.includes("brand-ring-spark"), false);
  assert.equal(app.includes('<span class="brand-mark">FC</span>'), false);
  assert.ok(app.includes('{ value: "system", label: "Sistema" }'));
  assert.ok(app.includes('{ value: "light", label: "Claro" }'));
  assert.ok(app.includes('{ value: "dark", label: "Oscuro" }'));
  assert.ok(app.includes('data-theme-choice="${option.value}"'));
  assert.ok(app.includes("function applyThemePreference()"));
  assert.ok(app.includes('document.documentElement.dataset.theme = theme'));
  assert.ok(app.includes('theme: normalizeTheme'));
  assert.ok(app.includes('data-view="movements"'));
  assert.ok(app.includes('renderIcon("receipt")'));
  assert.ok(app.includes('["savings", "calendar", "profile"].includes(state.activeView)'));
  assert.ok(app.includes('class="quick-expense-panel"'));
  assert.ok(app.includes('id="transaction-form"'));
  assert.ok(app.includes('data-choice-value="${escapeAttr(option.value)}"'));
  assert.ok(app.includes('role="radio" aria-checked='));
  assert.ok(app.includes('const APP_VIEWS = new Set'));
  assert.ok(app.includes('APP_VIEWS.has(view)'));
  assert.ok(app.includes('name="budgeted" type="checkbox" checked'));

  // The two behavioral checkboxes (24h cooldown opt-out, exclude from daily-pace
  // prediction) are load-bearing logic, not just labels — see handleTransactionSubmit's
  // `!budgeted && amount >= threshold` cooldown branch and ignoredOneOffSpent in
  // finance-core.js. Simplifying them for readability means clearer copy tucked behind a
  // "Más opciones" disclosure (closed by default), not removing the inputs — they must
  // stay in the DOM (via the HTML `hidden` attribute, not conditional rendering) so
  // FormData still submits their default values when the user never opens the section.
  assert.ok(app.includes('let quickExpenseAdvancedOpen = false;'));
  assert.ok(app.includes('data-action="toggle-quick-expense-advanced"'));
  assert.ok(app.includes('class="quick-expense-advanced" ${quickExpenseAdvancedOpen ? "" : "hidden"}'));
  assert.ok(app.includes("Ya lo tenía planeado"));
  assert.ok(app.includes("No fue un gasto de todos los días"));
  assert.equal(app.includes("Ya estaba previsto en el plan"), false);
  assert.equal(app.includes("Gasto único: no usar para ritmo diario"), false);

  // The undo snackbar must give enough time to read the message and react before it
  // disappears on its own.
  assert.match(app, /function showUndoSnackbar[\s\S]*?\}, 8000\);/);

  assert.ok(app.includes("money-location-list"));
  assert.ok(app.includes("Cuenta"));
  assert.ok(app.includes("Efectivo"));
  assert.ok(app.includes("Total real"));
  assert.ok(app.includes("const liquidity = liquiditySummary();"));
  assert.ok(app.includes("formatCompactMoney(liquidity.account)"));
  assert.ok(app.includes("formatCompactMoney(liquidity.cash)"));
  assert.ok(app.includes('class="expense-impact-preview" aria-live="polite"'));

  const todayView = app.slice(app.indexOf("function renderToday"), app.indexOf("function renderPeriodPredictionCard"));
  assert.ok(todayView.includes("Categorías del periodo"));
  assert.equal(todayView.includes("Movimientos del periodo"), false);
  assert.equal(todayView.includes("Fondo inicial"), false);
  assert.equal(todayView.includes("Pago recomendado"), false);

  const fullTodayView = app.slice(app.indexOf("function renderToday"), app.indexOf("function renderPeriodPredictionCard"));
  assert.equal(fullTodayView.includes("Ahora"), false);
  assert.equal(fullTodayView.includes("Revisión rápida"), false);
  assert.equal(fullTodayView.includes("complete-checkin"), false);
  assert.equal(fullTodayView.includes("Clasifica"), false);
  assert.equal(fullTodayView.includes("Gasto del mes"), false);
  assert.equal(fullTodayView.includes("Fondo inicial"), false);
  assert.equal(fullTodayView.includes("Ahorro recomendado"), false);
  assert.equal(fullTodayView.includes("Gastos por categoría"), false);
  assert.ok(fullTodayView.includes("renderCooldownPanel"));
  assert.equal(fullTodayView.includes("Ajuste sin culpa"), false);
  assert.equal(fullTodayView.includes("Patron dominante"), false);

  assert.ok(app.includes('class="bottom-nav-icon plus-icon"'));
  assert.ok(app.includes('renderIcon(normalizeLocation(transaction.source) === "cash" ? "cash" : "account")'));
  assert.ok(styles.includes(".bottom-nav"));
  assert.ok(styles.includes(".quick-expense-panel"));
  assert.ok(styles.includes("Design system v3"));
  assert.ok(styles.includes("Mockup fidelity v5"));
  assert.ok(styles.includes("Theme switcher v6"));
  assert.ok(styles.includes("color-scheme: light"));
  assert.ok(styles.includes('html[data-theme="dark"]'));
  assert.ok(styles.includes(".theme-switcher"));
  assert.ok(styles.includes(".theme-choice.is-active"));
  assert.ok(styles.includes(".nav-item span:last-child"));
  assert.ok(styles.includes("Quick expense dark contrast v7"));
  assert.ok(styles.includes('html[data-theme="dark"] .quick-expense-panel .metric-badge'));
  assert.ok(styles.includes('html[data-theme="dark"] .quick-expense-panel .choice-pill'));
  assert.ok(styles.includes("Plan dark contrast v8"));
  assert.ok(styles.includes('html[data-theme="dark"] .screen-title-row .period-chip'));
  assert.ok(styles.includes('html[data-theme="dark"] .add-category-row'));
  assert.ok(styles.includes("Modal choice contrast v9"));
  assert.ok(styles.includes('html[data-theme="dark"] .bottom-sheet .choice-pill'));
  assert.ok(styles.includes('html[data-theme="dark"] .modal:not(.onboarding-modal) .choice-pill'));
  assert.ok(styles.includes("Income editor dark contrast v10"));
  assert.ok(styles.includes('#app[data-theme="dark"] .bottom-sheet.transaction-editor .choice-pill'));
  assert.ok(styles.includes(".bottom-sheet.transaction-editor .extra-edit-allocation span"));
  assert.ok(styles.includes("Mobile drawer scroll fix v11"));
  assert.ok(styles.includes("height: 100dvh"));
  assert.ok(styles.includes("-webkit-overflow-scrolling: touch"));
  assert.ok(styles.includes("Savings hero tag contrast v12"));
  assert.ok(styles.includes(".savings-hero .trust-tags span"));
  assert.ok(styles.includes("Calendar reminder dark contrast v13"));
  assert.ok(styles.includes(".reminder-panel .metric-badge"));
  assert.ok(styles.includes(".reminder-actions .btn:disabled"));
  assert.ok(app.includes("function nativeLocalNotifications()"));
  assert.ok(app.includes("function scheduleNativeDailyReminder"));
  assert.ok(app.includes("function initializeNativeNotificationActions"));
  assert.ok(app.includes("function refreshNativeNotificationPermission"));
  assert.ok(app.includes("LocalNotifications"));
  assert.ok(app.includes("DAILY_REMINDER_NOTIFICATION_ID"));
  assert.ok(app.includes("TEST_REMINDER_NOTIFICATION_ID"));
  assert.ok(app.includes("localNotificationActionPerformed"));
  assert.ok(app.includes("Android mostrará el recordatorio aunque la app no este abierta."));
  assert.ok(styles.includes("Sidebar ghost button dark contrast v14"));
  assert.ok(styles.includes("html[data-theme=\"dark\"] .sidebar .menu-tools .btn.ghost"));
  assert.ok(styles.includes("Distribution brand mark v18"));
  assert.ok(styles.includes(".brand-ring-free"));
  assert.ok(styles.includes("--ds-bg: #f6f1e7"));
  assert.ok(styles.includes("--ds-bg: #f7f4ee"));
  assert.ok(styles.includes(":focus-visible"));
  assert.ok(styles.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(styles.includes(".expense-impact-preview"));
  assert.ok(styles.includes(".money-location-chips"));
  assert.ok(styles.includes("grid-template-columns: repeat(5"));
  assert.ok(styles.includes(".money-context"));
  assert.ok(styles.includes(".category-card-bar"));
  assert.ok(styles.includes("@media (prefers-color-scheme: dark)"));
});

test("movements combines expenses and extra income and can sort the full history", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("function renderMovements()"));
  assert.ok(app.includes("function movementsForSummary(summary = budgetSummary())"));
  assert.ok(app.includes("function renderExpenseCalendar(summary = budgetSummary())"));
  assert.ok(app.includes("${renderExpenseCalendar(summary)}"));
  assert.ok(app.includes("Calendario de gastos"));
  assert.ok(app.includes("function expenseCalendarForSummary(summary = budgetSummary())"));
  assert.ok(app.includes("function datesInWindow(start, end)"));
  assert.ok(app.includes("function nextMonthStartKey(dateValue = todayKey())"));
  assert.ok(app.includes("function minDateKey(a, b)"));
  assert.ok(app.includes("function maxDateKey(a, b)"));
  assert.ok(app.includes("const monthStart = monthStartKey(todayKey())"));
  assert.ok(app.includes("if (date < start || date >= end)"));
  assert.ok(app.includes("function weekdayOffset(dateValue)"));
  assert.ok(app.includes("transactionsForSummary(summary).reduce"));
  assert.ok(app.includes('kind: "expense"'));
  assert.ok(app.includes('kind: "income"'));
  assert.ok(app.includes('movement.kind === "income"'));
  assert.ok(app.includes("Dinero extra"));
  assert.ok(app.includes('renderIcon("income")'));
  assert.ok(app.includes('data-action="edit-extra"'));
  assert.ok(app.includes("function renderExtraEditor()"));
  assert.ok(app.includes('id="extra-edit-form"'));
  assert.ok(app.includes("function handleExtraEditSubmit(event)"));
  assert.ok(app.includes("function updateBudgetExtra(extra, next)"));
  assert.ok(app.includes("function reverseBudgetExtra(extra)"));
  assert.ok(app.includes('data-action="remove-extra-from-editor"'));
  assert.ok(app.includes("Eliminar ingreso y devolver saldo"));
  assert.ok(app.includes('adjustLiquidity(location, delta, "edit-extra")'));
  assert.ok(app.includes('const movementCountLabel = movements.length === 1 ? "movimiento" : "movimientos"'));
  assert.ok(app.includes("${movements.length} ${movementCountLabel}"));
  assert.ok(app.includes('id="transaction-history-sort"'));
  assert.ok(app.includes("function dailyExpenseTotal(dayMovements = [])"));
  assert.ok(app.includes('movement.kind === "expense"'));
  assert.ok(app.includes("Gastos: ${formatMoney(expenseTotal)}"));
  assert.ok(app.includes('value="recent"'));
  assert.ok(app.includes('value="amount"'));
  assert.ok(app.includes("transactionHistorySort"));
  assert.ok(app.includes('sort === "amount"'));
  assert.ok(app.includes("Number(b.amount || 0) - Number(a.amount || 0)"));
  assert.ok(app.includes("function compareTransactionsByRecent(a, b)"));
  assert.ok(app.includes('String(b.date || "").localeCompare(String(a.date || ""))'));
  assert.ok(app.includes('movements: "movimientos"'));
  assert.ok(app.includes('id="transaction-history-filter"'));
  assert.ok(app.includes("transactionHistoryFilter"));
  assert.ok(app.includes("function movementMatchesFilter(movement, filter)"));
  assert.ok(app.includes('value="expense"'));
  assert.ok(app.includes('value="income"'));
  assert.ok(app.includes('value="uncategorized"'));
  assert.ok(app.includes('filter.startsWith("cat:")'));
  assert.ok(app.includes('id="transaction-history-search"'));
  assert.ok(app.includes("transactionHistorySearch"));
  assert.ok(app.includes("function movementMatchesSearch(movement, query)"));
  assert.ok(app.includes("search: '<circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/>"));
  assert.ok(styles.includes(".movements-controls"));
  assert.ok(styles.includes(".history-search"));
  assert.ok(styles.includes(".history-row.is-income"));
  assert.ok(styles.includes(".expense-calendar-card"));
  assert.ok(styles.includes(".expense-calendar-grid"));
  assert.ok(styles.includes(".expense-calendar-day.high"));
  assert.ok(styles.includes(".movement-day-meta"));
  assert.ok(styles.includes(".movement-type-icon.income"));
  assert.ok(styles.includes(".income-amount strong"));
  assert.ok(styles.includes(".history-row .movement-type-icon"));
  assert.ok(styles.includes("place-items: center"));
  assert.ok(styles.includes("line-height: 0"));
  assert.ok(styles.includes(".extra-edit-allocation"));
  assert.ok(styles.includes(".income-editor-amount"));

  const profile = app.slice(app.indexOf("function renderProfile"), app.indexOf("function renderIncomeCadenceOptions"));
  assert.equal(profile.includes("renderTransactionHistory"), false);
  assert.equal(profile.includes("Movimientos del periodo"), false);
});

test("period prediction, period close and merchant rules are exposed in the app shell", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../finance-core.js", import.meta.url), "utf8");
  const stateModel = await readFile(new URL("../state-model.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(core.includes("export function predictUntilNextPeriod"));
  assert.ok(core.includes("projectedEndFree"));
  assert.ok(core.includes("minimumObservedDays"));
  assert.ok(core.includes("freeImpactForPrediction"));
  assert.ok(core.includes("ignoredOneOffSpent"));
  assert.ok(app.includes("predictUntilNextPeriod as getPeriodPrediction"));
  assert.ok(app.includes("function renderPeriodPredictionCard"));
  assert.ok(app.includes("function renderPredictionDetailsModal"));
  assert.ok(app.includes("Predicción hasta el próximo periodo"));
  assert.ok(app.includes("Cómo se calculó"));
  assert.ok(app.includes("data-action=\"open-prediction-details\""));
  assert.ok(app.includes("data-action=\"close-prediction-details\""));
  assert.ok(app.includes("dinero_libre_inicial"));
  assert.ok(app.includes("gasto_libre_real"));
  assert.ok(app.includes("ritmo_diario"));
  assert.ok(app.includes("gasto_estimado_restante"));
  assert.ok(app.includes("resultado_final"));
  assert.ok(app.includes("Aprendiendo ritmo"));
  assert.ok(app.includes("No fue un gasto de todos los días"));
  assert.ok(app.includes("Cierre de periodo"));
  assert.ok(app.includes("Ahorro sugerido vs posible"));
  assert.ok(app.includes("Qué ajustar para el próximo"));
  assert.ok(app.includes('data-view="periodClose"'));
  assert.ok(app.includes("function renderPeriodCloseScreen"));
  assert.ok(app.includes("function periodCloseReport"));
  assert.ok(app.includes("const PERIOD_CLOSE_NOTICE_DAYS = 5"));
  assert.ok(app.includes("function shouldShowPeriodClose"));
  assert.ok(app.includes("shouldShowPeriodClose(closeReport) ? renderPeriodCloseCard"));
  assert.ok(app.includes("function renderPeriodCloseWaiting"));
  assert.ok(app.includes("El cierre aparece cuando falten"));
  assert.ok(app.includes("function renderPeriodReportCard"));
  assert.ok(app.includes("function renderPeriodReportModal"));
  assert.ok(app.includes("function generatePeriodReport"));
  assert.ok(app.includes("function periodReportDailyTotals"));
  assert.ok(app.includes("function periodReportMerchantTotals"));
  assert.ok(app.includes("function copyPeriodReport"));
  assert.ok(app.includes("function downloadPeriodReport"));
  assert.ok(app.includes("Reporte del periodo"));
  assert.ok(app.includes("Resumen completo listo"));
  assert.ok(app.includes("data-action=\"open-period-report\""));
  assert.ok(app.includes("data-action=\"copy-period-report\""));
  assert.ok(app.includes("data-action=\"download-period-report\""));
  assert.ok(app.includes("Gasto total registrado"));
  assert.ok(app.includes("Comercios principales"));
  assert.ok(app.includes("Movimientos"));
  assert.ok(app.includes("function periodCloseAdjustments"));
  assert.ok(app.includes("exceededCategories"));
  assert.ok(app.includes("idealPeriodSavings"));
  assert.ok(app.includes("possiblePeriodSavings"));
  assert.ok(app.includes("predictionAmountLabel"));
  assert.ok(app.includes("predictionPaceText"));
  assert.ok(app.includes("function renderPeriodCloseCard"));
  assert.ok(app.includes('data-action="save-period-close"'));
  assert.ok(app.includes("function savePeriodClosure"));
  assert.ok(stateModel.includes("periodClosures: []"));
  assert.ok(app.includes("normalizePeriodClosures"));
  assert.ok(app.includes("function renderMerchantRulesPanel"));
  assert.ok(app.includes("function renderMerchantRuleSuggestion"));
  assert.ok(app.includes("function rememberMerchantRule"));
  assert.ok(app.includes("function findMerchantRule"));
  assert.ok(stateModel.includes("merchantRules: []"));
  assert.ok(app.includes("data-apply-merchant-rule"));
  assert.ok(app.includes('data-action="remove-merchant-rule"'));
  assert.ok(styles.includes("Prediction, period close and merchant rules v28"));
  assert.ok(styles.includes(".prediction-card"));
  assert.ok(styles.includes(".prediction-detail-modal"));
  assert.ok(styles.includes(".formula-list"));
  assert.ok(styles.includes(".period-close-card"));
  assert.ok(styles.includes(".period-close-view"));
  assert.ok(styles.includes(".period-close-hero"));
  assert.ok(styles.includes(".period-report-card"));
  assert.ok(styles.includes(".period-report-output"));
  assert.ok(styles.includes(".period-report-actions"));
  assert.ok(styles.includes(".savings-compare"));
  assert.ok(styles.includes(".period-adjustments"));
  assert.ok(styles.includes(".merchant-rule-suggestion"));
  assert.ok(styles.includes(".merchant-rules-panel"));
});

test("authenticated new users get a three-step financial onboarding", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes('id="onboarding-form"'));
  assert.ok(app.includes("Paso 1 de 3"));
  assert.ok(app.includes("Paso 2 de 3"));
  assert.ok(app.includes("Paso 3 de 3"));
  assert.ok(app.includes("¿Ganas dinero periódicamente?"));
  assert.ok(app.includes("¿Cuánto tienes hoy en cuenta y efectivo?"));
  assert.ok(app.includes("¿Para qué separas dinero?"));
  // El saldo real (paso 2) ya NO se valida contra el presupuesto del periodo: son
  // dos numeros independientes. Antes se exigia que cuenta+efectivo sumaran
  // exactamente el ingreso, lo que bloqueaba el paso para cualquiera que
  // empezara en $0 o ya tuviera guardado un monto distinto.
  assert.equal(app.includes("Cuenta + efectivo debe sumar"), false);
  assert.equal(app.includes("Cuenta + efectivo suma"), false);
  const step2Copy = app.slice(app.indexOf('data-step="2"'), app.indexOf('data-step="3"'));
  assert.ok(step2Copy.includes("no tiene que coincidir con lo que recibes por periodo"));
  assert.ok(step2Copy.includes("deja ambos en $0"));
  const validateFn = app.slice(app.indexOf("function validateOnboardingStep"), app.indexOf("function handleOnboardingSubmit"));
  assert.equal(validateFn.includes('step === 2'), false);
  assert.ok(app.includes("handleOnboardingSubmit"));
  assert.ok(app.includes("onboardingCategories"));
  assert.ok(app.includes("data-onboarding-category-chip"));
  assert.ok(app.includes("data-onboarding-free-preview"));
  assert.ok(app.includes("bindOnboardingFlowV2"));
  assert.equal(app.includes('["Transporte", "weekly"]'), false);
  assert.equal(app.includes('["Comida", "monthly"]'), false);
  assert.ok(styles.includes(".onboarding-category-chips"));
  assert.ok(styles.includes(".onboarding-category-chip"));
  assert.match(styles, /\.onboarding-form input,[\s\S]*\.onboarding-form select\s*{[\s\S]*-webkit-appearance: none/);
  assert.ok(styles.includes("-webkit-text-fill-color: #101614 !important"));
  assert.ok(styles.includes("-webkit-text-fill-color: #e8f5ee !important"));
});

// Regresion: createDefaultState() describia a una persona concreta (un estudiante con
// ingreso semestral de $1.750.000, gasolina semanal y un perfil de money scripts ya
// respondido). Esos numeros aparecian ya escritos en el formulario del primer usuario
// que abriera la app, y Datos le informaba un "Patron dominante" deducido de
// puntuaciones que nadie contesto. Un perfil nuevo no debe afirmar nada del usuario.
test("a new profile carries no invented data about the user", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const stateModel = await readFile(new URL("../state-model.js", import.meta.url), "utf8");
  const defaults = stateModel.slice(stateModel.indexOf("function createDefaultState("), stateModel.indexOf("function migrateState("));

  assert.equal(/1_750_000|1750000/.test(app) || /1_750_000|1750000/.test(stateModel), false, "el ingreso de la plantilla no debe existir en ningun sitio");
  assert.match(defaults, /incomeAmount: 0/);
  assert.match(defaults, /incomeCadence: ""/);
  assert.match(defaults, /incomeType: ""/);
  assert.match(defaults, /committedExpenses: 0/);

  for (const removed of ["moneyScripts", "financialAnxiety", "selfEfficacy", "dominantMoneyScript"]) {
    assert.equal(app.includes(removed), false, `${removed} debe haber desaparecido por completo`);
  }

  // El onboarding no responde por el usuario: ni monto, ni cadencia, ni categorias.
  assert.ok(app.includes('value="${income > 0 ? income : ""}"'));
  assert.equal(app.includes('["Comida", 0.18, true]'), false, "ninguna categoria debe venir premarcada");
  // Y ofrece la cadencia quincenal, que antes caia en "Otro" = semestral.
  assert.ok(app.includes('data-onboarding-cadence="biweekly"'));
});

test("saving Mis datos uses one native form submission per section", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const stateModel = await readFile(new URL("../state-model.js", import.meta.url), "utf8");
  const diagnosisModal = app.slice(app.indexOf("function renderDiagnosisModal()"), app.indexOf("function renderDiagnosisPlanFields"));
  const bindEvents = app.slice(app.indexOf("function bindEvents()"), app.indexOf("function bindOnboardingFlowV2"));

  assert.ok(stateModel.includes("export const DIAGNOSIS_SECTIONS = {"));
  assert.ok(stateModel.includes('plan: {') && stateModel.includes('balances: {'));
  // La seccion "Perfil conductual" se elimino: no alimentaba ninguna decision de la
  // app y se mostraba con respuestas que el usuario nunca dio.
  assert.equal(app.includes('behavior: {'), false);
  assert.ok(diagnosisModal.includes('data-diagnosis-section="${sectionKey}"'));
  assert.ok(diagnosisModal.includes('<button class="btn primary" type="submit">Guardar</button>'));
  assert.equal(diagnosisModal.includes("data-diagnosis-save"), false);
  assert.ok(bindEvents.includes('diagnosisForm.addEventListener("submit", handleDiagnosisSubmit)'));
  assert.equal(bindEvents.includes("[data-diagnosis-save]"), false);
  assert.ok(app.includes('data-action="open-diagnosis" data-section="plan"'));
  assert.ok(app.includes('data-action="open-diagnosis" data-section="balances"'));
  assert.equal(app.includes('data-section="behavior"'), false);
});

test("movements can be exported as a CSV with expenses negative and income positive", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes('data-action="export-movements-csv">Exportar CSV</button>'));
  assert.ok(app.includes('"export-movements-csv": downloadMovementsCsv'));
  assert.ok(app.includes('"export-movements-csv",'));
  assert.ok(app.includes("function csvField(value)"));
  assert.ok(app.includes("function movementsCsvRows()"));
  assert.ok(app.includes("function buildMovementsCsv()"));
  assert.ok(app.includes("function downloadMovementsCsv()"));
  const csvRows = app.slice(app.indexOf("function movementsCsvRows()"), app.indexOf("function buildMovementsCsv()"));
  assert.ok(csvRows.includes('kind: "Gasto"'));
  assert.ok(csvRows.includes('kind: "Ingreso"'));
  assert.ok(csvRows.includes("amount: -Math.abs(Number(transaction.amount || 0))"));
  assert.ok(csvRows.includes("amount: Math.abs(Number(extra.amount || 0))"));
  const csvBuilder = app.slice(app.indexOf("function buildMovementsCsv()"), app.indexOf("function downloadMovementsCsv()"));
  assert.ok(csvBuilder.includes("Fecha"));
  const csvDownload = app.slice(app.indexOf("function downloadMovementsCsv()"), app.indexOf("function downloadMovementsCsv()") + 500);
  assert.ok(csvDownload.includes('exportFile(`movimientos-${todayKey()}.csv`, csv, "text/csv"'));
});

test("period report and CSV exports use the native share sheet with a browser download fallback", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.ok(pkg.dependencies["@capacitor/filesystem"]);
  assert.ok(pkg.dependencies["@capacitor/share"]);
  assert.ok(app.includes("function nativeFilesystem()"));
  assert.ok(app.includes("window.Capacitor?.Plugins?.Filesystem"));
  assert.ok(app.includes("function nativeShare()"));
  assert.ok(app.includes("window.Capacitor?.Plugins?.Share"));
  const exportFn = app.slice(app.indexOf("async function exportFile("), app.indexOf("function downloadPeriodReport()"));
  assert.ok(exportFn.includes("filesystem.writeFile("));
  assert.ok(exportFn.includes("share.share("));
  assert.ok(exportFn.includes("new Blob("));
  assert.ok(exportFn.includes('link.download = filename'));
  assert.ok(app.includes('exportFile(`reporte-periodo-${summary.window.start}.txt`, reportText, "text/plain"'));
});

test("hardware back button closes the topmost open sheet/menu instead of exiting the app", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.ok(pkg.dependencies["@capacitor/app"]);
  assert.ok(app.includes("function nativeApp()"));
  assert.ok(app.includes("window.Capacitor?.Plugins?.App"));
  assert.ok(app.includes("function handleHardwareBackButton()"));
  assert.ok(app.includes("function bindHardwareBackButton()"));
  assert.ok(app.includes('app.addListener("backButton", handleHardwareBackButton)'));
  assert.ok(app.includes("bindHardwareBackButton();"));
  const closeOrderStart = app.indexOf("const BACK_CLOSE_SELECTORS");
  const closeOrder = app.slice(closeOrderStart, app.indexOf("];", closeOrderStart));
  assert.ok(closeOrder.indexOf('"close-transaction-editor"') < closeOrder.indexOf('"close-expense"'));
  assert.equal(closeOrder.includes('"close-menu"'), false);
  const backHandler = app.slice(app.indexOf("function handleHardwareBackButton()"), app.indexOf("function bindHardwareBackButton()"));
  assert.ok(backHandler.includes("button.click()"));
  assert.ok(backHandler.includes("if (menuOpen)"));
  assert.ok(backHandler.includes('document.querySelector(\'[data-action="close-menu"]\')?.click()'));
  assert.ok(backHandler.includes("nativeApp()?.exitApp()"));
});

test("home screen widget shows free money and stays in sync with app state", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const mainActivity = await readFile(
    new URL("../android/app/src/main/java/com/estbn05/finanzasconductuales/MainActivity.java", import.meta.url),
    "utf8"
  );
  const provider = await readFile(
    new URL("../android/app/src/main/java/com/estbn05/finanzasconductuales/FreeMoneyWidgetProvider.java", import.meta.url),
    "utf8"
  );
  const plugin = await readFile(
    new URL("../android/app/src/main/java/com/estbn05/finanzasconductuales/WidgetBridgePlugin.java", import.meta.url),
    "utf8"
  );
  const widgetInfo = await readFile(
    new URL("../android/app/src/main/res/xml/free_money_widget_info.xml", import.meta.url),
    "utf8"
  );
  const widgetLayout = await readFile(
    new URL("../android/app/src/main/res/layout/widget_free_money.xml", import.meta.url),
    "utf8"
  );

  assert.ok(app.includes("function nativeWidgetBridge()"));
  assert.ok(app.includes("window.Capacitor?.Plugins?.WidgetBridge"));
  assert.ok(app.includes("function syncHomeWidget()"));
  // Widgets render outside the lock screen, so the amount must not leak while the app
  // is PIN-locked — same principle as allowBackup="false" for the same file.
  const syncWidgetFn = app.slice(app.indexOf("function syncHomeWidget()"), app.indexOf("function handleHardwareBackButton()"));
  assert.ok(syncWidgetFn.includes('lockConfig.enabled ? "Bloqueado" : formatMoney(summary.freeRemaining)'));
  assert.ok(syncWidgetFn.includes("bridge.update({ freeMoney, periodLabel })"));
  const saveStateFn = app.slice(app.indexOf("function saveState(options = {})"), app.indexOf("async function initializeCloudSync()"));
  assert.ok(saveStateFn.includes("syncHomeWidget();"));
  // \r?\n: core.autocrlf=true checks the file out with CRLF on Windows.
  assert.match(app, /render\(\);\r?\ninitializeNativeNotificationActions\(\);/);
  assert.ok(app.includes("syncHomeWidget();"));

  assert.ok(manifest.includes('android:name=".FreeMoneyWidgetProvider"'));
  assert.ok(manifest.includes("android.appwidget.action.APPWIDGET_UPDATE"));
  assert.ok(manifest.includes('android:resource="@xml/free_money_widget_info"'));
  assert.ok(mainActivity.includes("registerPlugin(WidgetBridgePlugin.class);"));
  assert.ok(provider.includes("class FreeMoneyWidgetProvider extends AppWidgetProvider"));
  assert.ok(provider.includes("PREFS_NAME"));
  assert.ok(plugin.includes('@CapacitorPlugin(name = "WidgetBridge")'));
  assert.ok(plugin.includes("public void update(PluginCall call)"));
  assert.ok(widgetInfo.includes("android:initialLayout=\"@layout/widget_free_money\""));
  assert.ok(widgetLayout.includes('android:id="@+id/widget_amount"'));
});

test("progress screen shows behavior insights computed from existing transaction data", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("function weekdaySpendingInsight(summary)"));
  assert.ok(app.includes("function categoryTrendInsight(summary)"));
  assert.ok(app.includes("function smallExpensesInsight(summary)"));
  assert.ok(app.includes("function behaviorInsights(summary = budgetSummary())"));
  assert.ok(app.includes("function renderBehaviorInsights(summary = budgetSummary())"));
  assert.ok(app.includes("function previousPeriodWindow(summary)"));
  assert.ok(app.includes('class="insight-list"'));
  assert.ok(app.includes('class="insight-card"'));
  const progressView = app.slice(app.indexOf("function renderProgressView()"), app.indexOf("function renderIncomeCadenceOptions"));
  assert.ok(progressView.includes("renderBehaviorInsights()"));
  const smallExpenses = app.slice(app.indexOf("function smallExpensesInsight"), app.indexOf("function behaviorInsights"));
  assert.ok(smallExpenses.includes("SMALL_EXPENSE_THRESHOLD"));
  assert.ok(styles.includes(".insight-card"));
  assert.ok(styles.includes('html[data-theme="dark"] .insight-card'));
});

// Redesign: onboarding now asks up front whether income is fixed or variable. Fixed
// income asks for the exact payday (which doubles as periodStart, the period anchor),
// and app.js auto-deposits that income into real liquidity once the period starts,
// with a banner + undo so the user can correct it if it hasn't actually landed yet.
// This is what makes it safe to add real, leftover money into "dinero libre" for
// fixed-income users without repeating the doubling bug: the app always knows,
// explicitly, whether this period's income is already inside the real balance.
test("onboarding asks fixed vs variable income and the payday, and income status persists", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const stateModel = await readFile(new URL("../state-model.js", import.meta.url), "utf8");

  assert.ok(app.includes("¿Tu ingreso es fijo o variable?"));
  assert.ok(app.includes("data-onboarding-income-type=\"fixed\""));
  assert.ok(app.includes("data-onboarding-income-type=\"variable\""));
  assert.ok(app.includes("¿Qué día te pagan?"));

  // Persisted across reload/sync, and reset to null for brand-new accounts.
  assert.ok(stateModel.includes("periodIncomeStatus: null"));
  assert.ok(stateModel.includes("savedState.periodIncomeStatus"));
});

// The future-payday regression (a payday typed as "in 7 days" must not deposit on day
// one) is now a behavior test of resolvePeriodIncome() in finance-core.test.mjs.

// The lock screen gate, wrong/right PIN, the separate device-local storage key and
// "Cambiar PIN" asking for the current PIN are behavior-tested in app-smoke.test.mjs.
// What jsdom can't exercise stays here: the native resume hook and the cooldown wiring.
test("PIN lock re-locks on resume, cools down after repeated failures, and its copy stays honest", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // Auto-lock on resume from background via the already-installed App plugin.
  assert.ok(app.includes("function bindAppLock()"));
  assert.ok(app.includes('appPlugin.addListener("appStateChange"'));
  assert.ok(app.includes("bindAppLock();"));

  // Brute-force cooldown.
  assert.ok(app.includes("LOCK_MAX_ATTEMPTS"));
  assert.ok(app.includes("LOCK_COOLDOWN_MS"));
  assert.ok(app.includes("function lockIsCoolingDown()"));

  assert.ok(styles.includes(".lock-keypad"));
  assert.ok(styles.includes(".lock-dot"));
  assert.ok(styles.includes('html[data-theme="dark"] .lock-key'));

  // Copy must not claim the PIN encrypts/protects data: it only gates the app's UI.
  assert.equal(app.includes("Protege tus finanzas en este dispositivo."), false);
  assert.ok(app.includes("No cifra tus datos guardados en el teléfono."));
});

test("biometric unlock layers on top of the PIN with a native BiometricPrompt plugin", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const mainActivity = await readFile(
    new URL("../android/app/src/main/java/com/estbn05/finanzasconductuales/MainActivity.java", import.meta.url),
    "utf8"
  );
  const plugin = await readFile(
    new URL("../android/app/src/main/java/com/estbn05/finanzasconductuales/BiometricAuthPlugin.java", import.meta.url),
    "utf8"
  );
  const manifest = await readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const buildGradle = await readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8");

  // Native plugin using AndroidX BiometricPrompt.
  assert.ok(plugin.includes('@CapacitorPlugin(name = "BiometricAuth")'));
  assert.ok(plugin.includes("import androidx.biometric.BiometricPrompt"));
  assert.ok(plugin.includes("public void isAvailable(PluginCall call)"));
  assert.ok(plugin.includes("public void authenticate(final PluginCall call)"));
  assert.ok(plugin.includes('setNegativeButtonText("Usar PIN")'));
  assert.ok(mainActivity.includes("registerPlugin(BiometricAuthPlugin.class);"));
  assert.ok(manifest.includes("android.permission.USE_BIOMETRIC"));
  assert.ok(buildGradle.includes("androidx.biometric:biometric"));

  // allowBackup="true" would let Android's Auto Backup upload localStorage (including
  // the Supabase refresh token stored in the clear) to the user's Google Drive, outside
  // any control the PIN lock has.
  assert.ok(manifest.includes('android:allowBackup="false"'));

  // JS: biometric is an optional layer, PIN remains the fallback.
  assert.ok(app.includes("function nativeBiometric()"));
  assert.ok(app.includes("window.Capacitor?.Plugins?.BiometricAuth"));
  assert.ok(app.includes("async function tryBiometricUnlock()"));
  assert.ok(app.includes("async function enableBiometric()"));
  assert.ok(app.includes("function disableBiometric()"));
  assert.ok(app.includes('data-action="enable-biometric"'));
  assert.ok(app.includes('data-action="disable-biometric"'));
  assert.ok(app.includes("data-lock-biometric"));
  // biometric flag persists in the same device-local lock config.
  assert.ok(app.includes("biometric: Boolean(parsed?.biometric)"));
  // A successful biometric prompt clears lockMode just like a correct PIN.
  const tryBio = app.slice(app.indexOf("async function tryBiometricUnlock()"), app.indexOf("async function enableBiometric()"));
  assert.ok(tryBio.includes("biometric.authenticate("));
  assert.ok(tryBio.includes('lockMode = "";'));
});

test("failed login keeps the email and signup distinguishes new accounts from existing ones", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const syncClient = await readFile(new URL("../sync-client.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // The email survives the re-render after a wrong password.
  assert.ok(app.includes("let authEmailDraft"));
  assert.ok(app.includes("authEmailDraft = email;"));
  const authGate = app.slice(app.indexOf("function renderAuthGate()"), app.indexOf("function renderHeader"));
  assert.ok(authGate.includes("const emailValue = escapeAttr(authEmailDraft)"));
  // One shared form template serves both modes, so a single prefilled email input
  // covers sign in and sign up alike. The dedicated "forgot password" screen adds a
  // second occurrence with its own email field.
  assert.equal((authGate.match(/value="\$\{emailValue\}"/g) || []).length, 2);
  // Password is never echoed back.
  assert.equal(authGate.includes('type="password"') && authGate.includes('name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Tu contraseña" value='), false);

  // Supabase returns no error for an already-registered email, so the empty
  // identities array is what distinguishes the two cases.
  assert.ok(syncClient.includes("data.user.identities.length === 0"));
  assert.ok(syncClient.includes("alreadyRegistered"));
  assert.ok(syncClient.includes("needsConfirmation"));
  assert.ok(app.includes("result.alreadyRegistered"));
  assert.ok(app.includes('stopWithNotice({ kind: "exists", email })'));
  assert.ok(app.includes('stopWithNotice({ kind: "sent", email })'));
  // The old ambiguous single message is gone.
  assert.equal(app.includes("Cuenta creada. Revisa tu correo si Supabase pide confirmación."), false);

  // Dedicated screens instead of a bare error dangling under the form.
  assert.ok(app.includes("function renderAuthNoticeCard(notice)"));
  assert.ok(app.includes("Ese correo ya tiene cuenta"));
  assert.ok(app.includes("Revisa tu correo"));
  assert.ok(app.includes("auth-inline-error"));
  assert.equal(authGate.includes('class="form-error auth-error"'), false);
  assert.ok(styles.includes(".auth-notice-card"));
  assert.ok(styles.includes(".auth-inline-error"));
});

// A friend testing the app reported forgetting their password with no way to recover
// it, plus no way to check what they'd typed while signing up. Two independent fixes:
// a password visibility toggle (bound directly to the DOM, never through
// handleAction()/render(), since a full re-render regenerates the uncontrolled
// <input> and would wipe whatever the user had typed), and a real "forgot password"
// screen wired to Supabase's resetPasswordForEmail + a standalone completion page.
test("forgotten passwords can be recovered, and typed passwords can be revealed", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const syncClient = await readFile(new URL("../sync-client.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // Password visibility toggle: bound directly to the DOM (not via handleAction),
  // so it never triggers a re-render that would erase what the user typed.
  assert.ok(app.includes("function bindPasswordToggles(root = document)"));
  assert.ok(app.includes("bindPasswordToggles();"));
  assert.ok(app.includes('data-password-toggle'));
  assert.ok(app.includes('data-password-input'));
  assert.ok(app.includes('input.type = showing ? "password" : "text";'));
  assert.ok(styles.includes(".password-toggle"));

  // Forgot-password request screen, wired to Supabase's resetPasswordForEmail.
  assert.ok(syncClient.includes("export async function requestPasswordReset(email)"));
  assert.ok(syncClient.includes("resetPasswordForEmail(email"));
  assert.ok(syncClient.includes("reset-password.html"));
  assert.ok(app.includes("requestPasswordReset"));
  assert.ok(app.includes("¿Olvidaste tu contraseña?"));
  assert.ok(app.includes("function handleForgotPasswordSubmit(event)"));
  assert.ok(app.includes('data-cloud-forgot-form'));
  assert.ok(app.includes('authNotice = { kind: "reset-sent", email };'));

  // The confirmation card explains next steps instead of leaving the user stuck.
  const noticeCard = app.slice(app.indexOf("function renderAuthNoticeCard(notice)"), app.indexOf("function renderAuthGate()"));
  assert.ok(noticeCard.includes('notice.kind === "reset-sent"'));
});

test("onboarding controls stay legible in dark mode instead of keeping their light cream background", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // These were excluded from the earlier ".modal:not(.onboarding-modal)" dark-mode
  // pass and kept a hardcoded light background (#efe6d8 / var(--soft)) with
  // var(--muted) text, which in dark mode is a color meant for dark surfaces:
  // "Semanal"/"Mensual"/"Paso 1 de 3" rendered nearly invisible.
  assert.ok(styles.includes('html[data-theme="dark"] .onboarding-segmented'));
  assert.ok(styles.includes('html[data-theme="dark"] .onboarding-segmented button.is-active'));
  assert.ok(styles.includes('html[data-theme="dark"] .onboarding-category-chip'));
  assert.ok(styles.includes('html[data-theme="dark"] .onboarding-category-chip.is-active'));
  assert.ok(styles.includes('html[data-theme="dark"] .step-badge'));
});

test("theme follows the OS when the user never picked one, so data-theme cannot contradict prefers-color-scheme", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const stateModel = await readFile(new URL("../state-model.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // The stylesheet themes itself through BOTH mechanisms, so they must always agree.
  assert.ok(styles.includes("@media (prefers-color-scheme: dark)"));
  assert.ok(styles.includes('html[data-theme="dark"]'));

  // A fresh/signed-out state means "follow the system", not a hardcoded light.
  const defaultState = stateModel.slice(stateModel.indexOf("function createDefaultState"), stateModel.indexOf("function migrateState"));
  assert.ok(defaultState.includes('theme: ""'));
  assert.equal(defaultState.includes('theme: "light"'), false);

  assert.ok(app.includes("function systemPrefersDark()"));
  assert.ok(app.includes("function storedThemeChoice()"));
  const themePref = app.slice(app.indexOf("function themePreference()"), app.indexOf("function applyThemePreference()"));
  assert.ok(themePref.includes('storedThemeChoice() || (systemPrefersDark() ? "dark" : "light")'));

  // An explicit choice still wins and still round-trips through migration.
  const migrate = stateModel.slice(stateModel.indexOf("function migrateState"));
  assert.ok(migrate.includes('savedState.settings?.theme === "dark" || savedState.settings?.theme === "light"'));

  // index.html paints before app.js loads, so it needs the same fallback.
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes('stored === "dark" || stored === "light" ? stored : systemTheme()'));

  // Live OS changes apply only while the user has no explicit preference.
  assert.ok(app.includes("if (!storedThemeChoice()) {"));
});

test("sign in and sign up are each their own full screen, not a form unfolding in the landing", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const authGate = app.slice(app.indexOf("function renderAuthGate()"), app.indexOf("function renderHeader"));

  // Picking a mode returns early with a dedicated screen instead of swapping a card
  // inside the landing markup.
  assert.ok(authGate.includes("if (selectedAuthMode) {"));
  assert.ok(authGate.includes('class="auth-gate auth-gate-focused"'));
  assert.ok(authGate.includes('class="auth-screen"'));
  assert.ok(authGate.includes("auth-screen-back"));
  // The landing no longer branches into the forms.
  const landing = authGate.slice(authGate.indexOf('class="auth-landing"'));
  assert.equal(landing.includes("signInForm"), false);
  assert.equal(landing.includes("signUpForm"), false);
  assert.ok(landing.includes("auth-choice-card"));
  // Cross-link so the user can switch mode without going back to the landing.
  assert.ok(authGate.includes("auth-switch-link"));
  // One shared form template drives both modes.
  assert.ok(authGate.includes("const isSignIn = selectedAuthMode"));
  assert.ok(styles.includes(".auth-screen"));
  assert.ok(styles.includes(".auth-switch-link"));
});

test("brand typeface is actually self-hosted, not just named in the font stack", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  const { stat } = await import("node:fs/promises");

  // The font file must really ship: naming a family the device does not have
  // silently falls back to the Android system font (this was the bug before).
  const font = await stat(new URL("../assets/fonts/manrope-latin-var.woff2", import.meta.url));
  assert.ok(font.size > 5000);

  assert.ok(styles.includes("@font-face"));
  assert.ok(styles.includes('font-family: "Manrope"'));
  assert.ok(styles.includes('url("assets/fonts/manrope-latin-var.woff2") format("woff2")'));
  // Variable font covering the weights the UI uses.
  assert.ok(styles.includes("font-weight: 400 800"));
  // Manrope must come first in every stack, otherwise the fallback wins.
  const stacks = styles.match(/font-family:[^;]*Inter[^;]*;/g) || [];
  assert.ok(stacks.length > 0);
  stacks.forEach((stack) => assert.ok(stack.includes('"Manrope"')));
  // Cached for offline use, at the exact unversioned URL the stylesheet requests.
  assert.ok(worker.includes('"assets/fonts/manrope-latin-var.woff2"'));
  // Money figures use tabular numerals so columns align and digits stop jittering.
  assert.ok(styles.includes("font-variant-numeric: tabular-nums"));
});

test("authentication gates onboarding and signed-in users can close their session", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const syncClient = await readFile(new URL("../sync-client.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("function shouldShowAuthGate()"));
  assert.ok(app.includes("function shouldShowSessionCheck()"));
  assert.ok(app.includes("function profileNeedsOnboarding()"));
  assert.ok(app.includes("function cloudStillResolving()"));
  assert.ok(app.includes('cloudState.status === "checking" || cloudState.status === "syncing"'));
  assert.ok(app.includes("return !state.profile.completed && cloudStillResolving();"));
  assert.ok(app.includes("return !state.profile.completed && !cloudStillResolving();"));
  assert.ok(app.includes("const LOCAL_STATE_POLL_DURATION_MS = 1_500;"));
  assert.ok(app.includes("function pollLocalStateUntilStable(deadline)"));
  assert.ok(app.includes("window.requestAnimationFrame(() => pollLocalStateUntilStable(deadline));"));
  assert.ok(app.includes("${profileNeedsOnboarding() || state.showDiagnosis ? renderDiagnosisModal() : \"\"}"));
  assert.ok(app.includes("function renderSessionCheck()"));
  assert.ok(app.includes("function renderAuthGate()"));
  assert.ok(app.includes("AUTH_STARTUP_TIMEOUT_MS = 8_000"));
  assert.ok(app.includes("function recoverAuthStartup()"));
  assert.ok(app.includes('data-action="recover-auth"'));
  assert.ok(app.includes('"recover-auth": recoverAuthStartup'));
  assert.equal(app.includes('data-action="reload-app"'), false);
  assert.ok(app.includes("if (!cloudState.sessionReady) {"));
  // Offline-first: signedIn=false must not gate the app when local data already
  // proves this device was previously authenticated — only a real sign-out (which
  // wipes local data via clearLocalUserState()) should show the login wall.
  const authGateFn = app.slice(app.indexOf("function shouldShowAuthGate()"), app.indexOf("function profileNeedsOnboarding()"));
  assert.ok(authGateFn.includes("if (!cloudState.sessionReady || cloudState.signedIn) {"));
  assert.ok(authGateFn.includes("return !hasMeaningfulLocalData(state);"));
  assert.ok(app.includes("Estamos verificando automáticamente si ya tienes una sesión iniciada."));
  assert.ok(app.includes("Continuar al acceso"));
  assert.equal(app.includes("Estamos cargando tu cuenta y tus datos antes de mostrar el formulario inicial."), false);
  const renderFunction = app.slice(app.indexOf("function render()"), app.indexOf("function renderNavItem"));
  assert.ok(renderFunction.indexOf("if (shouldShowSessionCheck())") < renderFunction.indexOf("if (shouldShowAuthGate())"));
  assert.ok(renderFunction.includes("bindEvents();"));
  assert.ok(renderFunction.indexOf("if (shouldShowAuthGate())") < renderFunction.indexOf("const plan = calculatePlan();"));
  // The theme must be applied BEFORE the early returns. The session-check, auth and
  // lock screens never reach the main branch, so applying it later left them on
  // whatever data-theme index.html guessed, which contradicted the
  // prefers-color-scheme rules and rendered both themes at once.
  assert.ok(renderFunction.indexOf("applyThemePreference()") < renderFunction.indexOf("if (shouldShowSessionCheck())"));
  const sessionCheck = app.slice(app.indexOf("function renderSessionCheck()"), app.indexOf("function renderAuthGate()"));
  assert.equal(sessionCheck.includes("cloud-login-form"), false);
  assert.ok(app.includes("Entiende tu dinero antes de gastarlo"));
  assert.ok(app.includes("Dinero libre visible"));
  assert.ok(app.includes("Plan por categorías"));
  assert.ok(app.includes("Sincronización segura"));
  assert.ok(app.includes('let authMode = ""'));
  assert.ok(app.includes('data-action="show-auth-form"'));
  assert.ok(app.includes('data-action="back-auth-options"'));
  assert.ok(app.includes('data-auth-mode="signin"'));
  assert.ok(app.includes('data-auth-mode="signup"'));
  assert.ok(app.includes('const selectedAuthMode = ["signin", "signup", "forgot"].includes(authMode) ? authMode : ""'));
  // Both modes now come from one shared full-screen template driven by isSignIn.
  assert.ok(app.includes('const isSignIn = selectedAuthMode === "signin"'));
  assert.ok(app.includes('id="cloud-${isSignIn ? "signin" : "signup"}-form"'));
  assert.ok(app.includes('data-cloud-mode="${isSignIn ? "signin" : "signup"}"'));
  assert.ok(app.includes("document.querySelectorAll(\"[data-cloud-auth-form]\")"));
  assert.ok(app.includes("event.currentTarget.dataset.cloudMode"));
  // The landing still offers both entry points.
  assert.ok(app.includes(">Registrarse</button>"));
  assert.ok(app.includes(">Iniciar sesión</button>"));
  assert.equal(app.includes('id="cloud-login-form"'), false);
  assert.equal(app.includes(">Ya tengo cuenta: iniciar sesión</button>"), false);
  assert.ok(app.includes('data-action="cloud-sign-out">Cerrar sesión'));
  assert.ok(app.includes("function clearLocalUserState()"));
  assert.ok(app.includes('data-action="open-delete-account">Eliminar cuenta'));
  assert.ok(app.includes("function renderDeleteAccountConfirmation()"));
  assert.ok(app.includes('data-action="confirm-delete-account">Eliminar cuenta y datos</button>'));
  assert.ok(app.includes('data-action="cancel-delete-account">Cancelar</button>'));
  assert.ok(syncClient.includes("export async function deleteCloudAppState()"));
  assert.ok(syncClient.includes('cloud.from("finance_app_state").delete().eq("user_id", userId)'));
  // Full account deletion (auth user + data) goes through the server-side Edge
  // Function, since the anon key cannot delete an auth user. The client calls it and
  // only falls back to data-only deletion if the function isn't deployed yet.
  assert.ok(syncClient.includes("export async function deleteCloudAccount()"));
  assert.ok(syncClient.includes("/functions/v1/delete-account"));
  const deleteAccountHandler = app.slice(app.indexOf("async function handleDeleteAccount()"), app.indexOf("async function handleDeleteAccount()") + 1800);
  assert.ok(deleteAccountHandler.indexOf("deleteCloudAccount()") < deleteAccountHandler.indexOf("clearLocalUserState()"));
  assert.ok(deleteAccountHandler.includes("deleteCloudAppState()"));
  assert.ok(deleteAccountHandler.includes("cloudState.status = \"error\""));
  assert.ok(app.includes("clearStoredCloudSession()"));
  assert.ok(app.includes("previousEmail !== nextEmail"));
  assert.ok(app.includes("cloudState.sessionReady = true"));
  const pullCloud = app.slice(app.indexOf("async function pullCloudAfterLogin"), app.indexOf("function scheduleCloudSave"));
  assert.equal(pullCloud.includes("cloudState.sessionReady = false"), false);
  assert.ok(syncClient.includes("CLOUD_TIMEOUT_MS = 10_000"));
  assert.ok(syncClient.includes("SESSION_RETRY_DELAY_MS = 350"));
  assert.ok(syncClient.includes('SESSION_BACKUP_KEY = "finanzas-conductuales:cloud-session:v1"'));
  assert.ok(syncClient.includes("function isCurrentSessionBackup(session)"));
  assert.ok(syncClient.includes("lock: window.supabase.processLock"));
  assert.ok(syncClient.includes("lockAcquireTimeout: 4_000"));
  assert.ok(syncClient.includes("attempt < 2"));
  assert.ok(syncClient.includes("cloud.auth.setSession(backup)"));
  assert.ok(syncClient.includes("return backup;"));
  assert.ok(syncClient.includes("persistSessionBackup(data.session)"));
  assert.ok(syncClient.includes("export function clearStoredCloudSession()"));
  assert.ok(syncClient.includes("setTimeout(() => callback(session, event), 0)"));
  const authChange = app.slice(app.indexOf("authUnsubscribe = onCloudAuthChange"), app.indexOf("if (session) {", app.indexOf("authUnsubscribe = onCloudAuthChange")));
  assert.ok(authChange.includes("clearLocalUserState()"));
  assert.ok(authChange.includes("onCloudAuthChange((nextSession, event) =>"));
  assert.ok(authChange.includes('else if (event === "SIGNED_OUT")'));
  assert.ok(syncClient.includes("withCloudTimeout"));
  assert.ok(syncClient.includes("Comprobar la sesión"));
  assert.ok(styles.includes(".auth-gate"));
  assert.ok(styles.includes(".auth-landing"));
  assert.ok(styles.includes(".auth-benefits"));
  assert.ok(styles.includes(".auth-actions"));
  assert.ok(styles.includes(".auth-choice-actions"));
  assert.ok(styles.includes(".auth-back"));
  assert.ok(styles.includes(".auth-card"));
  assert.ok(styles.includes(".session-check"));
  assert.equal(styles.includes(".auth-recovery-actions"), false);
});

// Regression: signing out set cloudState.sessionReady = false and awaited the cloud
// save + Supabase sign-out BEFORE clearing local session state, so the app showed the
// "Comprobando tu sesión" startup screen (with its "Continuar al acceso" impatience
// button) during sign-out too. Tapping that button while signedIn was still true
// dropped the user back into the still-authenticated app for a few seconds, until the
// background sign-out finally finished and yanked them back out — the "entra un
// momento y despues sale" a friend reported on video. Fix: clear local session state
// (and render the access screen) synchronously, before any awaited network call.
test("signing out drops to the access screen instantly, with cloud cleanup only as best-effort afterward", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  const fn = app.slice(app.indexOf("async function handleCloudSignOut()"), app.indexOf("async function handleDeleteAccount()"));
  const firstAwaitIndex = fn.indexOf("await ");
  const clearedBeforeAnyAwait =
    fn.indexOf("cloudState.signedIn = false;") < firstAwaitIndex &&
    fn.indexOf("cloudState.sessionReady = true;") < firstAwaitIndex &&
    fn.indexOf("clearLocalUserState();") < firstAwaitIndex &&
    fn.indexOf("render();") < firstAwaitIndex;
  assert.ok(clearedBeforeAnyAwait, "local session state must be cleared and rendered before the first awaited cloud call");
  // The old blocking flag is gone from this function entirely.
  assert.equal(fn.includes('cloudState.sessionReady = false;'), false);
});

test("static startup fallback retries automatically without manual controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(html.includes('class="startup-fallback"'));
  assert.ok(html.includes('const retryKey = "finanzas-startup-retry"'));
  assert.ok(html.includes("window.location.reload()"));
  assert.ok(html.includes("window.pwaCleanupReady"));
  assert.ok(html.includes(`const APP_VERSION = "${ASSET_VERSION}"`));
  assert.ok(html.includes("const APP_CACHE_NAME"));
  assert.ok(html.includes("caches.keys()"));
  assert.ok(html.includes("controllerchange"));
  assert.ok(html.includes('"SKIP_WAITING"'));
  assert.ok(html.includes("service-worker.js?v=${APP_VERSION}"));
  assert.ok(html.includes("registration.update().catch(() => {})"));
  assert.equal(html.includes("registration.unregister()"), false);
  assert.ok(html.includes("caches.delete(key)"));
  assert.ok(html.includes("Comprobando tu sesión"));
  assert.ok(html.includes("Estamos verificando automáticamente si ya tienes una sesión iniciada."));
  assert.ok(html.includes("loadScript(`vendor/supabase-2.108.1.min.js?v=${APP_VERSION}`)"));
  assert.ok(html.includes("window.setTimeout(finish, timeoutMs)"));
  assert.equal(html.includes("cdn.jsdelivr.net/npm/@supabase/supabase-js"), false);
  assert.ok(html.includes("await import(`./app.js?v=${APP_VERSION}`)"));
  assert.ok(html.includes("No pude iniciar la app"));
  assert.ok(html.includes("instala la última versión del APK"));
  assert.equal(html.includes("Continuar al acceso"), false);
  assert.equal(html.includes("Recargar aplicación"), false);
  assert.equal(html.includes('onclick="window.location.reload()"'), false);
  assert.ok(styles.includes(".startup-fallback-card"));
});

// The 12-digit cap itself is behavior-tested in app-smoke.test.mjs. This guards the CSS
// side: long formatted numbers must wrap instead of pushing the screen sideways.
test("long money figures wrap instead of overflowing the screen", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  const onboardingStart = styles.indexOf(".onboarding-preview strong {");
  const onboardingPreview = styles.slice(onboardingStart, styles.indexOf("}", onboardingStart));
  assert.ok(onboardingPreview.includes("overflow-wrap: anywhere"));
  assert.ok(onboardingPreview.includes("min-width: 0"));

  const conversionStart = styles.indexOf(".conversion-box strong {");
  const conversionBox = styles.slice(conversionStart, styles.indexOf("}", conversionStart));
  assert.ok(conversionBox.includes("overflow-wrap: anywhere"));
  assert.ok(conversionBox.includes("min-width: 0"));
});

test("opening an expense form does not trigger cloud sync or replace active forms", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes('const interfaceOnlyActions = new Set(['));
  assert.ok(app.includes('"open-expense"'));
  assert.ok(app.includes("!interfaceOnlyActions.has(action)"));
  assert.ok(app.includes("function renderCloudStatusChange()"));
  // renderCloudStatusChange ya no lleva su propia lista de superficies abiertas: esa
  // copia se quedo corta (le faltaban planSheet y el onboarding). Ahora delega en
  // hasOpenUserInput(), que es la unica definicion.
  assert.equal(app.includes("quickExpenseOpen || state.showDiagnosis || pendingExtraAllocation"), false);
  assert.ok(app.includes("function hasOpenUserInput()"));
  assert.ok(app.includes("saveState({ sync: false, touch: false });"));
});

// Regresion: render() reconstruye el DOM entero (app.innerHTML = ...) y los formularios
// son no controlados, asi que lo escrito vive solo en el DOM. Cualquier render que el
// usuario no pidio se lo borraba. Los disparadores reales eran mucho mas frecuentes que
// un corte de red: el temporizador de 8s del "Deshacer" y, peor, el aviso de validacion
// ("Efectivo solo tiene $X"), que limpiaba el gasto que el usuario debia corregir.
test("background re-renders never wipe a form the user is filling in", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const guard = app.slice(app.indexOf("function hasOpenUserInput()"), app.indexOf("function renderBackground()"));

  for (const surface of [
    "quickExpenseOpen",
    "planSheet",
    "state.showDiagnosis",
    "profileNeedsOnboarding()",
    "pendingExtraAllocation",
    "editingTransactionId",
    "editingExtraId",
    "quickClassifyQueue.length",
    "pendingJobRemovalId",
    "deleteAccountOpen"
  ]) {
    assert.ok(guard.includes(surface), `hasOpenUserInput() debe cubrir ${surface}`);
  }

  // Los eventos incidentales no pueden llamar a render() directamente.
  assert.ok(app.includes('window.addEventListener("online", renderBackground)'));
  assert.ok(app.includes('window.addEventListener("offline", renderBackground)'));
  assert.equal(app.includes('window.addEventListener("online", render)'), false);
  assert.equal(app.includes('window.addEventListener("offline", render)'), false);

  // Mostrar u ocultar un aviso toca solo su nodo, nunca la app entera.
  assert.ok(app.includes("function paintSnackbar()"));
  const snackbars = app.slice(app.indexOf("function showNoticeSnackbar("), app.indexOf("function paintSnackbar()"));
  assert.ok(snackbars.includes("paintSnackbar();"));
  assert.equal(/\n\s+render\(\);/.test(snackbars), false, "el snackbar no debe llamar a render()");
});

test("Android back navigation closes the quick expense form before leaving the app", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes('const QUICK_EXPENSE_HASH = "registrar-gasto"'));
  assert.ok(app.includes('window.addEventListener("popstate", syncQuickExpenseWithLocation)'));
  assert.ok(app.includes("window.location.hash = QUICK_EXPENSE_HASH"));
  assert.ok(app.includes("function resetQuickExpenseAfterLogin()"));
  assert.ok(app.includes("resetQuickExpenseAfterLogin();"));
  assert.ok(app.includes("window.history.back();"));
  assert.ok(app.includes("function openQuickExpense()"));
  assert.ok(app.includes("function closeQuickExpense()"));
  assert.ok(app.includes("function isQuickExpenseLocation()"));
  assert.ok(app.includes("normalizeStartupRoute();"));
  assert.ok(app.includes("function normalizeStartupRoute()"));
  assert.ok(app.includes("let quickExpenseOpen = false;"));
  assert.equal(app.includes("function seedQuickExpenseBackEntry()"), false);
  assert.ok(app.includes("window.history.replaceState(historyState"));
  assert.equal(app.includes("required autofocus"), false);
});

// The home screen widget's "+" button jumps straight to "Registrar gasto" instead of
// just opening the app. It works via a finanzasconductuales://registrar-gasto deep
// link (AndroidManifest intent-filter + FreeMoneyWidgetProvider's second
// PendingIntent), consumed on the JS side through @capacitor/app's appUrlOpen +
// getLaunchUrl(), matching the exact scheme/host declared natively.
test("the widget's quick-add button deep links straight into the expense form", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const manifest = await readFile(
    new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8"
  );
  const widgetProvider = await readFile(
    new URL("../android/app/src/main/java/com/estbn05/finanzasconductuales/FreeMoneyWidgetProvider.java", import.meta.url),
    "utf8"
  );
  const widgetLayout = await readFile(
    new URL("../android/app/src/main/res/layout/widget_free_money.xml", import.meta.url),
    "utf8"
  );

  // Native side: manifest intent-filter and the widget's own PendingIntent must agree
  // on the exact scheme/host.
  assert.ok(manifest.includes('android:scheme="finanzasconductuales"'));
  assert.ok(manifest.includes('android:host="registrar-gasto"'));
  assert.ok(manifest.includes('android.intent.action.VIEW'));
  assert.ok(widgetProvider.includes('QUICK_ADD_URI = "finanzasconductuales://registrar-gasto"'));
  assert.ok(widgetProvider.includes("Intent.ACTION_VIEW"));
  // Two distinct PendingIntents (different request codes) so the info area and the
  // "+" button don't collapse into a single tap target that only does one of the two.
  assert.ok(widgetProvider.includes("PendingIntent.getActivity(\n            context,\n            0,"));
  assert.ok(widgetProvider.includes("PendingIntent.getActivity(\n            context,\n            1,"));
  assert.ok(widgetProvider.includes("setOnClickPendingIntent(R.id.widget_info, openIntent)"));
  assert.ok(widgetProvider.includes("setOnClickPendingIntent(R.id.widget_quick_add, quickAddPendingIntent)"));
  assert.ok(widgetLayout.includes('android:id="@+id/widget_quick_add"'));
  assert.ok(widgetLayout.includes('android:id="@+id/widget_info"'));

  // JS side: matching host constant, listener registration on startup, and both the
  // warm-start (appUrlOpen) and cold-start (getLaunchUrl) paths are covered.
  assert.ok(app.includes('const WIDGET_QUICK_ADD_HOST = "registrar-gasto";'));
  assert.ok(app.includes("function routeIfWidgetQuickAddUrl(url)"));
  assert.ok(app.includes("new URL(url).host === WIDGET_QUICK_ADD_HOST"));
  assert.ok(app.includes("window.location.hash = QUICK_EXPENSE_HASH;"));
  assert.ok(app.includes("function initializeWidgetQuickAddDeepLink()"));
  assert.ok(app.includes('capacitorApp.addListener("appUrlOpen"'));
  assert.ok(app.includes(".getLaunchUrl?.()"));
  assert.ok(app.includes("initializeWidgetQuickAddDeepLink();"));
  assert.ok(app.includes("function nativeCapacitorApp()"));
  assert.ok(app.includes('window.Capacitor?.Plugins?.App'));

  // normalizeStartupRoute must only clear a stale #registrar-gasto hash on its very
  // first check. Without a run-once guard, the pollLocalStateUntilStable loop (which
  // re-checks for up to LOCAL_STATE_POLL_DURATION_MS while cloud sync settles) calls
  // normalizeStartupRoute again and wipes out the hash this deep link sets asynchronously
  // moments after startup, silently sending the widget's "+" button back to the home view.
  assert.ok(app.includes("let startupRouteNormalized = false;"));
  assert.match(
    app,
    /function normalizeStartupRoute\(\) \{\s*if \(startupRouteNormalized\) \{\s*return;\s*\}\s*startupRouteNormalized = true;/
  );

  // applyRemoteState runs on essentially every logged-in cold start (via
  // pullCloudAfterLogin) and used to unconditionally call activateView(DEFAULT_VIEW),
  // which resets window.location.hash back to "#inicio" — clobbering the "#registrar-gasto"
  // hash the widget's deep link sets moments earlier via the async getLaunchUrl() call.
  assert.match(
    app,
    /function applyRemoteState\([\s\S]*?if \(!isQuickExpenseLocation\(\)\) \{\s*activateView\(DEFAULT_VIEW\);\s*\}/
  );
});

test("apartar dinero reserves money in plain language without moving real balances", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // Two doors, one sheet: Inicio and Plan both open the same plain-language flow.
  assert.ok(app.includes("function renderSetAsideSheet()"));
  assert.ok(app.includes('planSheet = "setaside";'));
  assert.ok(app.includes('if (planSheet === "setaside")'));
  const homeView = app.slice(app.indexOf("function renderToday"), app.indexOf("function renderPeriodPredictionCard"));
  assert.ok(homeView.includes('data-action="open-setaside-sheet"'));
  // Plan's category list used to show both "Apartar dinero" and "Apartar cada semana
  // o mes" as two buttons side by side with no explanation of when to pick which. Now
  // it's one "Nueva categoría" entry that opens a chooser sheet asking the actual
  // question, which then routes to whichever of the two forms fits — neither form's
  // own behavior (or the Inicio shortcut straight into setaside) changed.
  const planView = app.slice(app.indexOf("function renderBudget(plan)"), app.indexOf("function renderPeriodCloseCard"));
  assert.ok(planView.includes('data-action="open-add-category-choice"'));
  // The recurring path is no longer directly clickable from Plan — only reachable
  // through the chooser now. The empty-state "Apartar dinero" quick-start CTA still
  // jumps straight to setaside, unchanged — that's a distinct first-run nudge, not
  // part of the two-buttons-side-by-side ambiguity that got consolidated.
  assert.equal(planView.includes('data-action="open-category-sheet"'), false);

  assert.ok(app.includes("function renderAddCategoryChoiceSheet()"));
  assert.ok(app.includes('planSheet = "add-category-choice";'));
  assert.ok(app.includes('if (planSheet === "add-category-choice")'));
  const choiceSheet = app.slice(app.indexOf("function renderAddCategoryChoiceSheet"), app.indexOf("function renderSetAsideSheet"));
  // The recurring path (with its frequency question) must stay reachable alongside it.
  assert.ok(choiceSheet.includes('data-action="open-setaside-sheet"'));
  assert.ok(choiceSheet.includes('data-action="open-category-sheet"'));

  // Asks only how much and what for — deliberately no frequency question, unlike
  // renderBudgetJobForm, because "aparté esto ahora" means once, this period.
  const sheet = app.slice(app.indexOf("function renderSetAsideSheet"), app.indexOf("function renderPlanSheet"));
  assert.ok(sheet.includes("¿Cuánto quieres apartar?"));
  assert.ok(sheet.includes("¿Para qué es?"));
  assert.equal(sheet.includes('renderChoicePills("cadence"'), false);
  // The app never moves real money, so the sheet has to say so where the user can see it.
  assert.ok(sheet.includes("aquí no se mueve dinero de verdad"));
  assert.ok(sheet.includes('type="button" data-setaside-name='));

  // A weekly/monthly category multiplies its amount across the period (budgetAmountForJob),
  // so a one-off set-aside must never be summed straight onto one — that would reserve
  // several times what was asked for. Only a "period" category can absorb it directly.
  const target = app.slice(app.indexOf("function setAsideTarget"), app.indexOf("function handleSetAsideSubmit"));
  assert.ok(target.includes('if (match.cadence === "period")'));
  assert.ok(target.includes("`${name} extra`"));

  const submit = app.slice(app.indexOf("function handleSetAsideSubmit"), app.indexOf("function reduceSavingsAllocation"));
  assert.ok(submit.includes("amount > summary.freeRemaining"));
  assert.ok(submit.includes('cadence: "period"'));
  assert.ok(submit.includes("state.budgetJobs.length >= 10"));

  // Picking a suggestion chip runs through a direct listener rather than data-action:
  // handleAction re-renders the view, which would rebuild the uncontrolled inputs and
  // wipe an amount the user already typed before choosing a name.
  const preview = app.slice(app.indexOf("function bindSetAsidePreview"), app.indexOf("function bindSavingsSimulatorPreview"));
  assert.ok(preview.includes('chip.addEventListener("click"'));
  assert.ok(preview.includes("[data-setaside-name]"));

  assert.ok(styles.includes(".setaside-action"));

  // A primary button that is disabled must not still look like a live one. `.btn.primary`
  // declares its green gradient after `.btn:disabled`, so without an explicit override a
  // blocked "Apartar dinero" / "Agregar categoría" renders identically to an enabled one
  // and the tap just silently does nothing.
  assert.match(styles, /\.btn\.primary:disabled[\s\S]{0,200}background: #d7dad6 !important/);

  // The set-aside subtitle is intentionally darker than var(--muted), which only reaches
  // 4.35:1 on this panel — below the 4.5:1 AA floor.
  assert.match(styles, /\.setaside-action small \{[\s\S]{0,80}color: #4d574f/);
});

test("every form keeps readable controls in Android PWA themes", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // The first .plan-action ("Registrar dinero extra") gets a light green gradient from a
  // later block, but an earlier rule had left its title near-white (#fff9ee) for the dark
  // background that block replaced — leaving white-on-light-green. `strong` has to be
  // repainted alongside `small`/`b` or the button's own title is the hardest part to read.
  assert.match(styles, /\.plan-action:first-child strong \{[\s\S]{0,300}color: #052a22 !important;/);

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
  assert.match(styles, /\.history-row,[\s\S]*background: var\(--panel\)/);
  assert.equal(styles.includes("background: #fffdf8;"), false);
  assert.match(styles, /\.quick-amount input\[data-money-input="true"\]\s*{[\s\S]*background: transparent !important/);
});

test("behavioral finance, silent sync, undo and automatic backups remain available", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(app.includes("Gasto registrado."));
  assert.ok(app.includes("Deshacer?"));
  assert.ok(app.includes('"undo-snackbar"'));
  assert.ok(app.includes("savingsPercent"));
  assert.ok(app.includes("function renderCooldownPanel"));
  assert.ok(app.includes("Compras en pausa"));
  assert.ok(app.includes('"cancel-cooldown"'));
  assert.ok(app.includes('"unlock-cooldown"'));
  // La decisión de subir/bajar vive en state-model.js (decideLoginSync /
  // decidePushSync, probadas por comportamiento en state-model.test.mjs, incluido el
  // caso del reloj del teléfono atrasado). app.js solo debe usarlas.
  assert.ok(app.includes("decideLoginSync(state, remote)"));
  assert.ok(app.includes('decidePushSync(state, remote) === "download"'));
  assert.ok(app.includes("BACKUP_KEY"));
  assert.ok(app.includes("saveLocalBackup"));
  assert.ok(app.includes("function menuAlertText()"));
  assert.equal(app.includes("function renderCloudStatus()"), false);
  assert.equal(app.includes("Cuenta y nube"), false);
  assert.equal(app.includes("function renderAccountPanel()"), false);
  assert.ok(app.includes("liquiditySummary"));
  assert.ok(app.includes("adjustLiquidity"));
  assert.ok(app.includes("validateTransactionDraft"));
  assert.ok(app.includes("remove-transaction"));
  assert.equal(app.includes("clearCurrentPeriodExtras"), false);
  assert.ok(app.includes("renderTransactionHistory"));
  assert.ok(!app.includes("state.transactions = []"));
});

test("manual local backup and account plus cash panels are not shown", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const budget = app.slice(app.indexOf("function renderBudget("), app.indexOf("function renderBudgetJobForm"));
  const profile = app.slice(app.indexOf("function renderProfile("), app.indexOf("function renderIncomeCadenceOptions"));

  assert.equal(budget.includes("renderLiquidityCard"), false);
  assert.equal(budget.includes("Disponible por lugar"), false);
  assert.equal(profile.includes("Tus datos locales"), false);
  assert.equal(profile.includes("export-data"), false);
  assert.equal(profile.includes("import-file"), false);
  assert.equal(profile.includes("reset-demo"), false);
  assert.equal(app.includes("function renderLiquidityCard"), false);
  assert.equal(app.includes("function renderBackupTools"), false);
});

test("plan distribution uses one matching segment per non-overlapping amount", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("getBudgetRingAllocation(summary)"));
  assert.ok(app.includes("function renderBudgetRingChart("));
  assert.ok(app.includes("function donutSegmentPath("));
  assert.ok(app.includes('label: "Reservado"'));
  assert.ok(app.includes('label: "Gastado"'));
  assert.ok(app.includes('label: "Libre"'));
  assert.equal(app.includes('renderAllocation("Apartado sin gastar"'), false);
  assert.equal(app.includes('renderAllocation("Libre antes de gastos"'), false);
  assert.ok(styles.includes(".budget-ring-svg"));
  assert.ok(styles.includes(".budget-ring-arc"));
  assert.ok(styles.includes(".budget-ring-line"));
});

test("savings remains advisory and debt features are removed", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../finance-core.js", import.meta.url), "utf8");

  assert.ok(app.includes("Orientativo"));
  assert.ok(app.includes("No mueve dinero"));
  assert.ok((await readFile(new URL("../styles.css", import.meta.url), "utf8")).includes("Savings hero tag contrast v12"));
  assert.ok(app.includes("suggestedPeriodSavings"));
  assert.ok(core.includes("savingsCapacityGap"));
  assert.ok(core.includes("savingsReserved"));
  assert.equal(/debt|deuda/i.test(app), false);
  assert.equal(/debt|deuda/i.test(core), false);
});

test("mockup system covers progressive plan, correction and special states", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("function renderPlanSheet()"));
  assert.ok(app.includes("data-category-conversion"));
  assert.ok(app.includes("data-category-limit-warning"));
  assert.ok(app.includes("function renderJobRemovalConfirmation()"));
  assert.ok(app.includes("gastos quedarán"));
  assert.ok(app.includes("function renderTransactionEditor()"));
  assert.ok(app.includes('id="transaction-edit-form"'));
  assert.ok(app.includes("function renderConnectionBanner()"));
  assert.ok(app.includes("Tus datos locales siguen disponibles."));
  assert.ok(app.includes('type="range" min="0" max="100"'));
  assert.ok(app.includes("Plan básico"));
  assert.ok(app.includes("<strong>Saldos</strong>"));
  assert.ok(app.includes("data-onboarding-skip"));
  assert.ok(styles.includes(".sheet-backdrop"));
  assert.ok(styles.includes(".destructive-consequence"));
  assert.ok(styles.includes(".history-row.is-unclassified"));
  assert.ok(styles.includes(".connection-banner"));
  assert.ok(styles.includes("Visual redesign 2026"));
  assert.ok(styles.includes("--card-shadow"));
});

// Tap-outside-to-close is behavior-tested in app-smoke.test.mjs. jsdom can't drive
// Escape through the focus trap reliably, so its coverage stays here.
test("Escape closes every dismissable surface and close buttons meet the 44px touch target", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  // closeTopDialog() (used by Escape) must cover every dismissable surface, not just
  // the 7 it originally had — delete-account, backup restore, quick-classify,
  // prediction details and the period report were all missing.
  const closeTopDialogFn = app.slice(app.indexOf("function closeTopDialog()"), app.indexOf("function firstFocusable"));
  assert.ok(closeTopDialogFn.includes("if (pendingBackupRestoreId) {"));
  assert.ok(closeTopDialogFn.includes("if (deleteAccountOpen) {"));
  assert.ok(closeTopDialogFn.includes("if (quickClassifyQueue.length) {"));
  assert.ok(closeTopDialogFn.includes("if (predictionDetailsOpen) {"));
  assert.ok(closeTopDialogFn.includes("if (periodReportOpen) {"));

  // 34px was below the 44px minimum touch target, and these are the close buttons on
  // every sheet/modal in the app.
  const iconBtnSizeFn = styles.slice(styles.lastIndexOf(".icon-btn {"), styles.indexOf(".icon-btn.muted"));
  assert.ok(iconBtnSizeFn.includes("width: 44px;"));
  assert.ok(iconBtnSizeFn.includes("height: 44px;"));
});

test("drawer visual system keeps menu contrast in mobile themes", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(styles.includes("Visual redesign v2: stronger identity, fixed drawer contrast"));
  assert.ok(styles.includes("--ledger-deep"));
  assert.ok(styles.includes("--ledger-glow"));
  assert.match(styles, /\.app-shell\.is-menu-open \.drawer-scrim\s*{[\s\S]*backdrop-filter: blur\(8px\)/);
  assert.match(styles, /\.sidebar\s*{[\s\S]*linear-gradient\(180deg, #15231f 0%, #0b2c26 58%, #061f1b 100%\)/);
  assert.match(styles, /\.brand strong\s*{[\s\S]*color: #fff7e8/);
  assert.match(styles, /\.nav-item\s*{[\s\S]*color: rgba\(255, 247, 232, 0\.68\)/);
  assert.match(styles, /\.nav-item:hover,[\s\S]*\.nav-item\.is-active\s*{[\s\S]*color: #fff7e8/);
  assert.match(styles, /\.nav-item\.is-active \.nav-number\s*{[\s\S]*background: linear-gradient\(145deg, #7ee8c4, #47d6a6\)/);
  assert.match(styles, /\.menu-tools \.btn\.ghost\s*{[\s\S]*color: rgba\(255, 247, 232, 0\.78\)/);
  assert.match(styles, /Sidebar ghost button dark contrast v14[\s\S]*html\[data-theme="dark"\] \.sidebar \.menu-tools \.btn\.ghost[\s\S]*background: rgba\(255, 255, 255, 0\.07\) !important/);
  assert.match(styles, /Mobile drawer scroll fix v11[\s\S]*\.app-shell\.is-menu-open \.sidebar\s*{[\s\S]*height: 100dvh[\s\S]*touch-action: pan-y/);
  assert.match(styles, /\.app-shell\.is-menu-open \.nav-panel,[\s\S]*\.app-shell\.is-menu-open \.nav-panel\.is-open\s*{[\s\S]*overflow-y: auto !important[\s\S]*padding-bottom: calc\(116px \+ env\(safe-area-inset-bottom, 0px\)\)/);
});

// Regression: extracting state-model.js out of app.js left it out of the mobile build's
// file list, so the APK shipped an app.js whose import 404'd and the app never booted.
// Every local module app.js imports must be copied into www/.
test("mobile build ships every local module app.js imports", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const buildScript = await readFile(new URL("../scripts/build-mobile.mjs", import.meta.url), "utf8");
  const localImports = [...app.matchAll(/from "\.\/([\w-]+\.js)\?v=/g)].map((match) => match[1]);

  assert.ok(localImports.includes("state-model.js"));
  for (const file of localImports) {
    assert.ok(buildScript.includes(`"${file}"`), `${file} is imported by app.js but missing from build-mobile.mjs`);
  }
});
