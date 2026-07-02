// Supabase Edge Function — webhook Telegram Bot API untuk AI Agent WARNOTO.
//
// Alternatif dari whatsapp-webhook (WA kena restriksi "Business account is
// restricted from messaging users in this country" karena Business
// Verification Meta belum selesai). Setup Telegram jauh lebih ringan: tidak
// ada App Review, tidak ada verifikasi bisnis, tidak ada pembatasan negara.
//
// ── CARA DEPLOY ──
//   1. Chat @BotFather di Telegram -> /newbot -> dapat TELEGRAM_BOT_TOKEN
//   2. npx supabase link --project-ref tadxodrzoquugnsyejld
//   3. npx supabase secrets set TELEGRAM_BOT_TOKEN=<dari BotFather> \
//        GROQ_API_KEY=<...> COHERE_API_KEY=<...>
//   4. npx supabase functions deploy telegram-webhook --no-verify-jwt
//   5. curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tadxodrzoquugnsyejld.supabase.co/functions/v1/telegram-webhook"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const GROQ_API_KEY           = Deno.env.get("GROQ_API_KEY") ?? "";
const COHERE_API_KEY         = Deno.env.get("COHERE_API_KEY") ?? "";
const SUPABASE_URL           = Deno.env.get("SUPABASE_URL") ?? "";
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
• /menu — tampilkan menu perintah ini
• /help — bantuan penggunaan
• status sinkron — info terakhir sinkronisasi data
• Pertanyaan bebas — langsung tanya seputar stok/material

Jawaban bersifat ringkas. Untuk detail lengkap, buka aplikasi WARNOTO.`;

const MSG_MENU = `📋 *Menu WARNOTO Bot*

1️⃣ status sinkron — cek terakhir sync data ke Knowledge Base
2️⃣ stok [nama material] — contoh: stok trafo 100kva
3️⃣ katalog [nomor] — contoh: katalog 5000000123
4️⃣ Pertanyaan bebas dalam Bahasa Indonesia

_Bot ini hanya-baca (read-only). Mutasi stok dilakukan di aplikasi WARNOTO._`;

const MSG_NOT_WHITELISTED = `⛔ Akun Telegram Anda belum terdaftar di WARNOTO AI Agent.
Hubungi Admin WARNOTO untuk mendaftarkan akun Anda (kirim /start dulu supaya Admin bisa lihat User ID Anda).`;

// ── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK — telegram-webhook aktif. Set webhook via setWebhook API.", { status: 200 });
  }

  const t0 = Date.now();
  let userId      = "";
  let username: string | null = null;
  let displayName: string | null = null;
  let question    = "";
  let logEntry: Record<string, unknown> = {};

  try {
    const update  = await req.json();
    const message = update?.message;
    if (!message || typeof message.text !== "string") {
      return new Response("OK", { status: 200 });
    }

    userId      = String(message.from?.id ?? "");
    username    = message.from?.username ? `@${message.from.username}` : null;
    displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null;
    question    = message.text.trim();
    const chatId = message.chat?.id;
    if (!question || !userId || !chatId) return new Response("OK", { status: 200 });

    logEntry = { telegram_user_id: userId, telegram_username: username, display_name: displayName, message_in: question, is_whitelisted: false };

    // /start selalu dibalas (tanpa cek whitelist) supaya user baru tahu User ID-nya sendiri,
    // biar bisa dikirim ke Admin untuk didaftarkan.
    if (question === "/start") {
      await sendTelegramMessage(chatId, `👋 Halo${displayName ? " " + displayName : ""}!\n\nUser ID Telegram Anda: \`${userId}\`\nKirim ID ini ke Admin WARNOTO supaya akun Anda bisa diaktifkan.`);
      await writeLog({ ...logEntry, intent: "start", answer_summary: "SENT_USER_ID", response_ms: Date.now() - t0 });
      return new Response("OK", { status: 200 });
    }

    // 1. Cek whitelist
    const { data: allowed } = await supabase
      .from("tg_allowed_users")
      .select("display_name, is_active")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    const isWhitelisted = !!(allowed?.is_active);
    logEntry.is_whitelisted = isWhitelisted;
    if (allowed?.display_name) logEntry.display_name = allowed.display_name;

    if (!isWhitelisted) {
      await sendTelegramMessage(chatId, MSG_NOT_WHITELISTED);
      await writeLog({ ...logEntry, intent: "blocked", answer_summary: "NOT_WHITELISTED", response_ms: Date.now() - t0 });
      return new Response("OK", { status: 200 });
    }

    // 2. Detect command
    const qLower = question.toLowerCase().trim();
    let reply    = "";
    let intent   = "rag_query";

    if (["/help", "help", "bantuan", "tolong"].includes(qLower)) {
      reply  = MSG_HELP;
      intent = "help";
    } else if (["/menu", "menu", "perintah"].includes(qLower)) {
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

    await sendTelegramMessage(chatId, reply);
    await writeLog(logEntry);

  } catch (err) {
    console.error("telegram-webhook error:", err);
    const errMsg = (err as Error).message ?? String(err);
    await writeLog({
      ...logEntry,
      intent: logEntry.intent ?? "error",
      error_message: errMsg,
      response_ms: Date.now() - t0,
    });
  }

  return new Response("OK", { status: 200 });
});

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

  const systemPrompt = `Kamu adalah AI Agent sistem manajemen gudang PLN bernama WARNOTO, dihubungi lewat Telegram.
Jawab singkat dan jelas. Format Markdown Telegram sederhana (bold pakai *teks*), hindari tabel panjang.
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

// ── Kirim pesan Telegram ─────────────────────────────────────────────────────

async function sendTelegramMessage(chatId: number | string, text: string) {
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  if (!resp.ok) {
    console.error("Gagal kirim Telegram:", resp.status, await resp.text());
  }
}

// ── Audit log ───────────────────────────────────────────────────────────────

async function writeLog(entry: Record<string, unknown>) {
  try {
    await supabase.from("tg_agent_logs").insert(entry);
  } catch (e) {
    console.error("Gagal tulis audit log:", e);
  }
}
