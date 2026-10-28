// Server-first persistence for BA Non Stock / Pinjam.
// Semua mutation lewat RPC; foto disimpan sebagai Storage path/URL, bukan base64.
import { supabase } from "../supabaseClient.js";
import { compressImage } from "./supabaseSync.js";

export const BA_NON_STOCK_BUCKET = "tug-photos";
export const BA_NON_STOCK_PHOTO_PREFIX = "ba-non-stock";
export const BA_NON_STOCK_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_SLOTS = new Set(["label", "loaded"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isBaNonStockDataUrl(value) {
  return typeof value === "string" && /^data:/i.test(value);
}

function containsDataUrl(value) {
  if (isBaNonStockDataUrl(value)) return true;
  if (Array.isArray(value)) return value.some(containsDataUrl);
  return isRecord(value) && Object.values(value).some(containsDataUrl);
}

function normalizePath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (isBaNonStockDataUrl(trimmed)) return null;
  const match = trimmed.match(/\/storage\/v1\/object\/public\/tug-photos\/(.+)$/i);
  return (match ? match[1] : trimmed).replace(/^tug-photos\//i, "");
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("Format foto hasil kompresi tidak valid.");
  const bytes = atob(match[2]);
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new Blob([array], { type: match[1] || "image/jpeg" });
}

export function validateBaNonStockPhoto(file) {
  if (!file) return "Foto bukti belum dipilih.";
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type || "")) return "Foto harus berformat JPG, PNG, atau WebP.";
  if (Number(file.size) > BA_NON_STOCK_MAX_PHOTO_BYTES) return "Ukuran foto maksimal 5 MB.";
  return null;
}

function rpcResult(data) {
  return Array.isArray(data) ? data[0] : data;
}

function rpcError(error) {
  const message = String(error?.message || error || "");
  return { ok: false, conflict: /BA_VERSION_MISMATCH|version/i.test(message), error };
}

function mapItem(row) {
  if (!isRecord(row)) return null;
  const materialName = typeof row.material_name === "string" ? row.material_name : "";
  const unit = typeof row.unit === "string" ? row.unit : "";
  return {
    lineNo: row.line_no,
    materialName,
    qty: row.qty ?? "",
    unit,
    description: row.description || "",
    nama: materialName,
    satuan: unit,
    keterangan: row.description || "",
  };
}

export function mapBaNonStockRow(row) {
  if (!isRecord(row) || typeof row.id !== "string") return null;
  const items = Array.isArray(row.items)
    ? row.items
    : Array.isArray(row.ba_non_stock_items) ? row.ba_non_stock_items : [];
  return {
    id: row.id,
    docType: "BA_NON_STOCK",
    uptId: row.upt_id || null,
    kind: row.kind,
    stage: row.stage,
    status: row.status,
    workflowVersion: row.version ?? null,
    docNumber: row.doc_number || null,
    sequenceYear: row.sequence_year ?? null,
    sequenceValue: row.sequence_value ?? null,
    warehouseId: row.warehouse_id || null,
    gudangId: row.warehouse_id || null,
    securityGuardId: row.security_guard_id || null,
    issueDate: row.issue_date || null,
    sender: row.sender || "",
    destinationUnit: row.destination_unit || "",
    referenceDocument: row.reference_document || "",
    referensi: row.reference_document || "",
    purpose: row.purpose || "",
    recipientName: row.recipient_name || "",
    recipientTitle: row.recipient_title || "",
    recipientUnit: row.recipient_unit || "",
    driverName: row.driver_name || "",
    vehicleNumber: row.vehicle_number || "",
    photoLabelUrl: row.photo_label_url || null,
    photoLoadedUrl: row.photo_loaded_url || null,
    recipientSnapshot: isRecord(row.recipient_snapshot) ? row.recipient_snapshot : {},
    securityGuardSnapshot: isRecord(row.security_guard_snapshot) ? row.security_guard_snapshot : {},
    tlSnapshot: isRecord(row.tl_snapshot) ? row.tl_snapshot : {},
    createdBy: row.created_by || null,
    submittedBy: row.submitted_by || null,
    approvedBy: row.approved_by || null,
    rejectedBy: row.rejected_by || null,
    rejectionReason: row.rejection_reason || null,
    submittedAt: row.submitted_at || null,
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    items: items.map(mapItem).filter(Boolean),
    // Aliases keep the existing TUG form shape usable while the server stays typed.
    jenis: row.kind,
    tanggal: row.issue_date || null,
    sumber: row.sender || "",
    tujuan: row.destination_unit || "",
    referensi: row.reference_document || "",
    keperluan: row.purpose || "",
    satpam: row.security_guard_id || "",
    satpamId: row.security_guard_id || "",
    satpamNama: row.security_guard_snapshot?.name || row.security_guard_snapshot?.nama || "",
    tlNama: row.tl_snapshot?.name || "",
    penerimaNama: row.recipient_name || "",
    penerimaJabatan: row.recipient_title || "",
    penerimaUnit: row.recipient_unit || "",
    foto1: row.photo_label_url || null,
    foto2: row.photo_loaded_url || null,
    signatures: {
      penerima: isRecord(row.recipient_snapshot) ? row.recipient_snapshot : {},
      satpam: isRecord(row.security_guard_snapshot) ? row.security_guard_snapshot : {},
      tl: isRecord(row.tl_snapshot) ? row.tl_snapshot : {},
    },
  };
}

