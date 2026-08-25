// Self-check untuk src/lib/maturitySheetExport.js — jalankan: node scripts/check-maturity-sheet-export.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buildMaturitySheetFromBytes } from "../src/lib/maturitySheetExport.js";

const templatePath = fileURLToPath(new URL("../src/assets/maturity/matlev-template.xlsx", import.meta.url));
const bytes = new Uint8Array(readFileSync(templatePath));

const { base64, filename } = buildMaturitySheetFromBytes(bytes, {
  scoresByAspek: { "1.1": 4, "3.4": 3 },
  tahun: 2026,
  namaUpt: "UPT Surabaya",
});

assert.equal(filename, "2026_Maturity Level Gudang_UPT_UPT Surabaya_");

const wb = XLSX.read(base64, { type: "base64", sheetStubs: true });
const ws = wb.Sheets["Matlev 2026 UPT"];
const v = addr => ws[addr]?.v;

// Sel nilai tunggal (1.1 cuma tipe Gudang Persediaan -> col23/X saja)
assert.equal(v("X4"), 4, "1.1 col23 harus terisi skor 4");
assert.notEqual(ws["Y4"]?.t, "n", "1.1 col24 tidak ada di template, jangan dibuat");

// Sel nilai ganda (3.4 -> dua tipe gudang -> col23(X) & col24(Y))
assert.equal(v("X24"), 3, "3.4 col23 harus terisi skor 3");
assert.equal(v("Y24"), 3, "3.4 col24 harus terisi skor sama (3)");

// Aspek tanpa skor (1.2 / row5) dibiarkan apa adanya (nilai awal template = 0)
assert.equal(v("X5"), 0, "1.2 tanpa skor harus tetap nilai template, bukan ditulis ulang");

// Formula kategori/total TIDAK boleh disentuh
assert.equal(ws["X3"]?.f, "AVERAGE(X4:X13)", "formula kategori 1 harus tetap utuh");
assert.equal(ws["X20"]?.f, "AVERAGE(X21:X24)", "formula kategori 3 (col23) harus tetap utuh");
assert.equal(ws["Y20"]?.f, "AVERAGE(Y24:Y27)", "formula kategori 3 (col24) harus tetap utuh");
assert.equal(ws["X42"]?.f, "X41+Y41", "formula grand total harus tetap utuh");

console.log("OK — check-maturity-sheet-export lulus.");
