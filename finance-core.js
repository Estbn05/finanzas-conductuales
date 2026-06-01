export const EMERGENCY_BASELINE = 8_000_000;
export const LARGE_PURCHASE_RATIO = 0.08;
export const FREE_CATEGORY_ID = "free";

export function calculatePlan(state) {
  const income = getMonthlyIncome(state.profile);
  const isSemesterIncome = state.profile.incomeCadence === "semester";
  const base = income / 3;
  const hasDebt = state.debts.some((debt) => Number(debt.balance || 0) > 0);
  const alphaMap = { low: 1.08, medium: 1.18, high: 1.32 };
  const alpha = state.profile.incomeType === "variable" ? alphaMap[state.profile.volatility] || 1.18 : 1;
  let savings = base * alpha;
  let debt = hasDebt ? base * (alpha > 1 ? 0.92 : 1) : base * 0.35;
  let expenses = income - savings - debt;
  const minimumDebt = minimumDebtPayments(state);

  if (isSemesterIncome) {
    const committed = Number(state.profile.committedExpenses || 0);
    const flexiblePool = Math.max(0, income - committed - (hasDebt ? minimumDebt : 0));
    debt = hasDebt ? Math.max(minimumDebt, flexiblePool * 0.25) : 0;
    savings = flexiblePool * 0.45;
    expenses = Math.max(committed, income - savings - debt);
  }

  if (expenses < Number(state.profile.committedExpenses || 0)) {
    const gap = Number(state.profile.committedExpenses || 0) - expenses;
    savings = Math.max(base * 0.65, savings - gap * 0.7);
    debt = hasDebt ? Math.max(minimumDebt, debt - gap * 0.3) : debt;
    expenses = income - savings - debt;
  }

  if (!hasDebt && !isSemesterIncome) {
    savings += debt * 0.7;
    expenses += debt * 0.3;
    debt = 0;
  }

  const total = Math.max(1, debt + savings + expenses);
  const emergencyGap = Math.max(0, EMERGENCY_BASELINE - Number(state.profile.emergencySavings || 0));
  const dayFiveSweep = state.settings.emergencyAutoDefault
    ? Math.min(Math.max(0, savings * 0.7), Math.max(100_000, emergencyGap / 6))
    : 0;

  return {
    income,
    debt,
    savings,
    expenses,
    emergencyGap,
    emergencyProgress: (Number(state.profile.emergencySavings || 0) / EMERGENCY_BASELINE) * 100,
    dayFiveSweep,
    debtDegrees: (debt / total) * 360,
    savingsDegrees: ((debt + savings) / total) * 360,
    incomeNote:
      isSemesterIncome
        ? `Ingreso semestral: ${formatPlanNumber(Number(state.profile.semesterIncome || 0))} dividido en ${Number(state.profile.semesterMonths || 6)} meses.`
        : state.profile.incomeType === "variable"
        ? `Ingreso variable: factor alpha ${alpha.toFixed(2)} aumenta ahorro precautorio.`
        : "Ingreso fijo: se mantiene reparto 1/3 antes de optimizaciones."
  };
}

export function getMonthlyIncome(profile) {
  if (profile.incomeCadence === "semester") {
    const months = Math.max(1, Number(profile.semesterMonths || 6));
    const semesterIncome = Number(profile.semesterIncome || 0);
    return Math.round(semesterIncome / months);
  }
  return Number(profile.monthlyIncome || 0);
}

export function getSemesterIncome(profile) {
  if (profile.incomeCadence === "semester") {
    return Number(profile.semesterIncome || 0);
  }
  return getMonthlyIncome(profile) * getSemesterMonths(profile);
}

export function getSemesterMonths(profile) {
  return Math.max(1, Number(profile.semesterMonths || 6));
}

export function getSemesterWeeks(profile) {
  return Math.max(1, Math.round((getSemesterMonths(profile) * 52) / 12));
}

