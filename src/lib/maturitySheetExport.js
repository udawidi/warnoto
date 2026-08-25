import * as XLSX from "xlsx";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { AUDIT_ASPECTS } from "../data/auditAspects.js";

const SHEET_NAME = "Matlev 2026 UPT";
const COL_NO = 3;
const COL_PERSEDIAAN = 23; // -> kolom Excel "X"
const COL_MRWI = 24; // -> kolom Excel "Y"

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

// xlsx = zip. Cari entri worksheet utk sheet SHEET_NAME lewat urutan resmi
// workbook.xml -> r:id -> workbook.xml.rels -> target file, JANGAN hardcode
// "sheet1.xml" buta (template bisa berubah urutan sheet-nya).
function resolveSheetEntry(zip) {
  const workbookXml = strFromU8(zip["xl/workbook.xml"]);
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)]
    .map(m => m[0])
    .find(tag => tag.includes(`name="${SHEET_NAME}"`));
  const rId = sheetTag?.match(/r:id="([^"]+)"/)?.[1];
  if (!rId) throw new Error(`Sheet "${SHEET_NAME}" tidak ditemukan di template (workbook.xml).`);

  const relsXml = strFromU8(zip["xl/_rels/workbook.xml.rels"]);
  const relTag = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map(m => m[0])
    .find(tag => tag.includes(`Id="${rId}"`));
  const target = relTag?.match(/Target="([^"]+)"/)?.[1]?.replace(/^\//, "");
  if (!target) throw new Error(`Relationship "${rId}" tidak ditemukan di workbook.xml.rels.`);

  const entryKey = target.startsWith("xl/") ? target : `xl/${target}`;
  if (!zip[entryKey]) throw new Error(`Entri zip "${entryKey}" tidak ditemukan di template.`);
  return entryKey;
}

// Baca-saja (bukan tulis) via SheetJS: memetakan aspekId -> nomor baris
// sheet (1-based), dipakai buat menyasar sel X{row}/Y{row} di XML mentah.
// sheetStubs:true wajib supaya baris kategori/formula tak ikut ke-skip.
function buildAspekRowMap(bytes) {
  const wb = XLSX.read(bytes, { type: "array", sheetStubs: true });
  const ws = wb.Sheets[SHEET_NAME];
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const rowMap = {};
  for (let r = range.s.r; r <= range.e.r; r++) {
    const noCell = ws[XLSX.utils.encode_cell({ r, c: COL_NO })];
    if (!noCell) continue;
    const aspekId = normalizeNo(noCell.v);
    if (!ASPECT_IDS.has(aspekId)) continue; // baris kategori/header, bukan aspek
    rowMap[aspekId] = r + 1; // XLSX r 0-based -> atribut row XML 1-based
  }
  return rowMap;
}

// Patch satu sel `<c r="{ref}"...>` di string XML, pertahankan atribut style
// (s="...") supaya formatting tetap utuh. Regex dibatasi per-sel (non-greedy
// sampai </c> pertama setelah tag buka) supaya tidak lompat ke sel tetangga.
function patchCell(xml, ref, score) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>([\\s\\S]*?)</c>)`);
  const m = xml.match(re);
  if (!m) return xml; // sel tak ada di template, lewati

  const isSelfClosing = m[2] === "/>";
  if (isSelfClosing) return xml; // tanpa <v> = kolom ini tak berlaku utk baris ini
  if (m[3].includes("<f>")) return xml; // sel formula (AVERAGE dst) - jangan disentuh

  const attrs = m[1].replace(/\st="[^"]*"/, ""); // buang t="..." lama, default numeric
  const newTag = `<c r="${ref}"${attrs}><v>${score}</v></c>`;
  return xml.slice(0, m.index) + newTag + xml.slice(m.index + m[0].length);
}

// btoa berlaku di browser & Node (>=18) — chunked supaya tak kena limit argumen
// String.fromCharCode utk file besar (spread/apply per-byte bikin stack overflow).
function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Dipisah dari buildMaturitySheet supaya bisa di-unit-test dengan Node biasa
// (tanpa Vite `?url`/fetch) — lihat scripts/check-maturity-sheet-export.mjs.
//
// Patch langsung XML zip (bukan XLSX.write) supaya styling/fill/border/lebar
// kolom template tetap utuh — SheetJS community edition membuang semua itu
// saat menulis ulang workbook.
export function buildMaturitySheetFromBytes(bytes, { scoresByAspek = {}, tahun, namaUpt }) {
  const zip = unzipSync(bytes);
  const sheetEntry = resolveSheetEntry(zip);
  const rowMap = buildAspekRowMap(bytes);

  let xml = strFromU8(zip[sheetEntry]);
  for (const [aspekId, row] of Object.entries(rowMap)) {
    const score = scoresByAspek[aspekId];
    if (score == null) continue; // belum dinilai, biarkan nilai template apa adanya
    xml = patchCell(xml, `X${row}`, score);
    xml = patchCell(xml, `Y${row}`, score);
  }
  zip[sheetEntry] = strToU8(xml);

  const outBytes = zipSync(zip);
  const base64 = bytesToBase64(outBytes);
  const filename = `${tahun}_Maturity Level Gudang_UPT_${namaUpt}_`;
  return { base64, filename };
}

export async function buildMaturitySheet(opts) {
  const bytes = await loadTemplateBytes();
  return buildMaturitySheetFromBytes(bytes, opts);
}
