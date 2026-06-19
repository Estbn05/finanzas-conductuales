import {
  FREE_CATEGORY_ID,
  LARGE_PURCHASE_RATIO,
  budgetAmountForJob as getBudgetAmountForJob,
  budgetRingAllocation as getBudgetRingAllocation,
  budgetSummary as getBudgetSummary,
  calculatePlan as calculateFinancePlan,
  categoryStatus as getCategoryStatus,
  getPeriodIncome,
  getMonthlyIncome,
  monthlyLabeledSpend as getMonthlyLabeledSpend,
  predictUntilNextPeriod as getPeriodPrediction,
  spendByCategory as getSpendByCategory
} from "./finance-core.js?v=20260619-period-prediction-v23";
import {
  clearStoredCloudSession,
  getCloudSession,
  isCloudConfigured,
  isCloudLibraryLoaded,
  loadCloudState,
  onCloudAuthChange,
  saveCloudState,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud
} from "./sync-client.js?v=20260619-period-prediction-v23";

const STORAGE_KEY = "finanzas-conductuales:v1";
const BACKUP_KEY = "finanzas-conductuales:backups:v1";
const DEFAULT_VIEW = "today";
const QUICK_EXPENSE_HASH = "registrar-gasto";
const AUTH_STARTUP_TIMEOUT_MS = 25_000;
const DEFAULT_REMINDER_TIME = "20:00";
const STUDENT_SEMESTER_INCOME = 1_750_000;
const STUDENT_SEMESTER_MONTHS = 6;
const STUDENT_WEEKLY_GAS = 30_000;
const STUDENT_BUDGET_JOBS = [
  { id: "gas", name: "Gasolina moto", amount: STUDENT_WEEKLY_GAS, cadence: "weekly" },
  { id: "dates", name: "Salidas con novia", amount: 45_000, cadence: "monthly" },
  { id: "gifts", name: "Regalos para novia", amount: 20_000, cadence: "monthly" },
  { id: "university", name: "Universidad y comida", amount: 25_000, cadence: "monthly" },
  { id: "flex", name: "Imprevistos", amount: 9_000, cadence: "monthly" }
];

const NAV_ITEMS = [
  { id: "today", label: "Inicio", icon: "01" },
  { id: "budget", label: "Plan", icon: "02" },
  { id: "savings", label: "Ahorro", icon: "03" },
  { id: "calendar", label: "Calendario", icon: "04" },
  { id: "movements", label: "Movimientos", icon: "05" },
  { id: "profile", label: "Datos", icon: "06" }
];
const APP_VIEWS = new Set([...NAV_ITEMS.map((item) => item.id), "spending"]);

const app = document.querySelector("#app");
let state = loadState();
state.activeView = viewFromHash(DEFAULT_VIEW);
let menuOpen = false;
let quickExpenseOpen = isQuickExpenseLocation();
if (quickExpenseOpen) {
  seedQuickExpenseBackEntry();
}
let applyingCloudState = false;
let cloudSaveTimer;
let authUnsubscribe = () => {};
let authMode = "";
let transactionHistorySort = "recent";
let snackbar = null;
let snackbarTimer;
let pendingExtraAllocation = null;
let planSheet = "";
let pendingJobRemovalId = "";
let editingTransactionId = "";
let editingExtraId = "";
let expenseDraft = null;
let diagnosisValidation = { field: "", message: "" };
let cloudState = {
  configured: isCloudConfigured(),
  email: "",
  error: "",
  libraryLoaded: isCloudLibraryLoaded(),
  sessionReady: false,
  signedIn: false,
  status: isCloudConfigured() ? "checking" : "local"
};
let dailyReminderTimer;

applyThemePreference();
render();
window.setTimeout(recoverAuthStartup, AUTH_STARTUP_TIMEOUT_MS);
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
window.addEventListener("online", render);
window.addEventListener("offline", render);

function createDefaultState() {
  const today = todayKey();
  const now = new Date().toISOString();

  return {
    activeView: DEFAULT_VIEW,
    showDiagnosis: false,
    lastAlert: "Registra cada gasto en menos de un minuto. Usa Mis datos para ajustar tus numeros reales.",
    updated_at: now,
    meta: {
      updatedAt: now,
      updated_at: now,
      cloudUpdatedAt: "",
      cloudUserEmail: "",
      budgetPreset: ""
    },
    profile: {
      completed: false,
      name: "Tu plan",
      currency: "COP",
      incomeAmount: STUDENT_SEMESTER_INCOME,
      monthlyIncome: monthlyFromSemester(STUDENT_SEMESTER_INCOME, STUDENT_SEMESTER_MONTHS),
      semesterIncome: STUDENT_SEMESTER_INCOME,
      semesterMonths: STUDENT_SEMESTER_MONTHS,
      periodStart: monthStartKey(today),
      semesterStart: monthStartKey(today),
      incomeCadence: "semester",
      incomeType: "variable",
      volatility: "medium",
      committedExpenses: monthlyFromWeekly(STUDENT_WEEKLY_GAS),
      weeklyGas: STUDENT_WEEKLY_GAS,
      relationshipMonthlyBudget: 45_000,
      giftMonthlyBudget: 20_000,
      emergencySavings: 0,
      payday: 1,
      financialAnxiety: 6,
      selfEfficacy: 5,
      moneyScripts: {
        worship: 4,
        avoidance: 3,
        status: 2,
        vigilance: 4
      },
      updated_at: now
    },
    settings: {
      monthlyRaisePct: 8,
      escalationPct: 50,
      theme: "light",
      updated_at: now
    },
    budgetExtras: [],
    calendarEvents: [],
    dailyReminder: {
      enabled: false,
      time: DEFAULT_REMINDER_TIME,
      lastShownDate: "",
      updated_at: now
    },
    liquidity: {
      account: 0,
      cash: 0,
      initialized: false,
      updated_at: now
    },
    budgetJobs: [],
    transactions: [],
    cooldowns: [],
    periodClosures: [],
    merchantRules: [],
    checkins: [],
    wins: []
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return createDefaultState();
    }
    return migrateState(JSON.parse(saved));
  } catch {
    return createDefaultState();
  }
}

function migrateState(savedState) {
  const defaults = createDefaultState();
  const migrated = {
    ...defaults,
    activeView: savedState.activeView || defaults.activeView,
    showDiagnosis: Boolean(savedState.showDiagnosis),
    lastAlert: savedState.lastAlert || defaults.lastAlert,
    updated_at: savedState.updated_at || defaults.updated_at,
    meta: { ...defaults.meta, ...(savedState.meta || {}) },
    profile: { ...defaults.profile, ...(savedState.profile || {}) },
    settings: {
      monthlyRaisePct: Number(savedState.settings?.monthlyRaisePct ?? defaults.settings.monthlyRaisePct),
      escalationPct: Number(savedState.settings?.escalationPct ?? defaults.settings.escalationPct),
      theme: normalizeTheme(savedState.settings?.theme || defaults.settings.theme),
      updated_at: savedState.settings?.updated_at || defaults.settings.updated_at
    },
    transactions: normalizeTransactions(savedState.transactions || defaults.transactions),
    budgetExtras: normalizeBudgetExtras(savedState.budgetExtras || defaults.budgetExtras),
    calendarEvents: normalizeCalendarEvents(savedState.calendarEvents || defaults.calendarEvents),
    dailyReminder: normalizeDailyReminder(savedState.dailyReminder || defaults.dailyReminder),
    liquidity: normalizeLiquidity(savedState.liquidity || defaults.liquidity),
    cooldowns: savedState.cooldowns || defaults.cooldowns,
    periodClosures: normalizePeriodClosures(savedState.periodClosures || defaults.periodClosures),
    merchantRules: normalizeMerchantRules(savedState.merchantRules || defaults.merchantRules, savedState.transactions || defaults.transactions),
    checkins: savedState.checkins || defaults.checkins,
    wins: savedState.wins || defaults.wins
  };
  migrated.profile.incomeAmount = migrated.profile.incomeAmount ?? migrated.profile.semesterIncome ?? migrated.profile.monthlyIncome ?? defaults.profile.incomeAmount;
  migrated.profile.periodStart = migrated.profile.periodStart || migrated.profile.semesterStart || defaults.profile.periodStart;
  migrated.profile.semesterStart = migrated.profile.semesterStart || migrated.profile.periodStart;
  migrated.profile.payday = normalizePayday(migrated.profile.payday ?? defaults.profile.payday);
  migrated.budgetJobs = normalizeBudgetJobs(savedState.budgetJobs || defaults.budgetJobs);
  migrated.merchantRules = filterMerchantRulesForJobs(migrated.merchantRules, migrated.budgetJobs);
  if (migrated.profile.completed && migrated.meta.budgetPreset !== "student" && isTemplateBudgetJobs(migrated.budgetJobs)) {
    clearTemplateBudget(migrated);
    migrated.lastAlert = "Quite los campos de plantilla. Crea solo los campos que si usas.";
  }
  return migrated;
}

function saveState(options = {}) {
  const { sync = true, touch = true } = options;
  state.meta = { ...(state.meta || {}) };
  if (touch) {
    const now = new Date().toISOString();
    state.updated_at = now;
    state.meta.updatedAt = now;
    state.meta.updated_at = now;
  }
  state.meta.cloudUserEmail = cloudState.email || state.meta?.cloudUserEmail || "";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleDailyReminder();
  if (sync && !applyingCloudState) {
    scheduleCloudSave();
  }
}

