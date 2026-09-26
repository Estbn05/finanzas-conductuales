// Two devices editing the same account: mergeStates(base, local, remote) combines them
// instead of letting the last one to save erase the other's changes.
import assert from "node:assert/strict";
import test from "node:test";
import { compactMergeBase, mergeStates } from "../state-model.js";

const tx = (id, amount, extra = {}) => ({ id, merchant: `Gasto ${id}`, amount, category: "free", date: "2026-09-20", ...extra });

function baseState(overrides = {}) {
  return {
    updated_at: "2026-09-20T10:00:00.000Z",
    activeView: "today",
    lastAlert: "",
    meta: { cloudUpdatedAt: "2026-09-20T10:00:00.000Z" },
    profile: { completed: true, incomeAmount: 2_000_000, incomeCadence: "monthly", name: "Mi plan" },
    settings: { theme: "dark", monthlyRaisePct: 8 },
    liquidity: { account: 1_000_000, cash: 100_000, credit: 0, initialized: true },
    transactions: [tx("a", 10_000)],
    budgetJobs: [{ id: "mercado", name: "Mercado", amount: 300_000, cadence: "monthly" }],
    budgetExtras: [],
    periodIncomeApplied: [],
    periodIncomeStatus: null,
    ...overrides
  };
}

// Applies an edit to a copy of the base, the way a device would.
function edit(base, change, at) {
  const copy = structuredClone(base);
  change(copy);
  copy.updated_at = at;
  return copy;
}

const PHONE = "2026-09-20T11:00:00.000Z";
const LAPTOP = "2026-09-20T11:05:00.000Z";

test("an expense added on each device: both survive, and both come out of the account", () => {
  const base = baseState();
  const phone = edit(base, (s) => {
    s.transactions.push(tx("p", 20_000));
    s.liquidity.account -= 20_000;
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.transactions.push(tx("l", 35_000));
    s.liquidity.account -= 35_000;
  }, LAPTOP);

  const merged = mergeStates(base, phone, laptop);
  assert.deepEqual(merged.transactions.map((t) => t.id).sort(), ["a", "l", "p"]);
  assert.equal(merged.liquidity.account, 1_000_000 - 20_000 - 35_000);
  // Symmetric: merging the other way round gives the same data.
  const reverse = mergeStates(base, laptop, phone);
  assert.deepEqual(reverse.transactions.map((t) => t.id).sort(), ["a", "l", "p"]);
  assert.equal(reverse.liquidity.account, merged.liquidity.account);
});

test("an expense deleted on one device stays deleted, even after the other syncs", () => {
  const base = baseState({ transactions: [tx("a", 10_000), tx("b", 5_000)] });
  const phone = edit(base, (s) => {
    s.transactions = s.transactions.filter((t) => t.id !== "b");
    s.liquidity.account += 5_000;
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.transactions.push(tx("l", 1_000));
    s.liquidity.account -= 1_000;
  }, LAPTOP);

  const merged = mergeStates(base, phone, laptop);
  assert.deepEqual(merged.transactions.map((t) => t.id).sort(), ["a", "l"]);
  assert.equal(merged.liquidity.account, 1_000_000 + 5_000 - 1_000);
});

test("a record deleted on one device but edited on the other is kept (edits are not thrown away)", () => {
  const base = baseState();
  const phone = edit(base, (s) => {
    s.transactions = [];
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.transactions[0].category = "mercado";
  }, LAPTOP);
  const merged = mergeStates(base, phone, laptop);
  assert.equal(merged.transactions.length, 1);
  assert.equal(merged.transactions[0].category, "mercado");
});

test("the same record edited on both: the most recently saved edit wins", () => {
  const base = baseState();
  const phone = edit(base, (s) => {
    s.transactions[0].merchant = "Desde el teléfono";
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.transactions[0].merchant = "Desde el portátil";
  }, LAPTOP);
  assert.equal(mergeStates(base, phone, laptop).transactions[0].merchant, "Desde el portátil");
  assert.equal(mergeStates(base, laptop, phone).transactions[0].merchant, "Desde el portátil");
});

test("settings and profile merge field by field", () => {
  const base = baseState();
  const phone = edit(base, (s) => {
    s.settings.theme = "light";
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.profile.incomeAmount = 2_500_000;
  }, LAPTOP);
  const merged = mergeStates(base, phone, laptop);
  assert.equal(merged.settings.theme, "light");
  assert.equal(merged.profile.incomeAmount, 2_500_000);
  assert.equal(merged.profile.name, "Mi plan");
});

test("screen state stays this device's own", () => {
  const base = baseState();
  const phone = edit(base, (s) => {
    s.activeView = "movements";
    s.meta = { cloudUpdatedAt: "phone" };
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.activeView = "budget";
    s.meta = { cloudUpdatedAt: "laptop" };
  }, LAPTOP);
  const merged = mergeStates(base, phone, laptop);
  assert.equal(merged.activeView, "movements");
  assert.equal(merged.meta.cloudUpdatedAt, "phone");
});

