// The Android-only paths (hardware back, home screen widget, fingerprint, sharing a
// file) run through Capacitor plugins that app.js looks up on window.Capacitor.Plugins
// at call time. These tests boot the real app with fake plugins standing in for them,
// replacing tests that only checked the plugin names appeared in app.js.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { bootApp, returningUserState, settle, todayKey } from "./helpers/boot-app.mjs";

// What the native side would receive, recorded instead of acted on.
function fakeCapacitor({ launchUrl = "", biometricResult = "success", bank = { enabled: false, permission: false, pending: [] } } = {}) {
  const calls = { exited: 0, widget: [], files: [], shares: [], biometricPrompts: 0, bankSettingsOpened: 0, bankDismissed: [], bankEnabled: [] };
  const listeners = {};
  const plugins = {
    App: {
      addListener(event, callback) {
        (listeners[event] ||= []).push(callback);
        return Promise.resolve({ remove() {} });
      },
      exitApp() {
        calls.exited += 1;
      },
      getLaunchUrl: () => Promise.resolve(launchUrl ? { url: launchUrl } : undefined)
    },
    WidgetBridge: {
      update(payload) {
        calls.widget.push(payload);
        return Promise.resolve();
      }
    },
    BiometricAuth: {
      isAvailable: () => Promise.resolve({ available: true }),
      authenticate() {
        calls.biometricPrompts += 1;
        return biometricResult === "success" ? Promise.resolve() : Promise.reject(new Error("cancelled"));
      }
    },
    // Stands in for BankNotificationsPlugin.java (the Android listener's store).
    BankNotifications: {
      status: () => Promise.resolve({ enabled: bank.enabled, permission: bank.permission }),
      setEnabled({ enabled }) {
        bank.enabled = enabled;
        calls.bankEnabled.push(enabled);
        return Promise.resolve();
      },
      openSettings() {
        calls.bankSettingsOpened += 1;
        return Promise.resolve();
      },
      getPending: () => Promise.resolve({ notifications: bank.pending }),
      dismiss({ ids }) {
        calls.bankDismissed.push(...ids);
        bank.pending = bank.pending.filter((item) => !ids.includes(item.id));
        return Promise.resolve();
      }
    },
    Filesystem: {
      writeFile(file) {
        calls.files.push(file);
        return Promise.resolve({ uri: `file:///cache/${file.path}` });
      }
    },
    Share: {
      share(options) {
        calls.shares.push(options);
        return Promise.resolve();
      }
    }
  };
  return {
    calls,
    install: (window) => {
      window.Capacitor = { Plugins: plugins };
    },
    fire: async (event, payload, window) => {
      (listeners[event] || []).forEach((callback) => callback(payload));
      await settle(window);
    }
  };
}

// The first app booted in a process stays on the loading screen a little longer.
async function waitFor(ui, selector) {
  for (let i = 0; i < 40 && !ui.$(selector); i += 1) {
    await settle(ui.window);
  }
  assert.ok(ui.$(selector), `${selector} never appeared`);
}

async function sha256Hex(text) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function lockConfigFor(pin, extra = {}) {
  const salt = "native-salt";
  return { enabled: true, hash: await sha256Hex(`${salt}:${pin}`), salt, biometric: false, failedAttempts: 0, lockUntil: 0, ...extra };
}

test("the Android back button closes the open form first, and only leaves the app from a plain screen", async () => {
  const native = fakeCapacitor();
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: native.install });
  try {
    await waitFor(ui, '[data-action="open-expense"]');
    await ui.click('[data-action="open-expense"]');
    assert.ok(ui.$("#transaction-form"), "the expense form opened");

    await native.fire("backButton", undefined, ui.window);
    assert.equal(ui.$("#transaction-form"), null, "back closed the form");
    assert.equal(native.calls.exited, 0, "and did not leave the app");

    await native.fire("backButton", undefined, ui.window);
    assert.equal(native.calls.exited, 1, "with nothing open, back leaves the app");
  } finally {
    ui.close();
  }
});