export async function loadBaNonStockRows({ search = "", statuses = null } = {}) {
  if (!supabase) return { rows: [], unavailable: true };
  let query = supabase
    .from("ba_non_stock")
    .select("*, ba_non_stock_items(*)")
    .order("updated_at", { ascending: false });
  if (Array.isArray(statuses) && statuses.length) query = query.in("status", statuses);
  const { data, error } = await query;
  if (error) return { rows: [], unavailable: false, error };
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const rows = (data || []).map(mapBaNonStockRow).filter(Boolean).filter(row => {
    if (!normalizedSearch) return true;
    const haystack = [row.docNumber, row.sender, row.recipientName, row.referenceDocument, row.purpose, ...row.items.map(item => item.materialName)]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  });
  return { rows, unavailable: false };
}

export const loadBaNonStock = loadBaNonStockRows;

function draftValue(draft, ...keys) {
  const key = keys.find(candidate => Object.prototype.hasOwnProperty.call(draft || {}, candidate));
  return key === undefined ? null : (draft?.[key] || null);
}

export function draftPayload(draft, items) {
  const payload = {
    kind: String(draftValue(draft, "jenis", "kind") || "NON_STOCK").toUpperCase(),
    issueDate: draftValue(draft, "tanggal", "issueDate"),
    warehouseId: draftValue(draft, "gudangId", "warehouseId"),
    securityGuardId: draftValue(draft, "satpamId", "satpam", "securityGuardId"),
    sender: draftValue(draft, "sumber", "sender"),
    destinationUnit: draftValue(draft, "tujuan", "destinationUnit"),
    referenceDocument: draftValue(draft, "referensi", "referenceDocument"),
    purpose: draftValue(draft, "keperluan", "purpose"),
    recipientName: draftValue(draft, "penerimaNama", "recipientName"),
    recipientTitle: draftValue(draft, "penerimaJabatan", "recipientTitle"),
    recipientUnit: draftValue(draft, "penerimaUnit", "recipientUnit"),
    driverName: draftValue(draft, "namaPengemudi", "driverName"),
    vehicleNumber: draftValue(draft, "nomorKendaraan", "vehicleNumber"),
    photoLabelUrl: Object.prototype.hasOwnProperty.call(draft || {}, "foto1") ? draft.foto1 : (draft?.photoLabelUrl || null),
    photoLoadedUrl: Object.prototype.hasOwnProperty.call(draft || {}, "foto2") ? draft.foto2 : (draft?.photoLoadedUrl || null),
    items: (items || []).map(item => ({
      materialName: draftValue(item, "nama", "name", "materialName") || "",
      qty: item?.qty ?? "",
      unit: draftValue(item, "satuan", "unit") || "",
      description: draftValue(item, "keterangan", "description") || "",
    })),
  };
  if (containsDataUrl(payload)) throw new Error("BA_PHOTO_NOT_STORED");
  return payload;
}

