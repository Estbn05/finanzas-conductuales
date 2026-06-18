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

test("service worker caches the app shell and serves an offline navigation fallback", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");

  assert.ok(worker.includes('CACHE_PREFIX = "finanzas-conductuales-"'));
  assert.ok(worker.includes("CACHE_NAME"));
  assert.ok(worker.includes("cache.addAll(APP_SHELL)"));
  assert.ok(worker.includes('app.js?v=20260618-auth-buttons'));
  assert.ok(worker.includes('request.mode === "navigate"'));
  assert.ok(worker.includes("fetch(request)"));
  assert.ok(worker.includes("caches.delete(key)"));
  assert.ok(worker.includes("self.clients.claim()"));
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
  assert.ok(app.includes('{ id: "movements", label: "Movimientos", icon: "04" }'));
  assert.ok(app.includes('data-action="open-expense"'));
  assert.ok(app.includes('data-action="close-expense"'));
  assert.ok(app.includes('class="quick-expense-panel"'));
  assert.ok(app.includes('id="transaction-form"'));
  assert.ok(app.includes('data-choice-value="${escapeAttr(option.value)}"'));
  assert.ok(app.includes('role="radio" aria-checked='));
  assert.ok(app.includes('const APP_VIEWS = new Set'));
  assert.ok(app.includes('APP_VIEWS.has(view)'));
  assert.ok(app.includes('name="budgeted" type="checkbox" checked'));
  assert.ok(app.includes("money-location-chips"));
  assert.ok(app.includes("Cuenta"));
  assert.ok(app.includes("Efectivo"));
  assert.ok(app.includes("Total real"));

  const todayView = app.slice(app.indexOf("function renderToday"), app.indexOf("function renderTransactionLabeler"));
  assert.ok(todayView.includes("Categorias del periodo"));
  assert.equal(todayView.includes("Movimientos del periodo"), false);
  assert.equal(todayView.includes("Fondo inicial"), false);
  assert.equal(todayView.includes("Pago recomendado"), false);

  const fullTodayView = app.slice(app.indexOf("function renderToday"), app.indexOf("function renderTransactionLabeler"));
  assert.equal(fullTodayView.includes("Ahora"), false);
  assert.equal(fullTodayView.includes("Revision rapida"), false);
  assert.equal(fullTodayView.includes("complete-checkin"), false);
  assert.equal(fullTodayView.includes("Clasifica"), false);
  assert.equal(fullTodayView.includes("Gasto del mes"), false);
  assert.equal(fullTodayView.includes("Fondo inicial"), false);
  assert.equal(fullTodayView.includes("Ahorro recomendado"), false);
  assert.equal(fullTodayView.includes("Gastos por categoria"), false);
  assert.equal(fullTodayView.includes("Pausa de 24 horas"), false);
  assert.equal(fullTodayView.includes("Ajuste sin culpa"), false);
  assert.equal(fullTodayView.includes("Patron dominante"), false);

  assert.ok(app.includes('renderIcon("receipt")'));
  assert.ok(app.includes('class="bottom-nav-icon plus-icon"'));
  assert.ok(app.includes('renderIcon(normalizeLocation(transaction.source) === "cash" ? "cash" : "account")'));
  assert.ok(styles.includes(".bottom-nav"));
  assert.ok(styles.includes(".quick-expense-panel"));
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
  assert.ok(app.includes('value="recent"'));
  assert.ok(app.includes('value="amount"'));
  assert.ok(app.includes("transactionHistorySort"));
  assert.ok(app.includes('sort === "amount"'));
  assert.ok(app.includes("Number(b.amount || 0) - Number(a.amount || 0)"));
  assert.ok(app.includes("function compareTransactionsByRecent(a, b)"));
  assert.ok(app.includes('String(b.date || "").localeCompare(String(a.date || ""))'));
  assert.ok(app.includes('movements: "movimientos"'));
  assert.ok(styles.includes(".history-row.is-income"));
  assert.ok(styles.includes(".movement-type-icon.income"));
  assert.ok(styles.includes(".income-amount strong"));
  assert.ok(styles.includes(".history-row .movement-type-icon"));
  assert.ok(styles.includes("place-items: center"));
  assert.ok(styles.includes("line-height: 0"));
  assert.ok(styles.includes(".extra-edit-allocation"));
  assert.ok(styles.includes(".income-editor-amount"));

  const profile = app.slice(app.indexOf("function renderProfile"), app.indexOf("function renderStudentContextPanel"));
  assert.equal(profile.includes("renderTransactionHistory"), false);
  assert.equal(profile.includes("Movimientos del periodo"), false);
});

