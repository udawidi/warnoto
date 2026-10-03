// WARNOTO — Buat embedding visual (Cohere) untuk foto stok UPT BARU yang belum
// punya embedding, supaya "Cari dengan Foto" mode Bentuk (kemiripan) bekerja
// untuk material di luar UPT Surabaya.
//
// Target: stocks dengan id LIKE 'STK-SAP-361%' (Malang/Madiun/Probolinggo/Bali)
// ATAU data->>uptId = 'UPT-GRS' (Gresik). Foto (data.fotoKeseluruhan/fotoNameplate)
// SUDAH ada di Storage — skrip ini cuma download, embed (Cohere), lalu upsert ke
// stock_photo_embeddings. TIDAK mengunggah foto baru.
//
// --all: sapu SEMUA UPT (bukan cuma 361%/Gresik) — untuk cron maintenance tiap
// 3 hari, supaya foto baru di UPT mana pun ikut ter-index otomatis. Idempoten
// (skip id yang sudah ada), aman dijalankan berulang.
//
// Cara pakai:
//   node scripts/embed_stock_photos.mjs                # dry-run (hitung saja, tak panggil Cohere)
//   node scripts/embed_stock_photos.mjs --commit        # embed + tulis ke DB (UPT baru saja)
//   node scripts/embed_stock_photos.mjs --all --commit  # embed semua UPT (cron)
//   node scripts/embed_stock_photos.mjs --commit --limit 2   # uji dulu
//   node scripts/embed_stock_photos.mjs --commit --force     # re-embed walau id sudah ada
//
// Butuh: NEW_SUPABASE_URL + NEW_SUPABASE_SECRET_KEY (service_role, wajib utk tulis
// embedding — RLS), COHERE_API_KEY (atau VITE_COHERE_API_KEY di .env).

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { cohereEmbedImage } from "./lib/cohere.mjs";
import { DEFAULT_UPT_LIST } from "../src/data/masterUpt.js";

// ── env (pola sama seperti migrate_material_photos.mjs — .env CRLF-safe) ──────
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

const SUPABASE_URL = process.env.NEW_SUPABASE_URL || dotenv.NEW_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEW_SUPABASE_SECRET_KEY || dotenv.NEW_SUPABASE_SECRET_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY || dotenv.COHERE_API_KEY || dotenv.VITE_COHERE_API_KEY;
const OCRSPACE_API_KEY = process.env.OCRSPACE_API_KEY || dotenv.OCRSPACE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Butuh NEW_SUPABASE_URL + NEW_SUPABASE_SECRET_KEY (service_role, .env atau env var).");
  process.exit(1);
}

const COMMIT = process.argv.includes("--commit");
const FORCE = process.argv.includes("--force");
const ALL = process.argv.includes("--all");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0; // 0 = semua

