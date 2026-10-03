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
  period: { label: "una vez por periodo" },
  // Money set aside with "Apartar dinero": a fund that stays reserved across periods
  // until it is spent or released (see jobFund).
  once: { label: "apartado" }
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
    Math.min(Math.max(0, idealPeriodSavings - summary.savingsRemainingThisPeriod), availableAdditional)
  );
  const projectedPeriodSavings = summary.savingsRemainingThisPeriod + suggestedPeriodSavings;
  const savingsCapacityGap = Math.max(0, idealPeriodSavings - projectedPeriodSavings);
  const savings = Math.round(projectedPeriodSavings / summary.months);
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
    // getEmergencyTarget() floors at 1, so with no income on file the raw ratio can reach
    // millions of percent; cap it here so no consumer ever gets a nonsense figure.
    emergencyProgress: Math.min(100, Math.max(0, (Number(state.profile.emergencySavings || 0) / emergencyTarget) * 100)),
    incomeNote:
      state.profile.incomeType === "variable"
        ? `Ingreso variable con volatilidad ${state.profile.volatility || "medium"}: se recomienda un margen precautorio mayor.`
        : `Ingreso fijo: la recomendación protege primero los gastos comprometidos del periodo.`
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

// "Apartar dinero" builds a fund: money set aside stays reserved, period after period,
// until it is spent or released ("Liberar"). A new name becomes a "once" category whose
// own amount is its first contribution; money set aside onto an existing category is a
// top-up. It used to expire with the period it was set aside in, so $300.000 put aside
// for three months of gasolina silently went back to "libre" a month later — and a
// quincenal user could never plan anything further than 15 days out (SOAT, matrícula).
//
// The fund is never re-added each period (an older bug reserved $50.000 set aside once
// again in every later period). Instead each past period's spending on the category,
// beyond what its recurring limit already covered, draws the fund down.
function fundEvents(job) {
  const events = (job.topUps || []).map((topUp) => ({ windowStart: topUp.windowStart || "", amount: Number(topUp.amount || 0) }));
  if (job.cadence === "once") {
    events.push({ windowStart: job.windowStart || "", amount: Number(job.amount || 0) });
  }
  (job.released || []).forEach((release) => events.push({ windowStart: release.windowStart || "", amount: -Number(release.amount || 0) }));
  return events;
}

export function hasFund(job) {
  return job.cadence === "once" || (job.topUps || []).length > 0;
}

// The fund as of the period starting at `windowStart`: `carried` is what was left when
// that period began, `added` the net set aside (or released) during it. Spending beyond
// the recurring limit in a past period draws from the fund, never below zero; the
// current period's spending is left to the caller, like any category's.
export function jobFund(job, profile, transactions, windowStart) {
  const events = fundEvents(job);
  if (!events.length || !windowStart) {
    return { carried: 0, added: 0, total: 0 };
  }
  const recurring = job.cadence === "once" ? 0 : recurringBudgetAmount(job, profile);
  const past = events.filter((event) => event.windowStart && event.windowStart < windowStart);
  const firstStart = past.reduce((earliest, event) => (!earliest || event.windowStart < earliest ? event.windowStart : earliest), "");

  const spentByWindow = new Map();
  if (firstStart) {
    const windowOf = new Map();
    for (const transaction of transactions || []) {
      if (!transaction.labeled || transaction.category !== job.id) continue;
      const date = String(transaction.date || "").slice(0, 10);
      if (date < firstStart || date >= windowStart) continue;
      if (!windowOf.has(date)) windowOf.set(date, budgetWindow(profile, date).start);
      const start = windowOf.get(date);
      spentByWindow.set(start, (spentByWindow.get(start) || 0) + Number(transaction.amount || 0));
    }
  }

  let carried = 0;
  const starts = [...new Set([...past.map((event) => event.windowStart), ...spentByWindow.keys()])].sort();
  for (const start of starts) {
    carried += past.filter((event) => event.windowStart === start).reduce((sum, event) => sum + event.amount, 0);
    carried = Math.max(0, carried);
    carried = Math.max(0, carried - Math.max(0, (spentByWindow.get(start) || 0) - recurring));
  }

  const added = events
    .filter((event) => !event.windowStart || event.windowStart >= windowStart)
    .reduce((sum, event) => sum + event.amount, 0);
  // What earlier periods' spending took out of the fund, so the card can say so instead
  // of its "usado" counter (this period only) reading as if the fund had been reset.
  const pastNet = past.reduce((sum, event) => sum + event.amount, 0);
  return {
    carried: Math.round(carried),
    added: Math.round(added),
    total: Math.round(Math.max(0, carried + added)),
    usedBefore: Math.round(Math.max(0, pastNet - carried))
  };
}

