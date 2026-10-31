// Screen behavior that used to be covered only by searching app.js for strings: the
// Movimientos controls, Progreso's insights, Escape on dialogs and the theme choice.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState, settle, todayKey } from "./helpers/boot-app.mjs";

async function waitFor(ui, selector) {
  for (let i = 0; i < 40 && !ui.$(selector); i += 1) {
    await settle(ui.window);
  }
  assert.ok(ui.$(selector), `${selector} never appeared`);
}

function expense(overrides) {
  return { id: `t-${Math.random()}`, date: todayKey(), amount: 10_000, merchant: "Tienda", category: "", labeled: false, source: "account", ...overrides };
}

async function change(ui, selector, value) {
  const element = ui.$(selector);
  element.value = value;
  element.dispatchEvent(new ui.window.Event("change", { bubbles: true }));
  await settle(ui.window);
}

test("Movimientos: search narrows the list as you type, and filter and sort apply", async () => {
  const ui = await bootApp({
    savedState: returningUserState({
      budgetJobs: [{ id: "mercado", name: "Mercado", amount: 300_000, cadence: "monthly" }],
      transactions: [
        expense({ id: "a", merchant: "Éxito", amount: 80_000, category: "mercado", labeled: true }),
        expense({ id: "b", merchant: "Taxi", amount: 12_000, description: "al aeropuerto" }),
        expense({ id: "c", merchant: "Café", amount: 95_000 })
      ]
    })
  });
  try {
    await waitFor(ui, '[data-view="movements"]');
    await ui.click('[data-view="movements"]');
    assert.equal(ui.window.document.querySelectorAll("#transaction-history-results .history-row").length, 3);

    await ui.type(ui.$("#transaction-history-search"), "aeropuerto");
    assert.equal(ui.window.document.querySelectorAll("#transaction-history-results .history-row").length, 1);
    assert.match(ui.$("#transaction-history-results").textContent, /Taxi/);
    assert.ok(ui.$("#transaction-history-search"), "typing repaints only the results, the box stays");

    await ui.type(ui.$("#transaction-history-search"), "");
    await change(ui, "#transaction-history-filter", "cat:mercado");
    assert.equal(ui.window.document.querySelectorAll("#transaction-history-results .history-row").length, 1);
    assert.match(ui.$("#transaction-history-results").textContent, /Éxito/);

    await change(ui, "#transaction-history-filter", "all");
    await change(ui, "#transaction-history-sort", "amount");
    const text = ui.$("#transaction-history-results").textContent;
    assert.ok(text.indexOf("Café") < text.indexOf("Éxito") && text.indexOf("Éxito") < text.indexOf("Taxi"), "biggest first");
  } finally {
    ui.close();
  }
});

test("Progreso points out small expenses that add up, and says nothing without enough data", async () => {
  const small = Array.from({ length: 5 }, (_, index) => expense({ id: `s${index}`, amount: 8_000, merchant: `Tinto ${index}` }));
  const ui = await bootApp({ savedState: returningUserState({ transactions: [...small, expense({ amount: 100_000 })] }) });
  try {
    await waitFor(ui, '[data-view="budget"]');
    await ui.click('[data-view="budget"]');
    await ui.click('[data-view="progress"]');
    assert.match(ui.text(), /Gasto hormiga acumulado/);
    assert.match(ui.text(), /5 gastos menores a \$\s?15\.000 suman \$\s?40\.000/);
  } finally {
    ui.close();
  }

  const quiet = await bootApp({ savedState: returningUserState({ transactions: [expense({ amount: 8_000 })] }) });
  try {
    await waitFor(quiet, '[data-view="budget"]');
    await quiet.click('[data-view="budget"]');
    await quiet.click('[data-view="progress"]');
    assert.doesNotMatch(quiet.text(), /Lo que dicen tus datos/);
  } finally {
    quiet.close();
  }
});

