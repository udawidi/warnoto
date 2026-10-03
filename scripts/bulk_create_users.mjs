// WARNOTO — Bulk-daftarkan banyak akun user sekaligus dari 1 file CSV.
//
// Kenapa butuh script ini (bukan cuma SQL manual): Supabase Auth (auth.users)
// TIDAK BISA di-insert langsung lewat SQL biasa (password harus di-hash lewat
// GoTrue API, bukan kolom biasa) — harus lewat Admin API (createUser), yang
// butuh service_role key. Setelah user Auth dibuat, trigger di schema.sql
// (on_auth_user_created) otomatis bikin baris stub di `profiles` (role
// default VIEWER) — script ini lanjut UPDATE baris itu dengan data asli
// (name/role/jabatan/upt_id/ultg_id) dari CSV, dalam 1 kali jalan untuk
// banyak user sekaligus.
//
// Cara pakai:
//   1. Isi file users.csv (contoh: scripts/users.template.csv) — jangan commit
//      file CSV asli berisi password ke git (sudah masuk .gitignore kalau ada,
//      cek dulu manual kalau belum).
//   2. Jalankan:
//      SUPABASE_URL=https://xxx.supabase.co SUPABASE_SECRET_KEY=<service_role_key> \
//      node scripts/bulk_create_users.mjs scripts/users.csv
//
// Kolom CSV (header wajib persis ini, urutan bebas):
//   username,password,name,role,jabatan,upt_id,ultg_id,uit_id,pengadaan_scope
//   - username        : dipakai login (tanpa "@..."), huruf kecil, tanpa spasi
//   - password        : minimal 6 karakter (syarat Supabase Auth)
//   - name            : nama tampilan
//   - role            : ADMIN / TL / ASMAN / MANAGER / ADMIN_UIT / ASMAN_LOG_UIT /
//                       MGR_LOGISTIK_UIT / ADMIN_LOG_PUSAT / ADMIN_ULTG / MGR_ULTG /
//                       PENGADAAN / VIEWER
//                       (SUPERADMIN TIDAK BISA didaftarkan lewat script ini — manual SQL/Dashboard saja)
//   - jabatan         : opsional, boleh kosong
//   - upt_id          : wajib untuk role scope-UPT (ADMIN/TL/ASMAN/MANAGER, PENGADAAN mode UPT)
//   - ultg_id         : WAJIB diisi untuk role ADMIN_ULTG / MGR_ULTG, selain itu boleh kosong
//   - uit_id          : wajib untuk role ADMIN_UIT / ASMAN_LOG_UIT / MGR_LOGISTIK_UIT, atau
//                       PENGADAAN mode UIT. ADMIN_LOG_PUSAT nasional — tidak perlu uit_id.
//   - pengadaan_scope : "UPT" (default) atau "UIT" — cuma relevan kalau role=PENGADAAN, menentukan
//                       field mana (upt_id atau uit_id) yang dipakai & kuota mana yang dicek

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const AUTH_EMAIL_DOMAIN = "@warnoto.pln.local"; // harus SAMA PERSIS dengan AUTH_EMAIL_DOMAIN di App.jsx

const VALID_ROLES = ["ADMIN","TL","ASMAN","MANAGER","ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT","ADMIN_LOG_PUSAT","ADMIN_ULTG","MGR_ULTG","PENGADAAN","VIEWER","SUPERADMIN","RENEV"];

