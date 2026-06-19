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

export function calculatePlan(state, today) {
  const income = getMonthlyIncome(state.profile);
  const summary = budgetSummary(state, today);
  const emergencyTarget = getEmergencyTarget(state.profile);
  const emergencyGap = Math.max(0, emergencyTarget - Number(state.profile.emergencySavings || 0));
  const savingsRate = getSavingsRate(state.profile, emergencyGap);
  const idealPeriodSavings = Math.round(summary.income * savingsRate);
  const committedForPeriod = Math.round(Number(state.profile.committedExpenses || 0) * summary.months);
  const protectedExpenses = Math.max(summary.expenseReserved, committedForPeriod);
  const availableAdditional = Math.min(
    summary.freeRemaining,
    Math.max(0, summary.income - protectedExpenses - summary.savingsReserved - summary.freeImpactSpent)
  );
  const suggestedPeriodSavings = Math.round(
    Math.min(Math.max(0, idealPeriodSavings - summary.savingsRemaining), availableAdditional)
  );
  const projectedPeriodSavings = summary.savingsRemaining + suggestedPeriodSavings;
  const savingsCapacityGap = Math.max(0, idealPeriodSavings - projectedPeriodSavings);
  const savings = Math.round(projectedPeriodSavings / Math.max(1, summary.months));
  const expenses = Math.max(0, income - savings);

  return {
    income,
    savings,
    expenses,
    periodIncome: summary.income,
    idealPeriodSavings,
    suggestedPeriodSavings,
    projectedPeriodSavings,
    savingsReserved: summary.savingsRemaining,
    savingsCapacityGap,
    savingsRate: savingsRate * 100,
    freeAfterSuggestion: Math.max(0, summary.freeRemaining - suggestedPeriodSavings),
    committedForPeriod,
    emergencyTarget,
    emergencyGap,
    emergencyProgress: (Number(state.profile.emergencySavings || 0) / emergencyTarget) * 100,
    incomeNote:
      state.profile.incomeType === "variable"
        ? `Ingreso variable con volatilidad ${state.profile.volatility || "medium"}: se recomienda un margen precautorio mayor.`
        : `Ingreso fijo: la recomendacion protege primero los gastos comprometidos del periodo.`
  };
}

export function getEmergencyTarget(profile) {
  const income = getMonthlyIncome(profile);
  const committed = Number(profile.committedExpenses || 0);
  return Math.max(1, Math.round(Math.max(income, committed * 3)));
}