test("Escape closes the open form or sheet", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    const escape = async () => {
      ui.app.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(ui.window);
    };
    await waitFor(ui, '[data-action="open-expense"]');
    await ui.click('[data-action="open-expense"]');
    assert.ok(ui.$("#transaction-form"));
    await escape();
    assert.equal(ui.$("#transaction-form"), null);

    await ui.click('[data-view="budget"]');
    await ui.click('[data-action="open-add-category-choice"]');
    assert.ok(ui.$('[role="dialog"]'));
    await escape();
    assert.equal(ui.$('[role="dialog"]'), null);
  } finally {
    ui.close();
  }
});

test("the theme follows the phone until one is picked, and the pick survives a relaunch", async () => {
  const systemDark = (window) => {
    window.matchMedia = (query) => ({ matches: query.includes("dark"), addEventListener() {}, removeEventListener() {} });
  };
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: systemDark });
  let saved;
  try {
    await waitFor(ui, '[data-view="profile"]');
    assert.equal(ui.window.document.documentElement.dataset.theme, "dark");
    await ui.click('[data-view="profile"]');
    await ui.click('[data-theme-choice="light"]');
    assert.equal(ui.window.document.documentElement.dataset.theme, "light");
    saved = ui.saved();
    assert.equal(saved.settings.theme, "light");
  } finally {
    ui.close();
  }

  const again = await bootApp({ savedState: saved, beforeBoot: systemDark });
  try {
    await waitFor(again, '[data-view="profile"]');
    assert.equal(again.window.document.documentElement.dataset.theme, "light");
  } finally {
    again.close();
  }
});

// Recurring planned expenses (planned.js): rent, subscriptions, the gym.
test("a monthly planned expense is created from Gastos planeados with its repeat", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  try {
    await waitFor(ui, '[data-view="calendar"]');
    await ui.click('[data-view="calendar"]');
    const form = ui.$("#financial-event-form");
    form.elements.namedItem("title").value = "Arriendo";
    form.elements.namedItem("amount").value = "900000";
    form.elements.namedItem("repeat").value = "monthly";
    form.requestSubmit();
    await settle(ui.window);
    const [rent] = ui.saved().calendarEvents;
    assert.equal(rent.repeat, "monthly");
    assert.equal(rent.anchorDay, Number(todayKey().slice(8, 10)));
    assert.match(ui.text(), /Cada mes/);
  } finally {
    ui.close();
  }
});

test("a repeating plan due today is offered on Inicio; registering moves it a month on, and Deshacer brings it back", async () => {
  const { nextOccurrence } = await import("../planned.js");
  const today = todayKey();
  const rent = { id: "rent", title: "Arriendo", date: today, amount: 900_000, category: "free", repeat: "monthly", anchorDay: Number(today.slice(8, 10)) };
  const ui = await bootApp({ savedState: returningUserState({ calendarEvents: [rent] }) });
  try {
    await waitFor(ui, '[data-action="register-calendar-event"]');
    assert.match(ui.text(), /¿Registrar Arriendo\?/);
    await ui.click('[data-action="register-calendar-event"]');
    const form = ui.$("#transaction-form");
    assert.equal(form.elements.namedItem("amount").value.replace(/\D/g, ""), "900000");
    form.requestSubmit();
    await settle(ui.window);

    let saved = ui.saved();
    assert.equal(saved.transactions.length, 1);
    assert.equal(saved.calendarEvents[0].date, nextOccurrence(today, "monthly", rent.anchorDay), "next month, not 'done'");
    assert.equal(ui.$('[data-action="register-calendar-event"]'), null, "nothing due any more on Inicio");

    await ui.click('[data-action="undo-snackbar"]');
    saved = ui.saved();
    assert.equal(saved.transactions.length, 0);
    assert.equal(saved.calendarEvents[0].date, today, "undoing the expense undoes the step");
  } finally {
    ui.close();
  }
});

