import test from "node:test";
import assert from "node:assert/strict";
import { rowSapLabel } from "../../src/lib/ragShared.mjs";

test("Pre Memory gets its SAP label", () => {
  assert.equal(rowSapLabel({ jenisBarang: "Pre Memory", sapStatus: "SAP — Persediaan", katalog: "1234567" }), "SAP — Pre Memory");
});

test("explicit Non-SAP wins for Pre Memory", () => {
  assert.equal(rowSapLabel({ jenisBarang: "Pre Memory", sapStatus: "Non-SAP", katalog: "1234567" }), "Non-SAP");
});

test("Persediaan, Cadang, and legacy rows remain unchanged", () => {
  assert.equal(rowSapLabel({ jenisBarang: "Persediaan", katalog: "1234567" }), "SAP — Persediaan");
  assert.equal(rowSapLabel({ jenisBarang: "Cadang", katalog: "1234567890" }), "SAP — Cadang");
  assert.equal(rowSapLabel({ id: "STK-PREMEM-1", katalog: "1234567" }), "Non-SAP");
});
