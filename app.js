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
  spendByCategory as getSpendByCategory
} from "./finance-core.js?v=20260610-movements-theme";
import {
  getCloudSession,
  isCloudConfigured,
  isCloudLibraryLoaded,
  loadCloudState,
  onCloudAuthChange,
  saveCloudState,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud
} from "./sync-client.js?v=20260610-movements-theme";

const STORAGE_KEY = "finanzas-conductuales:v1";
const BACKUP_KEY = "finanzas-conductuales:backups:v1";
const DEFAULT_VIEW = "today";
const QUICK_EXPENSE_HASH = "registrar-gasto";
const AUTH_STARTUP_TIMEOUT_MS = 5_000;
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
  { id: "movements", label: "Movimientos", icon: "04" },
  { id: "profile", label: "Datos", icon: "05" }
];

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
let transactionHistorySort = "recent";
let snackbar = null;
let snackbarTimer;
let pendingExtraAllocation = null;
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

render();
window.setTimeout(recoverAuthStartup, AUTH_STARTUP_TIMEOUT_MS);
initializeCloudSync();
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
      updated_at: now
    },
    budgetExtras: [],
    liquidity: {
      account: 0,
      cash: 0,
      initialized: false,
      updated_at: now
    },
    budgetJobs: [],
    transactions: [],
    cooldowns: [],
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
      updated_at: savedState.settings?.updated_at || defaults.settings.updated_at
    },
    transactions: normalizeTransactions(savedState.transactions || defaults.transactions),
    budgetExtras: normalizeBudgetExtras(savedState.budgetExtras || defaults.budgetExtras),
    liquidity: normalizeLiquidity(savedState.liquidity || defaults.liquidity),
    cooldowns: savedState.cooldowns || defaults.cooldowns,
    checkins: savedState.checkins || defaults.checkins,
    wins: savedState.wins || defaults.wins
  };
  migrated.profile.incomeAmount = migrated.profile.incomeAmount ?? migrated.profile.semesterIncome ?? migrated.profile.monthlyIncome ?? defaults.profile.incomeAmount;
  migrated.profile.periodStart = migrated.profile.periodStart || migrated.profile.semesterStart || defaults.profile.periodStart;
  migrated.profile.semesterStart = migrated.profile.semesterStart || migrated.profile.periodStart;
  migrated.profile.payday = normalizePayday(migrated.profile.payday ?? defaults.profile.payday);
  migrated.budgetJobs = normalizeBudgetJobs(savedState.budgetJobs || defaults.budgetJobs);
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

function latestLocalBackup() {
  return readLocalBackups()[0] || null;
}

function restoreLatestBackup() {
  const backup = latestLocalBackup();
  if (!backup?.state) {
    state.lastAlert = "No encontre respaldos automaticos en este navegador.";
    return;
  }

  saveLocalBackup("antes de restaurar respaldo");
  state = migrateState(backup.state);
  state.showDiagnosis = false;
  pendingExtraAllocation = null;
  clearSnackbar({ renderNow: false });
  activateView(DEFAULT_VIEW);
  state.lastAlert = `Respaldo restaurado: ${backup.counts?.transactions || 0} gastos y ${backup.counts?.fields || 0} campos.`;
}

function friendlyCloudError(error) {
  const message = error?.message || String(error);
  if (message.toLowerCase().includes("invalid login")) {
    return "Correo o contrasena incorrectos.";
  }
  if (message.toLowerCase().includes("fetch")) {
    return "No pude conectar con la nube. Revisa internet.";
  }
  if (message.toLowerCase().includes("libreria de nube")) {
    return "No pude cargar Supabase. Revisa internet y recarga la pagina.";
  }
  return message;
}

