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

// Screenshots of the bank's pockets screen, read as text on the phone (Android
// ScreenTextPlugin, ML Kit). Each image: { width, lines: [{ text, left, top }] }.
// Real Nu "Cajitas" (November 2026), one card per pocket, text in one column:
//   "colchon de emergencia" / "(ahorro)"   the name, sometimes over two lines
//   "$ 1.323.650,70"                       what it holds
//   "↑ $ 10.650,70"                        what it has earned (not wanted)
// with a "9,35%" badge on the card's picture to the left, a "Total agregado" and a promo
// above the list, and cards cut off at the top and bottom of each screenshot. A name is
// only taken from the same column as the amounts, which leaves the promo and the badge out;
// the first amount after a name is its balance and the rest are ignored until the next
// name. Several screenshots of one long list overlap: a pocket is kept once.
// "$ 135.705,59", or the earnings under it, "↑ $ 45.035,15", whose arrow comes out "↑", "T"
// or "^". The reader confuses O with 0 and l or I with 1 inside the number ("135.7O5,59"),
// and sometimes reads the decimal comma as a dot ("135.705.59"): two digits after the last
// separator are always the cents.
const MONEY_LINE = /^(.{0,3}?)\$\s*([\dOoIl][\dOoIl.,\s]*)$/u;
const NOT_A_POCKET = /^(cajitas|total agregado|asi ha crecido|nueva forma|entra a una|tu ahorro|como funciona|bolsillos)/;

// { amount, earnings } or null. earnings: a mark before the "$", the arrow of what the
// cajita has earned, which is never its balance.
function moneyFromLine(text) {
  const match = String(text || "").trim().match(MONEY_LINE);
  if (!match) return null;
  const number = match[2].replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/\s/g, "");
  if (!/^\d{1,3}([.,]\d{3})*([.,]\d{2})?$|^\d+([.,]\d{2})?$/.test(number)) return null;
  const cents = /[.,]\d{2}$/.test(number);
  const whole = Number((cents ? number.slice(0, -3) : number).replace(/[.,]/g, ""));
  const amount = Math.round(whole + (cents ? Number(number.slice(-2)) / 100 : 0));
  return { amount, earnings: match[1].trim() !== "" };
}

// Text recognition mixes up look-alikes inside words: "ase0" is "aseo", "1ibre" is "libre".
function fixLetters(text) {
  return String(text)
    .replace(/(?<=\p{L})0|0(?=\p{L})/gu, "o")
    .replace(/(?<=\p{L})1|1(?=\p{L})/gu, "l");
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Two names that differ by a letter the reader dropped or misread ("mprevistos" and
// "imprevistos"): one letter in a short name, two in a long one. Very short names must match.
function sameName(a, b) {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  return shorter >= 5 && editDistance(a, b) <= (shorter >= 10 ? 2 : 1);
}

export function readPocketsFromScreens(images = []) {
  const pockets = new Map();
  images.forEach((image) => {
    const lines = (image?.lines || [])
      .map((line) => ({ text: String(line.text || "").trim(), left: Number(line.left) || 0, top: Number(line.top) || 0 }))
      .filter((line) => line.text)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const amounts = lines.filter((line) => moneyFromLine(line.text)).map((line) => line.left).sort((a, b) => a - b);
    if (!amounts.length) return;
    // The amounts' column; the earnings line starts a little to the right (its arrow).
    const column = amounts[Math.floor(amounts.length / 2)];
    const tolerance = Math.max(12, Number(image.width || 0) * 0.06);
    let name = "";
    let nameBottom = -1;
    lines.forEach((line) => {
      const money = moneyFromLine(line.text);
      if (money) {
        const { amount } = money;
        const key = bankBoxKey(name);
        // The earnings line with no balance read before it: the cajita is skipped, not
        // given what it earned.
        if (money.earnings) {
          name = "";
          return;
        }
        // The same cajita in two overlapping screenshots can be read slightly differently.
        if (key && !NOT_A_POCKET.test(key) && ![...pockets.keys()].some((seen) => sameName(seen, key))) {
          pockets.set(key, { name, amount });
        }
        name = "";
        return;
      }
      if (Math.abs(line.left - column) > tolerance || /%\s*$/.test(line.text) || !/\p{L}{2}/u.test(line.text)) {
        return;
      }
      // A name over two lines: the second follows right under the first.
      const text = fixLetters(line.text);
      name = name && line.top - nameBottom < Math.max(40, Number(image.width || 0) * 0.09) ? `${name} ${text}` : text;
      nameBottom = line.top;
    });
  });
  return [...pockets.values()];
}

// Each pocket read from the screenshots to its row in "Cuadrar con tu banco", trying in
// order: the same name; the same name but for a misread letter; a name that starts like the
// other ("Moto fija(soat+revision)" and "Moto fija"); a name whose words hold the other's
// ("colchon de emergencia (ahorro)" and "Ahorro"). Each step only links a pocket and a row
// that fit nobody else, so "moto" never guesses between "moto fija" and "moto mensual".
// "libre"/"disponible" go to Libre (added up) and one for paying the card to the card's row.
// fills: { rowKey: amount }; unmatched: names nobody claimed.
export function matchPockets(pockets = [], rows = []) {
  const fills = {};
  const boxRows = rows.filter((row) => row.key.startsWith("box:")).map((row) => ({ key: row.key, name: bankBoxKey(row.label) }));
  let pending = [];
  pockets.forEach((pocket) => {
    const key = bankBoxKey(pocket.name);
    if (["libre", "disponible", "dinero disponible"].some((name) => sameName(name, key)) && rows.some((row) => row.key === "free")) {
      fills.free = (fills.free || 0) + pocket.amount;
    } else {
      pending.push({ pocket, key });
    }
  });
  const startsLike = (a, b) => a.startsWith(`${b} `) || b.startsWith(`${a} `);
  const holds = (a, b) => ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
  const steps = [(row, key) => row === key, sameName, startsLike, holds];
  steps.forEach((fits) => {
    const linked = [];
    pending.forEach((item) => {
      const options = boxRows.filter((row) => !(row.key in fills) && fits(row.name, item.key));
      if (options.length === 1 && pending.filter((other) => fits(options[0].name, other.key)).length === 1) {
        linked.push([item, options[0]]);
      }
    });
    linked.forEach(([item, row]) => {
      if (!(row.key in fills)) {
        fills[row.key] = item.pocket.amount;
        pending = pending.filter((other) => other !== item);
      }
    });
  });
  const unmatched = [];
  pending.forEach(({ pocket, key }) => {
    if (/\b(tarjeta|cred|credito)\b/.test(key) && rows.some((row) => row.key === "credit") && !("credit" in fills)) {
      fills.credit = pocket.amount;
    } else {
      unmatched.push(pocket.name);
    }
  });
  return { fills, unmatched };
}
