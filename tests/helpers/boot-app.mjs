// Shared jsdom harness: boots the real app.js in a simulated browser so tests can drive
// it through real clicks and form submits instead of searching its source for strings.
import { IDBFactory } from "fake-indexeddb";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const STORAGE_KEY = "finanzas-conductuales:v1";
let bootCount = 0;

// app.js calls bare setTimeout, which is Node's, so window.close() does not cancel it: a
// previous test's app instance keeps its timers and, when they fire (e.g. the 8s snackbar
// dismiss), they act on whatever `document` is global by then, the NEXT test's DOM. Track
// every timer created while a test's app is alive and cancel them all when it closes.
// (Can't just alias window.setTimeout: jsdom's own implementation calls the global one.)
const nodeSetTimeout = globalThis.setTimeout;
const nodeClearTimeout = globalThis.clearTimeout;
let liveTimers = new Set();

function trackedSetTimeout(callback, delay, ...args) {
  const timers = liveTimers;
  const handle = nodeSetTimeout(() => {
    timers.delete(handle);
    if (typeof callback === "function") {
      callback(...args);
    }
  }, delay);
  timers.add(handle);
  return handle;
}

function trackedClearTimeout(handle) {
  liveTimers.delete(handle);
  nodeClearTimeout(handle);
}

export function todayKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

// A returning user: onboarding done, variable income (so no automatic payday deposit
// muddies the numbers), a real balance on file, no cloud configured.
export function returningUserState(overrides = {}) {
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

// `indexedDB`: an IndexedDB factory (fake-indexeddb) to share between boots, so data the
// app stored there survives a "relaunch". Each boot gets a fresh, empty one by default.
export async function bootApp({ savedState, lockConfig, syncConfig = {}, beforeBoot, indexedDB = new IDBFactory() } = {}) {
  const timers = new Set();
  liveTimers = timers;
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="live-status" role="status" aria-live="polite"></div><div id="live-alert" role="alert"></div><div id="app"></div></body></html>',
    {
      url: "https://localhost/",
      pretendToBeVisual: true
    }
  );
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.indexedDB = indexedDB;
  // Default: no Supabase config, so the app runs local-only, the way it must keep working
  // offline. Note sync-client.js reads this once per process when first imported, so a
  // test file that needs a (mocked) cloud must set it on its FIRST boot; see
  // app-sync-smoke.test.mjs, which runs in its own process for that reason.
  window.FINANZAS_SYNC_CONFIG = syncConfig;
  if (savedState) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
  }
  if (lockConfig) {
    window.localStorage.setItem("finanzas-conductuales-lock:v1", JSON.stringify(lockConfig));
  }
  beforeBoot?.(window);

  const globals = {
    window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    navigator: window.navigator,
    location: window.location,
    FormData: window.FormData,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  bootCount += 1;
  await import(`../../app.js?smoke=${bootCount}`);
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
    close: () => {
      for (const handle of timers) {
        nodeClearTimeout(handle);
      }
      timers.clear();
      window.close();
    }
  };
}

// Let the async boot (initializeCloudSync, microtasks, rAF polling) finish.
export async function settle(window) {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  }
}
