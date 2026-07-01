// Supabase Edge Function — webhook WhatsApp Cloud API untuk AI Agent WARNOTO.
//
// V2: + whitelist nomor WA (wa_allowed_users), + warnoto_state context,
//     + command handlers (help/menu/status sinkron), + audit log (wa_agent_logs).
//
// ── CARA DEPLOY ──
//   1. npx supabase link --project-ref tadxodrzoquugnsyejld
//   2. npx supabase secrets set WHATSAPP_VERIFY_TOKEN=warnoto-wa-verify-2026 \
//        WHATSAPP_ACCESS_TOKEN=<dari Meta> WHATSAPP_PHONE_NUMBER_ID=<dari Meta> \
//        GROQ_API_KEY=<...> COHERE_API_KEY=<...>
//   3. npx supabase functions deploy whatsapp-webhook --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN            = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WHATSAPP_ACCESS_TOKEN   = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID= Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GROQ_API_KEY            = Deno.env.get("GROQ_API_KEY") ?? "";
const COHERE_API_KEY          = Deno.env.get("COHERE_API_KEY") ?? "";
const SUPABASE_URL            = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Teks balasan command tetap ──────────────────────────────────────────────

const MSG_HELP = `🤖 *WARNOTO AI Agent*
Sistem Manajemen Gudang PLN UPT Surabaya

Anda bisa menanyakan informasi seputar:
• Stok material & katalog gudang
• Status sinkronisasi knowledge base
• Ringkasan kondisi gudang terkini

*Perintah tersedia:*
• *menu* — tampilkan menu perintah ini
• *help* — bantuan penggunaan
• *status sinkron* — info terakhir sinkronisasi data
• Pertanyaan bebas — langsung tanya seputar stok/material

Jawaban WA bersifat ringkas. Untuk detail lengkap, buka aplikasi WARNOTO.`;

const MSG_MENU = `📋 *Menu WARNOTO Bot*

1️⃣ *status sinkron* — cek terakhir sync data ke Knowledge Base
2️⃣ *stok [nama material]* — contoh: stok trafo 100kva
3️⃣ *katalog [nomor]* — contoh: katalog 5000000123
4️⃣ Pertanyaan bebas dalam Bahasa Indonesia

_Bot ini hanya-baca (read-only). Mutasi stok dilakukan di aplikasi WARNOTO._`;

const MSG_NOT_WHITELISTED = `⛔ Nomor Anda belum terdaftar di WARNOTO AI Agent.
Hubungi Admin WARNOTO untuk mendaftarkan nomor WhatsApp Anda.`;

// ── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden — verify token tidak cocok", { status: 403 });
  }

  if (req.method === "POST") {
    const t0 = Date.now();
    let fromNumber = "";
    let question   = "";
    let logEntry: Record<string, unknown> = {};

    try {
      const body    = await req.json();
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message || message.type !== "text") {
        return new Response("OK", { status: 200 });
      }

      fromNumber = message.from;
      question   = (message.text?.body ?? "").trim();
      if (!question) return new Response("OK", { status: 200 });

      logEntry = { phone_number: fromNumber, message_in: question, is_whitelisted: false };

      // 1. Cek whitelist
      const { data: allowed } = await supabase
        .from("wa_allowed_users")
        .select("display_name, is_active")
        .eq("phone_number", fromNumber)
        .maybeSingle();

      const isWhitelisted = !!(allowed?.is_active);
      logEntry.is_whitelisted = isWhitelisted;
      if (allowed?.display_name) logEntry.display_name = allowed.display_name;

      if (!isWhitelisted) {
        await sendWhatsAppMessage(fromNumber, MSG_NOT_WHITELISTED);
        await writeLog({ ...logEntry, intent: "blocked", answer_summary: "NOT_WHITELISTED", response_ms: Date.now() - t0 });
        return new Response("OK", { status: 200 });
      }

      // 2. Detect command
      const qLower = question.toLowerCase().trim();
      let reply    = "";
      let intent   = "rag_query";

      if (["help","bantuan","tolong"].includes(qLower)) {
        reply  = MSG_HELP;
        intent = "help";
      } else if (["menu","perintah"].includes(qLower)) {
        reply  = MSG_MENU;
        intent = "menu";
      } else if (qLower.startsWith("status sinkron") || qLower === "status sync") {
        reply  = await buildSyncStatusReply();
        intent = "status_sinkron";
      } else {
        // 3. RAG query
        const { text, chunksUsed } = await generateReply(question);
        reply  = text;
        logEntry.rag_chunks_used = chunksUsed;
        intent = "rag_query";
      }

      logEntry.intent         = intent;
      logEntry.answer_summary = reply.slice(0, 500);
      logEntry.response_ms    = Date.now() - t0;

      await sendWhatsAppMessage(fromNumber, reply);
      await writeLog(logEntry);

    } catch (err) {
      console.error("whatsapp-webhook error:", err);
      const errMsg = (err as Error).message ?? String(err);
      if (fromNumber) {
        await sendWhatsAppMessage(fromNumber, "⚠️ Maaf, terjadi kesalahan internal. Coba lagi beberapa saat.");
      }
      await writeLog({
        ...logEntry,
        intent: logEntry.intent ?? "error",
        error_message: errMsg,
        response_ms: Date.now() - t0,
      });
    }

    return new Response("OK", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});

