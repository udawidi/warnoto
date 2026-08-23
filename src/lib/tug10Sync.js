// Persistensi TUG-10 (barang kembali/retur) ke tabel `tug10_transactions`. Alur approval
// TETAP di App.jsx approveTxn — file ini murni load/upsert/delete, gagal selalu
// fail-safe (tak throw, tak sukses palsu). Mirror persis src/lib/tug3Sync.js.
import { supabase } from "../supabaseClient.js";
import { isCanonicalUnavailable } from "./tugCanonical.js";
import { processTxnPhotos } from "./supabaseSync.js";

function rowToTxn(row) {
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    stage: row.stage,
    status: row.status,
    uptId: row.upt_id,
    docNumbers: data.docNumbers || (row.doc_number ? { tug10: row.doc_number } : {}),
    canonical10: true,
  };
}

export async function loadTug10Transactions() {
  if (!supabase) return { rows: [], unavailable: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("tug10_transactions")
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
    console.warn("loadTug10Transactions gagal:", error.message || error);
    return { rows: [], unavailable: true };
  }
}

export async function upsertTug10Transaction(txn) {
  if (!supabase || !txn?.id) return false;
  // upt_id NOT NULL di DB — jangan tulis null (gagal senyap sebelumnya, data hilang).
  if (!txn.uptId) { console.warn("upsertTug10Transaction ditolak: txn tanpa uptId", txn.id); return false; }
  let createdBy = null;
  try { createdBy = (await supabase.auth.getUser()).data?.user?.id || null; } catch {}
  // Guard base64 (fix akar sama tug3Sync): upload dulu foto data:image ke Storage
  // sebelum disimpan — normal path (foto sudah URL) no-op, gagal upload = tetap base64
  // + pending (tak dibuang), disinkron ulang nanti.
  const { data: txnForRow } = await processTxnPhotos(txn, txn.id);
  const row = {
    id: txn.id,
    upt_id: txn.uptId || null,
    created_by: createdBy,
    doc_number: txn.docNumbers?.tug10 || null,
    stage: txn.stage,
    status: txn.status,
    data: txnForRow,
    created_at: txn.createdAt || Date.now(),   // kolom bigint (epoch ms), bukan ISO string
    updated_at: Date.now(),
  };
  const { data, error } = await supabase.from("tug10_transactions").upsert(row, { onConflict: "id" }).select("id");
  if (error) { console.warn("upsertTug10Transaction gagal:", error.message || error); return false; }
  return (data || []).length > 0;
}

export async function deleteTug10Transaction(id) {
  if (!supabase || !id) return false;
  const { data, error } = await supabase.from("tug10_transactions").delete().eq("id", id).select("id");
  if (error) { console.warn("deleteTug10Transaction gagal:", error.message || error); return false; }
  return (data || []).length > 0;
}
