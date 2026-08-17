// @ts-nocheck — file ini jalan di runtime Deno (Supabase Edge Functions),
// bukan Node/Vite seperti sisa proyek, jadi `Deno` global dan import
// esm.sh tidak dikenali TypeScript checker bawaan VS Code di sini.
//
// Supabase Edge Function — Gateway API-key untuk aplikasi pihak ketiga
// (khususnya SAP S/4HANA) membaca data WARNOTO (Fase 1: READ saja).
//
// Dua kelompok endpoint di satu function (path-routed lewat pathname):
//   /keys, /keys/revoke         — admin only, wajib JWT Supabase Auth role TL/SUPERADMIN
//                                  (pola sama admin-create-user: admin.auth.getUser(jwt) + cek profiles.role)
//   /stock, /catalog, /tug      — publik (SAP tidak punya sesi Supabase Auth),
//                                  auth-nya lewat API-key custom (Authorization: Bearer <key> atau x-api-key)
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy integration-api --no-verify-jwt
//   (self-host, BUKAN --project-ref cloud. --no-verify-jwt SENGAJA karena
//   endpoint /stock /catalog /tug dipanggil SAP tanpa sesi Supabase Auth —
//   auth-nya API-key custom kita, dicek manual di bawah. Endpoint /keys*
//   TETAP wajib JWT Admin, dicek manual di dalam function karena verifikasi
//   platform Supabase sudah dimatikan untuk seluruh function ini.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Hash key (sha256 hex) pakai Web Crypto — tidak perlu library ──
async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `wrn_live_${hex}`;
}

const SCOPE_BY_ENDPOINT = { stock: "read:stock", catalog: "read:catalog", tug: "read:tug" };
const VALID_SCOPES = Object.values(SCOPE_BY_ENDPOINT);

// ── Admin auth (endpoint /keys*) — pola sama admin-create-user ──
async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return { error: json({ ok: false, error: "Tidak ada sesi login." }, 401) };
  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerAuth?.user) return { error: json({ ok: false, error: "Sesi login tidak valid, silakan login ulang." }, 401) };
  const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerAuth.user.id).single();
  if (!callerProfile || (callerProfile.role !== "TL" && callerProfile.role !== "SUPERADMIN")) {
    return { error: json({ ok: false, error: "Hanya TL yang bisa mengelola API Integrasi." }, 403) };
  }
  return { userId: callerAuth.user.id };
}

// ── API-key auth (endpoint READ) — hash + lookup + scope + rate limit ──
async function requireApiKey(req: Request, endpoint: string) {
  const authHeader = req.headers.get("Authorization") || "";
  const rawKey = authHeader.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
  if (!rawKey) return { error: json({ ok: false, error: "API key wajib dikirim (Authorization: Bearer <key> atau header x-api-key)." }, 401) };

  const hash = await sha256Hex(rawKey);
  const { data: keyRow, error: keyErr } = await admin
    .from("integration_api_keys").select("*").eq("key_hash", hash).is("revoked_at", null).single();
  if (keyErr || !keyRow) return { error: json({ ok: false, error: "API key tidak dikenal atau sudah dicabut." }, 401) };

  const requiredScope = SCOPE_BY_ENDPOINT[endpoint];
  if (requiredScope && !(keyRow.scopes || []).includes(requiredScope)) {
    return { error: json({ ok: false, error: `API key tidak punya scope "${requiredScope}".` }, 403) };
  }

  // Rate limit sederhana: hitung request key ini 60 detik terakhir.
  // ponytail: full-table scan per-request di integration_request_log, upgrade
  // ke counter/Redis kalau volume SAP jadi tinggi.
  const sinceIso = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("integration_request_log").select("id", { count: "exact", head: true })
    .eq("key_id", keyRow.id).gte("at", sinceIso);
  if ((count || 0) >= (keyRow.rate_limit_per_min || 120)) {
    return { error: json({ ok: false, error: "Rate limit terlampaui, coba lagi sebentar lagi." }, 429) };
  }

  return { keyRow };
}

