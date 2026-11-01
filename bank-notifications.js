// Turns the text of a bank app's notification (kept on the phone by the Android
// BankNotificationListener) into a movement to confirm: an expense, money that came in,
// or null when it is neither. Pure: unit-tested in tests/bank-notifications.test.mjs.
//
// The reading is deliberately conservative: a notification only becomes a suggestion when
// it has an amount AND clearly says money went out, came in, or was given back. Anything
// else (declined payments, promotions, security codes) is not offered, because a wrong
// suggestion costs the user more than a missed one.
//
// Real Nu notifications (October 2026):
//   purchase  title "Compra aprobada por $8.500,00"
//             text  "Compra en DROGUERIA ALEMANA 67 C con tu tarjeta débito terminada en 3965."
//   incoming  title "Recibiste 20.000,00 en tu cuenta"            (no "$")
//             text  "Te llegó dinero de YEFRY ESTEBAN AVILA ZULUAGA con tu llave."
//   from a bank  title "Nu"   text "Bancolombia te envió 2.059.928,00."   (a pay)
//   sent      title "Enviaste $80.000,00"
//             text  "Le enviaste a HEY***** ALE******** en su cuenta de Bancolombia."
//   refund    title "Te hicimos una devolución por $71.900,00"
//             text  "Reversamos esta compra y tu dinero está nuevamente en tu cuenta."
//             (it does not name the store: the purchase is found by its amount)
//   card paid title "¡Bravo! Pagaste tu tarjeta de crédito Nu"
//             text  "Recibimos tu pago por $50.900,00. En un rato podrás verlo en tu app."
//             (not an expense: the purchases were recorded when the card was used)
// Other kinds (credit card) are still read with the usual Colombian
// banking wording until real samples confirm them. On a debug build, what the listener
// kept can be read with: adb shell run-as com.estbn05.finanzasconductuales cat
// shared_prefs/bank_notifications.xml

export const BANK_NAMES = { "com.nu.production": "Nu" };

const OUTGOING = /\b(compra(ste)?|pag(o|aste|ado)|retir(o|aste)|transferiste|enviaste|debito|cargo)\b/;
// Money that arrived. Refunds are their own kind (REFUND): they undo a purchase.
const INCOMING = /\b(recibiste|te (llego|envio|enviaron|transfirieron|pagaron|consignaron))\b/;
// Paying the credit card. Read before OUTGOING, which "pago"/"pagaste" would match.
const CARD_PAYMENT = /\b(pagaste tu tarjeta|recibimos tu pago|pago (a|de) tu tarjeta|abonaste a tu tarjeta)\b/;
const REFUND = /\b(reembolso|devolucion|devolvimos|reversion|reversamos)\b/;
const NOT_A_MOVEMENT = /\b(rechazad[ao]|declinad[ao]|fallid[ao]|no (pudimos|fue posible|se pudo)|codigo|clave|oferta|promo)/;

function plain(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Colombian format: "." between thousands and "," before cents ($45.000, $ 45.000,50,
// COP 1.250.000). Nu writes money that arrived without a sign ("Recibiste 20.000,00"),
// so a bare number also counts when it has both separators, which a code or a card's last
// digits never do; a sentence's final period after it is fine ("te envió 2.059.928,00.").
// Returns whole pesos, or 0 when there is no amount.
export function parseAmount(text) {
  const match = String(text || "").match(
    /(?:\$|COP)\s*([\d.]+(?:,\d{1,2})?)|([\d.]+(?:,\d{1,2})?)\s*(?:COP|pesos)\b|(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2})(?![\d,]|\.\d)/i
  );
  if (!match) {
    return 0;
  }
  const [whole, cents = "0"] = (match[1] || match[2] || match[3]).split(",");
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(whole)) {
    return 0;
  }
  return Math.round(Number(whole.replace(/\./g, "")) + Number(`0.${cents}`));
}

function titleCase(name) {
  // Banks shout names ("TERPEL CALLE 80"); keep the user's screen calm.
  if (name !== name.toUpperCase()) {
    return name;
  }
  return name.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, gap, letter) => `${gap}${letter.toUpperCase()}`);
}

function cleanName(name, max) {
  const value = String(name || "").trim().replace(/\s+/g, " ");
  if (!value || /^\$|^\d/.test(value) || /^(tu|su|la|el)\b/i.test(value)) {
    return "";
  }
  return titleCase(value).slice(0, max);
}

