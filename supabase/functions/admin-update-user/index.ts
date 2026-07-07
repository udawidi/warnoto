// Supabase Edge Function — Admin mengubah profil user yang sudah ada dari
// menu "Kelola Akun" (nama, role, jabatan, UPT, ULTG, dan reset password
// opsional). Username TIDAK bisa diubah di sini karena terikat ke email
// login Supabase Auth (username@warnoto.pln.local) — ganti username berarti
// ganti email akun, di luar cakupan form edit ini.
//
// Kenapa lewat Edge Function (bukan supabase.from("profiles").update()
// langsung dari browser): tabel profiles SENGAJA tidak punya RLS policy
// insert/update untuk role authenticated biasa (lihat schema.sql), supaya
// user tidak bisa menaikkan role-nya sendiri lewat console browser. Admin
// pun tetap "authenticated" di level Postgres, jadi update tetap harus lewat
// service_role di server ini, dengan otorisasi role ADMIN dicek manual.
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy admin-update-user --project-ref tadxodrzoquugnsyejld

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
      return json({ ok: false, error: "Hanya Admin yang bisa mengubah akun." }, 403);
    }

    // ── 2. Validasi input ──
    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId || "").trim();
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim().toUpperCase();
    const jabatan = body.jabatan ? String(body.jabatan).trim() : null;
    const uptId = body.uptId ? String(body.uptId).trim() : null;
    const ultgId = body.ultgId ? String(body.ultgId).trim() : null;
    const newPassword = body.newPassword ? String(body.newPassword) : "";

    if (!userId) return json({ ok: false, error: "userId wajib diisi." });
    if (!name) return json({ ok: false, error: "Nama lengkap wajib diisi." });
    if (!jabatan) return json({ ok: false, error: "Jabatan wajib diisi." });
    if (!uptId) return json({ ok: false, error: "UPT wajib dipilih." });
    if (!VALID_ROLES.includes(role)) {
      return json({ ok: false, error: `Role tidak dikenal. Pilihan valid: ${VALID_ROLES.join(", ")}` });
    }
    if ((role === "ADMIN_ULTG" || role === "MGR_ULTG") && !ultgId) {
      return json({ ok: false, error: `Role ${role} wajib memilih unit ULTG.` });
    }
    if (newPassword && newPassword.length < 6) {
      return json({ ok: false, error: "Password baru minimal 6 karakter." });
    }

    // ── 3. Update profil ──
    const { error: profErr } = await admin.from("profiles").update({
      name, role, jabatan, upt_id: uptId, ultg_id: ultgId,
    }).eq("id", userId);
    if (profErr) return json({ ok: false, error: `Gagal menyimpan profil: ${profErr.message}` });

    // ── 4. Reset password (opsional) ──
    if (newPassword) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (pwErr) return json({ ok: false, error: `Profil tersimpan tapi gagal reset password: ${pwErr.message}` });
    }

    return json({ ok: true, userId });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
