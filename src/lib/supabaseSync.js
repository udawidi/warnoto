// Cluster supabase-sync + proses foto TUG (dipindah dari App.jsx Fase 5f).
// Sebagian dipakai app-wide (processTxnPhotos/resolveTxnPrivPhotos di alur simpan txn),
// sebagian dipakai TUG15Tab (buildMutasiRows/sync*).
import { supabase, SUPABASE_URL, SUPABASE_KEY, fetchSupabase } from "../supabaseClient.js";
import { UIT, UPT, STATUS_RETUR_TO_JENIS } from "../constants.js";
import { fmtDateOnly } from "./utils.js";
import { getSAPLabel } from "./ragShared.mjs";
import { getSAPStatus } from "./sap.js";
import { syncMasterTable } from "./masterSync.js";
import { isDemoMode } from "./demo.js";

// Marker sync harus mengikuti endpoint. Jangan baca marker global lama: marker
// dari Supabase Cloud tidak boleh menekan recheck idempoten ke self-host baru.
function endpointScopedStorageKey(baseKey) {
  let host = "unconfigured";
  try { host = new URL(SUPABASE_URL).hostname; } catch {}
  return `${baseKey}::${host}`;
}
const SYNCED_KEYS_STORAGE = endpointScopedStorageKey("warnoto_synced_tug15_keys");

const FOTO_SYNCED_HASHES_STORAGE = endpointScopedStorageKey("warnoto_synced_foto_hashes");

const TXN_PHOTO_SLOTS = [
  { field: "fotoKendaraan",         bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoSimKtp",            bucket: "tug-docs-private",  maxBytes:   300_000 },
  { field: "fotoSuratPengembalian", bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoBAPengembalian",    bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoSuratJalanImg",     bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoKontrak",           bucket: "tug-photos",       maxBytes: 1_000_000 },
];

export const _isDataUrl = (v) => typeof v === "string" && v.startsWith("data:");

function rowSyncKey(r) {
  return `${r.katalogId}|${r.ts}|${r.masuk}|${r.keluar}|${r.docType}`;
}

function getSyncedKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEYS_STORAGE) || "[]")); }
  catch { return new Set(); }
}

function saveSyncedKeys(set) {
  localStorage.setItem(SYNCED_KEYS_STORAGE, JSON.stringify([...set]));
}

export async function syncTUG15ToSupabase(rows, katalogList) {
  if (isDemoMode()) return { katalogCount: 0, historyCount: 0 }; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase belum dikonfigurasi (cek VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY di .env)");
  }
  const synced = getSyncedKeys();
  const newRows = rows.filter(r => r.katalogId && r.katalogId!=="-" && !synced.has(rowSyncKey(r)));
  if (newRows.length === 0) return { katalogCount: 0, historyCount: 0 };

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. Upsert katalog yang dipakai (FK target â€” harus ada dulu sebelum insert history)
  const katalogIds = [...new Set(newRows.map(r=>r.katalogId))];
  const katalogPayload = katalogIds.map(kid => {
    const kat = katalogList.find(k=>k.id===kid);
    return { id: kid, data: { name: kat?.name||kid, katalog: kat?.katalog||null, satuan: kat?.satuan||null, jenisBarang: kat?.jenisBarang||null } };
  });
  // ignore-duplicates (bukan merge-duplicates): baris katalog yang sudah ada
  // (disinkron lewat syncMasterTable("katalog",...) di jalur utama) TIDAK BOLEH
  // ditimpa payload minimal di sini â€” kalau di-merge, field data jsonb lengkap
  // (merk/type/keterangan/dst) bisa hilang, cuma menyisakan 4 field ini.
  // Insert ini murni jaga-jaga FK (katalog_id di tug15_history) untuk id yang
  // belum sempat tersinkron dari jalur utama.
  const katRes = await fetchSupabase(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(katalogPayload),
  });
  if (!katRes.ok) throw new Error(`Gagal sync katalog: ${await katRes.text()}`);

  // 2. Insert baris mutasi (MASUK & KELUAR jadi baris terpisah sesuai skema tug15_history).
  // sync_key dibuat dari isi transaksi (bukan random) + upsert on_conflict=sync_key dengan
  // ignore-duplicates â€” supaya kalau cache lokal kebetulan kosong/di-reset dan baris yang sama
  // terkirim ulang (atau ada race antar tab), Supabase sendiri yang menolak duplikatnya,
  // bukan cuma mengandalkan cache di localStorage.
  const historyPayload = [];
  newRows.forEach(r => {
    const tanggal = new Date(r.ts).toISOString().slice(0,10);
    const baseKey = `${r.katalogId}_${r.ts}_${r.docType}`;
    if (r.masuk > 0) historyPayload.push({ katalog_id: r.katalogId, tanggal, jenis_transaksi: "MASUK", qty: r.masuk, lokasi_id: r.lokasiId||null, lokasi_kode: r.lokasiKode||null, doc_type: r.docType, no_bon: r.tugBaDoc||null, catatan: r.keterangan||null, sync_key: `${baseKey}_MASUK` });
    if (r.keluar > 0) historyPayload.push({ katalog_id: r.katalogId, tanggal, jenis_transaksi: "KELUAR", qty: r.keluar, lokasi_id: r.lokasiId||null, lokasi_kode: r.lokasiKode||null, doc_type: r.docType, no_bon: r.tugBaDoc||null, catatan: r.keterangan||null, sync_key: `${baseKey}_KELUAR` });
  });
  const histRes = await fetchSupabase(`${SUPABASE_URL}/rest/v1/tug15_history?on_conflict=sync_key`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(historyPayload),
  });
  if (!histRes.ok) throw new Error(`Gagal sync tug15_history: ${await histRes.text()}`);

  newRows.forEach(r => synced.add(rowSyncKey(r)));
  saveSyncedKeys(synced);
  return { katalogCount: katalogPayload.length, historyCount: historyPayload.length };
}

