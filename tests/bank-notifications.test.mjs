// "Real Nu" cases are copied from notifications Nu sent to the user's phone; the rest are
// typical Colombian banking wording, to be replaced with real samples as they show up.
import assert from "node:assert/strict";
import test from "node:test";
import { alreadyRecorded, parseAmount, parseMerchant, pendingSuggestions, suggestionFromNotification } from "../bank-notifications.js";

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
    { id: undefined, bank: "Nu", amount: 45_000, merchant: "Terpel Calle 80", source: "credit", date: "2026-10-12", postedAt: undefined }
  );
});

test("money out of the account is an expense from the account", () => {
  const suggestion = suggestionFromNotification(notification("Transferencia enviada", "Transferiste $50.000 desde tu cuenta a Juan Pérez."));
  assert.equal(suggestion.amount, 50_000);
  assert.equal(suggestion.source, "account");
  assert.equal(suggestion.merchant, "");
});

test("income, declined payments, codes and promotions are never offered as expenses", () => {
  for (const [title, text] of [
    ["Te llegó plata", "Recibiste $200.000 de Ana en tu cuenta."],
    ["Compra rechazada", "Tu compra por $45.000 en Terpel fue rechazada."],
    ["Código de seguridad", "Tu código es 483920. No lo compartas."],
    ["Oferta", "Paga $0 de cuota de manejo este mes con tu tarjeta"],
    ["Reembolso", "Te devolvimos $12.000 de un pago en Rappi"],
    ["Hola", "Tu extracto ya está disponible."]
  ]) {
    assert.equal(suggestionFromNotification(notification(title, text)), null, `${title}: ${text}`);
  }
});

test("a purchase already recorded by hand that day is not offered again", () => {
  const suggestion = suggestionFromNotification(notification("Compra", "Compraste $45.000 en Terpel"));
  assert.equal(alreadyRecorded(suggestion, [{ amount: 45_000, date: "2026-10-12" }]), true);
  assert.equal(alreadyRecorded(suggestion, [{ amount: 45_000, date: "2026-10-11" }]), false);
  assert.equal(alreadyRecorded(suggestion, [{ amount: 46_000, date: "2026-10-12" }]), false);
});

test("pending suggestions: newest first, without the ones that are not expenses or are already recorded", () => {
  const list = pendingSuggestions(
    [
      notification("Compra", "Compraste $10.000 en Café", at("2026-10-12T08:00:00")),
      notification("Te llegó plata", "Recibiste $5.000", at("2026-10-12T09:00:00")),
      notification("Compra", "Compraste $30.000 en Éxito", at("2026-10-12T10:00:00")),
      notification("Compra", "Compraste $7.000 en Bus", at("2026-10-12T11:00:00"))
    ],
    [{ amount: 7_000, date: "2026-10-12" }]
  );
  assert.deepEqual(
    list.map((item) => item.merchant),
    ["Éxito", "Café"]
  );
});