function renderCloudStatusChange() {
  if (shouldShowAuthGate()) {
    render();
    return;
  }
  if (quickExpenseOpen || state.showDiagnosis || pendingExtraAllocation) {
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
  if (isQuickExpenseLocation()) {
    window.history.back();
  }
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
          <span class="brand-mark">FC</span>
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
        <div class="menu-tools">
          <button class="btn primary" type="button" data-action="open-diagnosis">Mis datos</button>
          <button class="btn ghost" type="button" data-action="cloud-sign-out">Cerrar sesion</button>
          ${menuAlertText() ? `<div class="menu-notice" role="status">${escapeHtml(menuAlertText())}</div>` : ""}
        </div>
      </div>
    </aside>
    <main class="main-panel">
      ${renderHeader(plan)}
      ${renderView(plan)}
    </main>
    ${renderBottomNavigation()}
    <button class="expense-fab" type="button" data-action="open-expense" aria-label="Registrar gasto">+</button>
    ${quickExpenseOpen ? renderQuickExpensePanel() : ""}
    ${!state.profile.completed || state.showDiagnosis ? renderDiagnosisModal() : ""}
    ${pendingExtraAllocation ? renderExtraAllocationModal() : ""}
    ${renderSnackbar()}
  `;

  bindEvents();
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

function renderBottomNavigation() {
  return `
    <nav class="bottom-nav" aria-label="Navegacion rapida">
      <button class="bottom-nav-item" type="button" data-action="toggle-menu">
        <span class="bottom-nav-icon menu-icon" aria-hidden="true"></span>
        <span>Menu</span>
      </button>
      <button class="bottom-nav-item ${state.activeView === "today" ? "is-active" : ""}" type="button" data-view="today">
        <span class="bottom-nav-icon home-icon" aria-hidden="true"></span>
        <span>Inicio</span>
      </button>
      <button class="bottom-nav-item is-register" type="button" data-action="open-expense">
        <span class="bottom-nav-icon plus-icon" aria-hidden="true">+</span>
        <span>Registrar</span>
      </button>
      <button class="bottom-nav-item ${state.activeView === "budget" ? "is-active" : ""}" type="button" data-view="budget">
        <span class="bottom-nav-icon plan-icon" aria-hidden="true"></span>
        <span>Plan</span>
      </button>
    </nav>
  `;
}

function shouldShowAuthGate() {
  return !cloudState.signedIn;
}

function renderAuthGate() {
  const checkingSession = cloudState.status === "checking" && !cloudState.sessionReady;
  const submittingAccess = cloudState.status === "syncing" && !cloudState.sessionReady;
  const unavailable = !cloudState.configured || !cloudState.libraryLoaded;

  return `
    <main class="auth-gate">
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-brand">
          <span class="brand-mark">FC</span>
          <div>
            <p class="eyebrow">Finanzas Conductuales</p>
            <h1 id="auth-title">Accede para empezar</h1>
          </div>
        </div>
        ${
          unavailable
            ? `<p>La autenticacion no esta disponible. Revisa la configuracion de Supabase y vuelve a cargar la aplicacion.</p>`
            : `
              <p>Primero crea una cuenta o inicia sesion. Despues configuraras tu presupuesto y tus campos habituales.</p>
              ${checkingSession ? `<p class="auth-session-note">Comprobando automaticamente si ya tienes una sesion guardada...</p>` : ""}
              <form class="stacked-form auth-form" id="cloud-login-form">
                <label>
                  Correo
                  <input name="email" type="email" autocomplete="email" placeholder="tu@email.com" required>
                </label>
                <label>
                  Contrasena
                  <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Minimo 6 caracteres" required>
                </label>
                <button class="btn primary" type="submit" data-cloud-mode="signup" ${submittingAccess ? "disabled" : ""}>Crear cuenta</button>
                <button class="btn ghost" type="submit" data-cloud-mode="signin" ${submittingAccess ? "disabled" : ""}>Ya tengo cuenta: iniciar sesion</button>
              </form>
            `
        }
        ${cloudState.error ? `<p class="form-error" role="alert">${escapeHtml(cloudState.error)}</p>` : ""}
      </section>
    </main>
  `;
}

function renderHeader(plan) {
  const summary = budgetSummary();
  const liquidity = liquiditySummary(summary);
  const periodLine =
    summary.extraIncome > 0
      ? `<span class="money-split">Total incluye extra: ${periodExtraSourceLabel(summary)}. Base ${formatMoney(summary.baseIncome)} · Total ${formatMoney(summary.income)}</span>`
      : "";

  return `
    <header class="money-bar ${summary.overReserved ? "danger" : ""}" role="status" aria-label="Dinero libre sin asignar">
      <span class="money-label">Libre ${summary.cadenceLabel}</span>
      <strong>${formatMoney(summary.freeRemaining)}</strong>
      <span class="money-caption">${summary.overReserved ? "sobreasignado" : "para nuevos gastos"}</span>
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
    spending: renderSpending,
    movements: renderMovements,
    profile: renderProfile
  };
  return views[state.activeView](plan);
}

function getPrimaryAction(plan, unlabeled, checkinDone) {
  if (!state.profile.completed) {
    return {
      title: "Pon tus datos reales",
      copy: "La app esta usando un ejemplo. Con tu presupuesto y tus gastos cambia toda la recomendacion.",
      badge: "Primer paso",
      button: "Empezar",
      action: "open-diagnosis"
    };
  }

  if (unlabeled.length) {
    return {
      title: `Clasifica ${unlabeled.length} gastos pendientes`,
      copy: "Cuando cada gasto tiene categoria, el dinero disponible se vuelve claro.",
      badge: "Hoy",
      button: "Clasificar",
      view: "today"
    };
  }

  if (!checkinDone) {
    return {
      title: "Cierra tu revision de hoy",
      copy: "Ya no hay gastos pendientes. Guarda la revision para mantener tu racha.",
      badge: "Listo",
      button: "Terminar revision",
      action: "complete-checkin"
    };
  }

  if (plan.suggestedPeriodSavings > 0) {
    return {
      title: "Revisa tu recomendacion de ahorro",
      copy: `El simulador sugiere apartar ${formatMoney(plan.suggestedPeriodSavings)} durante este periodo.`,
      badge: "Ahorro",
      button: "Abrir simulador",
      view: "savings"
    };
  }

  if (plan.savingsCapacityGap > 0) {
    return {
      title: "Ajusta el plan antes de ahorrar",
      copy: `La meta ideal supera el dinero libre por ${formatMoney(plan.savingsCapacityGap)}.`,
      badge: "Simulador",
      button: "Ver recomendacion",
      view: "savings"
    };
  }

  return {
    title: "Mantente al dia",
    copy: "Registra el proximo gasto cuando ocurra y conserva tus limites visibles.",
    badge: "Sin pendientes",
    button: "Registrar gasto",
    view: "spending"
  };
}

function renderPrimaryActionButton(action) {
  if (action.view) {
    return `<button class="btn primary" type="button" data-view="${escapeAttr(action.view)}">${escapeHtml(action.button)}</button>`;
  }
  return `<button class="btn primary" type="button" data-action="${escapeAttr(action.action)}">${escapeHtml(action.button)}</button>`;
}

