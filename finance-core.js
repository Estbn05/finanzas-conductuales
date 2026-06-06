export const EMERGENCY_BASELINE = 8_000_000;
export const LARGE_PURCHASE_RATIO = 0.08;
export const FREE_CATEGORY_ID = "free";

export const INCOME_CADENCES = {
  weekly: { label: "semanal", months: 12 / 52, weeks: 1, days: 7 },
  biweekly: { label: "quincenal", months: 12 / 26, weeks: 2, days: 14 },
  monthly: { label: "mensual", months: 1, weeks: 52 / 12, monthsInterval: 1 },
  semester: { label: "semestral", months: 6, weeks: 26, monthsInterval: 6 },
  yearly: { label: "anual", months: 12, weeks: 52, monthsInterval: 12 }
};

export const JOB_CADENCES = {
  weekly: { label: "semanal" },
  biweekly: { label: "quincenal" },
  monthly: { label: "mensual" },
  semester: { label: "semestral" },
  yearly: { label: "anual" },
  period: { label: "una vez por periodo" }
};

export function calculatePlan(state) {
  const income = getMonthlyIncome(state.profile);
  const incomeCadence = getIncomeCadence(state.profile);
  const isPeriodIncome = incomeCadence !== "monthly";
  const base = income / 3;
  const hasDebt = state.debts.some((debt) => Number(debt.balance || 0) > 0);
  const alphaMap = { low: 1.08, medium: 1.18, high: 1.32 };
  const alpha = state.profile.incomeType === "variable" ? alphaMap[state.profile.volatility] || 1.18 : 1;
  let savings = base * alpha;
  let debt = hasDebt ? base * (alpha > 1 ? 0.92 : 1) : base * 0.35;
  let expenses = income - savings - debt;
  const minimumDebt = minimumDebtPayments(state);

  if (isPeriodIncome) {
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

  if (!hasDebt && !isPeriodIncome) {
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
      isPeriodIncome
        ? `Ingreso ${cadenceLabel(incomeCadence)}: ${formatPlanNumber(getPeriodIncome(state.profile))} por periodo, equivalente mensual ${formatPlanNumber(income)}.`
        : state.profile.incomeType === "variable"
        ? `Ingreso variable: factor alpha ${alpha.toFixed(2)} aumenta ahorro precautorio.`
        : "Ingreso fijo: se mantiene reparto 1/3 antes de optimizaciones."
  };
}

export function getMonthlyIncome(profile) {
  return Math.round(getPeriodIncome(profile) / getPeriodMonths(profile));
}

export function getPeriodIncome(profile) {
  if (profile.incomeAmount != null) {
    return Number(profile.incomeAmount || 0);
  }
  if (profile.incomeCadence === "semester") {
    return Number(profile.semesterIncome || 0);
  }
  return Number(profile.monthlyIncome || 0);
}

export function getIncomeCadence(profile) {
  const cadence = profile.incomeCadence || "monthly";
  return INCOME_CADENCES[cadence] ? cadence : "monthly";
}

export function getPeriodMonths(profile) {
  return INCOME_CADENCES[getIncomeCadence(profile)].months;
}

export function getPeriodWeeks(profile) {
  return INCOME_CADENCES[getIncomeCadence(profile)].weeks;
}

export function budgetAmountForJob(job, profile) {
  const amount = Number(job.amount ?? job.budget ?? 0);
  const cadence = job.cadence || "monthly";
  if (cadence === "weekly") {
    return Math.round(amount * getPeriodWeeks(profile));
  }
  if (cadence === "biweekly") {
    return Math.round(amount * (getPeriodWeeks(profile) / 2));
  }
  if (cadence === "semester") {
    return Math.round(amount * (getPeriodMonths(profile) / 6));
  }
  if (cadence === "yearly") {
    return Math.round(amount * (getPeriodMonths(profile) / 12));
  }
  if (cadence === "period") {
    return amount;
  }
  return Math.round(amount * getPeriodMonths(profile));
}

export function budgetSummary(state, today) {
  const spent = spendByCategory(state, today);
  const baseIncome = getPeriodIncome(state.profile);
  const extraIncome = extraIncomeForPeriod(state, today);
  const income = baseIncome + extraIncome;
  const jobBudgets = state.budgetJobs.map((job) => ({
    id: job.id,
    budget: budgetAmountForJob(job, state.profile),
    spent: spent[job.id] || 0
  }));
  const reserved = jobBudgets.reduce((sum, job) => sum + job.budget, 0);
  const reservedSpent = jobBudgets.reduce((sum, job) => sum + Math.min(job.spent, job.budget), 0);
  const reservedRemaining = jobBudgets.reduce((sum, job) => sum + Math.max(0, job.budget - job.spent), 0);
  const categoryOverspent = jobBudgets.reduce((sum, job) => sum + Math.max(0, job.spent - job.budget), 0);
  const freeBudget = Math.max(0, income - reserved);
  const freeSpent = spent[FREE_CATEGORY_ID] || 0;
  const totalSpent = Object.values(spent).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const freeImpactSpent = totalSpent;
  return {
    baseIncome,
    extraIncome,
    income,
    reserved,
    reservedSpent,
    reservedRemaining,
    categoryOverspent,
    freeBudget,
    freeSpent,
    totalSpent,
    freeImpactSpent,
    freeRemaining: Math.max(0, freeBudget - freeImpactSpent),
    overReserved: Math.max(0, reserved - income),
    months: getPeriodMonths(state.profile),
    weeks: getPeriodWeeks(state.profile),
    cadence: getIncomeCadence(state.profile),
    cadenceLabel: cadenceLabel(getIncomeCadence(state.profile)),
    window: budgetWindow(state.profile, today)
  };
}

export function extraIncomeForPeriod(state, today) {
  return (state.budgetExtras || [])
    .filter((extra) => isInBudgetWindow(extra.date, state.profile, today))
    .reduce((sum, extra) => sum + Number(extra.amount || 0), 0);
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
    .filter((transaction) => isInBudgetWindow(transaction.date, state.profile, today))
    .reduce((acc, transaction) => {
      const category = transaction.labeled && transaction.category ? transaction.category : FREE_CATEGORY_ID;
      acc[category] = (acc[category] || 0) + Number(transaction.amount || 0);
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
  const cadence = INCOME_CADENCES[getIncomeCadence(profile)];
  const fallbackStart = monthStartKey(todayKey);
  let start = parseDateOnly(profile.periodStart || profile.semesterStart || fallbackStart);
  const current = parseDateOnly(todayKey);
  const advance = (date, direction = 1) =>
    cadence.days ? addDays(date, cadence.days * direction) : addMonths(date, cadence.monthsInterval * direction);

  while (advance(start) <= current) {
    start = advance(start);
  }

  while (start > current) {
    start = advance(start, -1);
  }

  const end = advance(start);
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

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cadenceLabel(cadence) {
  return INCOME_CADENCES[cadence]?.label || "mensual";
}
