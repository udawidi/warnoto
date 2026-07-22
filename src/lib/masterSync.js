// Sinkron master-table Supabase (load/sync/seed) + helper Sub Gudang & peta lokasi
// + decode Plus Code alamat. Dipindah dari App.jsx (refactor Fase 3f).
import { supabase } from "../supabaseClient.js";
import { decode as olcDecode, isFull as olcIsFull, recoverNearest as olcRecoverNearest } from "./openLocationCode.js";
import { isDemoMode } from "./demo.js";

// Satpam, Tim Mutu, UIT, UPT, Gudang, Lokasi dulu hanya tersimpan di
// localStorage/CLOUD (per-browser, tidak sinkron antar device/user). Sekarang
// disimpan sebagai baris asli di Supabase: 1 baris = {id, data jsonb, ...kolom
// relasi}. Kolom `data` menyimpan object JS apa adanya (field-nya beragam dan
// berkembang seiring waktu, mis. lokasi punya mapX/mapY/pendingData/jenisArea
// yang tidak semua dipakai di semua baris) — kolom id/relasi/status dipisah
// supaya tetap bisa di-query/relasikan di Supabase Studio, tapi tidak perlu
// mendaftar ulang setiap field yang mungkin ada.
// Blok (Lokasi) bisa diplot koordinatnya lewat 2 denah berbeda: denah Gudang keseluruhan
// (mapX/mapY, terhadap gdg.denahImageData) ATAU denah Sub Gudang (subMapX/subMapY, terhadap
// sg.denahImageData, kalau blok itu di-assign ke sebuah Sub Gudang). Dulu "Lihat di Peta
// Gudang" di Data Stok cuma cek mapX/gdg.denahImageData, jadi blok yang koordinatnya sudah
// diplot lewat denah Sub Gudang tetap dianggap "belum diplot" — bug ditemukan 2026-07-09.
// Singkatan 3 huruf dari nama Sub Gudang, dipakai sebagai tag di depan kode blok supaya
// blok yang namanya sama antar Sub Gudang tetap terbedakan (mis. "Terbuka" vs "Tertutup"
// -> TRB vs TRT). Sengaja pakai huruf pertama + konsonan berikutnya, bukan 3 huruf pertama,
// supaya nama berawalan sama ("Ter...") tidak tabrakan jadi singkatan yang sama.
export function subGudangAbbr(nama) {
  const clean = (nama||"").toUpperCase().replace(/[^A-Z ]/g,"").replace(/\bSUB\b|\bGUDANG\b/g," ").replace(/\s+/g," ").trim();
  const letters = clean.replace(/ /g,"");
  if (!letters) return "";
  const consonants = letters[0] + letters.slice(1).replace(/[AEIOU]/g,"");
  return (consonants.length>=3 ? consonants : letters).slice(0,3);
}

// Peta id Sub Gudang -> kode 3 huruf yang DIJAMIN unik dalam satu Gudang. Kalau dua Sub
// Gudang menghasilkan singkatan sama (mis. dua nama beda tapi konsonannya kebetulan sama),
// yang berikutnya diberi akhiran angka (TRB, TR2, TR3, ...) supaya setiap Sub Gudang punya
// kode masing-masing. Kode manual (sg.kode) kalau diisi dihormati & tetap dijaga uniknya.
export function subGudangKodeMap(subs) {
  const used = new Set();
  const map = {};
  subs.forEach(sg => {
    if (sg.kode?.trim()) { const k = sg.kode.trim().toUpperCase().slice(0,3); map[sg.id] = k; used.add(k); }
  });
  subs.forEach(sg => {
    if (map[sg.id]) return;
    const base = subGudangAbbr(sg.nama) || "SGD";
    let kode = base, n = 1;
    while (used.has(kode)) { n++; kode = (base.slice(0,2) + n).slice(0,3); }
    used.add(kode); map[sg.id] = kode;
  });
  return map;
}

