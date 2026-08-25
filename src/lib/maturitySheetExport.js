import * as XLSX from "xlsx";
import { AUDIT_ASPECTS } from "../data/auditAspects.js";

const SHEET_NAME = "Matlev 2026 UPT";
const COL_NO = 3;
const COL_PERSEDIAAN = 23; // "Nilai Gudang Persediaan"
const COL_MRWI = 24; // "Nilai Gudang MRWI/ATTB"

const ASPECT_IDS = new Set(AUDIT_ASPECTS.map(a => a.id));

// Template salah ketik koma desimal ID di beberapa baris ("1,2" -> harus "1.2").
// "1.10" sudah benar (disimpan sbg string utk hindari tabrakan dgn "1.1").
function normalizeNo(rawNo) {
  return String(rawNo ?? "").replace(",", ".");
}

// Import dinamis (bukan statis) supaya modul ini tetap bisa di-import polos
// oleh Node (self-check script) tanpa Vite — specifier `?url` cuma perlu
// diresolve saat loadTemplateBytes() benar-benar dipanggil (browser only).
let cachedTemplateBytes = null;
async function loadTemplateBytes() {
  if (cachedTemplateBytes) return cachedTemplateBytes;
  const { default: templateUrl } = await import("../assets/maturity/matlev-template.xlsx?url");
  const res = await fetch(templateUrl);
  cachedTemplateBytes = new Uint8Array(await res.arrayBuffer());
  return cachedTemplateBytes;
}

// Dipisah dari buildMaturitySheet supaya bisa di-unit-test dengan Node biasa
// (tanpa Vite `?url`/fetch) — lihat scripts/check-maturity-sheet-export.mjs.
//
// ponytail: SheetJS community edition kadang membuang sebagian fill/border saat
// write ulang — merge, formula, dan nilai sel tetap aman (yang kita sentuh).
// Kalau warna/border hilang & user protes: upgrade ke zip-patch worksheet XML.
export function buildMaturitySheetFromBytes(bytes, { scoresByAspek = {}, tahun, namaUpt }) {
  // sheetStubs:true wajib — sel formula kategori/total tidak punya cached value
  // (template belum pernah dibuka Excel/Sheets), SheetJS drop cell "kosong" itu
  // (beserta formulanya!) tanpa opsi ini.
  const wb = XLSX.read(bytes, { type: "array", sheetStubs: true });
  const ws = wb.Sheets[SHEET_NAME];
  const range = XLSX.utils.decode_range(ws["!ref"]);

  for (let r = range.s.r; r <= range.e.r; r++) {
    const noCell = ws[XLSX.utils.encode_cell({ r, c: COL_NO })];
    if (!noCell) continue;
    const aspekId = normalizeNo(noCell.v);
    if (!ASPECT_IDS.has(aspekId)) continue; // baris kategori/header, bukan aspek
    const score = scoresByAspek[aspekId];
    if (score == null) continue; // belum dinilai, biarkan nilai template apa adanya

    [COL_PERSEDIAAN, COL_MRWI].forEach(c => {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      // t==="z" = stub kosong buatan sheetStubs (bukan sel asli di template);
      // cell.f = sel formula. Dua-duanya dilewati, hanya sel nilai asli yang ditulis.
      if (!cell || cell.f || cell.t === "z") return;
      ws[addr] = { t: "n", v: score };
    });
  }

  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const filename = `${tahun}_Maturity Level Gudang_UPT_${namaUpt}_`;
  return { base64, filename };
}

export async function buildMaturitySheet(opts) {
  const bytes = await loadTemplateBytes();
  return buildMaturitySheetFromBytes(bytes, opts);
}