export function resolveBaNonStockPrintNames(record = {}, { satpamList = [], users = [] } = {}) {
  const guard = satpamList.find(item => item.id === record.satpamId || item.id === record.securityGuardId);
  const scopedTls = users.filter(user => user.role === "TL" && (user.uptId || user.upt_id) === record.uptId);
  const tl = scopedTls.length === 1 ? scopedTls[0] : null;
  return {
    ...record,
    satpamNama: record.status === "APPROVED" || record.stage === "APPROVED"
      ? (record.securityGuardSnapshot?.name || record.securityGuardSnapshot?.nama || record.satpamNama || guard?.name || guard?.nama || "")
      : (record.satpamNama || record.securityGuardSnapshot?.name || guard?.name || guard?.nama || ""),
    tlNama: record.status === "APPROVED" || record.stage === "APPROVED"
      ? (record.tlSnapshot?.name || record.tlSnapshot?.nama || record.tlNama || tl?.name || "")
      : (record.tlNama || record.tlSnapshot?.name || tl?.name || ""),
  };
}

export async function uploadBaNonStockPhoto(id, slot, file) {
  if (!supabase) throw new Error("Koneksi Supabase belum tersedia.");
  if (!id || !PHOTO_SLOTS.has(slot)) throw new Error("Slot foto BA tidak valid.");
  const validationError = validateBaNonStockPhoto(file);
  if (validationError) throw new Error(validationError);
  const compressed = await compressImage(file, { maxBytes: 1_000_000, maxDim: 1600 });
  const path = `${BA_NON_STOCK_PHOTO_PREFIX}/${id}/${slot}.jpg`;
  const { error } = await supabase.storage.from(BA_NON_STOCK_BUCKET).upload(path, dataUrlToBlob(compressed), {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw error;
  return supabase.storage.from(BA_NON_STOCK_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function saveBaNonStockDraft(options = {}) {
  if (!supabase) return { ok: false, unavailable: true };
  const directDraft = options?.draft ? options.draft : options;
  const draft = directDraft || {};
  const items = options?.draft ? (options.items || draft.items || []) : (directDraft.items || []);
  const expectedVersion = options?.draft ? (options.expectedVersion ?? draft.workflowVersion ?? null) : (directDraft.workflowVersion ?? null);
  const photoFiles = options?.draft ? (options.photoFiles || {}) : {};
  const id = draft.id || crypto.randomUUID();
  const uploaded = [];
  try {
    const next = { ...draft };
    for (const slot of PHOTO_SLOTS) {
      const file = photoFiles?.[slot];
      if (!file) continue;
      const key = slot === "label" ? "photoLabelUrl" : "photoLoadedUrl";
      const aliasKey = slot === "label" ? "foto1" : "foto2";
      next[key] = await uploadBaNonStockPhoto(id, slot, file);
      next[aliasKey] = next[key];
      uploaded.push(next[key]);
    }
    const { data, error } = await supabase.rpc("save_ba_non_stock_draft", {
      p_id: id,
      p_expected_version: expectedVersion,
      p_upt_id: draft.uptId || draft.upt_id,
      p_payload: draftPayload(next, items),
    });
    if (error) throw error;
    const result = rpcResult(data);
    return { ok: true, result, row: { ...next, id, workflowVersion: result?.version ?? null, stage: "DRAFT", status: "DRAFT", items } };
  } catch (error) {
    for (const url of uploaded) {
      const path = normalizePath(url);
      if (path) await supabase.storage.from(BA_NON_STOCK_BUCKET).remove([path]).catch(() => {});
    }
    return rpcError(error);
  }
}

export async function submitBaNonStock(id, expectedVersion) {
  if (!supabase || !id) return { ok: false, unavailable: !supabase };
  const { data, error } = await supabase.rpc("submit_ba_non_stock", { p_id: id, p_expected_version: expectedVersion });
  return error ? rpcError(error) : { ok: true, result: rpcResult(data) };
}

export async function decideBaNonStock(id, expectedVersion, decision, reason = null) {
  if (!supabase || !id) return { ok: false, unavailable: !supabase };
  const { data, error } = await supabase.rpc("decide_ba_non_stock", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_decision: decision,
    p_reason: reason,
  });
  return error ? rpcError(error) : { ok: true, result: rpcResult(data) };
}

export function isBaNonStockConflict(error) {
  return !!rpcError(error).conflict;
}
