import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/components/DataStokTab.jsx", import.meta.url), "utf8");

test("Gudang mengikuti filter UPT dan reset lokasi turunannya", () => {
  assert.match(source, /\.filter\(g => !stockUptFilter \|\| \(g\.uptId \|\| g\.upt_id\) === stockUptFilter\)/);
  assert.match(source, /setStockUptFilter\(e\.target\.value\);setStockGudangSelect\(""\);setStockBlokSelect\(""\)/);
});

test("filter Gudang tetap memakai daftar akses termasuk GI", () => {
  assert.match(source, /stockVisibleGudangList \|\| visibleGudangList/);
  assert.match(source, /g\.uptId \|\| g\.upt_id/);
});
