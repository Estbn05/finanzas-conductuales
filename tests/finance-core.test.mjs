import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetAmountForJob,
  budgetRingAllocation,
  budgetSummary,
  pruneExpiredOneOffs,
  budgetWindow,
  calculatePlan,
  categoryStatus,
  extraIncomeForPeriod,
  getEmergencyTarget,
  isLargeUnbudgetedPurchase,
  freeShareOfBudget,
  isSavingsJob,
  predictUntilNextPeriod,
  resolvePeriodIncome,
  settlePeriodIncomeAtOnboarding
} from "../finance-core.js";

// El saldo real (cuenta + efectivo, seguido en app.js via adjustLiquidity) es un
// ledger vivo. Para ingreso VARIABLE es independiente del cupo (freeBudget), que sigue
// siendo la unica fuente de "dinero libre". Para ingreso FIJO con saldo ya registrado,
// "dinero libre" es directamente el saldo real menos lo reservado — nunca una promesa
// sumada encima — para evitar el bug que motivo este diseno: sumar cupo + saldo real
// duplicaba el dinero cuando el saldo ya incluia el sueldo depositado (caso real:
// $24.100 se volvio $48.200).
test("freeRemaining stays income-only when liquidity was never initialized", () => {
  const state = makeState({
    budgetJobs: [{ id: "food", name: "Mercado", budget: 600_000 }]
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.usesLiquidityBasedFree, false);
  assert.equal(summary.unclaimedLiquidity, 0);
  assert.equal(summary.freeRemaining, summary.freeBudget - summary.freeImpactSpent);
});

test("fixed income with a real balance on file: freeRemaining is the real balance minus what categories reserve", () => {
  const state = makeState({
    budgetJobs: [
      { id: "food", name: "Mercado", budget: 600_000 },
      { id: "transport", name: "Transporte", budget: 300_000 }
    ],
    liquidity: { account: 1_000_000, cash: 200_000, initialized: true }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.usesLiquidityBasedFree, true);
  // reservedRemaining = 900_000 (nada gastado aun); saldo real = 1_200_000.
  assert.equal(summary.unclaimedLiquidity, 300_000);
  assert.equal(summary.freeRemaining, 300_000);
});

test("liquidity smaller than what categories still owe contributes zero, never a negative amount", () => {
  const state = makeState({
    budgetJobs: [
      { id: "food", name: "Mercado", budget: 600_000 },
      { id: "transport", name: "Transporte", budget: 300_000 }
    ],
    liquidity: { account: 500_000, cash: 0, initialized: true }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.unclaimedLiquidity, 0);
  assert.equal(summary.freeRemaining, 0);
});

test("freeBudget (room left to reserve into new categories) never includes liquidity", () => {
  const withLiquidity = budgetSummary(
    makeState({ liquidity: { account: 5_000_000, cash: 0, initialized: true } }),
    "2026-06-10"
  );
  const withoutLiquidity = budgetSummary(makeState(), "2026-06-10");

  assert.equal(withLiquidity.freeBudget, withoutLiquidity.freeBudget);
});

test("period close performance (freeFinal) always measures the planning quota, independent of freeRemaining's formula", () => {
  const summary = budgetSummary(
    makeState({ liquidity: { account: 5_000_000, cash: 0, initialized: true } }),
    "2026-06-10"
  );
  const freeFinal = Math.round(summary.freeBudget - summary.freeImpactSpent);

  // freeFinal reports on the PERIOD's planning performance; for fixed income,
  // freeRemaining is liquidity-based, so the two are expected to differ here.
  assert.notEqual(freeFinal, summary.freeRemaining);
});

test("prediction's freeToday always agrees with freeRemaining, whichever formula produced it", () => {
  const state = makeState({
    budgetJobs: [
      { id: "food", name: "Mercado", budget: 600_000 },
      { id: "transport", name: "Transporte", budget: 300_000 }
    ],
    liquidity: { account: 1_000_000, cash: 200_000, initialized: true }
  });
  const summary = budgetSummary(state, "2026-06-10");
  const prediction = predictUntilNextPeriod(state, "2026-06-10");

  assert.equal(prediction.unclaimedLiquidity, 300_000);
  assert.equal(prediction.freeToday, summary.freeRemaining);
});

// Regression for the exact bug reported: a $2,000 free/unclassified expense removed
// $4,000 from "dinero libre" once a real balance existed, because the expense was
// subtracted once via freeImpactSpent (planning tracker) AND again via the live
// liquidity drop. Fix: once freeRemaining is liquidity-based, it NEVER also reads
// freeImpactSpent, so every expense is counted exactly once (via the liquidity drop).
test("spending an unclassified expense never double-counts against dinero libre for fixed income", () => {
  const jobs = [];
  const today = "2026-06-10";

  const before = budgetSummary(
    makeState({ budgetJobs: jobs, liquidity: { account: 700_000, cash: 0, initialized: true } }),
    today
  );
  assert.equal(before.freeRemaining, 700_000);

  const after = budgetSummary(
    makeState({
      budgetJobs: jobs,
      liquidity: { account: 698_000, cash: 0, initialized: true },
      transactions: [{ date: today, amount: 2_000, category: "", labeled: false }]
    }),
    today
  );

  assert.equal(
    after.freeRemaining,
    before.freeRemaining - 2_000,
    "a $2,000 expense must remove exactly $2,000 from dinero libre, not $4,000"
  );
});

test("freeRemaining never adds freeBudget on top of liquidity, no matter how large the real balance is", () => {
  const state = makeState({
    budgetJobs: [{ id: "food", name: "Mercado", budget: 600_000 }],
    liquidity: { account: 50_000_000, cash: 0, initialized: true }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.freeRemaining, 50_000_000 - 600_000);
});

// Before payday is confirmed, fixed-income users with a real balance on file see ONLY
// that real balance as "libre" — the period's cupo is informational only (shown
// separately in the UI as "por recibir"), never merged in. This is the design the
// user explicitly chose: no promise counts as spendable until it's real money.
test("fixed income before payday shows only the real balance, never the cupo added on top", () => {
  const state = makeState({
    budgetJobs: [{ id: "food", name: "Mercado", budget: 600_000 }],
    liquidity: { account: 700_000, cash: 0, initialized: true },
    periodIncomeStatus: { windowStart: "2026-06-01", applied: false, rejected: false }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.incomeApplied, false);
  assert.equal(summary.freeRemaining, 700_000 - 600_000);
});

test("fixed income after payday is applied: freeRemaining reflects the deposited income through the real balance", () => {
  const state = makeState({
    budgetJobs: [{ id: "food", name: "Mercado", budget: 600_000 }],
    liquidity: { account: 2_450_000, cash: 0, initialized: true },
    periodIncomeStatus: {
      windowStart: "2026-06-01",
      applied: true,
      rejected: false,
      amount: 1_750_000,
      location: "account"
    }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.incomeApplied, true);
  // liquidityTotal (2_450_000) - reservedRemaining (600_000, nothing spent yet)
  assert.equal(summary.freeRemaining, 1_850_000);
});

test("spending after payday is applied never double-counts", () => {
  const jobs = [{ id: "food", name: "Mercado", budget: 600_000 }];
  const periodIncomeStatus = {
    windowStart: "2026-06-01",
    applied: true,
    rejected: false,
    amount: 1_750_000,
    location: "account"
  };

  const before = budgetSummary(
    makeState({ budgetJobs: jobs, liquidity: { account: 1_750_000, cash: 0, initialized: true }, periodIncomeStatus }),
    "2026-06-10"
  );
  const after = budgetSummary(
    makeState({
      budgetJobs: jobs,
      liquidity: { account: 1_748_000, cash: 0, initialized: true },
      transactions: [{ date: "2026-06-10", amount: 2_000, category: "", labeled: false }],
      periodIncomeStatus
    }),
    "2026-06-10"
  );

  assert.equal(
    after.freeRemaining,
    before.freeRemaining - 2_000,
    "a $2,000 expense must remove exactly $2,000, not double, once income has been applied"
  );
});

test("variable income never uses the liquidity-based formula, even with a real balance on file", () => {
  const state = makeState({
    profile: { incomeType: "variable" },
    budgetJobs: [{ id: "food", name: "Mercado", budget: 600_000 }],
    liquidity: { account: 700_000, cash: 0, initialized: true },
    periodIncomeStatus: { windowStart: "2026-06-01", applied: false, rejected: false }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.hasFixedIncomeSchedule, false);
  assert.equal(summary.usesLiquidityBasedFree, false);
  assert.equal(summary.freeRemaining, summary.freeBudget - summary.freeImpactSpent);
});

// A stale periodIncomeStatus record from a PREVIOUS period (windowStart mismatch)
// must never be read as "already applied" for the current period.
test("a periodIncomeStatus record from a previous period never counts as applied for the current one", () => {
  const state = makeState({
    budgetJobs: [{ id: "food", name: "Mercado", budget: 600_000 }],
    liquidity: { account: 700_000, cash: 0, initialized: true },
    periodIncomeStatus: { windowStart: "2026-05-01", applied: true, rejected: false, amount: 1_750_000 }
  });
  const summary = budgetSummary(state, "2026-06-10");

  assert.equal(summary.incomeApplied, false);
  // Still liquidity-based (fixed income + real balance on file), just not "applied".
  assert.equal(summary.freeRemaining, 700_000 - 600_000);
});

test("budget ring allocation is an exact non-overlapping partition of income", () => {
  const ring = budgetRingAllocation({
    income: 1_690_000,
    reservedRemaining: 1_124_000,
    totalSpent: 371_000
  });

  assert.deepEqual(ring, {
    reserved: 1_124_000,
    spent: 371_000,
    free: 195_000,
    outside: 0,
    total: 1_690_000
  });
});

test("budget ring reports spending outside the available budget separately", () => {
  const ring = budgetRingAllocation({
    income: 1_000_000,
    reservedRemaining: 800_000,
    totalSpent: 350_000
  });

  assert.equal(ring.reserved + ring.spent + ring.free, ring.total);
  assert.equal(ring.total, 1_000_000);
  assert.equal(ring.outside, 150_000);
});

function makeState(overrides = {}) {
  return {
    profile: {
      monthlyIncome: 6_000_000,
      incomeType: "fixed",
      volatility: "medium",
      committedExpenses: 1_600_000,
      emergencySavings: 2_000_000,
      financialAnxiety: 4,
      moneyScripts: {
        avoidance: 2
      },
      ...overrides.profile
    },
    budgetJobs: overrides.budgetJobs || [
      { id: "food", name: "Mercado", budget: 600_000 },
      { id: "transport", name: "Transporte", budget: 300_000 }
    ],
    budgetExtras: overrides.budgetExtras || [],
    transactions: overrides.transactions || [],
    liquidity: overrides.liquidity,
    periodIncomeStatus: overrides.periodIncomeStatus
  };
}

test("savings advisor recommends a feasible amount for the current period", () => {
  const plan = calculatePlan(makeState());

  assert.equal(plan.savingsRate, 20);
  assert.equal(plan.idealPeriodSavings, 1_200_000);
  assert.equal(plan.suggestedPeriodSavings, 1_200_000);
  assert.equal(plan.freeAfterSuggestion, 3_900_000);
  assert.equal(plan.emergencyTarget, 6_000_000);
});

test("variable high-volatility income increases precautionary savings", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        incomeType: "variable",
        volatility: "high"
      }
    }),
    "2026-06-10"
  );

  assert.equal(plan.savingsRate, 35);
  assert.equal(plan.idealPeriodSavings, 2_100_000);
  assert.match(plan.incomeNote, /volatilidad high/);
});

test("semester scholarship income is normalized and protects weekly fixed costs", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        incomeCadence: "semester",
        semesterIncome: 1_750_000,
        semesterMonths: 6,
        monthlyIncome: 0,
        incomeType: "variable",
        committedExpenses: 130_000
      },
      budgetJobs: []
    })
  );

  assert.equal(plan.income, 291_667);
  assert.ok(plan.expenses >= 130_000);
  assert.ok(plan.savings > 70_000);
  assert.equal(plan.idealPeriodSavings, 437_500);
});