// Kuota role per UPT/UIT (hard limit) — sama seperti admin-create-user/admin-update-user,
// supaya batch import CSV tidak bisa bikin 2 Manager/Asman/TL/Admin/Pengadaan di 1 UPT/UIT
// yang sama, konsisten dengan validasi yang sudah aktif di menu Kelola Akun.
const UPT_ROLE_QUOTA = { MANAGER: 1, ASMAN: 1, TL: 1, ADMIN: 1, PENGADAAN: 1 };
const UIT_ROLE_QUOTA = { ADMIN_UIT: 1, ASMAN_LOG_UIT: 1, MGR_LOGISTIK_UIT: 1, PENGADAAN: 1 }; // ADMIN_LOG_PUSAT nasional, tidak terikat 1 UIT
const UIT_SCOPED_ROLES = ["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"];
const ROLE_LABELS = { ADMIN: "Admin Gudang", TL: "TL Logistik", ASMAN: "Asman Konstruksi", MANAGER: "Manager", PENGADAAN: "Tim Pengadaan", ADMIN_UIT: "Admin UIT", MGR_LOGISTIK_UIT: "Manager Logistik UIT", ASMAN_LOG_UIT: "Asman Logistik UIT", ADMIN_LOG_PUSAT: "Admin Logistik Pusat" };

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Env var SUPABASE_URL / SUPABASE_SECRET_KEY (service_role) belum di-set.");
  console.error("Cara dapat service_role key: Supabase Dashboard -> Project Settings -> API -> service_role (SECRET, jangan dipakai di App.jsx/browser).");
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/bulk_create_users.mjs <path-ke-file.csv>");
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File tidak ditemukan: ${csvPath}`);
  process.exit(1);
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length > 0);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  console.log(`Membaca ${rows.length} baris dari ${csvPath}...\n`);

  let created = 0, updated = 0, skipped = 0, failed = 0;

  // Baseline kuota role per UPT/UIT dari data yang sudah ada di database, supaya
  // baris CSV yang bentrok dengan akun existing (bukan cuma sesama baris CSV)
  // ikut tertangkap. key = "ROLE|upt:<id>" atau "ROLE|uit:<id>" -> {username, name}.
  const quotaRoles = [...new Set([...Object.keys(UPT_ROLE_QUOTA), ...Object.keys(UIT_ROLE_QUOTA)])];
  const { data: existingProfiles } = await supabase.from("profiles")
    .select("username, role, upt_id, uit_id, name").in("role", quotaRoles);
  const quotaHolder = new Map();
  for (const p of existingProfiles || []) {
    if (p.upt_id) {
      const key = `${p.role}|upt:${p.upt_id}`;
      if (!quotaHolder.has(key)) quotaHolder.set(key, { username: p.username, name: p.name });
    }
    if (p.uit_id) {
      const key = `${p.role}|uit:${p.uit_id}`;
      if (!quotaHolder.has(key)) quotaHolder.set(key, { username: p.username, name: p.name });
    }
  }

  for (const row of rows) {
    const username = (row.username || "").trim().toLowerCase();
    const password = row.password || "";
    const name = row.name || username;
    const role = (row.role || "VIEWER").trim().toUpperCase();
    const jabatan = row.jabatan || null;
    const uptIdRaw = row.upt_id || null;
    const ultgId = row.ultg_id || null;
    const uitIdRaw = row.uit_id || null;
    const pengadaanScope = (row.pengadaan_scope || "UPT").trim().toUpperCase();

    if (!username || !password) {
      console.log(`⚠️  Skip baris (username/password kosong): ${JSON.stringify(row)}`);
      skipped++; continue;
    }
    if (!VALID_ROLES.includes(role)) {
      console.log(`⚠️  Skip "${username}": role "${role}" tidak dikenal. Pilihan valid: ${VALID_ROLES.join(", ")}`);
      skipped++; continue;
    }
    if (role === "SUPERADMIN") {
      console.log(`⚠️  Skip "${username}": role SUPERADMIN tidak bisa didaftarkan lewat script ini — pakai SQL/Dashboard manual.`);
      skipped++; continue;
    }
    if ((role === "ADMIN_ULTG" || role === "MGR_ULTG") && !ultgId) {
      console.log(`⚠️  "${username}" role ${role} WAJIB isi ultg_id di CSV — dilewati dulu, isi kolom ultg_id lalu jalankan ulang untuk baris ini.`);
      skipped++; continue;
    }

    const isUitScoped = UIT_SCOPED_ROLES.includes(role) || (role === "PENGADAAN" && pengadaanScope === "UIT");
    const uptId = isUitScoped ? null : uptIdRaw;
    const uitId = isUitScoped ? uitIdRaw : null;
    if (isUitScoped && !uitId) {
      console.log(`⚠️  "${username}" role ${ROLE_LABELS[role]||role} WAJIB isi uit_id di CSV — dilewati.`);
      skipped++; continue;
    }
    if (!isUitScoped && !uptId) {
      console.log(`⚠️  "${username}" role ${ROLE_LABELS[role]||role} WAJIB isi upt_id di CSV — dilewati.`);
      skipped++; continue;
    }

    if (isUitScoped ? UIT_ROLE_QUOTA[role] !== undefined : UPT_ROLE_QUOTA[role] !== undefined) {
      const quotaKey = isUitScoped ? `${role}|uit:${uitId}` : `${role}|upt:${uptId}`;
      const holder = quotaHolder.get(quotaKey);
      if (holder && holder.username !== username) {
        const unitLabel = isUitScoped ? "UIT" : "UPT";
        console.log(`⚠️  Skip "${username}": ${unitLabel} ini sudah punya ${ROLE_LABELS[role]||role} (${holder.name}, username "${holder.username}"). Turunkan role user itu dulu sebelum daftarkan yang baru.`);
        skipped++; continue;
      }
    }

    const email = `${username}${AUTH_EMAIL_DOMAIN}`;

    // 1. Buat user Auth (kalau sudah ada, createUser akan error "already registered" — lanjut ke update profil saja)
    let userId = null;
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) {
      if (String(createErr.message||"").toLowerCase().includes("already") || String(createErr.message||"").toLowerCase().includes("registered")) {
        // Sudah ada — cari user_id-nya lewat listUsers (tidak ada getUserByEmail langsung di semua versi SDK)
        const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = list?.users?.find(u => u.email === email);
        if (!found) { console.log(`❌ "${username}": gagal buat user & tidak ketemu user existing (${createErr.message})`); failed++; continue; }
        userId = found.id;
        console.log(`ℹ️  "${username}": akun Auth sudah ada, lanjut update profil saja.`);
      } else {
        console.log(`❌ "${username}": gagal buat akun Auth — ${createErr.message}`);
        failed++; continue;
      }
    } else {
      userId = createData.user.id;
      created++;
      console.log(`✅ "${username}": akun Auth dibuat (${email}).`);
    }

    // 2. Update profil (trigger sudah bikin stub role VIEWER, timpa dengan data asli dari CSV)
    const { error: profErr } = await supabase.from("profiles").update({
      username, name, role, jabatan, upt_id: uptId, ultg_id: ultgId, uit_id: uitId,
    }).eq("id", userId);
    if (profErr) {
      console.log(`❌ "${username}": akun Auth OK tapi gagal update profil — ${profErr.message}`);
      failed++; continue;
    }
    updated++;
    if (isUitScoped ? UIT_ROLE_QUOTA[role] !== undefined : UPT_ROLE_QUOTA[role] !== undefined) {
      const quotaKey = isUitScoped ? `${role}|uit:${uitId}` : `${role}|upt:${uptId}`;
      quotaHolder.set(quotaKey, { username, name });
    }
    console.log(`   → profil diperbarui: ${name}, role ${role}${jabatan?`, jabatan ${jabatan}`:""}${uptId?`, upt_id ${uptId}`:""}${ultgId?`, ultg_id ${ultgId}`:""}${uitId?`, uit_id ${uitId}`:""}`);
  }

  console.log(`\nSelesai. ${created} akun baru dibuat, ${updated} profil diperbarui, ${skipped} dilewati, ${failed} gagal.`);
  if (failed > 0) process.exitCode = 1;
}

run();
