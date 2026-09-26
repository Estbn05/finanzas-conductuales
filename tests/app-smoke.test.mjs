// Smoke tests that actually run app.js in a simulated browser (jsdom), instead of
// searching its source for substrings. Each test boots a fresh app instance against a
// fresh DOM and drives it through real clicks and form submits.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { bootApp, returningUserState, settle, todayKey } from "./helpers/boot-app.mjs";

test("a returning user opens straight into Inicio with their free money, cloud or no cloud", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    assert.match(ui.text(), /Tu dinero libre/);
    assert.match(ui.text(), /2\.000\.000/);
    assert.equal(ui.$(".auth-screen, .auth-gate"), null);
  } finally {
    ui.close();
  }
});

test("a fresh device with no data shows the sign-in screen, not the app", async () => {
  const ui = await bootApp();
  try {
    assert.doesNotMatch(ui.text(), /Tu dinero libre/);
    assert.equal(ui.$(".bottom-nav"), null);
  } finally {
    ui.close();
  }
});

test("registering an expense lowers free money and persists it locally", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    assert.ok(form, "the quick expense sheet did not open");

    form.elements.namedItem("amount").value = "50000";
    form.elements.namedItem("merchant").value = "Panaderia Smoke";
    form.requestSubmit();
    await settle(ui.window);

    assert.equal(ui.$("#transaction-form"), null, "the sheet should close after registering");
    assert.match(ui.text(), /1\.950\.000/);
    const saved = ui.saved();
    assert.equal(saved.transactions.length, 1);
    assert.equal(saved.transactions[0].merchant, "Panaderia Smoke");
    assert.equal(saved.transactions[0].amount, 50_000);
  } finally {
    ui.close();
  }
});

test("tapping the backdrop closes a sheet, tapping inside it does not", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    await ui.click(".quick-expense-panel h2");
    assert.ok(ui.$("#transaction-form"), "a click inside the sheet bubbled up and closed it");

    await ui.click(".quick-expense-backdrop");
    assert.equal(ui.$("#transaction-form"), null, "tapping the backdrop did not close the sheet");
  } finally {
    ui.close();
  }
});

test("every main view renders without throwing", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    const expected = {
      today: /Tu dinero libre/,
      budget: /Plan/,
      savings: /Ahorro/,
      calendar: /Calendario/,
      movements: /Movimientos/,
      progress: /Progreso/,
      profile: /Datos/
    };
    for (const [view, pattern] of Object.entries(expected)) {
      await ui.click(`[data-view="${view}"]`);
      assert.match(ui.text(), pattern, `view ${view} did not render`);
    }
  } finally {
    ui.close();
  }
});

// Regression: removing the dead "spending" screen left saved states pointing at a view
// that no longer exists, which made renderView() call undefined and blank the app.
test("a saved view that no longer exists falls back to Inicio instead of a blank app", async () => {
  const ui = await bootApp({ savedState: returningUserState({ activeView: "spending" }) });
  try {
    assert.match(ui.text(), /Tu dinero libre/);
  } finally {
    ui.close();
  }
});

function transaction(overrides) {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    date: todayKey(),
    merchant: "Tienda",
    amount: 10_000,
    category: "free",
    labeled: false,
    source: "account",
    ...overrides
  };
}

// A second date inside the current monthly window, different from today.
function otherDayThisPeriod() {
  const today = todayKey();
  return today.endsWith("-01") ? `${today.slice(0, 8)}02` : `${today.slice(0, 8)}01`;
}

test("tapping a day on the expense calendar filters movements to that day, and the chip clears it", async () => {
  const otherDay = otherDayThisPeriod();
  const ui = await bootApp({
    savedState: returningUserState({
      transactions: [
        transaction({ merchant: "Compra De Hoy", date: todayKey() }),
        transaction({ merchant: "Compra Otro Dia", date: otherDay })
      ]
    })
  });
  try {
    await ui.click('[data-view="movements"]');
    assert.match(ui.text(), /Compra De Hoy/);
    assert.match(ui.text(), /Compra Otro Dia/);

    await ui.click(`[data-action="filter-movements-by-date"][data-date="${otherDay}"]`);
    assert.doesNotMatch(ui.text(), /Compra De Hoy/);
    assert.match(ui.text(), /Compra Otro Dia/);

    await ui.click('[data-action="clear-movements-date-filter"]');
    assert.match(ui.text(), /Compra De Hoy/);
    assert.match(ui.text(), /Compra Otro Dia/);
  } finally {
    ui.close();
  }
});