test("remaining money in savings fields reduces the additional recommendation", () => {
  const plan = calculatePlan(
    makeState({
      budgetJobs: [
        { id: "food", name: "Mercado", amount: 600_000, cadence: "period" },
        { id: "savings", name: "Ahorro", amount: 300_000, cadence: "period" }
      ],
      transactions: [{ date: "2026-06-01", amount: 100_000, category: "savings", labeled: true }]
    }),
    "2026-06-10"
  );

  assert.equal(plan.savingsReserved, 200_000);
  assert.equal(plan.suggestedPeriodSavings, 1_000_000);
  assert.equal(plan.projectedPeriodSavings, 1_200_000);
});

test("advisor reports when the ideal amount does not fit the current budget", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        monthlyIncome: 1_000_000,
        committedExpenses: 900_000,
        emergencySavings: 0
      },
      budgetJobs: []
    })
  );

  assert.equal(plan.idealPeriodSavings, 200_000);
  assert.equal(plan.suggestedPeriodSavings, 100_000);
  assert.equal(plan.savingsCapacityGap, 100_000);
  assert.equal(getEmergencyTarget(makeState().profile), 6_000_000);
});

test("weekly cadence: plan.savings and plan.expenses stay in monthly units, matching plan.income", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        incomeCadence: "weekly",
        incomeAmount: 700_000,
        committedExpenses: 0,
        emergencySavings: 10_000_000
      },
      budgetJobs: []
    }),
    "2026-06-10"
  );

  // Before the fix, plan.savings was left in per-period units (weekly) while
  // plan.income is always monthly, so expenses = income - savings barely dented
  // the monthly income and "Ahorro proyectado" showed a number ~4.33x too small.
  assert.equal(plan.income, 3_033_333);
  assert.equal(plan.savings, 455_000);
  assert.equal(plan.expenses, 2_578_333);
  assert.equal(plan.savings + plan.expenses, plan.income);
});