// "... $45.000 en TERPEL CALLE 80. ..." -> "Terpel Calle 80".
export function parseMerchant(text) {
  const match = String(text || "").match(/\ben\s+(.+?)(?=\s+(?:con|por|el|desde|a las|via)\b|[.,;!\n]|\s+\$|$)/i);
  return cleanName(match?.[1], 42);
}

// "Te llegó dinero de YEFRY ESTEBAN AVILA ZULUAGA con tu llave." -> "Yefry Esteban Avila Zuluaga".
// "Bancolombia te envió 2.059.928,00." -> "Bancolombia".
export function parseOrigin(text) {
  const value = String(text || "");
  const match =
    value.match(/\bde\s+(.+?)(?=\s+(?:con|por|a|al|en|desde|via)\b|[.,;!\n]|\s+\$|$)/i) ||
    value.match(/^\s*(.+?)\s+te\s+envi[oó](?!\p{L})/iu);
  return cleanName(match?.[1], 36);
}

// Where the money came from, only when the notification says it. A debit card spends
// straight from the account ("tarjeta débito" in Nu's purchase notifications); only a
// credit card leaves something owed. A bare "tarjeta" says neither, so it is left blank.
function parseSource(text) {
  const words = plain(text);
  if (/\bdebito\b/.test(words)) return "account";
  if (/\bcredito\b/.test(words)) return "credit";
  if (/\bcuenta\b|\btransferiste\b|\benviaste\b|\bretir/.test(words)) return "account";
  return "";
}

function dateKey(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function suggestionFromNotification(notification) {
  const text = `${notification?.title || ""}\n${notification?.text || ""}`;
  const words = plain(text);
  const amount = parseAmount(text);
  if (amount <= 0 || NOT_A_MOVEMENT.test(words)) {
    return null;
  }
  const base = {
    id: String(notification.id),
    bank: BANK_NAMES[notification.packageName] || "Tu banco",
    amount,
    date: dateKey(notification.postedAt),
    postedAt: Number(notification.postedAt) || 0
  };
  if (CARD_PAYMENT.test(words)) {
    return { ...base, kind: "card-payment", source: "account" };
  }
  if (REFUND.test(words)) {
    return { ...base, kind: "refund", source: parseSource(text) };
  }
  if (INCOMING.test(words)) {
    // Money only lands in the account: a bank does not deposit into the user's cash.
    return { ...base, kind: "income", origin: parseOrigin(notification.text) || parseOrigin(notification.title), location: "account" };
  }
  if (OUTGOING.test(words)) {
    return {
      ...base,
      kind: "expense",
      merchant: parseMerchant(notification.text) || parseMerchant(notification.title),
      source: parseSource(text)
    };
  }
  return null;
}

// Money in that is probably the fixed pay: within this pay period and at least 60% of the
// usual pay (a pay that came smaller than usual still qualifies; a $60.000 transfer from a
// friend does not). Only a guess: the user confirms "¿Es tu sueldo?" before it counts.
export function looksLikePay(suggestion, { usualPay = 0, window } = {}) {
  return (
    suggestion?.kind === "income" &&
    usualPay > 0 &&
    suggestion.amount >= usualPay * 0.6 &&
    Boolean(window) &&
    suggestion.date >= window.start &&
    suggestion.date < window.end
  );
}

// Employers pay early before a weekend or a holiday: a pay in the last days of a period
// whose own pay is settled is probably the NEXT period's. Up to a week early, or half the
// period for short ones (3 days when paid weekly).
export const EARLY_PAY_DAYS = 7;

export function looksLikeEarlyPay(suggestion, { usualPay = 0, window } = {}) {
  if (!looksLikePay(suggestion, { usualPay, window })) {
    return false;
  }
  const lead = Math.min(EARLY_PAY_DAYS, Math.floor(daysApart(window.start, window.end) / 2));
  return daysApart(suggestion.date, window.end) <= lead;
}

function daysApart(a, b) {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
}

function sameName(a, b) {
  const key = (value) => plain(value).replace(/[^a-z0-9]+/g, " ").trim();
  const left = key(a);
  const right = key(b);
  return Boolean(left && right) && (` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `));
}