export function budgetAmountForJob(job, profile) {
  const amount = Number(job.amount ?? job.budget ?? 0);
  const cadence = job.cadence || "monthly";
  if (cadence === "weekly") {
    return Math.round(amount * getSemesterWeeks(profile));
  }
  if (cadence === "semester") {
    return amount;
  }
  return Math.round(amount * getSemesterMonths(profile));
}

export function budgetSummary(state, today) {
  const spent = spendByCategory(state, today);
  const income = getSemesterIncome(state.profile);
  const reserved = state.budgetJobs.reduce((sum, job) => sum + budgetAmountForJob(job, state.profile), 0);
  const freeBudget = Math.max(0, income - reserved);
  const freeSpent = spent[FREE_CATEGORY_ID] || 0;
  return {
    income,
    reserved,
    freeBudget,
    freeSpent,
    freeRemaining: Math.max(0, freeBudget - freeSpent),
    overReserved: Math.max(0, reserved - income),
    months: getSemesterMonths(state.profile),
    weeks: getSemesterWeeks(state.profile),
    window: budgetWindow(state.profile, today)
  };
}

function formatPlanNumber(value) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

export function categoryStatus(state, today) {
  const spent = spendByCategory(state, today);
  return state.budgetJobs.map((job) => {
    const used = spent[job.id] || 0;
    const budget = budgetAmountForJob(job, state.profile);
    const ratio = budget ? (used / budget) * 100 : 0;
    return {
      id: job.id,
      name: job.name,
      budget,
      spent: used,
      ratio,
      band: ratio >= 95 ? "danger" : ratio >= 75 ? "warning" : "good"
    };
  });
}

export function spendByCategory(state, today) {
  return state.transactions
    .filter((transaction) => transaction.labeled && isInBudgetWindow(transaction.date, state.profile, today))
    .reduce((acc, transaction) => {
      acc[transaction.category] = (acc[transaction.category] || 0) + Number(transaction.amount || 0);
      return acc;
    }, {});
}

export function monthlyLabeledSpend(state, today) {
  return state.transactions
    .filter((transaction) => transaction.labeled && isInBudgetWindow(transaction.date, state.profile, today))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
}

export function sortedDebts(state) {
  return state.debts
    .filter((debt) => Number(debt.balance || 0) > 0)
    .slice()
    .sort((a, b) => Number(a.balance || 0) - Number(b.balance || 0));
}

export function totalDebt(state) {
  return state.debts.reduce((sum, debt) => sum + Number(debt.balance || 0), 0);
}

export function minimumDebtPayments(state) {
  return state.debts.reduce((sum, debt) => sum + Number(debt.minimum || 0), 0);
}

export function shouldUseDebtExposureMode(state) {
  return Number(state.profile.financialAnxiety || 0) >= 7 || Number(state.profile.moneyScripts.avoidance || 0) >= 4;
}

export function isLargeUnbudgetedPurchase(amount, expenses) {
  return Number(amount || 0) >= Number(expenses || 0) * LARGE_PURCHASE_RATIO;
}

export function isCurrentMonth(dateValue, today) {
  return String(dateValue).slice(0, 7) === String(today).slice(0, 7);
}

export function budgetWindow(profile, today) {
  const todayKey = today ? String(today).slice(0, 10) : dateKey(new Date());
  const months = getSemesterMonths(profile);
  const fallbackStart = monthStartKey(todayKey);
  let start = parseDateOnly(profile.semesterStart || fallbackStart);
  const current = parseDateOnly(todayKey);

  while (addMonths(start, months) <= current) {
    start = addMonths(start, months);
  }

  while (start > current) {
    start = addMonths(start, -months);
  }

  const end = addMonths(start, months);
  return {
    start: dateKey(start),
    end: dateKey(end)
  };
}

export function isInBudgetWindow(dateValue, profile, today) {
  const window = budgetWindow(profile, today);
  const date = String(dateValue).slice(0, 10);
  return date >= window.start && date < window.end;
}

function monthStartKey(today) {
  return `${String(today).slice(0, 7)}-01`;
}

function parseDateOnly(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
