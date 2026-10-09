import { supabase } from "../../supabaseClient.js";
import { normalizeMtuRecord, filterMtuRecords, isMtuNationalRole, buildMtuTug3Draft, buildMtuSearchText, rankMtuSearch, matchesMtuSearch } from "./mtuKhsModel.js";
import { compressImage } from "../../lib/supabaseSync.js";

const pageSize = 1000;
const ACTIVE_MASTER_TABLES = new Set(["mtu_khs_gardu_induk", "mtu_khs_gardu_induk_bay"]);
const mtuRecordsCache = new Map();
const mtuSyncDrainSessions = new Set();
const mtuRecordCacheKey = ({ user, uptList = [], year, status, vendor, upt, search, rfq, contractKr, page = 1, pageSize = 20 } = {}) => JSON.stringify([user?.id, user?.role, user?.uptId, user?.uitId, uptList.map(item => item.id).join(","), year || "", status || "", vendor || "", upt || "", search || "", rfq || "", contractKr || "", page, pageSize]);
export function mtuKhsMasterQuery(table) { return ACTIVE_MASTER_TABLES.has(table) ? { active: true } : {}; }
export function clearMtuKhsCache() { mtuRecordsCache.clear(); }
export function getCachedMtuKhsRecords(query) { return mtuRecordsCache.get(mtuRecordCacheKey(query)) || null; }
export function friendlyMtuKhsError(error) {
  const message = error?.message || String(error || "");
  return /relation .* does not exist|could not find the table|schema cache/i.test(message)
    ? "Database MTU KHS belum diaktifkan. Terapkan migration terlebih dahulu."
    : message || "Permintaan MTU KHS gagal";
}

/** Compact contract reference for dense monitoring tables. */
export function formatMtuContract(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const match = text.match(/\b(\d{3})\s*[.\-/]?\s*(KR|KHS)\b/i);
  return match ? `${match[1]}.${match[2].toUpperCase()}` : text;
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
  return normalizeMtuRecord({ ...(row?.data || {}), id: row?.id, uptId: row?.data?.uptId || row?.upt_id, ultgId: row?.data?.ultgId || row?.ultg_id, garduIndukId: row?.data?.garduIndukId || row?.gardu_induk_id, bayId: row?.data?.bayId || row?.bay_id, gudangId: row?.data?.gudangId || row?.gudang_id, lokasiId: row?.data?.lokasiId || row?.lokasi_id, qty: row?.data?.qty ?? row?.qty, physicalQty: row?.data?.physicalQty ?? row?.data?.qty ?? row?.qty, lifecycleStatus: row?.data?.lifecycleStatus || row?.lifecycle_status, status: row?.data?.status || row?.status, version: row?.data?.version || row?.version });
}

