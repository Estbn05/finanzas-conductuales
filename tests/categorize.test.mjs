import assert from "node:assert/strict";
import test from "node:test";
import { categoryIntent, merchantBrand, merchantIntent, suggestCategory } from "../categorize.js";

const rule = (merchant, category, extra = {}) => ({
  key: merchant.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(),
  merchant,
  category,
  source: "account",
  ...extra
});

test("the brand drops the branch: address, numbers, company form and city", () => {
  assert.equal(merchantBrand("CARULLA CALLE 63"), "carulla");
  assert.equal(merchantBrand("Carulla Calle 80"), "carulla");
  assert.equal(merchantBrand("DROGUERIA ALEMANA 67 C"), "drogueria alemana");
  assert.equal(merchantBrand("EXITO 93"), "exito");
  assert.equal(merchantBrand("D1 SAS"), "d1", "a brand with a digit keeps it");
  assert.equal(merchantBrand("TERPEL AV BOYACA BOGOTA"), "terpel");
  assert.equal(merchantBrand("Panadería La Calle"), "panaderia", "only an address word after the brand cuts");
  assert.equal(merchantBrand(""), "");
});

test("a merchant's kind comes from well-known names and words, and only when it is unambiguous", () => {
  assert.equal(merchantIntent("EDS TERPEL AV BOYACA"), "combustible");
  assert.equal(merchantIntent("Gasolina"), "combustible");
  assert.equal(merchantIntent("CARULLA CALLE 63"), "mercado");
  assert.equal(merchantIntent("Drogueria Alemana 67 C"), "salud");
  assert.equal(merchantIntent("Parqueadero Unicentro"), "transporte");
  assert.equal(merchantIntent("NETFLIX.COM"), "suscripciones");
  assert.equal(merchantIntent("Exito Droguería"), "", "groceries or pharmacy: no guess");
  assert.equal(merchantIntent("Rappi"), "", "food or groceries: left out on purpose");
  assert.equal(merchantIntent("Paramount"), "", "a stem must start a word: 'para' is not 'parqueadero'");
  assert.equal(merchantIntent("Ana Maria"), "");
});

test("a category's kind is read from its name", () => {
  assert.equal(categoryIntent("Gasolina"), "combustible");
  assert.equal(categoryIntent("Mercado del mes"), "mercado");
  assert.equal(categoryIntent("Salud"), "salud");
  assert.equal(categoryIntent("Revisión moto"), "", "one specific purpose, not a kind");
  assert.equal(categoryIntent("Ahorro"), "");
});

test("layer 1: the user's own choice for the merchant wins over everything else", () => {
  const categories = [{ id: "gas", name: "Gasolina" }, { id: "moto", name: "Moto" }];
  const suggestion = suggestCategory("Terpel Calle 80", { rules: [rule("Terpel Calle 80", "moto", { source: "cash" })], categories });
  assert.deepEqual(
    { category: suggestion.category, source: suggestion.source, via: suggestion.via },
    { category: "moto", source: "cash", via: "rule" },
    "even though the dictionary would say Gasolina"
  );
});

test("layer 2: what the user chose at one branch applies to the others", () => {
  const categories = [{ id: "casa", name: "Casa" }];
  const suggestion = suggestCategory("CARULLA CALLE 63", { rules: [rule("Carulla Calle 80", "casa", { source: "credit" })], categories });
  assert.equal(suggestion.category, "casa");
  assert.equal(suggestion.source, "credit");
  assert.equal(suggestion.via, "brand");
});

test("layer 2: branches filed under different categories leave the brand undecided", () => {
  const categories = [{ id: "casa", name: "Casa" }, { id: "mercado", name: "Mercado" }];
  const rules = [rule("Exito Calle 80", "casa"), rule("Exito Calle 10", "mercado")];
  assert.equal(suggestCategory("EXITO 93", { rules, categories }), null, "not even the dictionary decides then");
});

test("layer 3: a known kind goes to the one category named for it, never to an invented one", () => {
  const categories = [{ id: "ahorro", name: "Ahorro" }, { id: "gas", name: "Gasolina" }, { id: "soat", name: "Soat" }];
  const suggestion = suggestCategory("EDS TERPEL AV BOYACA", { categories });
  assert.deepEqual({ category: suggestion.category, via: suggestion.via, source: suggestion.source }, { category: "gas", via: "dictionary", source: "" });
  assert.equal(suggestCategory("Drogueria Alemana 67 C", { categories }), null, "no health category, no suggestion");
});

test("layer 3: fuel falls back to a transport category when there is no fuel one", () => {
  assert.equal(suggestCategory("Terpel", { categories: [{ id: "tr", name: "Transporte" }] }).category, "tr");
});

test("layer 3: two categories that fit equally is a tie, and a tie is no answer", () => {
  const categories = [{ id: "m1", name: "Mercado" }, { id: "m2", name: "Mercado finca" }];
  assert.equal(suggestCategory("Carulla", { categories }), null);
});

// Typical things people type for money that is not a purchase at a place: nothing to file.
test("no suggestion for loans, people, vague notes or rules whose category no longer exists", () => {
  const categories = [{ id: "gas", name: "Gasolina" }, { id: "mercado", name: "Mercado" }];
  for (const merchant of ["Préstamo a un amigo", "Ana Maria", "No sé de qué", "Regalo", "Gasto", "ab"]) {
    assert.equal(suggestCategory(merchant, { categories }), null, merchant);
  }
  assert.equal(suggestCategory("Terpel", { rules: [rule("Terpel", "borrada")], categories }).via, "dictionary");
});
