// @ts-nocheck — file ini jalan di runtime Deno (Supabase Edge Functions),
// bukan Node/Vite seperti sisa proyek, jadi `Deno` global dan import
// esm.sh tidak dikenali TypeScript checker bawaan VS Code di sini.
//
// Supabase Edge Function — Admin mendaftarkan akun user baru dari dalam
// aplikasi WARNOTO (menu "Kelola Akun"), tanpa perlu buka Supabase Dashboard.
//
// Kenapa harus lewat Edge Function (bukan supabase.auth.signUp() langsung
// dari browser): signUp() akan MENIMPA sesi browser yang sedang login (Admin
// ke-logout diam-diam, tergantikan sesi user baru). Membuat user lain tanpa
// mengganggu sesi pemanggil wajib lewat Admin API (auth.admin.createUser),
// yang butuh service_role key — TIDAK BOLEH ada di browser, makanya di sini.
//
// Alur create-user (create Auth user -> trigger on_auth_user_created bikin
// stub profile role VIEWER -> UPDATE profile dengan data asli) sama persis
// dengan scripts/bulk_create_users.mjs, cuma versi 1 user per call + dipanggil
// dari UI, bukan CSV dari CLI.
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy admin-create-user --project-ref tadxodrzoquugnsyejld
//   (SENGAJA TANPA --no-verify-jwt — endpoint ini cuma boleh dipanggil oleh
//   user yang sudah login lewat Supabase Auth, bukan pihak ketiga seperti
//   webhook WA/Telegram. Verifikasi platform baru memastikan "user login",
//   otorisasi role ADMIN tetap dicek manual di bawah.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AUTH_EMAIL_DOMAIN = "@warnoto.pln.local"; // harus SAMA PERSIS dengan App.jsx

const VALID_ROLES = ["ADMIN","TL","ASMAN","MANAGER","ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT","ADMIN_LOG_PUSAT","ADMIN_ULTG","MGR_ULTG","PENGADAAN","OPERATOR","VIEWER","SUPERADMIN"];

