import assert from "node:assert/strict";
import test from "node:test";
import { enrichStock } from "../../src/lib/utils.js";

const katalog = [{ id: "K1", jenisBarang: "Cadang", name: "Material" }];

test("ATTB and Bongkaran preserve stock jenisBarang, including legacy rows", () => {
  for (const jenisBarang of ["ATTB", "Bongkaran"]) {
    const row = enrichStock({ katalogId: "K1", jenisBarang }, katalog, []);
    assert.equal(row.jenisBarang, jenisBarang);
  }
});

test("ordinary stock keeps master catalog jenisBarang precedence", () => {
  const row = enrichStock({ katalogId: "K1", jenisBarang: "Persediaan" }, katalog, []);
  assert.equal(row.jenisBarang, "Cadang");
});
