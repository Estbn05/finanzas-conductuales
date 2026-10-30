// "Real Nu" cases are copied from notifications Nu sent to the user's phone; the rest are
// typical Colombian banking wording, to be replaced with real samples as they show up.
import assert from "node:assert/strict";
import test from "node:test";
import { alreadyRecorded, isStale, looksLikeEarlyPay, looksLikePay, parseAmount, unreadableNotifications, parseMerchant, parseOrigin, pendingSuggestions, suggestionFromNotification } from "../bank-notifications.js";

const NU = "com.nu.production";
const at = (iso) => new Date(iso).getTime();

function notification(title, text, postedAt = at("2026-10-12T15:30:00")) {
  return { id: `${NU}:${postedAt}:x`, packageName: NU, title, text, postedAt };
}

test("amounts in Colombian format become whole pesos", () => {
  assert.equal(parseAmount("Compraste $45.000 en Terpel"), 45_000);
  assert.equal(parseAmount("por $ 1.250.000,00"), 1_250_000);
  assert.equal(parseAmount("valor $8.900,50"), 8_901);
  assert.equal(parseAmount("COP 12.000"), 12_000);
  assert.equal(parseAmount("12.000 COP"), 12_000);
  assert.equal(parseAmount("$3500"), 3_500);
  assert.equal(parseAmount("Tu código es 483920"), 0, "a number without a currency is not an amount");
  assert.equal(parseAmount(""), 0);
});

// Real Nu: money that arrives is written without "$".
test("a bare amount counts only with both separators, as Nu writes money that arrived", () => {
  assert.equal(parseAmount("Recibiste 20.000,00 en tu cuenta"), 20_000);
  assert.equal(parseAmount("Bancolombia te envió 2.059.928,00."), 2_059_928, "the sentence's final period");
  assert.equal(parseAmount("Recibiste 1.250.000,50 en tu cuenta"), 1_250_001);
  assert.equal(parseAmount("tarjeta terminada en 3965"), 0);
  assert.equal(parseAmount("el 12.10.2026"), 0, "a date is not an amount");
  assert.equal(parseAmount("Tu clave es 4.839"), 0);
});

test("who sent the money is what follows 'de', in calm capitalization", () => {
  assert.equal(parseOrigin("Te llegó dinero de YEFRY ESTEBAN AVILA ZULUAGA con tu llave."), "Yefry Esteban Avila Zuluaga");
  assert.equal(parseOrigin("Recibiste $200.000 de Ana en tu cuenta."), "Ana");
  assert.equal(parseOrigin("Recibiste dinero"), "");
});

test("the merchant is what follows 'en', in calm capitalization", () => {
  assert.equal(parseMerchant("Compraste $45.000 en TERPEL CALLE 80."), "Terpel Calle 80");
  assert.equal(parseMerchant("Pagaste $20.000 con tu tarjeta en Rappi el 12 de octubre"), "Rappi");
  assert.equal(parseMerchant("Compra por $9.000 en D1 SAS, aprobada"), "D1 Sas");
  assert.equal(parseMerchant("Compraste $9.000 en tu tarjeta"), "", "'en tu tarjeta' is not a merchant");
  assert.equal(parseMerchant("Transferiste $50.000 a Juan"), "");
});

test("real Nu: a debit card purchase is an expense from the account, with its merchant", () => {
  for (const [title, text, amount, merchant] of [
    ["Compra aprobada por $8.500,00", "Compra en DROGUERIA ALEMANA 67 C con tu tarjeta débito terminada en 3965.", 8_500, "Drogueria Alemana 67 C"],
    ["Compra aprobada por $21.040,00", "Compra en CARULLA CALLE 63 con tu tarjeta débito terminada en 3965.", 21_040, "Carulla Calle 63"]
  ]) {
    const suggestion = suggestionFromNotification(notification(title, text));
    assert.equal(suggestion.amount, amount);
    assert.equal(suggestion.merchant, merchant);
    assert.equal(suggestion.source, "account", "a debit card spends from the account, it leaves nothing owed");
    assert.equal(suggestion.bank, "Nu");
  }
});

test("a bare 'tarjeta' does not say credit or debit, so the payment method is left to the user", () => {
  assert.equal(suggestionFromNotification(notification("Compra", "Compraste $9.000 con tu tarjeta en Rappi")).source, "");
});

test("a card purchase becomes an expense to confirm, with its date, card and merchant", () => {
  const suggestion = suggestionFromNotification(
    notification("Compra aprobada", "Compraste $45.000 con tu tarjeta de crédito en TERPEL CALLE 80.")
  );
  assert.deepEqual(
    { ...suggestion, id: undefined, postedAt: undefined },
    { id: undefined, kind: "expense", bank: "Nu", amount: 45_000, merchant: "Terpel Calle 80", source: "credit", date: "2026-10-12", postedAt: undefined }
  );
});

