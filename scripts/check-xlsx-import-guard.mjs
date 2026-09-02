// Self-check untuk src/lib/xlsxImport.js — guard ukuran file + sanitasi sel
// import XLSX (lihat CLAUDE.md "C-level security hardening" 2026-09-02).
import { readWorkbookSafe, sanitizeCell, sanitizeRows } from "../src/lib/xlsxImport.js";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// sanitizeCell: strip control char, cap panjang, biarkan non-string apa adanya
assert(sanitizeCell("abcdef") === "abcdef", "control char harus dibuang");
assert(sanitizeCell("  spasi  ") === "spasi", "harus di-trim");
assert(sanitizeCell("x".repeat(6000)).length === 5000, "harus dicap 5000 char");
assert(sanitizeCell(123) === 123, "angka tidak diubah");
assert(sanitizeCell(null) === null, "null tidak diubah");
assert(sanitizeCell(undefined) === undefined, "undefined tidak diubah");

// sanitizeRows: dukung baris objek maupun array (header:1)
const objRows = sanitizeRows([{ Nama: " Budi ", Qty: 5 }]);
assert(objRows[0].Nama === "Budi", "sanitasi baris objek harus jalan");
assert(objRows[0].Qty === 5, "nilai non-string di baris objek tidak diubah");

const arrRows = sanitizeRows([[" A ", 10]]);
assert(arrRows[0][0] === "A", "sanitasi baris array harus jalan");
assert(arrRows[0][1] === 10, "nilai non-string di baris array tidak diubah");

// readWorkbookSafe: reject kalau file.size > 15MB (mock object, tak perlu file nyata)
const bigFile = { size: 16 * 1024 * 1024, arrayBuffer: async () => { throw new Error("tak boleh sampai sini"); } };
try {
  await readWorkbookSafe(bigFile);
  throw new Error("FAIL: harusnya reject file besar");
} catch (e) {
  assert(/terlalu besar/.test(e.message), "pesan error harus soal ukuran, dapat: " + e.message);
}

console.log("check-xlsx-import-guard: semua assert lolos");