test("authenticated new users get a three-step financial onboarding", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes('id="onboarding-form"'));
  assert.ok(app.includes("Paso 1 de 3"));
  assert.ok(app.includes("Paso 2 de 3"));
  assert.ok(app.includes("Paso 3 de 3"));
  assert.ok(app.includes("¿Cuando recibes dinero?"));
  assert.ok(app.includes("¿Donde tienes ese dinero?"));
  assert.ok(app.includes("¿Para que separas dinero?"));
  assert.ok(app.includes("Cuenta + efectivo debe sumar"));
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

test("saving Mis datos uses one native form submission", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const diagnosisModal = app.slice(app.indexOf("function renderDiagnosisModal()"), app.indexOf("function renderScriptQuestion"));
  const bindEvents = app.slice(app.indexOf("function bindEvents()"), app.indexOf("function bindOnboardingFlow"));

  assert.ok(diagnosisModal.includes('<button class="btn primary" type="submit">Guardar plan</button>'));
  assert.ok(diagnosisModal.includes('<button class="btn primary" type="submit">Guardar y usar mi plan</button>'));
  assert.equal(diagnosisModal.includes("data-diagnosis-save"), false);
  assert.ok(bindEvents.includes('diagnosisForm.addEventListener("submit", handleDiagnosisSubmit)'));
  assert.equal(bindEvents.includes("[data-diagnosis-save]"), false);
});