// â”€â”€â”€ SUPABASE SYNC (Data Stok â†’ stock_current) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Push qty stok terkini (dijumlah per katalog dari semua lokasi) supaya job
// training bisa hitung estimasi_hari_sampai_habis = qty_saat_ini / rata2 prediksi harian.
export async function syncStockQtyToSupabase(stocks, katalogList) {
  if (isDemoMode()) return { katalogCount: 0, stockCount: 0 }; // mode demo: pura-pura sukses, tidak menulis Supabase
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase belum dikonfigurasi (cek VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY di .env)");
  }
  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // Jumlahkan qty per katalog (1 katalog bisa ada di banyak lokasi/baris stok)
  const qtyMap = {};
  (stocks||[]).forEach(s => {
    if (!s.katalogId) return;
    qtyMap[s.katalogId] = (qtyMap[s.katalogId]||0) + (s.qty||0);
  });
  const katalogIds = Object.keys(qtyMap);
  if (katalogIds.length === 0) return { katalogCount: 0, stockCount: 0 };

  // Pastikan katalog-nya ada dulu (FK target). ignore-duplicates supaya tidak
  // menimpa data jsonb lengkap milik baris yang sudah tersinkron via jalur utama.
  const katalogPayload = katalogIds.map(kid => {
    const kat = katalogList.find(k=>k.id===kid);
    return { id: kid, data: { name: kat?.name||kid, katalog: kat?.katalog||null, satuan: kat?.satuan||null, jenisBarang: kat?.jenisBarang||null } };
  });
  const katRes = await fetchSupabase(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(katalogPayload),
  });
  if (!katRes.ok) throw new Error(`Gagal sync katalog: ${await katRes.text()}`);

  const stockPayload = katalogIds.map(kid => ({ katalog_id: kid, qty: qtyMap[kid], updated_at: new Date().toISOString() }));
  const stockRes = await fetchSupabase(`${SUPABASE_URL}/rest/v1/stock_current?on_conflict=katalog_id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(stockPayload),
  });
  if (!stockRes.ok) throw new Error(`Gagal sync stock_current: ${await stockRes.text()}`);

  return { katalogCount: katalogPayload.length, stockCount: stockPayload.length };
}

// Balapan promise vs timeout â€” kalau promise belum selesai dalam `ms`, reject
// dengan pesan yang jelas (dipakai supaya upload foto yang macet tidak
// menggantung proses simpan transaksi selamanya).
export function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout ${label || "upload"} (${Math.round(ms / 1000)}s)`)), ms)),
  ]);
}

