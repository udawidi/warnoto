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

test("ordinary stock keeps its own jenisBarang over master catalog", () => {
  const row = enrichStock({ katalogId: "K1", jenisBarang: "Persediaan" }, katalog, []);
  assert.equal(row.jenisBarang, "Persediaan");
});

test("stock without jenisBarang falls back to master catalog", () => {
  const row = enrichStock({ katalogId: "K1" }, katalog, []);
  assert.equal(row.jenisBarang, "Cadang");
});

test("stock without jenisBarang or catalog type falls back to Cadang", () => {
  const row = enrichStock({ katalogId: "MISSING" }, katalog, []);
  assert.equal(row.jenisBarang, "Cadang");
});
