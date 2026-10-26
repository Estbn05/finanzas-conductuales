import assert from "node:assert/strict";
import test from "node:test";
import {
  duePlans,
  nextOccurrence,
  normalizeRepeat,
  occurrencesBetween,
  plannedTotal,
  registerOccurrence,
  skipOccurrence,
  undoOccurrence
} from "../planned.js";

const rent = (overrides = {}) => ({ id: "rent", title: "Arriendo", date: "2026-11-01", amount: 900_000, repeat: "monthly", anchorDay: 1, history: [], ...overrides });

test("monthly plans keep their day, falling on the last day of shorter months", () => {
  assert.equal(nextOccurrence("2026-10-31", "monthly", 31), "2026-11-30");
  assert.equal(nextOccurrence("2026-11-30", "monthly", 31), "2026-12-31", "back to the 31st, not stuck on the 30th");
  assert.equal(nextOccurrence("2027-01-31", "monthly", 31), "2027-02-28");
  assert.equal(nextOccurrence("2026-12-15", "monthly", 15), "2027-01-15", "across the year end");
  assert.equal(nextOccurrence("2026-10-28", "weekly"), "2026-11-04");
  assert.equal(nextOccurrence("2026-10-28", ""), "", "a one-off has no next date");
  assert.equal(normalizeRepeat("yearly"), "");
});

test("occurrences in a range count each repetition; one-offs and done plans count once or not at all", () => {
  const gym = { date: "2026-10-26", amount: 20_000, repeat: "weekly" };
  assert.deepEqual(occurrencesBetween(gym, "2026-10-25", "2026-11-24"), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  assert.deepEqual(occurrencesBetween({ date: "2026-11-05", amount: 1, repeat: "" }, "2026-10-25", "2026-11-24"), ["2026-11-05"]);
  assert.deepEqual(occurrencesBetween({ date: "2026-11-05", amount: 1, spent: true }, "2026-10-25", "2026-11-24"), []);
  assert.equal(plannedTotal([gym, rent()], "2026-10-25", "2026-11-24"), 5 * 20_000 + 900_000);
});

test("due plans are the pending ones whose date has come, oldest first", () => {
  const plans = [
    rent({ id: "late", date: "2026-10-20" }),
    rent({ id: "today", date: "2026-10-25" }),
    rent({ id: "future", date: "2026-10-26" }),
    { id: "done", date: "2026-10-01", spent: true }
  ];
  assert.deepEqual(duePlans(plans, "2026-10-25").map((plan) => plan.id), ["late", "today"]);
});

test("registering a repeating plan moves it to its next date, and undoing brings it back", () => {
  const paid = registerOccurrence(rent(), "tx1", "now");
  assert.equal(paid.date, "2026-12-01");
  assert.equal(paid.spent, undefined, "a repeating plan is never 'done'");
  assert.deepEqual(paid.history, [{ date: "2026-11-01", transactionId: "tx1" }]);

  const undone = undoOccurrence(paid, "tx1", "later");
  assert.equal(undone.date, "2026-11-01");
  assert.deepEqual(undone.history, []);
});

test("deleting the expense of an older occurrence does not move the plan back", () => {
  const twice = registerOccurrence(registerOccurrence(rent(), "nov"), "dec");
  assert.equal(twice.date, "2027-01-01");
  const forgotNov = undoOccurrence(twice, "nov");
  assert.equal(forgotNov.date, "2027-01-01");
  assert.deepEqual(forgotNov.history.map((entry) => entry.transactionId), ["dec"]);
  assert.equal(undoOccurrence(twice, "unknown"), twice);
});

test("skipping moves a repeating plan on without an expense; a one-off is just done", () => {
  const skipped = skipOccurrence(rent());
  assert.equal(skipped.date, "2026-12-01");
  assert.equal(skipped.history[0].skipped, true);
  assert.equal(undoOccurrence(skipped).date, "2026-11-01");

  const gift = { id: "gift", title: "Regalo", date: "2026-11-05", amount: 80_000, repeat: "" };
  const done = registerOccurrence(gift, "tx9");
  assert.deepEqual({ spent: done.spent, transactionId: done.transactionId }, { spent: true, transactionId: "tx9" });
  assert.equal(skipOccurrence(gift).skipped, true);
  assert.equal(undoOccurrence(done).spent, false);
});