// Upload satu foto base64 ke Storage â†’ kembalikan URL publik (atau penanda "priv:"
// untuk bucket privat). Dipakai foto transaksi TUG maupun foto Data Stok.
export async function uploadPhotoToStorage(dataUrl, bucket, path) {
  const blob = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw error;
  return bucket === "tug-docs-private"
    ? `priv:${path}`                                                     // render via signed URL
    : supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Upload semua foto base64 sebuah transaksi ke Storage â†’ ganti jadi URL/penanda.
// Foto yang gagal upload (mis. offline) dibiarkan base64 & dicatat di `pending`
// (transaksi tetap tersimpan + dokumen tetap bisa dibuat; disinkron ulang nanti).
export async function processTxnPhotos(txn, prefix, onProgress) {
  // Mode demo: jangan upload ke Storage â€” kembalikan txn dengan referensi PERSIS
  // sama (bukan copy) supaya pemanggil (mis. syncPendingTxnPhotos) yang membandingkan
  // `data !== x` tidak menganggap ada perubahan & tidak memicu save loop.
  if (isDemoMode()) return { data: txn, pending: [] };
  if (!supabase) return { data: txn, pending: [] };
  const t = { ...txn };
  const pending = [];

  // Hitung total foto ber-data-URL yang bakal diupload, supaya onProgress bisa
  // melapor "x/total" (dipakai overlay progres simpan transaksi di App.jsx).
  const total = TXN_PHOTO_SLOTS.filter(({ field }) => _isDataUrl(t[field])).length
    + (Array.isArray(t.fotoMaterial) ? t.fotoMaterial.filter(fm => _isDataUrl(fm?.img)).length : 0)
    + (Array.isArray(t.stockItems) ? t.stockItems.reduce((n, si) => n + ["fotoNameplate", "fotoBarangRetur"].filter(f => _isDataUrl(si?.[f])).length, 0) : 0);
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  for (const { field, bucket, maxBytes } of TXN_PHOTO_SLOTS) {
    if (_isDataUrl(t[field])) {
      try { t[field] = await _withTimeout(uploadPhotoToStorage(await compressImage(t[field], { maxBytes }), bucket, `${prefix}/${field}.jpg`), 30_000, "unggah foto"); }
      catch { pending.push(field); }
      tick();
    }
  }
  if (Array.isArray(t.fotoMaterial)) {
    t.fotoMaterial = await Promise.all(t.fotoMaterial.map(async (fm) => {
      if (!_isDataUrl(fm?.img)) return fm;
      try {
        const img = await _withTimeout(uploadPhotoToStorage(await compressImage(fm.img, { maxBytes: 1_000_000 }), "tug-photos", `${prefix}/material-${fm.stockId}.jpg`), 30_000, "unggah foto");
        tick();
        return { ...fm, img };
      }
      catch { pending.push(`material:${fm.stockId}`); tick(); return fm; }
    }));
  }
  if (Array.isArray(t.stockItems)) {
    t.stockItems = await Promise.all(t.stockItems.map(async (si, idx) => {
      const nsi = { ...si };
      for (const field of ["fotoNameplate", "fotoBarangRetur"]) {
        if (_isDataUrl(nsi[field])) {
          try { nsi[field] = await _withTimeout(uploadPhotoToStorage(await compressImage(nsi[field], { maxBytes: 1_000_000 }), "tug-photos", `${prefix}/item${idx}-${field}.jpg`), 30_000, "unggah foto"); }
          catch { pending.push(`item${idx}.${field}`); }
          tick();
        }
      }
      return nsi;
    }));
  }
  if (pending.length) t._fotoPending = true; else if (t._fotoPending) delete t._fotoPending;
  return { data: t, pending };
}

// SIM/KTP "priv:<path>" â†’ signed URL (1 jam) untuk ditampilkan/dicetak.
export async function resolveTxnPrivPhotos(txn) {
  if (!supabase || !txn || typeof txn.fotoSimKtp !== "string" || !txn.fotoSimKtp.startsWith("priv:")) return txn;
  try {
    const { data } = await supabase.storage.from("tug-docs-private").createSignedUrl(txn.fotoSimKtp.slice(5), 3600);
    return data?.signedUrl ? { ...txn, fotoSimKtp: data.signedUrl } : txn;
  } catch { return txn; }
}

export async function syncFotoMaterialToSupabase(stocks, katalogList) {
  if (isDemoMode()) return { uploadCount: 0 }; // mode demo: pura-pura sukses, tidak upload ke Storage
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase belum dikonfigurasi (cek VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY di .env)");
  }
  const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
  let synced = {};
  try { synced = JSON.parse(localStorage.getItem(FOTO_SYNCED_HASHES_STORAGE) || "{}"); } catch { synced = {}; }

  let uploadCount = 0;
  for (const kat of katalogList) {
    const stockRow = (stocks||[]).find(s => s.katalogId === kat.id && s.fotoKeseluruhan);
    if (!stockRow) continue;
    const img = stockRow.fotoKeseluruhan;
    const fingerprint = `${img.length}:${img.slice(0, 60)}`;
    if (synced[kat.id] === fingerprint) continue;

    // Foto hasil migrasi AppSheet sudah berupa URL Storage (bukan base64 data URL).
    // Tidak perlu di-upload ulang â€” cukup pakai URL-nya langsung sebagai
    // fotoKeseluruhanUrl (dipakai halaman scan QR). Tanpa guard ini, dataUrlToBlob
    // akan error karena img bukan format "data:...;base64,".
    if (!/^data:/i.test(img)) {
      const katRes = await fetchSupabase(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify([{ id: kat.id, data: { ...kat, fotoKeseluruhanUrl: img } }]),
      });
      if (!katRes.ok) throw new Error(`Gagal simpan URL foto ke katalog: ${await katRes.text()}`);
      synced[kat.id] = fingerprint;
      uploadCount++;
      continue;
    }

    const blob = dataUrlToBlob(img);
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const path = `${kat.id}.${ext}`;

    const upRes = await fetchSupabase(`${SUPABASE_URL}/storage/v1/object/material-photos/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": blob.type, "x-upsert": "true" },
      body: blob,
    });
    if (!upRes.ok) throw new Error(`Gagal upload foto ${kat.name}: ${await upRes.text()}`);

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/material-photos/${path}`;
    // Kirim seluruh objek `kat` (state React, sudah lengkap) + fotoKeseluruhanUrl
    // sebagai `data` jsonb â€” BUKAN payload minimal â€” supaya merge-duplicates di
    // sini tidak menghapus field lain (merk/type/keterangan/dst) milik baris ini.
    const katRes = await fetchSupabase(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: kat.id, data: { ...kat, fotoKeseluruhanUrl: publicUrl } }]),
    });
    if (!katRes.ok) throw new Error(`Gagal simpan URL foto ke katalog: ${await katRes.text()}`);

    synced[kat.id] = fingerprint;
    uploadCount++;
  }
  localStorage.setItem(FOTO_SYNCED_HASHES_STORAGE, JSON.stringify(synced));
  return { uploadCount };
}

