// The app used by someone without an account ("Usar sin cuenta"). Own file on purpose:
// sync-client.js caches the first Supabase client per process, and here there must never
// be a session.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState, settle } from "./helpers/boot-app.mjs";

const cloud = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    setSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null })
  },
  from() {
    throw new Error("a signed-out app must not touch the cloud table");
  }
};

function reset() {}

function bootSignedOut(savedState) {
  return bootApp({
    savedState,
    syncConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "smoke-key" },
    beforeBoot(window) {
      window.supabase = { createClient: () => cloud, processLock: async (_name, _timeout, callback) => callback() };
    }
  });
}

async function waitFor(ui, predicate) {
  for (let i = 0; i < 40 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(ui.window);
  }
}

// Requiring an account before showing anything drove people away in the first minute.
test("'Usar sin cuenta' goes straight to onboarding and is remembered", async () => {
  reset();
  const ui = await bootSignedOut(undefined);
  let saved;
  try {
    await waitFor(ui, () => ui.$('[data-action="use-without-account"]'));
    assert.match(ui.text(), /Política de privacidad/);
    await ui.click('[data-action="use-without-account"]');
    await waitFor(ui, () => ui.$("#onboarding-form"));
    assert.ok(ui.$("#onboarding-form"), "no onboarding after choosing to use the app without an account");
    saved = ui.saved();
    assert.equal(saved.meta.localOnly, true);
    // Chosen by mistake? Signing in stays one tap away, even before onboarding is done.
    assert.ok(ui.$('#onboarding-form') && ui.$('[data-action="request-account"][data-auth-mode="signin"]'));
  } finally {
    ui.close();
  }

  const again = await bootSignedOut(saved);
  try {
    await waitFor(again, () => again.$("#onboarding-form"));
    assert.ok(again.$("#onboarding-form"), "reopening asked for an account again");
  } finally {
    again.close();
  }
});

test("a local-only user can ask for an account later, and go back", async () => {
  reset();
  const ui = await bootSignedOut(returningUserState({ meta: { localOnly: true } }));
  try {
    await waitFor(ui, () => /Tu dinero libre/.test(ui.text()));
    await ui.click('[data-view="profile"]');
    assert.match(ui.text(), /Sin cuenta/);
    assert.equal(ui.$('[data-action="cloud-sign-out"]'), null);
    await ui.click('.local-only-section [data-action="request-account"]');
    assert.ok(ui.$('[data-action="show-auth-form"][data-auth-mode="signup"]'), "the account screen did not open");
    await ui.click('[data-action="use-without-account"]');
    assert.ok(ui.$(".bottom-nav"), "could not go back to the app");
    assert.match(ui.text(), /Sin cuenta/);
  } finally {
    ui.close();
  }
});

// The whole first-run form, as a new user fills it. The onboarding answers nothing for
// the user (no preselected cadence, type or categories), and the real balance on step 2
// is independent of the income: it used to have to add up to it exactly, which blocked
// anyone starting from $0.
test("onboarding: fixed biweekly income, $0 balances, one category, and Inicio opens with it", async () => {
  reset();
  const ui = await bootSignedOut({ meta: { localOnly: true }, profile: { completed: false } });
  try {
    await waitFor(ui, () => ui.$("#onboarding-form"));
    const form = ui.$("#onboarding-form");
    const next = () => ui.click("[data-onboarding-next]");
    const error = () => form.querySelector(".onboarding-error").textContent;

    await next();
    assert.match(error(), /fijo o variable/, "nothing is preselected for the user");

    await ui.click('[data-onboarding-income-type="fixed"]');
    await ui.click('[data-onboarding-cadence="biweekly"]');
    await ui.type(form.elements.namedItem("incomeAmount"), "1200000");
    assert.ok(form.elements.namedItem("periodStart").value, "a fixed income asks for the payday");
    await next();
    assert.equal(error(), "");

    await ui.type(form.elements.namedItem("account"), "0");
    await ui.type(form.elements.namedItem("cash"), "0");
    await next();
    assert.equal(error(), "", "starting from $0 is allowed");

    await ui.click("[data-onboarding-category-chip]");
    assert.match(form.querySelector("[data-onboarding-category-count]").textContent, /1 categoría seleccionada/);
    form.requestSubmit(form.querySelector(".onboarding-finish"));
    await waitFor(ui, () => /Tu dinero libre/.test(ui.text()));

    const saved = ui.saved();
    assert.equal(saved.profile.completed, true);
    assert.equal(saved.profile.incomeType, "fixed");
    assert.equal(saved.profile.incomeCadence, "biweekly");
    assert.equal(saved.profile.incomeAmount, 1_200_000);
    assert.equal(saved.budgetJobs.length, 1);
  } finally {
    ui.close();
  }
});
