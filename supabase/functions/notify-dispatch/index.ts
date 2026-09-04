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
import { renderWaMessage, docLabelFor } from "./renderWaMessage.mjs";

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

// stocks/katalog/gudang/upt disimpan sebagai {id, data jsonb} (pola masterSync.js
// loadMasterTable), bukan kolom relasional — jadi lookup per-id, bukan join SQL.
async function lookupNama(table: string, id?: string | null): Promise<string> {
  if (!id) return "";
  const { data } = await admin.from(table).select("data").eq("id", id).maybeSingle();
  return data?.data?.nama || "";
}

function join2(nama: string, unit?: string) {
  return unit ? `${nama} (${unit})` : nama;
}

function mapItems(raw: any[]) {
  return (raw || []).map((i: any) => ({ kode: i.kode || "-", nama: i.nama || "-", qty: i.qty, satuan: i.satuan || "" }));
}

// Detail canonical (TUG-8/9): txnId = tug_transactions.id. TUG-3/10 (legacy, blob
// txns lama) tidak punya row di sini -> query balik null, buildMessage jatuh ke payload.
async function fetchCanonical(txnId: string) {
  const { data: txn } = await admin
    .from("tug_transactions")
    .select("document, identity_snapshot, submitted_at, final_approved_at, doc_number, upt_id")
    .eq("id", txnId).maybeSingle();
  if (!txn) return null;

  const { data: approvals } = await admin
    .from("tug_approvals").select("event_type, decision, actor_snapshot, created_at")
    .eq("transaction_id", txnId).order("created_at", { ascending: true });
  const created = (approvals || []).find((a: any) => a.event_type === "CREATED");
  const finalApprove = [...(approvals || [])].reverse().find((a: any) => a.decision === "APPROVE");

  const doc = txn.document || {};
  let items: any[] = [];
  if (Array.isArray(doc.stockItems) && doc.stockItems.length) {
    const { data: rows } = await admin
      .from("tug_items").select("stock_id, qty, unit").eq("transaction_id", txnId).order("line_no", { ascending: true });
    if (rows?.length) {
      const stockIds = [...new Set(rows.map((i: any) => i.stock_id).filter(Boolean))];
      const { data: stockRows } = stockIds.length ? await admin.from("stocks").select("id, data").in("id", stockIds) : { data: [] };
      const katalogIdByStock: Record<string, string> = Object.fromEntries((stockRows || []).map((s: any) => [s.id, s.data?.katalogId]));
      const katalogIds = [...new Set(Object.values(katalogIdByStock).filter(Boolean))];
      const { data: katalogRows } = katalogIds.length ? await admin.from("katalog").select("id, data").in("id", katalogIds) : { data: [] };
      const katalogById: Record<string, any> = Object.fromEntries((katalogRows || []).map((k: any) => [k.id, k.data || {}]));
      items = rows.map((i: any) => {
        const kat = katalogById[katalogIdByStock[i.stock_id]] || {};
        return { kode: kat.katalog || "-", nama: kat.name || i.stock_id || "-", qty: i.qty, satuan: i.unit || kat.satuan || "" };
      });
    }
  }

  return { txn, doc, items, pengaju: created?.actor_snapshot?.name || "", approver: finalApprove?.actor_snapshot?.name || "" };
}

function fmtTanggal(ms: number) {
  return new Date(ms).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" }) + " WIB";
}

async function buildMessage(row: { doc_type: string; payload: Record<string, any>; created_at: number }) {
  const p = row.payload || {};
  const docType = p.docType || row.doc_type;
  const eventType = p.eventType === "PENDING" ? "PENDING" : "COMPLETION";
  const arah = p.arah || "KELUAR";
  const label = docLabelFor(docType);

  try {
    const canon = p.txnId ? await fetchCanonical(p.txnId) : null;
    const doc = canon?.doc || {};

    const [uptNama, gudang] = await Promise.all([
      lookupNama("upt", canon?.txn?.upt_id || p.uptId),
      lookupNama("gudang", doc.gudangId),
    ]);

    const items = Array.isArray(p.items) && p.items.length ? mapItems(p.items) : mapItems(canon?.items || []);

    const penerima = p.penerima?.nama
      ? join2(p.penerima.nama, p.penerima.unit)
      : doc.penerimaNama ? join2(doc.penerimaNama, doc.penerimaUnit) : "";

    const kontrak = p.kontrak || (doc.judulKontrak || doc.suratPesananNo || doc.dariSupplier
      ? { nama: doc.judulKontrak, noSP: doc.suratPesananNo, pt: doc.dariSupplier } : null);

    const tsMs = eventType === "COMPLETION"
      ? (canon?.txn?.final_approved_at ? Date.parse(canon.txn.final_approved_at) : row.created_at)
      : (canon?.txn?.submitted_at ? Date.parse(canon.txn.submitted_at) : row.created_at);

    const data = {
      eventType, arah, docType, docLabel: label,
      docNumber: canon?.txn?.doc_number || p.docNumber || "",
      uptNama, gudang,
      tanggal: fmtTanggal(tsMs),
      pekerjaan: p.pekerjaan || doc.namaPekerjaan || doc.pekerjaan || "",
      lokasi: doc.lokasiPekerjaan || "",
      penerima,
      kendaraan: doc.nopol || "",
      pengemudi: doc.namaPengemudi || "",
      approver: eventType === "COMPLETION" ? canon?.approver || "" : "",
      tl: eventType === "COMPLETION" ? canon?.txn?.identity_snapshot?.tl_name || "" : "",
      kontrak,
      asal: p.asal || null,
      pengaju: eventType === "PENDING" ? canon?.pengaju || "" : "",
      items,
      totalItem: items.length,
    };
    return renderWaMessage(data);
  } catch (_e) {
    // ponytail: gagal ambil detail (network/skema beda) -> jangan gagalkan kirim, fallback ringkas.
    const status = eventType === "PENDING" ? " — MENUNGGU PERSETUJUAN ASMAN" : " — DISETUJUI FINAL";
    const emoji = arah === "MASUK" ? "📥" : "📦";
    return `${emoji} *${label}${status}*\nNo. Dokumen: ${p.docNumber || "-"}`;
  }
}

// Disalin dari telegram-webhook/index.ts:522 (bukan diimpor — webhook tidak diubah).
async function sendTelegram(chatId: string, text: string) {
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Plain text (tanpa parse_mode): pesan kaya memakai *_ ala WhatsApp; kalau field bebas
    // (nama/PT/pekerjaan) mengandung *_[ tak berpasangan, Telegram Markdown akan GAGAL KIRIM.
    // Telegram di dispatcher ini praktis tak dipakai (semua notif = WA), jadi utamakan reliabilitas.
    body: JSON.stringify({ chat_id: chatId, text }),
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