function renderToday(plan) {
  const visibleCategoryCount = Math.max(1, Math.min(6, state.budgetJobs.length + 1));
  return `
    <section class="home-view" aria-label="Resumen del periodo">
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
          : `<div class="empty-state home-empty">Crea campos como gasolina, comida o ahorro para ver sus limites aqui.</div>`
      }
    </section>
  `;

  const today = todayKey();
  const unlabeled = state.transactions.filter((transaction) => !transaction.labeled);
  const unlabeledToday = state.transactions.filter((transaction) => transaction.date === today && !transaction.labeled);
  const checkinDone = state.checkins.includes(today);
  const script = dominantMoneyScript();
  const primaryAction = getPrimaryAction(plan, unlabeled, checkinDone);
  const summary = budgetSummary();
  const overBudget = categoryStatus().filter((category) => category.ratio > 100);

  return `
    <section class="content-grid today-grid">
      <article class="card focus-card wide-card">
        <div class="focus-copy">
          <p class="eyebrow">Ahora</p>
          <h2>${primaryAction.title}</h2>
          <p>${primaryAction.copy}</p>
        </div>
        <div class="focus-side">
          <span class="metric-badge">${primaryAction.badge}</span>
          ${renderPrimaryActionButton(primaryAction)}
        </div>
      </article>

      <article class="card ritual-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Revision rapida</p>
            <h2>Clasifica ${unlabeled.length} gastos</h2>
          </div>
          <span class="metric-badge">${checkinDone ? "Hecho hoy" : "Pendiente"}</span>
        </div>
        <div class="transaction-list">
          ${
            unlabeled.length
              ? unlabeled
                  .slice(0, 5)
                  .map((transaction) => renderTransactionLabeler(transaction))
                  .join("")
              : `<div class="empty-state">No hay movimientos pendientes. Tu ancho de banda financiero esta despejado.</div>`
          }
        </div>
        <div class="card-actions">
          <button class="btn primary" type="button" data-action="complete-checkin" ${checkinDone ? "disabled" : ""}>
            Terminar revision
          </button>
          <button class="btn ghost" type="button" data-view="spending">Registrar gasto</button>
        </div>
        ${
          unlabeledToday.length
            ? `<p class="helper-text">Quedan gastos de hoy sin categoria.</p>`
            : `<p class="helper-text">Todo lo de hoy ya tiene categoria.</p>`
        }
      </article>

      <article class="card hero-visual">
        <div class="paying-visual" style="--spent:${clamp((monthlyLabeledSpend() / plan.expenses) * 100, 0, 100)}">
          <div class="coin-stack" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <div>
            <p class="eyebrow">Gasto del mes</p>
            <h2>${formatMoney(monthlyLabeledSpend())}</h2>
            <p>registrados en categorias del plan</p>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Fondo inicial</p>
            <h2>${formatMoney(state.profile.emergencySavings)} guardados</h2>
          </div>
          <span class="metric-badge">${formatMoney(plan.emergencyGap)} faltan</span>
        </div>
        ${renderProgress(plan.emergencyProgress, "Meta inicial de emergencia")}
        <p class="helper-text">
          Referencia del simulador; no modifica tu dinero disponible.
        </p>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Ahorro recomendado</p>
            <h2>${formatMoney(plan.suggestedPeriodSavings)}</h2>
          </div>
          <span class="metric-badge">Este periodo</span>
        </div>
        <p>Calculado con tu presupuesto, campos reservados, gastos comprometidos y tipo de ingreso.</p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-view="savings">Abrir simulador</button>
        </div>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Gastos por categoria</p>
            <h2>Limites visibles</h2>
          </div>
          <button class="icon-btn" type="button" data-action="simulate-alert" aria-label="Simular alerta visual">!</button>
        </div>
        ${renderCategoryBars(plan, 6)}
      </article>

      <article class="card">
        <p class="eyebrow">Pausa de 24 horas</p>
        <h2>${state.cooldowns.length} compras pausadas</h2>
        <div class="cooldown-list">
          ${
            state.cooldowns.length
              ? state.cooldowns.map((cooldown) => renderCooldown(cooldown)).join("")
              : `<div class="empty-state">Sin compras en pausa.</div>`
          }
        </div>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Cuando te sales del plan</p>
            <h2>Ajuste sin culpa</h2>
          </div>
          <span class="metric-badge">${overBudget.length} categorias excedidas</span>
        </div>
        <p class="reframe">
          Una decision no define tu capacidad. ${overBudget.length ? "Reasigna lo que queda y protege el siguiente pago." : "Mantienes margen para decidir con calma."}
        </p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-action="add-process-win">Guardar avance</button>
        </div>
      </article>

      <article class="card">
        <p class="eyebrow">Patron dominante</p>
        <h2>${script.name}</h2>
        <p>${script.guidance}</p>
        <div class="micro-task">
          <strong>Siguiente accion de 5 minutos</strong>
          <span>${graduatedPresenceTask()}</span>
        </div>
      </article>
    </section>
  `;
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
  const assignmentRatio = summary.income ? (ring.reserved / summary.income) * 100 : 0;
  const reservedAngle = (ring.reserved / Math.max(1, ring.total)) * 360;
  const spentAngle = ((ring.reserved + ring.spent) / Math.max(1, ring.total)) * 360;
  const status = summary.overReserved ? "over" : summary.freeBudget > 0 ? "under" : "balanced";

  return `
    <section class="content-grid budget-grid">
      <article class="card split-card">
        <div class="budget-ring" style="--reserved:${reservedAngle}deg; --spent:${spentAngle}deg">
          <div>
            <strong>${Math.round(assignmentRatio)}%</strong>
            <span>reservado</span>
          </div>
        </div>
        <div class="split-details">
          <p class="eyebrow">Presupuesto ${summary.cadenceLabel}</p>
          <h2>${formatMoney(summary.income)} por periodo</h2>
          ${renderAllocation("Campos reservados", ring.reserved, "reserved")}
          ${renderAllocation("Gastos registrados", ring.spent, "expenses")}
          ${renderAllocation("Libre disponible", ring.free, "savings")}
          <p class="helper-text">Las tres porciones suman ${formatMoney(ring.total)}. Base ${formatMoney(summary.baseIncome)} + extra ${formatMoney(summary.extraIncome)}.</p>
          ${ring.outside > 0 ? `<p class="form-error">Gastos fuera del presupuesto: ${formatMoney(ring.outside)}.</p>` : ""}
          <p class="helper-text">Periodo actual: ${formatDate(summary.window.start)} - ${formatDate(previousDay(summary.window.end))}. Equivale a ${formatMoney(getMonthlyIncome(state.profile))} / mes.</p>
        </div>
      </article>

      ${renderLiquidityCard(summary)}
      ${renderExtraBudgetCard(summary)}

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Crear campo</p>
            <h2>Reservar dinero</h2>
          </div>
          <span class="metric-badge ${status}">${formatMoney(summary.freeBudget)} libre</span>
        </div>
        ${renderProgress(assignmentRatio, "Reservado del presupuesto del periodo")}
        ${renderBudgetJobForm()}
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Trabajos del dinero</p>
            <h2>Gasto consciente</h2>
          </div>
          <span class="metric-badge">${state.budgetJobs.length}/10 maximo</span>
        </div>
        <div class="job-table">
          ${
            state.budgetJobs.length
              ? state.budgetJobs.map((job) => renderBudgetJob(job)).join("")
              : `<div class="empty-state">Aun no tienes campos. Crea uno como gasolina, comida, ahorro o salidas.</div>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderBudgetJobForm() {
  return `
    <form class="inline-form" id="budget-job-form">
      <label>
        Campo
        <input name="name" type="text" placeholder="Ej. Novia, ahorro, comida" maxlength="32" required>
      </label>
      <label>
        Monto
        <input name="amount" type="number" min="1000" step="1000" placeholder="30000" required>
      </label>
      <label>
        Frecuencia
        <select name="cadence">
          <option value="weekly">Semanal</option>
          <option value="biweekly">Quincenal</option>
          <option value="monthly">Mensual</option>
          <option value="semester">Semestral</option>
          <option value="yearly">Anual</option>
          <option value="period">Una vez por periodo</option>
        </select>
      </label>
      <button class="btn secondary" type="submit">Agregar campo</button>
    </form>
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

  return `
    <div class="job-row">
      <div>
        <strong>${escapeHtml(job.name)}</strong>
        <span>${formatMoney(spent)} de ${formatMoney(budget)} (${formatMoney(job.amount)} ${cadenceLabel(job.cadence)})</span>
      </div>
      <div class="bar ${band}" aria-label="${Math.round(ratio)} por ciento usado">
        <span style="width:${clamp(ratio, 0, 120)}%"></span>
      </div>
      <button class="icon-btn muted" type="button" data-action="remove-job" data-id="${escapeAttr(job.id)}" aria-label="Eliminar ${escapeAttr(job.name)}">x</button>
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
    <section class="content-grid savings-grid">
      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Simulador · ${capitalize(summary.cadenceLabel)}</p>
            <h2>${formatMoney(plan.suggestedPeriodSavings)} sugeridos para apartar</h2>
          </div>
          <span class="metric-badge">${Math.round(plan.savingsRate)}% orientativo</span>
        </div>
        <p>Esta cifra es una recomendacion. No mueve dinero, no cambia saldos y no crea campos en tu plan.</p>
        <div class="phase-grid">
          <div>
            <strong>Meta ideal del periodo</strong>
            <span>${formatMoney(plan.idealPeriodSavings)}</span>
          </div>
          <div>
            <strong>Ya reservado como ahorro</strong>
            <span>${formatMoney(plan.savingsReserved)}</span>
          </div>
          <div>
            <strong>Libre despues de la sugerencia</strong>
            <span>${formatMoney(plan.freeAfterSuggestion)}</span>
          </div>
          <div>
            <strong>Momento sugerido</strong>
            <span>${suggestedSavingsMoment()}</span>
          </div>
        </div>
        ${
          plan.savingsCapacityGap > 0
            ? `<p class="helper-text danger-text">La meta ideal no cabe completa: faltaria liberar ${formatMoney(plan.savingsCapacityGap)} del presupuesto.</p>`
            : `<p class="helper-text">La recomendacion cabe en el dinero libre actual del periodo.</p>`
        }
      </article>

      <article class="card">
        <p class="eyebrow">Como se calcula</p>
        <h2>${formatMoney(plan.projectedPeriodSavings)} proyectados</h2>
        <p>${plan.incomeNote}</p>
        <div class="phase-grid">
          <div><strong>Presupuesto</strong><span>${formatMoney(plan.periodIncome)}</span></div>
          <div><strong>Gastos comprometidos</strong><span>${formatMoney(plan.committedForPeriod)}</span></div>
          <div><strong>Campos de gasto</strong><span>${formatMoney(summary.expenseReserved)}</span></div>
        </div>
      </article>

      <article class="card">
        <p class="eyebrow">Fondo de referencia</p>
        <h2>${targetCovered ? "Meta cubierta" : `${periodsToTarget || "Sin"} periodos estimados`}</h2>
        ${renderProgress(plan.emergencyProgress, "Avance simulado con el ahorro actual")}
        <p>Referencia: ${formatMoney(plan.emergencyTarget)}. Ahorro actual informado: ${formatMoney(state.profile.emergencySavings)}.</p>
      </article>

      <article class="card">
        <p class="eyebrow">Simular un aumento</p>
        <h2>${formatMoney(escalatedSavings)} adicionales / mes</h2>
        <p>Si tus ingresos subieran ${state.settings.monthlyRaisePct}%, podrias orientar el ${state.settings.escalationPct}% del aumento al ahorro.</p>
        <form class="stacked-form" id="smart-form">
          <label>
            Aumento hipotetico %
            <input name="monthlyRaisePct" type="number" min="0" max="100" value="${state.settings.monthlyRaisePct}">
          </label>
          <label>
            Porcion hipotetica al ahorro %
            <input name="escalationPct" type="number" min="0" max="100" value="${state.settings.escalationPct}">
          </label>
          <button class="btn secondary" type="submit">Actualizar simulacion</button>
        </form>
      </article>

      <article class="card">
        <p class="eyebrow">Proyeccion orientativa</p>
        <h2>${futureFreedom(plan)}</h2>
        <p>Estimacion basada en repetir el ahorro proyectado; no representa un rendimiento garantizado.</p>
      </article>
    </section>
  `;
}

function renderQuickExpensePanel() {
  const summary = budgetSummary();
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
          <label>
            Comercio
            <input name="merchant" type="text" maxlength="42" placeholder="Ej. Tienda, Terpel" required>
          </label>
          <label>
            Descripcion opcional
            <input name="description" type="text" maxlength="90" placeholder="Ej. Tanqueada, regalo, almuerzo">
          </label>
          <div class="quick-field">
            <span class="quick-label">Categoria</span>
            ${renderChoicePills("category", categoryChoiceOptions(), FREE_CATEGORY_ID)}
          </div>
          <div class="quick-field">
            <span class="quick-label">Pagado con</span>
            ${renderChoicePills("source", [
              { value: "account", label: "Cuenta" },
              { value: "cash", label: "Efectivo" }
            ], "account")}
          </div>
          <label class="quick-amount">
            <span>Monto</span>
            <input name="amount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="$0" required>
          </label>
          <input name="budgeted" type="hidden" value="on">
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

function renderChoicePills(name, options, selected) {
  return `
    <div class="choice-pills" data-choice-group="${escapeAttr(name)}">
      <input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(selected)}">
      ${options
        .map(
          (option) => `
            <button class="choice-pill ${option.value === selected ? "is-active" : ""}" type="button" data-choice-name="${escapeAttr(name)}" data-choice-value="${escapeAttr(option.value)}">
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

function renderLiquidityCard(summary = budgetSummary()) {
  const liquidity = liquiditySummary(summary);
  const drift = liquidityDrift(summary);
  return `
    <article class="card wide-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Disponible por lugar</p>
          <h2>Cuenta + efectivo</h2>
        </div>
        <span class="metric-badge">${formatMoney(liquidity.total)} total</span>
      </div>
      <form class="inline-form liquidity-form" id="liquidity-form">
        <label>
          En cuenta
          <input name="account" type="number" min="0" step="1000" value="${liquidity.account}">
        </label>
        <label>
          En efectivo
          <input name="cash" type="number" min="0" step="1000" value="${liquidity.cash}">
        </label>
        <button class="btn secondary" type="submit">Actualizar disponible</button>
      </form>
      ${
        drift.amount
          ? `<div class="menu-notice">
              El saldo real esta ${drift.amount > 0 ? "por encima" : "por debajo"} de lo que explican el presupuesto y los gastos por ${formatMoney(Math.abs(drift.amount))}.
              <button class="btn ghost" type="button" data-action="reconcile-liquidity">Ajustar saldo real</button>
            </div>`
          : ""
      }
    </article>
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
  return `
    <section class="content-grid movements-grid">
      <article class="card wide-card movements-card">
        <div class="card-heading movements-heading">
          <div>
            <p class="eyebrow">Historial</p>
            <h2>Movimientos del periodo</h2>
          </div>
          <span class="metric-badge">${transactionsForSummary(summary).length} gastos</span>
        </div>
        <label class="history-sort">
          Ordenar por
          <select id="transaction-history-sort">
            <option value="recent" ${transactionHistorySort === "recent" ? "selected" : ""}>Mas recientes</option>
            <option value="amount" ${transactionHistorySort === "amount" ? "selected" : ""}>Mayor cantidad gastada</option>
          </select>
        </label>
        ${renderTransactionHistory(summary, transactionHistorySort)}
      </article>
    </section>
  `;
}

function renderTransactionHistory(summary = budgetSummary(), sort = "recent") {
  const transactions = transactionsForSummary(summary)
    .slice()
    .sort((a, b) =>
      sort === "amount"
        ? Number(b.amount || 0) - Number(a.amount || 0) || compareTransactionsByRecent(a, b)
        : compareTransactionsByRecent(a, b)
    );

  if (!transactions.length) {
    return `<div class="empty-state">Todavia no hay gastos registrados en este periodo.</div>`;
  }

  return `
    <div class="transaction-history">
      ${transactions
        .map(
          (transaction) => `
            <div class="history-row">
              <div>
                <strong>${escapeHtml(transaction.merchant)}</strong>
                ${transaction.description ? `<span>${escapeHtml(transaction.description)}</span>` : ""}
                <span>${formatMoney(transaction.amount)} · ${escapeHtml(categoryName(transaction.category))} · ${locationLabel(transaction.source)} · ${formatDate(transaction.date)}</span>
              </div>
              <button class="btn ghost" type="button" data-action="remove-transaction" data-id="${escapeAttr(transaction.id)}">Eliminar</button>
            </div>
          `
        )
        .join("")}
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
  const anxietyTone = state.profile.financialAnxiety >= 7 ? "Revision suave" : "Revision estandar";
  const monthlyIncome = getMonthlyIncome(state.profile);

  return `
    <section class="content-grid profile-grid">
      ${renderAccountPanel()}

      <article class="card">
        <p class="eyebrow">Tus datos</p>
        <h2>${escapeHtml(state.profile.name)}</h2>
        <p>${anxietyTone}. Patron dominante: ${script.name.toLowerCase()}.</p>
        <div class="score-grid">
          <div>
            <strong>${state.profile.selfEfficacy}/10</strong>
            <span>Autoeficacia</span>
          </div>
          <div>
            <strong>${state.profile.financialAnxiety}/10</strong>
            <span>Ansiedad</span>
          </div>
        </div>
        <button class="btn primary" type="button" data-action="open-diagnosis">Editar datos</button>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Patrones de dinero</p>
            <h2>Patrones que guian decisiones</h2>
          </div>
        </div>
        <div class="script-bars">
          ${Object.entries(state.profile.moneyScripts)
            .map(([key, value]) => renderScriptBar(key, value))
            .join("")}
        </div>
      </article>

      <article class="card">
        <p class="eyebrow">Orientacion mensual</p>
        <h2>${formatMoney(monthlyIncome)} / mes</h2>
        ${renderAllocation("Ahorro proyectado", plan.savings, "savings")}
        ${renderAllocation("Resto para gastos", plan.expenses, "expenses")}
        <p class="helper-text">Es una simulacion; no modifica tu presupuesto ni tus saldos.</p>
      </article>

      <article class="card">
        <p class="eyebrow">Respaldo</p>
        <h2>Tus datos locales</h2>
        <p>La informacion queda guardada en este navegador. Puedes exportarla como JSON o restaurar un respaldo.</p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-action="export-data">Exportar</button>
          <label class="btn ghost file-btn">
            Importar
            <input id="import-file" type="file" accept="application/json">
          </label>
          <button class="btn danger" type="button" data-action="reset-demo">Reiniciar</button>
        </div>
        ${renderBackupTools()}
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Avances</p>
            <h2>Lo que ya hiciste</h2>
          </div>
          <span class="metric-badge">${state.wins.length}</span>
        </div>
        <div class="wins-list">
          ${state.wins
            .slice()
            .reverse()
            .slice(0, 6)
            .map((win) => `<div><strong>${formatDate(win.date)}</strong><span>${escapeHtml(win.text)}</span></div>`)
            .join("")}
        </div>
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

function renderBackupTools() {
  const backup = latestLocalBackup();
  if (!backup) {
    return `<p class="helper-text">Los respaldos automaticos aparecen aqui despues de importar o reiniciar.</p>`;
  }

  return `
    <div class="backup-tools">
      <p class="helper-text">
        Ultimo respaldo: ${formatDate(String(backup.created_at).slice(0, 10))}.
        ${backup.counts?.transactions || 0} gastos, ${backup.counts?.fields || 0} campos.
      </p>
      <button class="btn ghost" type="button" data-action="restore-latest-backup">Restaurar respaldo</button>
    </div>
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

  return `
    <div class="modal-backdrop onboarding-backdrop" role="presentation">
      <section class="modal onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" data-onboarding-step="1">
        <div class="onboarding-progress" aria-label="Paso 1 de 3">
          <span class="is-active"></span><span></span><span></span>
        </div>
        <form id="onboarding-form" class="onboarding-form" novalidate>
          <section class="onboarding-step is-active" data-step="1">
            <p class="eyebrow">Paso 1 de 3</p>
            <h2 id="onboarding-title">¿Cuanto recibes y cada cuanto?</h2>
            <p>Con esto calculamos el dinero libre del periodo.</p>
            <label>
              Frecuencia
              <select name="incomeCadence">
                ${renderIncomeCadenceOptions(profile.incomeCadence)}
              </select>
            </label>
            <label>
              Presupuesto por periodo
              <input name="incomeAmount" type="number" min="1" step="1000" inputmode="numeric" value="${getPeriodIncome(profile)}" required>
            </label>
            <input name="periodStart" type="hidden" value="${escapeAttr(profile.periodStart || monthStartKey())}">
          </section>

          <section class="onboarding-step" data-step="2">
            <p class="eyebrow">Paso 2 de 3</p>
            <h2>¿Donde tienes ese dinero?</h2>
            <p>Cuenta y efectivo deben sumar el presupuesto del periodo.</p>
            <div class="onboarding-balance-grid">
              <label>
                En cuenta
                <input name="account" type="number" min="0" step="1000" inputmode="numeric" value="${liquidity.account}" required>
              </label>
              <label>
                En efectivo
                <input name="cash" type="number" min="0" step="1000" inputmode="numeric" value="${liquidity.cash}" required>
              </label>
            </div>
            <small class="balance-hint" data-onboarding-balance></small>
          </section>

          <section class="onboarding-step" data-step="3">
            <p class="eyebrow">Paso 3 de 3</p>
            <h2>¿Para que separas plata normalmente?</h2>
            <p>Agrega montos solo a los campos que quieras usar. Puedes editarlos despues.</p>
            <div class="onboarding-categories">
              ${renderOnboardingCategoryRow(0, { example: true })}
            </div>
            <div class="onboarding-add-category">
              <span>Añadir otro campo</span>
              <button class="icon-btn onboarding-category-add" type="button" data-add-onboarding-category aria-label="Añadir otro campo" title="Añadir otro campo">+</button>
            </div>
          </section>

          <p class="form-error onboarding-error" role="alert" aria-live="assertive"></p>
          <div class="onboarding-actions">
            <button class="btn ghost onboarding-back" type="button" data-onboarding-back hidden>Atras</button>
            <button class="btn primary onboarding-next" type="button" data-onboarding-next>Continuar</button>
            <button class="btn primary onboarding-finish" type="submit" hidden>Ver mi dinero libre</button>
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
            <button class="btn primary" type="button" data-diagnosis-save>Guardar plan</button>
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
            <button class="btn primary" type="button" data-diagnosis-save>Guardar y usar mi plan</button>
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
  const percent = clamp(Number(draft.savingsPercent ?? 50), 0, 100);
  const savingsAmount = Math.round(Number(draft.amount || 0) * percent / 100);
  const freeAmount = Number(draft.amount || 0) - savingsAmount;
  const target = savingsAllocationTarget();

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="extra-allocation-title">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">Dinero extra</p>
            <h2 id="extra-allocation-title">Asignar antes de sumar</h2>
          </div>
          <button class="icon-btn" type="button" data-action="cancel-extra-allocation" aria-label="Cerrar">x</button>
        </div>
        <p>
          ${escapeHtml(draft.source)} suma ${formatMoney(draft.amount)} en ${locationLabel(draft.location)}.
          Sugerencia: separar una parte para ${escapeHtml(target.label)} y dejar el resto libre.
        </p>
        <form class="stacked-form" id="extra-allocation-form">
          <label>
            Porcentaje para ${escapeHtml(target.label)}
            <input name="savingsPercent" type="range" min="0" max="100" step="5" value="${percent}" data-extra-allocation-range>
          </label>
          <div class="allocation-preview" aria-live="polite">
            <div>
              <strong data-allocation-savings>${formatMoney(savingsAmount)}</strong>
              <span>${escapeHtml(target.label)}</span>
            </div>
            <div>
              <strong data-allocation-free>${formatMoney(freeAmount)}</strong>
              <span>Libre</span>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-action="extra-all-free">Dejar todo libre</button>
            <button class="btn primary" type="submit">Aplicar asignacion</button>
          </div>
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
      group.querySelectorAll("[data-choice-value]").forEach((choice) => choice.classList.toggle("is-active", choice === button));
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
      state.lastAlert = transaction.labeled
        ? `${transaction.merchant} ahora tiene trabajo asignado.`
        : "Ese movimiento sigue pendiente de categoria.";
      saveState();
      render();
    });
  });

  const onboardingForm = document.querySelector("#onboarding-form");
  if (onboardingForm) {
    bindOnboardingFlow(onboardingForm);
    onboardingForm.addEventListener("submit", handleOnboardingSubmit);
  }

  const diagnosisForm = document.querySelector("#diagnosis-form");
  if (diagnosisForm) {
    bindDiagnosisPreview(diagnosisForm);
    diagnosisForm.addEventListener("submit", handleDiagnosisSubmit);
    document.querySelectorAll("[data-diagnosis-save]").forEach((button) => {
      button.addEventListener("click", () => submitDiagnosisForm(diagnosisForm));
    });
  }

  const budgetForm = document.querySelector("#budget-job-form");
  if (budgetForm) {
    budgetForm.addEventListener("submit", handleBudgetSubmit);
  }

  const extraBudgetForm = document.querySelector("#extra-budget-form");
  if (extraBudgetForm) {
    extraBudgetForm.addEventListener("submit", handleExtraBudgetSubmit);
  }

  const liquidityForm = document.querySelector("#liquidity-form");
  if (liquidityForm) {
    liquidityForm.addEventListener("submit", handleLiquiditySubmit);
  }

  const transactionForm = document.querySelector("#transaction-form");
  if (transactionForm) {
    transactionForm.addEventListener("submit", handleTransactionSubmit);
  }

  const extraAllocationForm = document.querySelector("#extra-allocation-form");
  if (extraAllocationForm) {
    bindExtraAllocationPreview(extraAllocationForm);
    extraAllocationForm.addEventListener("submit", handleExtraAllocationSubmit);
  }

  const smartForm = document.querySelector("#smart-form");
  if (smartForm) {
    smartForm.addEventListener("submit", handleSmartSubmit);
  }

  const cloudLoginForm = document.querySelector("#cloud-login-form");
  if (cloudLoginForm) {
    cloudLoginForm.addEventListener("submit", handleCloudLoginSubmit);
  }

  const historySort = document.querySelector("#transaction-history-sort");
  if (historySort) {
    historySort.addEventListener("change", () => {
      transactionHistorySort = historySort.value === "amount" ? "amount" : "recent";
      render();
    });
  }

  const importFile = document.querySelector("#import-file");
  if (importFile) {
    importFile.addEventListener("change", handleImport);
  }
}

