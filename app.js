import {
  FREE_CATEGORY_ID,
  INCOME_CADENCES,
  LARGE_PURCHASE_RATIO,
  budgetAmountForJob as getBudgetAmountForJob,
  budgetRingAllocation as getBudgetRingAllocation,
  budgetSummary as getBudgetSummary,
  calculatePlan as calculateFinancePlan,
  categoryStatus as getCategoryStatus,
  findLoggedIncome,
  freeShareOfBudget,
  isSavingsJob,
  getPeriodIncome,
  getMonthlyIncome,
  monthlyLabeledSpend as getMonthlyLabeledSpend,
  predictUntilNextPeriod as getPeriodPrediction,
  resolvePeriodIncome,
  spendByCategory as getSpendByCategory
} from "./finance-core.js?v=1.1.24";
import {
  DEFAULT_MERCHANT,
  DEFAULT_REMINDER_TIME,
  DIAGNOSIS_SECTIONS,
  JOB_CADENCE_VALUES,
  LEGACY_TEMPLATE_BUDGET_JOBS,
  buildMerchantRulesFromTransactions,
  clamp,
  cleanDate,
  cleanText,
  clearTemplateBudget,
  createDefaultState,
  filterMerchantRulesForJobs,
  isTemplateBudgetJobs,
  merchantKey,
  isPlaceholderMerchant,
  merchantRuleMatches,
  csvField,
  migrateState,
  normalizeBudgetExtras,
  normalizeBudgetJobs,
  normalizeCalendarEvents,
  normalizeDailyReminder,
  normalizeEventCategory,
  normalizeLiquidity,
  normalizeLocation,
  normalizeMerchantRules,
  normalizePayday,
  normalizePeriodClosures,
  normalizePredictionStatus,
  normalizeReminderTime,
  normalizeTransactions,
  numberFrom,
  numberValue,
  decideLoginSync,
  describeSyncStatus,
  decidePushSync,
  hasMeaningfulLocalData,
  uid
} from "./state-model.js?v=1.1.24";
import {
  clearStoredCloudSession,
  deleteCloudAccount,
  deleteCloudAppState,
  getCloudSession,
  isCloudConfigured,
  isCloudLibraryLoaded,
  loadCloudState,
  onCloudAuthChange,
  requestPasswordReset,
  saveCloudState,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud
} from "./sync-client.js?v=1.1.24";

const STORAGE_KEY = "finanzas-conductuales:v1";
const SUPPORT_EMAIL = "yefry.avila.zuluaga@gmail.com";
const BACKUP_KEY = "finanzas-conductuales:backups:v1";
// Lock constants live at the top so loadLockConfig() (called during module init,
// before the lock helper block below) can read LOCK_STORAGE_KEY without hitting a
// temporal-dead-zone ReferenceError. A previous version declared these next to the
// helpers far below; the TDZ error was silently caught and the lock always read as off.
const LOCK_STORAGE_KEY = "finanzas-conductuales-lock:v1";
const LOCK_PIN_LENGTH = 4;
const LOCK_MAX_ATTEMPTS = 5;
const LOCK_COOLDOWN_MS = 30000;
const DEFAULT_VIEW = "today";
const QUICK_EXPENSE_HASH = "registrar-gasto";
const PERIOD_CLOSE_NOTICE_DAYS = 5;
const AUTH_STARTUP_TIMEOUT_MS = 8_000;
const SESSION_CHECK_MANUAL_DELAY_MS = 3_000;
const LOCAL_STATE_POLL_DURATION_MS = 1_500;
// Declared here, before the synchronous render() call further down (which runs
// immediately at module init and can reach formatMoney/formatDate on the very first
// paint), not next to the functions that use them — same TDZ trap documented above for
// LOCK_STORAGE_KEY: a const declared "closer to its usage" but after the code path that
// calls it first throws ReferenceError instead of ever getting assigned.
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("es-CO", { month: "short", day: "numeric" });
const EVENT_MONTH_FORMATTER = new Intl.DateTimeFormat("es-CO", { month: "short" });
const EVENT_DAY_FORMATTER = new Intl.DateTimeFormat("es-CO", { day: "2-digit" });
const MOVEMENT_DAY_FORMATTER = new Intl.DateTimeFormat("es-CO", { weekday: "long", month: "short", day: "numeric" });
const COMPACT_MONEY_FORMATTER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });
const PLAIN_NUMBER_FORMATTER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const moneyFormatterCache = new Map();

// Every module-level constant lives up here, above the boot code further down:
// render() and initializeCloudSync() run synchronously at module init, and a const
// declared below them throws a TDZ ReferenceError on any path that reaches it
// before script execution does (tests/app-smoke.test.mjs boots the real app).
// Only these two are pure no-op confirmations (nothing local changed, nothing to
// react to). Every other cloud message — including "la nube tenía cambios más
// recientes, descargué esa versión" — means the user's local data just got
// overwritten, and must always reach the sidebar. A previous version silenced any
// message matching /nube|sincron/i, which swallowed that overwrite warning too.
const SILENT_ALERTS = new Set(["Nube al día.", "Primera copia subida a la nube."]);

const SMALL_EXPENSE_THRESHOLD = 15000;
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Matches FreeMoneyWidgetProvider.QUICK_ADD_URI and the intent-filter data (scheme +
// host) declared in AndroidManifest.xml for the home screen widget's "+" button.
const WIDGET_QUICK_ADD_HOST = "registrar-gasto";

// Tope de digitos para cualquier campo de dinero: sin este limite, escribir muchos
// ceros produce un numero formateado tan largo (ej. "100.000.000.000.000.000.000")
// que desborda su contenedor y empuja toda la pantalla horizontalmente, cortando el
// resto del formulario. 12 digitos (hasta ~999.999.999.999) cubre cualquier cifra
// real de finanzas personales con margen de sobra.
const MONEY_INPUT_MAX_DIGITS = 12;

const BACK_CLOSE_SELECTORS = [
  '[data-action="close-transaction-editor"]',
  '[data-action="close-extra-editor"]',
  '[data-action="close-quick-classify"]',
  '[data-action="cancel-delete-account"]',
  '[data-action="cancel-remove-job"]',
  '[data-action="cancel-restore-backup"]',
  '[data-action="close-diagnosis"]',
  '[data-action="close-plan-sheet"]',
  '[data-action="close-period-report"]',
  '[data-action="close-prediction-details"]',
  '[data-action="close-expense"]'
];
const DAILY_REMINDER_NOTIFICATION_ID = 7301;
const TEST_REMINDER_NOTIFICATION_ID = 7302;
const INCOME_TYPES = ["fixed", "variable"];
const VOLATILITY_VALUES = ["low", "medium", "high"];

// Derivado de finance-core para que la interfaz nunca pueda ofrecer (ni aceptar) una
// frecuencia que el motor de periodos no sepa calcular, ni al reves. Antes esta lista
// estaba copiada literal en cuatro sitios de este archivo y el onboarding ofrecia solo
// tres opciones, sin "quincenal": quien cobra cada 15 dias terminaba en "Otro", que
// guardaba "semester" en silencio y le partia todo el calculo de periodos.
const INCOME_CADENCE_VALUES = Object.keys(INCOME_CADENCES);
// Las que el onboarding no muestra como boton directo y quedan detras de "Otro".
const SECONDARY_INCOME_CADENCES = ["semester", "yearly"];

const NAV_ITEMS = [
  { id: "today", label: "Inicio", icon: "01" },
  { id: "budget", label: "Plan", icon: "02" },
  { id: "savings", label: "Ahorro", icon: "03" },
  { id: "calendar", label: "Calendario", icon: "04" },
  { id: "movements", label: "Movimientos", icon: "05" },
  { id: "progress", label: "Progreso", icon: "06" },
  { id: "profile", label: "Datos", icon: "07" }
];
const APP_VIEWS = new Set([...NAV_ITEMS.map((item) => item.id), "periodClose"]);

const app = document.querySelector("#app");
let state = loadState();
state.activeView = viewFromHash(DEFAULT_VIEW);
let startupRouteNormalized = false;
normalizeStartupRoute();
let menuOpen = false;
let quickExpenseOpen = false;
let quickExpenseAdvancedOpen = false;
let applyingCloudState = false;
let cloudSaveTimer;
let authUnsubscribe = () => {};
let authMode = "";
let authEmailDraft = "";
let authNotice = null;
let transactionHistorySort = "recent";
let transactionHistoryFilter = "all";
let transactionHistorySearch = "";
let transactionHistoryDate = "";
let snackbar = null;
let snackbarTimer;
let nativeNotificationPermission = "";
let planSheet = "";
let pendingJobRemovalId = "";
let pendingBackupRestoreId = "";
let editingTransactionId = "";
let editingExtraId = "";
let predictionDetailsOpen = false;
let periodReportOpen = false;
let quickClassifyQueue = [];
let deleteAccountOpen = false;
// See budgetSummary() far below for why this is cached and invalidated. Declared here
// (before the synchronous render() call further down) rather than next to
// budgetSummary(), because render() calls it immediately at module init, before script
// execution ever reaches a `let` declared later in the file — same TDZ trap as
// SHORT_DATE_FORMATTER above.
let cachedBudgetSummary = null;
let expenseDraft = null;
let diagnosisValidation = { field: "", message: "" };
let cloudState = {
  configured: isCloudConfigured(),
  email: "",
  error: "",
  libraryLoaded: isCloudLibraryLoaded(),
  sessionReady: false,
  signedIn: false,
  status: isCloudConfigured() ? "checking" : "local",
  // Set when saveState() runs while a push is already in flight. pushCloudState's
  // round trip (download + upload) can take up to ~20s; without this, an edit made
  // during that window is never scheduled again once the in-flight push finishes.
  dirty: false
};
let dailyReminderTimer;
let sessionCheckManualReady = false;
let lockConfig = loadLockConfig();
let lockMode = lockConfig.enabled ? "unlock" : "";
let lockDigits = "";
let lockFirstEntry = "";
let lockError = "";
let lastBackgroundAt = 0;
let lockCooldownTimer;
let biometricAutoTried = false;
let biometricPromptActive = false;

render();
initializeNativeNotificationActions();
refreshNativeNotificationPermission({ renderNow: true });
bindHardwareBackButton();
bindAppLock();
syncHomeWidget();
initializeWidgetQuickAddDeepLink();
window.setTimeout(recoverAuthStartup, AUTH_STARTUP_TIMEOUT_MS);
window.setTimeout(() => {
  sessionCheckManualReady = true;
  if (shouldShowSessionCheck()) {
    render();
  }
}, SESSION_CHECK_MANUAL_DELAY_MS);
(function pollLocalStateUntilStable(deadline) {
  const reloaded = loadState();
  if (JSON.stringify(reloaded) !== JSON.stringify(state)) {
    state = reloaded;
    state.activeView = viewFromHash(DEFAULT_VIEW);
    normalizeStartupRoute();
    // El estado se adopta igual; lo que se aplaza es solo repintar. Importa porque el
    // acceso directo del widget abre la hoja de registrar gasto durante el arranque,
    // justo mientras este sondeo sigue corriendo.
    renderBackground();
    return;
  }
  if (performance.now() < deadline) {
    window.requestAnimationFrame(() => pollLocalStateUntilStable(deadline));
  }
})(performance.now() + LOCAL_STATE_POLL_DURATION_MS);
initializeCloudSync();
scheduleDailyReminder();
window.addEventListener("hashchange", () => {
  const nextView = viewFromHash(state.activeView || DEFAULT_VIEW);
  let shouldRender = false;
  if (nextView !== state.activeView) {
    state.activeView = nextView;
    menuOpen = false;
    saveState({ sync: false, touch: false });
    shouldRender = true;
  }
  if (syncQuickExpenseWithLocation({ renderNow: false })) {
    shouldRender = true;
  }
  if (shouldRender) {
    render();
  }
});
window.addEventListener("popstate", syncQuickExpenseWithLocation);
// Estos tres no los pide el usuario y pueden dispararse en cualquier momento — en un
// movil, perder y recuperar señal mientras se registra un gasto en una tienda es lo
// normal. Van por renderBackground() para no borrarle el formulario.
window.addEventListener("online", renderBackground);
// Follow the OS live, but only while the user has not picked a theme themselves.
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
  if (!storedThemeChoice()) {
    renderBackground();
  }
});
window.addEventListener("offline", renderBackground);

function isQuotaExceededError(error) {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22);
}

// Wraps every write to localStorage. On QuotaExceededError, frees space by trimming
// the backup history down to the single most recent snapshot and retries once; if that
// still fails, the write is lost but the user is told so instead of it vanishing silently.
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      return false;
    }
    try {
      if (key !== BACKUP_KEY) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(readLocalBackups().slice(0, 1)));
      }
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      if (key !== BACKUP_KEY) {
        showNoticeSnackbar(
          "No se pudo guardar: sin espacio de almacenamiento. Borra copias locales o movimientos viejos en Datos.",
          { kind: "error" }
        );
      }
      return false;
    }
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return createDefaultState(todayKey(), DEFAULT_VIEW);
    }
    return migrateState(JSON.parse(saved), todayKey(), DEFAULT_VIEW);
  } catch {
    const backups = readLocalBackups();
    if (backups[0]?.state) {
      const restored = migrateState(backups[0].state, todayKey(), DEFAULT_VIEW);
      restored.lastAlert = "Tu guardado local estaba dañado; lo recuperamos desde tu última copia automática.";
      return restored;
    }
    return createDefaultState(todayKey(), DEFAULT_VIEW);
  }
}

function saveState(options = {}) {
  cachedBudgetSummary = null;
  const { sync = true, touch = true } = options;
  state.meta = { ...(state.meta || {}) };
  if (touch) {
    const now = new Date().toISOString();
    state.updated_at = now;
    state.meta.updatedAt = now;
    state.meta.updated_at = now;
  }
  state.meta.cloudUserEmail = cloudState.email || state.meta?.cloudUserEmail || "";
  ensurePeriodIncomeApplication();
  persist(STORAGE_KEY, state);
  scheduleDailyReminder();
  syncHomeWidget();
  if (sync && !applyingCloudState) {
    scheduleCloudSave();
  }
}

async function initializeCloudSync() {
  if (!cloudState.configured) {
    cloudState.status = "local";
    cloudState.error = "Configura Supabase para activar sincronización.";
    cloudState.sessionReady = true;
    renderCloudStatusChange();
    return;
  }

  if (!cloudState.libraryLoaded) {
    cloudState.status = "local";
    cloudState.error = "No se pudo cargar la librería de autenticación. Revisa internet y vuelve a cargar.";
    cloudState.sessionReady = true;
    renderCloudStatusChange();
    return;
  }

  try {
    const session = await getCloudSession();
    applyCloudSession(session);
    cloudState.sessionReady = true;
    if (session) {
      cloudState.status = "syncing";
    }
    authUnsubscribe = onCloudAuthChange((nextSession, event) => {
      if (nextSession) {
        applyCloudSession(nextSession);
        cloudState.sessionReady = true;
        if (cloudState.status !== "syncing") {
          pullCloudAfterLogin();
        }
      } else if (event === "SIGNED_OUT") {
        clearLocalUserState();
        cloudState.signedIn = false;
        cloudState.email = "";
        cloudState.sessionReady = true;
        cloudState.status = "signed-out";
        cloudState.error = "";
        renderCloudStatusChange();
      }
    });

    if (session) {
      await pullCloudAfterLogin();
    } else {
      cloudState.sessionReady = true;
      cloudState.status = "signed-out";
      renderCloudStatusChange();
    }
  } catch (error) {
    cloudState.sessionReady = true;
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
    renderCloudStatusChange();
  }
}

function applyCloudSession(session) {
  const nextEmail = session?.user?.email || "";
  const previousEmail = state.meta?.cloudUserEmail || "";
  if (session && previousEmail && previousEmail !== nextEmail) {
    clearLocalUserState();
  }
  cloudState.signedIn = Boolean(session);
  cloudState.email = nextEmail;
  cloudState.error = "";
  if (session) {
    state.meta = {
      ...(state.meta || {}),
      cloudUserEmail: cloudState.email
    };
  }
}

async function pullCloudAfterLogin() {
  if (!cloudState.signedIn) {
    return;
  }

  cloudState.status = "syncing";
  cloudState.error = "";
  renderCloudStatusChange();

  try {
    const remote = await loadCloudState();
    const decision = decideLoginSync(state, remote);

    if (decision === "download") {
      applyRemoteState(remote.app_state, remote.updated_at, "Nube sincronizada automáticamente.");
    } else if (decision === "in-sync") {
      markCloudSynced(remote.updated_at || new Date().toISOString());
      state.lastAlert = "Nube al día.";
    } else {
      const saved = await saveCloudState(getCloudPayload());
      markCloudSynced(saved?.updated_at || new Date().toISOString());
      if (decision === "upload-remote-empty") {
        state.lastAlert = "La nube estaba vacía; conservé tus datos locales y los subí.";
      } else if (decision === "first-upload") {
        state.lastAlert = "Primera copia subida a la nube.";
      }
    }
    cloudState.status = "synced";
    renderCloudStatusChange();
  } catch (error) {
    applyingCloudState = false;
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
  } finally {
    cloudState.sessionReady = true;
    renderCloudStatusChange();
  }
}

function scheduleCloudSave() {
  if (!cloudState.signedIn) {
    return;
  }
  if (cloudState.status === "syncing") {
    // Don't drop this edit: flag it so pushCloudState reschedules itself once the
    // in-flight round trip finishes, instead of the edit silently never being synced.
    cloudState.dirty = true;
    return;
  }
  cloudState.status = "pending";
  cloudState.error = "";
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushCloudState, 800);
}

async function pushCloudState() {
  if (!cloudState.signedIn) {
    return;
  }

  cloudState.status = "syncing";
  cloudState.dirty = false;
  renderCloudStatusChange();

  try {
    const remote = await loadCloudState();
    if (decidePushSync(state, remote) === "download") {
      applyRemoteState(remote.app_state, remote.updated_at, "La nube tenía cambios más recientes. Descargué esa versión.");
      cloudState.status = "synced";
      renderCloudStatusChange();
      return;
    }

    const saved = await saveCloudState(getCloudPayload());
    markCloudSynced(saved?.updated_at || new Date().toISOString());
    cloudState.status = "synced";
    cloudState.error = "";
    renderCloudStatusChange();
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
    renderCloudStatusChange();
  } finally {
    // Any edit made while this push was in flight (getCloudPayload() above already
    // missed it) sets cloudState.dirty via scheduleCloudSave(). Reschedule so it isn't
    // silently dropped — scheduleCloudSave() re-reads `state` fresh when it fires.
    if (cloudState.dirty) {
      cloudState.dirty = false;
      scheduleCloudSave();
    }
  }
}

function getCloudPayload() {
  return {
    ...state,
    showDiagnosis: false,
    meta: {
      ...(state.meta || {}),
      cloudUserEmail: cloudState.email
    }
  };
}

function applyRemoteState(remoteState, remoteUpdatedAt, alert) {
  applyingCloudState = true;
  saveLocalBackup("antes de bajar nube");
  state = migrateState(remoteState, todayKey(), DEFAULT_VIEW);
  state.showDiagnosis = false;
  editingTransactionId = "";
  editingExtraId = "";
  clearSnackbar({ renderNow: false });
  // Adopting remote state normally forces the user back to the default view (editing a
  // transaction/extra that no longer exists in the new state would be unsafe to keep open).
  // But skip that when the widget's quick-add deep link just navigated here — this runs on
  // essentially every logged-in cold start (see pullCloudAfterLogin), racing against
  // initializeWidgetQuickAddDeepLink's async getLaunchUrl() call, and registering a new
  // expense never references anything from the old state, so it's safe to leave open.
  if (!isQuickExpenseLocation()) {
    activateView(DEFAULT_VIEW);
  }
  state.lastAlert = alert;
  markCloudSynced(remoteUpdatedAt || new Date().toISOString(), { persist: false });
  saveState({ sync: false, touch: false });
  applyingCloudState = false;
}

function markCloudSynced(updatedAt, options = {}) {
  const { persist: shouldPersist = true } = options;
  state.meta = {
    ...(state.meta || {}),
    cloudUpdatedAt: updatedAt,
    cloudUserEmail: cloudState.email
  };
  if (shouldPersist) {
    persist(STORAGE_KEY, state);
  }
}

function readLocalBackups() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const backups = raw ? JSON.parse(raw) : [];
    return Array.isArray(backups) ? backups : [];
  } catch {
    return [];
  }
}

function saveLocalBackup(reason, snapshot = state) {
  if (!hasMeaningfulLocalData(snapshot)) {
    return;
  }

  const backup = {
    id: uid("backup"),
    created_at: new Date().toISOString(),
    reason,
    counts: {
      fields: snapshot.budgetJobs?.length || 0,
      transactions: snapshot.transactions?.length || 0,
      extras: snapshot.budgetExtras?.length || 0
    },
    state: {
      ...JSON.parse(JSON.stringify(snapshot)),
      showDiagnosis: false
    }
  };
  const backups = [backup, ...readLocalBackups()].slice(0, 3);
  persist(BACKUP_KEY, backups);
}

function restoreLocalBackup(id) {
  const backup = readLocalBackups().find((item) => item.id === id);
  if (!backup?.state) {
    state.lastAlert = "No encontré esa copia local.";
    return;
  }
  saveLocalBackup("antes de restaurar una copia local");
  state = migrateState(backup.state, todayKey(), DEFAULT_VIEW);
  // backup.state carries the cloudUpdatedAt from whenever the backup was taken. Left
  // as-is, the next pushCloudState() would see the real cloud as "changed since our
  // last sync" and immediately re-download it, silently undoing the restore the user
  // just asked for. Bumping it to now makes the restored state win that comparison,
  // the same way the "nube vacía" first-sync case forces local to win.
  state.meta = {
    ...(state.meta || {}),
    cloudUpdatedAt: new Date().toISOString(),
    cloudUserEmail: cloudState.email
  };
  state.showDiagnosis = false;
  editingTransactionId = "";
  editingExtraId = "";
  clearSnackbar({ renderNow: false });
  activateView(DEFAULT_VIEW);
  state.lastAlert = `Restauramos la copia del ${formatBackupTimestamp(backup.created_at)}.`;
}

function friendlyCloudError(error) {
  const message = error?.message || String(error);
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes("row-level security") || normalizedMessage.includes("42501")) {
    return "No pude guardar en la nube por un problema de permisos de tu sesión. Tus datos locales siguen aquí; cierra sesión e inicia de nuevo. Si se repite, contáctanos.";
  }
  if (normalizedMessage.includes("invalid login")) {
    return "Correo o contraseña incorrectos.";
  }
  if (normalizedMessage.includes("fetch")) {
    return "No pude conectar con la nube. Revisa internet.";
  }
  if (normalizedMessage.includes("librería de nube")) {
    return "No pude cargar Supabase. Revisa internet y recarga la página.";
  }
  return message;
}

function renderCloudStatusChange() {
  // Perder la sesion si manda: dejar un formulario abierto sobre una sesion muerta es
  // peor que perderlo, porque al guardarlo fallaria igual.
  if (shouldShowAuthGate()) {
    render();
    return;
  }
  // La lista que habia aqui se quedo corta con el tiempo: no incluia planSheet (las
  // hojas de "Apartar dinero", "Crear categoria" y "Dinero extra", todas con campos de
  // texto) ni el onboarding de un usuario nuevo, que se muestra con showDiagnosis en
  // false. hasOpenUserInput() es ahora la unica definicion.
  renderBackground();
}

function openQuickExpense() {
  quickExpenseOpen = true;
  quickExpenseAdvancedOpen = false;
  menuOpen = false;
  predictionDetailsOpen = false;
  periodReportOpen = false;
  if (!isQuickExpenseLocation()) {
    window.location.hash = QUICK_EXPENSE_HASH;
  }
}

// Only clears a stale #registrar-gasto hash left over from a previous session, on the
// very first check. Without this guard, the poll loop below (pollLocalStateUntilStable)
// calls this again whenever cloud sync updates localStorage during startup, wiping out a
// hash that the widget's quick-add deep link (initializeWidgetQuickAddDeepLink) sets
// asynchronously — moments after startup — via a Capacitor plugin promise.
function normalizeStartupRoute() {
  if (startupRouteNormalized) {
    return;
  }
  startupRouteNormalized = true;
  if (!isQuickExpenseLocation()) {
    return;
  }
  state.activeView = DEFAULT_VIEW;
  const historyState = window.history.state || {};
  window.history.replaceState(historyState, "", `#${hashFromView(DEFAULT_VIEW)}`);
}

function closeQuickExpense() {
  quickExpenseOpen = false;
  quickExpenseAdvancedOpen = false;
  expenseDraft = null;
  if (isQuickExpenseLocation()) {
    window.history.back();
  }
}

function resetQuickExpenseAfterLogin() {
  if (!quickExpenseOpen && !isQuickExpenseLocation()) {
    return;
  }
  quickExpenseOpen = false;
  expenseDraft = null;
  menuOpen = false;
  state.activeView = DEFAULT_VIEW;
  const historyState = window.history.state || {};
  window.history.replaceState(historyState, "", `#${hashFromView(DEFAULT_VIEW)}`);
}

function isQuickExpenseLocation() {
  return window.location.hash.replace("#", "") === QUICK_EXPENSE_HASH;
}

function syncQuickExpenseWithLocation(options = {}) {
  const { renderNow = true } = options;
  const shouldBeOpen = isQuickExpenseLocation();
  if (quickExpenseOpen === shouldBeOpen) {
    return false;
  }
  quickExpenseOpen = shouldBeOpen;
  menuOpen = false;
  if (shouldBeOpen) {
    periodReportOpen = false;
    predictionDetailsOpen = false;
  }
  if (renderNow) {
    render();
  }
  return true;
}

// Superficies que pueden contener algo que el usuario escribio o eligio y que todavia
// no vive en `state`. Los formularios son no controlados: su contenido existe solo en
// el DOM, asi que `app.innerHTML = ...` lo borra sin dejar rastro.
function hasOpenUserInput() {
  return Boolean(
    quickExpenseOpen ||
      planSheet ||
      state.showDiagnosis ||
      profileNeedsOnboarding() ||
      editingTransactionId ||
      editingExtraId ||
      quickClassifyQueue.length ||
      pendingJobRemovalId ||
      pendingBackupRestoreId ||
      deleteAccountOpen ||
      periodReportOpen ||
      lockMode
  );
}

// Para los re-render que el usuario NO pidio: la red que aparece o se cae, el tema del
// sistema, la sincronizacion en segundo plano, el arranque. Ninguno de esos puede
// reconstruir el DOM mientras hay un formulario abierto. No hace falta reintentarlo
// despues: cerrar la superficie ya dispara su propio render(), que repinta todo desde
// `state`. Lo unico que se aplaza es cosmetico (p. ej. el aviso de "sin conexion"),
// que es mucho mejor que perder un gasto a medio escribir.
function renderBackground() {
  if (hasOpenUserInput()) {
    return;
  }
  render();
}

function render() {
  // Must run before the early returns below: the lock, session-check and auth
  // screens are rendered without ever reaching the main branch, so otherwise they
  // keep whatever data-theme index.html guessed at load time.
  applyThemePreference();

  if (lockMode) {
    app.classList.remove("is-menu-open", "is-expense-open");
    app.innerHTML = renderLockScreen();
    bindEvents();
    return;
  }

  if (shouldShowSessionCheck()) {
    app.classList.remove("is-menu-open", "is-expense-open");
    app.innerHTML = renderSessionCheck();
    bindEvents();
    return;
  }

  if (shouldShowAuthGate()) {
    app.classList.remove("is-menu-open", "is-expense-open");
    app.innerHTML = renderAuthGate();
    bindEvents();
    return;
  }

  applyThemePreference();
  // Covers the selfManagedAction paths (cloud-sign-out, confirm-delete-account) that
  // skip saveState() but still call render() — saveState() already invalidates this
  // cache on every other path. Must run before ensurePeriodIncomeApplication(), which
  // can itself mutate state right here.
  cachedBudgetSummary = null;
  ensurePeriodIncomeApplication();
  const plan = calculatePlan();
  app.classList.toggle("is-menu-open", menuOpen);
  app.classList.toggle("is-expense-open", quickExpenseOpen);
  app.innerHTML = `
    <button class="drawer-scrim" type="button" data-action="close-menu" aria-label="Cerrar menu"></button>
    <aside class="sidebar" aria-label="Menu principal">
      <div class="sidebar-head">
        <a class="brand" href="#" data-view="today" aria-label="Ir al inicio">
          ${renderBrandMark()}
          <span>
            <strong>Finanzas Conductuales</strong>
            <small>${capitalize(budgetSummary().cadenceLabel)} · ${formatMoney(budgetSummary().freeRemaining)} libre</small>
          </span>
        </a>
        <button class="drawer-close" type="button" data-action="close-menu" aria-label="Cerrar menu">x</button>
      </div>
      <div class="nav-panel is-open" id="main-menu">
        <nav class="nav-list" aria-label="Secciones principales">
          <button class="nav-item is-primary" type="button" data-action="open-expense">
            <span class="nav-number">+</span>
            <span>Registrar gasto</span>
          </button>
          ${NAV_ITEMS.map((item) => renderNavItem(item)).join("")}
        </nav>
        ${renderThemeSwitcher()}
        <div class="menu-tools">
          ${renderSyncStatusLine()}
          <button class="btn primary" type="button" data-action="open-diagnosis">Editar mi plan</button>
          <button class="btn ghost" type="button" data-action="cloud-sign-out">Cerrar sesión</button>
          ${menuAlertText() ? `<div class="menu-notice" role="status">${escapeHtml(menuAlertText())}</div>` : ""}
        </div>
      </div>
    </aside>
    <main class="main-panel">
      ${renderConnectionBanner()}
      ${renderSyncProblemBanner()}
      ${state.activeView === "today" ? renderHeader(plan) : ""}
      ${renderView(plan)}
    </main>
    ${renderBottomNavigation()}
    ${quickExpenseOpen ? renderQuickExpensePanel() : ""}
    ${planSheet ? renderPlanSheet() : ""}
    ${pendingJobRemovalId ? renderJobRemovalConfirmation() : ""}
    ${pendingBackupRestoreId ? renderBackupRestoreConfirmation() : ""}
    ${deleteAccountOpen ? renderDeleteAccountConfirmation() : ""}
    ${editingTransactionId ? renderTransactionEditor() : ""}
    ${editingExtraId ? renderExtraEditor() : ""}
    ${quickClassifyQueue.length ? renderQuickClassifyPanel() : ""}
    ${predictionDetailsOpen ? renderPredictionDetailsModal() : ""}
    ${periodReportOpen ? renderPeriodReportModal(plan) : ""}
    ${profileNeedsOnboarding() || state.showDiagnosis ? renderDiagnosisModal() : ""}
    ${renderSnackbar()}
  `;

  bindEvents();
}