test("a background re-render (network coming back) never wipes a form mid-typing", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    const merchant = ui.$("#transaction-form").elements.namedItem("merchant");
    merchant.value = "A medio escribir";

    ui.window.dispatchEvent(new ui.window.Event("online"));
    ui.window.dispatchEvent(new ui.window.Event("offline"));
    await settle(ui.window);

    assert.equal(ui.$("#transaction-form")?.elements.namedItem("merchant"), merchant, "the form was re-rendered");
    assert.equal(merchant.value, "A medio escribir");
  } finally {
    ui.close();
  }
});

test("quick classify lists every pending movement at once and classifying one removes it", async () => {
  const ui = await bootApp({
    savedState: returningUserState({
      budgetJobs: [{ id: "mercado", name: "Mercado", amount: 300_000, cadence: "monthly" }],
      transactions: [
        transaction({ merchant: "Pendiente Uno" }),
        transaction({ merchant: "Pendiente Dos" }),
        transaction({ merchant: "Pendiente Tres" })
      ]
    })
  });
  try {
    await ui.click('[data-view="movements"]');
    await ui.click('[data-action="start-quick-classify"]');
    assert.equal(ui.window.document.querySelectorAll(".quick-classify-row").length, 3);

    await ui.click('[data-action="quick-classify"][data-category="mercado"]');
    assert.equal(ui.window.document.querySelectorAll(".quick-classify-row").length, 2);
    assert.equal(ui.saved().transactions.filter((item) => item.category === "mercado").length, 1);
  } finally {
    ui.close();
  }
});

test("money inputs show thousands separators and stop at 12 digits", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    const amount = ui.$("#transaction-form").elements.namedItem("amount");

    await ui.type(amount, "1234567");
    assert.equal(amount.value, "1.234.567");

    await ui.type(amount, "99999999999999999999");
    assert.equal(amount.value.replace(/\D/g, "").length, 12);
  } finally {
    ui.close();
  }
});

// Regression: category creation checked the gross quota (freeBudget) instead of what is
// really left after unclassified spending (freeRemaining), so a category that no longer
// fit was accepted and silently pinned "Libre" at $0. The sheet's initial "Disponible
// para reservar" also showed the gross quota until the user typed.
test("a new category that no longer fits the real free money is blocked, preview and submit alike", async () => {
  const ui = await bootApp({
    savedState: returningUserState({ transactions: [transaction({ amount: 1_900_000 })] })
  });
  try {
    // Plan's single "Nueva categoría" entry point asks one-off vs recurring first.
    await ui.click('[data-view="budget"]');
    await ui.click('[data-action="open-add-category-choice"]');
    await ui.click('[data-action="open-category-sheet"]');
    const form = ui.$("#budget-job-form");
    assert.match(form.textContent.replace(/\s+/g, " "), /Disponible para reservar: \$\s?100\.000/);

    form.elements.namedItem("name").value = "Viaje";
    await ui.type(form.elements.namedItem("amount"), "500000");
    assert.equal(ui.$("[data-category-submit]").disabled, true);
    assert.equal(ui.$("[data-category-limit-warning]").hidden, false);

    form.requestSubmit();
    await settle(ui.window);
    assert.equal(ui.saved()?.budgetJobs?.length ?? 0, 0);
  } finally {
    ui.close();
  }
});

test("apartar dinero lowers free money without touching the real account balance", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-setaside-sheet"]');
    const form = ui.$("#setaside-form");
    form.elements.namedItem("name").value = "Remedios";
    await ui.type(form.elements.namedItem("amount"), "100000");
    form.requestSubmit();
    await settle(ui.window);

    assert.match(ui.text(), /1\.900\.000/);
    assert.equal(ui.saved().liquidity.account, 1_500_000);
    assert.ok(ui.saved().budgetJobs.some((job) => job.name === "Remedios"));
  } finally {
    ui.close();
  }
});

