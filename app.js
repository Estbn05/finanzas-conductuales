import {
  FREE_CATEGORY_ID,
  INCOME_CADENCES,
  LARGE_PURCHASE_RATIO,
  budgetAmountForJob as getBudgetAmountForJob,
  budgetWindow as getBudgetWindow,
  pruneExpiredOneOffs,
  budgetRingAllocation as getBudgetRingAllocation,
  budgetSummary as getBudgetSummary,
  calculatePlan as calculateFinancePlan,
  categoryStatus as getCategoryStatus,
  findLoggedIncome,
  hasFund,
  freeShareOfBudget,
  isSavingsJob,
  jobFund,
  getPeriodIncome,
  getMonthlyIncome,
  predictUntilNextPeriod as getPeriodPrediction,
  resolvePeriodIncome,
  settlePeriodIncomeAtOnboarding,
  spendByCategory as getSpendByCategory
} from "./finance-core.js?v=1.1.92";
import {
  SMALL_EXPENSE_THRESHOLD,
  categoryTrend,
  compareByRecent,
  dailyExpenseTotal,
  expenseCalendar,
  inWindow,
  listMovements,
  movementsCsv,
  periodMovements,
  smallExpenses,
  weekdayPattern
} from "./movements.js?v=1.1.92";
import { isStale, looksLikeEarlyPay, looksLikePay, pendingSuggestions, unreadableNotifications } from "./bank-notifications.js?v=1.1.92";
import { categoryIntent, suggestCategory } from "./categorize.js?v=1.1.92";
import { periodExportMarkdown, periodReview } from "./period-review.js?v=1.1.92";
import { duePlans, normalizeRepeat, plannedTotal, registerOccurrence, skipOccurrence, undoOccurrence } from "./planned.js?v=1.1.92";
import {
  DEFAULT_MERCHANT,
  DEFAULT_REMINDER_TIME,
  DIAGNOSIS_SECTIONS,
  JOB_CADENCE_VALUES,
  LEGACY_TEMPLATE_BUDGET_JOBS,
  buildMerchantRulesFromTransactions,
  clamp,
  frequentExpenses,
  lastExpenseSource,
  cleanDate,
  cleanText,
  clearTemplateBudget,
  createDefaultState,
  filterMerchantRulesForJobs,
  isTemplateBudgetJobs,
  merchantKey,
  isPlaceholderMerchant,
  migrateState,
  normalizeBudgetExtras,
  normalizeBudgetJobs,
  REMINDER_DAYS_AHEAD,
  upcomingReminderDates,
  normalizeCalendarEvents,
  normalizeDailyReminder,
  normalizeEventCategory,
  normalizeLiquidity,
  normalizeIncomeLocation,
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
  hasUnsyncedLocalEdits,
  compactForStorage,
  compactMergeBase,
  mergeStates,
  remoteChangedSinceLastSync,
  CREDIT_PAYMENTS_LIMIT,
  uid
} from "./state-model.js?v=1.1.92";
import {
  clearStoredCloudSession,
  deleteCloudAccount,
  deleteCloudAppState,
  getCloudSession,
  isCloudConfigured,
  isCloudLibraryLoaded,
  CloudConflictError,
  loadCloudState,
  onCloudAuthChange,
  requestPasswordReset,
  saveCloudState,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud
} from "./sync-client.js?v=1.1.92";

const STORAGE_KEY = "finanzas-conductuales:v1";
const SUPPORT_EMAIL = "yefry.avila.zuluaga@gmail.com";
const BACKUP_KEY = "finanzas-conductuales:backups:v1";
// The version this device last agreed on with the cloud: the common base for merging
// another device's changes (see mergeStates in state-model.js).
const CLOUD_BASE_KEY = "finanzas-conductuales:cloud-base:v1";
// Local backups live in IndexedDB, which has far more room than localStorage (~5 MB for
// everything). Three full copies of the state there used to push the main save against
// the quota after a couple of years of expenses. BACKUP_KEY is the old location, read
// once to migrate and as a fallback where IndexedDB is unavailable.
const BACKUP_DB_NAME = "finanzas-conductuales";
const BACKUP_STORE = "backups";
const BACKUP_LIMIT = 3;
// Categories: kept few so the plan stays readable. Learned merchant shortcuts: the
// least recently used are forgotten beyond this many.
const MAX_CATEGORIES = 10;
const MAX_MERCHANT_RULES = 30;
// In-memory list the UI reads synchronously; IndexedDB is its durable copy.
let localBackups = [];
// Set when the main save could not be read at startup and must be restored from a
// backup once the backups have loaded.
let recoverFromBackupPending = false;
let backupsReady = null;
let backupDbPromise = null;
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
// The loading screen (session check, sign-in) stays up at least this long, so it reads
// as a short sequence of steps instead of a flash, and each step lights up this far apart.
const LOADING_MIN_MS = 1_800;
const LOADING_STEP_MS = 600;
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

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// Icon for a category, by the kind of expense its name says (categorize.js categoryIntent).
const INTENT_ICONS = { combustible: "fuel", transporte: "car", mercado: "food", comida: "food" };

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
// One id per upcoming day (see upcomingReminderDates); 7301 is the old repeating one.
const DAILY_REMINDER_FIRST_ID = 7310;
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

// `inBottomNav`: already one tap away in the bottom bar on phones, so the drawer only
// shows them on desktop, where the drawer is the navigation.
const NAV_ITEMS = [
  { id: "today", label: "Inicio", icon: "home", inBottomNav: true },
  { id: "budget", label: "Plan", icon: "plan", inBottomNav: true },
  { id: "movements", label: "Movimientos", icon: "receipt", inBottomNav: true },
  { id: "savings", label: "Ahorro", icon: "target" },
  { id: "calendar", label: "Gastos planeados", icon: "calendar" },
  { id: "profile", label: "Datos", icon: "user" }
];
// Progreso and the period close are reached from Plan.
const APP_VIEWS = new Set([...NAV_ITEMS.map((item) => item.id), "periodClose", "progress"]);

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
// Last style sent to Android for the status bar icons (see syncSystemBarsStyle).
let systemBarsStyle = "";
// 0 = the current period in Movimientos, -1 the one before, and so on.
let movementsPeriodOffset = 0;
// "Olvidé mi PIN": the account password is being checked.
let lockForgotBusy = false;
// A local-only user asked to create an account / sign in from inside the app.
let accountRequested = false;
const PRIVACY_POLICY_URL = "https://estbn05.github.io/finanzas-conductuales/privacy-policy.html";
// The guided tour while it is open: { steps, position }.
let tour = null;
let tourLayoutFrame = 0;
// What each step of the tour lights up (first visible match) and says.
const TOUR_STEPS = [
  {
    targets: [".money-bar"],
    title: "Tu dinero libre",
    text: "Es lo que puedes gastar sin tocar lo que reservaste para tus categorías. Es la cifra que más importa: mírala antes de comprar."
  },
  {
    targets: [".bottom-nav .is-register", '.sidebar [data-action="open-expense"]'],
    title: "Registrar un gasto",
    text: "Cada vez que gastes, tócalo aquí. Con el monto basta; el comercio y la categoría son opcionales."
  },
  {
    targets: [".setaside-action"],
    title: "Apartar dinero",
    text: "Guarda plata para algo, como un regalo o la gasolina de varios meses. Queda apartada hasta que la uses o la liberes, y no se mueve de tu cuenta."
  },
  {
    targets: [".home-view .category-bars", ".home-view .home-section-heading"],
    title: "Lo que vas usando",
    text: "Cada categoría muestra cuánto llevas de su límite. Si te pasas no pasa nada: te lo mostramos para que ajustes con calma."
  },
  {
    targets: ['.bottom-nav [data-view="budget"]', '.sidebar [data-view="budget"]'],
    title: "Plan",
    text: "Crea y ajusta categorías, registra dinero extra y mira cómo te fue en los periodos anteriores."
  },
  {
    targets: ['.bottom-nav [data-view="movements"]', '.sidebar [data-view="movements"]'],
    title: "Movimientos",
    text: "Todo lo que registraste, periodo por periodo. Toca un gasto para corregirlo o cambiarle la categoría."
  },
  {
    targets: ['.bottom-nav [data-action="toggle-menu"]', '.sidebar [data-view="profile"]'],
    title: "Menú",
    text: "Ahorro, gastos planeados y Datos: tus saldos, el PIN, las copias y los ajustes. Desde Datos puedes volver a ver esta guía."
  }
];
// Which of Inicio's money rows are open ("have", "reserved", "budget").
let moneyDetailsOpen = {};
let planSheet = "";
let pendingJobRemovalId = "";
// The category open in "Editar categoría" (planSheet "edit-job").
let editingJobId = "";
// The cadences a recurring category can be edited to (the same as when it is created).
const EDITABLE_CADENCES = [
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quincenal" },
  { value: "monthly", label: "Mensual" }
];
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
// What the native daily reminders were last scheduled for, so saving state (which runs
// scheduleDailyReminder on every change) only reschedules when something that matters
// changed: on, time, day, permission, or whether an expense was recorded today.
let nativeReminderPlan = "";
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
// When the loading screen appeared (0 = not showing) and why: "startup" or "signin".
// The first startup screen counts from page load, since index.html's copy was already up.
let loadingShownSince = 0;
let loadingReason = "startup";
let loadingFirstShow = true;
let loadingHoldTimer = 0;
let lockConfig = loadLockConfig();
let lockMode = lockConfig.enabled ? "unlock" : "";
let lockDigits = "";
let lockFirstEntry = "";
let lockError = "";
let lastBackgroundAt = 0;
let lockCooldownTimer;
let biometricAutoTried = false;
let biometricPromptActive = false;
// Expenses read from the bank app's notifications, waiting for the user to confirm them.
// Device-only: they come from the Android listener and are never part of the synced state.
let bankSuggestions = [];
let bankStatus = { available: false, enabled: false, permission: false, connected: false };
// Recent bank notifications that are not a movement the app can read (shown in Datos).
let bankUnreadable = [];
// Money a bank notification said arrived, prefilling the "Dinero extra" sheet.
let extraDraft = null;
// The pay a bank notification seems to be, prefilling "¿Cuánto te llegó?".
let payDraft = null;