export async function loadMtuKhsRecords({ user, uptList = [], year, status, vendor, upt, search, rfq, contractKr, page = 1, pageSize = 20 } = {}) {
  const cacheKey = mtuRecordCacheKey({ user, uptList, year, status, vendor, upt, search, rfq, contractKr, page, pageSize });
  if (mtuRecordsCache.has(cacheKey)) return mtuRecordsCache.get(cacheKey);
  if (supabase?.rpc) {
    const { data, error } = await supabase.rpc("mtu_khs_list_records", { p_year: year || null, p_lifecycle_status: status || null, p_vendor: vendor || null, p_upt_id: upt || null, p_search: search || null, p_rfq: rfq || null, p_contract_kr: contractKr || null, p_limit: pageSize, p_offset: (page - 1) * pageSize });
    if (!error && data && !Array.isArray(data)) {
      const result = { data: (data.items || []).map(unwrap), total: data.total || 0, metrics: data.metrics || {}, vendors: data.vendors || [], rfqs: data.facets?.rfqs || [], contractKrs: data.facets?.contractKrs || [], error: null };
      mtuRecordsCache.set(cacheKey, result);
      return result;
    }
  }
  const result = await fetchPaged("mtu_khs_records", year ? { procurement_year: year } : {});
  const all = filterMtuRecords(result.data.map(unwrap), user, uptList).filter(record => (!status || record.lifecycleStatus === status) && (!vendor || record.vendor === vendor) && (!upt || record.uptId === upt) && (!rfq || String(record.mtuCode || "").toLowerCase() === String(rfq).toLowerCase()) && (!contractKr || String(record.contractDetailNumber || record.noKontrak || "").toLowerCase() === String(contractKr).toLowerCase()) && (!search || matchesMtuSearch(record, search))).sort((a, b) => rankMtuSearch(b, search) - rankMtuSearch(a, search));
  const fallback = { ...result, total: all.length, data: all.slice((page - 1) * pageSize, page * pageSize), metrics: { qty: all.reduce((sum, record) => sum + (record.physicalQty || 0), 0), onsite: all.filter(record => ["ON_SITE", "INSTALLED"].includes(record.lifecycleStatus)).length, installed: all.filter(record => record.lifecycleStatus === "INSTALLED").length }, vendors: [...new Set(all.map(record => record.vendor).filter(Boolean))].sort(), rfqs: [...new Set(all.map(record => record.mtuCode).filter(Boolean))].sort(), contractKrs: [...new Set(all.map(record => record.contractDetailNumber || record.noKontrak).filter(Boolean))].sort() };
  mtuRecordsCache.set(cacheKey, fallback);
  return fallback;
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
  const links = await fetchPaged("mtu_khs_usage_links", recordId ? { mtu_record_id: recordId, status: "APPROVED" } : { status: "APPROVED" });
  if (links.error || !links.data?.length || !supabase) return links;
  const ids = links.data.map(link => link.tug_item_id).filter(Boolean);
  const { data: items = [], error } = await supabase.from("tug_items")
    .select("id,qty,katalog_id,transaction_id,snapshot,tug_transactions!inner(id,doc_number,doc_type,status,upt_id,final_approved_at,document)")
    .in("id", ids);
  const byId = new Map((items || []).map(item => [String(item.id), item]));
  return {
    data: links.data.map(link => {
      const item = byId.get(String(link.tug_item_id));
      const transaction = item?.tug_transactions || {};
      return {
        ...link,
        tugItemId: link.tug_item_id,
        qty: Number(link.qty),
        docNumber: transaction.doc_number || link.data?.docNumber || "-",
        docType: transaction.doc_type || link.data?.docType || "-",
        finalApprovedAt: transaction.final_approved_at || link.data?.finalApprovedAt || null,
        materialName: item?.snapshot?.name || item?.snapshot?.materialName || "",
        catalogNumber: item?.snapshot?.katalog || item?.snapshot?.catalogNumber || "",
      };
    }),
    error: error || null,
  };
}

export async function loadMtuKhsReconciliation(recordId) {
  if (!supabase || !recordId) return { data: null, error: new Error("Record MTU tidak valid") };
  const { data, error } = await supabase.from("mtu_khs_reconciliations").select("*").eq("record_id", recordId).maybeSingle();
  return { data: data || null, error };
}

export async function loadMtuKhsStockLinks(recordId) {
  if (!supabase || !recordId) return { data: [], error: new Error("Record MTU tidak valid") };
  const { data, error } = await supabase.from("mtu_khs_stock_links")
    .select("id,mtu_record_id,stock_id,qty,created_by,created_at,updated_by,updated_at,stocks(id,katalog_id,lokasi_id,upt_id,data)")
    .eq("mtu_record_id", recordId).order("created_at", { ascending: false });
  return { data: data || [], error };
}

export async function loadMtuKhsReceipts(recordId) {
  if (!supabase || !recordId) return { data: [], error: new Error("Record MTU tidak valid") };
  const { data, error } = await supabase.from("mtu_khs_receipts")
    .select("id,mtu_record_id,tug3_transaction_id,qty,items,applied_by,applied_at,idempotency_key,tug3_transactions(doc_number,status)")
    .eq("mtu_record_id", recordId).order("applied_at", { ascending: false });
  return { data: (data || []).map(item => ({ ...item, docNumber: item.tug3_transactions?.doc_number, status: item.tug3_transactions?.status })), error };
}

export async function loadMtuKhsLifecycle(recordId) {
  const [reconciliation, stockLinks, receipts] = await Promise.all([
    loadMtuKhsReconciliation(recordId), loadMtuKhsStockLinks(recordId), loadMtuKhsReceipts(recordId),
  ]);
  return {
    data: { reconciliation: reconciliation.data, stockLinks: stockLinks.data, receipts: receipts.data },
    error: reconciliation.error || stockLinks.error || receipts.error || null,
  };
}