export function getLokasiPetaInfo(lok, gdg, subGudangList) {
  if (!lok) return null;
  if (lok.subGudangId && lok.subMapX != null) {
    const sg = subGudangList.find(s => s.id === lok.subGudangId);
    if (sg?.denahImageData) return { denahImageData: sg.denahImageData, x: lok.subMapX, y: lok.subMapY, subGudang: sg };
  }
  if (gdg?.denahImageData && lok.mapX != null) {
    return { denahImageData: gdg.denahImageData, x: lok.mapX, y: lok.mapY, subGudang: null };
  }
  return null;
}

export const SURABAYA_REF_LAT = -7.2575, SURABAYA_REF_LNG = 112.7521; // titik tengah Surabaya, dipakai sbg referensi decode Plus Code pendek (offline, tanpa API)

// Cari & decode Google Maps Plus Code (cth "MPJG+4JX, Ketintang, Gayungan, Surabaya, East Java 60231")
// dari teks alamat bebas → {lat,lng}. Plus Code pendek di-recover memakai titik tengah Surabaya
// sebagai referensi (akurat selama lokasinya memang di area Surabaya). Tidak butuh internet/API key.
export function extractLatLngFromAddress(text) {
  if (!text) return null;
  const m = (text.match(/[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}/i) || [])[0];
  if (!m) return null;
  try {
    const code = m.toUpperCase();
    const full = olcIsFull(code) ? code : olcRecoverNearest(code, SURABAYA_REF_LAT, SURABAYA_REF_LNG);
    const area = olcDecode(full);
    return { lat: Math.round(area.latitudeCenter*1e6)/1e6, lng: Math.round(area.longitudeCenter*1e6)/1e6 };
  } catch (e) {
    return null;
  }
}

export async function loadMasterTable(table) {
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select("*");
  if (error) { console.error(`loadMasterTable(${table}): ${error.message}`, error); return null; }
  return data.map(row => ({ ...row.data, id: row.id }));
}

// extraCols(item) => kolom tambahan per baris (FK/status) di luar id & data, opsional
export async function syncMasterTable(table, list, extraCols) {
  if (isDemoMode()) return true; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!supabase) return false;
  // Dedupe by id (keep-last) sebelum di-upsert: Postgres upsert().onConflict("id") GAGAL TOTAL
  // (error 21000, "ON CONFLICT DO UPDATE command cannot affect row a second time within one
  // command") kalau ada id yang sama muncul >1 kali dalam satu batch. Item terakhir dalam array
  // dipertahankan karena itu representasi paling baru di state React.
  const dedupedList = [...new Map(list.map(item => [item.id, item])).values()];
  const rows = dedupedList.map(item => ({
    id: item.id,
    data: item,
    created_at: item.createdAt ?? Date.now(),
    ...(extraCols ? extraCols(item) : {}),
  }));
  if (rows.length) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
    if (error) { console.error(`syncMasterTable upsert(${table}): ${error.message}`, error); return false; }
  }
  // PENGAMANAN KRITIS (2026-07-07): kalau `list` yang dikirim KOSONG, JANGAN lanjut ke
  // reconciliation-delete di bawah. Ditemukan lewat bug nyata: state React (mis. opnameList)
  // sempat kosong karena race/stale closure saat submit, ke-pass sebagai [] ke sini — hasilnya
  // SEMUA baris tabel (termasuk sesi Stock Opname 217 item yang sudah lengkap) ikut terhapus,
  // padahal user tidak pernah minta hapus apa pun. Data yang state-nya benar-benar kosong akan
  // gagal keluar dari cabang ini, tapi itu jauh lebih aman daripada menghapus data produksi
  // karena state belum sempat ter-load. Hapus satu sesi tetap aman (deleteOpname dkk.
  // menghasilkan list yang masih berisi N-1 item, bukan kosong, kecuali baris terakhir — kasus
  // itu sengaja dibiarkan tidak terhapus dari Supabase, harus dihapus manual kalau memang perlu).
  if (list.length === 0) return true;
  const { data: existing, error: selErr } = await supabase.from(table).select("id");
  if (selErr) { console.error(`syncMasterTable select(${table}): ${selErr.message}`, selErr); return false; }
  const currentIds = new Set(list.map(i => i.id));
  const toDelete = (existing || []).filter(r => !currentIds.has(r.id)).map(r => r.id);
  if (toDelete.length) {
    const { error: delErr } = await supabase.from(table).delete().in("id", toDelete);
    if (delErr) { console.error(`syncMasterTable delete(${table}): ${delErr.message}`, delErr); return false; }
  }
  return true;
}

