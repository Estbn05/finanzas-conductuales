export const EMERGENCY_BASELINE = 8_000_000;
export const LARGE_PURCHASE_RATIO = 0.08;

export function calculatePlan(state) {
  const income = Number(state.profile.monthlyIncome || 0);
  const base = income / 3;
  const hasDebt = state.debts.some((debt) => Number(debt.balance || 0) > 0);
  const alphaMap = { low: 1.08, medium: 1.18, high: 1.32 };
  const alpha = state.profile.incomeType === "variable" ? alphaMap[state.profile.volatility] || 1.18 : 1;
  let savings = base * alpha;
  let debt = hasDebt ? base * (alpha > 1 ? 0.92 : 1) : base * 0.35;
  let expenses = income - savings - debt;

  if (expenses < Number(state.profile.committedExpenses || 0)) {
    const gap = Number(state.profile.committedExpenses || 0) - expenses;
    savings = Math.max(base * 0.65, savings - gap * 0.7);
    debt = hasDebt ? Math.max(minimumDebtPayments(state), debt - gap * 0.3) : debt;
    expenses = income - savings - debt;
  }

  if (!hasDebt) {
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
      state.profile.incomeType === "variable"
        ? `Ingreso variable: factor alpha ${alpha.toFixed(2)} aumenta ahorro precautorio.`
        : "Ingreso fijo: se mantiene reparto 1/3 antes de optimizaciones."
  };
}

export function categoryStatus(state, today) {
  const spent = spendByCategory(state, today);
  return state.budgetJobs.map((job) => {
    const used = spent[job.id] || 0;
    const ratio = job.budget ? (used / job.budget) * 100 : 0;
    return {
      id: job.id,
      name: job.name,
      budget: job.budget,
      spent: used,
      ratio,
      band: ratio >= 95 ? "danger" : ratio >= 75 ? "warning" : "good"
    };
  });
}

export function spendByCategory(state, today) {
  return state.transactions
    .filter((transaction) => transaction.labeled && isCurrentMonth(transaction.date, today))
    .reduce((acc, transaction) => {
      acc[transaction.category] = (acc[transaction.category] || 0) + Number(transaction.amount || 0);
      return acc;
    }, {});
}

export function monthlyLabeledSpend(state, today) {
  return state.transactions
    .filter((transaction) => transaction.labeled && isCurrentMonth(transaction.date, today))
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
