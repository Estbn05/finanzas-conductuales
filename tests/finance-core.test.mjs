import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetAmountForJob,
  budgetSummary,
  calculatePlan,
  categoryStatus,
  extraIncomeForPeriod,
  getEmergencyTarget,
  isLargeUnbudgetedPurchase
} from "../finance-core.js";

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
    transactions: overrides.transactions || []
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

test("every registered expense reduces the amount available for new spending", () => {
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
  assert.equal(summary.freeRemaining, 900_000);
  assert.equal(gas.spent, 30_000);
  assert.equal(summary.reservedRemaining, 750_000);
  assert.equal(summary.categoryOverspent, 0);
});

test("a planned cash expense reduces free semester money from 317000 to 287000", () => {
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
  assert.equal(summary.freeRemaining, 287_000);
});

test("category spending and overspending both reduce money available for new expenses", () => {
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
  assert.equal(summary.freeImpactSpent, 60_000);
  assert.equal(summary.freeRemaining, 1_660_000);
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
  assert.equal(budgetSummary(classified, "2026-06-05").freeRemaining, 1_630_000);
  assert.equal(categoryStatus(classified, "2026-06-05").find((category) => category.id === "gas").spent, 30_000);
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
