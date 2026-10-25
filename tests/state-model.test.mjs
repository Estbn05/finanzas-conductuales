import assert from "node:assert/strict";
import test from "node:test";
import {
  decideLoginSync,
  decidePushSync,
  hasMeaningfulLocalData,
  hasUnsyncedLocalEdits,
  isPlaceholderMerchant,
  merchantKey,
  csvField,
  merchantRuleMatches,
  normalizeIncomeLocation,
  normalizeLiquidity,
  normalizeLocation,
  normalizeTransactions,
  compactForStorage,
  describeSyncStatus,
  frequentExpenses,
  lastExpenseSource,
  relativeTimeEs,
  remoteChangedSinceLastSync,
  uid,
  createDefaultState,
  migrateState,
  upcomingReminderDates
} from "../state-model.js";

const EMPTY = { profile: { completed: false }, transactions: [], budgetJobs: [] };
const withData = (cloudUpdatedAt) => ({
  profile: { completed: true },
  transactions: [{ id: "t1", amount: 5_000 }],
  meta: { cloudUpdatedAt }
});
const remoteRow = (app_state, updated_at) => ({ app_state, updated_at });

const LAST_SYNC = "2026-09-20T10:00:00.000Z";
const BEFORE_LAST_SYNC = "2026-09-20T09:00:00.000Z";
const AFTER_LAST_SYNC = "2026-09-20T11:00:00.000Z";

test("an empty default state is not meaningful data; a completed profile is", () => {
  assert.equal(hasMeaningfulLocalData(EMPTY), false);
  assert.equal(hasMeaningfulLocalData(null), false);
  assert.equal(hasMeaningfulLocalData(withData(LAST_SYNC)), true);
});

// Regression: this used to compare the phone's clock against the server's. The server
// usually runs a few seconds ahead, so a just-made local edit looked "older" than the
// cloud and a token-refresh pull wiped it. Both sides must be server timestamps.
test("remote counts as changed only when the server moved past our last synced server time", () => {
  const local = withData(LAST_SYNC);
  assert.equal(remoteChangedSinceLastSync(local, remoteRow({}, AFTER_LAST_SYNC)), true);
  assert.equal(remoteChangedSinceLastSync(local, remoteRow({}, LAST_SYNC)), false);
  assert.equal(remoteChangedSinceLastSync(local, remoteRow({}, BEFORE_LAST_SYNC)), false);
});

test("never-synced local state treats any stamped remote as changed", () => {
  assert.equal(remoteChangedSinceLastSync({ meta: {} }, remoteRow({}, BEFORE_LAST_SYNC)), true);
});

test("login with no cloud row creates it from local", () => {
  assert.equal(decideLoginSync(withData(LAST_SYNC), null), "first-upload");
  assert.equal(decideLoginSync(EMPTY, { app_state: null }), "first-upload");
});

test("login keeps local data when the cloud row is empty, even if the cloud is newer", () => {
  assert.equal(decideLoginSync(withData(LAST_SYNC), remoteRow(EMPTY, AFTER_LAST_SYNC)), "upload-remote-empty");
});

test("login downloads when another device changed the cloud since our last sync", () => {
  assert.equal(decideLoginSync(withData(LAST_SYNC), remoteRow(withData(AFTER_LAST_SYNC), AFTER_LAST_SYNC)), "download");
});

test("login uploads local edits when the cloud has not changed since our last sync", () => {
  assert.equal(decideLoginSync(withData(LAST_SYNC), remoteRow(withData(LAST_SYNC), LAST_SYNC)), "upload");
});

test("login adopts the cloud when this device has nothing yet (fresh install)", () => {
  assert.equal(decideLoginSync({ ...EMPTY, meta: { cloudUpdatedAt: AFTER_LAST_SYNC } }, remoteRow(withData(LAST_SYNC), LAST_SYNC)), "download");
});

test("login with nothing on either side is simply in sync", () => {
  assert.equal(decideLoginSync(EMPTY, remoteRow(EMPTY, LAST_SYNC)), "in-sync");
});

test("push uploads the local edit unless the cloud really changed since our last sync", () => {
  const local = withData(LAST_SYNC);
  assert.equal(decidePushSync(local, null), "upload");
  assert.equal(decidePushSync(local, remoteRow(withData(LAST_SYNC), LAST_SYNC)), "upload");
  assert.equal(decidePushSync(local, remoteRow(EMPTY, AFTER_LAST_SYNC)), "upload");
  assert.equal(decidePushSync(local, remoteRow(withData(AFTER_LAST_SYNC), AFTER_LAST_SYNC)), "download");
});