test("biweekly cadence: plan.savings and plan.expenses stay in monthly units, matching plan.income", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        incomeCadence: "biweekly",
        incomeAmount: 1_400_000,
        committedExpenses: 0,
        emergencySavings: 10_000_000
      },
      budgetJobs: []
    }),
    "2026-06-10"
  );

  assert.equal(plan.income, 3_033_333);
  assert.equal(plan.savings, 455_000);
  assert.equal(plan.expenses, 2_578_333);
  assert.equal(plan.savings + plan.expenses, plan.income);
});

test("category status only counts labeled transactions in the current budget period", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_750_000,
      semesterStart: "2026-05-01",
      semesterMonths: 6
    },
    budgetJobs: [
      { id: "food", name: "Mercado", amount: 600_000, cadence: "semester" },
      { id: "transport", name: "Transporte", amount: 300_000, cadence: "semester" }
    ],
    transactions: [
      { date: "2026-05-03", amount: 450_000, category: "food", labeled: true },
      { date: "2026-05-04", amount: 120_000, category: "transport", labeled: false },
      { date: "2026-04-29", amount: 300_000, category: "food", labeled: true }
    ]
  });

  const categories = categoryStatus(state, "2026-05-27");
  const food = categories.find((category) => category.id === "food");
  const transport = categories.find((category) => category.id === "transport");
  const summary = budgetSummary(state, "2026-05-27");

  assert.equal(food.spent, 450_000);
  assert.equal(food.band, "warning");
  assert.equal(transport.spent, 0);
  assert.equal(transport.band, "good");
  assert.equal(summary.freeSpent, 120_000);
});

