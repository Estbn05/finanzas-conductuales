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
    getSession: async () => ({ data: { session: cloud.session }, error: null }),
    setSession: async () => ({ data: { session: SESSION }, error: null }),
    getUser: async () => ({ data: { user: USER }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => (cloud.signOutHangs ? new Promise(() => {}) : Promise.resolve({ error: null })),
    // An email that already has an account comes back without error and with no
    // identities: Supabase's way of not revealing which emails are registered.
    signUp: async ({ email }) => ({
      data: { user: { id: "new", email, identities: email === "ya@example.com" ? [] : [{ id: "i" }] }, session: null },
      error: null
    }),
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
      }),
      // Conditional save: only lands if the row is still the version that was read.
      update: (row) => {
        let expected = null;
        const query = {
          eq(column, value) {
            if (column === "updated_at") expected = value;
            return query;
          },
          select: () => ({
            maybeSingle: async () => {
              if (cloud.failSaves) {
                return { data: null, error: { message: "Failed to fetch" } };
              }
              if (cloud.beforeUpdate) {
                const hook = cloud.beforeUpdate;
                cloud.beforeUpdate = null;
                hook();
              }
              if (!cloud.remote || cloud.remote.updated_at !== expected) {
                cloud.conflicts += 1;
                return { data: null, error: null };
              }
              cloud.saves += 1;
              cloud.remote = { app_state: row.app_state, updated_at: row.updated_at };
              return { data: { updated_at: row.updated_at }, error: null };
            }
          })
        };
        return query;
      }
    };
  }
};

function bootSignedIn({ savedState = returningUserState(), lockConfig, beforeBoot: extraBoot } = {}) {
  return bootApp({
    savedState,
    lockConfig,
    syncConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "smoke-key" },
    beforeBoot(window) {
      window.supabase = { createClient: () => cloud, processLock: async (_name, _timeout, callback) => callback() };
      window.localStorage.setItem("finanzas-conductuales:cloud-session:v1", JSON.stringify(SESSION));
      extraBoot?.(window);
    }
  });
}

// Signed out: Supabase configured, but no session on this device.
function bootSignedOut(options = {}) {
  return bootApp({
    ...options,
    syncConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "smoke-key" },
    beforeBoot(window) {
      window.supabase = { createClient: () => cloud, processLock: async (_name, _timeout, callback) => callback() };
    }
  });
}

function reset({ failSaves = false } = {}) {
  cloud.session = SESSION;
  cloud.signOutHangs = false;
  cloud.failSaves = failSaves;
  cloud.saves = 0;
  cloud.conflicts = 0;
  cloud.beforeUpdate = null;
  cloud.remote = null;
}

