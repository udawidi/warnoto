// Cluster supabase-sync + proses foto TUG (dipindah dari App.jsx Fase 5f).
// Sebagian dipakai app-wide (processTxnPhotos/resolveTxnPrivPhotos di alur simpan txn),
// sebagian dipakai TUG15Tab (buildMutasiRows/buildTUG15HTML/sync*).
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../supabaseClient.js";
import { UIT, UPT, STATUS_RETUR_TO_JENIS } from "../constants.js";
import { fmtDateOnly, fmtRp } from "./utils.js";
import { fmtNum, getSAPLabel } from "./ragShared.mjs";
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

  // 1. Upsert katalog yang dipakai (FK target — harus ada dulu sebelum insert history)
  const katalogIds = [...new Set(newRows.map(r=>r.katalogId))];
  const katalogPayload = katalogIds.map(kid => {
    const kat = katalogList.find(k=>k.id===kid);
    return { id: kid, data: { name: kat?.name||kid, katalog: kat?.katalog||null, satuan: kat?.satuan||null, jenisBarang: kat?.jenisBarang||null } };
  });
  // ignore-duplicates (bukan merge-duplicates): baris katalog yang sudah ada
  // (disinkron lewat syncMasterTable("katalog",...) di jalur utama) TIDAK BOLEH
  // ditimpa payload minimal di sini — kalau di-merge, field data jsonb lengkap
  // (merk/type/keterangan/dst) bisa hilang, cuma menyisakan 4 field ini.
  // Insert ini murni jaga-jaga FK (katalog_id di tug15_history) untuk id yang
  // belum sempat tersinkron dari jalur utama.
  const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(katalogPayload),
  });
  if (!katRes.ok) throw new Error(`Gagal sync katalog: ${await katRes.text()}`);

  // 2. Insert baris mutasi (MASUK & KELUAR jadi baris terpisah sesuai skema tug15_history).
  // sync_key dibuat dari isi transaksi (bukan random) + upsert on_conflict=sync_key dengan
  // ignore-duplicates — supaya kalau cache lokal kebetulan kosong/di-reset dan baris yang sama
  // terkirim ulang (atau ada race antar tab), Supabase sendiri yang menolak duplikatnya,
  // bukan cuma mengandalkan cache di localStorage.
  const historyPayload = [];
  newRows.forEach(r => {
    const tanggal = new Date(r.ts).toISOString().slice(0,10);
    const baseKey = `${r.katalogId}_${r.ts}_${r.docType}`;
    if (r.masuk > 0) historyPayload.push({ katalog_id: r.katalogId, tanggal, jenis_transaksi: "MASUK", qty: r.masuk, lokasi_id: r.lokasiId||null, lokasi_kode: r.lokasiKode||null, doc_type: r.docType, no_bon: r.tugBaDoc||null, catatan: r.keterangan||null, sync_key: `${baseKey}_MASUK` });
    if (r.keluar > 0) historyPayload.push({ katalog_id: r.katalogId, tanggal, jenis_transaksi: "KELUAR", qty: r.keluar, lokasi_id: r.lokasiId||null, lokasi_kode: r.lokasiKode||null, doc_type: r.docType, no_bon: r.tugBaDoc||null, catatan: r.keterangan||null, sync_key: `${baseKey}_KELUAR` });
  });
  const histRes = await fetch(`${SUPABASE_URL}/rest/v1/tug15_history?on_conflict=sync_key`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(historyPayload),
  });
  if (!histRes.ok) throw new Error(`Gagal sync tug15_history: ${await histRes.text()}`);

  newRows.forEach(r => synced.add(rowSyncKey(r)));
  saveSyncedKeys(synced);
  return { katalogCount: katalogPayload.length, historyCount: historyPayload.length };
}

