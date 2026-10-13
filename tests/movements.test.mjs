import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryTrend,
  dailyExpenseTotal,
  dailyTotals,
  datesInWindow,
  expenseCalendar,
  listMovements,
  merchantTotals,
  movementsCsv,
  periodMovements,
  previousWindow,
  smallExpenses,
  weekdayOffset,
  weekdayPattern
} from "../movements.js";

const october = { start: "2026-10-01", end: "2026-11-01" };

function expense(overrides) {
  return { id: `t-${Math.random()}`, date: "2026-10-05", amount: 10_000, merchant: "Tienda", category: "", labeled: false, source: "account", ...overrides };
}

test("a period's movements are its expenses and extra income, and nothing from other periods", () => {
  const movements = periodMovements(
    [expense({ id: "in", date: "2026-10-31" }), expense({ id: "before", date: "2026-09-30" }), expense({ id: "after", date: "2026-11-01" })],
    [{ id: "bono", date: "2026-10-15", amount: 300_000, source: "Bono" }],
    october
  );
  assert.deepEqual(
    movements.map((movement) => [movement.id, movement.kind]),
    [
      ["in", "expense"],
      ["bono", "income"]
    ]
  );
});

test("Movimientos filters by kind, category, unclassified, text and day, and sorts by date or amount", () => {
  const movements = periodMovements(
    [
      expense({ id: "mercado", date: "2026-10-03", amount: 80_000, merchant: "Éxito", category: "mercado", labeled: true }),
      expense({ id: "taxi", date: "2026-10-05", amount: 12_000, merchant: "Taxi", description: "al aeropuerto" }),
      expense({ id: "libre", date: "2026-10-05", amount: 5_000, merchant: "Café", category: "free", labeled: true })
    ],
    [{ id: "bono", date: "2026-10-04", amount: 300_000, source: "Bono trabajo" }],
    october
  );
  const ids = (options) => listMovements(movements, options).map((movement) => movement.id);

  assert.deepEqual(ids({}), ["taxi", "libre", "bono", "mercado"]);
  assert.deepEqual(ids({ sort: "amount" }), ["bono", "mercado", "taxi", "libre"]);
  assert.deepEqual(ids({ filter: "income" }), ["bono"]);
  assert.deepEqual(ids({ filter: "expense", sort: "amount" }), ["mercado", "taxi", "libre"]);
  assert.deepEqual(ids({ filter: "cat:mercado" }), ["mercado"]);
  // Never classified and classified as "libre" both count as unclassified; income never does.
  assert.deepEqual(ids({ filter: "uncategorized", sort: "amount" }), ["taxi", "libre"]);
  // Search looks at the merchant, the note and the origin of income, ignoring case.
  assert.deepEqual(ids({ search: "AEROPUERTO" }), ["taxi"]);
  assert.deepEqual(ids({ search: "bono" }), ["bono"]);
  assert.deepEqual(ids({ search: "   " }).length, 4);
  assert.deepEqual(ids({ date: "2026-10-05", sort: "amount" }), ["taxi", "libre"]);
});

test("the newest movement comes first, and within a day the one recorded last", () => {
  const movements = periodMovements(
    [
      expense({ id: "morning", date: "2026-10-05", updated_at: "2026-10-05T08:00:00Z" }),
      expense({ id: "old", date: "2026-10-02", updated_at: "2026-10-09T08:00:00Z" }),
      expense({ id: "night", date: "2026-10-05", updated_at: "2026-10-05T21:00:00Z" })
    ],
    [],
    october
  );
  assert.deepEqual(
    listMovements(movements).map((movement) => movement.id),
    ["night", "morning", "old"]
  );
});

test("a day's expense total ignores income received that day", () => {
  assert.equal(
    dailyExpenseTotal([
      { kind: "expense", amount: 20_000 },
      { kind: "income", amount: 500_000 },
      { kind: "expense", amount: "5000" }
    ]),
    25_000
  );
});

test("the CSV has every period, expenses negative and income positive, newest first, quoted safely", () => {
  const csv = movementsCsv(
    [
      expense({ date: "2026-09-10", amount: 45_000, merchant: 'Pan "La 14", centro', category: "mercado", source: "cash", description: "pan\ny leche" }),
      expense({ date: "2026-10-02", amount: 8_000, merchant: "Bus", category: "" })
    ],
    [{ date: "2026-10-01", amount: 300_000, source: "Bono", location: "cash" }],
    {
      categoryName: (id) => ({ mercado: "Mercado", free: "Libre" })[id] || id,
      locationLabel: (source) => ({ cash: "Efectivo", account: "Cuenta" })[source]
    }
  );
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Fecha,Tipo,Comercio u origen,Categoría,Monto,Pagado con,Nota");
  assert.equal(lines[1], "2026-10-02,Gasto,Bus,Libre,-8000,Cuenta,");
  assert.equal(lines[2], "2026-10-01,Ingreso,Bono,,300000,Efectivo,");
  assert.equal(lines[3], '2026-09-10,Gasto,"Pan ""La 14"", centro",Mercado,-45000,Efectivo,"pan\ny leche"');
  assert.equal(lines.length, 4);
});

