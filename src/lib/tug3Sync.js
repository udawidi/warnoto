// Persistensi TUG-3/4 (barang masuk) ke tabel `tug3_transactions`. Alur approval
// TETAP di App.jsx/useTugApprovals.js — file ini murni load/upsert/delete, gagal
// selalu fail-safe (tak throw, tak sukses palsu). Pola ringkas dari tugCanonical.js.
import { supabase } from "../supabaseClient.js";
import { isCanonicalUnavailable, newTugIdempotencyKey } from "./tugCanonical.js";
import { processTxnPhotos } from "./supabaseSync.js";

function rowToTxn(row) {
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    stage: row.stage,
    status: row.status,
    uptId: row.upt_id,
    mtuRecordId: row.mtu_record_id || data.mtuRecordId || data.mtu_record_id || null,
    docNumbers: data.docNumbers || (row.doc_number ? { tug3: row.doc_number } : {}),
    canonical3: true,
  };
}

export async function loadTug3Transactions() {
  if (!supabase) return { rows: [], unavailable: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("tug3_transactions")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) return { rows: (data || []).map(rowToTxn), unavailable: false };
    if (isCanonicalUnavailable(error)) return { rows: [], unavailable: true };
    // Race sesaat setelah login (token sesi belum melekat) — sama seperti
    // loadCanonicalTugTransactions, retry sekali sebelum menyerah.
    if (attempt === 0 && /permission denied/i.test(error.message || "")) {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    // ponytail: fail-safe generik (bukan relation-missing/permission race) — dianggap
    // unavailable daripada throw, supaya loader App.jsx tetap jatuh ke cache legacy.
    console.warn("loadTug3Transactions gagal:", error.message || error);
    return { rows: [], unavailable: true };
  }
}

export async function upsertTug3Transaction(txn) {
  if (!supabase || !txn?.id) return false;
  // upt_id NOT NULL di DB — jangan tulis null (gagal senyap sebelumnya, data hilang).
  if (!txn.uptId) { console.warn("upsertTug3Transaction ditolak: txn tanpa uptId", txn.id); return false; }
  let createdBy = null;
  try { createdBy = (await supabase.auth.getUser()).data?.user?.id || null; } catch {}
  // Fix akar base64-di-DB: kalau ada foto masih data:image (upload sebelumnya
  // belum jalan/gagal), upload dulu ke Storage sebelum disimpan. Normal path
  // (foto sudah URL/priv:) = no-op murah, processTxnPhotos skip non-dataURL.
  // Fail-safe: gagal upload → field tetap base64 + txn._fotoPending=true, TIDAK dibuang.
  const { data: txnForRow } = await processTxnPhotos(txn, txn.id);
  const row = {
    id: txn.id,
    upt_id: txn.uptId || null,
    created_by: createdBy,
    doc_number: txn.docNumbers?.tug3 || null,
    stage: txn.stage,
    status: txn.status,
    data: txnForRow,
    created_at: txn.createdAt || Date.now(),   // kolom bigint (epoch ms), bukan ISO string
    updated_at: Date.now(),
  };
  // Keep ordinary TUG-3 writes compatible with deployments before the MTU
  // migration. The optional column is sent only for an explicitly MTU-linked
  // receipt.
  if (txn.mtuRecordId || txn.mtu_record_id) row.mtu_record_id = txn.mtuRecordId || txn.mtu_record_id;
  const { data, error } = await supabase.from("tug3_transactions").upsert(row, { onConflict: "id" }).select("id");
  if (error) { console.warn("upsertTug3Transaction gagal:", error.message || error); return false; }
  return (data || []).length > 0;
}

export function formatTugMaraError(error, label = "TUG-3") {
  const code = String(error?.code || error?.details || error?.message || "").toUpperCase();
  if (code.includes("MARA_CATALOG_REQUIRED")) return `${label} ditolak: nomor katalog wajib dipilih dari data MARA.`;
  if (code.includes("MARA_CATALOG_NOT_FOUND")) return `${label} ditolak: nomor katalog tidak ditemukan di data MARA. Perbaiki item lalu coba lagi.`;
  if (code.includes("MARA_CATALOG_AMBIGUOUS")) return `${label} ditolak: nomor katalog memiliki lebih dari satu padanan MARA. Pilih katalog yang tepat.`;
  if (code.includes("MARA_CATALOG_INVALID")) return `${label} ditolak: data MARA tidak lengkap (nama/satuan). Perbaiki master MARA lalu coba lagi.`;
  if (code.includes("CATALOG_MARA_MISMATCH")) return `${label} ditolak: identitas katalog tidak sesuai data MARA. Petakan ulang material.`;
  return error?.message || `${label} gagal diproses.`;
}

export async function approveTug3Final(txnId, idempotencyKey = newTugIdempotencyKey()) {
  if (!supabase) throw new Error("Layanan database belum tersedia.");
  if (!txnId || !idempotencyKey) throw new Error("Approval TUG-3 tidak memiliki kunci idempotensi.");
  const { data, error } = await supabase.rpc("approve_tug3_final", { p_tug3_id: txnId, p_idempotency_key: idempotencyKey });
  if (error) throw error;
  if (!data?.transaction) throw new Error("Respons approval TUG-3 tidak lengkap.");
  return data;
}

export async function deleteTug3Transaction(id) {
  if (!supabase || !id) return false;
  const { data, error } = await supabase.from("tug3_transactions").delete().eq("id", id).select("id");
  if (error) { console.warn("deleteTug3Transaction gagal:", error.message || error); return false; }
  return (data || []).length > 0;
}
