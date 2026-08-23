// WARNOTO — Migrasi foto base64 yang nyangkut di kolom `data` (jsonb) tabel
// tug3_transactions ke Supabase Storage. Akar masalah: baris dibuat saat upload
// foto belum jalan/gagal (offline/503) → base64 tersimpan mentah di DB, bikin
// `loadTug3Transactions` menarik puluhan MB tiap load (lihat App.jsx loadCloud).
//
// Field yang dicek (samakan dgn TXN_PHOTO_SLOTS + processTxnPhotos di
// src/lib/supabaseSync.js): txn-level (bucket tug-photos, KECUALI fotoSimKtp →
// tug-docs-private + prefix "priv:"), stockItems[].fotoNameplate/fotoBarangRetur/
// fotoBarang, fotoMaterial[].img (semua tug-photos).
//
// Mode DEFAULT = DRY-RUN (baca + laporkan saja, TIDAK menulis apa pun).
//   node scripts/migrate_tug3_base64_to_storage.mjs
// Eksekusi nyata (upload + update DB) — HANYA setelah dry-run dikonfirmasi:
//   node scripts/migrate_tug3_base64_to_storage.mjs --commit

import fs from "fs";
import path from "path";

function loadDotEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const dotenv = loadDotEnv();
// Prod self-host saat ini (lihat CLAUDE.md): NEW_SUPABASE_URL/SECRET_KEY di .env
// (bukan VITE_* — itu anon key, tak bisa tulis tug3_transactions/Storage privat).
const SUPABASE_URL = process.env.SUPABASE_URL || dotenv.NEW_SUPABASE_URL || dotenv.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || dotenv.NEW_SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Butuh SUPABASE_URL + SUPABASE_SECRET_KEY (service_role). Cek NEW_SUPABASE_URL/NEW_SUPABASE_SECRET_KEY di .env.");
  process.exit(1);
}
const REST = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const STORAGE = `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1`;
const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

const COMMIT = process.argv.includes("--commit");

// field txn-level → bucket (samakan persis TXN_PHOTO_SLOTS di supabaseSync.js)
const TXN_FIELDS = [
  { field: "fotoKendaraan", bucket: "tug-photos" },
  { field: "fotoSimKtp", bucket: "tug-docs-private" },
  { field: "fotoSuratPengembalian", bucket: "tug-photos" },
  { field: "fotoBAPengembalian", bucket: "tug-photos" },
  { field: "fotoSuratJalanImg", bucket: "tug-photos" },
  { field: "fotoKontrak", bucket: "tug-photos" },
];
const STOCKITEM_FIELDS = ["fotoNameplate", "fotoBarangRetur", "fotoBarang"];

const isDataUrl = (v) => typeof v === "string" && v.startsWith("data:");

function decodeDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

// Kumpulkan semua slot foto base64 dalam satu txn → {getPath, storagePath, bucket, isPriv}
function collectPhotoSlots(txnId, data) {
  const slots = [];
  for (const { field, bucket } of TXN_FIELDS) {
    if (isDataUrl(data[field])) {
      slots.push({ label: field, bucket, storagePath: `${txnId}/${field}.jpg`, get: () => data[field], set: (v) => { data[field] = v; } });
    }
  }
  (Array.isArray(data.fotoMaterial) ? data.fotoMaterial : []).forEach((fm, i) => {
    if (isDataUrl(fm?.img)) {
      slots.push({ label: `fotoMaterial[${i}].img`, bucket: "tug-photos", storagePath: `${txnId}/material-${fm.stockId}.jpg`, get: () => fm.img, set: (v) => { fm.img = v; } });
    }
  });
  (Array.isArray(data.stockItems) ? data.stockItems : []).forEach((si, idx) => {
    for (const field of STOCKITEM_FIELDS) {
      if (isDataUrl(si?.[field])) {
        slots.push({ label: `stockItems[${idx}].${field}`, bucket: "tug-photos", storagePath: `${txnId}/item${idx}-${field}.jpg`, get: () => si[field], set: (v) => { si[field] = v; } });
      }
    }
  });
  return slots;
}

