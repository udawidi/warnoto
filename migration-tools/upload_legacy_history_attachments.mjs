// WARNOTO — Upload lampiran (foto & PDF) arsip legacy AppSheet ke Supabase Storage.
//
// Melengkapi load_legacy_history_to_supabase.mjs: script itu memuat BARIS transaksi,
// script ini memuat FILE-nya. Sumber file = hasil ekstrak backup AppSheet lama
// (D:\CLAUDE\WARNOTO data\Appsheet\_extracted\data\<APP_INSTANCE>\...), sumber
// metadata = cleaned_history.json (key `dokumen_header` + `foto_barang_relpath`
// di `transaksi_all_clean`).
//
// Dua bucket, sesuai sensitivitas data (lihat supabase/schema.sql section 27):
//   - tug-docs-private : foto SIM/KTP sopir + PDF dokumen → disimpan `priv:<path>`
//                        (signed URL di-generate on-demand oleh UI, bukan di sini).
//   - tug-photos       : foto surat jalan/permintaan/pengembalian, kendaraan,
//                        dan foto barang → public URL langsung.
//
// Cara pakai:
//   DRY-RUN (default aman, TIDAK upload & TIDAK menulis DB — cuma laporan match-rate):
//     node migration-tools/upload_legacy_history_attachments.mjs <cleaned.json> [<extracted-root>] --dry-run
//   COMMIT:
//     node migration-tools/upload_legacy_history_attachments.mjs <cleaned.json> [<extracted-root>] [--upt "UPT Surabaya"]
//
// Env vars: SUPABASE_URL, SUPABASE_SECRET_KEY (service_role — RLS tidak mengizinkan write publik).

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const DEFAULT_EXTRACTED_ROOT = "D:\\CLAUDE\\WARNOTO data\\Appsheet\\_extracted\\data";
const BUCKET_PRIVATE = "tug-docs-private";
const BUCKET_PUBLIC = "tug-photos";

// Field header → bucket. sim_ktp & pdf privat karena memuat data pribadi sopir.
const DOC_FIELDS = [
  { field: "surat_jalan", src: "foto_surat_jalan_relpath", col: "foto_surat_jalan_url", private: false },
  { field: "sim_ktp", src: "foto_sim_ktp_relpath", col: "foto_sim_ktp_url", private: true },
  { field: "kendaraan", src: "foto_kendaraan_relpath", col: "foto_kendaraan_url", private: false },
  { field: "pdf", src: "pdf_relpath", col: "pdf_url", private: true },
  { field: "berita_acara", src: "berita_acara_relpath", col: "berita_acara_url", private: true },
  { field: "lampiran", src: "lampiran_relpath", col: "lampiran_url", private: true },
];

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function parseArgs(argv) {
  const args = { jsonPath: null, root: null, upt: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--upt") args.upt = argv[++i];
    else if (!args.jsonPath) args.jsonPath = a;
    else if (!args.root) args.root = a;
  }
  return args;
}

function sanitizeSegment(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]/g, "-");
}

// Hanya folder lampiran AppSheet yang di-scan (mis. "TUG 9_Images", "Files/TUG9",
// "USER GUIDE_Files_") — sisanya (folder "content" dsb) dilewati supaya index ringan.
function isAttachmentSegment(name) {
  return /^(files|images)$/i.test(name) || /(_images|_files_?)$/i.test(name);
}

function buildIndex(root) {
  const index = new Map(); // basename lowercase -> [{ fullPath, appInstance }]
  const walk = (dir, appInstance, inAttachment) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, appInstance ?? entry.name, inAttachment || isAttachmentSegment(entry.name));
      } else if (inAttachment) {
        const key = entry.name.toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ fullPath: full, appInstance: appInstance ?? "(root)" });
      }
    }
  };
  walk(root, null, false);
  // Urutan stabil & predictable: app-instance descending (WARNOTOV2 = snapshot terbaru menang).
  for (const list of index.values()) {
    list.sort((a, b) => b.appInstance.localeCompare(a.appInstance) || a.fullPath.localeCompare(b.fullPath));
  }
  return index;
}

