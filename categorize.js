// Which of the user's categories an expense probably belongs to, from the merchant name
// alone. Layers, most trusted first; each runs only when the ones before have no answer,
// and when in doubt the answer is null: a wrong category silently skews spend by
// category and the prediction, while a missing one only costs the user a tap.
//
//   1. rule      the user's own past choice for this exact merchant (or the same merchant
//                written with more/fewer words, see merchantRuleMatches)
//   2. brand     the user's past choices for the same brand at another branch:
//                "CARULLA CALLE 63" and "Carulla Calle 80" are both "carulla"
//   3. dictionary + synonyms
//                well-known Colombian merchants and words give a kind of expense
//                (combustible, mercado, salud...), matched to the user's categories by
//                their names. Never invents a category.
//
// Pure and offline: nothing leaves the phone. Unit-tested in tests/categorize.test.mjs.
import { merchantKey, merchantRuleMatches } from "./state-model.js?v=1.1.89";

// Words that place a branch, not the business: from the first of these on, the name is
// an address ("CARULLA CALLE 63", "TERPEL AV BOYACA").
const ADDRESS_WORDS = new Set([
  "calle", "cl", "cll", "carrera", "cra", "cr", "kr", "kra", "avenida", "av", "ak", "ac", "diagonal", "dg",
  "transversal", "tv", "autopista", "km", "sede", "local", "sucursal", "cc", "centro", "no"
]);
// Company-form and city words that say nothing about what was bought.
const NOISE_WORDS = new Set([
  "sas", "s", "a", "sa", "ltda", "limitada", "inc", "cia", "y", "co", "col", "colombia", "de", "la", "el", "los", "las",
  "bogota", "medellin", "cali", "barranquilla", "cartagena", "bucaramanga", "pereira", "manizales", "chia", "ibague"
]);

// "DROGUERIA ALEMANA 67 C" -> "drogueria alemana"; "EXITO 93" -> "exito"; "D1 SAS" -> "d1".
export function merchantBrand(name) {
  const words = merchantKey(name).split(" ").filter(Boolean);
  const kept = [];
  for (const word of words) {
    if (ADDRESS_WORDS.has(word) && kept.length) break;
    if (/^\d+$/.test(word) || word.length === 1 || NOISE_WORDS.has(word)) continue;
    kept.push(word);
  }
  return kept.join(" ");
}

// Kinds of expense, each with the words that reveal it in a merchant name. A word ending
// in "*" is a stem ("droguer*" covers droguería, droguerías). Kept to names that mean the
// same thing for everyone: "Rappi" (food or groceries?) or "Tienda" are left out on
// purpose.
const MERCHANT_INTENTS = {
  combustible: ["terpel", "primax", "texaco", "biomax", "mobil", "esso", "petrobras", "zeuss", "gasolin*", "eds", "tanque*", "acpm"],
  mercado: [
    "exito", "carulla", "d1", "ara", "olimpica", "jumbo", "makro", "pricesmart", "surtimax", "isimo",
    "supermercad*", "mercado", "minimercad*", "fruver", "justo y bueno", "super inter", "la 14", "megatiendas"
  ],
  salud: ["droguer*", "farmac*", "cruz verde", "farmatodo", "la rebaja", "pasteur", "locatel", "clinica", "hospital", "laboratorio", "odontolog*", "optica"],
  transporte: ["uber", "didi", "cabify", "indriver", "indrive", "taxi", "transmilenio", "sitp", "peaje*", "parqueader*", "parking", "tullave"],
  comida: [
    "restaurant*", "pizza*", "burger*", "hamburgues*", "mcdonalds", "kfc", "frisby", "el corral", "crepes", "juan valdez",
    "starbucks", "tostao", "oma", "dominos", "subway", "panader*", "asadero", "corrientazo"
  ],
  suscripciones: ["netflix", "spotify", "disney", "hbo", "prime video", "youtube premium", "icloud", "google one", "chatgpt", "openai", "claude", "anthropic", "crunchyroll", "deezer"],
  servicios: ["enel", "codensa", "epm", "vanti", "acueducto", "claro", "movistar", "tigo", "wom", "etb", "emcali", "gases del caribe"],
  vehiculo: ["despinch*", "montallant*", "llanta*", "taller", "lavadero", "lubric*", "repuesto*", "tecnomecanic*"],
  cuidado: ["peluquer*", "peluqueada", "barberia", "barber", "spa", "manicure"]
};

