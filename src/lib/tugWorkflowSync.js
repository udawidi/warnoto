// Server-first persistence for TUG-5/TUG-7 lifecycle and pre-canonical TUG-8/9.
// Direct table writes are intentionally not used: all mutations go through the
// versioned SECURITY DEFINER RPCs in 20260923_tug_workflow_persistence.sql.
import { supabase } from "../supabaseClient.js";
import { processTxnPhotos } from "./supabaseSync.js";

const TYPES = new Set(["TUG5", "TUG7", "TUG8", "TUG9"]);

function rowToTxn(row) {
  const data = row?.data && typeof row.data === "object" ? row.data : {};
  return {
    ...data,
    id: row.id,
    docType: row.doc_type,
    uptId: row.upt_id !== undefined ? row.upt_id : (data.uptId || null),
    uitId: row.uit_id !== undefined ? row.uit_id : (data.uitId || null),
    ultgId: row.ultg_id !== undefined ? row.ultg_id : (data.ultgId || null),
    stage: row.stage,
    status: row.status,
    docNumbers: row.doc_number
      ? { ...(data.docNumbers || {}), [row.doc_type.toLowerCase()]: row.doc_number }
      : (data.docNumbers || {}),
    docSeq: row.doc_sequence ?? data.docSeq ?? null,
    workflowVersion: row.version,
    workflowParentId: row.parent_workflow_id ?? null,
    workflowCreatedBy: row.created_by,
    workflowUpdatedAt: row.updated_at,
    workflow: true,
  };
}

export function isWorkflowDoc(txn) {
  return !!txn && TYPES.has(String(txn.docType || "").toUpperCase())
    && !txn.canonical && !txn.canonical3 && !txn.canonical10
    && ["TUG5", "TUG7", "TUG8", "TUG9"].includes(String(txn.docType).toUpperCase());
}

export function isTugWorkflowConflict(error) {
  const text = String(error?.message || error || "");
  return /TUG_WORKFLOW_VERSION_MISMATCH|version mismatch|conflict/i.test(text);
}

export async function loadTugWorkflowTransactions() {
  if (!supabase) return { rows: [], unavailable: true };
  const { data, error } = await supabase
    .from("tug_workflow_transactions")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("loadTugWorkflowTransactions gagal:", error.message || error);
    return { rows: [], unavailable: true, error };
  }
  return { rows: (data || []).map(rowToTxn), unavailable: false };
}

function rpcErrorResult(error) {
  if (error) console.warn("TUG workflow RPC gagal:", error.message || error);
  return { ok: false, conflict: isTugWorkflowConflict(error), error };
}

export async function saveTugWorkflowTransaction(txn, { expectedVersion = null } = {}) {
  if (!supabase || !txn?.id || !isWorkflowDoc(txn)) return { ok: false, unavailable: !supabase };
  const docType = String(txn.docType).toUpperCase();
  if (!TYPES.has(docType)) return { ok: false, error: new Error("TUG_WORKFLOW_DOC_TYPE_INVALID") };
  const { data: processed, pending = [] } = await processTxnPhotos(txn, txn.id);
  if (pending.length) return { ok: false, error: new Error("TUG_WORKFLOW_PHOTO_NOT_STORED") };
  const data = { ...processed, docType };
  const uitScoped = docType === "TUG7" || (docType === "TUG5" && (txn.stage === "DRAFT_UIT" || txn.docSubType === "UIT_INTERCOMPANY"));
  const docNumber = txn.docNumbers?.[docType.toLowerCase()] || null;
  const { data: result, error } = await supabase.rpc("save_tug_workflow_transaction", {
    p_id: txn.id,
    p_doc_type: docType,
    p_upt_id: uitScoped ? null : (txn.uptId || null),
    p_uit_id: uitScoped ? (txn.uitId || null) : null,
    p_ultg_id: txn.ultgId || null,
    p_stage: txn.stage || "DRAFT",
    p_status: txn.status || "DRAFT",
    p_doc_number: docNumber,
    p_doc_sequence: txn.docSeq ?? null,
    p_data: data,
    p_expected_version: expectedVersion ?? txn.workflowVersion ?? null,
  });
  if (error) return rpcErrorResult(error);
  return { ok: true, result: Array.isArray(result) ? result[0] : result, txn: { ...txn, workflowVersion: result?.version } };
}

