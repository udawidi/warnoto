import assert from "node:assert/strict";
import test from "node:test";
import { cachedMasterMedia, compactMasterTables, hasUnwritableMedia, masterMediaRef } from "../../src/lib/masterMedia.js";
import { leanStocksForCache } from "../../src/lib/stockCache.js";

test("the old image field no longer exhausts the stock cache and the editable source stays intact", () => {
  const img = "data:image/jpeg;base64," + "A".repeat(340000);
  const rows = Array.from({ length: 18 }, (_, id) => ({ id: "TEST-" + id, qty: id, img }));
  const cached = leanStocksForCache(rows);
  assert.ok(JSON.stringify(cached).length < 2048);
  assert.equal(rows[0].img, img);
  assert.deepEqual(masterMediaRef(cached[5].img), { table: "stocks", field: "img", id: "TEST-5" });
  assert.ok(hasUnwritableMedia("stocks", cached));
  assert.equal(hasUnwritableMedia("stocks", rows), false);
});

test("compact media survives a reload and is writable only against a compatible server", () => {
  const denahImageData = "wmedia:gudang:denahImageData:" + "c".repeat(32) + ":TEST:G";
  const row = { id: "TEST:G", denahImageData, fotoGudang: "https://example.invalid/photo" };
  assert.equal(cachedMasterMedia("gudang", row), row);
  assert.deepEqual(masterMediaRef(denahImageData), { table: "gudang", field: "denahImageData", id: "TEST:G" });
  assert.equal(masterMediaRef(denahImageData.replace("gudang:", "profiles:")), null);
  assert.equal(masterMediaRef(denahImageData.replace("denahImageData:", "data:")), null);
  assert.ok(hasUnwritableMedia("gudang", [row]));
  compactMasterTables.set("gudang", true);
  try { assert.equal(hasUnwritableMedia("gudang", [row]), false); }
  finally { compactMasterTables.set("gudang", null); }
});
