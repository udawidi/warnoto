// WARNOTO — Loader generik: import cleaned_history.json (hasil clean_warnoto_history.py)
// ke tabel arsip `legacy_history_archive` (supabase/schema.sql, section 26).
//
// Arsip READ-ONLY, terpisah dari transaksi live (tug15_history) — TIDAK divalidasi
// ulang ke katalog aktif. Ambil SEMUA baris `transaksi_all_clean` (bukan cuma yang
// "import_ready", supaya jejak historis lengkap termasuk yang beranomali tetap
// tersimpan — anomali cukup transparan lewat issue_flags/match_confidence).
//
// Reusable untuk UPT manapun (workbook AppSheet template sama, beda data).
//
// Cara pakai:
//   DRY-RUN (default aman, TIDAK menulis ke Supabase — cuma print ringkasan):
//     node migration-tools/load_legacy_history_to_supabase.mjs <cleaned.json> --dry-run
//   COMMIT (benar-benar upsert ke legacy_history_archive):
//     node migration-tools/load_legacy_history_to_supabase.mjs <cleaned.json>
//   Filter 1 UPT saja (case-insensitive match ke field `upt` di JSON):
//     node migration-tools/load_legacy_history_to_supabase.mjs <cleaned.json> --upt "UPT Surabaya"
//
// Env vars (pola sama dgn scripts/nightly_sync.mjs):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (service_role — insert/upsert HANYA lewat ini,
//   bukan anon key, sesuai policy RLS di schema.sql yang tidak mengizinkan write publik).

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const CHUNK_SIZE = 500;

function parseArgs(argv) {
  const args = { jsonPath: null, upt: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--upt") args.upt = argv[++i];
    else if (!args.jsonPath) args.jsonPath = a;
  }
  return args;
}

function mapRow(row) {
  return {
    source_app: "appsheet_warnoto",
    source_upt: row.upt,
    doc_type: row.doc_type,
    doc_id: row.doc_id,
    item_id: row.item_id,
    tanggal: row.tanggal || null,
    jenis_transaksi: row.jenis_transaksi,
    no_katalog: row.no_katalog,
    nama_material: row.nama_material,
    satuan: row.satuan,
    qty: row.qty,
    unit_lawan: row.unit_lawan,
    lokasi_kode: row.lokasi_kode,
    catatan: row.catatan,
    link_foto: row.link_foto,
    match_confidence: row.confidence,
    issue_flags: row.issue_flags,
    sync_key: row.sync_key,
    imported_by: "migration-script",
  };
}

function summarize(rows) {
  const perUpt = {};
  const perDocType = {};
  for (const r of rows) {
    const upt = r.source_upt || "(kosong)";
    const dt = r.doc_type || "(kosong)";
    perUpt[upt] = (perUpt[upt] || 0) + 1;
    perDocType[dt] = (perDocType[dt] || 0) + 1;
  }
  return { total: rows.length, per_source_upt: perUpt, per_doc_type: perDocType };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jsonPath) {
    console.error("Pemakaian: node load_legacy_history_to_supabase.mjs <path-cleaned.json> [--upt \"<Nama UPT>\"] [--dry-run]");
    process.exit(1);
  }

  const jsonPath = path.resolve(args.jsonPath);
  if (!fs.existsSync(jsonPath)) {
    console.error(`File tidak ditemukan: ${jsonPath}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.error(`File JSON tidak valid: ${jsonPath}`);
    console.error(err.message);
    process.exit(1);
  }

  const raw = parsed.transaksi_all_clean;
  if (!Array.isArray(raw)) {
    console.error("Key 'transaksi_all_clean' tidak ditemukan / bukan array di JSON.");
    process.exit(1);
  }

  let filtered = raw;
  if (args.upt) {
    const target = args.upt.toLowerCase();
    filtered = raw.filter((r) => (r.upt || "").toLowerCase() === target);
  }

  const rows = filtered.map(mapRow);

  if (args.dryRun) {
    console.log(`=== DRY RUN — ${rows.length} baris AKAN di-upsert ke legacy_history_archive ===`);
    console.log(JSON.stringify(summarize(rows), null, 2));
    console.log("--- Contoh 3 baris pertama ---");
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    console.log("\nDRY RUN selesai. Tidak ada perubahan ditulis ke Supabase.");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("Env var SUPABASE_URL / SUPABASE_SECRET_KEY belum di-set.");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  console.log(`Mengupsert ${rows.length} baris ke legacy_history_archive...`);
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("legacy_history_archive").upsert(chunk, { onConflict: "sync_key" });
    if (error) {
      console.error(`Gagal upsert batch ${i}-${i + chunk.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  batch ${i}-${i + chunk.length} OK`);
  }

  console.log("=== Selesai ===");
  console.log(JSON.stringify(summarize(rows), null, 2));
}

main();
