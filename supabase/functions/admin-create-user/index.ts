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

const VALID_ROLES = ["ADMIN","TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN_ULTG","MGR_ULTG","PENGADAAN","VIEWER"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerAuth.user.id).single();
    if (!callerProfile || callerProfile.role !== "ADMIN") {
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

    if (!username || !/^[a-z0-9._-]+$/.test(username)) {
      return json({ ok: false, error: "Username wajib diisi, huruf kecil/angka tanpa spasi." });
    }
    if (!password || password.length < 6) {
      return json({ ok: false, error: "Password wajib diisi, minimal 6 karakter." });
    }
    if (!name) return json({ ok: false, error: "Nama lengkap wajib diisi." });
    if (!jabatan) return json({ ok: false, error: "Jabatan wajib diisi." });
    if (!uptId) return json({ ok: false, error: "UPT wajib dipilih." });
    if (!VALID_ROLES.includes(role)) {
      return json({ ok: false, error: `Role tidak dikenal. Pilihan valid: ${VALID_ROLES.join(", ")}` });
    }
    if ((role === "ADMIN_ULTG" || role === "MGR_ULTG") && !ultgId) {
      return json({ ok: false, error: `Role ${role} wajib memilih unit ULTG.` });
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
      username, name, role, jabatan, upt_id: uptId, ultg_id: ultgId,
    }).eq("id", userId);
    if (profErr) {
      return json({ ok: false, error: `Akun Auth dibuat tapi gagal menyimpan profil: ${profErr.message}` });
    }

    return json({ ok: true, userId, username });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