// ─── SUPABASE SYNC (Data Stok → stock_current) ───────────────────────────
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
  const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(katalogPayload),
  });
  if (!katRes.ok) throw new Error(`Gagal sync katalog: ${await katRes.text()}`);

  const stockPayload = katalogIds.map(kid => ({ katalog_id: kid, qty: qtyMap[kid], updated_at: new Date().toISOString() }));
  const stockRes = await fetch(`${SUPABASE_URL}/rest/v1/stock_current?on_conflict=katalog_id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(stockPayload),
  });
  if (!stockRes.ok) throw new Error(`Gagal sync stock_current: ${await stockRes.text()}`);

  return { katalogCount: katalogPayload.length, stockCount: stockPayload.length };
}

// Balapan promise vs timeout — kalau promise belum selesai dalam `ms`, reject
// dengan pesan yang jelas (dipakai supaya upload foto yang macet tidak
// menggantung proses simpan transaksi selamanya).
function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout ${label || "upload"} (${Math.round(ms / 1000)}s)`)), ms)),
  ]);
}

async function _uploadTxnPhoto(dataUrl, bucket, path) {
  const blob = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw error;
  return bucket === "tug-docs-private"
    ? `priv:${path}`                                                     // render via signed URL
    : supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Upload semua foto base64 sebuah transaksi ke Storage → ganti jadi URL/penanda.
// Foto yang gagal upload (mis. offline) dibiarkan base64 & dicatat di `pending`
// (transaksi tetap tersimpan + dokumen tetap bisa dibuat; disinkron ulang nanti).
export async function processTxnPhotos(txn, prefix, onProgress) {
  // Mode demo: jangan upload ke Storage — kembalikan txn dengan referensi PERSIS
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
      try { t[field] = await _withTimeout(_uploadTxnPhoto(await compressImage(t[field], { maxBytes }), bucket, `${prefix}/${field}.jpg`), 30_000, "unggah foto"); }
      catch { pending.push(field); }
      tick();
    }
  }
  if (Array.isArray(t.fotoMaterial)) {
    t.fotoMaterial = await Promise.all(t.fotoMaterial.map(async (fm) => {
      if (!_isDataUrl(fm?.img)) return fm;
      try {
        const img = await _withTimeout(_uploadTxnPhoto(await compressImage(fm.img, { maxBytes: 1_000_000 }), "tug-photos", `${prefix}/material-${fm.stockId}.jpg`), 30_000, "unggah foto");
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
          try { nsi[field] = await _withTimeout(_uploadTxnPhoto(await compressImage(nsi[field], { maxBytes: 1_000_000 }), "tug-photos", `${prefix}/item${idx}-${field}.jpg`), 30_000, "unggah foto"); }
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

// SIM/KTP "priv:<path>" → signed URL (1 jam) untuk ditampilkan/dicetak.
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
    // Tidak perlu di-upload ulang — cukup pakai URL-nya langsung sebagai
    // fotoKeseluruhanUrl (dipakai halaman scan QR). Tanpa guard ini, dataUrlToBlob
    // akan error karena img bukan format "data:...;base64,".
    if (!/^data:/i.test(img)) {
      const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
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

    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/material-photos/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": blob.type, "x-upsert": "true" },
      body: blob,
    });
    if (!upRes.ok) throw new Error(`Gagal upload foto ${kat.name}: ${await upRes.text()}`);

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/material-photos/${path}`;
    // Kirim seluruh objek `kat` (state React, sudah lengkap) + fotoKeseluruhanUrl
    // sebagai `data` jsonb — BUKAN payload minimal — supaya merge-duplicates di
    // sini tidak menghapus field lain (merk/type/keterangan/dst) milik baris ini.
    const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
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
    // Masih kegedean di kualitas minimum → kecilkan dimensi lalu ulang.
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

export function buildMutasiRows(txns, katalogList, stocks, filter, lokasiList) {
  const { dateFrom, dateTo, katalogId, jenisBarang, sapStatus, docTypes } = filter;
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

  const rows = [];

  txns.forEach(t => {
    const approved = t.status==="APPROVED" || t.stage==="APPROVED";
    if (!approved) return;
    if (!docTypes.includes(t.docType)) return;

    const ts = t.approvedAt || t.approvedAtAsman || t.approvedAtMgrLogistik || t.createdAt || 0;
    if (ts < fromMs || ts > toMs) return;

    const tanggal = fmtDateOnly(ts);
    const docNo = t.docNumbers?.[t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":t.docType==="TUG10"?"tug10":"tug3"] || "-";

    if (t.docType==="TUG9" || t.docType==="TUG8") {
      (t.stockItems||[]).forEach(si => {
        const stockRow = stocks.find(s=>s.id===si.stockId);
        const kat = katalogList.find(k=>k.id===stockRow?.katalogId);
        if (!shouldIncludeKatalog(kat, stockRow)) return;
        rows.push({
          katalog: kat.katalog||"-", deskripsi: kat.name, merk:"-", type:"-",
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
        });
      });
    }

    if (t.docType==="TUG10") {
      (t.stockItems||[]).forEach(si => {
        const kat = si.katalogMode==="existing"
          ? katalogList.find(k=>k.id===si.katalogId)
          : { id:si.katalogId||"", katalog:si.katalogBaru||"", name:si.namaBaru, satuan:si.satuanBaru||"-" };
        const fakeStockRow = { jenisBarang: STATUS_RETUR_TO_JENIS[si.statusMaterial]||"Persediaan" };
        if (!shouldIncludeKatalog(kat, fakeStockRow)) return;
        rows.push({
          katalog: kat?.katalog||"-", deskripsi: kat?.name||"-", merk:"-", type:"-",
          satuan: kat?.satuan||"-", valuasi: 0,
          masuk: si.qty||0, keluar: 0,
          upt: "UPT Surabaya",
          tugBaDoc: `TUG-10 / ${docNo}`,
          keterangan: `${t.namaPekerjaan||"-"} — ${si.statusMaterial||""}`,
          tanggalMutasi: tanggal, ts,
          katalogId: kat?.id||"-",
          sapStatus: getSAPStatus(kat?.katalog),
          sapLabel: getSAPLabel(kat?.katalog),
          jenisBarang: fakeStockRow.jenisBarang,
          docType: "TUG10",
          lokasiId: t.lokasiTujuanId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId)?.kode||"-",
        });
      });
    }

    if (t.docType==="TUG3" && t.stage==="APPROVED") {
      (t.stockItems||[]).forEach(si => {
        const kat = si.katalogMode==="existing"
          ? katalogList.find(k=>k.id===si.katalogId)
          : { id:"-", katalog:si.katalogBaru||"", name:si.namaBaru, satuan:si.satuanBaru||"-" };
        const fakeStockRow = { jenisBarang:"Persediaan" };
        if (!shouldIncludeKatalog(kat, fakeStockRow)) return;
        rows.push({
          katalog: kat?.katalog||"-", deskripsi: kat?.name||"-", merk:"-", type:"-",
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
        });
      });
    }
  });

  rows.sort((a,b)=>a.ts-b.ts);
  const saldoMap = {};
  return rows.map((r,i) => {
    const prev = saldoMap[r.katalogId] || 0;
    const saldo = prev + r.masuk - r.keluar;
    saldoMap[r.katalogId] = saldo;
    return { ...r, saldoAwal: prev, saldoAkhir: saldo, no: i+1 };
  });
}

export function buildTUG15HTML(rows, filter, katalogList) {
  const { dateFrom, dateTo } = filter;
  const periodLabel = dateFrom && dateTo ? `${dateFrom} s/d ${dateTo}` : dateFrom ? `Mulai ${dateFrom}` : dateTo ? `S/d ${dateTo}` : "Semua Periode";
  const filterKatalogLabel = filter.katalogId==="ALL" ? "Semua Barang" : (katalogList.find(k=>k.id===filter.katalogId)?.name||"-");
  const filterSAPLabel = filter.sapStatus==="ALL" ? "SAP + Non-SAP" : filter.sapStatus;
  const filterJenisLabel = filter.jenisBarang==="ALL" ? "Semua Jenis" : filter.jenisBarang;
  const generated = fmtDateOnly(Date.now());
  const totalMasuk = rows.reduce((a,r)=>a+r.masuk, 0);
  const totalKeluar = rows.reduce((a,r)=>a+r.keluar, 0);

  const itemRows = rows.map(r=>`<tr>
    <td style="text-align:center">${r.no}</td>
    <td>${r.katalog}</td>
    <td>${r.deskripsi}</td>
    <td><span style="padding:2px 6px;border-radius:10px;font-size:8px;font-weight:700;background:${r.sapStatus==="SAP"?"#dbeafe":"#f3f4f6"};color:${r.sapStatus==="SAP"?"#1d4ed8":"#6b7280"}">${r.sapStatus||"-"}</span></td>
    <td>${r.jenisBarang||"-"}</td>
    <td>${r.merk}</td>
    <td>${r.type}</td>
    <td style="text-align:center">${r.satuan}</td>
    <td style="text-align:right">${r.valuasi>0?fmtRp(r.valuasi):"-"}</td>
    <td style="text-align:center">${fmtNum(r.saldoAwal)||0}</td>
    <td style="text-align:center;color:#16a34a;font-weight:${r.masuk>0?"700":"400"}">${r.masuk>0?fmtNum(r.masuk):"-"}</td>
    <td style="text-align:center;color:#dc2626;font-weight:${r.keluar>0?"700":"400"}">${r.keluar>0?fmtNum(r.keluar):"-"}</td>
    <td style="text-align:center;font-weight:700">${fmtNum(r.saldoAkhir)}</td>
    <td>${r.upt}</td>
    <td style="font-size:9px">${r.tugBaDoc}</td>
    <td style="font-size:9px">${r.keterangan}</td>
    <td style="text-align:center">${r.tanggalMutasi}</td>
  </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-15 Laporan Mutasi Stok</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9px;color:#111;background:#e5e7eb}.page{padding:20px;background:white;max-width:1400px;margin:0 auto 16px}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:8px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800}.doctitle .sub{font-size:10px;color:#555;margin-top:2px}table.info{width:100%;margin-bottom:12px;font-size:9.5px}table.info td{padding:2px 4px}table.items{width:100%;border-collapse:collapse;margin-bottom:14px}table.items th{background:#003087;color:white;padding:5px 4px;font-size:8.5px;text-align:center;border:1px solid #ccc}table.items td{padding:4px 4px;border:1px solid #ddd;font-size:8.5px;vertical-align:top}.total-row td{background:#f1f5f9;font-weight:700}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}.page{max-width:none}}</style></head><body>
<div class="print-bar">📊 TUG-15 Laporan Mutasi Stok siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div class="doctitle">
  <h2>PT PLN (PERSERO) — ${UIT}</h2>
  <div class="sub">LAPORAN MUTASI STOK MATERIAL — TUG 15</div>
  <div class="sub" style="margin-top:4px">Periode: ${periodLabel} | Barang: ${filterKatalogLabel} | Kategori: ${filterSAPLabel} | Jenis: ${filterJenisLabel} | Digenerate: ${generated}</div>
</div>
<table class="items">
  <thead><tr>
    <th style="width:3%">No</th>
    <th style="width:7%">No Katalog</th>
    <th style="width:13%">Deskripsi Material</th>
    <th style="width:5%">Status SAP</th>
    <th style="width:5%">Jenis Barang</th>
    <th style="width:4%">Merk</th>
    <th style="width:4%">Type</th>
    <th style="width:4%">Satuan</th>
    <th style="width:6%">Valuasi</th>
    <th style="width:5%">Saldo Awal</th>
    <th style="width:5%">Stok Masuk</th>
    <th style="width:5%">Stok Keluar</th>
    <th style="width:5%">Saldo Akhir</th>
    <th style="width:6%">UPT</th>
    <th style="width:9%">TUG/BA & Tgl</th>
    <th style="width:9%">Keterangan</th>
    <th style="width:6%">Tanggal Mutasi</th>
  </tr></thead>
  <tbody>
    ${itemRows}
    <tr class="total-row">
      <td colspan="10" style="text-align:right;padding:5px 8px">TOTAL PERIODE</td>
      <td style="text-align:center;color:#16a34a">${fmtNum(totalMasuk)}</td>
      <td style="text-align:center;color:#dc2626">${fmtNum(totalKeluar)}</td>
      <td colspan="5"></td>
    </tr>
  </tbody>
</table>
<div style="font-size:9px;color:#6b7280;text-align:right">Total ${rows.length} baris mutasi • Digenerate otomatis dari sistem PLN TUG Digital</div>
</div></body></html>`;
}