test("'Omitir esta vez' moves a repeating plan on without recording anything", async () => {
  const today = todayKey();
  const gym = { id: "gym", title: "Gimnasio", date: today, amount: 90_000, category: "free", repeat: "weekly" };
  const ui = await bootApp({ savedState: returningUserState({ calendarEvents: [gym] }) });
  try {
    await waitFor(ui, '[data-action="skip-calendar-event"]');
    await ui.click('[data-action="skip-calendar-event"]');
    const saved = ui.saved();
    assert.equal(saved.transactions?.length ?? 0, 0);
    assert.ok(saved.calendarEvents[0].date > today);
    assert.match(ui.text(), /no se registró esta vez/);
  } finally {
    ui.close();
  }
});

test("Tu periodo: where the money went, the card, and a document of the period to hand to an AI", async () => {
  const ui = await bootApp({
    savedState: returningUserState({
      budgetJobs: [{ id: "mercado", name: "Mercado", amount: 300_000, cadence: "monthly" }],
      liquidity: { account: 500_000, cash: 0, credit: 90_000, initialized: true },
      transactions: [
        expense({ id: "a", merchant: "Éxito", amount: 80_000, category: "mercado", labeled: true }),
        expense({ id: "b", merchant: "Rappi", amount: 60_000, source: "credit" }),
        expense({ id: "c", merchant: "Rappi", amount: 30_000, source: "credit", description: "domicilio | noche" })
      ]
    })
  });
  try {
    // A card payment is kept for the period's card summary (it is not an expense).
    await waitFor(ui, '[data-view="profile"]');
    await ui.click('[data-view="profile"]');
    await waitFor(ui, '[data-action="open-credit-payment"]');
    await ui.click('[data-action="open-credit-payment"]');
    const payment = ui.$("#credit-payment-form");
    payment.elements.namedItem("amount").value = "40000";
    payment.requestSubmit();
    await settle(ui.window);
    assert.deepEqual(ui.saved().creditPayments.map((item) => [item.amount, item.source]), [[40_000, "account"]]);

    await ui.click('[data-view="budget"]');
    await waitFor(ui, '[data-view="periodClose"]');
    await ui.click('[data-view="periodClose"]');
    const text = ui.text();
    assert.match(text, /En qué se fue/);
    assert.match(text, /Sin categoría\s*\$\s?90\.000 · 53%/);
    assert.match(text, /Tarjeta de crédito\s*2 compras\s*\$\s?90\.000/);
    assert.match(text, /Le pagaste \$\s?40\.000 a la tarjeta en este periodo\. Hoy le debes \$\s?50\.000\./);

    await ui.click('[data-action="open-period-report"]');
    const markdown = ui.$("#period-report-output").value;
    assert.match(markdown, /^# Mis finanzas: periodo/);
    assert.match(markdown, /\| Total gastado \| \$170\.000 en 3 gastos \|/);
    assert.match(markdown, /Pagos a la tarjeta en el periodo: \$40\.000 en 1 pago\. Hoy debo \$50\.000\./);
    assert.match(markdown, /\| Gasto \| Rappi - domicilio \/ noche \| Sin categoría \| Tarjeta[^|]* \| -\$30\.000 \|/);
    assert.doesNotMatch(markdown, /@/, "no email in the export");

    await ui.click('[data-action="close-period-report"]');
    await ui.click('[data-action="review-uncategorized"]');
    assert.equal(ui.window.document.querySelectorAll("#transaction-history-results .history-row").length, 2, "only the unclassified ones");
  } finally {
    ui.close();
  }
});

test("an expense can be recorded for yesterday or an earlier day, never a future one", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  const keyOf = (offset) => {
    const date = new Date(`${todayKey()}T12:00:00`);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const record = async ({ amount, merchant, choice, other, budgeted = true }) => {
    await waitFor(ui, '[data-action="open-expense"]');
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    form.elements.namedItem("amount").value = amount;
    form.elements.namedItem("merchant").value = merchant;
    form.elements.namedItem("budgeted").checked = budgeted;
    if (choice) await ui.click(`[data-choice-name="dateChoice"][data-choice-value="${choice}"]`);
    if (other) form.elements.namedItem("expenseDateOther").value = other;
    form.requestSubmit();
    await settle(ui.window);
  };
  const dateOf = (merchant) => ui.saved().transactions.find((item) => item.merchant === merchant)?.date;
  try {
    await record({ amount: "12000", merchant: "Hoy" });
    assert.equal(dateOf("Hoy"), todayKey(), "today unless told otherwise");

    await record({ amount: "8000", merchant: "Ayer", choice: "yesterday" });
    assert.equal(dateOf("Ayer"), keyOf(-1));

    // Big and not planned, but from a past day: it already happened, so no 24-hour pause.
    await record({ amount: "900000", merchant: "Little Caesars", choice: "other", other: keyOf(-5), budgeted: false });
    assert.equal(dateOf("Little Caesars"), keyOf(-5));
    assert.equal(ui.saved().cooldowns?.length ?? 0, 0);
    assert.match(ui.text(), /Quedó con fecha del/);

    await record({ amount: "5000", merchant: "Mañana", choice: "other", other: keyOf(1) });
    assert.equal(dateOf("Mañana"), undefined, "a future day is refused (the picker's max blocks it)");
  } finally {
    ui.close();
  }
});

test("Editar categoría: rename it and change its limit from this period on, within what is free; deleting is one step further", async () => {
  const ui = await bootApp({
    savedState: returningUserState({
      budgetJobs: [
        { id: "gas", name: "Gasolina", amount: 150_000, cadence: "monthly" },
        { id: "soat", name: "Soat", amount: 400_000, cadence: "once" }
      ],
      transactions: [
        expense({ id: "a", merchant: "Terpel", amount: 120_000, category: "gas", labeled: true }),
        expense({ id: "b", merchant: "Seguros", amount: 100_000, category: "soat", labeled: true })
      ]
    })
  });
  const edit = async (id, values) => {
    await ui.click(`[data-action="open-edit-job"][data-id="${id}"]`);
    const form = ui.$("#edit-job-form");
    for (const [name, value] of Object.entries(values)) {
      if (name === "cadence" || name === "fundMode") await ui.click(`#edit-job-form [data-choice-name="${name}"][data-choice-value="${value}"]`);
      else form.elements.namedItem(name).value = value;
    }
    form.requestSubmit();
    await settle(ui.window);
  };
  const job = (id) => ui.saved().budgetJobs.find((item) => item.id === id);
  try {
    await waitFor(ui, '[data-view="budget"]');
    await ui.click('[data-view="budget"]');
    await waitFor(ui, '[data-action="open-edit-job"]');

    await edit("gas", { name: "Gasolina moto", amount: "200000" });
    assert.deepEqual([job("gas").name, job("gas").amount, job("gas").cadence], ["Gasolina moto", 200_000, "monthly"]);
    assert.equal(ui.saved().transactions[0].category, "gas", "its expenses keep their category");
    assert.match(ui.text(), /ahora aparta \$\s?200\.000 por periodo \(antes \$\s?150\.000\)/);

    await edit("gas", { amount: "99000000" });
    assert.equal(job("gas").amount, 200_000, "more than what is free is refused");

    await edit("gas", { amount: "50000", cadence: "weekly" });
    assert.deepEqual([job("gas").amount, job("gas").cadence], [50_000, "weekly"]);

    // Money set aside: say how much to add or take out, not the new total (no adding up by
    // hand); taking out never goes below what was already spent from it.
    await ui.click('[data-action="open-edit-job"][data-id="soat"]');
    assert.match(ui.text(), /Apartado ahora: \$\s?400\.000/);
    const typed = ui.$("#edit-job-form").elements.namedItem("fundDelta");
    typed.value = "50000";
    typed.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
    assert.match(ui.$("[data-fund-preview]").textContent, /Quedará en \$\s?450\.000/);
    await ui.click('[data-action="close-plan-sheet"]');

    await edit("soat", { fundDelta: "50000" });
    assert.deepEqual(job("soat").topUps.map((topUp) => topUp.amount), [50_000]);
    await edit("soat", { fundMode: "remove", fundDelta: "150000" });
    assert.deepEqual(job("soat").released.map((release) => release.amount), [150_000]);
    assert.match(ui.text(), /Soat ahora tiene \$\s?300\.000 apartados \(antes \$\s?450\.000\)/);
    await edit("soat", { fundMode: "remove", fundDelta: "250000" });
    assert.equal(job("soat").released.length, 1, "it cannot go below the $100.000 already spent");
    assert.match(ui.text(), /Solo puedes quitar \$\s?200\.000 de Soat/);
    await ui.click('[data-action="close-plan-sheet"]');

    await ui.click('[data-action="open-edit-job"][data-id="soat"]');
    await ui.click('#edit-job-form [data-action="request-remove-job"]');
    assert.ok(ui.$("#remove-category-title"), "deleting still asks for confirmation");
  } finally {
    ui.close();
  }
});

test("Inicio splits libre into the account and cash, so the account can be checked against the bank", async () => {
  const start = todayKey();
  const fixed = (liquidity) =>
    returningUserState({
      profile: { ...returningUserState().profile, incomeType: "fixed", incomeAmount: 1_500_000, periodStart: start },
      liquidity: { initialized: true, ...liquidity },
      periodIncomeStatus: { windowStart: start, applied: true, amount: 0, bannerDismissed: true, location: "account" },
      budgetJobs: [{ id: "gas", name: "Gasolina", amount: 300_000, cadence: "once", windowStart: start }]
    });
  const amounts = (ui) => [...ui.window.document.querySelectorAll(".money-free-split strong")].map((node) => node.textContent.replace(/\D/g, ""));

  const ui = await bootApp({ savedState: fixed({ account: 500_000, cash: 80_000, credit: 20_000 }) });
  try {
    await waitFor(ui, ".money-free-split");
    assert.deepEqual(amounts(ui), ["180000", "80000"], "500.000 - 20.000 owed - 300.000 reserved; the cash apart");
    assert.equal(ui.$(".money-free-split-note"), null, "no note while the account covers it all");
  } finally {
    ui.close();
  }

  const short = await bootApp({ savedState: fixed({ account: 250_000, cash: 80_000, credit: 0 }) });
  try {
    await waitFor(short, ".money-free-split");
    assert.deepEqual(amounts(short), ["0", "30000"]);
    assert.match(short.text(), /Lo reservado no cabe en tu cuenta: \$\s?50\.000 salen del efectivo/);
  } finally {
    short.close();
  }

  const noCash = await bootApp({ savedState: fixed({ account: 500_000, cash: 0, credit: 0 }) });
  try {
    await waitFor(noCash, ".money-bar");
    assert.equal(noCash.$(".money-free-split"), null, "without cash, libre is all in the account already");
  } finally {
    noCash.close();
  }
});

test("Cuadrar con tu banco: each pocket against the bank, interest noted into its category, and pockets shared by several", async () => {
  const start = todayKey();
  const ui = await bootApp({
    savedState: returningUserState({
      profile: { ...returningUserState().profile, incomeType: "fixed", incomeAmount: 1_500_000, periodStart: start },
      liquidity: { initialized: true, account: 2_000_000, cash: 50_000, credit: 40_000 },
      periodIncomeStatus: { windowStart: start, applied: true, amount: 0, bannerDismissed: true, location: "account" },
      budgetJobs: [
        { id: "soat", name: "Soat", amount: 350_000, cadence: "once", windowStart: start },
        { id: "plan", name: "Plan pospago", amount: 31_000, cadence: "once", windowStart: start, bankBox: "Varios" },
        { id: "park", name: "Parqueadero", amount: 20_000, cadence: "once", windowStart: start }
      ]
    })
  });
  const row = (label) => [...ui.window.document.querySelectorAll(".reconcile-row")].find((item) => item.querySelector(".reconcile-head strong").textContent === label);
  const type = async (key, value) => {
    const input = ui.$(`[data-reconcile-key="${key}"]`);
    input.value = value;
    input.dispatchEvent(new ui.window.Event("change", { bubbles: true }));
    await settle(ui.window);
  };
  try {
    await waitFor(ui, '[data-view="budget"]');
    await ui.click('[data-view="budget"]');
    await ui.click('[data-view="reconcile"]');
    await waitFor(ui, ".reconcile-row");
    assert.deepEqual(
      [...ui.window.document.querySelectorAll(".reconcile-head")].map((head) => head.textContent.replace(/\s+/g, " ").trim()),
      ["Libre La app: $ 1.559.000", "Soat La app: $ 350.000", "Varios La app: $ 31.000", "Parqueadero La app: $ 20.000", "Para pagar la tarjeta La app: $ 40.000"]
    );

    await type("box:soat", "351729");
    assert.match(row("Soat").textContent, /Cuadra, y tu banco tiene \$\s?1\.729 más: son rendimientos/);
    assert.equal(ui.saved().bankChecks["box:soat"].amount, 351_729);

    await ui.click('[data-action="register-interest"][data-id="box:soat"]');
    const saved = ui.saved();
    assert.equal(saved.liquidity.account, 2_001_729, "the interest is in the account now");
    assert.deepEqual(saved.budgetJobs.find((job) => job.id === "soat").topUps.map((topUp) => topUp.amount), [1729], "and set aside in Soat");
    assert.equal(saved.budgetExtras.at(-1).source, "Rendimientos Soat");
    assert.match(row("Soat").textContent, /Cuadra\./);

    await type("free", "1400000");
    assert.match(row("Libre").textContent, /Tu banco tiene \$\s?159\.000 menos/);
    assert.match(ui.text(), /Cuadran 1 de 2/);
    assert.match(ui.text(), /Tu efectivo \(\$\s?50\.000\) no está en el banco/);

    // Parqueadero joins the "Varios" pocket from Editar categoría, picked from a list:
    // its own pocket, the other categories' and "Otra…".
    await ui.click('[data-view="budget"]');
    await ui.click('[data-action="open-edit-job"][data-id="park"]');
    assert.deepEqual(
      [...ui.window.document.querySelectorAll('#edit-job-form [data-choice-name="bankBox"]')].map((pill) => pill.textContent.trim()),
      ["Su propia cajita", "Soat", "Varios", "Otra…"]
    );
    await ui.click('#edit-job-form [data-choice-name="bankBox"][data-choice-value="Varios"]');
    ui.$("#edit-job-form").requestSubmit();
    await settle(ui.window);
    await ui.click('[data-view="reconcile"]');
    await waitFor(ui, ".reconcile-row");
    assert.match(row("Varios").textContent, /La app: \$\s?51\.000/);
    assert.match(row("Varios").textContent, /Plan pospago \$\s?31\.000 · Parqueadero \$\s?20\.000/);
    assert.equal(row("Parqueadero"), undefined);
  } finally {
    ui.close();
  }
});

test("a category's pocket can be a new shared name with 'Otra…', and going back to its own clears it", async () => {
  const ui = await bootApp({
    savedState: returningUserState({ budgetJobs: [{ id: "soat", name: "Soat", amount: 350_000, cadence: "once", windowStart: todayKey() }] })
  });
  const save = async (choice, other) => {
    await ui.click('[data-action="open-edit-job"][data-id="soat"]');
    await ui.click(`#edit-job-form [data-choice-name="bankBox"][data-choice-value="${choice}"]`);
    if (other !== undefined) {
      assert.equal(ui.$("#edit-job-form").elements.namedItem("bankBoxOther").hidden, false, "'Otra…' shows the name field");
      ui.$("#edit-job-form").elements.namedItem("bankBoxOther").value = other;
    }
    ui.$("#edit-job-form").requestSubmit();
    await settle(ui.window);
  };
  try {
    await waitFor(ui, '[data-view="budget"]');
    await ui.click('[data-view="budget"]');
    await waitFor(ui, '[data-action="open-edit-job"]');
    await save("__other", "Moto");
    assert.equal(ui.saved().budgetJobs[0].bankBox, "Moto");
    await ui.click('[data-action="open-edit-job"][data-id="soat"]');
    assert.equal(ui.$('#edit-job-form [data-choice-name="bankBox"].is-active').textContent.trim(), "Moto", "the saved pocket comes selected");
    await ui.click('[data-action="close-plan-sheet"]');
    await save("");
    assert.equal(ui.saved().budgetJobs[0].bankBox, "");
  } finally {
    ui.close();
  }
});

// Real case, October 2026: "1244082" typed into Libre was saved as 12.440 and the message
// said the bank had $1.231.251 less: a background re-render (a sync, the network coming
// back) rebuilt the screen mid-number. Now nothing rebuilds the screen while a field on it
// has the cursor, the message follows each keystroke, and the amount gets its dots.
test("Cuadrar: the message follows the number as it is typed, and nothing re-renders the field mid-typing", async () => {
  const start = todayKey();
  const ui = await bootApp({
    savedState: returningUserState({
      profile: { ...returningUserState().profile, incomeType: "fixed", incomeAmount: 1_500_000, periodStart: start },
      liquidity: { initialized: true, account: 1_243_691, cash: 0, credit: 0 },
      periodIncomeStatus: { windowStart: start, applied: true, amount: 0, bannerDismissed: true, location: "account" }
    })
  });
  const status = () => ui.$(".reconcile-status").textContent;
  const typeKeys = (input, text) => {
    for (const digit of text) {
      input.value += digit;
      input.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
    }
  };
  try {
    await waitFor(ui, '[data-view="budget"]');
    await ui.click('[data-view="budget"]');
    await ui.click('[data-view="reconcile"]');
    await waitFor(ui, '[data-reconcile-key="free"]');
    const input = ui.$('[data-reconcile-key="free"]');
    input.focus();
    typeKeys(input, "12440");
    assert.match(status(), /Tu banco tiene \$\s?1\.231\.251 menos/, "half typed, said as it is");

    assert.equal(input.value, "12.440", "thousands dots as it is typed");

    // The network drops and comes back mid-typing: that re-renders in the background.
    ui.window.dispatchEvent(new ui.window.Event("offline"));
    ui.window.dispatchEvent(new ui.window.Event("online"));
    await settle(ui.window);
    const again = ui.$('[data-reconcile-key="free"]');
    assert.equal(again, input, "the field was not rebuilt under the finger");
    assert.equal(again.value, "12.440");
    assert.equal(ui.saved().bankChecks?.free, undefined, "and nothing was saved yet");

    typeKeys(again, "82");
    assert.match(status(), /Cuadra, y tu banco tiene \$\s?391 más: son rendimientos/);
    again.dispatchEvent(new ui.window.Event("change", { bubbles: true }));
    await settle(ui.window);
    assert.equal(ui.saved().bankChecks.free.amount, 1_244_082);
  } finally {
    ui.close();
  }
});

// Every save, sync or bank notification rebuilds the app from HTML; replaying the entrance
// animations each time made it blink as if reloading. Only what is new animates.
test("re-rendering the same screen keeps it still; a new screen, sheet or amount animates", async () => {
  const ui = await bootApp({ savedState: returningUserState() });
  const app = ui.$("#app");
  const rerender = async () => {
    ui.window.dispatchEvent(new ui.window.Event("online"));
    await settle(ui.window);
  };
  try {
    await waitFor(ui, ".money-bar");
    await rerender();
    assert.ok(app.classList.contains("is-same-view"), "Inicio re-rendered: no fade-in");
    assert.ok(app.classList.contains("keeps-free"), "same free money: no pop");

    await ui.click('[data-view="budget"]');
    assert.ok(!app.classList.contains("is-same-view"), "entering Plan fades in");

    await ui.click('[data-action="open-add-category-choice"]');
    assert.ok(!app.classList.contains("keeps-dialog"), "a sheet that just opened animates in");
    await ui.click('[data-action="open-setaside-sheet"]');
    assert.ok(!app.classList.contains("keeps-dialog"), "and so does the next, different sheet");
    await ui.click('[data-action="close-plan-sheet"]');
    await ui.click('[data-view="today"]');
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    form.elements.namedItem("amount").value = "15000";
    form.requestSubmit();
    await settle(ui.window);
    assert.ok(!app.classList.contains("keeps-free"), "a new free amount pops");
  } finally {
    ui.close();
  }
});