async function initializeCloudSync() {
  if (!cloudState.configured) {
    cloudState.status = "local";
    cloudState.error = "Configura Supabase para activar sincronizacion.";
    cloudState.sessionReady = true;
    renderCloudStatusChange();
    return;
  }

  if (!cloudState.libraryLoaded) {
    cloudState.status = "local";
    cloudState.error = "No se pudo cargar la libreria de autenticacion. Revisa internet y vuelve a cargar.";
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
    authUnsubscribe = onCloudAuthChange((nextSession) => {
      if (nextSession) {
        applyCloudSession(nextSession);
        cloudState.sessionReady = true;
        if (cloudState.status !== "syncing") {
          pullCloudAfterLogin();
        }
      } else {
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
    if (remote?.app_state) {
      const localTime = stateUpdatedTime(state);
      const remoteTime = cloudRecordUpdatedTime(remote);
      const localHasData = hasMeaningfulLocalData(state);
      const remoteHasData = hasMeaningfulLocalData(remote.app_state);

      if (localHasData && !remoteHasData) {
        const saved = await saveCloudState(getCloudPayload());
        markCloudSynced(saved?.updated_at || new Date().toISOString());
        state.lastAlert = "La nube estaba vacia; conserve tus datos locales y los subi.";
        cloudState.status = "synced";
        renderCloudStatusChange();
        return;
      }

      if (localTime > remoteTime && localHasData) {
        const saved = await saveCloudState(getCloudPayload());
        markCloudSynced(saved?.updated_at || new Date().toISOString());
        state.lastAlert = "Tus cambios locales eran mas recientes y se subieron a la nube.";
        cloudState.status = "synced";
        renderCloudStatusChange();
        return;
      }

      if ((remoteTime > localTime && remoteHasData) || (!localHasData && remoteHasData)) {
        applyRemoteState(remote.app_state, remote.updated_at, "Nube sincronizada automaticamente.");
        cloudState.status = "synced";
        renderCloudStatusChange();
        return;
      }

      markCloudSynced(remote.updated_at || new Date().toISOString());
      cloudState.status = "synced";
      state.lastAlert = "Nube al dia.";
      renderCloudStatusChange();
      return;
    }

    const saved = await saveCloudState(getCloudPayload());
    state.meta = {
      ...(state.meta || {}),
      cloudUpdatedAt: saved?.updated_at || new Date().toISOString(),
      cloudUserEmail: cloudState.email
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    cloudState.status = "synced";
    state.lastAlert = "Primera copia subida a la nube.";
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
  if (!cloudState.signedIn || cloudState.status === "syncing") {
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
  renderCloudStatusChange();

  try {
    const remote = await loadCloudState();
    if (remote?.app_state) {
      const localTime = stateUpdatedTime(state);
      const remoteTime = cloudRecordUpdatedTime(remote);
      const localHasData = hasMeaningfulLocalData(state);
      const remoteHasData = hasMeaningfulLocalData(remote.app_state);

      if (localHasData && !remoteHasData) {
        const saved = await saveCloudState(getCloudPayload());
        markCloudSynced(saved?.updated_at || new Date().toISOString());
        cloudState.status = "synced";
        cloudState.error = "";
        renderCloudStatusChange();
        return;
      }

      if ((remoteTime > localTime && remoteHasData) || (!localHasData && remoteHasData)) {
        applyRemoteState(remote.app_state, remote.updated_at, "La nube tenia cambios mas recientes. Descargue esa version.");
        cloudState.status = "synced";
        renderCloudStatusChange();
        return;
      }

      if (remoteTime === localTime) {
        markCloudSynced(remote.updated_at || new Date().toISOString());
        cloudState.status = "synced";
        cloudState.error = "";
        renderCloudStatusChange();
        return;
      }
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
  state = migrateState(remoteState);
  state.showDiagnosis = false;
  pendingExtraAllocation = null;
  editingTransactionId = "";
  editingExtraId = "";
  clearSnackbar({ renderNow: false });
  activateView(DEFAULT_VIEW);
  state.lastAlert = alert;
  markCloudSynced(remoteUpdatedAt || new Date().toISOString(), { persist: false });
  saveState({ sync: false, touch: false });
  applyingCloudState = false;
}

function markCloudSynced(updatedAt, options = {}) {
  const { persist = true } = options;
  state.meta = {
    ...(state.meta || {}),
    cloudUpdatedAt: updatedAt,
    cloudUserEmail: cloudState.email
  };
  if (persist) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

function stateUpdatedTime(payload) {
  return Math.max(
    timestampValue(payload?.updated_at),
    timestampValue(payload?.meta?.updated_at),
    timestampValue(payload?.meta?.updatedAt),
    timestampValue(payload?.meta?.cloudUpdatedAt)
  );
}

function cloudRecordUpdatedTime(record) {
  return Math.max(timestampValue(record?.updated_at), stateUpdatedTime(record?.app_state));
}

function timestampValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function hasMeaningfulLocalData(payload) {
  return Boolean(
    payload?.profile?.completed ||
      payload?.liquidity?.initialized ||
      payload?.transactions?.length ||
      payload?.budgetExtras?.length ||
      payload?.calendarEvents?.length ||
      payload?.dailyReminder?.enabled ||
      payload?.budgetJobs?.length ||
      payload?.wins?.length
  );
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
  const backups = [backup, ...readLocalBackups()].slice(0, 5);
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
}

function friendlyCloudError(error) {
  const message = error?.message || String(error);
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes("row-level security") || normalizedMessage.includes("42501")) {
    return "Supabase bloqueo el guardado por permisos de esta sesion. Tus datos locales siguen aqui; cierra sesion e inicia de nuevo. Si se repite, actualiza las politicas SQL de finance_app_state.";
  }
  if (normalizedMessage.includes("invalid login")) {
    return "Correo o contrasena incorrectos.";
  }
  if (normalizedMessage.includes("fetch")) {
    return "No pude conectar con la nube. Revisa internet.";
  }
  if (normalizedMessage.includes("libreria de nube")) {
    return "No pude cargar Supabase. Revisa internet y recarga la pagina.";
  }
  return message;
}

function renderCloudStatusChange() {
  if (shouldShowAuthGate()) {
    render();
    return;
  }
  if (quickExpenseOpen || state.showDiagnosis || pendingExtraAllocation || editingTransactionId || editingExtraId) {
    return;
  }
  render();
}

function openQuickExpense() {
  quickExpenseOpen = true;
  menuOpen = false;
  if (!isQuickExpenseLocation()) {
    window.location.hash = QUICK_EXPENSE_HASH;
  }
}

function seedQuickExpenseBackEntry() {
  const historyState = window.history.state || {};
  window.history.replaceState(historyState, "", `#${hashFromView(state.activeView || DEFAULT_VIEW)}`);
  window.history.pushState(historyState, "", `#${QUICK_EXPENSE_HASH}`);
}

function closeQuickExpense() {
  quickExpenseOpen = false;
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
  if (renderNow) {
    render();
  }
  return true;
}

function render() {
  const currentTheme = applyThemePreference();
  if (shouldShowSessionCheck()) {
    app.classList.remove("is-menu-open", "is-expense-open");
    app.innerHTML = renderSessionCheck();
    return;
  }

  if (shouldShowAuthGate()) {
    app.classList.remove("is-menu-open", "is-expense-open");
    app.innerHTML = renderAuthGate();
    bindEvents();
    return;
  }

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
        ${renderThemeSwitcher(currentTheme)}
        <div class="menu-tools">
          <button class="btn primary" type="button" data-action="open-diagnosis">Mis datos</button>
          <button class="btn ghost" type="button" data-action="cloud-sign-out">Cerrar sesion</button>
          ${menuAlertText() ? `<div class="menu-notice" role="status">${escapeHtml(menuAlertText())}</div>` : ""}
        </div>
      </div>
    </aside>
    <main class="main-panel">
      ${renderConnectionBanner()}
      ${state.activeView === "today" ? renderHeader(plan) : ""}
      ${renderView(plan)}
    </main>
    ${renderBottomNavigation()}
    ${quickExpenseOpen ? renderQuickExpensePanel() : ""}
    ${planSheet ? renderPlanSheet() : ""}
    ${pendingJobRemovalId ? renderJobRemovalConfirmation() : ""}
    ${editingTransactionId ? renderTransactionEditor() : ""}
    ${editingExtraId ? renderExtraEditor() : ""}
    ${!state.profile.completed || state.showDiagnosis ? renderDiagnosisModal() : ""}
    ${pendingExtraAllocation ? renderExtraAllocationModal() : ""}
    ${renderSnackbar()}
  `;

  bindEvents();
}

function renderThemeSwitcher(currentTheme = themePreference()) {
  return `
    <div class="theme-switcher" role="group" aria-label="Cambiar tema">
      <span>Apariencia</span>
      <div class="theme-options">
        <button class="theme-choice ${currentTheme === "light" ? "is-active" : ""}" type="button" data-action="set-theme" data-theme-choice="light" aria-pressed="${currentTheme === "light" ? "true" : "false"}">
          Claro
        </button>
        <button class="theme-choice ${currentTheme === "dark" ? "is-active" : ""}" type="button" data-action="set-theme" data-theme-choice="dark" aria-pressed="${currentTheme === "dark" ? "true" : "false"}">
          Oscuro
        </button>
      </div>
    </div>
  `;
}

function renderNavItem(item) {
  const active = state.activeView === item.id ? "is-active" : "";
  return `
    <button class="nav-item ${active}" type="button" data-view="${item.id}">
      <span class="nav-number">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `;
}

function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

function themePreference() {
  return normalizeTheme(state.settings?.theme);
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
    <nav class="bottom-nav" aria-label="Navegacion rapida">
      <button class="bottom-nav-item ${state.activeView === "today" ? "is-active" : ""}" type="button" data-view="today">
        <span class="bottom-nav-icon" aria-hidden="true">${renderIcon("home")}</span>
        <span>Inicio</span>
      </button>
      <button class="bottom-nav-item ${state.activeView === "budget" ? "is-active" : ""}" type="button" data-view="budget">
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
    income: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M8.5 10h5.25a2.25 2.25 0 0 1 0 4.5H10.5a2.25 2.25 0 0 1-2-1.25"/>'
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

function renderConnectionBanner() {
  if (navigator.onLine) {
    return "";
  }
  return `
    <div class="connection-banner" role="status">
      <span class="connection-dot" aria-hidden="true"></span>
      <div><strong>Sin conexion</strong><span>Tus datos locales siguen disponibles.</span></div>
    </div>
  `;
}

function shouldShowSessionCheck() {
  return !cloudState.sessionReady;
}

function shouldShowAuthGate() {
  return cloudState.sessionReady && !cloudState.signedIn;
}

function renderSessionCheck() {
  return `
    <main class="session-check" aria-busy="true" aria-live="polite">
      <section class="startup-fallback-card">
        <h1>Comprobando tu sesion</h1>
        <p>Estamos verificando automaticamente si ya tienes una sesion iniciada.</p>
      </section>
    </main>
  `;
}

function renderAuthGate() {
  const submittingAccess = cloudState.status === "syncing" && !cloudState.sessionReady;
  const unavailable = !cloudState.configured || !cloudState.libraryLoaded;
  const selectedAuthMode = ["signin", "signup"].includes(authMode) ? authMode : "";
  const signInForm = `
    <article class="auth-card">
      <button class="auth-back" type="button" data-action="back-auth-options">Volver</button>
      <div>
        <p class="eyebrow">Ya tengo cuenta</p>
        <h2>Iniciar sesion</h2>
      </div>
      <form class="stacked-form auth-form" id="cloud-signin-form" data-cloud-auth-form data-cloud-mode="signin">
        <label>
          Correo
          <input name="email" type="email" autocomplete="email" placeholder="tu@email.com" required>
        </label>
        <label>
          Contrasena
          <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Tu contrasena" required>
        </label>
        <button class="btn primary" type="submit" data-cloud-mode="signin" ${submittingAccess ? "disabled" : ""}>Iniciar sesion</button>
      </form>
    </article>
  `;
  const signUpForm = `
    <article class="auth-card">
      <button class="auth-back" type="button" data-action="back-auth-options">Volver</button>
      <div>
        <p class="eyebrow">Primera vez</p>
        <h2>Crear cuenta</h2>
      </div>
      <p class="auth-form-note">Despues de registrarte configuras tu presupuesto y tus campos habituales.</p>
      <form class="stacked-form auth-form" id="cloud-signup-form" data-cloud-auth-form data-cloud-mode="signup">
        <label>
          Correo
          <input name="email" type="email" autocomplete="email" placeholder="tu@email.com" required>
        </label>
        <label>
          Contrasena
          <input name="password" type="password" autocomplete="new-password" minlength="6" placeholder="Minimo 6 caracteres" required>
        </label>
        <button class="btn secondary" type="submit" data-cloud-mode="signup" ${submittingAccess ? "disabled" : ""}>Registrarse</button>
      </form>
    </article>
  `;

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
            Una app para registrar gastos, ver cuanto dinero queda libre y separar categorias del periodo sin convertir cada compra en culpa.
          </p>
          <div class="auth-benefits" aria-label="Para que sirve la app">
            <article>
              <strong>Dinero libre visible</strong>
              <span>El inicio muestra lo disponible despues de reservas, categorias y gastos reales.</span>
            </article>
            <article>
              <strong>Plan por categorias</strong>
              <span>Define limites para gasolina, salidas, universidad o cualquier campo que quieras cuidar.</span>
            </article>
            <article>
              <strong>Sincronizacion segura</strong>
              <span>Tu cuenta guarda una copia en la nube y conserva una copia local para el dia a dia.</span>
            </article>
          </div>
        </div>

        <div class="auth-actions" aria-label="Acceso a la aplicacion">
          ${
            unavailable
              ? `<article class="auth-card">
                  <h2>Acceso no disponible</h2>
                  <p>La autenticacion no esta disponible. Revisa la configuracion de Supabase y vuelve a cargar la aplicacion.</p>
                </article>`
              : selectedAuthMode === "signin"
                ? signInForm
                : selectedAuthMode === "signup"
                  ? signUpForm
                  : `<article class="auth-card auth-choice-card">
                      <div>
                        <p class="eyebrow">Acceso</p>
                        <h2>Elige como entrar</h2>
                      </div>
                      <div class="auth-choice-actions">
                        <button class="btn primary" type="button" data-action="show-auth-form" data-auth-mode="signin">Iniciar sesion</button>
                        <button class="btn secondary" type="button" data-action="show-auth-form" data-auth-mode="signup">Registrarse</button>
                      </div>
                    </article>`
          }
          ${cloudState.error ? `<p class="form-error auth-error" role="alert">${escapeHtml(cloudState.error)}</p>` : ""}
        </div>
      </section>
    </main>
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

  return `
    <header class="money-bar ${summary.overReserved ? "danger" : ""}" role="status" aria-label="Dinero libre sin asignar">
      <div class="money-context"><span>Tu dinero libre</span><span>${period}</span></div>
      <strong>${formatMoney(summary.freeRemaining)}</strong>
      <span class="money-caption">${summary.overReserved ? "Presupuesto sobreasignado" : "Disponible para nuevos gastos"}</span>
      ${
        summary.categoryOverspent > 0
          ? `<span class="money-split danger-text">Exceso sobre topes: ${formatMoney(summary.categoryOverspent)}</span>`
          : ""
      }
      <div class="money-location-chips">
        <div><span>Cuenta</span><strong>${formatMoney(liquidity.account)}</strong></div>
        <div><span>Efectivo</span><strong>${formatMoney(liquidity.cash)}</strong></div>
        <div><span>Total real</span><strong>${formatMoney(liquidity.total)}</strong></div>
      </div>
      <p class="money-help">Libre ya descuenta las reservas. Solo baja por gastos sin categoria o por exceder un limite. Total real muestra cuenta + efectivo.</p>
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
  return hiddenCount > 0 ? `${labels} · +${hiddenCount} mas` : labels;
}

function menuAlertText() {
  const alert = String(state.lastAlert || "");
  return /nube|sincron/i.test(alert) ? "" : alert;
}

function renderView(plan) {
  const views = {
    today: renderToday,
    budget: renderBudget,
    savings: renderSavings,
    calendar: renderCalendar,
    spending: renderSpending,
    movements: renderMovements,
    profile: renderProfile
  };
  return views[state.activeView](plan);
}

function renderToday(plan) {
  const visibleCategoryCount = Math.max(1, Math.min(6, state.budgetJobs.length + 1));
  const homeSummary = budgetSummary();
  return `
    <section class="home-view" aria-label="Resumen del periodo">
      ${renderPeriodPredictionCard(homeSummary)}
      <div class="home-section-heading">
        <div>
          <p class="eyebrow">Categorias del periodo</p>
          <h2>Lo que vas usando</h2>
        </div>
        <button class="home-plan-link" type="button" data-view="budget">Editar limites</button>
      </div>
      ${renderCategoryBars(plan, visibleCategoryCount)}
      ${
        state.budgetJobs.length
          ? ""
          : `<div class="empty-state home-empty actionable-empty">
              <span class="empty-icon" aria-hidden="true">+</span>
              <strong>Tu plan aun no tiene categorias</strong>
              <span>Separa dinero para comida, transporte o cualquier proposito habitual.</span>
              <button class="btn primary" type="button" data-action="open-category-sheet">Crear primera categoria</button>
            </div>`
      }
      <div class="home-period-note">Presupuesto ${formatMoney(homeSummary.income)} · ${Math.round((homeSummary.freeRemaining / Math.max(1, homeSummary.income)) * 100)}% sigue libre</div>
    </section>
  `;

}

function renderPeriodPredictionCard(summary = budgetSummary()) {
  const prediction = periodPrediction();
  const statusLabel = predictionStatusLabel(prediction.status);
  const endDate = formatShortDate(previousDay(summary.window.end));
  const amount = predictionDisplayAmount(prediction);
  return `
    <article class="prediction-card ${prediction.status}" aria-label="Prediccion hasta el proximo periodo">
      <div>
        <p class="eyebrow">Prediccion hasta el proximo periodo</p>
        <h2>${predictionHeadline(prediction)}</h2>
        <span>${predictionCopy(prediction, endDate)}</span>
        <p class="prediction-explainer">No mueve dinero ni crea cargos. Sirve para bajar ansiedad: ves a tiempo si tu dinero libre podria alcanzar antes del proximo pago.</p>
      </div>
      <div class="prediction-number">
        <span>${predictionAmountLabel(prediction)}</span>
        <strong>${formatMoney(amount)}</strong>
        <small>${statusLabel}</small>
      </div>
      ${renderPredictionHelp(prediction)}
    </article>
  `;
}

function renderPredictionHelp(prediction) {
  return `
    <div class="prediction-help" aria-label="Para que sirve y como se calcula">
      <div>
        <strong>Para que sirve</strong>
        <span>${predictionPurposeText(prediction)}</span>
      </div>
      <div>
        <strong>Como se calcula</strong>
        <span>${predictionFormulaIntro(prediction)}</span>
        <code>${predictionFormulaText(prediction)}</code>
        <small>${predictionPaceText(prediction)}</small>
      </div>
    </div>
  `;
}

function predictionPurposeText(prediction) {
  if (prediction.status === "learning") {
    return "Te muestra lo observado sin convertir pocos dias en una alarma grande.";
  }
  if (prediction.status === "risk") {
    if (prediction.freeToday < 0 && prediction.dailyRate === 0) {
      return "Te avisa que el dinero libre de hoy ya quedo negativo, sin culpar al ritmo diario.";
    }
    return "Te avisa antes del proximo pago para ajustar limites, bajar gasto libre o agregar dinero.";
  }
  return "Te ayuda a saber si el dinero libre actual alcanza para cerrar el periodo con calma.";
}

function predictionFormulaIntro(prediction) {
  if (prediction.status === "learning") {
    return "Libre hoy = dinero libre inicial - gasto libre real. El ritmo aun no se proyecta.";
  }
  if (prediction.status === "empty") {
    return "Libre hoy = dinero libre inicial - gasto libre real.";
  }
  return "Libre hoy - gasto libre estimado hasta el proximo pago = cierre estimado.";
}

function predictionFormulaText(prediction) {
  if (prediction.status === "learning" || prediction.status === "empty") {
    return `Libre hoy: ${formatMoney(prediction.freeToday)}`;
  }
  return `${formatMoney(prediction.freeToday)} - (${formatMoney(Math.round(prediction.dailyRate))} x ${formatDays(prediction.remainingDays)}) = ${formatMoney(prediction.projectedEndFree)}`;
}

function predictionPaceText(prediction) {
  const ignored = prediction.ignoredOneOffSpent > 0 ? ` Gasto unico ignorado para ritmo: ${formatMoney(prediction.ignoredOneOffSpent)}.` : "";
  if (prediction.remainingDays <= 0) {
    return "El periodo termina hoy; no hay dias futuros que proyectar.";
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
    return "Tu plan esta sobreasignado";
  }
  if (prediction.status === "empty") {
    return "Aun no hay gasto libre que proyectar";
  }
  if (prediction.status === "learning") {
    return "Aun no hay tendencia suficiente";
  }
  if (prediction.status === "risk") {
    return "Si sigues asi, no alcanza";
  }
  if (prediction.status === "tight") {
    return "Llegas con poco margen";
  }
  return "Vas bien para el proximo pago";
}

function predictionCopy(prediction, endDate) {
  if (prediction.remainingDays <= 0) {
    return "El periodo termina hoy. Guarda el resultado real antes de ajustar el siguiente plan.";
  }
  if (prediction.status === "empty") {
    return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Cuando haya gasto libre real, la app empezara a observar el ritmo.`;
  }
  if (prediction.status === "learning") {
    return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Hay datos, pero todavia no los extrapolo para evitar falsas alarmas.`;
  }
  if (prediction.status === "risk") {
    if (prediction.freeToday < 0 && prediction.dailyRate === 0) {
      return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Hoy ya faltan ${formatMoney(prediction.shortage)} de dinero libre.`;
    }
    return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Si el ritmo se mantiene, podrian faltar ${formatMoney(prediction.shortage)}.`;
  }
  return `Quedan ${formatDays(prediction.remainingDays)} hasta ${endDate}. Si el ritmo se mantiene, llegarias con ${formatMoney(Math.max(0, prediction.projectedEndFree))}.`;
}

function predictionAmountLabel(prediction) {
  if (prediction.status === "over_reserved") {
    return "Por ajustar";
  }
  if (prediction.status === "risk") {
    return "Podrian faltar";
  }
  if (prediction.status === "healthy" || prediction.status === "tight") {
    return "Llegarias con";
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
  return `${count} ${count === 1 ? "dia" : "dias"}`;
}

function renderTransactionLabeler(transaction) {
  return `
    <div class="transaction-row">
      <div>
        <strong>${escapeHtml(transaction.merchant)}</strong>
        ${transaction.description ? `<span>${escapeHtml(transaction.description)}</span>` : ""}
        <span>${formatMoney(transaction.amount)} · ${formatDate(transaction.date)}</span>
      </div>
      <select data-transaction-category="${transaction.id}" aria-label="Categoria para ${escapeAttr(transaction.merchant)}">
        <option value="">Elegir categoria</option>
        <option value="${FREE_CATEGORY_ID}" ${transaction.category === FREE_CATEGORY_ID ? "selected" : ""}>Libre / sin clasificar</option>
        ${state.budgetJobs
          .map(
            (job) =>
              `<option value="${escapeAttr(job.id)}" ${transaction.category === job.id ? "selected" : ""}>${escapeHtml(job.name)}</option>`
          )
          .join("")}
      </select>
    </div>
  `;
}

function renderBudget(plan) {
  const summary = budgetSummary();
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
        <div class="distribution-labels">
          <span><i class="dist-reserved"></i>Reservado <strong>${formatCompactMoney(ring.reserved)}</strong></span>
          <span><i class="dist-spent"></i>Gastado <strong>${formatCompactMoney(ring.spent)}</strong></span>
          <span><i class="dist-free"></i>Libre <strong>${formatCompactMoney(ring.free)}</strong></span>
        </div>
        <div class="distribution-bar" aria-label="Distribucion del presupuesto">
          <span class="dist-reserved" style="width:${reservedRatio}%"></span>
          <span class="dist-spent" style="width:${spentRatio}%"></span>
          <span class="dist-free" style="width:${freeRatio}%"></span>
        </div>
        <div class="distribution-foot">
          <span>Presupuesto total: ${formatMoney(summary.income)}</span>
          <strong>${Math.round(freeRatio)}% libre</strong>
        </div>
        ${ring.outside > 0 ? `<p class="inline-warning">Gastos fuera del presupuesto: ${formatMoney(ring.outside)}.</p>` : ""}
      </article>

      ${renderPeriodCloseCard(summary)}

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
        <h2>Categorias <span>(${state.budgetJobs.length} de 10)</span></h2>
        <span>${formatMoney(summary.freeBudget)} reservables</span>
      </div>

      <div class="plan-category-list">
        ${
          state.budgetJobs.length
            ? state.budgetJobs.map((job) => renderBudgetJob(job)).join("")
            : `<div class="empty-state actionable-empty">
                <span class="empty-icon" aria-hidden="true">+</span>
                <strong>Aun no separas dinero por categorias</strong>
                <span>Crea una categoria y veras su limite siempre antes de gastar.</span>
                <button class="btn primary" type="button" data-action="open-category-sheet">Crear categoria</button>
              </div>`
        }
        <button class="add-category-row" type="button" data-action="open-category-sheet" ${state.budgetJobs.length >= 10 ? "disabled" : ""}>
          <span aria-hidden="true">+</span>
          <strong>Crear categoria</strong>
          <small>max. ${formatCompactMoney(summary.freeBudget)} reservables</small>
        </button>
      </div>
    </section>
  `;
}

function renderPeriodCloseCard(summary = budgetSummary()) {
  const prediction = periodPrediction();
  const closure = periodClosureForWindow(summary.window);
  const movements = movementsForSummary(summary);
  const endDate = formatShortDate(previousDay(summary.window.end));
  const isFinalClose = prediction.remainingDays <= 0;
  const closedLine = closure
    ? `<span class="period-close-saved">Guardado ${formatShortDate(String(closure.closedAt || "").slice(0, 10) || todayKey())}</span>`
    : "";

  return `
    <article class="period-close-card ${prediction.status}">
      <div class="period-close-heading">
        <div>
          <p class="eyebrow">${isFinalClose ? "Cierre del periodo" : "Revision del periodo"}</p>
          <h2>${periodCloseHeadline(prediction)}</h2>
        </div>
        ${closedLine}
      </div>
      <div class="period-close-metrics">
        <div><span>Libre hoy</span><strong>${formatMoney(summary.freeRemaining)}</strong></div>
        <div><span>${predictionAmountLabel(prediction)} al ${endDate}</span><strong>${formatMoney(predictionDisplayAmount(prediction))}</strong></div>
        <div><span>Gastos e ingresos</span><strong>${movements.length}</strong></div>
      </div>
      <p>${periodCloseInsight(summary, prediction)}</p>
      <p class="period-close-calculation"><strong>Calculo:</strong> ${predictionFormulaText(prediction)}. ${predictionPaceText(prediction)}</p>
      <button class="btn secondary" type="button" data-action="save-period-close">${closure ? "Actualizar revision" : isFinalClose ? "Guardar cierre final" : "Guardar revision de hoy"}</button>
    </article>
  `;
}

function periodCloseHeadline(prediction) {
  if (prediction.remainingDays <= 0) {
    return "Listo para guardar el resultado";
  }
  return `Asi vas hasta hoy`;
}

function periodCloseInsight(summary, prediction) {
  if (summary.overReserved > 0) {
    return `Sirve para ver si el plan cabe. Ahora hay ${formatMoney(summary.overReserved)} mas reservado que presupuesto.`;
  }
  if (prediction.status === "learning") {
    return `Sirve para evitar falsas alarmas: ya hay gasto libre, pero aun no hay suficientes dias para convertirlo en tendencia.`;
  }
  if (prediction.status === "risk") {
    return `Sirve para comparar tu libre de hoy con una prediccion al cierre. No es un pago pendiente ni un cargo: es una alerta de que este ritmo no alcanza.`;
  }
  if (summary.categoryOverspent > 0) {
    return `Sirve para dejar visible el ajuste: hay ${formatMoney(summary.categoryOverspent)} por encima de limites, sin borrar movimientos.`;
  }
  return `Sirve para guardar una foto del periodo y comparar despues. No mueve saldos ni borra movimientos.`;
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
        <span>Conversion automatica</span>
        <strong>Escribe un monto para ver su valor en este periodo.</strong>
        <small>Disponible para reservar: ${formatMoney(summary.freeBudget)}</small>
      </div>
      <div class="limit-warning" data-category-limit-warning hidden>
        <span aria-hidden="true">!</span>
        <p>Esta categoria excede el dinero libre del periodo.</p>
      </div>
      <button class="btn primary" type="submit" data-category-submit>Agregar categoria</button>
      <button class="btn ghost" type="button" data-action="close-plan-sheet">Cancelar</button>
    </form>
  `;
}

function renderPlanSheet() {
  if (planSheet === "category") {
    return `
      <div class="sheet-backdrop" role="presentation">
        <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="category-sheet-title">
          <div class="sheet-handle"></div>
          <div class="sheet-heading">
            <div><p class="eyebrow">Plan</p><h2 id="category-sheet-title">Nueva categoria</h2></div>
            <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">x</button>
          </div>
          ${renderBudgetJobForm()}
        </section>
      </div>
    `;
  }

  return `
    <div class="sheet-backdrop" role="presentation">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="extra-sheet-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><span class="extra-badge">Dinero extra</span><h2 id="extra-sheet-title">¿De donde viene?</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-plan-sheet" aria-label="Cerrar">x</button>
        </div>
        <form class="sheet-form" id="extra-budget-form">
          <label>Origen<input name="source" type="text" maxlength="36" placeholder="Ej. Bono trabajo" required></label>
          <label>Monto<input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" required></label>
          <input name="date" type="hidden" value="${todayKey()}">
          <div class="sheet-field">
            <span class="sheet-label">¿Donde entro?</span>
            ${renderChoicePills("location", [
              { value: "account", label: "Cuenta" },
              { value: "cash", label: "Efectivo" }
            ], "account")}
          </div>
          <button class="btn primary" type="submit">Continuar</button>
          <button class="btn ghost" type="button" data-action="close-plan-sheet">Cancelar</button>
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

function renderBudgetJob(job) {
  const spent = spendByCategory()[job.id] || 0;
  const budget = getBudgetAmountForJob(job, state.profile);
  const ratio = budget ? (spent / budget) * 100 : 0;
  const band = ratio > 90 ? "danger" : ratio > 65 ? "warning" : "good";
  const remaining = Math.max(0, budget - spent);
  const status = ratio > 100 ? "Excedida" : ratio > 90 ? "Critica" : ratio > 65 ? "Atencion" : "Saludable";

  return `
    <article class="plan-category-card ${band}">
      <div class="category-card-top">
        <div>
          <strong>${escapeHtml(job.name)}</strong>
          <span>${capitalize(cadenceLabel(job.cadence))} · ${formatMoney(job.amount)}</span>
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
    <div class="sheet-backdrop destructive-backdrop" role="presentation">
      <section class="bottom-sheet destructive-sheet" role="alertdialog" aria-modal="true" aria-labelledby="remove-category-title">
        <div class="sheet-handle"></div>
        <span class="destructive-icon" aria-hidden="true">!</span>
        <h2 id="remove-category-title">Eliminar ${escapeHtml(job.name)}</h2>
        <p>La reserva desaparecera del plan. Tus movimientos no se borran.</p>
        <div class="destructive-consequence">
          <strong>${affected} ${affected === 1 ? "gasto quedara" : "gastos quedaran"} sin clasificar</strong>
          <span>Podras reclasificarlos despues desde Movimientos.</span>
        </div>
        <button class="btn danger" type="button" data-action="confirm-remove-job">Eliminar categoria</button>
        <button class="btn ghost" type="button" data-action="cancel-remove-job">Conservar categoria</button>
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
        <div><p class="eyebrow">Recomendacion del periodo</p><h1>Ahorro</h1></div>
      </div>

      <article class="savings-hero">
        <div class="trust-tags"><span>Orientativo</span><span>No mueve dinero</span></div>
        <p>Podrias apartar</p>
        <strong>${formatMoney(plan.suggestedPeriodSavings)}</strong>
        <span>durante este periodo ${summary.cadenceLabel}</span>
        <div class="savings-fit ${plan.savingsCapacityGap > 0 ? "warning" : ""}">
          ${
            plan.savingsCapacityGap > 0
              ? `La meta ideal no cabe completa. Faltaria liberar ${formatMoney(plan.savingsCapacityGap)}.`
              : `La recomendacion cabe y deja ${formatMoney(plan.freeAfterSuggestion)} libres.`
          }
        </div>
      </article>

      <div class="savings-metrics">
        <div><span>Meta ideal</span><strong>${formatMoney(plan.idealPeriodSavings)}</strong></div>
        <div><span>Ya reservado</span><strong>${formatMoney(plan.savingsReserved)}</strong></div>
        <div><span>Momento sugerido</span><strong>${suggestedSavingsMoment()}</strong></div>
      </div>

      <details class="calculation-accordion">
        <summary><span><strong>Como se calculo</strong><small>Ver presupuesto, compromisos y reservas</small></span><b>+</b></summary>
        <div class="calculation-body">
          <p>${plan.incomeNote}</p>
          ${renderAllocation("Presupuesto del periodo", plan.periodIncome, "reserved")}
          ${renderAllocation("Gastos comprometidos", plan.committedForPeriod, "expenses")}
          ${renderAllocation("Categorias de gasto", summary.expenseReserved, "expenses")}
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
            <span>Aumento hipotetico <output data-raise-output>${state.settings.monthlyRaisePct}%</output></span>
            <input name="monthlyRaisePct" type="range" min="0" max="100" step="1" value="${state.settings.monthlyRaisePct}">
          </label>
          <label>
            <span>Porcion del aumento al ahorro <output data-escalation-output>${state.settings.escalationPct}%</output></span>
            <input name="escalationPct" type="range" min="0" max="100" step="5" value="${state.settings.escalationPct}">
          </label>
          <button class="btn primary" type="submit">Guardar simulacion</button>
        </form>
      </article>

      <article class="reference-fund">
        <div><p class="eyebrow">Fondo de referencia</p><h2>${targetCovered ? "Meta cubierta" : `${periodsToTarget || "Sin"} periodos estimados`}</h2></div>
        ${renderProgress(plan.emergencyProgress, "Avance simulado con el ahorro actual")}
        <p>${futureFreedom(plan)}. Es una proyeccion orientativa, no una promesa.</p>
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
          <span>Proximos 30 dias</span>
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
            <p class="eyebrow">Revision diaria</p>
            <h2>Recordatorio de gastos</h2>
          </div>
          <span class="metric-badge ${permission === "granted" ? "under" : permission === "denied" ? "danger" : ""}">${notificationStatusLabel(permission)}</span>
        </div>
        <form class="calendar-reminder-form" id="daily-reminder-form">
          <label class="toggle-row">
            <input name="enabled" type="checkbox" ${reminder.enabled ? "checked" : ""}>
            <span>
              <strong>Preguntar cada dia</strong>
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
            <input name="title" type="text" maxlength="48" placeholder="Ej. Regalo para la novia" required>
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
            Categoria
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
      <strong>Aun no hay planes con dinero</strong>
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
    <div class="quick-expense-backdrop" role="presentation">
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
            Comercio
            <input name="merchant" type="text" maxlength="42" placeholder="Ej. Tienda, Terpel" value="${escapeAttr(draft.merchant || "")}" required>
          </label>
          ${renderMerchantRuleSuggestion(draft.merchant || "")}
          <label>
            Descripcion opcional
            <input name="description" type="text" maxlength="90" placeholder="Ej. Tanqueada, regalo, almuerzo" value="${escapeAttr(draft.description || "")}">
          </label>
          <div class="quick-field">
            <span class="quick-label">Categoria</span>
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
          <label class="check-row quick-check-row">
            <input name="budgeted" type="checkbox" checked>
            Ya estaba previsto en el plan
          </label>
          <label class="check-row quick-check-row">
            <input name="oneOff" type="checkbox">
            Gasto unico: no usar para ritmo diario
          </label>
          <button class="btn primary quick-submit" type="submit">Registrar gasto</button>
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

function renderSpending(plan) {
  const summary = budgetSummary();
  const threshold = Math.max(1, summary.income * LARGE_PURCHASE_RATIO);

  return `
    <section class="content-grid spending-grid">
      <article class="card wide-card primary-spend-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Nuevo movimiento</p>
            <h2>Registrar gasto</h2>
          </div>
          <span class="metric-badge">Libre ${formatMoney(summary.freeRemaining)}</span>
        </div>
        <form class="stacked-form" id="transaction-form">
          <label>
            Comercio
            <input name="merchant" type="text" maxlength="42" placeholder="Ej. Tienda" required>
          </label>
          ${renderMerchantRuleSuggestion()}
          <label>
            Descripcion opcional
            <input name="description" type="text" maxlength="90" placeholder="Ej. Tanqueada, regalo, almuerzo">
          </label>
          <div class="transaction-options-row">
            <label>
              Categoria
              <select name="category" required>
                <option value="${FREE_CATEGORY_ID}">Libre / sin clasificar</option>
                ${state.budgetJobs.map((job) => `<option value="${escapeAttr(job.id)}">${escapeHtml(job.name)}</option>`).join("")}
              </select>
            </label>
            <label>
              Pagado con
              <select name="source">
                ${renderLocationOptions("account")}
              </select>
            </label>
          </div>
          <div class="amount-submit-row">
            <label>
              Monto
              <input name="amount" type="number" min="1000" step="1000" required>
            </label>
            <button class="btn primary spend-submit" type="submit">Registrar gasto</button>
          </div>
          <label class="check-row">
            <input name="budgeted" type="checkbox" checked>
            Ya estaba previsto en el plan
          </label>
          <label class="check-row">
            <input name="oneOff" type="checkbox">
            Gasto unico: no usar para ritmo diario
          </label>
        </form>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Gasto por categoria</p>
            <h2>Lo que va usado</h2>
          </div>
          <span class="metric-badge">Compra grande: ${formatMoney(threshold)}</span>
        </div>
        ${renderCategoryBars(plan, state.budgetJobs.length + 1)}
      </article>
    </section>
  `;
}

function renderExtraBudgetCard(summary = budgetSummary()) {
  return `
    <article class="card wide-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Dinero recibido</p>
          <h2>Sumar al presupuesto</h2>
        </div>
        <span class="metric-badge">${formatMoney(summary.extraIncome)} extra</span>
      </div>
      <p class="helper-text">Suma regalos, bonos o ayudas solo al periodo actual. Antes de guardarlo puedes separar una parte para ahorro.</p>
      <form class="inline-form extra-budget-form" id="extra-budget-form">
        <label>
          Origen
          <input name="source" type="text" maxlength="36" placeholder="Ej. Regalo, ayuda, venta" required>
        </label>
        <label>
          Monto
          <input name="amount" type="number" min="1000" step="1000" required>
        </label>
        <label>
          Fecha
          <input name="date" type="date" value="${todayKey()}" required>
        </label>
        <label>
          Entra a
          <select name="location">
            ${renderLocationOptions("account")}
          </select>
        </label>
        <button class="btn secondary" type="submit">Sumar dinero</button>
      </form>
      ${renderBudgetExtras(summary)}
      ${
        summary.extraIncome > 0
          ? `<div class="card-actions">
              <button class="btn danger" type="button" data-action="clear-period-extras">Quitar extra del periodo</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderBudgetExtras(summary = budgetSummary()) {
  const extras = budgetExtrasForSummary(summary)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!extras.length) {
    return `<div class="empty-state">Aun no has sumado dinero extra en este periodo.</div>`;
  }

  return `
    <div class="job-table extra-budget-list">
      ${extras
        .map(
          (extra) => `
            <div class="extra-budget-row">
              <div>
                <strong>${escapeHtml(extra.source)}</strong>
                <span>${formatMoney(extra.amount)} · ${locationLabel(extra.location)} · ${formatDate(extra.date)}</span>
              </div>
              <button class="icon-btn muted" type="button" data-action="remove-extra" data-id="${escapeAttr(extra.id)}" aria-label="Eliminar ${escapeAttr(extra.source)}">x</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderLocationOptions(selected) {
  return [
    ["account", "Cuenta"],
    ["cash", "Efectivo"]
  ]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderMovements() {
  const summary = budgetSummary();
  const movements = movementsForSummary(summary);
  const movementCountLabel = movements.length === 1 ? "movimiento" : "movimientos";
  return `
    <section class="screen-view movements-view" aria-label="Movimientos">
      <div class="screen-title-row movements-heading">
        <div><p class="eyebrow">Historial del periodo</p><h1>Movimientos</h1></div>
        <span class="period-chip">${movements.length} ${movementCountLabel}</span>
      </div>
      ${renderMerchantRulesPanel()}
      <article class="movements-card">
        <label class="history-sort">
          Ordenar por
          <select id="transaction-history-sort">
            <option value="recent" ${transactionHistorySort === "recent" ? "selected" : ""}>Mas recientes</option>
            <option value="amount" ${transactionHistorySort === "amount" ? "selected" : ""}>Mayor cantidad</option>
          </select>
        </label>
        ${renderTransactionHistory(summary, transactionHistorySort)}
      </article>
    </section>
  `;
}

function renderTransactionHistory(summary = budgetSummary(), sort = "recent") {
  const movements = movementsForSummary(summary)
    .slice()
    .sort((a, b) =>
      sort === "amount"
        ? Number(b.amount || 0) - Number(a.amount || 0) || compareTransactionsByRecent(a, b)
        : compareTransactionsByRecent(a, b)
    );

  if (!movements.length) {
    return `<div class="empty-state actionable-empty">
      <span class="empty-icon" aria-hidden="true">+</span>
      <strong>Todavia no hay movimientos</strong>
      <span>Cuando registres un gasto o sumes dinero extra aparecera aqui.</span>
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
      ${Object.entries(groups).map(([date, dayMovements]) => `
        <section class="movement-day">
          <div class="movement-day-heading"><strong>${movementDayLabel(date)}</strong><span>${dayMovements.length} ${dayMovements.length === 1 ? "movimiento" : "movimientos"}</span></div>
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
      `).join("")}
    </div>
  `;
}

function renderTransactionEditor() {
  const transaction = state.transactions.find((item) => item.id === editingTransactionId);
  if (!transaction) {
    return "";
  }
  return `
    <div class="sheet-backdrop" role="presentation">
      <section class="bottom-sheet transaction-editor" role="dialog" aria-modal="true" aria-labelledby="transaction-editor-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><p class="eyebrow">Corregir movimiento</p><h2 id="transaction-editor-title">${escapeHtml(transaction.merchant)}</h2></div>
          <button class="icon-btn muted" type="button" data-action="close-transaction-editor" aria-label="Cerrar">x</button>
        </div>
        <div class="editor-amount">${formatMoney(transaction.amount)}<span>${formatDate(transaction.date)}</span></div>
        <form class="sheet-form" id="transaction-edit-form">
          <div class="sheet-field">
            <span class="sheet-label">Categoria</span>
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
            Gasto unico: no usar para ritmo diario
          </label>
          <button class="btn primary" type="submit">Guardar cambios</button>
          <button class="btn danger subtle-danger" type="button" data-action="remove-transaction" data-id="${escapeAttr(transaction.id)}">Eliminar gasto y devolver saldo</button>
        </form>
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
    <div class="sheet-backdrop" role="presentation">
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
  const script = dominantMoneyScript();
  const monthlyIncome = getMonthlyIncome(state.profile);
  const liquidity = liquiditySummary();

  return `
    <section class="screen-view data-view" aria-label="Datos">
      <div class="screen-title-row">
        <div><p class="eyebrow">Configuracion y contexto</p><h1>Datos</h1></div>
      </div>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">P</span><div><strong>Plan basico</strong><small>Ingreso y frecuencia del periodo</small></div><button type="button" data-action="open-diagnosis">Editar</button></div>
        <div class="data-metrics"><div><span>Presupuesto</span><strong>${formatMoney(getPeriodIncome(state.profile))}</strong></div><div><span>Frecuencia</span><strong>${capitalize(cadenceLabel(state.profile.incomeCadence))}</strong></div></div>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">S</span><div><strong>Saldos</strong><small>Dinero disponible hoy</small></div><button type="button" data-action="open-diagnosis">Editar</button></div>
        <div class="data-metrics three"><div><span>Cuenta</span><strong>${formatMoney(liquidity.account)}</strong></div><div><span>Efectivo</span><strong>${formatMoney(liquidity.cash)}</strong></div><div><span>Total real</span><strong>${formatMoney(liquidity.total)}</strong></div></div>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">R</span><div><strong>Recomendacion</strong><small>Orientacion mensual simple</small></div><button type="button" data-view="savings">Ver ahorro</button></div>
        <div class="data-metrics three"><div><span>Ingreso mensual</span><strong>${formatMoney(monthlyIncome)}</strong></div><div><span>Ahorro proyectado</span><strong>${formatMoney(plan.savings)}</strong></div><div><span>Para gastos</span><strong>${formatMoney(plan.expenses)}</strong></div></div>
        <p class="data-note">Es una simulacion: no modifica tu presupuesto ni tus saldos.</p>
      </article>

      <article class="data-section">
        <div class="data-section-heading"><span class="data-icon">C</span><div><strong>Perfil conductual</strong><small>Opcional, ayuda a orientar el tono</small></div><button type="button" data-action="open-diagnosis">Editar</button></div>
        <div class="data-metrics three"><div><span>Patron dominante</span><strong>${script.name}</strong></div><div><span>Confianza</span><strong>${state.profile.selfEfficacy}/10</strong></div><div><span>Ansiedad</span><strong>${state.profile.financialAnxiety}/10</strong></div></div>
      </article>

      <article class="sign-out-section">
        <div><strong>${escapeHtml(cloudState.email)}</strong><span>La copia local se retirara de este dispositivo.</span></div>
        <button class="btn danger" type="button" data-action="cloud-sign-out">Cerrar sesion</button>
      </article>
    </section>
  `;
}

function renderStudentContextPanel() {
  const semesterIncome = Number(state.profile.semesterIncome || STUDENT_SEMESTER_INCOME);
  const semesterMonths = Number(state.profile.semesterMonths || STUDENT_SEMESTER_MONTHS);
  const weeklyGas = Number(state.profile.weeklyGas || STUDENT_WEEKLY_GAS);
  return `
    <article class="card wide-card context-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Plantilla opcional</p>
          <h2>Estudiante becado con moto</h2>
        </div>
        <span class="metric-badge">${formatMoney(monthlyFromSemester(semesterIncome, semesterMonths))} / mes</span>
      </div>
      <div class="context-grid">
        <div>
          <strong>${formatMoney(semesterIncome)}</strong>
          <span>beca semestral</span>
        </div>
        <div>
          <strong>${semesterMonths} meses</strong>
          <span>para cubrir</span>
        </div>
        <div>
          <strong>${formatMoney(weeklyGas)}</strong>
          <span>gasolina semanal</span>
        </div>
        <div>
          <strong>${formatMoney(state.profile.relationshipMonthlyBudget || 45_000)}</strong>
          <span>salidas con novia</span>
        </div>
      </div>
      <p>Este preset es solo un punto de partida. Puedes cambiar el presupuesto, su frecuencia y crear campos propios.</p>
      <div class="card-actions">
        <button class="btn secondary" type="button" data-action="apply-student-context">Aplicar mi contexto</button>
      </div>
    </article>
  `;
}

function renderAccountPanel() {
  return `
    <article class="card wide-card account-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Cuenta</p>
          <h2>${escapeHtml(cloudState.email)}</h2>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn danger" type="button" data-action="cloud-sign-out">Cerrar sesion</button>
      </div>
    </article>
  `;
}

function renderScriptBar(key, value) {
  const labels = {
    worship: "Buscar mas dinero",
    avoidance: "Evitar mirar dinero",
    status: "Dinero como estatus",
    vigilance: "Control y seguridad"
  };
  const ratio = (Number(value) / 5) * 100;
  return `
    <div class="script-row">
      <div>
        <strong>${labels[key]}</strong>
        <span>${Number(value).toFixed(1)} / 5</span>
      </div>
      <div class="bar">
        <span style="width:${clamp(ratio, 0, 100)}%"></span>
      </div>
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
  const suggestions = [
    ["Comida", 0.18, true],
    ["Gasolina", 0.1, true],
    ["Transporte", 0.08, false],
    ["Salidas", 0.08, true],
    ["Arriendo", 0.25, false],
    ["Salud", 0.06, false],
    ["Ropa", 0.05, false]
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
            <h2 id="onboarding-title">¿Cuando recibes dinero?</h2>
            <p>Asi calculamos cuanto tienes disponible en cada periodo.</p>
            <div class="sheet-field">
              <span class="sheet-label">¿Cada cuanto recibes?</span>
              <div class="onboarding-segmented" data-onboarding-cadence-group>
                <button type="button" data-onboarding-cadence="weekly" class="${profile.incomeCadence === "weekly" ? "is-active" : ""}">Semanal</button>
                <button type="button" data-onboarding-cadence="monthly" class="${profile.incomeCadence === "monthly" ? "is-active" : ""}">Mensual</button>
                <button type="button" data-onboarding-cadence="semester" class="${!["weekly", "monthly"].includes(profile.incomeCadence) ? "is-active" : ""}">Otro</button>
              </div>
              <input name="incomeCadence" type="hidden" value="${escapeAttr(profile.incomeCadence)}">
            </div>
            <label>
              ¿Cuanto recibes por periodo?
              <input name="incomeAmount" type="number" min="1" step="1000" inputmode="numeric" value="${getPeriodIncome(profile)}" required>
            </label>
            <div class="onboarding-preview"><span>Libre estimado</span><strong data-onboarding-income-preview>${formatMoney(income)}</strong></div>
            <small class="onboarding-note">Despues separaras reservas para gastos habituales y este numero bajara.</small>
            <input name="periodStart" type="hidden" value="${escapeAttr(profile.periodStart || monthStartKey())}">
          </section>

          <section class="onboarding-step" data-step="2">
            <span class="step-badge">Paso 2 de 3</span>
            <h2>¿Donde tienes ese dinero?</h2>
            <p>La app distingue entre cuenta y efectivo para que los saldos reflejen la realidad.</p>
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
            <small class="balance-hint" data-onboarding-balance></small>
          </section>

          <section class="onboarding-step" data-step="3">
            <span class="step-badge">Paso 3 de 3</span>
            <h2>¿Para que separas dinero?</h2>
            <p>Elige categorias habituales. Puedes ajustar sus montos despues.</p>
            <div class="onboarding-category-chips">
              ${suggestions.map(([name, rate, selected], index) => `
                <button type="button" class="onboarding-category-chip ${selected ? "is-active" : ""}" data-onboarding-category-chip data-category-index="${index}" data-rate="${rate}">${name}</button>
                <input name="categoryName${index}" type="hidden" value="${name}" ${selected ? "" : "disabled"}>
                <input name="categoryAmount${index}" type="hidden" value="${Math.round(income * rate)}" ${selected ? "" : "disabled"}>
                <input name="categoryCadence${index}" type="hidden" value="period" ${selected ? "" : "disabled"}>
              `).join("")}
            </div>
            <div class="onboarding-preview category-preview">
              <span>Libre estimado despues de reservas</span>
              <strong data-onboarding-free-preview>${formatMoney(income * 0.64)}</strong>
              <small data-onboarding-category-count>de ${formatMoney(income)} · 3 categorias seleccionadas</small>
            </div>
          </section>

          <p class="form-error onboarding-error" role="alert" aria-live="assertive"></p>
          <div class="onboarding-actions">
            <button class="btn ghost onboarding-back" type="button" data-onboarding-back hidden>← Atras</button>
            <button class="btn primary onboarding-next" type="button" data-onboarding-next>Siguiente →</button>
            <button class="btn primary onboarding-finish" type="submit" hidden>Ver mi dinero libre</button>
            <button class="btn ghost onboarding-skip" type="button" data-onboarding-skip hidden>Saltarme esto por ahora</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderOnboardingCategoryRow(index, options = {}) {
  const { example = false, removable = false } = options;
  const namePlaceholder = example ? "Ej. Gasolina" : "Ej. Comida";
  const amountPlaceholder = example ? "Ej. $30.000" : "Ej. $50.000";

  return `
    <div class="onboarding-category-row ${removable ? "is-removable" : ""}" data-onboarding-category-row data-category-index="${index}">
      <input name="categoryName${index}" type="text" maxlength="32" placeholder="${namePlaceholder}" aria-label="Nombre del campo ${index + 1}">
      <input name="categoryAmount${index}" type="number" min="0" step="1000" inputmode="numeric" placeholder="${amountPlaceholder}" aria-label="Monto del campo ${index + 1}">
      <select name="categoryCadence${index}" aria-label="Frecuencia del campo ${index + 1}">
        <option value="weekly">Semanal</option>
        <option value="biweekly">Quincenal</option>
        <option value="monthly">Mensual</option>
        <option value="period">Una vez</option>
      </select>
      ${removable ? `<button class="icon-btn muted onboarding-category-remove" type="button" data-remove-onboarding-category aria-label="Quitar este campo" title="Quitar este campo">x</button>` : ""}
    </div>
  `;
}

function renderDiagnosisModal() {
  if (!state.profile.completed) {
    return renderOnboardingModal();
  }

  const profile = state.profile;
  const liquidity = normalizeLiquidity(state.liquidity);
  const available = liquidity.initialized ? liquidity : { account: 0, cash: 0 };

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="diagnosis-title">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">Personalizar plan</p>
            <h2 id="diagnosis-title">Mis datos</h2>
          </div>
          <button class="icon-btn" type="button" data-action="close-diagnosis" aria-label="Cerrar">x</button>
        </div>
        ${diagnosisValidation.message ? `<p class="form-error diagnosis-error" role="alert" aria-live="assertive">${escapeHtml(diagnosisValidation.message)}</p>` : ""}
        <form id="diagnosis-form" class="diagnosis-form" novalidate>
          <fieldset>
            <legend>Datos principales</legend>
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
              Inicio del periodo actual
              <input name="periodStart" type="date" value="${escapeAttr(profile.periodStart || profile.semesterStart || monthStartKey())}" required ${diagnosisInvalidAttr("periodStart")}>
              ${renderDiagnosisFieldError("periodStart")}
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
              Ahorro actual para simular
              <input name="emergencySavings" type="number" min="0" step="1000" value="${profile.emergencySavings}" required ${diagnosisInvalidAttr("emergencySavings")}>
              ${renderDiagnosisFieldError("emergencySavings")}
            </label>
            <label>
              Dia de pago principal
              <input name="payday" type="number" min="0" max="28" inputmode="numeric" value="${profile.payday}" ${diagnosisInvalidAttr("payday")}>
              <small>Usa 0 si no tienes un dia fijo.</small>
              ${renderDiagnosisFieldError("payday")}
            </label>
            <label>
              Dinero en cuenta
              <input name="account" type="number" min="0" step="1000" value="${available.account}" required ${diagnosisInvalidAttr("account")}>
              ${renderDiagnosisFieldError("account")}
            </label>
            <label>
              Dinero en fisico
              <input name="cash" type="number" min="0" step="1000" value="${available.cash}" required ${diagnosisInvalidAttr("cash")}>
              ${renderDiagnosisFieldError("cash")}
            </label>
            <small class="balance-hint" data-liquidity-match-hint></small>
          </fieldset>

          <div class="modal-actions quick-save-actions">
            <button class="btn primary" type="submit">Guardar plan</button>
          </div>

          <fieldset>
            <legend>Tipo de ingreso</legend>
            <label>
              Frecuencia
              <select name="incomeType" ${diagnosisInvalidAttr("incomeType")}>
                <option value="fixed" ${profile.incomeType === "fixed" ? "selected" : ""}>Fijo</option>
                <option value="variable" ${profile.incomeType === "variable" ? "selected" : ""}>Variable / freelance</option>
              </select>
              ${renderDiagnosisFieldError("incomeType")}
            </label>
            <label>
              Volatilidad
              <select name="volatility" ${diagnosisInvalidAttr("volatility")}>
                <option value="low" ${profile.volatility === "low" ? "selected" : ""}>Baja</option>
                <option value="medium" ${profile.volatility === "medium" ? "selected" : ""}>Media</option>
                <option value="high" ${profile.volatility === "high" ? "selected" : ""}>Alta</option>
              </select>
              ${renderDiagnosisFieldError("volatility")}
            </label>
            <label>
              Confianza financiera: ${profile.selfEfficacy}/10
              <input name="selfEfficacy" type="range" min="1" max="10" value="${profile.selfEfficacy}">
            </label>
            <label>
              Ansiedad financiera: ${profile.financialAnxiety}/10
              <input name="financialAnxiety" type="range" min="1" max="10" value="${profile.financialAnxiety}">
            </label>
          </fieldset>

          <fieldset>
            <legend>Patrones de dinero</legend>
            ${renderScriptQuestion("worship", "Siento que las cosas mejorarian mucho si tuviera mas dinero.")}
            ${renderScriptQuestion("avoidance", "A veces siento que no merezco dinero cuando otras personas tienen menos.")}
            ${renderScriptQuestion("status", "Mi valor personal se refleja en mis logros financieros.")}
            ${renderScriptQuestion("vigilance", "Me cuesta disfrutar el dinero porque prefiero guardarlo por seguridad.")}
          </fieldset>

          <div class="modal-actions">
            <button class="btn ghost" type="button" data-action="close-diagnosis">Cancelar</button>
            <button class="btn primary" type="submit">Guardar y usar mi plan</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderScriptQuestion(key, label) {
  const value = state.profile.moneyScripts[key];
  return `
    <label>
      ${label}
      <select name="${key}" ${diagnosisInvalidAttr(key)}>
        ${[1, 2, 3, 4, 5]
          .map((score) => `<option value="${score}" ${score === Number(value) ? "selected" : ""}>${score}</option>`)
          .join("")}
      </select>
      ${renderDiagnosisFieldError(key)}
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
              <div class="bar ${category.band}">
                <span style="width:${clamp(category.ratio, 0, 120)}%"></span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderExtraAllocationModal() {
  const draft = pendingExtraAllocation;
  const percent = clamp(Number(draft.savingsPercent ?? 20), 0, 100);
  const savingsAmount = Math.round(Number(draft.amount || 0) * percent / 100);
  const freeAmount = Number(draft.amount || 0) - savingsAmount;
  const target = savingsAllocationTarget();

  return `
    <div class="sheet-backdrop" role="presentation">
      <section class="bottom-sheet extra-suggestion-sheet" role="dialog" aria-modal="true" aria-labelledby="extra-allocation-title">
        <div class="sheet-handle"></div>
        <div class="sheet-heading">
          <div><span class="extra-badge">Dinero extra</span><h2 id="extra-allocation-title">Antes de sumarlo</h2></div>
          <button class="icon-btn muted" type="button" data-action="cancel-extra-allocation" aria-label="Cerrar">x</button>
        </div>
        <div class="extra-origin-summary">
          <strong>${formatMoney(draft.amount)}</strong>
          <span>${escapeHtml(draft.source)} · ${locationLabel(draft.location)}</span>
        </div>
        <form class="sheet-form" id="extra-allocation-form">
          <div class="extra-suggestion-card">
            <span>Una sugerencia antes de decidir</span>
            <strong data-allocation-savings>${formatMoney(savingsAmount)}</strong>
            <p>para ${escapeHtml(target.label)} (${percent}%). Los <b data-allocation-free>${formatMoney(freeAmount)}</b> restantes quedarian libres.</p>
          </div>
          <label>
            Porcentaje para ${escapeHtml(target.label)}
            <input name="savingsPercent" type="range" min="0" max="100" step="5" value="${percent}" data-extra-allocation-range>
          </label>
          <button class="btn primary" type="submit">Separar ${formatCompactMoney(savingsAmount)} y sumar</button>
          <button class="btn ghost" type="button" data-action="extra-all-free">Dejar todo libre</button>
        </form>
      </section>
    </div>
  `;
}

function renderSnackbar() {
  if (!snackbar) {
    return "";
  }

  return `
    <div class="snackbar ${snackbar.kind || ""}" role="${snackbar.kind === "error" ? "alert" : "status"}" aria-live="${snackbar.kind === "error" ? "assertive" : "polite"}">
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

  document.querySelectorAll("[data-transaction-category]").forEach((select) => {
    select.addEventListener("change", () => {
      const transaction = state.transactions.find((item) => item.id === select.dataset.transactionCategory);
      if (!transaction) {
        return;
      }
      transaction.category = select.value;
      transaction.labeled = Boolean(select.value);
      transaction.updated_at = new Date().toISOString();
      rememberMerchantRule(transaction);
      state.lastAlert = transaction.labeled
        ? `${transaction.merchant} ahora tiene trabajo asignado.`
        : "Ese movimiento sigue pendiente de categoria.";
      saveState();
      render();
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

  const extraBudgetForm = document.querySelector("#extra-budget-form");
  if (extraBudgetForm) {
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

  const extraAllocationForm = document.querySelector("#extra-allocation-form");
  if (extraAllocationForm) {
    bindExtraAllocationPreview(extraAllocationForm);
    extraAllocationForm.addEventListener("submit", handleExtraAllocationSubmit);
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

  const historySort = document.querySelector("#transaction-history-sort");
  if (historySort) {
    historySort.addEventListener("change", () => {
      transactionHistorySort = historySort.value === "amount" ? "amount" : "recent";
      render();
    });
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
  if (pendingExtraAllocation) {
    pendingExtraAllocation = null;
    state.lastAlert = "Dinero extra sin guardar.";
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
  return false;
}

function firstFocusable(root) {
  return focusableElements(root)[0] || null;
}

function focusableElements(root) {
  return [...root.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && element.offsetParent !== null);
}

function bindOnboardingFlow(form) {
  const modal = form.closest("[data-onboarding-step]");
  const error = form.querySelector(".onboarding-error");
  const nextButton = form.querySelector("[data-onboarding-next]");
  const backButton = form.querySelector("[data-onboarding-back]");
  const finishButton = form.querySelector(".onboarding-finish");
  const skipButton = form.querySelector("[data-onboarding-skip]");
  const balanceHint = form.querySelector("[data-onboarding-balance]");
  const categoryList = form.querySelector(".onboarding-categories");
  const addCategoryButton = form.querySelector("[data-add-onboarding-category]");
  const progress = modal.querySelector(".onboarding-progress");

  const updateBalanceHint = () => {
    const data = new FormData(form);
    const budget = numberFrom(data.get("incomeAmount"));
    const total = numberFrom(data.get("account")) + numberFrom(data.get("cash"));
    const matches = budget > 0 && total === budget;
    balanceHint.textContent = matches
      ? `Cuenta + efectivo coincide con ${formatMoney(budget)}.`
      : `Cuenta + efectivo suma ${formatMoney(total)} de ${formatMoney(budget)}.`;
    balanceHint.classList.toggle("is-ok", matches);
    balanceHint.classList.toggle("is-error", !matches);
  };

  const showStep = (step) => {
    modal.dataset.onboardingStep = String(step);
    form.querySelectorAll("[data-step]").forEach((section) => section.classList.toggle("is-active", Number(section.dataset.step) === step));
    modal.querySelectorAll(".onboarding-progress span").forEach((dot, index) => dot.classList.toggle("is-active", index < step));
    progress?.setAttribute("aria-label", `Paso ${step} de 3`);
    backButton.hidden = step === 1 || step === 3;
    nextButton.hidden = step === 3;
    finishButton.hidden = step !== 3;
    skipButton.hidden = step !== 3;
    error.textContent = "";
    if (step === 2) {
      updateBalanceHint();
    }
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

  backButton.addEventListener("click", () => {
    const step = Number(modal.dataset.onboardingStep || 1);
    showStep(Math.max(1, step - 1));
  });

  ["incomeAmount", "account", "cash"].forEach((name) => {
    form.elements.namedItem(name)?.addEventListener("input", updateBalanceHint);
  });

  const updateCategoryControls = () => {
    const rowCount = categoryList?.querySelectorAll("[data-onboarding-category-row]").length || 0;
    if (addCategoryButton) {
      addCategoryButton.disabled = rowCount >= 10;
      addCategoryButton.title = rowCount >= 10 ? "Máximo 10 campos" : "Añadir otro campo";
    }
  };

  addCategoryButton?.addEventListener("click", () => {
    if (!categoryList) {
      return;
    }
    const indexes = [...categoryList.querySelectorAll("[data-category-index]")].map((row) => Number(row.dataset.categoryIndex) || 0);
    const nextIndex = Math.max(...indexes, -1) + 1;
    if (indexes.length >= 10) {
      return;
    }
    categoryList.insertAdjacentHTML("beforeend", renderOnboardingCategoryRow(nextIndex, { removable: true }));
    const row = categoryList.querySelector(`[data-category-index="${nextIndex}"]`);
    bindMoneyInputs(row);
    row?.querySelector(`input[name="categoryName${nextIndex}"]`)?.focus();
    updateCategoryControls();
  });

  categoryList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-onboarding-category]");
    if (!removeButton) {
      return;
    }
    removeButton.closest("[data-onboarding-category-row]")?.remove();
    updateCategoryControls();
  });

  updateCategoryControls();
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

  const updateBalance = () => {
    const data = new FormData(form);
    const budget = numberFrom(data.get("incomeAmount"));
    const total = numberFrom(data.get("account")) + numberFrom(data.get("cash"));
    const matches = budget > 0 && total === budget;
    balanceHint.textContent = matches
      ? `Coincide con tu presupuesto de ${formatMoney(budget)}.`
      : `Cuenta + efectivo suma ${formatMoney(total)} de ${formatMoney(budget)}.`;
    balanceHint.classList.toggle("is-ok", matches);
    balanceHint.classList.toggle("is-error", !matches);
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
    if (categoryCount) categoryCount.textContent = `de ${formatMoney(income)} · ${selected} categorias seleccionadas`;
  };

  const showStep = (step) => {
    modal.dataset.onboardingStep = String(step);
    form.querySelectorAll("[data-step]").forEach((section) => section.classList.toggle("is-active", Number(section.dataset.step) === step));
    modal.querySelectorAll(".onboarding-progress span").forEach((dot, index) => dot.classList.toggle("is-active", index === step - 1));
    progress?.setAttribute("aria-label", `Paso ${step} de 3`);
    backButton.hidden = step === 1 || step === 3;
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
  form.querySelectorAll("[data-onboarding-cadence]").forEach((button) => {
    button.addEventListener("click", () => {
      form.elements.namedItem("incomeCadence").value = button.dataset.onboardingCadence;
      form.querySelectorAll("[data-onboarding-cadence]").forEach((item) => item.classList.toggle("is-active", item === button));
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
  if (step === 1 && numberFrom(data.get("incomeAmount")) <= 0) {
    return "Escribe un presupuesto mayor que cero.";
  }
  if (step === 2) {
    const budget = numberFrom(data.get("incomeAmount"));
    const total = numberFrom(data.get("account")) + numberFrom(data.get("cash"));
    if (total !== budget) {
      return `Cuenta + efectivo debe sumar ${formatMoney(budget)}.`;
    }
  }
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
  const incomeCadence = ["weekly", "biweekly", "monthly", "semester", "yearly"].includes(data.get("incomeCadence"))
    ? data.get("incomeCadence")
    : "monthly";
  const incomeAmount = numberFrom(data.get("incomeAmount"));
  const periodStart = cleanDate(data.get("periodStart"), monthStartKey());
  const now = new Date().toISOString();
  const profileDraft = {
    ...state.profile,
    completed: true,
    name: "Mi plan",
    incomeCadence,
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
    error.textContent = `Los campos separan ${formatMoney(reserved)}, mas que tu presupuesto de ${formatMoney(incomeAmount)}.`;
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
    const incomeCadence = ["weekly", "biweekly", "monthly", "semester", "yearly"].includes(data.get("incomeCadence"))
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
      ? `Cuenta + fisico coincide con ${formatMoney(incomeAmount)}.`
      : `Cuenta + fisico suma ${formatMoney(total)}; debe sumar ${formatMoney(incomeAmount)}.`;
    hint.classList.toggle("is-ok", matches);
    hint.classList.toggle("is-error", !matches);
  };
  const updatePreview = () => {
    updateMonthlyEquivalent();
    updateLiquidityMatch();
  };

  ["incomeCadence", "incomeAmount", "account", "cash"].forEach((name) => {
    const field = form.elements.namedItem(name);
    if (field) {
      field.addEventListener("input", updatePreview);
      field.addEventListener("change", updatePreview);
    }
  });
  updatePreview();
}

function bindExtraAllocationPreview(form) {
  const range = form.querySelector("[data-extra-allocation-range]");
  const savingsNode = form.querySelector("[data-allocation-savings]");
  const freeNode = form.querySelector("[data-allocation-free]");
  if (!range || !savingsNode || !freeNode || !pendingExtraAllocation) {
    return;
  }

  const update = () => {
    const percent = clamp(Number(range.value), 0, 100);
    const amount = Number(pendingExtraAllocation.amount || 0);
    const savingsAmount = Math.round(amount * percent / 100);
    savingsNode.textContent = formatMoney(savingsAmount);
    freeNode.textContent = formatMoney(amount - savingsAmount);
  };

  range.addEventListener("input", update);
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
  const conversion = form.querySelector("[data-category-conversion]");
  const warning = form.querySelector("[data-category-limit-warning]");
  const submit = form.querySelector("[data-category-submit]");
  const update = () => {
    const data = new FormData(form);
    const amount = numberFrom(data.get("amount"));
    const cadence = data.get("cadence") || "monthly";
    const draft = { amount, cadence };
    const converted = getBudgetAmountForJob(draft, state.profile);
    const available = budgetSummary().freeBudget;
    const exceeds = amount > 0 && converted > available;
    if (conversion) {
      conversion.innerHTML = amount > 0
        ? `<span>Conversion automatica</span><strong>${formatMoney(amount)} ${cadenceLabel(cadence)} = ${formatMoney(converted)} en este periodo</strong><small>Disponible para reservar: ${formatMoney(available)}</small>`
        : `<span>Conversion automatica</span><strong>Escribe un monto para ver su valor en este periodo.</strong><small>Disponible para reservar: ${formatMoney(available)}</small>`;
    }
    if (warning) warning.hidden = !exceeds;
    if (submit) submit.disabled = exceeds;
  };
  form.querySelectorAll("input, [data-choice-value]").forEach((control) => control.addEventListener("input", update));
  form.querySelectorAll("[data-choice-value]").forEach((control) => control.addEventListener("click", () => window.setTimeout(update)));
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
  event.preventDefault();
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;
  const interfaceOnlyActions = new Set([
    "go-spending",
    "toggle-menu",
    "close-menu",
    "open-expense",
    "close-expense",
    "show-auth-form",
    "back-auth-options",
    "open-category-sheet",
    "open-extra-sheet",
    "close-plan-sheet",
    "request-remove-job",
    "cancel-remove-job",
    "edit-transaction",
    "close-transaction-editor",
    "edit-extra",
    "close-extra-editor",
    "open-diagnosis",
    "close-diagnosis",
    "cancel-extra-allocation",
    "request-reminder-permission",
    "send-test-reminder",
    "register-calendar-event",
    "set-theme"
  ]);

  const actions = {
    "go-spending": openQuickExpense,
    "toggle-menu": () => {
      menuOpen = !menuOpen;
      quickExpenseOpen = false;
    },
    "close-menu": () => {
      menuOpen = false;
    },
    "open-expense": openQuickExpense,
    "close-expense": closeQuickExpense,
    "show-auth-form": () => {
      authMode = ["signin", "signup"].includes(event.currentTarget.dataset.authMode) ? event.currentTarget.dataset.authMode : "";
    },
    "back-auth-options": () => {
      authMode = "";
      cloudState.error = "";
    },
    "open-category-sheet": () => {
      planSheet = "category";
      menuOpen = false;
    },
    "open-extra-sheet": () => {
      planSheet = "extra";
      menuOpen = false;
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
    "edit-transaction": () => {
      editingTransactionId = id;
      editingExtraId = "";
    },
    "close-transaction-editor": () => {
      editingTransactionId = "";
    },
    "edit-extra": () => {
      editingExtraId = id;
      editingTransactionId = "";
    },
    "close-extra-editor": () => {
      editingExtraId = "";
    },
    "open-diagnosis": () => {
      diagnosisValidation = { field: "", message: "" };
      state.showDiagnosis = true;
      menuOpen = false;
    },
    "close-diagnosis": () => {
      diagnosisValidation = { field: "", message: "" };
      state.showDiagnosis = false;
    },
    "complete-checkin": completeCheckin,
    "simulate-alert": simulateSpendingAlert,
    "add-process-win": addProcessWin,
    "apply-student-context": applyStudentContext,
    "remove-job": () => removeBudgetJob(id),
    "remove-transaction": () => {
      removeTransaction(id);
      editingTransactionId = "";
    },
    "undo-snackbar": () => {
      removeTransaction(id);
      clearSnackbar({ renderNow: false });
    },
    "remove-extra": () => removeBudgetExtra(id),
    "remove-extra-from-editor": () => {
      removeBudgetExtra(id);
      editingExtraId = "";
    },
    "clear-period-extras": clearCurrentPeriodExtras,
    "save-period-close": savePeriodClosure,
    "remove-merchant-rule": () => removeMerchantRule(id),
    "extra-all-free": () => applyPendingExtraAllocation(0),
    "cancel-extra-allocation": () => {
      pendingExtraAllocation = null;
      state.lastAlert = "Dinero extra sin guardar.";
    },
    "request-reminder-permission": requestReminderPermission,
    "send-test-reminder": sendTestReminder,
    "register-calendar-event": () => startCalendarEventExpense(id),
    "set-theme": () => {
      state.settings = {
        ...(state.settings || {}),
        theme: normalizeTheme(event.currentTarget.dataset.themeChoice),
        updated_at: new Date().toISOString()
      };
      saveState({ sync: false, touch: false });
      applyThemePreference();
    },
    "remove-calendar-event": () => removeCalendarEvent(id),
    "reopen-calendar-event": () => reopenCalendarEvent(id),
    "cancel-cooldown": () => cancelCooldown(id),
    "unlock-cooldown": () => unlockCooldown(id),
    "push-cloud-now": () => pushCloudState(),
    "pull-cloud-now": () => pullCloudAfterLogin(),
    "cloud-sign-out": () => handleCloudSignOut()
  };

  if (actions[action]) {
    actions[action]();
    const asyncCloudAction = ["push-cloud-now", "pull-cloud-now", "cloud-sign-out"].includes(action);
    if (!asyncCloudAction && !interfaceOnlyActions.has(action)) {
      saveState();
    }
    if (!asyncCloudAction) {
      render();
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
    cloudState.error = "La sincronizacion esta tardando. Puedes usar tus datos locales mientras vuelve la conexion.";
  } else {
    cloudState.status = "signed-out";
    cloudState.error = "No pude comprobar una sesion guardada. Inicia sesion de nuevo.";
  }
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
  const wasIncomplete = !state.profile.completed;
  const shouldClearTemplateBudget = shouldClearTemplateBudgetOnPlanSave();
  const incomeCadence = ["weekly", "biweekly", "monthly", "semester", "yearly"].includes(data.get("incomeCadence"))
    ? data.get("incomeCadence")
    : "monthly";
  const incomeAmount = numberFrom(data.get("incomeAmount"));
  const accountAmount = numberFrom(data.get("account"));
  const cashAmount = numberFrom(data.get("cash"));
  const periodStart = cleanDate(data.get("periodStart"), monthStartKey());
  const semesterIncome = incomeCadence === "semester" ? incomeAmount : state.profile.semesterIncome || STUDENT_SEMESTER_INCOME;
  const semesterMonths = incomeCadence === "semester" ? STUDENT_SEMESTER_MONTHS : state.profile.semesterMonths || STUDENT_SEMESTER_MONTHS;
  const weeklyGas = data.has("weeklyGas") ? numberFrom(data.get("weeklyGas")) : Number(state.profile.weeklyGas || 0);
  const monthlyIncome = getMonthlyIncome({ ...state.profile, incomeCadence, incomeAmount, semesterIncome, semesterMonths });

  saveLocalBackup("antes de guardar plan");

  state.profile = {
    ...state.profile,
    completed: true,
    name: cleanText(data.get("name"), "Mi plan"),
    incomeCadence,
    incomeAmount,
    semesterIncome,
    semesterMonths,
    periodStart,
    semesterStart: periodStart,
    monthlyIncome,
    committedExpenses: numberFrom(data.get("committedExpenses")),
    weeklyGas,
    relationshipMonthlyBudget: data.has("relationshipMonthlyBudget") ? numberFrom(data.get("relationshipMonthlyBudget")) : Number(state.profile.relationshipMonthlyBudget || 0),
    giftMonthlyBudget: data.has("giftMonthlyBudget") ? numberFrom(data.get("giftMonthlyBudget")) : Number(state.profile.giftMonthlyBudget || 0),
    emergencySavings: numberFrom(data.get("emergencySavings")),
    payday: normalizePayday(data.get("payday")),
    incomeType: data.get("incomeType") === "variable" ? "variable" : "fixed",
    volatility: ["low", "medium", "high"].includes(data.get("volatility")) ? data.get("volatility") : "medium",
    selfEfficacy: clamp(numberFrom(data.get("selfEfficacy")), 1, 10),
    financialAnxiety: clamp(numberFrom(data.get("financialAnxiety")), 1, 10),
    moneyScripts: {
      worship: clamp(numberFrom(data.get("worship")), 1, 5),
      avoidance: clamp(numberFrom(data.get("avoidance")), 1, 5),
      status: clamp(numberFrom(data.get("status")), 1, 5),
      vigilance: clamp(numberFrom(data.get("vigilance")), 1, 5)
    },
    updated_at: new Date().toISOString()
  };
  state.liquidity = {
    account: accountAmount,
    cash: cashAmount,
    initialized: true,
    updated_at: new Date().toISOString()
  };

  if (wasIncomplete) {
    state.wins.push({
      id: uid("win"),
      date: todayKey(),
      text: "Guardaste tus datos reales y convertiste numeros sueltos en un plan."
    });
  }

  if (shouldClearTemplateBudget) {
    clearTemplateBudget();
  }

  state.showDiagnosis = false;
  activateView(DEFAULT_VIEW);
  state.lastAlert = shouldClearTemplateBudget
    ? "Datos guardados. Quite los campos de plantilla; ahora crea tus propios campos de gasto."
    : "Datos guardados. Ahora registra tus gastos desde la pantalla principal.";
  saveState();
  render();
}

function validateDiagnosisForm(form) {
  const data = new FormData(form);
  const allowedCadences = ["weekly", "biweekly", "monthly", "semester", "yearly"];
  const requiredNumbers = [
    ["incomeAmount", "El presupuesto por periodo debe ser mayor que cero.", 1],
    ["committedExpenses", "Los gastos comprometidos no pueden estar vacios.", 0],
    ["emergencySavings", "El ahorro actual para la simulacion no puede estar vacio.", 0],
    ["account", "El dinero en cuenta no puede estar vacio.", 0],
    ["cash", "El dinero en fisico no puede estar vacio.", 0]
  ];

  if (!cleanText(data.get("name"), "")) {
    return { field: "name", message: "Escribe un nombre para tu plan." };
  }

  if (!allowedCadences.includes(data.get("incomeCadence"))) {
    return { field: "incomeCadence", message: "Elige cada cuanto recibes presupuesto." };
  }

  for (const [field, message, min] of requiredNumbers) {
    const value = numberValue(data.get(field));
    if (value == null || value < min) {
      return { field, message };
    }
  }

  const incomeAmount = numberValue(data.get("incomeAmount"));
  const accountAmount = numberValue(data.get("account"));
  const cashAmount = numberValue(data.get("cash"));
  const liquidityTotal = Number(accountAmount || 0) + Number(cashAmount || 0);
  if (shouldRequireOpeningBalanceMatch() && Math.abs(liquidityTotal - Number(incomeAmount || 0)) > 0) {
    return {
      field: "account",
      fields: ["account", "cash"],
      message: `Cuenta + fisico debe sumar el presupuesto del periodo: ${formatMoney(liquidityTotal)} de ${formatMoney(incomeAmount)}.`
    };
  }

  if (!cleanDate(data.get("periodStart"), "")) {
    return { field: "periodStart", message: "El inicio del periodo actual debe ser una fecha valida." };
  }

  const paydayRaw = String(data.get("payday") ?? "").trim();
  const payday = paydayRaw ? Number(paydayRaw) : 0;
  if (!Number.isFinite(payday) || payday < 0 || payday > 28) {
    return { field: "payday", message: "El dia de pago debe estar entre 0 y 28." };
  }

  if (!["fixed", "variable"].includes(data.get("incomeType"))) {
    return { field: "incomeType", message: "Elige si tu ingreso es fijo o variable." };
  }

  if (!["low", "medium", "high"].includes(data.get("volatility"))) {
    return { field: "volatility", message: "Elige la volatilidad de tus ingresos." };
  }

  const rangeFields = [
    ["selfEfficacy", "La confianza financiera debe estar entre 1 y 10.", 1, 10],
    ["financialAnxiety", "La ansiedad financiera debe estar entre 1 y 10.", 1, 10],
    ["worship", "Revisa la pregunta de buscar mas dinero.", 1, 5],
    ["avoidance", "Revisa la pregunta de evitar mirar dinero.", 1, 5],
    ["status", "Revisa la pregunta de dinero como estatus.", 1, 5],
    ["vigilance", "Revisa la pregunta de control y seguridad.", 1, 5]
  ];

  for (const [field, message, min, max] of rangeFields) {
    const value = numberValue(data.get(field));
    if (value == null || value < min || value > max) {
      return { field, message };
    }
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
    state.lastAlert = "Mantengamos maximo 10 categorias para que el plan siga claro.";
    saveState();
    render();
    return;
  }

  const name = cleanText(data.get("name"), "Nuevo campo");
  const amount = numberFrom(data.get("amount"));
  const cadence = ["weekly", "biweekly", "monthly", "semester", "yearly", "period"].includes(data.get("cadence")) ? data.get("cadence") : "monthly";
  if (amount <= 0) {
    state.lastAlert = "El monto del campo debe ser mayor que cero.";
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
  if (semesterBudget > summary.freeBudget) {
    state.lastAlert = `${name} reservaria ${formatMoney(semesterBudget)}, pero solo hay ${formatMoney(summary.freeBudget)} libre para reservar.`;
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
    state.lastAlert = "El dinero extra debe ser mayor que cero.";
    saveState();
    render();
    return;
  }

  const source = cleanText(data.get("source"), "Dinero extra");
  const location = normalizeLocation(data.get("location"));
  const date = cleanDate(data.get("date"), todayKey());
  pendingExtraAllocation = {
    source,
    amount,
    date,
    location,
    savingsPercent: 20
  };
  planSheet = "";
  state.lastAlert = "Antes de sumarlo, decide cuanto va a ahorro y cuanto queda libre.";
  render();
}

function handleExtraAllocationSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  applyPendingExtraAllocation(numberFrom(data.get("savingsPercent")));
  saveState();
  render();
}

function applyPendingExtraAllocation(rawPercent) {
  if (!pendingExtraAllocation) {
    return;
  }

  const percent = clamp(Number(rawPercent || 0), 0, 100);
  const savingsAmount = Math.round(Number(pendingExtraAllocation.amount || 0) * percent / 100);
  const freeAmount = Number(pendingExtraAllocation.amount || 0) - savingsAmount;
  const now = new Date().toISOString();
  const currentWindow = budgetSummary().window;
  const appliesNow = pendingExtraAllocation.date >= currentWindow.start && pendingExtraAllocation.date < currentWindow.end;
  let savingsJob = null;

  if (appliesNow) {
    adjustLiquidity(pendingExtraAllocation.location, pendingExtraAllocation.amount, "extra");
    savingsJob = applySavingsAllocation(savingsAmount, now);
  }

  const extra = {
    id: uid("extra"),
    source: pendingExtraAllocation.source,
    amount: pendingExtraAllocation.amount,
    date: pendingExtraAllocation.date,
    location: pendingExtraAllocation.location,
    allocation: {
      savingsPercent: percent,
      savingsAmount: appliesNow ? savingsAmount : 0,
      freeAmount: appliesNow ? freeAmount : pendingExtraAllocation.amount,
      savingsJobId: savingsJob?.id || ""
    },
    updated_at: now
  };
  state.budgetExtras.push(extra);
  const summary = budgetSummary();
  state.lastAlert = appliesNow
    ? `${extra.source} sumo ${formatMoney(extra.amount)}: ${formatMoney(extra.allocation.savingsAmount)} a ahorro y ${formatMoney(extra.allocation.freeAmount)} libre.`
    : `${extra.source} quedo guardado, pero esa fecha pertenece a otro periodo.`;
  pendingExtraAllocation = null;
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const plan = calculatePlan();
  const amount = numberFrom(data.get("amount"));
  const merchant = cleanText(data.get("merchant"), "Compra");
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
    state.lastAlert = `${merchant} quedo en pausa 24 horas antes de decidir.`;
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
  state.lastAlert = `${transaction.merchant} quedo reclasificado.`;
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
    return "Elige un campo valido para clasificar el gasto.";
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
  state.lastAlert = "Simulacion de aumento actualizada.";
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
    state.lastAlert = "Recordatorio guardado, pero las notificaciones estan bloqueadas en el navegador.";
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
  } else if (permission === "denied") {
    state.lastAlert = "El navegador bloqueo las notificaciones. Cambialo desde los ajustes del sitio.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  } else {
    state.lastAlert = "Notificaciones no disponibles en este navegador.";
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
  }
  saveState({ touch: false });
  render();
}

function sendTestReminder() {
  showDailyReminderNotification({ test: true });
  state.lastAlert = "Notificacion de prueba enviada.";
}

async function handleCloudLoginSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const email = cleanText(data.get("email"), "");
  const password = String(data.get("password") || "");
  const mode = event.currentTarget.dataset.cloudMode || event.submitter?.dataset.cloudMode || "signin";

  cloudState.status = "syncing";
  cloudState.sessionReady = false;
  cloudState.error = "";
  render();

  try {
    const session = mode === "signup" ? await signUpToCloud(email, password) : await signInToCloud(email, password);
    if (!session) {
      cloudState.sessionReady = true;
      cloudState.status = "signed-out";
      cloudState.error = "Cuenta creada. Revisa tu correo si Supabase pide confirmacion.";
      render();
      return;
    }
    applyCloudSession(session);
    cloudState.sessionReady = true;
    resetQuickExpenseAfterLogin();
    state.lastAlert = mode === "signup" ? "Cuenta creada." : "Sesion iniciada.";
    await pullCloudAfterLogin();
  } catch (error) {
    cloudState.sessionReady = true;
    cloudState.status = "signed-out";
    cloudState.error = friendlyCloudError(error);
    render();
  }
}

async function handleCloudSignOut() {
  cloudState.status = "syncing";
  cloudState.sessionReady = false;
  clearTimeout(cloudSaveTimer);
  render();
  let signOutWarning = "";
  try {
    await saveCloudState(getCloudPayload());
  } catch (error) {
    signOutWarning = friendlyCloudError(error);
  }

  try {
    await signOutFromCloud();
  } catch (error) {
    signOutWarning ||= friendlyCloudError(error);
  }

  clearStoredCloudSession();
  clearLocalUserState();
  cloudState.signedIn = false;
  cloudState.email = "";
  cloudState.sessionReady = true;
  cloudState.status = "signed-out";
  cloudState.error = signOutWarning
    ? `Cerraste sesion en este dispositivo. No pude completar la sincronizacion: ${signOutWarning}`
    : "";
  render();
}

function clearLocalUserState() {
  clearTimeout(cloudSaveTimer);
  clearTimeout(dailyReminderTimer);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BACKUP_KEY);
  state = createDefaultState();
  state.activeView = DEFAULT_VIEW;
  authMode = "";
  menuOpen = false;
  quickExpenseOpen = false;
  pendingExtraAllocation = null;
  planSheet = "";
  pendingJobRemovalId = "";
  editingTransactionId = "";
  editingExtraId = "";
  clearSnackbar({ renderNow: false });
}

function completeCheckin() {
  const today = todayKey();
  const unlabeledToday = state.transactions.filter((transaction) => transaction.date === today && !transaction.labeled);
  if (unlabeledToday.length) {
    state.lastAlert = `Quedan ${unlabeledToday.length} gastos de hoy sin categoria.`;
    return;
  }

  if (!state.checkins.includes(today)) {
    state.checkins.push(today);
    state.wins.push({
      id: uid("win"),
      date: today,
      text: "Completaste la revision de hoy."
    });
  }
  state.lastAlert = "Revision cerrada. Hoy ya quedo al dia.";
}

function simulateSpendingAlert() {
  state.lastAlert = createSpendAlert(categoryStatus().sort((a, b) => b.ratio - a.ratio)[0]?.id);
}

function addProcessWin() {
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Revisaste el plan sin convertir un desvio en identidad."
  });
  state.lastAlert = "Victoria de proceso registrada.";
}

function applyStudentContext() {
  const now = new Date().toISOString();
  const semesterIncome = STUDENT_SEMESTER_INCOME;
  const semesterMonths = STUDENT_SEMESTER_MONTHS;
  const weeklyGas = STUDENT_WEEKLY_GAS;
  state.profile = {
    ...state.profile,
    completed: true,
    name: "Plan estudiante becado",
    incomeCadence: "semester",
    incomeAmount: semesterIncome,
    incomeType: "variable",
    volatility: "medium",
    semesterIncome,
    semesterMonths,
    periodStart: monthStartKey(),
    semesterStart: monthStartKey(),
    monthlyIncome: monthlyFromSemester(semesterIncome, semesterMonths),
    weeklyGas,
    committedExpenses: monthlyFromWeekly(weeklyGas),
    relationshipMonthlyBudget: 45_000,
    giftMonthlyBudget: 20_000,
    updated_at: now
  };
  state.budgetJobs = STUDENT_BUDGET_JOBS.map((job) => ({ ...job, updated_at: now }));
  state.meta = { ...(state.meta || {}), budgetPreset: "student" };
  state.lastAlert = "Contexto estudiante aplicado: beca semestral, moto, gasolina y salidas.";
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Personalizaste la app a tu vida de estudiante becado."
  });
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
  const prediction = periodPrediction();
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
    freeRemaining: summary.freeRemaining,
    projectedEndFree: prediction.projectedEndFree,
    dailyRate: prediction.dailyRate,
    confidence: prediction.confidence,
    categoryOverspent: summary.categoryOverspent,
    transactionCount: movements.filter((movement) => movement.kind === "expense").length,
    incomeCount: movements.filter((movement) => movement.kind === "income").length,
    status: prediction.status
  };
  const existingIndex = (state.periodClosures || []).findIndex((item) => item.id === closure.id);
  state.periodClosures = state.periodClosures || [];
  if (existingIndex >= 0) {
    state.periodClosures[existingIndex] = closure;
  } else {
    state.periodClosures.unshift(closure);
  }
  state.periodClosures = state.periodClosures.slice(0, 12);
  state.lastAlert = `Cierre guardado: ${formatMoney(closure.freeRemaining)} libres y ${closure.transactionCount} gastos.`;
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
  state.lastAlert = "Categoria eliminada. Sus gastos vuelven a revision.";
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
    ? `${transaction.merchant} eliminado. La categoria se recalculo.`
    : "Gasto eliminado.";
  if (snackbar?.transactionId === id) {
    clearSnackbar({ renderNow: false });
  }
}

function shouldClearTemplateBudgetOnPlanSave() {
  return state.meta?.budgetPreset !== "student" && isTemplateBudgetJobs(state.budgetJobs);
}

function clearTemplateBudget(target = state) {
  const templateIds = new Set(STUDENT_BUDGET_JOBS.map((job) => job.id));
  target.budgetJobs = [];
  target.cooldowns = (target.cooldowns || []).filter((cooldown) => !templateIds.has(cooldown.category));
  target.merchantRules = (target.merchantRules || []).filter((rule) => !templateIds.has(rule.category));
  (target.transactions || []).forEach((transaction) => {
    if (templateIds.has(transaction.category)) {
      transaction.category = "";
      transaction.labeled = false;
    }
  });
  target.meta = { ...(target.meta || {}), budgetPreset: "" };
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

function clearCurrentPeriodExtras() {
  const summary = budgetSummary();
  const extras = budgetExtrasForSummary(summary);
  if (!extras.length) {
    state.lastAlert = "No hay dinero extra en este periodo.";
    return;
  }

  const total = extras.reduce((sum, extra) => sum + Number(extra.amount || 0), 0);
  if (typeof window.confirm === "function" && !window.confirm(`Quitar ${formatMoney(total)} de dinero extra del periodo actual?`)) {
    state.lastAlert = "No quite ningun extra.";
    return;
  }

  const ids = new Set(extras.map((extra) => extra.id));
  extras.forEach((extra) => {
    reverseBudgetExtra(extra);
  });
  state.budgetExtras = state.budgetExtras.filter((extra) => !ids.has(extra.id));
  state.lastAlert = `Quite ${formatMoney(total)} de dinero extra del periodo.`;
}

function cancelCooldown(id) {
  state.cooldowns = state.cooldowns.filter((cooldown) => cooldown.id !== id);
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Cancelaste una compra despues de pausarla."
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
  const matches = state.budgetJobs.filter((job) => /ahorro|emergencia|buffer/i.test(job.name));
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

function showUndoSnackbar(transactionId) {
  clearTimeout(snackbarTimer);
  snackbar = {
    message: "Gasto registrado. ¿Deshacer?",
    action: "undo",
    kind: "",
    transactionId
  };
  snackbarTimer = setTimeout(() => {
    clearSnackbar();
  }, 5000);
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
  snackbarTimer = setTimeout(() => {
    clearSnackbar();
  }, duration);
  if (renderNow) {
    render();
  }
}

function clearSnackbar(options = {}) {
  const { renderNow = true } = options;
  clearTimeout(snackbarTimer);
  snackbar = null;
  if (renderNow) {
    render();
  }
}

function calculatePlan() {
  return calculateFinancePlan(state, todayKey());
}

function budgetSummary() {
  return getBudgetSummary(state, todayKey());
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
  if (!("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

async function requestNotificationPermission() {
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
    return;
  }

  const title = options.test ? "Prueba de recordatorio" : "Revision de gastos";
  const body = "Quieres registrar tus gastos de hoy?";
  const data = { url: `${selfLocationOrigin()}#${QUICK_EXPENSE_HASH}` };
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
      return;
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
  } catch {}
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
  if (permission === "granted") {
    return "El recordatorio queda programado localmente en este dispositivo. Si el sistema cierra la app por completo, se reprograma al volver a abrirla.";
  }
  if (permission === "denied") {
    return "El horario queda guardado, pero el navegador no mostrara avisos hasta que cambies el permiso del sitio.";
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
  return state.budgetJobs.find((job) => job.id === categoryId)?.name || "Sin categoria";
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
    || rules.find((rule) => rule.key.length >= 3 && (key.includes(rule.key) || rule.key.includes(key)))
    || null;
}

function rememberMerchantRule(transaction) {
  const key = merchantKey(transaction?.merchant);
  const category = transaction?.category || "";
  if (key.length < 3 || !category || category === FREE_CATEGORY_ID || !state.budgetJobs.some((job) => job.id === category)) {
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

function merchantKey(value) {
  return cleanText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function spendByCategory() {
  return getSpendByCategory(state, todayKey());
}

function monthlyLabeledSpend() {
  return getMonthlyLabeledSpend(state, todayKey());
}

function dominantMoneyScript() {
  const labels = {
    worship: {
      name: "Buscar mas dinero",
      guidance: "Convierte deseos grandes en metas concretas antes de gastar."
    },
    avoidance: {
      name: "Evitar mirar dinero",
      guidance: "Mira solo el siguiente paso y evita cargar todo el peso de una vez."
    },
    status: {
      name: "Dinero como estatus",
      guidance: "Separa tu valor personal de compras visibles y comparaciones."
    },
    vigilance: {
      name: "Control y seguridad",
      guidance: "Automatiza seguridad y deja un margen claro para gastar sin culpa."
    }
  };
  const key = Object.entries(state.profile.moneyScripts).sort((a, b) => b[1] - a[1])[0][0];
  return labels[key];
}

function graduatedPresenceTask() {
  if (state.profile.financialAnxiety >= 7) {
    return "Clasifica un gasto y cierra la revision.";
  }
  if (state.profile.selfEfficacy <= 4) {
    return "Guarda un avance antes de mirar saldos.";
  }
  return "Clasifica pendientes y revisa la categoria mas cercana al limite.";
}

function futureFreedom(plan) {
  const monthlyReturn = plan.savings * 0.006;
  const hours = monthlyReturn / Math.max(1, getMonthlyIncome(state.profile) / 160);
  if (hours < 1) {
    return `${Math.round(hours * 60)} minutos libres/mes`;
  }
  return `${hours.toFixed(1)} horas libres/mes`;
}

function suggestedSavingsMoment() {
  const payday = Number(state.profile.payday || 0);
  return payday > 0 ? `Dia ${clamp(payday + 1, 1, 28)} del periodo` : "Al recibir el presupuesto";
}

function createSpendAlert(categoryId) {
  const category = categoryStatus().find((item) => item.id === categoryId) || categoryStatus()[0];
  if (!category) {
    return "Gasto registrado.";
  }
  if (category.ratio >= 100) {
    return `${category.name} supero su trabajo. Una decision no define tu capacidad; reasigna antes del proximo gasto.`;
  }
  if (category.ratio >= 75) {
    return `${category.name} esta al ${Math.round(category.ratio)}%. Quedan ${formatMoney(Math.max(0, category.budget - category.spent))}.`;
  }
  return `${category.name} va al ${Math.round(category.ratio)}%. El limite sigue visible antes de comprar.`;
}

function uniqueCategoryId(name) {
  const base = cleanText(name, "categoria")
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
    registrar: "spending",
    gastos: "spending",
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
    savings: "ahorro",
    calendar: "calendario",
    spending: "registrar",
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
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0
  }).format(Number(digits));
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

function parseNumberText(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return Number.NaN;
  }
  const clean = text.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!clean || clean === "-" || clean === "." || clean === ",") {
    return Number.NaN;
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    return Number(clean.replace(/\./g, "").replace(",", "."));
  }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) {
    return Number(clean.replace(/,/g, ""));
  }
  return Number(clean.replace(",", "."));
}

function numberFrom(value) {
  const number = parseNumberText(value);
  return Math.max(0, Number.isFinite(number) ? number : 0);
}

function numberValue(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const number = parseNumberText(text);
  return Number.isFinite(number) ? number : null;
}

function normalizePayday(value) {
  const day = Number(value);
  if (!Number.isFinite(day) || day <= 0) {
    return 0;
  }
  return clamp(day, 1, 28);
}

function monthlyFromSemester(amount, months) {
  return Math.round(numberFrom(amount) / Math.max(1, Number(months) || STUDENT_SEMESTER_MONTHS));
}

function monthlyFromWeekly(amount) {
  return Math.round((numberFrom(amount) * 52) / 12);
}

function normalizeBudgetJobs(jobs) {
  const defaults = {
    gas: { amount: STUDENT_WEEKLY_GAS, cadence: "weekly" },
    dates: { amount: 45_000, cadence: "monthly" },
    gifts: { amount: 20_000, cadence: "monthly" },
    university: { amount: 25_000, cadence: "monthly" },
    flex: { amount: 9_000, cadence: "monthly" }
  };

  return jobs.map((job) => {
    const known = defaults[job.id] || {};
    return {
      ...job,
      amount: Number(job.amount ?? known.amount ?? job.budget ?? 0),
      cadence: ["weekly", "biweekly", "monthly", "semester", "yearly", "period"].includes(job.cadence) ? job.cadence : known.cadence || "monthly",
      updated_at: job.updated_at || ""
    };
  });
}

function normalizeTransactions(transactions) {
  return transactions.map((transaction) => ({
    ...transaction,
    id: transaction.id || uid("tx"),
    date: cleanDate(transaction.date, todayKey()),
    merchant: cleanText(transaction.merchant, "Compra"),
    description: cleanText(transaction.description, ""),
    amount: Number(transaction.amount || 0),
    category: transaction.category || "",
    labeled: Boolean(transaction.category || transaction.labeled),
    budgeted: Boolean(transaction.budgeted),
    oneOff: Boolean(transaction.oneOff || transaction.excludeFromPrediction),
    source: normalizeLocation(transaction.source),
    calendarEventId: transaction.calendarEventId || "",
    updated_at: transaction.updated_at || transaction.createdAt || transaction.date || ""
  }));
}

function normalizePeriodClosures(closures) {
  return closures
    .map((closure) => ({
      id: closure.id || `${closure.windowStart || closure.start}:${closure.windowEnd || closure.end}`,
      windowStart: cleanDate(closure.windowStart || closure.start, ""),
      windowEnd: cleanDate(closure.windowEnd || closure.end, ""),
      closedAt: closure.closedAt || closure.updated_at || "",
      income: Number(closure.income || 0),
      reserved: Number(closure.reserved || 0),
      spent: Number(closure.spent || 0),
      freeRemaining: Number(closure.freeRemaining || 0),
      projectedEndFree: Number(closure.projectedEndFree || 0),
      dailyRate: Number(closure.dailyRate || 0),
      confidence: ["empty", "learning", "normal"].includes(closure.confidence) ? closure.confidence : "normal",
      categoryOverspent: Number(closure.categoryOverspent || 0),
      transactionCount: Number(closure.transactionCount || 0),
      incomeCount: Number(closure.incomeCount || 0),
      status: normalizePredictionStatus(closure.status)
    }))
    .filter((closure) => closure.windowStart && closure.windowEnd)
    .slice(0, 12);
}

function normalizePredictionStatus(status) {
  return ["empty", "learning", "healthy", "tight", "risk", "over_reserved"].includes(status) ? status : "healthy";
}

function normalizeMerchantRules(rules, transactions = []) {
  const normalized = rules
    .map((rule) => {
      const merchant = cleanText(rule.merchant || rule.name, "");
      const key = merchantKey(rule.key || merchant);
      return {
        id: rule.id || uid("rule"),
        merchant,
        key,
        category: rule.category || "",
        source: normalizeLocation(rule.source),
        count: Number(rule.count || 1),
        lastUsedAt: rule.lastUsedAt || rule.updated_at || "",
        updated_at: rule.updated_at || rule.lastUsedAt || ""
      };
    })
    .filter((rule) => rule.key.length >= 3 && rule.category);

  const byKey = new Map(normalized.map((rule) => [rule.key, rule]));
  buildMerchantRulesFromTransactions(transactions).forEach((rule) => {
    if (!byKey.has(rule.key)) {
      byKey.set(rule.key, rule);
    }
  });

  return [...byKey.values()]
    .sort((a, b) => String(b.lastUsedAt || b.updated_at || "").localeCompare(String(a.lastUsedAt || a.updated_at || "")) || Number(b.count || 0) - Number(a.count || 0))
    .slice(0, 30);
}

function buildMerchantRulesFromTransactions(transactions = []) {
  const rules = new Map();
  transactions.forEach((transaction) => {
    const key = merchantKey(transaction.merchant);
    const category = transaction.category || "";
    if (key.length < 3 || !category || category === FREE_CATEGORY_ID) {
      return;
    }
    const existing = rules.get(key);
    const updatedAt = transaction.updated_at || transaction.createdAt || transaction.date || "";
    if (!existing) {
      rules.set(key, {
        id: uid("rule"),
        merchant: cleanText(transaction.merchant, "Comercio"),
        key,
        category,
        source: normalizeLocation(transaction.source),
        count: 1,
        lastUsedAt: updatedAt,
        updated_at: updatedAt
      });
      return;
    }
    existing.count += 1;
    if (String(updatedAt).localeCompare(String(existing.lastUsedAt || "")) >= 0) {
      existing.category = category;
      existing.source = normalizeLocation(transaction.source);
      existing.lastUsedAt = updatedAt;
      existing.updated_at = updatedAt;
    }
  });
  return [...rules.values()];
}

function filterMerchantRulesForJobs(rules, jobs) {
  const validCategories = new Set((jobs || []).map((job) => job.id));
  return (rules || []).filter((rule) => validCategories.has(rule.category));
}

function normalizeCalendarEvents(events) {
  return events.map((event) => ({
    id: event.id || uid("event"),
    title: cleanText(event.title || event.name, "Plan especial"),
    date: cleanDate(event.date, todayKey()),
    amount: Number(event.amount || event.estimatedAmount || 0),
    category: normalizeEventCategory(event.category),
    notes: cleanText(event.notes || event.description, ""),
    spent: Boolean(event.spent),
    transactionId: event.transactionId || "",
    updated_at: event.updated_at || event.date || ""
  }));
}

function normalizeDailyReminder(reminder = {}) {
  return {
    enabled: Boolean(reminder.enabled),
    time: normalizeReminderTime(reminder.time),
    lastShownDate: cleanDate(reminder.lastShownDate, ""),
    updated_at: reminder.updated_at || ""
  };
}

function isTemplateBudgetJobs(jobs) {
  return Boolean(jobs?.length) && jobs.every((job) => {
    const template = STUDENT_BUDGET_JOBS.find((item) => item.id === job.id);
    if (!template) {
      return false;
    }
    const amount = Number(job.amount ?? job.budget ?? 0);
    const cadence = job.cadence || template.cadence;
    return cleanText(job.name, "") === template.name && amount === template.amount && cadence === template.cadence;
  });
}

function normalizeBudgetExtras(extras) {
  return extras.map((extra) => ({
    id: extra.id || uid("extra"),
    source: cleanText(extra.source || extra.name, "Dinero extra"),
    amount: Number(extra.amount || 0),
    date: cleanDate(extra.date, todayKey()),
    location: normalizeLocation(extra.location),
    allocation: extra.allocation || null,
    updated_at: extra.updated_at || extra.date || ""
  }));
}

function normalizeLiquidity(liquidity) {
  return {
    account: numberFrom(liquidity?.account),
    cash: numberFrom(liquidity?.cash),
    initialized: Boolean(liquidity?.initialized),
    updated_at: liquidity?.updated_at || ""
  };
}

function normalizeLocation(value) {
  return value === "cash" ? "cash" : "account";
}

function normalizeEventCategory(value) {
  const category = String(value || "");
  return category || FREE_CATEGORY_ID;
}

function normalizeReminderTime(value) {
  const text = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : DEFAULT_REMINDER_TIME;
}

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

function cleanText(value, fallback) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text || fallback;
}

function cleanDate(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : fallback;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
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

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("es-CO", {
    month: "short",
    day: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function formatShortDate(dateValue) {
  return new Intl.DateTimeFormat("es-CO", {
    month: "short",
    day: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`)).replace(".", "");
}

function eventMonthLabel(dateValue) {
  return new Intl.DateTimeFormat("es-CO", {
    month: "short"
  }).format(new Date(`${dateValue}T12:00:00`)).replace(".", "");
}

function eventDayLabel(dateValue) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function formatRelativeEventDate(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  const today = new Date(`${todayKey()}T12:00:00`);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Manana";
  if (days === -1) return "Ayer";
  if (days > 1) return `En ${days} dias`;
  return `Hace ${Math.abs(days)} dias`;
}

function movementDayLabel(dateValue) {
  if (dateValue === todayKey()) return "Hoy";
  if (dateValue === previousDay(todayKey())) return "Ayer";
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: state.profile.currency || "COP",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatCompactMoney(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) < 1000) {
    return formatMoney(amount);
  }
  return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(amount / 1000)}k`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
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
