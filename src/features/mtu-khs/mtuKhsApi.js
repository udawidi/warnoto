import { supabase } from "../../supabaseClient.js";
import { normalizeMtuRecord, filterMtuRecords, isMtuNationalRole } from "./mtuKhsModel.js";

const pageSize = 1000;
const ACTIVE_MASTER_TABLES = new Set(["mtu_khs_gardu_induk", "mtu_khs_gardu_induk_bay"]);
export function mtuKhsMasterQuery(table) { return ACTIVE_MASTER_TABLES.has(table) ? { active: true } : {}; }
export function friendlyMtuKhsError(error) {
  const message = error?.message || String(error || "");
  return /relation .* does not exist|could not find the table|schema cache/i.test(message)
    ? "Database MTU KHS belum diaktifkan. Terapkan migration terlebih dahulu."
    : message || "Permintaan MTU KHS gagal";
}

async function fetchPaged(table, query = {}) {
  if (!supabase) return { data: [], error: new Error("Supabase belum tersedia") };
  const rows = [];
  try {
    for (let from = 0; ; from += pageSize) {
      let request = supabase.from(table).select("*").order("created_at", { ascending: false }).range(from, from + pageSize - 1);
      Object.entries(query).forEach(([column, value]) => { if (value !== undefined && value !== null && value !== "") request = request.eq(column, value); });
      const { data, error } = await request;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data: rows, error: null };
  } catch (error) {
    return { data: [], error };
  }
}

function unwrap(row) {
  return normalizeMtuRecord({ ...(row?.data || {}), id: row?.id, uptId: row?.upt_id || row?.data?.uptId, ultgId: row?.ultg_id || row?.data?.ultgId, garduIndukId: row?.gardu_induk_id || row?.data?.garduIndukId, bayId: row?.bay_id || row?.data?.bayId, lifecycleStatus: row?.lifecycle_status || row?.data?.lifecycleStatus, status: row?.status || row?.data?.status });
}

export async function loadMtuKhsRecords({ user, uptList = [], year } = {}) {
  const result = await fetchPaged("mtu_khs_records", year ? { procurement_year: year } : {});
  return { ...result, data: filterMtuRecords(result.data.map(unwrap), user, uptList) };
}

export async function loadMtuKhsMaster(table, { user, uptList = [] } = {}) {
  const result = await fetchPaged(table, mtuKhsMasterQuery(table));
  if (!result.error) {
    const data = result.data.map(row => ({ ...(row.data || {}), id: row.id, uptId: row.upt_id || row.data?.uptId, ultgId: row.ultg_id || row.data?.ultgId, garduIndukId: row.gardu_induk_id || row.data?.garduIndukId }));
    return { ...result, data: isMtuNationalRole(user) ? data : data.filter(row => !row.uptId || filterMtuRecords([row], user, uptList).length > 0) };
  }
  return result;
}

export async function loadMtuKhsDocuments({ recordId } = {}) {
  if (recordId) {
    const links = await fetchPaged("mtu_khs_record_documents", { record_id: recordId });
    const documents = await fetchPaged("mtu_khs_documents");
    const linkedIds = new Set(links.data.map(link => link.document_id));
    return { error: links.error || documents.error, data: documents.data.filter(document => linkedIds.has(document.id)).map(document => ({ ...document, recordId })) };
  }
  const [documents, links] = await Promise.all([fetchPaged("mtu_khs_documents"), fetchPaged("mtu_khs_record_documents")]);
  const byDocument = new Map((links.data || []).map(link => [link.document_id, link.record_id]));
  return { error: documents.error || links.error, data: (documents.data || []).map(document => ({ ...document, recordId: byDocument.get(document.id) })) };
}

export async function loadMtuKhsUsage(recordId) {
  return fetchPaged("mtu_khs_usage_links", recordId ? { mtu_record_id: recordId, status: "APPROVED" } : { status: "APPROVED" });
}

export async function submitMtuKhsChange({ recordId, expectedVersion = 1, patch, idempotencyKey = `mtu-${Date.now()}`, currentUser }) {
  if (!supabase || !recordId || !patch || !currentUser?.id) return { data: null, error: new Error("Data perubahan MTU tidak lengkap") };
  return supabase.rpc("mtu_khs_submit_change", { p_record_id: recordId, p_expected_version: expectedVersion, p_patch: patch, p_idempotency_key: idempotencyKey });
}