// Sync RINGAN: upsert HANYA baris yang diberikan (`rows`), TANPA langkah
// reconciliation-delete. Dipakai untuk kasus "1–beberapa baris SPESIFIK yang jelas
// berubah" (mis. update lokasi 1 item Data Stok) supaya payload yang dikirim cuma
// baris itu saja — bukan seluruh tabel seperti syncMasterTable (yang untuk tabel
// `stocks` bisa ~18.7MB karena beberapa baris menyimpan foto base64 besar di jsonb
// `data`, jadi update 1 baris ikut mengirim ulang semua 200+ baris).
//
// SENGAJA TIDAK melakukan reconciliation-delete: tujuannya bukan mendeteksi/menghapus
// baris yang hilang dari state, cuma menulis baris yang memang berubah. Untuk kasus
// yang BUTUH deteksi baris terhapus (bulk delete/opname), tetap pakai syncMasterTable
// penuh — JANGAN pakai fungsi ini. Karena tidak pernah delete, guard "list kosong"
// di syncMasterTable (PENGAMANAN KRITIS terhadap wipe massal) tidak relevan di sini:
// `rows` kosong cuma berarti tidak ada yang perlu ditulis → return true.
export async function syncMasterTableRows(table, rows, extraCols) {
  if (isDemoMode()) return true; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!supabase) return false;
  if (!rows?.length) return true; // tidak ada baris berubah → tidak ada yang perlu ditulis
  // Dedupe by id (keep-last) — sama seperti syncMasterTable: upsert().onConflict("id")
  // GAGAL (error 21000) kalau id yang sama muncul >1 kali dalam satu batch.
  const dedupedRows = [...new Map(rows.map(item => [item.id, item])).values()];
  const upsertRows = dedupedRows.map(item => ({
    id: item.id,
    data: item,
    created_at: item.createdAt ?? Date.now(),
    ...(extraCols ? extraCols(item) : {}),
  }));
  const { error } = await supabase.from(table).upsert(upsertRows, { onConflict: "id" });
  if (error) { console.error(`syncMasterTableRows upsert(${table}): ${error.message}`, error); return false; }
  return true;
}