function renderThemeSwitcher() {
  // Active state must reflect the STORED choice, not themePreference()'s resolved
  // value — otherwise picking "Sistema" while the OS is dark would show "Oscuro" as
  // active too, since themePreference() resolves both to "dark".
  const stored = storedThemeChoice();
  const options = [
    { value: "system", label: "Sistema" },
    { value: "light", label: "Claro" },
    { value: "dark", label: "Oscuro" }
  ];
  return `
    <div class="theme-switcher" role="group" aria-label="Cambiar tema">
      <span>Apariencia</span>
      <div class="theme-options">
        ${options
          .map((option) => {
            const isActive = option.value === "system" ? stored === "" : stored === option.value;
            return `<button class="theme-choice ${isActive ? "is-active" : ""}" type="button" data-action="set-theme" data-theme-choice="${option.value}" aria-pressed="${isActive ? "true" : "false"}">${option.label}</button>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderNavItem(item) {
  const active = state.activeView === item.id || (item.id === "budget" && state.activeView === "periodClose") ? "is-active" : "";
  return `
    <button class="nav-item ${active}" type="button" data-view="${item.id}">
      <span class="nav-number">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `;
}

// "system" (or anything else unrecognised) normalizes to "" — storedThemeChoice()
// already treats "" as "no explicit choice, follow the OS", so this is what lets the
// theme switcher's "Sistema" button hand control back to prefers-color-scheme.
function normalizeTheme(theme) {
  return theme === "dark" || theme === "light" ? theme : "";
}

function systemPrefersDark() {
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

// "" (or anything unrecognised) means the user never picked a theme.
function storedThemeChoice() {
  const theme = state.settings?.theme;
  return theme === "dark" || theme === "light" ? theme : "";
}

// Without an explicit choice we must follow the OS, otherwise data-theme says
// "light" while the prefers-color-scheme rules paint dark, and the two halves of
// the stylesheet render on top of each other (invisible text on the auth screen).
function themePreference() {
  return storedThemeChoice() || (systemPrefersDark() ? "dark" : "light");
}

function applyThemePreference() {
  const theme = themePreference();
  document.documentElement.dataset.theme = theme;
  app.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101412" : "#0b6f5b");
  return theme;
}

function renderBottomNavigation() {
  return `
    <nav class="bottom-nav" aria-label="Navegación rápida">
      <button class="bottom-nav-item ${state.activeView === "today" ? "is-active" : ""}" type="button" data-view="today">
        <span class="bottom-nav-icon" aria-hidden="true">${renderIcon("home")}</span>
        <span>Inicio</span>
      </button>
      <button class="bottom-nav-item ${["budget", "periodClose"].includes(state.activeView) ? "is-active" : ""}" type="button" data-view="budget">
        <span class="bottom-nav-icon" aria-hidden="true">${renderIcon("plan")}</span>
        <span>Plan</span>
      </button>
      <button class="bottom-nav-item is-register" type="button" data-action="open-expense">
        <span class="bottom-nav-icon plus-icon" aria-hidden="true">${renderIcon("plus")}</span>
        <span>Registrar</span>
      </button>
      <button class="bottom-nav-item ${state.activeView === "movements" ? "is-active" : ""}" type="button" data-view="movements">
        <span class="bottom-nav-icon" aria-hidden="true">${renderIcon("receipt")}</span>
        <span>Movimientos</span>
      </button>
      <button class="bottom-nav-item ${["savings", "calendar", "profile"].includes(state.activeView) ? "is-active" : ""}" type="button" data-action="toggle-menu">
        <span class="bottom-nav-icon" aria-hidden="true">${renderIcon("menu")}</span>
        <span>Menu</span>
      </button>
    </nav>
  `;
}

function renderIcon(name) {
  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>',
    plan: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15v2M12 11v6M16 8v9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M8 14h2M12 14h2M16 14h1M8 17h2M12 17h2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    account: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 15h3"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 9.5a3 3 0 0 1-1.5 1.5A3 3 0 0 1 7 14.5M17 9.5a3 3 0 0 0 1.5 1.5 3 3 0 0 0-1.5 3.5"/><circle cx="12" cy="12" r="2.25"/>',
    income: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M8.5 10h5.25a2.25 2.25 0 0 1 0 4.5H10.5a2.25 2.25 0 0 1-2-1.25"/>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8 7h8"/><circle cx="8.5" cy="12" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/><circle cx="15.5" cy="12" r="0.9" fill="currentColor" stroke="none"/><circle cx="8.5" cy="16" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/><circle cx="15.5" cy="16" r="0.9" fill="currentColor" stroke="none"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V8H5.5A2.5 2.5 0 0 1 3 5.5Z"/><rect x="3" y="8" width="18" height="11" rx="2.5"/><circle cx="16" cy="13.5" r="1.4" fill="currentColor" stroke="none"/>',
    list: '<circle cx="5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1" fill="currentColor" stroke="none"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6.2 6.2 17.8 17.8"/>',
    fuel: '<path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M4 11h8"/><path d="M14 8.5 17 11v6a1.7 1.7 0 0 0 3.4 0V9.8a2 2 0 0 0-.6-1.4L17.5 6"/><path d="M4 21h10"/>',
    food: '<path d="M7 3v7a1.8 1.8 0 0 0 3.6 0V3M8.8 10v11M16.5 3c-1.4 0-2.3 1.6-2.3 4.5S15.1 12 16.5 12s2.3-1.6 2.3-4.5S17.9 3 16.5 3ZM16.5 12v9"/>',
    car: '<path d="M4 16V11.5L6 7h12l2 4.5V16"/><path d="M4 16h16v2.5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V17H7v1.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><circle cx="7.5" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16" r="1.3" fill="currentColor" stroke="none"/>',
    tag: '<path d="M11.5 3.5H5A1.5 1.5 0 0 0 3.5 5v6.5a1.5 1.5 0 0 0 .44 1.06l9 9a1.5 1.5 0 0 0 2.12 0l6.5-6.5a1.5 1.5 0 0 0 0-2.12l-9-9a1.5 1.5 0 0 0-1.06-.44Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.75"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    user: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.5 20c0-3.9 3.36-6.5 7.5-6.5s7.5 2.6 7.5 6.5"/>',
    trend: '<path d="M4 16.5 9.5 11l4 4 6.5-7"/><path d="M15.5 8h4.5v4.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M3 3l18 18"/><path d="M10.6 5.7A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.6 15.6 0 0 1-3.4 4.2M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 3.4-.6"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths[name] || paths.menu}</svg>`;
}

function renderBrandMark() {
  return `
    <span class="brand-mark" aria-hidden="true">
      <svg class="brand-mark-icon" viewBox="0 0 48 48" fill="none" focusable="false">
        <circle class="brand-ring-track" cx="24" cy="24" r="13.5"/>
        <path class="brand-ring-spent" d="M24 10.5a13.5 13.5 0 0 1 12.1 19.5"/>
        <path class="brand-ring-reserved" d="M36.1 30A13.5 13.5 0 0 1 18.4 36.2"/>
        <path class="brand-ring-free" d="M18.4 36.2A13.5 13.5 0 0 1 24 10.5"/>
        <circle class="brand-ring-core" cx="24" cy="24" r="5.6"/>
      </svg>
    </span>
  `;
}

function currentSyncStatus() {
  return describeSyncStatus(
    {
      configured: cloudState.configured,
      signedIn: cloudState.signedIn,
      status: cloudState.status,
      online: navigator.onLine !== false
    },
    state.meta?.cloudUpdatedAt
  );
}

// The quiet, always-there answer to "¿esto está respaldado?", in the menu only: the brief
// asks for clear sync states without filling the main screen with technical indicators.
// Tone is spelled out in words and an icon, never color alone.
function renderSyncStatusLine() {
  const status = currentSyncStatus();
  if (!status) {
    return "";
  }
  const icons = { ok: "✓", pending: "↻", offline: "•", problem: "!" };
  return `
    <p class="sync-status sync-status--${status.tone}">
      <span class="sync-status-icon" aria-hidden="true">${icons[status.tone]}</span>
      <span>${escapeHtml(status.label)}${status.detail && status.tone === "ok" ? ` · ${escapeHtml(status.detail)}` : ""}</span>
    </p>
  `;
}

// Only a failed save earns space on the main screen. Offline already has its own banner,
// and "saving…"/"saved" are not something the user needs to act on.
function renderSyncProblemBanner() {
  const status = currentSyncStatus();
  if (status?.tone !== "problem") {
    return "";
  }
  return `
    <div class="sync-problem-banner" role="alert">
      <span class="sync-problem-icon" aria-hidden="true">!</span>
      <div>
        <strong>${escapeHtml(status.label)}</strong>
        <span>${escapeHtml(status.detail)}</span>
      </div>
      <button class="btn ghost" type="button" data-action="retry-cloud-sync">Reintentar</button>
    </div>
  `;
}

function renderConnectionBanner() {
  if (navigator.onLine) {
    return "";
  }
  return `
    <div class="connection-banner" role="status">
      <span class="connection-dot" aria-hidden="true"></span>
      <div><strong>Sin conexión</strong><span>Tus datos locales siguen disponibles.</span></div>
    </div>
  `;
}

function cloudStillResolving() {
  return cloudState.configured && (cloudState.status === "checking" || cloudState.status === "syncing");
}

function shouldShowSessionCheck() {
  if (!cloudState.sessionReady) {
    return true;
  }
  return !state.profile.completed && cloudStillResolving();
}

function shouldShowAuthGate() {
  if (!cloudState.sessionReady || cloudState.signedIn) {
    return false;
  }
  // A real sign-out (explicit action, or Supabase confirming the session is gone)
  // always runs clearLocalUserState() first, wiping this data. So if there's still
  // meaningful local data here, `signedIn` is false because of a connectivity problem
  // confirming the session — not an actual sign-out — and showing the login wall would
  // lock the user out of their own local data over a network hiccup. Let them in;
  // renderConnectionBanner() and cloudState.error already surface that sync is stuck.
  return !hasMeaningfulLocalData(state);
}

function profileNeedsOnboarding() {
  return !state.profile.completed && !cloudStillResolving();
}

function renderSessionCheck() {
  return `
    <main class="session-check" aria-busy="true" aria-live="polite">
      <section class="startup-fallback-card">
        <h1>Comprobando tu sesión</h1>
        <p>Estamos verificando automáticamente si ya tienes una sesión iniciada. Si la red tarda, puedes entrar al acceso y la nube seguirá intentando después.</p>
        ${sessionCheckManualReady ? `<button class="btn secondary" type="button" data-action="recover-auth">Continuar al acceso</button>` : ""}
      </section>
    </main>
  `;
}

function renderAuthNoticeCard(notice) {
  const exists = notice.kind === "exists";
  const resetSent = notice.kind === "reset-sent";
  const icon = exists ? "user" : resetSent ? "lock" : "income";
  const heading = exists ? "Ese correo ya tiene cuenta" : resetSent ? "Revisa tu correo" : "Revisa tu correo";
  return `
    <article class="auth-card auth-notice-card ${exists ? "is-exists" : "is-sent"}">
      <span class="auth-notice-icon" aria-hidden="true">${renderIcon(icon)}</span>
      <div class="auth-notice-copy">
        <h2>${heading}</h2>
        <p>
          ${
            exists
              ? `Ya existe una cuenta registrada con <strong>${escapeHtml(notice.email)}</strong>. Inicia sesión con tu contraseña en vez de crear otra.`
              : resetSent
                ? `Enviamos un enlace a <strong>${escapeHtml(notice.email)}</strong> para elegir una contraseña nueva. Abrelo desde ese correo y después inicia sesión aquí con la contraseña nueva.`
                : `Enviamos un enlace de confirmación a <strong>${escapeHtml(notice.email)}</strong>. Abrelo para activar tu cuenta y después inicia sesión.`
          }
        </p>
      </div>
      <div class="auth-notice-actions">
        <button class="btn primary" type="button" data-action="show-auth-form" data-auth-mode="signin">Iniciar sesión</button>
        <button class="btn ghost" type="button" data-action="back-auth-options">Volver</button>
      </div>
    </article>
  `;
}

function renderAuthGate() {
  const submittingAccess = cloudState.status === "syncing" && !cloudState.sessionReady;
  const unavailable = !cloudState.configured || !cloudState.libraryLoaded;
  const selectedAuthMode = ["signin", "signup", "forgot"].includes(authMode) ? authMode : "";
  const emailValue = escapeAttr(authEmailDraft);
  const inlineError = cloudState.error
    ? `<p class="auth-inline-error" role="alert"><span class="auth-inline-error-icon" aria-hidden="true">!</span>${escapeHtml(cloudState.error)}</p>`
    : "";
  if (unavailable) {
    return `
      <main class="auth-gate auth-gate-focused">
        <section class="auth-screen">
          <div class="auth-screen-copy">
            <h1>Acceso no disponible</h1>
            <p class="auth-screen-lead">La autenticación no está disponible. Revisa la configuración de Supabase y vuelve a cargar la aplicación.</p>
          </div>
        </section>
      </main>
    `;
  }

  if (authNotice) {
    return `
      <main class="auth-gate auth-gate-focused">
        <section class="auth-screen">
          ${renderAuthNoticeCard(authNotice)}
        </section>
      </main>
    `;
  }

  if (selectedAuthMode === "forgot") {
    return `
      <main class="auth-gate auth-gate-focused">
        <section class="auth-screen" aria-labelledby="auth-screen-title">
          <header class="auth-screen-head">
            <button class="auth-screen-back" type="button" data-action="show-auth-form" data-auth-mode="signin" aria-label="Volver">&#8592;</button>
            <span class="auth-screen-brand" aria-hidden="true">${renderBrandMark()}</span>
          </header>
          <div class="auth-screen-copy">
            <p class="eyebrow">Recuperar acceso</p>
            <h1 id="auth-screen-title">¿Olvidaste tu contraseña?</h1>
            <p class="auth-screen-lead">Escribe el correo con el que te registraste y te enviamos un enlace para elegir una contraseña nueva.</p>
          </div>
          ${inlineError}
          <form class="stacked-form auth-form" id="cloud-forgot-form" data-cloud-forgot-form>
            <label>
              Correo
              <input name="email" type="email" autocomplete="email" placeholder="tu@email.com" value="${emailValue}" required>
            </label>
            <button class="btn primary" type="submit" ${submittingAccess ? "disabled" : ""}>
              Enviar enlace
            </button>
          </form>
          <p class="auth-switch">
            <button class="auth-switch-link" type="button" data-action="show-auth-form" data-auth-mode="signin">
              Volver a iniciar sesión
            </button>
          </p>
        </section>
      </main>
    `;
  }

  // Each mode is its own full screen, not a form that unfolds inside the landing.
  if (selectedAuthMode) {
    const isSignIn = selectedAuthMode === "signin";
    return `
      <main class="auth-gate auth-gate-focused">
        <section class="auth-screen" aria-labelledby="auth-screen-title">
          <header class="auth-screen-head">
            <button class="auth-screen-back" type="button" data-action="back-auth-options" aria-label="Volver">&#8592;</button>
            <span class="auth-screen-brand" aria-hidden="true">${renderBrandMark()}</span>
          </header>
          <div class="auth-screen-copy">
            <p class="eyebrow">${isSignIn ? "Ya tengo cuenta" : "Primera vez"}</p>
            <h1 id="auth-screen-title">${isSignIn ? "Iniciar sesión" : "Crear cuenta"}</h1>
            <p class="auth-screen-lead">
              ${
                isSignIn
                  ? "Entra con el correo y la contraseña que registraste."
                  : "Después de registrarte configuras tu presupuesto y tus categorías habituales."
              }
            </p>
          </div>
          ${inlineError}
          <form class="stacked-form auth-form" id="cloud-${isSignIn ? "signin" : "signup"}-form" data-cloud-auth-form data-cloud-mode="${isSignIn ? "signin" : "signup"}">
            <label>
              Correo
              <input name="email" type="email" autocomplete="email" placeholder="tu@email.com" value="${emailValue}" required>
            </label>
            <label>
              Contraseña
              <div class="password-field">
                <input name="password" type="password" autocomplete="${isSignIn ? "current-password" : "new-password"}" minlength="6" placeholder="${isSignIn ? "Tu contraseña" : "Mínimo 6 caracteres"}" required data-password-input>
                <button type="button" class="password-toggle" data-password-toggle aria-label="Mostrar contraseña" aria-pressed="false">${renderIcon("eye")}</button>
              </div>
            </label>
            ${
              isSignIn
                ? `<button class="auth-forgot-link" type="button" data-action="show-auth-form" data-auth-mode="forgot">¿Olvidaste tu contraseña?</button>`
                : ""
            }
            <button class="btn ${isSignIn ? "primary" : "secondary"}" type="submit" data-cloud-mode="${isSignIn ? "signin" : "signup"}" ${submittingAccess ? "disabled" : ""}>
              ${isSignIn ? "Iniciar sesión" : "Registrarse"}
            </button>
          </form>
          <p class="auth-switch">
            ${isSignIn ? "No tienes cuenta?" : "Ya tienes cuenta?"}
            <button class="auth-switch-link" type="button" data-action="show-auth-form" data-auth-mode="${isSignIn ? "signup" : "signin"}">
              ${isSignIn ? "Registrate" : "Inicia sesión"}
            </button>
          </p>
        </section>
      </main>
    `;
  }

  return `
    <main class="auth-gate">
      <section class="auth-landing" aria-labelledby="auth-title">
        <div class="auth-hero">
          <div class="auth-brand">
            ${renderBrandMark()}
            <div>
              <p class="eyebrow">Finanzas Conductuales</p>
              <h1 id="auth-title">Entiende tu dinero antes de gastarlo</h1>
            </div>
          </div>
          <p class="auth-lead">
            Una app para registrar gastos, ver cuanto dinero queda libre y separar categorías del periodo sin convertir cada compra en culpa.
          </p>
          <div class="auth-benefits" aria-label="Para que sirve la app">
            <article>
              <strong>Dinero libre visible</strong>
              <span>El inicio muestra lo disponible después de reservas, categorías y gastos reales.</span>
            </article>
            <article>
              <strong>Plan por categorías</strong>
              <span>Define límites para gasolina, salidas, universidad o cualquier categoría que quieras cuidar.</span>
            </article>
            <article>
              <strong>Sincronización segura</strong>
              <span>Tu cuenta guarda una copia en la nube y conserva una copia local para el día a día.</span>
            </article>
          </div>
        </div>

        <div class="auth-actions" aria-label="Acceso a la aplicación">
          <article class="auth-card auth-choice-card">
            <div>
              <p class="eyebrow">Acceso</p>
              <h2>Elige como entrar</h2>
            </div>
            ${inlineError}
            <div class="auth-choice-actions">
              <button class="btn primary" type="button" data-action="show-auth-form" data-auth-mode="signin">Iniciar sesión</button>
              <button class="btn secondary" type="button" data-action="show-auth-form" data-auth-mode="signup">Registrarse</button>
            </div>
          </article>
        </div>
      </section>
    </main>
  `;
}

function renderIncomeAppliedBanner() {
  const status = state.periodIncomeStatus;
  if (!status?.applied || status.bannerDismissed) {
    return "";
  }
  return `
    <div class="income-applied-banner" role="status">
      <p>Se sumó automáticamente tu ingreso periódico de <strong>${formatMoney(status.amount)}</strong> a tu saldo real (cuenta).</p>
      <p class="income-applied-banner-note">Si aún no te ha llegado, deshazlo aquí o corrige el saldo en Datos &gt; Saldos.</p>
      <div class="income-applied-banner-actions">
        <button class="btn ghost" type="button" data-action="undo-income-application">Aún no me pagan, deshacer</button>
        <button class="btn primary" type="button" data-action="dismiss-income-banner">Entendido</button>
      </div>
    </div>
  `;
}

function renderHeader(plan) {
  const summary = budgetSummary();
  const liquidity = liquiditySummary(summary);
  const period = `${formatShortDate(summary.window.start)} - ${formatShortDate(previousDay(summary.window.end))}`;
  const periodLine =
    summary.extraIncome > 0
      ? `<span class="money-split">Total incluye extra: ${periodExtraSourceLabel(summary)}. Base ${formatMoney(summary.baseIncome)} · Total ${formatMoney(summary.income)}</span>`
      : "";
  // Once "libre" is computed from the real balance (finance-core.js), showing
  // "Saldo extra sin usar" again here would just repeat the exact same number under a
  // different label.
  const showUnclaimedLiquidity = !summary.usesLiquidityBasedFree && summary.unclaimedLiquidity > 0;
  // Before payday, fixed-income users (who already have a real balance on file) don't
  // have this period's money yet: show the expected amount as informational only,
  // never counted inside "libre".
  const showPendingIncome = summary.usesLiquidityBasedFree && !summary.incomeApplied && summary.freeBudget > 0;

  return `
    ${renderIncomeAppliedBanner()}
    <header class="money-bar ${summary.overReserved ? "danger" : ""}" role="status" aria-label="Dinero libre sin asignar">
      <div class="money-context"><span>Tu dinero libre</span><span>${period}</span></div>
      <strong>${formatMoney(summary.freeRemaining)}</strong>
      <span class="money-caption">${summary.overReserved ? "Presupuesto sobreasignado" : "Disponible para nuevos gastos"}</span>
      ${
        summary.categoryOverspent > 0
          ? `<span class="money-split danger-text">Exceso sobre topes: ${formatMoney(summary.categoryOverspent)}</span>`
          : ""
      }
      <div class="money-location-list">
        <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("account")}</span><span class="money-location-text"><span>Cuenta</span><strong>${formatMoney(liquidity.account)}</strong></span></div>
        <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("cash")}</span><span class="money-location-text"><span>Efectivo</span><strong>${formatMoney(liquidity.cash)}</strong></span></div>
        <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("calculator")}</span><span class="money-location-text"><span>Total real</span><strong>${formatMoney(liquidity.total)}</strong></span></div>
        ${
          showUnclaimedLiquidity
            ? `<div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("calculator")}</span><span class="money-location-text"><span>Saldo extra sin usar</span><strong>${formatMoney(summary.unclaimedLiquidity)}</strong></span></div>`
            : ""
        }
        ${
          showPendingIncome
            ? `<div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("calculator")}</span><span class="money-location-text"><span>Por recibir (aún no cuenta como libre)</span><strong>${formatMoney(summary.freeBudget)}</strong></span></div>`
            : ""
        }
      </div>
      <details class="money-help-toggle">
        <summary>Por qué libre no es igual a total real</summary>
        <p class="money-help">${
          summary.usesLiquidityBasedFree
            ? `Como tienes un ingreso fijo programado, libre es tu saldo real (cuenta + efectivo) menos lo reservado en categorías — nunca incluye dinero que aún no te ha llegado. El día que te pagan, ese ingreso se suma automáticamente a tu saldo real, y "libre" sube en ese momento, no antes. Total real es cuenta + efectivo ahora mismo, incluyendo lo reservado en categorías.`
            : `Libre es tu cupo de este periodo menos lo ya gastado sin categoría. Total real es cuenta + efectivo ahora mismo, incluyendo lo que sí está reservado en categorías y cualquier saldo extra que aún no has clasificado.${
                summary.unclaimedLiquidity > 0
                  ? ` "Saldo extra sin usar" (${formatMoney(summary.unclaimedLiquidity)}) es dinero real que ya tienes y que ninguna categoría reclama todavía. Si ya sabes que es parte de tu ingreso de este periodo, regístralo como ingreso para que se sume a libre.`
                  : ""
              }`
        }</p>
      </details>
    </header>
  `;
}

function periodExtraSourceLabel(summary = budgetSummary()) {
  const extras = budgetExtrasForSummary(summary);
  if (!extras.length) {
    return formatMoney(summary.extraIncome);
  }

  const labels = extras
    .slice(0, 2)
    .map((extra) => `${escapeHtml(extra.source)} ${formatMoney(extra.amount)}`)
    .join(" · ");
  const hiddenCount = extras.length - 2;
  return hiddenCount > 0 ? `${labels} · +${hiddenCount} más` : labels;
}

function menuAlertText() {
  const alert = String(state.lastAlert || "");
  return SILENT_ALERTS.has(alert) ? "" : alert;
}

function renderView(plan) {
  const views = {
    today: renderToday,
    budget: renderBudget,
    periodClose: renderPeriodCloseScreen,
    savings: renderSavings,
    calendar: renderCalendar,
    movements: renderMovements,
    progress: renderProgressView,
    profile: renderProfile
  };
  // A persisted activeView from an older version (e.g. the removed "spending" screen)
  // would otherwise call undefined here and blank the whole app on launch.
  if (!views[state.activeView]) {
    state.activeView = DEFAULT_VIEW;
  }
  return views[state.activeView](plan);
}

function renderToday(plan) {
  const visibleCategoryCount = Math.max(1, Math.min(6, state.budgetJobs.length + 1));
  const homeSummary = budgetSummary();
  return `
    <section class="home-view" aria-label="Resumen del periodo">
      ${renderPeriodPredictionCard(homeSummary)}
      ${renderCooldownPanel()}
      <button class="setaside-action" type="button" data-action="open-setaside-sheet">
        <span class="setaside-action-icon" aria-hidden="true">$</span>
        <span><strong>Apartar dinero</strong><small>Guarda plata para algo, sin gastarla todavía</small></span>
        <b aria-hidden="true">&rsaquo;</b>
      </button>
      <div class="home-section-heading">
        <div>
          <p class="eyebrow">Categorías del periodo</p>
          <h2>Lo que vas usando</h2>
        </div>
        <button class="home-plan-link" type="button" data-view="budget">Editar límites</button>
      </div>
      ${renderCategoryBars(plan, visibleCategoryCount)}
      ${
        state.budgetJobs.length
          ? ""
          : `<div class="empty-state home-empty actionable-empty">
              <span class="empty-icon" aria-hidden="true">+</span>
              <strong>Tu plan aun no tiene categorías</strong>
              <span>Aparta dinero para comida, transporte o cualquier propósito.</span>
              <button class="btn primary" type="button" data-action="open-setaside-sheet">Apartar dinero</button>
            </div>`
      }
      <div class="home-period-note">Presupuesto ${formatMoney(homeSummary.income)} · ${freeShareOfBudget(homeSummary)}% sigue libre</div>
    </section>
  `;

}

function renderPeriodPredictionCard(summary = budgetSummary()) {
  const prediction = periodPrediction();
  const statusLabel = predictionStatusLabel(prediction.status);
  const endDate = formatShortDate(previousDay(summary.window.end));
  const amount = predictionDisplayAmount(prediction);
  return `
    <article class="prediction-card ${prediction.status}" aria-label="Predicción hasta el próximo periodo">
      <div>
        <p class="eyebrow">Predicción hasta el próximo periodo</p>
        <h2>${predictionHeadline(prediction)}</h2>
        <span>${predictionCopy(prediction, endDate)}</span>
        <button class="text-link prediction-detail-link" type="button" data-action="open-prediction-details">Cómo se calculó</button>
      </div>
      <div class="prediction-number">
        <span>${predictionAmountLabel(prediction)}</span>
        <strong>${formatMoney(amount)}</strong>
        <small>${statusLabel}</small>
      </div>
    </article>
  `;
}

function renderCooldownPanel() {
  const cooldowns = (state.cooldowns || [])
    .slice()
    .sort((a, b) => String(a.unlockAt || "").localeCompare(String(b.unlockAt || "")));
  if (!cooldowns.length) {
    return "";
  }
  return `
    <article class="cooldown-panel" aria-label="Compras en pausa">
      <div class="home-section-heading compact-heading">
        <div>
          <p class="eyebrow">Compras en pausa</p>
          <h2>Decide con calma</h2>
        </div>
      </div>
      <div class="cooldown-list">
        ${cooldowns.map((cooldown) => renderCooldown(cooldown)).join("")}
      </div>
    </article>
  `;
}

function renderPredictionDetailsModal() {
  const prediction = periodPrediction();
  const summary = budgetSummary();
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-prediction-details">
      <section class="bottom-sheet prediction-detail-modal" role="dialog" aria-modal="true" aria-labelledby="prediction-detail-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div>
            <p class="eyebrow">Predicción hasta el próximo periodo</p>
            <h2 id="prediction-detail-title">Cómo se calculó</h2>
          </div>
          <button class="icon-btn muted" type="button" data-action="close-prediction-details" aria-label="Cerrar">x</button>
        </div>
        <div class="calculation-outcome ${prediction.status}">
          <strong>${predictionOutcomeText(prediction)}</strong>
          <span>${predictionPaceText(prediction)}</span>
        </div>
        <div class="prediction-detail-grid">
          <div>
            <span>Libre hoy</span>
            <strong>${formatMoney(prediction.freeToday)}</strong>
          </div>
          <div>
            <span>Ritmo usado</span>
            <strong>${formatMoney(Math.round(prediction.dailyRate))} diarios</strong>
          </div>
          <div>
            <span>Días restantes</span>
            <strong>${prediction.remainingDays}</strong>
          </div>
        </div>
        <div class="formula-list">
          <p class="formula-heading">Calculo</p>
          <p><strong>dinero_libre_inicial</strong> = ingreso_del_periodo + extras - dinero_reservado_en_categorias</p>
          <code>${formatMoney(summary.baseIncome)} + ${formatMoney(prediction.extraIncome)} - ${formatMoney(prediction.reserved)} = ${formatMoney(prediction.freeBudget)}</code>
          <p><strong>gasto_libre_real</strong> = gastos_sin_categoria + excesos_de_categorias</p>
          <code>${formatMoney(prediction.freeSpent)} + ${formatMoney(prediction.categoryOverspent)} = ${formatMoney(prediction.actualFreeImpactSpent)}</code>
          ${prediction.ignoredOneOffSpent > 0 ? `<p><strong>gasto_unico</strong> = ${formatMoney(prediction.ignoredOneOffSpent)}. Baja el libre hoy, pero no se usa para ritmo diario.</p>` : ""}
          ${
            prediction.usesLiquidityBasedFree
              ? `<p><strong>libre_hoy</strong> = saldo_real_en_cuenta_y_efectivo - reservado_en_categorias${prediction.incomeApplied ? " (ya te pagaron este periodo)" : " (aún no te pagan este periodo: el cupo no cuenta todavía)"}</p>
                 <code>${formatMoney(prediction.liquidityTotal)} - ${formatMoney(prediction.reservedRemaining)} = ${formatMoney(prediction.freeToday)}</code>`
              : `<p><strong>libre_hoy</strong> = dinero_libre_inicial - gasto_libre_real</p>
                 <code>${formatMoney(prediction.freeBudget)} - ${formatMoney(prediction.actualFreeImpactSpent)} = ${formatMoney(prediction.freeToday)}</code>`
          }
          <p><strong>ritmo_diario</strong> = ${prediction.ignoredOneOffSpent > 0 ? "gasto_libre_real_sin_unicos" : "gasto_libre_real"} / dias_observados</p>
          <code>${formatMoney(prediction.observedFreeSpent)} / ${prediction.observedDays} = ${formatMoney(Math.round(prediction.observedDailyRate))} diarios</code>
          <p><strong>gasto_estimado_restante</strong> = ritmo_diario * dias_hasta_proximo_pago</p>
          <code>${formatMoney(Math.round(prediction.dailyRate))} x ${prediction.remainingDays} = ${formatMoney(prediction.projectedRemainingSpend)}</code>
          <p><strong>resultado_final</strong> = libre_hoy - gasto_estimado_restante</p>
          <code>${formatMoney(prediction.freeToday)} - ${formatMoney(prediction.projectedRemainingSpend)} = ${formatMoney(prediction.projectedEndFree)}</code>
        </div>
        <button class="btn primary" type="button" data-action="close-prediction-details">Entendido</button>
      </section>
    </div>
  `;
}

function predictionOutcomeText(prediction) {
  if (prediction.status === "risk") {
    return `Si sigues a este ritmo, podrian faltar ${formatMoney(prediction.shortage)}.`;
  }
  if (prediction.status === "healthy" || prediction.status === "tight") {
    return `Si sigues a este ritmo, llegarías con ${formatMoney(Math.max(0, prediction.projectedEndFree))}.`;
  }
  if (prediction.status === "learning") {
    return "Aún no proyecto el resultado final porque faltan días observados.";
  }
  if (prediction.status === "over_reserved") {
    return `Hay ${formatMoney(prediction.overReserved)} más reservado que presupuesto.`;
  }
  return "Aún no hay gasto libre para calcular un ritmo.";
}

function predictionPaceText(prediction) {
  const ignored = prediction.ignoredOneOffSpent > 0 ? ` Gasto único ignorado para ritmo: ${formatMoney(prediction.ignoredOneOffSpent)}.` : "";
  if (prediction.remainingDays <= 0) {
    return "El periodo termina hoy; no hay días futuros que proyectar.";
  }
  if (prediction.status === "empty") {
    return `Gasto libre que cuenta para ritmo: ${formatMoney(0)}.${ignored}`;
  }
  if (prediction.status === "learning") {
    return `Observado para ritmo: ${formatMoney(prediction.observedFreeSpent)} en ${formatDays(prediction.observedDays)}. Necesito ${formatDays(prediction.minimumObservedDays)} para proyectar.${ignored}`;
  }
  return `Ritmo usado: ${formatMoney(Math.round(prediction.dailyRate))} diarios durante ${formatDays(prediction.remainingDays)}.${ignored}`;
}

function predictionHeadline(prediction) {
  if (prediction.status === "over_reserved") {
    return "Tu plan está sobreasignado";
  }
  if (prediction.status === "empty") {
    return "Aún no hay gasto libre que proyectar";
  }
  if (prediction.status === "learning") {
    return "Aún no hay tendencia suficiente";
  }
  if (prediction.status === "risk") {
    return "Si sigues así, no alcanza";
  }
  if (prediction.status === "tight") {
    return "Llegas con poco margen";
  }
  return "Vas bien para el próximo pago";
}

function predictionCopy(prediction, endDate) {
  if (prediction.remainingDays <= 0) {
    return "El periodo termina hoy. Guarda el resultado real antes de ajustar el siguiente plan.";
  }
  if (prediction.status === "empty") {
    return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Cuando haya gasto libre real, la app empezará a observar el ritmo.`;
  }
  if (prediction.status === "learning") {
    return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Hay datos, pero todavía no los extrapolo para evitar falsas alarmas.`;
  }
  if (prediction.status === "risk") {
    if (prediction.freeToday < 0 && prediction.dailyRate === 0) {
      return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Hoy ya faltan ${formatMoney(prediction.shortage)} de dinero libre.`;
    }
    return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Si el ritmo se mantiene, podrian faltar ${formatMoney(prediction.shortage)}.`;
  }
  return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Si el ritmo se mantiene, llegarías con ${formatMoney(Math.max(0, prediction.projectedEndFree))}.`;
}

function predictionAmountLabel(prediction) {
  if (prediction.status === "over_reserved") {
    return "Por ajustar";
  }
  if (prediction.status === "risk") {
    return "Podrian faltar";
  }
  if (prediction.status === "healthy" || prediction.status === "tight") {
    return "Llegarías con";
  }
  return "Libre hoy";
}

function predictionDisplayAmount(prediction) {
  if (prediction.status === "over_reserved") {
    return prediction.overReserved || 0;
  }
  if (prediction.status === "risk") {
    return prediction.shortage;
  }
  if (prediction.status === "healthy" || prediction.status === "tight") {
    return Math.max(0, prediction.projectedEndFree);
  }
  return prediction.freeToday;
}

function predictionStatusLabel(status) {
  const labels = {
    empty: "Sin datos",
    learning: "Aprendiendo ritmo",
    healthy: "Vas bien",
    tight: "Margen justo",
    risk: "Riesgo",
    over_reserved: "Revisar plan"
  };
  return labels[status] || labels.healthy;
}

function formatDays(days) {
  const count = Math.max(0, Math.round(Number(days || 0)));
  return `${count} ${count === 1 ? "día" : "días"}`;
}

function polarPoint(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSegmentPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const p0 = polarPoint(cx, cy, rOuter, startDeg);
  const p1 = polarPoint(cx, cy, rOuter, endDeg);
  const p2 = polarPoint(cx, cy, rInner, endDeg);
  const p3 = polarPoint(cx, cy, rInner, startDeg);
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
    "Z"
  ].join(" ");
}

