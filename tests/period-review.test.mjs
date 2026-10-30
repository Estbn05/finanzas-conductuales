import assert from "node:assert/strict";
import test from "node:test";
import { periodExportMarkdown, periodReview } from "../period-review.js";

const october = { start: "2026-10-01", end: "2026-11-01" };
const september = { start: "2026-09-01", end: "2026-10-01" };
const names = { food: "Mercado", gas: "Gasolina" };
const expense = (date, amount, overrides = {}) => ({ id: `${date}-${amount}`, date, amount, merchant: "D1", category: "food", labeled: true, source: "account", ...overrides });

const transactions = [
  expense("2026-09-01", 400_000),
  expense("2026-10-02", 100_000),
  expense("2026-10-05", 50_000, { merchant: "Terpel", category: "gas", source: "credit" }),
  expense("2026-10-09", 30_000, { merchant: "Rappi", category: "", labeled: false, source: "cash" }),
  expense("2026-10-20", 20_000, { merchant: "Rappi", labeled: false, category: "free" }),
  expense("2026-11-01", 999_000)
];

const review = periodReview({
  transactions,
  extras: [{ id: "x", date: "2026-10-15", amount: 80_000, source: "Angela" }],
  creditPayments: [{ id: "p", date: "2026-10-10", amount: 50_000, source: "account" }],
  window: october,
  previous: september,
  categoryName: (id) => names[id]
});

test("the period review adds up only this period, by category with unclassified apart", () => {
  assert.equal(review.spent, 200_000);
  assert.equal(review.expenseCount, 4);
  assert.deepEqual(
    review.categories.map((category) => [category.name, category.total, category.count]),
    [["Mercado", 100_000, 1], ["Gasolina", 50_000, 1], ["Sin categoría", 50_000, 2]]
  );
  assert.equal(review.categories[0].share, 0.5);
  assert.deepEqual(review.unclassified, { total: 50_000, count: 2, share: 0.25 });
  assert.equal(review.merchants[0].name, "D1");
  assert.equal(review.extraIncome, 80_000);
});

test("how it was paid, and the credit card's purchases and payments", () => {
  assert.deepEqual(review.paidWith, { account: 120_000, cash: 30_000, credit: 50_000, unknown: 0 });
  assert.deepEqual(review.credit, { purchases: 50_000, purchaseCount: 1, payments: 50_000, paymentCount: 1 });
});

test("compared with the period before, only when the app was in use for all of it", () => {
  assert.equal(review.previous.spent, 400_000);
  assert.equal(review.previous.change, -0.5);
  const first = periodReview({ transactions: transactions.slice(1), window: october, previous: september, categoryName: (id) => names[id] });
  assert.equal(first.previous.change, null);
  const partial = periodReview({ transactions: [expense("2026-09-20", 50_000), ...transactions.slice(1)], window: october, previous: september, categoryName: (id) => names[id] });
  assert.equal(partial.previous.change, null, "a period the app saw only part of is not compared");
});

test("the export is a Markdown document with every movement of the period, oldest first", () => {
  const markdown = periodExportMarkdown(review, {
    generatedOn: "2026-10-29",
    periodLabel: "1 de oct - 31 de oct",
    cadenceLabel: "Mensual",
    remainingDays: 2,
    pay: { amount: 1_500_000, status: "recibido" },
    free: { today: 137_653, projectedEnd: 90_000, reserved: 1_277_697 },
    balances: { account: 1_415_350, cash: 0, credit: 120_000 },
    plan: [{ name: "Mercado", budget: 80_000, spent: 100_000 }],
    savings: { reserved: 300_000, suggested: 400_000 },
    nextPeriod: { startLabel: "1 de nov", pay: 2_059_928, payReceived: true, recurring: 600_000, planned: 900_000 },
    movements: [
      { kind: "expense", date: "2026-10-09", amount: 30_000, detail: "Rappi | domicilio", category: "Sin categoría", source: "cash" },
      { kind: "income", date: "2026-10-15", amount: 80_000, detail: "Angela", location: "account" },
      { kind: "expense", date: "2026-10-02", amount: 100_000, detail: "D1", category: "Mercado", source: "account" }
    ],
    locationLabel: (value) => ({ account: "Cuenta", cash: "Efectivo", credit: "Tarjeta" })[value]
  });
  assert.match(markdown, /^# Mis finanzas: periodo 1 de oct - 31 de oct/);
  assert.match(markdown, /> Para una IA:/);
  assert.match(markdown, /\| Total gastado \| \$200\.000 en 4 gastos \|/);
  assert.match(markdown, /\| Periodo anterior \| \$400\.000 \(-50% este periodo\) \|/);
  assert.match(markdown, /\| Tarjeta de crédito \| \$50\.000 en 1 compra \|/);
  assert.match(markdown, /\| Mercado \| \$80\.000 \| \$100\.000 \| Excedida por \$20\.000 \|/);
  assert.match(markdown, /Sueldo: \$2\.059\.928, ya recibido \(llegó antes\)/);
  const rows = markdown.split("\n").filter((line) => /^\| 2026-10-/.test(line));
  assert.deepEqual(rows.map((row) => row.slice(2, 12)), ["2026-10-02", "2026-10-09", "2026-10-15"]);
  assert.match(rows[1], /\| Rappi \/ domicilio \|/, "a '|' in a note does not break the table");
  assert.match(rows[2], /\+\$80\.000 \|$/);
});
