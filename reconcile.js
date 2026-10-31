// "Cuadrar con tu banco": what each pocket of the bank account (Nu's cajitas, Nequi's
// bolsillos) should hold according to the app, next to what the bank says. Each category
// is its own pocket unless it says otherwise (`box`, for a pocket shared by several);
// libre is what is free in the account, and a pocket for paying the card should hold what
// is owed on it. Pure: app.js passes the numbers; tested in tests/reconcile.test.mjs.

// Bank pockets earn interest (Nu's cajitas, around 9% a year), so the bank usually holds a
// little more than the app knows about. A difference in the bank's favor up to this much
// is read as interest, not as a mistake.
export const INTEREST_MIN = 5000;
export const INTEREST_SHARE = 0.05;

// "Moto", "moto " and "Motó" are the same pocket.
export function bankBoxKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// How the bank's figure compares with the app's: "unchecked" (nothing typed yet),
// "match" (within a peso of rounding), "interest", or "more"/"less" than expected.
export function reconcileStatus(expected, bank) {
  if (bank === null || bank === undefined || bank === "" || !Number.isFinite(Number(bank))) {
    return { kind: "unchecked", difference: 0 };
  }
  const difference = Math.round(Number(bank) - Number(expected || 0));
  if (Math.abs(difference) < 100) {
    return { kind: "match", difference };
  }
  if (difference > 0 && difference <= Math.max(INTEREST_MIN, Number(expected || 0) * INTEREST_SHARE)) {
    return { kind: "interest", difference };
  }
  return { kind: difference > 0 ? "more" : "less", difference };
}

// One row per pocket: libre first, then the categories' pockets in the plan's order, then
// the card. `categories`: [{ id, name, remaining, box }]; `checks`: what the user typed
// last, by row key ({ amount, at }).
export function reconcileRows({ categories = [], freeInAccount = 0, owedOnCard = 0, checks = {} }) {
  const row = (key, label, expected, members = []) => {
    const check = checks[key] || null;
    return { key, label, expected: Math.round(expected), members, check, status: reconcileStatus(expected, check?.amount) };
  };
  const boxes = new Map();
  categories.forEach((category) => {
    const label = String(category.box || "").trim() || category.name;
    const key = `box:${bankBoxKey(label)}`;
    const box = boxes.get(key) || { label, expected: 0, members: [] };
    box.expected += Math.max(0, Number(category.remaining || 0));
    box.members.push({ id: category.id, name: category.name, remaining: Math.max(0, Math.round(Number(category.remaining || 0))) });
    boxes.set(key, box);
  });
  const rows = [row("free", "Libre", Math.max(0, freeInAccount))];
  boxes.forEach((box, key) => rows.push(row(key, box.label, box.expected, box.members)));
  if (owedOnCard > 0 || checks.credit) {
    rows.push(row("credit", "Para pagar la tarjeta", Math.max(0, owedOnCard)));
  }
  return rows;
}

// "Cuadran 5 de 7": rows checked against the bank and how many of them add up (interest
// counts as adding up).
export function reconcileSummary(rows = []) {
  const checked = rows.filter((item) => item.status.kind !== "unchecked");
  return {
    checked: checked.length,
    matching: checked.filter((item) => item.status.kind === "match" || item.status.kind === "interest").length,
    total: rows.length
  };
}