function animateBudgetRingCharts() {
  const arcs = document.querySelectorAll(".budget-ring-arc");
  if (!arcs.length) {
    return;
  }
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const items = Array.from(arcs).map((arc) => ({
    arc,
    cx: Number(arc.dataset.cx),
    cy: Number(arc.dataset.cy),
    rOuter: Number(arc.dataset.router),
    rInner: Number(arc.dataset.rinner),
    start: Number(arc.dataset.start),
    end: Number(arc.dataset.end)
  }));
  if (reduceMotion) {
    items.forEach(({ arc, cx, cy, rOuter, rInner, start, end }) => {
      arc.setAttribute("d", donutSegmentPath(cx, cy, rOuter, rInner, start, end));
    });
    return;
  }
  const duration = 700;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = ease(progress);
    items.forEach(({ arc, cx, cy, rOuter, rInner, start: startDeg, end: endDeg }) => {
      const currentEnd = startDeg + (endDeg - startDeg) * eased;
      arc.setAttribute("d", donutSegmentPath(cx, cy, rOuter, rInner, startDeg, currentEnd));
    });
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function renderBudgetRingChart(segments, totalText, freeText) {
  const cx = 160;
  const cy = 112;
  const rOuter = 72;
  const rInner = 54;
  const lineStart = 76;
  const lineElbow = 98;
  const labelGap = 4;

  let cursor = 0;
  const parts = segments
    .filter((segment) => segment.ratio > 0.05)
    .map((segment) => {
      const startDeg = (cursor / 100) * 360;
      cursor += segment.ratio;
      const endDeg = (cursor / 100) * 360;
      const midDeg = (startDeg + endDeg) / 2;
      const arcPath = donutSegmentPath(cx, cy, rOuter, rInner, startDeg, startDeg);
      const lineFrom = polarPoint(cx, cy, lineStart, midDeg);
      const lineTo = polarPoint(cx, cy, lineElbow, midDeg);
      const onRight = lineTo.x >= cx;
      const labelX = lineTo.x + (onRight ? labelGap : -labelGap);
      const anchor = onRight ? "start" : "end";
      return `
        <path class="budget-ring-arc" d="${arcPath}" fill="${segment.color}" data-cx="${cx}" data-cy="${cy}" data-router="${rOuter}" data-rinner="${rInner}" data-start="${startDeg.toFixed(3)}" data-end="${endDeg.toFixed(3)}"></path>
        <line class="budget-ring-line" x1="${lineFrom.x.toFixed(1)}" y1="${lineFrom.y.toFixed(1)}" x2="${lineTo.x.toFixed(1)}" y2="${lineTo.y.toFixed(1)}" stroke="${segment.color}"></line>
        <text class="budget-ring-label-name" x="${labelX.toFixed(1)}" y="${(lineTo.y - 4).toFixed(1)}" text-anchor="${anchor}" fill="${segment.color}">${escapeHtml(segment.label)}</text>
        <text class="budget-ring-label-amount" x="${labelX.toFixed(1)}" y="${(lineTo.y + 11).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(segment.amountLabel)}</text>
      `;
    })
    .join("");

  return `
    <svg class="budget-ring-svg" viewBox="0 0 320 224" role="img" aria-label="Distribución del presupuesto: ${segments.map((s) => `${s.label} ${Math.round(s.ratio)} por ciento`).join(", ")}">
      ${parts}
      <text class="budget-ring-center-eyebrow" x="${cx}" y="${cy - 22}" text-anchor="middle">Total</text>
      <text class="budget-ring-center-amount" x="${cx}" y="${cy + 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
      <text class="budget-ring-center-free" x="${cx}" y="${cy + 26}" text-anchor="middle">${escapeHtml(freeText)}</text>
    </svg>
  `;
}

function renderBudget(plan) {
  const summary = budgetSummary();
  const closeReport = periodCloseReport(plan, summary);
  const ring = getBudgetRingAllocation(summary);
  const reservedRatio = (ring.reserved / Math.max(1, ring.total)) * 100;
  const spentRatio = (ring.spent / Math.max(1, ring.total)) * 100;
  const freeRatio = (ring.free / Math.max(1, ring.total)) * 100;
  const period = `${formatShortDate(summary.window.start)} - ${formatShortDate(previousDay(summary.window.end))}`;

  return `
    <section class="screen-view plan-view" aria-label="Plan del periodo">
      <div class="screen-title-row">
        <div>
          <p class="eyebrow">Organiza antes de gastar</p>
          <h1>Plan del periodo</h1>
        </div>
        <span class="period-chip">${period}</span>
      </div>

      <article class="plan-distribution">
        ${renderBudgetRingChart(
          [
            { key: "reserved", label: "Reservado", ratio: reservedRatio, amountLabel: formatCompactMoney(ring.reserved), color: "var(--ds-plum, #6b5a8d)" },
            { key: "spent", label: "Gastado", ratio: spentRatio, amountLabel: formatCompactMoney(ring.spent), color: "var(--ds-amber)" },
            { key: "free", label: "Libre", ratio: freeRatio, amountLabel: formatCompactMoney(ring.free), color: "#69d5b5" }
          ],
          formatMoney(summary.income),
          `${Math.round(freeRatio)}% libre`
        )}
        ${ring.outside > 0 ? `<p class="inline-warning">Gastos fuera del presupuesto: ${formatMoney(ring.outside)}.</p>` : ""}
      </article>

      ${shouldShowPeriodClose(closeReport) ? renderPeriodCloseCard(summary, plan, closeReport) : ""}
      ${renderPeriodReportCard(summary, plan, closeReport)}

      <div class="plan-actions">
        <button class="plan-action" type="button" data-action="open-extra-sheet">
          <span class="plan-action-icon extra-icon" aria-hidden="true">+</span>
          <span><strong>Registrar dinero extra</strong><small>Bonos, regalos o ventas</small></span>
          <b>&rsaquo;</b>
        </button>
        ${
          summary.extraIncome > 0
            ? `<span class="extra-inline-summary">${formatMoney(summary.extraIncome)} extra en este periodo · ${periodExtraSourceLabel(summary)}</span>`
            : ""
        }
      </div>

      <div class="section-heading">
        <h2>Categorías <span>(${state.budgetJobs.length} de 10)</span></h2>
        <span>${formatMoney(summary.freeBudget)} reservables</span>
      </div>

      <div class="plan-category-list">
        ${
          state.budgetJobs.length
            ? state.budgetJobs.map((job) => renderBudgetJob(job)).join("")
            : `<div class="empty-state actionable-empty">
                <span class="empty-icon" aria-hidden="true">+</span>
                <strong>Aún no separas dinero por categorías</strong>
                <span>Aparta plata para algo y verás su límite siempre antes de gastar.</span>
                <button class="btn primary" type="button" data-action="open-setaside-sheet">Apartar dinero</button>
              </div>`
        }
        <button class="add-category-row" type="button" data-action="open-add-category-choice" ${state.budgetJobs.length >= 10 ? "disabled" : ""}>
          <span aria-hidden="true">+</span>
          <div class="add-category-row-text">
            <strong>Nueva categoría</strong>
            <small>Una vez o recurrente · max. ${formatCompactMoney(summary.freeBudget)}</small>
          </div>
        </button>
      </div>
    </section>
  `;
}

function renderPeriodCloseCard(summary = budgetSummary(), plan = calculatePlan(), report = periodCloseReport(plan, summary)) {
  const closedLine = renderPeriodCloseSavedLine(report.closure);
  const freeClass = report.freeFinal < 0 ? "negative" : "";

  return `
    <article class="period-close-card ${report.status}">
      <div class="period-close-heading">
        <div>
          <p class="eyebrow">Cierre de periodo</p>
          <h2>${report.isFinal ? "Resultado listo para guardar" : "Prepara el próximo plan"}</h2>
        </div>
        ${closedLine}
      </div>
      <div class="period-close-metrics">
        <div><span>${report.isFinal ? "Libre final" : "Libre si cerrarás hoy"}</span><strong class="${freeClass}">${formatMoney(report.freeFinal)}</strong></div>
        <div><span>Categorías excedidas</span><strong>${report.exceededCategories.length}</strong></div>
        <div><span>Ahorro posible</span><strong>${formatMoney(report.possibleSavings)}</strong></div>
      </div>
      <p>${periodCloseCardText(report)}</p>
      <button class="btn secondary" type="button" data-view="periodClose">Ver cierre</button>
    </article>
  `;
}

function renderPeriodCloseScreen(plan = calculatePlan()) {
  const summary = budgetSummary();
  const report = periodCloseReport(plan, summary);
  if (!shouldShowPeriodClose(report)) {
    return renderPeriodCloseWaiting(summary, report);
  }
  const period = `${formatShortDate(summary.window.start)} - ${formatShortDate(previousDay(summary.window.end))}`;
  const freeClass = report.freeFinal < 0 ? "negative" : "positive";

  return `
    <section class="screen-view period-close-view" aria-label="Cierre de periodo">
      <div class="screen-title-row">
        <div>
          <p class="eyebrow">${report.isFinal ? "Fin del periodo" : "Pre-cierre"}</p>
          <h1>Cierre de periodo</h1>
        </div>
        <span class="period-chip">${period}</span>
      </div>

      <article class="period-close-hero ${freeClass}">
        <span>${report.isFinal ? "Libre final" : "Libre si cerrarás hoy"}</span>
        <strong>${formatMoney(report.freeFinal)}</strong>
        <p>${periodCloseHeroText(report)}</p>
      </article>

      <div class="period-close-grid">
        <article class="period-close-panel">
          <div class="period-close-panel-head">
            <p class="eyebrow">Categorías excedidas</p>
            <h2>${report.exceededCategories.length ? `${report.exceededCategories.length} por ajustar` : "Sin excedidos"}</h2>
          </div>
          ${renderExceededCategories(report)}
        </article>

        <article class="period-close-panel">
          <div class="period-close-panel-head">
            <p class="eyebrow">Ahorro sugerido vs posible</p>
            <h2>${report.savingsGap > 0 ? `Faltaría ${formatMoney(report.savingsGap)}` : "Cabe en el plan"}</h2>
          </div>
          <div class="savings-compare">
            <div><span>Sugerido ideal</span><strong>${formatMoney(report.suggestedSavings)}</strong></div>
            <div><span>Posible real</span><strong>${formatMoney(report.possibleSavings)}</strong></div>
          </div>
          <p>${periodCloseSavingsText(report)}</p>
        </article>

        <article class="period-close-panel period-close-adjust-panel">
          <div class="period-close-panel-head">
            <p class="eyebrow">Qué ajustar para el próximo</p>
            <h2>${report.adjustments.length ? "Acciones concretas" : "Mantener plan"}</h2>
          </div>
          <ol class="period-adjustments">
            ${report.adjustments.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ol>
        </article>
      </div>

      ${renderPeriodReportCard(summary, plan, report)}

      <div class="period-close-actions">
        <button class="btn primary" type="button" data-action="save-period-close">${report.closure ? "Actualizar cierre" : report.isFinal ? "Guardar cierre final" : "Guardar pre-cierre"}</button>
        <button class="btn ghost" type="button" data-view="budget">Volver al plan</button>
      </div>
    </section>
  `;
}

function renderPeriodCloseWaiting(summary, report) {
  const period = `${formatShortDate(summary.window.start)} - ${formatShortDate(previousDay(summary.window.end))}`;
  return `
    <section class="screen-view period-close-view" aria-label="Cierre de periodo">
      <div class="screen-title-row">
        <div>
          <p class="eyebrow">Cierre de periodo</p>
          <h1>Todavía no toca cerrar</h1>
        </div>
        <span class="period-chip">${period}</span>
      </div>
      <article class="period-close-panel period-close-waiting">
        <div class="period-close-panel-head">
          <p class="eyebrow">Disponible al final</p>
          <h2>Faltan ${formatDays(report.remainingDays)}</h2>
        </div>
        <p>El cierre aparece cuando falten ${PERIOD_CLOSE_NOTICE_DAYS} días o menos para el próximo periodo, incluyendo el día que se vence.</p>
        <button class="btn ghost" type="button" data-view="budget">Volver al plan</button>
      </article>
      ${renderPeriodReportCard(summary, calculatePlan(), report)}
    </section>
  `;
}

function renderPeriodReportCard(summary = budgetSummary(), plan = calculatePlan(), report = periodCloseReport(plan, summary)) {
  const movements = movementsForSummary(summary);
  const expenses = movements.filter((movement) => movement.kind === "expense");
  const totalExpenses = dailyExpenseTotal(movements);
  const period = `${formatShortDate(summary.window.start)} - ${formatShortDate(previousDay(summary.window.end))}`;
  return `
    <article class="period-report-card" aria-label="Reporte completo del periodo">
      <div class="period-report-head">
        <div>
          <p class="eyebrow">Reporte del periodo</p>
          <h2>Resumen completo listo</h2>
        </div>
        <span class="metric-badge">${period}</span>
      </div>
      <div class="period-report-mini">
        <div><span class="mini-icon" aria-hidden="true">${renderIcon("wallet")}</span><span>Gastos</span><strong>${formatMoney(totalExpenses)}</strong></div>
        <div><span class="mini-icon" aria-hidden="true">${renderIcon("list")}</span><span>Movimientos</span><strong>${movements.length}</strong></div>
        <div><span class="mini-icon" aria-hidden="true">${renderIcon("ban")}</span><span>Excedidas</span><strong>${report.exceededCategories.length}</strong></div>
      </div>
      <p>Genera un texto con libre, categorías, ahorro, predicción, días con gasto, comercios y movimientos del periodo.</p>
      <button class="btn secondary" type="button" data-action="open-period-report">${expenses.length ? "Generar reporte" : "Ver reporte"}</button>
    </article>
  `;
}

function renderPeriodReportModal(plan = calculatePlan()) {
  const summary = budgetSummary();
  const report = periodCloseReport(plan, summary);
  const content = generatePeriodReport(plan, summary, report);
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-period-report">
      <section class="bottom-sheet period-report-modal" role="dialog" aria-modal="true" aria-labelledby="period-report-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div>
            <p class="eyebrow">Reporte del periodo</p>
            <h2 id="period-report-title">Resumen completo</h2>
          </div>
          <button class="icon-btn muted" type="button" data-action="close-period-report" aria-label="Cerrar">x</button>
        </div>
        <textarea id="period-report-output" class="period-report-output" readonly>${escapeHtml(content)}</textarea>
        <div class="period-report-actions">
          <button class="btn primary" type="button" data-action="copy-period-report">Copiar reporte</button>
          <button class="btn secondary" type="button" data-action="download-period-report">Descargar .txt</button>
          <button class="btn ghost" type="button" data-action="close-period-report">Cerrar</button>
        </div>
      </section>
    </div>
  `;
}

function renderPeriodCloseSavedLine(closure) {
  if (!closure) {
    return "";
  }
  return `<span class="period-close-saved">Guardado ${formatShortDate(String(closure.closedAt || "").slice(0, 10) || todayKey())}</span>`;
}

function periodCloseReport(plan = calculatePlan(), summary = budgetSummary()) {
  const prediction = periodPrediction();
  const closure = periodClosureForWindow(summary.window);
  const categories = categoryStatus()
    .map((category) => ({
      ...category,
      over: Math.max(0, Number(category.spent || 0) - Number(category.budget || 0))
    }))
    .filter((category) => category.over > 0)
    .sort((a, b) => b.over - a.over);
  const freeFinal = Math.round(summary.freeBudget - summary.freeImpactSpent);
  const possibleSavings = Math.max(0, Number(plan.projectedPeriodSavings || 0));
  const suggestedSavings = Math.max(0, Number(plan.idealPeriodSavings || 0));
  const savingsGap = Math.max(0, Number(plan.savingsCapacityGap || 0));
  const movements = movementsForSummary(summary);
  const status = periodCloseStatus(summary, categories, freeFinal, savingsGap);

  return {
    summary,
    prediction,
    closure,
    isFinal: prediction.remainingDays <= 0,
    remainingDays: prediction.remainingDays,
    freeFinal,
    exceededCategories: categories,
    suggestedSavings,
    possibleSavings,
    additionalSavingsNow: Math.max(0, Number(plan.suggestedPeriodSavings || 0)),
    savingsGap,
    expenseCount: movements.filter((movement) => movement.kind === "expense").length,
    incomeCount: movements.filter((movement) => movement.kind === "income").length,
    status,
    adjustments: periodCloseAdjustments(summary, plan, categories, freeFinal)
  };
}

function shouldShowPeriodClose(report = periodCloseReport()) {
  return Number(report.remainingDays || 0) <= PERIOD_CLOSE_NOTICE_DAYS;
}

function periodCloseStatus(summary, exceededCategories, freeFinal, savingsGap) {
  if (summary.overReserved > 0 || freeFinal < 0) {
    return "risk";
  }
  if (exceededCategories.length || savingsGap > 0) {
    return "tight";
  }
  return "healthy";
}

function periodCloseCardText(report) {
  if (!report.isFinal) {
    return `Faltan ${formatDays(report.remainingDays)}. Puedes revisar el cierre hoy y ajustar el siguiente plan antes de que se acabe el periodo.`;
  }
  if (report.freeFinal < 0) {
    return `El periodo cerro con faltante de dinero libre. Guarda el cierre y baja gasto libre o sube límites realistas.`;
  }
  return `Guarda una foto del resultado final y usa los ajustes para el próximo periodo.`;
}

function periodCloseHeroText(report) {
  if (!report.isFinal) {
    return `Todavía no termina: faltan ${formatDays(report.remainingDays)}. Este número muestra como quedaría si cerrarás el periodo hoy.`;
  }
  if (report.freeFinal < 0) {
    return `Faltaron ${formatMoney(Math.abs(report.freeFinal))} de dinero libre después de gastos sin categoría y excesos.`;
  }
  return `Quedaron ${formatMoney(report.freeFinal)} libres después de gastos sin categoría y excesos.`;
}

function renderExceededCategories(report) {
  if (!report.exceededCategories.length) {
    return `<div class="empty-state compact-empty">No hay categorías por encima del límite. Buen cierre.</div>`;
  }
  return `
    <div class="period-close-list">
      ${report.exceededCategories
        .map(
          (category) => `
            <div class="period-close-row">
              <span>${escapeHtml(category.name)}</span>
              <strong>${formatMoney(category.over)} de exceso</strong>
              <small>${formatMoney(category.spent)} usados de ${formatMoney(category.budget)}</small>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function periodCloseSavingsText(report) {
  if (report.savingsGap > 0) {
    return `El ahorro ideal no cupo completo. Lo posible incluye lo ya reservado más ${formatMoney(report.additionalSavingsNow)} que todavía caben desde el libre.`;
  }
  if (report.possibleSavings > 0) {
    return `El ahorro sugerido cabe en este periodo. Puedes separar hasta ${formatMoney(report.additionalSavingsNow)} adicionales sin forzar el plan.`;
  }
  return `No hay ahorro posible en este cierre. Primero libera gasto libre o reduce categorías excedidas.`;
}

function periodCloseAdjustments(summary, plan, exceededCategories, freeFinal) {
  const adjustments = [];
  if (freeFinal < 0) {
    adjustments.push(`Recupera ${formatMoney(Math.abs(freeFinal))} bajando gasto libre o moviendo dinero desde una categoría menos usada.`);
  }
  if (summary.overReserved > 0) {
    adjustments.push(`Baja reservas por ${formatMoney(summary.overReserved)}; el plan separa más dinero del que entra.`);
  }
  exceededCategories.slice(0, 3).forEach((category) => {
    if (category.id === FREE_CATEGORY_ID) {
      adjustments.push(`Convierte ${formatMoney(category.over)} de gasto libre repetido en una categoría con límite propio.`);
      return;
    }
    adjustments.push(`Ajusta ${category.name}: sube el límite a ${formatMoney(category.spent)} o baja ${formatMoney(category.over)} de gasto.`);
  });
  if (summary.freeSpent > 0 && !exceededCategories.some((category) => category.id === FREE_CATEGORY_ID)) {
    adjustments.push(`Revisa ${formatMoney(summary.freeSpent)} sin categoría para decidir si era gasto libre real o falta una regla por comercio.`);
  }
  if (Number(plan.savingsCapacityGap || 0) > 0) {
    adjustments.push(`Para acercarte al ahorro ideal, libera ${formatMoney(plan.savingsCapacityGap)} en el próximo periodo.`);
  }
  if (!adjustments.length && freeFinal > 0) {
    adjustments.push(`Mantén los límites y considera mover ${formatMoney(freeFinal)} sobrantes a ahorro antes de iniciar el próximo periodo.`);
  }
  if (!adjustments.length) {
    adjustments.push("Mantén el plan actual y registra gastos desde el primer día del próximo periodo.");
  }
  return adjustments.slice(0, 5);
}

function generatePeriodReport(plan = calculatePlan(), summary = budgetSummary(), report = periodCloseReport(plan, summary)) {
  const prediction = report.prediction || periodPrediction();
  const liquidity = liquiditySummary(summary);
  const periodEnd = previousDay(summary.window.end);
  const transactions = transactionsForSummary(summary);
  const movements = movementsForSummary(summary).slice().sort(compareTransactionsByRecent);
  const totalExpenses = transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const oneOffTotal = transactions
    .filter((transaction) => transaction.oneOff)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const unclassified = transactions.filter((transaction) => !transaction.labeled || !transaction.category || transaction.category === FREE_CATEGORY_ID);
  const unclassifiedTotal = unclassified.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const dailyTotals = periodReportDailyTotals(summary);
  const merchants = periodReportMerchantTotals(summary);
  const categories = periodReportCategoryLines();
  const movementLines = periodReportMovementLines(movements);
  const cadence = capitalize(summary.cadenceLabel || cadenceLabel(state.profile.incomeCadence));
  const lines = [
    "Reporte del periodo",
    `Periodo: ${summary.window.start} a ${periodEnd}`,
    `Frecuencia: ${cadence}`,
    `Generado: ${todayKey()}`,
    "",
    "Resumen de dinero",
    `Ingreso base: ${formatMoney(summary.baseIncome)}`,
    `Dinero extra: ${formatMoney(summary.extraIncome)}`,
    `Ingreso total del periodo: ${formatMoney(summary.income)}`,
    `Reservado en categorías: ${formatMoney(summary.reserved)}`,
    `Dinero libre inicial: ${formatMoney(summary.freeBudget)}`,
    `Gasto total registrado: ${formatMoney(totalExpenses)}`,
    `Gasto libre real: ${formatMoney(summary.freeImpactSpent)}`,
    `Saldo no comprometido (ya en tu cuenta/efectivo): ${formatMoney(summary.unclaimedLiquidity)}`,
    `Libre hoy: ${formatMoney(prediction.freeToday)}`,
    `Libre disponible visible: ${formatMoney(summary.freeRemaining)}`,
    `Libre de cierre: ${formatMoney(report.freeFinal)}`,
    `Saldo real en cuenta: ${formatMoney(liquidity.account)}`,
    `Saldo real en efectivo: ${formatMoney(liquidity.cash)}`,
    `Saldo real total: ${formatMoney(liquidity.total)}`,
    "",
    "Predicción",
    predictionOutcomeText(prediction),
    predictionPaceText(prediction),
    `Resultado proyectado: ${formatMoney(prediction.projectedEndFree)}`,
    `Días restantes: ${prediction.remainingDays}`,
    "",
    "Ahorro",
    `Ahorro sugerido ideal: ${formatMoney(report.suggestedSavings)}`,
    `Ahorro posible real: ${formatMoney(report.possibleSavings)}`,
    `Ahorro adicional que cabe hoy: ${formatMoney(report.additionalSavingsNow)}`,
    `Brecha contra ideal: ${formatMoney(report.savingsGap)}`,
    "",
    "Categorías",
    ...categories,
    "",
    "Control de gasto libre",
    `Gastos sin categoría o libre: ${formatMoney(summary.freeSpent)}`,
    `Excesos de categorías: ${formatMoney(summary.categoryOverspent)}`,
    `Movimientos sin clasificar: ${unclassified.length} por ${formatMoney(unclassifiedTotal)}`,
    `Gastos únicos ignorados para ritmo diario: ${formatMoney(oneOffTotal)}`,
    "",
    "Días con gasto",
    ...(dailyTotals.length ? dailyTotals.map((day) => `${day.date}: ${formatMoney(day.total)} en ${day.count} ${day.count === 1 ? "gasto" : "gastos"}`) : ["Sin gastos registrados en este periodo."]),
    "",
    "Comercios principales",
    ...(merchants.length ? merchants.map((merchant) => `${merchant.name}: ${formatMoney(merchant.total)} en ${merchant.count} ${merchant.count === 1 ? "gasto" : "gastos"}`) : ["Sin comercios registrados."]),
    "",
    "Qué ajustar para el próximo periodo",
    ...report.adjustments.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Movimientos",
    ...(movementLines.length ? movementLines : ["Sin movimientos registrados en este periodo."])
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function periodReportCategoryLines() {
  const categories = categoryStatus()
    .slice()
    .sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0) || String(a.name).localeCompare(String(b.name)));
  if (!categories.length) {
    return ["Sin categorías creadas."];
  }
  return categories.map((category) => {
    const budget = Number(category.budget || 0);
    const spent = Number(category.spent || 0);
    const remaining = budget - spent;
    const status = remaining < 0 ? `excedida por ${formatMoney(Math.abs(remaining))}` : `quedan ${formatMoney(remaining)}`;
    return `${category.name}: ${formatMoney(spent)} de ${formatMoney(budget)} (${status})`;
  });
}

function periodReportDailyTotals(summary = budgetSummary()) {
  const totals = transactionsForSummary(summary).reduce((acc, transaction) => {
    const date = String(transaction.date || todayKey()).slice(0, 10);
    acc[date] ||= { date, total: 0, count: 0 };
    acc[date].total += Number(transaction.amount || 0);
    acc[date].count += 1;
    return acc;
  }, {});
  return Object.values(totals).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function periodReportMerchantTotals(summary = budgetSummary()) {
  const totals = transactionsForSummary(summary).reduce((acc, transaction) => {
    const name = cleanText(transaction.merchant, "Comercio");
    const key = merchantKey(name) || name.toLowerCase();
    acc[key] ||= { name, total: 0, count: 0 };
    acc[key].total += Number(transaction.amount || 0);
    acc[key].count += 1;
    return acc;
  }, {});
  return Object.values(totals)
    .sort((a, b) => b.total - a.total || b.count - a.count || String(a.name).localeCompare(String(b.name)))
    .slice(0, 8);
}

function periodReportMovementLines(movements = []) {
  return movements.map((movement) => {
    if (movement.kind === "income") {
      const extra = movement.extra;
      const savingsAmount = Number(extra.allocation?.savingsAmount || 0);
      const savingsText = savingsAmount > 0 ? `, ahorro ${formatMoney(savingsAmount)}` : "";
      return `+ ${String(extra.date || "").slice(0, 10)} - ${extra.source} - ${formatMoney(extra.amount)} (${locationLabel(extra.location)}${savingsText})`;
    }
    const transaction = movement.transaction;
    const category = !transaction.labeled || !transaction.category || transaction.category === FREE_CATEGORY_ID ? "Sin clasificar" : categoryName(transaction.category);
    const oneOff = transaction.oneOff ? " - gasto único" : "";
    const description = transaction.description ? ` - ${transaction.description}` : "";
    return `- ${String(transaction.date || "").slice(0, 10)} - ${transaction.merchant}${description} - ${category} - ${locationLabel(transaction.source)} - ${formatMoney(transaction.amount)}${oneOff}`;
  });
}

function renderBudgetJobForm() {
  const summary = budgetSummary();
  return `
    <form class="sheet-form" id="budget-job-form">
      <label>
        Nombre
        <input name="name" type="text" placeholder="Ej. Mercado semanal" maxlength="32" required>
      </label>
      <label>
        Monto
        <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" required>
      </label>
      <div class="sheet-field">
        <span class="sheet-label">Frecuencia</span>
        ${renderChoicePills("cadence", [
          { value: "weekly", label: "Semanal" },
          { value: "biweekly", label: "Quincenal" },
          { value: "monthly", label: "Mensual" }
        ], "monthly")}
      </div>
      <div class="conversion-box" data-category-conversion>
        <span>Conversión automática</span>
        <strong>Escribe un monto para ver su valor en este periodo.</strong>
        <small>Disponible para reservar: ${formatMoney(summary.freeRemaining)}</small>
      </div>
      <div class="limit-warning" data-category-limit-warning hidden>
        <span aria-hidden="true">!</span>
        <p>Esta categoría excede el dinero libre del periodo.</p>
      </div>
      <button class="btn primary" type="submit" data-category-submit>Agregar categoría</button>
      <button class="btn ghost" type="button" data-action="close-plan-sheet">Cancelar</button>
    </form>
  `;
}

// Single entry point for "Nueva categoría" in Plan. Used to be two buttons sitting
// side by side (setaside vs recurring) with no explanation of when to pick which —
// this picks for the user in one tap by asking the actual question, then routes to
// whichever of the two purpose-built forms below fits. Neither form changed: setaside
// still tops up an existing envelope by name instead of duplicating it, and the
// recurring form still asks for a cadence. Only the entry UI got consolidated.
function renderAddCategoryChoiceSheet() {
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="add-category-choice-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Plan</p><h2 id="add-category-choice-title">Nueva categoría</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">x</button>
        </div>
        <button class="add-category-row" type="button" data-action="open-setaside-sheet">
          <span aria-hidden="true">$</span>
          <div class="add-category-row-text">
            <strong>Apartar dinero</strong>
            <small>Una vez, en este periodo — para algo puntual</small>
          </div>
        </button>
        <button class="add-category-row" type="button" data-action="open-category-sheet">
          <span aria-hidden="true">+</span>
          <div class="add-category-row-text">
            <strong>Apartar cada semana o mes</strong>
            <small>Para algo que pagas siempre, como el mercado</small>
          </div>
        </button>
      </section>
    </div>
  `;
}

// Plain-language front door for reserving money, in the "envelope" mental model people
// already use ("aparté plata para los remedios"). Deliberately asks only two things —
// how much, and what for — where renderBudgetJobForm also asks for a frequency: this
// reserves once for the current period (cadence "period"), which is what a one-off
// "aparté esto ahora" actually means. Recurring reserves still go through the full form.
function renderSetAsideSheet() {
  const summary = budgetSummary();
  const reusable = state.budgetJobs.slice(0, 6);
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="setaside-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Tu plata</p><h2 id="setaside-sheet-title">Apartar dinero</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">x</button>
        </div>
        <p class="setaside-note">Guardas esta plata para algo, y deja de contar como libre. Tu cuenta y tu efectivo siguen igual: aquí no se mueve dinero de verdad.</p>
        <form class="sheet-form setaside-form" id="setaside-form">
          <label>
            ¿Cuánto quieres apartar?
            <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" required>
          </label>
          <label>
            ¿Para qué es?
            <input name="name" type="text" maxlength="32" placeholder="Ej. Remedios, mercado" autocomplete="off" required>
          </label>
          ${
            reusable.length
              ? `<div class="setaside-suggestions">
                  <span class="sheet-label">O toca una que ya tienes</span>
                  <div class="setaside-chips">
                    ${reusable
                      .map(
                        (job) => `<button class="choice-pill" type="button" data-setaside-name="${escapeAttr(job.name)}">${escapeHtml(job.name)}</button>`
                      )
                      .join("")}
                  </div>
                </div>`
              : ""
          }
          <div class="conversion-box" data-setaside-preview aria-live="polite">
            <span>Después de apartar</span>
            <strong>Escribe un monto para ver cuánto te queda libre.</strong>
            <small>Ahora tienes ${formatMoney(summary.freeRemaining)} libres.</small>
          </div>
          <div class="limit-warning" data-setaside-warning hidden>
            <span aria-hidden="true">!</span>
            <p>No puedes apartar más de lo que tienes libre.</p>
          </div>
          <button class="btn primary" type="submit" data-setaside-submit>Apartar dinero</button>
          <button class="btn ghost" type="button" data-action="close-plan-sheet">Cancelar</button>
        </form>
      </section>
    </div>
  `;
}

function renderPlanSheet() {
  if (planSheet === "add-category-choice") {
    return renderAddCategoryChoiceSheet();
  }

  if (planSheet === "setaside") {
    return renderSetAsideSheet();
  }

  if (planSheet === "category") {
    return `
      <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
        <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="category-sheet-title">
          <div class="sheet-handle"></div>
          <div class="sheet-heading">
            <div><p class="eyebrow">Plan</p><h2 id="category-sheet-title">Apartar cada semana o mes</h2></div>
            <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">x</button>
          </div>
          ${renderBudgetJobForm()}
        </section>
      </div>
    `;
  }

  // One sheet: origin, amount, where it landed, AND the savings suggestion. The brief's
  // flow E ("antes de sumarlo, la app propone separar un porcentaje") used to take a
  // second sheet after "Continuar"; the proposal now sits right under the amount, with
  // the suggestion preselected and "Dejar todo libre" one tap away.
  const target = savingsAllocationTarget();
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="extra-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><span class="extra-badge">Dinero extra</span><h2 id="extra-sheet-title">¿De dónde viene?</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">x</button>
        </div>
        <form class="sheet-form" id="extra-budget-form">
          <label>Origen<input name="source" type="text" maxlength="36" placeholder="Ej. Bono trabajo" required></label>
          <label>Monto<input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" required></label>
          <input name="date" type="hidden" value="${todayKey()}">
          <div class="sheet-field">
            <span class="sheet-label">¿Dónde entró?</span>
            ${renderChoicePills("location", [
              { value: "account", label: "Cuenta" },
              { value: "cash", label: "Efectivo" }
            ], "account")}
          </div>
          <div class="extra-suggestion-card" aria-live="polite">
            <span>Una sugerencia antes de sumarlo</span>
            <strong data-extra-savings>${formatMoney(0)}</strong>
            <p>para ${escapeHtml(target.label)}. Los <b data-extra-free>${formatMoney(0)}</b> restantes quedan libres. No mueve dinero de tu cuenta.</p>
          </div>
          <label>
            <span>Porcentaje para ${escapeHtml(target.label)} <output data-extra-percent>20%</output></span>
            <input name="savingsPercent" type="range" min="0" max="100" step="5" value="20" data-extra-range>
          </label>
          <button class="btn primary" type="submit" name="intent" value="split">Sumar dinero extra</button>
          <button class="btn ghost" type="submit" name="intent" value="all-free">Dejar todo libre</button>
        </form>
      </section>
    </div>
  `;
}

function renderAllocation(label, amount, type) {
  return `
    <div class="allocation-row ${type}">
      <span>${label}</span>
      <strong>${formatMoney(amount)}</strong>
    </div>
  `;
}

function categoryIconFor(name) {
  const value = String(name || "").toLowerCase();
  if (/gasolina|combust|carro|transporte|uber|taxi|bus|moto/.test(value)) {
    return /transporte|uber|taxi|bus/.test(value) ? "car" : "fuel";
  }
  if (/comida|mercado|almuerzo|restaurante|alimentaci/.test(value)) {
    return "food";
  }
  return "tag";
}

function renderBudgetJob(job) {
  const spent = spendByCategory()[job.id] || 0;
  const budget = getBudgetAmountForJob(job, state.profile);
  const ratio = budget ? (spent / budget) * 100 : 0;
  const band = ratio > 90 ? "danger" : ratio > 65 ? "warning" : "good";
  const remaining = Math.max(0, budget - spent);
  const status = categoryStatusLabel(ratio);

  return `
    <article class="plan-category-card ${band}">
      <div class="category-card-top">
        <div class="category-card-heading">
          <span class="category-card-icon" aria-hidden="true">${renderIcon(categoryIconFor(job.name))}</span>
          <div>
            <strong>${escapeHtml(job.name)}</strong>
            <span>${capitalize(cadenceLabel(job.cadence))} · ${formatMoney(job.amount)}</span>
          </div>
        </div>
        <button class="category-menu-btn" type="button" data-action="request-remove-job" data-id="${escapeAttr(job.id)}" aria-label="Eliminar ${escapeAttr(job.name)}">&middot;&middot;&middot;</button>
      </div>
      <div class="category-card-bar ${band}" aria-label="${Math.round(ratio)} por ciento usado">
        <span style="width:${clamp(ratio, 0, 120)}%"></span>
      </div>
      <div class="category-card-foot">
        <span><strong>${formatMoney(spent)}</strong> usado</span>
        <span class="category-status">${status} · ${formatCompactMoney(remaining)} restante</span>
      </div>
    </article>
  `;
}

function renderJobRemovalConfirmation() {
  const job = state.budgetJobs.find((item) => item.id === pendingJobRemovalId);
  if (!job) {
    return "";
  }
  const affected = state.transactions.filter((transaction) => transaction.category === job.id).length;
  return `
    <div class="sheet-backdrop destructive-backdrop" role="presentation" data-action="cancel-remove-job">
      <section class="bottom-sheet destructive-sheet" role="alertdialog" aria-modal="true" aria-labelledby="remove-category-title">
        <div class="sheet-handle"></div>
        <span class="destructive-icon" aria-hidden="true">!</span>
        <h2 id="remove-category-title">Eliminar ${escapeHtml(job.name)}</h2>
        <p>La reserva desaparecerá del plan. Tus movimientos no se borran.</p>
        <div class="destructive-consequence">
          <strong>${affected} ${affected === 1 ? "gasto quedará" : "gastos quedarán"} sin clasificar</strong>
          <span>Podrás reclasificarlos después desde Movimientos.</span>
        </div>
        <button class="btn danger" type="button" data-action="confirm-remove-job">Eliminar categoría</button>
        <button class="btn ghost" type="button" data-action="cancel-remove-job">Conservar categoría</button>
      </section>
    </div>
  `;
}

function formatBackupTimestamp(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "fecha desconocida";
  }
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function renderBackupRestoreConfirmation() {
  const backup = readLocalBackups().find((item) => item.id === pendingBackupRestoreId);
  if (!backup) {
    return "";
  }
  return `
    <div class="sheet-backdrop destructive-backdrop" role="presentation" data-action="cancel-restore-backup">
      <section class="bottom-sheet destructive-sheet" role="alertdialog" aria-modal="true" aria-labelledby="restore-backup-title">
        <div class="sheet-handle"></div>
        <span class="destructive-icon" aria-hidden="true">!</span>
        <h2 id="restore-backup-title">Restaurar copia del ${escapeHtml(formatBackupTimestamp(backup.created_at))}</h2>
        <p>Reemplazará tu presupuesto, movimientos y ahorro actuales por los de esa copia. Antes de reemplazar, guardamos tus datos actuales como otra copia.</p>
        <div class="destructive-consequence">
          <strong>${backup.counts?.transactions || 0} movimientos, ${backup.counts?.fields || 0} categorías</strong>
          <span>Es lo que había guardado en ese momento.</span>
        </div>
        <button class="btn danger" type="button" data-action="confirm-restore-backup">Restaurar esta copia</button>
        <button class="btn ghost" type="button" data-action="cancel-restore-backup">Cancelar</button>
      </section>
    </div>
  `;
}

function renderDeleteAccountConfirmation() {
  return `
    <div class="sheet-backdrop destructive-backdrop" role="presentation" data-action="cancel-delete-account">
      <section class="bottom-sheet destructive-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
        <div class="sheet-handle"></div>
        <span class="destructive-icon" aria-hidden="true">!</span>
        <h2 id="delete-account-title">Eliminar tu cuenta y tus datos</h2>
        <p>Se borraran tu presupuesto, movimientos, categorías y ahorro guardados en la nube. Esto no se puede deshacer.</p>
        <div class="destructive-consequence">
          <strong>También se cerrará tu sesión en este dispositivo</strong>
          <span>Tu correo queda registrado por si quieres volver a crear un plan. Para retirarlo por completo de nuestro sistema, escribenos a ${escapeHtml(SUPPORT_EMAIL)}.</span>
        </div>
        ${cloudState.status === "error" && cloudState.error ? `<p class="form-error" role="alert">${escapeHtml(cloudState.error)}</p>` : ""}
        <button class="btn danger" type="button" data-action="confirm-delete-account">Eliminar cuenta y datos</button>
        <button class="btn ghost" type="button" data-action="cancel-delete-account">Cancelar</button>
      </section>
    </div>
  `;
}

function renderSavings(plan) {
  const summary = budgetSummary();
  const targetCovered = plan.emergencyGap <= 0;
  const periodsToTarget = plan.projectedPeriodSavings > 0
    ? Math.ceil(plan.emergencyGap / plan.projectedPeriodSavings)
    : 0;
  const futureRaise = getMonthlyIncome(state.profile) * (state.settings.monthlyRaisePct / 100);
  const escalatedSavings = futureRaise * (state.settings.escalationPct / 100);

  return `
    <section class="screen-view savings-view" aria-label="Ahorro">
      <div class="screen-title-row">
        <div><p class="eyebrow">Recomendación del periodo</p><h1>Ahorro</h1></div>
      </div>

      <article class="savings-hero">
        <div class="trust-tags"><span>Orientativo</span><span>No mueve dinero</span></div>
        <p>Podrías apartar</p>
        <strong>${formatMoney(plan.suggestedPeriodSavings)}</strong>
        <span>durante este periodo ${summary.cadenceLabel}</span>
        <div class="savings-fit ${plan.savingsCapacityGap > 0 ? "warning" : ""}">
          ${
            plan.savingsCapacityGap > 0
              ? `La meta ideal no cabe completa. Faltaría liberar ${formatMoney(plan.savingsCapacityGap)}.`
              : `La recomendación cabe y deja ${formatMoney(plan.freeAfterSuggestion)} libres.`
          }
        </div>
      </article>

      <div class="money-location-list">
        <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("target")}</span><span class="money-location-text"><span>Meta ideal</span><strong>${formatMoney(plan.idealPeriodSavings)}</strong></span></div>
        <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("wallet")}</span><span class="money-location-text"><span>Ya reservado</span><strong>${formatMoney(plan.savingsReserved)}</strong></span></div>
        <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("calendar")}</span><span class="money-location-text"><span>Momento sugerido</span><strong>${suggestedSavingsMoment()}</strong></span></div>
      </div>

      <details class="calculation-accordion">
        <summary><span><strong>Cómo se calculó</strong><small>Ver presupuesto, compromisos y reservas</small></span><b>+</b></summary>
        <div class="calculation-body">
          <p>${plan.incomeNote}</p>
          ${renderAllocation("Presupuesto del periodo", plan.periodIncome, "reserved")}
          ${renderAllocation("Gastos comprometidos", plan.committedForPeriod, "expenses")}
          ${renderAllocation("Categorías de gasto", summary.expenseReserved, "expenses")}
          ${renderAllocation("Ahorro proyectado", plan.projectedPeriodSavings, "savings")}
        </div>
      </details>

      <article class="raise-simulator">
        <p class="eyebrow">Simulador interactivo</p>
        <h2>¿Y si tus ingresos aumentaran?</h2>
        <div class="simulator-result">
          <strong data-simulator-result>${formatMoney(escalatedSavings)}</strong>
          <span>adicionales al ahorro cada mes</span>
        </div>
        <form id="smart-form" class="simulator-form" data-monthly-income="${getMonthlyIncome(state.profile)}">
          <label>
            <span>Aumento hipotético <output data-raise-output>${state.settings.monthlyRaisePct}%</output></span>
            <input name="monthlyRaisePct" type="range" min="0" max="100" step="1" value="${state.settings.monthlyRaisePct}">
          </label>
          <label>
            <span>Porción del aumento al ahorro <output data-escalation-output>${state.settings.escalationPct}%</output></span>
            <input name="escalationPct" type="range" min="0" max="100" step="5" value="${state.settings.escalationPct}">
          </label>
          <button class="btn primary" type="submit">Guardar simulación</button>
        </form>
      </article>

      <article class="reference-fund">
        <div><p class="eyebrow">Fondo de emergencia</p><h2>${targetCovered ? "Meta cubierta" : `${periodsToTarget || "Sin"} periodos estimados`}</h2></div>
        ${renderProgress(plan.emergencyProgress, "Avance simulado con el ahorro actual")}
        <p>${futureFreedom(plan)}. Es una proyección orientativa, no una promesa.</p>
      </article>
    </section>
  `;
}

function renderCalendar() {
  const events = calendarEventsSorted();
  const upcomingEvents = events.filter((event) => event.date >= todayKey() && !event.spent);
  const nextEvent = upcomingEvents[0] || null;
  const nextThirtyTotal = calendarEstimateForDays(30);
  const reminder = normalizeDailyReminder(state.dailyReminder);
  const permission = notificationPermissionStatus();
  const reminderState = reminder.enabled ? "Activo" : "Apagado";

  return `
    <section class="screen-view calendar-view" aria-label="Calendario financiero">
      <div class="screen-title-row">
        <div>
          <p class="eyebrow">Planes reales</p>
          <h1>Calendario financiero</h1>
        </div>
        <span class="period-chip">${events.length} ${events.length === 1 ? "evento" : "eventos"}</span>
      </div>

      <div class="calendar-summary-grid">
        <article>
          <span>Próximos 30 días</span>
          <strong>${formatMoney(nextThirtyTotal)}</strong>
        </article>
        <article>
          <span>Siguiente plan</span>
          <strong>${nextEvent ? formatShortDate(nextEvent.date) : "Sin fecha"}</strong>
        </article>
        <article>
          <span>Recordatorio</span>
          <strong>${reminderState} ${reminder.enabled ? reminder.time : ""}</strong>
        </article>
      </div>

      <article class="calendar-panel reminder-panel">
        <div class="calendar-panel-heading">
          <div>
            <p class="eyebrow">Revisión diaria</p>
            <h2>Recordatorio de gastos</h2>
          </div>
          <span class="metric-badge ${permission === "granted" ? "under" : permission === "denied" ? "danger" : ""}">${notificationStatusLabel(permission)}</span>
        </div>
        <form class="calendar-reminder-form" id="daily-reminder-form">
          <label class="toggle-row">
            <input name="enabled" type="checkbox" ${reminder.enabled ? "checked" : ""}>
            <span>
              <strong>Preguntar cada día</strong>
              <small>Mensaje: "Quieres registrar tus gastos de hoy?"</small>
            </span>
          </label>
          <label>
            Hora
            <input name="time" type="time" value="${escapeAttr(reminder.time)}" required>
          </label>
          <button class="btn primary" type="submit">Guardar recordatorio</button>
        </form>
        <div class="reminder-actions">
          <button class="btn secondary" type="button" data-action="request-reminder-permission" ${permission === "granted" ? "disabled" : ""}>Permitir notificaciones</button>
          <button class="btn ghost" type="button" data-action="send-test-reminder" ${permission === "granted" ? "" : "disabled"}>Probar</button>
        </div>
        <p class="data-note">${reminderSupportNote(permission)}</p>
      </article>

      <article class="calendar-panel">
        <div class="calendar-panel-heading">
          <div>
            <p class="eyebrow">Nuevo plan</p>
            <h2>Guardar evento financiero</h2>
          </div>
        </div>
        <form class="financial-event-form" id="financial-event-form">
          <label>
            Evento
            <input name="title" type="text" maxlength="48" placeholder="Ej. Regalo de cumpleaños" required>
          </label>
          <label>
            Fecha
            <input name="date" type="date" value="${todayKey()}" required>
          </label>
          <label>
            Estimado
            <input name="amount" type="number" min="0" step="1000" inputmode="numeric" placeholder="$0" required>
          </label>
          <label>
            Categoría
            <select name="category">
              ${renderCategoryOptions(FREE_CATEGORY_ID)}
            </select>
          </label>
          <label class="event-notes-field">
            Nota opcional
            <input name="notes" type="text" maxlength="90" placeholder="Ej. Comprar antes del viernes">
          </label>
          <button class="btn primary" type="submit">Agregar al calendario</button>
        </form>
      </article>

      <div class="section-heading">
        <h2>Eventos guardados</h2>
        <span>${formatMoney(events.reduce((sum, event) => sum + Number(event.amount || 0), 0))} estimados</span>
      </div>
      ${renderFinancialEvents(events)}
    </section>
  `;
}

function renderFinancialEvents(events) {
  if (!events.length) {
    return `<div class="empty-state actionable-empty">
      <span class="empty-icon" aria-hidden="true">+</span>
      <strong>Aún no hay planes con dinero</strong>
      <span>Guarda fechas que suelen traer gastos: regalos, viajes, aniversarios o planes especiales.</span>
    </div>`;
  }

  return `
    <div class="financial-event-list">
      ${events.map((event) => renderFinancialEvent(event)).join("")}
    </div>
  `;
}

function renderFinancialEvent(event) {
  const isPast = event.date < todayKey() && !event.spent;
  const category = event.category && event.category !== FREE_CATEGORY_ID ? categoryName(event.category) : "Libre / sin clasificar";
  return `
    <article class="financial-event-card ${event.spent ? "is-spent" : ""} ${isPast ? "is-past" : ""}">
      <div class="event-date-box">
        <span>${eventMonthLabel(event.date)}</span>
        <strong>${eventDayLabel(event.date)}</strong>
      </div>
      <div class="event-copy">
        <div class="event-title-line">
          <strong>${escapeHtml(event.title)}</strong>
          <span>${event.spent ? "Registrado" : isPast ? "Pendiente" : "Planeado"}</span>
        </div>
        <small>${escapeHtml(category)}${event.notes ? ` &middot; ${escapeHtml(event.notes)}` : ""}</small>
      </div>
      <div class="event-amount">
        <strong>${formatMoney(event.amount)}</strong>
        <small>${formatRelativeEventDate(event.date)}</small>
      </div>
      <div class="event-actions">
        ${
          event.spent
            ? `<button class="btn ghost" type="button" data-action="reopen-calendar-event" data-id="${escapeAttr(event.id)}">Reabrir</button>`
            : `<button class="btn secondary" type="button" data-action="register-calendar-event" data-id="${escapeAttr(event.id)}">Registrar gasto</button>`
        }
        <button class="icon-btn muted" type="button" data-action="remove-calendar-event" data-id="${escapeAttr(event.id)}" aria-label="Eliminar ${escapeAttr(event.title)}">x</button>
      </div>
    </article>
  `;
}

function renderCategoryOptions(selected = FREE_CATEGORY_ID) {
  return [
    `<option value="${FREE_CATEGORY_ID}" ${selected === FREE_CATEGORY_ID ? "selected" : ""}>Libre / sin clasificar</option>`,
    ...state.budgetJobs.map((job) => `<option value="${escapeAttr(job.id)}" ${selected === job.id ? "selected" : ""}>${escapeHtml(job.name)}</option>`)
  ].join("");
}

function renderQuickExpensePanel() {
  const summary = budgetSummary();
  const liquidity = liquiditySummary();
  const draft = expenseDraft || {};
  const selectedCategory = categoryChoiceOptions().some((option) => option.value === draft.category) ? draft.category : FREE_CATEGORY_ID;
  return `
    <div class="quick-expense-backdrop" role="presentation" data-action="close-expense">
      <section class="quick-expense-panel" role="dialog" aria-modal="true" aria-labelledby="quick-expense-title">
        <div class="quick-expense-header">
          <button class="icon-btn muted" type="button" data-action="close-expense" aria-label="Volver">←</button>
          <div>
            <p class="eyebrow">Nuevo movimiento</p>
            <h2 id="quick-expense-title">Registrar gasto</h2>
          </div>
          <span class="metric-badge">Libre ${formatMoney(summary.freeRemaining)}</span>
        </div>
        <form class="quick-expense-form" id="transaction-form">
          ${draft.calendarEventId ? `<input name="calendarEventId" type="hidden" value="${escapeAttr(draft.calendarEventId)}">` : ""}
          <label class="quick-amount">
            <span>Monto</span>
            <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" value="${draft.amount ? escapeAttr(draft.amount) : ""}" required>
          </label>
          <label>
            Comercio opcional
            <input name="merchant" type="text" maxlength="42" placeholder="Ej. Tienda, Terpel" value="${escapeAttr(draft.merchant || "")}">
          </label>
          ${renderMerchantRuleSuggestion(draft.merchant || "")}
          <label>
            Descripción opcional
            <input name="description" type="text" maxlength="90" placeholder="Ej. Tanqueada, regalo, almuerzo" value="${escapeAttr(draft.description || "")}">
          </label>
          <div class="quick-field">
            <span class="quick-label">Categoría</span>
            ${renderChoicePills("category", categoryChoiceOptions(), selectedCategory)}
          </div>
          <div class="quick-field">
            <span class="quick-label">Pagado con</span>
            ${renderChoicePills("source", [
              { value: "account", label: `Cuenta · ${formatCompactMoney(liquidity.account)}` },
              { value: "cash", label: `Efectivo · ${formatCompactMoney(liquidity.cash)}` }
            ], "account")}
          </div>
          <div class="expense-impact-preview" aria-live="polite">
            <span>Disponible antes de registrar</span>
            <strong>${formatMoney(summary.freeRemaining)} libre · ${formatMoney(liquidity.total)} total real</strong>
          </div>
          <button class="quick-advanced-toggle" type="button" data-action="toggle-quick-expense-advanced" aria-expanded="${quickExpenseAdvancedOpen ? "true" : "false"}">
            ${quickExpenseAdvancedOpen ? "Menos opciones" : "Más opciones"}
          </button>
          <div class="quick-expense-advanced" ${quickExpenseAdvancedOpen ? "" : "hidden"}>
            <label class="check-row quick-check-row">
              <input name="budgeted" type="checkbox" checked>
              <span>Ya lo tenía planeado<small>Si NO lo tenías planeado y es un gasto grande, te damos 24 horas antes de registrarlo para pensarlo con calma.</small></span>
            </label>
            <label class="check-row quick-check-row">
              <input name="oneOff" type="checkbox">
              <span>No fue un gasto de todos los días<small>Actívalo en compras grandes que no se repiten (un viaje, un regalo), para que no afecten el cálculo de cuánto gastas por día normalmente.</small></span>
            </label>
          </div>
          <button class="btn primary quick-submit" type="submit">Registrar gasto</button>
          <button class="quick-income-link" type="button" data-action="open-extra-sheet">¿Te entró plata? Regístrala aquí</button>
        </form>
      </section>
    </div>
  `;
}

function categoryChoiceOptions() {
  return [
    { value: FREE_CATEGORY_ID, label: "Libre" },
    ...state.budgetJobs.map((job) => ({ value: job.id, label: job.name }))
  ];
}

function renderMerchantRuleSuggestion(merchant = "") {
  const rule = findMerchantRule(merchant);
  return `
    <div class="merchant-rule-suggestion" data-merchant-rule-suggestion ${rule ? "" : "hidden"}>
      ${rule ? merchantRuleSuggestionMarkup(rule) : ""}
    </div>
  `;
}

function merchantRuleSuggestionMarkup(rule) {
  return `
    <span>Este comercio suele ir en <strong>${escapeHtml(categoryName(rule.category))}</strong> con ${locationLabel(rule.source)}.</span>
    <button class="btn ghost" type="button" data-apply-merchant-rule="${escapeAttr(rule.id)}">Usar sugerencia</button>
  `;
}

function renderMerchantRulesPanel() {
  const rules = activeMerchantRules().slice(0, 4);
  if (!rules.length) {
    return "";
  }

  return `
    <article class="merchant-rules-panel">
      <div class="merchant-rules-heading">
        <div>
          <p class="eyebrow">Reglas por comercio</p>
          <h2>Atajos aprendidos</h2>
        </div>
        <span>${state.merchantRules.length} ${state.merchantRules.length === 1 ? "regla" : "reglas"}</span>
      </div>
      <div class="merchant-rule-list">
        ${rules.map((rule) => `
          <div class="merchant-rule-chip">
            <span><strong>${escapeHtml(rule.merchant)}</strong> -> ${escapeHtml(categoryName(rule.category))} · ${locationLabel(rule.source)}</span>
            <button class="icon-btn muted" type="button" data-action="remove-merchant-rule" data-id="${escapeAttr(rule.id)}" aria-label="Quitar regla de ${escapeAttr(rule.merchant)}">x</button>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderChoicePills(name, options, selected) {
  return `
    <div class="choice-pills" data-choice-group="${escapeAttr(name)}" role="radiogroup">
      <input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(selected)}">
      ${options
        .map(
          (option) => `
            <button class="choice-pill ${option.value === selected ? "is-active" : ""}" type="button" role="radio" aria-checked="${option.value === selected ? "true" : "false"}" tabindex="${option.value === selected ? "0" : "-1"}" data-choice-name="${escapeAttr(name)}" data-choice-value="${escapeAttr(option.value)}">
              ${escapeHtml(option.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMovements() {
  const summary = budgetSummary();
  const movements = movementsForSummary(summary);
  const movementCountLabel = movements.length === 1 ? "movimiento" : "movimientos";
  const pendingCount = unclassifiedTransactionsForSummary(summary).length;
  return `
    <section class="screen-view movements-view" aria-label="Movimientos">
      <div class="screen-title-row movements-heading">
        <div><p class="eyebrow">Historial del periodo</p><h1>Movimientos</h1></div>
        <span class="period-chip">${movements.length} ${movementCountLabel}</span>
      </div>
      ${
        pendingCount > 0
          ? `<button class="classify-banner" type="button" data-action="start-quick-classify">
              <span class="classify-banner-icon" aria-hidden="true">${renderIcon("tag")}</span>
              <span class="classify-banner-text"><strong>Clasificar pendientes</strong><span>${pendingCount} ${pendingCount === 1 ? "movimiento sin categoría" : "movimientos sin categoría"}</span></span>
              <span class="classify-banner-arrow" aria-hidden="true">&rsaquo;</span>
            </button>`
          : ""
      }
      ${renderExpenseCalendar(summary)}
      <article class="movements-card" id="transaction-history-card">
        <div class="movements-toolbar">
          <label class="history-search">
            <span class="history-search-icon" aria-hidden="true">${renderIcon("search")}</span>
            <input type="search" id="transaction-history-search" placeholder="Buscar por nombre o nota" value="${escapeAttr(transactionHistorySearch)}" aria-label="Buscar movimientos">
          </label>
          <div class="movements-controls">
            <label class="history-sort">
              Ordenar por
              <select id="transaction-history-sort">
                <option value="recent" ${transactionHistorySort === "recent" ? "selected" : ""}>Más recientes</option>
                <option value="amount" ${transactionHistorySort === "amount" ? "selected" : ""}>Mayor cantidad</option>
              </select>
            </label>
            <label class="history-sort history-filter">
              Filtrar
              <select id="transaction-history-filter">
                <option value="all" ${transactionHistoryFilter === "all" ? "selected" : ""}>Todos</option>
                <option value="expense" ${transactionHistoryFilter === "expense" ? "selected" : ""}>Gastos</option>
                <option value="income" ${transactionHistoryFilter === "income" ? "selected" : ""}>Ingresos</option>
                <option value="uncategorized" ${transactionHistoryFilter === "uncategorized" ? "selected" : ""}>Sin categoría</option>
                ${state.budgetJobs
                  .map(
                    (job) =>
                      `<option value="cat:${escapeAttr(job.id)}" ${transactionHistoryFilter === `cat:${job.id}` ? "selected" : ""}>${escapeHtml(job.name)}</option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <button class="btn ghost history-export-btn" type="button" data-action="export-movements-csv">Exportar CSV</button>
        </div>
        ${
          transactionHistoryDate
            ? `<p class="history-date-chip">
                <span>Mostrando ${movementDayLabel(transactionHistoryDate)}</span>
                <button type="button" data-action="clear-movements-date-filter" aria-label="Quitar filtro de fecha">&times;</button>
              </p>`
            : ""
        }
        <div id="transaction-history-results">
          ${renderTransactionHistory(summary, transactionHistorySort, transactionHistoryFilter, transactionHistorySearch, transactionHistoryDate)}
        </div>
      </article>
      ${renderMerchantRulesPanel()}
    </section>
  `;
}

function renderExpenseCalendar(summary = budgetSummary()) {
  const calendar = expenseCalendarForSummary(summary);
  if (!calendar.days.length) {
    return "";
  }
  return `
    <article class="expense-calendar-card" aria-label="Calendario de gastos del periodo">
      <div class="expense-calendar-head">
        <div>
          <p class="eyebrow">Calendario de gastos</p>
          <h2>${formatShortDate(calendar.start)} - ${formatShortDate(previousDay(calendar.end))}</h2>
        </div>
        <span class="metric-badge">${formatMoney(calendar.total)} gastado</span>
      </div>
      <div class="expense-calendar-stats">
        <div>
          <span>Día más caro</span>
          <strong>${calendar.heaviest ? `${movementDayLabel(calendar.heaviest.date)} · ${formatMoney(calendar.heaviest.total)}` : "Sin gastos"}</strong>
        </div>
        <div>
          <span>Promedio con gasto</span>
          <strong>${formatMoney(calendar.averageActive)}</strong>
        </div>
      </div>
      <div class="expense-calendar-weekdays" aria-hidden="true">
        ${["L", "M", "M", "J", "V", "S", "D"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="expense-calendar-grid">
        ${calendar.blanks.map(() => `<span class="expense-calendar-blank" aria-hidden="true"></span>`).join("")}
        ${calendar.days.map((day) => renderExpenseCalendarDay(day, calendar.maxDaily)).join("")}
      </div>
    </article>
  `;
}

function renderExpenseCalendarDay(day, maxDaily) {
  const ratio = maxDaily ? day.total / maxDaily : 0;
  const level = day.total <= 0 ? "empty" : ratio >= 0.75 ? "high" : ratio >= 0.35 ? "medium" : "low";
  const label = `Ver movimientos del ${movementDayLabel(day.date)}: ${formatMoney(day.total)} en gastos`;
  const selected = day.date === transactionHistoryDate;
  return `
    <button type="button" class="expense-calendar-day ${level} ${day.isToday ? "is-today" : ""} ${selected ? "is-selected" : ""}" aria-label="${escapeAttr(label)}" aria-pressed="${selected}" data-action="filter-movements-by-date" data-date="${escapeAttr(day.date)}">
      <span>${day.dayNumber}</span>
      ${day.total > 0 ? `<strong>${formatCompactMoney(day.total)}</strong>` : `<small>-</small>`}
    </button>
  `;
}

function expenseCalendarForSummary(summary = budgetSummary()) {
  const monthStart = monthStartKey(todayKey());
  const monthEnd = nextMonthStartKey(monthStart);
  const start = maxDateKey(summary.window.start, monthStart);
  const end = minDateKey(summary.window.end, monthEnd);
  const totals = transactionsForSummary(summary).reduce((acc, transaction) => {
    const date = String(transaction.date || todayKey()).slice(0, 10);
    if (date < start || date >= end) {
      return acc;
    }
    acc[date] = (acc[date] || 0) + Number(transaction.amount || 0);
    return acc;
  }, {});
  const days = datesInWindow(start, end).map((date) => {
    const total = totals[date] || 0;
    return {
      date,
      total,
      dayNumber: Number(date.slice(8, 10)),
      isToday: date === todayKey()
    };
  });
  const activeDays = days.filter((day) => day.total > 0);
  const total = activeDays.reduce((sum, day) => sum + day.total, 0);
  const heaviest = activeDays.slice().sort((a, b) => b.total - a.total || String(b.date).localeCompare(String(a.date)))[0] || null;
  return {
    start,
    end,
    days,
    blanks: Array.from({ length: weekdayOffset(start) }),
    total,
    heaviest,
    maxDaily: activeDays.reduce((max, day) => Math.max(max, day.total), 0),
    averageActive: activeDays.length ? Math.round(total / activeDays.length) : 0
  };
}

function datesInWindow(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T12:00:00`);
  const finish = new Date(`${end}T12:00:00`);
  while (cursor < finish) {
    dates.push(todayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function nextMonthStartKey(dateValue = todayKey()) {
  const date = new Date(`${monthStartKey(dateValue)}T12:00:00`);
  date.setMonth(date.getMonth() + 1);
  return todayKey(date);
}

function minDateKey(a, b) {
  return String(a) <= String(b) ? String(a) : String(b);
}

function maxDateKey(a, b) {
  return String(a) >= String(b) ? String(a) : String(b);
}

function weekdayOffset(dateValue) {
  const day = new Date(`${dateValue}T12:00:00`).getDay();
  return day === 0 ? 6 : day - 1;
}

function movementMatchesFilter(movement, filter) {
  if (!filter || filter === "all") {
    return true;
  }
  if (filter === "expense" || filter === "income") {
    return movement.kind === filter;
  }
  if (movement.kind !== "expense") {
    return false;
  }
  const category = movement.transaction.category || FREE_CATEGORY_ID;
  const unlabeled = !movement.transaction.labeled || category === FREE_CATEGORY_ID;
  if (filter === "uncategorized") {
    return unlabeled;
  }
  if (filter.startsWith("cat:")) {
    return category === filter.slice(4);
  }
  return true;
}

function movementMatchesSearch(movement, query) {
  if (!query) {
    return true;
  }
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack =
    movement.kind === "income"
      ? movement.extra.source || ""
      : `${movement.transaction.merchant || ""} ${movement.transaction.description || ""}`;
  return haystack.toLowerCase().includes(needle);
}

function renderTransactionHistory(summary = budgetSummary(), sort = "recent", filter = "all", search = "", date = "") {
  const movements = movementsForSummary(summary)
    .filter(
      (movement) =>
        movementMatchesFilter(movement, filter) &&
        movementMatchesSearch(movement, search) &&
        (!date || String(movement.date || "").slice(0, 10) === date)
    )
    .sort((a, b) =>
      sort === "amount"
        ? Number(b.amount || 0) - Number(a.amount || 0) || compareTransactionsByRecent(a, b)
        : compareTransactionsByRecent(a, b)
    );

  if (!movements.length) {
    return date
      ? `<div class="empty-state actionable-empty">
          <span class="empty-icon" aria-hidden="true">+</span>
          <strong>Sin movimientos ese día</strong>
          <span>El ${movementDayLabel(date)} no tiene gastos ni ingresos registrados.</span>
        </div>`
      : filter !== "all" || search.trim()
        ? `<div class="empty-state actionable-empty">
          <span class="empty-icon" aria-hidden="true">+</span>
          <strong>Sin movimientos con esa búsqueda</strong>
          <span>Prueba otro termino, filtro u orden.</span>
        </div>`
        : `<div class="empty-state actionable-empty">
      <span class="empty-icon" aria-hidden="true">+</span>
      <strong>Todavía no hay movimientos</strong>
      <span>Cuando registres un gasto o sumes dinero extra aparecerá aquí.</span>
      <button class="btn primary" type="button" data-action="open-expense">Registrar gasto</button>
    </div>`;
  }

  const groups = movements.reduce((acc, movement) => {
    const date = String(movement.date || todayKey()).slice(0, 10);
    (acc[date] ||= []).push(movement);
    return acc;
  }, {});

  return `
    <div class="transaction-history">
      ${Object.entries(groups).map(([date, dayMovements]) => {
        const expenseTotal = dailyExpenseTotal(dayMovements);
        return `
        <section class="movement-day">
          <div class="movement-day-heading">
            <strong>${movementDayLabel(date)}</strong>
            <span class="movement-day-meta">
              <span>${dayMovements.length} ${dayMovements.length === 1 ? "movimiento" : "movimientos"}</span>
              <strong>Gastos: ${formatMoney(expenseTotal)}</strong>
            </span>
          </div>
          ${dayMovements.map((movement) => {
            if (movement.kind === "income") {
              const extra = movement.extra;
              const savingsAmount = Number(extra.allocation?.savingsAmount || 0);
              const allocationText = savingsAmount > 0 ? ` &middot; ${formatMoney(savingsAmount)} para ahorro` : "";
              return `
                <button class="history-row is-income" type="button" data-action="edit-extra" data-id="${escapeAttr(extra.id)}">
                  <span class="movement-type-icon income" aria-hidden="true">${renderIcon("income")}</span>
                  <span class="movement-copy">
                    <strong>${escapeHtml(extra.source)}</strong>
                    <small>Dinero extra &middot; ${locationLabel(extra.location)}${allocationText}</small>
                  </span>
                  <span class="movement-amount income-amount"><strong>+${formatMoney(extra.amount)}</strong><small>Editar</small></span>
                </button>
              `;
            }
            const transaction = movement.transaction;
            const unlabeled = !transaction.labeled || !transaction.category || transaction.category === FREE_CATEGORY_ID;
            return `
              <button class="history-row ${unlabeled ? "is-unclassified" : ""}" type="button" data-action="edit-transaction" data-id="${escapeAttr(transaction.id)}">
                <span class="movement-type-icon ${normalizeLocation(transaction.source)}" aria-hidden="true">${renderIcon(normalizeLocation(transaction.source) === "cash" ? "cash" : "account")}</span>
                <span class="movement-copy">
                  <strong>${escapeHtml(transaction.merchant)}</strong>
                  <small>${transaction.description ? `${escapeHtml(transaction.description)} · ` : ""}${unlabeled ? "Sin clasificar" : escapeHtml(categoryName(transaction.category))} · ${locationLabel(transaction.source)}</small>
                </span>
                <span class="movement-amount"><strong>-${formatMoney(transaction.amount)}</strong><small>Editar</small></span>
              </button>
            `;
          }).join("")}
        </section>
      `;
      }).join("")}
    </div>
  `;
}

function dailyExpenseTotal(dayMovements = []) {
  return dayMovements
    .filter((movement) => movement.kind === "expense")
    .reduce((total, movement) => total + Number(movement.amount || 0), 0);
}

function renderTransactionEditor() {
  const transaction = state.transactions.find((item) => item.id === editingTransactionId);
  if (!transaction) {
    return "";
  }
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-transaction-editor">
      <section class="bottom-sheet transaction-editor" role="dialog" aria-modal="true" aria-labelledby="transaction-editor-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Corregir movimiento</p><h2 id="transaction-editor-title">${escapeHtml(transaction.merchant)}</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-transaction-editor" aria-label="Cerrar">x</button>
        </div>
        <div class="editor-amount">${formatMoney(transaction.amount)}<span>${formatDate(transaction.date)}</span></div>
        <form class="sheet-form" id="transaction-edit-form">
          <div class="sheet-field">
            <span class="sheet-label">Categoría</span>
            ${renderChoicePills("category", categoryChoiceOptions(), transaction.category || FREE_CATEGORY_ID)}
          </div>
          <div class="sheet-field">
            <span class="sheet-label">Pagado con</span>
            ${renderChoicePills("source", [
              { value: "account", label: "Cuenta" },
              { value: "cash", label: "Efectivo" }
            ], normalizeLocation(transaction.source))}
          </div>
          <label class="check-row">
            <input name="oneOff" type="checkbox" ${transaction.oneOff ? "checked" : ""}>
            <span>No fue un gasto de todos los días<small>Actívalo en compras grandes que no se repiten (un viaje, un regalo), para que no afecten el cálculo de cuánto gastas por día normalmente.</small></span>
          </label>
          <button class="btn primary" type="submit">Guardar cambios</button>
          <button class="btn danger subtle-danger" type="button" data-action="remove-transaction" data-id="${escapeAttr(transaction.id)}">Eliminar gasto y devolver saldo</button>
        </form>
      </section>
    </div>
  `;
}

function unclassifiedTransactionsForSummary(summary = budgetSummary()) {
  return transactionsForSummary(summary).filter(
    (transaction) => !transaction.labeled || !transaction.category || transaction.category === FREE_CATEGORY_ID
  );
}

function renderQuickClassifyPanel() {
  const pending = quickClassifyQueue.map((id) => state.transactions.find((item) => item.id === id)).filter(Boolean);
  if (!pending.length) {
    return "";
  }
  const categoryChips = categoryChoiceOptions().filter((option) => option.value !== FREE_CATEGORY_ID);
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-quick-classify">
      <section class="bottom-sheet quick-classify-panel" role="dialog" aria-modal="true" aria-labelledby="quick-classify-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Clasificar pendientes</p><h2 id="quick-classify-title">${pending.length} ${pending.length === 1 ? "movimiento sin categoría" : "movimientos sin categoría"}</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-quick-classify" aria-label="Cerrar">x</button>
        </div>
        <div class="quick-classify-list">
          ${pending
            .map(
              (transaction) => `
                <article class="quick-classify-row">
                  <div class="quick-classify-row-head">
                    <strong>${escapeHtml(transaction.merchant)}</strong>
                    <span>${formatMoney(transaction.amount)} · ${formatDate(transaction.date)}</span>
                  </div>
                  ${
                    categoryChips.length
                      ? `<div class="choice-pills">
                          ${categoryChips
                            .map(
                              (option) => `
                                <button class="choice-pill" type="button" data-action="quick-classify" data-id="${escapeAttr(transaction.id)}" data-category="${escapeAttr(option.value)}">${escapeHtml(option.label)}</button>
                              `
                            )
                            .join("")}
                        </div>`
                      : `<p class="quick-classify-empty">Aún no tienes categorías creadas. Crea una desde Plan para poder clasificar.</p>`
                  }
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderExtraEditor() {
  const extra = state.budgetExtras.find((item) => item.id === editingExtraId);
  if (!extra) {
    return "";
  }
  const savingsPercent = clamp(Number(extra.allocation?.savingsPercent || 0), 0, 100);
  const savingsAmount = Math.round(Number(extra.amount || 0) * savingsPercent / 100);
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-extra-editor">
      <section class="bottom-sheet transaction-editor" role="dialog" aria-modal="true" aria-labelledby="extra-editor-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Corregir ingreso</p><h2 id="extra-editor-title">${escapeHtml(extra.source)}</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-extra-editor" aria-label="Cerrar">x</button>
        </div>
        <div class="editor-amount income-editor-amount">+${formatMoney(extra.amount)}<span>${formatDate(extra.date)}</span></div>
        <form class="sheet-form" id="extra-edit-form">
          <label>
            Origen
            <input name="source" type="text" maxlength="36" value="${escapeAttr(extra.source)}" required>
          </label>
          <label>
            Monto
            <input name="amount" type="number" min="1000" step="1000" value="${Number(extra.amount || 0)}" required>
          </label>
          <label>
            Fecha
            <input name="date" type="date" value="${escapeAttr(extra.date)}" required>
          </label>
          <div class="sheet-field">
            <span class="sheet-label">Entra a</span>
            ${renderChoicePills("location", [
              { value: "account", label: "Cuenta" },
              { value: "cash", label: "Efectivo" }
            ], normalizeLocation(extra.location))}
          </div>
          <label>
            Porcentaje para ahorro
            <input name="savingsPercent" type="range" min="0" max="100" step="5" value="${savingsPercent}" data-extra-edit-range>
          </label>
          <div class="extra-edit-allocation" aria-live="polite">
            <span><strong data-extra-edit-savings>${formatMoney(savingsAmount)}</strong> para ahorro</span>
            <span><strong data-extra-edit-free>${formatMoney(Number(extra.amount || 0) - savingsAmount)}</strong> libre</span>
          </div>
          <button class="btn primary" type="submit">Guardar cambios</button>
          <button class="btn danger subtle-danger" type="button" data-action="remove-extra-from-editor" data-id="${escapeAttr(extra.id)}">Eliminar ingreso y devolver saldo</button>
        </form>
      </section>
    </div>
  `;
}

function compareTransactionsByRecent(a, b) {
  const dateDifference = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateDifference) return dateDifference;

  const aCreated = Date.parse(a.createdAt || a.updated_at || "");
  const bCreated = Date.parse(b.createdAt || b.updated_at || "");
  return (Number.isFinite(bCreated) ? bCreated : 0) - (Number.isFinite(aCreated) ? aCreated : 0);
}

function renderCooldown(cooldown) {
  const unlocked = new Date(cooldown.unlockAt).getTime() <= Date.now();
  return `
    <div class="cooldown-item">
      <div>
        <strong>${escapeHtml(cooldown.merchant)}</strong>
        ${cooldown.description ? `<span>${escapeHtml(cooldown.description)}</span>` : ""}
        <span>${formatMoney(cooldown.amount)} · ${unlocked ? "Lista para decidir" : `Desbloquea ${relativeUnlock(cooldown.unlockAt)}`}</span>
      </div>
      <div class="cooldown-actions">
        <button class="btn ghost" type="button" data-action="cancel-cooldown" data-id="${escapeAttr(cooldown.id)}">Cancelar</button>
        <button class="btn secondary" type="button" data-action="unlock-cooldown" data-id="${escapeAttr(cooldown.id)}" ${unlocked ? "" : "disabled"}>Registrar</button>
      </div>
    </div>
  `;
}

function renderProfile(plan) {
  const monthlyIncome = getMonthlyIncome(state.profile);
  const liquidity = liquiditySummary();

  return `
    <section class="screen-view data-view" aria-label="Datos">
      <div class="screen-title-row">
        <div><p class="eyebrow">Configuración y contexto</p><h1>Datos</h1></div>
      </div>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("plan")}</span><div><strong>Plan básico</strong><small>Ingreso y frecuencia del periodo</small></div><button type="button" data-action="open-diagnosis" data-section="plan">Editar</button></div>
        <div class="data-metrics"><div><span>Presupuesto</span><strong>${formatMoney(getPeriodIncome(state.profile))}</strong></div><div><span>Frecuencia</span><strong>${capitalize(cadenceLabel(state.profile.incomeCadence))}</strong></div></div>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("wallet")}</span><div><strong>Saldos</strong><small>Dinero disponible hoy</small></div><button type="button" data-action="open-diagnosis" data-section="balances">Editar</button></div>
        <div class="money-location-list">
          <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("account")}</span><span class="money-location-text"><span>Cuenta</span><strong>${formatMoney(liquidity.account)}</strong></span></div>
          <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("cash")}</span><span class="money-location-text"><span>Efectivo</span><strong>${formatMoney(liquidity.cash)}</strong></span></div>
          <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("calculator")}</span><span class="money-location-text"><span>Total real</span><strong>${formatMoney(liquidity.total)}</strong></span></div>
        </div>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("income")}</span><div><strong>Recomendación</strong><small>Orientación mensual simple</small></div><button type="button" data-view="savings">Ver ahorro</button></div>
        <div class="data-metrics three"><div><span>Ingreso mensual</span><strong>${formatMoney(monthlyIncome)}</strong></div><div><span>Ahorro proyectado</span><strong>${formatMoney(plan.savings)}</strong></div><div><span>Para gastos</span><strong>${formatMoney(plan.expenses)}</strong></div></div>
        <p class="data-note">Es una simulación: no modifica tu presupuesto ni tus saldos.</p>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("lock")}</span><div><strong>Bloqueo con PIN</strong><small>${lockConfig.enabled ? "Activado. Pedimos tu PIN al abrir la app." : "Pide un PIN de 4 dígitos para abrir la app. No cifra tus datos guardados en el teléfono."}</small></div></div>
        <div class="lock-settings-actions">
          ${
            lockConfig.enabled
              ? `<button class="btn ghost" type="button" data-action="open-lock-setup">Cambiar PIN</button>
                 ${
                   lockConfig.biometric
                     ? `<button class="btn ghost" type="button" data-action="disable-biometric">Quitar huella</button>`
                     : `<button class="btn ghost" type="button" data-action="enable-biometric">Activar huella</button>`
                 }
                 <button class="btn danger" type="button" data-action="open-lock-disable">Desactivar</button>`
              : `<button class="btn primary" type="button" data-action="open-lock-setup">Activar bloqueo</button>`
          }
        </div>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("calculator")}</span><div><strong>Copias locales</strong><small>Guardadas automáticamente en este dispositivo antes de cambios grandes</small></div></div>
        ${
          readLocalBackups().length
            ? `<div class="local-backup-list">
                ${readLocalBackups()
                  .map(
                    (backup) => `
                  <div class="local-backup-row">
                    <span class="local-backup-text">
                      <strong>${escapeHtml(formatBackupTimestamp(backup.created_at))}</strong>
                      <span>${escapeHtml(backup.reason || "Copia automática")} · ${backup.counts?.transactions || 0} movimientos</span>
                    </span>
                    <button class="btn ghost" type="button" data-action="request-restore-backup" data-id="${escapeAttr(backup.id)}">Restaurar</button>
                  </div>
                `
                  )
                  .join("")}
              </div>`
            : `<p class="data-note">Aún no hay copias locales guardadas.</p>`
        }
      </article>

      <article class="sign-out-section">
        <div><strong>${escapeHtml(cloudState.email)}</strong><span>La copia local se retirará de este dispositivo.</span></div>
        <button class="btn danger" type="button" data-action="cloud-sign-out">Cerrar sesión</button>
      </article>

      <article class="sign-out-section">
        <div><strong>Eliminar cuenta y datos</strong><span>Borra tu presupuesto, movimientos y ahorro guardados en la nube. No se puede deshacer.</span></div>
        <button class="btn danger" type="button" data-action="open-delete-account">Eliminar cuenta</button>
      </article>
    </section>
  `;
}

function periodStatusLabel(status) {
  return status === "risk" ? "En riesgo" : status === "tight" ? "Ajustado" : "Saludable";
}

function progressStreak(closures) {
  let streak = 0;
  for (const closure of closures) {
    if (closure.status !== "healthy") {
      break;
    }
    streak += 1;
  }
  return streak;
}

function progressTopExceededCategories(closures, limit = 3) {
  const tally = new Map();
  closures.forEach((closure) => {
    (closure.exceededCategories || []).forEach((category) => {
      const entry = tally.get(category.name) || { name: category.name, count: 0, totalOver: 0 };
      entry.count += 1;
      entry.totalOver += Number(category.over || 0);
      tally.set(category.name, entry);
    });
  });
  return Array.from(tally.values()).sort((a, b) => b.count - a.count || b.totalOver - a.totalOver).slice(0, limit);
}

function renderProgressView() {
  const closures = (state.periodClosures || []).slice().sort((a, b) => (a.windowStart < b.windowStart ? 1 : -1));

  if (!closures.length) {
    return `
      <section class="screen-view progress-view" aria-label="Progreso">
        <div class="screen-title-row">
          <div><p class="eyebrow">Historial entre periodos</p><h1>Progreso</h1></div>
        </div>
        <div class="empty-state actionable-empty">
          <p>Aún no has cerrado ningún periodo. Cuando guardes tu primer cierre, aquí verás cómo cambia tu resultado con el tiempo.</p>
          <button class="btn primary" type="button" data-view="periodClose">Ver cierre de periodo</button>
        </div>
        ${renderBehaviorInsights()}
      </section>
    `;
  }

  const streak = progressStreak(closures);
  const latest = closures[0];
  const previous = closures[1];
  const trendDelta = previous ? latest.freeFinal - previous.freeFinal : null;
  const topExceeded = progressTopExceededCategories(closures);

  return `
    <section class="screen-view progress-view" aria-label="Progreso">
      <div class="screen-title-row">
        <div><p class="eyebrow">Historial entre periodos</p><h1>Progreso</h1></div>
      </div>

      <article class="progress-hero ${streak > 0 ? "healthy" : ""}">
        <span class="progress-hero-icon" aria-hidden="true">${renderIcon("trend")}</span>
        <div>
          <span>${streak > 0 ? "Racha activa" : "Sin racha activa"}</span>
          <strong>${streak > 0 ? `${streak} ${streak === 1 ? "periodo seguido saludable" : "periodos seguidos saludables"}` : "Cierra un periodo saludable para empezar una racha"}</strong>
          ${trendDelta !== null ? `<p>Quedaron ${formatMoney(Math.abs(trendDelta))} ${trendDelta >= 0 ? "más" : "menos"} libres que el periodo anterior.</p>` : ""}
        </div>
      </article>

      <div class="home-section-heading">
        <div><p class="eyebrow">Últimos periodos</p><h2>Cómo te fue</h2></div>
      </div>
      <div class="progress-history">
        ${closures
          .map((closure) => {
            const ratio = closure.income > 0 ? clamp((closure.spent / closure.income) * 100, 0, 130) : 0;
            const band = closure.status === "risk" ? "danger" : closure.status === "tight" ? "warning" : "good";
            const period = `${formatShortDate(closure.windowStart)} - ${formatShortDate(previousDay(closure.windowEnd))}`;
            return `
              <article class="progress-row ${closure.status}">
                <div class="progress-row-top">
                  <div><strong>${period}</strong><span class="progress-row-status">${periodStatusLabel(closure.status)}</span></div>
                  <strong class="${closure.freeFinal < 0 ? "negative" : ""}">${formatMoney(closure.freeFinal)}</strong>
                </div>
                <div class="bar ${band}" aria-label="${Math.round(ratio)} por ciento del ingreso gastado">
                  <span style="width:${ratio}%"></span>
                </div>
                <div class="progress-row-meta">
                  <span>${formatMoney(closure.spent)} gastado de ${formatMoney(closure.income)}</span>
                  ${(closure.exceededCategories || []).length ? `<span>${closure.exceededCategories.length} ${closure.exceededCategories.length === 1 ? "categoría excedida" : "categorías excedidas"}</span>` : ""}
                </div>
              </article>
            `;
          })
          .join("")}
      </div>

      ${
        topExceeded.length
          ? `
        <div class="home-section-heading">
          <div><p class="eyebrow">Patrones repetidos</p><h2>Lo que más se excede</h2></div>
        </div>
        <div class="progress-history">
          ${topExceeded
            .map(
              (category) => `
                <article class="progress-row">
                  <div class="progress-row-top">
                    <div><strong>${escapeHtml(category.name)}</strong><span class="progress-row-status">${category.count} ${category.count === 1 ? "vez excedida" : "veces excedida"}</span></div>
                    <strong>${formatMoney(category.totalOver)}</strong>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      `
          : ""
      }
      ${renderBehaviorInsights()}
    </section>
  `;
}

function previousPeriodWindow(summary) {
  const start = new Date(`${summary.window.start}T00:00:00`);
  const end = new Date(`${summary.window.end}T00:00:00`);
  const lengthMs = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - lengthMs);
  return { start: todayKey(prevStart), end: summary.window.start };
}

function weekdaySpendingInsight(summary) {
  const transactions = transactionsForSummary(summary);
  if (transactions.length < 6) {
    return null;
  }
  const totals = new Array(7).fill(0);
  transactions.forEach((transaction) => {
    const day = new Date(`${transaction.date}T12:00:00`).getDay();
    totals[day] += Number(transaction.amount || 0);
  });
  const totalSpent = totals.reduce((sum, value) => sum + value, 0);
  if (totalSpent <= 0) {
    return null;
  }
  const daysWithSpend = totals.map((total, day) => ({ day, total })).filter((entry) => entry.total > 0);
  if (daysWithSpend.length < 3) {
    return null;
  }
  const top = daysWithSpend.reduce((best, entry) => (entry.total > best.total ? entry : best));
  const share = (top.total / totalSpent) * 100;
  if (share < 25) {
    return null;
  }
  return {
    icon: "calendar",
    title: `Los ${WEEKDAY_NAMES[top.day]}s concentran tus gastos`,
    detail: `Gastaste ${formatMoney(top.total)} en ${WEEKDAY_NAMES[top.day]}s este periodo, ${Math.round(share)}% de lo que llevas gastado.`
  };
}

function categoryTrendInsight(summary) {
  const prevWindow = previousPeriodWindow(summary);
  const currentByCategory = {};
  transactionsForSummary(summary).forEach((transaction) => {
    const category = transaction.category || FREE_CATEGORY_ID;
    currentByCategory[category] = (currentByCategory[category] || 0) + Number(transaction.amount || 0);
  });
  const prevByCategory = {};
  (state.transactions || []).forEach((transaction) => {
    const date = String(transaction.date || "").slice(0, 10);
    if (date >= prevWindow.start && date < prevWindow.end) {
      const category = transaction.category || FREE_CATEGORY_ID;
      prevByCategory[category] = (prevByCategory[category] || 0) + Number(transaction.amount || 0);
    }
  });
  let best = null;
  Object.keys(currentByCategory).forEach((category) => {
    const current = currentByCategory[category];
    const previous = prevByCategory[category] || 0;
    if (previous < 5000) {
      return;
    }
    const diff = current - previous;
    const pct = (diff / previous) * 100;
    if (pct >= 30 && diff >= 10000 && (!best || diff > best.diff)) {
      best = { category, current, previous, diff, pct };
    }
  });
  if (!best) {
    return null;
  }
  return {
    icon: "trend",
    title: `${categoryName(best.category)} subio frente al periodo pasado`,
    detail: `Gastaste ${formatMoney(best.current)}, ${Math.round(best.pct)}% más que los ${formatMoney(best.previous)} del periodo anterior.`
  };
}

function smallExpensesInsight(summary) {
  const transactions = transactionsForSummary(summary);
  const small = transactions.filter((transaction) => {
    const amount = Number(transaction.amount || 0);
    return amount > 0 && amount < SMALL_EXPENSE_THRESHOLD;
  });
  if (small.length < 5) {
    return null;
  }
  const total = small.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const totalSpent = Number(summary.totalSpent || 0);
  const share = totalSpent > 0 ? (total / totalSpent) * 100 : 0;
  if (share < 10) {
    return null;
  }
  return {
    icon: "cash",
    title: "Gasto hormiga acumulado",
    detail: `${small.length} gastos menores a ${formatMoney(SMALL_EXPENSE_THRESHOLD)} suman ${formatMoney(total)}, ${Math.round(share)}% de lo gastado este periodo.`
  };
}

function behaviorInsights(summary = budgetSummary()) {
  return [weekdaySpendingInsight(summary), categoryTrendInsight(summary), smallExpensesInsight(summary)].filter(Boolean);
}

function renderBehaviorInsights(summary = budgetSummary()) {
  const insights = behaviorInsights(summary);
  if (!insights.length) {
    return "";
  }
  return `
    <div class="home-section-heading">
      <div><p class="eyebrow">Basado en tus movimientos</p><h2>Lo que dicen tus datos</h2></div>
    </div>
    <div class="insight-list">
      ${insights
        .map(
          (insight) => `
            <article class="insight-card">
              <span class="insight-icon" aria-hidden="true">${renderIcon(insight.icon)}</span>
              <div>
                <strong>${escapeHtml(insight.title)}</strong>
                <span>${escapeHtml(insight.detail)}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderIncomeCadenceOptions(selected) {
  const options = [
    ["weekly", "Semanal"],
    ["biweekly", "Quincenal"],
    ["monthly", "Mensual"],
    ["semester", "Semestral"],
    ["yearly", "Anual"]
  ];
  return options
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderOnboardingModal() {
  const profile = state.profile;
  const liquidity = normalizeLiquidity(state.liquidity);
  const income = getPeriodIncome(profile);
  // "Otro" es un estado de la interfaz, no una frecuencia: el valor real siempre vive
  // en el input oculto. Se compara por igualdad exacta (y no "todo lo que no sea
  // semanal/mensual es Otro") para que una cadencia vacia no marque nada por defecto.
  const usesSecondaryCadence = SECONDARY_INCOME_CADENCES.includes(profile.incomeCadence);
  const secondaryCadence = usesSecondaryCadence ? profile.incomeCadence : "semester";
  // Solo "fixed" revela el dia de pago. Un perfil sin responder ("") no es "fijo":
  // preguntar el dia de pago antes de saber si el ingreso es fijo no tiene sentido.
  const usesFixedIncome = profile.incomeType === "fixed";
  // Ninguna viene marcada. Son sugerencias para tocar, no un plan por defecto: marcar
  // Comida + Gasolina + Salidas reservaba el 36% del ingreso de quien pulsara
  // "Siguiente" sin mirar, incluido el porcentaje de gasolina de alguien sin vehiculo.
  const suggestions = [
    ["Comida", 0.18],
    ["Gasolina", 0.1],
    ["Transporte", 0.08],
    ["Salidas", 0.08],
    ["Arriendo", 0.25],
    ["Salud", 0.06],
    ["Ropa", 0.05]
  ];

  return `
    <div class="modal-backdrop onboarding-backdrop" role="presentation">
      <section class="modal onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" data-onboarding-step="1">
        <div class="onboarding-progress" aria-label="Paso 1 de 3">
          <span class="is-active"></span><span></span><span></span>
        </div>
        <form id="onboarding-form" class="onboarding-form" novalidate>
          <section class="onboarding-step is-active" data-step="1">
            <span class="step-badge">Paso 1 de 3</span>
            <h2 id="onboarding-title">¿Ganas dinero periódicamente?</h2>
            <p>Así calculamos cuanto tienes disponible en cada periodo.</p>
            <div class="sheet-field">
              <span class="sheet-label">¿Tu ingreso es fijo o variable?</span>
              <div class="onboarding-segmented" data-onboarding-income-type-group>
                <button type="button" data-onboarding-income-type="fixed" class="${profile.incomeType === "fixed" ? "is-active" : ""}">Fijo (salario)</button>
                <button type="button" data-onboarding-income-type="variable" class="${profile.incomeType === "variable" ? "is-active" : ""}">Variable / freelance</button>
              </div>
              <input name="incomeType" type="hidden" value="${escapeAttr(INCOME_TYPES.includes(profile.incomeType) ? profile.incomeType : "")}">
            </div>
            <div class="sheet-field">
              <span class="sheet-label">¿Cada cuánto recibes?</span>
              <div class="onboarding-segmented is-quad" data-onboarding-cadence-group>
                <button type="button" data-onboarding-cadence="weekly" class="${profile.incomeCadence === "weekly" ? "is-active" : ""}">Semanal</button>
                <button type="button" data-onboarding-cadence="biweekly" class="${profile.incomeCadence === "biweekly" ? "is-active" : ""}">Quincenal</button>
                <button type="button" data-onboarding-cadence="monthly" class="${profile.incomeCadence === "monthly" ? "is-active" : ""}">Mensual</button>
                <button type="button" data-onboarding-cadence="other" class="${usesSecondaryCadence ? "is-active" : ""}">Otro</button>
              </div>
              <label class="onboarding-cadence-other" data-onboarding-cadence-other ${usesSecondaryCadence ? "" : "hidden"}>
                ¿Cada cuánto exactamente?
                <select data-onboarding-cadence-select>
                  <option value="semester" ${secondaryCadence === "semester" ? "selected" : ""}>Cada 6 meses (semestral)</option>
                  <option value="yearly" ${secondaryCadence === "yearly" ? "selected" : ""}>Una vez al año (anual)</option>
                </select>
              </label>
              <input name="incomeCadence" type="hidden" value="${escapeAttr(profile.incomeCadence)}">
            </div>
            <label>
              ¿Cuánto recibes por periodo?
              <input name="incomeAmount" type="number" min="1" step="1000" inputmode="numeric" placeholder="$0" value="${income > 0 ? income : ""}" required>
            </label>
            <div class="onboarding-preview"><span>Libre estimado</span><strong data-onboarding-income-preview>${formatMoney(income)}</strong></div>
            <small class="onboarding-note">Después separarás reservas para gastos habituales y este número bajará.</small>
            <label data-onboarding-payday-field ${usesFixedIncome ? "" : "hidden"}>
              ¿Qué día te pagan?
              <input name="periodStart" type="${usesFixedIncome ? "date" : "hidden"}" value="${escapeAttr(profile.periodStart || monthStartKey())}" ${usesFixedIncome ? "required" : ""}>
            </label>
            <small class="onboarding-note" data-onboarding-payday-note ${usesFixedIncome ? "" : "hidden"}>Ese día tu ingreso se suma automáticamente a tu dinero libre. Podrás corregirlo si aún no te ha llegado.</small>
          </section>

          <section class="onboarding-step" data-step="2">
            <span class="step-badge">Paso 2 de 3</span>
            <h2>¿Cuánto tienes hoy en cuenta y efectivo?</h2>
            <p>Esto es tu saldo real ahora mismo, no tiene que coincidir con lo que recibes por periodo. Si vas a empezar desde cero, deja ambos en $0.</p>
            <div class="onboarding-balance-grid">
              <label class="balance-card">
                <span>Cuenta</span>
                <input name="account" type="number" min="0" step="1000" inputmode="numeric" value="${liquidity.account}" required>
              </label>
              <label class="balance-card">
                <span>Efectivo</span>
                <input name="cash" type="number" min="0" step="1000" inputmode="numeric" value="${liquidity.cash}" required>
              </label>
            </div>
            <div class="onboarding-preview"><span>Total real</span><strong data-onboarding-total-preview>${formatMoney(liquidity.account + liquidity.cash)}</strong></div>
            <small class="balance-hint" data-onboarding-balance>Puedes ajustar esto despues, cuando quieras, desde Datos.</small>
          </section>

          <section class="onboarding-step" data-step="3">
            <span class="step-badge">Paso 3 de 3</span>
            <h2>¿Para qué separas dinero?</h2>
            <p>Elige categorías habituales. Puedes ajustar sus montos después.</p>
            <div class="onboarding-category-chips">
              ${suggestions.map(([name, rate], index) => `
                <button type="button" class="onboarding-category-chip" data-onboarding-category-chip data-category-index="${index}" data-rate="${rate}">${name}</button>
                <input name="categoryName${index}" type="hidden" value="${name}" disabled>
                <input name="categoryAmount${index}" type="hidden" value="${Math.round(income * rate)}" disabled>
                <input name="categoryCadence${index}" type="hidden" value="period" disabled>
              `).join("")}
            </div>
            <div class="onboarding-preview category-preview">
              <span>Libre estimado después de reservas</span>
              <strong data-onboarding-free-preview>${formatMoney(income)}</strong>
              <small data-onboarding-category-count>de ${formatMoney(income)} · 0 categorías seleccionadas</small>
            </div>
          </section>

          <p class="form-error onboarding-error" role="alert" aria-live="assertive"></p>
          <div class="onboarding-actions">
            <button class="btn ghost onboarding-back" type="button" data-onboarding-back hidden>← Atrás</button>
            <button class="btn primary onboarding-next" type="button" data-onboarding-next>Siguiente →</button>
            <button class="btn primary onboarding-finish" type="submit" hidden>Ver mi dinero libre</button>
            <button class="btn ghost onboarding-skip" type="button" data-onboarding-skip hidden>Saltarme esto por ahora</button>
          </div>
        </form>
      </section>
    </div>
  `;
}


function renderDiagnosisModal() {
  if (!state.profile.completed) {
    return renderOnboardingModal();
  }

  const sectionKey = DIAGNOSIS_SECTIONS[state.diagnosisSection] ? state.diagnosisSection : "plan";
  const section = DIAGNOSIS_SECTIONS[sectionKey];
  const bodyBySection = {
    plan: renderDiagnosisPlanFields,
    balances: renderDiagnosisBalancesFields
  };

  return `
    <div class="modal-backdrop" role="presentation" data-action="close-diagnosis">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="diagnosis-title">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">Personalizar plan</p>
            <h2 id="diagnosis-title">${escapeHtml(section.title)}</h2>
          </div>
          <button class="icon-btn" type="button" data-action="close-diagnosis" aria-label="Cerrar">x</button>
        </div>
        ${diagnosisValidation.message ? `<p class="form-error diagnosis-error" role="alert" aria-live="assertive">${escapeHtml(diagnosisValidation.message)}</p>` : ""}
        <form id="diagnosis-form" class="diagnosis-form" data-diagnosis-section="${sectionKey}" novalidate>
          <fieldset>
            <legend>${escapeHtml(section.subtitle)}</legend>
            ${bodyBySection[sectionKey]()}
          </fieldset>

          <div class="modal-actions">
            <button class="btn ghost" type="button" data-action="close-diagnosis">Cancelar</button>
            <button class="btn primary" type="submit">Guardar</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderDiagnosisPlanFields() {
  const profile = state.profile;
  return `
    <label>
      Nombre del plan
      <input name="name" type="text" maxlength="32" value="${escapeAttr(profile.name)}" required ${diagnosisInvalidAttr("name")}>
      ${renderDiagnosisFieldError("name")}
    </label>
    <label>
      Cada cuanto recibes presupuesto
      <select name="incomeCadence" ${diagnosisInvalidAttr("incomeCadence")}>
        ${renderIncomeCadenceOptions(profile.incomeCadence)}
      </select>
      ${renderDiagnosisFieldError("incomeCadence")}
    </label>
    <label>
      Presupuesto por periodo
      <input name="incomeAmount" type="number" min="0" step="1000" value="${getPeriodIncome(profile)}" required ${diagnosisInvalidAttr("incomeAmount")}>
      ${renderDiagnosisFieldError("incomeAmount")}
    </label>
    <label>
      ¿Tu ingreso es fijo o variable?
      <select name="incomeType" ${diagnosisInvalidAttr("incomeType")}>
        <option value="fixed" ${profile.incomeType !== "variable" ? "selected" : ""}>Fijo (salario, día de pago conocido)</option>
        <option value="variable" ${profile.incomeType === "variable" ? "selected" : ""}>Variable / freelance</option>
      </select>
      <small>${profile.incomeType === "variable"
        ? "Registra cada ingreso manualmente cuando te llegue."
        : "El día de pago tu ingreso se suma automáticamente a tu dinero libre."}</small>
      ${renderDiagnosisFieldError("incomeType")}
    </label>
    <label>
      ${profile.incomeType === "variable" ? "Inicio del periodo actual" : "Día que te pagan (inicio del periodo)"}
      <input name="periodStart" type="date" value="${escapeAttr(profile.periodStart || profile.semesterStart || monthStartKey())}" required ${diagnosisInvalidAttr("periodStart")}>
      ${renderDiagnosisFieldError("periodStart")}
    </label>
    <label data-volatility-field ${profile.incomeType === "variable" ? "" : "hidden"}>
      ¿Qué tanto varía lo que recibes?
      <select name="volatility" ${diagnosisInvalidAttr("volatility")}>
        <option value="low" ${profile.volatility === "low" ? "selected" : ""}>Poco: mes a mes es parecido</option>
        <option value="medium" ${profile.volatility === "medium" ? "selected" : ""}>Algo: hay meses buenos y flojos</option>
        <option value="high" ${profile.volatility === "high" ? "selected" : ""}>Mucho: cambia bastante</option>
      </select>
      <small>Cuanto más varíe, más prudente es el ahorro que te sugerimos.</small>
      ${renderDiagnosisFieldError("volatility")}
    </label>
    <label>
      Ingreso mensual equivalente
      <input name="monthlyIncome" type="number" min="0" step="1000" value="${getMonthlyIncome(profile)}" readonly>
    </label>
    <label>
      Gastos comprometidos
      <input name="committedExpenses" type="number" min="0" step="1000" value="${profile.committedExpenses}" required ${diagnosisInvalidAttr("committedExpenses")}>
      ${renderDiagnosisFieldError("committedExpenses")}
    </label>
    <label>
      Día de pago principal
      <input name="payday" type="number" min="0" max="28" inputmode="numeric" value="${profile.payday}" ${diagnosisInvalidAttr("payday")}>
      <small>Usa 0 si no tienes un día fijo.</small>
      ${renderDiagnosisFieldError("payday")}
    </label>
  `;
}

function renderDiagnosisBalancesFields() {
  const profile = state.profile;
  const liquidity = normalizeLiquidity(state.liquidity);
  const available = liquidity.initialized ? liquidity : { account: 0, cash: 0 };
  return `
    <label>
      Dinero en cuenta
      <input name="account" type="number" min="0" step="1000" value="${available.account}" required ${diagnosisInvalidAttr("account")}>
      ${renderDiagnosisFieldError("account")}
    </label>
    <label>
      Dinero en físico
      <input name="cash" type="number" min="0" step="1000" value="${available.cash}" required ${diagnosisInvalidAttr("cash")}>
      ${renderDiagnosisFieldError("cash")}
    </label>
    <small class="balance-hint" data-liquidity-match-hint></small>
    <label>
      Ahorro de emergencia actual
      <input name="emergencySavings" type="number" min="0" step="1000" value="${profile.emergencySavings}" required ${diagnosisInvalidAttr("emergencySavings")}>
      ${renderDiagnosisFieldError("emergencySavings")}
    </label>
  `;
}

function diagnosisInvalidAttr(name) {
  const invalidFields = diagnosisValidation.fields || [diagnosisValidation.field];
  return invalidFields.includes(name) ? `aria-invalid="true" data-invalid="true"` : "";
}

function renderDiagnosisFieldError(name) {
  if (diagnosisValidation.field !== name) {
    return "";
  }
  return `<small class="field-error">${escapeHtml(diagnosisValidation.message)}</small>`;
}

function categoryStatusLabel(ratio) {
  return ratio > 100 ? "Excedida" : ratio > 90 ? "Crítica" : ratio > 65 ? "Atención" : "Saludable";
}

function renderCategoryBars(plan, limit) {
  const categories = categoryStatus()
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);

  return `
    <div class="category-bars">
      ${categories
        .map(
          (category) => `
            <div class="category-row">
              <div class="category-top">
                <strong>${escapeHtml(category.name)}</strong>
                <span class="category-numbers">${formatMoney(category.spent)} / ${formatMoney(category.budget)}</span>
              </div>
              <div class="bar ${category.band}" aria-label="${Math.round(category.ratio)} por ciento usado">
                <span style="width:${clamp(category.ratio, 0, 120)}%"></span>
              </div>
              <span class="category-status">${categoryStatusLabel(category.ratio)} · ${Math.round(clamp(category.ratio, 0, 999))}%</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSnackbar() {
  if (!snackbar) {
    return "";
  }

  return `
    <div class="snackbar ${snackbar.kind || ""}">
      <span>${escapeHtml(snackbar.message)}</span>
      ${
        snackbar.action === "undo"
          ? `<button class="btn secondary" type="button" data-action="undo-snackbar" data-id="${escapeAttr(snackbar.transactionId)}">Deshacer</button>`
          : ""
      }
    </div>
  `;
}

function renderProgress(value, label) {
  const safeValue = clamp(value, 0, 100);
  return `
    <div class="progress-block">
      <div class="progress-label">
        <span>${label}</span>
        <strong>${Math.round(safeValue)}%</strong>
      </div>
      <div class="progress-track">
        <span style="width:${safeValue}%"></span>
      </div>
    </div>
  `;
}

function bindEvents() {
  bindMoneyInputs();
  animateBudgetRingCharts();

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activateView(button.dataset.view);
      quickExpenseOpen = false;
      saveState({ sync: false, touch: false });
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleAction);
  });

  document.querySelectorAll("[data-choice-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest("[data-choice-group]");
      const input = group?.querySelector(`input[name="${button.dataset.choiceName}"]`);
      if (!group || !input) {
        return;
      }
      input.value = button.dataset.choiceValue;
      group.querySelectorAll("[data-choice-value]").forEach((choice) => {
        const active = choice === button;
        choice.classList.toggle("is-active", active);
        choice.setAttribute("aria-checked", active ? "true" : "false");
        choice.tabIndex = active ? 0 : -1;
      });
    });
  });

  const onboardingForm = document.querySelector("#onboarding-form");
  if (onboardingForm) {
    bindOnboardingFlowV2(onboardingForm);
    onboardingForm.addEventListener("submit", handleOnboardingSubmit);
  }

  const diagnosisForm = document.querySelector("#diagnosis-form");
  if (diagnosisForm) {
    bindDiagnosisPreview(diagnosisForm);
    diagnosisForm.addEventListener("submit", handleDiagnosisSubmit);
  }

  const budgetForm = document.querySelector("#budget-job-form");
  if (budgetForm) {
    bindPlanCategoryPreview(budgetForm);
    budgetForm.addEventListener("submit", handleBudgetSubmit);
  }

  const setAsideForm = document.querySelector("#setaside-form");
  if (setAsideForm) {
    bindSetAsidePreview(setAsideForm);
    setAsideForm.addEventListener("submit", handleSetAsideSubmit);
  }

  const extraBudgetForm = document.querySelector("#extra-budget-form");
  if (extraBudgetForm) {
    bindExtraSheetPreview(extraBudgetForm);
    extraBudgetForm.addEventListener("submit", handleExtraBudgetSubmit);
  }

  const transactionForm = document.querySelector("#transaction-form");
  if (transactionForm) {
    bindMerchantRuleSuggestions(transactionForm);
    transactionForm.addEventListener("submit", handleTransactionSubmit);
  }

  const transactionEditForm = document.querySelector("#transaction-edit-form");
  if (transactionEditForm) {
    transactionEditForm.addEventListener("submit", handleTransactionEditSubmit);
  }

  const extraEditForm = document.querySelector("#extra-edit-form");
  if (extraEditForm) {
    bindExtraEditPreview(extraEditForm);
    extraEditForm.addEventListener("submit", handleExtraEditSubmit);
  }

  const smartForm = document.querySelector("#smart-form");
  if (smartForm) {
    bindSavingsSimulatorPreview(smartForm);
    smartForm.addEventListener("submit", handleSmartSubmit);
  }

  const dailyReminderForm = document.querySelector("#daily-reminder-form");
  if (dailyReminderForm) {
    dailyReminderForm.addEventListener("submit", handleDailyReminderSubmit);
  }

  const financialEventForm = document.querySelector("#financial-event-form");
  if (financialEventForm) {
    financialEventForm.addEventListener("submit", handleFinancialEventSubmit);
  }

  document.querySelectorAll("[data-cloud-auth-form]").forEach((form) => {
    form.addEventListener("submit", handleCloudLoginSubmit);
  });

  document.querySelectorAll("[data-cloud-forgot-form]").forEach((form) => {
    form.addEventListener("submit", handleForgotPasswordSubmit);
  });

  bindPasswordToggles();

  const historySort = document.querySelector("#transaction-history-sort");
  if (historySort) {
    historySort.addEventListener("change", () => {
      transactionHistorySort = historySort.value === "amount" ? "amount" : "recent";
      render();
    });
  }

  const historyFilter = document.querySelector("#transaction-history-filter");
  if (historyFilter) {
    historyFilter.addEventListener("change", () => {
      transactionHistoryFilter = historyFilter.value || "all";
      render();
    });
  }

  const historySearch = document.querySelector("#transaction-history-search");
  if (historySearch) {
    historySearch.addEventListener("input", () => {
      transactionHistorySearch = historySearch.value;
      // Repaint only the results. A full render() on every keystroke rebuilds the
      // whole screen, which visibly flickers and throws away the caret (we used to
      // paper over that by restoring focus afterwards).
      const results = document.querySelector("#transaction-history-results");
      if (!results) {
        render();
        return;
      }
      results.innerHTML = renderTransactionHistory(
        budgetSummary(),
        transactionHistorySort,
        transactionHistoryFilter,
        transactionHistorySearch,
        transactionHistoryDate
      );
      results.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", handleAction);
      });
    });
  }

  document.querySelectorAll("[data-lock-digit]").forEach((button) => {
    button.addEventListener("click", () => pushLockDigit(button.dataset.lockDigit));
  });
  const lockBackspace = document.querySelector("[data-lock-backspace]");
  if (lockBackspace) {
    lockBackspace.addEventListener("click", () => {
      lockDigits = lockDigits.slice(0, -1);
      lockError = "";
      render();
    });
  }
  const lockCancel = document.querySelector("[data-lock-cancel]");
  if (lockCancel) {
    lockCancel.addEventListener("click", () => {
      lockMode = "";
      lockDigits = "";
      lockFirstEntry = "";
      lockError = "";
      render();
    });
  }
  const lockBiometric = document.querySelector("[data-lock-biometric]");
  if (lockBiometric) {
    lockBiometric.addEventListener("click", () => tryBiometricUnlock());
  }
  if (lockMode === "unlock" && lockConfig.biometric && !biometricAutoTried && !lockIsCoolingDown()) {
    biometricAutoTried = true;
    tryBiometricUnlock();
  }

  bindDialogBehavior();
}

function bindDialogBehavior() {
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  const modalOpen = Boolean(dialog);
  document.querySelectorAll(".sidebar, .main-panel, .bottom-nav, .drawer-scrim").forEach((element) => {
    if (modalOpen) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    } else {
      element.inert = false;
      element.removeAttribute("aria-hidden");
    }
  });

  if (!dialog) {
    app.onkeydown = null;
    return;
  }

  if (!dialog.contains(document.activeElement)) {
    window.setTimeout(() => {
      if (!dialog.isConnected || dialog.contains(document.activeElement)) {
        return;
      }
      firstFocusable(dialog)?.focus({ preventScroll: true });
    }, 0);
  }

  app.onkeydown = handleDialogKeydown;
}

function handleDialogKeydown(event) {
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  if (!dialog) {
    return;
  }

  if (event.key === "Escape" && closeTopDialog()) {
    event.preventDefault();
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const focusable = focusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeTopDialog() {
  if (quickExpenseOpen) {
    closeQuickExpense();
    render();
    return true;
  }
  if (editingTransactionId) {
    editingTransactionId = "";
    render();
    return true;
  }
  if (editingExtraId) {
    editingExtraId = "";
    render();
    return true;
  }
  if (pendingJobRemovalId) {
    pendingJobRemovalId = "";
    render();
    return true;
  }
  if (planSheet) {
    planSheet = "";
    render();
    return true;
  }
  if (state.showDiagnosis && state.profile.completed) {
    diagnosisValidation = { field: "", message: "" };
    state.showDiagnosis = false;
    render();
    return true;
  }
  if (pendingBackupRestoreId) {
    pendingBackupRestoreId = "";
    render();
    return true;
  }
  if (deleteAccountOpen) {
    cloudState.error = "";
    deleteAccountOpen = false;
    render();
    return true;
  }
  if (quickClassifyQueue.length) {
    quickClassifyQueue = [];
    render();
    return true;
  }
  if (predictionDetailsOpen) {
    predictionDetailsOpen = false;
    render();
    return true;
  }
  if (periodReportOpen) {
    periodReportOpen = false;
    render();
    return true;
  }
  return false;
}

function firstFocusable(root) {
  return focusableElements(root)[0] || null;
}

function focusableElements(root) {
  return [...root.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && element.offsetParent !== null);
}

function bindOnboardingFlowV2(form) {
  const modal = form.closest("[data-onboarding-step]");
  const error = form.querySelector(".onboarding-error");
  const nextButton = form.querySelector("[data-onboarding-next]");
  const backButton = form.querySelector("[data-onboarding-back]");
  const finishButton = form.querySelector(".onboarding-finish");
  const skipButton = form.querySelector("[data-onboarding-skip]");
  const balanceHint = form.querySelector("[data-onboarding-balance]");
  const incomePreview = form.querySelector("[data-onboarding-income-preview]");
  const totalPreview = form.querySelector("[data-onboarding-total-preview]");
  const freePreview = form.querySelector("[data-onboarding-free-preview]");
  const categoryCount = form.querySelector("[data-onboarding-category-count]");
  const progress = modal.querySelector(".onboarding-progress");

  // El saldo real (cuenta + efectivo) es independiente del ingreso por periodo:
  // alguien puede empezar en $0, o ya tener guardado mas o menos que un periodo
  // de ingreso. Antes se exigia que sumaran exactamente igual, lo que bloqueaba
  // el paso para cualquiera que no tuviera esa coincidencia exacta.
  const updateBalance = () => {
    const data = new FormData(form);
    const total = numberFrom(data.get("account")) + numberFrom(data.get("cash"));
    if (totalPreview) totalPreview.textContent = formatMoney(total);
  };

  const updateCategories = () => {
    const income = numberFrom(form.elements.namedItem("incomeAmount")?.value);
    let reserved = 0;
    let selected = 0;
    form.querySelectorAll("[data-onboarding-category-chip]").forEach((chip) => {
      const index = chip.dataset.categoryIndex;
      const amount = Math.round(income * Number(chip.dataset.rate || 0));
      const enabled = chip.classList.contains("is-active");
      ["categoryName", "categoryAmount", "categoryCadence"].forEach((prefix) => {
        const input = form.elements.namedItem(`${prefix}${index}`);
        if (input) input.disabled = !enabled;
      });
      const amountInput = form.elements.namedItem(`categoryAmount${index}`);
      if (amountInput) amountInput.value = amount;
      if (enabled) {
        reserved += amount;
        selected += 1;
      }
    });
    if (incomePreview) incomePreview.textContent = formatMoney(income);
    if (freePreview) freePreview.textContent = formatMoney(Math.max(0, income - reserved));
    if (categoryCount) {
      categoryCount.textContent = `de ${formatMoney(income)} · ${selected} ${selected === 1 ? "categoría seleccionada" : "categorías seleccionadas"}`;
    }
  };

  const showStep = (step) => {
    modal.dataset.onboardingStep = String(step);
    form.querySelectorAll("[data-step]").forEach((section) => section.classList.toggle("is-active", Number(section.dataset.step) === step));
    modal.querySelectorAll(".onboarding-progress span").forEach((dot, index) => dot.classList.toggle("is-active", index === step - 1));
    progress?.setAttribute("aria-label", `Paso ${step} de 3`);
    backButton.hidden = step === 1;
    nextButton.hidden = step === 3;
    finishButton.hidden = step !== 3;
    skipButton.hidden = step !== 3;
    error.textContent = "";
    if (step === 2) updateBalance();
    if (step === 3) updateCategories();
  };

  nextButton.addEventListener("click", () => {
    const step = Number(modal.dataset.onboardingStep || 1);
    const message = validateOnboardingStep(form, step);
    if (message) {
      error.textContent = message;
      return;
    }
    showStep(Math.min(3, step + 1));
  });
  backButton.addEventListener("click", () => showStep(Math.max(1, Number(modal.dataset.onboardingStep || 1) - 1)));
  form.elements.namedItem("incomeAmount")?.addEventListener("input", updateCategories);
  ["account", "cash"].forEach((name) => form.elements.namedItem(name)?.addEventListener("input", updateBalance));
  const cadenceInput = form.elements.namedItem("incomeCadence");
  const cadenceOtherField = form.querySelector("[data-onboarding-cadence-other]");
  const cadenceOtherSelect = form.querySelector("[data-onboarding-cadence-select]");
  form.querySelectorAll("[data-onboarding-cadence]").forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.onboardingCadence;
      const isOther = choice === "other";
      if (cadenceOtherField) {
        cadenceOtherField.hidden = !isOther;
      }
      // El boton "Otro" no es una frecuencia; toma la del select que acaba de revelar.
      cadenceInput.value = isOther ? cadenceOtherSelect?.value || "semester" : choice;
      form.querySelectorAll("[data-onboarding-cadence]").forEach((item) => item.classList.toggle("is-active", item === button));
    });
  });
  cadenceOtherSelect?.addEventListener("change", () => {
    cadenceInput.value = cadenceOtherSelect.value;
  });
  const paydayField = form.querySelector("[data-onboarding-payday-field]");
  const paydayNote = form.querySelector("[data-onboarding-payday-note]");
  const paydayInput = form.elements.namedItem("periodStart");
  form.querySelectorAll("[data-onboarding-income-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const incomeType = button.dataset.onboardingIncomeType;
      form.elements.namedItem("incomeType").value = incomeType;
      form.querySelectorAll("[data-onboarding-income-type]").forEach((item) => item.classList.toggle("is-active", item === button));
      const isFixed = incomeType !== "variable";
      if (paydayField) paydayField.hidden = !isFixed;
      if (paydayNote) paydayNote.hidden = !isFixed;
      if (paydayInput) {
        paydayInput.type = isFixed ? "date" : "hidden";
        if (isFixed) {
          paydayInput.required = true;
          if (!paydayInput.value) paydayInput.value = todayKey();
        } else {
          paydayInput.required = false;
          paydayInput.value = monthStartKey();
        }
      }
    });
  });
  form.querySelectorAll("[data-onboarding-category-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("is-active");
      updateCategories();
    });
  });
  skipButton.addEventListener("click", () => {
    form.querySelectorAll("[data-onboarding-category-chip]").forEach((chip) => chip.classList.remove("is-active"));
    updateCategories();
    form.requestSubmit(finishButton);
  });
  updateCategories();
}

function validateOnboardingStep(form, step) {
  const data = new FormData(form);
  // En el orden en que el usuario ve los campos, para que el mensaje apunte siempre a
  // lo primero que falta. Ninguno de estos tiene ya un valor por defecto que lo
  // resuelva en silencio, asi que los tres son respuestas reales del usuario.
  if (step === 1 && !INCOME_TYPES.includes(data.get("incomeType"))) {
    return "Dinos si tu ingreso es fijo o variable.";
  }
  if (step === 1 && !INCOME_CADENCE_VALUES.includes(data.get("incomeCadence"))) {
    return "Elige cada cuánto recibes tu dinero.";
  }
  if (step === 1 && numberFrom(data.get("incomeAmount")) <= 0) {
    return "Escribe cuánto recibes por periodo.";
  }
  if (step === 1 && data.get("incomeType") === "fixed" && !cleanDate(data.get("periodStart"), "")) {
    return "Elige el día en que te pagan.";
  }
  // El paso 2 (saldo real) no se valida contra el presupuesto: son dos numeros
  // independientes (ver nota en updateBalance). $0 en ambos es una respuesta valida.
  return "";
}

function handleOnboardingSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = form.querySelector(".onboarding-error");
  const stepOneError = validateOnboardingStep(form, 1);
  const stepTwoError = validateOnboardingStep(form, 2);
  if (stepOneError || stepTwoError) {
    error.textContent = stepOneError || stepTwoError;
    return;
  }

  const data = new FormData(form);
  const incomeCadence = INCOME_CADENCE_VALUES.includes(data.get("incomeCadence"))
    ? data.get("incomeCadence")
    : "monthly";
  const incomeType = data.get("incomeType") === "variable" ? "variable" : "fixed";
  const incomeAmount = numberFrom(data.get("incomeAmount"));
  const periodStart = cleanDate(data.get("periodStart"), monthStartKey());
  const now = new Date().toISOString();
  const profileDraft = {
    ...state.profile,
    completed: true,
    name: "Mi plan",
    incomeCadence,
    incomeType,
    incomeAmount,
    periodStart,
    semesterStart: periodStart,
    monthlyIncome: getMonthlyIncome({ ...state.profile, incomeCadence, incomeAmount }),
    committedExpenses: 0,
    updated_at: now
  };
  const jobs = onboardingCategories(data, profileDraft, now);
  const reserved = jobs.reduce((sum, job) => sum + getBudgetAmountForJob(job, profileDraft), 0);
  if (reserved > incomeAmount) {
    error.textContent = `Las categorías separan ${formatMoney(reserved)}, más que tu presupuesto de ${formatMoney(incomeAmount)}.`;
    return;
  }

  state.profile = profileDraft;
  state.liquidity = {
    account: numberFrom(data.get("account")),
    cash: numberFrom(data.get("cash")),
    initialized: true,
    updated_at: now
  };
  state.budgetJobs = jobs;
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Creaste tu primer plan y viste cuanto puedes gastar."
  });
  state.lastAlert = "Plan listo. Registra tu primer gasto cuando ocurra.";
  activateView(DEFAULT_VIEW);
  saveState();
  render();
}

function onboardingCategories(data, profile, updatedAt) {
  const indexes = [...data.keys()]
    .filter((name) => /^categoryName\d+$/.test(name))
    .map((name) => Number(name.replace("categoryName", "")))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return indexes
    .map((index) => ({
      name: cleanText(data.get(`categoryName${index}`), ""),
      amount: numberFrom(data.get(`categoryAmount${index}`)),
      cadence: ["weekly", "biweekly", "monthly", "period"].includes(data.get(`categoryCadence${index}`))
        ? data.get(`categoryCadence${index}`)
        : "monthly"
    }))
    .filter((job) => job.name && job.amount > 0)
    .map((job) => ({
      ...job,
      id: uniqueCategoryId(job.name),
      updated_at: updatedAt
    }));
}

function bindDiagnosisPreview(form) {
  const updateMonthlyEquivalent = () => {
    const data = new FormData(form);
    const incomeCadence = INCOME_CADENCE_VALUES.includes(data.get("incomeCadence"))
      ? data.get("incomeCadence")
      : "monthly";
    const monthlyInput = form.elements.namedItem("monthlyIncome");
    if (!monthlyInput) {
      return;
    }
    monthlyInput.value = getMonthlyIncome({
      ...state.profile,
      incomeCadence,
      incomeAmount: numberFrom(data.get("incomeAmount"))
    });
  };
  const updateLiquidityMatch = () => {
    const hint = form.querySelector("[data-liquidity-match-hint]");
    if (!hint) {
      return;
    }
    const data = new FormData(form);
    const incomeAmount = numberFrom(data.get("incomeAmount"));
    const total = numberFrom(data.get("account")) + numberFrom(data.get("cash"));
    const requireMatch = shouldRequireOpeningBalanceMatch();
    if (!requireMatch) {
      hint.textContent = `Saldo real actual: ${formatMoney(total)}. Puede ser distinto del presupuesto base si ya registraste gastos o dinero extra.`;
      hint.classList.remove("is-error");
      hint.classList.add("is-ok");
      return;
    }
    const matches = total === incomeAmount;
    hint.textContent = matches
      ? `Cuenta + físico coincide con ${formatMoney(incomeAmount)}.`
      : `Cuenta + físico suma ${formatMoney(total)}; debe sumar ${formatMoney(incomeAmount)}.`;
    hint.classList.toggle("is-ok", matches);
    hint.classList.toggle("is-error", !matches);
  };
  // La volatilidad solo altera el ahorro sugerido cuando el ingreso es variable
  // (getSavingsRate la ignora si es fijo), asi que no se le pregunta a quien cobra un
  // salario. Se oculta en vez de quitarse del DOM para que el valor guardado viaje
  // igual en el FormData si el usuario alterna entre fijo y variable sin guardar.
  const updateVolatilityVisibility = () => {
    const field = form.querySelector("[data-volatility-field]");
    if (!field) {
      return;
    }
    field.hidden = form.elements.namedItem("incomeType")?.value !== "variable";
  };
  const updatePreview = () => {
    updateMonthlyEquivalent();
    updateLiquidityMatch();
    updateVolatilityVisibility();
  };

  ["incomeCadence", "incomeAmount", "account", "cash", "incomeType"].forEach((name) => {
    const field = form.elements.namedItem(name);
    if (field) {
      field.addEventListener("input", updatePreview);
      field.addEventListener("change", updatePreview);
    }
  });
  updatePreview();
}

function bindExtraSheetPreview(form) {
  const amountInput = form.elements.namedItem("amount");
  const range = form.querySelector("[data-extra-range]");
  const savingsNode = form.querySelector("[data-extra-savings]");
  const freeNode = form.querySelector("[data-extra-free]");
  const percentNode = form.querySelector("[data-extra-percent]");
  if (!amountInput || !range || !savingsNode || !freeNode) {
    return;
  }

  const update = () => {
    const percent = clamp(Number(range.value), 0, 100);
    const amount = numberFrom(amountInput.value);
    const savingsAmount = Math.round(amount * percent / 100);
    savingsNode.textContent = formatMoney(savingsAmount);
    freeNode.textContent = formatMoney(amount - savingsAmount);
    if (percentNode) {
      percentNode.textContent = `${percent}%`;
    }
  };

  range.addEventListener("input", update);
  amountInput.addEventListener("input", update);
  update();
}

function bindExtraEditPreview(form) {
  const amount = form.elements.namedItem("amount");
  const range = form.querySelector("[data-extra-edit-range]");
  const savingsNode = form.querySelector("[data-extra-edit-savings]");
  const freeNode = form.querySelector("[data-extra-edit-free]");
  if (!amount || !range || !savingsNode || !freeNode) {
    return;
  }

  const update = () => {
    const nextAmount = numberFrom(amount.value);
    const percent = clamp(Number(range.value), 0, 100);
    const savingsAmount = Math.round(nextAmount * percent / 100);
    savingsNode.textContent = formatMoney(savingsAmount);
    freeNode.textContent = formatMoney(nextAmount - savingsAmount);
  };
  amount.addEventListener("input", update);
  range.addEventListener("input", update);
  update();
}

function bindPlanCategoryPreview(form) {
  const conversión = form.querySelector("[data-category-conversion]");
  const warning = form.querySelector("[data-category-limit-warning]");
  const submit = form.querySelector("[data-category-submit]");
  const update = () => {
    const data = new FormData(form);
    const amount = numberFrom(data.get("amount"));
    const cadence = data.get("cadence") || "monthly";
    const draft = { amount, cadence };
    const converted = getBudgetAmountForJob(draft, state.profile);
    // Mismo criterio que handleBudgetSubmit: comparar contra freeRemaining (lo que de
    // verdad queda libre, ya descontado lo gastado sin clasificar), no freeBudget (el
    // cupo bruto) — si no, este boton se habilita para montos que igual serian
    // rechazados al guardar, o peor, que dejarian "Libre" clavado en $0.
    const available = budgetSummary().freeRemaining;
    const exceeds = amount > 0 && converted > available;
    if (conversión) {
      conversión.innerHTML = amount > 0
        ? `<span>Conversión automática</span><strong>${formatMoney(amount)} ${cadenceLabel(cadence)} = ${formatMoney(converted)} en este periodo</strong><small>Disponible para reservar: ${formatMoney(available)}</small>`
        : `<span>Conversión automática</span><strong>Escribe un monto para ver su valor en este periodo.</strong><small>Disponible para reservar: ${formatMoney(available)}</small>`;
    }
    if (warning) warning.hidden = !exceeds;
    if (submit) submit.disabled = exceeds;
  };
  form.querySelectorAll("input, [data-choice-value]").forEach((control) => control.addEventListener("input", update));
  form.querySelectorAll("[data-choice-value]").forEach((control) => control.addEventListener("click", () => window.setTimeout(update)));
  update();
}

function bindSetAsidePreview(form) {
  const preview = form.querySelector("[data-setaside-preview]");
  const warning = form.querySelector("[data-setaside-warning]");
  const submit = form.querySelector("[data-setaside-submit]");
  const nameInput = form.elements.namedItem("name");
  const update = () => {
    const amount = numberFrom(new FormData(form).get("amount"));
    const available = budgetSummary().freeRemaining;
    const exceeds = amount > 0 && amount > available;
    if (preview) {
      preview.innerHTML =
        amount > 0
          ? `<span>Después de apartar</span><strong>Te quedarían ${formatMoney(Math.max(0, available - amount))} libres</strong><small>Ahora tienes ${formatMoney(available)} libres.</small>`
          : `<span>Después de apartar</span><strong>Escribe un monto para ver cuánto te queda libre.</strong><small>Ahora tienes ${formatMoney(available)} libres.</small>`;
    }
    if (warning) warning.hidden = !exceeds;
    if (submit) submit.disabled = exceeds;
  };
  form.querySelectorAll("input").forEach((control) => control.addEventListener("input", update));
  // Deliberately a direct listener instead of data-action: handleAction re-renders the
  // whole view, which would rebuild these uncontrolled inputs and wipe the amount the
  // user already typed before they picked a name.
  form.querySelectorAll("[data-setaside-name]").forEach((chip) =>
    chip.addEventListener("click", () => {
      if (nameInput) {
        nameInput.value = chip.dataset.setasideName || "";
      }
      update();
    })
  );
  update();
}

function bindSavingsSimulatorPreview(form) {
  const raise = form.elements.namedItem("monthlyRaisePct");
  const escalation = form.elements.namedItem("escalationPct");
  const result = form.closest(".raise-simulator")?.querySelector("[data-simulator-result]");
  const raiseOutput = form.querySelector("[data-raise-output]");
  const escalationOutput = form.querySelector("[data-escalation-output]");
  const update = () => {
    const monthlyIncome = Number(form.dataset.monthlyIncome || 0);
    const raiseValue = Number(raise.value || 0);
    const escalationValue = Number(escalation.value || 0);
    if (raiseOutput) raiseOutput.value = `${raiseValue}%`;
    if (escalationOutput) escalationOutput.value = `${escalationValue}%`;
    if (result) result.textContent = formatMoney(monthlyIncome * (raiseValue / 100) * (escalationValue / 100));
  };
  raise?.addEventListener("input", update);
  escalation?.addEventListener("input", update);
}

function bindMerchantRuleSuggestions(form) {
  const merchantInput = form.elements.namedItem("merchant");
  const suggestion = form.querySelector("[data-merchant-rule-suggestion]");
  if (!merchantInput || !suggestion) {
    return;
  }

  const update = () => {
    const rule = findMerchantRule(merchantInput.value);
    const selectedCategory = form.elements.namedItem("category")?.value || "";
    const shouldShow = Boolean(rule) && (!selectedCategory || selectedCategory === FREE_CATEGORY_ID);
    suggestion.hidden = !shouldShow;
    suggestion.innerHTML = shouldShow ? merchantRuleSuggestionMarkup(rule) : "";
  };

  merchantInput.addEventListener("input", update);
  merchantInput.addEventListener("change", update);
  form.querySelectorAll('[name="category"], [data-choice-name="category"]').forEach((control) => {
    control.addEventListener("change", update);
    control.addEventListener("click", () => window.setTimeout(update));
  });
  suggestion.addEventListener("click", (event) => {
    const button = event.target.closest("[data-apply-merchant-rule]");
    if (!button) {
      return;
    }
    const rule = state.merchantRules.find((item) => item.id === button.dataset.applyMerchantRule);
    if (!rule) {
      return;
    }
    applyMerchantRuleToForm(form, rule);
    update();
  });
  update();
}

function applyMerchantRuleToForm(form, rule) {
  setFormChoiceValue(form, "category", rule.category);
  setFormChoiceValue(form, "source", normalizeLocation(rule.source));
}

function setFormChoiceValue(form, name, value) {
  const field = form.elements.namedItem(name);
  if (!field) {
    return;
  }

  field.value = value;
  const group = form.querySelector(`[data-choice-group="${name}"]`);
  if (group) {
    group.querySelectorAll("[data-choice-value]").forEach((choice) => {
      const active = choice.dataset.choiceValue === value;
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-checked", active ? "true" : "false");
      choice.tabIndex = active ? 0 : -1;
    });
  }
}

function handleAction(event) {
  // Backdrops carry the same data-action as their sheet's own close/cancel button, so
  // tapping outside the sheet dismisses it — the standard Android gesture, previously
  // missing entirely. But clicks inside the sheet bubble up through the backdrop too;
  // only actually close when the tap landed on the backdrop itself, not on its content.
  if (
    event.currentTarget !== event.target &&
    (event.currentTarget.classList.contains("sheet-backdrop") ||
      event.currentTarget.classList.contains("quick-expense-backdrop") ||
      event.currentTarget.classList.contains("modal-backdrop"))
  ) {
    return;
  }
  event.preventDefault();
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;
  const section = event.currentTarget.dataset.section;
  const category = event.currentTarget.dataset.category;
  const interfaceOnlyActions = new Set([
    "toggle-menu",
    "close-menu",
    "open-expense",
    "toggle-quick-expense-advanced",
    "filter-movements-by-date",
    "clear-movements-date-filter",
    "close-expense",
    "show-auth-form",
    "back-auth-options",
    "open-add-category-choice",
    "open-category-sheet",
    "open-setaside-sheet",
    "open-extra-sheet",
    "close-plan-sheet",
    "request-remove-job",
    "cancel-remove-job",
    "request-restore-backup",
    "cancel-restore-backup",
    "open-delete-account",
    "cancel-delete-account",
    "edit-transaction",
    "close-transaction-editor",
    "edit-extra",
    "close-extra-editor",
    "open-prediction-details",
    "close-prediction-details",
    "open-period-report",
    "close-period-report",
    "copy-period-report",
    "download-period-report",
    "export-movements-csv",
    "recover-auth",
    "open-diagnosis",
    "close-diagnosis",
    "start-quick-classify",
    "close-quick-classify",
    "request-reminder-permission",
    "send-test-reminder",
    "register-calendar-event",
    "open-lock-setup",
    "open-lock-disable",
    "set-theme",
    "retry-cloud-sync"
  ]);

  const actions = {
    "toggle-menu": () => {
      menuOpen = !menuOpen;
      quickExpenseOpen = false;
    },
    "close-menu": () => {
      menuOpen = false;
    },
    "open-expense": openQuickExpense,
    "toggle-quick-expense-advanced": () => {
      quickExpenseAdvancedOpen = !quickExpenseAdvancedOpen;
    },
    "close-expense": closeQuickExpense,
    "filter-movements-by-date": () => {
      const date = event.currentTarget.dataset.date || "";
      // Tapping the same day again clears the filter, same as a toggle.
      transactionHistoryDate = transactionHistoryDate === date ? "" : date;
    },
    "clear-movements-date-filter": () => {
      transactionHistoryDate = "";
    },
    "show-auth-form": () => {
      authMode = ["signin", "signup", "forgot"].includes(event.currentTarget.dataset.authMode) ? event.currentTarget.dataset.authMode : "";
      authNotice = null;
      cloudState.error = "";
    },
    "back-auth-options": () => {
      authMode = "";
      authNotice = null;
      cloudState.error = "";
    },
    "open-add-category-choice": () => {
      planSheet = "add-category-choice";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "open-category-sheet": () => {
      planSheet = "category";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "open-setaside-sheet": () => {
      planSheet = "setaside";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "open-extra-sheet": () => {
      // Also reachable from the expense sheet ("¿Te entró plata?"), so swap sheets.
      if (quickExpenseOpen) {
        closeQuickExpense();
      }
      planSheet = "extra";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "close-plan-sheet": () => {
      planSheet = "";
    },
    "request-remove-job": () => {
      pendingJobRemovalId = id;
    },
    "cancel-remove-job": () => {
      pendingJobRemovalId = "";
    },
    "confirm-remove-job": () => {
      removeBudgetJob(pendingJobRemovalId);
      pendingJobRemovalId = "";
    },
    "request-restore-backup": () => {
      pendingBackupRestoreId = id;
    },
    "cancel-restore-backup": () => {
      pendingBackupRestoreId = "";
    },
    "confirm-restore-backup": () => {
      restoreLocalBackup(pendingBackupRestoreId);
      pendingBackupRestoreId = "";
    },
    "open-delete-account": () => {
      cloudState.error = "";
      deleteAccountOpen = true;
      menuOpen = false;
    },
    "cancel-delete-account": () => {
      cloudState.error = "";
      deleteAccountOpen = false;
    },
    "confirm-delete-account": () => handleDeleteAccount(),
    "edit-transaction": () => {
      editingTransactionId = id;
      editingExtraId = "";
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "close-transaction-editor": () => {
      editingTransactionId = "";
    },
    "edit-extra": () => {
      editingExtraId = id;
      editingTransactionId = "";
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "close-extra-editor": () => {
      editingExtraId = "";
    },
    "open-prediction-details": () => {
      predictionDetailsOpen = true;
      periodReportOpen = false;
      menuOpen = false;
      quickExpenseOpen = false;
    },
    "close-prediction-details": () => {
      predictionDetailsOpen = false;
    },
    "open-period-report": () => {
      periodReportOpen = true;
      predictionDetailsOpen = false;
      menuOpen = false;
      quickExpenseOpen = false;
    },
    "close-period-report": () => {
      periodReportOpen = false;
    },
    "copy-period-report": copyPeriodReport,
    "download-period-report": downloadPeriodReport,
    "export-movements-csv": downloadMovementsCsv,
    "recover-auth": recoverAuthStartup,
    "open-diagnosis": () => {
      diagnosisValidation = { field: "", message: "" };
      state.showDiagnosis = true;
      state.diagnosisSection = DIAGNOSIS_SECTIONS[section] ? section : "plan";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "close-diagnosis": () => {
      diagnosisValidation = { field: "", message: "" };
      state.showDiagnosis = false;
    },
    "start-quick-classify": () => {
      quickClassifyQueue = unclassifiedTransactionsForSummary().map((transaction) => transaction.id);
      menuOpen = false;
    },
    "quick-classify": () => {
      const transaction = state.transactions.find((item) => item.id === id);
      if (transaction) {
        transaction.category = category || FREE_CATEGORY_ID;
        transaction.labeled = transaction.category !== FREE_CATEGORY_ID;
        transaction.updated_at = new Date().toISOString();
        showNoticeSnackbar(`Clasificado como ${categoryName(transaction.category)}.`, { renderNow: false });
      }
      quickClassifyQueue = quickClassifyQueue.filter((queuedId) => queuedId !== id);
    },
    "close-quick-classify": () => {
      quickClassifyQueue = [];
    },
    "remove-transaction": () => {
      removeTransaction(id);
      editingTransactionId = "";
    },
    "undo-snackbar": () => {
      removeTransaction(id);
      clearSnackbar({ renderNow: false });
    },
    "remove-extra-from-editor": () => {
      removeBudgetExtra(id);
      editingExtraId = "";
    },
    "save-period-close": savePeriodClosure,
    "remove-merchant-rule": () => removeMerchantRule(id),
    "request-reminder-permission": requestReminderPermission,
    "send-test-reminder": sendTestReminder,
    "register-calendar-event": () => startCalendarEventExpense(id),
    "open-lock-setup": () => {
      // Changing an existing PIN must prove you know the current one first — otherwise
      // anyone who picks up an already-unlocked phone could silently swap in their own
      // PIN. First-time setup has no current PIN to verify, so it goes straight to "set".
      lockMode = lockConfig.enabled ? "verify-change" : "set";
      lockDigits = "";
      lockFirstEntry = "";
      lockError = "";
      menuOpen = false;
    },
    "open-lock-disable": () => {
      lockMode = "disable";
      lockDigits = "";
      lockError = "";
      menuOpen = false;
    },
    "enable-biometric": () => enableBiometric(),
    "disable-biometric": () => disableBiometric(),
    "retry-cloud-sync": () => {
      pushCloudState();
    },
    "set-theme": () => {
      state.settings = {
        ...(state.settings || {}),
        theme: normalizeTheme(event.currentTarget.dataset.themeChoice),
        updated_at: new Date().toISOString()
      };
      saveState();
      applyThemePreference();
    },
    "remove-calendar-event": () => removeCalendarEvent(id),
    "reopen-calendar-event": () => reopenCalendarEvent(id),
    "cancel-cooldown": () => cancelCooldown(id),
    "unlock-cooldown": () => unlockCooldown(id),
    "cloud-sign-out": () => handleCloudSignOut(),
    "dismiss-income-banner": () => {
      if (state.periodIncomeStatus) {
        state.periodIncomeStatus.bannerDismissed = true;
      }
    },
    "undo-income-application": () => {
      const status = state.periodIncomeStatus;
      if (status?.applied) {
        adjustLiquidity(status.location || "account", -Number(status.amount || 0), "revertir-ingreso-periodico");
        status.applied = false;
        status.rejected = true;
        status.bannerDismissed = true;
        const logged = findLoggedIncome(state.periodIncomeApplied, todayKey());
        if (logged) {
          logged.status = "rejected";
        }
      }
    }
  };

  if (actions[action]) {
    actions[action]();
    // These manage their own persistence + render (async, or device-local lock storage
    // that must never touch saveState / cloud sync).
    const selfManagedAction =
      action === "cloud-sign-out" ||
      action === "confirm-delete-account" ||
      action === "enable-biometric" ||
      action === "disable-biometric";
    if (!selfManagedAction && !interfaceOnlyActions.has(action)) {
      saveState();
    }
    if (!selfManagedAction) {
      render();
    }
    if (action === "filter-movements-by-date" && transactionHistoryDate) {
      // The calendar sits above the results list, so jump the user straight to what
      // they tapped for instead of leaving them to scroll down and find it themselves.
      document.querySelector("#transaction-history-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function recoverAuthStartup() {
  if (cloudState.sessionReady) {
    return;
  }
  cloudState.sessionReady = true;
  if (cloudState.signedIn) {
    cloudState.status = "error";
    cloudState.error = "La sincronización está tardando. Puedes usar tus datos locales mientras vuelve la conexión.";
    // Solo cambia un aviso: si hay un formulario abierto (el acceso directo del widget
    // puede haberlo abierto hace segundos) no vale la pena borrarlo por eso.
    renderBackground();
    return;
  }
  cloudState.status = "signed-out";
  cloudState.error = "No pude comprobar una sesión guardada. Inicia sesión de nuevo.";
  render();
}

function handleDiagnosisSubmit(event) {
  event.preventDefault();
  submitDiagnosisForm(event.currentTarget);
}

function submitDiagnosisForm(form) {
  const validation = validateDiagnosisForm(form);
  if (validation) {
    diagnosisValidation = validation;
    state.lastAlert = validation.message;
    showNoticeSnackbar(validation.message, { kind: "error", renderNow: false });
    render();
    showDiagnosisValidation(validation);
    return;
  }

  diagnosisValidation = { field: "", message: "" };
  clearSnackbar({ renderNow: false });
  const data = new FormData(form);
  const sectionKey = DIAGNOSIS_SECTIONS[form.dataset.diagnosisSection] ? form.dataset.diagnosisSection : "plan";
  const wasIncomplete = !state.profile.completed;
  let successMessage = "Datos guardados.";

  saveLocalBackup("antes de guardar plan");

  if (sectionKey === "plan") {
    const shouldClearTemplateBudget = shouldClearTemplateBudgetOnPlanSave();
    const incomeCadence = INCOME_CADENCE_VALUES.includes(data.get("incomeCadence"))
      ? data.get("incomeCadence")
      : "monthly";
    const incomeAmount = numberFrom(data.get("incomeAmount"));
    const periodStart = cleanDate(data.get("periodStart"), monthStartKey());
    // getMonthlyIncome saca los meses del periodo de la cadencia (INCOME_CADENCES) y
    // nunca lee semesterMonths; y solo cae en semesterIncome si incomeAmount es null,
    // cosa que migrateState garantiza que no pasa. Ambos campos eran ruido, pero uno
    // hacia dano real: con `state.profile.semesterIncome || STUDENT_SEMESTER_INCOME`,
    // guardar el Plan con semesterIncome en 0 escribia $1.750.000 (el ingreso de la
    // plantilla "estudiante") dentro del perfil real del usuario.
    const monthlyIncome = getMonthlyIncome({ ...state.profile, incomeCadence, incomeAmount });

    state.profile = {
      ...state.profile,
      completed: true,
      name: cleanText(data.get("name"), "Mi plan"),
      incomeCadence,
      incomeType: data.get("incomeType") === "variable" ? "variable" : "fixed",
      incomeAmount,
      periodStart,
      semesterStart: periodStart,
      monthlyIncome,
      volatility: VOLATILITY_VALUES.includes(data.get("volatility")) ? data.get("volatility") : state.profile.volatility || "medium",
      committedExpenses: numberFrom(data.get("committedExpenses")),
      payday: normalizePayday(data.get("payday")),
      updated_at: new Date().toISOString()
    };

    if (shouldClearTemplateBudget) {
      clearTemplateBudget(state);
    }
    successMessage = shouldClearTemplateBudget
      ? "Datos guardados. Quité las categorías de ejemplo; ahora crea las tuyas."
      : "Plan básico guardado.";
  }

  if (sectionKey === "balances") {
    state.profile = {
      ...state.profile,
      completed: true,
      emergencySavings: numberFrom(data.get("emergencySavings")),
      updated_at: new Date().toISOString()
    };
    state.liquidity = {
      account: numberFrom(data.get("account")),
      cash: numberFrom(data.get("cash")),
      initialized: true,
      updated_at: new Date().toISOString()
    };
    successMessage = "Saldos actualizados.";
  }

  if (wasIncomplete) {
    state.wins.push({
      id: uid("win"),
      date: todayKey(),
      text: "Guardaste tus datos reales y convertiste números sueltos en un plan."
    });
  }

  state.showDiagnosis = false;
  activateView(DEFAULT_VIEW);
  state.lastAlert = successMessage;
  saveState();
  render();
}

function validateDiagnosisForm(form) {
  const data = new FormData(form);
  const sectionKey = DIAGNOSIS_SECTIONS[form.dataset.diagnosisSection] ? form.dataset.diagnosisSection : "plan";
  const activeFields = new Set(DIAGNOSIS_SECTIONS[sectionKey].fields);
  const allowedCadences = INCOME_CADENCE_VALUES;
  const requiredNumbers = [
    ["incomeAmount", "El presupuesto por periodo debe ser mayor que cero.", 1],
    ["committedExpenses", "Los gastos comprometidos no pueden estar vacios.", 0],
    ["emergencySavings", "El ahorro actual para la simulación no puede estar vacio.", 0],
    ["account", "El dinero en cuenta no puede estar vacio.", 0],
    ["cash", "El dinero en físico no puede estar vacio.", 0]
  ];

  if (activeFields.has("name") && !cleanText(data.get("name"), "")) {
    return { field: "name", message: "Escribe un nombre para tu plan." };
  }

  if (activeFields.has("incomeCadence") && !allowedCadences.includes(data.get("incomeCadence"))) {
    return { field: "incomeCadence", message: "Elige cada cuanto recibes presupuesto." };
  }

  for (const [field, message, min] of requiredNumbers) {
    if (!activeFields.has(field)) {
      continue;
    }
    const value = numberValue(data.get(field));
    if (value == null || value < min) {
      return { field, message };
    }
  }

  if (activeFields.has("periodStart") && !cleanDate(data.get("periodStart"), "")) {
    return { field: "periodStart", message: "El inicio del periodo actual debe ser una fecha valida." };
  }

  if (activeFields.has("payday")) {
    const paydayRaw = String(data.get("payday") ?? "").trim();
    const payday = paydayRaw ? Number(paydayRaw) : 0;
    if (!Number.isFinite(payday) || payday < 0 || payday > 28) {
      return { field: "payday", message: "El día de pago debe estar entre 0 y 28." };
    }
  }

  if (activeFields.has("incomeType") && !["fixed", "variable"].includes(data.get("incomeType"))) {
    return { field: "incomeType", message: "Elige si tu ingreso es fijo o variable." };
  }

  // Solo se exige cuando el ingreso es variable: con ingreso fijo el campo va oculto
  // (ver bindDiagnosisPreview) y getSavingsRate ni siquiera lee la volatilidad.
  if (
    activeFields.has("volatility") &&
    data.get("incomeType") === "variable" &&
    !VOLATILITY_VALUES.includes(data.get("volatility"))
  ) {
    return { field: "volatility", message: "Elige qué tanto varía lo que recibes." };
  }

  return null;
}

function shouldRequireOpeningBalanceMatch() {
  return !state.profile.completed && !state.transactions.length && !state.budgetExtras.length && !state.budgetJobs.length;
}

function focusDiagnosisField(field) {
  window.setTimeout(() => {
    const input = document.querySelector(`#diagnosis-form [name="${field}"]`);
    const modal = document.querySelector(".modal");
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    if (modal) {
      const modalRect = modal.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const targetTop = modal.scrollTop + inputRect.top - modalRect.top - 96;
      modal.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
      return;
    }
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 80);
}

function showDiagnosisValidation(validation) {
  focusDiagnosisField(validation.field);
  window.setTimeout(() => {
    const error = document.querySelector(".diagnosis-error");
    const rect = error?.getBoundingClientRect();
    const visible = rect && rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!visible && typeof window.alert === "function") {
      window.alert(validation.message);
    }
  }, 220);
}

function handleBudgetSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  if (state.budgetJobs.length >= 10) {
    state.lastAlert = "Mantengamos máximo 10 categorías para que el plan siga claro.";
    saveState();
    render();
    return;
  }

  const name = cleanText(data.get("name"), "Nueva categoría");
  const amount = numberFrom(data.get("amount"));
  const cadence = JOB_CADENCE_VALUES.includes(data.get("cadence")) ? data.get("cadence") : "monthly";
  if (amount <= 0) {
    state.lastAlert = "El monto de la categoría debe ser mayor que cero.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
    saveState();
    render();
    return;
  }

  const job = {
    id: uniqueCategoryId(name),
    name,
    amount,
    cadence,
    updated_at: new Date().toISOString()
  };
  const semesterBudget = getBudgetAmountForJob(job, state.profile);
  const summary = budgetSummary();
  // Comparar contra freeBudget (el cupo bruto: ingreso menos OTRAS categorias) deja
  // pasar categorias que si caben en el cupo pero no en lo que de verdad queda libre,
  // porque freeBudget no descuenta lo que ya gastaste sin clasificar este periodo. El
  // usuario ve "Libre" (freeRemaining) en pantalla, asi que hay que validar contra eso:
  // es el mismo numero que compara mentalmente antes de crear la categoria, y evita que
  // freeRemaining termine clavado en $0 (por el Math.max(0, ...) interno) en vez de
  // bloquear la creacion con un aviso claro.
  if (semesterBudget > summary.freeRemaining) {
    state.lastAlert = `${name} reservaría ${formatMoney(semesterBudget)}, pero solo hay ${formatMoney(summary.freeRemaining)} libre para reservar.`;
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
    saveState();
    render();
    return;
  }

  state.budgetJobs.push(job);
  state.lastAlert = `${name} reserva ${formatMoney(semesterBudget)} del periodo ${budgetSummary().cadenceLabel}.`;
  planSheet = "";
  saveState();
  render();
}

function handleExtraBudgetSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amount = numberFrom(data.get("amount"));
  if (amount <= 0) {
    showNoticeSnackbar("El dinero extra debe ser mayor que cero.", { kind: "error" });
    return;
  }

  const allFree = event.submitter?.value === "all-free";
  applyExtraIncome(
    {
      source: cleanText(data.get("source"), "Dinero extra"),
      amount,
      date: cleanDate(data.get("date"), todayKey()),
      location: normalizeLocation(data.get("location"))
    },
    allFree ? 0 : numberFrom(data.get("savingsPercent"))
  );
  planSheet = "";
  saveState();
  render();
}

function applyExtraIncome(draft, rawPercent) {
  const percent = clamp(Number(rawPercent || 0), 0, 100);
  const savingsAmount = Math.round(Number(draft.amount || 0) * percent / 100);
  const freeAmount = Number(draft.amount || 0) - savingsAmount;
  const now = new Date().toISOString();
  const currentWindow = budgetSummary().window;
  const appliesNow = draft.date >= currentWindow.start && draft.date < currentWindow.end;
  let savingsJob = null;

  if (appliesNow) {
    adjustLiquidity(draft.location, draft.amount, "extra");
    savingsJob = applySavingsAllocation(savingsAmount, now);
  }

  const extra = {
    id: uid("extra"),
    source: draft.source,
    amount: draft.amount,
    date: draft.date,
    location: draft.location,
    allocation: {
      savingsPercent: percent,
      savingsAmount: appliesNow ? savingsAmount : 0,
      freeAmount: appliesNow ? freeAmount : draft.amount,
      savingsJobId: savingsJob?.id || ""
    },
    updated_at: now
  };
  state.budgetExtras.push(extra);
  state.lastAlert = appliesNow
    ? `${extra.source} sumó ${formatMoney(extra.amount)}: ${formatMoney(extra.allocation.savingsAmount)} a ahorro y ${formatMoney(extra.allocation.freeAmount)} libre.`
    : `${extra.source} quedó guardado, pero esa fecha pertenece a otro periodo.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const plan = calculatePlan();
  const amount = numberFrom(data.get("amount"));
  const merchant = cleanText(data.get("merchant"), DEFAULT_MERCHANT);
  const description = cleanText(data.get("description"), "");
  const category = String(data.get("category"));
  const budgeted = data.get("budgeted") === "on";
  const oneOff = data.get("oneOff") === "on";
  const source = normalizeLocation(data.get("source"));
  const calendarEventId = cleanText(data.get("calendarEventId"), "");
  const threshold = plan.expenses * LARGE_PURCHASE_RATIO;
  const transactionError = validateTransactionDraft({ amount, category, source });

  if (transactionError) {
    state.lastAlert = transactionError;
    showNoticeSnackbar(transactionError, { kind: "error" });
    return;
  }

  if (!budgeted && amount >= threshold) {
    state.cooldowns.push({
      id: uid("cool"),
      merchant,
      description,
      amount,
      category,
      source,
      createdAt: new Date().toISOString(),
      unlockAt: hoursFromNow(24).toISOString(),
      updated_at: new Date().toISOString()
    });
    state.lastAlert = `${merchant} quedó en pausa 24 horas antes de decidir.`;
  } else {
    const transaction = addTransaction({ merchant, description, amount, category, budgeted, oneOff, source, calendarEventId });
    if (calendarEventId) {
      markCalendarEventSpent(calendarEventId, transaction.id);
    }
    state.lastAlert = createSpendAlert(category);
    showUndoSnackbar(transaction.id);
  }

  closeQuickExpense();
  expenseDraft = null;
  saveState();
  render();
}

function handleTransactionEditSubmit(event) {
  event.preventDefault();
  const transaction = state.transactions.find((item) => item.id === editingTransactionId);
  if (!transaction) {
    editingTransactionId = "";
    render();
    return;
  }
  const data = new FormData(event.currentTarget);
  const nextCategory = String(data.get("category") || FREE_CATEGORY_ID);
  const nextSource = normalizeLocation(data.get("source"));
  const nextOneOff = data.get("oneOff") === "on";
  const currentSource = normalizeLocation(transaction.source);
  if (nextSource !== currentSource) {
    const available = liquiditySummary()[nextSource];
    if (Number(transaction.amount || 0) > available) {
      showNoticeSnackbar(`${locationLabel(nextSource)} solo tiene ${formatMoney(available)} disponible.`, { kind: "error" });
      return;
    }
    if (state.liquidity?.initialized) {
      adjustLiquidity(currentSource, Number(transaction.amount || 0), "refund");
      adjustLiquidity(nextSource, -Number(transaction.amount || 0), "expense");
    }
  }
  transaction.category = nextCategory;
  transaction.labeled = nextCategory !== FREE_CATEGORY_ID;
  transaction.source = nextSource;
  transaction.oneOff = nextOneOff;
  transaction.updated_at = new Date().toISOString();
  rememberMerchantRule(transaction);
  state.lastAlert = `${transaction.merchant} quedó reclasificado.`;
  editingTransactionId = "";
  saveState();
  render();
}

function handleExtraEditSubmit(event) {
  event.preventDefault();
  const extra = state.budgetExtras.find((item) => item.id === editingExtraId);
  if (!extra) {
    editingExtraId = "";
    render();
    return;
  }

  const data = new FormData(event.currentTarget);
  const amount = numberFrom(data.get("amount"));
  if (amount <= 0) {
    showNoticeSnackbar("El dinero extra debe ser mayor que cero.", { kind: "error" });
    return;
  }

  updateBudgetExtra(extra, {
    source: cleanText(data.get("source"), "Dinero extra"),
    amount,
    date: cleanDate(data.get("date"), extra.date),
    location: normalizeLocation(data.get("location")),
    savingsPercent: clamp(numberFrom(data.get("savingsPercent")), 0, 100)
  });
  state.lastAlert = `${extra.source} quedo actualizado y el saldo se ajusto.`;
  editingExtraId = "";
  saveState();
  render();
}

function validateTransactionDraft({ amount, category, source }) {
  if (amount <= 0) {
    return "El monto del gasto debe ser mayor que cero.";
  }

  const validCategory = category === FREE_CATEGORY_ID || state.budgetJobs.some((job) => job.id === category);
  if (!validCategory) {
    return "Elige una categoría válida para clasificar el gasto.";
  }

  const available = liquiditySummary()[normalizeLocation(source)];
  if (amount > available) {
    return `${locationLabel(source)} solo tiene ${formatMoney(available)} disponible. Elige otra fuente o actualiza tus datos.`;
  }

  return "";
}

function handleSmartSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.settings.monthlyRaisePct = clamp(numberFrom(data.get("monthlyRaisePct")), 0, 100);
  state.settings.escalationPct = clamp(numberFrom(data.get("escalationPct")), 0, 100);
  state.settings.updated_at = new Date().toISOString();
  state.lastAlert = "Simulación de aumento actualizada.";
  saveState();
  render();
}

async function handleDailyReminderSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const enabled = data.get("enabled") === "on";
  const time = normalizeReminderTime(data.get("time"));
  let permission = notificationPermissionStatus();

  if (enabled && permission === "default") {
    permission = await requestNotificationPermission();
  }

  state.dailyReminder = {
    ...normalizeDailyReminder(state.dailyReminder),
    enabled,
    time,
    updated_at: new Date().toISOString()
  };

  if (enabled && permission === "denied") {
    state.lastAlert = "Recordatorio guardado, pero las notificaciones están bloqueadas en el navegador.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  } else if (enabled && permission === "unsupported") {
    state.lastAlert = "Este navegador no permite notificaciones desde la app.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  } else {
    state.lastAlert = enabled
      ? `Recordatorio diario activado a las ${time}.`
      : "Recordatorio diario apagado.";
  }

  saveState();
  if (enabled && permission === "granted") {
    scheduleDailyReminder();
  }
  render();
}

function handleFinancialEventSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const title = cleanText(data.get("title"), "");
  const amount = numberFrom(data.get("amount"));
  const date = cleanDate(data.get("date"), todayKey());
  const category = normalizeEventCategory(data.get("category"));

  if (!title) {
    showNoticeSnackbar("Escribe un nombre para el evento.", { kind: "error" });
    return;
  }

  state.calendarEvents.push({
    id: uid("event"),
    title,
    date,
    amount,
    category,
    notes: cleanText(data.get("notes"), ""),
    spent: false,
    transactionId: "",
    updated_at: new Date().toISOString()
  });
  state.lastAlert = `${title} quedo en tu calendario con estimado de ${formatMoney(amount)}.`;
  saveState();
  render();
}

async function requestReminderPermission() {
  const permission = await requestNotificationPermission();
  if (permission === "granted") {
    state.lastAlert = "Notificaciones permitidas. Ya puedes activar o probar el recordatorio.";
    if (normalizeDailyReminder(state.dailyReminder).enabled) {
      scheduleDailyReminder();
    }
  } else if (permission === "denied") {
    state.lastAlert = "El navegador bloqueó las notificaciones. Cámbialo desde los ajustes del sitio.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  } else {
    state.lastAlert = "Notificaciones no disponibles en este navegador.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  }
  saveState({ touch: false });
  render();
}

async function sendTestReminder() {
  const sent = await showDailyReminderNotification({ test: true });
  state.lastAlert = sent ? "Notificación de prueba enviada." : "No pude enviar la notificación de prueba.";
  if (!sent) {
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  }
  saveState({ touch: false });
  render();
}

async function handleForgotPasswordSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const email = cleanText(data.get("email"), "");

  authEmailDraft = email;
  cloudState.status = "syncing";
  cloudState.error = "";
  render();

  try {
    await requestPasswordReset(email);
    cloudState.status = "signed-out";
    authMode = "";
    authNotice = { kind: "reset-sent", email };
    render();
  } catch (error) {
    cloudState.status = "signed-out";
    cloudState.error = friendlyCloudError(error);
    render();
  }
}

async function handleCloudLoginSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const email = cleanText(data.get("email"), "");
  const password = String(data.get("password") || "");
  const mode = event.currentTarget.dataset.cloudMode || event.submitter?.dataset.cloudMode || "signin";

  // Remember the address so a wrong password never costs the user their email again.
  authEmailDraft = email;
  authNotice = null;
  cloudState.status = "syncing";
  cloudState.sessionReady = false;
  cloudState.error = "";
  render();

  const stopWithNotice = (notice) => {
    cloudState.sessionReady = true;
    cloudState.status = "signed-out";
    authNotice = notice;
    authMode = "";
    render();
  };

  try {
    let session = null;
    if (mode === "signup") {
      const result = await signUpToCloud(email, password);
      if (result.alreadyRegistered) {
        stopWithNotice({ kind: "exists", email });
        return;
      }
      if (!result.session) {
        stopWithNotice({ kind: "sent", email });
        return;
      }
      session = result.session;
    } else {
      session = await signInToCloud(email, password);
      if (!session) {
        cloudState.sessionReady = true;
        cloudState.status = "signed-out";
        cloudState.error = "No pude iniciar sesión. Si acabas de registrarte, confirma primero el correo.";
        render();
        return;
      }
    }

    applyCloudSession(session);
    cloudState.sessionReady = true;
    authEmailDraft = "";
    authNotice = null;
    resetQuickExpenseAfterLogin();
    state.lastAlert = mode === "signup" ? "Cuenta creada." : "Sesión iniciada.";
    await pullCloudAfterLogin();
  } catch (error) {
    cloudState.sessionReady = true;
    cloudState.status = "signed-out";
    cloudState.error = friendlyCloudError(error);
    render();
  }
}

async function handleCloudSignOut() {
  // Sign out is instantaneous from the user's point of view: drop straight to the
  // access screen, no "Comprobando tu sesión" detour. That screen (and its impatience
  // escape hatch, "Continuar al acceso") exists for STARTUP session checks, where
  // letting the user in while the check is still pending is the right fallback. During
  // sign-out it was the wrong fallback: cloudState.signedIn was still true while the
  // save+signOut network calls were in flight, so tapping that same button re-entered
  // the still-authenticated app for a few seconds before the background work finished
  // and yanked them back out — exactly the "entra un momento y despues sale" a friend
  // reported. Clearing local session state up front removes the whole window where
  // that could happen; the cloud save/sign-out below is best-effort cleanup after.
  clearTimeout(cloudSaveTimer);
  const payload = getCloudPayload();
  clearStoredCloudSession();
  clearLocalUserState();
  cloudState.signedIn = false;
  cloudState.email = "";
  cloudState.sessionReady = true;
  cloudState.status = "signed-out";
  cloudState.error = "";
  render();

  try {
    await saveCloudState(payload);
  } catch {
    // Best-effort: the user already left. Nothing to show them anymore.
  }
  try {
    await signOutFromCloud();
  } catch {
    // Same as above — local sign-out already happened regardless.
  }
}

async function handleDeleteAccount() {
  cloudState.status = "syncing";
  cloudState.error = "";
  render();

  // Intento primero el borrado COMPLETO (usuario de auth + datos) vía Edge Function.
  // Si esa función confirma, ya está todo hecho — incluidos los datos, por el
  // `on delete cascade`. Si aún no está desplegada (devuelve false), caigo al borrado
  // parcial: elimino la fila de datos y cierro sesión, y aviso con honestidad que el
  // correo/contraseña siguen existiendo hasta que la función esté disponible.
  let fullyDeleted = false;
  try {
    fullyDeleted = await deleteCloudAccount();
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = `No pude eliminar tu cuenta: ${friendlyCloudError(error)}. Intenta de nuevo.`;
    render();
    return;
  }

  if (!fullyDeleted) {
    try {
      await deleteCloudAppState();
    } catch (error) {
      cloudState.status = "error";
      cloudState.error = `No pude eliminar tus datos de la nube: ${friendlyCloudError(error)}. Intenta de nuevo.`;
      render();
      return;
    }
  }

  try {
    await signOutFromCloud();
  } catch {}

  clearStoredCloudSession();
  clearLocalUserState();
  deleteAccountOpen = false;
  cloudState.signedIn = false;
  cloudState.email = "";
  cloudState.sessionReady = true;
  cloudState.status = "signed-out";
  cloudState.error = fullyDeleted
    ? "Tu cuenta y todos tus datos se eliminaron por completo. Ya no podrás iniciar sesión con ese correo."
    : `Se eliminaron tus datos y se cerró la sesión, pero tu correo y contraseña siguen activos por ahora. Para borrarlos por completo, escríbenos a ${SUPPORT_EMAIL}.`;
  render();
}

function clearLocalUserState() {
  clearTimeout(cloudSaveTimer);
  clearTimeout(dailyReminderTimer);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BACKUP_KEY);
  state = createDefaultState(todayKey(), DEFAULT_VIEW);
  state.activeView = DEFAULT_VIEW;
  authMode = "";
  menuOpen = false;
  quickExpenseOpen = false;
  planSheet = "";
  pendingJobRemovalId = "";
  editingTransactionId = "";
  editingExtraId = "";
  clearSnackbar({ renderNow: false });
}

function startCalendarEventExpense(id) {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event) {
    state.lastAlert = "No encontre ese evento del calendario.";
    return;
  }

  expenseDraft = {
    calendarEventId: event.id,
    merchant: event.title,
    description: event.notes ? `Calendario: ${event.notes}` : "Calendario financiero",
    amount: Number(event.amount || 0),
    category: event.category || FREE_CATEGORY_ID
  };
  state.lastAlert = `${event.title} listo para registrar como gasto.`;
  openQuickExpense();
}

function markCalendarEventSpent(id, transactionId) {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event) {
    return;
  }
  event.spent = true;
  event.transactionId = transactionId;
  event.updated_at = new Date().toISOString();
}

function reopenCalendarEvent(id) {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event) {
    state.lastAlert = "No encontre ese evento del calendario.";
    return;
  }
  event.spent = false;
  event.transactionId = "";
  event.updated_at = new Date().toISOString();
  state.lastAlert = `${event.title} volvio a quedar pendiente.`;
}

function removeCalendarEvent(id) {
  const event = state.calendarEvents.find((item) => item.id === id);
  state.calendarEvents = state.calendarEvents.filter((item) => item.id !== id);
  state.lastAlert = event ? `${event.title} salio del calendario.` : "Evento eliminado.";
}

function savePeriodClosure() {
  const summary = budgetSummary();
  const plan = calculatePlan();
  const prediction = periodPrediction();
  const report = periodCloseReport(plan, summary);
  const movements = movementsForSummary(summary);
  const now = new Date().toISOString();
  const closure = {
    id: `${summary.window.start}:${summary.window.end}`,
    windowStart: summary.window.start,
    windowEnd: summary.window.end,
    closedAt: now,
    income: summary.income,
    reserved: summary.reserved,
    spent: summary.totalSpent,
    freeRemaining: report.freeFinal,
    freeFinal: report.freeFinal,
    projectedEndFree: prediction.projectedEndFree,
    dailyRate: prediction.dailyRate,
    confidence: prediction.confidence,
    categoryOverspent: summary.categoryOverspent,
    exceededCategories: report.exceededCategories.map((category) => ({
      id: category.id,
      name: category.name,
      budget: category.budget,
      spent: category.spent,
      over: category.over
    })),
    idealPeriodSavings: report.suggestedSavings,
    possiblePeriodSavings: report.possibleSavings,
    suggestedPeriodSavings: report.additionalSavingsNow,
    savingsCapacityGap: report.savingsGap,
    adjustments: report.adjustments,
    transactionCount: movements.filter((movement) => movement.kind === "expense").length,
    incomeCount: movements.filter((movement) => movement.kind === "income").length,
    status: report.status
  };
  const existingIndex = (state.periodClosures || []).findIndex((item) => item.id === closure.id);
  state.periodClosures = state.periodClosures || [];
  if (existingIndex >= 0) {
    state.periodClosures[existingIndex] = closure;
  } else {
    state.periodClosures.unshift(closure);
  }
  state.periodClosures = state.periodClosures.slice(0, 12);
  state.lastAlert = `Cierre guardado: ${formatMoney(closure.freeFinal)} libres y ${closure.exceededCategories.length} excedidos.`;
}

function currentPeriodReportText() {
  const summary = budgetSummary();
  const plan = calculatePlan();
  return generatePeriodReport(plan, summary, periodCloseReport(plan, summary));
}

function copyPeriodReport() {
  const reportText = currentPeriodReportText();
  const success = () => showNoticeSnackbar("Reporte copiado.", { duration: 3500 });
  const failure = () => showNoticeSnackbar("No pude copiarlo automáticamente. Puedes seleccionar el texto del reporte.", { kind: "error" });

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(reportText)
      .then(success)
      .catch(() => copyPeriodReportFallback(success, failure));
    return;
  }
  copyPeriodReportFallback(success, failure);
}

function copyPeriodReportFallback(success, failure) {
  const output = document.querySelector("#period-report-output");
  if (!output) {
    failure();
    return;
  }
  try {
    output.focus();
    output.select();
    const copied = document.execCommand("copy");
    if (copied) {
      success();
    } else {
      failure();
    }
  } catch {
    failure();
  }
}

function nativeFilesystem() {
  return window.Capacitor?.Plugins?.Filesystem || null;
}

function nativeShare() {
  return window.Capacitor?.Plugins?.Share || null;
}

function nativeApp() {
  return window.Capacitor?.Plugins?.App || null;
}

function nativeBiometric() {
  return window.Capacitor?.Plugins?.BiometricAuth || null;
}

async function tryBiometricUnlock() {
  if (lockMode !== "unlock" || !lockConfig.biometric || lockIsCoolingDown() || biometricPromptActive) {
    return;
  }
  const biometric = nativeBiometric();
  if (!biometric) {
    return;
  }
  biometricPromptActive = true;
  try {
    await biometric.authenticate({ reason: "Desbloquea tus finanzas" });
    lockConfig = { ...lockConfig, failedAttempts: 0, lockUntil: 0 };
    saveLockConfig(lockConfig);
    lockMode = "";
    lockDigits = "";
    lockError = "";
  } catch {
    // Cancelled or failed: the PIN keypad stays available as the fallback.
  } finally {
    biometricPromptActive = false;
    render();
  }
}

async function enableBiometric() {
  const biometric = nativeBiometric();
  if (!biometric) {
    showNoticeSnackbar("Este dispositivo no admite huella.", { kind: "error", renderNow: false });
    render();
    return;
  }
  try {
    const status = await biometric.isAvailable();
    if (!status?.available) {
      showNoticeSnackbar("Configura una huella en los ajustes del teléfono primero.", { kind: "error", renderNow: false });
      render();
      return;
    }
    await biometric.authenticate({ reason: "Confirma tu huella para activarla" });
    lockConfig = { ...lockConfig, biometric: true };
    saveLockConfig(lockConfig);
    showNoticeSnackbar("Huella activada. La usaremos para desbloquear.", { renderNow: false });
    render();
  } catch {
    showNoticeSnackbar("No se pudo activar la huella.", { kind: "error", renderNow: false });
    render();
  }
}

function disableBiometric() {
  lockConfig = { ...lockConfig, biometric: false };
  saveLockConfig(lockConfig);
  showNoticeSnackbar("Huella desactivada. Seguirás usando el PIN.", { renderNow: false });
  render();
}

function nativeWidgetBridge() {
  return window.Capacitor?.Plugins?.WidgetBridge || null;
}

function syncHomeWidget() {
  const bridge = nativeWidgetBridge();
  if (!bridge) {
    return;
  }
  const summary = budgetSummary();
  const periodLabel = `${formatShortDate(summary.window.start)} - ${formatShortDate(previousDay(summary.window.end))}`;
  // The whole point of the PIN lock is that someone holding the phone can't see your
  // money without it — showing the exact amount on the home screen widget defeats that
  // even while the app itself is locked, since widgets render outside the lock screen.
  const freeMoney = lockConfig.enabled ? "Bloqueado" : formatMoney(summary.freeRemaining);
  bridge.update({ freeMoney, periodLabel }).catch(() => {});
}

function handleHardwareBackButton() {
  // The onboarding "Atrás" button has no data-action (it's bound directly in
  // bindOnboardingFlowV2), so it never matches BACK_CLOSE_SELECTORS below. Without this,
  // the hardware back button skipped straight to exitApp() on any onboarding step,
  // silently discarding whatever the user had typed — the worst possible moment to lose
  // someone. On step 1 there's nothing to go back to within the flow, so fall through
  // to the normal exit-app behavior, same as Android's back button on any first screen.
  const onboardingModal = document.querySelector("[data-onboarding-step]");
  if (onboardingModal && Number(onboardingModal.dataset.onboardingStep || 1) > 1) {
    onboardingModal.querySelector("[data-onboarding-back]")?.click();
    return;
  }
  for (const selector of BACK_CLOSE_SELECTORS) {
    const button = document.querySelector(selector);
    if (button) {
      button.click();
      return;
    }
  }
  // The sidebar drawer markup stays in the DOM even when closed (CSS-only visibility),
  // so it can't use the same querySelector check as the sheets/modals above.
  if (menuOpen) {
    document.querySelector('[data-action="close-menu"]')?.click();
    return;
  }
  nativeApp()?.exitApp();
}

function bindHardwareBackButton() {
  const app = nativeApp();
  if (!app) {
    return;
  }
  app.addListener("backButton", handleHardwareBackButton);
}

// The PIN lock lives in its own device-local storage key and never syncs to the
// cloud: it protects this phone, not the account. Restoring on a new device
// should not carry a lock the user set somewhere else. (The LOCK_* constants are
// declared near the top of the file so this runs safely during module init.)
function loadLockConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCK_STORAGE_KEY) || "null");
    return {
      enabled: Boolean(parsed?.enabled),
      hash: parsed?.hash || "",
      salt: parsed?.salt || "",
      biometric: Boolean(parsed?.biometric),
      failedAttempts: Number(parsed?.failedAttempts || 0),
      lockUntil: Number(parsed?.lockUntil || 0)
    };
  } catch {
    return { enabled: false, hash: "", salt: "", biometric: false, failedAttempts: 0, lockUntil: 0 };
  }
}

function saveLockConfig(config) {
  try {
    localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(config));
  } catch {}
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function lockIsCoolingDown() {
  return Boolean(lockConfig.lockUntil) && Date.now() < lockConfig.lockUntil;
}

function scheduleLockCooldownClear() {
  clearTimeout(lockCooldownTimer);
  if (!lockIsCoolingDown()) {
    return;
  }
  lockCooldownTimer = window.setTimeout(() => {
    lockError = "";
    if (lockMode) {
      render();
    }
  }, Math.max(50, lockConfig.lockUntil - Date.now() + 50));
}

function bindAppLock() {
  const appPlugin = nativeApp();
  if (!appPlugin) {
    return;
  }
  appPlugin.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) {
      lastBackgroundAt = Date.now();
      return;
    }
    if (lockConfig.enabled && lockMode === "" && lastBackgroundAt) {
      lockMode = "unlock";
      lockDigits = "";
      lockError = "";
      biometricAutoTried = false;
      render();
    }
  });
  scheduleLockCooldownClear();
}

async function pushLockDigit(digit) {
  if ((lockMode === "unlock" || lockMode === "disable" || lockMode === "verify-change") && lockIsCoolingDown()) {
    return;
  }
  if (lockDigits.length >= LOCK_PIN_LENGTH) {
    return;
  }
  lockDigits += digit;
  lockError = "";
  if (lockDigits.length < LOCK_PIN_LENGTH) {
    render();
    return;
  }
  await resolveLockEntry();
}

async function resolveLockEntry() {
  const entry = lockDigits;
  if (lockMode === "set") {
    lockFirstEntry = entry;
    lockDigits = "";
    lockMode = "confirm";
    render();
    return;
  }
  if (lockMode === "confirm") {
    if (entry !== lockFirstEntry) {
      lockFirstEntry = "";
      lockDigits = "";
      lockMode = "set";
      lockError = "Los PIN no coinciden. Vuelve a crearlo.";
      render();
      return;
    }
    const salt = randomSalt();
    const hash = await hashPin(entry, salt);
    lockConfig = { enabled: true, hash, salt, biometric: false, failedAttempts: 0, lockUntil: 0 };
    saveLockConfig(lockConfig);
    syncHomeWidget();
    lockMode = "";
    lockDigits = "";
    lockFirstEntry = "";
    lockError = "";
    showNoticeSnackbar("Bloqueo activado. Pediremos tu PIN al abrir la app.", { renderNow: false });
    render();
    return;
  }

  const hash = await hashPin(entry, lockConfig.salt);
  if (hash === lockConfig.hash) {
    if (lockMode === "disable") {
      lockConfig = { enabled: false, hash: "", salt: "", biometric: false, failedAttempts: 0, lockUntil: 0 };
      saveLockConfig(lockConfig);
      syncHomeWidget();
      showNoticeSnackbar("Bloqueo desactivado.", { renderNow: false });
      lockMode = "";
      lockDigits = "";
      lockError = "";
      render();
      return;
    }
    if (lockMode === "verify-change") {
      // Current PIN confirmed — now walk through "set" → "confirm" same as first-time
      // setup. The new hash/salt only get saved once that new PIN is confirmed
      // (see the "confirm" branch above), so bailing out here via Cancelar leaves the
      // old PIN in place.
      lockConfig = { ...lockConfig, failedAttempts: 0, lockUntil: 0 };
      saveLockConfig(lockConfig);
      lockMode = "set";
      lockDigits = "";
      lockError = "";
      render();
      return;
    }
    lockConfig = { ...lockConfig, failedAttempts: 0, lockUntil: 0 };
    saveLockConfig(lockConfig);
    lockMode = "";
    lockDigits = "";
    lockError = "";
    render();
    return;
  }

  const failedAttempts = (lockConfig.failedAttempts || 0) + 1;
  const lockUntil = failedAttempts >= LOCK_MAX_ATTEMPTS ? Date.now() + LOCK_COOLDOWN_MS : 0;
  lockConfig = { ...lockConfig, failedAttempts, lockUntil };
  saveLockConfig(lockConfig);
  lockDigits = "";
  lockError = lockUntil ? "Demasiados intentos. Espera 30 segundos." : "PIN incorrecto. Intenta de nuevo.";
  scheduleLockCooldownClear();
  render();
}

function renderLockScreen() {
  const titles = {
    unlock: "Ingresa tu PIN",
    set: "Crea un PIN de 4 dígitos",
    confirm: "Confirma tu PIN",
    disable: "Ingresa tu PIN",
    "verify-change": "Ingresa tu PIN actual"
  };
  const subtitles = {
    unlock: "Evita que alguien abra la app sin tu PIN.",
    set: "Lo pediremos cada vez que abras la app.",
    confirm: "Escríbelo otra vez para confirmar.",
    disable: "Confirma tu PIN para desactivar el bloqueo.",
    "verify-change": "Confirma tu PIN actual para cambiarlo."
  };
  const cooling = (lockMode === "unlock" || lockMode === "disable" || lockMode === "verify-change") && lockIsCoolingDown();
  const dots = Array.from({ length: LOCK_PIN_LENGTH }, (_, index) => `<span class="lock-dot ${index < lockDigits.length ? "filled" : ""}"></span>`).join("");
  const canCancel = lockMode === "set" || lockMode === "confirm" || lockMode === "disable" || lockMode === "verify-change";
  const digitKey = (value) => `<button class="lock-key" type="button" data-lock-digit="${value}" ${cooling ? "disabled" : ""}>${value}</button>`;
  return `
    <div class="lock-screen" role="dialog" aria-modal="true" aria-label="${escapeHtml(titles[lockMode] || titles.unlock)}">
      <section class="lock-card">
        <span class="lock-icon" aria-hidden="true">${renderIcon("lock")}</span>
        <h2>${escapeHtml(titles[lockMode] || titles.unlock)}</h2>
        <p>${escapeHtml(subtitles[lockMode] || "")}</p>
        <div class="lock-dots ${lockError ? "shake" : ""}">${dots}</div>
        ${lockError ? `<p class="lock-error" role="alert">${escapeHtml(lockError)}</p>` : ""}
        <div class="lock-keypad">
          ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digitKey).join("")}
          ${
            canCancel
              ? `<button class="lock-key lock-key-text" type="button" data-lock-cancel>Cancelar</button>`
              : `<span class="lock-key lock-key-empty" aria-hidden="true"></span>`
          }
          ${digitKey("0")}
          <button class="lock-key lock-key-text" type="button" data-lock-backspace ${cooling ? "disabled" : ""} aria-label="Borrar">&#9003;</button>
        </div>
        ${
          lockMode === "unlock" && lockConfig.biometric
            ? `<button class="btn ghost lock-biometric-btn" type="button" data-lock-biometric ${cooling ? "disabled" : ""}>Usar huella</button>`
            : ""
        }
      </section>
    </div>
  `;
}

async function exportFile(filename, content, mimeType, successMessage) {
  const filesystem = nativeFilesystem();
  const share = nativeShare();
  if (filesystem && share) {
    try {
      const written = await filesystem.writeFile({
        path: filename,
        data: content,
        directory: "CACHE",
        encoding: "utf8"
      });
      try {
        await share.share({ title: filename, url: written.uri });
      } catch {}
      showNoticeSnackbar(successMessage, { duration: 3500, renderNow: false });
      return;
    } catch {
      // Native write failed (e.g. running outside Capacitor); fall back to a browser download below.
    }
  }
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNoticeSnackbar(successMessage, { duration: 3500, renderNow: false });
}

function downloadPeriodReport() {
  const summary = budgetSummary();
  const reportText = currentPeriodReportText();
  exportFile(`reporte-periodo-${summary.window.start}.txt`, reportText, "text/plain", "Reporte listo.");
}

function movementsCsvRows() {
  const expenseRows = (state.transactions || []).map((transaction) => ({
    date: transaction.date,
    kind: "Gasto",
    who: transaction.merchant,
    category: categoryName(transaction.category || FREE_CATEGORY_ID),
    amount: -Math.abs(Number(transaction.amount || 0)),
    paidWith: transaction.source === "cash" ? "Efectivo" : "Cuenta",
    note: transaction.description || ""
  }));
  const incomeRows = (state.budgetExtras || []).map((extra) => ({
    date: extra.date,
    kind: "Ingreso",
    who: extra.source,
    category: "",
    amount: Math.abs(Number(extra.amount || 0)),
    paidWith: extra.location === "cash" ? "Efectivo" : "Cuenta",
    note: ""
  }));
  return [...expenseRows, ...incomeRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function buildMovementsCsv() {
  const header = ["Fecha", "Tipo", "Comercio u origen", "Categoría", "Monto", "Pagado con", "Nota"];
  const rows = movementsCsvRows().map((row) => [row.date, row.kind, row.who, row.category, row.amount, row.paidWith, row.note]);
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

function downloadMovementsCsv() {
  if (!(state.transactions || []).length && !(state.budgetExtras || []).length) {
    showNoticeSnackbar("Aún no tienes movimientos para exportar.", { duration: 3500, renderNow: false });
    return;
  }
  const csv = "﻿" + buildMovementsCsv();
  exportFile(`movimientos-${todayKey()}.csv`, csv, "text/csv", "Movimientos listos.");
}

function periodClosureForWindow(window) {
  return (state.periodClosures || []).find((closure) => closure.windowStart === window.start && closure.windowEnd === window.end);
}

function removeBudgetJob(id) {
  state.budgetJobs = state.budgetJobs.filter((job) => job.id !== id);
  state.merchantRules = (state.merchantRules || []).filter((rule) => rule.category !== id);
  state.transactions.forEach((transaction) => {
    if (transaction.category === id) {
      transaction.category = "";
      transaction.labeled = false;
    }
  });
  state.lastAlert = "Categoría eliminada. Sus gastos vuelven a revisión.";
}

function removeMerchantRule(id) {
  const rule = state.merchantRules.find((item) => item.id === id);
  state.merchantRules = state.merchantRules.filter((item) => item.id !== id);
  state.lastAlert = rule ? `Quite la regla de ${rule.merchant}.` : "Regla quitada.";
}

function removeTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  state.transactions = state.transactions.filter((item) => item.id !== id);
  if (transaction && state.liquidity?.initialized) {
    adjustLiquidity(transaction.source, Number(transaction.amount || 0), "refund");
  }
  if (transaction?.calendarEventId) {
    reopenCalendarEvent(transaction.calendarEventId);
  }
  state.lastAlert = transaction
    ? `${transaction.merchant} eliminado. La categoría se recalculó.`
    : "Gasto eliminado.";
  if (snackbar?.transactionId === id) {
    clearSnackbar({ renderNow: false });
  }
}

function shouldClearTemplateBudgetOnPlanSave() {
  return state.meta?.budgetPreset !== "student" && isTemplateBudgetJobs(state.budgetJobs);
}

function removeBudgetExtra(id) {
  const extra = state.budgetExtras.find((item) => item.id === id);
  state.budgetExtras = state.budgetExtras.filter((item) => item.id !== id);
  reverseBudgetExtra(extra);
  state.lastAlert = extra ? `${extra.source} ya no suma al presupuesto.` : "Dinero extra eliminado.";
}

function updateBudgetExtra(extra, next) {
  const window = budgetSummary().window;
  const oldAppliesNow = dateIsInWindow(extra.date, window);
  const nextAppliesNow = dateIsInWindow(next.date, window);
  const oldLocation = normalizeLocation(extra.location);
  const nextLocation = normalizeLocation(next.location);
  const liquidityDeltas = { account: 0, cash: 0 };

  if (oldAppliesNow) {
    liquidityDeltas[oldLocation] -= Number(extra.amount || 0);
  }
  if (nextAppliesNow) {
    liquidityDeltas[nextLocation] += Number(next.amount || 0);
  }

  if (state.liquidity?.initialized) {
    Object.entries(liquidityDeltas).forEach(([location, delta]) => {
      if (delta) {
        adjustLiquidity(location, delta, "edit-extra");
      }
    });
  } else if (nextAppliesNow) {
    adjustLiquidity(nextLocation, Number(next.amount || 0), "extra");
  }

  if (extra.allocation?.savingsJobId && Number(extra.allocation.savingsAmount || 0) > 0) {
    reduceSavingsAllocation(extra.allocation.savingsJobId, Number(extra.allocation.savingsAmount || 0));
  }

  const now = new Date().toISOString();
  const savingsAmount = nextAppliesNow ? Math.round(Number(next.amount || 0) * Number(next.savingsPercent || 0) / 100) : 0;
  const savingsJob = nextAppliesNow ? applySavingsAllocation(savingsAmount, now) : null;
  extra.source = next.source;
  extra.amount = next.amount;
  extra.date = next.date;
  extra.location = nextLocation;
  extra.allocation = {
    savingsPercent: next.savingsPercent,
    savingsAmount,
    freeAmount: nextAppliesNow ? Number(next.amount || 0) - savingsAmount : Number(next.amount || 0),
    savingsJobId: savingsJob?.id || ""
  };
  extra.updated_at = now;
}

function reverseBudgetExtra(extra) {
  if (!extra) {
    return;
  }
  if (dateIsInWindow(extra.date, budgetSummary().window) && state.liquidity?.initialized) {
    adjustLiquidity(extra.location, -Number(extra.amount || 0), "remove-extra");
  }
  if (extra.allocation?.savingsJobId && Number(extra.allocation.savingsAmount || 0) > 0) {
    reduceSavingsAllocation(extra.allocation.savingsJobId, Number(extra.allocation.savingsAmount || 0));
  }
}

function dateIsInWindow(dateValue, window) {
  const date = String(dateValue || "").slice(0, 10);
  return date >= window.start && date < window.end;
}

function cancelCooldown(id) {
  state.cooldowns = state.cooldowns.filter((cooldown) => cooldown.id !== id);
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Cancelaste una compra después de pausarla."
  });
  state.lastAlert = "Compra cancelada. Ese ahorro ya cuenta.";
}

function unlockCooldown(id) {
  const cooldown = state.cooldowns.find((item) => item.id === id);
  if (!cooldown || new Date(cooldown.unlockAt).getTime() > Date.now()) {
    return;
  }
  const available = liquiditySummary()[normalizeLocation(cooldown.source)];
  if (Number(cooldown.amount || 0) > available) {
    showNoticeSnackbar(`${locationLabel(cooldown.source)} solo tiene ${formatMoney(available)} disponible. Actualiza tus datos antes de registrarla.`, { kind: "error", renderNow: false });
    return;
  }
  addTransaction({
    merchant: cooldown.merchant,
    description: cooldown.description || "",
    amount: cooldown.amount,
    category: cooldown.category,
    budgeted: false,
    source: cooldown.source
  });
  state.cooldowns = state.cooldowns.filter((item) => item.id !== id);
  state.lastAlert = createSpendAlert(cooldown.category);
}

function addTransaction({ merchant, description = "", amount, category, budgeted, oneOff = false, source = "account", calendarEventId = "" }) {
  const location = normalizeLocation(source);
  const now = new Date().toISOString();
  adjustLiquidity(location, -Number(amount || 0), "expense");
  const transaction = {
    id: uid("tx"),
    date: todayKey(),
    merchant,
    description: cleanText(description, ""),
    amount,
    category,
    labeled: Boolean(category),
    budgeted,
    oneOff,
    source: location,
    calendarEventId,
    updated_at: now
  };
  state.transactions.push(transaction);
  rememberMerchantRule(transaction);
  return transaction;
}

function savingsAllocationTarget() {
  const job = findSavingsJob();
  if (!job) {
    return { job: null, label: "Ahorro", createName: "Ahorro" };
  }
  if (job.cadence === "period") {
    return { job, label: job.name, createName: job.name };
  }
  return { job: null, label: `${job.name} extra`, createName: `${job.name} extra` };
}

function findSavingsJob() {
  const matches = state.budgetJobs.filter(isSavingsJob);
  return matches.find((job) => job.cadence === "period") || matches[0];
}

function applySavingsAllocation(amount, updatedAt) {
  if (amount <= 0) {
    return null;
  }

  const target = savingsAllocationTarget();
  if (target.job) {
    target.job.amount = Number(target.job.amount || 0) + amount;
    target.job.updated_at = updatedAt;
    return target.job;
  }

  const job = {
    id: uniqueCategoryId(target.createName),
    name: target.createName,
    amount,
    cadence: "period",
    updated_at: updatedAt
  };
  state.budgetJobs.push(job);
  return job;
}

// Mirrors savingsAllocationTarget's rule, and for the same reason: a weekly/monthly
// category multiplies its amount across the period (see budgetAmountForJob), so adding a
// one-off set-aside straight onto job.amount would reserve several times what was asked
// for. Only a "period" category can absorb it directly; anything else gets its own
// exact-amount reserve beside it.
function setAsideTarget(name) {
  const wanted = String(name).trim().toLowerCase();
  const match = state.budgetJobs.find((job) => String(job.name || "").trim().toLowerCase() === wanted);
  if (!match) {
    return { job: null, createName: name };
  }
  if (match.cadence === "period") {
    return { job: match, createName: match.name };
  }
  return { job: null, createName: `${name} extra` };
}

function handleSetAsideSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = cleanText(data.get("name"), "Apartado");
  const amount = numberFrom(data.get("amount"));

  const failWith = (message) => {
    state.lastAlert = message;
    showNoticeSnackbar(message, { kind: "error", renderNow: false });
    saveState();
    render();
  };

  if (amount <= 0) {
    failWith("Escribe cuánto quieres apartar.");
    return;
  }

  // Same guard as handleBudgetSubmit: freeRemaining is the number shown on screen as
  // "Libre", so it's the one the user compares against before apartar.
  const summary = budgetSummary();
  if (amount > summary.freeRemaining) {
    failWith(`Solo tienes ${formatMoney(summary.freeRemaining)} libres para apartar.`);
    return;
  }

  const target = setAsideTarget(name);
  if (!target.job && state.budgetJobs.length >= 10) {
    failWith("Mantengamos máximo 10 categorías para que el plan siga claro.");
    return;
  }

  const now = new Date().toISOString();
  if (target.job) {
    target.job.amount = Number(target.job.amount || 0) + amount;
    target.job.updated_at = now;
  } else {
    state.budgetJobs.push({
      id: uniqueCategoryId(target.createName),
      name: target.createName,
      amount,
      cadence: "period",
      updated_at: now
    });
  }

  planSheet = "";
  state.lastAlert = `Apartaste ${formatMoney(amount)} para ${target.createName}.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  saveState();
  render();
}

function reduceSavingsAllocation(jobId, amount) {
  const job = state.budgetJobs.find((item) => item.id === jobId);
  if (!job) {
    return;
  }
  job.amount = Math.max(0, Number(job.amount || 0) - amount);
  job.updated_at = new Date().toISOString();
  if (job.cadence === "period" && job.amount === 0 && /ahorro/i.test(job.name)) {
    state.budgetJobs = state.budgetJobs.filter((item) => item.id !== jobId);
  }
}

// Speaks a message to screen readers through the permanent live regions in
// index.html. Cleared first and set on the next tick so repeating the same message
// ("Gasto registrado") is announced again instead of being ignored as unchanged.
function announce(message, kind = "") {
  const region = document.getElementById(kind === "error" ? "live-alert" : "live-status");
  if (!region || !message) {
    return;
  }
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}

function showUndoSnackbar(transactionId) {
  clearTimeout(snackbarTimer);
  snackbar = {
    message: "Gasto registrado. ¿Deshacer?",
    action: "undo",
    kind: "",
    transactionId
  };
  announce(snackbar.message);
  // 8s (not the original 5s) so there's enough time to read the message and react,
  // not just for users who need it — nobody benefits from a confirmation that vanishes
  // before they've finished reading it.
  snackbarTimer = setTimeout(() => {
    clearSnackbar();
  }, 8000);
}

function showNoticeSnackbar(message, options = {}) {
  const { kind = "", duration = 7000, renderNow = true } = options;
  clearTimeout(snackbarTimer);
  snackbar = {
    message,
    action: "",
    kind,
    transactionId: ""
  };
  announce(message, kind);
  snackbarTimer = setTimeout(() => {
    clearSnackbar();
  }, duration);
  if (renderNow) {
    paintSnackbar();
  }
}

function clearSnackbar(options = {}) {
  const { renderNow = true } = options;
  clearTimeout(snackbarTimer);
  snackbar = null;
  if (renderNow) {
    paintSnackbar();
  }
}

// Toca solo el nodo del snackbar en vez de reconstruir la app. Antes mostrar u ocultar
// un aviso llamaba a render(), y eso borraba cualquier formulario abierto. El caso peor
// era el aviso de validacion: "Efectivo solo tiene $X disponible" limpiaba el gasto que
// el usuario acababa de escribir, justo cuando necesitaba corregirlo. El temporizador
// de 8 segundos del "Deshacer" hacia lo mismo si el usuario ya estaba registrando el
// siguiente gasto. Mismo motivo por el que bindPasswordToggles toca el DOM directo.
function paintSnackbar() {
  document.querySelector(".snackbar")?.remove();
  const markup = renderSnackbar();
  if (!markup) {
    return;
  }
  app.insertAdjacentHTML("beforeend", markup);
  // bindEvents() enlaza elemento por elemento, no por delegacion: volver a llamarlo
  // aqui duplicaria los listeners de todo lo que ya esta en pantalla.
  app.querySelector(".snackbar [data-action]")?.addEventListener("click", handleAction);
}

function calculatePlan() {
  return calculateFinancePlan(state, todayKey());
}

// Cached because a single Plan-view render calls budgetSummary() 15-25 times
// (calculatePlan, periodPrediction and freeImpactForPrediction all call it, and each
// category/prediction card calls it again), and getBudgetSummary() rescans every
// transaction from scratch on each call. Invalidated at the top of saveState() (so any
// mutation is visible to the very next read, including syncHomeWidget() which runs
// inside saveState() before render()) and at the top of render() (covers the
// selfManagedAction paths — sign-out, delete-account — that skip saveState() but still
// render()). Confirmed safe: no code path reads budgetSummary(), mutates state, then
// reads it again expecting the post-mutation value within the same synchronous call.
function budgetSummary() {
  if (!cachedBudgetSummary) {
    cachedBudgetSummary = getBudgetSummary(state, todayKey());
  }
  return cachedBudgetSummary;
}

function periodPrediction() {
  return getPeriodPrediction(state, todayKey());
}

function calendarEventsSorted() {
  return (state.calendarEvents || [])
    .slice()
    .sort((a, b) => {
      const statusDelta = Number(a.spent) - Number(b.spent);
      return statusDelta || String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title));
    });
}

