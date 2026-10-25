// Turns the text of a bank app's notification (kept on the phone by the Android
// BankNotificationListener) into a movement to confirm: an expense, money that came in,
// or null when it is neither. Pure: unit-tested in tests/bank-notifications.test.mjs.
//
// The reading is deliberately conservative: a notification only becomes a suggestion when
// it has an amount AND clearly says money went out or came in. Anything else (refunds,
// declined payments, promotions, security codes) is not offered, because a wrong
// suggestion costs the user more than a missed one.
//
// Real Nu notifications (October 2026):
//   purchase  title "Compra aprobada por $8.500,00"
//             text  "Compra en DROGUERIA ALEMANA 67 C con tu tarjeta débito terminada en 3965."
//   incoming  title "Recibiste 20.000,00 en tu cuenta"            (no "$")
//             text  "Te llegó dinero de YEFRY ESTEBAN AVILA ZULUAGA con tu llave."
// Other kinds (credit card, outgoing transfers) are still read with the usual Colombian
// banking wording until real samples confirm them. On a debug build, what the listener
// kept can be read with: adb shell run-as com.estbn05.finanzasconductuales cat
// shared_prefs/bank_notifications.xml

export const BANK_NAMES = { "com.nu.production": "Nu" };

const OUTGOING = /\b(compra(ste)?|pag(o|aste|ado)|retir(o|aste)|transferiste|enviaste|debito|cargo)\b/;
// Money that arrived. Refunds and reversals are left out on purpose: whether they return
// to the account or lower a card's debt is not something the text reliably says.
const INCOMING = /\b(recibiste|te (llego|enviaron|transfirieron|pagaron|consignaron))\b/;
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
// digits never do. Returns whole pesos, or 0 when there is no amount.
export function parseAmount(text) {
  const match = String(text || "").match(
    /(?:\$|COP)\s*([\d.]+(?:,\d{1,2})?)|([\d.]+(?:,\d{1,2})?)\s*(?:COP|pesos)\b|(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2})(?![\d.,])/i
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
export function parseOrigin(text) {
  const match = String(text || "").match(/\bde\s+(.+?)(?=\s+(?:con|por|a|al|en|desde|via)\b|[.,;!\n]|\s+\$|$)/i);
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
  if (amount <= 0 || REFUND.test(words) || NOT_A_MOVEMENT.test(words)) {
    return null;
  }
  const base = {
    id: String(notification.id),
    bank: BANK_NAMES[notification.packageName] || "Tu banco",
    amount,
    date: dateKey(notification.postedAt),
    postedAt: Number(notification.postedAt) || 0
  };
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
export function alreadyRecorded(suggestion, { transactions = [], extras = [] } = {}) {
  const name = suggestion.kind === "income" ? suggestion.origin : suggestion.merchant;
  const matches = (item) => {
    if (Number(item.amount) !== suggestion.amount) return false;
    const date = String(item.date || "").slice(0, 10);
    if (date === suggestion.date) return true;
    return daysApart(date, suggestion.date) <= 1 && sameName(suggestion.kind === "income" ? item.source : item.merchant, name);
  };
  return suggestion.kind === "income" ? extras.some(matches) : transactions.some(matches);
}

// A notification this old is not offered any more: it would land in a period that may be
// closed already, and by then the user has either recorded it by hand or let it go.
export const SUGGESTION_MAX_AGE_DAYS = 30;

export function isStale(notification, now = Date.now()) {
  return now - Number(notification?.postedAt || 0) > SUGGESTION_MAX_AGE_DAYS * 86_400_000;
}

// Newest first; recorded and stale ones left out.
export function pendingSuggestions(notifications = [], recorded = {}, now = Date.now()) {
  return notifications
    .filter((notification) => !isStale(notification, now))
    .map(suggestionFromNotification)
    .filter((suggestion) => suggestion && !alreadyRecorded(suggestion, recorded))
    .sort((a, b) => b.postedAt - a.postedAt);
}

// Recent notifications from the bank that are not a movement the app can read: promos,
// codes, or a wording it does not know yet. Shown in Datos so a change in the bank's
// texts does not make the feature stop working in silence.
export function unreadableNotifications(notifications = [], now = Date.now()) {
  return notifications
    .filter((notification) => !isStale(notification, now) && !suggestionFromNotification(notification))
    .sort((a, b) => Number(b.postedAt || 0) - Number(a.postedAt || 0));
}