// What a category reserves in the period starting at `windowStart`: its recurring limit
// plus whatever its fund holds. Without `windowStart` (a form preview, onboarding) the
// base amount is returned. Pass `transactions` so earlier periods' spending can draw the
// fund down; without them the fund is taken as untouched.
export function budgetAmountForJob(job, profile, windowStart, transactions = []) {
  if (!windowStart) {
    return job.cadence === "once" ? Math.round(Number(job.amount || 0)) : recurringBudgetAmount(job, profile);
  }
  const recurring = job.cadence === "once" ? 0 : recurringBudgetAmount(job, profile);
  return recurring + jobFund(job, profile, transactions, windowStart).total;
}

// The part of that reserve paid out of THIS period's income: the recurring limit plus
// what was set aside during the period. A fund carried over was paid for by earlier
// periods, so it must not shrink this period's cupo a second time.
function incomeFundedAmount(job, profile, windowStart, transactions) {
  const recurring = job.cadence === "once" ? 0 : recurringBudgetAmount(job, profile);
  const fund = jobFund(job, profile, transactions, windowStart);
  return recurring + Math.max(0, Math.min(fund.total, fund.added));
}

// A fund that has been spent or released and has nothing left is dropped at a new
// period, so it stops cluttering the plan and counting toward the 10-category limit. One
// that still holds money is kept, period after period, until it is used. `retired`
// keeps each dropped category's name, so older movements still say what they were for.
export function pruneExpiredOneOffs(budgetJobs, windowStart, profile, transactions) {
  const retired = [];
  const kept = [];
  for (const job of budgetJobs || []) {
    if (!hasFund(job)) {
      kept.push(job);
      continue;
    }
    const fund = jobFund(job, profile, transactions, windowStart);
    const touchedThisPeriod = fundEvents(job).some((event) => !event.windowStart || event.windowStart >= windowStart);
    if (fund.total > 0 || touchedThisPeriod) {
      kept.push(job);
      continue;
    }
    if (job.cadence === "once") {
      retired.push({ id: job.id, name: job.name });
      continue;
    }
    // A recurring category whose extra fund ran out: keep the category, drop the history.
    kept.push({ ...job, topUps: [], released: [] });
  }
  return { budgetJobs: kept, retired };
}