const hashCache = new Map();
function fileHash(p) {
  if (!hashCache.has(p)) {
    hashCache.set(p, crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex"));
  }
  return hashCache.get(p);
}

// ponytail: ambiguous-file collision resolved by picking first candidate after identical-hash check; manual review via match_notes if throughput of collisions becomes a problem
function resolveFile(index, relpath) {
  if (!relpath) return { status: "kosong" };
  const base = path.basename(String(relpath).replace(/\\/g, "/")).toLowerCase();
  const candidates = index.get(base);
  if (!candidates || candidates.length === 0) return { status: "tidak_ketemu" };
  const picked = candidates[0];
  if (candidates.length === 1) return { status: "match", file: picked.fullPath, appInstance: picked.appInstance };
  const hashes = new Set(candidates.map((c) => fileHash(c.fullPath)));
  if (hashes.size === 1) {
    return {
      status: "match",
      file: picked.fullPath,
      appInstance: picked.appInstance,
      note: `duplikat identik, ${candidates.length} kandidat`,
    };
  }
  return {
    status: "ambigu",
    file: picked.fullPath,
    appInstance: picked.appInstance,
    note: `AMBIGU: ${candidates.length} kandidat beda isi, dipilih dari ${picked.appInstance}`,
  };
}

function emptyStat() {
  return { kosong: 0, match: 0, tidak_ketemu: 0, ambigu: 0, dari_duplikat_identik: 0 };
}

async function uploadOne(supabase, localPath, storagePath, isPrivate) {
  const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET_PUBLIC;
  const ext = path.extname(storagePath).toLowerCase();
  const { error } = await supabase.storage.from(bucket).upload(storagePath, fs.readFileSync(localPath), {
    contentType: MIME[ext] || "application/octet-stream",
    upsert: true,
  });
  if (error) throw new Error(`upload ${bucket}/${storagePath}: ${error.message}`);
  return isPrivate ? `priv:${storagePath}` : supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jsonPath) {
    console.error(
      'Pemakaian: node upload_legacy_history_attachments.mjs <cleaned.json> [<extracted-root-dir>] [--upt "<Nama UPT>"] [--dry-run]'
    );
    process.exit(1);
  }
  const jsonPath = path.resolve(args.jsonPath);
  if (!fs.existsSync(jsonPath)) {
    console.error(`File JSON tidak ditemukan: ${jsonPath}`);
    process.exit(1);
  }
  const root = path.resolve(args.root || DEFAULT_EXTRACTED_ROOT);
  if (!fs.existsSync(root)) {
    console.error(`Folder hasil ekstrak tidak ditemukan: ${root}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.error(`File JSON tidak valid: ${jsonPath}\n${err.message}`);
    process.exit(1);
  }

  const target = args.upt ? args.upt.toLowerCase() : null;
  const docs = (parsed.dokumen_header || []).filter(
    (d) => !target || (d.source_upt || "").toLowerCase() === target
  );
  const items = (parsed.transaksi_all_clean || []).filter(
    (t) => !target || (t.upt || "").toLowerCase() === target
  );

  console.log(`Membangun index file dari ${root} ...`);
  const index = buildIndex(root);
  console.log(`Index: ${index.size} nama file unik.\n`);

  const stats = Object.fromEntries([...DOC_FIELDS.map((f) => f.field), "foto_barang"].map((f) => [f, emptyStat()]));
  const ambiguSamples = [];

  // Resolve dulu semua (dipakai untuk laporan dry-run maupun upload).
  const docPlans = docs.map((doc) => {
    const notes = [];
    const resolved = {};
    for (const f of DOC_FIELDS) {
      const r = resolveFile(index, doc[f.src]);
      stats[f.field][r.status] += 1;
      if (r.status === "match" && r.note) stats[f.field].dari_duplikat_identik += 1;
      if (r.note) {
        notes.push(`${f.field}: ${r.note}`);
        if (r.status === "ambigu" && ambiguSamples.length < 3) {
          ambiguSamples.push(`${doc.doc_type} ${doc.doc_id} — ${f.field}: ${r.note}`);
        }
      }
      if (r.status === "tidak_ketemu") notes.push(`${f.field}: file tidak ditemukan`);
      resolved[f.field] = r;
    }
    return { doc, resolved, notes };
  });

  const itemPlans = items
    .filter((t) => t.foto_barang_relpath)
    .map((t) => {
      const r = resolveFile(index, t.foto_barang_relpath);
      stats.foto_barang[r.status] += 1;
      if (r.status === "match" && r.note) stats.foto_barang.dari_duplikat_identik += 1;
      if (r.status === "ambigu" && ambiguSamples.length < 3) {
        ambiguSamples.push(`item ${t.doc_type} ${t.item_id} — foto_barang: ${r.note}`);
      }
      return { tx: t, resolved: r };
    });
  stats.foto_barang.kosong = items.length - itemPlans.length;

  console.log(`=== Dokumen header: ${docs.length} | baris transaksi: ${items.length} ===`);
  console.log(JSON.stringify(stats, null, 2));
  if (ambiguSamples.length) {
    console.log("--- Contoh kasus ambigu ---");
    ambiguSamples.forEach((s) => console.log("  " + s));
  }

  if (args.dryRun) {
    console.log("\nDRY RUN selesai. Tidak ada file diupload & tidak ada perubahan DB.");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("Env var SUPABASE_URL / SUPABASE_SECRET_KEY belum di-set.");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  console.log(`\nMengupload lampiran ${docPlans.length} dokumen...`);
  for (const plan of docPlans) {
    const { doc } = plan;
    const row = {
      source_app: "appsheet_warnoto",
      source_upt: doc.source_upt,
      doc_type: doc.doc_type,
      doc_id: doc.doc_id,
      match_notes: plan.notes.join("; ") || null,
      imported_by: "migration-script",
    };
    const docDir = `legacy/${sanitizeSegment(doc.doc_type)}/${sanitizeSegment(doc.doc_id)}`;
    for (const f of DOC_FIELDS) {
      const r = plan.resolved[f.field];
      if (r.status !== "match" && r.status !== "ambigu") continue;
      const storagePath = `${docDir}/${f.field}${path.extname(r.file).toLowerCase()}`;
      row[f.col] = await uploadOne(supabase, r.file, storagePath, f.private);
    }
    const { error } = await supabase.from("legacy_history_documents").upsert(row, { onConflict: "doc_type,doc_id" });
    if (error) {
      console.error(`Gagal upsert ${doc.doc_type} ${doc.doc_id}: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`Mengupload ${itemPlans.length} foto barang...`);
  for (const { tx, resolved } of itemPlans) {
    if (resolved.status !== "match" && resolved.status !== "ambigu") continue;
    const storagePath = `legacy/${sanitizeSegment(tx.doc_type)}/item/${sanitizeSegment(tx.item_id)}${path
      .extname(resolved.file)
      .toLowerCase()}`;
    const url = await uploadOne(supabase, resolved.file, storagePath, false);
    // UPDATE saja — baris arsipnya harus sudah ada dari load_legacy_history_to_supabase.mjs.
    const { data, error } = await supabase
      .from("legacy_history_archive")
      .update({ foto_barang_url: url })
      .eq("sync_key", tx.sync_key)
      .select("id");
    if (error) {
      console.error(`Gagal update foto_barang_url ${tx.sync_key}: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) {
      console.warn(`  WARNING: sync_key ${tx.sync_key} belum ada di legacy_history_archive — dilewati.`);
    }
  }

  console.log("=== Selesai ===");
}

main();
