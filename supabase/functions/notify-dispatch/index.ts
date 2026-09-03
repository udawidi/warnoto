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
const FONNTE_TOKEN = Deno.env.get("FONNTE_TOKEN") ?? "";
const MAX_ATTEMPTS = 5;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// stocks/katalog disimpan sebagai {id, data jsonb} (lihat masterSync.js loadMasterTable),
// bukan kolom relasional — jadi 3 query berantai (items -> stocks -> katalog) untuk nama/kode.
async function buildMessage(row: { doc_type: string; payload: Record<string, any> }) {
  const p = row.payload || {};
  const arahMasuk = p.arah === "MASUK";
  const fallback = arahMasuk
    ? `📥 ${row.doc_type} ${p.docNumber || ""} — PENERIMAAN BARANG DISETUJUI\nUPT ${p.uptId || "-"}. Barang masuk gudang.`
    : `📦 ${row.doc_type} ${p.docNumber || ""} FINAL APPROVED — UPT ${p.uptId || "-"}. Material siap dikeluarkan dari gudang.`;

  // TUG-3/4 (legacy, tidak punya row tug_items) sudah bawa daftar material sendiri
  // di payload.items (lihat enqueueLegacyTugNotif di useTugApprovals.js) — pakai
  // langsung, skip query tug_items/stocks/katalog di bawah.
  if (Array.isArray(p.items) && p.items.length) {
    const lines = p.items.map((i: any) => `- ${i.kode || "-"} ${i.nama || "-"}: ${i.qty} ${i.satuan || ""}`.trim());
    const judul = arahMasuk
      ? `📥 ${row.doc_type} ${p.docNumber || ""} — PENERIMAAN BARANG DISETUJUI`
      : `📦 ${row.doc_type} ${p.docNumber || ""} — DISETUJUI FINAL`;
    const sub = arahMasuk ? `Barang masuk gudang UPT ${p.uptId || "-"}` : `UPT: ${p.uptId || "-"}`;
    return `${judul}\n${sub}\nMaterial:\n${lines.join("\n")}`;
  }

  const txnId = p.txnId;
  if (!txnId) return fallback;
  // ponytail: gagal ambil detail (tabel/kolom beda, network) -> jangan gagalkan kirim, pakai fallback ringkas.
  try {
    const { data: items } = await admin
      .from("tug_items").select("stock_id, qty, unit").eq("transaction_id", txnId).order("line_no", { ascending: true });
    if (!items?.length) return fallback;

    const stockIds = [...new Set(items.map((i: any) => i.stock_id).filter(Boolean))];
    const { data: stockRows } = stockIds.length ? await admin.from("stocks").select("id, data").in("id", stockIds) : { data: [] };
    const katalogIdByStock: Record<string, string> = Object.fromEntries((stockRows || []).map((s: any) => [s.id, s.data?.katalogId]));

    const katalogIds = [...new Set(Object.values(katalogIdByStock).filter(Boolean))];
    const { data: katalogRows } = katalogIds.length ? await admin.from("katalog").select("id, data").in("id", katalogIds) : { data: [] };
    const katalogById: Record<string, any> = Object.fromEntries((katalogRows || []).map((k: any) => [k.id, k.data || {}]));

    const { data: txnRow } = await admin.from("tug_transactions").select("final_approved_at").eq("id", txnId).maybeSingle();
    const tanggal = txnRow?.final_approved_at ? new Date(txnRow.final_approved_at).toLocaleDateString("id-ID") : "-";

    const lines = items.map((i: any) => {
      const kat = katalogById[katalogIdByStock[i.stock_id]] || {};
      const kode = kat.katalog || "-";
      const nama = kat.name || i.stock_id || "-";
      return `- ${kode} ${nama}: ${i.qty} ${i.unit || kat.satuan || ""}`.trim();
    });

    return `📦 ${row.doc_type} ${p.docNumber || ""} — DISETUJUI FINAL\nUPT: ${p.uptId || "-"} | Tgl: ${tanggal}\nMaterial:\n${lines.join("\n")}`;
  } catch (_e) {
    return fallback;
  }
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

async function sendWhatsApp(target: string, text: string) {
  if (!FONNTE_TOKEN) throw new Error("FONNTE_TOKEN belum diset di server");
  const resp = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: FONNTE_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ target, message: text }).toString(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) throw new Error(`Fonnte gagal: ${data.reason || resp.status}`);
  return data;
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
    const text = await buildMessage(row);
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