// Regression: a category creation form must validate the new job's converted cost
// against freeRemaining (what the user actually sees as "Libre"), not freeBudget (the
// gross quota before subtracting money already spent unclassified this period).
// Real-world case: monthly income $1,000,000, $350,000 already spent unclassified
// (Libre showed $650,000), then a weekly "gasolina" category of $200,000 was created.
// $200,000 * (52/12 weeks) = $866,667, comfortably under freeBudget ($1,000,000) but
// far above the true $650,000 available — creating it silently clamped Libre to $0
// instead of being rejected with a clear "not enough libre" error.
test("a category whose converted cost fits freeBudget but exceeds freeRemaining must be rejected, not silently clamp Libre to zero", () => {
  const state = makeState({
    profile: { incomeType: "variable", incomeCadence: "monthly", monthlyIncome: 1_000_000, incomeAmount: 1_000_000 },
    budgetJobs: [],
    transactions: [{ date: "2026-06-05", amount: 350_000, category: "", labeled: false }]
  });
  const before = budgetSummary(state, "2026-06-10");
  assert.equal(before.freeBudget, 1_000_000);
  assert.equal(before.freeRemaining, 650_000, "Libre shown to the user before creating the category");

  const gasolina = { amount: 200_000, cadence: "weekly" };
  const converted = budgetAmountForJob(gasolina, state.profile);
  assert.equal(converted, 866_667, "200,000/week * 52/12 weeks in a monthly period");

  // The bug: this fits under freeBudget...
  assert.ok(converted < before.freeBudget, "fits the gross quota - this is exactly what let it slip through");
  // ...but it does NOT fit what's truly left to reserve (freeRemaining).
  assert.ok(converted > before.freeRemaining, "the category must be rejected against this number instead");

  // If it were wrongly created anyway, Libre would clamp to 0 instead of going negative.
  const after = budgetSummary(
    makeState({
      profile: state.profile,
      budgetJobs: [{ id: "gas", name: "Gasolina", ...gasolina }],
      transactions: state.transactions
    }),
    "2026-06-10"
  );
  assert.equal(after.freeRemaining, 0, "demonstrates the silent clamp the fixed validation must prevent from ever being reached");
});

test("weekly fields reserve the whole semester from the scholarship budget", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      semesterIncome: 1_750_000,
      semesterMonths: 6,
      semesterStart: "2026-05-01"
    },
    budgetJobs: [
      { id: "gas", name: "Gasolina moto", amount: 30_000, cadence: "weekly" },
      { id: "dates", name: "Salidas", amount: 45_000, cadence: "monthly" }
    ],
    transactions: [{ date: "2026-05-03", amount: 30_000, category: "gas", labeled: true }]
  });

  assert.equal(budgetAmountForJob(state.budgetJobs[0], state.profile), 780_000);
  const summary = budgetSummary(state, "2026-05-27");
  assert.equal(summary.reserved, 1_050_000);
  assert.equal(summary.freeBudget, 700_000);

  const gas = categoryStatus(state, "2026-05-27").find((category) => category.id === "gas");
  assert.equal(gas.spent, 30_000);
  assert.equal(Math.round(gas.ratio), 4);
});

test("reserved spending does not reduce free money a second time", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_750_000,
      periodStart: "2026-05-01"
    },
    budgetJobs: [{ id: "gas", name: "Gasolina", amount: 30_000, cadence: "weekly" }],
    transactions: [
      { date: "2026-05-03", amount: 30_000, category: "gas", labeled: true },
      { date: "2026-05-04", amount: 40_000, category: "free", labeled: true }
    ]
  });

  const summary = budgetSummary(state, "2026-05-20");
  const gas = categoryStatus(state, "2026-05-20").find((category) => category.id === "gas");

  assert.equal(summary.reserved, 780_000);
  assert.equal(summary.freeBudget, 970_000);
  assert.equal(summary.freeSpent, 40_000);
  assert.equal(summary.totalSpent, 70_000);
  assert.equal(summary.freeImpactSpent, 40_000);
  assert.equal(summary.freeRemaining, 930_000);
  assert.equal(gas.spent, 30_000);
  assert.equal(summary.reservedRemaining, 750_000);
  assert.equal(summary.categoryOverspent, 0);
});

