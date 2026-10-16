// Turns the text of a bank app's notification (kept on the phone by the Android
// BankNotificationListener) into an expense to confirm, or null when it is not one.
// Pure: unit-tested in tests/bank-notifications.test.mjs.
//
// The reading is deliberately conservative: a notification only becomes a suggestion when
// it has an amount AND says money went out. Anything else (income, promotions, security
// alerts) is not offered, because a wrong suggestion costs the user more than a missed one.
//
// Real Nu purchase notifications (October 2026) look like:
//   title "Compra aprobada por $8.500,00"
//   text  "Compra en DROGUERIA ALEMANA 67 C con tu tarjeta débito terminada en 3965."
// Other kinds (credit card, transfers, income) are still read with the usual Colombian
// banking wording until real samples confirm them. On a debug build, what the listener
// kept can be read with: adb shell run-as com.estbn05.finanzasconductuales cat
// shared_prefs/bank_notifications.xml

export const BANK_NAMES = { "com.nu.production": "Nu" };

const OUTGOING = /\b(compra(ste)?|pag(o|aste|ado)|retir(o|aste)|transferiste|enviaste|debito|cargo)\b/;
const INCOMING = /\b(recibiste|te (enviaron|transfirieron|pagaron)|abono|deposito|reembolso|devolucion|llego|ingreso)\b/;
const NOT_A_MOVEMENT = /\b(rechazad[ao]|declinad[ao]|fallid[ao]|no (pudimos|fue posible|se pudo)|codigo|clave|oferta|promo)/;

function plain(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Colombian format: "." between thousands and "," before cents ($45.000, $ 45.000,50,
// COP 1.250.000). Returns whole pesos, or 0 when there is no amount.
export function parseAmount(text) {
  const match = String(text || "").match(/(?:\$|COP)\s*([\d.]+(?:,\d{1,2})?)|([\d.]+(?:,\d{1,2})?)\s*(?:COP|pesos)\b/i);
  if (!match) {
    return 0;
  }
  const [whole, cents = "0"] = (match[1] || match[2]).split(",");
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(whole)) {
    return 0;
  }
  return Math.round(Number(whole.replace(/\./g, "")) + Number(`0.${cents}`));
}

function titleCase(name) {
  // Banks shout merchant names ("TERPEL CALLE 80"); keep the user's screen calm.
  if (name !== name.toUpperCase()) {
    return name;
  }
  return name.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, gap, letter) => `${gap}${letter.toUpperCase()}`);
}

// "... $45.000 en TERPEL CALLE 80. ..." -> "Terpel Calle 80".
export function parseMerchant(text) {
  const match = String(text || "").match(/\ben\s+(.+?)(?=\s+(?:con|por|el|desde|a las|via)\b|[.,;!\n]|\s+\$|$)/i);
  const name = match ? match[1].trim().replace(/\s+/g, " ") : "";
  if (!name || /^\$|^\d/.test(name) || /^(tu|su|la|el)\b/i.test(name)) {
    return "";
  }
  return titleCase(name).slice(0, 42);
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
  if (amount <= 0 || !OUTGOING.test(words) || INCOMING.test(words) || NOT_A_MOVEMENT.test(words)) {
    return null;
  }
  return {
    id: String(notification.id),
    bank: BANK_NAMES[notification.packageName] || "Tu banco",
    amount,
    merchant: parseMerchant(notification.text) || parseMerchant(notification.title),
    source: parseSource(text),
    date: dateKey(notification.postedAt),
    postedAt: Number(notification.postedAt) || 0
  };
}

// Recorded by hand already (same amount, same day): do not offer it again.
export function alreadyRecorded(suggestion, transactions = []) {
  return transactions.some(
    (transaction) =>
      Number(transaction.amount) === suggestion.amount && String(transaction.date || "").slice(0, 10) === suggestion.date
  );
}

// Newest first; recorded ones left out.
export function pendingSuggestions(notifications = [], transactions = []) {
  return notifications
    .map(suggestionFromNotification)
    .filter((suggestion) => suggestion && !alreadyRecorded(suggestion, transactions))
    .sort((a, b) => b.postedAt - a.postedAt);
}
