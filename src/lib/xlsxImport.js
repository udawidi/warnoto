// Guard bersama untuk semua titik import XLSX di app — batas ukuran file
// (cegah tab hang/crash dari file raksasa) + sanitasi ringan sel hasil
// sheet_to_json (control char, sel raksasa). Dipakai di semua komponen yang
// baca file .xlsx user (AttbTab, ImportLokasiModal, KapasitasGudangImportTab,
// MaterialCadangTab, MigrasiDataTab).
import * as XLSX from "xlsx";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB

// Cek ukuran SEBELUM baca ke ArrayBuffer (hemat memori kalau file kegedean).
export async function readXlsxArrayBufferSafe(file) {
  if (file.size > MAX_BYTES) {
    throw new Error("File terlalu besar (maks 15MB). Pecah atau ringkas dulu.");
  }
  return file.arrayBuffer();
}

// Baca workbook lengkap (arrayBuffer + XLSX.read) dengan guard ukuran.
// readOpts di-pass-through ke XLSX.read supaya tiap pemanggil tetap bisa
// kirim opsi yang dibutuhkan (cellDates, cellStyles, sheets, bookSheets, dst).
export async function readWorkbookSafe(file, { readOpts } = {}) {
  const buf = await readXlsxArrayBufferSafe(file);
  const wb = XLSX.read(buf, { type: "array", ...readOpts });
  if (!wb.SheetNames.length) throw new Error("File tidak punya sheet");
  return wb;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const MAX_CELL_LEN = 5000;

export function sanitizeCell(v) {
  if (typeof v !== "string") return v;
  return v.trim().replace(CONTROL_CHARS, "").slice(0, MAX_CELL_LEN);
}

// Terapkan sanitizeCell ke tiap nilai baris hasil sheet_to_json — support baik
// bentuk objek ({kolom: nilai}, default sheet_to_json) maupun array (header:1).
export function sanitizeRows(rows) {
  return rows.map(row => {
    if (Array.isArray(row)) return row.map(sanitizeCell);
    if (row && typeof row === "object") {
      const out = {};
      for (const k in row) out[k] = sanitizeCell(row[k]);
      return out;
    }
    return sanitizeCell(row);
  });
}