// For fixed income, periodStart doubles as the payday: the period's income is deposited
// into the real balance once, announced with an undoable banner.
test("fixed income is deposited once on payday, can be undone, and is not re-deposited on relaunch", async () => {
  const fixed = returningUserState({
    profile: { ...returningUserState().profile, incomeType: "fixed" },
    liquidity: { account: 500_000, cash: 0, initialized: true }
  });
  const first = await bootApp({ savedState: fixed });
  let afterUndo;
  try {
    // The deposit happens on render and is persisted with the next save, so check the UI.
    assert.match(first.text(), /Cuenta\s*\$\s?2\.500\.000/);
    assert.match(first.text(), /Se sumó automáticamente/);
    // Real balance (2.5M) now exceeds the period budget (2M): the note must cap at 100%.
    assert.match(first.text(), /100% sigue libre/);

    await first.click('[data-action="undo-income-application"]');
    afterUndo = first.saved();
    assert.equal(afterUndo.liquidity.account, 500_000);
  } finally {
    first.close();
  }

  const relaunched = await bootApp({ savedState: afterUndo });
  try {
    assert.match(relaunched.text(), /Cuenta\s*\$\s?500\.000/, "income was deposited again after the user undid it");
  } finally {
    relaunched.close();
  }
});

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bootLocked(pin) {
  const salt = "smoke-salt";
  const lockConfig = { enabled: true, hash: await sha256Hex(`${salt}:${pin}`), salt, biometric: false, failedAttempts: 0, lockUntil: 0 };
  return bootApp({ savedState: returningUserState(), lockConfig });
}

async function enterPin(ui, pin) {
  for (const digit of pin) {
    await ui.click(`[data-lock-digit="${digit}"]`);
  }
}

test("with the PIN lock on, the app opens on the lock screen and only the right PIN shows the money", async () => {
  const ui = await bootLocked("1234");
  try {
    assert.match(ui.text(), /Ingresa tu PIN/);
    assert.doesNotMatch(ui.text(), /Tu dinero libre/);

    await enterPin(ui, "9999");
    assert.match(ui.text(), /PIN incorrecto/);
    assert.doesNotMatch(ui.text(), /Tu dinero libre/);

    await enterPin(ui, "1234");
    assert.match(ui.text(), /Tu dinero libre/);
    // The lock lives in its own device-local key and never rides along with synced state.
    assert.equal(JSON.stringify(ui.saved()).includes("smoke-salt"), false);
  } finally {
    ui.close();
  }
});

// Regression: "Cambiar PIN" reused the first-time setup flow and never asked for the
// current PIN, so anyone holding an unlocked phone could swap in their own.
test("changing the PIN asks for the current one first", async () => {
  const ui = await bootLocked("1234");
  try {
    await enterPin(ui, "1234");
    await ui.click('[data-view="profile"]');
    await ui.click('[data-action="open-lock-setup"]');
    assert.match(ui.text(), /Ingresa tu PIN actual/);

    await enterPin(ui, "1234");
    assert.match(ui.text(), /Crea un PIN de 4 dígitos/);
  } finally {
    ui.close();
  }
});

// Regression: #app itself was an aria-live region, so every tap made a screen reader
// re-read the whole screen. Announcements now go through permanent regions outside it.
test("screen readers hear the expense confirmation without #app being a live region", async () => {
  const { readFile } = await import("node:fs/promises");
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const shell = new JSDOM(indexHtml).window.document;
  assert.equal(shell.querySelector("#app").hasAttribute("aria-live"), false);
  assert.ok(shell.querySelector("#live-status[aria-live='polite']"));
  assert.ok(shell.querySelector("#live-alert[role='alert']"));

  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    form.elements.namedItem("amount").value = "50000";
    form.elements.namedItem("merchant").value = "Tienda";
    form.requestSubmit();
    await settle(ui.window);

    assert.match(ui.$("#live-status").textContent, /Gasto registrado/);
    assert.equal(ui.$(".snackbar")?.hasAttribute("aria-live"), false, "the visual snackbar would be announced twice");
  } finally {
    ui.close();
  }
});