async function uploadToStorage(bucket, storagePath, mime, buf) {
  const res = await fetch(`${STORAGE}/object/${bucket}/${encodeURI(storagePath)}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload gagal ${res.status}: ${await res.text()}`);
  // bucket privat → app pakai penanda "priv:<path>" (resolveTxnPrivPhotos bikin signed URL saat ditampilkan)
  return bucket === "tug-docs-private" ? `priv:${storagePath}` : `${STORAGE}/object/public/${bucket}/${storagePath}`;
}

async function main() {
  console.log(`WARNOTO — Migrasi base64 tug3_transactions → Storage (${COMMIT ? "COMMIT" : "DRY-RUN"})\n`);

  // PostgREST tak izinkan `like` langsung di kolom jsonb — filter pakai RPC-free
  // approach: `data->>` bukan opsi generik (field bervariasi), jadi tarik SEMUA baris
  // (tabel ini kecil, transaksi TUG-3 per-UPT) lalu filter base64 di sisi client.
  const res = await fetch(`${REST}/tug3_transactions?select=id,data`, { headers: HEADERS });
  if (!res.ok) { console.error("❌ Gagal fetch tug3_transactions:", res.status, await res.text()); process.exit(1); }
  const allRows = await res.json();
  const rows = allRows.filter((r) => JSON.stringify(r.data).includes("data:image"));
  console.log(`Total baris tug3_transactions: ${allRows.length}  |  mengandung base64: ${rows.length}\n`);

  if (rows.length === 0) { console.log("✔ Tidak ada baris dengan base64 di kolom data. Tidak ada yang perlu dimigrasi."); return; }

  let totalBefore = 0, totalSlots = 0;
  for (const row of rows) {
    const beforeSize = JSON.stringify(row.data).length;
    totalBefore += beforeSize;
    const slots = collectPhotoSlots(row.id, row.data);
    totalSlots += slots.length;
    console.log(`── ${row.id} ──`);
    console.log(`   ukuran data sebelum : ${(beforeSize / 1024).toFixed(1)} KB`);
    console.log(`   foto base64 ditemukan: ${slots.length}`);
    for (const s of slots) console.log(`     - ${s.label} → bucket ${s.bucket} (${s.storagePath})`);

    if (!COMMIT) continue;

    // COMMIT: upload tiap slot, ganti value jadi URL/priv:, lalu update baris.
    let failed = 0;
    for (const s of slots) {
      const dec = decodeDataUrl(s.get());
      if (!dec) { console.warn(`     ✗ ${s.label}: format data-URL tak dikenali, dilewati`); failed++; continue; }
      try {
        const newVal = await uploadToStorage(s.bucket, s.storagePath, dec.mime, dec.buf);
        s.set(newVal);
        console.log(`     ✓ ${s.label} diupload`);
      } catch (e) { console.error(`     ✗ ${s.label}:`, e.message); failed++; }
    }
    if (failed > 0) { console.error(`   ⚠ ${failed} foto gagal diupload — baris ${row.id} TIDAK diupdate (dibiarkan base64, coba lagi nanti).`); continue; }

    const putRes = await fetch(`${REST}/tug3_transactions?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { ...HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({ data: row.data, updated_at: Date.now() }),
    });
    if (!putRes.ok) console.error(`   ✗ update DB gagal:`, putRes.status, await putRes.text());
    else console.log(`   ✓ baris ${row.id} diupdate — data sekarang ${(JSON.stringify(row.data).length / 1024).toFixed(1)} KB`);
  }

  console.log(`\n── RINGKASAN ──`);
  console.log(`Baris ber-base64      : ${rows.length}`);
  console.log(`Total foto base64     : ${totalSlots}`);
  console.log(`Total ukuran sebelum  : ${(totalBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(COMMIT ? "\n✔ COMMIT selesai." : "\n✔ DRY-RUN selesai. TIDAK ada data yang diubah. Jalankan ulang dengan --commit setelah dikonfirmasi.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