export async function submitMtuKhsChange({ recordId, expectedVersion = 1, patch, idempotencyKey = `mtu-${Date.now()}`, currentUser }) {
  if (!supabase || !recordId || !patch || !currentUser?.id) return { data: null, error: new Error("Data perubahan MTU tidak lengkap") };
  return supabase.rpc("mtu_khs_submit_change", { p_record_id: recordId, p_expected_version: expectedVersion, p_patch: patch, p_idempotency_key: idempotencyKey });
}

export async function updateMtuKhsOperational({ recordId, expectedVersion = 1, patch = {}, idempotencyKey = `mtu-op-${Date.now()}` } = {}) {
  if (!supabase || !recordId) return { data: null, error: new Error("Record MTU tidak valid") };
  const result = await supabase.rpc("mtu_khs_update_operational", { p_record_id: recordId, p_expected_version: expectedVersion, p_patch: patch, p_idempotency_key: idempotencyKey });
  return { ...result, data: result.data ? unwrap(Array.isArray(result.data) ? result.data[0] : result.data) : null };
}

export async function requestMtuKhsTransfer({ recordId, expectedVersion = 1, qty, targetUptId, targetUltgId = null, targetGarduIndukId = null, targetBayId = null, targetGudangId = null, targetLokasiId = null, note = "", idempotencyKey = `mtu-transfer-${Date.now()}` } = {}) {
  if (!supabase || !recordId || !targetUptId || !(Number(qty) > 0)) return { data: null, error: new Error("Data transfer MTU belum lengkap") };
  return supabase.rpc("mtu_khs_request_transfer", { p_record_id: recordId, p_expected_version: expectedVersion, p_qty: Number(qty), p_target_upt_id: targetUptId, p_target_ultg_id: targetUltgId, p_target_gardu_induk_id: targetGarduIndukId, p_target_bay_id: targetBayId, p_target_gudang_id: targetGudangId, p_target_lokasi_id: targetLokasiId, p_note: note, p_idempotency_key: idempotencyKey });
}

export async function decideMtuKhsTransfer({ requestId, decision, note = "" } = {}) {
  if (!supabase || !requestId || !["APPROVED", "REJECTED"].includes(decision)) return { data: null, error: new Error("Keputusan transfer MTU tidak valid") };
  return supabase.rpc("mtu_khs_decide_transfer", { p_request_id: requestId, p_decision: decision, p_note: note });
}

export async function loadMtuKhsTransferRequests({ status = "PENDING" } = {}) {
  if (!supabase) return { data: [], error: new Error("Supabase belum tersedia") };
  const { data, error } = await supabase.from("mtu_khs_transfer_requests").select("*").eq("status", status).order("requested_at", { ascending: false });
  return { data: data || [], error };
}

export async function loadMtuKhsTransferDestinations(targetUptId) {
  if (!supabase || !targetUptId) return { data: null, error: new Error("UPT tujuan transfer belum dipilih") };
  return supabase.rpc("mtu_khs_transfer_destinations", { p_target_upt_id: targetUptId });
}

export async function loadMtuKhsEvidence(recordId) {
  if (!supabase || !recordId) return { data: [], error: new Error("Record MTU tidak valid") };
  const { data, error } = await supabase.from("mtu_khs_record_evidence").select("*").eq("record_id", recordId).order("created_at", { ascending: false });
  if (error) return { data: [], error };
  const rows = data || [];
  const signed = await createMtuKhsEvidenceUrls(rows.map(item => item.object_path).filter(Boolean));
  const byPath = new Map((signed.data || []).map(item => [item.path, item.signedUrl || item.signed_url || ""]));
  return { data: rows.map(item => ({ ...item, signedUrl: byPath.get(item.object_path) || "" })), error: signed.error || null };
}

function evidenceBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("Format foto tidak valid.");
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] || "image/jpeg" });
}