// A coffee should take one field: the amount. Merchant is optional.
test("an expense can be registered with just the amount, and never teaches a merchant rule", async () => {
  const ui = await bootApp({
    savedState: returningUserState({ budgetJobs: [{ id: "cafe", name: "Café", amount: 100_000, cadence: "monthly" }] })
  });
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    assert.equal(form.elements.namedItem("merchant").required, false);
    await ui.type(form.elements.namedItem("amount"), "8000");
    form.requestSubmit();
    await settle(ui.window);

    const [saved] = ui.saved().transactions;
    assert.equal(saved.merchant, "Gasto");
    assert.equal(saved.amount, 8_000);

    // Classifying that unnamed expense must not make "gasto" suggest Café from now on.
    await ui.click('[data-view="movements"]');
    await ui.click('[data-action="start-quick-classify"]');
    await ui.click('[data-action="quick-classify"][data-category="cafe"]');
    assert.equal(ui.saved().transactions[0].category, "cafe");
    assert.deepEqual(ui.saved().merchantRules ?? [], []);
  } finally {
    ui.close();
  }
});

async function openExtraSheetFromExpense(ui) {
  await ui.click('[data-action="open-expense"]');
  await ui.click('.quick-income-link[data-action="open-extra-sheet"]');
  assert.equal(ui.$("#transaction-form"), null, "the expense sheet should give way to the extra-money sheet");
  const form = ui.$("#extra-budget-form");
  assert.ok(form, "the extra-money sheet did not open");
  return form;
}

// Registering extra money used to take two chained sheets and was only reachable from
// Plan. Now: one sheet, reachable from Registrar, with the savings proposal inline.
test("extra money: one sheet from Registrar, savings suggestion previewed and applied", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    const form = await openExtraSheetFromExpense(ui);
    form.elements.namedItem("source").value = "Bono";
    await ui.type(form.elements.namedItem("amount"), "300000");
    assert.match(ui.$("[data-extra-savings]").textContent, /60\.000/);
    assert.match(ui.$("[data-extra-free]").textContent, /240\.000/);

    form.requestSubmit(form.querySelector('[value="split"]'));
    await settle(ui.window);

    assert.equal(ui.$("#extra-budget-form"), null, "no second sheet should follow");
    const [extra] = ui.saved().budgetExtras;
    assert.equal(extra.amount, 300_000);
    assert.equal(extra.allocation.savingsAmount, 60_000);
    assert.equal(ui.saved().liquidity.account, 1_800_000);
    assert.ok(ui.saved().budgetJobs.some((job) => job.name === "Ahorro"));
    assert.match(ui.text(), /2\.240\.000/);
  } finally {
    ui.close();
  }
});

test("extra money: 'Dejar todo libre' adds it all to free money without separating savings", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    const form = await openExtraSheetFromExpense(ui);
    form.elements.namedItem("source").value = "Venta";
    await ui.type(form.elements.namedItem("amount"), "300000");
    form.requestSubmit(form.querySelector('[value="all-free"]'));
    await settle(ui.window);

    const [extra] = ui.saved().budgetExtras;
    assert.equal(extra.allocation.savingsAmount, 0);
    assert.equal(ui.saved().budgetJobs.length, 0);
    assert.match(ui.text(), /2\.300\.000/);
  } finally {
    ui.close();
  }
});

// The app records what already happened. Refusing an expense larger than the balance
// (overdraft, cash borrowed, a stale balance) pushed users to fake the amount or give up.
const NEGATIVE_100K = /-\s?\$\s?100\.000|\$\s?-\s?100\.000/;