test("authentication gates onboarding and signed-in users can close their session", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const syncClient = await readFile(new URL("../sync-client.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(app.includes("function shouldShowAuthGate()"));
  assert.ok(app.includes("function shouldShowSessionCheck()"));
  assert.ok(app.includes("function renderSessionCheck()"));
  assert.ok(app.includes("function renderAuthGate()"));
  assert.ok(app.includes("AUTH_STARTUP_TIMEOUT_MS = 25_000"));
  assert.ok(app.includes("function recoverAuthStartup()"));
  assert.equal(app.includes('data-action="recover-auth"'), false);
  assert.equal(app.includes('data-action="reload-app"'), false);
  assert.ok(app.includes("return !cloudState.sessionReady;"));
  assert.ok(app.includes("return cloudState.sessionReady && !cloudState.signedIn;"));
  assert.ok(app.includes("Estamos verificando automaticamente si ya tienes una sesion iniciada."));
  assert.equal(app.includes("Estamos cargando tu cuenta y tus datos antes de mostrar el formulario inicial."), false);
  const renderFunction = app.slice(app.indexOf("function render()"), app.indexOf("function renderNavItem"));
  assert.ok(renderFunction.indexOf("if (shouldShowSessionCheck())") < renderFunction.indexOf("if (shouldShowAuthGate())"));
  assert.ok(renderFunction.indexOf("if (shouldShowAuthGate())") < renderFunction.indexOf("const plan = calculatePlan();"));
  const sessionCheck = app.slice(app.indexOf("function renderSessionCheck()"), app.indexOf("function renderAuthGate()"));
  assert.equal(sessionCheck.includes("cloud-login-form"), false);
  assert.ok(app.includes("Entiende tu dinero antes de gastarlo"));
  assert.ok(app.includes("Dinero libre visible"));
  assert.ok(app.includes("Plan por categorias"));
  assert.ok(app.includes("Sincronizacion segura"));
  assert.ok(app.includes('let authMode = ""'));
  assert.ok(app.includes('data-action="show-auth-form"'));
  assert.ok(app.includes('data-action="back-auth-options"'));
  assert.ok(app.includes('data-auth-mode="signin"'));
  assert.ok(app.includes('data-auth-mode="signup"'));
  assert.ok(app.includes('const selectedAuthMode = ["signin", "signup"].includes(authMode) ? authMode : ""'));
  assert.ok(app.includes('selectedAuthMode === "signin"'));
  assert.ok(app.includes('selectedAuthMode === "signup"'));
  assert.ok(app.includes('id="cloud-signin-form"'));
  assert.ok(app.includes('id="cloud-signup-form"'));
  assert.ok(app.includes("document.querySelectorAll(\"[data-cloud-auth-form]\")"));
  assert.ok(app.includes("event.currentTarget.dataset.cloudMode"));
  assert.ok(app.includes('data-cloud-mode="signup"'));
  assert.ok(app.includes(">Registrarse</button>"));
  assert.ok(app.includes('data-cloud-mode="signin"'));
  assert.ok(app.includes(">Iniciar sesion</button>"));
  assert.equal(app.includes('id="cloud-login-form"'), false);
  assert.equal(app.includes(">Ya tengo cuenta: iniciar sesion</button>"), false);
  assert.ok(app.includes('data-action="cloud-sign-out">Cerrar sesion'));
  assert.ok(app.includes("function clearLocalUserState()"));
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
  assert.ok(syncClient.includes("withCloudTimeout"));
  assert.ok(syncClient.includes("Comprobar la sesion"));
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

test("static startup fallback retries automatically without manual controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.ok(html.includes('class="startup-fallback"'));
  assert.ok(html.includes('const retryKey = "finanzas-startup-retry"'));
  assert.ok(html.includes("window.location.reload()"));
  assert.ok(html.includes("window.pwaCleanupReady"));
  assert.ok(html.includes("window.pwaCleanupReady = Promise.resolve()"));
  assert.ok(html.includes('navigator.serviceWorker.register("service-worker.js?v=20260618-auth-buttons")'));
  assert.ok(html.includes("registration.update().catch(() => {})"));
  assert.equal(html.includes("registration.unregister()"), false);
  assert.equal(html.includes("caches.delete(key)"), false);
  assert.ok(html.includes("Comprobando tu sesion"));
  assert.ok(html.includes("Estamos verificando automaticamente si ya tienes una sesion iniciada."));
  assert.ok(html.includes('loadScript("vendor/supabase-2.108.1.min.js?v=20260618-auth-buttons")'));
  assert.ok(html.includes("window.setTimeout(finish, timeoutMs)"));
  assert.equal(html.includes("cdn.jsdelivr.net/npm/@supabase/supabase-js"), false);
  assert.ok(html.includes('await import("./app.js?v=20260618-auth-buttons")'));
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
  assert.ok(app.includes("window.confirm"));
  assert.ok(app.includes("stateUpdatedTime"));
  assert.ok(app.includes("cloudRecordUpdatedTime"));
  assert.ok(app.includes("hasMeaningfulLocalData"));
  assert.ok(app.includes("BACKUP_KEY"));
  assert.ok(app.includes("saveLocalBackup"));
  assert.ok(app.includes("function menuAlertText()"));
  assert.equal(app.includes("function renderCloudStatus()"), false);
  assert.equal(app.includes("Cuenta y nube"), false);
  assert.ok(app.includes("function renderAccountPanel()"));
  assert.ok(app.includes("liquiditySummary"));
  assert.ok(app.includes("adjustLiquidity"));
  assert.ok(app.includes("validateTransactionDraft"));
  assert.ok(app.includes("remove-transaction"));
  assert.ok(app.includes("clearCurrentPeriodExtras"));
  assert.ok(app.includes("renderTransactionHistory"));
  assert.ok(!app.includes("state.transactions = []"));
});

test("manual local backup and account plus cash panels are not shown", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const budget = app.slice(app.indexOf("function renderBudget("), app.indexOf("function renderBudgetJobForm"));
  const profile = app.slice(app.indexOf("function renderProfile("), app.indexOf("function renderStudentContextPanel"));

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
  assert.ok(app.includes('class="distribution-bar"'));
  assert.ok(app.includes('class="dist-reserved"'));
  assert.ok(app.includes('class="dist-spent"'));
  assert.ok(app.includes('class="dist-free"'));
  assert.equal(app.includes('renderAllocation("Apartado sin gastar"'), false);
  assert.equal(app.includes('renderAllocation("Libre antes de gastos"'), false);
  assert.ok(styles.includes(".distribution-bar"));
  assert.ok(styles.includes(".dist-reserved"));
  assert.ok(styles.includes(".dist-spent"));
  assert.ok(styles.includes(".dist-free"));
});

test("savings remains advisory and debt features are removed", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../finance-core.js", import.meta.url), "utf8");

  assert.ok(app.includes("Orientativo"));
  assert.ok(app.includes("No mueve dinero"));
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
  assert.ok(app.includes("gastos quedaran"));
  assert.ok(app.includes("function renderTransactionEditor()"));
  assert.ok(app.includes('id="transaction-edit-form"'));
  assert.ok(app.includes("function renderConnectionBanner()"));
  assert.ok(app.includes("Tus datos locales siguen disponibles."));
  assert.ok(app.includes('type="range" min="0" max="100"'));
  assert.ok(app.includes("Plan basico"));
  assert.ok(app.includes("Perfil conductual"));
  assert.ok(app.includes("data-onboarding-skip"));
  assert.ok(styles.includes(".sheet-backdrop"));
  assert.ok(styles.includes(".destructive-consequence"));
  assert.ok(styles.includes(".history-row.is-unclassified"));
  assert.ok(styles.includes(".connection-banner"));
});