test("a signed-in user sees a quiet 'Guardado en la nube' in the menu and no banner", async () => {
  reset();
  const ui = await bootSignedIn();
  try {
    // The first boot in a process can still be on the loading screen.
    await waitFor(ui, ".sync-status");
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
// Regression: the whole state synced as one piece, so when another device had saved
// first its version replaced this device's unsynced edits. Now both are combined.
test("another device's changes and this device's unsynced ones are combined, and uploaded", async () => {
  reset();
  const lastSync = new Date(Date.now() - 3_600_000).toISOString();
  const base = returningUserState({ updated_at: lastSync });
  const other = { ...base, transactions: [{ id: "otro", merchant: "Desde el otro teléfono", amount: 5_000, date: "2026-01-01" }], updated_at: new Date(Date.now() - 60_000).toISOString() };
  cloud.remote = { app_state: other, updated_at: new Date(Date.now() - 60_000).toISOString() };
  const local = returningUserState({
    transactions: [{ id: "mio", merchant: "Desde este teléfono", amount: 7_000, date: "2026-01-02" }],
    updated_at: new Date().toISOString(),
    meta: { cloudUpdatedAt: lastSync, cloudUserEmail: USER.email }
  });
  const ui = await bootSignedIn({
    savedState: local,
    beforeBoot(window) {
      window.localStorage.setItem("finanzas-conductuales:cloud-base:v1", JSON.stringify({ email: USER.email, state: base }));
    }
  });
  try {
    const ids = ui.saved().transactions.map((t) => t.id).sort();
    assert.deepEqual(ids, ["mio", "otro"], "one side's expense was lost");
    assert.deepEqual(cloud.remote.app_state.transactions.map((t) => t.id).sort(), ["mio", "otro"], "the merge was not uploaded");
    assert.match(ui.text(), /Combinamos tus cambios con los de otro dispositivo/);
  } finally {
    ui.close();
  }
});

// Two devices saving at the same moment: the second write must not overwrite the first.
test("a save that loses the race reads again, merges and retries", async () => {
  reset();
  const synced = new Date(Date.now() - 3_600_000).toISOString();
  const base = returningUserState({ updated_at: synced });
  cloud.remote = { app_state: base, updated_at: synced };
  const ui = await bootSignedIn({
    savedState: base,
    beforeBoot(window) {
      window.localStorage.setItem("finanzas-conductuales:cloud-base:v1", JSON.stringify({ email: USER.email, state: base }));
    }
  });
  try {
    // Just before this device's write lands, another device saves an expense.
    cloud.beforeUpdate = () => {
      const now = new Date().toISOString();
      cloud.remote = {
        app_state: { ...cloud.remote.app_state, transactions: [{ id: "rapido", merchant: "El otro fue más rápido", amount: 1_000, date: "2026-01-03" }], updated_at: now },
        updated_at: now
      };
    };
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    await ui.type(form.elements.namedItem("amount"), "4000");
    form.requestSubmit();
    for (let i = 0; i < 40 && cloud.conflicts === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 40 && cloud.remote.app_state.transactions.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(cloud.conflicts >= 1, "the conditional save never detected the race");
    assert.equal(cloud.remote.app_state.transactions.length, 2, "one of the two expenses was overwritten");
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

async function waitFor(ui, selector) {
  for (let i = 0; i < 40 && !ui.$(selector); i += 1) {
    await settle(ui.window);
  }
  assert.ok(ui.$(selector), `${selector} never appeared`);
}

// Regression: signing out awaited the cloud save and Supabase's sign-out before clearing
// the session here, so on a slow network the user stayed inside the app for seconds and
// was then yanked out ("entra un momento y después sale").
test("signing out drops to the access screen at once, even while the cloud is still answering", async () => {
  reset();
  const ui = await bootSignedIn();
  try {
    cloud.signOutHangs = true;
    await ui.click('[data-view="profile"]');
    await ui.click('[data-action="cloud-sign-out"]');
    assert.ok(ui.$('[data-action="show-auth-form"][data-auth-mode="signin"]'), "the access screen is showing");
    assert.doesNotMatch(ui.text(), /Tu dinero libre/);
  } finally {
    ui.close();
  }
});

test("sign in is its own screen, and a wrong password keeps the email typed", async () => {
  reset();
  cloud.session = null;
  const ui = await bootSignedOut();
  try {
    await waitFor(ui, '[data-action="show-auth-form"][data-auth-mode="signin"]');
    await ui.click('[data-action="show-auth-form"][data-auth-mode="signin"]');
    let form = ui.$("#cloud-signin-form");
    assert.ok(form, "the sign-in form has its own screen");
    assert.equal(ui.$(".auth-landing"), null, "instead of unfolding inside the landing");

    form.elements.namedItem("email").value = "alguien@example.com";
    form.elements.namedItem("password").value = "incorrecta";
    form.requestSubmit();
    await settle(ui.window);

    await waitFor(ui, ".auth-inline-error");
    form = ui.$("#cloud-signin-form");
    assert.equal(form.elements.namedItem("email").value, "alguien@example.com");
    assert.equal(form.elements.namedItem("password").value, "", "the password is never written back into the page");
  } finally {
    ui.close();
  }
});

test("signing up with an email that already has an account says so instead of 'check your email'", async () => {
  reset();
  cloud.session = null;
  const ui = await bootSignedOut();
  try {
    await waitFor(ui, '[data-action="show-auth-form"][data-auth-mode="signup"]');
    await ui.click('[data-action="show-auth-form"][data-auth-mode="signup"]');
    const form = ui.$("#cloud-signup-form");
    form.elements.namedItem("email").value = "ya@example.com";
    form.elements.namedItem("password").value = "secreta123";
    form.requestSubmit();
    await waitFor(ui, ".auth-notice-card");
    assert.match(ui.text(), /Ese correo ya tiene cuenta/);
  } finally {
    ui.close();
  }
});

test("opening a form is not a change: it never uploads to the cloud", async () => {
  reset();
  const ui = await bootSignedIn();
  try {
    await waitFor(ui, '[data-action="open-expense"]');
    await settle(ui.window);
    const before = cloud.saves;
    await ui.click('[data-action="open-expense"]');
    await ui.click('[data-action="close-expense"]');
    // Real edits upload 800 ms after the last change; wait past that.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(cloud.saves, before);
  } finally {
    ui.close();
  }
});

// Regression: on a signed-in cold start the cloud download (applyRemoteState) reset the
// view to Inicio, wiping the #registrar-gasto the widget's "+" had just asked for.
test("the widget's + still lands on Registrar gasto when the cloud brings newer data at launch", async () => {
  reset();
  // Nothing real on this device yet, so the newer cloud copy is downloaded and applied.
  cloud.remote = { app_state: returningUserState(), updated_at: new Date(Date.now() + 60_000).toISOString() };
  const empty = { meta: { cloudUpdatedAt: "" }, updated_at: new Date().toISOString(), profile: { completed: false } };
  const ui = await bootSignedIn({
    savedState: empty,
    beforeBoot(window) {
      window.Capacitor = {
        Plugins: {
          App: {
            addListener: () => Promise.resolve({ remove() {} }),
            getLaunchUrl: () => Promise.resolve({ url: "finanzasconductuales://registrar-gasto" })
          }
        }
      };
    }
  });
  try {
    await waitFor(ui, "#transaction-form");
    for (let i = 0; i < 10; i += 1) await settle(ui.window);
    assert.equal(ui.saved().profile.completed, true, "the cloud copy was applied");
    assert.ok(ui.$("#transaction-form"), "the expense form is still open after the cloud data arrived");
  } finally {
    ui.close();
  }
});