test("an expense larger than the balance is recorded and the balance goes negative, with a plain notice", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  let saved;
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    await ui.type(form.elements.namedItem("amount"), "1600000");
    form.requestSubmit();
    await settle(ui.window);

    saved = ui.saved();
    assert.equal(saved.transactions.length, 1, "the expense was refused");
    assert.equal(saved.liquidity.account, -100_000);
    const snackbar = ui.$(".snackbar");
    assert.match(snackbar.textContent, /Cuenta quedó en/);
    assert.ok(!snackbar.classList.contains("error"), "an overdraft is information, not an error");
  } finally {
    ui.close();
  }

  const relaunched = await bootApp({ savedState: saved });
  try {
    assert.equal(relaunched.saved().liquidity.account, -100_000, "reloading rounded the overdraft up to zero");
    assert.match(relaunched.text(), NEGATIVE_100K);
  } finally {
    relaunched.close();
  }
});

test("editing balances keeps a negative account negative instead of flipping its sign", async () => {
  const ui = await bootApp({
    savedState: returningUserState({ liquidity: { account: -100_000, cash: 20_000, initialized: true } })
  });
  try {
    await ui.click('[data-view="profile"]');
    await ui.click('[data-action="open-diagnosis"][data-section="balances"]');
    const form = ui.$("#diagnosis-form");
    assert.equal(form.elements.namedItem("account").value, "-100.000");
    form.requestSubmit();
    await settle(ui.window);
    assert.equal(ui.saved().liquidity.account, -100_000);
    assert.equal(ui.saved().liquidity.cash, 20_000);
  } finally {
    ui.close();
  }
});

// Paying by card raises what you owe instead of lowering the account; paying the
// statement moves money from the account to the card without a second expense.
test("card: an expense raises what you owe, the statement payment clears it without counting twice", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    await ui.type(form.elements.namedItem("amount"), "100000");
    await ui.click('#transaction-form [data-choice-value="credit"]');
    form.requestSubmit();
    await settle(ui.window);

    let saved = ui.saved();
    assert.equal(saved.transactions[0].source, "credit");
    assert.equal(saved.liquidity.account, 1_500_000, "a card expense must not touch the account");
    assert.equal(saved.liquidity.credit, 100_000);
    assert.match(ui.text(), /Tarjeta \(ya lo debes\)/);
    assert.match(ui.text(), /Total real\s*\$\s?1\.400\.000/);

    await ui.click('[data-view="profile"]');
    await ui.click('[data-action="open-credit-payment"]');
    const pay = ui.$("#credit-payment-form");
    await ui.type(pay.elements.namedItem("amount"), "100000");
    pay.requestSubmit();
    await settle(ui.window);

    saved = ui.saved();
    assert.equal(saved.transactions.length, 1, "paying the card is not a new expense");
    assert.equal(saved.liquidity.account, 1_400_000);
    assert.equal(saved.liquidity.credit, 0);
    assert.match(ui.text(), /Total real\s*\$\s?1\.400\.000/, "paying the card must not change the real total");
  } finally {
    ui.close();
  }
});

test("card: undoing a card expense lowers what you owe", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    await ui.type(form.elements.namedItem("amount"), "40000");
    await ui.click('#transaction-form [data-choice-value="credit"]');
    form.requestSubmit();
    await settle(ui.window);
    assert.equal(ui.saved().liquidity.credit, 40_000);

    await ui.click('[data-action="undo-snackbar"]');
    assert.equal(ui.saved().transactions.length, 0);
    assert.equal(ui.saved().liquidity.credit, 0);
    assert.equal(ui.saved().liquidity.account, 1_500_000);
  } finally {
    ui.close();
  }
});

// Regression: Inicio showed the free money from the real balance while Plan, the Libre
// row and "reservables" showed income minus reservations: two different "libres" on
// screen at once. The period's income is already settled here, so no deposit muddies it.
function fixedIncomeState() {
  const monthStart = `${todayKey().slice(0, 8)}01`;
  const base = returningUserState();
  return {
    ...base,
    profile: { ...base.profile, incomeType: "fixed" },
    budgetJobs: [{ id: "mercado", name: "Mercado", amount: 100_000, cadence: "period" }],
    periodIncomeStatus: { windowStart: monthStart, applied: true, rejected: false, bannerDismissed: true, amount: 0, location: "account" },
    periodIncomeApplied: [{ windowStart: monthStart, windowEnd: "9999-12-31", status: "applied", amount: 0 }]
  };
}

