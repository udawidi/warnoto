// @ts-nocheck — runtime Deno (Supabase Edge Functions), lihat catatan sama
// di supabase/functions/admin-create-user/index.ts.
//
// ponytail: skeleton dispatcher untuk notif_outbox (lihat migrasi
// 20260902_notif_outbox.sql). Baca baris PENDING, kirim per channel, tulis
// balik status. Telegram pakai pola sendTelegramMessage yang SUDAH ADA di
// telegram-webhook/index.ts:522 (disalin, bukan diimpor — webhook itu tidak
// disentuh). WA masih STUB, provider belum diputuskan user.
//
// Trigger DB hanya insert baris PENDING (tanpa network call) — fungsi ini yang
// dipanggil belakangan (cron/manual, BUKAN bagian dari fondasi ini) untuk
// benar-benar mengirim.
//
// ── CARA DEPLOY (belum dilakukan — menunggu keputusan user) ──
//   npx supabase functions deploy notify-dispatch --project-ref <ref>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const MAX_ATTEMPTS = 5;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function buildMessage(row: { doc_type: string; payload: Record<string, unknown> }) {
  const p = row.payload || {};
  // TODO(materi): tambahkan daftar item dari tug_items (join by tug_txn_id) kalau
  // dibutuhkan di badan pesan — belum diambil di sini supaya skeleton tetap ringan.
  return `📦 ${row.doc_type} ${p.docNumber || ""} FINAL APPROVED — UPT ${p.uptId || "-"}. Material siap dikeluarkan dari gudang.`;
}

// Disalin dari telegram-webhook/index.ts:522 (bukan diimpor — webhook tidak diubah).
async function sendTelegram(chatId: string, text: string) {
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!resp.ok) throw new Error(`Telegram HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// STUB — provider WA belum dipilih user (Meta Cloud API butuh message template
// berbayar vs gateway tak-resmi seperti Baileys). JANGAN isi endpoint di sini
// sebelum keputusan itu turun; kredensial env masih placeholder.
// TODO(provider): isi setelah user pilih Meta Cloud API vs gateway tak-resmi.
async function sendWhatsApp(_target: string, _text: string): Promise<never> {
  throw new Error("NOT_CONFIGURED");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { data: rows, error } = await admin
    .from("notif_outbox")
    .select("*")
    .eq("status", "PENDING")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0;
  for (const row of rows || []) {
    const text = buildMessage(row);
    try {
      if (row.channel === "TELEGRAM") {
        await sendTelegram(row.recipient, text);
      } else if (row.channel === "WA") {
        await sendWhatsApp(row.recipient, text);
      } else {
        throw new Error(`Channel tidak dikenal: ${row.channel}`);
      }
      await admin.from("notif_outbox").update({ status: "SENT", sent_at: Date.now() }).eq("id", row.id);
      sent++;
    } catch (e) {
      await admin.from("notif_outbox").update({
        status: "FAILED",
        attempts: (row.attempts || 0) + 1,
        last_error: String(e?.message || e),
      }).eq("id", row.id);
      failed++;
    }
  }

  return json({ processed: (rows || []).length, sent, failed });
});