function bindOnboardingFlow(form) {
  const modal = form.closest("[data-onboarding-step]");
  const error = form.querySelector(".onboarding-error");
  const nextButton = form.querySelector("[data-onboarding-next]");
  const backButton = form.querySelector("[data-onboarding-back]");
  const finishButton = form.querySelector(".onboarding-finish");
  const balanceHint = form.querySelector("[data-onboarding-balance]");
  const categoryList = form.querySelector(".onboarding-categories");
  const addCategoryButton = form.querySelector("[data-add-onboarding-category]");

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
    backButton.hidden = step === 1;
    nextButton.hidden = step === 3;
    finishButton.hidden = step !== 3;
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
    "open-diagnosis",
    "close-diagnosis",
    "cancel-extra-allocation",
    "export-data"
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
    "remove-transaction": () => removeTransaction(id),
    "undo-snackbar": () => {
      removeTransaction(id);
      clearSnackbar({ renderNow: false });
    },
    "remove-extra": () => removeBudgetExtra(id),
    "clear-period-extras": clearCurrentPeriodExtras,
    "reconcile-liquidity": reconcileLiquidity,
    "extra-all-free": () => applyPendingExtraAllocation(0),
    "cancel-extra-allocation": () => {
      pendingExtraAllocation = null;
      state.lastAlert = "Dinero extra sin guardar.";
    },
    "cancel-cooldown": () => cancelCooldown(id),
    "unlock-cooldown": () => unlockCooldown(id),
    "push-cloud-now": () => pushCloudState(),
    "pull-cloud-now": () => pullCloudAfterLogin(),
    "cloud-sign-out": () => handleCloudSignOut(),
    "export-data": exportData,
    "restore-latest-backup": restoreLatestBackup,
    "reset-demo": resetDemo
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
  if (semesterBudget > summary.freeRemaining) {
    state.lastAlert = `${name} reservaria ${formatMoney(semesterBudget)}, pero solo hay ${formatMoney(summary.freeRemaining)} libre.`;
    showNoticeSnackbar(state.lastAlert, { kind: "error", renderNow: false });
    saveState();
    render();
    return;
  }

  state.budgetJobs.push(job);
  state.lastAlert = `${name} reserva ${formatMoney(semesterBudget)} del periodo ${budgetSummary().cadenceLabel}.`;
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
    savingsPercent: 50
  };
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

function handleLiquiditySubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.liquidity = {
    account: numberFrom(data.get("account")),
    cash: numberFrom(data.get("cash")),
    initialized: true,
    updated_at: new Date().toISOString()
  };
  state.lastAlert = `Disponible actualizado: ${formatMoney(state.liquidity.account + state.liquidity.cash)} en total.`;
  saveState();
  render();
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
  const source = normalizeLocation(data.get("source"));
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
    const transaction = addTransaction({ merchant, description, amount, category, budgeted, source });
    state.lastAlert = createSpendAlert(category);
    showUndoSnackbar(transaction.id);
  }

  closeQuickExpense();
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

async function handleCloudLoginSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const email = cleanText(data.get("email"), "");
  const password = String(data.get("password") || "");
  const mode = event.submitter?.dataset.cloudMode || "signin";

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
  try {
    await saveCloudState(getCloudPayload());
    await signOutFromCloud();
    clearLocalUserState();
    cloudState.signedIn = false;
    cloudState.email = "";
    cloudState.sessionReady = true;
    cloudState.status = "signed-out";
  } catch (error) {
    cloudState.sessionReady = true;
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
  }
  render();
}

function clearLocalUserState() {
  clearTimeout(cloudSaveTimer);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BACKUP_KEY);
  state = createDefaultState();
  state.activeView = DEFAULT_VIEW;
  menuOpen = false;
  quickExpenseOpen = false;
  pendingExtraAllocation = null;
  clearSnackbar({ renderNow: false });
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!window.confirm("Importar este JSON reemplazara los datos actuales de este navegador. ¿Quieres continuar?")) {
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("El archivo no contiene datos de la app.");
      }
      saveLocalBackup("antes de importar JSON");
      state = migrateState(parsed);
      pendingExtraAllocation = null;
      clearSnackbar({ renderNow: false });
      state.lastAlert = "Datos importados correctamente.";
      saveState();
      render();
    } catch {
      state.lastAlert = "No pude importar ese archivo. Revisa que sea un JSON exportado desde esta app.";
      render();
    }
    event.target.value = "";
  });
  reader.readAsText(file);
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

