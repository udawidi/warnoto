// @ts-nocheck — runtime Deno (Supabase Edge Functions), lihat catatan sama
// di supabase/functions/admin-create-user/index.ts.
//
// SECURITY FIX P1 (opsi A): tulis `warnoto_state` (blob state nasional untuk
// bot Telegram) dipindah ke sini lewat service_role. Sebelumnya klien insert
// langsung dan RLS cuma cek `authenticated` — role read-only (VIEWER) atau
// siapa pun yang login via REST bisa nulis/poison state. Sekarang tulis lewat
// EF ini (gate role di bawah), lalu grant insert `authenticated` dicabut
// (lihat migration 20260818_warnoto_state_service_write.sql). Baca TIDAK
// berubah — bot Telegram & App.jsx masih baca langsung dari tabel.
//
// ── CARA DEPLOY ──
//   copy ke volume self-host: functions/sync-warnoto-state (lihat memory
//   edge-function-selfhost-deploy), load per-request TANPA restart.
//   (TANPA --no-verify-jwt — pemanggil wajib sudah login, otorisasi role
//   dicek manual di bawah via getUser, sama pola admin-reset-mfa.)

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

// Satu-satunya role read-only (src/lib/roles.js) — tidak boleh menulis state.
// Role lain (ADMIN/TL/PENGADAAN/dst/SUPERADMIN) boleh.
export function bolehSyncState(role: string | null | undefined): boolean {
  if (!role || role === "VIEWER") return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Tidak ada sesi login." }, 401);

    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth?.user) return json({ ok: false, error: "Sesi login tidak valid, silakan login ulang." }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerAuth.user.id).single();
    if (!bolehSyncState(callerProfile?.role)) {
      return json({ ok: false, error: "Role ini tidak boleh sinkron State Gudang." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const state_data = body?.state_data;
    if (!state_data || typeof state_data !== "object" || Array.isArray(state_data)) {
      return json({ ok: false, error: "state_data wajib diisi (objek)." }, 400);
    }

    const { error: insertErr } = await admin.from("warnoto_state").insert({ state_data, version: "v1" });
    if (insertErr) return json({ ok: false, error: `Gagal sinkron State Gudang: ${insertErr.message}` }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