test("a planned cash expense within its category leaves free semester money unchanged", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_690_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [
      { id: "gas", name: "Gasolina", amount: 780_000, cadence: "period" },
      { id: "other-plans", name: "Otros campos", amount: 593_000, cadence: "period" }
    ],
    transactions: [{ date: "2026-06-05", amount: 30_000, category: "gas", labeled: true, source: "cash" }]
  });

  const summary = budgetSummary(state, "2026-06-05");

  assert.equal(summary.freeBudget, 317_000);
  assert.equal(summary.totalSpent, 30_000);
  assert.equal(summary.freeImpactSpent, 0);
  assert.equal(summary.freeRemaining, 317_000);
});

test("gasoline reserved spending does not lower the screenshot free balance", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_705_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [
      { id: "gas", name: "Gasolina", amount: 780_000, cadence: "period" },
      { id: "soat", name: "Soat", amount: 344_000, cadence: "period" }
    ],
    transactions: [
      { date: "2026-06-05", amount: 351_000, category: "free", labeled: true },
      { date: "2026-06-06", amount: 60_000, category: "gas", labeled: true }
    ]
  });

  const summary = budgetSummary(state, "2026-06-10");
  const ring = budgetRingAllocation(summary);

  assert.equal(summary.freeBudget, 581_000);
  assert.equal(summary.freeImpactSpent, 351_000);
  assert.equal(summary.freeRemaining, 230_000);
  assert.deepEqual(ring, {
    reserved: 1_064_000,
    spent: 411_000,
    free: 230_000,
    outside: 0,
    total: 1_705_000
  });
});

test("only category overspending and free spending reduce money available for new expenses", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_750_000,
      periodStart: "2026-05-01"
    },
    budgetJobs: [{ id: "gas", name: "Gasolina", amount: 30_000, cadence: "period" }],
    transactions: [
      { date: "2026-05-03", amount: 40_000, category: "gas", labeled: true },
      { date: "2026-05-04", amount: 20_000, category: "free", labeled: true }
    ]
  });

  const summary = budgetSummary(state, "2026-05-20");

  assert.equal(summary.freeBudget, 1_720_000);
  assert.equal(summary.freeSpent, 20_000);
  assert.equal(summary.categoryOverspent, 10_000);
  assert.equal(summary.totalSpent, 60_000);
  assert.equal(summary.freeImpactSpent, 30_000);
  assert.equal(summary.freeRemaining, 1_690_000);
});

test("unlabeled spending reduces free budget until it is classified", () => {
  const pending = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_690_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [{ id: "gas", name: "Gasolina", amount: 30_000, cadence: "period" }],
    transactions: [{ date: "2026-06-05", amount: 30_000, category: "", labeled: false }]
  });
  const classified = {
    ...pending,
    transactions: [{ date: "2026-06-05", amount: 30_000, category: "gas", labeled: true }]
  };

  assert.equal(budgetSummary(pending, "2026-06-05").freeSpent, 30_000);
  assert.equal(budgetSummary(pending, "2026-06-05").freeRemaining, 1_630_000);
  assert.equal(budgetSummary(classified, "2026-06-05").freeSpent, 0);
  assert.equal(budgetSummary(classified, "2026-06-05").freeRemaining, 1_660_000);
  assert.equal(categoryStatus(classified, "2026-06-05").find((category) => category.id === "gas").spent, 30_000);
});

test("spending assigned to a missing category is treated as free spending", () => {
  const state = makeState({
    profile: {
      incomeCadence: "monthly",
      incomeAmount: 1_000_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [{ id: "gas", name: "Gasolina", amount: 200_000, cadence: "period" }],
    transactions: [{ date: "2026-06-05", amount: 50_000, category: "deleted-category", labeled: true }]
  });

  const summary = budgetSummary(state, "2026-06-05");

  assert.equal(summary.freeBudget, 800_000);
  assert.equal(summary.freeSpent, 50_000);
  assert.equal(summary.freeRemaining, 750_000);
});

test("income cadence can be weekly biweekly monthly semester or yearly", () => {
  const state = makeState({
    profile: {
      incomeCadence: "biweekly",
      incomeAmount: 800_000,
      periodStart: "2026-05-01"
    },
    budgetJobs: [
      { id: "gas", name: "Gasolina", amount: 30_000, cadence: "weekly" },
      { id: "rent", name: "Arriendo", amount: 600_000, cadence: "monthly" }
    ]
  });

  const summary = budgetSummary(state, "2026-05-20");
  assert.equal(summary.income, 800_000);
  assert.equal(budgetAmountForJob(state.budgetJobs[0], state.profile), 60_000);
  assert.equal(budgetAmountForJob(state.budgetJobs[1], state.profile), 276_923);
  assert.equal(summary.window.start, "2026-05-15");
  assert.equal(summary.window.end, "2026-05-29");
});

test("monthly budget windows clamp end-of-month starts instead of skipping the next month", () => {
  assert.deepEqual(
    budgetWindow({ incomeCadence: "monthly", incomeAmount: 1_000_000, periodStart: "2026-01-31" }, "2026-02-15"),
    { start: "2026-01-31", end: "2026-02-28" }
  );
  assert.deepEqual(
    budgetWindow({ incomeCadence: "monthly", incomeAmount: 1_000_000, periodStart: "2026-01-31" }, "2026-03-01"),
    { start: "2026-02-28", end: "2026-03-31" }
  );
});

test("extra money increases only the current period budget", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      incomeAmount: 1_750_000,
      periodStart: "2026-05-01"
    },
    budgetJobs: [{ id: "gas", name: "Gasolina", amount: 30_000, cadence: "weekly" }],
    budgetExtras: [
      { id: "gift", source: "Regalo", amount: 80_000, date: "2026-05-10" },
      { id: "old", source: "Venta vieja", amount: 50_000, date: "2026-04-10" }
    ]
  });

  const summary = budgetSummary(state, "2026-05-20");

  assert.equal(extraIncomeForPeriod(state, "2026-05-20"), 80_000);
  assert.equal(summary.baseIncome, 1_750_000);
  assert.equal(summary.extraIncome, 80_000);
  assert.equal(summary.income, 1_830_000);
  assert.equal(summary.freeBudget, 1_050_000);
});