function removeBudgetJob(id) {
  state.budgetJobs = state.budgetJobs.filter((job) => job.id !== id);
  state.transactions.forEach((transaction) => {
    if (transaction.category === id) {
      transaction.category = "";
      transaction.labeled = false;
    }
  });
  state.lastAlert = "Categoria eliminada. Sus gastos vuelven a revision.";
}

function removeTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  state.transactions = state.transactions.filter((item) => item.id !== id);
  if (transaction && state.liquidity?.initialized) {
    adjustLiquidity(transaction.source, Number(transaction.amount || 0), "refund");
  }
  state.lastAlert = transaction
    ? `${transaction.merchant} eliminado. La categoria se recalculo.`
    : "Gasto eliminado.";
}

function shouldClearTemplateBudgetOnPlanSave() {
  return state.meta?.budgetPreset !== "student" && isTemplateBudgetJobs(state.budgetJobs);
}

function clearTemplateBudget(target = state) {
  const templateIds = new Set(STUDENT_BUDGET_JOBS.map((job) => job.id));
  target.budgetJobs = [];
  target.cooldowns = (target.cooldowns || []).filter((cooldown) => !templateIds.has(cooldown.category));
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
  if (extra && state.liquidity?.initialized) {
    adjustLiquidity(extra.location, -Number(extra.amount || 0), "remove-extra");
  }
  if (extra?.allocation?.savingsJobId && Number(extra.allocation.savingsAmount || 0) > 0) {
    reduceSavingsAllocation(extra.allocation.savingsJobId, Number(extra.allocation.savingsAmount || 0));
  }
  state.lastAlert = extra ? `${extra.source} ya no suma al presupuesto.` : "Dinero extra eliminado.";
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
    if (state.liquidity?.initialized) {
      adjustLiquidity(extra.location, -Number(extra.amount || 0), "remove-extra");
    }
    if (extra?.allocation?.savingsJobId && Number(extra.allocation.savingsAmount || 0) > 0) {
      reduceSavingsAllocation(extra.allocation.savingsJobId, Number(extra.allocation.savingsAmount || 0));
    }
  });
  state.budgetExtras = state.budgetExtras.filter((extra) => !ids.has(extra.id));
  state.lastAlert = `Quite ${formatMoney(total)} de dinero extra del periodo.`;
}

