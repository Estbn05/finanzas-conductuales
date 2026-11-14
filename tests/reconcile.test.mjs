import assert from "node:assert/strict";
import test from "node:test";
import { bankBoxKey, matchPockets, readPocketsFromScreens, reconcileRows, reconcileStatus, reconcileSummary } from "../reconcile.js";

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

// The user's Nu "Cajitas" screenshots (November 2026), as ML Kit reads them: 900px wide,
// status bar, title, a total and a promo on the first, cards cut off at the edges.
const line = (text, left, top) => ({ text, left, top });
const STATUS = [line("13:58", 60, 30), line("27.7 kB/s", 480, 35), line("39", 778, 32), line("Cajitas", 383, 140)];
const NU_TOP = {
  width: 900,
  lines: [
    ...STATUS,
    line("Total agregado", 58, 245),
    line("$ 2.325.475,91", 58, 320),
    line("Así ha crecido tu dinero", 58, 440),
    line("↑ $ 61.098,69", 70, 505),
    line("Nueva forma de ahorrar", 72, 675),
    line("Entra a una Cajita y abre un CDT", 48, 735),
    line("Tu ahorro puede crecer hasta al 11,50%", 48, 800),
    line("Cómo funciona →", 48, 880),
    line("libre", 327, 1025),
    line("9,35%", 185, 1175),
    line("$ 135.705,59", 327, 1095),
    line("↑ $ 45.035,15", 335, 1162),
    line("colchon de emergencia", 327, 1318),
    line("(ahorro)", 327, 1372),
    line("$ 1.323.650,70", 327, 1440),
    line("↑ $ 10.650,70", 335, 1508),
    line("pagar cred", 327, 1663),
    line("$ 25,08", 327, 1732),
    line("↑ $ 1.885,13", 335, 1800)
  ]
};
const NU_MIDDLE = {
  width: 900,
  lines: [
    ...STATUS,
    line("Moto fija(soat+revision)", 327, 333),
    line("$ 567.078,41", 327, 403),
    line("↑ $ 1.916,25", 335, 470),
    line("gafas", 327, 645),
    line("$ 0,00", 327, 715),
    line("↑ $ 151,90", 335, 782),
    line("fijos(suscripciones)", 327, 957),
    line("$ 49.977,73", 327, 1027),
    line("moto mensual", 327, 1268),
    line("$ 122.595,39", 327, 1338),
    line("motilada y aseo", 327, 1580),
    line("$ 26.124,15", 327, 1650),
    line("familia", 327, 1890)
  ]
};
const NU_BOTTOM = {
  width: 900,
  lines: [
    ...STATUS,
    line("↑ $ 151,90", 335, 230),
    line("fijos(suscripciones)", 327, 405),
    line("$ 49.977,73", 327, 475),
    line("↑ $ 217,55", 335, 542),
    line("familia", 327, 1340),
    line("$ 100.318,86", 327, 1410),
    line("↑ $ 318,86", 335, 1477),
    line("imprevistos", 327, 1650),
    line("$ 0,00", 327, 1720),
    line("↑ $ 122,52", 335, 1787)
  ]
};

test("Nu's Cajitas screenshots become one balance per cajita, earnings, totals and promo left out", () => {
  const pockets = readPocketsFromScreens([NU_TOP, NU_MIDDLE, NU_BOTTOM]);
  assert.deepEqual(
    pockets.map((pocket) => [pocket.name, pocket.amount]),
    [
      ["libre", 135_706],
      ["colchon de emergencia (ahorro)", 1_323_651],
      ["pagar cred", 25],
      ["Moto fija(soat+revision)", 567_078],
      ["gafas", 0],
      ["fijos(suscripciones)", 49_978],
      ["moto mensual", 122_595],
      ["motilada y aseo", 26_124],
      ["familia", 100_319],
      ["imprevistos", 0]
    ]
  );
});

test("a cajita fills the row with its name, or one that starts the same when only one fits", () => {
  const rows = reconcileRows({
    categories: [
      { id: "moto", name: "Moto fija", remaining: 560_000 },
      { id: "mm", name: "Moto mensual", remaining: 120_000 },
      { id: "subs", name: "Suscripciones", remaining: 50_000, box: "fijos(suscripciones)" },
      { id: "fam", name: "Familia", remaining: 100_000 },
      { id: "corte", name: "Motilada", remaining: 25_000 }
    ],
    freeInAccount: 100_000,
    owedOnCard: 30_000
  });
  const { fills, unmatched } = matchPockets(readPocketsFromScreens([NU_TOP, NU_MIDDLE, NU_BOTTOM]), rows);
  assert.deepEqual(fills, {
    free: 135_706,
    "box:moto fija": 567_078,
    "box:moto mensual": 122_595,
    "box:fijos suscripciones": 49_978,
    "box:familia": 100_319,
    "box:motilada": 26_124,
    credit: 25
  });
  assert.deepEqual(unmatched, ["colchon de emergencia (ahorro)", "gafas", "imprevistos"]);
});