test("money out of the account is an expense from the account", () => {
  const suggestion = suggestionFromNotification(notification("Transferencia enviada", "Transferiste $50.000 desde tu cuenta a Juan Pérez."));
  assert.equal(suggestion.amount, 50_000);
  assert.equal(suggestion.source, "account");
  assert.equal(suggestion.merchant, "");
});

// Real Nu: money arriving from Nequi through a Bre-B key. For the app the account is only
// Nu, so even the user's own transfer is new money in it, and is offered as income.
test("money that arrives is offered as income to the account, with who sent it", () => {
  const suggestion = suggestionFromNotification(
    notification("Recibiste 20.000,00 en tu cuenta", "Te llegó dinero de YEFRY ESTEBAN AVILA ZULUAGA con tu llave.")
  );
  assert.equal(suggestion.kind, "income");
  assert.equal(suggestion.amount, 20_000);
  assert.equal(suggestion.origin, "Yefry Esteban Avila Zuluaga");
  assert.equal(suggestion.location, "account");
  assert.equal(suggestion.date, "2026-10-12");

  const other = suggestionFromNotification(notification("Te llegó plata", "Recibiste un pago de $200.000 de Ana en tu cuenta."));
  assert.equal(other.kind, "income", "'pago' inside a 'recibiste' is still money coming in");
});

// Real Nu, October 2026: the pay, sent from the employer's bank, titled just "Nu".
test("money another bank sent ('Bancolombia te envió') is income from that bank", () => {
  const pay = suggestionFromNotification(notification("Nu", "Bancolombia te envió 2.059.928,00."));
  assert.equal(pay.kind, "income");
  assert.equal(pay.amount, 2_059_928);
  assert.equal(pay.origin, "Bancolombia");

  const sent = suggestionFromNotification(notification("Enviaste $80.000,00", "Le enviaste a HEY***** ALE******** en su cuenta de Bancolombia."));
  assert.equal(sent.kind, "expense", "'enviaste' is money out, not 'te envió'");
  assert.equal(sent.amount, 80_000);
  assert.equal(sent.source, "account");
});

test("refunds, declined payments, codes and promotions are never offered", () => {
  for (const [title, text] of [
    ["Compra rechazada", "Tu compra por $45.000 en Terpel fue rechazada."],
    ["Código de seguridad", "Tu código es 483920. No lo compartas."],
    ["Oferta", "Paga $0 de cuota de manejo este mes con tu tarjeta"],
    ["Reembolso", "Te devolvimos $12.000 de un pago en Rappi"],
    ["Hola", "Tu extracto ya está disponible."]
  ]) {
    assert.equal(suggestionFromNotification(notification(title, text)), null, `${title}: ${text}`);
  }
});

test("a movement already recorded by hand that day is not offered again, expenses and income apart", () => {
  const purchase = suggestionFromNotification(notification("Compra", "Compraste $45.000 en Terpel"));
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 45_000, date: "2026-10-12" }] }), true);
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 45_000, date: "2026-10-11" }] }), false);
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 46_000, date: "2026-10-12" }] }), false);
  assert.equal(alreadyRecorded(purchase, { extras: [{ amount: 45_000, date: "2026-10-12" }] }), false, "income of the same amount is not this expense");

  const arrived = suggestionFromNotification(notification("Recibiste 20.000,00 en tu cuenta", "Te llegó dinero de Ana."));
  assert.equal(alreadyRecorded(arrived, { extras: [{ amount: 20_000, date: "2026-10-12" }] }), true);
  assert.equal(alreadyRecorded(arrived, { transactions: [{ amount: 20_000, date: "2026-10-12" }] }), false);
});

test("pending suggestions: newest first, without the ones already recorded", () => {
  const list = pendingSuggestions(
    [
      notification("Compra", "Compraste $10.000 en Café", at("2026-10-12T08:00:00")),
      notification("Te llegó plata", "Recibiste $5.000 de Ana", at("2026-10-12T09:00:00")),
      notification("Compra", "Compraste $30.000 en Éxito", at("2026-10-12T10:00:00")),
      notification("Compra", "Compraste $7.000 en Bus", at("2026-10-12T11:00:00")),
      notification("Hola", "Tu extracto ya está disponible.", at("2026-10-12T12:00:00"))
    ],
    { transactions: [{ amount: 7_000, date: "2026-10-12" }] }
  );
  assert.deepEqual(
    list.map((item) => item.merchant || item.origin),
    ["Éxito", "Ana", "Café"]
  );
});

