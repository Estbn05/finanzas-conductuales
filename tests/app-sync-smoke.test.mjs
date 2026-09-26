// Smoke tests for the signed-in, cloud-backed app. Separate file on purpose: node --test
// runs each file in its own process, and sync-client.js reads the cloud config (and caches
// its client) once per process, so these boots need a mocked Supabase from the first one.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState, settle } from "./helpers/boot-app.mjs";

const USER = { id: "user-smoke", email: "smoke@example.com" };
const SESSION = {
  access_token: "smoke-access",
  refresh_token: "smoke-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: USER
};

// One mock for the whole file (sync-client caches the first client it creates); tests
// reset its knobs instead of creating new ones.
const cloud = {
  failSaves: false,
  saves: 0,
  remote: null,
  auth: {
    getSession: async () => ({ data: { session: SESSION }, error: null }),
    setSession: async () => ({ data: { session: SESSION }, error: null }),
    getUser: async () => ({ data: { user: USER }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async ({ password }) =>
      password === "correcta"
        ? { data: { session: SESSION }, error: null }
        : { data: { session: null }, error: { message: "Invalid login credentials" } }
  },
  from() {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: cloud.remote, error: null }) })
      }),
      upsert: (row) => ({
        select: () => ({
          single: async () => {
            if (cloud.failSaves) {
              return { data: null, error: { message: "Failed to fetch" } };
            }
            cloud.saves += 1;
            cloud.remote = { app_state: row.app_state, updated_at: row.updated_at };
            return { data: { updated_at: row.updated_at }, error: null };
          }
        })
      })
    };
  }
};

function bootSignedIn({ savedState = returningUserState(), lockConfig } = {}) {
  return bootApp({
    savedState,
    lockConfig,
    syncConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "smoke-key" },
    beforeBoot(window) {
      window.supabase = { createClient: () => cloud, processLock: async (_name, _timeout, callback) => callback() };
      window.localStorage.setItem("finanzas-conductuales:cloud-session:v1", JSON.stringify(SESSION));
    }
  });
}

function reset({ failSaves = false } = {}) {
  cloud.failSaves = failSaves;
  cloud.saves = 0;
  cloud.remote = null;
}

test("a signed-in user sees a quiet 'Guardado en la nube' in the menu and no banner", async () => {
  reset();
  const ui = await bootSignedIn();
  try {
    assert.ok(cloud.saves >= 1, "the first sync never reached the cloud");
    assert.match(ui.$(".sync-status").textContent, /Guardado en la nube/);
    assert.equal(ui.$(".sync-problem-banner"), null);
  } finally {
    ui.close();
  }
});

// Regression: a failed save used to be invisible once inside the app, so a user could go
// days believing they had a cloud backup they didn't.
test("a failed cloud save shows a banner that reassures and offers a working retry", async () => {
  reset({ failSaves: true });
  const ui = await bootSignedIn();
  try {
    const banner = ui.$(".sync-problem-banner");
    assert.ok(banner, "the failed save was not surfaced");
    assert.match(banner.textContent, /No se pudo guardar en la nube/);
    assert.match(banner.textContent, /siguen seguros en este teléfono/);
    assert.match(ui.$(".sync-status").textContent, /No se pudo guardar/);
    // The user's own money is still right there.
    assert.match(ui.text(), /Tu dinero libre/);

    cloud.failSaves = false;
    await ui.click('[data-action="retry-cloud-sync"]');

    assert.equal(ui.$(".sync-problem-banner"), null, "the banner stayed after a successful retry");
    assert.match(ui.$(".sync-status").textContent, /Guardado en la nube/);
    assert.equal(cloud.saves, 1);
  } finally {
    ui.close();
  }
});

// Regression: the whole state syncs as one piece, so when another device saved first
// this device's unsynced edits were replaced without a word.
test("downloading another device's version over unsynced local edits says so", async () => {
  reset();
  const remoteState = returningUserState({ transactions: [{ id: "otro", merchant: "Desde el otro teléfono", amount: 5_000, date: "2026-01-01" }] });
  cloud.remote = { app_state: remoteState, updated_at: new Date(Date.now() + 60_000).toISOString() };
  const local = returningUserState({
    updated_at: new Date().toISOString(),
    meta: { cloudUpdatedAt: new Date(Date.now() - 3_600_000).toISOString() }
  });
  const ui = await bootSignedIn({ savedState: local });
  try {
    assert.match(ui.text(), /Trajimos cambios de otro dispositivo/);
    await ui.click('[data-action="dismiss-cloud-conflict"]');
    assert.doesNotMatch(ui.text(), /Trajimos cambios de otro dispositivo/);
  } finally {
    ui.close();
  }
});

test("a download with nothing unsynced locally stays quiet", async () => {
  reset();
  cloud.remote = { app_state: returningUserState(), updated_at: new Date(Date.now() + 60_000).toISOString() };
  const synced = new Date().toISOString();
  const ui = await bootSignedIn({ savedState: returningUserState({ updated_at: synced, meta: { cloudUpdatedAt: synced } }) });
  try {
    assert.doesNotMatch(ui.text(), /Trajimos cambios de otro dispositivo/);
  } finally {
    ui.close();
  }
});

// A forgotten PIN used to leave only "clear the app's data" as a way back in.
test("'Olvidé mi PIN' unlocks with the account password and turns the lock off", async () => {
  reset();
  const lockConfig = { enabled: true, hash: "no-match", salt: "s", biometric: false, failedAttempts: 0, lockUntil: 0 };
  const ui = await bootSignedIn({
    savedState: returningUserState({ meta: { cloudUserEmail: USER.email } }),
    lockConfig
  });
  try {
    await ui.click("[data-lock-forgot]");
    let form = ui.$("#lock-forgot-form");
    assert.ok(form, "no password form for an account holder");
    form.elements.namedItem("password").value = "mala";
    form.requestSubmit();
    await settle(ui.window);
    assert.match(ui.text(), /no coincide con tu cuenta/);

    form = ui.$("#lock-forgot-form");
    form.elements.namedItem("password").value = "correcta";
    form.requestSubmit();
    await settle(ui.window);
    assert.equal(ui.$(".lock-screen"), null, "still locked after the right password");
    assert.match(ui.text(), /Tu dinero libre/);
    const stored = JSON.parse(ui.window.localStorage.getItem("finanzas-conductuales-lock:v1"));
    assert.equal(stored.enabled, false);
  } finally {
    ui.close();
  }
});


// Regression: signing in from "Usar sin cuenta" with nothing entered yet raised the
// "your edits were replaced" banner though there was nothing to lose.
test("a download over a device with no real data stays quiet", async () => {
  reset();
  cloud.remote = { app_state: returningUserState(), updated_at: new Date(Date.now() + 60_000).toISOString() };
  const empty = { meta: { localOnly: true, cloudUpdatedAt: "" }, updated_at: new Date().toISOString(), profile: { completed: false } };
  const ui = await bootSignedIn({ savedState: empty });
  try {
    assert.doesNotMatch(ui.text(), /Trajimos cambios de otro dispositivo/);
  } finally {
    ui.close();
  }
});