// Kompres + resize foto ke JPEG di bawah target ukuran, mengembalikan data URL.
// Dipakai sebelum upload ke Storage (foto transaksi TUG, stok, visual-search)
// supaya hemat penyimpanan/bandwidth. Menerima File maupun data URL.
//   maxBytes : batas ukuran hasil (default 1MB; SIM/KTP pakai ~300KB).
//   maxDim   : sisi terpanjang maksimum (px) sebelum kualitas diturunkan.
export async function compressImage(input, { maxBytes = 1_000_000, maxDim = 1600 } = {}) {
  const srcUrl = typeof input === "string" ? input : URL.createObjectURL(input);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      // URL remote http(s) perlu mode CORS eksplisit, kalau tidak canvas jadi "tainted"
      // dan toDataURL() ditolak browser. blob:/data: (upload File lokal) tidak butuh ini.
      if (srcUrl.startsWith("http")) im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Gagal memuat gambar untuk kompresi."));
      im.src = srcUrl;
    });
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";                 // cegah PNG transparan jadi hitam saat ke JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const bytesOf = (u) => Math.ceil((u.length - (u.indexOf(",") + 1)) * 0.75);
    let quality = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (bytesOf(dataUrl) > maxBytes && quality > 0.4) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    // Masih kegedean di kualitas minimum â†’ kecilkan dimensi lalu ulang.
    if (bytesOf(dataUrl) > maxBytes && Math.max(width, height) > 800) {
      return compressImage(dataUrl, { maxBytes, maxDim: Math.round(Math.max(width, height) * 0.75) });
    }
    return dataUrl;
  } finally {
    if (typeof input !== "string") URL.revokeObjectURL(srcUrl);
  }
}

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("Format foto tidak valid (bukan base64 dataURL).");
  const mime = match[1] || "image/jpeg";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function loadLegacyHistoryPages(table, fields, sourceUpt) {
  const rows = [];
  let afterId = null;
  while (true) {
    let query = supabase.from(table).select(fields).eq("source_upt", sourceUpt).order("id", { ascending: true }).limit(1000);
    if (afterId !== null) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) return { rows, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < 1000) return { rows, error: null };
    afterId = page[page.length - 1]?.id;
    if (afterId === undefined || afterId === null) return { rows, error: null };
  }
}

export async function loadLegacyHistoryArchive(sourceUpt = "UPT Surabaya") {
  if (isDemoMode() || !supabase) return { rows: [], documents: [], error: null };
  const archiveFields = "id,source_upt,doc_type,doc_id,item_id,tanggal,jenis_transaksi,no_katalog,nama_material,satuan,qty,unit_lawan,lokasi_kode,catatan,link_foto,foto_barang_url,match_confidence,issue_flags,sync_key";
  const documentFields = "id,source_upt,doc_type,doc_id,foto_surat_jalan_url,foto_sim_ktp_url,foto_kendaraan_url,pdf_url,berita_acara_url,lampiran_url,match_notes";
  const [archiveRes, documentRes] = await Promise.all([
    loadLegacyHistoryPages("legacy_history_archive", archiveFields, sourceUpt),
    loadLegacyHistoryPages("legacy_history_documents", documentFields, sourceUpt),
  ]);
  return {
    rows: archiveRes.rows,
    documents: documentRes.rows,
    error: archiveRes.error || documentRes.error || null,
  };
}

