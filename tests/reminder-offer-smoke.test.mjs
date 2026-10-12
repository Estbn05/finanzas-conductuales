// The daily reminder (whose notification opens "Registrar gasto") lived in Datos and was
// off by default, so new users never found it. The first-run tour now ends by offering
// it. These drive the real tour in jsdom.
import assert from "node:assert/strict";
import test from "node:test";
import { bootApp, returningUserState, settle } from "./helpers/boot-app.mjs";

// jsdom does no layout (every tour target looks invisible) and has no Notification API
// (the offer is skipped where notifications are unsupported); provide both.
function withLayoutAndNotifications(window, { permission = "default", answer = "granted" } = {}) {
  window.Element.prototype.getClientRects = function getClientRects() {
    return [{ top: 0, left: 0, width: 100, height: 40 }];
  };
  window.Element.prototype.scrollIntoView = () => {};
  const fake = {
    permission,
    requested: 0,
    async requestPermission() {
      fake.requested += 1;
      fake.permission = answer;
      return answer;
    }
  };
  window.Notification = fake;
  // app.js reads the bare global, and bootApp only mirrors a few window globals.
  globalThis.Notification = fake;
  return fake;
}

async function nextFrame(ui) {
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle(ui.window);
}

async function openTour(ui) {
  for (let i = 0; i < 40 && !ui.$('[data-view="profile"]'); i += 1) {
    await settle(ui.window);
  }
  await ui.click('[data-view="profile"]');
  await ui.click('[data-action="start-tour"]');
  await nextFrame(ui);
  const layer = ui.$("#app-tour");
  assert.ok(layer, "the tour did not open");
  return layer;
}

function walkToEnd(layer) {
  const total = Number(layer.querySelector("[data-tour-count]").textContent.split(" de ")[1]);
  for (let i = 0; i < total; i += 1) layer.querySelector("[data-tour-next]").click();
}

test("the first tour ends by offering the daily reminder, and accepting turns it on", async () => {
  let notifications;
  const ui = await bootApp({
    savedState: returningUserState(),
    beforeBoot: (window) => {
      notifications = withLayoutAndNotifications(window);
    }
  });
  try {
    const layer = await openTour(ui);
    const total = Number(layer.querySelector("[data-tour-count]").textContent.split(" de ")[1]);
    for (let i = 1; i < total; i += 1) layer.querySelector("[data-tour-next]").click();
    assert.equal(layer.querySelector("[data-tour-next]").textContent, "Siguiente", "the last step leads to the offer");
    layer.querySelector("[data-tour-next]").click();

    assert.ok(ui.$("[data-tour-reminder-enable]"), "the reminder offer did not show");
    assert.match(ui.$(".tour-card").textContent, /¿Te recordamos registrar tus gastos\?/);
    const time = ui.$("[data-tour-reminder-time]");
    assert.equal(time.value, "20:00");
    time.value = "21:30";

    ui.$("[data-tour-reminder-enable]").click();
    await settle(ui.window);

    assert.equal(ui.$("#app-tour"), null, "the tour should close after accepting");
    assert.equal(notifications.requested, 1, "permission is asked for at that moment");
    const saved = ui.saved();
    assert.equal(saved.dailyReminder.enabled, true);
    assert.equal(saved.dailyReminder.time, "21:30");
    assert.equal(saved.settings.tourDone, true);
  } finally {
    ui.close();
  }
});

test("'Ahora no' leaves the reminder off and the offer is not repeated", async () => {
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: (window) => withLayoutAndNotifications(window) });
  let saved;
  try {
    const layer = await openTour(ui);
    walkToEnd(layer);
    ui.$("[data-tour-reminder-skip]").click();
    await settle(ui.window);
    assert.equal(ui.$("#app-tour"), null);
    saved = ui.saved();
    assert.equal(saved.dailyReminder.enabled, false);
    assert.equal(saved.settings.tourDone, true);
  } finally {
    ui.close();
  }

  const again = await bootApp({ savedState: saved, beforeBoot: (window) => withLayoutAndNotifications(window) });
  try {
    const layer = await openTour(again);
    walkToEnd(layer);
    assert.equal(again.$("[data-tour-reminder-enable]"), null, "the offer only comes with the first tour");
    assert.equal(again.$("#app-tour"), null);
  } finally {
    again.close();
  }
});

test("skipping the tour early still offers the reminder once", async () => {
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: (window) => withLayoutAndNotifications(window) });
  try {
    await openTour(ui);
    ui.$("[data-tour-skip]").click();
    assert.ok(ui.$("[data-tour-reminder-enable]"), "skipping the guide should still offer the reminder");
  } finally {
    ui.close();
  }
});

test("no offer when the reminder is already on (unsupported notifications are covered by the tour tests in app-smoke)", async () => {
  const on = await bootApp({
    savedState: returningUserState({ dailyReminder: { enabled: true, time: "19:00" } }),
    beforeBoot: (window) => withLayoutAndNotifications(window, { permission: "granted" })
  });
  try {
    const layer = await openTour(on);
    const total = Number(layer.querySelector("[data-tour-count]").textContent.split(" de ")[1]);
    for (let i = 1; i < total; i += 1) layer.querySelector("[data-tour-next]").click();
    assert.equal(layer.querySelector("[data-tour-next]").textContent, "Empezar a usarla");
    layer.querySelector("[data-tour-next]").click();
    assert.equal(on.$("#app-tour"), null);
  } finally {
    on.close();
  }
});