test("'moto' does not guess between two moto cajitas", () => {
  const rows = reconcileRows({ categories: [{ id: "moto", name: "Moto", remaining: 1 }] });
  const { fills, unmatched } = matchPockets([{ name: "moto fija", amount: 5 }, { name: "moto mensual", amount: 7 }], rows);
  assert.deepEqual(fills, {});
  assert.deepEqual(unmatched, ["moto fija", "moto mensual"]);
});

test("a promo with its own amount, outside the cajitas' column, is not a cajita", () => {
  const screen = {
    width: 900,
    lines: [line("Abre un CDT desde", 48, 700), line("$ 500.000", 48, 760), line("libre", 327, 1025), line("$ 135.705,59", 327, 1095)]
  };
  assert.deepEqual(readPocketsFromScreens([screen]), [{ name: "libre", amount: 135_706 }]);
});

// What the phone actually read from those screenshots (November 2026): "imprevistos" lost
// its i, and "aseo" came out "ase0" in one of the two screenshots that show it.
test("letters the reader got wrong still find their category, and a cajita seen twice counts once", () => {
  const screens = [
    { width: 900, lines: [line("motilada y aseo", 327, 1580), line("$ 26.124,15", 327, 1650)] },
    {
      width: 900,
      lines: [
        line("motilada y ase0", 327, 1000),
        line("$ 26.124,15", 327, 1070),
        line("mprevistos", 327, 1650),
        line("$ 0,00", 327, 1720),
        line("colchon de emergencia", 327, 1318),
        line("(ahorro)", 327, 1372),
        line("$ 1.323.650,70", 327, 1440)
      ]
    }
  ];
  const pockets = readPocketsFromScreens(screens);
  assert.deepEqual(pockets.map((pocket) => pocket.name), ["motilada y aseo", "colchon de emergencia (ahorro)", "mprevistos"]);
  const rows = reconcileRows({
    categories: [
      { id: "a", name: "Motilada y aseo", remaining: 1 },
      { id: "b", name: "Imprevistos", remaining: 1 },
      { id: "c", name: "Ahorro", remaining: 1 }
    ]
  });
  const { fills, unmatched } = matchPockets(pockets, rows);
  assert.deepEqual(fills, { "box:motilada y aseo": 26_124, "box:imprevistos": 0, "box:ahorro": 1_323_651 });
  assert.deepEqual(unmatched, []);
});

// Exactly what ML Kit returned on the user's phone for their three Nu Cajitas screenshots
// (November 2026, 1220px wide): the decimal comma read as a dot ("$ 135.705.59"), arrows
// read as "T" and "^", "mprevistos", and "aseo" as "ase0" in one of the two shots.
const PHONE_READING = [
    {
      width: 1220,
      lines: [
        line("13:58", 83, 48),
        line("9,35%", 251, 336),
        line("9,35%", 251, 757),
        line("9,35%", 251, 1180),
        line("9,35%", 251, 1602),
        line("9,35%", 251, 2026),
        line("9,35%", 251, 2448),
        line("Cajitas", 518, 195),
        line("↑$ 151,90", 478, 306),
        line("fijos(suscripciones)", 442, 550),
        line("$ 49.977,73", 444, 642),
        line("^$ 217,55", 489, 723),
        line("moto mensual", 446, 973),
        line("$ 122.595,39", 443, 1067),
        line("^$ 676,48", 484, 1146),
        line("motilada y aseo", 445, 1392),
        line("$ 26.124,15", 444, 1488),
        line("^$ 124,15", 486, 1575),
        line("familia", 442, 1812),
        line("$ 100.318,86", 471, 1911),
        line("↑$318,86", 455, 1998),
        line("mprevistos", 481, 2239),
        line("$ 0,00", 444, 2333),
        line("^$ 122,52", 487, 2420)
      ]
    },
    {
      width: 1220,
      lines: [
        line("13:58", 83, 48),
        line("9,35%", 251, 662),
        line("9,35%", 251, 1085),
        line("9,35%", 251, 1510),
        line("9,35%", 251, 1933),
        line("9,35%", 251, 2352),
        line("Cajitas", 518, 195),
        line("Moto fija(soat+revision)", 447, 454),
        line("$ 567.078,41", 441, 547),
        line("^$1.916,25", 452, 631),
        line("gafas", 441, 875),
        line("$ 0,00", 442, 971),
        line("^$ 151,90", 478, 1053),
        line("fijos(suscripciones)", 441, 1297),
        line("$ 49.977,73", 473, 1387),
        line("^$ 217,55", 481, 1474),
        line("moto mensual", 446, 1723),
        line("$ 122.595,39", 472, 1811),
        line("^$ 676, 48", 488, 1896),
        line("motilada y ase0", 445, 2142),
        line("$ 26.124,15", 444, 2239),
        line("T$ 124,15", 454, 2324),
        line("familia", 442, 2567)
      ]
    },
    {
      width: 1220,
      lines: [
        line("13:58", 83, 48),
        line("Total agregado", 78, 329),
        line("$ 2.325.475,91", 82, 431),
        line("Así ha crecido tu dinero", 97, 587),
        line("↑ $61.098,69", 96, 683),
        line("Cajitas", 518, 195),
        line("Nueva forma de ahorrar", 100, 915),
        line("Entra a una Cajita y abre un CDT", 68, 998),
        line("Tu ahorro puede crecer hasta al 11,50%", 83, 1087),
        line("Cómo funciona >", 66, 1198),
        line("9,35%", 251, 1600),
        line("9,35%", 251, 2031),
        line("9,35%", 250, 2466),
        line("libre", 444, 1390),
        line("$ 135.705.59", 481, 1480),
        line("T$ 45.035,15", 483, 1573),
        line("colchon de emergencia", 444, 1784),
        line("(ahorro)", 444, 1861),
        line("$ 1.323.650,70", 444, 1955),
        line("↑$ 10.650,70", 455, 2042),
        line("pagar cred", 441, 2257),
        line("$ 25,08", 442, 2349),
        line("^$ 1.885,13", 481, 2433)
      ]
    }
];