test("large unbudgeted purchases use the 8 percent cooling-off threshold", () => {
  assert.equal(isLargeUnbudgetedPurchase(159_000, 2_000_000), false);
  assert.equal(isLargeUnbudgetedPurchase(160_000, 2_000_000), true);
});

test("period prediction projects free money only after enough observed days", () => {
  const state = makeState({
    profile: {
      incomeCadence: "monthly",
      incomeAmount: 1_000_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [{ id: "gas", name: "Gasolina", amount: 300_000, cadence: "period" }],
    transactions: [
      { date: "2026-06-01", amount: 100_000, category: "free", labeled: true },
      { date: "2026-06-05", amount: 50_000, category: "gas", labeled: true }
    ]
  });

  const prediction = predictUntilNextPeriod(state, "2026-06-10");

  assert.equal(prediction.totalDays, 30);
  assert.equal(prediction.observedDays, 10);
  assert.equal(prediction.remainingDays, 20);
  assert.equal(prediction.minimumObservedDays, 3);
  assert.equal(prediction.confidence, "normal");
  assert.equal(prediction.observedFreeSpent, 100_000);
  assert.equal(prediction.observedDailyRate, 10_000);
  assert.equal(prediction.freeToday, 600_000);
  assert.equal(prediction.projectedRemainingSpend, 200_000);
  assert.equal(prediction.projectedEndFree, 400_000);
  assert.equal(prediction.status, "healthy");
});

test("period prediction does not extrapolate one early day across a semester", () => {
  const state = makeState({
    profile: {
      incomeCadence: "semester",
      semesterIncome: 5_000_000,
      semesterStart: "2026-06-19",
      semesterMonths: 6
    },
    budgetJobs: [],
    transactions: [{ date: "2026-06-19", amount: 30_100, category: "free", labeled: true }]
  });

  const prediction = predictUntilNextPeriod(state, "2026-06-19");

  assert.equal(prediction.observedDays, 1);
  assert.equal(prediction.minimumObservedDays, 7);
  assert.equal(prediction.confidence, "learning");
  assert.equal(prediction.observedFreeSpent, 30_100);
  assert.equal(prediction.dailyRate, 0);
  assert.equal(prediction.projectedRemainingSpend, 0);
  assert.equal(prediction.projectedEndFree, 4_969_900);
  assert.equal(prediction.status, "learning");
});

test("period prediction flags a likely shortfall", () => {
  const state = makeState({
    profile: {
      incomeCadence: "monthly",
      incomeAmount: 1_000_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [{ id: "fixed", name: "Fijos", amount: 600_000, cadence: "period" }],
    transactions: [
      { date: "2026-06-01", amount: 250_000, category: "free", labeled: true },
      { date: "2026-06-02", amount: 150_000, category: "free", labeled: true }
    ]
  });

  const prediction = predictUntilNextPeriod(state, "2026-06-03");

  assert.equal(prediction.projectedEndFree < 0, true);
  assert.equal(prediction.confidence, "normal");
  assert.equal(prediction.status, "risk");
  assert.equal(prediction.shortage, 3_600_000);
});

test("one-off spending lowers free money but does not affect the daily pace", () => {
  const state = makeState({
    profile: {
      incomeCadence: "monthly",
      incomeAmount: 1_000_000,
      periodStart: "2026-06-01"
    },
    budgetJobs: [],
    transactions: [{ date: "2026-06-05", amount: 300_000, category: "free", labeled: true, oneOff: true }]
  });

  const prediction = predictUntilNextPeriod(state, "2026-06-05");

  assert.equal(prediction.freeToday, 700_000);
  assert.equal(prediction.observedFreeSpent, 0);
  assert.equal(prediction.ignoredOneOffSpent, 300_000);
  assert.equal(prediction.dailyRate, 0);
  assert.equal(prediction.projectedEndFree, 700_000);
  assert.equal(prediction.status, "empty");
});

function incomeState(profile = {}, extra = {}) {
  return {
    profile: {
      incomeType: "fixed",
      incomeCadence: "monthly",
      incomeAmount: 2_000_000,
      periodStart: "2026-06-01",
      ...profile
    },
    periodIncomeStatus: null,
    periodIncomeApplied: [],
    ...extra
  };
}

const NOW = "2026-06-10T15:00:00.000Z";

test("fixed income is deposited once when the period's payday has arrived", () => {
  const result = resolvePeriodIncome(incomeState(), "2026-06-10", NOW);

  assert.equal(result.deposit, 2_000_000);
  assert.equal(result.periodIncomeStatus.applied, true);
  assert.equal(result.periodIncomeStatus.windowStart, "2026-06-01");
  assert.deepEqual(result.periodIncomeApplied, [
    { windowStart: "2026-06-01", windowEnd: "2026-07-01", status: "applied", amount: 2_000_000, appliedAt: NOW }
  ]);
});

test("resolving the same period again never deposits a second time", () => {
  const first = resolvePeriodIncome(incomeState(), "2026-06-10", NOW);
  const second = resolvePeriodIncome(
    incomeState({}, { periodIncomeStatus: first.periodIncomeStatus, periodIncomeApplied: first.periodIncomeApplied }),
    "2026-06-12",
    NOW
  );

  assert.equal(second.deposit, 0);
  assert.equal(second.periodIncomeApplied.length, 1);
});

// Regression: editing the payday in "Editar mi plan" moves window.start for what is still
// the same real-world pay period. Keying on exact windowStart treated that as a new,
// never-paid period and deposited the income again.
test("editing the payday date does not re-deposit income already logged for today", () => {
  const first = resolvePeriodIncome(incomeState(), "2026-06-10", NOW);
  const edited = resolvePeriodIncome(
    incomeState(
      { periodStart: "2026-06-05" },
      { periodIncomeStatus: first.periodIncomeStatus, periodIncomeApplied: first.periodIncomeApplied }
    ),
    "2026-06-10",
    NOW
  );

  assert.equal(edited.periodIncomeStatus.windowStart, "2026-06-05");
  assert.equal(edited.deposit, 0);
  assert.equal(edited.periodIncomeStatus.applied, true);
  assert.equal(edited.periodIncomeApplied.length, 1);
});

test("a period the user marked as 'aún no me pagan' stays undeposited after a payday edit", () => {
  const edited = resolvePeriodIncome(
    incomeState(
      { periodStart: "2026-06-05" },
      {
        periodIncomeApplied: [
          { windowStart: "2026-06-01", windowEnd: "2026-07-01", status: "rejected", amount: 2_000_000, appliedAt: NOW }
        ]
      }
    ),
    "2026-06-10",
    NOW
  );

  assert.equal(edited.deposit, 0);
  assert.equal(edited.periodIncomeStatus.rejected, true);
});

// Regression: budgetWindow() rolls a future periodStart BACK to the window containing
// today, so a payday typed as "in 5 days" looked like it had already happened.
test("a payday entered in the future is not deposited until that date arrives", () => {
  const before = resolvePeriodIncome(incomeState({ periodStart: "2026-06-15" }), "2026-06-10", NOW);
  const onPayday = resolvePeriodIncome(incomeState({ periodStart: "2026-06-15" }), "2026-06-15", NOW);

  assert.equal(before.deposit, 0);
  assert.equal(onPayday.deposit, 2_000_000);
});

test("variable income is never auto-deposited", () => {
  const result = resolvePeriodIncome(incomeState({ incomeType: "variable" }), "2026-06-10", NOW);

  assert.equal(result.deposit, 0);
  assert.equal(result.periodIncomeStatus.applied, false);
});

test("resolvePeriodIncome does not mutate the state it is given", () => {
  const state = incomeState();
  const snapshot = JSON.stringify(state);
  resolvePeriodIncome(state, "2026-06-10", NOW);

  assert.equal(JSON.stringify(state), snapshot);
});

test("the 'sigue libre' share never passes 100% even when real money exceeds the budget", () => {
  assert.equal(freeShareOfBudget({ income: 2_000_000, freeRemaining: 2_500_000 }), 100);
  assert.equal(freeShareOfBudget({ income: 2_000_000, freeRemaining: 500_000 }), 25);
  assert.equal(freeShareOfBudget({ income: 2_000_000, freeRemaining: 0 }), 0);
  assert.equal(freeShareOfBudget({ income: 0, freeRemaining: 0 }), 0);
});

// Regression: /ahorro|emergencia|buffer/ counted "Emergencia médica" (an expense) as
// savings, pulling it out of expenses and inflating free money and projected savings.
test("savings categories are recognized by name, but an emergency expense is not savings", () => {
  for (const name of ["Ahorro", "Ahorro viaje", "Ahorros", "Fondo de emergencia", "Buffer", "Colchón", "Ahorro extra"]) {
    assert.equal(isSavingsJob({ name }), true, name);
  }
  for (const name of ["Emergencia médica", "Emergencias del carro", "Mercado", "Gasolina", "Bufferías"]) {
    assert.equal(isSavingsJob({ name }), false, name);
  }
});

test("emergency progress stays between 0 and 100 even with no income on file", () => {
  const plan = calculatePlan(
    makeState({ profile: { monthlyIncome: 0, incomeAmount: 0, committedExpenses: 0, emergencySavings: 50_000_000 }, budgetJobs: [] })
  );
  assert.equal(plan.emergencyProgress, 100);
});

// Regression: onboarding asks for today's balance, which already includes this period's
// pay. Paid biweekly, signing up 5 days after payday with $500.000 typed used to deposit
// the $1.200.000 income on top.
test("the period a user onboards in is settled: their typed balance is not topped up", () => {
  const profile = { incomeCadence: "biweekly", incomeAmount: 1_200_000, periodStart: "2026-06-05" };
  const settled = settlePeriodIncomeAtOnboarding(incomeState(profile).profile, "2026-06-10", NOW);
  const now = resolvePeriodIncome(incomeState(profile, settled), "2026-06-10", NOW);
  assert.equal(now.deposit, 0);

  // Moving the payday inside the same real period must not sneak the deposit back in.
  const edited = resolvePeriodIncome(
    incomeState({ ...profile, periodStart: "2026-06-07" }, { periodIncomeStatus: now.periodIncomeStatus, periodIncomeApplied: now.periodIncomeApplied }),
    "2026-06-10",
    NOW
  );
  assert.equal(edited.deposit, 0);

  // The next payday still deposits on its own.
  const nextPayday = resolvePeriodIncome(
    incomeState(profile, { periodIncomeStatus: now.periodIncomeStatus, periodIncomeApplied: now.periodIncomeApplied }),
    "2026-06-19",
    NOW
  );
  assert.equal(nextPayday.deposit, 1_200_000);
});

test("what is owed on the card comes out of the real total", () => {
  const summary = budgetSummary(
    {
      profile: { incomeType: "fixed", incomeCadence: "monthly", incomeAmount: 1_000_000, periodStart: "2026-06-01" },
      liquidity: { account: 800_000, cash: 50_000, credit: 150_000, initialized: true },
      budgetJobs: [],
      transactions: [],
      budgetExtras: []
    },
    "2026-06-10"
  );
  assert.equal(summary.liquidityTotal, 700_000);
});

// Regression: "Apartar dinero" used to add to a recurring "per period" amount, so money
// set aside once was reserved again in every later period.
test("a one-off set-aside reserves only in its own period", () => {
  const profile = { incomeCadence: "monthly", incomeAmount: 1_000_000, periodStart: "2026-06-01" };
  const remedios = { id: "remedios", name: "Remedios", amount: 50_000, cadence: "once", windowStart: "2026-06-01" };
  assert.equal(budgetAmountForJob(remedios, profile, "2026-06-01"), 50_000);
  assert.equal(budgetAmountForJob(remedios, profile, "2026-07-01"), 0);

  const mercado = {
    id: "mercado",
    name: "Mercado",
    amount: 200_000,
    cadence: "period",
    topUps: [{ windowStart: "2026-06-01", amount: 30_000 }]
  };
  assert.equal(budgetAmountForJob(mercado, profile, "2026-06-01"), 230_000);
  assert.equal(budgetAmountForJob(mercado, profile, "2026-07-01"), 200_000, "the top-up leaked into the next period");

  const june = { profile, liquidity: { account: 0, cash: 0 }, budgetJobs: [remedios, mercado], transactions: [], budgetExtras: [] };
  assert.equal(budgetSummary(june, "2026-06-10").reserved, 280_000);
  assert.equal(budgetSummary(june, "2026-07-10").reserved, 200_000);
});

test("expired one-offs are dropped at a new period, keeping their names", () => {
  const jobs = [
    { id: "remedios", name: "Remedios", amount: 50_000, cadence: "once", windowStart: "2026-06-01" },
    { id: "mercado", name: "Mercado", amount: 200_000, cadence: "period", topUps: [{ windowStart: "2026-06-01", amount: 30_000 }] },
    { id: "viaje", name: "Viaje", amount: 90_000, cadence: "once", windowStart: "2026-07-01" }
  ];
  const { budgetJobs, retired } = pruneExpiredOneOffs(jobs, "2026-07-01");
  assert.deepEqual(budgetJobs.map((job) => job.id), ["mercado", "viaje"]);
  assert.deepEqual(budgetJobs[0].topUps, []);
  assert.deepEqual(retired, [{ id: "remedios", name: "Remedios" }]);
  assert.equal(pruneExpiredOneOffs(jobs, "2026-06-01").budgetJobs[1], jobs[1], "nothing to prune must keep the same objects");
});
