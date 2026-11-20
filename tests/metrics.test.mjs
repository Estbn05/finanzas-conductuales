import assert from "node:assert/strict";
import test from "node:test";
import { BATCH_SIZE, MAX_QUEUED, cleanProps, createMetrics } from "../metrics.js";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

const AT = () => new Date("2026-11-19T15:00:00Z");

test("an event carries the install's random id, the version and only short flags", () => {
  const storage = memoryStorage();
  const metrics = createMetrics({ storage, send: async () => {}, version: "1.1.120", platform: "android", now: AT });
  assert.equal(metrics.track("expense_added", { via: "manual", count: 2, merchant: "Una tienda con un nombre larguísimo que alguien escribió" }), true);
  metrics.track("app_open");
  const [first, second] = JSON.parse(storage.getItem("fc-metrics-queue"));
  assert.match(first.install_id, /^[0-9a-f-]{36}$/);
  assert.equal(second.install_id, first.install_id, "the same id for every event of this install");
  assert.deepEqual(first.props, { via: "manual", count: 2 });
  assert.equal(first.app_version, "1.1.120");
  assert.equal(first.platform, "android");
  assert.equal(first.happened_at, "2026-11-19T15:00:00.000Z");
});

test("props never take objects, lists or long text, so nothing typed can slip in", () => {
  assert.deepEqual(cleanProps({ ok: true, n: 3, list: [1], nested: { a: 1 }, text: "x".repeat(41), "bad key": 1 }), { ok: true, n: 3 });
});

test("waiting events go in batches, and the ones that fail stay for the next try", async () => {
  const storage = memoryStorage();
  const batches = [];
  let failNext = false;
  const metrics = createMetrics({
    storage,
    now: AT,
    send: async (batch) => {
      if (failNext) throw new Error("offline");
      batches.push(batch.length);
    }
  });
  for (let i = 0; i < BATCH_SIZE + 5; i += 1) metrics.track("view", { name: "today" });
  failNext = true;
  assert.equal(await metrics.flush(), 0);
  assert.equal(metrics.pending(), BATCH_SIZE + 5);
  failNext = false;
  assert.equal(await metrics.flush(), BATCH_SIZE + 5);
  assert.deepEqual(batches, [BATCH_SIZE, 5]);
  assert.equal(metrics.pending(), 0);
});

test("offline for long, the phone keeps only the newest events", () => {
  const storage = memoryStorage();
  const metrics = createMetrics({ storage, send: async () => {}, now: AT });
  for (let i = 0; i < MAX_QUEUED + 10; i += 1) metrics.track("view", { n: i });
  const queue = JSON.parse(storage.getItem("fc-metrics-queue"));
  assert.equal(queue.length, MAX_QUEUED);
  assert.equal(queue[0].props.n, 10);
});

test("turned off: nothing is recorded or sent, and what was waiting is dropped", async () => {
  const storage = memoryStorage();
  let sent = 0;
  const metrics = createMetrics({ storage, send: async (batch) => (sent += batch.length), now: AT });
  metrics.track("app_open");
  metrics.setOn(false);
  assert.equal(metrics.isOn(), false);
  assert.equal(metrics.pending(), 0);
  assert.equal(metrics.track("app_open"), false);
  assert.equal(await metrics.flush(), 0);
  assert.equal(sent, 0);
  metrics.setOn(true);
  assert.equal(metrics.track("app_open"), true);
});

test("a storage that throws (private mode) never breaks the app", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  const metrics = createMetrics({ storage: broken, send: async () => {} });
  assert.doesNotThrow(() => metrics.track("app_open"));
});
