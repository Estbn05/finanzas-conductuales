// Recording an expense by hand has to be fast or people stop doing it. These drive the
// real "Registrar gasto" sheet in jsdom: frequent expenses as one-tap "Repetir" chips,
// "Pagado con" starting where the last expense was paid, and a known merchant filling in
// its usual category and payment on its own — without ever overriding a manual choice.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState, settle, todayKey } from "./helpers/boot-app.mjs";

const GASOLINA = { id: "gasolina", name: "Gasolina", amount: 300_000, cadence: "monthly" };

function transaction(overrides) {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    date: todayKey(),
    merchant: "Tienda",
    amount: 10_000,
    category: "free",
    labeled: false,
    source: "account",
    updated_at: `${todayKey()}T10:00:00.000Z`,
    ...overrides
  };
}

const terpel = (overrides = {}) =>
  transaction({ merchant: "Terpel", amount: 80_000, category: "gasolina", labeled: true, source: "cash", ...overrides });

function userWithHabits(extra = []) {
  return returningUserState({
    liquidity: { account: 1_500_000, cash: 200_000, initialized: true },
    budgetJobs: [GASOLINA],
    transactions: [terpel({ amount: 75_000 }), terpel({ updated_at: `${todayKey()}T11:00:00.000Z` }), ...extra]
  });
}

// The first boot in a process shows the stepped loading screen a little longer than
// settle() waits, so wait for the button instead of assuming it is there.
async function openExpenseSheet(ui) {
  for (let i = 0; i < 40 && !ui.$('[data-action="open-expense"]'); i += 1) {
    await settle(ui.window);
  }
  await ui.click('[data-action="open-expense"]');
}

function choice(form, name) {
  return form.elements.namedItem(name).value;
}

function typeMerchant(ui, form, value) {
  const input = form.elements.namedItem("merchant");
  input.value = value;
  input.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
}

test("a frequent expense is one tap away: the Repetir chip fills the whole form", async () => {
  const ui = await bootApp({ savedState: userWithHabits() });
  try {
    await openExpenseSheet(ui);
    const chips = [...ui.window.document.querySelectorAll(".quick-repeat")];
    assert.equal(chips.length, 1, "Terpel was paid twice, so it is a repeat");
    assert.match(chips[0].textContent, /Terpel/);
    assert.match(chips[0].textContent, /80\.000/, "latest amount, not the older 75.000");

    await ui.click(".quick-repeat");
    const form = ui.$("#transaction-form");
    assert.equal(form.elements.namedItem("merchant").value, "Terpel");
    assert.equal(choice(form, "category"), "gasolina");
    assert.equal(choice(form, "source"), "cash");

    form.requestSubmit();
    await settle(ui.window);
    const saved = ui.saved();
    const added = saved.transactions.at(-1);
    assert.equal(added.amount, 80_000);
    assert.equal(added.category, "gasolina");
    assert.equal(added.source, "cash");
    assert.equal(saved.liquidity.cash, 120_000, "paid in cash, so cash went down");
  } finally {
    ui.close();
  }
});

test("no repeats are offered before any habit exists", async () => {
  const ui = await bootApp({ savedState: returningUserState({ transactions: [transaction({ merchant: "Cine" })] }) });
  try {
    await openExpenseSheet(ui);
    assert.equal(ui.$(".quick-repeats"), null);
  } finally {
    ui.close();
  }
});

test("Pagado con starts where the last expense was paid", async () => {
  const ui = await bootApp({ savedState: userWithHabits() });
  try {
    await openExpenseSheet(ui);
    assert.equal(choice(ui.$("#transaction-form"), "source"), "cash");
  } finally {
    ui.close();
  }
});

test("a known merchant fills its usual category and payment on its own, and undoes it if retyped", async () => {
  const later = `${todayKey()}T12:00:00.000Z`;
  const ui = await bootApp({ savedState: userWithHabits([transaction({ merchant: "Cine", source: "account", updated_at: later })]) });
  try {
    await openExpenseSheet(ui);
    const form = ui.$("#transaction-form");
    assert.equal(choice(form, "category"), "free");
    assert.equal(choice(form, "source"), "account", "the latest expense (Cine) was paid from the account");

    typeMerchant(ui, form, "Terpel");
    assert.equal(choice(form, "category"), "gasolina");
    assert.equal(choice(form, "source"), "cash");
    assert.match(ui.$("[data-merchant-rule-suggestion]").textContent, /Gasolina/);
    assert.equal(ui.$("[data-merchant-rule-suggestion]").hidden, false);

    typeMerchant(ui, form, "Farmacia");
    assert.equal(choice(form, "category"), "free", "the auto-filled category is undone for an unknown merchant");
    assert.equal(choice(form, "source"), "account");
    assert.equal(ui.$("[data-merchant-rule-suggestion]").hidden, true);
  } finally {
    ui.close();
  }
});

test("a choice made by hand is never overridden by the merchant's usual category", async () => {
  const ui = await bootApp({ savedState: userWithHabits() });
  try {
    await openExpenseSheet(ui);
    const form = ui.$("#transaction-form");
    await ui.click('[data-choice-name="source"][data-choice-value="account"]');

    typeMerchant(ui, form, "Terpel");
    assert.equal(choice(form, "category"), "gasolina", "category was not touched, so it is filled");
    assert.equal(choice(form, "source"), "account", "payment was picked by hand, so it stays");
  } finally {
    ui.close();
  }
});

// Merchants never filed before (categorize.js layers 2 and 3).
test("a new branch of a known brand gets the category and payment used at the other branch", async () => {
  const ui = await bootApp({
    savedState: returningUserState({
      liquidity: { account: 1_500_000, cash: 200_000, initialized: true },
      budgetJobs: [{ id: "casa", name: "Casa", amount: 600_000, cadence: "monthly" }],
      transactions: [transaction({ merchant: "Carulla Calle 80", category: "casa", labeled: true, source: "cash" })]
    })
  });
  try {
    await openExpenseSheet(ui);
    const form = ui.$("#transaction-form");
    typeMerchant(ui, form, "CARULLA CALLE 63");
    assert.equal(choice(form, "category"), "casa");
    assert.equal(choice(form, "source"), "cash");
  } finally {
    ui.close();
  }
});

test("a well-known merchant fills only the category named for it, and says why", async () => {
  const ui = await bootApp({
    savedState: returningUserState({
      liquidity: { account: 1_500_000, cash: 200_000, initialized: true },
      budgetJobs: [GASOLINA, { id: "soat", name: "Soat", amount: 400_000, cadence: "monthly" }],
      transactions: [transaction({ merchant: "Cine", source: "cash" })]
    })
  });
  try {
    await openExpenseSheet(ui);
    const form = ui.$("#transaction-form");
    const sourceBefore = choice(form, "source");
    typeMerchant(ui, form, "EDS TERPEL AV BOYACA");
    assert.equal(choice(form, "category"), "gasolina");
    assert.equal(choice(form, "source"), sourceBefore, "a dictionary knows the place, not the card");
    assert.match(form.querySelector("[data-merchant-rule-suggestion]").textContent, /por el nombre del comercio/);

    typeMerchant(ui, form, "Préstamo a un amigo");
    assert.equal(choice(form, "category"), "free", "nothing it cannot tell is guessed");
  } finally {
    ui.close();
  }
});
