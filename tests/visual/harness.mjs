// Shared by the visual tools: boots the real app in headless Edge/Chromium with a fixed
// date, a rich seeded state and a stubbed cloud, and walks every screen, sheet and dialog
// in both themes at several widths. Browser: PW_CHROMIUM_PATH, else the installed Edge.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const root = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 4391;
const TODAY = "2026-09-25";
const NOW = new Date(`${TODAY}T15:00:00`);

const browserPath =
  process.env.PW_CHROMIUM_PATH ||
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);

// ------------------------------------------------------------------ seeded data
function richState(theme) {
  const tx = (id, date, merchant, amount, category, extra = {}) => ({
    id, date, merchant, amount, category, labeled: category !== "free", source: "account",
    updated_at: `${date}T12:00:00.000Z`, ...extra
  });
  return {
    activeView: "today",
    settings: { theme, monthlyRaisePct: 8, escalationPct: 50 },
    profile: {
      completed: true, name: "Mi plan", incomeType: "fixed", incomeCadence: "monthly", incomeAmount: 3_000_000,
      periodStart: "2026-09-01", semesterStart: "2026-09-01", committedExpenses: 0, emergencySavings: 400_000, volatility: "medium"
    },
    liquidity: { account: 1_850_000, cash: 120_000, credit: 90_000, initialized: true },
    periodIncomeStatus: { windowStart: "2026-09-01", applied: true, rejected: false, bannerDismissed: true, amount: 0, location: "account" },
    periodIncomeApplied: [{ windowStart: "2026-09-01", windowEnd: "2026-10-01", status: "applied", amount: 0 }],
    budgetJobs: [
      { id: "mercado", name: "Mercado", amount: 600_000, cadence: "monthly" },
      { id: "transporte", name: "Transporte", amount: 40_000, cadence: "weekly" },
      { id: "salidas", name: "Salidas", amount: 150_000, cadence: "period" },
      { id: "ahorro", name: "Ahorro", amount: 200_000, cadence: "period" },
      { id: "remedios", name: "Remedios", amount: 50_000, cadence: "once", windowStart: "2026-09-01" }
    ],
    transactions: [
      tx("t1", "2026-09-24", "Éxito", 182_000, "mercado"),
      tx("t2", "2026-09-23", "Terpel", 60_000, "transporte"),
      tx("t3", "2026-09-22", "Bar La 70", 210_000, "salidas"),
      tx("t4", "2026-09-20", "Gasto", 35_000, "free"),
      tx("t5", "2026-09-18", "Rappi", 48_000, "free", { source: "credit" }),
      tx("t6", "2026-09-12", "D1", 95_000, "mercado", { source: "cash" }),
      tx("t7", "2026-09-05", "Farmacia", 22_000, "remedios"),
      tx("t8", "2026-08-20", "Mercado viejo", 70_000, "mercado")
    ],
    budgetExtras: [
      { id: "e1", source: "Bono", amount: 500_000, date: "2026-09-15", location: "account",
        allocation: { savingsPercent: 20, savingsAmount: 100_000, freeAmount: 400_000, savingsJobId: "ahorro" } }
    ],
    calendarEvents: [
      { id: "c1", title: "Cumpleaños de mamá", date: "2026-10-04", amount: 120_000, category: "free", note: "Regalo" },
      { id: "c2", title: "SOAT", date: "2026-11-02", amount: 450_000, category: "transporte" }
    ],
    cooldowns: [
      { id: "k1", merchant: "Audífonos", amount: 350_000, category: "free", source: "account",
        createdAt: "2026-09-25T10:00:00.000Z", unlockAt: "2026-09-26T10:00:00.000Z" }
    ],
    periodClosures: [
      { id: "2026-08-01:2026-09-01", windowStart: "2026-08-01", windowEnd: "2026-09-01", closedAt: "2026-08-31T20:00:00.000Z",
        income: 3_000_000, reserved: 1_100_000, spent: 2_450_000, freeRemaining: 150_000, freeFinal: 150_000,
        exceededCategories: [{ id: "salidas", name: "Salidas", budget: 150_000, spent: 230_000, over: 80_000 }],
        status: "tight", adjustments: ["Ajusta Salidas: sube el límite a $ 230.000 o baja $ 80.000 de gasto."], transactionCount: 31, incomeCount: 1 },
      { id: "2026-07-01:2026-08-01", windowStart: "2026-07-01", windowEnd: "2026-08-01", closedAt: "2026-07-31T20:00:00.000Z",
        income: 3_000_000, reserved: 1_000_000, spent: 2_100_000, freeRemaining: 400_000, freeFinal: 400_000,
        exceededCategories: [], status: "healthy", adjustments: [], transactionCount: 27, incomeCount: 0 }
    ],
    merchantRules: [{ id: "r1", merchant: "Éxito", key: "exito", category: "mercado", source: "account", count: 4 }],
    meta: { cloudUpdatedAt: `${TODAY}T14:59:00.000Z`, cloudUserEmail: "visual@example.com" },
    updated_at: `${TODAY}T14:59:00.000Z`
  };
}