test("the period report totals spending per day and per merchant, merging spellings of one merchant", () => {
  const transactions = [
    expense({ date: "2026-10-03", amount: 30_000, merchant: "Éxito" }),
    expense({ date: "2026-10-01", amount: 10_000, merchant: "exito" }),
    expense({ date: "2026-10-03", amount: 50_000, merchant: "Terpel" })
  ];
  assert.deepEqual(dailyTotals(transactions, "2026-10-20"), [
    { date: "2026-10-01", total: 10_000, count: 1 },
    { date: "2026-10-03", total: 80_000, count: 2 }
  ]);
  assert.deepEqual(merchantTotals(transactions), [
    { name: "Terpel", total: 50_000, count: 1 },
    { name: "Éxito", total: 40_000, count: 2 }
  ]);
  assert.equal(merchantTotals(transactions, 1).length, 1);
});

test("date helpers: windows exclude their end, weeks start on Monday", () => {
  assert.deepEqual(datesInWindow("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.equal(weekdayOffset("2026-10-12"), 0); // a Monday
  assert.equal(weekdayOffset("2026-10-18"), 6); // a Sunday
  assert.deepEqual(previousWindow({ start: "2026-10-16", end: "2026-11-01" }), { start: "2026-09-30", end: "2026-10-16" });
});

test("the expense calendar covers a monthly period whole, with its heaviest day", () => {
  const calendar = expenseCalendar(
    [
      expense({ date: "2026-10-05", amount: 20_000 }),
      expense({ date: "2026-10-05", amount: 10_000 }),
      expense({ date: "2026-10-09", amount: 6_000 }),
      expense({ date: "2026-09-29", amount: 99_000 })
    ],
    october,
    "2026-10-12"
  );
  assert.equal(calendar.start, "2026-10-01");
  assert.equal(calendar.days.length, 31);
  assert.equal(calendar.blanks.length, 3); // October 1st 2026 is a Thursday
  assert.equal(calendar.total, 36_000);
  assert.deepEqual(calendar.heaviest, { date: "2026-10-05", total: 30_000, dayNumber: 5, isToday: false });
  assert.equal(calendar.averageActive, 18_000);
  assert.equal(calendar.days.find((day) => day.isToday).date, "2026-10-12");
});

test("a semester-long period shows only the month of the last day that already happened", () => {
  const calendar = expenseCalendar([expense({ date: "2026-08-20", amount: 5_000 })], { start: "2026-07-15", end: "2027-01-15" }, "2026-10-12");
  assert.equal(calendar.start, "2026-10-01");
  assert.equal(calendar.end, "2026-11-01");
  assert.equal(calendar.total, 0, "August spending is outside the month shown");
});

test("weekday pattern: one weekday with a quarter of the spending, only with enough data", () => {
  // 2026-10-03 and 2026-10-10 are Saturdays.
  const week = [
    expense({ date: "2026-10-03", amount: 60_000 }),
    expense({ date: "2026-10-10", amount: 60_000 }),
    expense({ date: "2026-10-05", amount: 10_000 }),
    expense({ date: "2026-10-06", amount: 10_000 }),
    expense({ date: "2026-10-07", amount: 10_000 }),
    expense({ date: "2026-10-08", amount: 10_000 })
  ];
  const pattern = weekdayPattern(week);
  assert.equal(pattern.day, 6);
  assert.equal(pattern.total, 120_000);
  assert.equal(Math.round(pattern.share), 75);

  assert.equal(weekdayPattern(week.slice(0, 5)), null, "fewer than 6 expenses is not a pattern");
  const twoDays = week.map((item, index) => ({ ...item, date: index % 2 ? "2026-10-05" : "2026-10-06" }));
  assert.equal(weekdayPattern(twoDays), null, "spending on only two weekdays is not a pattern");
});

test("category trend: the category that grew the most against the period before, ignoring small bases", () => {
  const transactions = [
    expense({ date: "2026-09-10", amount: 100_000, category: "mercado" }),
    expense({ date: "2026-10-10", amount: 150_000, category: "mercado" }),
    expense({ date: "2026-09-10", amount: 4_000, category: "cafe" }),
    expense({ date: "2026-10-10", amount: 40_000, category: "cafe" }),
    expense({ date: "2026-09-10", amount: 50_000, category: "bus" }),
    expense({ date: "2026-10-10", amount: 55_000, category: "bus" })
  ];
  const trend = categoryTrend(transactions, october);
  assert.equal(trend.category, "mercado");
  assert.equal(trend.previous, 100_000);
  assert.equal(trend.pct, 50);
  assert.equal(categoryTrend(transactions.filter((item) => item.category !== "mercado"), october), null);
});

test("small expenses: five or more under the threshold that add up to a tenth of the period", () => {
  const small = Array.from({ length: 5 }, () => expense({ amount: 8_000 }));
  assert.deepEqual(smallExpenses(small, 200_000), { count: 5, total: 40_000, share: 20, threshold: 15_000 });
  assert.equal(smallExpenses(small.slice(0, 4), 200_000), null);
  assert.equal(smallExpenses(small, 1_000_000), null, "4% of the period is not worth pointing out");
});
