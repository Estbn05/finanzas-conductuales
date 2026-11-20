// "Enviar comentario" and the anonymous usage statistics (metrics.js). Own file on purpose:
// sync-client.js caches the first Supabase client per process, and this one records what
// the app inserts.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState, settle } from "./helpers/boot-app.mjs";

const inserted = [];
let failInserts = false;
const cloud = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    setSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null })
  },
  from(table) {
    return {
      insert: async (rows) => {
        if (failInserts) return { error: new Error("offline") };
        inserted.push({ table, rows });
        return { error: null };
      }
    };
  }
};

function boot(savedState = returningUserState({ meta: { localOnly: true } })) {
  inserted.length = 0;
  failInserts = false;
  return bootApp({
    savedState,
    syncConfig: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "smoke-key" },
    beforeBoot(window) {
      window.supabase = { createClient: () => cloud, processLock: async (_name, _timeout, callback) => callback() };
    }
  });
}

async function waitFor(ui, selector) {
  for (let i = 0; i < 40 && !ui.$(selector); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(ui.window);
  }
  assert.ok(ui.$(selector), `nothing matches ${selector}`);
}

function queued(ui) {
  return JSON.parse(ui.window.localStorage.getItem("fc-metrics-queue") || "[]");
}

test("Enviar comentario sends the text and an optional contact, and says thanks", async () => {
  const ui = await boot();
  try {
    await waitFor(ui, '[data-action="open-feedback"]');
    await ui.click('[data-action="open-feedback"]');
    const form = ui.$("#feedback-form");
    form.elements.namedItem("message").value = "No entendí qué es Reservado";
    form.elements.namedItem("contact").value = "yo@example.com";
    form.requestSubmit();
    await settle(ui.window);
    const sent = inserted.find((item) => item.table === "app_feedback");
    assert.ok(sent, "the comment reached the app_feedback table");
    assert.equal(sent.rows[0].message, "No entendí qué es Reservado");
    assert.equal(sent.rows[0].contact, "yo@example.com");
    assert.match(sent.rows[0].install_id, /^[0-9a-f-]{36}$/);
    assert.equal(ui.$("#feedback-form"), null);
    assert.match(ui.text(), /Gracias/);
  } finally {
    ui.close();
  }
});

test("a comment that could not be sent stays written, with the reason", async () => {
  const ui = await boot();
  try {
    await waitFor(ui, '[data-action="open-feedback"]');
    failInserts = true;
    await ui.click('[data-action="open-feedback"]');
    const form = ui.$("#feedback-form");
    form.elements.namedItem("message").value = "Me encanta el widget";
    form.requestSubmit();
    await settle(ui.window);
    assert.ok(ui.$("#feedback-form"), "the sheet stays open");
    assert.equal(ui.$("#feedback-form").elements.namedItem("message").value, "Me encanta el widget");
    assert.match(ui.text(), /No se pudo enviar/);
  } finally {
    ui.close();
  }
});

test("usage events are names and flags only, and the switch in Datos stops them", async () => {
  const ui = await boot();
  try {
    await waitFor(ui, '[data-view="profile"]');
    await ui.click('[data-view="profile"]');
    const events = queued(ui);
    assert.ok(events.some((event) => event.name === "app_open"));
    const view = events.find((event) => event.name === "view");
    assert.deepEqual(view.props, { name: "profile" });
    assert.ok(events.every((event) => Object.keys(event).sort().join() === "app_version,happened_at,install_id,name,platform,props"));

    await waitFor(ui, '[data-action="set-metrics"][data-metrics-choice="off"]');
    await ui.click('[data-action="set-metrics"][data-metrics-choice="off"]');
    assert.equal(queued(ui).length, 0, "what was waiting is dropped");
    assert.equal(ui.$('[data-action="set-metrics"][data-metrics-choice="off"]').getAttribute("aria-pressed"), "true");
    await ui.click('[data-view="today"]');
    assert.equal(queued(ui).length, 0, "nothing new is recorded");
  } finally {
    ui.close();
  }
});