// ════════════════════════════════════════════════════════════════════
// KAPASITAS GUDANG — load/sync KHUSUS (tabel warehouse_capacity)
// ────────────────────────────────────────────────────────────────────
// Berbeda dari master lain, tabel `warehouse_capacity` punya SKEMA KOLOM TYPED
// PENUH (upt/gudang/sub_gudang/luas_*_m2/…), BUKAN pola generik {id, data jsonb,
// created_at bigint}. loadMasterTable/syncMasterTable di atas TIDAK bisa dipakai:
// syncMasterTable mengirim {id, data, created_at} — kolom `data` & `created_at`
// tidak ada di tabel ini, jadi setiap upsert GAGAL HTTP 400 (tabel selalu 0 baris
// di produksi, data user hanya tersimpan di localStorage per-browser). loadMasterTable
// juga salah: `row => ({...row.data, id})` — karena `row.data` tidak ada, semua field
// kapasitas ikut hilang. Fungsi di bawah memetakan camelCase (JS) ↔ snake_case (kolom)
// satu per satu. Skema tabel di Supabase SUDAH benar & sengaja typed — JANGAN diubah.
//
// Pasangan [kolom_db, fieldJs]. Sumber tunggal untuk load & sync supaya tidak ada
// nama yang menyimpang antara arah baca & tulis (salah satu huruf = 400 lagi).
const WAREHOUSE_CAPACITY_FIELDS = [
  ["upt", "upt"],
  ["gudang", "gudang"],
  ["sub_gudang", "subGudang"],
  ["type_gudang", "typeGudang"],
  ["alamat", "alamat"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
  ["luas_lahan_m2", "luasLahanM2"],
  ["luas_terpakai_m2", "luasTerpakaiM2"],
  ["sisa_luas_m2", "sisaLuasM2"],
  ["persentase_terpakai", "persentaseTerpakai"],
  ["persediaan_pct", "persediaanPct"],
  ["cadang_pct", "cadangPct"],
  ["pre_memory_pct", "preMemoryPct"],
  ["attb_pct", "attbPct"],
  ["lainnya_pct", "lainnyaPct"],
  ["status_kapasitas", "statusKapasitas"],
  ["contact_person", "contactPerson"],
  ["waktu_update", "waktuUpdate"],
  ["keterangan", "keterangan"],
  ["link_gudang", "linkGudang"],
  ["matched_gudang_id", "matchedGudangId"],
  ["mapping_status", "mappingStatus"],
  ["import_batch_id", "importBatchId"],
];
// Kolom NOT NULL numeric (default 0 di DB) — jangan pernah kirim undefined/NaN/null.
const WAREHOUSE_CAPACITY_NUM_NOTNULL = new Set([
  "luas_lahan_m2", "luas_terpakai_m2", "sisa_luas_m2", "persentase_terpakai",
]);

// Baris DB (snake_case) → object JS (camelCase) sesuai bentuk yang dipakai
// KapasitasGudangTab/KapasitasGudangImportTab.
function warehouseCapacityRowToItem(row) {
  const item = { id: row.id };
  for (const [col, key] of WAREHOUSE_CAPACITY_FIELDS) item[key] = row[col];
  // matchedLokasiId ada di object JS (selalu null, tidak pernah dibaca) tapi tidak
  // punya kolom DB — kembalikan null supaya bentuk object konsisten dengan komponen.
  item.matchedLokasiId = null;
  return item;
}

// Object JS (camelCase) → baris DB (snake_case). Field `matchedLokasiId` & metadata
// _errors/_warnings/_valid (kalau tersisa) sengaja TIDAK ikut — tidak ada kolomnya.
function warehouseCapacityItemToRow(item) {
  const row = { id: item.id };
  for (const [col, key] of WAREHOUSE_CAPACITY_FIELDS) {
    let v = item[key];
    if (WAREHOUSE_CAPACITY_NUM_NOTNULL.has(col)) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : 0;
    } else if (v === undefined) {
      v = null;
    }
    row[col] = v;
  }
  // NOT NULL + CHECK constraint — pastikan selalu nilai valid meski record cacat.
  if (!row.status_kapasitas) row.status_kapasitas = "AMAN";
  if (!row.mapping_status) row.mapping_status = "UNMATCHED";
  return row;
}

export async function loadWarehouseCapacity() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("warehouse_capacity").select("*");
  if (error) { console.error(`loadWarehouseCapacity: ${error.message}`, error); return null; }
  return data.map(warehouseCapacityRowToItem);
}

