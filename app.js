import {
  EMERGENCY_BASELINE,
  FREE_CATEGORY_ID,
  LARGE_PURCHASE_RATIO,
  budgetAmountForJob as getBudgetAmountForJob,
  budgetSummary as getBudgetSummary,
  calculatePlan as calculateFinancePlan,
  categoryStatus as getCategoryStatus,
  getPeriodIncome,
  minimumDebtPayments as getMinimumDebtPayments,
  getMonthlyIncome,
  monthlyLabeledSpend as getMonthlyLabeledSpend,
  shouldUseDebtExposureMode as getShouldUseDebtExposureMode,
  sortedDebts as getSortedDebts,
  spendByCategory as getSpendByCategory,
  totalDebt as getTotalDebt
} from "./finance-core.js";
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
} from "./sync-client.js";

const STORAGE_KEY = "finanzas-conductuales:v1";
const DEFAULT_VIEW = "spending";
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
  { id: "spending", label: "Registrar gasto", icon: "01" },
  { id: "today", label: "Inicio", icon: "02" },
  { id: "budget", label: "Plan", icon: "03" },
  { id: "savings", label: "Ahorro", icon: "04" },
  { id: "debt", label: "Deudas", icon: "05" },
  { id: "profile", label: "Datos", icon: "06" }
];

const app = document.querySelector("#app");
let state = loadState();
state.activeView = viewFromHash(DEFAULT_VIEW);
let menuOpen = false;
let applyingCloudState = false;
let cloudSaveTimer;
let authUnsubscribe = () => {};
let cloudState = {
  configured: isCloudConfigured(),
  email: "",
  error: "",
  libraryLoaded: isCloudLibraryLoaded(),
  signedIn: false,
  status: isCloudConfigured() ? "checking" : "local"
};

render();
initializeCloudSync();
window.addEventListener("hashchange", () => {
  const nextView = viewFromHash(DEFAULT_VIEW);
  if (nextView !== state.activeView) {
    state.activeView = nextView;
    menuOpen = false;
    saveState({ sync: false });
    render();
  }
});

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

