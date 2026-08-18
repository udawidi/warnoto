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
//   5. curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tadxodrzoquugnsyejld.supabase.co/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
//      (secret_token WAJIB sama persis dengan env TELEGRAM_WEBHOOK_SECRET di
//      langkah 3 — tanpa ini siapa pun yang tahu URL webhook bisa POST update
//      palsu ke endpoint ini, karena --no-verify-jwt tidak mengecek JWT platform.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const GROQ_API_KEY           = Deno.env.get("GROQ_API_KEY") ?? "";
const COHERE_API_KEY         = Deno.env.get("COHERE_API_KEY") ?? "";
const SUPABASE_URL           = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

// Header wajib Telegram (kalau secret_token di-set via setWebhook) — bandingkan
// dengan TELEGRAM_WEBHOOK_SECRET supaya endpoint hanya menerima update ASLI dari
// Telegram, bukan POST palsu dari siapa pun yang tahu URL webhook (yang bisa
// spoof message.from.id ke user whitelisted). Fail-open + warn kalau secret
// belum dikonfigurasi (env kosong), supaya bot yang sudah live tidak mati
// mendadak sebelum secret dipasang di kedua sisi (env + setWebhook).
function secretCocok(headerVal: string | null, envVal: string): boolean {
  if (!envVal) return true;
  return headerVal === envVal;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Glosarium singkatan & istilah material PLN (sheet PLN-Terminology, CATALOG MASTER.xlsx).
// Diinject ke system prompt supaya bot paham singkatan teknis di nama material / pertanyaan
// user (mis. "PMT" = circuit breaker, "LA" = penangkal petir). SALINAN dari MATERIAL_GLOSSARY
// di App.jsx — kalau salah satu diubah, samakan yang lain (Deno tidak bisa impor dari App.jsx).
const MATERIAL_GLOSSARY = `2CCT = Double Circuit (Sirkuit Ganda)
2W = 2 Wire (2 Kawat); 4W = 4 Wire (4 Kawat)
AB = Air Blast; ACC = Accessories (Aksesoris)
CABLE CTRL = Cable Control (Kabel Kontrol); CABLE PWR = Cable Power (Kabel Daya)
CAP = Capacity (Kapasitas); CARD = Modul
CB = Circuit Breaker / PMT (Pemutus Tenaga); CIRCL = Circular (Bulat/Bundar)
CLV = Connector Low Voltage; CO = Cut Out; COMB = Combo (Kombinasi)
COND = Conductor (Kawat/Konduktor); CONN = Connector; CR = Capacitor
CT = Current Transformer (Trafo Arus); CUB = Cubicle (Kubikel); DGR = Degree (Derajat)
DIFF = Differential; DIST = Distribution (Distribusi); DISTAN = Distance Relay (Rele Jarak)
DS = Disconnecting Switch / PMS (Pemisah); DT = Double Tarif; EF = Earth Fault
FLV = For Low Voltage; GIS = Gas Insulation Substation; H = Heat Shrink (Ciut Panas)
ID = Indoor (terpasang di dalam ruang/gedung); IND = Inductive; ISO = Isolated (Isolasi)
K = Konvensional; LA = Lightning Arrester (Penangkal Petir); LINE = Feeder (Jurusan)
LLC = Live Line Connector; LVSB = Low Voltage Switch Board (Papan Hubung Bagi / Rak Tegangan Rendah)
LW = Live Working (Pekerjaan Tanpa Pemadaman); M = Metering; MCB = Mini Circuit Breaker (Pembatas Arus)
MCCB = Moulded Case Circuit Breaker; M-TPD = Manual Terpadu; MTR = Meter; N = Netral
NCLBL = Non Clamp Block; OCR = Over Current Relay (Rele Arus Lebih)
OD = Outdoor (terpasang di luar ruang/gedung); OH = Over Head Line / SU (Saluran Udara)
OVR = Over Voltage Relay (Rele Tegangan Lebih); P = Phase (Fasa); PB = Plumbum
PIER = Piercing (Bergigi); PLC = Power Line Carrier; PR = Press (Compress)
PT = Potential/Voltage Transformer (Trafo Tegangan); RECL = Recloser; RTU = Remote Terminal Unit
SACO = Switch Automatic Change Over; SCLV = Single Core Low Voltage; SCMV = Single Core Medium Voltage
ST = Single Tariff (catatan: ST juga dipakai untuk UG/Saluran Tanah); STRG = Straight (Lurus); TERM = Termination
TOOL E = Tool Electronic (Perangkat Kerja Elektronik); TOOL L = Tool Laboratory (Perangkat Kerja Laboratorium)
TOOL M = Tool Mechanic (Perangkat Kerja Mekanik); TOOL S = Tool Safety (Perangkat Kerja Keselamatan)
TRF = Transformer (Trafo); UG = Under Ground / ST (Saluran Tanah/Bawah Tanah)
WAVE TRAP = Line Trap; WP = Water Proof (Kedap Air)`;

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

const MSG_ERROR_RETRY = `🙏 Maaf, Pak War lagi agak kesulitan ambil datanya barusan. Coba kirim ulang pertanyaannya ya — kalau masih belum bisa juga, tunggu beberapa saat lagi baru coba lagi 🙏`;

const MSG_NON_TEXT = `🙏 Maaf, Pak War baru bisa baca pesan teks ya. Coba ketik pertanyaannya langsung, misalnya: *stok trafo 100kva* atau *katalog 5000000123*.`;

const MSG_RATE_LIMITED = `⏳ Sabar dulu ya, pertanyaannya kebanyakan berturut-turut nih 😄 Boleh kasih jeda sebentar sebelum tanya lagi. Kalau memang ada yang mendesak, langsung saja hubungi Admin Gudang.`;

// ── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK — telegram-webhook aktif. Set webhook via setWebhook API.", { status: 200 });
  }

  if (!TELEGRAM_WEBHOOK_SECRET) {
    console.warn("TELEGRAM_WEBHOOK_SECRET belum dikonfigurasi — webhook menerima update tanpa verifikasi asal Telegram.");
  } else if (!secretCocok(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const t0 = Date.now();
  let userId      = "";
  let username: string | null = null;
  let displayName: string | null = null;
  let question    = "";
  let chatId: number | string | undefined;
  let logEntry: Record<string, unknown> = {};

  try {
    const update = await req.json();

    // ── Tombol feedback 👍/👎 (callback_query, bukan message biasa) ──
    const callback = update?.callback_query;
    if (callback) {
      await handleFeedbackCallback(callback);
      return new Response("OK", { status: 200 });
    }

    const message = update?.message;
    if (!message) {
      return new Response("OK", { status: 200 });
    }

    userId   = String(message.from?.id ?? "");
    username = message.from?.username ? `@${message.from.username}` : null;
    displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null;
    chatId   = message.chat?.id;

    // Pesan non-teks (foto/stiker/voice/dokumen tanpa caption teks): kalau user
    // sudah whitelist, kasih tahu bot cuma baca teks. Kalau belum whitelist,
    // tetap MSG_NOT_WHITELISTED (konsisten dengan alur pesan teks di bawah,
    // supaya bot tidak "bocor" merespons ke sembarang orang yang belum terdaftar).
    if (typeof message.text !== "string") {
      if (!userId || !chatId) return new Response("OK", { status: 200 });
      const { data: allowedNonText } = await supabase
        .from("tg_allowed_users")
        .select("is_active")
        .eq("telegram_user_id", userId)
        .maybeSingle();
      await sendTelegramMessage(chatId, allowedNonText?.is_active ? MSG_NON_TEXT : MSG_NOT_WHITELISTED);
      return new Response("OK", { status: 200 });
    }

    question = message.text.trim();
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
      .select("display_name, is_active, upt_id")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    const callerUptId = allowed?.upt_id ?? null;
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
    } else if (await isRateLimited(userId)) {
      reply  = MSG_RATE_LIMITED;
      intent = "rate_limited";
    } else {
      // 3. RAG query
      await sendTypingAction(chatId);
      const { text, chunksUsed } = await generateReply(question, userId, callerUptId);
      reply  = text;
      logEntry.rag_chunks_used = chunksUsed;
      intent = "rag_query";
    }

    logEntry.intent         = intent;
    logEntry.answer_summary = reply.slice(0, 500);
    logEntry.response_ms    = Date.now() - t0;

    await sendTelegramMessage(chatId, reply);
    const savedLog = await writeLog(logEntry);

    // Setiap 4 pertanyaan (bukan tiap kali, biar tidak mengganggu), minta feedback 👍/👎 —
    // dipakai Admin di panel "Kelola FAQ Bot" untuk cari jawaban yang perlu diperbaiki.
    if (intent === "rag_query" && savedLog?.id) {
      const { count } = await supabase
        .from("tg_agent_logs")
        .select("id", { count: "exact", head: true })
        .eq("telegram_user_id", userId)
        .eq("intent", "rag_query");
      if (count && count % 4 === 0) {
        await sendTelegramFeedbackPrompt(chatId, savedLog.id as number);
      }
    }

  } catch (err) {
    console.error("telegram-webhook error:", err);
    const errMsg = (err as Error).message ?? String(err);
    if (chatId) {
      // Best-effort — kalau kirim pesan error ini sendiri juga gagal (mis. Telegram API down),
      // jangan sampai melempar exception baru di sini dan menggagalkan writeLog di bawah.
      try { await sendTelegramMessage(chatId, MSG_ERROR_RETRY); } catch (sendErr) { console.error("Gagal kirim pesan error ke user:", sendErr); }
    }
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

async function buildRagContext(question: string, callerUptId: string | null): Promise<{ context: string; chunksUsed: number }> {
  try {
    const [queryVector] = await cohereEmbed([question], "search_query");
    const { data: matches, error } = await supabase.rpc("match_rag_chunks", {
      query_embedding: queryVector,
      match_count: 12,
      p_upts: callerUptId ? [callerUptId] : null,
    });
    if (error) throw error;
    if (!matches || matches.length === 0) return { context: "(tidak ditemukan referensi yang relevan untuk pertanyaan ini)", chunksUsed: 0 };
    const context = (matches as Array<{ similarity: number; content: string }>)
      .map((m) => `- (${(m.similarity * 100).toFixed(0)}%) ${m.content}`)
      .join("\n");
    return { context, chunksUsed: matches.length };
  } catch (e) {
    return { context: `(referensi data sedang tidak bisa diambil: ${(e as Error).message})`, chunksUsed: 0 };
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
    return `\nDATA KONDISI GUDANG (update: ${since}):\n` + JSON.stringify(s, null, 2).slice(0, 4000);
  } catch {
    return "";
  }
}

// Ambil 3 tanya-jawab terakhir user ini (reuse answer_summary yang sudah ada di
// tg_agent_logs, tanpa tabel/kolom baru). Kalau pertanyaan terakhirnya sudah
// >20 menit lalu, anggap sesi baru dan kembalikan histori kosong — supaya bot
// tidak "nyambung-nyambungin" topik lama yang sudah tidak relevan.
async function buildConversationHistory(userId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("tg_agent_logs")
      .select("message_in, answer_summary, created_at")
      .eq("telegram_user_id", userId)
      .eq("intent", "rag_query")
      .order("created_at", { ascending: false })
      .limit(3);
    if (error || !data || data.length === 0) return "";

    const latestAt = new Date(data[0].created_at as string).getTime();
    if (Date.now() - latestAt > 20 * 60 * 1000) return "";

    return [...data].reverse()
      .map((r: Record<string, unknown>) => `User: ${r.message_in}\nJawaban kamu sebelumnya: ${String(r.answer_summary ?? "").slice(0, 300)}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

// Maks 8 pertanyaan RAG (Cohere+Groq, paling mahal & paling lambat) per user per
// 3 menit. Fail-open kalau query hitungnya sendiri error — gangguan DB sesaat
// tidak boleh mengunci user keluar dari bot.
async function isRateLimited(userId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("tg_agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("telegram_user_id", userId)
      .eq("intent", "rag_query")
      .gte("created_at", since);
    if (error) throw error;
    return (count ?? 0) >= 8;
  } catch (e) {
    console.error("Gagal cek rate limit (fail-open, tidak diblokir):", e);
    return false;
  }
}

async function generateReply(question: string, userId: string, callerUptId: string | null): Promise<{ text: string; chunksUsed: number }> {
  const [{ context: ragContext, chunksUsed }, stateContext, conversationHistory] = await Promise.all([
    buildRagContext(question, callerUptId),
    // blob warnoto_state = ringkasan NASIONAL (top20ByValue, materialKritis, dst.) tanpa
    // penanda upt_id per item. Untuk user scoped-UPT blob ini bocor lintas-UPT DAN salah
    // (bukan data UPT-nya) — jadi hanya user global (callerUptId=null) yang disuntik.
    // Per-UPT state summary butuh restruktur buildWarnotoStateSnapshot() di App.jsx; ditunda.
    callerUptId ? Promise.resolve("") : buildWarnotoStateContext(),
    buildConversationHistory(userId),
  ]);

  const systemPrompt = `Kamu adalah Pak War — admin gudang senior PLN yang sudah 10+ tahun pegang urusan stok & material, dihubungi user lewat Telegram. Kamu bukan sistem yang "membaca database", kamu kolega yang paham konteks dan mau bantu sampai tuntas.

ATURAN BICARA — WAJIB DIIKUTI:
1. JANGAN PERNAH memakai istilah teknis internal ke user: "knowledge base", "konteks", "database", "chunk", "similarity", "RAG", "tidak ada di data saya", "saya tidak memiliki akses". User tidak peduli istilah itu, mereka cuma mau jawaban yang jelas.
2. Kalau datanya ADA di bawah (baik di bagian referensi katalog/riwayat maupun data kondisi gudang), jawab dengan percaya diri pakai angka/fakta itu — jangan ragu-ragu kalau datanya jelas tersedia.
3. Kalau data yang ada mirip tapi tidak persis sama dengan pertanyaan (misal user tanya "trafo 100kva", yang ada "Trafo Distribusi 100 kVA"), tetap pakai data itu, sebutkan secara natural kalau itu yang paling mendekati.
4. Kalau BENAR-BENAR tidak ada info relevan sama sekali: JANGAN cuma bilang "tidak tahu" dan berhenti di situ. Akui dengan sopan dan hangat, lalu SELALU kasih langkah lanjutan konkret — sarankan cek menu tertentu di aplikasi WARNOTO, hubungi Admin Gudang, atau minta user kasih detail tambahan (nomor katalog/lokasi/nama lengkap material). Tindak lanjut itu wajib ada, bukan opsional.
5. Bahasa Indonesia sopan, formal, jelas, informatif — hangat profesional, seperti CS senior menjawab kolega, bukan kaku robotik atau membaca skrip. Mulai dengan JAWABAN INTI dulu (1-2 kalimat), baru rincian. Format Markdown Telegram sederhana (bold pakai *teks*), judul pendek/bullet/angka, hindari tabel panjang dan paragraf bertele-tele. Maksimal 600 kata.
5b. Kalau data yang tersedia tidak cukup menjawab, sebutkan data apa yang belum ada lalu ajukan SATU pertanyaan klarifikasi — jangan mengarang angka, lokasi, status, atau kebijakan.
5c. Sesekali saja (tidak setiap jawaban, di akhir sesi atau saat relevan), boleh tutup dengan ajakan singkat minta masukan, mis. "Kalau jawaban ini kurang tepat atau ada yang bisa diperbaiki, kirim saja masukan Anda — bisa juga mulai dengan kata *feedback:* biar mudah saya kenali. Masukan Anda membantu meningkatkan layanan WARNOTO." Jangan tampilkan ajakan ini di setiap balasan.
6. Kalau jawabanmu menyebut LEBIH DARI SATU material/barang (misal user tanya daftar stok, hasil pencarian nama yang mirip, atau ringkasan beberapa item), JANGAN digabung jadi satu paragraf panjang. WAJIB pakai list bernomor, satu material per nomor, dengan baris rincian di bawah nama (bukan disambung koma), dan baris kosong sebagai pemisah antar nomor. Contoh format yang benar:

1. *Trafo Distribusi 100 kVA* [4180023]
   📦 Qty: 12 unit
   📍 Lokasi: Gudang A - Blok 3
   💰 Harga satuan: Rp 15.000.000

2. *Trafo Distribusi 200 kVA* [4180045]
   📦 Qty: 5 unit
   📍 Lokasi: Gudang B - Blok 1

Sesuaikan baris rincian dengan data yang benar-benar tersedia untuk item itu (tidak usah paksa semua baris kalau datanya tidak ada) — tapi format bernomor + terpisah ini WAJIB dipakai begitu ada 2 material atau lebih dalam satu jawaban. Untuk 1 material saja, boleh langsung naratif tanpa nomor.
${conversationHistory ? `
RIWAYAT PERCAKAPAN SEBELUMNYA DENGAN USER INI (masih dalam sesi yang sama, gunakan sebagai konteks lanjutan kalau relevan — tapi kalau pertanyaan sekarang ganti topik, abaikan histori ini dan jawab topik barunya):
${conversationHistory}
` : ""}
GLOSARIUM SINGKATAN & ISTILAH MATERIAL PLN (pakai untuk memahami nama material di data maupun pertanyaan user yang pakai singkatan/bahasa awam — mis. user tanya "PMT" atau "pemutus" maksudnya CB/circuit breaker, "penangkal petir" = LA, "trafo arus" = CT. Jangan sebut istilah "glosarium" ke user):
${MATERIAL_GLOSSARY}

REFERENSI YANG BISA KAMU PAKAI (jangan sebut nama/istilah ini ke user, cukup pakai isinya secara natural):

Referensi Master Katalog & riwayat transaksi TUG yang relevan dengan pertanyaan:
${ragContext}

Data kondisi gudang terkini (qty, satuan, harga satuan, nilai Rupiah, material kritis):
${stateContext}

Kalau ditanya jumlah/qty/harga/nilai material, cek dulu "Data kondisi gudang terkini" di atas — itu angka real-time. Kalau ditanya lokasi/di gudang mana/di blok mana suatu material, atau status SAP/Non-SAP-nya, cek juga referensi katalog (biasanya bawa field "Lokasi fisik" dan "Status"). Untuk pertanyaan "stok terbanyak/paling banyak" pakai field topByQtyPerSatuan (jangan bandingkan qty antar satuan beda), untuk "akan habis/proyeksi" pakai field proyeksiStokHabis.`;

  // Single-call ke Groq (bukan tool-loop): tool-use bikin 3-4 panggilan/pertanyaan
  // yang menjebol limit free tier 12k token/menit. Akurasi dijaga lewat stateContext
  // yang diperkaya (topByQtyPerSatuan, proyeksiStokHabis) di nightly_sync.mjs.
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
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
  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  if (!resp.ok) {
    const errorBody = await resp.text();
    // Telegram rejects malformed Markdown with HTTP 400. Retry once as plain
    // text so a formatting issue in an LLM response never leaves the user
    // without the actual answer. Other API errors preserve the existing
    // best-effort logging behavior and are not retried.
    const isMarkdownEntityError = resp.status === 400 && /(?:parse entities|find end of (?:the )?entity|unclosed entity)/i.test(errorBody);
    if (isMarkdownEntityError) {
      console.error("Gagal kirim Telegram (Markdown), retry plain text:", resp.status, errorBody);
      const retryResp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!retryResp.ok) {
        console.error("Gagal retry kirim Telegram plain text:", retryResp.status, await retryResp.text());
      }
      return;
    }
    console.error("Gagal kirim Telegram:", resp.status, errorBody);
  }
}

// Indikator "sedang mengetik..." — dipanggil sebelum RAG query (Cohere+Groq) yang
// paling lama, biar user tahu bot lagi proses, bukan diam/hang. Best-effort,
// jangan sampai kegagalannya mengganggu alur balasan utama.
async function sendTypingAction(chatId: number | string) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
    if (!resp.ok) console.error("Gagal kirim typing indicator:", resp.status, await resp.text());
  } catch (e) {
    console.error("Gagal kirim typing indicator:", e);
  }
}

// ── Audit log ───────────────────────────────────────────────────────────────

async function writeLog(entry: Record<string, unknown>): Promise<{ id: number } | null> {
  try {
    const { data, error } = await supabase.from("tg_agent_logs").insert(entry).select("id").single();
    if (error) throw error;
    return data as { id: number };
  } catch (e) {
    console.error("Gagal tulis audit log:", e);
    return null;
  }
}

// ── Feedback 👍/👎 ────────────────────────────────────────────────────────────

async function sendTelegramFeedbackPrompt(chatId: number | string, logId: number) {
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Apakah jawaban-jawaban di atas membantu?",
      reply_markup: {
        inline_keyboard: [[
          { text: "👍 Membantu", callback_data: `fb:up:${logId}` },
          { text: "👎 Kurang Tepat", callback_data: `fb:down:${logId}` },
        ]],
      },
    }),
  });
  if (!resp.ok) console.error("Gagal kirim feedback prompt:", resp.status, await resp.text());
}

async function handleFeedbackCallback(callback: Record<string, any>) {
  const data = String(callback?.data ?? "");
  const chatId = callback?.message?.chat?.id;
  const callbackId = callback?.id;
  const [, vote, logIdStr] = data.split(":");
  const logId = Number(logIdStr);

  if (!["up", "down"].includes(vote) || !logId) {
    if (callbackId) await answerCallbackQuery(callbackId, "");
    return;
  }

  try {
    await supabase.from("tg_agent_logs").update({ feedback: vote }).eq("id", logId);
  } catch (e) {
    console.error("Gagal simpan feedback:", e);
  }

  if (callbackId) await answerCallbackQuery(callbackId, vote === "up" ? "Terima kasih! 🙏" : "Dicatat, akan diperbaiki Admin 🙏");

  // Edit pesan tombol jadi teks statis supaya tidak bisa diklik berkali-kali.
  if (chatId && callback?.message?.message_id) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: callback.message.message_id,
        text: vote === "up" ? "✅ Terima kasih atas feedback-nya!" : "📝 Terima kasih, akan diperbaiki Admin.",
      }),
    });
  }
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}