async function logRequest(keyId: string, endpoint: string, method: string, status: number, ip: string) {
  await admin.from("integration_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
  await admin.from("integration_request_log").insert({ key_id: keyId, endpoint, method, status, ip });
}

function shapeKatalog(row: { id: string; data: Record<string, unknown> }) {
  const d = row.data || {};
  return { katalogId: row.id, nama: d.name ?? null, nomorMaterial: d.katalog ?? null, satuan: d.satuan ?? null, jenisBarang: d.jenisBarang ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  // Segmen terakhir setelah nama function, cth ".../integration-api/stock" -> "stock".
  const segments = url.pathname.split("/").filter(Boolean);
  const endpoint = segments[segments.length - 1] || "";
  const ip = req.headers.get("x-forwarded-for") || "";

  try {
    // ── Admin: kelola key ──
    if (endpoint === "keys" && req.method === "GET") {
      const auth = await requireAdmin(req);
      if (auth.error) return auth.error;
      const { data, error } = await admin.from("integration_api_keys")
        .select("id,label,key_prefix,scopes,created_at,last_used_at,revoked_at,rate_limit_per_min")
        .order("created_at", { ascending: false });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, keys: data });
    }

    if (endpoint === "keys" && req.method === "POST") {
      const auth = await requireAdmin(req);
      if (auth.error) return auth.error;
      const body = await req.json().catch(() => ({}));
      const label = String(body.label || "").trim();
      const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s: unknown) => VALID_SCOPES.includes(s)) : [];
      if (!label) return json({ ok: false, error: "Label wajib diisi." });
      if (!scopes.length) return json({ ok: false, error: `Pilih minimal satu scope: ${VALID_SCOPES.join(", ")}` });

      const plainKey = randomKey();
      const keyHash = await sha256Hex(plainKey);
      const keyPrefix = plainKey.slice(0, 13); // "wrn_live_" + 4 hex char pertama, cukup buat identifikasi di UI
      const { data, error } = await admin.from("integration_api_keys")
        .insert({ label, key_prefix: keyPrefix, key_hash: keyHash, scopes, created_by: auth.userId })
        .select("id,label,key_prefix,scopes,created_at").single();
      if (error) return json({ ok: false, error: error.message }, 500);
      // Plaintext HANYA dikembalikan di respons ini, sekali, tidak pernah disimpan.
      return json({ ok: true, key: { ...data, plaintext: plainKey } });
    }

    if (endpoint === "revoke" && req.method === "POST") {
      const auth = await requireAdmin(req);
      if (auth.error) return auth.error;
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || "").trim();
      if (!id) return json({ ok: false, error: "id key wajib diisi." });
      const { error } = await admin.from("integration_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // ── READ endpoints (API-key) ──
    if (["stock", "catalog", "tug"].includes(endpoint) && req.method === "GET") {
      const auth = await requireApiKey(req, endpoint);
      if (auth.error) return auth.error;
      const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);

      let result;
      if (endpoint === "catalog") {
        const { data, error } = await admin.from("katalog").select("id,data").limit(limit);
        if (error) return json({ ok: false, error: error.message }, 500);
        result = { catalog: (data || []).map(shapeKatalog) };
      } else if (endpoint === "stock") {
        // stock_current = qty terkini per katalog (dijumlah semua lokasi) —
        // join manual ke katalog untuk nama/nomor material SAP-friendly.
        const { data, error } = await admin.from("stock_current").select("katalog_id,qty,updated_at").limit(limit);
        if (error) return json({ ok: false, error: error.message }, 500);
        const katalogIds = [...new Set((data || []).map(r => r.katalog_id))];
        const { data: katRows } = katalogIds.length
          ? await admin.from("katalog").select("id,data").in("id", katalogIds)
          : { data: [] };
        const katMap = new Map((katRows || []).map(k => [k.id, shapeKatalog(k)]));
        result = {
          stock: (data || []).map(r => ({
            katalogId: r.katalog_id,
            ...(katMap.get(r.katalog_id) ? { nama: katMap.get(r.katalog_id).nama, nomorMaterial: katMap.get(r.katalog_id).nomorMaterial, satuan: katMap.get(r.katalog_id).satuan } : {}),
            qty: r.qty,
            updatedAt: r.updated_at,
          })),
        };
      } else {
        // tug: riwayat mutasi (tug15_history) — dokumen TUG.
        const { data, error } = await admin.from("tug15_history")
          .select("id,katalog_id,tanggal,jenis_transaksi,qty,lokasi_kode,doc_type,no_bon,catatan")
          .order("tanggal", { ascending: false }).limit(limit);
        if (error) return json({ ok: false, error: error.message }, 500);
        result = { tug: (data || []).map(r => ({ id: r.id, katalogId: r.katalog_id, tanggal: r.tanggal, jenisTransaksi: r.jenis_transaksi, qty: r.qty, lokasiKode: r.lokasi_kode, docType: r.doc_type, noBon: r.no_bon, catatan: r.catatan })) };
      }

      await logRequest(auth.keyRow.id, endpoint, req.method, 200, ip);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: "Endpoint tidak dikenal." }, 404);
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
