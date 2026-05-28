import assert from "node:assert/strict";
import test from "node:test";
import {
  EMERGENCY_BASELINE,
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

test("category status only counts labeled transactions in the current month", () => {
  const state = makeState({
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
