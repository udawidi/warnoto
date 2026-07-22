// WARNOTO — Rekreasi Auth users dari FILE EXPORT ke Supabase BARU (self-host).
//
// Konteks (rencana migrasi full self-host, section 4.3):
//   pg_restore membawa tabel `profiles` apa adanya, TAPI auth.users TIDAK bisa di-restore
//   langsung lewat SQL biasa (GoTrue yang mengelola hash password). Jadi 9 user auth
//   dibuat ulang lewat Admin API — DENGAN mempertahankan UUID asli DAN hash password asli.
//
// Sumber data: FILE JSON hasil export manual (arsitek), BUKAN dibaca lewat PostgREST.
//   Alasan: schema `auth` di Supabase cloud TIDAK di-expose ke PostgREST (default hanya
//   'public'/'graphql_public'), jadi oldClient.schema("auth").from("users") TERBUKTI tidak
//   pernah bisa. Arsitek mengambil 9 baris via akses SQL terpisah lalu menyimpannya sebagai
//   JSON array — script ini cukup membaca file itu (tidak perlu koneksi ke instance LAMA,
//   tidak perlu dependency `pg` baru).
//
// Diverifikasi (bukan asumsi):
//   - @supabase/supabase-js@2.108.2 punya field `id` DAN `password_hash` di createUser()
//     (dicek langsung di node_modules type defs).
//   - Hash password asli semua user berformat bcrypt standar ($2a$10$) yang kompatibel
//     dengan GoTrue self-host → TIDAK perlu reset password sama sekali.
//   Karena `id` dipertahankan persis, baris `profiles` hasil restore tetap cocok — script
//   ini TIDAK menyentuh tabel profiles sama sekali (trigger handle_new_auth_user di DB baru
//   ON CONFLICT (id) DO NOTHING, jadi profil existing aman).
//
// Jauh lebih sederhana dari bulk_create_users.mjs: TANPA CSV, TANPA generate password,
// TANPA logika SUPERADMIN/kuota — UUID & role dipertahankan apa adanya, tidak ada re-derivasi.
//
// Cara pakai:
//   DRY-RUN (default — tampilkan daftar user yang AKAN dibuat, TIDAK memanggil createUser):
//     node scripts/migrate_auth_users.mjs --input-file <path-ke-json>
//   COMMIT (benar-benar buat user di instance baru):
//     node scripts/migrate_auth_users.mjs --input-file <path-ke-json> --commit
//
//   --input-file <path>  WAJIB. File JSON berisi array of object:
//                        [{ id, email, encrypted_password, email_confirmed? }, ...]
//                        (email_confirmed opsional, default true). File ini bersifat
//                        sementara/manual — JANGAN commit ke git, biarkan di lokasinya.
//
// Env vars (hanya TUJUAN — instance LAMA tidak diakses sama sekali oleh script ini):
//   NEW_SUPABASE_URL         URL instance self-host (tujuan)
//   NEW_SUPABASE_SECRET_KEY  service_role key instance baru (untuk auth.admin.createUser)
// (boleh di .env — .env tidak ikut git; jangan hardcode key). Env tujuan hanya WAJIB
// saat --commit; dry-run cukup baca file (tidak menyentuh jaringan sama sekali).

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// ── env (pola sama dgn script lain: process.env dulu, fallback .env) ──
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

const NEW_URL = env("NEW_SUPABASE_URL").replace(/\/$/, "");
const NEW_KEY = env("NEW_SUPABASE_SECRET_KEY");

const COMMIT = process.argv.includes("--commit");
const inputIdx = process.argv.indexOf("--input-file");
const INPUT_FILE = inputIdx >= 0 ? process.argv[inputIdx + 1] : null;

// --input-file WAJIB (tidak ada default — path export ini sementara/manual).
if (!INPUT_FILE) {
  console.error("❌ --input-file <path-ke-json> WAJIB diisi.");
  console.error("   Contoh: node scripts/migrate_auth_users.mjs --input-file ./auth_users_export.json --dry-run");
  console.error("   File JSON: array of { id, email, encrypted_password, email_confirmed? }.");
  process.exit(1);
}
if (!fs.existsSync(INPUT_FILE)) {
  console.error(`❌ File input tidak ditemukan: ${INPUT_FILE}`);
  process.exit(1);
}
// Env tujuan hanya wajib saat commit; dry-run tidak menyentuh jaringan.
if (COMMIT && (!NEW_URL || !NEW_KEY)) {
  console.error("❌ Mode --commit butuh env tujuan: NEW_SUPABASE_URL & NEW_SUPABASE_SECRET_KEY (service_role).");
  process.exit(1);
}

const newClient = NEW_URL && NEW_KEY
  ? createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Sensor hash untuk log (jangan tumpahkan hash penuh ke stdout — ini data produksi asli).