export async function decideMtuKhsChange({ changeId, decision, note = "" }) {
  if (!supabase || !changeId || !["APPROVED", "REJECTED"].includes(decision)) return { data: null, error: new Error("Keputusan approval MTU tidak valid") };
  return supabase.rpc("mtu_khs_decide_change", { p_change_id: changeId, p_decision: decision, p_note: note });
}

export async function promoteMtuKhsImport(batchId) {
  if (!supabase || !batchId) return { data: null, error: new Error("Batch import MTU tidak valid") };
  return supabase.rpc("mtu_khs_commit_import", { p_batch_id: batchId, p_idempotency_key: `commit-${batchId}` });
}

export async function stageMtuKhsImport({ batchId, procurementYear, uitId, sourceFile, fileSha256 = "", sheetName, rows }) {
  if (!supabase) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.rpc("mtu_khs_stage_import", { p_batch_id: batchId, p_procurement_year: procurementYear, p_uit_id: uitId || null, p_source_file: sourceFile || "", p_file_sha256: fileSha256, p_sheet_name: sheetName || "", p_rows: rows || [] });
}

export async function loadMtuKhsPendingChanges() { return fetchPaged("mtu_khs_change_requests", { status: "PENDING" }); }
export async function loadMtuKhsPendingImports(status = "REVIEW") { return fetchPaged("mtu_khs_import_batches", { status }); }
export async function loadMtuKhsImportRows(batchId) { return fetchPaged("mtu_khs_import_rows", { batch_id: batchId }); }
export async function updateMtuKhsImportRowMapping(rowId, mapping) {
  if (!supabase) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.rpc("mtu_khs_update_import_row_mapping", { p_row_id: rowId, p_mapping: mapping });
}
export async function decideMtuKhsImport(batchId, decision, note = "") {
  if (!supabase) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.rpc("mtu_khs_decide_import", { p_batch_id: batchId, p_decision: decision, p_note: note });
}
export async function attachMtuKhsDocument(recordId, documentId) {
  if (!supabase) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.rpc("mtu_khs_attach_document", { p_record_id: recordId, p_document_id: documentId });
}
export async function registerMtuKhsDocument({ recordId, documentType = "DRAWING", title, url, revision = "" }) {
  if (!supabase) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.rpc("mtu_khs_register_document", { p_id: `MTU-DOC-${Date.now()}`, p_record_id: recordId, p_document_type: documentType, p_title: title, p_url: url, p_revision: revision });
}
export async function linkApprovedTugUsage({ recordId, tugItemId, qty }) {
  if (!supabase) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.rpc("mtu_khs_link_approved_tug", { p_record_id: recordId, p_tug_item_id: tugItemId, p_qty: qty });
}
export async function loadApprovedTugItems() {
  if (!supabase) return { data: [], error: new Error("Supabase belum tersedia") };
  const { data, error } = await supabase.from("tug_items").select("id,qty,katalog_id,transaction_id,tug_transactions!inner(id,doc_number,status,upt_id)").eq("tug_transactions.status", "FINAL_APPROVED").limit(500);
  return { data: data || [], error };
}

export async function saveMtuKhsMasterRow(table, row) {
  if (!supabase || !row?.id) return { data: null, error: new Error("Master GI/Bay belum lengkap") };
  return table === "mtu_khs_gardu_induk"
    ? supabase.rpc("mtu_khs_upsert_gardu_induk", { p_id: row.id, p_ultg_id: row.ultgId, p_data: row })
    : supabase.rpc("mtu_khs_upsert_bay", { p_id: row.id, p_gardu_induk_id: row.garduIndukId, p_data: row });
}

export async function deleteMtuKhsMasterRow(table, id) {
  if (!supabase || !id) return { error: new Error("Master GI/Bay tidak valid") };
  return supabase.rpc("mtu_khs_deactivate_site_master", { p_table_name: table, p_id: id });
}

export function toMtuRecordRow(record) {
  const normalized = normalizeMtuRecord(record);
  return { id: normalized.id, upt_id: normalized.uptId || null, ultg_id: normalized.ultgId || null, gardu_induk_id: normalized.garduIndukId || null, bay_id: normalized.bayId || null, katalog_id: normalized.katalogId || null, procurement_year: normalized.procurementYear, lifecycle_status: normalized.lifecycleStatus, status: normalized.status || "DRAFT", data: normalized };
}