test("the home screen widget gets the same free money as Inicio, and hides it while the PIN lock is on", async () => {
  const native = fakeCapacitor();
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: native.install });
  try {
    await ui.click('[data-action="open-expense"]');
    const form = ui.$("#transaction-form");
    await ui.type(form.elements.namedItem("amount"), "100000");
    form.requestSubmit();
    await settle(ui.window);
    const last = native.calls.widget.at(-1);
    assert.ok(last, "saving updated the widget");
    assert.match(last.freeMoney.replace(/\s/g, ""), /\$1\.900\.000/);
    assert.ok(last.periodLabel);
  } finally {
    ui.close();
  }

  const lockedNative = fakeCapacitor();
  const locked = await bootApp({
    savedState: returningUserState(),
    lockConfig: await lockConfigFor("1234"),
    beforeBoot: lockedNative.install
  });
  try {
    // Unlocking and saving something still sends "Bloqueado": widgets render outside the
    // lock screen, so the amount would be readable on the home screen of a locked phone.
    for (const digit of "1234") {
      await locked.click(`[data-lock-digit="${digit}"]`);
    }
    await locked.click('[data-action="open-expense"]');
    const form = locked.$("#transaction-form");
    await locked.type(form.elements.namedItem("amount"), "5000");
    form.requestSubmit();
    await settle(locked.window);
    assert.ok(lockedNative.calls.widget.length > 0);
    for (const payload of lockedNative.calls.widget) {
      assert.equal(payload.freeMoney, "Bloqueado");
    }
  } finally {
    locked.close();
  }
});

test("the widget's + button opens the app straight into Registrar gasto", async () => {
  const native = fakeCapacitor({ launchUrl: "finanzasconductuales://registrar-gasto" });
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: native.install });
  try {
    for (let i = 0; i < 20 && !ui.$("#transaction-form"); i += 1) {
      await settle(ui.window);
    }
    assert.ok(ui.$("#transaction-form"), "a cold start from the widget lands on the expense form");
  } finally {
    ui.close();
  }
});

test("with the fingerprint on, the lock screen asks for it first and a match opens the app", async () => {
  const native = fakeCapacitor();
  const ui = await bootApp({
    savedState: returningUserState(),
    lockConfig: await lockConfigFor("1234", { biometric: true }),
    beforeBoot: native.install
  });
  try {
    await settle(ui.window);
    assert.equal(native.calls.biometricPrompts, 1);
    assert.match(ui.text(), /Tu dinero libre/);
  } finally {
    ui.close();
  }
});

test("a cancelled fingerprint leaves the PIN keypad as the way in", async () => {
  const native = fakeCapacitor({ biometricResult: "cancel" });
  const ui = await bootApp({
    savedState: returningUserState(),
    lockConfig: await lockConfigFor("1234", { biometric: true }),
    beforeBoot: native.install
  });
  try {
    await settle(ui.window);
    assert.match(ui.text(), /Ingresa tu PIN/);
    assert.ok(ui.$("[data-lock-biometric]"), "and 'Usar huella' stays there to try again");
  } finally {
    ui.close();
  }
});

test("five wrong PINs in a row pause the keypad", async () => {
  const ui = await bootApp({ savedState: returningUserState(), lockConfig: await lockConfigFor("1234") });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      for (const digit of "9999") {
        await ui.click(`[data-lock-digit="${digit}"]`);
      }
    }
    assert.match(ui.text(), /Demasiados intentos/);
    assert.equal(ui.$('[data-lock-digit="1"]').disabled, true, "the right PIN cannot be tried during the pause");
  } finally {
    ui.close();
  }
});

test("a resumed app locks again when the PIN lock is on", async () => {
  const native = fakeCapacitor();
  const ui = await bootApp({ savedState: returningUserState(), lockConfig: await lockConfigFor("1234"), beforeBoot: native.install });
  try {
    for (const digit of "1234") {
      await ui.click(`[data-lock-digit="${digit}"]`);
    }
    assert.match(ui.text(), /Tu dinero libre/);
    await native.fire("appStateChange", { isActive: false }, ui.window);
    await native.fire("appStateChange", { isActive: true }, ui.window);
    assert.match(ui.text(), /Ingresa tu PIN/);
  } finally {
    ui.close();
  }
});

test("Exportar CSV hands the file to Android's share sheet", async () => {
  const native = fakeCapacitor();
  const savedState = returningUserState({
    transactions: [{ id: "t1", date: todayKey(), amount: 25_000, merchant: "Terpel", category: "", labeled: false, source: "cash" }]
  });
  const ui = await bootApp({ savedState, beforeBoot: native.install });
  try {
    await ui.click('[data-view="movements"]');
    await ui.click('[data-action="export-movements-csv"]');
    await settle(ui.window);
    const [file] = native.calls.files;
    assert.equal(file.path, `movimientos-${todayKey()}.csv`);
    assert.match(file.data, /Terpel/);
    assert.match(file.data, /-25000/);
    assert.equal(native.calls.shares[0].url, `file:///cache/${file.path}`);
  } finally {
    ui.close();
  }
});

function nuNotification(text, daysAgo = 0) {
  const postedAt = Date.now() - daysAgo * 86_400_000;
  return { id: `com.nu.production:${postedAt}:a`, packageName: "com.nu.production", title: "Compra aprobada", text, postedAt };
}

