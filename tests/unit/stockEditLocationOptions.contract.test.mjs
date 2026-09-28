import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sortBlokOptions } from "../../src/lib/masterSync.js";

const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");
const modals = await readFile(new URL("../../src/components/StockModals.jsx", import.meta.url), "utf8");

test("Stock Edit passes Sub Gudang master into location options", () => {
  assert.match(app, /<StockEditFields[^>]*lokasiList=\{lokasiList\} subGudangList=\{subGudangList\}/);
  assert.match(modals, /Umum \/ Tanpa Sub Gudang/);
  assert.match(modals, /sg\?\.nama \|\| "Umum \/ Tanpa Sub Gudang"/);
  assert.match(modals, /<optgroup key=\{group\.id\} label=\{group\.label\}>/);
});

test("location options reuse natural block sorting", () => {
  assert.deepEqual(sortBlokOptions([{ kode:"A10" }, { kode:"A2" }, { kode:"A1" }]).map(l => l.kode), ["A1", "A2", "A10"]);
  assert.match(modals, /groups\.map[\s\S]*sortBlokOptions/);
  assert.match(modals, /if \(a\[0\] === "__umum__"\) return 1/);
  assert.doesNotMatch(modals, /__label:.*›/);
});