test("the phone's real reading of Nu's Cajitas: every balance, none of the earnings", () => {
  assert.deepEqual(
    readPocketsFromScreens(PHONE_READING).map((pocket) => [pocket.name, pocket.amount]),
    [
      ["fijos(suscripciones)", 49_978],
      ["moto mensual", 122_595],
      ["motilada y aseo", 26_124],
      ["familia", 100_319],
      ["mprevistos", 0],
      ["Moto fija(soat+revision)", 567_078],
      ["gafas", 0],
      ["libre", 135_706],
      ["colchon de emergencia (ahorro)", 1_323_651],
      ["pagar cred", 25]
    ]
  );
});

test("a balance that cannot be read leaves the cajita out instead of taking its earnings", () => {
  const screen = { width: 1220, lines: [line("libre", 444, 1390), line("$ 135.7#5,59", 481, 1480), line("T$ 45.035,15", 483, 1573)] };
  assert.deepEqual(readPocketsFromScreens([screen]), []);
});

test("the 135.7O5,59 the reader also produced still reads as 135.706", () => {
  const screen = { width: 1220, lines: [line("libre", 446, 1391), line("$ 135.7O5,59", 443, 1486), line("$ 50.000", 443, 1600)] };
  assert.deepEqual(readPocketsFromScreens([screen]), [{ name: "libre", amount: 135_706 }]);
});

test("with the user's own categories, all ten cajitas from the phone's reading find their row", () => {
  const rows = reconcileRows({
    categories: [
      { id: "ahorro", name: "Ahorro", remaining: 1_320_700 },
      { id: "fam", name: "Familia", remaining: 100_000 },
      { id: "gafas", name: "Gafas", remaining: 0 },
      { id: "imp", name: "Imprevistos", remaining: 0 },
      { id: "mot", name: "Motilada y aseo", remaining: 26_000 },
      { id: "soat", name: "Soat", remaining: 350_000, box: "Moto fija" },
      { id: "rev", name: "Revision moto", remaining: 213_000, box: "Moto fija" },
      { id: "gas", name: "Gasolina", remaining: 120_000, box: "Moto mensual" },
      { id: "spot", name: "Spotify duo", remaining: 20_000, box: "Fijos(suscripciones)" },
      { id: "plan", name: "Plan pospago", remaining: 30_000, box: "Fijos(suscripciones)" }
    ],
    freeInAccount: 147_066,
    owedOnCard: 25
  });
  const { fills, unmatched } = matchPockets(readPocketsFromScreens(PHONE_READING), rows);
  assert.deepEqual(unmatched, []);
  assert.equal(Object.keys(fills).length, 10);
  assert.equal(fills.free, 135_706);
  assert.equal(fills["box:imprevistos"], 0);
  assert.equal(fills["box:ahorro"], 1_323_651);
});
