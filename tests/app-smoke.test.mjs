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

async function bootApp({ savedState } = {}) {
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
