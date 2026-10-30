// The period close dashboard ("Así va tu periodo") and the document exported from it to
// read or hand to an AI ("Analízalo con una IA"). Pure: app.js passes the period's records
// and the words it shows for ids (categoryName, locationLabel); tested in
// tests/period-review.test.mjs.
import { FREE_CATEGORY_ID } from "./finance-core.js?v=1.1.90";
import { inWindow, merchantTotals, previousWindow } from "./movements.js?v=1.1.90";

const sum = (items) => items.reduce((total, item) => total + Number(item.amount || 0), 0);

function isUnclassified(transaction) {
  return !transaction.labeled || !transaction.category || transaction.category === FREE_CATEGORY_ID;
}

function byDate(a, b) {
  return String(a.date || "").localeCompare(String(b.date || ""));
}

// Where the money went, what came in, how it was paid and how it compares with the
// period before. `transactions`/`extras`/`creditPayments` are the whole history; only
// what falls in `window` (and `previous`, for the comparison) is used. `previous` is the
// real pay period before (a month is not always 31 days back); by default, one of the
// same length.
export function periodReview({ transactions = [], extras = [], creditPayments = [], window, previous = previousWindow(window), categoryName = (id) => id }) {
  const expenses = inWindow(transactions, window);
  const spent = sum(expenses);
  const groups = new Map();
  expenses.forEach((transaction) => {
    const id = isUnclassified(transaction) ? FREE_CATEGORY_ID : transaction.category;
    const group = groups.get(id) || { id, name: id === FREE_CATEGORY_ID ? "Sin categoría" : categoryName(id), total: 0, count: 0 };
    group.total += Number(transaction.amount || 0);
    group.count += 1;
    groups.set(id, group);
  });
  const categories = [...groups.values()]
    .map((group) => ({ ...group, share: spent > 0 ? group.total / spent : 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const paidWith = { account: 0, cash: 0, credit: 0, unknown: 0 };
  expenses.forEach((transaction) => {
    const key = Object.hasOwn(paidWith, transaction.source) ? transaction.source : "unknown";
    paidWith[key] += Number(transaction.amount || 0);
  });
  const creditPurchases = expenses.filter((transaction) => transaction.source === "credit");
  const payments = inWindow(creditPayments, window);

  const previousSpent = sum(inWindow(transactions, previous));
  // A previous period counts only if the app was in use for all of it: the first one is
  // usually partial (started mid-month), and comparing with it reads as "+1133%".
  const firstRecorded = transactions.reduce((first, transaction) => {
    const date = String(transaction.date || "").slice(0, 10);
    return date && (!first || date < first) ? date : first;
  }, "");
  const comparable = previousSpent > 0 && Boolean(firstRecorded) && firstRecorded <= previous.start;
  const income = inWindow(extras, window);
  const unclassified = groups.get(FREE_CATEGORY_ID);

  return {
    window,
    spent,
    expenseCount: expenses.length,
    extraIncome: sum(income),
    incomeCount: income.length,
    categories,
    unclassified: { total: unclassified?.total || 0, count: unclassified?.count || 0, share: spent > 0 ? (unclassified?.total || 0) / spent : 0 },
    merchants: merchantTotals(expenses, 5),
    paidWith,
    credit: {
      purchases: sum(creditPurchases),
      purchaseCount: creditPurchases.length,
      payments: sum(payments),
      paymentCount: payments.length
    },
    previous: {
      window: previous,
      spent: previousSpent,
      change: comparable ? (spent - previousSpent) / previousSpent : null
    }
  };
}

const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CO")}`;
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const cell = (value) => String(value ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "-";

// A Markdown document with everything about the period, for the user to keep or paste
// into an AI chat. It starts with a short request so the AI knows what to do with it, and
// it never includes the user's name, email or account numbers.
export function periodExportMarkdown(review, context) {
  const {
    generatedOn,
    periodLabel,
    cadenceLabel,
    remainingDays = 0,
    pay = {},
    free = {},
    balances = {},
    plan = [],
    savings = {},
    nextPeriod = null,
    movements = [],
    locationLabel = (value) => value
  } = context;
  const lines = [
    `# Mis finanzas: periodo ${periodLabel}`,
    "",
    `Exportado de Finanzas Conductuales el ${generatedOn}. Montos en pesos colombianos.`,
    remainingDays > 0 ? `El periodo todavía no termina: faltan ${remainingDays} ${remainingDays === 1 ? "día" : "días"}.` : "El periodo ya terminó.",
    "",
    "> Para una IA: este es mi resumen de gastos e ingresos de un periodo. Analiza en qué se va mi dinero, qué patrones ves",
    "> (comercios repetidos, gastos pequeños que suman, días o categorías que pesan más) y qué ajustes concretos me sugieres",
    "> para el próximo periodo. Pregúntame si algo no está claro antes de suponer.",
    "",
    "## Resumen",
    "",
    "| Concepto | Valor |",
    "| --- | --- |",
    `| Frecuencia de pago | ${cell(cadenceLabel)} |`,
    `| Sueldo del periodo | ${pay.amount > 0 ? money(pay.amount) : "Sin sueldo fijo"}${pay.status ? ` (${cell(pay.status)})` : ""} |`,
    `| Dinero extra recibido | ${money(review.extraIncome)} en ${review.incomeCount} ${review.incomeCount === 1 ? "ingreso" : "ingresos"} |`,
    `| Total gastado | ${money(review.spent)} en ${review.expenseCount} ${review.expenseCount === 1 ? "gasto" : "gastos"} |`,
    review.previous.change === null
      ? `| Periodo anterior | Sin datos para comparar |`
      : `| Periodo anterior | ${money(review.previous.spent)} (${review.previous.change >= 0 ? "+" : ""}${pct(review.previous.change)} este periodo) |`,
    `| Dinero libre hoy | ${money(free.today)} |`,
    ...(remainingDays > 0 ? [`| Si sigue el ritmo, termino con | ${money(free.projectedEnd)} |`] : []),
    `| Reservado en categorías | ${money(free.reserved)} |`,
    "",
    "## Dónde está mi dinero hoy",
    "",
    "| Lugar | Saldo |",
    "| --- | --- |",
    `| Cuenta | ${money(balances.account)} |`,
    `| Efectivo | ${money(balances.cash)} |`,
    `| Tarjeta de crédito (lo que debo) | ${money(balances.credit)} |`,
    "",
    "## En qué se fue",
    "",
    ...(review.categories.length
      ? ["| Categoría | Gastado | % del total | Gastos |", "| --- | --- | --- | --- |", ...review.categories.map((category) => `| ${cell(category.name)} | ${money(category.total)} | ${pct(category.share)} | ${category.count} |`)]
      : ["Sin gastos registrados."]),
    "",
    "## Comercios donde más gasté",
    "",
    ...(review.merchants.length
      ? ["| Comercio | Total | Veces |", "| --- | --- | --- |", ...review.merchants.map((merchant) => `| ${cell(merchant.name)} | ${money(merchant.total)} | ${merchant.count} |`)]
      : ["Sin comercios registrados."]),
    "",
    "## Cómo pagué",
    "",
    "| Medio | Total |",
    "| --- | --- |",
    `| Cuenta | ${money(review.paidWith.account)} |`,
    `| Efectivo | ${money(review.paidWith.cash)} |`,
    `| Tarjeta de crédito | ${money(review.paidWith.credit)} en ${review.credit.purchaseCount} ${review.credit.purchaseCount === 1 ? "compra" : "compras"} |`,
    ...(review.paidWith.unknown > 0 ? [`| Sin dato | ${money(review.paidWith.unknown)} |`] : []),
    "",
    `Pagos a la tarjeta en el periodo: ${money(review.credit.payments)} en ${review.credit.paymentCount} ${review.credit.paymentCount === 1 ? "pago" : "pagos"}. Hoy debo ${money(balances.credit)}.`,
    "",
    "## Mi plan del periodo",
    "",
    ...(plan.length
      ? ["| Categoría | Límite | Usado | Estado |", "| --- | --- | --- | --- |", ...plan.map((item) => `| ${cell(item.name)} | ${money(item.budget)} | ${money(item.spent)} | ${item.spent > item.budget ? `Excedida por ${money(item.spent - item.budget)}` : `Quedan ${money(item.budget - item.spent)}`} |`)]
      : ["No tengo categorías con límite."]),
    "",
    `Ahorro: ${money(savings.reserved)} apartado${savings.suggested > 0 ? `; la app sugiere ${money(savings.suggested)} por periodo` : ""}.`
  ];

  if (nextPeriod) {
    lines.push(
      "",
      `## Próximo periodo (desde ${nextPeriod.startLabel})`,
      "",
      `- Sueldo: ${nextPeriod.payReceived ? `${money(nextPeriod.pay)}, ya recibido (llegó antes)` : nextPeriod.pay > 0 ? `${money(nextPeriod.pay)} esperado` : "sin sueldo fijo"}`,
      `- Categorías que se renuevan: ${money(nextPeriod.recurring)}`,
      `- Gastos planeados que caen en ese periodo: ${money(nextPeriod.planned)}`
    );
  }

  const sorted = movements.slice().sort(byDate);
  lines.push(
    "",
    "## Todos los movimientos",
    "",
    ...(sorted.length
      ? [
          "| Fecha | Tipo | Detalle | Categoría | Medio | Monto |",
          "| --- | --- | --- | --- | --- | --- |",
          ...sorted.map((movement) =>
            movement.kind === "income"
              ? `| ${String(movement.date).slice(0, 10)} | Ingreso | ${cell(movement.detail)} | - | ${cell(locationLabel(movement.location))} | +${money(movement.amount)} |`
              : `| ${String(movement.date).slice(0, 10)} | Gasto | ${cell(movement.detail)} | ${cell(movement.category)} | ${cell(locationLabel(movement.source))} | -${money(movement.amount)} |`
          )
        ]
      : ["Sin movimientos registrados."])
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