function recurringBudgetAmount(job, profile) {
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
  const window = budgetWindow(state.profile, today);
  const jobBudgets = state.budgetJobs.map((job) => ({
    id: job.id,
    isSavings: isSavingsJob(job),
    budget: budgetAmountForJob(job, state.profile, window.start, state.transactions),
    fromIncome: incomeFundedAmount(job, state.profile, window.start, state.transactions),
    spent: spent[job.id] || 0
  }));
  const reserved = jobBudgets.reduce((sum, job) => sum + job.budget, 0);
  // What this period's income has to cover. Funds carried over from earlier periods are
  // still reserved (above) but were already paid for, so they don't shrink the cupo.
  const incomeReserved = jobBudgets.reduce((sum, job) => sum + job.fromIncome, 0);
  const carriedReserved = reserved - incomeReserved;
  const savingsReserved = jobBudgets.filter((job) => job.isSavings).reduce((sum, job) => sum + job.budget, 0);
  const savingsRemaining = jobBudgets
    .filter((job) => job.isSavings)
    .reduce((sum, job) => sum + Math.max(0, job.budget - job.spent), 0);
  // Only what this period set aside for savings counts toward this period's suggestion;
  // savings carried from earlier periods must not make the advisor ask for less now.
  const savingsRemainingThisPeriod = jobBudgets
    .filter((job) => job.isSavings)
    .reduce((sum, job) => sum + Math.max(0, Math.min(job.fromIncome, job.budget - job.spent)), 0);
  const expenseReserved = reserved - savingsReserved;
  const reservedSpent = jobBudgets.reduce((sum, job) => sum + Math.min(job.spent, job.budget), 0);
  const reservedRemaining = jobBudgets.reduce((sum, job) => sum + Math.max(0, job.budget - job.spent), 0);
  const categoryOverspent = jobBudgets.reduce((sum, job) => sum + Math.max(0, job.spent - job.budget), 0);
  const freeBudget = Math.max(0, income - incomeReserved);
  const freeSpent = spent[FREE_CATEGORY_ID] || 0;
  const totalSpent = Object.values(spent).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const freeImpactSpent = freeSpent + categoryOverspent;
  // What is owed on the card is subtracted: that money is already spoken for even while
  // it sits in the account. Otherwise paying by card would not lower free money, and the
  // app would report more than the user has right after spending.
  const liquidityTotal = state.liquidity?.initialized
    ? Number(state.liquidity.account || 0) +
      Number(state.liquidity.cash || 0) -
      Math.max(0, Number(state.liquidity.credit || 0))
    : 0;
  // Real money in account/cash that no category currently claims. Purely
  // informational (never summed into freeRemaining below): it's what "Saldo extra
  // sin usar" shows for variable-income users, since for them there is no reliable
  // signal telling us whether this figure already contains this period's income.
  const unclaimedLiquidity = Math.max(0, liquidityTotal - reservedRemaining);

  // For users with a fixed, scheduled income (state.profile.incomeType === "fixed"),
  // "dinero libre" is ALWAYS the real money in account/cash minus what's reserved in
  // categories — never a planning promise. Before payday, that's just whatever real
  // money already exists (the period's income genuinely isn't there yet, so nothing
  // to add). On payday, app.js's ensurePeriodIncomeApplication() deposits the period's
  // income into real liquidity once (with an undoable confirmation banner) — and
  // because the formula never changes, that single deposit is reflected automatically,
  // with no risk of ever counting it twice. The period's cupo (freeBudget) still
  // exists for sizing new categories, but is reported separately, informational only,
  // never merged into freeRemaining for fixed income.
  const periodIncomeStatus = state.periodIncomeStatus;
  const scheduleMatchesWindow = periodIncomeStatus && periodIncomeStatus.windowStart === window.start;
  const hasFixedIncomeSchedule = state.profile.incomeType === "fixed";
  const incomeApplied = hasFixedIncomeSchedule && scheduleMatchesWindow && Boolean(periodIncomeStatus.applied);
  // Only switch to the real-money formula once the user actually entered a real
  // balance (onboarding always sets this). Without it there is no "real balance" to
  // speak of, so the original planning quota is the only sensible number to show.
  const usesLiquidityBasedFree = hasFixedIncomeSchedule && Boolean(state.liquidity?.initialized);

  const freeRemaining = usesLiquidityBasedFree
    ? Math.max(0, liquidityTotal - reservedRemaining)
    : Math.max(0, freeBudget - freeImpactSpent);

  return {
    baseIncome,
    extraIncome,
    income,
    reserved,
    incomeReserved,
    carriedReserved,
    savingsReserved,
    savingsRemaining,
    savingsRemainingThisPeriod,
    expenseReserved,
    reservedSpent,
    reservedRemaining,
    categoryOverspent,
    freeBudget,
    freeSpent,
    totalSpent,
    freeImpactSpent,
    unclaimedLiquidity,
    liquidityTotal,
    hasFixedIncomeSchedule,
    usesLiquidityBasedFree,
    incomeApplied,
    freeRemaining,
    overReserved: Math.max(0, incomeReserved - income),
    months: getPeriodMonths(state.profile),
    weeks: getPeriodWeeks(state.profile),
    cadence: getIncomeCadence(state.profile),
    cadenceLabel: cadenceLabel(getIncomeCadence(state.profile)),
    window
  };
}

