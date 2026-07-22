// WARNOTO — Migrasi FILE FISIK Storage dari Supabase LAMA (cloud) ke Supabase BARU (self-host).
//
// Konteks (rencana migrasi full self-host, section 4.2):
//   pg_dump hanya membawa METADATA storage.objects, TIDAK pernah membawa byte file-nya.
//   Merestore metadata tanpa file = "ghost 404" (baris menunjuk file yang tidak pernah ada).
//   Script ini menyalin byte FILE-nya langsung Supabase→Supabase: DOWNLOAD dari cloud (lama),
//   lalu UPLOAD ke instance baru dengan bucket + path SAMA PERSIS.
//
// Beda dari migrate_material_photos.mjs (yang upload dari file LOKAL AppSheet):
//   sumbernya di sini adalah Supabase cloud, bukan disk lokal — dua arah Supabase↔Supabase.
//   Pola upload (raw fetch POST + x-upsert) & pola resumable (skip yang sudah ada) DIWARISI
//   persis dari script itu supaya konsisten & terbukti jalan.
//
// 4 bucket yang dimigrasi (lihat supabase/schema.sql):
//   - material-photos   (PUBLIK)  → download via public URL (tanpa auth)
//   - stock-photos      (PUBLIK)  → download via public URL (tanpa auth)
//   - tug-photos        (PUBLIK)  → download via public URL (tanpa auth)
//   - tug-docs-private  (PRIVAT)  → download via .download() pakai service_role key lama
//
// Cara pakai:
//   DRY-RUN (default, TIDAK menulis apa pun — cuma hitung jumlah file + total ukuran):
//     node scripts/migrate_storage_buckets.mjs
//   COMMIT (benar-benar download dari lama → upload ke baru):
//     node scripts/migrate_storage_buckets.mjs --commit
//
//   Opsi tambahan:
//     --bucket <nama>   proses HANYA 1 bucket (default: keempat-empatnya)
//     --force           upload ulang walau file sudah ada di instance baru (default: skip)
//     --limit <n>       batasi jumlah file per bucket (untuk uji coba kecil)
//
// Env vars (WAJIB SEPASANG — script butuh KEDUA instance sekaligus, jangan pakai nama
// generic SUPABASE_URL yang ambigu dipakai buat yang mana):
//   OLD_SUPABASE_URL         URL Supabase cloud (sumber),  cth https://xxx.supabase.co
//   OLD_SUPABASE_SECRET_KEY  service_role key cloud (dipakai untuk list + download bucket privat)
//   NEW_SUPABASE_URL         URL instance self-host (tujuan)
//   NEW_SUPABASE_SECRET_KEY  service_role key instance baru (dipakai untuk upload)
// (semua boleh diletakkan di .env — file .env tidak ikut git; jangan hardcode key di sini)

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// ── env (pola sama dgn migrate_material_photos.mjs: process.env dulu, fallback .env) ──
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
const env = (k) => process.env[k] || dotenv[k] || "";

const OLD_URL = env("OLD_SUPABASE_URL").replace(/\/$/, "");
const OLD_KEY = env("OLD_SUPABASE_SECRET_KEY");
const NEW_URL = env("NEW_SUPABASE_URL").replace(/\/$/, "");
const NEW_KEY = env("NEW_SUPABASE_SECRET_KEY");

// ── argumen ───────────────────────────────────────────────────────────────────
const COMMIT = process.argv.includes("--commit");
const FORCE = process.argv.includes("--force");
const bucketArgIdx = process.argv.indexOf("--bucket");
const ONLY_BUCKET = bucketArgIdx >= 0 ? process.argv[bucketArgIdx + 1] : null;
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0; // 0 = semua

const PUBLIC_BUCKETS = ["material-photos", "stock-photos", "tug-photos"];
const PRIVATE_BUCKETS = ["tug-docs-private"];
let BUCKETS = [...PUBLIC_BUCKETS, ...PRIVATE_BUCKETS];
if (ONLY_BUCKET) {
  if (!BUCKETS.includes(ONLY_BUCKET)) {
    console.error(`❌ --bucket "${ONLY_BUCKET}" tidak dikenal. Pilihan: ${BUCKETS.join(", ")}`);
    process.exit(1);
  }
  BUCKETS = [ONLY_BUCKET];
}
const isPrivate = (b) => PRIVATE_BUCKETS.includes(b);