function incompleteState(theme) {
  return { settings: { theme }, profile: { completed: false }, meta: { localOnly: true } };
}

// ------------------------------------------------------------------ scenarios
// state: "rich" | "incomplete" | "empty"; signedIn: stub cloud session; steps: selectors to click.
export const SCENARIOS = [
  { name: "today", steps: [] },
  { name: "today-scrolled", steps: [], scroll: 900 },
  { name: "plan", steps: ['[data-view="budget"]'] },
  { name: "period-close", steps: ['[data-view="budget"]', '[data-view="periodClose"]'] },
  { name: "progress", steps: ['[data-view="budget"]', '[data-view="progress"]'] },
  { name: "savings", steps: ['[data-view="savings"]'] },
  { name: "calendar", steps: ['[data-view="calendar"]'] },
  { name: "movements", steps: ['[data-view="movements"]'] },
  { name: "movements-prev", steps: ['[data-view="movements"]', '[data-action="movements-prev-period"]'] },
  { name: "movements-day", steps: ['[data-view="movements"]', '[data-action="filter-movements-by-date"][data-date="2026-09-24"]'] },
  { name: "profile", steps: ['[data-view="profile"]'] },
  { name: "menu", steps: ['[data-action="toggle-menu"]'] },
  { name: "expense", steps: ['[data-action="open-expense"]'] },
  { name: "expense-advanced", steps: ['[data-action="open-expense"]', '[data-action="toggle-quick-expense-advanced"]'] },
  { name: "extra", steps: ['[data-view="budget"]', '[data-action="open-extra-sheet"]'] },
  { name: "setaside", steps: ['[data-action="open-setaside-sheet"]'] },
  { name: "add-category-choice", steps: ['[data-view="budget"]', '[data-action="open-add-category-choice"]'] },
  { name: "category", steps: ['[data-view="budget"]', '[data-action="open-add-category-choice"]', '[data-action="open-category-sheet"]'] },
  { name: "remove-job", steps: ['[data-view="budget"]', '[data-action="request-remove-job"]'] },
  { name: "credit-payment", steps: ['[data-view="profile"]', '[data-action="open-credit-payment"]'] },
  { name: "tx-edit", steps: ['[data-view="movements"]', '[data-action="edit-transaction"]'] },
  { name: "extra-edit", steps: ['[data-view="movements"]', '[data-action="edit-extra"]'] },
  { name: "diagnosis", steps: ['[data-view="profile"]', '[data-action="open-diagnosis"]'] },
  { name: "diagnosis-balances", steps: ['[data-view="profile"]', '[data-action="open-diagnosis"][data-section="balances"]'] },
  { name: "quick-classify", steps: ['[data-view="movements"]', '[data-action="start-quick-classify"]'] },
  { name: "prediction", steps: ['[data-action="open-prediction-details"]'] },
  { name: "period-report", steps: ['[data-view="budget"]', '[data-view="periodClose"]', '[data-action="open-period-report"]'] },
  { name: "delete-account", steps: ['[data-view="profile"]', '[data-action="open-delete-account"]'] },
  { name: "lock", steps: [], lock: true },
  { name: "onboarding", state: "incomplete", signedIn: false, steps: [] },
  { name: "auth-landing", state: "empty", signedIn: false, steps: [] },
  { name: "auth-signin", state: "empty", signedIn: false, steps: ['[data-action="show-auth-form"][data-auth-mode="signin"]'] },
  { name: "auth-signup", state: "empty", signedIn: false, steps: ['[data-action="show-auth-form"][data-auth-mode="signup"]'] }
];
export const THEMES = ["light", "dark"];
// One width per band of the stylesheet's @media breakpoints that real devices use.
export const VIEWPORTS = {
  small: { width: 360, height: 780 },
  phone: { width: 390, height: 844 },
  large: { width: 450, height: 900 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 900 }
};

// ------------------------------------------------------------------ cloud stub
const SUPABASE_STUB = `
(() => {
  const signedIn = Boolean(window.__VISUAL_SIGNED_IN);
  const user = { id: "visual-user", email: "visual@example.com" };
  const session = signedIn ? { access_token: "a", refresh_token: "r", expires_at: 4102444800, user } : null;
  let remote = null;
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      setSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: signedIn ? user : null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { session: null }, error: { message: "stub" } })
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: remote, error: null }) }) }),
      upsert: (row) => ({ select: () => ({ single: async () => {
        remote = { app_state: row.app_state, updated_at: row.updated_at };
        return { data: { updated_at: row.updated_at }, error: null };
      } }) })
    })
  };
  window.supabase = { createClient: () => client, processLock: async (_n, _t, cb) => cb() };
})();
`;

