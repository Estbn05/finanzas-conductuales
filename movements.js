// What Movimientos, the period report, the CSV export and Progreso compute from the
// recorded expenses (transactions) and extra income (budgetExtras). Pure: everything
// comes in as arguments, so these are unit-tested in tests/movements.test.mjs instead of
// being searched for in app.js's source.
import { FREE_CATEGORY_ID } from "./finance-core.js?v=1.1.89";
import { cleanText, csvField, merchantKey } from "./state-model.js?v=1.1.89";

export const SMALL_EXPENSE_THRESHOLD = 15000;

// Date keys are "YYYY-MM-DD". Arithmetic happens at UTC noon so no timezone or DST shift
// can move a key to the neighbouring day.
function keyToDate(key) {
  return new Date(`${String(key).slice(0, 10)}T12:00:00Z`);
}

function dateToKey(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(key, days) {
  const date = keyToDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToKey(date);
}

export function monthStartKey(key) {
  return `${String(key).slice(0, 7)}-01`;
}

export function nextMonthStartKey(key) {
  const date = keyToDate(monthStartKey(key));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return dateToKey(date);
}

// Every date key from start (inclusive) to end (exclusive).
export function datesInWindow(start, end) {
  const dates = [];
  for (let key = String(start).slice(0, 10); key < end; key = addDays(key, 1)) {
    dates.push(key);
  }
  return dates;
}

// Monday-first column of a date in a calendar grid (Monday 0 ... Sunday 6).
export function weekdayOffset(key) {
  const day = keyToDate(key).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function dayOf(item) {
  return String(item.date || "").slice(0, 10);
}

export function inWindow(items = [], window) {
  return (items || []).filter((item) => {
    const date = dayOf(item);
    return date >= window.start && date < window.end;
  });
}

// Expenses and extra income of one period as one list of movements.
export function periodMovements(transactions, extras, window) {
  const expenses = inWindow(transactions, window).map((transaction) => ({
    id: transaction.id,
    kind: "expense",
    date: transaction.date,
    amount: transaction.amount,
    updated_at: transaction.updated_at || transaction.createdAt || transaction.date,
    transaction
  }));
  const income = inWindow(extras, window).map((extra) => ({
    id: extra.id,
    kind: "income",
    date: extra.date,
    amount: extra.amount,
    updated_at: extra.updated_at || extra.date,
    extra
  }));
  return [...expenses, ...income];
}

// filter: "all" | "expense" | "income" | "uncategorized" | "cat:<categoryId>".
export function movementMatchesFilter(movement, filter) {
  if (!filter || filter === "all") {
    return true;
  }
  if (filter === "expense" || filter === "income") {
    return movement.kind === filter;
  }
  if (movement.kind !== "expense") {
    return false;
  }
  const category = movement.transaction.category || FREE_CATEGORY_ID;
  const unlabeled = !movement.transaction.labeled || category === FREE_CATEGORY_ID;
  if (filter === "uncategorized") {
    return unlabeled;
  }
  if (filter.startsWith("cat:")) {
    return category === filter.slice(4);
  }
  return true;
}

// Case-insensitive match on the merchant and note of an expense, or the origin of income.
export function movementMatchesSearch(movement, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack =
    movement.kind === "income"
      ? movement.extra.source || ""
      : `${movement.transaction.merchant || ""} ${movement.transaction.description || ""}`;
  return haystack.toLowerCase().includes(needle);
}

// Newest day first; within a day, the one recorded last first.
export function compareByRecent(a, b) {
  const dateDifference = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateDifference) return dateDifference;

  const aCreated = Date.parse(a.createdAt || a.updated_at || "");
  const bCreated = Date.parse(b.createdAt || b.updated_at || "");
  return (Number.isFinite(bCreated) ? bCreated : 0) - (Number.isFinite(aCreated) ? aCreated : 0);
}

export function listMovements(movements, { sort = "recent", filter = "all", search = "", date = "" } = {}) {
  return movements
    .filter(
      (movement) =>
        movementMatchesFilter(movement, filter) &&
        movementMatchesSearch(movement, search) &&
        (!date || dayOf(movement) === date)
    )
    .sort((a, b) =>
      sort === "amount" ? Number(b.amount || 0) - Number(a.amount || 0) || compareByRecent(a, b) : compareByRecent(a, b)
    );
}

// What went out on a day: income on the same day does not offset it.
export function dailyExpenseTotal(dayMovements = []) {
  return dayMovements
    .filter((movement) => movement.kind === "expense")
    .reduce((total, movement) => total + Number(movement.amount || 0), 0);
}

// The full history (every period), newest first, as a spreadsheet: expenses negative and
// income positive so a SUM over the column gives the net. categoryName/locationLabel turn
// stored ids into the words the app shows.
export function movementsCsv(transactions = [], extras = [], { categoryName, locationLabel }) {
  const expenseRows = (transactions || []).map((transaction) => ({
    date: transaction.date,
    kind: "Gasto",
    who: transaction.merchant,
    category: categoryName(transaction.category || FREE_CATEGORY_ID),
    amount: -Math.abs(Number(transaction.amount || 0)),
    paidWith: locationLabel(transaction.source),
    note: transaction.description || ""
  }));
  const incomeRows = (extras || []).map((extra) => ({
    date: extra.date,
    kind: "Ingreso",
    who: extra.source,
    category: "",
    amount: Math.abs(Number(extra.amount || 0)),
    paidWith: extra.location === "cash" ? "Efectivo" : "Cuenta",
    note: ""
  }));
  const rows = [...expenseRows, ...incomeRows]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((row) => [row.date, row.kind, row.who, row.category, row.amount, row.paidWith, row.note]);
  const header = ["Fecha", "Tipo", "Comercio u origen", "Categoría", "Monto", "Pagado con", "Nota"];
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

// Spending per day, oldest first, for the period report.
export function dailyTotals(transactions = [], today) {
  const totals = transactions.reduce((acc, transaction) => {
    const date = String(transaction.date || today).slice(0, 10);
    acc[date] ||= { date, total: 0, count: 0 };
    acc[date].total += Number(transaction.amount || 0);
    acc[date].count += 1;
    return acc;
  }, {});
  return Object.values(totals).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Where the money went, biggest first. "Éxito" and "exito 93" are one merchant
// (merchantKey), shown under the first spelling seen.
export function merchantTotals(transactions = [], limit = 8) {
  const totals = transactions.reduce((acc, transaction) => {
    const name = cleanText(transaction.merchant, "Comercio");
    const key = merchantKey(name) || name.toLowerCase();
    acc[key] ||= { name, total: 0, count: 0 };
    acc[key].total += Number(transaction.amount || 0);
    acc[key].count += 1;
    return acc;
  }, {});
  return Object.values(totals)
    .sort((a, b) => b.total - a.total || b.count - a.count || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

// The heatmap in Movimientos: the whole period, except periods longer than five weeks
// (semester, year), which are too long for a grid and show the month of the last day that
// already happened.
export function expenseCalendar(transactions, window, today) {
  const long = datesInWindow(window.start, window.end).length > 35;
  const anchor = [today, addDays(window.end, -1)].sort()[0];
  const monthStart = monthStartKey(anchor);
  const start = long ? [window.start, monthStart].sort()[1] : window.start;
  const end = long ? [window.end, nextMonthStartKey(monthStart)].sort()[0] : window.end;
  const totals = inWindow(transactions, window).reduce((acc, transaction) => {
    const date = String(transaction.date || today).slice(0, 10);
    if (date < start || date >= end) {
      return acc;
    }
    acc[date] = (acc[date] || 0) + Number(transaction.amount || 0);
    return acc;
  }, {});
  const days = datesInWindow(start, end).map((date) => ({
    date,
    total: totals[date] || 0,
    dayNumber: Number(date.slice(8, 10)),
    isToday: date === today
  }));
  const activeDays = days.filter((day) => day.total > 0);
  const total = activeDays.reduce((sum, day) => sum + day.total, 0);
  const heaviest = activeDays.slice().sort((a, b) => b.total - a.total || String(b.date).localeCompare(String(a.date)))[0] || null;
  return {
    start,
    end,
    days,
    blanks: Array.from({ length: weekdayOffset(start) }),
    total,
    heaviest,
    maxDaily: activeDays.reduce((max, day) => Math.max(max, day.total), 0),
    averageActive: activeDays.length ? Math.round(total / activeDays.length) : 0
  };
}

// The period of the same length right before this one.
export function previousWindow(window) {
  const lengthDays = datesInWindow(window.start, window.end).length;
  return { start: addDays(window.start, -lengthDays), end: window.start };
}

// "Lo que dicen tus datos" in Progreso. Each detector returns the numbers behind one
// insight, or null when the data does not support saying it; app.js writes the words.

// One weekday holding at least a quarter of the period's spending. Needs 6+ expenses on
// 3+ different weekdays so a single big shopping day does not read as a habit.
export function weekdayPattern(periodTransactions = []) {
  if (periodTransactions.length < 6) {
    return null;
  }
  const totals = new Array(7).fill(0);
  periodTransactions.forEach((transaction) => {
    totals[keyToDate(transaction.date).getUTCDay()] += Number(transaction.amount || 0);
  });
  const totalSpent = totals.reduce((sum, value) => sum + value, 0);
  const daysWithSpend = totals.map((total, day) => ({ day, total })).filter((entry) => entry.total > 0);
  if (totalSpent <= 0 || daysWithSpend.length < 3) {
    return null;
  }
  const top = daysWithSpend.reduce((best, entry) => (entry.total > best.total ? entry : best));
  const share = (top.total / totalSpent) * 100;
  return share < 25 ? null : { day: top.day, total: top.total, share };
}

function totalsByCategory(transactions) {
  return transactions.reduce((acc, transaction) => {
    const category = transaction.category || FREE_CATEGORY_ID;
    acc[category] = (acc[category] || 0) + Number(transaction.amount || 0);
    return acc;
  }, {});
}

// The category that grew the most against the previous period, when it grew by at least
// 30% and $10.000 over a previous spend of at least $5.000 (smaller bases are noise).
export function categoryTrend(allTransactions = [], window) {
  const current = totalsByCategory(inWindow(allTransactions, window));
  const previous = totalsByCategory(inWindow(allTransactions, previousWindow(window)));
  let best = null;
  Object.keys(current).forEach((category) => {
    const before = previous[category] || 0;
    if (before < 5000) {
      return;
    }
    const diff = current[category] - before;
    const pct = (diff / before) * 100;
    if (pct >= 30 && diff >= 10000 && (!best || diff > best.diff)) {
      best = { category, current: current[category], previous: before, diff, pct };
    }
  });
  return best;
}

// "Gasto hormiga": 5+ expenses under the threshold adding up to 10%+ of the period.
export function smallExpenses(periodTransactions = [], totalSpent = 0, threshold = SMALL_EXPENSE_THRESHOLD) {
  const small = periodTransactions.filter((transaction) => {
    const amount = Number(transaction.amount || 0);
    return amount > 0 && amount < threshold;
  });
  if (small.length < 5) {
    return null;
  }
  const total = small.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const share = totalSpent > 0 ? (total / totalSpent) * 100 : 0;
  return share < 10 ? null : { count: small.length, total, share, threshold };
}
