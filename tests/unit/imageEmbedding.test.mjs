import assert from "node:assert/strict";
import test from "node:test";
import { chunkValues, isPermanentCohere429, resolveEffectiveUptId } from "../../scripts/lib/imageEmbedding.mjs";

test("direct stock UPT wins over location fallback", () => {
  assert.equal(resolveEffectiveUptId({ upt_id: "UPT-DIRECT", lokasi_id: "L1" }, new Map(), new Map()), "UPT-DIRECT");
});

test("stock resolves UPT through lokasi then gudang", () => {
  const lokasi = new Map([["L1", { id: "L1", gudang_id: "G1" }]]);
  const gudang = new Map([["G1", { id: "G1", upt_id: "UPT-SBY" }]]);
  assert.equal(resolveEffectiveUptId({ id: "S1", lokasi_id: "L1", data: {} }, lokasi, gudang), "UPT-SBY");
});

test("permanent Cohere quota 429 does not retry", () => {
  assert.equal(isPermanentCohere429({ status: 429, message: "trial key monthly quota exceeded" }), true);
  assert.equal(isPermanentCohere429({ status: 429, message: "rate limit, retry later" }), false);
});

test("existing embedding IDs are chunked beyond the 1000-row API page", () => {
  const ids = Array.from({ length: 1201 }, (_, index) => `spe_${index}`);
  const chunks = chunkValues(ids);
  assert.equal(chunks.length, 25);
  assert.deepEqual(chunks.flat(), ids);
  assert.ok(chunks.at(-1).includes("spe_1200"));
});