if (COMMIT && !COHERE_API_KEY) {
  console.error("❌ Mode --commit butuh COHERE_API_KEY (atau VITE_COHERE_API_KEY di .env).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// plant SAP (id STK-SAP-<plant>-...) → nama UPT tampilan (konvensi sama seperti "UPT Surabaya")
const PLANT_TO_UPT = {
  "3612": "UPT Malang",
  "3613": "UPT Madiun",
  "3614": "UPT Probolinggo",
  "3615": "UPT Bali",
};
const GRESIK_UPT = "UPT Gresik";
// --all: resolusi data.uptId → nama tampilan lewat master UPT (satu sumber kebenaran).
const UPTID_TO_NAMA = new Map(DEFAULT_UPT_LIST.map((u) => [u.id, u.nama]));
const UPT_NAMA_TO_ID = new Map([...UPTID_TO_NAMA.entries()].map(([id, nama]) => [nama, id]));

function uptSlug(nama) {
  return nama.toLowerCase().replace(/\s+/g, "-");
}

// Retry 429 (rate limit Cohere) — pola sama seperti migrate_material_photos.mjs.
async function embedImageWithRetry(dataUri, attempt = 0) {
  try {
    return await cohereEmbedImage(dataUri, COHERE_API_KEY);
  } catch (e) {
    if (e.status !== 429) throw e;
    if (attempt >= 15) throw new Error("Cohere 429 berulang — limit trial sangat ketat.");
    const waitMs = 65000;
    console.log(`    ⏳ rate limit Cohere, tunggu ${waitMs / 1000}s lalu ulang (percobaan ${attempt + 1}) ...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return embedImageWithRetry(dataUri, attempt + 1);
  }
}

async function main() {
  console.log(`WARNOTO — Embed foto stok (${ALL ? "--all" : "UPT baru"}, ${COMMIT ? "COMMIT" : "DRY-RUN"})\n`);

  const jobs = []; // {id, uptId, upt, katalog, source, photoUrl, ocr}
  const stockRowsForOpname = [];

  if (ALL) {
    // Ambil semua identity stok supaya opname dapat dipetakan walau stok belum
    // punya foto utama; job embedding tetap hanya dibuat bila ada URL foto.
    const { data: rows, error: allErr } = await supabase
      .from("stocks").select("id,upt_id,data");
    if (allErr) { console.error("❌ Gagal baca stocks (--all):", allErr.message); process.exit(1); }
    let unknownUpt = 0;
    for (const s of rows || []) {
      stockRowsForOpname.push(s);
      const uptId = s.upt_id || s.data?.uptId;
      const nama = UPTID_TO_NAMA.get(uptId) || uptId;
      if (!uptId || !nama) { unknownUpt++; continue; }
      pushJobs(jobs, s, uptId, nama);
    }
    if (unknownUpt) console.log(`(lewati ${unknownUpt} baris: uptId tak dikenal)`);
  } else {
    // 1. Ambil stok target: 4 UPT baru (id STK-SAP-361%) + Gresik (data.uptId='UPT-GRS').
    const { data: sap, error: sapErr } = await supabase
      .from("stocks").select("id,upt_id,data").like("id", "STK-SAP-361%");
    if (sapErr) { console.error("❌ Gagal baca stocks (SAP):", sapErr.message); process.exit(1); }
    const { data: grs, error: grsErr } = await supabase
      .from("stocks").select("id,upt_id,data").filter("data->>uptId", "eq", "UPT-GRS");
    if (grsErr) { console.error("❌ Gagal baca stocks (Gresik):", grsErr.message); process.exit(1); }

    // 2. Bangun daftar foto (katalog, upt, source, url) dari kedua kelompok.
    for (const s of sap || []) {
      stockRowsForOpname.push(s);
      const plant = (s.id.match(/^STK-SAP-(\d{4})-/) || [])[1];
      const upt = PLANT_TO_UPT[plant];
      if (!upt) continue; // plant lain di luar daftar — jangan sentuh (termasuk Surabaya)
      pushJobs(jobs, s, UPT_NAMA_TO_ID.get(upt) || s.upt_id || s.data?.uptId, upt);
    }
    for (const s of grs || []) { stockRowsForOpname.push(s); pushJobs(jobs, s, s.upt_id || s.data?.uptId || "UPT-GRS", GRESIK_UPT); }
  }

  // Foto historis hanya ikut AI setelah sesi benar-benar SELESAI.
  const { data: opnameRows, error: opnameErr } = await supabase
    .from("stock_opname").select("id,upt_id,data").eq("status", "SELESAI");
  if (opnameErr) { console.error("❌ Gagal baca stock_opname:", opnameErr.message); process.exit(1); }
  for (const row of opnameRows || []) pushOpnameJobs(jobs, row, stockRowsForOpname);

  // Dedup by id: banyak baris stok (lokasi berbeda) berbagi katalog yang sama →
  // foto per katalog, jangan embed berkali-kali untuk katalog yang sama.
  const seen = new Set();
  const uniqJobs = jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));

  if (!uniqJobs.length) { console.log("Tidak ada foto ditemukan untuk UPT target."); return; }

  // 3. Skip yang sudah ada embedding-nya (resume), kecuali --force.
  const { data: existing, error: exErr } = await supabase
    .from("stock_photo_embeddings").select("id,photo_url,ocr_text");
  if (exErr) { console.error("❌ Gagal baca stock_photo_embeddings:", exErr.message); process.exit(1); }
  const existingById = new Map((existing || []).map((r) => [r.id, r]));

  const perUpt = {};
  const todo = [];
  for (const j of uniqJobs) {
    perUpt[j.upt] = perUpt[j.upt] || { total: 0, todo: 0, done: 0 };
    perUpt[j.upt].total++;
    const prior = existingById.get(j.id);
    if (!FORCE && prior?.photo_url === j.photoUrl && (!j.ocr || prior.ocr_text || !OCRSPACE_API_KEY)) { perUpt[j.upt].done++; continue; }
    perUpt[j.upt].todo++;
    todo.push(j);
  }

  console.log("── RINGKASAN PER UPT ─────────────────────────────────────");
  for (const [upt, c] of Object.entries(perUpt)) {
    console.log(`${upt.padEnd(20)} total foto: ${c.total}  sudah ada embedding: ${c.done}  akan di-embed: ${c.todo}`);
  }
  console.log(`\nTotal akan di-embed: ${todo.length}${LIMIT ? ` (dibatasi --limit ${LIMIT})` : ""}\n`);

  if (!COMMIT) { console.log("✔ DRY-RUN selesai. Jalankan dengan --commit untuk benar-benar meng-embed."); return; }

  const list = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  let done = 0, failed = 0;
  for (const j of list) {
    try {
      const res = await fetch(j.photoUrl);
      if (!res.ok) throw new Error(`download gagal ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type") || "image/jpeg";
      const vec = await embedImageWithRetry(`data:${mime};base64,${buf.toString("base64")}`);

      const ocrText = j.ocr ? await ocrNameplate(j.photoUrl) : null;
      const { error: upErr } = await supabase.from("stock_photo_embeddings").upsert(
        [{ id: j.id, upt_id: j.uptId, upt: j.upt, katalog: j.katalog, source: j.source, photo_url: j.photoUrl, embedding: vec, ocr_text: ocrText, updated_at: new Date().toISOString() }],
        { onConflict: "id" }
      );
      if (upErr) throw new Error("upsert: " + upErr.message);
      done++;
      if (done % 25 === 0) console.log(`  ... ${done}/${list.length}`);
      await new Promise((r) => setTimeout(r, 200)); // jeda rate-limit Cohere
    } catch (e) {
      failed++;
      console.error(`  ✗ ${j.id}:`, e.message);
    }
  }
  console.log(`\n✅ Embedding dibuat: ${done}  |  gagal: ${failed}  |  dilewati (sudah ada, non --force): ${uniqJobs.length - todo.length}`);
  console.log("✔ COMMIT selesai.");
}

function pushJobs(jobs, stockRow, uptId, upt) {
  const d = stockRow.data || {};
  const katalog = String(d.katalog ?? "").trim();
  if (!katalog || !uptId) return;
  const slug = uptSlug(uptId);
  if (d.fotoKeseluruhan) jobs.push({ id: `spe_${slug}_${katalog}_utama`, uptId, upt, katalog, source: "utama", photoUrl: d.fotoKeseluruhan });
  if (d.fotoNameplate) jobs.push({ id: `spe_${slug}_${katalog}_tambahan`, uptId, upt, katalog, source: "tambahan", photoUrl: d.fotoNameplate, ocr: true });
}

function pushOpnameJobs(jobs, opnameRow, stockRows) {
  const data = opnameRow.data || {};
  const uptId = opnameRow.upt_id || data.uptId || data.upt_id;
  if (!uptId || data.status && data.status !== "SELESAI") return;
  const upt = UPTID_TO_NAMA.get(uptId) || uptId;
  for (const [index, item] of (data.items || []).entries()) {
    const exact = item.stockId ? (stockRows || []).find(row => String(row.id) === String(item.stockId) && (row.upt_id || row.data?.uptId) === uptId) : null;
    const itemCode = String(item.katalogId || "").trim();
    const itemKatalog = String(item.noKatalog || "").trim();
    const candidates = (stockRows || []).filter(row => {
      if ((row.upt_id || row.data?.uptId) !== uptId) return false;
      const rowId = String(row.data?.katalogId || "").trim();
      const rowCode = String(row.data?.katalog || "").trim();
      return (itemCode && rowId === itemCode) || (itemKatalog && rowCode === itemKatalog);
    });
    const stock = exact || (candidates.length === 1 ? candidates[0] : null);
    const katalog = String(item.noKatalog || stock?.data?.katalog || "").trim();
    if (!katalog) continue;
    const key = String(item.stockId || item.katalogId || item.noKatalog || index).replace(/[^a-zA-Z0-9_-]+/g, "-");
    const slug = uptSlug(uptId);
    if (item.fotoKeseluruhan) jobs.push({ id: `spe_${slug}_opname_${opnameRow.id}_${key}_utama`, uptId, upt, katalog, source: "opname-utama", photoUrl: item.fotoKeseluruhan });
    if (item.fotoNameplate) jobs.push({ id: `spe_${slug}_opname_${opnameRow.id}_${key}_nameplate`, uptId, upt, katalog, source: "opname-nameplate", photoUrl: item.fotoNameplate, ocr: true });
  }
}

async function ocrNameplate(photoUrl) {
  if (!OCRSPACE_API_KEY) return null;
  const res = await fetch(photoUrl);
  if (!res.ok) throw new Error(`download OCR gagal ${res.status}`);
  const blob = new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") || "image/jpeg" });
  const form = new FormData();
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("file", blob, "nameplate.jpg");
  const response = await fetch("https://api.ocr.space/parse/image", { method: "POST", headers: { apikey: OCRSPACE_API_KEY }, body: form });
  if (!response.ok) throw new Error(`OCR.space gagal ${response.status}`);
  const data = await response.json();
  return (data.ParsedResults || []).map(row => row.ParsedText || "").join("\n").trim();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