export function getSavingsRate(profile, emergencyGap = 0) {
  const variableRates = { low: 0.2, medium: 0.25, high: 0.3 };
  const baseRate = profile.incomeType === "variable" ? variableRates[profile.volatility] || 0.25 : 0.15;
  return Math.min(0.35, baseRate + (emergencyGap > 0 ? 0.05 : 0));
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
    isSavings: isSavingsJob(job),
    budget: budgetAmountForJob(job, state.profile),
    spent: spent[job.id] || 0
  }));
  const reserved = jobBudgets.reduce((sum, job) => sum + job.budget, 0);
  const savingsReserved = jobBudgets.filter((job) => job.isSavings).reduce((sum, job) => sum + job.budget, 0);
  const savingsRemaining = jobBudgets
    .filter((job) => job.isSavings)
    .reduce((sum, job) => sum + Math.max(0, job.budget - job.spent), 0);
  const expenseReserved = reserved - savingsReserved;
  const reservedSpent = jobBudgets.reduce((sum, job) => sum + Math.min(job.spent, job.budget), 0);
  const reservedRemaining = jobBudgets.reduce((sum, job) => sum + Math.max(0, job.budget - job.spent), 0);
  const categoryOverspent = jobBudgets.reduce((sum, job) => sum + Math.max(0, job.spent - job.budget), 0);
  const freeBudget = Math.max(0, income - reserved);
  const freeSpent = spent[FREE_CATEGORY_ID] || 0;
  const totalSpent = Object.values(spent).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const freeImpactSpent = freeSpent + categoryOverspent;
  return {
    baseIncome,
    extraIncome,
    income,
    reserved,
    savingsReserved,
    savingsRemaining,
    expenseReserved,
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

export function predictPeriodEnd(state, today) {
  const summary = budgetSummary(state, today);
  const currentKey = today ? String(today).slice(0, 10) : dateKey(new Date());
  const totalDays = Math.max(1, daysBetween(summary.window.start, summary.window.end));
  const elapsedDays = Math.max(1, Math.min(totalDays, daysBetween(summary.window.start, currentKey) + 1));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const dailyFreeImpact = summary.freeImpactSpent / elapsedDays;
  const projectedAdditionalImpact = Math.round(dailyFreeImpact * remainingDays);
  const projectedFreeAtEnd = Math.round(summary.freeBudget - summary.freeImpactSpent - projectedAdditionalImpact);
  const dailyAllowance = remainingDays > 0 ? Math.floor(summary.freeRemaining / remainingDays) : summary.freeRemaining;
  let status = "steady";

  if (summary.overReserved > 0) {
    status = "over_reserved";
  } else if (projectedFreeAtEnd < 0) {
    status = "short";
  } else if (remainingDays > 0 && projectedFreeAtEnd < summary.income * 0.08) {
    status = "tight";
  }

  return {
    window: summary.window,
    totalDays,
    elapsedDays,
    remainingDays,
    dailyFreeImpact,
    projectedAdditionalImpact,
    projectedFreeAtEnd,
    shortage: Math.max(0, -projectedFreeAtEnd),
    dailyAllowance,
    status,
    confidence: summary.totalSpent === 0 ? "empty" : elapsedDays < 3 ? "early" : "normal"
  };
}

export function budgetRingAllocation(summary) {
  const income = Math.max(0, Number(summary?.income || 0));
  const reserved = Math.min(income, Math.max(0, Number((summary?.reservedRemaining ?? summary?.reserved) || 0)));
  const spent = Math.min(Math.max(0, income - reserved), Math.max(0, Number(summary?.totalSpent || 0)));
  const free = Math.max(0, income - reserved - spent);
  return {
    reserved,
    spent,
    free,
    outside: Math.max(0, Number(summary?.totalSpent || 0) - spent),
    total: reserved + spent + free
  };
}

export function isSavingsJob(job) {
  return /ahorro|emergencia|buffer/i.test(String(job?.name || ""));
}

export function extraIncomeForPeriod(state, today) {
  return (state.budgetExtras || [])
    .filter((extra) => isInBudgetWindow(extra.date, state.profile, today))
    .reduce((sum, extra) => sum + Number(extra.amount || 0), 0);
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
      band: ratio > 90 ? "danger" : ratio > 65 ? "warning" : "good"
    };
  });
}

export function spendByCategory(state, today) {
  const validCategoryIds = new Set((state.budgetJobs || []).map((job) => job.id));
  return state.transactions
    .filter((transaction) => isInBudgetWindow(transaction.date, state.profile, today))
    .reduce((acc, transaction) => {
      const category =
        transaction.labeled && validCategoryIds.has(transaction.category)
          ? transaction.category
          : FREE_CATEGORY_ID;
      acc[category] = (acc[category] || 0) + Number(transaction.amount || 0);
      return acc;
    }, {});
}

export function monthlyLabeledSpend(state, today) {
  return state.transactions
    .filter((transaction) => transaction.labeled && isInBudgetWindow(transaction.date, state.profile, today))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
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
  const anchorDay = start.getDate();
  const advance = (date, direction = 1) =>
    cadence.days ? addDays(date, cadence.days * direction) : addMonths(date, cadence.monthsInterval * direction, anchorDay);

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

function addMonths(date, months, preferredDay = date.getDate()) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(preferredDay, daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), day);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function daysBetween(startValue, endValue) {
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue);
  return Math.round((end - start) / 86_400_000);
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
