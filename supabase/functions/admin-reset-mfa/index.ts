// @ts-nocheck — runtime Deno (Supabase Edge Functions), lihat catatan sama
// di supabase/functions/admin-create-user/index.ts.
//
// Reset 2FA (TOTP) milik user lain — dipanggil dari menu "Kelola Akun" saat
// user kehilangan HP authenticator (2FA wajib semua user, tanpa recovery
// mandiri ini akun terkunci permanen). Hapus semua factor MFA user via
// service_role (auth.admin.mfa.deleteFactor) supaya login berikutnya jatuh
// balik ke mode enroll (App.jsx handleAuthSession, cabang nextLevel==='aal1').
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy admin-reset-mfa --project-ref <ref>
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

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerAuth.user.id).single();
    if (!callerProfile || (callerProfile.role !== "ADMIN" && callerProfile.role !== "SUPERADMIN")) {
      return json({ ok: false, error: "Hanya Admin yang bisa mereset verifikasi 2 langkah akun lain." }, 403);
    }

    // ── 2. Validasi input ──
    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId || "").trim();
    if (!userId) return json({ ok: false, error: "userId wajib diisi." });

    // ── 3. Hapus semua factor MFA milik target ──
    const { data: factorsData, error: listErr } = await admin.auth.admin.mfa.listFactors({ userId });
    if (listErr) return json({ ok: false, error: `Gagal membaca factor 2FA: ${listErr.message}` });
    const factors = factorsData?.factors || [];
    for (const f of factors) {
      const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (delErr) return json({ ok: false, error: `Gagal menghapus factor 2FA: ${delErr.message}` });
    }

    return json({ ok: true, removed: factors.length });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
