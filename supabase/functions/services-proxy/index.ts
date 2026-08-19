// @ts-nocheck — runtime Deno (Supabase Edge Functions), lihat catatan sama
// di supabase/functions/admin-create-user/index.ts.
//
// Proxy tipis ke Cohere (embed) & OCR.space untuk fitur RAG (src/lib/rag.js).
// Sebelumnya dipanggil LANGSUNG dari browser pakai VITE_COHERE_API_KEY &
// VITE_OCRSPACE_API_KEY — bocor di bundle. Sekarang key hanya hidup di sini
// (env server), pemanggil wajib login (JWT diverifikasi manual, sama pola
// ai-proxy). Diskriminator body.service: "cohere-embed" | "ocr".
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy services-proxy --project-ref <ref>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COHERE_API_KEY = Deno.env.get("COHERE_API_KEY") ?? "";
const OCRSPACE_API_KEY = Deno.env.get("OCRSPACE_API_KEY") ?? "";

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
  if (req.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);

  try {
    // ── 1. Pastikan pemanggil login ──
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: { message: "Sesi login tidak valid." } }, 401);

    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth?.user) return json({ error: { message: "Sesi login tidak valid." } }, 401);

    // ── 2. Diskriminasi service ──
    const body = await req.json().catch(() => ({}));

    if (body.service === "cohere-embed") {
      if (!COHERE_API_KEY) return json({ error: { message: "COHERE_API_KEY belum diset." } }, 500);
      const { model, texts, images, input_type } = body;
      if (!model || !input_type) return json({ error: { message: "model & input_type wajib diisi." } }, 400);
      if (!Array.isArray(texts) && !Array.isArray(images)) {
        return json({ error: { message: "texts atau images wajib diisi." } }, 400);
      }
      const resp = await fetch("https://api.cohere.com/v1/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${COHERE_API_KEY}` },
        body: JSON.stringify({ model, ...(texts ? { texts } : {}), ...(images ? { images } : {}), input_type }),
      });
      return new Response(await resp.text(), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.service === "ocr") {
      if (!OCRSPACE_API_KEY) return json({ error: { message: "OCRSPACE_API_KEY belum diset." } }, 500);
      const { base64Image } = body;
      if (!base64Image) return json({ error: { message: "base64Image wajib diisi." } }, 400);
      const form = new FormData();
      form.append("base64Image", base64Image);
      form.append("language", "eng");
      form.append("OCREngine", "2");
      form.append("scale", "true");
      const resp = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { apikey: OCRSPACE_API_KEY }, // JANGAN set Content-Type — biar boundary FormData otomatis
        body: form,
      });
      return new Response(await resp.text(), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return json({ error: { message: "service tidak dikenal (pakai 'cohere-embed' atau 'ocr')." } }, 400);
  } catch (e) {
    return json({ error: { message: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` } }, 500);
  }
});
