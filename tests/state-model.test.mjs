import assert from "node:assert/strict";
import test from "node:test";
import {
  decideLoginSync,
  decidePushSync,
  hasMeaningfulLocalData,
  merchantKey,
  csvField,
  merchantRuleMatches,
  describeSyncStatus,
  relativeTimeEs,
  remoteChangedSinceLastSync,
  uid
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