test("a purchase noted by hand the day before or after counts as recorded only when the name matches", () => {
  const purchase = suggestionFromNotification(notification("Compra aprobada por $45.000,00", "Compra en TERPEL CALLE 80 con tu tarjeta débito."));
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 45_000, date: "2026-10-11", merchant: "Terpel" }] }), true, "11:50 p.m. by hand, 12:05 a.m. from Nu");
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 45_000, date: "2026-10-13", merchant: "terpel calle 80" }] }), true);
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 45_000, date: "2026-10-11", merchant: "Peaje" }] }), false, "same amount at another place is another purchase");
  assert.equal(alreadyRecorded(purchase, { transactions: [{ amount: 45_000, date: "2026-10-10", merchant: "Terpel" }] }), false, "two days apart is another purchase");
});

test("notifications older than 30 days are not offered any more", () => {
  const now = at("2026-11-20T10:00:00");
  const old = notification("Compra", "Compraste $10.000 en Café", at("2026-10-12T15:30:00"));
  const recent = notification("Compra", "Compraste $12.000 en Bus", at("2026-11-19T08:00:00"));
  assert.equal(isStale(old, now), true);
  assert.equal(isStale(recent, now), false);
  assert.deepEqual(pendingSuggestions([old, recent], {}, now).map((item) => item.merchant), ["Bus"]);
});

test("recent bank notifications the app cannot read are listed, newest first, without the stale ones", () => {
  const now = at("2026-10-20T10:00:00");
  const promo = notification("Oferta", "Paga $0 de cuota este mes", at("2026-10-18T10:00:00"));
  const code = notification("Código", "Tu código es 483920", at("2026-10-19T10:00:00"));
  const purchase = notification("Compra", "Compraste $10.000 en Café", at("2026-10-19T11:00:00"));
  const oldPromo = notification("Oferta", "Promo vieja", at("2026-08-01T10:00:00"));
  assert.deepEqual(unreadableNotifications([promo, code, purchase, oldPromo], now).map((item) => item.title), ["Código", "Oferta"]);
});

test("a big income inside the pay period looks like the pay; small ones or other periods do not", () => {
  const october = { start: "2026-10-01", end: "2026-11-01" };
  const pay = suggestionFromNotification(notification("Recibiste 2.068.000,00 en tu cuenta", "Te llegó dinero de EMPRESA SAS."));
  assert.equal(looksLikePay(pay, { usualPay: 1_500_000, window: october }), true, "more than usual still is the pay");
  const smaller = { ...pay, amount: 1_000_000 };
  assert.equal(looksLikePay(smaller, { usualPay: 1_500_000, window: october }), true, "a smaller pay (60%+) too");
  const friend = { ...pay, amount: 60_000 };
  assert.equal(looksLikePay(friend, { usualPay: 1_500_000, window: october }), false);
  assert.equal(looksLikePay(pay, { usualPay: 1_500_000, window: { start: "2026-11-01", end: "2026-12-01" } }), false);
  assert.equal(looksLikePay(pay, { usualPay: 0, window: october }), false, "no fixed pay, nothing to recognize");
  const purchase = suggestionFromNotification(notification("Compra aprobada por $2.000.000,00", "Compra en ALKOSTO con tu tarjeta débito."));
  assert.equal(looksLikePay(purchase, { usualPay: 1_500_000, window: october }), false);
});

// Real case, October 2026: the November pay arrived on October 29, with October's paid.
test("a pay in the last days of the period looks like the next period's, paid early", () => {
  const october = { start: "2026-10-01", end: "2026-11-01" };
  const pay = suggestionFromNotification(notification("Nu", "Bancolombia te envió 2.059.928,00.", at("2026-10-29T15:00:00")));
  assert.equal(looksLikeEarlyPay(pay, { usualPay: 1_500_000, window: october }), true);
  assert.equal(looksLikeEarlyPay({ ...pay, date: "2026-10-25" }, { usualPay: 1_500_000, window: october }), true, "a week early");
  assert.equal(looksLikeEarlyPay({ ...pay, date: "2026-10-20" }, { usualPay: 1_500_000, window: october }), false, "mid-month is not early");
  assert.equal(looksLikeEarlyPay({ ...pay, amount: 60_000 }, { usualPay: 1_500_000, window: october }), false, "a small transfer is no pay");

  const week = { start: "2026-10-26", end: "2026-11-02" };
  assert.equal(looksLikeEarlyPay({ ...pay, date: "2026-10-30" }, { usualPay: 400_000, window: week }), true, "3 days before, paid weekly");
  assert.equal(looksLikeEarlyPay({ ...pay, date: "2026-10-28" }, { usualPay: 400_000, window: week }), false, "4 days is mid-week");
});
