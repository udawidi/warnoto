// Canonical TUG RPC client.  The feature is deliberately capability-gated so a
// frontend deployed before the reviewed SQL migration remains read/write-safe.
import { supabase } from "../supabaseClient.js";

const RPC_MISSING = /could not find (the )?function|does not exist|relation .* does not exist|404/i;

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

export function isCanonicalUnavailable(error) {
  return !supabase || RPC_MISSING.test(String(error?.message || error || ""));
}

async function rpc(name, args) {
  if (!supabase) return { data: null, unavailable: true };
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isCanonicalUnavailable(error)) return { data: null, unavailable: true };
    throw new Error(error.message || `RPC ${name} gagal`);
  }
  return { data, unavailable: false };
}

export function canonicalItem(item = {}) {
  return {
    ...item,
    stockId: item.stockId || null,
    katalogId: item.katalogId || null,
    lokasiId: item.lokasiId || item.lokasiTujuanId || null,
    qty: Number(item.qty || item.permintaan || 0),
    unit: item.unit || item.satuan || null,
  };
}

export function canonicalDocument(docType, formData, currentUser) {
  const uptId = formData.uptId || formData.upt_id || currentUser?.uptId || currentUser?.upt_id;
  if (!uptId) throw new Error("UPT transaksi tidak tersedia. Lengkapi scope UPT akun sebelum membuat dokumen resmi.");
  return {
    ...formData,
    docType,
    uptId,
    submittedFrom: "warnoto-web",
  };
}

/** Create and submit the official record in one user action. */
export function newCanonicalActionKeys() { return { create: uuid(), submit: uuid(), decide: uuid() }; }

export async function createAndSubmitCanonicalTug({ docType, formData, currentUser, idempotencyKeys }) {
  const document = canonicalDocument(docType, formData, currentUser);
  const items = (formData.stockItems || []).map(canonicalItem);
  const created = await rpc("tug_create_transaction", {
    p_document: document,
    p_items: items,
    p_idempotency_key: idempotencyKeys?.create || uuid(),
  });
  if (created.unavailable) return { unavailable: true };
  const submitted = await rpc("tug_submit_transaction", {
    p_transaction_id: created.data.id,
    p_expected_version: created.data.version,
    p_idempotency_key: idempotencyKeys?.submit || uuid(),
  });
  if (submitted.unavailable) return { unavailable: true };
  return { unavailable: false, ...submitted.data, docSequence: created.data.docSequence, identitySnapshot: created.data.identitySnapshot, created: created.data };
}

/** TL amend of a still-PENDING canonical TUG-8/9 (fixing admin input errors in place). */
export async function amendCanonicalTug({ txn, formData, currentUser, idempotencyKey }) {
  const document = canonicalDocument(txn.docType, formData, currentUser);
  const items = (formData.stockItems || []).map(canonicalItem);
  return rpc("tug_amend", {
    p_transaction_id: txn.canonicalId || txn.id,
    p_expected_version: txn.canonicalVersion || txn.version,
    p_document: document,
    p_items: items,
    p_idempotency_key: idempotencyKey || uuid(),
  });
}

export async function prepareCanonicalTugReview(txn) {
  return rpc("tug_prepare_review", {
    p_transaction_id: txn.canonicalId || txn.id,
    p_expected_version: txn.canonicalVersion || txn.version,
  });
}

export async function decideCanonicalTug({ txn, decision, reviewToken = null, reason = "", attestations = null, idempotencyKey }) {
  return rpc("tug_decide", {
    p_transaction_id: txn.canonicalId || txn.id,
    p_expected_version: txn.canonicalVersion || txn.version,
    p_decision: decision,
    p_review_token: reviewToken,
    p_reason: reason || null,
    p_idempotency_key: idempotencyKey || uuid(),
    p_attestations: attestations,
  });
}

export function canonicalRowToTxn(row) {
  const document = row.document || {};
  const docKey = { TUG3: "tug3", TUG5: "tug5", TUG7: "tug7", TUG8: "tug8", TUG9: "tug9", TUG10: "tug10" }[row.doc_type];
  const approvals = [...(row.tug_approvals || [])].filter(e => e.decision === "APPROVE").sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)));
  const tlApproval = approvals.find(e => e.actor_snapshot?.role === "TL");
  const asmanApproval = approvals.find(e => e.actor_snapshot?.role === "ASMAN" && e.stage === "FINAL_APPROVED");
  return {
    ...document,
    id: row.id,
    canonicalId: row.id,
    canonical: true,
    canonicalVersion: row.version,
    docType: row.doc_type,
    docSeq: Number(row.doc_sequence),
    docNumbers: { ...(document.docNumbers || {}), [docKey]: row.doc_number },
    stockItems: (row.tug_items || []).map(i => ({ ...i.snapshot, stockId: i.stock_id, katalogId: i.katalog_id, lokasiId: i.lokasi_id, qty: Number(i.qty), unit: i.unit })),
    status: row.status === "FINAL_APPROVED" ? "APPROVED" : row.status,
    stage: row.stage,
    requiredApprover: { PENDING_TL:"TL", PENDING_ASMAN:"ASMAN", PENDING_MANAGER:"MANAGER", PENDING_MGR_LOGISTIK:"MGR_LOGISTIK_UIT", PENDING_MGR_ULTG:"MGR_ULTG" }[row.stage] || null,
    uptId: row.upt_id,
    createdBy: row.created_by,
    createdAt: Date.parse(row.created_at) || Date.now(),
    submittedAt: row.submitted_at ? Date.parse(row.submitted_at) : null,
    approvedAt: row.final_approved_at ? Date.parse(row.final_approved_at) : null,
    identitySnapshot: row.identity_snapshot || {},
    approvalEvents: row.tug_approvals || [],
    approvedByTL: tlApproval?.actor_id || null,
    approvedAtTL: tlApproval?.created_at ? Date.parse(tlApproval.created_at) : null,
    approvedBy: asmanApproval?.actor_id || null,
  };
}

export async function loadCanonicalTugTransactions() {
  if (!supabase) return { rows: [], unavailable: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("tug_transactions")
      .select("*, tug_items(*), tug_approvals(*)")
      .order("created_at", { ascending: false });
    if (!error) return { rows: (data || []).map(canonicalRowToTxn), unavailable: false };
    if (isCanonicalUnavailable(error)) return { rows: [], unavailable: true };
    // Sesaat setelah login, request ini bisa sempat tertembak sebelum token sesi
    // baru melekat di client (race), muncul sebagai "permission denied" karena
    // diperlakukan anon. Retry sekali setelah jeda singkat sebelum menyerah.
    if (attempt === 0 && /permission denied/i.test(error.message || "")) {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    throw new Error(error.message || "Gagal membaca transaksi TUG canonical");
  }
}

// Legacy records are never auto-imported.  Only explicitly chosen final records
// may use this baseline RPC, which writes no stock movement and dedupes legacy_id.
export async function importLegacyTugBaseline(legacyTxn, uptId) {
  const docKey = { TUG3: "tug3", TUG5: "tug5", TUG7: "tug7", TUG8: "tug8", TUG9: "tug9", TUG10: "tug10" }[legacyTxn.docType];
  return rpc("tug_import_legacy_baseline", {
    p_legacy_id: legacyTxn.id,
    p_document: { ...legacyTxn, docNumber: legacyTxn.docNumbers?.[docKey], uptId: legacyTxn.uptId || uptId || (() => { throw new Error("UPT legacy wajib dipilih sebelum import baseline."); })() },
    p_items: (legacyTxn.stockItems || []).map(canonicalItem),
  });
}