function dateDaysAgo(days) {
  const date = new Date(Date.now() - days * 86_400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

test("Gastos desde Nu: Datos explains what is read before Android's permission screen", async () => {
  const native = fakeCapacitor();
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: native.install });
  try {
    await waitFor(ui, '[data-view="profile"]');
    await ui.click('[data-view="profile"]');
    await ui.click('[data-action="open-bank-disclosure"]');
    assert.equal(native.calls.bankSettingsOpened, 0, "nothing is asked of Android before the explanation");
    assert.match(ui.text(), /Leemos solo las notificaciones de la app de Nu/);
    assert.match(ui.text(), /no se sube a la nube/);

    await ui.click('[data-action="enable-bank-notifications"]');
    assert.deepEqual(native.calls.bankEnabled, [true]);
    assert.equal(native.calls.bankSettingsOpened, 1, "then Android's notification-access screen opens");
    assert.match(ui.text(), /Falta un paso/);

    await ui.click('[data-action="disable-bank-notifications"]');
    assert.deepEqual(native.calls.bankEnabled, [true, false]);
    assert.ok(ui.$('[data-action="open-bank-disclosure"]'));
  } finally {
    ui.close();
  }
});

test("a Nu purchase shows on Inicio and one confirmation records it with the bank's date and card", async () => {
  const purchase = nuNotification("Compraste $450.000 con tu tarjeta de crédito en TERPEL CALLE 80.", 1);
  const native = fakeCapacitor({ bank: { enabled: true, permission: true, pending: [purchase] } });
  const savedState = returningUserState({
    budgetJobs: [{ id: "transporte", name: "Transporte", amount: 900_000, cadence: "monthly" }],
    // Earlier Terpel purchases were paid in cash: that habit fills the category, but the
    // bank says this one went on the card, so the card wins.
    transactions: [
      { id: "t1", date: dateDaysAgo(5), amount: 40_000, merchant: "Terpel Calle 80", category: "transporte", labeled: true, source: "cash" },
      { id: "t2", date: dateDaysAgo(3), amount: 40_000, merchant: "Terpel Calle 80", category: "transporte", labeled: true, source: "cash" }
    ],
    liquidity: { account: 1_500_000, cash: 200_000, initialized: true }
  });
  const ui = await bootApp({ savedState, beforeBoot: native.install });
  try {
    await waitFor(ui, '[data-action="register-bank-suggestion"]');
    assert.match(ui.text(), /¿Registrar este gasto\?/);
    assert.match(ui.text(), /Terpel Calle 80/);
    assert.match(ui.text(), /ayer/);

    await ui.click('[data-action="register-bank-suggestion"]');
    const form = ui.$("#transaction-form");
    assert.equal(form.elements.namedItem("amount").value.replace(/\D/g, ""), "450000");
    assert.equal(form.elements.namedItem("merchant").value, "Terpel Calle 80");
    assert.equal(form.elements.namedItem("source").value, "credit");
    assert.equal(form.elements.namedItem("category").value, "transporte");
    form.requestSubmit();
    await settle(ui.window);

    const recorded = ui.saved().transactions.find((item) => item.amount === 450_000);
    assert.ok(recorded, "a large purchase the bank reported is recorded, not paused for 24 hours");
    assert.equal(recorded.date, dateDaysAgo(1));
    assert.equal(recorded.source, "credit");
    assert.equal(ui.saved().cooldowns?.length ?? 0, 0);
    assert.deepEqual(native.calls.bankDismissed, [purchase.id]);
    assert.equal(ui.$('[data-action="register-bank-suggestion"]'), null);
  } finally {
    ui.close();
  }
});

test("'No es un gasto' drops the suggestion without recording anything", async () => {
  const purchase = nuNotification("Compraste $12.000 en Rappi");
  const native = fakeCapacitor({ bank: { enabled: true, permission: true, pending: [purchase] } });
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: native.install });
  try {
    await waitFor(ui, '[data-action="dismiss-bank-suggestion"]');
    await ui.click('[data-action="dismiss-bank-suggestion"]');
    assert.equal(ui.$('[data-action="dismiss-bank-suggestion"]'), null);
    assert.deepEqual(native.calls.bankDismissed, [purchase.id]);
    assert.equal(ui.saved()?.transactions?.length ?? 0, 0);
  } finally {
    ui.close();
  }
});

test("nothing from the bank shows while the feature is off, even with notifications kept", async () => {
  const native = fakeCapacitor({ bank: { enabled: false, permission: true, pending: [nuNotification("Compraste $12.000 en Rappi")] } });
  const ui = await bootApp({ savedState: returningUserState(), beforeBoot: native.install });
  try {
    await waitFor(ui, '[data-view="profile"]');
    await settle(ui.window);
    assert.equal(ui.$('[data-action="register-bank-suggestion"]'), null);
  } finally {
    ui.close();
  }
});
