// Smoke tests for the signed-in, cloud-backed app. Separate file on purpose: node --test
// runs each file in its own process, and sync-client.js reads the cloud config (and caches
// its client) once per process, so these boots need a mocked Supabase from the first one.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState } from "./helpers/boot-app.mjs";

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
    signOut: async () => ({ error: null })
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

function bootSignedIn() {
  return bootApp({
    savedState: returningUserState(),
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
