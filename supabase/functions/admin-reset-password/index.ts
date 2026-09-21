// @ts-nocheck — runtime Deno (Supabase Edge Functions), lihat catatan sama
// di supabase/functions/admin-create-user/index.ts.
//
// Reset password milik user lain — dipisah dari admin-update-user supaya
// gagal validasi profil (kuota role, UPT, dsb) TIDAK ikut membatalkan reset
// password. Aksi TUNGGAL: ganti password via service_role, TIDAK menyentuh
// tabel profiles sama sekali.
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy admin-reset-password --project-ref <ref>
//   (TANPA --no-verify-jwt — sama alasannya dgn admin-create-user: pemanggil
//   wajib sudah login, otorisasi role ADMIN/SUPERADMIN dicek manual di bawah.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Scope UPT: ADMIN hanya boleh reset password akun di UPT sendiri, SUPERADMIN
// lintas-UPT bebas (sama pola dengan admin-update-user).
function bolehKelolaAkun(callerRole: string, callerUptId: string | null, targetUptId: string | null): boolean {
  if (callerRole === "SUPERADMIN") return true;
  return targetUptId === callerUptId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    // ── 1. Pastikan pemanggil login DAN role-nya ADMIN/SUPERADMIN ──
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Tidak ada sesi login." }, 401);

    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth?.user) return json({ ok: false, error: "Sesi login tidak valid, silakan login ulang." }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role, upt_id").eq("id", callerAuth.user.id).single();
    if (!callerProfile || (callerProfile.role !== "ADMIN" && callerProfile.role !== "SUPERADMIN")) {
      return json({ ok: false, error: "Hanya Admin yang bisa mereset password akun lain." }, 403);
    }

    // ── 2. Validasi input ──
    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId || "").trim();
    const newPassword = String(body.newPassword || "");
    if (!userId) return json({ ok: false, error: "userId wajib diisi." });
    if (newPassword.length < 6) return json({ ok: false, error: "Password baru minimal 6 karakter." });

    // ── 2a. Scope UPT — ADMIN (bukan SUPERADMIN) hanya boleh reset akun di UPT sendiri.
    const { data: targetProfile, error: targetErr } = await admin.from("profiles").select("upt_id").eq("id", userId).single();
    if (targetErr || !targetProfile) return json({ ok: false, error: "Akun target tidak ditemukan." }, 404);
    if (!bolehKelolaAkun(callerProfile.role, callerProfile.upt_id, targetProfile.upt_id)) {
      return json({ ok: false, error: "ADMIN hanya boleh mereset password akun di UPT sendiri." }, 403);
    }

    // ── 3. Ganti password (TIDAK menyentuh tabel profiles) ──
    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (pwErr) return json({ ok: false, error: `Gagal reset password: ${pwErr.message}` });

    return json({ ok: true, userId });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
