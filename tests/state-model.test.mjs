import assert from "node:assert/strict";
import test from "node:test";
import { decideLoginSync, decidePushSync, hasMeaningfulLocalData, remoteChangedSinceLastSync } from "../state-model.js";

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
