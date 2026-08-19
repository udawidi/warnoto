// @ts-nocheck — runtime Deno (Supabase Edge Functions), lihat catatan sama
// di supabase/functions/admin-create-user/index.ts.
//
// Proxy tipis ke OpenRouter (chat completions, OpenAI-compatible) untuk semua
// fitur AI in-app (chatbot Pak War, forecast drill-down, ekstraksi kontrak PDF,
// insight material cadang). Sebelumnya call-site di App.jsx & materialCadang.js
// panggil Groq LANGSUNG dari browser pakai VITE_GROQ_API_KEY — bocor di bundle.
// Sekarang API key OpenRouter hanya hidup di sini (env server), pemanggil wajib
// login (JWT diverifikasi manual karena FUNCTIONS_VERIFY_JWT=false di router).
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy ai-proxy --project-ref <ref>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "deepseek/deepseek-chat";

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

    if (!OPENROUTER_API_KEY) return json({ error: { message: "OPENROUTER_API_KEY belum diset." } }, 500);

    // ── 2. Validasi input ──
    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0) return json({ error: { message: "messages wajib diisi." } }, 400);
    const maxTokens = Math.min(Number(body.max_tokens) || 900, 2000);
    const stream = body.stream === true;

    // ── 3. Forward ke OpenRouter, retry sekali kalau 429 (pola sama telegram-webhook) ──
    let resp;
    let totalWait = 0;
    for (let attempt = 0; ; attempt++) {
      resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://warnoto.com",
          "X-Title": "WARNOTO",
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages,
          max_tokens: maxTokens,
          ...(stream ? { stream: true } : {}),
          ...(body.temperature != null ? { temperature: body.temperature } : {}),
        }),
      });
      if (resp.status !== 429 || attempt >= 3) break;
      const wait = Math.min(Number(resp.headers.get("retry-after")) || 8, 25);
      if (totalWait + wait > 40) break;
      totalWait += wait;
      await new Promise((r) => setTimeout(r, wait * 1000));
    }

    // Path stream: passthrough SSE mentah (cek status dulu; error tetap JSON dari OpenRouter).
    if (stream && resp.status < 400) {
      return new Response(resp.body, { status: resp.status, headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    return new Response(await resp.text(), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return json({ error: { message: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` } }, 500);
  }
});
