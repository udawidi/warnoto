// ponytail: smallest runnable check for the pure map/classify/range logic behind
// push-kapasitas. No network, no framework — assert-based, run with
// `node scripts/check-push-kapasitas-map.mjs`.
import { buildKey, buildRowMap, classifyRows, buildUpdateOps, buildInsertRow } from "../supabase/functions/push-kapasitas/mapping.mjs";
import assert from "node:assert/strict";

// Mock grid = values API `{title}!A:C` response.values (1 header row + 2 data rows).
const grid = [
  ["UPT", "GUDANG", "SUB GUDANG"],
  ["SURABAYA", "Gudang Waru", "Sub A"],
  ["MALANG", "Gudang Kedungkandang", "Sub B"],
];
const rowMap = buildRowMap(grid);

assert.equal(rowMap.size, 2, "header row should be skipped");
assert.equal(rowMap.get(buildKey("SURABAYA", "Gudang Waru", "Sub A")), 2);
assert.equal(rowMap.get(buildKey("MALANG", "Gudang Kedungkandang", "Sub B")), 3);
// Normalization: extra spaces / lowercase must still match the same key.
assert.equal(buildKey("surabaya", "  Gudang   Waru ", "sub a"), buildKey("SURABAYA", "Gudang Waru", "Sub A"));

const matchedItem = {
  upt: "SURABAYA", gudang: "Gudang Waru", sub_gudang: "Sub A",
  luas_lahan_m2: 1000, luas_terpakai_m2: 400, sisa_luas_m2: 600, persentase_terpakai: 0.4,
  persediaan_pct: 0.2, cadang_pct: 0.1, pre_memory_pct: 0.05, attb_pct: 0.03, lainnya_pct: 0.02,
};
// Baris baru: key tak ada di sheet sama sekali (UPT baru).
const newItem = {
  upt: "BALI", gudang: "Gudang Denpasar", sub_gudang: "Sub Baru",
  type_gudang: "Terbuka", alamat: "Jl. Contoh", latitude: -8.6, longitude: 115.2,
  luas_lahan_m2: 500, luas_terpakai_m2: 100, sisa_luas_m2: 400, persentase_terpakai: 0.2,
  persediaan_pct: 0.1, cadang_pct: 0.05, pre_memory_pct: 0, attb_pct: 0, lainnya_pct: 0.05,
  contact_person: "Budi", keterangan: "", link_gudang: "",
};

const { updates, inserts } = classifyRows([matchedItem, newItem], rowMap);
assert.equal(updates.length, 1, "matched row must classify as update");
assert.equal(inserts.length, 1, "unmatched row must classify as INSERT, not skip");
assert.equal(updates[0].rowIndex, 2);

const [capOp, waktuOp] = buildUpdateOps("Kapasitas", updates[0].rowIndex, matchedItem, "01/01/2026 10:00");
assert.equal(capOp.range, "Kapasitas!H2:P2");
assert.deepEqual(capOp.values, [[1000, 400, 600, 0.4, 0.2, 0.1, 0.05, 0.03, 0.02]]);
assert.equal(waktuOp.range, "Kapasitas!S2");
assert.deepEqual(waktuOp.values, [["01/01/2026 10:00"]]);

const insertRow = buildInsertRow(newItem, "01/01/2026 10:00");
assert.equal(insertRow.length, 24, "insert row must cover A..X (24 columns)");
assert.deepEqual(
  [insertRow[0], insertRow[1], insertRow[2]],
  ["BALI", "Gudang Denpasar", "Sub Baru"],
);
assert.deepEqual(insertRow.slice(7, 16), [500, 100, 400, 0.2, 0.1, 0.05, 0, 0, 0.05]); // H..P
assert.equal(insertRow[16], "", "Q unused column must stay blank, not garbage");
assert.equal(insertRow[17], "Budi");                // R contact_person
assert.equal(insertRow[18], "01/01/2026 10:00");    // S waktu_update
assert.deepEqual(insertRow.slice(19, 23), ["", "", "", ""]); // T (keterangan kosong) + U,V,W unused
assert.equal(insertRow[23], "");                    // X link_gudang kosong

console.log("check-push-kapasitas-map: OK");
