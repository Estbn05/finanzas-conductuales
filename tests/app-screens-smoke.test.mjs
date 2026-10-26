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