// ── validasi env: SUMBER (lama) wajib untuk dry-run maupun commit ───────────────
// Dry-run cukup baca dari cloud (list + ukuran). TUJUAN (baru) hanya wajib saat --commit
// (dan saat dry-run kalau ingin laporan "berapa yang sudah ada di tujuan").
if (!OLD_URL || !OLD_KEY) {
  console.error("❌ Env sumber (cloud lama) belum lengkap.");
  console.error("   Butuh: OLD_SUPABASE_URL & OLD_SUPABASE_SECRET_KEY (service_role cloud).");
  console.error("   Set di .env atau lewat environment, lalu jalankan ulang.");
  process.exit(1);
}
if (COMMIT && (!NEW_URL || !NEW_KEY)) {
  console.error("❌ Mode --commit butuh env tujuan (instance baru): NEW_SUPABASE_URL & NEW_SUPABASE_SECRET_KEY (service_role).");
  console.error("   Tanpa itu tidak ada tujuan upload. Isi dulu env-nya lalu jalankan ulang.");
  process.exit(1);
}

const oldClient = createClient(OLD_URL, OLD_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Client tujuan hanya dibuat kalau kredensialnya ada (dry-run boleh tanpa tujuan).
const newClient = NEW_URL && NEW_KEY
  ? createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// ── util ────────────────────────────────────────────────────────────────────
const PAGE = 100;
const MIME_BY_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
  ".heic": "image/heic", ".bmp": "image/bmp", ".tiff": "image/tiff",
};
function guessMime(p, fallback) {
  if (fallback) return fallback;
  const ext = (String(p).match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}
function fmtMB(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

// Enumerasi REKURSIF semua objek dalam sebuah bucket (subfolder ikut ditelusuri).
// supabase-js .list() mengembalikan folder sebagai item ber-id null (metadata null);
// file punya id (uuid) + metadata.size/mimetype. Placeholder .emptyFolderPlaceholder
// yang dibuat otomatis Supabase dilewati.
async function listBucketRecursive(client, bucket, prefix = "") {
  const files = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: PAGE, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list ${bucket}/${prefix || "(root)"}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      if (item.name === ".emptyFolderPlaceholder") continue;
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      const looksFolder = item.id == null && !item.metadata; // folder placeholder
      if (looksFolder) {
        const sub = await listBucketRecursive(client, bucket, full);
        files.push(...sub);
      } else {
        files.push({
          path: full,
          size: item.metadata?.size ?? null,
          mimetype: item.metadata?.mimetype ?? null,
        });
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return files;
}

// Set path yang SUDAH ada di bucket tujuan → untuk skip (resumable), mirror pola
// doneIds/existingEmb di migrate_material_photos.mjs. Kalau bucket tujuan belum ada
// (mis. schema.sql belum dijalankan di instance baru), balikkan set kosong + tandai.
async function listDestExisting(bucket) {
  if (!newClient) return { set: new Set(), reachable: false };
  try {
    const existing = await listBucketRecursive(newClient, bucket);
    return { set: new Set(existing.map((f) => f.path)), reachable: true };
  } catch (e) {
    return { set: new Set(), reachable: false, error: e.message };
  }
}

// Ambil byte 1 file dari instance LAMA.
//   - bucket publik: fetch() biasa ke public URL (tanpa auth) — paling ringan.
//   - bucket privat: .download() pakai service_role lama (bypass signed-URL, aman utk migrasi).
async function downloadBytes(bucket, filePath) {
  if (isPrivate(bucket)) {
    const { data, error } = await oldClient.storage.from(bucket).download(filePath);
    if (error) throw new Error(`download privat ${bucket}/${filePath}: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  const url = `${OLD_URL}/storage/v1/object/public/${bucket}/${encodeURI(filePath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download publik ${bucket}/${filePath}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  return Buffer.from(await res.arrayBuffer());
}

// Upload byte ke instance BARU — pola raw fetch POST + x-upsert PERSIS seperti
// migrate_material_photos.mjs (idempoten, aman diulang).
async function uploadBytes(bucket, filePath, buf, mime) {
  const upUrl = `${NEW_URL}/storage/v1/object/${bucket}/${encodeURI(filePath)}`;
  const res = await fetch(upUrl, {
    method: "POST",
    headers: {
      apikey: NEW_KEY,
      Authorization: `Bearer ${NEW_KEY}`,
      "Content-Type": mime,
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload ${bucket}/${filePath}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`WARNOTO — Migrasi Storage bucket (${COMMIT ? "COMMIT — MENULIS ke instance baru" : "DRY-RUN — read-only"})\n`);
  console.log("Sumber (lama)  :", OLD_URL);
  console.log("Tujuan (baru)  :", NEW_URL || "(belum di-set — dry-run tetap jalan, hanya menghitung sumber)");
  console.log("Bucket         :", BUCKETS.join(", "));
  if (LIMIT) console.log("Limit/bucket   :", LIMIT);
  console.log("");

  const manifest = [];   // catatan semua file & statusnya (untuk audit + resume)
  const summary = [];    // ringkasan per bucket
  let grandFiles = 0, grandBytes = 0, grandUploaded = 0, grandSkipped = 0, grandFailed = 0;

  for (const bucket of BUCKETS) {
    console.log(`── Bucket: ${bucket} (${isPrivate(bucket) ? "PRIVAT" : "publik"}) ─────────────────`);

    // 1. enumerasi sumber
    let srcFiles;
    try {
      srcFiles = await listBucketRecursive(oldClient, bucket);
    } catch (e) {
      console.error(`  ❌ Gagal enumerasi bucket sumber: ${e.message}`);
      summary.push({ bucket, files: 0, note: "GAGAL list sumber: " + e.message });
      continue;
    }
    if (LIMIT > 0) srcFiles = srcFiles.slice(0, LIMIT);

    const totalBytes = srcFiles.reduce((a, f) => a + (f.size || 0), 0);
    grandFiles += srcFiles.length;
    grandBytes += totalBytes;

    // 2. cek apa yang sudah ada di tujuan (resume) — hanya kalau tujuan tersedia
    const dest = await listDestExisting(bucket);
    const alreadyThere = srcFiles.filter((f) => dest.set.has(f.path)).length;

    console.log(`  File di sumber : ${srcFiles.length}  |  total ukuran ~${fmtMB(totalBytes)}`);
    if (newClient) {
      if (dest.reachable) console.log(`  Sudah ada di tujuan : ${alreadyThere} (akan dilewati${FORCE ? ", tapi --force → tetap diupload" : ""})`);
      else console.log(`  ⚠️  Bucket tujuan belum bisa dibaca (${dest.error || "belum dibuat?"}) — jalankan schema.sql di instance baru dulu.`);
    } else {
      console.log("  (tujuan belum di-set → tidak bisa hitung yang sudah ada)");
    }

    if (!COMMIT) {
      summary.push({ bucket, files: srcFiles.length, bytes: totalBytes, alreadyThere: newClient ? alreadyThere : null });
      for (const f of srcFiles) manifest.push({ bucket, path: f.path, size: f.size, status: "dry-run" });
      console.log("");
      continue;
    }

    // 3. COMMIT — download dari lama, upload ke baru, per file (progres tak hilang bila putus)
    let uploaded = 0, skipped = 0, failed = 0;
    for (const f of srcFiles) {
      if (!FORCE && dest.set.has(f.path)) {
        skipped++;
        manifest.push({ bucket, path: f.path, size: f.size, status: "skip-exists" });
        continue;
      }
      try {
        const buf = await downloadBytes(bucket, f.path);
        const mime = guessMime(f.path, f.mimetype);
        await uploadBytes(bucket, f.path, buf, mime);
        uploaded++;
        manifest.push({ bucket, path: f.path, size: buf.length, status: "uploaded" });
        if (uploaded % 25 === 0) console.log(`  ... ${uploaded} terupload`);
      } catch (e) {
        failed++;
        manifest.push({ bucket, path: f.path, size: f.size, status: "FAILED", error: e.message });
        console.error(`  ✗ ${f.path}: ${e.message}`);
      }
    }
    console.log(`  ✅ upload baru: ${uploaded}  |  dilewati (sudah ada): ${skipped}  |  gagal: ${failed}\n`);
    grandUploaded += uploaded; grandSkipped += skipped; grandFailed += failed;
    summary.push({ bucket, files: srcFiles.length, bytes: totalBytes, uploaded, skipped, failed });
  }

  // 4. tulis manifest ke outputs/ (audit + jejak resume), pola sama dgn script existing
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.resolve(process.cwd(), "outputs");
  ensureDir(outDir);
  const manFile = path.join(outDir, `storage_migration_${COMMIT ? "commit" : "dryrun"}_${stamp}.json`);
  fs.writeFileSync(manFile, JSON.stringify({ generatedAt: new Date().toISOString(), mode: COMMIT ? "commit" : "dry-run", summary, manifest }, null, 2), "utf8");

  console.log("── RINGKASAN ─────────────────────────────────────────────");
  console.log(`Total file di sumber : ${grandFiles}  |  total ukuran ~${fmtMB(grandBytes)}`);
  if (COMMIT) console.log(`Upload baru: ${grandUploaded}  |  dilewati: ${grandSkipped}  |  gagal: ${grandFailed}`);
  console.log(`📄 Manifest: ${manFile}`);

  if (!COMMIT) {
    console.log("\n✔ DRY-RUN selesai. TIDAK ada file yang ditulis ke instance baru.");
    console.log("   Jalankan ulang dengan --commit (setelah env tujuan siap) untuk benar-benar menyalin.");
  } else {
    console.log("\n✔ COMMIT selesai.");
    if (grandFailed > 0) process.exitCode = 1;
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
