// Persistensi TUG-3/4 (barang masuk) ke tabel `tug3_transactions`. Alur approval
// TETAP di App.jsx/useTugApprovals.js — file ini murni load/upsert/delete, gagal
// selalu fail-safe (tak throw, tak sukses palsu). Pola ringkas dari tugCanonical.js.
import { supabase } from "../supabaseClient.js";
import { isCanonicalUnavailable } from "./tugCanonical.js";

function rowToTxn(row) {
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    stage: row.stage,
    status: row.status,
    uptId: row.upt_id,
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
  let createdBy = null;
  try { createdBy = (await supabase.auth.getUser()).data?.user?.id || null; } catch {}
  const row = {
    id: txn.id,
    upt_id: txn.uptId || null,
    created_by: createdBy,
    doc_number: txn.docNumbers?.tug3 || null,
    stage: txn.stage,
    status: txn.status,
    data: txn,
    created_at: txn.createdAt || Date.now(),   // kolom bigint (epoch ms), bukan ISO string
    updated_at: Date.now(),
  };
  const { data, error } = await supabase.from("tug3_transactions").upsert(row, { onConflict: "id" }).select("id");
  if (error) { console.warn("upsertTug3Transaction gagal:", error.message || error); return false; }
  return (data || []).length > 0;
}

export async function deleteTug3Transaction(id) {
  if (!supabase || !id) return false;
  const { data, error } = await supabase.from("tug3_transactions").delete().eq("id", id).select("id");
  if (error) { console.warn("deleteTug3Transaction gagal:", error.message || error); return false; }
  return (data || []).length > 0;
}
