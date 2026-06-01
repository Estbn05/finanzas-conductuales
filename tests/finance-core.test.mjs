import assert from "node:assert/strict";
import test from "node:test";
import {
  EMERGENCY_BASELINE,
  budgetAmountForJob,
  budgetSummary,
  calculatePlan,
  categoryStatus,
  isLargeUnbudgetedPurchase,
  minimumDebtPayments,
  shouldUseDebtExposureMode,
  sortedDebts
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
    settings: {
      emergencyAutoDefault: true,
      ...overrides.settings
    },
    budgetJobs: overrides.budgetJobs || [
      { id: "food", name: "Mercado", budget: 600_000 },
      { id: "transport", name: "Transporte", budget: 300_000 }
    ],
    debts: overrides.debts || [
      { id: "card", name: "Tarjeta", balance: 1_200_000, minimum: 120_000 },
      { id: "loan", name: "Prestamo", balance: 3_800_000, minimum: 260_000 }
    ],
    transactions: overrides.transactions || []
  };
}

test("fixed income with active debt follows the 1/3 allocation", () => {
  const plan = calculatePlan(makeState());

  assert.equal(plan.debt, 2_000_000);
  assert.equal(plan.savings, 2_000_000);
  assert.equal(plan.expenses, 2_000_000);
  assert.equal(plan.emergencyGap, EMERGENCY_BASELINE - 2_000_000);
  assert.equal(plan.dayFiveSweep, 1_000_000);
});

test("variable high-volatility income increases precautionary savings", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        incomeType: "variable",
        volatility: "high"
      }
    })
  );

  assert.ok(plan.savings > 2_000_000);
  assert.match(plan.incomeNote, /alpha 1\.32/);
});

test("semester scholarship income is normalized and protects weekly fixed costs", () => {
  const plan = calculatePlan(
    makeState({
      profile: {
        incomeCadence: "semester",
        semesterIncome: 1_750_000,
        semesterMonths: 6,
        monthlyIncome: 0,
        committedExpenses: 130_000
      },
      debts: []
    })
  );

  assert.equal(plan.income, 291_667);
  assert.ok(plan.expenses >= 130_000);
  assert.ok(plan.savings > 70_000);
  assert.match(plan.incomeNote, /Ingreso semestral/);
});

test("when debt is gone, the debt third is redirected to savings and expenses", () => {
  const plan = calculatePlan(
    makeState({
      debts: []
    })
  );

  assert.equal(plan.debt, 0);
  assert.ok(plan.savings > 2_000_000);
  assert.ok(plan.expenses > 2_000_000);
});

test("debt snowball orders accounts by smallest balance first", () => {
  const debts = sortedDebts(
    makeState({
      debts: [
        { id: "large", name: "Large", balance: 4_000_000, minimum: 200_000 },
        { id: "small", name: "Small", balance: 250_000, minimum: 50_000 },
        { id: "closed", name: "Closed", balance: 0, minimum: 0 }
      ]
    })
  );

  assert.deepEqual(
    debts.map((debt) => debt.id),
    ["small", "large"]
  );
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

  assert.equal(food.spent, 450_000);
  assert.equal(food.band, "warning");
  assert.equal(transport.spent, 0);
  assert.equal(transport.band, "good");
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

test("high anxiety or avoidance enables gradual debt exposure", () => {
  assert.equal(shouldUseDebtExposureMode(makeState()), false);
  assert.equal(
    shouldUseDebtExposureMode(
      makeState({
        profile: {
          financialAnxiety: 8
        }
      })
    ),
    true
  );
  assert.equal(
    shouldUseDebtExposureMode(
      makeState({
        profile: {
          moneyScripts: {
            avoidance: 4
          }
        }
      })
    ),
    true
  );
});

test("large unbudgeted purchases use the 8 percent cooling-off threshold", () => {
  assert.equal(isLargeUnbudgetedPurchase(159_000, 2_000_000), false);
  assert.equal(isLargeUnbudgetedPurchase(160_000, 2_000_000), true);
  assert.equal(minimumDebtPayments(makeState()), 380_000);
});