export async function deleteTugWorkflowTransaction(id, expectedVersion) {
  if (!supabase || !id) return { ok: false, unavailable: !supabase };
  const { data, error } = await supabase.rpc("delete_tug_workflow_transaction", {
    p_id: id,
    p_expected_version: expectedVersion,
  });
  if (error) return rpcErrorResult(error);
  return { ok: true, result: Array.isArray(data) ? data[0] : data };
}

export async function issueTugWorkflowDocumentNumber(id, expectedVersion, numberUptId = null) {
  if (!supabase || !id) return { ok: false, unavailable: !supabase };
  const { data, error } = await supabase.rpc("issue_tug_workflow_document_number", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_number_upt_id: numberUptId,
  });
  if (error) return rpcErrorResult(error);
  return { ok: true, result: Array.isArray(data) ? data[0] : data };
}

export async function transitionTugWorkflowTransaction(id, expectedVersion, targetStage, targetStatus, patch = {}) {
  if (!supabase || !id) return { ok: false, unavailable: !supabase };
  const { data, error } = await supabase.rpc("transition_tug_workflow_transaction", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_target_stage: targetStage,
    p_target_status: targetStatus,
    p_patch: patch || {},
  });
  if (error) return rpcErrorResult(error);
  return { ok: true, result: Array.isArray(data) ? data[0] : data };
}

export async function transitionTugWorkflowWithChild({ action, parent, child }) {
  if (!supabase || !parent?.id || !child?.id) return { ok: false, unavailable: !supabase };
  const { data: processed, pending = [] } = await processTxnPhotos(child, child.id);
  if (pending.length) return { ok: false, error: new Error("TUG_WORKFLOW_PHOTO_NOT_STORED") };
  const { data, error } = await supabase.rpc("transition_tug_workflow_with_child", {
    p_action: action,
    p_parent_id: parent.id,
    p_expected_version: parent.workflowVersion ?? null,
    p_child_id: child.id,
    p_child_data: { ...processed, docType: String(child.docType || "").toUpperCase() },
  });
  if (error) return rpcErrorResult(error);
  const result = Array.isArray(data) ? data[0] : data;
  const parentTxn = result?.parent ? { ...parent, ...rowToTxn(result.parent) } : parent;
  const childTxn = result?.child ? { ...child, ...rowToTxn(result.child) } : child;
  return { ok: true, idempotent: !!result?.idempotent, result, parent: parentTxn, child: childTxn };
}

export function mergeWorkflowServerWins(serverRows = [], cachedRows = []) {
  const serverIds = new Set(serverRows.map(row => row?.id).filter(Boolean));
  return [...serverRows, ...cachedRows.filter(row => isWorkflowDoc(row) && !serverIds.has(row.id))];
}

export async function migrateLegacyWorkflowDrafts(cachedRows = [], serverRows = []) {
  if (!supabase) return { rows: serverRows, unavailable: true, migrated: 0, failed: [] };
  const known = new Set(serverRows.map(row => row?.id).filter(Boolean));
  const candidates = cachedRows.filter(row => isWorkflowDoc(row) && !known.has(row.id));
  const migrated = [];
  const failed = [];
  for (const row of candidates) {
    const hasLegacyNumber = !!(row.docNumbers?.[String(row.docType).toLowerCase()] || row.docSeq != null);
    const importRow = hasLegacyNumber ? { ...row, legacyImport: true } : row;
    const result = await saveTugWorkflowTransaction(importRow, { expectedVersion: null });
    if (result.ok) {
      migrated.push({ ...row, workflow: true, workflowVersion: result.result?.version || 1 });
      known.add(row.id);
    } else failed.push({ id: row.id, conflict: !!result.conflict, error: result.error });
  }
  return { rows: [...serverRows, ...migrated], unavailable: false, migrated: migrated.length, failed };
}

export function workflowRowFromResult(txn, result) {
  const version = result?.version ?? txn?.workflowVersion ?? null;
  return version == null ? txn : { ...txn, workflow: true, workflowVersion: version };
}