// Recorded by hand already: same amount and direction on the same day, or on the day
// before/after when the name also matches (noted at 11:50 p.m., notified at 12:05 a.m.).
// The name is required across days so a $3.000 bus ride on two days in a row stays two.
export function alreadyRecorded(suggestion, { transactions = [], extras = [], creditPayments = [] } = {}) {
  if (suggestion.kind === "card-payment") {
    return creditPayments.some((item) => Number(item.amount) === suggestion.amount && daysApart(String(item.date || "").slice(0, 10), suggestion.date) <= 1);
  }
  const name = suggestion.kind === "income" ? suggestion.origin : suggestion.merchant;
  const matches = (item) => {
    if (Number(item.amount) !== suggestion.amount) return false;
    const date = String(item.date || "").slice(0, 10);
    if (date === suggestion.date) return true;
    return daysApart(date, suggestion.date) <= 1 && sameName(suggestion.kind === "income" ? item.source : item.merchant, name);
  };
  return suggestion.kind === "income" ? extras.some(matches) : transactions.some(matches);
}

// How far back a refund looks for the purchase it gives back.
export const REFUND_LOOKBACK_DAYS = 30;

// A refund undoes a purchase of the same amount made before it (the bank's text does not
// name the store, so the amount is the match; the most recent purchase wins):
// - a purchase the bank notified that is still waiting to be confirmed: both go away, the
//   user never sees either (settled);
// - a purchase already recorded: the refund asks to remove it (transactionId);
// - neither: the refund stays as money that came back, for the user to judge.
// Each purchase is matched by one refund only.
export function matchRefunds(suggestions = [], { transactions = [] } = {}) {
  const settled = [];
  const used = new Set();
  const refunds = suggestions
    .filter((suggestion) => suggestion.kind === "refund")
    .sort((a, b) => a.postedAt - b.postedAt);
  const resolved = new Map();
  const inReach = (refund, date) => date <= refund.date && daysApart(date, refund.date) <= REFUND_LOOKBACK_DAYS;
  for (const refund of refunds) {
    const pending = suggestions
      .filter((item) => item.kind === "expense" && !used.has(item.id) && item.amount === refund.amount && item.postedAt <= refund.postedAt && inReach(refund, item.date))
      .sort((a, b) => b.postedAt - a.postedAt)[0];
    if (pending) {
      used.add(pending.id);
      settled.push(pending.id, refund.id);
      continue;
    }
    const recorded = transactions
      .filter((item) => !used.has(item.id) && Number(item.amount) === refund.amount && inReach(refund, String(item.date || "").slice(0, 10)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
    if (recorded) {
      used.add(recorded.id);
      resolved.set(refund.id, { ...refund, transactionId: recorded.id, merchant: recorded.merchant || "" });
    } else {
      resolved.set(refund.id, { ...refund, transactionId: "" });
    }
  }
  const gone = new Set(settled);
  return {
    suggestions: suggestions.filter((item) => !gone.has(item.id)).map((item) => resolved.get(item.id) || item),
    settled
  };
}

// A notification this old is not offered any more: it would land in a period that may be
// closed already, and by then the user has either recorded it by hand or let it go.
export const SUGGESTION_MAX_AGE_DAYS = 30;

export function isStale(notification, now = Date.now()) {
  return now - Number(notification?.postedAt || 0) > SUGGESTION_MAX_AGE_DAYS * 86_400_000;
}

// Newest first; recorded and stale ones left out, and refunds matched to their purchase
// (matchRefunds). settled: the ids of the purchase+refund pairs that cancelled out, for
// the phone to forget.
export function readSuggestions(notifications = [], recorded = {}, now = Date.now()) {
  const fresh = notifications
    .filter((notification) => !isStale(notification, now))
    .map(suggestionFromNotification)
    .filter((suggestion) => suggestion && (suggestion.kind === "refund" || !alreadyRecorded(suggestion, recorded)));
  const { suggestions, settled } = matchRefunds(fresh, recorded);
  return { suggestions: suggestions.sort((a, b) => b.postedAt - a.postedAt), settled };
}

export function pendingSuggestions(notifications = [], recorded = {}, now = Date.now()) {
  return readSuggestions(notifications, recorded, now).suggestions;
}

// Recent notifications from the bank that are not a movement the app can read: promos,
// codes, or a wording it does not know yet. Shown in Datos so a change in the bank's
// texts does not make the feature stop working in silence.
export function unreadableNotifications(notifications = [], now = Date.now()) {
  return notifications
    .filter((notification) => !isStale(notification, now) && !suggestionFromNotification(notification))
    .sort((a, b) => Number(b.postedAt || 0) - Number(a.postedAt || 0));
}