// Mirip syncMasterTable, tapi upsert ke kolom-kolom typed asli (bukan wrap `data` jsonb).
export async function syncWarehouseCapacity(list) {
  if (isDemoMode()) return true; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!supabase) return false;
  // Dedupe by id (keep-last) — samakan dengan syncMasterTable (hindari error 21000 upsert).
  const dedupedList = [...new Map(list.map(item => [item.id, item])).values()];
  const rows = dedupedList.map(warehouseCapacityItemToRow);
  if (rows.length) {
    const { error } = await supabase.from("warehouse_capacity").upsert(rows, { onConflict: "id" });
    if (error) { console.error(`syncWarehouseCapacity upsert: ${error.message}`, error); return false; }
  }
  // PENGAMANAN KRITIS (sama seperti syncMasterTable, 2026-07-07): kalau `list` KOSONG,
  // JANGAN lanjut ke reconciliation-delete — cegah state React yang sempat kosong (race/
  // stale closure) menghapus SEMUA baris produksi yang tidak pernah diminta user hapus.
  if (list.length === 0) return true;
  const { data: existing, error: selErr } = await supabase.from("warehouse_capacity").select("id");
  if (selErr) { console.error(`syncWarehouseCapacity select: ${selErr.message}`, selErr); return false; }
  const currentIds = new Set(list.map(i => i.id));
  const toDelete = (existing || []).filter(r => !currentIds.has(r.id)).map(r => r.id);
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("warehouse_capacity").delete().in("id", toDelete);
    if (delErr) { console.error(`syncWarehouseCapacity delete: ${delErr.message}`, delErr); return false; }
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════
// IMPORT KAPASITAS GUDANG — load/sync KHUSUS (tabel warehouse_capacity_imports)
// ────────────────────────────────────────────────────────────────────
// Antrian approval import Excel Kapasitas Gudang. Sama seperti warehouse_capacity,
// tabel ini SUDAH DIMIGRASI ke SKEMA KOLOM TYPED PENUH (source_file/status/records
// jsonb/approved_by/…), BUKAN pola generik {id, data jsonb, created_at bigint}.
// loadMasterTable/syncMasterTable generik TIDAK bisa dipakai: syncMasterTable
// mengirim {id, data, created_at} — kolom itu tidak ada lagi di tabel ini, jadi
// upsert GAGAL HTTP 400. Fungsi di bawah memetakan camelCase (JS) ↔ snake_case
// (kolom) satu per satu. BEDA dari warehouse_capacity: `records` di sini adalah
// SATU kolom jsonb yang menyimpan seluruh array baris kapasitas APA ADANYA
// (passthrough, TIDAK di-flatten per-field). Skema tabel sudah final — JANGAN diubah.
//
// Pasangan [kolom_db, fieldJs]. Sumber tunggal untuk load & sync supaya tidak ada
// nama yang menyimpang antara arah baca & tulis (salah satu huruf = 400 lagi).
const WAREHOUSE_CAPACITY_IMPORTS_FIELDS = [
  ["source_file", "sourceFile"],
  ["sheet_name", "sheetName"],
  ["imported_by", "importedBy"],
  ["imported_at", "importedAt"],
  ["total_rows", "totalRows"],
  ["valid_rows", "validRows"],
  ["invalid_rows", "invalidRows"],
  ["warning_rows", "warningRows"],
  ["status", "status"],
  ["records", "records"],
  ["approved_by", "approvedBy"],
  ["approved_at", "approvedAt"],
  ["rejected_by", "rejectedBy"],
  ["rejected_at", "rejectedAt"],
  ["reject_reason", "rejectReason"],
];
// Kolom NOT NULL integer (default 0 di DB) — jangan pernah kirim undefined/NaN/null.
const WAREHOUSE_CAPACITY_IMPORTS_NUM_NOTNULL = new Set([
  "total_rows", "valid_rows", "invalid_rows", "warning_rows",
]);

// Baris DB (snake_case) → object JS (camelCase) sesuai bentuk yang dipakai
// KapasitasGudangImportTab/approveCapacityImport/rejectCapacityImport.
function warehouseCapacityImportRowToItem(row) {
  const item = { id: row.id };
  for (const [col, key] of WAREHOUSE_CAPACITY_IMPORTS_FIELDS) item[key] = row[col];
  // records = kolom jsonb; kalau null/undefined kembalikan [] supaya komponen aman.
  if (!Array.isArray(item.records)) item.records = [];
  return item;
}

