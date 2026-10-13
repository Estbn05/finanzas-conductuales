// The Android-only paths (hardware back, home screen widget, fingerprint, sharing a
// file) run through Capacitor plugins that app.js looks up on window.Capacitor.Plugins
// at call time. These tests boot the real app with fake plugins standing in for them,
// replacing tests that only checked the plugin names appeared in app.js.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { bootApp, returningUserState, settle, todayKey } from "./helpers/boot-app.mjs";

// What the native side would receive, recorded instead of acted on.
function fakeCapacitor({ launchUrl = "", biometricResult = "success" } = {}) {
  const calls = { exited: 0, widget: [], files: [], shares: [], biometricPrompts: 0 };
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