render();
initializeNativeNotificationActions();
refreshNativeNotificationPermission({ renderNow: true });
bindHardwareBackButton();
bindAppLock();
syncHomeWidget();
initializeWidgetQuickAddDeepLink();
bindBankNotifications();
window.setTimeout(recoverAuthStartup, AUTH_STARTUP_TIMEOUT_MS);
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
loadLocalBackups();
initializeCloudSync();
scheduleDailyReminder();
window.addEventListener("hashchange", () => {
  const nextView = viewFromHash(state.activeView || DEFAULT_VIEW);
  let shouldRender = false;
  if (nextView !== state.activeView) {
    scrollToTop();
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
function persist(key, rawValue) {
  const value = key === STORAGE_KEY ? compactForStorage(rawValue) : rawValue;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      return false;
    }
    try {
      if (key !== BACKUP_KEY) {
        // The merge base can be rebuilt on the next sync; old-style backups can go too.
        localStorage.removeItem(CLOUD_BASE_KEY);
        localStorage.removeItem(BACKUP_KEY);
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
    // Restored from the newest backup as soon as the backups load (loadLocalBackups).
    recoverFromBackupPending = true;
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
  snapshotCurrentPeriod();
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

    if (decision === "download" && !(hasMeaningfulLocalData(state) && hasUnsyncedLocalEdits(state))) {
      applyRemoteState(remote.app_state, remote.updated_at, "Nube sincronizada automáticamente.");
    } else if (decision === "in-sync") {
      markCloudSynced(remote.updated_at || new Date().toISOString(), { base: remote.app_state });
      state.lastAlert = "Nube al día.";
    } else {
      // "download" with changes of this device's own merges them in before uploading.
      await uploadWithMerge(remote);
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
    if (decidePushSync(state, remote) === "download" && !(hasMeaningfulLocalData(state) && hasUnsyncedLocalEdits(state))) {
      // Nothing of this device's own to keep: simply take the cloud version.
      applyRemoteState(remote.app_state, remote.updated_at, "La nube tenía cambios más recientes. Descargué esa versión.");
      cloudState.status = "synced";
      renderCloudStatusChange();
      return;
    }

    await uploadWithMerge(remote);
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
  markCloudSynced(remoteUpdatedAt || new Date().toISOString(), { persist: false, base: state });
  saveState({ sync: false, touch: false });
  applyingCloudState = false;
}

// `base`: the exact document now in the cloud, remembered as the merge base.
function markCloudSynced(updatedAt, options = {}) {
  const { persist: shouldPersist = true, base = null } = options;
  state.meta = {
    ...(state.meta || {}),
    cloudUpdatedAt: updatedAt,
    cloudUserEmail: cloudState.email
  };
  if (base) {
    writeCloudBase(base);
  }
  if (shouldPersist) {
    persist(STORAGE_KEY, state);
  }
}

function writeCloudBase(appState) {
  try {
    // Compact: record hashes instead of a second full copy of every expense.
    localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify({ email: cloudState.email, state: compactMergeBase(appState) }));
  } catch {
    // Out of space: without a base the next merge falls back to combining both sides.
    try {
      localStorage.removeItem(CLOUD_BASE_KEY);
    } catch {}
  }
}

// Only a base from this same account counts.
function readCloudBase() {
  try {
    const stored = JSON.parse(localStorage.getItem(CLOUD_BASE_KEY) || "null");
    return stored && stored.email === cloudState.email ? stored.state : null;
  } catch {
    return null;
  }
}

// Another device saved since this one last synced, and this one has changes of its own:
// combine both instead of letting either erase the other (mergeStates in state-model.js).
function adoptMergedState(remote) {
  saveLocalBackup("antes de combinar con otro dispositivo");
  // Both sides normalized the same way, so records only differ where someone changed them.
  const merged = mergeStates(readCloudBase(), getCloudPayload(), migrateState(remote.app_state, todayKey(), DEFAULT_VIEW));
  applyingCloudState = true;
  state = migrateState(merged, todayKey(), DEFAULT_VIEW);
  state.meta = { ...(state.meta || {}), cloudUpdatedAt: remote.updated_at, cloudUserEmail: cloudState.email };
  saveState({ sync: false });
  applyingCloudState = false;
  showNoticeSnackbar("Combinamos tus cambios con los de otro dispositivo.", { renderNow: false });
}

// Uploads this device's state with compare-and-swap: if another device saves between
// reading and writing, read again, merge and retry.
async function uploadWithMerge(remote) {
  let current = remote;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (current?.app_state && hasMeaningfulLocalData(current.app_state) && remoteChangedSinceLastSync(state, current)) {
      adoptMergedState(current);
    }
    const payload = getCloudPayload();
    try {
      const saved = await saveCloudState(payload, current?.app_state ? current.updated_at : null);
      markCloudSynced(saved?.updated_at || new Date().toISOString(), { base: payload });
      return;
    } catch (error) {
      if (!(error instanceof CloudConflictError)) throw error;
      current = await loadCloudState();
    }
  }
  throw new Error("Otro dispositivo está guardando al mismo tiempo. Lo intento de nuevo en un momento.");
}

function readLocalBackups() {
  return localBackups;
}

function readLegacyBackups() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const backups = raw ? JSON.parse(raw) : [];
    return Array.isArray(backups) ? backups : [];
  } catch {
    return [];
  }
}

function openBackupDb() {
  return new Promise((resolve) => {
    try {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const request = window.indexedDB.open(BACKUP_DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(BACKUP_STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function backupDb() {
  backupDbPromise ||= openBackupDb();
  return backupDbPromise;
}

// Runs `work(store)` in one transaction; resolves with the request it returns, if any.
async function withBackupStore(mode, work) {
  const db = await backupDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(BACKUP_STORE, mode);
      const request = work(transaction.objectStore(BACKUP_STORE));
      transaction.oncomplete = () => resolve(request?.result ?? null);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Loads the backups into memory at startup, moving any left in localStorage by older
// versions into IndexedDB, and finishes a pending recovery.
function loadLocalBackups() {
  backupsReady ||= (async () => {
    const db = await backupDb();
    const legacy = readLegacyBackups();
    if (db) {
      const stored = (await withBackupStore("readonly", (store) => store.getAll())) || [];
      localBackups = [...stored, ...legacy.filter((item) => !stored.some((s) => s.id === item.id))]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, BACKUP_LIMIT);
      if (legacy.length) {
        await writeBackups();
        try {
          localStorage.removeItem(BACKUP_KEY);
        } catch {}
      }
    } else {
      localBackups = legacy;
    }
    if (recoverFromBackupPending && localBackups[0]?.state) {
      recoverFromBackupPending = false;
      state = migrateState(localBackups[0].state, todayKey(), DEFAULT_VIEW);
      state.lastAlert = "Tu guardado local estaba dañado; lo recuperamos desde tu última copia automática.";
      saveState({ sync: false, touch: false });
      showNoticeSnackbar(state.lastAlert, { renderNow: false });
      render();
    } else if (state.activeView === "profile") {
      renderBackground();
    }
  })();
  return backupsReady;
}

async function writeBackups() {
  const db = await backupDb();
  if (!db) {
    persist(BACKUP_KEY, localBackups);
    return;
  }
  const keep = localBackups;
  await withBackupStore("readwrite", (store) => {
    store.clear();
    keep.forEach((backup) => store.put(backup));
  });
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
  // After the stored backups have loaded, so an early backup never overwrites them.
  (backupsReady || loadLocalBackups()).then(() => {
    localBackups = [backup, ...localBackups].slice(0, BACKUP_LIMIT);
    return writeBackups();
  });
}

function restoreLocalBackup(id) {
  const backup = readLocalBackups().find((item) => item.id === id);
  if (!backup?.state) {
    state.lastAlert = "No encontré esa copia local.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
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
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
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
  // The "Comprobando tu sesión" screen has nothing to lose, but hasOpenUserInput() counts
  // a pending onboarding as open input and would leave a local-only user stuck on it.
  if (shouldShowAuthGate() || document.querySelector(".session-check")) {
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
    <button class="drawer-scrim" type="button" data-action="close-menu" aria-label="Cerrar menú"></button>
    <aside class="sidebar" aria-label="Menú principal">
      <div class="sidebar-head">
        <a class="brand" href="#" data-view="today" aria-label="Ir al inicio">
          ${renderBrandMark()}
          <span>
            <strong>Finanzas Conductuales</strong>
            <small>${capitalize(budgetSummary().cadenceLabel)} · ${formatMoney(budgetSummary().freeRemaining)} libre</small>
          </span>
        </a>
        <button class="drawer-close" type="button" data-action="close-menu" aria-label="Cerrar menú">${renderIcon("close")}</button>
      </div>
      <div class="nav-panel is-open" id="main-menu">
        <nav class="nav-list" aria-label="Secciones principales">
          <button class="nav-item is-primary is-in-bottom-nav" type="button" data-action="open-expense">
            <span class="nav-number">+</span>
            <span>Registrar gasto</span>
          </button>
          ${NAV_ITEMS.map((item) => renderNavItem(item)).join("")}
        </nav>
        <div class="menu-tools">
          ${renderSyncStatusLine()}
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
    ${periodReportOpen ? renderPeriodReportModal() : ""}
    ${profileNeedsOnboarding() || state.showDiagnosis ? renderDiagnosisModal() : ""}
    ${renderSnackbar()}
  `;

  bindEvents();
  if (tour) scheduleTourLayout();
}

function renderDailyReminderPanel() {
  const reminder = normalizeDailyReminder(state.dailyReminder);
  const permission = notificationPermissionStatus();
  return `
      <article class="calendar-panel reminder-panel">
        <div class="calendar-panel-heading">
          <div>
            <p class="eyebrow">Revisión diaria</p>
            <h2>Recordatorio de gastos</h2>
          </div>
          <span class="metric-badge ${permission === "granted" ? "under" : permission === "denied" ? "danger" : ""}">${notificationStatusLabel(permission)}</span>
        </div>
        ${
          permission === "granted"
            ? ""
            : `<button class="btn secondary" type="button" data-action="request-reminder-permission">Permitir notificaciones</button>`
        }
        <form class="calendar-reminder-form" id="daily-reminder-form">
          <label class="toggle-row">
            <input name="enabled" type="checkbox" ${reminder.enabled ? "checked" : ""}>
            <span>
              <strong>Preguntar cada día</strong>
              <small>Mensaje: "¿Quieres registrar tus gastos de hoy?"</small>
            </span>
          </label>
          <label>
            Hora
            <input name="time" type="time" value="${escapeAttr(reminder.time)}" required>
          </label>
          <button class="btn primary" type="submit">Guardar recordatorio</button>
        </form>
        <div class="reminder-actions">
          ${
            permission === "granted"
              ? `<button class="btn ghost" type="button" data-action="send-test-reminder">Probar</button>`
              : ""
          }
        </div>
        <p class="data-note">${reminderSupportNote(permission)}</p>
      </article>

  `;
}

// ------------------------------------------------------------------ guided tour
// A first look at Inicio for new users: the screen dims and only the part being explained
// stays lit, with a card next to it. Shown once after onboarding, replayable from Datos.
// It lives outside #app (render() rebuilds #app), marks #app inert while open, and
// re-measures its target after every render, scroll and resize.

function tourTarget(step) {
  for (const selector of step.targets) {
    const el = document.querySelector(selector);
    if (el && el.getClientRects().length && window.getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

// Steps whose target is not on screen (no categories yet, desktop layout...) are skipped.
function tourStepIndexes() {
  return TOUR_STEPS.map((step, index) => (tourTarget(step) ? index : -1)).filter((index) => index >= 0);
}

function startTour() {
  if (tour || lockMode) return;
  if (state.activeView !== DEFAULT_VIEW) {
    activateView(DEFAULT_VIEW);
    render();
  }
  menuOpen = false;
  const steps = tourStepIndexes();
  if (!steps.length) return;
  tour = { steps, position: 0 };
  const layer = document.createElement("div");
  layer.id = "app-tour";
  layer.className = "tour-layer";
  layer.innerHTML = `
    <div class="tour-blocker"></div>
    <div class="tour-spotlight" aria-hidden="true"></div>
    <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      <p class="tour-count" data-tour-count></p>
      <h2 id="tour-title" data-tour-title></h2>
      <p id="tour-text" data-tour-text></p>
      <div class="tour-actions">
        <button class="btn ghost tour-skip" type="button" data-tour-skip>Saltar guía</button>
        <button class="btn ghost" type="button" data-tour-back>Atrás</button>
        <button class="btn primary" type="button" data-tour-next>Siguiente</button>
      </div>
    </section>
  `;
  document.body.append(layer);
  app.inert = true;
  layer.querySelector("[data-tour-skip]").addEventListener("click", () => finishTour());
  layer.querySelector("[data-tour-back]").addEventListener("click", () => moveTour(-1));
  layer.querySelector("[data-tour-next]").addEventListener("click", () => moveTour(1));
  // The tour lives outside #app, whose keydown handler it cannot rely on.
  layer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      endTour();
    }
  });
  window.addEventListener("resize", scheduleTourLayout);
  window.addEventListener("scroll", scheduleTourLayout, { passive: true });
  showTourStep();
}

function moveTour(delta) {
  if (!tour) return;
  const next = tour.position + delta;
  if (next < 0) return;
  if (next >= tour.steps.length) {
    finishTour();
    return;
  }
  tour.position = next;
  showTourStep();
}

// Whether the first-run tour should end by offering the daily reminder. Recording
// everything on the same day is what keeps the numbers right, and the reminder (which
// opens "Registrar gasto" when tapped) was buried in Datos and off by default, so most
// people never found it. Only once — the first tour — and only if it is not on yet.
function shouldOfferDailyReminder() {
  return !state.settings.tourDone
    && !normalizeDailyReminder(state.dailyReminder).enabled
    && notificationPermissionStatus() !== "unsupported";
}

function finishTour() {
  if (tour && !tour.offer && shouldOfferDailyReminder()) {
    showDailyReminderOffer();
    return;
  }
  endTour();
}

function showDailyReminderOffer() {
  const layer = document.getElementById("app-tour");
  if (!tour || !layer) return;
  tour.offer = true;
  const time = normalizeDailyReminder(state.dailyReminder).time;
  const card = layer.querySelector(".tour-card");
  card.classList.add("tour-reminder-offer");
  card.setAttribute("aria-labelledby", "tour-reminder-title");
  card.setAttribute("aria-describedby", "tour-reminder-text");
  card.innerHTML = `
    <h2 id="tour-reminder-title">¿Te recordamos registrar tus gastos?</h2>
    <p id="tour-reminder-text">Una vez al día te llega un aviso que abre directo "Registrar gasto". Anotar el mismo día es lo que mantiene tus números al día.</p>
    <label class="tour-reminder-time">
      Hora del aviso
      <input type="time" value="${escapeAttr(time)}" data-tour-reminder-time required>
    </label>
    <div class="tour-actions">
      <button class="btn ghost" type="button" data-tour-reminder-skip>Ahora no</button>
      <button class="btn primary" type="button" data-tour-reminder-enable>Activar recordatorio</button>
    </div>
    <p class="tour-reminder-note">Puedes cambiarlo cuando quieras en Datos.</p>
  `;
  card.querySelector("[data-tour-reminder-skip]").addEventListener("click", () => endTour());
  const enable = card.querySelector("[data-tour-reminder-enable]");
  enable.addEventListener("click", async () => {
    enable.disabled = true;
    const permission = await setDailyReminder({ enabled: true, time: card.querySelector("[data-tour-reminder-time]").value });
    endTour();
    if (permission === "granted") {
      showNoticeSnackbar(state.lastAlert);
    }
    render();
  });
  layoutTour();
  enable.focus({ preventScroll: true });
}

function showTourStep() {
  const layer = document.getElementById("app-tour");
  if (!tour || !layer) return;
  const step = TOUR_STEPS[tour.steps[tour.position]];
  const last = tour.position === tour.steps.length - 1;
  layer.querySelector("[data-tour-count]").textContent = `${tour.position + 1} de ${tour.steps.length}`;
  layer.querySelector("[data-tour-title]").textContent = step.title;
  layer.querySelector("[data-tour-text]").textContent = step.text;
  layer.querySelector("[data-tour-back]").hidden = tour.position === 0;
  layer.querySelector("[data-tour-skip]").hidden = last;
  layer.querySelector("[data-tour-next]").textContent = last && !shouldOfferDailyReminder() ? "Empezar a usarla" : "Siguiente";
  const target = tourTarget(step);
  if (target && window.getComputedStyle(target).position !== "fixed" && !target.closest(".bottom-nav, .sidebar")) {
    try {
      target.scrollIntoView({ block: "center" });
    } catch {}
  }
  layoutTour();
  layer.querySelector("[data-tour-next]").focus({ preventScroll: true });
}

function scheduleTourLayout() {
  cancelAnimationFrame(tourLayoutFrame);
  tourLayoutFrame = requestAnimationFrame(layoutTour);
}

// Places the lit hole over the target and the card below it, or above if it does not fit.
function layoutTour() {
  const layer = document.getElementById("app-tour");
  if (!tour || !layer) return;
  const target = tour.offer ? null : tourTarget(TOUR_STEPS[tour.steps[tour.position]]);
  const spotlight = layer.querySelector(".tour-spotlight");
  const card = layer.querySelector(".tour-card");
  if (!target) {
    spotlight.style.cssText = "left:50%;top:50%;width:0;height:0";
    card.style.top = "";
    card.style.bottom = "24px";
    return;
  }
  const pad = 8;
  const rect = target.getBoundingClientRect();
  const top = Math.max(4, rect.top - pad);
  const left = Math.max(4, rect.left - pad);
  const width = Math.min(window.innerWidth - left - 4, rect.width + pad * 2);
  const height = rect.height + pad * 2;
  spotlight.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
  const gap = 14;
  const cardHeight = card.offsetHeight || 220;
  const below = window.innerHeight - (top + height) - gap;
  const above = top - gap - 16;
  if (below >= cardHeight + 16) {
    card.style.top = `${top + height + gap}px`;
    card.style.bottom = "";
  } else if (above >= cardHeight) {
    card.style.top = `${top - gap - cardHeight}px`;
    card.style.bottom = "";
  } else {
    // Fits neither side of a tall target: pin it low, over the least important part.
    card.style.top = "";
    card.style.bottom = "16px";
  }
}

function endTour() {
  if (!tour) return;
  tour = null;
  document.getElementById("app-tour")?.remove();
  app.inert = false;
  window.removeEventListener("resize", scheduleTourLayout);
  window.removeEventListener("scroll", scheduleTourLayout);
  if (!state.settings.tourDone) {
    state.settings = { ...state.settings, tourDone: true, updated_at: new Date().toISOString() };
    saveState();
  }
  scrollToTop();
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
  const active =
    state.activeView === item.id || (item.id === "budget" && ["periodClose", "progress"].includes(state.activeView)) ? "is-active" : "";
  return `
    <button class="nav-item ${active} ${item.inBottomNav ? "is-in-bottom-nav" : ""}" type="button" data-view="${item.id}">
      <span class="nav-number" aria-hidden="true">${renderIcon(item.icon)}</span>
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
  syncSystemBarsStyle(theme);
  return theme;
}

// Android follows the SYSTEM theme for the status bar icons, not the app's: with the app
// on "Claro" and the phone in dark mode the clock came out white on the cream strip.
// "DARK" means a dark background, so light icons.
function syncSystemBarsStyle(theme) {
  const style = theme === "dark" ? "DARK" : "LIGHT";
  const systemBars = window.Capacitor?.Plugins?.SystemBars;
  if (style === systemBarsStyle || !systemBars?.setStyle) {
    return;
  }
  systemBarsStyle = style;
  systemBars.setStyle({ style }).catch(() => {
    systemBarsStyle = "";
  });
}

function renderBottomNavigation() {
  return `
    <nav class="bottom-nav" aria-label="Navegación rápida">
      <button class="bottom-nav-item ${state.activeView === "today" ? "is-active" : ""}" type="button" data-view="today">
        <span class="bottom-nav-icon" aria-hidden="true">${renderIcon("home")}</span>
        <span>Inicio</span>
      </button>
      <button class="bottom-nav-item ${["budget", "periodClose", "progress"].includes(state.activeView) ? "is-active" : ""}" type="button" data-view="budget">
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
    // Two stacked cards: the single-card shape is already the "account" icon.
    card: '<rect x="2.5" y="8" width="15" height="11" rx="2"/><path d="M2.5 11.5h15"/><path d="M6.5 8V6.5A1.5 1.5 0 0 1 8 5h12a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 16h-2.5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
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
  if (isLocalOnly()) {
    return `<p class="sync-status sync-status--offline"><span class="sync-status-icon" aria-hidden="true">•</span><span>Solo en este teléfono</span></p>`;
  }
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
  if (!cloudState.sessionReady || (!state.profile.completed && cloudStillResolving())) {
    return true;
  }
  return loadingHoldRemaining() > 0;
}

// The work is done but the loading screen has not been up for LOADING_MIN_MS yet: keep it
// and come back when it has. There is no manual way out; recoverAuthStartup() still ends a
// stuck startup check on its own after AUTH_STARTUP_TIMEOUT_MS.
function loadingHoldRemaining() {
  if (!loadingShownSince) {
    return 0;
  }
  const left = loadingShownSince + LOADING_MIN_MS - Date.now();
  if (left <= 0) {
    loadingShownSince = 0;
    loadingReason = "startup";
    return 0;
  }
  clearTimeout(loadingHoldTimer);
  loadingHoldTimer = window.setTimeout(render, left);
  return left;
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
  if (accountRequested) {
    return true;
  }
  // "Usar sin cuenta": the app works entirely on this phone until they choose to sign up.
  if (isLocalOnly()) {
    return false;
  }
  return !hasMeaningfulLocalData(state);
}

function isLocalOnly() {
  return Boolean(state.meta?.localOnly) && !cloudState.signedIn;
}

function startLocalOnly() {
  state.meta = { ...(state.meta || {}), localOnly: true };
  accountRequested = false;
  authMode = "";
  authNotice = null;
  cloudState.error = "";
  saveState({ sync: false });
}

function renderLocalOnlyChoice() {
  const staying = Boolean(state.meta?.localOnly);
  return `
    <div class="auth-local-choice">
      <button class="btn ghost" type="button" data-action="use-without-account">${staying ? "Seguir sin cuenta" : "Usar sin cuenta"}</button>
      <small>Tus datos quedan solo en este teléfono. Puedes crear una cuenta después para tener copia en la nube.</small>
    </div>
  `;
}

function renderPrivacyLink(prefix = "") {
  return `<p class="auth-privacy">${prefix}<a href="${PRIVACY_POLICY_URL}" target="_blank" rel="noopener">Política de privacidad</a></p>`;
}

function profileNeedsOnboarding() {
  return !state.profile.completed && !cloudStillResolving();
}

// Real steps, in the order the work happens. Each lights up LOADING_STEP_MS after the
// previous one; the last keeps spinning until the work actually ends. Delays are offset by
// the time already elapsed, so a re-render mid-way does not restart the sequence.
function renderSessionCheck() {
  if (!loadingShownSince) {
    loadingShownSince = loadingFirstShow && loadingReason === "startup" ? Date.now() - performance.now() : Date.now();
  }
  loadingFirstShow = false;
  const elapsed = Date.now() - loadingShownSince;
  const signin = loadingReason === "signin";
  const steps = signin
    ? ["Verificando tu correo", "Trayendo tus datos de la nube", "Calculando tu dinero libre"]
    : ["Comprobando tu sesión", "Trayendo tus datos", "Calculando tu dinero libre"];
  return `
    <main class="session-check" aria-busy="true">
      <section class="startup-fallback-card loading-card">
        <h1>${signin ? "Entrando a tu cuenta" : "Preparando todo"}</h1>
        <ol class="loading-steps">
          ${steps
            .map((label, index) => {
              const on = index * LOADING_STEP_MS - elapsed;
              const done = index < steps.length - 1 ? (index + 1) * LOADING_STEP_MS - elapsed : null;
              return `<li class="loading-step" style="--step-on:${on}ms;${done === null ? "" : `--step-done:${done}ms`}"${done === null ? ' data-last="true"' : ""}>
                <span class="loading-step-mark" aria-hidden="true"><span class="loading-step-spin"></span>${done === null ? "" : `<span class="loading-step-check">${renderIcon("check")}</span>`}</span>
                <span>${label}</span>
              </li>`;
            })
            .join("")}
        </ol>
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
            <p class="auth-screen-lead">No pudimos conectar con el servicio de cuentas. Puedes usar la app sin cuenta mientras tanto.</p>
          </div>
          ${renderLocalOnlyChoice()}
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
          ${isSignIn ? "" : renderPrivacyLink("Al registrarte aceptas la ")}
          <p class="auth-switch">
            ${isSignIn ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}
            <button class="auth-switch-link" type="button" data-action="show-auth-form" data-auth-mode="${isSignIn ? "signup" : "signin"}">
              ${isSignIn ? "Regístrate" : "Inicia sesión"}
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
          <p class="auth-lead">Registra tus gastos y mira cuánto te queda libre, sin culpa.</p>
          <div class="auth-benefits" aria-label="Para qué sirve la app">
            <article>
              <span class="auth-benefit-icon" aria-hidden="true">${renderIcon("wallet")}</span>
              <strong>Dinero libre visible</strong>
              <span>Lo disponible después de reservas y gastos reales.</span>
            </article>
            <article>
              <span class="auth-benefit-icon" aria-hidden="true">${renderIcon("tag")}</span>
              <strong>Plan por categorías</strong>
              <span>Límites para lo que quieras cuidar.</span>
            </article>
            <article>
              <span class="auth-benefit-icon" aria-hidden="true">${renderIcon("lock")}</span>
              <strong>Copia en la nube</strong>
              <span>Tus datos en tu cuenta y en tu teléfono.</span>
            </article>
          </div>
        </div>

        <div class="auth-actions" aria-label="Acceso a la aplicación">
          <article class="auth-card auth-choice-card">
            <div class="auth-choice-head">
              <p class="eyebrow">Acceso</p>
              <h2>Elige cómo entrar</h2>
            </div>
            ${inlineError}
            <div class="auth-choice-actions">
              <button class="btn primary" type="button" data-action="show-auth-form" data-auth-mode="signin">Iniciar sesión</button>
              <button class="btn secondary" type="button" data-action="show-auth-form" data-auth-mode="signup">Registrarse</button>
            </div>
            ${renderLocalOnlyChoice()}
            ${renderPrivacyLink()}
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

  return `
    ${renderIncomeAppliedBanner()}
    <header class="money-bar ${summary.overReserved ? "danger" : ""}" aria-label="Tu dinero libre">
      <div class="money-context"><span>Tu dinero libre</span><span>${period}</span></div>
      <strong>${formatMoney(summary.freeRemaining)}</strong>
      <span class="money-caption">${summary.overReserved ? "Presupuesto sobreasignado" : "Disponible para nuevos gastos"}</span>
      ${
        summary.categoryOverspent > 0
          ? `<span class="money-split danger-text">Exceso sobre topes: ${formatMoney(summary.categoryOverspent)}</span>`
          : ""
      }
      ${summary.usesLiquidityBasedFree ? renderMoneyMathFromBalance(summary, liquidity) : renderMoneyMathFromBudget(summary, liquidity)}
    </header>
  `;
}

// The hero card spells out how "libre" is reached, as a subtraction the user can read top
// to bottom, instead of showing the result next to the ingredients and hiding the piece
// that joins them (what is still reserved) behind a "why" link nobody remembers to open.

function moneyMathRow(icon, label, amount) {
  return `
    <div class="money-location-row money-math-row">
      <span class="money-location-icon" aria-hidden="true">${renderIcon(icon)}</span>
      <span class="money-location-text"><span>${label}</span><strong>${amount}</strong></span>
    </div>
  `;
}

// A row that opens to show what it is made of. `key` remembers it open across re-renders.
function moneyMathDetails(key, icon, label, amount, items, note = "") {
  if (!items.length) {
    return moneyMathRow(icon, label, amount);
  }
  return `
    <details class="money-math-details" data-money-details="${key}" ${moneyDetailsOpen[key] ? "open" : ""}>
      <summary class="money-location-row money-math-row">
        <span class="money-location-icon" aria-hidden="true">${renderIcon(icon)}</span>
        <span class="money-location-text"><span>${label}</span><strong>${amount}</strong></span>
        <span class="money-math-chevron" aria-hidden="true">&rsaquo;</span>
      </summary>
      <ul class="money-detail-list">
        ${items.map(([name, value]) => `<li><span>${name}</span><span>${value}</span></li>`).join("")}
      </ul>
      ${note ? `<p class="money-detail-note">${note}</p>` : ""}
    </details>
  `;
}

// "Reservado": what each peso is reserved for. `mode` "remaining": what is still left to
// spend in each category (fixed income, libre from the real balance). "budget": each
// category's full reserve (variable income, libre from the period's budget).
function renderReservedBreakdown(mode) {
  const rows = categoryStatus()
    .filter((category) => category.id !== FREE_CATEGORY_ID)
    .map((category) => {
      const budget = Number(category.budget || 0);
      const spent = Number(category.spent || 0);
      return { name: category.name, budget, spent, counted: mode === "remaining" ? Math.max(0, budget - spent) : budget };
    })
    .filter((row) => row.counted > 0);
  // In "budget" mode the row reads Presupuesto − Reservado = Libre, but a fund carried
  // over from earlier periods was paid for by earlier income, not this budget; leave it
  // out of the subtraction (still listed per category) so the math adds up.
  const carried = mode === "budget" ? Number(budgetSummary().carriedReserved || 0) : 0;
  const total = rows.reduce((sum, row) => sum + row.counted, 0) - carried;
  const items = rows.map((row) => [
    escapeHtml(row.name),
    mode === "remaining"
      ? row.spent > 0
        ? `quedan ${formatMoney(row.counted)} de ${formatMoney(row.budget)}`
        : formatMoney(row.counted)
      : `${formatMoney(row.budget)}${row.spent > 0 ? ` · usado ${formatMoney(row.spent)}` : ""}`
  ]);
  return moneyMathDetails(
    "reserved",
    "tag",
    "Reservado",
    total > 0 ? `−${formatMoney(total)}` : formatMoney(0),
    items,
    mode === "remaining"
      ? "Lo que todavía te queda por gastar en cada categoría. Baja a medida que la usas y no sale de tu cuenta."
      : carried > 0
        ? `Lo que separaste en cada categoría; no cuenta como libre. ${formatMoney(carried)} de eso lo apartaste en periodos anteriores, así que no resta de este presupuesto.`
        : "Lo que separaste en cada categoría este periodo; no cuenta como libre."
  );
}

function moneyLocationItems(liquidity) {
  return [
    ["Cuenta", formatMoney(liquidity.account)],
    ["Efectivo", formatMoney(liquidity.cash)],
    ...(liquidity.credit > 0 ? [["Tarjeta (ya lo debes)", `−${formatMoney(liquidity.credit)}`]] : [])
  ];
}

// Fixed income with a real balance: Tienes − Reservado; the big figure above is the result.
function renderMoneyMathFromBalance(summary, liquidity) {
  const shortfall = Math.max(0, summary.reservedRemaining - liquidity.total);
  // What payday adds is the whole pay: it lands in Tienes, and since Reservado is already
  // taken out of the figure above, free money rises by all of it. Extra money is never
  // pending (it is already inside Tienes), and neither is the cupo after reservations,
  // which is what this used to show.
  const toReceive = Number(summary.baseIncome || 0);
  const pending = !summary.incomeApplied && toReceive > 0;
  const notes = [
    shortfall > 0 ? `Te faltan ${formatMoney(shortfall)} para cubrir lo reservado.` : "",
    pending ? `Por recibir: ${formatMoney(toReceive)}. Se suma el día que te pagan.` : ""
  ].filter(Boolean);
  return `
    <div class="money-location-list money-math">
      ${moneyMathDetails("have", "wallet", "Tienes", formatMoney(liquidity.total), moneyLocationItems(liquidity))}
      ${renderReservedBreakdown("remaining")}
    </div>
    ${notes.map((note) => `<p class="money-math-note">${note}</p>`).join("")}
    ${pending ? `<button class="prediction-detail-link pay-received-link" type="button" data-action="open-pay-received">Ya me llegó</button>` : ""}
  `;
}

// Variable income: the period's budget − Reservado − what went outside categories.
function renderMoneyMathFromBudget(summary, liquidity) {
  const budgetItems =
    summary.extraIncome > 0
      ? [
          ["Base", formatMoney(summary.baseIncome)],
          ["Extra", formatMoney(summary.extraIncome)]
        ]
      : [];
  return `
    <div class="money-location-list money-math">
      ${moneyMathDetails("budget", "income", "Presupuesto", formatMoney(summary.income), budgetItems)}
      ${renderReservedBreakdown("budget")}
      ${summary.freeImpactSpent > 0 ? moneyMathRow("receipt", "Fuera de categorías", `−${formatMoney(summary.freeImpactSpent)}`) : ""}
      ${liquidity.initialized ? moneyMathDetails("have", "wallet", "Tienes", formatMoney(liquidity.total), moneyLocationItems(liquidity), summary.unclaimedLiquidity > 0 ? `${formatMoney(summary.unclaimedLiquidity)} de eso no lo reclama ninguna categoría; si es ingreso de este periodo, regístralo para que sume a libre.` : "") : ""}
    </div>
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
      ${renderDuePlans()}
      ${renderBankSuggestions()}
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
              <strong>Tu plan aún no tiene categorías</strong>
              <span>Aparta dinero para comida, transporte o cualquier propósito.</span>
              <button class="btn primary" type="button" data-action="open-setaside-sheet">Apartar dinero</button>
            </div>`
      }
      <div class="home-period-note">Presupuesto ${formatMoney(homeSummary.baseIncome)}${homeSummary.extraIncome > 0 ? ` + ${formatMoney(homeSummary.extraIncome)} extra` : ""} · ${freeShareOfBudget(homeSummary)}% sigue libre</div>
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
      ${
        predictionAmountLabel(prediction) === "Libre hoy"
          ? ""
          : `<div class="prediction-number">
              <span>${predictionAmountLabel(prediction)}</span>
              <strong>${formatMoney(amount)}</strong>
              <small>${statusLabel}</small>
            </div>`
      }
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
          <button class="icon-btn muted" type="button" data-action="close-prediction-details" aria-label="Cerrar">${renderIcon("close")}</button>
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
          <p><strong>dinero_libre_inicial</strong> = ingreso_del_periodo + extras - reservado_este_periodo${prediction.carriedReserved > 0 ? ` (lo apartado de periodos anteriores, ${formatMoney(prediction.carriedReserved)}, ya salió de ingresos pasados)` : ""}</p>
          <code>${formatMoney(summary.baseIncome)} + ${formatMoney(prediction.extraIncome)} - ${formatMoney(prediction.incomeReserved)} = ${formatMoney(prediction.freeBudget)}</code>
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
          ${
            prediction.pendingIncome > 0
              ? `<p><strong>resultado_final</strong> = libre_hoy + sueldo_por_recibir - gasto_estimado_restante</p>
                 <code>${formatMoney(prediction.freeToday)} + ${formatMoney(prediction.pendingIncome)} - ${formatMoney(prediction.projectedRemainingSpend)} = ${formatMoney(prediction.projectedEndFree)}</code>`
              : `<p><strong>resultado_final</strong> = libre_hoy - gasto_estimado_restante</p>
                 <code>${formatMoney(prediction.freeToday)} - ${formatMoney(prediction.projectedRemainingSpend)} = ${formatMoney(prediction.projectedEndFree)}</code>`
          }
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
    return "Podrían faltar";
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
            { key: "free", label: "Sin reservar", ratio: freeRatio, amountLabel: formatCompactMoney(ring.free), color: "#69d5b5" }
          ],
          formatMoney(summary.income),
          `${Math.round(freeRatio)}% sin reservar`
        )}
        ${ring.outside > 0 ? `<p class="inline-warning">Gastos fuera del presupuesto: ${formatMoney(ring.outside)}.</p>` : ""}
      </article>

      ${shouldShowPeriodClose(closeReport) ? renderPeriodCloseCard(summary, plan, closeReport) : ""}
      <div class="plan-actions plan-history-links">
        ${
          shouldShowPeriodClose(closeReport)
            ? ""
            : `<button class="plan-action" type="button" data-view="periodClose">
                <span class="plan-action-icon" aria-hidden="true">${renderIcon("list")}</span>
                <span><strong>Tu periodo en detalle</strong><small>En qué se fue, la tarjeta y un documento para analizar con IA</small></span>
                <b>&rsaquo;</b>
              </button>`
        }
        <button class="plan-action" type="button" data-view="progress">
          <span class="plan-action-icon" aria-hidden="true">${renderIcon("trend")}</span>
          <span><strong>Periodos anteriores</strong><small>Cómo te fue y cómo cambia de un periodo a otro</small></span>
          <b>&rsaquo;</b>
        </button>
      </div>

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
        <h2>Categorías <span>(${state.budgetJobs.length} de ${MAX_CATEGORIES})</span></h2>
        <span>${formatMoney(summary.freeRemaining)} libres para reservar</span>
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
        <button class="add-category-row" type="button" data-action="open-add-category-choice" ${state.budgetJobs.length >= MAX_CATEGORIES ? "disabled" : ""}>
          <span aria-hidden="true">+</span>
          <div class="add-category-row-text">
            <strong>Nueva categoría</strong>
            <small>Una vez o recurrente · máx. ${formatCompactMoney(summary.freeRemaining)}</small>
          </div>
        </button>
      </div>
    </section>
  `;
}

function renderPeriodCloseCard(summary = budgetSummary(), plan = calculatePlan(), report = periodCloseReport(plan, summary)) {
  const prediction = report.prediction;
  return `
    <article class="period-close-card ${report.status}">
      <div class="period-close-heading">
        <div>
          <p class="eyebrow">${report.isFinal ? "Fin del periodo" : "Pre-cierre"}</p>
          <h2>${report.isFinal ? "Así cerró tu periodo" : `Faltan ${formatDays(report.remainingDays)}`}</h2>
        </div>
      </div>
      <div class="period-close-metrics">
        <div><span>${report.isFinal ? "Libre al cerrar" : "Libre hoy"}</span><strong class="${report.freeFinal < 0 ? "negative" : ""}">${formatMoney(report.freeFinal)}</strong></div>
        ${
          report.isFinal
            ? ""
            : `<div><span>Por día</span><strong>${formatMoney(dailyAllowance(report))}</strong></div>
               <div><span>Al cerrar, a tu ritmo</span><strong>${formatMoney(Math.max(0, prediction.projectedEndFree))}</strong></div>`
        }
      </div>
      <button class="btn secondary" type="button" data-view="periodClose">Ver tu periodo</button>
    </article>
  `;
}

// What can go out each day until the period ends without touching what is reserved.
function dailyAllowance(report) {
  return Math.max(0, Math.floor(report.freeFinal / Math.max(1, report.remainingDays)));
}

function currentPeriodReview(summary = budgetSummary()) {
  return periodReview({
    transactions: state.transactions,
    extras: state.budgetExtras,
    creditPayments: state.creditPayments,
    window: summary.window,
    previous: getBudgetWindow(state.profile, previousDay(summary.window.start)),
    categoryName
  });
}

// The next period, as far as it can be known today: its pay (already in if it came
// early), the recurring categories that start over, and the planned expenses that fall
// in it.
function nextPeriodOutlook(summary = budgetSummary()) {
  const next = getBudgetWindow(state.profile, summary.window.end);
  const fixed = state.profile.incomeType === "fixed";
  const logged = findLoggedIncome(state.periodIncomeApplied, next.start);
  const payReceived = Boolean(logged && logged.status === "applied" && Number(logged.amount) > 0);
  const pay = payReceived ? Number(logged.amount) : fixed ? getPeriodIncome(state.profile) : 0;
  const recurring = categoryStatus()
    .filter((category) => category.id !== FREE_CATEGORY_ID && state.budgetJobs.find((job) => job.id === category.id)?.cadence !== "once")
    .reduce((total, category) => total + Number(category.budget || 0), 0);
  const planned = plannedTotal(state.calendarEvents || [], next.start, previousDay(next.end));
  return { window: next, startLabel: formatShortDate(next.start), pay, payReceived, recurring, planned, fixed };
}

function periodLabel(window) {
  return `${formatShortDate(window.start)} - ${formatShortDate(previousDay(window.end))}`;
}

function renderPeriodCloseScreen(plan = calculatePlan()) {
  const summary = budgetSummary();
  const report = periodCloseReport(plan, summary);
  const review = currentPeriodReview(summary);
  const next = nextPeriodOutlook(summary);
  const closing = shouldShowPeriodClose(report);
  const eyebrow = report.isFinal ? "Fin del periodo" : closing ? "Pre-cierre" : "Así va tu periodo";

  return `
    <section class="screen-view period-close-view" aria-label="Tu periodo">
      <div class="screen-title-row">
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h1>Tu periodo</h1>
        </div>
        <span class="period-chip">${periodLabel(summary.window)}</span>
      </div>

      <article class="period-close-hero ${report.freeFinal < 0 ? "negative" : "positive"}">
        <span>${report.isFinal ? "Libre al cerrar" : "Libre hoy"}</span>
        <strong>${formatMoney(report.freeFinal)}</strong>
        <p>${periodCloseHeroText(report)}</p>
      </article>

      ${renderPeriodStats(summary, review, plan)}
      ${renderPeriodCategories(review)}
      ${renderPeriodMerchants(review)}
      ${renderPeriodPayments(review)}
      ${renderNextPeriod(next)}

      <article class="period-close-panel period-close-adjust-panel">
        <div class="period-close-panel-head">
          <p class="eyebrow">Para el próximo periodo</p>
          <h2>${report.adjustments.length ? "Qué ajustar" : "Mantén el plan"}</h2>
        </div>
        <ol class="period-adjustments">
          ${report.adjustments.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ol>
      </article>

      ${renderPeriodExportCard(review)}

      <div class="period-close-actions">
        <p class="period-close-auto-note">No tienes que guardar nada: cuando termine el periodo, este resumen queda en Progreso.</p>
        <button class="btn ghost" type="button" data-view="budget">Volver al plan</button>
      </div>
    </section>
  `;
}

function renderPeriodStats(summary, review, plan) {
  const change = review.previous.change;
  const changeText =
    change === null
      ? "Aún no hay un periodo completo para comparar"
      : Math.abs(change) < 0.01
        ? "Igual que el anterior"
        : `${change > 0 ? "+" : "−"}${Math.round(Math.abs(change) * 100)}% que el anterior`;
  // The pay counts only when the app added it: one settled as Dinero extra is already
  // among the extras.
  const payIn = summary.incomeApplied ? Number(state.periodIncomeStatus?.amount || 0) : 0;
  const income = payIn + review.extraIncome;
  return `
    <div class="period-stats" aria-label="Números del periodo">
      <div><span>Entró</span><strong>${formatMoney(income)}</strong><small>${review.incomeCount} ${review.incomeCount === 1 ? "ingreso extra" : "ingresos extra"}${payIn > 0 ? " + sueldo" : ""}</small></div>
      <div><span>Gastaste</span><strong>${formatMoney(review.spent)}</strong><small>${review.expenseCount} ${review.expenseCount === 1 ? "gasto" : "gastos"}</small></div>
      <div><span>Contra el anterior</span><strong>${change === null ? "—" : formatMoney(review.previous.spent)}</strong><small>${changeText}</small></div>
      <div><span>Ahorro apartado</span><strong>${formatMoney(plan.savingsReserved)}</strong><small>Sigue reservado</small></div>
    </div>
  `;
}

function renderPeriodCategories(review) {
  if (!review.categories.length) {
    return "";
  }
  const shown = review.categories.slice(0, 6);
  return `
    <article class="period-close-panel">
      <div class="period-close-panel-head">
        <p class="eyebrow">En qué se fue</p>
        <h2>${formatMoney(review.spent)} por categoría</h2>
      </div>
      <div class="period-share-list">
        ${shown
          .map(
            (category) => `
          <div class="period-share-row ${category.id === FREE_CATEGORY_ID ? "is-unclassified" : ""}">
            <div class="period-share-top">
              <strong>${escapeHtml(category.name)}</strong>
              <span>${formatMoney(category.total)} · ${Math.round(category.share * 100)}%</span>
            </div>
            <div class="period-share-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round(category.share * 100))}%"></span></div>
          </div>
        `
          )
          .join("")}
      </div>
      ${
        review.unclassified.share >= 0.2
          ? `<p>${formatMoney(review.unclassified.total)} (${Math.round(review.unclassified.share * 100)}%) no tienen categoría, así que no sabes en qué se fueron. Clasificarlos te muestra a dónde se va tu plata de verdad.</p>
             <button class="btn secondary" type="button" data-action="review-uncategorized">Clasificar ${review.unclassified.count} ${review.unclassified.count === 1 ? "gasto" : "gastos"}</button>`
          : ""
      }
    </article>
  `;
}

function renderPeriodMerchants(review) {
  if (!review.merchants.length) {
    return "";
  }
  return `
    <article class="period-close-panel">
      <div class="period-close-panel-head">
        <p class="eyebrow">Dónde gastaste más</p>
        <h2>Tus comercios principales</h2>
      </div>
      <div class="period-plain-list">
        ${review.merchants
          .map(
            (merchant) => `<div><span>${escapeHtml(merchant.name)}<small>${merchant.count} ${merchant.count === 1 ? "vez" : "veces"}</small></span><strong>${formatMoney(merchant.total)}</strong></div>`
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderPeriodPayments(review) {
  const owed = liquiditySummary().credit;
  return `
    <article class="period-close-panel">
      <div class="period-close-panel-head">
        <p class="eyebrow">Cómo pagaste</p>
        <h2>Cuenta, efectivo y tarjeta</h2>
      </div>
      <div class="period-plain-list">
        <div><span>Cuenta</span><strong>${formatMoney(review.paidWith.account)}</strong></div>
        <div><span>Efectivo</span><strong>${formatMoney(review.paidWith.cash)}</strong></div>
        <div><span>Tarjeta de crédito<small>${review.credit.purchaseCount} ${review.credit.purchaseCount === 1 ? "compra" : "compras"}</small></span><strong>${formatMoney(review.paidWith.credit)}</strong></div>
        ${review.paidWith.unknown > 0 ? `<div><span>Sin dato</span><strong>${formatMoney(review.paidWith.unknown)}</strong></div>` : ""}
      </div>
      <p>${
        review.credit.paymentCount
          ? `Le pagaste ${formatMoney(review.credit.payments)} a la tarjeta en este periodo. `
          : ""
      }${owed > 0 ? `Hoy le debes ${formatMoney(owed)}.` : "Hoy no le debes nada a la tarjeta."}</p>
    </article>
  `;
}

function renderNextPeriod(next) {
  if (!next.fixed && !next.recurring && !next.planned) {
    return "";
  }
  const left = next.pay - next.recurring - next.planned;
  return `
    <article class="period-close-panel">
      <div class="period-close-panel-head">
        <p class="eyebrow">Tu próximo periodo</p>
        <h2>Desde el ${escapeHtml(next.startLabel)}</h2>
      </div>
      <div class="period-plain-list">
        ${
          next.fixed || next.payReceived
            ? `<div><span>Sueldo<small>${next.payReceived ? "Ya te llegó, adelantado" : "Esperado"}</small></span><strong>+${formatMoney(next.pay)}</strong></div>`
            : ""
        }
        <div><span>Categorías que se renuevan</span><strong>−${formatMoney(next.recurring)}</strong></div>
        <div><span>Gastos planeados</span><strong>−${formatMoney(next.planned)}</strong></div>
      </div>
      ${
        next.pay > 0
          ? `<p>${
              left >= 0
                ? `Te quedarían unos ${formatMoney(left)} libres para el resto, más lo que te sobre de este periodo.`
                : `Lo que ya tienes comprometido supera tu sueldo por ${formatMoney(Math.abs(left))}: revisa categorías o gastos planeados antes de que empiece.`
            }</p>`
          : ""
      }
    </article>
  `;
}

function renderPeriodExportCard(review) {
  return `
    <article class="period-report-card" aria-label="Exportar el periodo">
      <div class="period-report-head">
        <div>
          <p class="eyebrow">Analízalo con una IA</p>
          <h2>Exporta tu periodo</h2>
        </div>
      </div>
      <p>Un documento con tus ${review.expenseCount} gastos, ${review.incomeCount} ingresos, la tarjeta y tu plan, listo para guardarlo o pegarlo en un chat de IA y pedirle que lo analice. No incluye tu nombre ni tu correo.</p>
      <div class="period-report-actions">
        <button class="btn primary" type="button" data-action="share-period-export">Compartir documento</button>
        <button class="btn secondary" type="button" data-action="open-period-report">Ver y copiar</button>
      </div>
    </article>
  `;
}

function renderPeriodReportModal() {
  const content = currentPeriodReportText();
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-period-report">
      <section class="bottom-sheet period-report-modal" role="dialog" aria-modal="true" aria-labelledby="period-report-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div>
            <p class="eyebrow">Para una IA o para guardar</p>
            <h2 id="period-report-title">Tu periodo en un documento</h2>
          </div>
          <button class="icon-btn muted" type="button" data-action="close-period-report" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <textarea id="period-report-output" class="period-report-output" readonly>${escapeHtml(content)}</textarea>
        <div class="period-report-actions">
          <button class="btn primary" type="button" data-action="copy-period-report">Copiar</button>
          <button class="btn secondary" type="button" data-action="share-period-export">Compartir</button>
          <button class="btn ghost" type="button" data-action="close-period-report">Cerrar</button>
        </div>
      </section>
    </div>
  `;
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
  // Same "libre" as Inicio. Variable income keeps the unclamped figure so a period that
  // ended over budget still shows how far over it went.
  const freeFinal = Math.round(
    summary.usesLiquidityBasedFree ? summary.freeRemaining : summary.freeBudget - summary.freeImpactSpent
  );
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
    adjustments: periodCloseAdjustments(summary, plan, categories, freeFinal, prediction.remainingDays)
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

function periodCloseHeroText(report) {
  if (!report.isFinal) {
    return `Para ${report.remainingDays === 1 ? "el día que falta" : `los ${formatDays(report.remainingDays)} que faltan`}: unos ${formatMoney(dailyAllowance(report))} al día. Si sigues a tu ritmo, terminas con ${formatMoney(Math.max(0, report.prediction.projectedEndFree))}.`;
  }
  if (report.freeFinal < 0) {
    return `Faltaron ${formatMoney(Math.abs(report.freeFinal))} de dinero libre después de gastos sin categoría y excesos.`;
  }
  return `Quedaron ${formatMoney(report.freeFinal)} libres después de gastos sin categoría y excesos.`;
}

function periodCloseAdjustments(summary, plan, exceededCategories, freeFinal, remainingDays = 0) {
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
  // Before the last day the free money is still what the user lives on until payday;
  // suggesting to move all of it to savings "3 days before the end" was bad advice.
  if (!adjustments.length && freeFinal > 0 && remainingDays <= 0) {
    adjustments.push(`Mantén los límites y considera mover a ahorro los ${formatMoney(freeFinal)} que te sobraron antes de iniciar el próximo periodo.`);
  } else if (!adjustments.length && freeFinal > 0) {
    adjustments.push("Vas bien. Si al final del periodo te sobra dinero, puedes pasarlo a ahorro.");
  }
  if (!adjustments.length) {
    adjustments.push("Mantén el plan actual y registra gastos desde el primer día del próximo periodo.");
  }
  return adjustments.slice(0, 5);
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
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <button class="add-category-row" type="button" data-action="open-setaside-sheet">
          <span aria-hidden="true">$</span>
          <div class="add-category-row-text">
            <strong>Apartar dinero</strong>
            <small>Una vez, y queda guardado hasta que lo uses — gasolina para varios meses, el SOAT</small>
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

function renderCreditRow(liquidity) {
  return `<div class="money-location-row is-owed"><span class="money-location-icon" aria-hidden="true">${renderIcon("card")}</span><span class="money-location-text"><span>Tarjeta (ya lo debes)</span><strong>${liquidity.credit > 0 ? `-${formatMoney(liquidity.credit)}` : formatMoney(0)}</strong></span></div>`;
}

// Paying the card statement is NOT a new expense: it was recorded when the card was
// used. Money only moves from the account to what is owed, so the real total does not
// change. Recording it as an expense would count it twice.
function renderCreditPaymentSheet() {
  const liquidity = liquiditySummary();
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="credit-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Tarjeta</p><h2 id="credit-sheet-title">Registrar pago</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <p class="setaside-note">Esto no es un gasto nuevo: ya lo registraste cuando usaste la tarjeta. Aquí solo bajas lo que debes y sale de tu cuenta o efectivo, así que tu total real no cambia.</p>
        <form class="sheet-form" id="credit-payment-form">
          <label>
            ¿Cuánto pagaste?
            <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" required>
          </label>
          <div class="conversion-box">
            <span>Debes ahora</span>
            <strong>${formatMoney(liquidity.credit)}</strong>
          </div>
          <div class="sheet-field">
            <span class="sheet-label">¿De dónde salió?</span>
            ${renderChoicePills("source", [
              { value: "account", label: `Cuenta · ${formatCompactMoney(liquidity.account)}` },
              { value: "cash", label: `Efectivo · ${formatCompactMoney(liquidity.cash)}` }
            ], "account")}
          </div>
          <button class="btn primary" type="submit">Registrar pago</button>
        </form>
      </section>
    </div>
  `;
}

// Plain-language front door for reserving money, in the "envelope" mental model people
// already use ("aparté plata para los remedios"). Deliberately asks only two things —
// how much, and what for — where renderBudgetJobForm also asks for a frequency: this
// reserves once (cadence "once", or a top-up on a category of the same name) and the
// fund carries over until spent or released. Recurring reserves use the full form.
function renderSetAsideSheet() {
  const summary = budgetSummary();
  const reusable = state.budgetJobs.slice(0, 6);
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="setaside-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Tu plata</p><h2 id="setaside-sheet-title">Apartar dinero</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <p class="setaside-note">Queda apartado hasta que lo uses o lo liberes, aunque pasen varios periodos, y deja de contar como libre. Tu cuenta y tu efectivo siguen igual: aquí no se mueve dinero de verdad.</p>
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
  if (planSheet === "pay-received") {
    return renderPayReceivedSheet();
  }

  if (planSheet === "bank-unreadable") {
    return renderBankUnreadableSheet();
  }

  if (planSheet === "bank-disclosure") {
    return renderBankDisclosureSheet();
  }

  if (planSheet === "add-category-choice") {
    return renderAddCategoryChoiceSheet();
  }

  if (planSheet === "setaside") {
    return renderSetAsideSheet();
  }

  if (planSheet === "credit") {
    return renderCreditPaymentSheet();
  }

  if (planSheet === "edit-job") {
    return renderEditJobSheet();
  }

  if (planSheet === "category") {
    return `
      <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
        <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="category-sheet-title">
          <div class="sheet-handle"></div>
          <div class="sheet-heading">
            <div><p class="eyebrow">Plan</p><h2 id="category-sheet-title">Apartar cada semana o mes</h2></div>
            <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
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
  const draft = extraDraft || {};
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="extra-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><span class="extra-badge">Dinero extra</span><h2 id="extra-sheet-title">¿De dónde viene?</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <form class="sheet-form" id="extra-budget-form">
          ${
            draft.bankNotificationId
              ? `<input name="bankNotificationId" type="hidden" value="${escapeAttr(draft.bankNotificationId)}">
                 <p class="data-note quick-bank-note">De tu notificación de ${escapeHtml(draft.bank)}, ${escapeHtml(bankDateLabel(draft.date))}. Revisa y confirma.</p>`
              : ""
          }
          <label>Origen<input name="source" type="text" maxlength="36" placeholder="Ej. Bono trabajo" value="${escapeAttr(draft.source || "")}" required></label>
          <label>Monto<input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" value="${draft.amount ? escapeAttr(draft.amount) : ""}" required></label>
          <input name="date" type="hidden" value="${escapeAttr(draft.date || todayKey())}">
          <div class="sheet-field">
            <span class="sheet-label">¿Dónde entró?</span>
            ${renderChoicePills("location", [
              { value: "account", label: "Cuenta" },
              { value: "cash", label: "Efectivo" }
            ], draft.location || "account")}
          </div>
          ${
            canSeparateSavings()
              ? `<div class="extra-suggestion-card" aria-live="polite">
                  <span>Una sugerencia antes de sumarlo</span>
                  <strong data-extra-savings>${formatMoney(0)}</strong>
                  <p>para ${escapeHtml(target.label)}. Los <b data-extra-free>${formatMoney(0)}</b> restantes quedan libres. No mueve dinero de tu cuenta.</p>
                </div>
                <label>
                  <span>Porcentaje para ${escapeHtml(target.label)} <output data-extra-percent>20%</output></span>
                  <input name="savingsPercent" type="range" min="0" max="100" step="5" value="20" data-extra-range>
                </label>
                <button class="btn primary" type="submit" name="intent" value="split">Sumar dinero extra</button>
                <button class="btn ghost" type="submit" name="intent" value="all-free">Dejar todo libre</button>`
              : `<p class="data-note extra-limit-note">Ya tienes ${MAX_CATEGORIES} categorías, así que todo queda libre. Para separar una parte como ahorro, quita una categoría o crea una llamada "Ahorro" en su lugar.</p>
                <button class="btn primary" type="submit" name="intent" value="all-free">Sumar dinero extra</button>`
          }
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

// One reading of category names for the whole app (categorize.js), icons included.
function categoryIconFor(name) {
  const icon = INTENT_ICONS[categoryIntent(name)];
  if (icon) {
    return icon;
  }
  return /carro|moto/.test(String(name || "").toLowerCase()) ? "fuel" : "tag";
}

// A category's fund this period, and what of it can still go back to libre: the fund,
// net of anything already spent from it this period beyond the recurring limit.
function fundStanding(job) {
  const spent = spendByCategory()[job.id] || 0;
  const windowStart = budgetSummary().window.start;
  const budget = getBudgetAmountForJob(job, state.profile, windowStart, state.transactions);
  const fund = jobFund(job, state.profile, state.transactions, windowStart);
  const recurring = job.cadence === "once" ? 0 : getBudgetAmountForJob(job, state.profile);
  const releasable = Math.max(0, Math.min(fund.total, budget - Math.max(spent, recurring)));
  return { spent, windowStart, budget, fund, recurring, releasable };
}

function renderBudgetJob(job) {
  const { spent, budget, fund, releasable } = fundStanding(job);
  const isFundOnly = job.cadence === "once";
  const subtitle = isFundOnly
    ? `Apartado · ${formatMoney(fund.total)}${fund.usedBefore > 0 ? ` · ya usaste ${formatMoney(fund.usedBefore)} antes` : ""}`
    : `${capitalize(cadenceLabel(job.cadence))} · ${formatMoney(job.amount)}${fund.total > 0 ? ` + ${formatMoney(fund.total)} apartado` : ""}`;
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
            <span>${subtitle}</span>
          </div>
        </div>
        <button class="category-menu-btn" type="button" data-action="open-edit-job" data-id="${escapeAttr(job.id)}" aria-label="Editar o eliminar ${escapeAttr(job.name)}">&middot;&middot;&middot;</button>
      </div>
      <div class="category-card-bar ${band}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(ratio, 0, 100))}" aria-valuetext="${Math.round(ratio)} por ciento usado">
        <span style="width:${clamp(ratio, 0, 120)}%"></span>
      </div>
      <div class="category-card-foot">
        <span><strong>${formatMoney(spent)}</strong> usado</span>
        <span class="category-status">${status} · ${formatCompactMoney(remaining)} restante</span>
      </div>
      ${
        releasable > 0
          ? `<button class="btn ghost category-release-btn" type="button" data-action="release-fund" data-id="${escapeAttr(job.id)}">Liberar ${formatMoney(releasable)} apartado</button>`
          : ""
      }
    </article>
  `;
}

// "Editar categoría": its name and, for a recurring one, how much it gets and how often,
// from this period on (what was set aside in it stays as it is). For money set aside
// ("once"), the amount is what is set aside right now: raising it sets the difference
// aside and lowering it releases the difference, the same records "Apartar dinero" and
// "Liberar" leave, never below what was already spent from it.
function renderEditJobSheet() {
  const job = state.budgetJobs.find((item) => item.id === editingJobId);
  if (!job) {
    return "";
  }
  const isFundOnly = job.cadence === "once";
  const standing = fundStanding(job);
  const cadences = EDITABLE_CADENCES.some((option) => option.value === job.cadence)
    ? EDITABLE_CADENCES
    : [...EDITABLE_CADENCES, { value: job.cadence, label: capitalize(cadenceLabel(job.cadence)) }];
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-job-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Plan</p><h2 id="edit-job-title">Editar ${escapeHtml(job.name)}</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <form class="sheet-form" id="edit-job-form">
          <input name="id" type="hidden" value="${escapeAttr(job.id)}">
          <label>
            Nombre
            <input name="name" type="text" maxlength="32" value="${escapeAttr(job.name)}" required>
          </label>
          ${
            isFundOnly
              ? `<label>
                  Apartado
                  <input name="fund" type="number" min="${escapeAttr(Math.max(1000, standing.fund.total - standing.releasable))}" step="1000" inputmode="numeric" value="${escapeAttr(standing.fund.total)}" required>
                </label>
                <p class="setaside-note">Si lo subes, la diferencia sale de lo libre (tienes ${formatMoney(budgetSummary().freeRemaining)}). Si lo bajas, vuelve a lo libre${
                  standing.fund.total - standing.releasable > 0 ? `, hasta ${formatMoney(standing.fund.total - standing.releasable)}, porque eso ya lo usaste` : ""
                }.</p>`
              : `<label>
                  Monto
                  <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" value="${escapeAttr(job.amount)}" required>
                </label>
                <div class="sheet-field">
                  <span class="sheet-label">Cada cuánto</span>
                  ${renderChoicePills("cadence", cadences, job.cadence)}
                </div>
                <p class="setaside-note">El cambio rige desde este periodo. Lo que ya gastaste no cambia${hasFund(job) ? ", y lo que apartaste en ella sigue apartado" : ""}.</p>`
          }
          <button class="btn primary" type="submit">Guardar cambios</button>
          <button class="btn ghost destructive-link" type="button" data-action="request-remove-job" data-id="${escapeAttr(job.id)}">Eliminar categoría</button>
        </form>
      </section>
    </div>
  `;
}

function handleEditJobSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const job = state.budgetJobs.find((item) => item.id === data.get("id"));
  if (!job) {
    return;
  }
  const name = cleanText(data.get("name"), job.name);
  const duplicate = setAsideTarget(name).job;
  if (duplicate && duplicate.id !== job.id) {
    failCategoryForm(`Ya tienes una categoría llamada ${duplicate.name}.`);
    return;
  }
  const changes = { name };
  let before = 0;
  let after = 0;
  let fundChange = 0;
  if (job.cadence === "once") {
    const standing = fundStanding(job);
    const wanted = numberFrom(data.get("fund"));
    const floor = standing.fund.total - standing.releasable;
    fundChange = wanted - standing.fund.total;
    if (wanted <= 0 || wanted < floor) {
      failCategoryForm(floor > 0 ? `Ya usaste ${formatMoney(floor)} de ${job.name}: no puede quedar en menos.` : "Escribe un monto mayor que cero.");
      return;
    }
    const error = fundChange > 0 ? categoryReserveError({ name, amount: fundChange, createsCategory: false }) : "";
    if (error) {
      failCategoryForm(error);
      return;
    }
    before = standing.fund.total;
    after = wanted;
  } else {
    const amount = numberFrom(data.get("amount"));
    const cadence = JOB_CADENCE_VALUES.includes(data.get("cadence")) && data.get("cadence") !== "once" ? data.get("cadence") : job.cadence;
    before = getBudgetAmountForJob(job, state.profile);
    after = getBudgetAmountForJob({ ...job, amount, cadence }, state.profile);
    // Only what it takes on top of today's reserve has to fit in what is free.
    const error = categoryReserveError({ name, amount, reserves: Math.max(0, after - before), createsCategory: false });
    if (amount <= 0 || (after > before && error)) {
      failCategoryForm(amount <= 0 ? "Escribe un monto mayor que cero." : `${name} pasaría a apartar ${formatMoney(after)} por periodo; te faltan ${formatMoney(after - before - budgetSummary().freeRemaining)} libres para eso.`);
      return;
    }
    Object.assign(changes, { amount, cadence });
  }
  const now = new Date().toISOString();
  if (fundChange > 0) {
    setAsideForThisPeriod(job, job.name, fundChange, now);
  } else if (fundChange < 0) {
    job.released = [...(job.released || []), { windowStart: budgetSummary().window.start, amount: -fundChange }];
  }
  Object.assign(job, changes, { updated_at: now });
  planSheet = "";
  editingJobId = "";
  const spent = spendByCategory()[job.id] || 0;
  state.lastAlert =
    after === before
      ? `Listo, guardé ${job.name}.`
      : job.cadence === "once"
        ? `${job.name} ahora tiene ${formatMoney(after)} apartados (antes ${formatMoney(before)}). ${fundChange > 0 ? `Apartaste ${formatMoney(fundChange)} más.` : `${formatMoney(-fundChange)} volvieron a lo libre.`}`
        : `${job.name} ahora aparta ${formatMoney(after)} por periodo (antes ${formatMoney(before)}).${
          after < before && spent > after ? ` Ya usaste ${formatMoney(spent)}, así que este periodo queda por encima del límite: no pasa nada, solo tenlo en cuenta.` : ""
        }`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  saveState();
  render();
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
  const futureRaise = summary.baseIncome * (state.settings.monthlyRaisePct / 100);
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
          <span>más para ahorrar cada periodo</span>
        </div>
        <form id="smart-form" class="simulator-form" data-period-income="${summary.baseIncome}">
          <label>
            <span>Aumento hipotético <output data-raise-output>${state.settings.monthlyRaisePct}%</output></span>
            <input name="monthlyRaisePct" type="range" min="0" max="100" step="1" value="${state.settings.monthlyRaisePct}">
          </label>
          <label>
            <span>Porción del aumento al ahorro <output data-escalation-output>${state.settings.escalationPct}%</output></span>
            <input name="escalationPct" type="range" min="0" max="100" step="5" value="${state.settings.escalationPct}">
          </label>
        </form>
      </article>

      <article class="reference-fund">
        <div><p class="eyebrow">Fondo de emergencia</p><h2>${targetCovered ? "Meta cubierta" : `${periodsToTarget || "Sin"} periodos estimados`}</h2></div>
        ${renderProgress(plan.emergencyProgress, "Avance simulado con el ahorro actual")}
        <p>Es una proyección orientativa, no una promesa.</p>
      </article>
    </section>
  `;
}

function renderCalendar() {
  const events = calendarEventsSorted();
  const upcomingEvents = events.filter((event) => event.date >= todayKey() && !event.spent);
  const nextEvent = upcomingEvents[0] || null;
  const nextThirtyTotal = calendarEstimateForDays(30);

  return `
    <section class="screen-view calendar-view" aria-label="Gastos planeados">
      <div class="screen-title-row">
        <div>
          <p class="eyebrow">Fechas que traen gastos</p>
          <h1>Gastos planeados</h1>
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
      </div>

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
          <label>
            Se repite
            <select name="repeat">
              <option value="">Una vez</option>
              <option value="weekly">Cada semana</option>
              <option value="monthly">Cada mes</option>
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
        <small>${event.repeat ? `${escapeHtml(repeatLabel(event.repeat))} &middot; ` : ""}${escapeHtml(category)}${event.notes ? ` &middot; ${escapeHtml(event.notes)}` : ""}</small>
      </div>
      <div class="event-amount">
        <strong>${formatMoney(event.amount)}</strong>
        <small>${formatRelativeEventDate(event.date)}</small>
      </div>
      <div class="event-actions">
        ${
          event.spent
            ? `<button class="btn ghost" type="button" data-action="reopen-calendar-event" data-id="${escapeAttr(event.id)}">Reabrir</button>`
            : `<button class="btn secondary" type="button" data-action="register-calendar-event" data-id="${escapeAttr(event.id)}">Registrar gasto</button>
               ${event.repeat ? `<button class="btn ghost" type="button" data-action="skip-calendar-event" data-id="${escapeAttr(event.id)}">Omitir esta vez</button>` : ""}`
        }
        <button class="icon-btn muted" type="button" data-action="remove-calendar-event" data-id="${escapeAttr(event.id)}" aria-label="Eliminar ${escapeAttr(event.title)}">${renderIcon("close")}</button>
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
  const selectedSource = draft.source || lastExpenseSource(state.transactions);
  // A calendar event already prefilled the form; offering unrelated repeats there would
  // only invite overwriting it by accident.
  const repeats = draft.calendarEventId || draft.bankNotificationId ? [] : quickExpenseRepeats();
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
          ${
            draft.bankNotificationId
              ? `<input name="bankNotificationId" type="hidden" value="${escapeAttr(draft.bankNotificationId)}">
                 <input name="expenseDate" type="hidden" value="${escapeAttr(draft.date)}">
                 ${draft.source ? `<input name="bankSourceKnown" type="hidden" value="1">` : ""}
                 <p class="data-note quick-bank-note">De tu notificación de ${escapeHtml(draft.bank)}, ${escapeHtml(bankDateLabel(draft.date))}. Revisa y confirma.</p>`
              : ""
          }
          ${renderQuickExpenseRepeats(repeats)}
          <label class="quick-amount">
            <span>Monto</span>
            <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" value="${draft.amount ? escapeAttr(draft.amount) : ""}" required data-autofocus>
          </label>
          <label>
            Comercio opcional
            <input name="merchant" type="text" maxlength="42" placeholder="Ej. Tienda, Terpel" value="${escapeAttr(draft.merchant || "")}">
          </label>
          ${renderMerchantRuleSuggestion()}
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
            ${renderChoicePills("source", expenseSourceOptions(liquidity), selectedSource)}
          </div>
          ${draft.bankNotificationId ? "" : renderExpenseDateField()}
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

// When it was: today unless told otherwise, so recording something now costs no extra tap.
// Yesterday, or any earlier day, is for what was forgotten or that the bank never
// notified. Never a future day: a purchase that has not happened is a planned expense.
function renderExpenseDateField() {
  const today = todayKey();
  return `
    <div class="quick-field expense-date-field">
      <span class="quick-label">¿Cuándo fue?</span>
      ${renderChoicePills("dateChoice", [
        { value: "today", label: "Hoy" },
        { value: "yesterday", label: "Ayer" },
        { value: "other", label: "Otro día" }
      ], "today")}
      <input name="expenseDateOther" type="date" max="${escapeAttr(today)}" value="${escapeAttr(previousDay(previousDay(today)))}" aria-label="Fecha del gasto" hidden>
    </div>
  `;
}

function bindExpenseDateField(form) {
  const other = form.elements.namedItem("expenseDateOther");
  if (!other) {
    return;
  }
  form.querySelectorAll('[data-choice-name="dateChoice"]').forEach((pill) => {
    pill.addEventListener("click", () => {
      other.hidden = pill.dataset.choiceValue !== "other";
      if (!other.hidden) {
        other.focus();
      }
    });
  });
}

// The day an expense happened, or "" when "Otro día" has no valid past date.
function expenseDateFromForm(data) {
  const fromBank = cleanText(data.get("expenseDate"), "");
  if (fromBank) {
    return cleanDate(fromBank, todayKey());
  }
  const today = todayKey();
  const choice = String(data.get("dateChoice") || "today");
  if (choice === "yesterday") {
    return previousDay(today);
  }
  if (choice === "other") {
    const picked = String(data.get("expenseDateOther") || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(picked) && picked <= today ? picked : "";
  }
  return today;
}

// The card shows what you ALREADY owe, not an available balance: the app does not know
// the credit limit, and what is useful while recording is how much you have run up.
function expenseSourceOptions(liquidity = liquiditySummary()) {
  return [
    { value: "account", label: `Cuenta · ${formatCompactMoney(liquidity.account)}` },
    { value: "cash", label: `Efectivo · ${formatCompactMoney(liquidity.cash)}` },
    { value: "credit", label: liquidity.credit > 0 ? `Tarjeta · debes ${formatCompactMoney(liquidity.credit)}` : "Tarjeta" }
  ];
}

function quickExpenseRepeats() {
  return frequentExpenses(state.transactions, {
    today: todayKey(),
    validCategoryIds: new Set(state.budgetJobs.map((job) => job.id))
  });
}

// Filling the form, not submitting it: prices drift (the tanqueo is rarely the exact same
// amount twice), so the amount stays selected for a quick correction before "Registrar".
function renderQuickExpenseRepeats(repeats) {
  if (!repeats.length) {
    return "";
  }
  return `
    <div class="quick-repeats quick-field" role="group" aria-label="Repetir un gasto frecuente">
      <span class="quick-label">Repetir</span>
      <div class="quick-repeat-list">
        ${repeats
          .map(
            (repeat) => `
              <button class="quick-repeat" type="button"
                data-repeat-amount="${escapeAttr(repeat.amount)}"
                data-repeat-merchant="${escapeAttr(repeat.merchant)}"
                data-repeat-category="${escapeAttr(repeat.category)}"
                data-repeat-source="${escapeAttr(repeat.source)}">
                <strong>${escapeHtml(repeat.merchant)}</strong>
                <span>${formatMoney(repeat.amount)} · ${escapeHtml(repeat.category === FREE_CATEGORY_ID ? "Libre" : categoryName(repeat.category))} · ${escapeHtml(locationLabel(repeat.source))}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function bindQuickExpenseRepeats(form) {
  form.querySelectorAll("[data-repeat-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      const amountInput = form.elements.namedItem("amount");
      const merchantInput = form.elements.namedItem("merchant");
      if (amountInput) {
        amountInput.value = formatMoneyInputValue(button.dataset.repeatAmount);
      }
      if (merchantInput) {
        merchantInput.value = button.dataset.repeatMerchant || "";
      }
      setFormChoiceValue(form, "category", button.dataset.repeatCategory || FREE_CATEGORY_ID);
      setFormChoiceValue(form, "source", normalizeLocation(button.dataset.repeatSource));
      form.querySelectorAll("[data-repeat-amount]").forEach((item) => item.classList.toggle("is-active", item === button));
      // The repeat already chose category and source; a merchant-rule suggestion
      // re-appearing on top of that would only be noise.
      form.dispatchEvent(new CustomEvent("quick-expense-prefilled"));
      amountInput?.focus({ preventScroll: true });
      amountInput?.select?.();
    });
  });
}

function movementSourceIcon(source) {
  const key = normalizeLocation(source);
  if (key === "cash") {
    return "cash";
  }
  return key === "credit" ? "card" : "account";
}

function categoryChoiceOptions() {
  return [
    { value: FREE_CATEGORY_ID, label: "Libre" },
    ...state.budgetJobs.map((job) => ({ value: job.id, label: job.name }))
  ];
}

// Filled in by bindMerchantRuleSuggestions once the form is live, since applying a rule
// depends on what the user has already picked by hand.
function renderMerchantRuleSuggestion() {
  return `<div class="merchant-rule-suggestion" data-merchant-rule-suggestion role="status" hidden></div>`;
}

function merchantRuleAppliedMarkup(rule, applied) {
  const parts = [];
  if (applied.includes("category")) {
    parts.push(`<strong>${escapeHtml(categoryName(rule.category))}</strong>`);
  }
  if (applied.includes("source")) {
    parts.push(`<strong>${escapeHtml(locationLabel(rule.source))}</strong>`);
  }
  if (rule.via === "dictionary") {
    return `<span>Puse ${parts.join(" y ")} por el nombre del comercio. Cámbialo abajo si no es.</span>`;
  }
  return `<span>Puse ${parts.join(" y ")}, como las veces anteriores. Cámbialo abajo si esta vez fue distinto.</span>`;
}

function renderMerchantRulesPanel() {
  const allRules = activeMerchantRules();
  const rules = allRules.slice(0, 4);
  if (!rules.length) {
    return "";
  }
  const hidden = allRules.length - rules.length;

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
            <span><strong>${escapeHtml(rule.merchant)}</strong> → ${escapeHtml(categoryName(rule.category))} · ${locationLabel(rule.source)}</span>
            <button class="icon-btn muted" type="button" data-action="remove-merchant-rule" data-id="${escapeAttr(rule.id)}" aria-label="Quitar regla de ${escapeAttr(rule.merchant)}">${renderIcon("close")}</button>
          </div>
        `).join("")}
      </div>
      <p class="data-note">${hidden > 0 ? `Se muestran los 4 más recientes de ${allRules.length}. ` : ""}Recordamos hasta ${MAX_MERCHANT_RULES} comercios; los que no usas hace más tiempo se olvidan solos. Para cambiar uno, clasifica su próximo gasto en otra categoría.</p>
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

// Movimientos used to show only the current period: "how much did I spend on groceries
// last month?" had no answer inside the app. The period being viewed is the current one
// shifted back `movementsPeriodOffset` times, using the real period boundaries (months
// are not all the same length).
function movementsViewSummary(summary = budgetSummary()) {
  let window = summary.window;
  for (let step = 0; step > movementsPeriodOffset; step -= 1) {
    window = getBudgetWindow(state.profile, previousDay(window.start));
  }
  return window === summary.window ? summary : { ...summary, window };
}

function hasMovementsBefore(dateKey) {
  return (
    (state.transactions || []).some((transaction) => String(transaction.date || "").slice(0, 10) < dateKey) ||
    (state.budgetExtras || []).some((extra) => String(extra.date || "").slice(0, 10) < dateKey)
  );
}

function renderMovementsPeriodNav(view) {
  // The dates are right below, in the calendar's title; this only says where you are.
  const label =
    movementsPeriodOffset === 0
      ? "Este periodo"
      : movementsPeriodOffset === -1
        ? "Periodo anterior"
        : `Hace ${-movementsPeriodOffset} periodos`;
  const canGoBack = hasMovementsBefore(view.window.start);
  return `
    <div class="movements-period-nav">
      <button type="button" data-action="movements-prev-period" aria-label="Periodo anterior" ${canGoBack ? "" : "disabled"}>&lsaquo;</button>
      <span>${label}</span>
      <button type="button" data-action="movements-next-period" aria-label="Periodo siguiente" ${movementsPeriodOffset === 0 ? "disabled" : ""}>&rsaquo;</button>
    </div>
  `;
}

function renderMovements() {
  const summary = movementsViewSummary();
  const movements = movementsForSummary(summary);
  const movementCountLabel = movements.length === 1 ? "movimiento" : "movimientos";
  const pendingCount = movementsPeriodOffset === 0 ? unclassifiedTransactionsForSummary(summary).length : 0;
  return `
    <section class="screen-view movements-view" aria-label="Movimientos">
      <div class="screen-title-row movements-heading">
        <div><p class="eyebrow">Historial del periodo</p><h1>Movimientos</h1></div>
        <span class="period-chip">${movements.length} ${movementCountLabel}</span>
      </div>
      ${renderMovementsPeriodNav(summary)}
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
                <button type="button" data-action="clear-movements-date-filter" aria-label="Quitar filtro de fecha">${renderIcon("close")}</button>
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
  return expenseCalendar(state.transactions, summary.window, todayKey());
}








function renderTransactionHistory(summary = budgetSummary(), sort = "recent", filter = "all", search = "", date = "") {
  const movements = listMovements(movementsForSummary(summary), { sort, filter, search, date });

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
                <span class="movement-type-icon ${normalizeLocation(transaction.source)}" aria-hidden="true">${renderIcon(movementSourceIcon(transaction.source))}</span>
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
          <button class="icon-btn muted" type="button" data-action="close-transaction-editor" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <div class="editor-amount">${formatMoney(transaction.amount)}<span>${formatDate(transaction.date)}</span></div>
        <form class="sheet-form" id="transaction-edit-form">
          <div class="sheet-field">
            <span class="sheet-label">Categoría</span>
            ${renderChoicePills("category", categoryChoiceOptions(), transaction.category || FREE_CATEGORY_ID)}
          </div>
          <div class="sheet-field">
            <span class="sheet-label">Pagado con</span>
            ${renderChoicePills("source", expenseSourceOptions(), normalizeLocation(transaction.source))}
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
  const suggestions = new Map(pending.map((transaction) => [transaction.id, findMerchantRule(transaction.merchant)?.category || ""]));
  const suggestedCount = [...suggestions.values()].filter(Boolean).length;
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-quick-classify">
      <section class="bottom-sheet quick-classify-panel" role="dialog" aria-modal="true" aria-labelledby="quick-classify-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Clasificar pendientes</p><h2 id="quick-classify-title">${pending.length} ${pending.length === 1 ? "movimiento sin categoría" : "movimientos sin categoría"}</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-quick-classify" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        ${
          suggestedCount
            ? `<button class="btn primary" type="button" data-action="accept-classify-suggestions">Aceptar ${suggestedCount === 1 ? "la sugerida" : `las ${suggestedCount} sugeridas`}</button>`
            : ""
        }
        <div class="quick-classify-list">
          ${pending
            .map((transaction) => {
              const suggested = suggestions.get(transaction.id);
              const chips = suggested
                ? [...categoryChips.filter((option) => option.value === suggested), ...categoryChips.filter((option) => option.value !== suggested)]
                : categoryChips;
              return `
                <article class="quick-classify-row">
                  <div class="quick-classify-row-head">
                    <strong>${escapeHtml(transaction.merchant)}</strong>
                    <span>${formatMoney(transaction.amount)} · ${formatDate(transaction.date)}${suggested ? ` · sugerida: ${escapeHtml(categoryName(suggested))}` : ""}</span>
                  </div>
                  ${
                    categoryChips.length
                      ? `<div class="choice-pills">
                          ${chips
                            .map(
                              (option) => `
                                <button class="choice-pill ${option.value === suggested ? "is-suggested" : ""}" type="button" data-action="quick-classify" data-id="${escapeAttr(transaction.id)}" data-category="${escapeAttr(option.value)}">${escapeHtml(option.label)}</button>
                              `
                            )
                            .join("")}
                        </div>`
                      : `<p class="quick-classify-empty">Aún no tienes categorías creadas. Crea una desde Plan para poder clasificar.</p>`
                  }
                </article>
              `;
            })
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
          <button class="icon-btn muted" type="button" data-action="close-extra-editor" aria-label="Cerrar">${renderIcon("close")}</button>
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
            ], normalizeIncomeLocation(extra.location))}
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
          ${renderCreditRow(liquidity)}
          <div class="money-location-row"><span class="money-location-icon" aria-hidden="true">${renderIcon("calculator")}</span><span class="money-location-text"><span>Total real</span><strong>${formatMoney(liquidity.total)}</strong></span></div>
        </div>
        ${
          liquidity.credit > 0
            ? `<button class="btn ghost" type="button" data-action="open-credit-payment">Registrar pago de tarjeta</button>`
            : `<small class="data-note">Cuando pagues algo con tarjeta, aquí verás cuánto debes y podrás anotar el pago.</small>`
        }
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("income")}</span><div><strong>Recomendación</strong><small>Para este periodo</small></div><button type="button" data-view="savings">Ver ahorro</button></div>
        <div class="data-metrics three"><div><span>${budgetSummary().extraIncome > 0 ? "Presupuesto + extra" : "Presupuesto"}</span><strong>${formatMoney(budgetSummary().income)}</strong></div><div><span>Podrías apartar</span><strong>${formatMoney(plan.suggestedPeriodSavings)}</strong></div><div><span>Libre después</span><strong>${formatMoney(plan.freeAfterSuggestion)}</strong></div></div>
        <p class="data-note">Es una simulación: no modifica tu presupuesto ni tus saldos.</p>
      </article>

      <article class="data-section settings-section">
        <div class="data-section-heading"><span class="data-icon">${renderIcon("menu")}</span><div><strong>Ajustes</strong><small>Apariencia, guía y recordatorio diario</small></div></div>
        ${renderThemeSwitcher()}
        <button class="btn ghost" type="button" data-action="start-tour">Ver la guía de la app</button>
      </article>
      ${renderDailyReminderPanel()}
      ${renderBankNotificationsPanel()}

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

      ${
        isLocalOnly()
          ? `<article class="data-section local-only-section">
              <div><strong>Sin cuenta</strong><span>Tus datos están solo en este teléfono. Si lo pierdes o borras la app, se pierden. Con una cuenta tienes copia en la nube.</span></div>
              <button class="btn primary" type="button" data-action="request-account">Crear cuenta o iniciar sesión</button>
            </article>`
          : `<article class="sign-out-section">
              <div><strong>${escapeHtml(cloudState.email)}</strong><span>Tus datos se borrarán de este teléfono. Siguen en tu cuenta.</span></div>
              <button class="btn ghost" type="button" data-action="cloud-sign-out">Cerrar sesión</button>
            </article>

            <article class="sign-out-section is-destructive">
              <div><strong>Eliminar cuenta y datos</strong><span>Borra tu presupuesto, movimientos y ahorro guardados en la nube. No se puede deshacer.</span></div>
              <button class="btn danger" type="button" data-action="open-delete-account">Eliminar cuenta</button>
            </article>`
      }
      ${renderPrivacyLink()}
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
  const closures = finishedPeriodClosures();

  if (!closures.length) {
    return `
      <section class="screen-view progress-view" aria-label="Progreso">
        <div class="screen-title-row">
          <div><p class="eyebrow">Historial entre periodos</p><h1>Progreso</h1></div>
        </div>
        <div class="empty-state actionable-empty">
          <p>Cuando termine tu primer periodo, aquí verás cómo te fue y cómo cambia tu resultado de un periodo a otro. No tienes que hacer nada: se guarda solo.</p>
          <button class="btn primary" type="button" data-view="periodClose">Ver cómo va este periodo</button>
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
                <div class="bar ${band}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(ratio, 0, 100))}" aria-valuetext="${Math.round(ratio)} por ciento del ingreso gastado">
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


function weekdaySpendingInsight(summary) {
  const pattern = weekdayPattern(transactionsForSummary(summary));
  if (!pattern) {
    return null;
  }
  const day = WEEKDAY_NAMES[pattern.day];
  return {
    icon: "calendar",
    title: `Los ${day}s concentran tus gastos`,
    detail: `Gastaste ${formatMoney(pattern.total)} en ${day}s este periodo, ${Math.round(pattern.share)}% de lo que llevas gastado.`
  };
}

function categoryTrendInsight(summary) {
  const trend = categoryTrend(state.transactions, summary.window);
  if (!trend) {
    return null;
  }
  return {
    icon: "trend",
    title: `${categoryName(trend.category)} subió frente al periodo pasado`,
    detail: `Gastaste ${formatMoney(trend.current)}, ${Math.round(trend.pct)}% más que los ${formatMoney(trend.previous)} del periodo anterior.`
  };
}

function smallExpensesInsight(summary) {
  const small = smallExpenses(transactionsForSummary(summary), Number(summary.totalSpent || 0));
  if (!small) {
    return null;
  }
  return {
    icon: "cash",
    title: "Gasto hormiga acumulado",
    detail: `${small.count} gastos menores a ${formatMoney(SMALL_EXPENSE_THRESHOLD)} suman ${formatMoney(small.total)}, ${Math.round(small.share)}% de lo gastado este periodo.`
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
            <p>Así calculamos cuánto tienes disponible en cada periodo.</p>
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
            <small class="balance-hint" data-onboarding-balance>Puedes ajustar esto después, cuando quieras, desde Datos.</small>
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
        ${
          isLocalOnly()
            ? `<p class="auth-privacy">¿Ya tienes cuenta? <button class="auth-switch-link" type="button" data-action="request-account" data-auth-mode="signin">Inicia sesión</button></p>`
            : ""
        }
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
          <button class="icon-btn" type="button" data-action="close-diagnosis" aria-label="Cerrar">${renderIcon("close")}</button>
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
  const available = liquidity.initialized ? liquidity : { account: 0, cash: 0, credit: 0 };
  return `
    <label>
      Dinero en cuenta
      <input name="account" type="number" step="1000" value="${available.account}" data-allow-negative="true" required ${diagnosisInvalidAttr("account")}>
      ${renderDiagnosisFieldError("account")}
    </label>
    <label>
      Dinero en físico
      <input name="cash" type="number" step="1000" value="${available.cash}" data-allow-negative="true" required ${diagnosisInvalidAttr("cash")}>
      ${renderDiagnosisFieldError("cash")}
    </label>
    <label>
      Lo que debes en la tarjeta
      <input name="credit" type="number" min="0" step="1000" value="${available.credit}" required ${diagnosisInvalidAttr("credit")}>
      ${renderDiagnosisFieldError("credit")}
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
  if (ratio <= 0) {
    return "Sin gastos todavía";
  }
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
              <div class="bar ${category.band}" aria-label="${escapeAttr(category.name)}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(category.ratio, 0, 100))}" aria-valuetext="${Math.round(category.ratio)} por ciento usado">
                <span style="width:${clamp(category.ratio, 0, 120)}%"></span>
              </div>
              <span class="category-status">${categoryStatusLabel(category.ratio)}${category.ratio > 0 ? ` · ${Math.round(clamp(category.ratio, 0, 999))}%` : ""}</span>
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
      <div class="progress-track" role="progressbar" aria-label="${escapeAttr(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(safeValue)}">
        <span style="width:${safeValue}%"></span>
      </div>
    </div>
  `;
}

function bindEvents() {
  bindMoneyInputs();
  bindDateCaptions();
  document.querySelectorAll("[data-money-details]").forEach((details) => {
    details.addEventListener("toggle", () => {
      moneyDetailsOpen[details.dataset.moneyDetails] = details.open;
    });
  });
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

  const editJobForm = document.querySelector("#edit-job-form");
  if (editJobForm) {
    editJobForm.addEventListener("submit", handleEditJobSubmit);
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

  const payReceivedForm = document.querySelector("#pay-received-form");
  if (payReceivedForm) {
    payReceivedForm.addEventListener("submit", handlePayReceivedSubmit);
  }

  const creditPaymentForm = document.querySelector("#credit-payment-form");
  if (creditPaymentForm) {
    creditPaymentForm.addEventListener("submit", handleCreditPaymentSubmit);
  }

  const extraBudgetForm = document.querySelector("#extra-budget-form");
  if (extraBudgetForm) {
    bindExtraSheetPreview(extraBudgetForm);
    extraBudgetForm.addEventListener("submit", handleExtraBudgetSubmit);
  }

  const transactionForm = document.querySelector("#transaction-form");
  if (transactionForm) {
    bindMerchantRuleSuggestions(transactionForm);
    bindQuickExpenseRepeats(transactionForm);
    bindExpenseDateField(transactionForm);
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
  document.querySelector("[data-lock-forgot]")?.addEventListener("click", () => {
    lockMode = "forgot";
    lockDigits = "";
    lockError = "";
    render();
  });
  document.querySelector("[data-lock-forgot-back]")?.addEventListener("click", () => {
    lockMode = "unlock";
    lockError = "";
    render();
  });
  document.querySelector("#lock-forgot-form")?.addEventListener("submit", handleLockForgotSubmit);
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
      (dialog.querySelector("[data-autofocus]") || firstFocusable(dialog))?.focus({ preventScroll: true });
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
  Object.assign(state, settlePeriodIncomeAtOnboarding(profileDraft, todayKey(), now));
  state.budgetJobs = jobs;
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Creaste tu primer plan y viste cuánto puedes gastar."
  });
  state.lastAlert = "Plan listo. Registra tu primer gasto cuando ocurra.";
  activateView(DEFAULT_VIEW);
  saveState();
  render();
  if (!state.settings.tourDone) {
    startTour();
  } else {
    showNoticeSnackbar(state.lastAlert);
  }
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
    const total = (numberValue(data.get("account")) ?? 0) + (numberValue(data.get("cash")) ?? 0) - numberFrom(data.get("credit"));
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
          ? exceeds
            ? `<span>Después de apartar</span><strong>Te pasas por ${formatMoney(amount - available)}</strong><small>Ahora tienes ${formatMoney(available)} libres.</small>`
            : `<span>Después de apartar</span><strong>Te quedarían ${formatMoney(available - amount)} libres</strong><small>Ahora tienes ${formatMoney(available)} libres.</small>`
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
    const periodIncome = Number(form.dataset.periodIncome || 0);
    const raiseValue = Number(raise.value || 0);
    const escalationValue = Number(escalation.value || 0);
    if (raiseOutput) raiseOutput.value = `${raiseValue}%`;
    if (escalationOutput) escalationOutput.value = `${escalationValue}%`;
    if (result) result.textContent = formatMoney(periodIncome * (raiseValue / 100) * (escalationValue / 100));
  };
  raise?.addEventListener("input", update);
  escalation?.addEventListener("input", update);
  // Remembered when the slider is released; there is nothing to "save" in a simulation.
  raise?.addEventListener("change", () => form.requestSubmit());
  escalation?.addEventListener("change", () => form.requestSubmit());
}

// A merchant seen before fills in its usual category and way of paying on its own; it used
// to only show a "Usar sugerencia" button, one more tap on every repeated expense. Never
// overrides a choice made by hand (or by a calendar event / repeat chip), and undoes its
// own change if the merchant is edited into one with no rule.
function bindMerchantRuleSuggestions(form) {
  const merchantInput = form.elements.namedItem("merchant");
  const suggestion = form.querySelector("[data-merchant-rule-suggestion]");
  if (!merchantInput || !suggestion) {
    return;
  }

  const pickedByHand = new Set();
  if ((form.elements.namedItem("category")?.value || FREE_CATEGORY_ID) !== FREE_CATEGORY_ID) {
    pickedByHand.add("category");
  }
  // The bank's notification said how it was paid (card or account): that is a fact, not
  // a habit to fill in from earlier purchases at the same merchant.
  if (form.elements.namedItem("bankSourceKnown")) {
    pickedByHand.add("source");
  }
  let autoApplied = null;

  const hide = () => {
    suggestion.hidden = true;
    suggestion.innerHTML = "";
  };

  const restoreBeforeAutoApply = () => {
    if (!autoApplied) {
      return;
    }
    Object.entries(autoApplied.before).forEach(([name, value]) => {
      if (!pickedByHand.has(name)) {
        setFormChoiceValue(form, name, value);
      }
    });
    autoApplied = null;
  };

  const update = () => {
    const rule = findMerchantRule(merchantInput.value);
    if (!rule) {
      restoreBeforeAutoApply();
      hide();
      return;
    }
    if (autoApplied?.ruleId === rule.id) {
      return;
    }
    restoreBeforeAutoApply();
    const targets = rule.source ? { category: rule.category, source: normalizeLocation(rule.source) } : { category: rule.category };
    const before = {};
    const applied = [];
    Object.entries(targets).forEach(([name, value]) => {
      const current = form.elements.namedItem(name)?.value;
      if (pickedByHand.has(name) || current === value) {
        return;
      }
      before[name] = current;
      setFormChoiceValue(form, name, value);
      applied.push(name);
    });
    if (!applied.length) {
      hide();
      return;
    }
    autoApplied = { ruleId: rule.id, before };
    suggestion.innerHTML = merchantRuleAppliedMarkup(rule, applied);
    suggestion.hidden = false;
  };

  form.querySelectorAll('[data-choice-name="category"], [data-choice-name="source"]').forEach((pill) => {
    pill.addEventListener("click", () => {
      pickedByHand.add(pill.dataset.choiceName);
      autoApplied = null;
      hide();
    });
  });
  form.addEventListener("quick-expense-prefilled", () => {
    pickedByHand.add("category");
    pickedByHand.add("source");
    autoApplied = null;
    hide();
  });
  merchantInput.addEventListener("input", update);
  merchantInput.addEventListener("change", update);
  update();
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
    "movements-prev-period",
    "movements-next-period",
    "clear-movements-date-filter",
    "close-expense",
    "show-auth-form",
    "back-auth-options",
    "request-account",
    "open-add-category-choice",
    "open-category-sheet",
    "open-setaside-sheet",
    "open-extra-sheet",
    "open-credit-payment",
    "close-plan-sheet",
    "request-remove-job",
    "open-edit-job",
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
    "share-period-export",
    "review-uncategorized",
    "export-movements-csv",
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
    "retry-cloud-sync",
    "open-bank-disclosure",
    "open-bank-unreadable",
    "forget-bank-unreadable",
    "register-bank-suggestion",
    "register-bank-income",
    "dismiss-bank-suggestion",
    "open-pay-received",
    "confirm-bank-pay"
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
    "movements-prev-period": () => {
      movementsPeriodOffset -= 1;
      transactionHistoryDate = "";
    },
    "movements-next-period": () => {
      movementsPeriodOffset = Math.min(0, movementsPeriodOffset + 1);
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
    "use-without-account": () => startLocalOnly(),
    "start-tour": () => {
      activateView(DEFAULT_VIEW);
      requestAnimationFrame(() => startTour());
    },
    "request-account": () => {
      accountRequested = true;
      menuOpen = false;
      authMode = event.currentTarget.dataset.authMode === "signin" ? "signin" : "";
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
      extraDraft = null;
      planSheet = "extra";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "open-credit-payment": () => {
      planSheet = "credit";
      menuOpen = false;
      predictionDetailsOpen = false;
      periodReportOpen = false;
    },
    "close-plan-sheet": () => {
      planSheet = "";
    },
    "release-fund": () => releaseFund(id),
    "open-edit-job": () => {
      editingJobId = id;
      planSheet = "edit-job";
    },
    "request-remove-job": () => {
      planSheet = "";
      editingJobId = "";
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
    "share-period-export": sharePeriodExport,
    "review-uncategorized": () => {
      transactionHistoryFilter = "uncategorized";
      movementsPeriodOffset = 0;
      activateView("movements");
    },
    "export-movements-csv": downloadMovementsCsv,
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
        classifyTransaction(transaction, category);
        showNoticeSnackbar(`Clasificado como ${categoryName(transaction.category)}.`, { renderNow: false });
      }
      quickClassifyQueue = quickClassifyQueue.filter((queuedId) => queuedId !== id);
    },
    "accept-classify-suggestions": () => {
      let classified = 0;
      quickClassifyQueue = quickClassifyQueue.filter((queuedId) => {
        const transaction = state.transactions.find((item) => item.id === queuedId);
        const suggested = transaction && findMerchantRule(transaction.merchant)?.category;
        if (!suggested) {
          return true;
        }
        classifyTransaction(transaction, suggested);
        classified += 1;
        return false;
      });
      showNoticeSnackbar(`Clasifiqué ${classified} ${classified === 1 ? "movimiento" : "movimientos"}.`, { renderNow: false });
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
    "open-bank-unreadable": () => {
      planSheet = "bank-unreadable";
    },
    "forget-bank-unreadable": () => {
      const ids = bankUnreadable.map((notification) => notification.id);
      bankUnreadable = [];
      planSheet = "";
      try {
        nativeBankNotifications()?.dismiss({ ids })?.catch?.(() => {});
      } catch {}
      showNoticeSnackbar("Listo, los borré de este teléfono.", { duration: 3500, renderNow: false });
    },
    "open-bank-disclosure": () => {
      planSheet = "bank-disclosure";
    },
    "enable-bank-notifications": () => enableBankNotifications(),
    "disable-bank-notifications": () => disableBankNotifications(),
    "open-bank-settings": () => nativeBankNotifications()?.openSettings().catch(() => {}),
    "open-bank-background-settings": () => nativeBankNotifications()?.openBackgroundSettings().catch(() => {}),
    "register-bank-suggestion": () => registerBankSuggestion(id),
    "register-bank-income": () => registerBankIncome(id),
    "confirm-bank-pay": () => registerBankPay(id),
    "open-pay-received": () => {
      payDraft = null;
      planSheet = "pay-received";
      menuOpen = false;
    },
    "dismiss-bank-suggestion": () => {
      forgetBankNotification(id);
      showNoticeSnackbar("Listo, no lo registro.", { duration: 3500, renderNow: false });
    },
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
    "skip-calendar-event": () => skipCalendarEvent(id),
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
      action === "disable-biometric" ||
      action === "enable-bank-notifications" ||
      action === "disable-bank-notifications" ||
      action === "open-bank-settings" ||
      action === "open-bank-background-settings";
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
      account: numberValue(data.get("account")) ?? 0,
      cash: numberValue(data.get("cash")) ?? 0,
      credit: numberFrom(data.get("credit")),
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
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
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
    ["emergencySavings", "El ahorro actual para la simulación no puede estar vacío.", 0],
    // Balances may be negative (an overdraft); they only have to be filled in.
    ["account", "El dinero en cuenta no puede estar vacío.", -Infinity],
    ["cash", "El dinero en físico no puede estar vacío.", -Infinity],
    ["credit", "Escribe cuánto debes en la tarjeta (0 si nada).", 0]
  ];

  if (activeFields.has("name") && !cleanText(data.get("name"), "")) {
    return { field: "name", message: "Escribe un nombre para tu plan." };
  }

  if (activeFields.has("incomeCadence") && !allowedCadences.includes(data.get("incomeCadence"))) {
    return { field: "incomeCadence", message: "Elige cada cuánto recibes presupuesto." };
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
    return { field: "periodStart", message: "El inicio del periodo actual debe ser una fecha válida." };
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

// Both "Nueva categoría" forms (Apartar dinero and Apartar cada semana o mes) end in
// state.budgetJobs, so they share one set of checks and messages. `reserves` is what the
// category takes from this period: the typed amount for a one-off, the period equivalent
// of the cadence for a recurring one. Comparing against freeRemaining (not the gross
// freeBudget) matters: it is the "Libre" the user sees, and it already discounts this
// period's unclassified spending.
function categoryReserveError({ name, amount, reserves = amount, createsCategory }) {
  if (amount <= 0) {
    return "Escribe un monto mayor que cero.";
  }
  if (createsCategory && state.budgetJobs.length >= MAX_CATEGORIES) {
    return `Mantengamos máximo ${MAX_CATEGORIES} categorías para que el plan siga claro.`;
  }
  const free = budgetSummary().freeRemaining;
  if (reserves > free) {
    return reserves === amount
      ? `Solo tienes ${formatMoney(free)} libres para apartar.`
      : `${name} apartaría ${formatMoney(reserves)} este periodo, pero solo tienes ${formatMoney(free)} libres.`;
  }
  return "";
}

function failCategoryForm(message) {
  state.lastAlert = message;
  showNoticeSnackbar(message, { kind: "error", renderNow: false });
  saveState();
  render();
}

function handleBudgetSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = cleanText(data.get("name"), "Nueva categoría");
  const amount = numberFrom(data.get("amount"));
  const cadence = JOB_CADENCE_VALUES.includes(data.get("cadence")) ? data.get("cadence") : "monthly";

  // A second recurring "Mercado" would split one envelope in two with no way to tell them
  // apart; "Apartar dinero" tops up the existing one instead (setAsideTarget).
  const existing = setAsideTarget(name).job;
  if (existing) {
    failCategoryForm(`Ya tienes una categoría llamada ${existing.name}.`);
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
  const error = categoryReserveError({ name, amount, reserves: semesterBudget, createsCategory: true });
  if (error) {
    failCategoryForm(error);
    return;
  }

  state.budgetJobs.push(job);
  state.lastAlert = `${name} reserva ${formatMoney(semesterBudget)} del periodo ${budgetSummary().cadenceLabel}.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
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
      location: normalizeIncomeLocation(data.get("location"))
    },
    allFree ? 0 : numberFrom(data.get("savingsPercent"))
  );
  const bankNotificationId = cleanText(data.get("bankNotificationId"), "");
  if (bankNotificationId) {
    forgetBankNotification(bankNotificationId);
  }
  extraDraft = null;
  planSheet = "";
  saveState();
  render();
}

function applyExtraIncome(draft, rawPercent) {
  const percent = canSeparateSavings() ? clamp(Number(rawPercent || 0), 0, 100) : 0;
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
  const bankNotificationId = cleanText(data.get("bankNotificationId"), "");
  const date = expenseDateFromForm(data);
  const threshold = plan.expenses * LARGE_PURCHASE_RATIO;
  const transactionError = date ? validateTransactionDraft({ amount, category }) : "Elige un día que ya haya pasado.";

  if (transactionError) {
    state.lastAlert = transactionError;
    showNoticeSnackbar(transactionError, { kind: "error" });
    return;
  }

  // The 24-hour pause is for deciding whether to buy; a purchase the bank already
  // reported, or one from an earlier day, has happened, so it is recorded straight away.
  if (!bankNotificationId && date === todayKey() && !budgeted && amount >= threshold) {
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
    showNoticeSnackbar(state.lastAlert, { renderNow: false });
  } else {
    const transaction = addTransaction({ merchant, description, amount, category, budgeted, oneOff, source, calendarEventId, date });
    if (bankNotificationId) {
      forgetBankNotification(bankNotificationId);
    }
    if (calendarEventId) {
      markCalendarEventSpent(calendarEventId, transaction.id);
    }
    const overdraft = overdraftNotice(source);
    const when = date === todayKey() ? "" : ` Quedó con fecha ${date === previousDay(todayKey()) ? "de ayer" : `del ${formatShortDate(date)}`}.`;
    state.lastAlert = overdraft || `${createSpendAlert(category)}${when}`;
    showUndoSnackbar(transaction.id, [when.trim(), overdraft].filter(Boolean).join(" "));
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
  const overdraft = nextSource !== currentSource ? overdraftNotice(nextSource) : "";
  state.lastAlert = overdraft || `${transaction.merchant} quedó reclasificado.`;
  if (overdraft) {
    showNoticeSnackbar(overdraft, { renderNow: false });
  }
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
    location: normalizeIncomeLocation(data.get("location")),
    savingsPercent: clamp(numberFrom(data.get("savingsPercent")), 0, 100)
  });
  state.lastAlert = `${extra.source} quedo actualizado y el saldo se ajusto.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  editingExtraId = "";
  saveState();
  render();
}

// Paying the card moves money from a real source to what is owed. It creates no
// transaction: the expense was recorded when the card was used; recording it again would
// count it twice and charge its category a second time.
// "Ya me llegó" / "¿Es tu sueldo?": the pay of this period, confirmed for the amount that
// really came. Two situations:
//   - still pending (the user said "aún no me llega" on payday): the amount is added;
//   - already added by the app on payday for the usual amount: only the difference is
//     corrected, so the same pay is never counted twice.
// The amount can differ from the usual pay (a bonus month, a raise), so it is asked, not
// assumed; and the user can make it the usual pay from now on.
function payAlreadyDeposited() {
  const summary = budgetSummary();
  const status = state.periodIncomeStatus;
  return summary.incomeApplied && Number(status?.amount || 0) > 0;
}

function renderPayReceivedSheet() {
  const usual = getPeriodIncome(state.profile);
  const draft = payDraft || {};
  const early = draft.nextWindow || null;
  const deposited = !early && payAlreadyDeposited();
  const depositedAmount = Number(state.periodIncomeStatus?.amount || 0);
  const amount = draft.amount || usual;
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="pay-received-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Tu sueldo</p><h2 id="pay-received-title">¿Cuánto te llegó?</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        ${
          draft.bankNotificationId
            ? `<p class="data-note quick-bank-note">De tu notificación de ${escapeHtml(draft.bank)}, ${escapeHtml(bankDateLabel(draft.date))}.</p>`
            : ""
        }
        <p class="setaside-note">${
          early
            ? `Es el sueldo de tu periodo que empieza el ${escapeHtml(formatShortDate(early.start))}: lo sumo a tu saldo ahora y ese día no lo vuelvo a sumar.`
            : deposited
            ? `El día de pago sumé ${formatMoney(depositedAmount)} por tu sueldo. Si te llegó otro monto, corrijo solo la diferencia.`
            : "Se suma a tu saldo y deja de aparecer como por recibir."
        }</p>
        <form class="sheet-form" id="pay-received-form">
          ${draft.bankNotificationId ? `<input name="bankNotificationId" type="hidden" value="${escapeAttr(draft.bankNotificationId)}">` : ""}
          ${early ? `<input name="earlyWindowStart" type="hidden" value="${escapeAttr(early.start)}">` : ""}
          <label>Monto<input name="amount" type="number" min="1000" step="1000" inputmode="numeric" value="${amount > 0 ? amount : ""}" required data-autofocus></label>
          ${
            deposited
              ? `<input name="location" type="hidden" value="${escapeAttr(state.periodIncomeStatus?.location || "account")}">`
              : `<div class="sheet-field">
                  <span class="sheet-label">¿Dónde entró?</span>
                  ${renderChoicePills("location", [
                    { value: "account", label: "Cuenta" },
                    { value: "cash", label: "Efectivo" }
                  ], "account")}
                </div>`
          }
          <label class="check-row">
            <input name="makeUsual" type="checkbox">
            <span>Este es mi sueldo de ahora en adelante</span>
          </label>
          <button class="btn primary" type="submit" name="intent" value="add">${deposited ? "Corregir mi saldo" : "Sumar a mi saldo"}</button>
          ${
            deposited || draft.bankNotificationId
              ? ""
              : `<button class="btn ghost" type="submit" name="intent" value="already-recorded" formnovalidate>Ya lo anoté como dinero extra</button>
                 <p class="data-note">Esta opción solo deja de esperarlo: no suma nada, porque esa plata ya está en tu saldo.</p>`
          }
        </form>
      </section>
    </div>
  `;
}

function handlePayReceivedSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  // Entered earlier as Dinero extra: the money is already in the balance, so the pay is
  // only marked as received (amount 0, like settlePeriodIncomeAtOnboarding), and that
  // movement with its savings split stays as it is.
  const alreadyRecorded = event.submitter?.value === "already-recorded";
  const amount = alreadyRecorded ? 0 : numberFrom(data.get("amount"));
  if (!alreadyRecorded && amount <= 0) {
    showNoticeSnackbar("Escribe cuánto te llegó.", { kind: "error" });
    return;
  }
  const earlyWindowStart = cleanText(data.get("earlyWindowStart"), "");
  if (earlyWindowStart) {
    receiveEarlyPay(data, amount, earlyWindowStart);
    return;
  }
  const deposited = payAlreadyDeposited();
  const previous = deposited ? Number(state.periodIncomeStatus.amount || 0) : 0;
  const location = deposited ? normalizeIncomeLocation(state.periodIncomeStatus.location) : normalizeIncomeLocation(data.get("location"));
  const now = new Date().toISOString();
  const window = budgetSummary().window;
  const delta = amount - previous;
  if (delta !== 0) {
    adjustLiquidity(location, delta, "ingreso-periodico");
  }
  state.periodIncomeStatus = {
    ...(state.periodIncomeStatus || {}),
    windowStart: window.start,
    applied: true,
    rejected: false,
    bannerDismissed: true,
    amount,
    location,
    appliedAt: now
  };
  // The ledger guards against depositing the same period twice (see resolvePeriodIncome).
  const logged = findLoggedIncome(state.periodIncomeApplied, todayKey());
  if (logged) {
    Object.assign(logged, { status: "applied", amount, appliedAt: now });
  } else {
    state.periodIncomeApplied = [
      ...(state.periodIncomeApplied || []),
      { windowStart: window.start, windowEnd: window.end, status: "applied", amount, appliedAt: now }
    ].slice(-12);
  }
  const makeUsual = data.get("makeUsual") === "on" && amount > 0 && amount !== getPeriodIncome(state.profile);
  if (makeUsual) {
    state.profile = {
      ...state.profile,
      incomeAmount: amount,
      monthlyIncome: getMonthlyIncome({ ...state.profile, incomeAmount: amount }),
      updated_at: now
    };
  }
  const bankNotificationId = cleanText(data.get("bankNotificationId"), "");
  if (bankNotificationId) {
    forgetBankNotification(bankNotificationId);
  }
  payDraft = null;
  planSheet = "";
  const where = location === "cash" ? "efectivo" : "cuenta";
  state.lastAlert = alreadyRecorded
    ? "Listo: tu pago de este periodo ya cuenta como recibido."
    : deposited
      ? delta === 0
        ? "Listo: tu sueldo ya estaba sumado completo."
        : `Listo: ${delta > 0 ? "sumé" : "resté"} ${formatMoney(Math.abs(delta))} para que tu ${where} tenga el sueldo que te llegó.`
      : `Listo: sumé ${formatMoney(amount)} a tu ${where}.`;
  if (makeUsual) {
    state.lastAlert += ` Tu sueldo ahora es ${formatMoney(amount)}.`;
  }
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  saveState();
  render();
}

// The next period's pay, arrived early: the money goes into the balance now, and that
// period is logged as paid so its payday (resolvePeriodIncome) does not add it again.
// This period's own pay status is left as it is.
function receiveEarlyPay(data, amount, windowStart) {
  const next = getBudgetWindow(state.profile, windowStart);
  const location = normalizeIncomeLocation(data.get("location"));
  const now = new Date().toISOString();
  adjustLiquidity(location, amount, "ingreso-periodico");
  state.periodIncomeApplied = [
    ...(state.periodIncomeApplied || []).filter((entry) => entry.windowStart !== next.start),
    { windowStart: next.start, windowEnd: next.end, status: "applied", amount, appliedAt: now }
  ].slice(-12);
  const makeUsual = data.get("makeUsual") === "on" && amount !== getPeriodIncome(state.profile);
  if (makeUsual) {
    state.profile = {
      ...state.profile,
      incomeAmount: amount,
      monthlyIncome: getMonthlyIncome({ ...state.profile, incomeAmount: amount }),
      updated_at: now
    };
  }
  const bankNotificationId = cleanText(data.get("bankNotificationId"), "");
  if (bankNotificationId) {
    forgetBankNotification(bankNotificationId);
  }
  payDraft = null;
  planSheet = "";
  state.lastAlert = `Listo: sumé ${formatMoney(amount)} a tu ${location === "cash" ? "efectivo" : "cuenta"}. El ${formatShortDate(next.start)} ya cuenta como pagado.`;
  if (makeUsual) {
    state.lastAlert += ` Tu sueldo ahora es ${formatMoney(amount)}.`;
  }
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  saveState();
  render();
}

function handleCreditPaymentSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const amount = numberFrom(data.get("amount"));
  const source = normalizeIncomeLocation(data.get("source"));
  const owed = liquiditySummary().credit;

  if (amount <= 0) {
    showNoticeSnackbar("El pago debe ser mayor que cero.", { kind: "error" });
    return;
  }
  if (owed <= 0) {
    showNoticeSnackbar("No tienes nada pendiente en la tarjeta.", { kind: "error" });
    return;
  }

  // Paying more than owed clears the card and only takes what was actually owed.
  const applied = Math.min(amount, owed);
  adjustLiquidity(source, -applied, "credit-payment");
  adjustLiquidity("credit", applied, "credit-payment");
  state.creditPayments = [
    ...(state.creditPayments || []),
    { id: uid("credit-payment"), date: todayKey(), amount: applied, source, updated_at: new Date().toISOString() }
  ].slice(-CREDIT_PAYMENTS_LIMIT);

  planSheet = "";
  const overdraft = overdraftNotice(source);
  state.lastAlert =
    applied < amount
      ? `Pagaste ${formatMoney(applied)}, que era todo lo que debías. Tu tarjeta queda en cero.`
      : `Pago de ${formatMoney(applied)} registrado. Ahora debes ${formatMoney(owed - applied)}.`;
  showNoticeSnackbar(overdraft ? `${state.lastAlert} ${overdraft}` : state.lastAlert, { renderNow: false });
  saveState();
  render();
}

function validateTransactionDraft({ amount, category }) {
  if (amount <= 0) {
    return "El monto del gasto debe ser mayor que cero.";
  }

  const validCategory = category === FREE_CATEGORY_ID || state.budgetJobs.some((job) => job.id === category);
  if (!validCategory) {
    return "Elige una categoría válida para clasificar el gasto.";
  }

  // No balance check: this records something that already happened. An overdraft, cash
  // borrowed from a friend or a stale balance are all real, and refusing the expense only
  // pushed the user to fake the amount or give up. It is recorded, and overdraftNotice()
  // says where the balance ended up.
  return "";
}

// A negative balance is useful information ("te pasaste"), not an error: plain wording,
// no red, and a direct way to fix it if the balance on file was simply out of date.
function overdraftNotice(source) {
  const liquidity = normalizeLiquidity(state.liquidity);
  const key = normalizeLocation(source);
  if (!liquidity.initialized || key === "credit" || liquidity[key] >= 0) {
    return "";
  }
  return `${locationLabel(key)} quedó en ${formatMoney(liquidity[key])}. Si no cuadra, corrige el saldo en Datos.`;
}

function handleSmartSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.settings.monthlyRaisePct = clamp(numberFrom(data.get("monthlyRaisePct")), 0, 100);
  state.settings.escalationPct = clamp(numberFrom(data.get("escalationPct")), 0, 100);
  state.settings.updated_at = new Date().toISOString();
  saveState();
  render();
}

async function handleDailyReminderSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await setDailyReminder({ enabled: data.get("enabled") === "on", time: data.get("time") });
  render();
}

// Shared by the Datos form and the offer at the end of the welcome tour: asks for
// notification permission when needed, saves, schedules, and leaves the outcome in
// state.lastAlert. Returns the permission so the caller can tell the user what happened.
async function setDailyReminder({ enabled, time }) {
  const reminderTime = normalizeReminderTime(time);
  let permission = notificationPermissionStatus();

  if (enabled && permission === "default") {
    permission = await requestNotificationPermission();
  }

  state.dailyReminder = {
    ...normalizeDailyReminder(state.dailyReminder),
    enabled,
    time: reminderTime,
    updated_at: new Date().toISOString()
  };

  if (enabled && permission === "denied") {
    state.lastAlert = "Recordatorio guardado, pero las notificaciones están bloqueadas. Puedes permitirlas en los ajustes del teléfono.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  } else if (enabled && permission === "unsupported") {
    state.lastAlert = "Este navegador no permite notificaciones desde la app.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  } else {
    state.lastAlert = enabled
      ? `Recordatorio diario activado a las ${reminderTime}.`
      : "Recordatorio diario apagado.";
  }

  saveState();
  if (enabled && permission === "granted") {
    scheduleDailyReminder();
  }
  return permission;
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

  const repeat = normalizeRepeat(data.get("repeat"));
  state.calendarEvents.push({
    id: uid("event"),
    title,
    date,
    amount,
    category,
    notes: cleanText(data.get("notes"), ""),
    spent: false,
    transactionId: "",
    repeat,
    anchorDay: Number(date.slice(8, 10)),
    history: [],
    updated_at: new Date().toISOString()
  });
  state.lastAlert = repeat
    ? `${title} quedó en tus gastos planeados, ${repeatLabel(repeat).toLowerCase()}, con estimado de ${formatMoney(amount)}.`
    : `${title} quedó en tu calendario con estimado de ${formatMoney(amount)}.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
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
  loadingReason = "signin";
  loadingShownSince = 0;
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
    accountRequested = false;
    state.meta = { ...(state.meta || {}), localOnly: false };
    authEmailDraft = "";
    authNotice = null;
    resetQuickExpenseAfterLogin();
    state.lastAlert = mode === "signup" ? "Cuenta creada." : "Sesión iniciada.";
    showNoticeSnackbar(state.lastAlert, { renderNow: false });
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
  // access screen, no "Comprobando tu sesión" detour. That screen used to have an
  // impatience escape hatch ("Continuar al acceso"), and during sign-out
  // cloudState.signedIn was still true while the save+signOut network calls were in
  // flight, so tapping it re-entered the still-authenticated app for a few seconds
  // before the background work finished and yanked them back out — exactly the "entra un momento y despues sale" a friend
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
  localStorage.removeItem(CLOUD_BASE_KEY);
  localBackups = [];
  withBackupStore("readwrite", (store) => store.clear());
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
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
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
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  openQuickExpense();
}

function replaceCalendarEvent(id, update) {
  state.calendarEvents = state.calendarEvents.map((item) => (item.id === id ? update(item) : item));
}

// A repeating plan moves to its next date (planned.js); a one-off is done.
function markCalendarEventSpent(id, transactionId) {
  replaceCalendarEvent(id, (event) => registerOccurrence(event, transactionId));
}

// transactionId: its expense was deleted, so only that occurrence is undone.
function reopenCalendarEvent(id, transactionId = "") {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event) {
    state.lastAlert = "No encontré ese gasto planeado.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
    return;
  }
  replaceCalendarEvent(id, (item) => undoOccurrence(item, transactionId));
  const after = state.calendarEvents.find((item) => item.id === id);
  state.lastAlert = after.repeat
    ? `${after.title} vuelve a quedar para el ${formatShortDate(after.date)}.`
    : `${after.title} volvió a quedar pendiente.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function skipCalendarEvent(id) {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event) {
    return;
  }
  replaceCalendarEvent(id, (item) => skipOccurrence(item));
  const after = state.calendarEvents.find((item) => item.id === id);
  state.lastAlert = after.repeat
    ? `Listo, ${after.title} no se registró esta vez. El próximo es el ${formatShortDate(after.date)}.`
    : `Listo, ${after.title} ya no queda pendiente.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function repeatLabel(repeat) {
  return repeat === "weekly" ? "Cada semana" : repeat === "monthly" ? "Cada mes" : "Una vez";
}

function plannedDateLabel(date) {
  const today = todayKey();
  if (date === today) return "hoy";
  if (date === previousDay(today)) return "ayer";
  return date < today ? `desde el ${formatShortDate(date)}` : formatShortDate(date);
}

// Inicio: planned expenses whose day has come ("¿Registrar el arriendo?"), with the same
// two answers as the bank's suggestions. Registering opens the prefilled form.
function renderDuePlans() {
  const due = duePlans(state.calendarEvents || [], todayKey());
  if (!due.length) {
    return "";
  }
  const shown = due.slice(0, 3);
  return `
    <article class="cooldown-panel bank-suggestions planned-due" aria-label="Gastos planeados para hoy">
      <div class="home-section-heading compact-heading">
        <div>
          <p class="eyebrow">Gastos planeados</p>
          <h2>${due.length === 1 ? `¿Registrar ${escapeHtml(shown[0].title)}?` : "¿Registrar estos gastos planeados?"}</h2>
        </div>
      </div>
      <div class="cooldown-list">
        ${shown
          .map(
            (event) => `
          <div class="cooldown-item">
            <div>
              <strong>${escapeHtml(event.title)}</strong>
              <span>${formatMoney(event.amount)} · ${escapeHtml(plannedDateLabel(event.date))}${event.repeat ? ` · ${escapeHtml(repeatLabel(event.repeat).toLowerCase())}` : ""}</span>
            </div>
            <div class="cooldown-actions">
              <button class="btn ghost" type="button" data-action="skip-calendar-event" data-id="${escapeAttr(event.id)}">${event.repeat ? "Omitir esta vez" : "Ya no aplica"}</button>
              <button class="btn secondary" type="button" data-action="register-calendar-event" data-id="${escapeAttr(event.id)}">Registrar</button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
      ${due.length > shown.length ? `<button class="text-link prediction-detail-link" type="button" data-view="calendar">Ver los ${due.length} pendientes</button>` : ""}
    </article>
  `;
}

function removeCalendarEvent(id) {
  const event = state.calendarEvents.find((item) => item.id === id);
  state.calendarEvents = state.calendarEvents.filter((item) => item.id !== id);
  state.lastAlert = event ? `${event.title} salio del calendario.` : "Evento eliminado.";
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

// The period close used to be saved only by hand, and the final one only on the period's
// last day: the next day the old period could no longer be closed, so Progreso stayed
// empty for almost everyone. A snapshot of the current period is now kept up to date on
// every save; when the period ends, the last one taken while it was current remains as
// its close. It cannot be rebuilt afterwards (balances and categories move on), which is
// why it is taken continuously instead.
function snapshotCurrentPeriod() {
  if (!state.profile.completed) {
    return;
  }
  const closure = buildPeriodClosure();
  const others = (state.periodClosures || []).filter((item) => item.id !== closure.id);
  state.periodClosures = [closure, ...others]
    .sort((a, b) => (a.windowStart < b.windowStart ? 1 : a.windowStart > b.windowStart ? -1 : 0))
    .slice(0, 12);
}

// Periods that already ended; the current one is still in progress.
function finishedPeriodClosures() {
  const today = todayKey();
  return (state.periodClosures || [])
    .filter((closure) => closure.windowEnd <= today)
    .slice()
    .sort((a, b) => (a.windowStart < b.windowStart ? 1 : -1));
}

function buildPeriodClosure() {
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
  return closure;
}

function currentPeriodReportText() {
  const summary = budgetSummary();
  const plan = calculatePlan();
  const report = periodCloseReport(plan, summary);
  const next = nextPeriodOutlook(summary);
  const liquidity = liquiditySummary(summary);
  const status = state.periodIncomeStatus;
  const payStatus = !summary.hasFixedIncomeSchedule
    ? ""
    : summary.incomeApplied
      ? Number(status?.amount || 0) > 0 ? `recibido: ${formatMoney(status.amount)}` : "recibido, anotado como dinero extra"
      : "todavía no llega";
  const movements = movementsForSummary(summary).map((movement) =>
    movement.kind === "income"
      ? { kind: "income", date: movement.date, amount: movement.amount, detail: movement.extra.source, location: movement.extra.location }
      : {
          kind: "expense",
          date: movement.date,
          amount: movement.amount,
          detail: [movement.transaction.merchant, movement.transaction.description].filter(Boolean).join(" - "),
          category: !movement.transaction.labeled || !movement.transaction.category || movement.transaction.category === FREE_CATEGORY_ID ? "Sin categoría" : categoryName(movement.transaction.category),
          source: movement.transaction.source
        }
  );
  return periodExportMarkdown(currentPeriodReview(summary), {
    generatedOn: todayKey(),
    periodLabel: periodLabel(summary.window),
    cadenceLabel: capitalize(summary.cadenceLabel || ""),
    remainingDays: report.remainingDays,
    pay: { amount: summary.hasFixedIncomeSchedule ? getPeriodIncome(state.profile) : 0, status: payStatus },
    free: { today: report.freeFinal, projectedEnd: report.prediction.projectedEndFree, reserved: summary.reservedRemaining },
    balances: { account: liquidity.account, cash: liquidity.cash, credit: liquidity.credit },
    plan: categoryStatus()
      .filter((category) => category.id !== FREE_CATEGORY_ID)
      .map((category) => ({ name: category.name, budget: Number(category.budget || 0), spent: Number(category.spent || 0) })),
    savings: { reserved: plan.savingsReserved, suggested: report.suggestedSavings },
    nextPeriod: next.fixed || next.recurring || next.planned ? next : null,
    movements,
    locationLabel
  });
}

function sharePeriodExport() {
  const summary = budgetSummary();
  exportFile(`mi-periodo-${summary.window.start}.md`, currentPeriodReportText(), "text/markdown", "Documento listo.");
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

function nativeBankNotifications() {
  return window.Capacitor?.Plugins?.BankNotifications || null;
}

// Expenses from the bank app's notifications (Android BankNotificationListener keeps
// them on the phone). Read at launch and whenever the app comes back to the foreground:
// the usual moment is right after paying, or after granting access in Android settings.
function bindBankNotifications() {
  if (!nativeBankNotifications()) {
    return;
  }
  nativeApp()?.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      refreshBankSuggestions();
    }
  });
  refreshBankSuggestions();
}

async function refreshBankSuggestions({ recheck = true } = {}) {
  const plugin = nativeBankNotifications();
  if (!plugin) {
    return;
  }
  try {
    const status = await plugin.status();
    bankStatus = {
      available: true,
      enabled: Boolean(status?.enabled),
      permission: Boolean(status?.permission),
      connected: status?.connected !== false
    };
    // status() asks Android to reconnect an unbound listener, which takes a moment: look
    // again once before telling the user something is blocking it.
    if (recheck && bankStatus.enabled && bankStatus.permission && !bankStatus.connected) {
      window.setTimeout(() => refreshBankSuggestions({ recheck: false }), 1500);
    }
    const pending = bankStatus.enabled && bankStatus.permission ? (await plugin.getPending())?.notifications || [] : [];
    // Too old to offer (see SUGGESTION_MAX_AGE_DAYS): forgotten on the phone as well, so
    // they stop taking room in the listener's limited store.
    const stale = pending.filter((notification) => isStale(notification)).map((notification) => notification.id);
    if (stale.length) {
      plugin.dismiss({ ids: stale })?.catch?.(() => {});
    }
    bankSuggestions = pendingSuggestions(pending, { transactions: state.transactions, extras: state.budgetExtras });
    bankUnreadable = unreadableNotifications(pending);
  } catch {
    bankStatus = { ...bankStatus, available: true };
  }
  renderBackground();
}

function forgetBankNotification(id) {
  bankSuggestions = bankSuggestions.filter((suggestion) => suggestion.id !== id);
  try {
    nativeBankNotifications()?.dismiss({ ids: [id] })?.catch?.(() => {});
  } catch {}
}

function registerBankSuggestion(id) {
  const suggestion = bankSuggestions.find((item) => item.id === id);
  if (!suggestion) {
    return;
  }
  expenseDraft = {
    bankNotificationId: suggestion.id,
    bank: suggestion.bank,
    date: suggestion.date,
    amount: suggestion.amount,
    merchant: suggestion.merchant,
    source: suggestion.source
  };
  openQuickExpense();
}

function registerBankIncome(id) {
  const suggestion = bankSuggestions.find((item) => item.id === id);
  if (!suggestion) {
    return;
  }
  extraDraft = {
    bankNotificationId: suggestion.id,
    bank: suggestion.bank,
    date: suggestion.date,
    amount: suggestion.amount,
    source: suggestion.origin || `Recibido en ${suggestion.bank}`,
    location: suggestion.location
  };
  planSheet = "extra";
  menuOpen = false;
}

// The income suggestion that is probably this period's fixed pay, if any: while the pay
// is still pending, or after the app added it on payday for the usual amount (then only
// the difference is corrected). Not when the pay was settled with nothing added (already
// typed into the balance at onboarding, or entered as Dinero extra): then this
// notification may be that same money, so it is offered as plain income for the user
// to judge.
function bankPaySuggestion() {
  if (state.profile.incomeType !== "fixed") {
    return null;
  }
  const early = bankSuggestions.find((suggestion) => earlyPayWindow(suggestion));
  if (early) {
    return early;
  }
  const summary = budgetSummary();
  if (summary.incomeApplied && !payAlreadyDeposited()) {
    return null;
  }
  const usualPay = getPeriodIncome(state.profile);
  return bankSuggestions.find((suggestion) => looksLikePay(suggestion, { usualPay, window: summary.window })) || null;
}

// The next period, when this income is probably its pay arriving early: this period's
// pay is settled, it came in the last days, and the next one is not logged yet. Logging it
// for that period (handlePayReceivedSubmit) keeps payday from adding it a second time.
function earlyPayWindow(suggestion) {
  const summary = budgetSummary();
  if (state.profile.incomeType !== "fixed" || !summary.incomeApplied) {
    return null;
  }
  if (!looksLikeEarlyPay(suggestion, { usualPay: getPeriodIncome(state.profile), window: summary.window })) {
    return null;
  }
  const next = getBudgetWindow(state.profile, summary.window.end);
  return findLoggedIncome(state.periodIncomeApplied, next.start) ? null : next;
}

function registerBankPay(id) {
  const suggestion = bankSuggestions.find((item) => item.id === id);
  if (!suggestion) {
    return;
  }
  payDraft = {
    bankNotificationId: suggestion.id,
    bank: suggestion.bank,
    date: suggestion.date,
    amount: suggestion.amount,
    nextWindow: earlyPayWindow(suggestion)
  };
  planSheet = "pay-received";
  menuOpen = false;
}

async function enableBankNotifications() {
  const plugin = nativeBankNotifications();
  planSheet = "";
  if (!plugin) {
    render();
    return;
  }
  try {
    await plugin.setEnabled({ enabled: true });
    bankStatus = { ...bankStatus, available: true, enabled: true };
    if (!bankStatus.permission) {
      await plugin.openSettings();
    }
  } catch {
    showNoticeSnackbar("No pude activarlo en este teléfono.", { kind: "error", renderNow: false });
  }
  render();
}

async function disableBankNotifications() {
  try {
    await nativeBankNotifications()?.setEnabled({ enabled: false });
  } catch {}
  bankStatus = { ...bankStatus, enabled: false };
  bankSuggestions = [];
  showNoticeSnackbar("Desactivado. Ya no leemos tus notificaciones de Nu. El permiso de Android lo puedes quitar en sus ajustes.", { renderNow: false });
  render();
}

function bankDateLabel(date) {
  if (date === todayKey()) return "hoy";
  if (date === previousDay(todayKey())) return "ayer";
  return formatShortDate(date);
}

// Inicio: what the bank said went out, and what it said came in, each in its own card so
// the question ("¿gasto?" / "¿ingreso?") is never ambiguous.
function renderBankSuggestions() {
  const pay = bankPaySuggestion();
  const expenses = bankSuggestions.filter((suggestion) => suggestion.kind !== "income");
  const income = bankSuggestions.filter((suggestion) => suggestion.kind === "income" && suggestion !== pay);
  return `${renderBankPayCard(pay)}${renderBankSuggestionCard(expenses, "expense")}${renderBankSuggestionCard(income, "income")}`;
}

function renderBankPayCard(pay) {
  if (!pay) {
    return "";
  }
  const nextWindow = earlyPayWindow(pay);
  return `
    <article class="cooldown-panel bank-suggestions is-income" aria-label="¿Es tu sueldo?">
      <div class="home-section-heading compact-heading">
        <div>
          <p class="eyebrow">De tus notificaciones de ${escapeHtml(pay.bank)}</p>
          <h2>${nextWindow ? "¿Es tu próximo sueldo, adelantado?" : "¿Es tu sueldo?"}</h2>
          ${nextWindow ? `<p class="data-note">Tu periodo nuevo empieza el ${escapeHtml(formatShortDate(nextWindow.start))}.</p>` : ""}
        </div>
      </div>
      <div class="cooldown-list">
        <div class="cooldown-item">
          <div>
            <strong>${escapeHtml(pay.origin || `Te llegó plata a ${pay.bank}`)}</strong>
            <span>+${formatMoney(pay.amount)} · ${escapeHtml(locationLabel(pay.location))} · ${escapeHtml(bankDateLabel(pay.date))}</span>
          </div>
          <div class="cooldown-actions">
            <button class="btn ghost" type="button" data-action="register-bank-income" data-id="${escapeAttr(pay.id)}">No, es otra cosa</button>
            <button class="btn secondary" type="button" data-action="confirm-bank-pay" data-id="${escapeAttr(pay.id)}">Sí, es mi sueldo</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderBankSuggestionCard(suggestions, kind) {
  if (!suggestions.length) {
    return "";
  }
  const isIncome = kind === "income";
  const shown = suggestions.slice(0, 3);
  const more = suggestions.length - shown.length;
  const question = isIncome
    ? `¿Registrar ${suggestions.length === 1 ? "este ingreso" : "estos ingresos"}?`
    : `¿Registrar ${suggestions.length === 1 ? "este gasto" : "estos gastos"}?`;
  return `
    <article class="cooldown-panel bank-suggestions ${isIncome ? "is-income" : ""}" aria-label="${isIncome ? "Ingresos por confirmar" : "Gastos por confirmar"}">
      <div class="home-section-heading compact-heading">
        <div>
          <p class="eyebrow">De tus notificaciones de ${escapeHtml(shown[0].bank)}</p>
          <h2>${question}</h2>
        </div>
      </div>
      <div class="cooldown-list">
        ${shown
          .map((suggestion) => {
            const title = isIncome
              ? suggestion.origin || `Te llegó plata a ${suggestion.bank}`
              : suggestion.merchant || `Compra con ${suggestion.bank}`;
            const where = isIncome ? locationLabel(suggestion.location) : suggestion.source ? locationLabel(suggestion.source) : "";
            return `
          <div class="cooldown-item">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <span>${isIncome ? "+" : ""}${formatMoney(suggestion.amount)}${where ? ` · ${escapeHtml(where)}` : ""} · ${escapeHtml(bankDateLabel(suggestion.date))}</span>
            </div>
            <div class="cooldown-actions">
              <button class="btn ghost" type="button" data-action="dismiss-bank-suggestion" data-id="${escapeAttr(suggestion.id)}">${isIncome ? "No es un ingreso" : "No es un gasto"}</button>
              <button class="btn secondary" type="button" data-action="${isIncome ? "register-bank-income" : "register-bank-suggestion"}" data-id="${escapeAttr(suggestion.id)}">Registrar</button>
            </div>
          </div>
        `;
          })
          .join("")}
      </div>
      ${more > 0 ? `<p class="data-note">Y ${more} más. Aparecen aquí a medida que confirmes estos.</p>` : ""}
    </article>
  `;
}

function renderBankNotificationsPanel() {
  if (!bankStatus.available) {
    return "";
  }
  const { enabled, permission, connected } = bankStatus;
  // Access granted but Android will not start the listener: on Xiaomi phones that is the
  // app's "Inicio automático" (autostart) being off, and nothing arrives until it is on.
  const blocked = enabled && permission && !connected;
  const note = !enabled
    ? "Cuando Nu te avise de una compra, te proponemos registrarla. Tú confirmas cada una."
    : !permission
      ? "Falta un paso: permite el acceso a notificaciones en los ajustes de Android."
      : blocked
        ? "Tu teléfono no deja que la app lea las notificaciones en segundo plano. Activa “Inicio automático” para Finanzas Conductuales y vuelve a abrir la app."
        : "Activado. Cuando Nu te avise de una compra, aparece en Inicio para que la confirmes.";
  return `
    <article class="data-section bank-notifications-section">
      <div class="data-section-heading"><span class="data-icon">${renderIcon("card")}</span><div><strong>Gastos desde Nu</strong><small>${note}</small></div></div>
      <div class="lock-settings-actions">
        ${
          !enabled
            ? `<button class="btn primary" type="button" data-action="open-bank-disclosure">Activar</button>`
            : `${permission ? "" : `<button class="btn primary" type="button" data-action="open-bank-settings">Dar permiso</button>`}
               ${blocked ? `<button class="btn primary" type="button" data-action="open-bank-background-settings">Abrir ajustes</button>` : ""}
               <button class="btn ghost" type="button" data-action="disable-bank-notifications">Desactivar</button>`
        }
      </div>
      ${
        enabled && bankUnreadable.length
          ? `<div class="bank-unreadable-row">
              <span>${bankUnreadable.length === 1 ? "1 aviso de Nu que no entendí" : `${bankUnreadable.length} avisos de Nu que no entendí`}</span>
              <button class="btn ghost" type="button" data-action="open-bank-unreadable">Ver</button>
            </div>`
          : ""
      }
    </article>
  `;
}

// The notifications behind "avisos que no entendí": promos and codes are expected here;
// a purchase listed here means Nu changed its wording and the reading needs updating.
function renderBankUnreadableSheet() {
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="bank-unreadable-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Gastos desde Nu</p><h2 id="bank-unreadable-title">Avisos que no entendí</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <p class="setaside-note">Promociones o códigos de seguridad son normales aquí. Si ves una compra o una plata que te llegó, avísanos: Nu cambió cómo escribe sus avisos y hay que actualizar la app.</p>
        <ul class="bank-unreadable-list">
          ${bankUnreadable
            .map(
              (notification) => `
            <li>
              <strong>${escapeHtml(notification.title || "Sin título")}</strong>
              <span>${escapeHtml(notification.text || "")}</span>
              <small>${escapeHtml(formatDate(new Date(Number(notification.postedAt || 0)).toISOString().slice(0, 10)))}</small>
            </li>
          `
            )
            .join("")}
        </ul>
        <button class="btn ghost" type="button" data-action="forget-bank-unreadable">Borrar estos avisos</button>
      </section>
    </div>
  `;
}

// Shown before Android's permission screen, as Google Play requires for notification
// access: what is read, what is kept and where, before the user grants anything.
function renderBankDisclosureSheet() {
  return `
    <div class="sheet-backdrop" role="presentation" data-action="close-plan-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="bank-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Gastos desde Nu</p><h2 id="bank-sheet-title">Tus compras de Nu, listas para confirmar</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">${renderIcon("close")}</button>
        </div>
        <ul class="bank-disclosure-list">
          <li>Leemos solo las notificaciones de la app de Nu, para sacar el monto y el comercio de cada compra. Las de otras apps se descartan sin guardarlas.</li>
          <li>Lo que leemos se queda en este teléfono: no se sube a la nube ni se comparte con nadie.</li>
          <li>Nunca registramos un gasto sin que lo confirmes.</li>
          <li>Puedes apagarlo cuando quieras desde Datos.</li>
        </ul>
        <p class="setaside-note">Después, Android te pedirá permitir el acceso a notificaciones para Finanzas Conductuales.</p>
        <button class="btn primary" type="button" data-action="enable-bank-notifications">Continuar</button>
        <button class="btn ghost" type="button" data-action="close-plan-sheet">Ahora no</button>
      </section>
    </div>
  `;
}

function handleHardwareBackButton() {
  if (tour) {
    if (tour.position > 0) moveTour(-1);
    else endTour();
    return;
  }
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

function lockAccountEmail() {
  return cloudState.configured ? cloudState.email || state.meta?.cloudUserEmail || "" : "";
}

// A forgotten PIN used to have no way out but clearing the app's data in Android settings,
// losing anything not yet in the cloud. The account password proves it is the owner.
function renderLockForgot() {
  const email = lockAccountEmail();
  return `
    <div class="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-forgot-title">
      <section class="lock-card lock-forgot-card">
        <span class="lock-icon" aria-hidden="true">${renderIcon("lock")}</span>
        <h2 id="lock-forgot-title">Olvidé mi PIN</h2>
        ${
          email
            ? `<p>Escribe la contraseña de ${escapeHtml(email)} y quitamos el bloqueo. Después puedes crear un PIN nuevo en Datos.</p>
              <form id="lock-forgot-form" class="lock-forgot-form">
                <label>
                  Contraseña de tu cuenta
                  <input name="password" type="password" autocomplete="current-password" required>
                </label>
                ${lockError ? `<p class="lock-error" role="alert">${escapeHtml(lockError)}</p>` : ""}
                <button class="btn primary" type="submit" ${lockForgotBusy ? "disabled" : ""}>${lockForgotBusy ? "Verificando…" : "Quitar bloqueo"}</button>
              </form>`
            : `<p>Sin una cuenta no hay forma de comprobar que eres tú. Para volver a entrar, borra los datos de la app desde los ajustes de Android; se perderá lo que tengas en este teléfono.</p>`
        }
        <button class="btn ghost" type="button" data-lock-forgot-back>Volver</button>
      </section>
    </div>
  `;
}

async function handleLockForgotSubmit(event) {
  event.preventDefault();
  const password = String(new FormData(event.currentTarget).get("password") || "");
  const email = lockAccountEmail();
  if (!password || !email || lockForgotBusy) {
    return;
  }
  lockForgotBusy = true;
  lockError = "";
  render();
  try {
    await signInToCloud(email, password);
    lockConfig = { enabled: false, hash: "", salt: "", biometric: false, failedAttempts: 0, lockUntil: 0 };
    saveLockConfig(lockConfig);
    lockMode = "";
    lockDigits = "";
    showNoticeSnackbar("Quitamos el bloqueo. Si quieres, crea un PIN nuevo en Datos.", { renderNow: false });
  } catch (error) {
    lockError = /invalid|credentials/i.test(String(error?.message || ""))
      ? "Esa contraseña no coincide con tu cuenta."
      : friendlyCloudError(error);
  } finally {
    lockForgotBusy = false;
    render();
  }
}

function renderLockScreen() {
  if (lockMode === "forgot") {
    return renderLockForgot();
  }
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
        ${lockMode === "unlock" ? `<button class="lock-forgot-link" type="button" data-lock-forgot>Olvidé mi PIN</button>` : ""}
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



function buildMovementsCsv() {
  return movementsCsv(state.transactions, state.budgetExtras, { categoryName, locationLabel });
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
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function removeMerchantRule(id) {
  const rule = state.merchantRules.find((item) => item.id === id);
  state.merchantRules = state.merchantRules.filter((item) => item.id !== id);
  state.lastAlert = rule ? `Quité la regla de ${rule.merchant}.` : "Regla quitada.";
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function removeTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  state.transactions = state.transactions.filter((item) => item.id !== id);
  if (transaction && state.liquidity?.initialized) {
    adjustLiquidity(transaction.source, Number(transaction.amount || 0), "refund");
  }
  if (transaction?.calendarEventId) {
    reopenCalendarEvent(transaction.calendarEventId, transaction.id);
  }
  state.lastAlert = transaction
    ? `${transaction.merchant} eliminado. La categoría se recalculó.`
    : "Gasto eliminado.";
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
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
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function updateBudgetExtra(extra, next) {
  const window = budgetSummary().window;
  const oldAppliesNow = dateIsInWindow(extra.date, window);
  const nextAppliesNow = dateIsInWindow(next.date, window);
  const oldLocation = normalizeIncomeLocation(extra.location);
  const nextLocation = normalizeIncomeLocation(next.location);
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
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function unlockCooldown(id) {
  const cooldown = state.cooldowns.find((item) => item.id === id);
  if (!cooldown || new Date(cooldown.unlockAt).getTime() > Date.now()) {
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
  const overdraft = overdraftNotice(cooldown.source);
  state.lastAlert = overdraft || createSpendAlert(cooldown.category);
  if (overdraft) {
    showNoticeSnackbar(overdraft, { renderNow: false });
  }
}

function addTransaction({ merchant, description = "", amount, category, budgeted, oneOff = false, source = "account", calendarEventId = "", date = todayKey() }) {
  const location = normalizeLocation(source);
  const now = new Date().toISOString();
  adjustLiquidity(location, -Number(amount || 0), "expense");
  const transaction = {
    id: uid("tx"),
    date,
    merchant,
    description: cleanText(description, ""),
    amount,
    category,
    // "Libre" is the absence of a category, so it never counts as classified.
    labeled: Boolean(category) && category !== FREE_CATEGORY_ID,
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
  return job ? { job, label: job.name, createName: job.name } : { job: null, label: "Ahorro", createName: "Ahorro" };
}

function findSavingsJob() {
  const matches = state.budgetJobs.filter(isSavingsJob);
  return matches.find((job) => job.cadence === "period") || matches[0];
}

// Sets money aside into a fund that stays reserved across periods until it's spent or
// released: a top-up on an existing category, or a new "once" category. Each entry
// records the period it was made in so earlier periods' spending can draw it down
// (finance-core jobFund) instead of it being reserved again every period.
function setAsideForThisPeriod(job, name, amount, updatedAt) {
  const windowStart = budgetSummary().window.start;
  if (job) {
    job.topUps = [...(job.topUps || []), { windowStart, amount }];
    job.updated_at = updatedAt;
    return job;
  }
  const created = {
    id: uniqueCategoryId(name),
    name,
    amount,
    cadence: "once",
    windowStart,
    topUps: [],
    updated_at: updatedAt
  };
  state.budgetJobs.push(created);
  return created;
}

// The savings share of extra money goes to the savings category, created if missing, but
// never past the category limit: that used to leave the plan at "11 de 10".
function canSeparateSavings() {
  return Boolean(savingsAllocationTarget().job) || state.budgetJobs.length < MAX_CATEGORIES;
}

function applySavingsAllocation(amount, updatedAt) {
  if (amount <= 0) {
    return null;
  }

  const target = savingsAllocationTarget();
  return setAsideForThisPeriod(target.job, target.createName, amount, updatedAt);
}

// Setting money aside under a name the plan already has tops up that category's fund
// (setAsideForThisPeriod records it as a top-up, never by touching job.amount, which a
// weekly/monthly cadence would multiply) instead of creating a second one.
function setAsideTarget(name) {
  const wanted = String(name).trim().toLowerCase();
  const match = state.budgetJobs.find((job) => String(job.name || "").trim().toLowerCase() === wanted);
  return match ? { job: match, createName: match.name } : { job: null, createName: name };
}

function handleSetAsideSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = cleanText(data.get("name"), "Apartado");
  const amount = numberFrom(data.get("amount"));
  const target = setAsideTarget(name);
  const error = categoryReserveError({ name: target.createName, amount, createsCategory: !target.job });
  if (error) {
    failCategoryForm(error);
    return;
  }

  setAsideForThisPeriod(target.job, target.createName, amount, new Date().toISOString());

  planSheet = "";
  state.lastAlert = `Apartaste ${formatMoney(amount)} para ${target.createName}.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
  saveState();
  render();
}

// "Liberar": hands what's left of a category's fund back to Libre. A set-aside-only
// category with nothing spent this period is removed outright; otherwise the release is
// recorded so this period's spending on it keeps its category, and the emptied fund is
// dropped at the next period like any other.
function releaseFund(jobId) {
  const job = state.budgetJobs.find((item) => item.id === jobId);
  if (!job) {
    return;
  }
  const { windowStart, spent, releasable: amount } = fundStanding(job);
  if (amount <= 0) {
    return;
  }

  if (job.cadence === "once" && spent === 0) {
    state.budgetJobs = state.budgetJobs.filter((item) => item.id !== jobId);
    state.retiredCategoryNames = { ...(state.retiredCategoryNames || {}), [job.id]: job.name };
  } else {
    job.released = [...(job.released || []), { windowStart, amount }];
    job.updated_at = new Date().toISOString();
  }
  state.lastAlert = `Liberaste ${formatMoney(amount)} de ${job.name}. Vuelve a contar como libre.`;
  showNoticeSnackbar(state.lastAlert, { renderNow: false });
}

function reduceSavingsAllocation(jobId, amount) {
  const job = state.budgetJobs.find((item) => item.id === jobId);
  if (!job) {
    return;
  }
  job.updated_at = new Date().toISOString();
  const topUps = job.topUps || [];
  const index = topUps.findIndex((topUp) => Number(topUp.amount) === Number(amount));
  if (index >= 0) {
    job.topUps = topUps.filter((_, position) => position !== index);
  } else if (job.cadence === "period") {
    // Saved before one-off set-asides existed: the amount was added to the base.
    job.amount = Math.max(0, Number(job.amount || 0) - amount);
  }
  if (job.cadence === "once" && Number(job.amount || 0) <= 0 && !(job.topUps || []).length) {
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

function showUndoSnackbar(transactionId, note = "") {
  clearTimeout(snackbarTimer);
  snackbar = {
    message: note ? `Gasto registrado. ${note}` : "Gasto registrado. ¿Deshacer?",
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
  return plannedTotal(state.calendarEvents || [], start, todayKey(endDate));
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
  if (reminder.lastShownDate !== today && !recordedExpenseToday()) {
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
  const body = "¿Quieres registrar tus gastos de hoy?";
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
            isExactNotification: false,
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
  // At launch the reminder was planned before the permission was known.
  scheduleDailyReminder();
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

function recordedExpenseToday() {
  const today = todayKey();
  return (state.transactions || []).some((transaction) => String(transaction.date || "").slice(0, 10) === today);
}

// Not exact on purpose: a reminder a few minutes late is fine, and asking for exact
// alarms makes Android open its "Alarmas y recordatorios" settings screen in the
// middle of the app (the local-notifications plugin does it on schedule since 8.3).
async function scheduleNativeDailyReminder(reminder = normalizeDailyReminder(state.dailyReminder)) {
  const localNotifications = nativeLocalNotifications();
  if (!localNotifications) {
    return false;
  }
  const permission = notificationPermissionStatus();
  const skipToday = recordedExpenseToday();
  const plan = JSON.stringify([reminder.enabled, reminder.time, permission, skipToday, todayKey()]);
  if (plan === nativeReminderPlan) {
    return reminder.enabled && permission === "granted";
  }
  nativeReminderPlan = plan;
  const ids = Array.from({ length: REMINDER_DAYS_AHEAD }, (_, index) => DAILY_REMINDER_FIRST_ID + index);
  try {
    await localNotifications.cancel({
      notifications: [DAILY_REMINDER_NOTIFICATION_ID, ...ids].map((id) => ({ id }))
    });
    if (!reminder.enabled || permission !== "granted") {
      return false;
    }
    const dates = upcomingReminderDates(reminder.time, { skipToday });
    await localNotifications.schedule({
      notifications: dates.map((at, index) => ({
        id: ids[index],
        title: "Revisión de gastos",
        body: "¿Quieres registrar tus gastos de hoy?",
        schedule: { at, allowWhileIdle: true },
        isExactNotification: false,
        extra: { route: QUICK_EXPENSE_HASH }
      }))
    });
    return true;
  } catch {
    nativeReminderPlan = "";
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
      credit: 0,
      total: summary.freeRemaining,
      initialized: false
    };
  }
  return {
    ...liquidity,
    // Minus what is owed on the card (see budgetSummary's liquidityTotal).
    total: liquidity.account + liquidity.cash - liquidity.credit
  };
}

// Runs before anything else reads budgetSummary(). The decision itself (is this
// period's fixed income due? was it already logged or rejected?) is the pure
// resolvePeriodIncome() in finance-core.js; this only applies its result to `state`.
function ensurePeriodIncomeApplication() {
  retireExpiredOneOffs();
  const result = resolvePeriodIncome(state, todayKey());
  state.periodIncomeStatus = result.periodIncomeStatus;
  state.periodIncomeApplied = result.periodIncomeApplied;
  if (result.deposit > 0) {
    adjustLiquidity("account", result.deposit, "ingreso-periodico");
  }
}

function retireExpiredOneOffs() {
  const windowStart = getBudgetWindow(state.profile, todayKey()).start;
  // A set-aside saved without the period it was made in would count as made "now" in
  // every period (re-reserving it forever); pin it to this one.
  state.budgetJobs.forEach((job) => {
    if (job.cadence === "once" && !job.windowStart) {
      job.windowStart = windowStart;
    }
  });
  const { budgetJobs, retired } = pruneExpiredOneOffs(state.budgetJobs, windowStart, state.profile, state.transactions);
  if (budgetJobs.length === state.budgetJobs.length && budgetJobs.every((job, index) => job === state.budgetJobs[index])) {
    return;
  }
  state.budgetJobs = budgetJobs;
  state.retiredCategoryNames = { ...(state.retiredCategoryNames || {}) };
  retired.forEach(({ id, name }) => {
    state.retiredCategoryNames[id] = name;
  });
  cachedBudgetSummary = null;
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
  if (key === "credit") {
    // An expense arrives as a negative delta; on the card it raises what is owed, hence
    // the flipped sign. Refunding or paying (positive delta) lowers it, never below 0.
    liquidity.credit = Math.max(0, liquidity.credit - amount);
  } else {
    liquidity[key] += amount;
  }
  liquidity.initialized = true;
  liquidity.updated_at = new Date().toISOString();
  state.liquidity = liquidity;
}

function budgetExtrasForSummary(summary = budgetSummary()) {
  return inWindow(state.budgetExtras, summary.window);
}

function transactionsForSummary(summary = budgetSummary()) {
  return inWindow(state.transactions, summary.window);
}

function movementsForSummary(summary = budgetSummary()) {
  return periodMovements(state.transactions, state.budgetExtras, summary.window);
}

function categoryStatus() {
  const summary = budgetSummary();
  const freeCap = freeCapForPeriod(summary);
  const freeRatio = freeCap ? (summary.freeSpent / freeCap) * 100 : summary.freeSpent > 0 ? 120 : 0;
  return [
    ...getCategoryStatus(state, todayKey()),
    {
      id: FREE_CATEGORY_ID,
      name: "Libre / sin clasificar",
      budget: freeCap,
      spent: summary.freeSpent,
      ratio: freeRatio,
      band: freeRatio > 90 ? "danger" : freeRatio > 65 ? "warning" : "good"
    }
  ];
}

// There is ONE "dinero libre": summary.freeRemaining, the hero on Inicio. For fixed income
// it comes from the real balance, while freeBudget is the period's income minus
// reservations, and the two differ as soon as the balance and the income differ. Showing
// freeBudget anywhere labeled "libre" put two different "libres" on screen (Inicio
// $1.700.000, Plan $1.900.000). The Libre row's cap is what was free before this period's
// free spending, measured the same way as the hero.
function freeCapForPeriod(summary = budgetSummary()) {
  return summary.usesLiquidityBasedFree ? summary.freeSpent + summary.freeRemaining : summary.freeBudget;
}

function categoryName(categoryId) {
  if (categoryId === FREE_CATEGORY_ID) {
    return "Libre / sin clasificar";
  }
  return state.budgetJobs.find((job) => job.id === categoryId)?.name || state.retiredCategoryNames?.[categoryId] || "Sin categoría";
}

function activeMerchantRules() {
  const validCategories = new Set(state.budgetJobs.map((job) => job.id));
  return (state.merchantRules || [])
    .filter((rule) => validCategories.has(rule.category))
    .slice()
    .sort((a, b) => String(b.lastUsedAt || b.updated_at || "").localeCompare(String(a.lastUsedAt || a.updated_at || "")) || Number(b.count || 0) - Number(a.count || 0));
}

// The category (and, from the user's own habits, the way of paying) a merchant probably
// goes with: the user's past choices first, then the same brand at another branch, then
// well-known names matched to the user's categories (categorize.js). Shaped like a rule.
function findMerchantRule(merchant) {
  const suggestion = suggestCategory(merchant, { rules: activeMerchantRules(), categories: state.budgetJobs });
  if (!suggestion) {
    return null;
  }
  return {
    id: suggestion.rule?.id || `${suggestion.via}:${suggestion.category}`,
    category: suggestion.category,
    source: suggestion.source,
    via: suggestion.via
  };
}

// Classifying by hand teaches the merchant's category, so the next purchase there (and,
// through its brand, at its other branches) comes already filed.
function classifyTransaction(transaction, category) {
  transaction.category = category || FREE_CATEGORY_ID;
  transaction.labeled = transaction.category !== FREE_CATEGORY_ID;
  transaction.updated_at = new Date().toISOString();
  rememberMerchantRule(transaction);
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
  state.merchantRules = state.merchantRules.slice(0, MAX_MERCHANT_RULES);
}

function spendByCategory() {
  return getSpendByCategory(state, todayKey());
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
  if (view !== state.activeView) {
    scrollToTop();
    movementsPeriodOffset = 0;
  }
  state.activeView = view;
  menuOpen = false;
  const nextHash = hashFromView(view);
  if (window.location.hash.replace("#", "") !== nextHash) {
    window.location.hash = nextHash;
  }
}

// The page scrolls on window and render() keeps that offset, so switching sections used
// to land mid-page (Plan and Ahorro opened with their titles scrolled out of sight).
function scrollToTop() {
  try {
    window.scrollTo(0, 0);
  } catch {
    // Not available (jsdom); nothing to reset.
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

// Native date and time pickers follow the PHONE's language, so on an English phone the
// app showed "09/25/2026" and "8:00 PM" next to its own "25 de sept". The field cannot be
// reformatted, so the chosen value is repeated below it in the app's format.
function dateCaptionText(input) {
  const value = input.value;
  if (!value) return "";
  if (input.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const label = capitalize(MOVEMENT_DAY_FORMATTER.format(new Date(`${value}T12:00:00`)));
    return value.slice(0, 4) === todayKey().slice(0, 4) ? label : `${label} de ${value.slice(0, 4)}`;
  }
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `A las ${Number(match[1])}:${match[2]}` : "";
}

function bindDateCaptions(root = document) {
  root?.querySelectorAll('input[type="date"], input[type="time"]').forEach((input) => {
    if (input.dataset.dateCaptionBound === "true") return;
    input.dataset.dateCaptionBound = "true";
    const caption = document.createElement("small");
    caption.className = "date-caption";
    caption.setAttribute("aria-hidden", "true");
    input.after(caption);
    const update = () => {
      caption.textContent = dateCaptionText(input);
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    update();
  });
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
    input.value = formatMoneyInputValue(input.value, input.dataset.allowNegative === "true");
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
  const formatted = formatMoneyInputValue(input.value, input.dataset.allowNegative === "true");
  input.value = formatted;
  const nextCursor = positionAfterDigitCount(formatted, digitCountBeforeCursor);
  try {
    input.setSelectionRange(nextCursor, nextCursor);
  } catch {
    input.selectionStart = nextCursor;
    input.selectionEnd = nextCursor;
  }
}

// Stripping every non-digit also stripped a minus sign, so a -50.000 balance showed as
// 50.000 and saved back positive. Only fields that may hold an overdraft keep the sign.
function formatMoneyInputValue(value, allowNegative = false) {
  const text = String(value ?? "");
  const sign = allowNegative && text.trim().startsWith("-") ? "-" : "";
  const digits = text.replace(/\D/g, "").slice(0, MONEY_INPUT_MAX_DIGITS);
  if (!digits) {
    return sign;
  }
  return sign + PLAIN_NUMBER_FORMATTER.format(Number(digits));
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
  const key = normalizeLocation(location);
  if (key === "cash") {
    return "Efectivo";
  }
  return key === "credit" ? "Tarjeta" : "Cuenta";
}

function cadenceLabel(cadence) {
  const labels = {
    weekly: "semanal",
    biweekly: "quincenal",
    monthly: "mensual",
    semester: "semestral",
    yearly: "anual",
    period: "por periodo",
    once: "apartado"
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
