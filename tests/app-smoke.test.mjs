// Smoke tests that actually run app.js in a simulated browser (jsdom), instead of
// searching its source for substrings. Each test boots a fresh app instance against a
// fresh DOM and drives it through real clicks and form submits.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const STORAGE_KEY = "finanzas-conductuales:v1";
let bootCount = 0;

function todayKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

// A returning user: onboarding done, variable income (so no automatic payday deposit
// muddies the numbers), a real balance on file, no cloud configured.
function returningUserState(overrides = {}) {
  return {
    activeView: "today",
    profile: {
      completed: true,
      incomeType: "variable",
      volatility: "medium",
      incomeCadence: "monthly",
      incomeAmount: 2_000_000,
      periodStart: `${todayKey().slice(0, 8)}01`,
      committedExpenses: 0,
      emergencySavings: 0
    },
    liquidity: { account: 1_500_000, cash: 0, initialized: true },
    budgetJobs: [],
    transactions: [],
    ...overrides
  };
}

async function bootApp({ savedState, lockConfig } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: "https://localhost/",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // No Supabase config: the app runs local-only, the way it must keep working offline.
  window.FINANZAS_SYNC_CONFIG = {};
  if (savedState) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
  }
  if (lockConfig) {
    window.localStorage.setItem("finanzas-conductuales-lock:v1", JSON.stringify(lockConfig));
  }

  const globals = {
    window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    navigator: window.navigator,
    location: window.location,
    FormData: window.FormData,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  bootCount += 1;
  await import(`../app.js?smoke=${bootCount}`);
  await settle(window);

  const app = window.document.querySelector("#app");
  return {
    window,
    app,
    text: () => app.textContent.replace(/\s+/g, " "),
    $: (selector) => window.document.querySelector(selector),
    click: async (selector) => {
      const element = window.document.querySelector(selector);
      assert.ok(element, `nothing matches ${selector}`);
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await settle(window);
    },
    // Sets a field the way typing would: value, then the input event listeners react to.
    type: async (element, value) => {
      element.value = value;
      element.dispatchEvent(new window.Event("input", { bubbles: true }));
      await settle(window);
    },
    saved: () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"),
    close: () => window.close()
  };
}

// Let the async boot (initializeCloudSync, microtasks, rAF polling) finish.
async function settle(window) {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  }
}

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