const matches = (typed, ruleName) => merchantRuleMatches(merchantKey(typed), merchantKey(ruleName));

// Regression: raw substring matching made a "Pan" rule claim unrelated merchants.
test("a merchant rule never matches just because its letters appear inside another word", () => {
  assert.equal(matches("Pantalones", "Pan"), false);
  assert.equal(matches("Compañía", "Pan"), false);
  assert.equal(matches("Japan Sushi", "Pan"), false);
});

test("a merchant rule matches the same merchant written differently or with extra words", () => {
  assert.equal(matches("Panadería", "panaderia"), true);
  assert.equal(matches("Éxito Calle 80", "Éxito"), true);
  assert.equal(matches("Éxito", "Éxito Calle 80"), true);
  assert.equal(matches("Pan", "Pan"), true);
});

test("very short or empty names only match exactly", () => {
  assert.equal(matches("D1", "D1"), true);
  assert.equal(matches("D1 Centro", "D1"), false);
  assert.equal(merchantRuleMatches("", "pan"), false);
});

// Regression: a merchant or note typed as "=HYPERLINK(...)" was exported verbatim and
// ran as a formula when the CSV was opened in Excel or Sheets.
test("CSV export neutralizes text that a spreadsheet would run as a formula", () => {
  assert.equal(csvField("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvField("+57 300"), "'+57 300");
  assert.equal(csvField("-descuento"), "'-descuento");
  assert.equal(csvField("@usuario"), "'@usuario");
});

test("CSV export keeps amounts numeric and quotes only when needed", () => {
  assert.equal(csvField(-50_000), "-50000");
  assert.equal(csvField(120_000), "120000");
  assert.equal(csvField("Panadería"), "Panadería");
  assert.equal(csvField("Pan, leche"), '"Pan, leche"');
  assert.equal(csvField(""), "");
  assert.equal(csvField(null), "");
});

test("generated ids keep their prefix and do not collide", () => {
  const ids = new Set(Array.from({ length: 5_000 }, () => uid("tx")));
  assert.equal(ids.size, 5_000);
  for (const id of ids) {
    assert.ok(id.startsWith("tx-"));
  }
});

const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const online = { configured: true, signedIn: true, online: true };

test("relative time reads naturally in Spanish", () => {
  assert.equal(relativeTimeEs("2026-09-25T11:59:40.000Z", NOW), "hace un momento");
  assert.equal(relativeTimeEs("2026-09-25T11:55:00.000Z", NOW), "hace 5 min");
  assert.equal(relativeTimeEs("2026-09-25T09:00:00.000Z", NOW), "hace 3 h");
  assert.equal(relativeTimeEs("2026-09-24T11:00:00.000Z", NOW), "hace 1 día");
  assert.equal(relativeTimeEs("2026-09-20T12:00:00.000Z", NOW), "hace 5 días");
  assert.equal(relativeTimeEs("", NOW), "");
});

test("there is nothing to say about sync without a cloud account", () => {
  assert.equal(describeSyncStatus({ ...online, configured: false, status: "local" }, "", NOW), null);
  assert.equal(describeSyncStatus({ ...online, signedIn: false, status: "signed-out" }, "", NOW), null);
});

test("a saved state says when it was last saved", () => {
  const status = describeSyncStatus({ ...online, status: "synced" }, "2026-09-25T11:55:00.000Z", NOW);
  assert.equal(status.tone, "ok");
  assert.equal(status.label, "Guardado en la nube");
  assert.equal(status.detail, "hace 5 min");
});

test("an upload in flight reads as saving", () => {
  for (const state of ["pending", "syncing", "checking"]) {
    assert.equal(describeSyncStatus({ ...online, status: state }, "", NOW).tone, "pending");
  }
});

// Regression: a failed save was invisible once inside the app.
test("a failed save is a problem the user is told about, with their data reassured", () => {
  const status = describeSyncStatus({ ...online, status: "error" }, "2026-09-20T12:00:00.000Z", NOW);
  assert.equal(status.tone, "problem");
  assert.match(status.detail, /siguen seguros en este teléfono/);
});

test("being offline wins over a stale error: the fix is the connection, not a retry", () => {
  assert.equal(describeSyncStatus({ ...online, online: false, status: "error" }, "", NOW).tone, "offline");
});

test("the default names for an unnamed expense are placeholders, real merchants are not", () => {
  for (const name of ["Gasto", "gasto", "Compra", " GASTO "]) {
    assert.equal(isPlaceholderMerchant(name), true, name);
  }
  for (const name of ["Gastos varios", "Panadería", "Tienda"]) {
    assert.equal(isPlaceholderMerchant(name), false, name);
  }
});

test("a 'Libre' movement is never marked as classified when loaded", () => {
  const [free, food, none] = normalizeTransactions(
    [
      { id: "a", amount: 1, category: "free", labeled: true },
      { id: "b", amount: 1, category: "food" },
      { id: "c", amount: 1, category: "", labeled: true }
    ],
    "2026-06-10"
  );
  assert.equal(free.labeled, false);
  assert.equal(food.labeled, true);
  assert.equal(none.labeled, false);
});

test("expenses may come from the card, income never lands on it", () => {
  assert.equal(normalizeLocation("credit"), "credit");
  assert.equal(normalizeIncomeLocation("credit"), "account");
  assert.equal(normalizeIncomeLocation("cash"), "cash");
});

test("what is owed on the card is never negative; account and cash may be", () => {
  const liquidity = normalizeLiquidity({ account: -20_000, cash: "5000", credit: -300, initialized: true });
  assert.equal(liquidity.account, -20_000);
  assert.equal(liquidity.cash, 5_000);
  assert.equal(liquidity.credit, 0);
  assert.equal(normalizeLiquidity({}).credit, 0);
});

test("unsynced local edits are the ones made after the last successful sync", () => {
  const meta = { cloudUpdatedAt: "2026-06-10T10:00:00.000Z" };
  assert.equal(hasUnsyncedLocalEdits({ updated_at: "2026-06-10T10:05:00.000Z", meta }), true);
  assert.equal(hasUnsyncedLocalEdits({ updated_at: "2026-06-10T09:59:00.000Z", meta }), false);
  assert.equal(hasUnsyncedLocalEdits({ updated_at: "2026-06-10T10:05:00.000Z", meta: {} }), true);
  assert.equal(hasUnsyncedLocalEdits({ meta }), false);
});

test("the compact local save round-trips every expense exactly", () => {
  const today = "2026-09-26";
  const original = normalizeTransactions(
    [
      { id: "a", date: "2026-09-20", merchant: "Tienda", amount: 5_000, category: "free", source: "account", updated_at: "2026-09-20T10:00:00.000Z", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "b", date: "2026-09-21", merchant: "Terpel", description: "Tanqueada", amount: 60_000, category: "transporte", budgeted: true, oneOff: true, source: "credit", calendarEventId: "c1", updated_at: "2026-09-22T10:00:00.000Z", createdAt: "2026-09-21T10:00:00.000Z" }
    ],
    today
  );
  const compact = compactForStorage({ transactions: original });
  assert.ok(JSON.stringify(compact).length < JSON.stringify({ transactions: original }).length);
  assert.equal("source" in compact.transactions[0], false);
  assert.deepEqual(normalizeTransactions(compact.transactions, today), original.map((t) => (t.createdAt === t.updated_at ? (({ createdAt, ...rest }) => rest)(t) : t)));
});

const tx = (merchant, amount, date, category = "gasolina", source = "cash", updated_at = `${date}T12:00:00.000Z`) =>
  ({ merchant, amount, date, category, source, updated_at });

test("frequent expenses: repeated merchants become one-tap chips with the latest amount", () => {
  const transactions = [
    tx("Terpel", 70_000, "2026-09-01"),
    tx("terpel ", 85_000, "2026-09-20"),
    tx("Terpel", 80_000, "2026-10-05"),
    tx("Tienda Don Jose", 12_000, "2026-10-01", "mercado", "account"),
    tx("Tienda don José", 9_000, "2026-10-08", "mercado", "account"),
    tx("Cine", 30_000, "2026-10-02", "free", "account")
  ];
  const chips = frequentExpenses(transactions, { today: "2026-10-10", validCategoryIds: ["gasolina", "mercado"] });

  assert.deepEqual(chips.map((chip) => [chip.merchant, chip.amount, chip.category, chip.source, chip.count]), [
    ["Terpel", 80_000, "gasolina", "cash", 3],
    ["Tienda don José", 9_000, "mercado", "account", 2]
  ], "seen once (Cine) is not a habit; accents/case/spaces group together; newest amount wins");
});

test("frequent expenses: one chip per merchant, ignoring old, unnamed and deleted-category expenses", () => {
  const transactions = [
    tx("Terpel", 80_000, "2026-10-01", "gasolina", "cash"),
    tx("Terpel", 80_000, "2026-10-03", "gasolina", "cash"),
    tx("Terpel", 50_000, "2026-10-04", "gasolina", "account"),
    tx("Gasto", 5_000, "2026-10-04", "free", "cash"),
    tx("Gasto", 5_000, "2026-10-05", "free", "cash"),
    tx("Parqueadero", 4_000, "2026-01-02", "free", "cash"),
    tx("Parqueadero", 4_000, "2026-01-03", "free", "cash"),
    tx("Gym", 90_000, "2026-09-01", "borrada", "account"),
    tx("Gym", 90_000, "2026-10-01", "borrada", "account")
  ];
  const chips = frequentExpenses(transactions, { today: "2026-10-10", validCategoryIds: new Set(["gasolina"]) });

  assert.deepEqual(chips.map((chip) => [chip.merchant, chip.source, chip.category]), [
    ["Terpel", "cash", "gasolina"],
    ["Gym", "account", "free"]
  ], "the usual way of paying wins; the placeholder 'Gasto' and expenses older than 90 days are skipped; a deleted category falls back to Libre");
});

test("frequent expenses respects the limit", () => {
  const transactions = ["Aaa", "Bbb", "Ccc", "Ddd", "Eee"].flatMap((name) => [tx(name, 1_000, "2026-10-01"), tx(name, 1_000, "2026-10-02")]);
  assert.equal(frequentExpenses(transactions, { today: "2026-10-10", validCategoryIds: ["gasolina"] }).length, 4);
  assert.equal(frequentExpenses(transactions, { today: "2026-10-10", validCategoryIds: ["gasolina"], limit: 2 }).length, 2);
  assert.deepEqual(frequentExpenses([], { today: "2026-10-10" }), []);
});

test("last expense source: Pagado con starts where the latest expense was paid", () => {
  assert.equal(lastExpenseSource([]), "account");
  assert.equal(lastExpenseSource([
    tx("Terpel", 80_000, "2026-10-05", "gasolina", "cash"),
    tx("Exito", 40_000, "2026-10-01", "mercado", "credit"),
    tx("Tienda", 3_000, "2026-10-05", "free", "credit", "2026-10-05T08:00:00.000Z")
  ]), "cash", "latest date wins, then the latest edit within the same day");
});

// Regression: the default state used to describe a specific person (a student with a
// $1.750.000 semester income, weekly gasoline, a money-scripts profile) and those numbers
// showed up already typed in the first user's onboarding.
test("a new profile assumes nothing about the user, and follows the phone's theme", () => {
  const fresh = createDefaultState("2026-10-12", "today");
  assert.equal(fresh.profile.completed, false);
  assert.equal(fresh.profile.incomeAmount, 0);
  assert.equal(fresh.profile.incomeCadence, "", "the onboarding must ask, not preselect");
  assert.equal(fresh.profile.incomeType, "");
  assert.equal(fresh.profile.committedExpenses, 0);
  assert.deepEqual(fresh.budgetJobs, []);
  assert.deepEqual(fresh.transactions, []);
  assert.deepEqual({ account: fresh.liquidity.account, cash: fresh.liquidity.cash }, { account: 0, cash: 0 });
  assert.equal(fresh.settings.theme, "");
  assert.equal(fresh.periodIncomeStatus, null);
});

test("an explicit theme survives migration, anything else falls back to following the phone", () => {
  for (const theme of ["dark", "light"]) {
    assert.equal(migrateState({ settings: { theme } }, "2026-10-12", "today").settings.theme, theme);
  }
  assert.equal(migrateState({ settings: { theme: "sepia" } }, "2026-10-12", "today").settings.theme, "");
});

test("the daily reminder covers the next 14 days at its time, skipping today when already recorded", () => {
  const keys = (dates) => dates.map((date) => `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`);
  const morning = new Date(2026, 9, 25, 9, 0);
  const dates = upcomingReminderDates("20:00", { now: morning });
  assert.equal(dates.length, 14);
  assert.deepEqual(keys(dates).slice(0, 2), ["10/25 20:00", "10/26 20:00"], "today still counts before the time");
  assert.deepEqual(keys(upcomingReminderDates("20:00", { now: morning, skipToday: true })).slice(0, 1), ["10/26 20:00"], "already recorded today");
  assert.deepEqual(keys(upcomingReminderDates("20:00", { now: new Date(2026, 9, 25, 21, 0) })).slice(0, 1), ["10/26 20:00"], "time already passed");
  assert.deepEqual(keys(upcomingReminderDates("20:00", { now: new Date(2026, 9, 31, 22, 0) })).slice(0, 2), ["11/1 20:00", "11/2 20:00"], "across a month end");
  assert.equal(upcomingReminderDates("nope", { now: morning })[0].getHours(), 20, "an invalid time falls back to 20:00");
});