function calendarEstimateForDays(days) {
  const start = todayKey();
  const endDate = new Date(`${start}T12:00:00`);
  endDate.setDate(endDate.getDate() + Number(days || 0));
  const end = todayKey(endDate);
  return (state.calendarEvents || [])
    .filter((event) => !event.spent && event.date >= start && event.date <= end)
    .reduce((sum, event) => sum + Number(event.amount || 0), 0);
}

function scheduleDailyReminder() {
  clearTimeout(dailyReminderTimer);
  const reminder = normalizeDailyReminder(state.dailyReminder);
  if (nativeLocalNotifications()) {
    scheduleNativeDailyReminder(reminder);
    return;
  }
  if (!reminder.enabled) {
    return;
  }

  const delay = Math.max(1_000, nextReminderDate(reminder.time).getTime() - Date.now());
  dailyReminderTimer = window.setTimeout(handleDailyReminderDue, delay);
}

function nextReminderDate(timeValue) {
  const [hours, minutes] = normalizeReminderTime(timeValue).split(":").map(Number);
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function handleDailyReminderDue() {
  const reminder = normalizeDailyReminder(state.dailyReminder);
  if (!reminder.enabled) {
    return;
  }

  const today = todayKey();
  if (reminder.lastShownDate !== today) {
    showDailyReminderNotification();
    state.dailyReminder = {
      ...reminder,
      lastShownDate: today,
      updated_at: new Date().toISOString()
    };
    saveState({ touch: false });
  } else {
    scheduleDailyReminder();
  }
}

function notificationPermissionStatus() {
  if (nativeLocalNotifications()) {
    return nativeNotificationPermission || "default";
  }
  if (!("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

async function requestNotificationPermission() {
  const localNotifications = nativeLocalNotifications();
  if (localNotifications) {
    try {
      const current = await localNotifications.checkPermissions();
      const currentStatus = normalizeNativeNotificationPermission(current);
      if (currentStatus === "granted") {
        nativeNotificationPermission = currentStatus;
        return currentStatus;
      }
      const requested = await localNotifications.requestPermissions();
      nativeNotificationPermission = normalizeNativeNotificationPermission(requested);
      return nativeNotificationPermission;
    } catch {
      nativeNotificationPermission = "unsupported";
      return "unsupported";
    }
  }
  if (!("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "unsupported";
  }
}

async function showDailyReminderNotification(options = {}) {
  const permission = notificationPermissionStatus();
  if (permission !== "granted") {
    return false;
  }

  const title = options.test ? "Prueba de recordatorio" : "Revisión de gastos";
  const body = "Quieres registrar tus gastos de hoy?";
  const data = { url: `${selfLocationOrigin()}#${QUICK_EXPENSE_HASH}` };
  const localNotifications = nativeLocalNotifications();
  if (localNotifications) {
    try {
      await localNotifications.schedule({
        notifications: [
          {
            id: options.test ? TEST_REMINDER_NOTIFICATION_ID : DAILY_REMINDER_NOTIFICATION_ID,
            title,
            body,
            schedule: { at: new Date(Date.now() + 1200) },
            extra: { route: QUICK_EXPENSE_HASH }
          }
        ]
      });
      return true;
    } catch {
      return false;
    }
  }

  try {
    const registration = navigator.serviceWorker ? await navigator.serviceWorker.ready : null;
    if (registration?.showNotification) {
      await registration.showNotification(title, {
        body,
        tag: "daily-expense-reminder",
        renotify: false,
        data,
        icon: "assets/icon-192.png",
        badge: "assets/icon-192.png"
      });
      return true;
    }
  } catch {
    // Fall back to the page Notification API below.
  }

  try {
    const notification = new Notification(title, {
      body,
      tag: "daily-expense-reminder",
      data,
      icon: "assets/icon-192.png"
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = QUICK_EXPENSE_HASH;
    };
    return true;
  } catch {}
  return false;
}

function nativeLocalNotifications() {
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

function normalizeNativeNotificationPermission(permission) {
  const display = permission?.display || "";
  if (display === "granted") {
    return "granted";
  }
  if (display === "denied") {
    return "denied";
  }
  return "default";
}

async function refreshNativeNotificationPermission(options = {}) {
  const { renderNow = false } = options;
  const localNotifications = nativeLocalNotifications();
  if (!localNotifications) {
    return notificationPermissionStatus();
  }
  try {
    nativeNotificationPermission = normalizeNativeNotificationPermission(await localNotifications.checkPermissions());
  } catch {
    nativeNotificationPermission = "unsupported";
  }
  if (renderNow) {
    render();
  }
  return nativeNotificationPermission;
}

function initializeNativeNotificationActions() {
  const localNotifications = nativeLocalNotifications();
  if (!localNotifications?.addListener) {
    return;
  }
  try {
    const listener = localNotifications.addListener("localNotificationActionPerformed", () => {
      window.focus?.();
      window.location.hash = QUICK_EXPENSE_HASH;
    });
    if (listener?.catch) {
      listener.catch(() => {});
    }
  } catch {}
}

function nativeCapacitorApp() {
  return window.Capacitor?.Plugins?.App || null;
}

function routeIfWidgetQuickAddUrl(url) {
  if (!url) {
    return;
  }
  try {
    if (new URL(url).host === WIDGET_QUICK_ADD_HOST) {
      window.location.hash = QUICK_EXPENSE_HASH;
    }
  } catch {}
}

// The widget's "+" button opens the app via a finanzasconductuales://registrar-gasto
// deep link (see AndroidManifest.xml + FreeMoneyWidgetProvider) instead of just the
// normal launcher intent. @capacitor/app delivers that URL through appUrlOpen for a
// warm start (app already running) and buffers it until this listener is registered
// for a cold start — getLaunchUrl() is checked too as a belt-and-suspenders fallback
// in case a Capacitor version ever fails to replay the buffered event.
function initializeWidgetQuickAddDeepLink() {
  const capacitorApp = nativeCapacitorApp();
  if (!capacitorApp) {
    return;
  }
  try {
    const listener = capacitorApp.addListener("appUrlOpen", ({ url }) => routeIfWidgetQuickAddUrl(url));
    if (listener?.catch) {
      listener.catch(() => {});
    }
  } catch {}
  try {
    capacitorApp
      .getLaunchUrl?.()
      ?.then((result) => routeIfWidgetQuickAddUrl(result?.url))
      ?.catch(() => {});
  } catch {}
}

async function scheduleNativeDailyReminder(reminder = normalizeDailyReminder(state.dailyReminder)) {
  const localNotifications = nativeLocalNotifications();
  if (!localNotifications) {
    return false;
  }
  try {
    await localNotifications.cancel({ notifications: [{ id: DAILY_REMINDER_NOTIFICATION_ID }] });
    if (!reminder.enabled || notificationPermissionStatus() !== "granted") {
      return false;
    }
    await localNotifications.schedule({
      notifications: [
        {
          id: DAILY_REMINDER_NOTIFICATION_ID,
          title: "Revisión de gastos",
          body: "Quieres registrar tus gastos de hoy?",
          schedule: {
            at: nextReminderDate(reminder.time),
            repeats: true,
            every: "day"
          },
          extra: { route: QUICK_EXPENSE_HASH }
        }
      ]
    });
    return true;
  } catch {
    return false;
  }
}

function selfLocationOrigin() {
  return `${window.location.origin}${window.location.pathname}`;
}

function notificationStatusLabel(permission) {
  const labels = {
    granted: "Permiso activo",
    denied: "Bloqueado",
    default: "Permiso pendiente",
    unsupported: "No soportado"
  };
  return labels[permission] || labels.default;
}

function reminderSupportNote(permission) {
  if (nativeLocalNotifications()) {
    if (permission === "granted") {
      return "Android mostrará el recordatorio aunque la app no este abierta. Tocar la notificación abre registrar gasto.";
    }
    if (permission === "denied") {
      return "Android bloqueó las notificaciones para esta app. Cámbialo en ajustes del sistema.";
    }
    if (permission === "unsupported") {
      return "El plugin nativo de notificaciones no está disponible en esta instalación.";
    }
    return "Permite notificaciones para activar el recordatorio diario en Android.";
  }
  if (permission === "granted") {
    return "El recordatorio queda programado localmente en este dispositivo. Si el sistema cierra la app por completo, se reprograma al volver a abrirla.";
  }
  if (permission === "denied") {
    return "El horario queda guardado, pero el navegador no mostrará avisos hasta que cambies el permiso del sitio.";
  }
  if (permission === "unsupported") {
    return "Este navegador no expone notificaciones web para esta app.";
  }
  return "Activa el permiso para que el aviso pueda aparecer fuera de la pantalla actual.";
}

function liquiditySummary(summary = budgetSummary()) {
  const liquidity = normalizeLiquidity(state.liquidity);
  if (!liquidity.initialized) {
    return {
      account: summary.freeRemaining,
      cash: 0,
      total: summary.freeRemaining,
      initialized: false
    };
  }
  return {
    ...liquidity,
    total: liquidity.account + liquidity.cash
  };
}

// Runs before anything else reads budgetSummary(). The decision itself (is this
// period's fixed income due? was it already logged or rejected?) is the pure
// resolvePeriodIncome() in finance-core.js; this only applies its result to `state`.
function ensurePeriodIncomeApplication() {
  const result = resolvePeriodIncome(state, todayKey());
  state.periodIncomeStatus = result.periodIncomeStatus;
  state.periodIncomeApplied = result.periodIncomeApplied;
  if (result.deposit > 0) {
    adjustLiquidity("account", result.deposit, "ingreso-periodico");
  }
}

function adjustLiquidity(location, delta, reason) {
  const key = normalizeLocation(location);
  const amount = Number(delta || 0);
  if (!state.liquidity?.initialized) {
    const total = budgetSummary().freeRemaining;
    state.liquidity =
      reason === "expense" && key === "cash"
        ? { account: Math.max(0, total + amount), cash: Math.abs(amount), initialized: true }
        : { account: total, cash: 0, initialized: true };
  }

  const liquidity = normalizeLiquidity(state.liquidity);
  liquidity[key] = Math.max(0, liquidity[key] + amount);
  liquidity.initialized = true;
  liquidity.updated_at = new Date().toISOString();
  state.liquidity = liquidity;
}

function budgetExtrasForSummary(summary = budgetSummary()) {
  return (state.budgetExtras || []).filter((extra) => {
    const date = String(extra.date || "").slice(0, 10);
    return date >= summary.window.start && date < summary.window.end;
  });
}

function transactionsForSummary(summary = budgetSummary()) {
  return (state.transactions || []).filter((transaction) => {
    const date = String(transaction.date || "").slice(0, 10);
    return date >= summary.window.start && date < summary.window.end;
  });
}

function movementsForSummary(summary = budgetSummary()) {
  const expenses = transactionsForSummary(summary).map((transaction) => ({
    id: transaction.id,
    kind: "expense",
    date: transaction.date,
    amount: transaction.amount,
    updated_at: transaction.updated_at || transaction.createdAt || transaction.date,
    transaction
  }));
  const income = budgetExtrasForSummary(summary).map((extra) => ({
    id: extra.id,
    kind: "income",
    date: extra.date,
    amount: extra.amount,
    updated_at: extra.updated_at || extra.date,
    extra
  }));
  return [...expenses, ...income];
}

function categoryStatus() {
  const summary = budgetSummary();
  const freeRatio = summary.freeBudget ? (summary.freeSpent / summary.freeBudget) * 100 : summary.freeSpent > 0 ? 120 : 0;
  return [
    ...getCategoryStatus(state, todayKey()),
    {
      id: FREE_CATEGORY_ID,
      name: "Libre / sin clasificar",
      budget: summary.freeBudget,
      spent: summary.freeSpent,
      ratio: freeRatio,
      band: freeRatio > 90 ? "danger" : freeRatio > 65 ? "warning" : "good"
    }
  ];
}

function categoryName(categoryId) {
  if (categoryId === FREE_CATEGORY_ID) {
    return "Libre / sin clasificar";
  }
  return state.budgetJobs.find((job) => job.id === categoryId)?.name || "Sin categoría";
}

function activeMerchantRules() {
  const validCategories = new Set(state.budgetJobs.map((job) => job.id));
  return (state.merchantRules || [])
    .filter((rule) => validCategories.has(rule.category))
    .slice()
    .sort((a, b) => String(b.lastUsedAt || b.updated_at || "").localeCompare(String(a.lastUsedAt || a.updated_at || "")) || Number(b.count || 0) - Number(a.count || 0));
}

function findMerchantRule(merchant) {
  const key = merchantKey(merchant);
  if (key.length < 3) {
    return null;
  }

  const rules = activeMerchantRules();
  return rules.find((rule) => rule.key === key)
    || rules.find((rule) => merchantRuleMatches(key, rule.key))
    || null;
}

function rememberMerchantRule(transaction) {
  const key = merchantKey(transaction?.merchant);
  const category = transaction?.category || "";
  if (key.length < 3 || isPlaceholderMerchant(key) || !category || category === FREE_CATEGORY_ID || !state.budgetJobs.some((job) => job.id === category)) {
    return;
  }

  const now = new Date().toISOString();
  const existing = (state.merchantRules || []).find((rule) => rule.key === key);
  const merchant = cleanText(transaction.merchant, "Comercio");
  const next = {
    id: existing?.id || uid("rule"),
    merchant,
    key,
    category,
    source: normalizeLocation(transaction.source),
    count: Number(existing?.count || 0) + 1,
    lastUsedAt: now,
    updated_at: now
  };

  state.merchantRules = state.merchantRules || [];
  if (existing) {
    Object.assign(existing, next);
  } else {
    state.merchantRules.unshift(next);
  }
  state.merchantRules = state.merchantRules.slice(0, 30);
}

function spendByCategory() {
  return getSpendByCategory(state, todayKey());
}

function monthlyLabeledSpend() {
  return getMonthlyLabeledSpend(state, todayKey());
}

function futureFreedom(plan) {
  const monthlyReturn = plan.savings * 0.006;
  const hours = monthlyReturn / Math.max(1, getMonthlyIncome(state.profile) / 160);
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} ${minutes === 1 ? "minuto" : "minutos"} libres/mes`;
  }
  return `${hours.toFixed(1)} horas libres/mes`;
}

function suggestedSavingsMoment() {
  const payday = Number(state.profile.payday || 0);
  return payday > 0 ? `Día ${clamp(payday + 1, 1, 28)} del periodo` : "Al recibir el presupuesto";
}

function createSpendAlert(categoryId) {
  const category = categoryStatus().find((item) => item.id === categoryId) || categoryStatus()[0];
  if (!category) {
    return "Gasto registrado.";
  }
  if (category.ratio >= 100) {
    return `${category.name} supero su trabajo. Una decisión no define tu capacidad; reasigna antes del próximo gasto.`;
  }
  if (category.ratio >= 75) {
    return `${category.name} está al ${Math.round(category.ratio)}%. Quedan ${formatMoney(Math.max(0, category.budget - category.spent))}.`;
  }
  return `${category.name} va al ${Math.round(category.ratio)}%. El límite sigue visible antes de comprar.`;
}

function uniqueCategoryId(name) {
  const base = cleanText(name, "categoría")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  let candidate = base || uid("cat");
  let counter = 2;
  while (state.budgetJobs.some((job) => job.id === candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function viewFromHash(fallback) {
  const rawHash = window.location.hash.replace("#", "");
  const aliases = {
    inicio: "today",
    hoy: "today",
    plan: "budget",
    presupuesto: "budget",
    ahorro: "savings",
    calendario: "calendar",
    eventos: "calendar",
    cierre: "periodClose",
    "cierre-periodo": "periodClose",
    movimientos: "movements",
    historial: "movements",
    datos: "profile",
    cuenta: "profile",
    profile: "profile"
  };
  const view = aliases[rawHash] || rawHash;
  return APP_VIEWS.has(view) ? view : fallback;
}

function activateView(view) {
  if (!APP_VIEWS.has(view)) {
    return;
  }
  state.activeView = view;
  menuOpen = false;
  const nextHash = hashFromView(view);
  if (window.location.hash.replace("#", "") !== nextHash) {
    window.location.hash = nextHash;
  }
}

function hashFromView(view) {
  const hashes = {
    today: "inicio",
    budget: "plan",
    periodClose: "cierre",
    savings: "ahorro",
    calendar: "calendario",
    movements: "movimientos",
    profile: "datos"
  };
  return hashes[view] || view;
}

function bindMoneyInputs(root = document) {
  root?.querySelectorAll('input[type="number"][step="1000"], input[data-money-input="true"]').forEach((input) => {
    if (input.dataset.moneyInputBound === "true") {
      return;
    }
    input.dataset.moneyInputBound = "true";
    input.dataset.moneyInput = "true";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    try {
      input.type = "text";
    } catch {
      // Some older browsers do not allow changing input type after creation.
    }
    input.value = formatMoneyInputValue(input.value);
    input.addEventListener("input", () => formatMoneyInput(input));
  });
}

// Toggle directo sobre el DOM, sin pasar por handleAction()/render(): un re-render
// completo regenera el <input> desde HTML (que nunca lleva `value=`, es un campo no
// controlado) y borraria lo que el usuario ya escribio en la contraseña.
function bindPasswordToggles(root = document) {
  root?.querySelectorAll("[data-password-toggle]").forEach((button) => {
    if (button.dataset.passwordToggleBound === "true") {
      return;
    }
    button.dataset.passwordToggleBound = "true";
    button.addEventListener("click", () => {
      const input = button.closest(".password-field")?.querySelector("[data-password-input]");
      if (!input) {
        return;
      }
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.innerHTML = renderIcon(showing ? "eye" : "eye-off");
      button.setAttribute("aria-pressed", showing ? "false" : "true");
      button.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
    });
  });
}

function formatMoneyInput(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const digitCountBeforeCursor = input.value.slice(0, cursor).replace(/\D/g, "").length;
  const formatted = formatMoneyInputValue(input.value);
  input.value = formatted;
  const nextCursor = positionAfterDigitCount(formatted, digitCountBeforeCursor);
  try {
    input.setSelectionRange(nextCursor, nextCursor);
  } catch {
    input.selectionStart = nextCursor;
    input.selectionEnd = nextCursor;
  }
}

function formatMoneyInputValue(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, MONEY_INPUT_MAX_DIGITS);
  if (!digits) {
    return "";
  }
  return PLAIN_NUMBER_FORMATTER.format(Number(digits));
}

function positionAfterDigitCount(value, digitCount) {
  if (digitCount <= 0) {
    return 0;
  }

  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) {
      seen += 1;
    }
    if (seen >= digitCount) {
      return index + 1;
    }
  }
  return value.length;
}

// Antes esta funcion tenia un mapa de montos por defecto indexado por los ids de la
// plantilla "estudiante" (gas, dates, gifts, university, flex). Corria sobre TODAS las
// categorias en cada migracion, y como uniqueCategoryId() convierte el nombre en slug,
// una categoria que el usuario llamara "Gas" recibia el id `gas` y podia heredar
// $30.000 semanales que nunca escribio.
function locationLabel(location) {
  return normalizeLocation(location) === "cash" ? "Efectivo" : "Cuenta";
}

function cadenceLabel(cadence) {
  const labels = {
    weekly: "semanal",
    biweekly: "quincenal",
    monthly: "mensual",
    semester: "semestral",
    yearly: "anual",
    period: "por periodo"
  };
  return labels[cadence] || labels.monthly;
}

function monthStartKey(dateValue = todayKey()) {
  return `${String(dateValue).slice(0, 7)}-01`;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function hoursFromNow(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

function previousDay(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return todayKey(date);
}

function todayKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function relativeUnlock(dateValue) {
  const diff = new Date(dateValue).getTime() - Date.now();
  const hours = Math.ceil(diff / 3_600_000);
  if (hours <= 1) {
    return "en menos de 1 hora";
  }
  return `en ${hours} horas`;
}

function getMoneyFormatter(currency) {
  let formatter = moneyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 });
    moneyFormatterCache.set(currency, formatter);
  }
  return formatter;
}

function formatDate(dateValue) {
  return SHORT_DATE_FORMATTER.format(new Date(`${dateValue}T12:00:00`));
}

function formatShortDate(dateValue) {
  return SHORT_DATE_FORMATTER.format(new Date(`${dateValue}T12:00:00`)).replace(".", "");
}

function eventMonthLabel(dateValue) {
  return EVENT_MONTH_FORMATTER.format(new Date(`${dateValue}T12:00:00`)).replace(".", "");
}

function eventDayLabel(dateValue) {
  return EVENT_DAY_FORMATTER.format(new Date(`${dateValue}T12:00:00`));
}

function formatRelativeEventDate(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  const today = new Date(`${todayKey()}T12:00:00`);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days === -1) return "Ayer";
  if (days > 1) return `En ${days} días`;
  return `Hace ${Math.abs(days)} días`;
}

function movementDayLabel(dateValue) {
  if (dateValue === todayKey()) return "Hoy";
  if (dateValue === previousDay(todayKey())) return "Ayer";
  return MOVEMENT_DAY_FORMATTER.format(new Date(`${dateValue}T12:00:00`));
}

function formatMoney(value) {
  return getMoneyFormatter(state.profile.currency || "COP").format(Number(value || 0));
}

function formatCompactMoney(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) < 1000) {
    return formatMoney(amount);
  }
  return `$${COMPACT_MONEY_FORMATTER.format(amount / 1000)}k`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
