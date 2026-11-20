// Anonymous usage statistics: which parts of the app get used, where the first steps are
// abandoned, what fails on a real phone. Nothing about the user's money ever goes in: no
// amounts, merchants, categories or names, only an event name and a few small flags. Each
// install has a random id that is not linked to the cloud account. Off with one switch in
// Datos (setMetricsOn), which also drops what was waiting to be sent.
//
// Events wait on the phone (the app works offline) and go to Supabase (table app_events,
// insert-only, see docs/supabase-schema.sql) in batches. Storage and sending are passed
// in, so this file has no browser or network code of its own and is unit-tested in
// tests/metrics.test.mjs.

export const METRICS_KEYS = { id: "fc-install-id", off: "fc-metrics-off", queue: "fc-metrics-queue" };
// Kept on the phone at most; the oldest go first when offline for a long time.
export const MAX_QUEUED = 200;
export const BATCH_SIZE = 50;
const NAME = /^[a-z][a-z0-9_]{1,39}$/;

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {}
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

// Only short flags and counts: a string longer than 40 characters, an object or a list is
// dropped, so nothing typed by the user can slip in by accident.
export function cleanProps(props = {}) {
  const clean = {};
  Object.entries(props || {}).slice(0, 8).forEach(([key, value]) => {
    if (!/^[a-z][a-zA-Z0-9_]{0,23}$/.test(key)) return;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) clean[key] = value;
    else if (typeof value === "string" && value.length <= 40) clean[key] = value;
  });
  return clean;
}

export function createMetrics({ storage, send, version = "", platform = "web", now = () => new Date() } = {}) {
  let flushing = null;

  const isOn = () => read(storage, METRICS_KEYS.off) !== "1";
  const installId = () => {
    let id = read(storage, METRICS_KEYS.id);
    if (!id) {
      id = randomId();
      write(storage, METRICS_KEYS.id, id);
    }
    return id;
  };
  const queue = () => {
    try {
      const list = JSON.parse(read(storage, METRICS_KEYS.queue) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const save = (list) => write(storage, METRICS_KEYS.queue, list.length ? JSON.stringify(list.slice(-MAX_QUEUED)) : null);

  function track(name, props = {}) {
    if (!isOn() || !NAME.test(String(name))) return false;
    save([
      ...queue(),
      {
        install_id: installId(),
        name,
        props: cleanProps(props),
        app_version: String(version).slice(0, 20),
        platform: String(platform).slice(0, 12),
        happened_at: now().toISOString()
      }
    ]);
    return true;
  }

  // Sends what is waiting, a batch at a time; whatever fails stays for the next try.
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      while (isOn()) {
        const batch = queue().slice(0, BATCH_SIZE);
        if (!batch.length) break;
        try {
          await send(batch);
        } catch {
          break;
        }
        // Events tracked while sending were added at the end: keep them.
        save(queue().slice(batch.length));
        sent += batch.length;
      }
      return sent;
    })();
    try {
      return await flushing;
    } finally {
      flushing = null;
    }
  }

  function setOn(on) {
    write(storage, METRICS_KEYS.off, on ? null : "1");
    if (!on) save([]);
  }

  return { track, flush, isOn, setOn, installId, pending: () => queue().length };
}