// The words a user would put in the NAME of a category for each kind, best first. Each
// inner list is tried in order; the first one that matches exactly one category wins.
// Two categories matching the same list is a tie, and a tie is no answer.
const CATEGORY_SYNONYMS = {
  combustible: [["gasolin*", "combustibl*", "tanque*", "acpm"], ["transporte*", "movilidad"]],
  mercado: [["mercado*", "supermercad*", "despensa", "viveres"], ["comida*", "alimenta*"]],
  salud: [["salud", "droguer*", "farmac*", "medic*", "remedio*"]],
  transporte: [["transporte*", "movilidad", "pasaje*", "taxi*", "bus*", "uber"]],
  comida: [["restaurant*", "salida*", "domicilio*", "almuerzo*", "comida*", "corrientazo*"], ["alimenta*"]],
  suscripciones: [["suscripcion*", "streaming", "plataforma*", "apps", "aplicacion*"]],
  servicios: [["servicio*", "recibo*", "factura*", "luz", "agua", "gas", "internet", "celular", "plan"]],
  // Not "moto"/"carro": a category like "Revisión moto" is for one specific thing.
  vehiculo: [["mantenimiento*", "taller*", "repuesto*", "vehiculo*"]],
  cuidado: [["cuidado*", "peluquer*", "belleza", "personal"]]
};

// Whole-word match of a list of words/stems/phrases against normalized text.
function matchesAny(text, words) {
  const padded = ` ${text} `;
  return words.some((word) => {
    if (word.endsWith("*")) {
      const stem = word.slice(0, -1);
      return padded.includes(` ${stem}`);
    }
    return padded.includes(` ${word} `);
  });
}

// The kind of expense a merchant name reveals, or "" when it reveals none or more than
// one ("Exito Droguería" stays ""). Uses the full name, not only the brand, so a word
// after the brand ("EDS TERPEL", "Parqueadero Unicentro") still counts.
export function merchantIntent(name) {
  const text = merchantKey(name);
  if (!text) return "";
  const found = Object.keys(MERCHANT_INTENTS).filter((intent) => matchesAny(text, MERCHANT_INTENTS[intent]));
  return found.length === 1 ? found[0] : "";
}

// The kind of expense a category is for, judged from its name: "Gasolina" -> combustible.
// Only the first, most specific synonym list of each kind counts here, so "Moto" is not
// read as a single kind. Also drives the category's icon.
export function categoryIntent(name) {
  const text = merchantKey(name);
  if (!text) return "";
  const found = Object.keys(CATEGORY_SYNONYMS).filter((intent) => matchesAny(text, CATEGORY_SYNONYMS[intent][0]));
  return found.length === 1 ? found[0] : "";
}

function categoryForIntent(intent, categories) {
  for (const synonyms of CATEGORY_SYNONYMS[intent] || []) {
    const matches = categories.filter((category) => matchesAny(merchantKey(category.name), synonyms));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }
  return null;
}

// rules: the user's merchant rules ({ key, merchant, category, source, count }).
// categories: the user's categories ({ id, name }); only these can be suggested.
// Returns { category, source, via, rule?, intent? } or null. `source` (how it was paid)
// only comes from the user's own habits (layers 1-2); a dictionary knows the place, not
// the card.
export function suggestCategory(merchant, { rules = [], categories = [] } = {}) {
  const key = merchantKey(merchant);
  if (key.length < 3) return null;
  const valid = new Set(categories.map((category) => category.id));
  const usable = rules.filter((rule) => valid.has(rule.category) && rule.key);

  const exact = usable.find((rule) => rule.key === key) || usable.find((rule) => merchantRuleMatches(key, rule.key));
  if (exact) {
    return { category: exact.category, source: exact.source || "", via: "rule", rule: exact };
  }

  const brand = merchantBrand(merchant);
  if (brand.length >= 2) {
    const sameBrand = usable.filter((rule) => merchantBrand(rule.merchant || rule.key) === brand);
    const chosen = new Set(sameBrand.map((rule) => rule.category));
    // Branches of one brand filed under different categories: the brand does not decide.
    if (chosen.size === 1) {
      const latest = sameBrand.reduce((best, rule) =>
        String(rule.lastUsedAt || rule.updated_at || "") > String(best.lastUsedAt || best.updated_at || "") ? rule : best
      );
      return { category: latest.category, source: latest.source || "", via: "brand", rule: latest };
    }
    if (chosen.size > 1) return null;
  }

  const intent = merchantIntent(merchant);
  const category = intent ? categoryForIntent(intent, categories) : null;
  return category ? { category: category.id, source: "", via: "dictionary", intent } : null;
}