export function predictUntilNextPeriod(state, today) {
  const summary = budgetSummary(state, today);
  const currentKey = today ? String(today).slice(0, 10) : dateKey(new Date());
  const totalDays = Math.max(1, daysBetween(summary.window.start, summary.window.end));
  const observedDays = Math.max(1, Math.min(totalDays, daysBetween(summary.window.start, currentKey) + 1));
  const remainingDays = Math.max(0, totalDays - observedDays);
  const minimumObservedDays = predictionMinimumObservedDays(totalDays);
  const pace = freeImpactForPrediction(state, summary, today);
  const freeToday = Math.round(summary.freeRemaining);
  const hasObservedPace = pace.observedFreeSpent > 0;
  const hasReliablePace = hasObservedPace && observedDays >= minimumObservedDays;
  const observedDailyRate = hasObservedPace ? pace.observedFreeSpent / observedDays : 0;
  const dailyRate = hasReliablePace ? observedDailyRate : 0;
  const projectedRemainingSpend = Math.round(dailyRate * remainingDays);
  const projectedEndFree = Math.round(freeToday - projectedRemainingSpend);
  const shortage = Math.max(0, -projectedEndFree);
  const tightThreshold = Math.round(summary.income * LARGE_PURCHASE_RATIO);
  let status = "healthy";
  let confidence = hasReliablePace ? "normal" : "learning";

  if (summary.overReserved > 0) {
    status = "over_reserved";
    confidence = "normal";
  } else if (freeToday < 0) {
    status = "risk";
    confidence = hasReliablePace ? "normal" : hasObservedPace ? "learning" : "empty";
  } else if (!hasObservedPace) {
    status = "empty";
    confidence = "empty";
  } else if (!hasReliablePace && remainingDays > 0) {
    status = "learning";
  } else if (projectedEndFree < 0) {
    status = "risk";
  } else if (remainingDays > 0 && projectedEndFree < tightThreshold) {
    status = "tight";
  }

  return {
    window: summary.window,
    totalDays,
    observedDays,
    remainingDays,
    minimumObservedDays,
    periodIncome: summary.income,
    extraIncome: summary.extraIncome,
    freeBudget: summary.freeBudget,
    reserved: summary.reserved,
    incomeReserved: summary.incomeReserved,
    carriedReserved: summary.carriedReserved,
    overReserved: summary.overReserved,
    freeSpent: summary.freeSpent,
    categoryOverspent: summary.categoryOverspent,
    actualFreeImpactSpent: summary.freeImpactSpent,
    unclaimedLiquidity: summary.unclaimedLiquidity,
    liquidityTotal: summary.liquidityTotal,
    reservedRemaining: summary.reservedRemaining,
    hasFixedIncomeSchedule: summary.hasFixedIncomeSchedule,
    usesLiquidityBasedFree: summary.usesLiquidityBasedFree,
    incomeApplied: summary.incomeApplied,
    freeToday,
    observedFreeSpent: pace.observedFreeSpent,
    ignoredOneOffSpent: pace.ignoredOneOffSpent,
    observedDailyRate,
    dailyRate,
    projectedRemainingSpend,
    projectedEndFree,
    shortage,
    tightThreshold,
    status,
    confidence
  };
}

function predictionMinimumObservedDays(totalDays) {
  if (totalDays >= 90) {
    return 7;
  }
  return Math.min(3, totalDays);
}