// ------------------------------------------------------------------ style snapshot
export const PROPS = [
  "display", "position", "top", "right", "bottom", "left", "z-index", "visibility", "opacity",
  "width", "height", "min-height", "max-width",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "gap", "grid-template-columns", "flex-direction", "flex-wrap", "justify-content", "align-items", "text-align",
  "color", "background-color", "background-image", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
  "box-shadow", "outline-style", "outline-color", "filter", "backdrop-filter", "transform",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "text-decoration-line",
  "white-space", "overflow-x", "overflow-y", "fill", "stroke", "-webkit-text-fill-color", "caret-color", "accent-color"
];

export function snapshot(props) {
  const out = {};
  const pathOf = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const siblings = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
      const nth = siblings.length > 1 ? `:${siblings.indexOf(node) + 1}` : "";
      const cls = node.classList.length ? `.${[...node.classList].sort().join(".")}` : "";
      parts.unshift(`${node.tagName.toLowerCase()}${cls}${nth}`);
    }
    return parts.join(">");
  };
  const read = (style) => {
    const values = {};
    for (const prop of props) {
      let value = style.getPropertyValue(prop);
      if (/^-?\d+(\.\d+)?px$/.test(value)) value = `${Math.round(parseFloat(value))}px`;
      values[prop] = value;
    }
    return values;
  };
  for (const el of document.querySelectorAll("html, body, body *")) {
    if (el.closest("script, style, template")) continue;
    const key = pathOf(el);
    out[key] = read(getComputedStyle(el));
    for (const pseudo of ["::before", "::after"]) {
      const style = getComputedStyle(el, pseudo);
      if (style.content && style.content !== "none" && style.content !== "normal") {
        out[`${key}${pseudo}`] = { content: style.content, ...read(style) };
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ run
async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}


// Calls `visit(page, name)` for every viewport x theme x scenario whose name contains `only`.
// Returns the list of failures (scenario name: error).
export async function forEachScenario({ only = "", viewports = VIEWPORTS } = {}, visit) {
  if (!browserPath) throw new Error("No browser: set PW_CHROMIUM_PATH");
  const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const failures = [];
  try {
    await waitForServer();
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      for (const theme of THEMES) {
        for (const scenario of SCENARIOS) {
          const name = `${viewportName}-${theme}-${scenario.name}`;
          if (only && !name.includes(only)) continue;
          const context = await browser.newContext({
            viewport, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block", locale: "es-CO"
          });
          const page = await context.newPage();
          try {
            await page.clock.setFixedTime(NOW);
            const stateKind = scenario.state || "rich";
            const saved = stateKind === "rich" ? richState(theme) : stateKind === "incomplete" ? incompleteState(theme) : null;
            const signedIn = scenario.signedIn ?? true;
            await page.addInitScript(({ saved, signedIn, lock }) => {
              if (sessionStorage.getItem("__seeded")) return;
              sessionStorage.setItem("__seeded", "1");
              localStorage.clear();
              window.__VISUAL_SIGNED_IN = signedIn;
              if (saved) localStorage.setItem("finanzas-conductuales:v1", JSON.stringify(saved));
              if (signedIn) {
                localStorage.setItem("finanzas-conductuales:cloud-session:v1", JSON.stringify({
                  access_token: "a", refresh_token: "r", expires_at: 4102444800, user: { id: "visual-user", email: "visual@example.com" }
                }));
              }
              if (lock) {
                localStorage.setItem("finanzas-conductuales-lock:v1", JSON.stringify({ enabled: true, hash: "x", salt: "y", biometric: false, failedAttempts: 0, lockUntil: 0 }));
              }
            }, { saved, signedIn, lock: Boolean(scenario.lock) });
            await page.addInitScript((flag) => { window.__VISUAL_SIGNED_IN = flag; }, signedIn);
            await page.route("**/sync-config.js*", (route) =>
              route.fulfill({ contentType: "text/javascript", body: 'window.FINANZAS_SYNC_CONFIG = { supabaseUrl: "https://stub.supabase.co", supabaseAnonKey: "stub" };' })
            );
            await page.route("**/vendor/supabase-*.js*", (route) => route.fulfill({ contentType: "text/javascript", body: SUPABASE_STUB }));
            await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
            await page.goto(`http://localhost:${PORT}/`);
            await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 10000 });
            await page.waitForTimeout(700);
            for (const selector of scenario.steps) {
              const clicked = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                el.click();
                return true;
              }, selector);
              if (!clicked) throw new Error(`nothing matches ${selector}`);
              await page.waitForTimeout(250);
            }
            await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
            if (scenario.scroll) await page.evaluate((y) => window.scrollTo(0, y), scenario.scroll);
            await page.waitForTimeout(250);
            await visit(page, name, scenario);
            process.stdout.write(".");
          } catch (error) {
            failures.push(`${name}: ${error.message}`);
            process.stdout.write("x");
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  return failures;
}