export async function uploadMtuKhsEvidence({ file, recordId, uptId, kind } = {}) {
  if (!supabase || !file || !recordId || !uptId || !["ITEM", "NAMEPLATE"].includes(kind)) throw new Error("Data foto MTU belum lengkap.");
  const dataUrl = await compressImage(file, { maxBytes: 2 * 1024 * 1024, maxDim: 2000 });
  const blob = evidenceBlob(dataUrl);
  if (blob.size > 2 * 1024 * 1024 || !blob.type.startsWith("image/")) throw new Error("Foto harus berupa gambar maksimal 2 MiB.");
  const path = `${uptId}/${recordId}/${kind.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const uploaded = await supabase.storage.from("mtu-khs-evidence").upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "3600" });
  if (uploaded.error) throw uploaded.error;
  const registered = await supabase.rpc("mtu_khs_register_evidence", { p_record_id: recordId, p_kind: kind, p_object_path: path, p_mime_type: blob.type, p_size_bytes: blob.size, p_idempotency_key: `evidence-${path}` });
  if (registered.error) { await supabase.storage.from("mtu-khs-evidence").remove([path]); throw registered.error; }
  return registered;
}

export async function createMtuKhsEvidenceUrls(paths, expiresIn = 3600) {
  if (!supabase || !paths?.length) return { data: [], error: null };
  return supabase.storage.from("mtu-khs-evidence").createSignedUrls(paths, expiresIn);
}

export async function decideMtuKhsChange({ changeId, decision, note = "" }) {
  if (!supabase || !changeId || !["APPROVED", "REJECTED"].includes(decision)) return { data: null, error: new Error("Keputusan approval MTU tidak valid") };
  return supabase.rpc("mtu_khs_decide_change", { p_change_id: changeId, p_decision: decision, p_note: note });
}

export async function pushMtuKhsSheetSync({ jobId, dryRun = false, maxJobs = 10 } = {}) {
  if (!supabase?.functions) return { data: null, error: new Error("Supabase belum tersedia") };
  return supabase.functions.invoke("push-mtu-khs", { body: { ...(jobId ? { jobId } : {}), dryRun, maxJobs } });
}

export async function loadMtuKhsSyncJobs({ statuses = ["PENDING", "SYNCING", "FAILED", "CONFLICT"] } = {}) {
  if (!supabase) return { data: [], error: new Error("Supabase belum tersedia") };
  const { data, error } = await supabase.from("mtu_khs_sheet_sync_jobs").select("id,record_id,status,attempts,last_error,updated_at,synced_at").in("status", statuses).order("updated_at", { ascending: false }).limit(100);
  return { data: data || [], error };
}

export async function drainMtuKhsSheetSyncOnce(sessionKey = "default") {
  if (mtuSyncDrainSessions.has(sessionKey)) return { data: null, error: null, skipped: true };
  mtuSyncDrainSessions.add(sessionKey);
  return pushMtuKhsSheetSync({ maxJobs: 10 });
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
  const { data, error } = await supabase.from("tug_items").select("id,qty,katalog_id,transaction_id,lokasi_id,unit,snapshot,tug_transactions!inner(id,doc_number,doc_type,status,upt_id,final_approved_at,document)").eq("tug_transactions.status", "FINAL_APPROVED").in("tug_transactions.doc_type", ["TUG8", "TUG9"]).limit(500);
  return { data: (data || []).map(item => {
    const transaction = item.tug_transactions || {};
    return {
      ...item,
      tugItemId: item.id,
      qty: Number(item.qty),
      docNumber: transaction.doc_number || "-",
      docType: transaction.doc_type || "-",
      uptId: transaction.upt_id || "",
      finalApprovedAt: transaction.final_approved_at || null,
      materialName: item.snapshot?.name || item.snapshot?.materialName || "",
      catalogNumber: item.snapshot?.katalog || item.snapshot?.catalogNumber || "",
    };
  }), error };
}

export async function saveMtuKhsReconciliation({ recordId, status, note = "" }) {
  if (!supabase || !recordId || !status) return { data: null, error: new Error("Rekonsiliasi MTU belum lengkap") };
  return supabase.rpc("mtu_khs_set_reconciliation", { p_record_id: recordId, p_status: status, p_note: note });
}

export async function linkMtuKhsStock({ recordId, stockId, qty }) {
  if (!supabase || !recordId || !stockId || !(Number(qty) > 0)) return { data: null, error: new Error("Referensi stok MTU belum lengkap") };
  return supabase.rpc("mtu_khs_link_stock", { p_record_id: recordId, p_stock_id: stockId, p_qty: Number(qty) });
}

export async function applyMtuKhsTug3Receipt({ tug3TransactionId, idempotencyKey = `mtu-receipt-${tug3TransactionId}` }) {
  if (!supabase || !tug3TransactionId) return { data: null, error: new Error("TUG-3 MTU belum lengkap") };
  return supabase.rpc("mtu_khs_apply_tug3_receipt", { p_tug3_transaction_id: tug3TransactionId, p_idempotency_key: idempotencyKey });
}

export function createMtuKhsTug3Draft(record, currentUser) {
  return buildMtuTug3Draft(record, currentUser);
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