test("there is one 'libre': Inicio, the Libre row and Plan all show the same free money", async () => {
  const ui = await bootApp({ savedState: fixedIncomeState() });
  try {
    // 1.500.000 in the account minus the 100.000 reserved.
    assert.match(ui.text(), /Tu dinero libre[\s\S]*1\.400\.000/);
    const libreRow = [...ui.window.document.querySelectorAll("*")].find(
      (node) => node.children.length === 0 && node.textContent.trim() === "Libre / sin clasificar"
    );
    assert.ok(libreRow, "no Libre row on Inicio");
    assert.doesNotMatch(ui.text(), /1\.900\.000/, "income minus reservations leaked onto Inicio");

    await ui.click('[data-view="budget"]');
    assert.match(ui.text(), /1\.400\.000 libres para reservar/);
    assert.doesNotMatch(ui.text(), /1\.900\.000 reservables|\d+% libre/);
  } finally {
    ui.close();
  }
});

async function setAside(ui, name, amount) {
  await ui.click('[data-action="open-setaside-sheet"]');
  const form = ui.$("#setaside-form");
  form.elements.namedItem("name").value = name;
  await ui.type(form.elements.namedItem("amount"), String(amount));
  form.requestSubmit();
  await settle(ui.window);
}

// Regression: setting money aside once reserved it again in every later period.
test("apartar dinero reserves for this period only, and expires with it", async () => {
  const ui = await bootApp({
    savedState: returningUserState({ budgetJobs: [{ id: "mercado", name: "Mercado", amount: 200_000, cadence: "period" }] })
  });
  let saved;
  try {
    await setAside(ui, "Remedios", 50_000);
    await setAside(ui, "Mercado", 30_000);
    saved = ui.saved();
    const remedios = saved.budgetJobs.find((job) => job.name === "Remedios");
    const mercado = saved.budgetJobs.find((job) => job.id === "mercado");
    assert.equal(remedios.cadence, "once");
    assert.equal(mercado.amount, 200_000, "a one-off top-up must not raise the recurring amount");
    assert.equal(mercado.topUps.length, 1);
    assert.equal(mercado.topUps[0].amount, 30_000);
  } finally {
    ui.close();
  }

  // Same data, one period later: the one-offs are gone, the name survives for old movements.
  const lastPeriod = "2000-01-01";
  const nextPeriod = await bootApp({
    savedState: {
      ...saved,
      budgetJobs: saved.budgetJobs.map((job) => ({
        ...job,
        windowStart: job.cadence === "once" ? lastPeriod : job.windowStart,
        topUps: (job.topUps || []).map((topUp) => ({ ...topUp, windowStart: lastPeriod }))
      }))
    }
  });
  try {
    nextPeriod.window.document.querySelector('[data-view="budget"]').click();
    await settle(nextPeriod.window);
    const after = nextPeriod.saved();
    assert.deepEqual(after.budgetJobs.map((job) => job.id), ["mercado"]);
    assert.deepEqual(after.budgetJobs[0].topUps, []);
    assert.ok(Object.values(after.retiredCategoryNames).includes("Remedios"));
  } finally {
    nextPeriod.close();
  }
});

// The boot code (render(), initializeCloudSync()) runs synchronously at module init, so
// a module-level const/let declared below it is in its temporal dead zone for any boot
// path that reaches it — this crashed the app three separate times. The smoke tests
// above only cover the paths they exercise; this guards all of them statically.
test("no module-level const/let is declared below app.js's boot code", async () => {
  const { readFile } = await import("node:fs/promises");
  const lines = (await readFile(new URL("../app.js", import.meta.url), "utf8")).split(/\r?\n/);
  const bootLine = lines.findIndex((line) => /^initializeCloudSync\(\);/.test(line));
  assert.ok(bootLine > 0, "could not find the top-level initializeCloudSync() call");

  const late = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line, number }) => number > bootLine + 1 && /^(const|let) \w+/.test(line));
  assert.deepEqual(late, [], "move these declarations above the boot code");
});
