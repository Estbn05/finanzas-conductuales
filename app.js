import {
  EMERGENCY_BASELINE,
  LARGE_PURCHASE_RATIO,
  calculatePlan as calculateFinancePlan,
  categoryStatus as getCategoryStatus,
  minimumDebtPayments as getMinimumDebtPayments,
  monthlyLabeledSpend as getMonthlyLabeledSpend,
  shouldUseDebtExposureMode as getShouldUseDebtExposureMode,
  sortedDebts as getSortedDebts,
  spendByCategory as getSpendByCategory,
  totalDebt as getTotalDebt
} from "./finance-core.js";

const STORAGE_KEY = "finanzas-conductuales:v1";
const TODAY = todayKey();

const NAV_ITEMS = [
  { id: "today", label: "Hoy", icon: "01" },
  { id: "budget", label: "Presupuesto", icon: "02" },
  { id: "debt", label: "Deudas", icon: "03" },
  { id: "savings", label: "Ahorro", icon: "04" },
  { id: "spending", label: "Gastos", icon: "05" },
  { id: "profile", label: "Perfil", icon: "06" }
];

const app = document.querySelector("#app");
let state = loadState();

render();

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

function createDefaultState() {
  const daysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return todayKey(date);
  };

  return {
    activeView: "today",
    showDiagnosis: false,
    lastAlert: "Tienes 3 movimientos esperando etiqueta. El ritual diario toma menos de 5 minutos.",
    profile: {
      completed: false,
      name: "Tu plan",
      currency: "COP",
      monthlyIncome: 5_200_000,
      incomeType: "fixed",
      volatility: "medium",
      committedExpenses: 1_850_000,
      emergencySavings: 1_200_000,
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
    budgetJobs: [
      { id: "housing", name: "Vivienda y servicios", budget: 1_650_000 },
      { id: "food", name: "Mercado y comida", budget: 780_000 },
      { id: "transport", name: "Transporte", budget: 320_000 },
      { id: "health", name: "Salud", budget: 220_000 },
      { id: "learning", name: "Aprendizaje", budget: 180_000 },
      { id: "flex", name: "Gasto flexible", budget: 380_000 }
    ],
    debts: [
      { id: uid("debt"), name: "Tarjeta de credito", balance: 1_450_000, apr: 31, minimum: 180_000 },
      { id: uid("debt"), name: "Compra a cuotas", balance: 620_000, apr: 18, minimum: 95_000 },
      { id: uid("debt"), name: "Prestamo personal", balance: 4_800_000, apr: 24, minimum: 310_000 }
    ],
    transactions: [
      {
        id: uid("tx"),
        date: TODAY,
        merchant: "Supermercado",
        amount: 128_000,
        category: "",
        labeled: false,
        budgeted: true
      },
      {
        id: uid("tx"),
        date: TODAY,
        merchant: "Plataforma streaming",
        amount: 34_900,
        category: "",
        labeled: false,
        budgeted: true
      },
      {
        id: uid("tx"),
        date: TODAY,
        merchant: "Cafe y snack",
        amount: 22_000,
        category: "",
        labeled: false,
        budgeted: true
      },
      {
        id: uid("tx"),
        date: daysAgo(1),
        merchant: "Arriendo",
        amount: 1_300_000,
        category: "housing",
        labeled: true,
        budgeted: true
      },
      {
        id: uid("tx"),
        date: daysAgo(2),
        merchant: "Transporte app",
        amount: 46_000,
        category: "transport",
        labeled: true,
        budgeted: true
      },
      {
        id: uid("tx"),
        date: daysAgo(3),
        merchant: "Curso online",
        amount: 110_000,
        category: "learning",
        labeled: true,
        budgeted: true
      }
    ],
    cooldowns: [
      {
        id: uid("cool"),
        merchant: "Audifonos premium",
        amount: 540_000,
        category: "flex",
        createdAt: new Date().toISOString(),
        unlockAt: hoursFromNow(24).toISOString()
      }
    ],
    checkins: [],
    wins: [
      { id: uid("win"), date: daysAgo(2), text: "Clasificaste tus primeros movimientos y redujiste ambiguedad." },
      { id: uid("win"), date: daysAgo(1), text: "Pagaste el minimo de la cuenta mas pequena." }
    ]
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return createDefaultState();
    }
    return { ...createDefaultState(), ...JSON.parse(saved) };
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const plan = calculatePlan();
  app.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#" data-action="go-today" aria-label="Ir al tablero diario">
        <span class="brand-mark">FC</span>
        <span>
          <strong>Finanzas Conductuales</strong>
          <small>Ritual, ahorro y deuda</small>
        </span>
      </a>
      <nav class="nav-list" aria-label="Secciones principales">
        ${NAV_ITEMS.map((item) => renderNavItem(item)).join("")}
      </nav>
      <div class="sidebar-meter">
        <span>Buffer base</span>
        <strong>${Math.round(plan.emergencyProgress)}%</strong>
        <div class="mini-track">
          <span style="width:${clamp(plan.emergencyProgress, 0, 100)}%"></span>
        </div>
      </div>
    </aside>
    <main class="main-panel">
      ${renderHeader(plan)}
      ${state.lastAlert ? `<div class="notice" role="status">${escapeHtml(state.lastAlert)}</div>` : ""}
      ${renderView(plan)}
    </main>
    ${state.showDiagnosis ? renderDiagnosisModal() : ""}
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

function renderHeader(plan) {
  const streak = currentStreak();
  const remaining = Math.max(0, plan.expenses - monthlyLabeledSpend());

  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">${state.profile.completed ? "Plan personal activo" : "Modo demo listo para personalizar"}</p>
        <h1>${headerTitle()}</h1>
      </div>
      <div class="topbar-actions">
        <span class="status-pill">
          <strong>${streak}</strong>
          dias de ritual
        </span>
        <span class="status-pill">
          <strong>${formatMoney(remaining)}</strong>
          disponible
        </span>
        <button class="btn primary" type="button" data-action="open-diagnosis">Diagnostico</button>
      </div>
    </header>
  `;
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

function headerTitle() {
  const titles = {
    today: "Ritual diario",
    budget: "Presupuesto 1/3",
    debt: "Snowball de deudas",
    savings: "Ahorro automatico",
    spending: "Conciencia de gasto",
    profile: "Diagnostico conductual"
  };
  return titles[state.activeView] || "Finanzas Conductuales";
}

function renderToday(plan) {
  const unlabeled = state.transactions.filter((transaction) => !transaction.labeled);
  const unlabeledToday = state.transactions.filter((transaction) => transaction.date === TODAY && !transaction.labeled);
  const checkinDone = state.checkins.includes(TODAY);
  const script = dominantMoneyScript();

  return `
    <section class="content-grid today-grid">
      <article class="card ritual-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Self-regulatory drill</p>
            <h2>Etiqueta ${unlabeled.length} movimientos</h2>
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
            Marcar ritual
          </button>
          <button class="btn ghost" type="button" data-view="spending">Registrar gasto</button>
        </div>
        ${
          unlabeledToday.length
            ? `<p class="helper-text">Para cerrar el ritual de hoy, primero asigna una categoria a los movimientos del dia.</p>`
            : `<p class="helper-text">El seguimiento diario restaura friccion consciente sin convertir tus finanzas en una carga.</p>`
        }
      </article>

      <article class="card hero-visual">
        <div class="paying-visual" style="--spent:${clamp((monthlyLabeledSpend() / plan.expenses) * 100, 0, 100)}">
          <div class="coin-stack" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <div>
            <p class="eyebrow">Pain of paying sintetico</p>
            <h2>${formatMoney(monthlyLabeledSpend())}</h2>
            <p>gastados este mes dentro de trabajos etiquetados</p>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Buffer de emergencia</p>
            <h2>${formatMoney(state.profile.emergencySavings)} guardados</h2>
          </div>
          <span class="metric-badge">${formatMoney(plan.emergencyGap)} faltan</span>
        </div>
        ${renderProgress(plan.emergencyProgress, "Progreso al equivalente de US$2.000")}
        <p class="helper-text">
          Barrido sugerido dia ${state.profile.payday + 4}: ${formatMoney(plan.dayFiveSweep)} antes del gasto flexible.
        </p>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Siguiente accion pequena</p>
            <h2>${nextDebtAction().title}</h2>
          </div>
          <span class="metric-badge">Snowball</span>
        </div>
        <p>${nextDebtAction().copy}</p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-view="debt">Ver deudas</button>
        </div>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Categorias activas</p>
            <h2>Senales de agotamiento</h2>
          </div>
          <button class="icon-btn" type="button" data-action="simulate-alert" aria-label="Simular alerta visual">!</button>
        </div>
        ${renderCategoryBars(plan, 6)}
      </article>

      <article class="card">
        <p class="eyebrow">Script dominante</p>
        <h2>${script.name}</h2>
        <p>${script.guidance}</p>
        <div class="micro-task">
          <strong>Tarea de 5 minutos</strong>
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
  const assigned = state.budgetJobs.reduce((sum, job) => sum + Number(job.budget || 0), 0);
  const assignmentRatio = plan.expenses ? (assigned / plan.expenses) * 100 : 0;
  const status = assigned > plan.expenses ? "over" : assigned < plan.expenses * 0.95 ? "under" : "balanced";

  return `
    <section class="content-grid budget-grid">
      <article class="card split-card">
        <div class="budget-ring" style="--debt:${plan.debtDegrees}deg; --savings:${plan.savingsDegrees}deg">
          <div>
            <strong>1/3</strong>
            <span>Regla base</span>
          </div>
        </div>
        <div class="split-details">
          <p class="eyebrow">Arquitectura de eleccion</p>
          <h2>Tres pilares, pocas decisiones</h2>
          ${renderAllocation("Deuda", plan.debt, "debt")}
          ${renderAllocation("Ahorro", plan.savings, "savings")}
          ${renderAllocation("Gastos", plan.expenses, "expenses")}
          <p class="helper-text">${plan.incomeNote}</p>
        </div>
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Zero-based dentro de gastos</p>
            <h2>${formatMoney(assigned)} asignados</h2>
          </div>
          <span class="metric-badge ${status}">${Math.round(assignmentRatio)}%</span>
        </div>
        ${renderProgress(assignmentRatio, "Trabajos asignados del tercio de gastos")}
        <form class="inline-form" id="budget-job-form">
          <label>
            Trabajo
            <input name="name" type="text" placeholder="Ej. Regalos" maxlength="32" required>
          </label>
          <label>
            Presupuesto
            <input name="budget" type="number" min="1000" step="1000" placeholder="150000" required>
          </label>
          <button class="btn secondary" type="submit">Agregar</button>
        </form>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Trabajos del dinero</p>
            <h2>Gasto consciente</h2>
          </div>
          <span class="metric-badge">${state.budgetJobs.length}/10 categorias</span>
        </div>
        <div class="job-table">
          ${state.budgetJobs.map((job) => renderBudgetJob(job)).join("")}
        </div>
      </article>
    </section>
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
  const ratio = job.budget ? (spent / job.budget) * 100 : 0;
  const band = ratio >= 95 ? "danger" : ratio >= 75 ? "warning" : "good";

  return `
    <div class="job-row">
      <div>
        <strong>${escapeHtml(job.name)}</strong>
        <span>${formatMoney(spent)} de ${formatMoney(job.budget)}</span>
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
            <p class="eyebrow">Mountain to Molehill</p>
            <h2>${visibleDebts.length === 1 && sorted.length > 1 ? "Solo el siguiente paso" : "Cuentas por cerrar"}</h2>
          </div>
          <span class="metric-badge">${sorted.length} cuentas</span>
        </div>
        ${
          exposureMode && !state.settings.revealDebtTotal
            ? `<p class="helper-text">Modo exposicion gradual activo: mostramos la deuda mas pequena para evitar sobrecarga y convertir ansiedad en accion.</p>`
            : `<p class="helper-text">Total visible: ${formatMoney(totalDebt)}. El orden prioriza victorias pequenas sobre interes perfecto.</p>`
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
        <p>Primero cubre minimos. Cualquier excedente va a la cuenta mas pequena hasta cerrarla.</p>
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
  const futureRaise = state.profile.monthlyIncome * (state.settings.monthlyRaisePct / 100);
  const escalatedSavings = futureRaise * (state.settings.escalationPct / 100);

  return `
    <section class="content-grid savings-grid">
      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">${phase} · Pay yourself first</p>
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
        <p>Si tus ingresos suben ${state.settings.monthlyRaisePct}%, el ${state.settings.escalationPct}% del aumento se redirige al ahorro antes de sentirse como gasto disponible.</p>
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
        <p>Mostrar el rendimiento como tiempo futuro hace que la recompensa sea mas concreta que un porcentaje aislado.</p>
      </article>
    </section>
  `;
}

function renderSpending(plan) {
  const overBudget = categoryStatus().filter((category) => category.ratio > 100);
  const threshold = plan.expenses * LARGE_PURCHASE_RATIO;

  return `
    <section class="content-grid spending-grid">
      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Alertas de agotamiento</p>
            <h2>Barras que cambian con tu gasto</h2>
          </div>
          <span class="metric-badge">Umbral grande: ${formatMoney(threshold)}</span>
        </div>
        ${renderCategoryBars(plan, state.budgetJobs.length)}
      </article>

      <article class="card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Cooling-off</p>
            <h2>Registrar compra</h2>
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
              ${state.budgetJobs.map((job) => `<option value="${escapeAttr(job.id)}">${escapeHtml(job.name)}</option>`).join("")}
            </select>
          </label>
          <label class="check-row">
            <input name="budgeted" type="checkbox" checked>
            Tiene trabajo asignado en el presupuesto
          </label>
          <button class="btn primary" type="submit">Registrar</button>
        </form>
      </article>

      <article class="card">
        <p class="eyebrow">Compras en espera</p>
        <h2>${state.cooldowns.length} bloqueadas</h2>
        <div class="cooldown-list">
          ${
            state.cooldowns.length
              ? state.cooldowns.map((cooldown) => renderCooldown(cooldown)).join("")
              : `<div class="empty-state">No hay compras impulsivas esperando desbloqueo.</div>`
          }
        </div>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Respuesta a recaidas</p>
            <h2>Reestructuracion cognitiva</h2>
          </div>
          <span class="metric-badge">${overBudget.length} categorias excedidas</span>
        </div>
        <p class="reframe">
          Una decision no define tu capacidad. ${overBudget.length ? "Reasigna los trabajos restantes y protege el siguiente paso." : "Mantienes margen para decidir con calma."}
        </p>
        <div class="card-actions">
          <button class="btn secondary" type="button" data-action="add-process-win">Registrar victoria de proceso</button>
        </div>
      </article>
    </section>
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
  const anxietyTone = state.profile.financialAnxiety >= 7 ? "Presencia financiera graduada" : "Revision estandar";

  return `
    <section class="content-grid profile-grid">
      <article class="card">
        <p class="eyebrow">Diagnostico</p>
        <h2>${escapeHtml(state.profile.name)}</h2>
        <p>${anxietyTone}. Script dominante: ${script.name.toLowerCase()}.</p>
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
        <button class="btn primary" type="button" data-action="open-diagnosis">Editar diagnostico</button>
      </article>

      <article class="card wide-card">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Money scripts</p>
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
        <p class="eyebrow">Plan calculado</p>
        <h2>${formatMoney(state.profile.monthlyIncome)} / mes</h2>
        ${renderAllocation("Deuda", plan.debt, "debt")}
        ${renderAllocation("Ahorro", plan.savings, "savings")}
        ${renderAllocation("Gastos", plan.expenses, "expenses")}
      </article>

      <article class="card">
        <p class="eyebrow">Datos locales</p>
        <h2>Portabilidad</h2>
        <p>La app guarda informacion en este navegador. Puedes exportarla como JSON para respaldos o demo.</p>
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
            <p class="eyebrow">Victorias de proceso</p>
            <h2>Identidad en construccion</h2>
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

function renderScriptBar(key, value) {
  const labels = {
    worship: "Money Worship",
    avoidance: "Money Avoidance",
    status: "Money Status",
    vigilance: "Money Vigilance"
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

function renderDiagnosisModal() {
  const profile = state.profile;

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="diagnosis-title">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">Onboarding psicologico y financiero</p>
            <h2 id="diagnosis-title">Diagnostico conductual</h2>
          </div>
          <button class="icon-btn" type="button" data-action="close-diagnosis" aria-label="Cerrar">x</button>
        </div>
        <form id="diagnosis-form" class="diagnosis-form">
          <fieldset>
            <legend>Datos minimos</legend>
            <label>
              Nombre del plan
              <input name="name" type="text" maxlength="32" value="${escapeAttr(profile.name)}" required>
            </label>
            <label>
              Ingreso mensual
              <input name="monthlyIncome" type="number" min="0" step="1000" value="${profile.monthlyIncome}" required>
            </label>
            <label>
              Gastos comprometidos
              <input name="committedExpenses" type="number" min="0" step="1000" value="${profile.committedExpenses}" required>
            </label>
            <label>
              Ahorro liquido actual
              <input name="emergencySavings" type="number" min="0" step="1000" value="${profile.emergencySavings}" required>
            </label>
            <label>
              Deuda total estimada
              <input name="totalDebt" type="number" min="0" step="1000" value="${totalDebt()}" required>
            </label>
            <label>
              Dia de pago principal
              <input name="payday" type="number" min="1" max="28" value="${profile.payday}" required>
            </label>
          </fieldset>

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
              Autoeficacia financiera: ${profile.selfEfficacy}/10
              <input name="selfEfficacy" type="range" min="1" max="10" value="${profile.selfEfficacy}">
            </label>
            <label>
              Ansiedad financiera: ${profile.financialAnxiety}/10
              <input name="financialAnxiety" type="range" min="1" max="10" value="${profile.financialAnxiety}">
            </label>
          </fieldset>

          <fieldset>
            <legend>Money scripts resumidos</legend>
            ${renderScriptQuestion("worship", "Siento que las cosas mejorarian mucho si tuviera mas dinero.")}
            ${renderScriptQuestion("avoidance", "A veces siento que no merezco dinero cuando otras personas tienen menos.")}
            ${renderScriptQuestion("status", "Mi valor personal se refleja en mis logros financieros.")}
            ${renderScriptQuestion("vigilance", "Me cuesta disfrutar el dinero porque prefiero guardarlo por seguridad.")}
          </fieldset>

          <div class="modal-actions">
            <button class="btn ghost" type="button" data-action="close-diagnosis">Cancelar</button>
            <button class="btn primary" type="submit">Guardar diagnostico</button>
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
          (category) => `
            <div class="category-row">
              <div>
                <strong>${escapeHtml(category.name)}</strong>
                <span>${formatMoney(category.spent)} de ${formatMoney(category.budget)}</span>
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
      state.activeView = button.dataset.view;
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
    diagnosisForm.addEventListener("submit", handleDiagnosisSubmit);
  }

  const budgetForm = document.querySelector("#budget-job-form");
  if (budgetForm) {
    budgetForm.addEventListener("submit", handleBudgetSubmit);
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

  const importFile = document.querySelector("#import-file");
  if (importFile) {
    importFile.addEventListener("change", handleImport);
  }
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;

  const actions = {
    "go-today": () => {
      state.activeView = "today";
    },
    "open-diagnosis": () => {
      state.showDiagnosis = true;
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
    "pay-debt": () => registerDebtPayment(id),
    "remove-job": () => removeBudgetJob(id),
    "cancel-cooldown": () => cancelCooldown(id),
    "unlock-cooldown": () => unlockCooldown(id),
    "export-data": exportData,
    "reset-demo": resetDemo
  };

  if (actions[action]) {
    actions[action]();
    saveState();
    render();
  }
}

function handleDiagnosisSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const wasIncomplete = !state.profile.completed;
  const estimatedDebt = numberFrom(data.get("totalDebt"));

  state.profile = {
    ...state.profile,
    completed: true,
    name: cleanText(data.get("name"), "Mi plan"),
    monthlyIncome: numberFrom(data.get("monthlyIncome")),
    committedExpenses: numberFrom(data.get("committedExpenses")),
    emergencySavings: numberFrom(data.get("emergencySavings")),
    payday: clamp(numberFrom(data.get("payday")), 1, 28),
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
        date: TODAY,
        text: "Completaste el diagnostico inicial y convertiste datos sueltos en un plan."
      }
    ];
  }

  state.showDiagnosis = false;
  state.activeView = "today";
  state.lastAlert = "Diagnostico guardado. Empieza con un ritual de 5 minutos para mantener presencia financiera.";
  saveState();
  render();
}

function handleBudgetSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  if (state.budgetJobs.length >= 10) {
    state.lastAlert = "Mantengamos maximo 10 categorias para evitar decision paralysis.";
    saveState();
    render();
    return;
  }

  const name = cleanText(data.get("name"), "Nuevo trabajo");
  state.budgetJobs.push({
    id: uniqueCategoryId(name),
    name,
    budget: numberFrom(data.get("budget"))
  });
  state.lastAlert = `${name} ya tiene un trabajo asignado.`;
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
  state.lastAlert = "Nueva deuda agregada al snowball. La cuenta mas pequena queda primero.";
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
  const threshold = plan.expenses * LARGE_PURCHASE_RATIO;

  if (!budgeted && amount >= threshold) {
    state.cooldowns.push({
      id: uid("cool"),
      merchant,
      amount,
      category,
      createdAt: new Date().toISOString(),
      unlockAt: hoursFromNow(24).toISOString()
    });
    state.lastAlert = `${merchant} entro en espera 24 horas. La friccion protege el presupuesto.`;
  } else {
    addTransaction({ merchant, amount, category, budgeted });
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
  state.lastAlert = "Escalador Save More Tomorrow actualizado.";
  saveState();
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
  const unlabeledToday = state.transactions.filter((transaction) => transaction.date === TODAY && !transaction.labeled);
  if (unlabeledToday.length) {
    state.lastAlert = `Quedan ${unlabeledToday.length} movimientos de hoy sin categoria. Ese es el ejercicio.`;
    return;
  }

  if (!state.checkins.includes(TODAY)) {
    state.checkins.push(TODAY);
    state.wins.push({
      id: uid("win"),
      date: TODAY,
      text: "Completaste el ritual diario de monitoreo."
    });
  }
  state.lastAlert = "Ritual cerrado. Pequenas repeticiones construyen autocontrol financiero.";
}

function simulateSpendingAlert() {
  state.lastAlert = createSpendAlert(categoryStatus().sort((a, b) => b.ratio - a.ratio)[0]?.id);
}

function addProcessWin() {
  state.wins.push({
    id: uid("win"),
    date: TODAY,
    text: "Revisaste el plan sin convertir un desvio en identidad."
  });
  state.lastAlert = "Victoria de proceso registrada.";
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
      date: TODAY,
      text: `Cerraste ${debt.name}. Una cuenta menos pesa mas que un numero perfecto.`
    });
    state.lastAlert = `${debt.name} cerrada. Esa victoria aumenta autoeficacia.`;
  } else {
    state.lastAlert = `Pago de ${formatMoney(payment)} registrado en ${debt.name}.`;
  }
}

function removeBudgetJob(id) {
  if (state.budgetJobs.length <= 3) {
    state.lastAlert = "Dejemos al menos 3 trabajos para mantener estructura basica.";
    return;
  }
  state.budgetJobs = state.budgetJobs.filter((job) => job.id !== id);
  state.transactions.forEach((transaction) => {
    if (transaction.category === id) {
      transaction.category = "";
      transaction.labeled = false;
    }
  });
  state.lastAlert = "Categoria eliminada. Los movimientos asociados vuelven a revision.";
}

function cancelCooldown(id) {
  state.cooldowns = state.cooldowns.filter((cooldown) => cooldown.id !== id);
  state.wins.push({
    id: uid("win"),
    date: TODAY,
    text: "Cancelaste una compra impulsiva despues del periodo de friccion."
  });
  state.lastAlert = "Compra cancelada. Ese es un ahorro real, no solo una intencion.";
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
    budgeted: false
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
  link.download = `finanzas-conductuales-${TODAY}.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.lastAlert = "Archivo JSON exportado.";
}

function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  state = createDefaultState();
  state.lastAlert = "Demo reiniciada. Puedes abrir el diagnostico para personalizarla.";
}

function addTransaction({ merchant, amount, category, budgeted }) {
  state.transactions.push({
    id: uid("tx"),
    date: TODAY,
    merchant,
    amount,
    category,
    labeled: Boolean(category),
    budgeted
  });
}

function calculatePlan() {
  return calculateFinancePlan(state);
}

function categoryStatus() {
  return getCategoryStatus(state, TODAY);
}

function spendByCategory() {
  return getSpendByCategory(state, TODAY);
}

function monthlyLabeledSpend() {
  return getMonthlyLabeledSpend(state, TODAY);
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
    copy: `Paga al menos ${formatMoney(debt.minimum)} y envia excedentes a esta cuenta hasta cerrarla.`
  };
}

function dominantMoneyScript() {
  const labels = {
    worship: {
      name: "Money Worship",
      guidance: "Convierte deseos grandes en metas con espera y costo visible."
    },
    avoidance: {
      name: "Money Avoidance",
      guidance: "Usa pasos pequenos y evita mirar todo el peso financiero de una sola vez."
    },
    status: {
      name: "Money Status",
      guidance: "Separa valor personal de compras visibles y logros comparativos."
    },
    vigilance: {
      name: "Money Vigilance",
      guidance: "Automatiza seguridad y permite gasto flexible con limites claros."
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
    return "Abre solo una categoria, etiqueta un movimiento y cierra la app.";
  }
  if (state.profile.selfEfficacy <= 4) {
    return "Registra una victoria de proceso antes de revisar saldos.";
  }
  return "Etiqueta pendientes y revisa la barra mas cercana al limite.";
}

function futureFreedom(plan) {
  const monthlyReturn = plan.savings * 0.006;
  const hours = monthlyReturn / Math.max(1, state.profile.monthlyIncome / 160);
  if (hours < 1) {
    return `${Math.round(hours * 60)} minutos libres/mes`;
  }
  return `${hours.toFixed(1)} horas libres/mes`;
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

function currentStreak() {
  const dates = new Set(state.checkins);
  let streak = 0;
  const cursor = new Date();
  while (dates.has(todayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
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

function numberFrom(value) {
  return Math.max(0, Number(value) || 0);
}

function cleanText(value, fallback) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text || fallback;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function hoursFromNow(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

function todayKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function isCurrentMonth(dateValue) {
  return String(dateValue).slice(0, 7) === TODAY.slice(0, 7);
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