export async function resolveLegacyPrivateUrl(value) {
  if (typeof value !== "string" || !value.startsWith("priv:") || !supabase) return value || null;
  const { data, error } = await supabase.storage.from("tug-docs-private").createSignedUrl(value.slice(5), 3600);
  if (error) throw error;
  return data?.signedUrl || null;
}

function historyMaterialKey(katalog, deskripsi, sourceScope = "live", uniqueSeed = "") {
  const code = String(katalog || "").trim().toLowerCase();
  if (code && code !== "-") return `katalog:${code}`;
  const name = String(deskripsi || "").trim().toLowerCase();
  if (name && name !== "-") return `${sourceScope}:nama:${name}`;
  return `${sourceScope}:unknown:${String(uniqueSeed || "material").trim().toLowerCase()}`;
}

function normalizedSearchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
}

function valuesToText(values) {
  return values.filter(Boolean).map(normalizedSearchText).filter(Boolean).join(" ");
}

function matchesSearchTokens(row, query) {
  const tokens = normalizedSearchText(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const haystack = valuesToText([
    row.deskripsi, row.katalog, row.eventKind, row.eventDate, row.docType, row.documentNo, row.tugBaDoc,
    row.jobName, row.workLocation, row.counterparty, row.unit, row.contractRefs, row.documentRefs,
    row.notes, row.storageLocation, row.quality, row.upt, row.unitLawan,
  ]);
  return tokens.every(token => haystack.includes(token));
}

function addLiveSearchFields(row, fields) {
  return {
    ...row,
    // Kontrak baris laporan: metadata ini lokal untuk konsumsi UI/export.
    // Tidak mengubah skema, payload API, maupun histori produksi.
    id: row.id || fields.id || `${row.docType}:${fields.documentNo || "-"}:${row.materialKey}`,
    materialId: row.resolvedKatalogId || row.katalogId || "",
    requestedQty: Number(fields.requestedQty ?? row.requestedQty ?? 0) || 0,
    eventKind: fields.eventKind,
    eventDate: row.tanggalMutasi,
    documentNo: fields.documentNo || "-",
    jobName: fields.jobName || "-",
    workLocation: fields.workLocation || "-",
    counterparty: fields.counterparty || "-",
    unit: fields.unit || "-",
    contractRefs: fields.contractRefs || "-",
    documentRefs: fields.documentRefs || "-",
    notes: fields.notes || "-",
    storageLocation: fields.storageLocation || "-",
    quality: fields.quality || "-",
  };
}

export function buildMutasiRows(txns, katalogList, stocks, filter, lokasiList, legacyRows = [], context = {}) {
  const { dateFrom, dateTo, katalogId, jenisBarang, sapStatus } = filter;
  const docTypes = [...new Set(["TUG9", "TUG8", "TUG10", "TUG3", "TUG5", ...(filter.docTypes || [])])];
  const source = filter.source || "ALL";
  const searchText = filter.searchText || "";
  const ultgList = context.ultgList || filter.ultgList || [];
  const uitList = context.uitList || filter.uitList || [];
  const gudangList = context.gudangList || filter.gudangList || [];
  const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
  const toMs   = dateTo   ? new Date(dateTo).getTime() + 86399999 : Infinity;

  // Helper: resolve katalog object and apply SAP/jenisBarang filters
  function shouldIncludeKatalog(kat, stockRow) {
    if (!kat) return false;
    if (katalogId !== "ALL" && kat.id !== katalogId) return false;
    // Jenis Barang filter (from Data Stok row)
    if (jenisBarang !== "ALL") {
      const jb = stockRow?.jenisBarang || "Persediaan";
      if (jb !== jenisBarang) return false;
    }
    // SAP status filter (from katalog number)
    if (sapStatus !== "ALL") {
      if (getSAPStatus(kat.katalog) !== sapStatus) return false;
    }
    return true;
  }
  const resolveMerk = (kat, item) => kat?.merk || kat?.merek || item?.merk || item?.merek || "-";
  const resolveType = (kat, item) => kat?.type || kat?.tipe || item?.type || item?.tipe || "-";
  const warehouseNameForLokasi = lokasiId => {
    const gudangId = (lokasiList || []).find(l => l.id === lokasiId)?.gudangId;
    return gudangList.find(g => g.id === gudangId)?.nama || "Tidak tercatat";
  };
  const legacyWarehouseName = (value, sourceUpt) => {
    // Arsip lama tidak punya FK gudang. Ambil hanya awalan nama gudang yang
    // eksplisit dan hentikan sebelum detail UPT/subgudang/blok.
    const match = String(value || "").trim().match(/^\s*(GUDANG\b.*?)(?=\s+-\s+|[|/;,]|$)/i);
    return match ? match[1].trim() : (sourceUpt || "Tidak tercatat");
  };

  const rows = [];

  txns.forEach(t => {
    const approved = t.status==="APPROVED" || t.stage==="APPROVED";
    if (!approved) return;
    if (source === "LAMA") return;
    if (!docTypes.includes(t.docType)) return;

    const ts = t.docType === "TUG5"
      ? (t.approvedAtMgrUltg || t.approvedAtManager || t.createdAt || 0)
      : (t.approvedAt || t.approvedAtAsman || t.approvedAtMgrLogistik || t.createdAt || 0);

    const tanggal = fmtDateOnly(ts);
    const docKey = { TUG3:"tug3", TUG5:"tug5", TUG8:"tug8", TUG9:"tug9", TUG10:"tug10" }[t.docType];
    const docNo = t.docNumbers?.[docKey] || "-";

    if (t.docType==="TUG9" || t.docType==="TUG8") {
      (t.stockItems||[]).forEach((si, itemIndex) => {
        const stockRow = stocks.find(s=>s.id===si.stockId);
        const kat = katalogList.find(k=>k.id===stockRow?.katalogId);
        if (!shouldIncludeKatalog(kat, stockRow)) return;
        rows.push(addLiveSearchFields({
          katalog: kat.katalog||"-", deskripsi: kat.name, merk:resolveMerk(kat, si), type:resolveType(kat, si),
          satuan: kat.satuan||"-", valuasi: stockRow?.price||0,
          masuk:0, keluar: si.qty||0,
          upt: "UPT Surabaya",
          tugBaDoc: `${t.docType.replace("TUG","TUG-")} / ${docNo}`,
          keterangan: t.namaPekerjaan||"-",
          tanggalMutasi: tanggal, ts,
          katalogId: kat.id,
          sapStatus: getSAPStatus(kat.katalog),
          sapLabel: getSAPLabel(kat.katalog),
          jenisBarang: stockRow?.jenisBarang||"-",
          docType: t.docType,
          lokasiId: stockRow?.lokasiId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===stockRow?.lokasiId)?.kode||"-",
          warehouseName: warehouseNameForLokasi(stockRow?.lokasiId),
          source: "BARU",
          sourceLabel: "Baru",
          materialKey: historyMaterialKey(kat.katalog, kat.name, "live", `${t.id}:${itemIndex}`),
        }, {
          eventKind: "KELUAR",
          documentNo: docNo,
          jobName: t.namaPekerjaan || t.pekerjaan,
          workLocation: t.lokasiPekerjaan,
          counterparty: t.docType === "TUG8" ? (t.unitTujuan || t.penerimaUnit || t.penerimaNama) : (t.penerimaUnit || t.penerimaNama),
          unit: t.docType === "TUG8" ? (t.unitTujuan || t.penerimaUnit) : t.penerimaUnit,
          documentRefs: t.noNodin || t.noPersetujuan,
          notes: t.keteranganBarang || t.namaPekerjaan,
          storageLocation: (lokasiList||[]).find(l=>l.id===stockRow?.lokasiId)?.kode,
        }));
      });
    }

    if (t.docType==="TUG10") {
      (t.stockItems||[]).forEach((si, itemIndex) => {
        const kat = si.katalogMode==="existing"
          ? katalogList.find(k=>k.id===si.katalogId)
          : { id:si.katalogId||"", katalog:si.katalogBaru||"", name:si.namaBaru, satuan:si.satuanBaru||"-" };
        const fakeStockRow = { jenisBarang: STATUS_RETUR_TO_JENIS[si.statusMaterial]||"Persediaan" };
        if (!shouldIncludeKatalog(kat, fakeStockRow)) return;
        rows.push(addLiveSearchFields({
          katalog: kat?.katalog||"-", deskripsi: kat?.name||"-", merk:resolveMerk(kat, si), type:resolveType(kat, si),
          satuan: kat?.satuan||"-", valuasi: 0,
          masuk: si.qty||0, keluar: 0,
          upt: "UPT Surabaya",
          tugBaDoc: `TUG-10 / ${docNo}`,
          keterangan: `${t.namaPekerjaan||"-"} â€” ${si.statusMaterial||""}`,
          tanggalMutasi: tanggal, ts,
          katalogId: kat?.id||"-",
          sapStatus: getSAPStatus(kat?.katalog),
          sapLabel: getSAPLabel(kat?.katalog),
          jenisBarang: fakeStockRow.jenisBarang,
          docType: "TUG10",
          lokasiId: t.lokasiTujuanId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId)?.kode||"-",
          warehouseName: warehouseNameForLokasi(t.lokasiTujuanId),
          source: "BARU",
          sourceLabel: "Baru",
          materialKey: historyMaterialKey(kat?.katalog, kat?.name, "live", `${t.id}:${itemIndex}`),
        }, {
          eventKind: "MASUK",
          documentNo: docNo,
          jobName: t.namaPekerjaan || t.pekerjaan,
          workLocation: t.lokasiPekerjaan,
          counterparty: t.menyerahkanNama,
          unit: t.menyerahkanNama,
          documentRefs: t.noBAPenggantian,
          notes: t.keteranganBarang || t.namaPekerjaan,
          storageLocation: (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId)?.kode,
          quality: si.statusMaterial,
        }));
      });
    }

    if (t.docType==="TUG3" && t.stage==="APPROVED") {
      (t.stockItems||[]).forEach((si, itemIndex) => {
        const kat = si.katalogMode==="existing"
          ? katalogList.find(k=>k.id===si.katalogId)
          : { id:"-", katalog:si.katalogBaru||"", name:si.namaBaru, satuan:si.satuanBaru||"-" };
        const fakeStockRow = { jenisBarang:"Persediaan" };
        if (!shouldIncludeKatalog(kat, fakeStockRow)) return;
        rows.push(addLiveSearchFields({
          katalog: kat?.katalog||"-", deskripsi: kat?.name||"-", merk:resolveMerk(kat, si), type:resolveType(kat, si),
          satuan: kat?.satuan||"-", valuasi: si.harga||0,
          masuk: si.qty||0, keluar: 0,
          upt: "UPT Surabaya",
          tugBaDoc: `TUG-3 / ${docNo}`,
          keterangan: `Penerimaan dari ${t.dariSupplier||"-"}`,
          tanggalMutasi: tanggal, ts,
          katalogId: kat?.id||"-",
          sapStatus: getSAPStatus(kat?.katalog),
          sapLabel: getSAPLabel(kat?.katalog),
          jenisBarang: "Persediaan",
          docType: "TUG3",
          lokasiId: si.lokasiTujuanId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===si.lokasiTujuanId)?.kode||"-",
          warehouseName: warehouseNameForLokasi(si.lokasiTujuanId),
          source: "BARU",
          sourceLabel: "Baru",
          materialKey: historyMaterialKey(kat?.katalog, kat?.name, "live", `${t.id}:${itemIndex}`),
        }, {
          eventKind: "MASUK",
          documentNo: docNo,
          jobName: t.namaPekerjaan,
          workLocation: t.lokasiPekerjaan,
          counterparty: t.dariSupplier,
          unit: t.dariSupplier,
          contractRefs: [t.noSpk, t.noAmandemen].filter(Boolean).join(" | "),
          documentRefs: [t.noSuratJalan, t.noFaktur].filter(Boolean).join(" | "),
          notes: t.keteranganTug3 || t.keteranganBarang,
          storageLocation: (lokasiList||[]).find(l=>l.id===si.lokasiTujuanId)?.kode,
          quality: t.keteranganTug3,
        }));
      });
    }

    if (t.docType === "TUG5") {
      const sourceUnit = t.sourceType === "ULTG"
        ? (ultgList.find(unit => unit.id === t.ultgId)?.nama || t.ultgId)
        : (uitList.find(unit => unit.id === t.uitId)?.nama || t.uitId);
      (t.stockItems || []).forEach((si, itemIndex) => {
        const kat = katalogList.find(k => k.id === si.katalogId);
        if (!shouldIncludeKatalog(kat, { jenisBarang:"Persediaan" })) return;
        rows.push(addLiveSearchFields({
          katalog: kat?.katalog || "-", deskripsi: kat?.name || "-", merk:resolveMerk(kat, si), type:resolveType(kat, si),
          satuan: kat?.satuan || "-", valuasi:0,
          masuk:0, keluar:0,
          upt: "UPT Surabaya",
          tugBaDoc: `TUG-5 / ${docNo}`,
          keterangan: t.keteranganUmum || t.namaPekerjaan || "Permintaan material",
          tanggalMutasi: tanggal, ts,
          // TUG-5 adalah permintaan, bukan mutasi: sentinel ini mempertahankan
          // guard sync lama agar tidak masuk tug15_history/live saldo.
          katalogId:"-", resolvedKatalogId:kat?.id || "-", affectsSaldo:false,
          sapStatus: getSAPStatus(kat?.katalog), sapLabel:getSAPLabel(kat?.katalog), jenisBarang:"Persediaan",
          docType:"TUG5", lokasiId:"", lokasiKode:"-",
          warehouseName:"Tidak tercatat",
          source:"BARU", sourceLabel:"Baru", materialKey:historyMaterialKey(kat?.katalog, kat?.name, "live", `${t.id}:${itemIndex}`),
        }, {
          eventKind:"PERMINTAAN",
          requestedQty:si.qty,
          documentNo:docNo,
          jobName:t.namaPekerjaan || t.keteranganUmum,
          workLocation:t.lokasiPekerjaan,
          counterparty:sourceUnit,
          unit:sourceUnit,
          documentRefs:t.noReferensiTug7 || t.noReferensiTug5,
          notes:t.keteranganUmum || t.keteranganBarang,
        }));
      });
    }
  });

  if (source !== "BARU") {
    legacyRows.forEach(item => {
      if (!docTypes.includes(item.doc_type)) return;
      const katalog = item.no_katalog || "-";
      const deskripsi = item.nama_material || "-";
      const selectedKatalog = katalogId === "ALL" ? null : katalogList.find(k => k.id === katalogId);
      // Kode legacy tidak punya FK ke master aktif; filter barang hanya boleh memakai
      // kecocokan kode persis agar arsip tidak "divalidasi" atau dipetakan ulang.
      if (selectedKatalog && String(selectedKatalog.katalog || "") !== String(katalog)) return;
      if (jenisBarang !== "ALL" || sapStatus !== "ALL") return;
      const ts = item.tanggal ? new Date(`${item.tanggal}T00:00:00`).getTime() : 0;
      const isMasuk = String(item.jenis_transaksi || "").toUpperCase() === "MASUK";
      const isKeluar = String(item.jenis_transaksi || "").toUpperCase() === "KELUAR";
      rows.push({
        id:item.id || item.sync_key || item.item_id || `${item.doc_type}:${item.doc_id}`,
        materialId:"",
        requestedQty:0,
        katalog, deskripsi, merk:"-", type:"-", satuan:item.satuan || "-", valuasi:0,
        masuk: isMasuk ? Number(item.qty || 0) : 0,
        keluar: isKeluar ? Number(item.qty || 0) : 0,
        upt: item.source_upt || "-",
        tugBaDoc: `${String(item.doc_type || "-").replace("TUG", "TUG-")} / ${item.doc_id || "-"}`,
        keterangan: item.catatan || item.unit_lawan || "-",
        tanggalMutasi: item.tanggal || "-", ts,
        katalogId: "-", sapStatus:"ARSIP", sapLabel:"Arsip lama", jenisBarang:"-",
        docType:item.doc_type || "-", lokasiId:"", lokasiKode:item.lokasi_kode || "-",
        warehouseName:legacyWarehouseName(item.lokasi_kode, item.source_upt),
        eventKind:String(item.jenis_transaksi || "ARSIP").toUpperCase(), eventDate:item.tanggal || "-",
        documentNo:item.doc_id || "-", jobName:"-", workLocation:item.lokasi_kode || "-",
        counterparty:item.unit_lawan || "-", unit:item.unit_lawan || "-", unitLawan:item.unit_lawan || "-",
        contractRefs:"-", documentRefs:item.doc_id || "-", notes:item.catatan || "-",
        storageLocation:item.lokasi_kode || "-",
        quality:[item.match_confidence !== null && item.match_confidence !== undefined ? `Match ${item.match_confidence}%` : "", item.issue_flags].filter(Boolean).join(" | ") || "-",
        source:"LAMA", sourceLabel:"Lama", materialKey:historyMaterialKey(katalog, deskripsi, "legacy", item.id || item.sync_key || item.item_id),
        legacyId:item.id, legacyDocId:item.doc_id || null, legacySyncKey:item.sync_key, fotoBarangUrl:item.foto_barang_url || null,
        issueFlags:item.issue_flags || null, matchConfidence:item.match_confidence,
      });
    });
  }

  const visibleRows = rows.filter(row => row.ts >= fromMs && row.ts <= toMs && (!searchText || matchesSearchTokens(row, searchText)));
  visibleRows.sort((a,b)=>a.ts-b.ts);
  const saldoMap = {};
  return visibleRows.map((r,i) => {
    if (r.affectsSaldo === false) return { ...r, saldoAwal:null, saldoAkhir:null, no:i+1 };
    const saldoKey = r.source === "LAMA" ? `legacy:${r.materialKey}` : `live:${r.katalogId}`;
    const prev = saldoMap[saldoKey] || 0;
    const saldo = prev + r.masuk - r.keluar;
    saldoMap[saldoKey] = saldo;
    return { ...r, saldoAwal: prev, saldoAkhir: saldo, no: i+1 };
  });
}