function createDefaultState() {
  const today = todayKey();

  return {
    activeView: DEFAULT_VIEW,
    showDiagnosis: false,
    lastAlert: "Registra cada gasto en menos de un minuto. Usa Mis datos para ajustar tus numeros reales.",
    meta: {
      updatedAt: new Date().toISOString(),
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
      }
    },
    settings: {
      emergencyAutoDefault: true,
      smartEscalator: true,
      revealDebtTotal: false,
      monthlyRaisePct: 8,
      escalationPct: 50
    },
    budgetExtras: [],
    liquidity: {
      account: 0,
      cash: 0,
      initialized: false
    },
    budgetJobs: [],
    debts: [],
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
    ...savedState,
    meta: { ...defaults.meta, ...(savedState.meta || {}) },
    profile: { ...defaults.profile, ...(savedState.profile || {}) },
    settings: { ...defaults.settings, ...(savedState.settings || {}) },
    debts: savedState.debts || defaults.debts,
    transactions: savedState.transactions || defaults.transactions,
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
  const { sync = true } = options;
  state.meta = {
    ...(state.meta || {}),
    updatedAt: new Date().toISOString(),
    cloudUserEmail: cloudState.email || state.meta?.cloudUserEmail || ""
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (sync && !applyingCloudState) {
    scheduleCloudSave();
  }
}

async function initializeCloudSync() {
  if (!cloudState.configured) {
    cloudState.status = "local";
    cloudState.error = "Configura Supabase para activar sincronizacion.";
    render();
    return;
  }

  if (!cloudState.libraryLoaded) {
    cloudState.status = "local";
    cloudState.error = "No se pudo cargar la libreria de nube. La app sigue en modo local.";
    render();
    return;
  }

  try {
    const session = await getCloudSession();
    applyCloudSession(session);
    authUnsubscribe = onCloudAuthChange((nextSession) => {
      applyCloudSession(nextSession);
      if (nextSession) {
        pullCloudAfterLogin();
      } else {
        cloudState.status = "signed-out";
        render();
      }
    });

    if (session) {
      await pullCloudAfterLogin();
    } else {
      cloudState.status = "signed-out";
      render();
    }
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
    render();
  }
}

function applyCloudSession(session) {
  cloudState.signedIn = Boolean(session);
  cloudState.email = session?.user?.email || "";
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
  render();

  try {
    const remote = await loadCloudState();
    if (remote?.app_state) {
      applyingCloudState = true;
      state = migrateState(remote.app_state);
      state.showDiagnosis = false;
      activateView(DEFAULT_VIEW);
      state.lastAlert = "Nube sincronizada automaticamente.";
      state.meta = {
        ...(state.meta || {}),
        cloudUpdatedAt: remote.updated_at,
        cloudUserEmail: cloudState.email
      };
      saveState({ sync: false });
      applyingCloudState = false;
      cloudState.status = "synced";
      render();
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
    render();
  } catch (error) {
    applyingCloudState = false;
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
    render();
  }
}

function scheduleCloudSave() {
  if (!cloudState.signedIn || cloudState.status === "syncing") {
    return;
  }
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushCloudState, 800);
}

async function pushCloudState() {
  if (!cloudState.signedIn) {
    return;
  }

  cloudState.status = "syncing";
  render();

  try {
    const saved = await saveCloudState(getCloudPayload());
    state.meta = {
      ...(state.meta || {}),
      cloudUpdatedAt: saved?.updated_at || new Date().toISOString(),
      cloudUserEmail: cloudState.email
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    cloudState.status = "synced";
    cloudState.error = "";
    render();
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
    render();
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

function render() {
  const plan = calculatePlan();
  app.classList.toggle("is-menu-open", menuOpen);
  app.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-head">
        <a class="brand" href="#" data-action="go-spending" aria-label="Ir a registrar gasto">
          <span class="brand-mark">FC</span>
          <span>
            <strong>Finanzas Conductuales</strong>
            <small>Tu dinero en 5 minutos</small>
          </span>
        </a>
        <button class="menu-toggle" type="button" data-action="toggle-menu" aria-expanded="${menuOpen}" aria-controls="main-menu">
          <span class="menu-bars" aria-hidden="true"></span>
          <span>Menu</span>
        </button>
      </div>
      ${renderHeader(plan)}
      <div class="nav-panel ${menuOpen ? "is-open" : ""}" id="main-menu" aria-hidden="${!menuOpen}">
        <nav class="nav-list" aria-label="Secciones principales">
          ${NAV_ITEMS.map((item) => renderNavItem(item)).join("")}
        </nav>
        <div class="menu-tools">
          ${renderCloudStatus()}
          <button class="btn primary" type="button" data-action="open-diagnosis">Mis datos</button>
          ${state.lastAlert ? `<div class="menu-notice" role="status">${escapeHtml(state.lastAlert)}</div>` : ""}
        </div>
      </div>
      <div class="sidebar-meter">
        <span>Buffer base</span>
        <strong>${Math.round(plan.emergencyProgress)}%</strong>
        <div class="mini-track">
          <span style="width:${clamp(plan.emergencyProgress, 0, 100)}%"></span>
        </div>
      </div>
    </aside>
    <main class="main-panel">
      ${renderView(plan)}
    </main>
    ${state.showDiagnosis ? renderDiagnosisModal() : ""}
  `;

  bindEvents();
}

function renderNavItem(item) {
  const active = state.activeView === item.id ? "is-active" : "";
  const primary = item.id === DEFAULT_VIEW ? "is-primary" : "";
  return `
    <button class="nav-item ${active} ${primary}" type="button" data-view="${item.id}" tabindex="${menuOpen ? "0" : "-1"}">
      <span class="nav-number">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `;
}

function renderHeader(plan) {
  const summary = budgetSummary();
  const liquidity = liquiditySummary(summary);
  const visibleFree = liquidity.initialized ? liquidity.total : summary.freeRemaining;

  return `
    <header class="money-bar ${summary.overReserved ? "danger" : ""}" role="status" aria-label="Dinero libre del periodo">
      <span>Libre ${summary.cadenceLabel}</span>
      <strong>${formatMoney(visibleFree)}</strong>
      <span>${summary.overReserved ? "sobreasignado" : "sin asignar"}</span>
      <span class="money-split">Cuenta ${formatMoney(liquidity.account)} · Efectivo ${formatMoney(liquidity.cash)}</span>
    </header>
  `;
}

function renderCloudStatus() {
  if (!cloudState.configured) {
    return `<span class="status-pill cloud-status"><strong>Local</strong> sin nube</span>`;
  }
  if (cloudState.status === "checking") {
    return `<span class="status-pill cloud-status"><strong>Nube</strong> revisando</span>`;
  }
  if (!cloudState.signedIn) {
    return `<span class="status-pill cloud-status"><strong>Nube</strong> sin sesion</span>`;
  }
  if (cloudState.status === "syncing") {
    return `<span class="status-pill cloud-status"><strong>Nube</strong> sincronizando</span>`;
  }
  if (cloudState.status === "error") {
    return `<span class="status-pill cloud-status danger"><strong>Nube</strong> error</span>`;
  }
  return `<span class="status-pill cloud-status"><strong>Nube</strong> al dia</span>`;
}

function renderView(plan) {
  const views = {
    today: renderToday,
    budget: renderBudget,
    debt: renderDebt,
    savings: renderSavings,
    spending: renderSpending,
    profile: renderProfile
  };
  return views[state.activeView](plan);
}

function getPrimaryAction(plan, unlabeled, checkinDone) {
  if (!state.profile.completed) {
    return {
      title: "Pon tus datos reales",
      copy: "La app esta usando un ejemplo. Con tus ingresos, deudas y ahorro cambia todo el plan.",
      badge: "Primer paso",
      button: "Empezar",
      action: "open-diagnosis"
    };
  }

  if (cloudState.configured && !cloudState.signedIn) {
    return {
      title: "Inicia sesion para sincronizar",
      copy: "Asi tus datos se bajan automaticamente en el celular despues de iniciar sesion.",
      badge: "Nube",
      button: "Ir a Datos",
      view: "profile"
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

  if (plan.emergencyGap > 0) {
    return {
      title: "Sube tu fondo inicial",
      copy: `Faltan ${formatMoney(plan.emergencyGap)} para completar la primera meta de emergencia.`,
      badge: "Ahorro",
      button: "Ver ahorro",
      view: "savings"
    };
  }

  const debt = sortedDebts()[0];
  if (debt) {
    return {
      title: `Paga ${debt.name}`,
      copy: `La cuenta mas pequena va primero. Pago minimo: ${formatMoney(debt.minimum)}.`,
      badge: "Deuda",
      button: "Ver deudas",
      view: "debt"
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
  const today = todayKey();
  const unlabeled = state.transactions.filter((transaction) => !transaction.labeled);
  const unlabeledToday = state.transactions.filter((transaction) => transaction.date === today && !transaction.labeled);
  const checkinDone = state.checkins.includes(today);
  const script = dominantMoneyScript();
  const primaryAction = getPrimaryAction(plan, unlabeled, checkinDone);

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
          Reserva sugerida dia ${dayFiveSweepDay()}: ${formatMoney(plan.dayFiveSweep)}.
        </p>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Pago recomendado</p>
            <h2>${nextDebtAction().title}</h2>
          </div>
          <span class="metric-badge">Paso pequeno</span>
        </div>
        <p>${nextDebtAction().copy}</p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-view="debt">Abrir deudas</button>
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
        <span>${formatMoney(transaction.amount)} · ${formatDate(transaction.date)}</span>
      </div>
      <select data-transaction-category="${transaction.id}" aria-label="Categoria para ${escapeAttr(transaction.merchant)}">
        <option value="">Elegir categoria</option>
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
  const assignmentRatio = summary.income ? (summary.reserved / summary.income) * 100 : 0;
  const status = summary.overReserved ? "over" : summary.freeBudget > 0 ? "under" : "balanced";

  return `
    <section class="content-grid budget-grid">
      <article class="card split-card">
        <div class="budget-ring" style="--debt:${Math.min(360, (summary.reserved / Math.max(1, summary.income)) * 360)}deg; --savings:${Math.min(360, ((summary.reserved + summary.freeSpent) / Math.max(1, summary.income)) * 360)}deg">
          <div>
            <strong>${Math.round(assignmentRatio)}%</strong>
            <span>reservado</span>
          </div>
        </div>
        <div class="split-details">
          <p class="eyebrow">Presupuesto ${summary.cadenceLabel}</p>
          <h2>${formatMoney(summary.income)} por periodo</h2>
          ${renderAllocation("Presupuesto base", summary.baseIncome, "savings")}
          ${renderAllocation("Dinero extra", summary.extraIncome, "expenses")}
          ${renderAllocation("Campos reservados", summary.reserved, "debt")}
          ${renderAllocation("Libre sin asignar", summary.freeBudget, "savings")}
          ${renderAllocation("Libre ya usado", summary.freeSpent, "expenses")}
          <p class="helper-text">Periodo actual: ${formatDate(summary.window.start)} - ${formatDate(previousDay(summary.window.end))}. Equivale a ${formatMoney(getMonthlyIncome(state.profile))} / mes.</p>
        </div>
      </article>

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
  const band = ratio >= 95 ? "danger" : ratio >= 75 ? "warning" : "good";

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

function renderDebt(plan) {
  const sorted = sortedDebts();
  const exposureMode = shouldUseDebtExposureMode();
  const visibleDebts = exposureMode && !state.settings.revealDebtTotal ? sorted.slice(0, 1) : sorted;
  const totalDebt = sorted.reduce((sum, debt) => sum + debt.balance, 0);

  return `
    <section class="content-grid debt-grid">
      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Orden de pago</p>
            <h2>${visibleDebts.length === 1 && sorted.length > 1 ? "Solo el siguiente paso" : "Cuentas por cerrar"}</h2>
          </div>
          <span class="metric-badge">${sorted.length} cuentas</span>
        </div>
        ${
          exposureMode && !state.settings.revealDebtTotal
            ? `<p class="helper-text">Mostramos primero la cuenta mas facil de cerrar.</p>`
            : `<p class="helper-text">Total visible: ${formatMoney(totalDebt)}. La cuenta mas pequena va primero.</p>`
        }
        <div class="molehill-track">
          ${sorted.map((debt, index) => `<span class="${index === 0 ? "next" : ""}">${index + 1}</span>`).join("")}
        </div>
        <div class="debt-list">
          ${visibleDebts.map((debt, index) => renderDebtItem(debt, index)).join("")}
        </div>
        <div class="card-actions">
          ${
            exposureMode
              ? `<button class="btn ghost" type="button" data-action="${state.settings.revealDebtTotal ? "hide-debt" : "reveal-debt"}">${state.settings.revealDebtTotal ? "Volver a paso pequeno" : "Mostrar panorama completo"}</button>`
              : ""
          }
        </div>
      </article>

      <article class="card">
        <p class="eyebrow">Pago sugerido</p>
        <h2>${formatMoney(Math.max(plan.debt, minimumDebtPayments()))}</h2>
        <p>Primero cubre minimos. Lo extra va a la cuenta mas pequena hasta cerrarla.</p>
        <div class="micro-task">
          <strong>Victoria pequena</strong>
          <span>${nextDebtAction().copy}</span>
        </div>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Agregar cuenta</p>
            <h2>Nueva deuda</h2>
          </div>
        </div>
        <form class="stacked-form" id="debt-form">
          <label>
            Nombre
            <input name="name" type="text" maxlength="36" placeholder="Tarjeta, prestamo..." required>
          </label>
          <label>
            Saldo
            <input name="balance" type="number" min="0" step="1000" required>
          </label>
          <label>
            Interes anual %
            <input name="apr" type="number" min="0" max="120" step="0.1" value="24">
          </label>
          <label>
            Pago minimo
            <input name="minimum" type="number" min="0" step="1000" required>
          </label>
          <button class="btn secondary" type="submit">Agregar deuda</button>
        </form>
      </article>
    </section>
  `;
}

function renderDebtItem(debt, index) {
  const isNext = index === 0;
  return `
    <div class="debt-item ${isNext ? "is-next" : ""}">
      <div>
        <span class="eyebrow">${isNext ? "Siguiente cierre" : "Luego"}</span>
        <h3>${escapeHtml(debt.name)}</h3>
        <p>${formatMoney(debt.balance)} · ${debt.apr}% EA · minimo ${formatMoney(debt.minimum)}</p>
      </div>
      <button class="btn ${isNext ? "primary" : "ghost"}" type="button" data-action="pay-debt" data-id="${escapeAttr(debt.id)}">
        Registrar pago
      </button>
    </div>
  `;
}

function renderSavings(plan) {
  const phase = state.profile.emergencySavings < EMERGENCY_BASELINE ? "Fase 1" : "Fase 2";
  const monthsCovered = state.profile.committedExpenses
    ? state.profile.emergencySavings / state.profile.committedExpenses
    : 0;
  const futureRaise = getMonthlyIncome(state.profile) * (state.settings.monthlyRaisePct / 100);
  const escalatedSavings = futureRaise * (state.settings.escalationPct / 100);

  return `
    <section class="content-grid savings-grid">
      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">${phase} · Pagarte primero</p>
            <h2>Buffer que protege ancho de banda</h2>
          </div>
          <span class="metric-badge">${Math.round(monthsCovered * 10) / 10} meses</span>
        </div>
        ${renderProgress(plan.emergencyProgress, "Progreso al buffer base")}
        <div class="phase-grid">
          <div>
            <strong>Meta base</strong>
            <span>${formatMoney(EMERGENCY_BASELINE)}</span>
          </div>
          <div>
            <strong>Barrido dia 5</strong>
            <span>${formatMoney(plan.dayFiveSweep)}</span>
          </div>
          <div>
            <strong>Automatizacion</strong>
            <span>${state.settings.emergencyAutoDefault ? "Activa por defecto" : "Pausada"}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-action="toggle-setting" data-setting="emergencyAutoDefault">
            ${state.settings.emergencyAutoDefault ? "Pausar auto-buffer" : "Activar auto-buffer"}
          </button>
        </div>
      </article>

      <article class="card">
        <p class="eyebrow">Save More Tomorrow</p>
        <h2>${formatMoney(escalatedSavings)} extra</h2>
        <p>Si tus ingresos suben ${state.settings.monthlyRaisePct}%, el ${state.settings.escalationPct}% del aumento se mueve al ahorro antes de volverse gasto.</p>
        <form class="stacked-form" id="smart-form">
          <label>
            Aumento futuro %
            <input name="monthlyRaisePct" type="number" min="0" max="100" value="${state.settings.monthlyRaisePct}">
          </label>
          <label>
            Porcion al ahorro %
            <input name="escalationPct" type="number" min="0" max="100" value="${state.settings.escalationPct}">
          </label>
          <button class="btn secondary" type="submit">Actualizar escalador</button>
        </form>
      </article>

      <article class="card">
        <p class="eyebrow">Interes como libertad</p>
        <h2>${futureFreedom(plan)}</h2>
        <p>El ahorro se entiende mejor cuando se traduce en tiempo y margen de decision.</p>
      </article>
    </section>
  `;
}

function renderSpending(plan) {
  const overBudget = categoryStatus().filter((category) => category.ratio > 100);
  const summary = budgetSummary();
  const liquidity = liquiditySummary(summary);
  const threshold = Math.max(1, summary.income * LARGE_PURCHASE_RATIO);

  return `
    <section class="content-grid spending-grid">
      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Nuevo movimiento</p>
            <h2>Registrar gasto</h2>
          </div>
        </div>
        <form class="stacked-form" id="transaction-form">
          <label>
            Comercio
            <input name="merchant" type="text" maxlength="42" placeholder="Ej. Tienda" required>
          </label>
          <label>
            Monto
            <input name="amount" type="number" min="1000" step="1000" required>
          </label>
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
          <label class="check-row">
            <input name="budgeted" type="checkbox" checked>
            Ya estaba previsto en el plan
          </label>
          <button class="btn primary" type="submit">Guardar gasto</button>
        </form>
      </article>

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
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Gastos registrados</p>
            <h2>Movimientos del periodo</h2>
          </div>
          <span class="metric-badge">${transactionsForSummary(summary).length} gastos</span>
        </div>
        ${renderTransactionHistory(summary)}
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Dinero recibido</p>
            <h2>Sumar al presupuesto</h2>
          </div>
          <span class="metric-badge">${formatMoney(summary.extraIncome)} extra</span>
        </div>
        <p class="helper-text">Suma regalos, bonos o ayudas solo al periodo actual. Tu presupuesto base no cambia.</p>
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
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Nuevo campo</p>
            <h2>Reservar del periodo</h2>
          </div>
          <span class="metric-badge">${formatMoney(summary.freeBudget)} libre</span>
        </div>
        ${renderBudgetJobForm()}
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
    </section>
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

function renderTransactionHistory(summary = budgetSummary()) {
  const transactions = transactionsForSummary(summary)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

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

function renderCooldown(cooldown) {
  const unlocked = new Date(cooldown.unlockAt).getTime() <= Date.now();
  return `
    <div class="cooldown-item">
      <div>
        <strong>${escapeHtml(cooldown.merchant)}</strong>
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
      ${renderCloudPanel()}
      ${renderStudentContextPanel()}

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
        <p class="eyebrow">Resumen mensual</p>
        <h2>${formatMoney(monthlyIncome)} / mes</h2>
        ${renderAllocation("Deuda", plan.debt, "debt")}
        ${renderAllocation("Ahorro", plan.savings, "savings")}
        ${renderAllocation("Gastos", plan.expenses, "expenses")}
      </article>

      <article class="card">
        <p class="eyebrow">Respaldo</p>
        <h2>Tus datos locales</h2>
        <p>La informacion queda guardada en este navegador. Puedes exportarla como JSON.</p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-action="export-data">Exportar</button>
          <label class="btn ghost file-btn">
            Importar
            <input id="import-file" type="file" accept="application/json">
          </label>
          <button class="btn danger" type="button" data-action="reset-demo">Reiniciar</button>
        </div>
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

function renderCloudPanel() {
  if (!cloudState.configured) {
    return `
      <article class="card wide-card cloud-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Sincronizacion</p>
            <h2>Modo local por ahora</h2>
          </div>
          <span class="metric-badge">Falta Supabase</span>
        </div>
        <p>Para que computador y celular compartan datos, configura Supabase en <strong>sync-config.js</strong>. Cuando este activo, iniciar sesion bajara la nube automaticamente.</p>
      </article>
    `;
  }

  if (cloudState.signedIn) {
    return `
      <article class="card wide-card cloud-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Cuenta y nube</p>
            <h2>${escapeHtml(cloudState.email)}</h2>
          </div>
          <span class="metric-badge">${cloudState.status === "syncing" ? "Sincronizando" : "Al dia"}</span>
        </div>
        <p>Cuando guardas cambios, se suben solos. En otro dispositivo solo inicia sesion y la app baja la nube automaticamente.</p>
        ${cloudState.error ? `<p class="form-error">${escapeHtml(cloudState.error)}</p>` : ""}
        <div class="card-actions">
          <button class="btn secondary" type="button" data-action="push-cloud-now">Subir ahora</button>
          <button class="btn ghost" type="button" data-action="pull-cloud-now">Bajar nube</button>
          <button class="btn danger" type="button" data-action="cloud-sign-out">Cerrar sesion</button>
        </div>
      </article>
    `;
  }

  return `
    <article class="card wide-card cloud-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">Cuenta y nube</p>
          <h2>Inicia sesion</h2>
        </div>
        <span class="metric-badge">Auto-sync</span>
      </div>
      <p>Despues de iniciar sesion, la app descarga tu nube automaticamente. Si es tu primer dispositivo, sube tu plan actual.</p>
      ${cloudState.error ? `<p class="form-error">${escapeHtml(cloudState.error)}</p>` : ""}
      <form class="inline-form cloud-form" id="cloud-login-form">
        <label>
          Correo
          <input name="email" type="email" autocomplete="email" placeholder="tu@email.com" required>
        </label>
        <label>
          Contrasena
          <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Minimo 6 caracteres" required>
        </label>
        <div class="cloud-form-actions">
          <button class="btn primary" type="submit" data-cloud-mode="signin">Iniciar sesion</button>
          <button class="btn ghost" type="submit" data-cloud-mode="signup">Crear cuenta</button>
        </div>
      </form>
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

function renderDiagnosisModal() {
  const profile = state.profile;

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
        <form id="diagnosis-form" class="diagnosis-form" novalidate>
          <fieldset>
            <legend>Datos principales</legend>
            <label>
              Nombre del plan
              <input name="name" type="text" maxlength="32" value="${escapeAttr(profile.name)}" required>
            </label>
            <label>
              Cada cuanto recibes presupuesto
              <select name="incomeCadence">
                ${renderIncomeCadenceOptions(profile.incomeCadence)}
              </select>
            </label>
            <label>
              Presupuesto por periodo
              <input name="incomeAmount" type="number" min="0" step="1000" value="${getPeriodIncome(profile)}" required>
            </label>
            <label>
              Inicio del periodo actual
              <input name="periodStart" type="date" value="${escapeAttr(profile.periodStart || profile.semesterStart || monthStartKey())}" required>
            </label>
            <label>
              Ingreso mensual equivalente
              <input name="monthlyIncome" type="number" min="0" step="1000" value="${getMonthlyIncome(profile)}" readonly>
            </label>
            <label>
              Gastos comprometidos
              <input name="committedExpenses" type="number" min="0" step="1000" value="${profile.committedExpenses}" required>
            </label>
            <label>
              Ahorro disponible
              <input name="emergencySavings" type="number" min="0" step="1000" value="${profile.emergencySavings}" required>
            </label>
            <label>
              Deuda total estimada
              <input name="totalDebt" type="number" min="0" step="1000" value="${totalDebt()}" required>
            </label>
            <label>
              Dia de pago principal
              <input name="payday" type="number" min="0" max="28" inputmode="numeric" value="${profile.payday}">
              <small>Usa 0 si no tienes un dia fijo.</small>
            </label>
          </fieldset>

          <div class="modal-actions quick-save-actions">
            <button class="btn primary" type="submit">Guardar plan</button>
          </div>

          <fieldset>
            <legend>Tipo de ingreso</legend>
            <label>
              Frecuencia
              <select name="incomeType">
                <option value="fixed" ${profile.incomeType === "fixed" ? "selected" : ""}>Fijo</option>
                <option value="variable" ${profile.incomeType === "variable" ? "selected" : ""}>Variable / freelance</option>
              </select>
            </label>
            <label>
              Volatilidad
              <select name="volatility">
                <option value="low" ${profile.volatility === "low" ? "selected" : ""}>Baja</option>
                <option value="medium" ${profile.volatility === "medium" ? "selected" : ""}>Media</option>
                <option value="high" ${profile.volatility === "high" ? "selected" : ""}>Alta</option>
              </select>
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
      <select name="${key}">
        ${[1, 2, 3, 4, 5]
          .map((score) => `<option value="${score}" ${score === Number(value) ? "selected" : ""}>${score}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function renderCategoryBars(plan, limit) {
  const categories = categoryStatus()
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);

  return `
    <div class="category-bars">
      ${categories
        .map(
          (category) => {
            const lastTransaction = lastTransactionForCategory(category.id);
            return `
            <div class="category-row">
              <div>
                <strong>${escapeHtml(category.name)}</strong>
                <span>${formatMoney(category.spent)} de ${formatMoney(category.budget)}</span>
              </div>
              <div class="bar ${category.band}">
                <span style="width:${clamp(category.ratio, 0, 120)}%"></span>
              </div>
              ${
                lastTransaction
                  ? `<button class="btn ghost" type="button" data-action="remove-transaction" data-id="${escapeAttr(lastTransaction.id)}">Deshacer ultimo</button>`
                  : ""
              }
            </div>
          `;
          }
        )
        .join("")}
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
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activateView(button.dataset.view);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleAction);
  });

  document.querySelectorAll("[data-transaction-category]").forEach((select) => {
    select.addEventListener("change", () => {
      const transaction = state.transactions.find((item) => item.id === select.dataset.transactionCategory);
      if (!transaction) {
        return;
      }
      transaction.category = select.value;
      transaction.labeled = Boolean(select.value);
      state.lastAlert = transaction.labeled
        ? `${transaction.merchant} ahora tiene trabajo asignado.`
        : "Ese movimiento sigue pendiente de categoria.";
      saveState();
      render();
    });
  });

  const diagnosisForm = document.querySelector("#diagnosis-form");
  if (diagnosisForm) {
    bindDiagnosisPreview(diagnosisForm);
    diagnosisForm.addEventListener("submit", handleDiagnosisSubmit);
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

  const debtForm = document.querySelector("#debt-form");
  if (debtForm) {
    debtForm.addEventListener("submit", handleDebtSubmit);
  }

  const transactionForm = document.querySelector("#transaction-form");
  if (transactionForm) {
    transactionForm.addEventListener("submit", handleTransactionSubmit);
  }

  const smartForm = document.querySelector("#smart-form");
  if (smartForm) {
    smartForm.addEventListener("submit", handleSmartSubmit);
  }

  const cloudLoginForm = document.querySelector("#cloud-login-form");
  if (cloudLoginForm) {
    cloudLoginForm.addEventListener("submit", handleCloudLoginSubmit);
  }

  const importFile = document.querySelector("#import-file");
  if (importFile) {
    importFile.addEventListener("change", handleImport);
  }
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

  ["incomeCadence", "incomeAmount"].forEach((name) => {
    const field = form.elements.namedItem(name);
    if (field) {
      field.addEventListener("input", updateMonthlyEquivalent);
      field.addEventListener("change", updateMonthlyEquivalent);
    }
  });
  updateMonthlyEquivalent();
}

function handleAction(event) {
  event.preventDefault();
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;

  const actions = {
    "go-spending": () => {
      activateView(DEFAULT_VIEW);
    },
    "toggle-menu": () => {
      menuOpen = !menuOpen;
    },
    "open-diagnosis": () => {
      state.showDiagnosis = true;
      menuOpen = false;
    },
    "close-diagnosis": () => {
      state.showDiagnosis = false;
    },
    "complete-checkin": completeCheckin,
    "simulate-alert": simulateSpendingAlert,
    "add-process-win": addProcessWin,
    "reveal-debt": () => {
      state.settings.revealDebtTotal = true;
    },
    "hide-debt": () => {
      state.settings.revealDebtTotal = false;
    },
    "toggle-setting": () => {
      const setting = event.currentTarget.dataset.setting;
      state.settings[setting] = !state.settings[setting];
      state.lastAlert = state.settings[setting] ? "Automatizacion activada por defecto." : "Automatizacion pausada manualmente.";
    },
    "apply-student-context": applyStudentContext,
    "pay-debt": () => registerDebtPayment(id),
    "remove-job": () => removeBudgetJob(id),
    "remove-transaction": () => removeTransaction(id),
    "remove-extra": () => removeBudgetExtra(id),
    "cancel-cooldown": () => cancelCooldown(id),
    "unlock-cooldown": () => unlockCooldown(id),
    "push-cloud-now": () => pushCloudState(),
    "pull-cloud-now": () => pullCloudAfterLogin(),
    "cloud-sign-out": () => handleCloudSignOut(),
    "export-data": exportData,
    "reset-demo": resetDemo
  };

  if (actions[action]) {
    actions[action]();
    const asyncCloudAction = ["push-cloud-now", "pull-cloud-now", "cloud-sign-out"].includes(action);
    if (!asyncCloudAction && action !== "toggle-menu") {
      saveState();
    }
    if (!asyncCloudAction) {
      render();
    }
  }
}

function handleDiagnosisSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const wasIncomplete = !state.profile.completed;
  const shouldClearTemplateBudget = shouldClearTemplateBudgetOnPlanSave();
  const estimatedDebt = numberFrom(data.get("totalDebt"));
  const incomeCadence = ["weekly", "biweekly", "monthly", "semester", "yearly"].includes(data.get("incomeCadence"))
    ? data.get("incomeCadence")
    : "monthly";
  const incomeAmount = numberFrom(data.get("incomeAmount"));
  const periodStart = cleanDate(data.get("periodStart"), monthStartKey());
  const semesterIncome = incomeCadence === "semester" ? incomeAmount : state.profile.semesterIncome || STUDENT_SEMESTER_INCOME;
  const semesterMonths = incomeCadence === "semester" ? STUDENT_SEMESTER_MONTHS : state.profile.semesterMonths || STUDENT_SEMESTER_MONTHS;
  const weeklyGas = data.has("weeklyGas") ? numberFrom(data.get("weeklyGas")) : Number(state.profile.weeklyGas || 0);
  const monthlyIncome = getMonthlyIncome({ ...state.profile, incomeCadence, incomeAmount, semesterIncome, semesterMonths });

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
    }
  };

  if (wasIncomplete) {
    state.debts =
      estimatedDebt > 0
        ? [{ id: uid("debt"), name: "Deuda principal", balance: estimatedDebt, apr: 24, minimum: Math.max(50_000, estimatedDebt * 0.03) }]
        : [];
    state.transactions = [];
    state.cooldowns = [];
    state.wins = [
      {
        id: uid("win"),
        date: todayKey(),
        text: "Guardaste tus datos reales y convertiste numeros sueltos en un plan."
      }
    ];
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
  const job = {
    id: uniqueCategoryId(name),
    name,
    amount,
    cadence
  };
  state.budgetJobs.push(job);
  const semesterBudget = getBudgetAmountForJob(job, state.profile);
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
  const currentWindow = budgetSummary().window;
  const appliesNow = date >= currentWindow.start && date < currentWindow.end;
  if (appliesNow) {
    adjustLiquidity(location, amount, "extra");
  }
  const extra = {
    id: uid("extra"),
    source,
    amount,
    date,
    location
  };
  state.budgetExtras.push(extra);
  const summary = budgetSummary();
  state.lastAlert = appliesNow
    ? `${source} sumo ${formatMoney(amount)} al presupuesto ${summary.cadenceLabel} en ${locationLabel(location)}.`
    : `${source} quedo guardado, pero esa fecha pertenece a otro periodo.`;
  saveState();
  render();
}

function handleLiquiditySubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.liquidity = {
    account: numberFrom(data.get("account")),
    cash: numberFrom(data.get("cash")),
    initialized: true
  };
  state.lastAlert = `Disponible actualizado: ${formatMoney(state.liquidity.account + state.liquidity.cash)} en total.`;
  saveState();
  render();
}

function handleDebtSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.debts.push({
    id: uid("debt"),
    name: cleanText(data.get("name"), "Deuda"),
    balance: numberFrom(data.get("balance")),
    apr: numberFrom(data.get("apr")),
    minimum: numberFrom(data.get("minimum"))
  });
  state.lastAlert = "Nueva deuda agregada. La cuenta mas pequena queda primero.";
  saveState();
  render();
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const plan = calculatePlan();
  const amount = numberFrom(data.get("amount"));
  const merchant = cleanText(data.get("merchant"), "Compra");
  const category = String(data.get("category"));
  const budgeted = data.get("budgeted") === "on";
  const source = normalizeLocation(data.get("source"));
  const threshold = plan.expenses * LARGE_PURCHASE_RATIO;

  if (!budgeted && amount >= threshold) {
    state.cooldowns.push({
      id: uid("cool"),
      merchant,
      amount,
      category,
      source,
      createdAt: new Date().toISOString(),
      unlockAt: hoursFromNow(24).toISOString()
    });
    state.lastAlert = `${merchant} quedo en pausa 24 horas antes de decidir.`;
  } else {
    addTransaction({ merchant, amount, category, budgeted, source });
    state.lastAlert = createSpendAlert(category);
  }

  saveState();
  render();
}

function handleSmartSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.settings.monthlyRaisePct = clamp(numberFrom(data.get("monthlyRaisePct")), 0, 100);
  state.settings.escalationPct = clamp(numberFrom(data.get("escalationPct")), 0, 100);
  state.lastAlert = "Aumento futuro actualizado.";
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
  cloudState.error = "";
  render();

  try {
    const session = mode === "signup" ? await signUpToCloud(email, password) : await signInToCloud(email, password);
    if (!session) {
      cloudState.status = "signed-out";
      cloudState.error = "Cuenta creada. Revisa tu correo si Supabase pide confirmacion.";
      render();
      return;
    }
    applyCloudSession(session);
    state.lastAlert = mode === "signup" ? "Cuenta creada. Sincronizando nube..." : "Sesion iniciada. Bajando nube...";
    await pullCloudAfterLogin();
  } catch (error) {
    cloudState.status = "signed-out";
    cloudState.error = friendlyCloudError(error);
    render();
  }
}

async function handleCloudSignOut() {
  cloudState.status = "syncing";
  render();
  try {
    await signOutFromCloud();
    cloudState.signedIn = false;
    cloudState.email = "";
    cloudState.status = "signed-out";
    state.lastAlert = "Sesion cerrada. Este dispositivo queda en modo local.";
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = friendlyCloudError(error);
  }
  render();
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      state = { ...createDefaultState(), ...JSON.parse(String(reader.result)) };
      state.lastAlert = "Datos importados correctamente.";
      saveState();
      render();
    } catch {
      state.lastAlert = "No pude importar ese archivo JSON.";
      render();
    }
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
    giftMonthlyBudget: 20_000
  };
  state.budgetJobs = STUDENT_BUDGET_JOBS.map((job) => ({ ...job }));
  state.meta = { ...(state.meta || {}), budgetPreset: "student" };
  state.lastAlert = "Contexto estudiante aplicado: beca semestral, moto, gasolina y salidas.";
  state.wins.push({
    id: uid("win"),
    date: todayKey(),
    text: "Personalizaste la app a tu vida de estudiante becado."
  });
}

function registerDebtPayment(id) {
  const debt = state.debts.find((item) => item.id === id);
  if (!debt) {
    return;
  }
  const payment = Math.min(debt.balance, Math.max(debt.minimum, 100_000));
  debt.balance = Math.max(0, debt.balance - payment);

  if (debt.balance === 0) {
    state.debts = state.debts.filter((item) => item.id !== id);
    state.wins.push({
      id: uid("win"),
      date: todayKey(),
      text: `Cerraste ${debt.name}. Una cuenta menos pesa mas que un numero perfecto.`
    });
    state.lastAlert = `${debt.name} cerrada. Una cuenta menos.`;
  } else {
    state.lastAlert = `Pago de ${formatMoney(payment)} registrado en ${debt.name}.`;
  }
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
  state.lastAlert = extra ? `${extra.source} ya no suma al presupuesto.` : "Dinero extra eliminado.";
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
  link.download = `finanzas-conductuales-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.lastAlert = "Archivo JSON exportado.";
}

function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  state = createDefaultState();
  state.lastAlert = "Demo reiniciada. Usa Mis datos para personalizarla.";
}

function addTransaction({ merchant, amount, category, budgeted, source = "account" }) {
  const location = normalizeLocation(source);
  adjustLiquidity(location, -Number(amount || 0), "expense");
  state.transactions.push({
    id: uid("tx"),
    date: todayKey(),
    merchant,
    amount,
    category,
    labeled: Boolean(category),
    budgeted,
    source: location
  });
}

function calculatePlan() {
  return calculateFinancePlan(state);
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

function lastTransactionForCategory(categoryId) {
  return transactionsForSummary()
    .filter((transaction) => transaction.category === categoryId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
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
      band: freeRatio >= 95 ? "danger" : freeRatio >= 75 ? "warning" : "good"
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

function sortedDebts() {
  return getSortedDebts(state);
}

function totalDebt() {
  return getTotalDebt(state);
}

function minimumDebtPayments() {
  return getMinimumDebtPayments(state);
}

function nextDebtAction() {
  const debt = sortedDebts()[0];
  if (!debt) {
    return {
      title: "Sin deudas activas",
      copy: "Redirige el tercio de deuda hacia ahorro e inversion automatizada."
    };
  }
  return {
    title: debt.name,
    copy: `Paga al menos ${formatMoney(debt.minimum)}. Lo extra va aqui hasta cerrar esta cuenta.`
  };
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

function shouldUseDebtExposureMode() {
  return getShouldUseDebtExposureMode(state);
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

function dayFiveSweepDay() {
  const payday = Number(state.profile.payday || 0);
  return payday > 0 ? clamp(payday + 4, 5, 28) : 5;
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
    deudas: "debt",
    ahorro: "savings",
    registrar: "spending",
    gastos: "spending",
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
    debt: "deudas",
    savings: "ahorro",
    spending: "registrar",
    profile: "datos"
  };
  return hashes[view] || view;
}

function numberFrom(value) {
  return Math.max(0, Number(value) || 0);
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
      cadence: ["weekly", "biweekly", "monthly", "semester", "yearly", "period"].includes(job.cadence) ? job.cadence : known.cadence || "monthly"
    };
  });
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
    location: normalizeLocation(extra.location)
  }));
}

function normalizeLiquidity(liquidity) {
  return {
    account: numberFrom(liquidity?.account),
    cash: numberFrom(liquidity?.cash),
    initialized: Boolean(liquidity?.initialized)
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