// Kuota role per UPT — 1 unit UPT hanya boleh punya 1 orang di posisi kunci
// ini sekaligus, supaya tidak ada rangkap jabatan struktural. Hard limit:
// ditolak total kalau slot penuh, Admin wajib turunkan role user lama dulu
// (bukan auto-downgrade, sesuai preferensi WARNOTO: review-first).
const UPT_ROLE_QUOTA = { MANAGER: 1, ASMAN: 1, TL: 1, ADMIN: 1, PENGADAAN: 1 };
// Kuota role per UIT — sama prinsipnya, level di atas UPT. PENGADAAN dibagi 2
// scope independen (UPT vs UIT), dibedakan lewat upt_id vs uit_id yang terisi
// (lihat pengecekan di bawah), bukan role value yang berbeda.
const UIT_ROLE_QUOTA = { ADMIN_UIT: 5, ASMAN_LOG_UIT: 1, MGR_LOGISTIK_UIT: 1, PENGADAAN: 1 }; // ADMIN_LOG_PUSAT nasional, tidak terikat 1 UIT
const ROLE_LABELS = { ADMIN: "Admin Gudang", TL: "TL Logistik", ASMAN: "Asman Konstruksi", MANAGER: "Manager", PENGADAAN: "Tim Pengadaan", ADMIN_UIT: "Admin UIT", MGR_LOGISTIK_UIT: "Manager Logistik UIT", ASMAN_LOG_UIT: "Asman Logistik UIT", ADMIN_LOG_PUSAT: "Admin Logistik Pusat", OPERATOR: "Operator Alat" };
const UIT_SCOPED_ROLES = ["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"]; // PENGADAAN scope UIT ditentukan lewat body.pengadaanScope, bukan role tetap
// Peran nasional (Pusat): lingkupnya seluruh UPT dan UIT, jadi TIDAK terikat
// upt_id maupun uit_id. Tanpa cabang ini akun Pusat dipaksa memilih satu UPT
// dan menyimpan upt_id yang salah secara semantik.
const NATIONAL_ROLES = ["ADMIN_LOG_PUSAT"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Scope UPT: ADMIN hanya boleh kelola akun di UPT sendiri, SUPERADMIN lintas-UPT
// bebas. targetUptLama/targetUptBaru dibandingkan terpisah supaya ADMIN tidak
// bisa mengedit akun yang SEKARANG di UPT lain walau body-nya dikirim seolah
// upt_id tujuan = UPT sendiri (lihat pemakaian di admin-update-user).
function bolehKelolaAkun(callerRole: string, callerUptId: string | null, targetUptLama: string | null, targetUptBaru: string | null): boolean {
  if (callerRole === "SUPERADMIN") return true;
  return targetUptLama === callerUptId && targetUptBaru === callerUptId;
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    // ── 1. Pastikan pemanggil login DAN role-nya ADMIN ──
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Tidak ada sesi login." }, 401);

    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth?.user) return json({ ok: false, error: "Sesi login tidak valid, silakan login ulang." }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role, upt_id").eq("id", callerAuth.user.id).single();
    if (!callerProfile || (callerProfile.role !== "ADMIN" && callerProfile.role !== "SUPERADMIN")) {
      return json({ ok: false, error: "Hanya Admin yang bisa mendaftarkan akun baru." }, 403);
    }

    // ── 2. Validasi input ──
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim().toUpperCase();
    const jabatan = body.jabatan ? String(body.jabatan).trim() : null;
    const uptId = body.uptId ? String(body.uptId).trim() : null;
    const ultgId = body.ultgId ? String(body.ultgId).trim() : null;
    const uitId = body.uitId ? String(body.uitId).trim() : null;
    // Cuma relevan kalau role===PENGADAAN — role ini punya 2 slot kuota independen
    // (1 di UPT, 1 di UIT), dibedakan lewat field mana yang diisi, bukan role value beda.
    const pengadaanScope = String(body.pengadaanScope || "UPT").trim().toUpperCase();
    // Batasan akses per gudang (RBAC tingkat 2): null/undefined = semua gudang;
    // selain itu WAJIB array of string (id gudang).
    const gudangIdsRaw = body.gudangIds;
    if (gudangIdsRaw !== null && gudangIdsRaw !== undefined &&
        (!Array.isArray(gudangIdsRaw) || gudangIdsRaw.some((x) => typeof x !== "string"))) {
      return json({ ok: false, error: "gudangIds harus null atau array id gudang (string)." });
    }
    const gudangIds = (Array.isArray(gudangIdsRaw) && gudangIdsRaw.length) ? gudangIdsRaw : null;

    if (!username || !/^[a-z0-9._-]+$/.test(username)) {
      return json({ ok: false, error: "Username wajib diisi, huruf kecil/angka tanpa spasi." });
    }
    if (!password || password.length < 6) {
      return json({ ok: false, error: "Password wajib diisi, minimal 6 karakter." });
    }
    if (!name) return json({ ok: false, error: "Nama lengkap wajib diisi." });
    if (!jabatan) return json({ ok: false, error: "Jabatan wajib diisi." });
    if (!VALID_ROLES.includes(role)) {
      return json({ ok: false, error: `Role tidak dikenal. Pilihan valid: ${VALID_ROLES.join(", ")}` });
    }
    if (role === "SUPERADMIN") {
      return json({ ok: false, error: "Role SUPERADMIN tidak bisa dibuat lewat menu ini — hubungi pengelola sistem." });
    }
    if ((role === "ADMIN_ULTG" || role === "MGR_ULTG") && !ultgId) {
      return json({ ok: false, error: `Role ${role} wajib memilih unit ULTG.` });
    }

    // ── 2a. Scope UPT — ADMIN (bukan SUPERADMIN) hanya boleh buat akun di UPT sendiri.
    //        Role nasional/UIT-scoped tidak punya uptId (null) -> otomatis ditolak untuk
    //        ADMIN biasa, karena null !== callerProfile.upt_id.
    if (!bolehKelolaAkun(callerProfile.role, callerProfile.upt_id, uptId, uptId)) {
      return json({ ok: false, error: "ADMIN hanya boleh mengelola akun di UPT sendiri." }, 403);
    }

    // Role level-UIT (ADMIN_UIT/ASMAN_LOG_UIT/MGR_LOGISTIK_UIT) dan PENGADAAN mode UIT pakai
    // uitId, bukan uptId — field-nya saling eksklusif di form Kelola Akun.
    const isNational = NATIONAL_ROLES.includes(role);
    const isUitScoped = UIT_SCOPED_ROLES.includes(role) || (role === "PENGADAAN" && pengadaanScope === "UIT");
    if (isNational) {
      // Lingkup nasional — tidak memilih UPT maupun UIT.
    } else if (isUitScoped) {
      if (!uitId) return json({ ok: false, error: `Role ${ROLE_LABELS[role] || role} wajib memilih unit UIT.` });
    } else {
      if (!uptId) return json({ ok: false, error: "UPT wajib dipilih." });
    }

    // ── 2b. Kuota role per UPT/UIT (hard limit) — peran nasional tidak dikuotakan
    //        per unit karena tidak punya upt_id/uit_id untuk dijadikan pembanding.
    if (isNational) {
      // tanpa kuota per unit
    } else if (isUitScoped) {
      if (UIT_ROLE_QUOTA[role] !== undefined) {
        const { data: existing, error: quotaErr } = await admin
          .from("profiles").select("name").eq("role", role).eq("uit_id", uitId);
        if (quotaErr) return json({ ok: false, error: `Gagal memeriksa kuota role: ${quotaErr.message}` });
        if ((existing?.length || 0) >= UIT_ROLE_QUOTA[role]) {
          const holder = existing[0]?.name || "user lain";
          return json({ ok: false, error: `UIT ini sudah punya ${ROLE_LABELS[role]}: ${holder}. Turunkan role user tersebut dulu sebelum menetapkan yang baru.` });
        }
      }
    } else if (UPT_ROLE_QUOTA[role] !== undefined) {
      const { data: existing, error: quotaErr } = await admin
        .from("profiles").select("name").eq("role", role).eq("upt_id", uptId);
      if (quotaErr) return json({ ok: false, error: `Gagal memeriksa kuota role: ${quotaErr.message}` });
      if ((existing?.length || 0) >= UPT_ROLE_QUOTA[role]) {
        const holder = existing[0]?.name || "user lain";
        return json({ ok: false, error: `UPT ini sudah punya ${ROLE_LABELS[role]}: ${holder}. Turunkan role user tersebut dulu sebelum menetapkan yang baru.` });
      }
    }

    // ── 3. Buat akun Auth ──
    const email = `${username}${AUTH_EMAIL_DOMAIN}`;
    const { data: createData, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) {
      const msg = String(createErr.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        return json({ ok: false, error: `Username "${username}" sudah terdaftar. Gunakan username lain.` });
      }
      return json({ ok: false, error: `Gagal membuat akun: ${createErr.message}` });
    }
    const userId = createData.user.id;

    // ── 4. Trigger on_auth_user_created sudah bikin stub profile (role VIEWER) —
    //        timpa dengan data asli dari form ──
    const { error: profErr } = await admin.from("profiles").update({
      username, name, role, jabatan,
      upt_id: (isNational || isUitScoped) ? null : uptId,
      ultg_id: ultgId,
      uit_id: isUitScoped ? uitId : null,
      gudang_ids: gudangIds,
    }).eq("id", userId);
    if (profErr) {
      return json({ ok: false, error: `Akun Auth dibuat tapi gagal menyimpan profil: ${profErr.message}` });
    }

    return json({ ok: true, userId, username });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