function freeImpactForPrediction(state, summary, today) {
  const validCategoryIds = new Set((state.budgetJobs || []).map((job) => job.id));
  const window = budgetWindow(state.profile, today);
  const spent = {};
  let ignoredOneOffSpent = 0;

  (state.transactions || [])
    .filter((transaction) => isDateInWindow(transaction.date, window))
    .forEach((transaction) => {
      const amount = Number(transaction.amount || 0);
      if (transaction.oneOff || transaction.excludeFromPrediction) {
        ignoredOneOffSpent += amount;
        return;
      }
      const category =
        transaction.labeled && validCategoryIds.has(transaction.category)
          ? transaction.category
          : FREE_CATEGORY_ID;
      spent[category] = (spent[category] || 0) + amount;
    });

  const categoryOverspent = (state.budgetJobs || []).reduce((sum, job) => {
    const used = spent[job.id] || 0;
    const budget = budgetAmountForJob(job, state.profile, window.start, state.transactions);
    return sum + Math.max(0, used - budget);
  }, 0);
  const observedFreeSpent = (spent[FREE_CATEGORY_ID] || 0) + categoryOverspent;

  return {
    observedFreeSpent,
    ignoredOneOffSpent,
    actualFreeImpactSpent: summary.freeImpactSpent
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

// A category is savings when its name says so. "emergencia" alone is NOT enough: that
// used to match "Emergencia médica" (a real, recurring expense) and count it as savings,
// taking it out of expenses and inflating both free money and projected savings. Only
// the savings phrasings people actually use for an emergency fund count.
// \p{L} lookarounds instead of \b: JS's \b is ASCII-only, so an accented letter
// counted as a word boundary and "Bufferías" matched "buffer".
const SAVINGS_NAME_PATTERN =
  /(?<!\p{L})ahorr|fondo\s+de\s+emergencia|(?<!\p{L})emergency\s+fund|(?<!\p{L})buffer(?!\p{L})|(?<!\p{L})colch[oó]n(?!\p{L})/iu;

export function isSavingsJob(job) {
  return SAVINGS_NAME_PATTERN.test(String(job?.name || ""));
}

export function extraIncomeForPeriod(state, today) {
  const window = budgetWindow(state.profile, today);
  return (state.budgetExtras || [])
    .filter((extra) => isDateInWindow(extra.date, window))
    .reduce((sum, extra) => sum + Number(extra.amount || 0), 0);
}

export function categoryStatus(state, today) {
  const spent = spendByCategory(state, today);
  const windowStart = budgetWindow(state.profile, today).start;
  return state.budgetJobs.map((job) => {
    const used = spent[job.id] || 0;
    const budget = budgetAmountForJob(job, state.profile, windowStart, state.transactions);
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
  const window = budgetWindow(state.profile, today);
  return state.transactions
    .filter((transaction) => isDateInWindow(transaction.date, window))
    .reduce((acc, transaction) => {
      const category =
        transaction.labeled && validCategoryIds.has(transaction.category)
          ? transaction.category
          : FREE_CATEGORY_ID;
      acc[category] = (acc[category] || 0) + Number(transaction.amount || 0);
      return acc;
    }, {});
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

// Takes an already-computed window instead of (profile, today) so callers that filter
// an array of transactions/extras compute budgetWindow() once, not once per item —
// budgetWindow() walks the period cadence forward from periodStart to find today's
// window, so recomputing it per item made filtering an O(n * periods-since-start) scan.
export function isDateInWindow(dateValue, window) {
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

// The ledger entry (if any) for a pay period whose date range contains `today`.
// Looked up by date overlap, not by exact windowStart: editing periodStart/cadence
// recomputes window.start for what is still the same real-world pay period, and an
// equality lookup would treat that edit as a new, never-paid period.
export function findLoggedIncome(ledger, today) {
  return (ledger || []).find((entry) => today >= entry.windowStart && today < entry.windowEnd);
}

// Decides this period's fixed-income deposit without touching `state`. Returns the next
// periodIncomeStatus / periodIncomeApplied and `deposit`, the amount the caller must add
// to the real "account" balance (0 when nothing is due). For fixed income, periodStart
// doubles as the payday: the income is deposited once, the day the period begins —
// unless the user already rejected it ("aún no me pagan") or it was already logged.
// Onboarding asks "¿Cuánto tienes hoy?", so the balance typed there already includes this
// period's pay if it arrived. Without settling the current period, resolvePeriodIncome()
// saw an unpaid period and deposited the income on top: paid biweekly, signing up 5 days
// after payday with $500.000 typed, the user started at $1.700.000. The period is logged
// as applied with amount 0 (nothing was deposited, so undoing takes nothing back); the
// next payday still deposits as usual.
export function settlePeriodIncomeAtOnboarding(profile, today, nowIso = new Date().toISOString()) {
  const window = budgetWindow(profile, today);
  return {
    periodIncomeStatus: {
      windowStart: window.start,
      applied: true,
      rejected: false,
      bannerDismissed: true,
      amount: 0,
      location: "account",
      appliedAt: nowIso
    },
    periodIncomeApplied: [{ windowStart: window.start, windowEnd: window.end, status: "applied", amount: 0, appliedAt: nowIso }]
  };
}

export function resolvePeriodIncome(state, today, nowIso = new Date().toISOString()) {
  const window = budgetWindow(state.profile, today);
  const ledger = state.periodIncomeApplied || [];
  const logged = findLoggedIncome(ledger, today);
  let status = state.periodIncomeStatus;

  if (!status || status.windowStart !== window.start) {
    status = logged
      ? {
          windowStart: window.start,
          applied: logged.status === "applied",
          rejected: logged.status === "rejected",
          bannerDismissed: true,
          amount: logged.amount || 0,
          location: logged.status === "applied" ? "account" : null,
          appliedAt: logged.appliedAt
        }
      : { windowStart: window.start, applied: false, rejected: false, bannerDismissed: false, amount: 0, location: null };
  }

  // budgetWindow() rolls periodStart forward OR backward to the window containing today,
  // so a payday typed as "in 7 days" (weekly) resolves to window.start === today. If the
  // RAW date the user typed is still in the future, the first payday hasn't arrived.
  const rawPeriodStart = /^\d{4}-\d{2}-\d{2}$/.test(String(state.profile.periodStart || ""))
    ? String(state.profile.periodStart)
    : "";
  const paydayArrived = !rawPeriodStart || rawPeriodStart <= today;
  const amount = getPeriodIncome(state.profile);
  const due =
    state.profile.incomeType === "fixed" && paydayArrived && !status.applied && !status.rejected && !logged && amount > 0;

  if (!due) {
    return { periodIncomeStatus: status, periodIncomeApplied: ledger, deposit: 0 };
  }

  return {
    periodIncomeStatus: { ...status, applied: true, bannerDismissed: false, amount, location: "account", appliedAt: nowIso },
    // Only entries that could still overlap "today" after a plausible date edit matter
    // for the duplicate-deposit guard; keep the ledger bounded.
    periodIncomeApplied: [...ledger, { windowStart: window.start, windowEnd: window.end, status: "applied", amount, appliedAt: nowIso }].slice(-12),
    deposit: amount
  };
}

// Share of this period's budget that is still free, for the "N% sigue libre" note.
// For fixed income with a real balance on file, "libre" is the real balance minus
// reserves, which can exceed the period budget (money carried over from before) —
// that still means none of the budget is used, so it caps at 100% instead of "125%".
export function freeShareOfBudget(summary) {
  const income = Math.max(1, Number(summary?.income || 0));
  const share = Math.round((Number(summary?.freeRemaining || 0) / income) * 100);
  return Math.min(100, Math.max(0, share));
}