// ── Whitelist check cache sederhana (per invocation — Edge Function bisa warm) ─

// ── Status sinkronisasi ─────────────────────────────────────────────────────

async function buildSyncStatusReply(): Promise<string> {
  const { data: rows } = await supabase
    .from("wa_sync_status")
    .select("sync_type, last_synced_at, record_count, status, error_message");

  if (!rows || rows.length === 0) {
    return "⚠️ Belum ada data sinkronisasi tersimpan. Jalankan sync dari aplikasi WARNOTO (Admin → AI Agent → Sync Knowledge Base).";
  }

  const lines = rows.map((r: Record<string, unknown>) => {
    const type  = r.sync_type === "rag_knowledge_base" ? "📚 Knowledge Base" : "📊 State Gudang";
    const since = r.last_synced_at ? new Date(r.last_synced_at as string).toLocaleString("id-ID", { timeZone:"Asia/Jakarta" }) : "belum pernah";
    const status = r.status === "OK" ? "✅" : r.status === "ERROR" ? "❌" : "⏳";
    return `${status} ${type}\n   Terakhir: ${since}\n   Records: ${r.record_count ?? 0}${r.error_message ? "\n   ⚠️ " + r.error_message : ""}`;
  });

  return `🔄 *Status Sinkronisasi WARNOTO*\n\n${lines.join("\n\n")}`;
}

// ── RAG ─────────────────────────────────────────────────────────────────────

async function cohereEmbed(texts: string[], inputType: "search_document" | "search_query") {
  const resp = await fetch("https://api.cohere.com/v1/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${COHERE_API_KEY}` },
    body: JSON.stringify({ model: "embed-multilingual-v3.0", texts, input_type: inputType }),
  });
  if (!resp.ok) throw new Error(`Cohere embed gagal (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.embeddings as number[][];
}

async function buildRagContext(question: string): Promise<{ context: string; chunksUsed: number }> {
  try {
    const [queryVector] = await cohereEmbed([question], "search_query");
    const { data: matches, error } = await supabase.rpc("match_rag_chunks", {
      query_embedding: queryVector,
      match_count: 8,
    });
    if (error) throw error;
    if (!matches || matches.length === 0) return { context: "Tidak ada hasil relevan di knowledge base.", chunksUsed: 0 };
    const context = (matches as Array<{ similarity: number; content: string }>)
      .map((m) => `- (${(m.similarity * 100).toFixed(0)}%) ${m.content}`)
      .join("\n");
    return { context, chunksUsed: matches.length };
  } catch (e) {
    return { context: `(Knowledge Base tidak tersedia: ${(e as Error).message})`, chunksUsed: 0 };
  }
}

async function buildWarnotoStateContext(): Promise<string> {
  try {
    const { data } = await supabase
      .from("warnoto_state")
      .select("state_data, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return "";
    const s = data.state_data as Record<string, unknown>;
    const since = new Date(data.updated_at as string).toLocaleString("id-ID", { timeZone:"Asia/Jakarta" });
    return `\nDATA KONDISI GUDANG (update: ${since}):\n` + JSON.stringify(s, null, 2).slice(0, 2000);
  } catch {
    return "";
  }
}

async function generateReply(question: string): Promise<{ text: string; chunksUsed: number }> {
  const [{ context: ragContext, chunksUsed }, stateContext] = await Promise.all([
    buildRagContext(question),
    buildWarnotoStateContext(),
  ]);

  const systemPrompt = `Kamu adalah AI Agent sistem manajemen gudang PLN bernama WARNOTO, dihubungi lewat WhatsApp.
Jawab singkat dan jelas. Format untuk WhatsApp: hindari tabel panjang, gunakan bullet point atau angka.
Gunakan Bahasa Indonesia profesional namun mudah dipahami.
Kapasitas jawaban: maksimal 600 kata.

KONTEKS KNOWLEDGE BASE (Master Katalog + riwayat TUG):
${ragContext}
${stateContext}

Kalau pertanyaan tidak bisa dijawab dari data di atas, sampaikan dengan jujur dan sarankan buka aplikasi WARNOTO.`;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 900,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Groq gagal (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "Maaf, terjadi kendala saat memproses pertanyaan Anda.",
    chunksUsed,
  };
}

// ── Kirim pesan WA ──────────────────────────────────────────────────────────

async function sendWhatsAppMessage(toNumber: string, text: string) {
  const resp = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "text",
      text: { body: text },
    }),
  });
  if (!resp.ok) {
    console.error("Gagal kirim WA:", resp.status, await resp.text());
  }
}

// ── Audit log ───────────────────────────────────────────────────────────────

async function writeLog(entry: Record<string, unknown>) {
  try {
    await supabase.from("wa_agent_logs").insert(entry);
  } catch (e) {
    console.error("Gagal tulis audit log:", e);
  }
}