function maskHash(h) {
  if (!h) return "(kosong)";
  const s = String(h);
  return s.length <= 12 ? s : `${s.slice(0, 7)}…${s.slice(-4)} (${s.length} char)`;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`WARNOTO — Rekreasi Auth users (${COMMIT ? "COMMIT — MENULIS ke instance baru" : "DRY-RUN — read-only"})\n`);
  console.log("Sumber (file) :", INPUT_FILE);
  console.log("Tujuan (baru) :", NEW_URL || "(belum di-set — dry-run tetap jalan)");
  console.log("");

  // 1. Baca & parse file export.
  console.log("Membaca daftar user dari file export...");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
  } catch (e) {
    console.error(`❌ Gagal parse JSON dari ${INPUT_FILE}: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error("❌ Format file salah: isi harus ARRAY of object { id, email, encrypted_password, email_confirmed? }.");
    process.exit(1);
  }
  if (raw.length === 0) {
    console.error("❌ File export 0 baris — tidak ada yang bisa dimigrasi. Berhenti.");
    process.exit(1);
  }

  // Validasi bentuk minimal tiap baris: id, email, encrypted_password wajib ada.
  const invalid = [];
  raw.forEach((u, i) => {
    if (!u || typeof u !== "object") { invalid.push({ i, reason: "bukan object" }); return; }
    const miss = [];
    if (!u.id) miss.push("id");
    if (!u.email) miss.push("email");
    if (!u.encrypted_password) miss.push("encrypted_password");
    if (miss.length) invalid.push({ i, reason: `field kosong: ${miss.join(", ")}` });
  });
  if (invalid.length) {
    console.error(`❌ ${invalid.length} baris tidak valid — berhenti sebelum memproses apa pun:`);
    invalid.forEach((v) => console.error(`   - baris index ${v.i}: ${v.reason}`));
    process.exit(1);
  }

  // Normalisasi + validasi hash bcrypt ($2a/$2b/$2y). email_confirmed default true.
  const rows = raw.map((u) => {
    const hash = u.encrypted_password || "";
    return {
      id: u.id,
      email: u.email,
      encrypted_password: hash,
      email_confirmed: u.email_confirmed === undefined ? true : !!u.email_confirmed,
      bcryptOk: /^\$2[aby]\$/.test(hash),
    };
  });

  console.log(`\n── ${rows.length} user akan dibuat di instance baru ──────────────`);
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${r.email.padEnd(38)} id=${r.id}` +
      `  hash=${maskHash(r.encrypted_password)}${r.bcryptOk ? "" : "  ⚠️ BUKAN bcrypt!"}` +
      `${r.email_confirmed ? "" : "  ⚠️ email belum confirmed di sumber"}`
    );
  });
  const nonBcrypt = rows.filter((r) => !r.bcryptOk);
  if (nonBcrypt.length) {
    console.log(`\n⚠️  ${nonBcrypt.length} user hash-nya BUKAN format bcrypt $2[aby]$ — di luar asumsi rencana.`);
    console.log("   Tetap dilaporkan; arsitek putuskan sebelum commit (jangan asal migrasi).");
  }

  // 2. DRY-RUN: berhenti di sini, tidak memanggil createUser sama sekali.
  if (!COMMIT) {
    console.log("\n✔ DRY-RUN selesai. TIDAK ada user yang dibuat. Jalankan --commit setelah instance baru siap.");
    return;
  }

  // 3. COMMIT: buat tiap user di instance BARU dengan id + password_hash asli.
  console.log(`\n── MODE COMMIT: membuat ${rows.length} user di ${NEW_URL} ──────`);
  let created = 0;
  const failures = [];
  for (const r of rows) {
    const { data, error: cErr } = await newClient.auth.admin.createUser({
      id: r.id,
      email: r.email,
      password_hash: r.encrypted_password,
      email_confirm: r.email_confirmed,
    });
    if (cErr) {
      failures.push({ email: r.email, id: r.id, error: cErr.message });
      console.error(`  ✗ ${r.email}: ${cErr.message}`);
    } else {
      created++;
      console.log(`  ✅ ${r.email} (id=${data?.user?.id || r.id})`);
    }
  }

  console.log(`\n── HASIL ─────────────────────────────────────────────────`);
  console.log(`Berhasil dibuat : ${created} / ${rows.length}`);
  console.log(`Gagal           : ${failures.length}`);
  if (failures.length) {
    console.log("\nDaftar gagal (error PERSIS — TIDAK di-retry otomatis, arsitek yang putuskan):");
    failures.forEach((f) => console.log(`  - ${f.email} (id=${f.id}): ${f.error}`));
    process.exitCode = 1;
  }
  console.log("\nCatatan: tabel `profiles` sengaja TIDAK disentuh (sudah direstore via pg_restore;");
  console.log("id dipertahankan → trigger ON CONFLICT (id) DO NOTHING menjaga profil tetap utuh).");
  console.log("\n✔ COMMIT selesai.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