test("pay deposited by both devices for the same period counts once", () => {
  const base = baseState();
  const deposit = (s) => {
    s.liquidity.account += 2_000_000;
    s.periodIncomeApplied.push({ windowStart: "2026-10-01", windowEnd: "2026-11-01", status: "applied", amount: 2_000_000 });
  };
  const phone = edit(base, deposit, PHONE);
  const laptop = edit(base, (s) => {
    deposit(s);
    s.transactions.push(tx("l", 50_000));
    s.liquidity.account -= 50_000;
  }, LAPTOP);
  const merged = mergeStates(base, phone, laptop);
  assert.equal(merged.liquidity.account, 1_000_000 + 2_000_000 - 50_000);
  assert.equal(merged.periodIncomeApplied.length, 1);
});

test("a card payment and a card expense on different devices both count", () => {
  const base = baseState({ liquidity: { account: 1_000_000, cash: 0, credit: 200_000, initialized: true } });
  const phone = edit(base, (s) => {
    s.liquidity.account -= 200_000;
    s.liquidity.credit -= 200_000;
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.transactions.push(tx("c", 30_000, { source: "credit" }));
    s.liquidity.credit += 30_000;
  }, LAPTOP);
  const merged = mergeStates(base, phone, laptop);
  assert.equal(merged.liquidity.account, 800_000);
  assert.equal(merged.liquidity.credit, 30_000);
});

test("without a base (first sync after the update), records are combined and nothing is deleted", () => {
  const phone = baseState({ transactions: [tx("a", 1), tx("p", 2)], updated_at: PHONE });
  const laptop = baseState({ transactions: [tx("a", 1), tx("l", 3)], updated_at: LAPTOP, liquidity: { account: 5, cash: 0, credit: 0, initialized: true } });
  const merged = mergeStates(null, phone, laptop);
  assert.deepEqual(merged.transactions.map((t) => t.id).sort(), ["a", "l", "p"]);
  // No common point to add changes from: the newer balance is kept.
  assert.equal(merged.liquidity.account, 5);
});

test("nothing changed remotely: the merge is just the local state", () => {
  const base = baseState();
  const phone = edit(base, (s) => {
    s.transactions.push(tx("p", 20_000));
    s.liquidity.account -= 20_000;
  }, PHONE);
  const merged = mergeStates(base, phone, base);
  assert.deepEqual(merged.transactions, phone.transactions);
  assert.deepEqual(merged.liquidity, phone.liquidity);
});

// The device stores the base compactly (record hashes, not copies). Every case above must
// come out exactly the same with the compact base.
test("a compact base (record hashes) merges exactly like the full one", () => {
  const base = baseState({ transactions: [tx("a", 10_000), tx("b", 5_000)] });
  const phone = edit(base, (s) => {
    s.transactions = s.transactions.filter((t) => t.id !== "b");
    s.transactions.push(tx("p", 20_000));
    s.transactions[0].category = "mercado";
    s.liquidity.account -= 15_000;
  }, PHONE);
  const laptop = edit(base, (s) => {
    s.transactions.push(tx("l", 35_000));
    s.settings.theme = "light";
    s.liquidity.account -= 35_000;
  }, LAPTOP);
  const compact = compactMergeBase(base);
  assert.deepEqual(mergeStates(compact, phone, laptop), mergeStates(base, phone, laptop));
  assert.deepEqual(mergeStates(compact, laptop, phone), mergeStates(base, laptop, phone));
  assert.ok(JSON.stringify(compact).length < JSON.stringify(base).length);
});

test("with a compact base, pay deposited by both devices still counts once", () => {
  const base = baseState();
  const deposit = (s) => {
    s.liquidity.account += 2_000_000;
    s.periodIncomeApplied.push({ windowStart: "2026-10-01", windowEnd: "2026-11-01", status: "applied", amount: 2_000_000 });
  };
  const merged = mergeStates(compactMergeBase(base), edit(base, deposit, PHONE), edit(base, deposit, LAPTOP));
  assert.equal(merged.liquidity.account, 3_000_000);
});

// Records reloaded from the compact local save come back with their fields in another
// order and without default-valued ones. That is not a change: a record deleted on the
// other device must stay deleted.
test("a reloaded (compacted, then normalized) record still counts as unchanged", async () => {
  const { compactForStorage, normalizeTransactions } = await import("../state-model.js");
  const today = "2026-09-26";
  const base = baseState({
    transactions: normalizeTransactions([tx("a", 10_000, { updated_at: "2026-09-20T10:00:00.000Z", createdAt: "2026-09-20T10:00:00.000Z" }), tx("b", 5_000)], today)
  });
  const reloaded = { ...structuredClone(base), transactions: normalizeTransactions(compactForStorage(base).transactions, today) };
  const laptop = edit(base, (s) => {
    s.transactions = s.transactions.filter((t) => t.id !== "a");
  }, LAPTOP);
  const merged = mergeStates(compactMergeBase(base), reloaded, laptop);
  assert.deepEqual(merged.transactions.map((t) => t.id), ["b"], "the deleted expense came back");
});