// Object JS (camelCase) → baris DB (snake_case). `records` dipassthrough apa adanya
// (jsonb array utuh, TIDAK di-flatten). Metadata JS lain yang tak berkolom sengaja
// tidak ikut — hanya field terdaftar di WAREHOUSE_CAPACITY_IMPORTS_FIELDS yang dikirim.
function warehouseCapacityImportItemToRow(item) {
  const row = { id: item.id };
  for (const [col, key] of WAREHOUSE_CAPACITY_IMPORTS_FIELDS) {
    let v = item[key];
    if (WAREHOUSE_CAPACITY_IMPORTS_NUM_NOTNULL.has(col)) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : 0;
    } else if (col === "records") {
      v = Array.isArray(v) ? v : [];
    } else if (v === undefined) {
      v = null;
    }
    row[col] = v;
  }
  // NOT NULL + CHECK constraint — status harus salah satu nilai valid meski record cacat.
  if (!row.status) row.status = "PENDING_ASMAN";
  return row;
}

export async function loadWarehouseCapacityImports() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("warehouse_capacity_imports").select("*");
  if (error) { console.error(`loadWarehouseCapacityImports: ${error.message}`, error); return null; }
  return data.map(warehouseCapacityImportRowToItem);
}

// Mirip syncMasterTable, tapi upsert ke kolom-kolom typed asli (bukan wrap `data` jsonb).
export async function syncWarehouseCapacityImports(list) {
  if (isDemoMode()) return true; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!supabase) return false;
  // Dedupe by id (keep-last) — samakan dengan syncMasterTable (hindari error 21000 upsert).
  const dedupedList = [...new Map(list.map(item => [item.id, item])).values()];
  const rows = dedupedList.map(warehouseCapacityImportItemToRow);
  if (rows.length) {
    const { error } = await supabase.from("warehouse_capacity_imports").upsert(rows, { onConflict: "id" });
    if (error) { console.error(`syncWarehouseCapacityImports upsert: ${error.message}`, error); return false; }
  }
  // PENGAMANAN KRITIS (sama seperti syncMasterTable, 2026-07-07): kalau `list` KOSONG,
  // JANGAN lanjut ke reconciliation-delete — cegah state React yang sempat kosong (race/
  // stale closure) menghapus SEMUA baris produksi yang tidak pernah diminta user hapus.
  if (list.length === 0) return true;
  const { data: existing, error: selErr } = await supabase.from("warehouse_capacity_imports").select("id");
  if (selErr) { console.error(`syncWarehouseCapacityImports select: ${selErr.message}`, selErr); return false; }
  const currentIds = new Set(list.map(i => i.id));
  const toDelete = (existing || []).filter(r => !currentIds.has(r.id)).map(r => r.id);
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("warehouse_capacity_imports").delete().in("id", toDelete);
    if (delErr) { console.error(`syncWarehouseCapacityImports delete: ${delErr.message}`, delErr); return false; }
  }
  return true;
}

// Seed Supabase sekali dari DEFAULT_* kalau tabelnya masih kosong (instalasi pertama kali)
export async function seedMasterTableIfEmpty(table, defaults, extraCols) {
  if (!supabase || !defaults?.length) return defaults || [];
  const existing = await loadMasterTable(table);
  if (existing === null) return defaults; // Supabase tidak terkonfigurasi/error — fallback lokal
  if (existing.length > 0) return existing;
  await syncMasterTable(table, defaults, extraCols);
  return defaults;
}

// Upsert APPEND-ONLY (tidak pernah delete baris lain) — dipakai untuk domain
// audit-log seperti Health Index Material Cadang (imports/runs/health_results/
// ai_insights/apply_audit) yang tumbuh terus, bukan "daftar aktif" seperti
// katalog/stocks. localStorage/CLOUD tetap sumber utama UI (dibaca saat load),
// Supabase di sini murni backup/audit-trail — jadi tidak perlu delete-sync
// simetris seperti syncMasterTable, cukup upsert baris baru saja.
export async function syncMaterialCadangRows(table, rows, mapFn) {
  if (isDemoMode()) return true; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!supabase || !rows?.length) return false;
  const mapped = rows.map(mapFn);
  const { error } = await supabase.from(table).upsert(mapped, { onConflict: "id" });
  if (error) { console.error(`syncMaterialCadangRows upsert(${table}): ${error.message}`, error); return false; }
  return true;
}
