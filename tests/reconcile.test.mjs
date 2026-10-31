import assert from "node:assert/strict";
import test from "node:test";
import { bankBoxKey, reconcileRows, reconcileStatus, reconcileSummary } from "../reconcile.js";

test("the bank's figure against the app's: matching, interest in the bank's favor, or a real difference", () => {
  assert.deepEqual(reconcileStatus(350_000, undefined), { kind: "unchecked", difference: 0 });
  assert.deepEqual(reconcileStatus(350_000, 350_040), { kind: "match", difference: 40 });
  // Real Nu cajita, October 2026: SOAT $350.000 set aside, $351.729 with interest.
  assert.deepEqual(reconcileStatus(350_000, 351_729), { kind: "interest", difference: 1729 });
  assert.equal(reconcileStatus(20_000, 24_000).kind, "interest", "small pockets get the $5.000 floor");
  assert.equal(reconcileStatus(413_600, 1_319_120).kind, "more", "$905.000 more is not interest");
  assert.equal(reconcileStatus(330_000, 213_311).kind, "less");
  assert.equal(reconcileStatus(330_000, 330_500).kind, "interest");
  assert.equal(reconcileStatus(330_000, 329_000).kind, "less", "less than expected is never interest");
});

test("each category is its own pocket unless it shares one; libre first and the card last", () => {
  const rows = reconcileRows({
    categories: [
      { id: "gas", name: "Gasolina", remaining: 101_097 },
      { id: "soat", name: "Soat", remaining: 350_000 },
      { id: "plan", name: "Plan pospago", remaining: 31_000, box: "Varios" },
      { id: "park", name: "Parqueadero", remaining: 20_000, box: " varios" },
      { id: "spent", name: "Revisión", remaining: -5000 }
    ],
    freeInAccount: 1_349_691,
    owedOnCard: 50_900,
    checks: { "box:soat": { amount: 351_729, at: "2026-10-31" }, free: { amount: 1_244_083 } }
  });
  assert.deepEqual(
    rows.map((row) => [row.key, row.label, row.expected]),
    [
      ["free", "Libre", 1_349_691],
      ["box:gasolina", "Gasolina", 101_097],
      ["box:soat", "Soat", 350_000],
      ["box:varios", "Varios", 51_000],
      ["box:revision", "Revisión", 0],
      ["credit", "Para pagar la tarjeta", 50_900]
    ]
  );
  assert.deepEqual(rows[3].members.map((member) => member.name), ["Plan pospago", "Parqueadero"]);
  assert.equal(rows[2].status.kind, "interest");
  assert.equal(rows[0].status.kind, "less");
  assert.deepEqual(reconcileSummary(rows), { checked: 2, matching: 1, total: 6 });

  const noCard = reconcileRows({ categories: [], freeInAccount: 10_000, owedOnCard: 0 });
  assert.deepEqual(noCard.map((row) => row.key), ["free"], "no card row when nothing is owed");
});

test("pocket names match regardless of case, accents and spaces", () => {
  assert.equal(bankBoxKey(" Revisión  Moto "), "revision moto");
  assert.equal(bankBoxKey("revision moto"), bankBoxKey("REVISION-MOTO"));
});