function reconcileLiquidity() {
  const drift = liquidityDrift();
  if (!drift.amount) {
    state.lastAlert = "El saldo real ya cuadra con presupuesto y gastos.";
    return;
  }

  if (
    typeof window.confirm === "function" &&
    !window.confirm(`Ajustar saldo real de ${formatMoney(drift.actual)} a ${formatMoney(drift.expected)}?`)
  ) {
    state.lastAlert = "No ajuste el saldo real.";
    return;
  }

  const liquidity = normalizeLiquidity(state.liquidity);
  if (drift.amount > 0) {
    let remaining = drift.amount;
    const fromAccount = Math.min(liquidity.account, remaining);
    liquidity.account -= fromAccount;
    remaining -= fromAccount;
    liquidity.cash = Math.max(0, liquidity.cash - remaining);
  } else {
    liquidity.account += Math.abs(drift.amount);
  }

  liquidity.initialized = true;
  liquidity.updated_at = new Date().toISOString();
  state.liquidity = liquidity;
  state.lastAlert = `Saldo real ajustado a ${formatMoney(drift.expected)}.`;
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

function exportData() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `finanzas-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.lastAlert = "Archivo JSON exportado.";
}

function resetDemo() {
  saveLocalBackup("antes de reiniciar");
  pendingExtraAllocation = null;
  clearSnackbar({ renderNow: false });
  localStorage.removeItem(STORAGE_KEY);
  state = createDefaultState();
  state.lastAlert = "Demo reiniciada. Usa Mis datos para personalizarla.";
}

function addTransaction({ merchant, description = "", amount, category, budgeted, source = "account" }) {
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
    source: location,
    updated_at: now
  };
  state.transactions.push(transaction);
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

function expectedLiquidityTotal(summary = budgetSummary()) {
  const spent = transactionsForSummary(summary).reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  return Math.max(0, summary.income - spent);
}

function liquidityDrift(summary = budgetSummary()) {
  const liquidity = liquiditySummary(summary);
  const expected = expectedLiquidityTotal(summary);
  const actual = liquidity.total;
  const amount = Math.round(actual - expected);
  return {
    actual,
    expected,
    amount: Math.abs(amount) >= 1 ? amount : 0
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
    registrar: "spending",
    gastos: "spending",
    movimientos: "movements",
    historial: "movements",
    datos: "profile",
    cuenta: "profile",
    profile: "profile"
  };
  const view = aliases[rawHash] || rawHash;
  return NAV_ITEMS.some((item) => item.id === view) ? view : fallback;
}

function activateView(view) {
  if (!NAV_ITEMS.some((item) => item.id === view)) {
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
    source: normalizeLocation(transaction.source),
    updated_at: transaction.updated_at || transaction.createdAt || transaction.date || ""
  }));
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

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: state.profile.currency || "COP",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
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
