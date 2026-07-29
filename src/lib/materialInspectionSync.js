import { supabase } from "../supabaseClient.js";
import { compressImage } from "./supabaseSync.js";

export const MATERIAL_INSPECTION_BUCKET = "material-inspection-photos";
export const MATERIAL_INSPECTION_MAX_PHOTOS = 2;
export const MATERIAL_INSPECTION_MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  if (!match) throw new Error("Hasil kompresi foto tidak valid.");
  const bytes = atob(match[2]);
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new Blob([array], { type: match[1] || "image/jpeg" });
}

export function validateInspectionPhoto(file) {
  if (!file) return "Foto inspeksi tidak ditemukan.";
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return "Foto harus berformat JPG, PNG, atau WebP.";
  if (file.size > MATERIAL_INSPECTION_MAX_FILE_BYTES) return "Ukuran setiap foto maksimal 5 MB.";
  return null;
}

export function mapMaterialInspectionRow(row) {
  if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.data)) return null;
  const photoPaths = Array.isArray(row.data.photoPaths)
    ? row.data.photoPaths.filter(path => typeof path === "string" && !path.startsWith("data:"))
    : [];
  return {
    ...row.data,
    id: row.id,
    batchId: row.batch_id || null,
    stockId: row.stock_id || null,
    katalogId: row.katalog_id || null,
    lokasiId: row.lokasi_id || null,
    inspectorId: row.inspector_id || null,
    createdAt: row.created_at,
    photoPaths,
  };
}

export const MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH = 10;

// LEGACY v1 — keep until UI migration done
export async function loadMaterialInspections() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("material_inspections")
    .select("id, stock_id, katalog_id, lokasi_id, inspector_id, data, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("loadMaterialInspections:", error.message, error);
    return null;
  }
  return (data || []).map(mapMaterialInspectionRow).filter(Boolean);
}

// LEGACY v1 — keep until UI migration done
export async function createMaterialInspection({ inspection, photoFiles = [] }) {
  if (!supabase) throw new Error("Koneksi Supabase belum tersedia.");
  if (!inspection?.inspectorId) throw new Error("Identitas pemeriksa tidak tersedia.");
  if (photoFiles.length > MATERIAL_INSPECTION_MAX_PHOTOS) throw new Error("Maksimal dua foto inspeksi.");
  for (const file of photoFiles) {
    const validationError = validateInspectionPhoto(file);
    if (validationError) throw new Error(validationError);
  }

  const inspectionId = crypto.randomUUID();
  const uploadedPaths = [];
  try {
    for (const [index, file] of photoFiles.entries()) {
      const compressed = await compressImage(file, { maxBytes: 800_000, maxDim: 1600 });
      const path = `${inspection.inspectorId}/${inspectionId}/foto-${index + 1}.jpg`;
      const { error } = await supabase.storage
        .from(MATERIAL_INSPECTION_BUCKET)
        .upload(path, dataUrlToBlob(compressed), { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);
    }

    const persistedData = {
      ...inspection,
      photoPaths: uploadedPaths,
    };
    delete persistedData.id;
    delete persistedData.stockId;
    delete persistedData.katalogId;
    delete persistedData.lokasiId;
    delete persistedData.inspectorId;
    delete persistedData.createdAt;
    delete persistedData.photos;

    const { data, error } = await supabase
      .from("material_inspections")
      .insert({
        id: inspectionId,
        stock_id: inspection.stockId || null,
        katalog_id: inspection.katalogId || null,
        lokasi_id: inspection.lokasiId || null,
        inspector_id: inspection.inspectorId,
        data: persistedData,
      })
      .select("id, stock_id, katalog_id, lokasi_id, inspector_id, data, created_at")
      .single();
    if (error) throw error;
    return mapMaterialInspectionRow(data);
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(MATERIAL_INSPECTION_BUCKET).remove(uploadedPaths);
    throw error;
  }
}

export function mapMaterialInspectionBatchRow(row) {
  if (!isRecord(row) || typeof row.id !== "string") return null;
  const items = Array.isArray(row.material_inspections) ? row.material_inspections : [];
  return {
    ...(isRecord(row.data) ? row.data : {}),
    id: row.id,
    nomorBa: row.nomor_ba,
    uptId: row.upt_id || null,
    gudangId: row.gudang_id || null,
    tanggal: row.tanggal,
    inspectorId: row.inspector_id || null,
    createdAt: row.created_at,
    items: items.map(mapMaterialInspectionRow).filter(Boolean),
  };
}

export async function loadMaterialInspectionBatches() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("material_inspection_batches")
    .select(
      "id, nomor_ba, upt_id, gudang_id, tanggal, inspector_id, data, created_at, " +
        "material_inspections(id, stock_id, katalog_id, lokasi_id, inspector_id, data, created_at)"
    )
    .order("created_at", { ascending: false });
  if (error) {
    console.error("loadMaterialInspectionBatches:", error.message, error);
    return null;
  }
  return (data || []).map(mapMaterialInspectionBatchRow).filter(Boolean);
}

// Satu BA = 1..10 material. Foto di-upload dulu (butuh path di jsonb item), lalu
// RPC atomik dipanggil; kalau RPC gagal semua foto yang sudah masuk dibersihkan.
export async function createMaterialInspectionBatch({ header, items = [], photoFilesPerItem = [] }) {
  if (!supabase) throw new Error("Koneksi Supabase belum tersedia.");
  const inspectorId = header?.inspectorId;
  if (!inspectorId) throw new Error("Identitas pemeriksa tidak tersedia.");
  if (!items.length) throw new Error("Minimal satu material harus diperiksa.");
  if (items.length > MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH) {
    throw new Error(`Maksimal ${MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH} material per BA.`);
  }
  const stockIds = items.map(item => item?.stockId);
  if (stockIds.some(id => !id)) throw new Error("Setiap material harus dipilih dari data stok.");
  if (new Set(stockIds).size !== stockIds.length) throw new Error("Material tidak boleh dipilih dua kali dalam satu BA.");
  items.forEach((_, index) => {
    const files = photoFilesPerItem[index] || [];
    if (files.length !== MATERIAL_INSPECTION_MAX_PHOTOS) {
      throw new Error(`Material baris ${index + 1} wajib punya ${MATERIAL_INSPECTION_MAX_PHOTOS} foto.`);
    }
    for (const file of files) {
      const validationError = validateInspectionPhoto(file);
      if (validationError) throw new Error(`Material baris ${index + 1}: ${validationError}`);
    }
  });

  const uploadKey = crypto.randomUUID();
  const uploadedPaths = [];
  try {
    const payloadItems = [];
    for (const [index, item] of items.entries()) {
      const photoPaths = [];
      for (const [photoIndex, file] of (photoFilesPerItem[index] || []).entries()) {
        const compressed = await compressImage(file, { maxBytes: 800_000, maxDim: 1600 });
        const path = `${inspectorId}/${uploadKey}/item-${index + 1}/foto-${photoIndex + 1}.jpg`;
        const { error } = await supabase.storage
          .from(MATERIAL_INSPECTION_BUCKET)
          .upload(path, dataUrlToBlob(compressed), { contentType: "image/jpeg", upsert: false });
        if (error) throw error;
        uploadedPaths.push(path);
        photoPaths.push(path);
      }
      const itemData = { ...item, photoPaths };
      delete itemData.id;
      delete itemData.stockId;
      delete itemData.katalogId;
      delete itemData.lokasiId;
      delete itemData.inspectorId;
      delete itemData.createdAt;
      delete itemData.photos;
      payloadItems.push({ ...itemData, stock_id: item.stockId });
    }

    const headerPayload = { ...header };
    delete headerPayload.inspectorId;
    delete headerPayload.items;

    const { data, error } = await supabase.rpc("create_material_inspection_batch", {
      p_items: payloadItems,
      p_header: {
        ...headerPayload,
        upt_id: header.uptId || "UPT-SBY",
        gudang_id: header.gudangId || null,
        tanggal: header.tanggal || null,
      },
    });
    if (error) throw error;
    return {
      ...header,
      id: data?.batch_id,
      nomorBa: data?.nomor_ba,
      items: (data?.items || []).map(mapMaterialInspectionRow).filter(Boolean),
    };
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(MATERIAL_INSPECTION_BUCKET).remove(uploadedPaths);
    throw error;
  }
}

export async function loadInspectionPhotoUrls(paths) {
  if (!supabase || !Array.isArray(paths) || paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(MATERIAL_INSPECTION_BUCKET).createSignedUrls(paths, 3600);
  if (error) {
    console.error("loadInspectionPhotoUrls:", error.message, error);
    return {};
  }
  return Object.fromEntries((data || []).filter(item => item?.path && item?.signedUrl).map(item => [item.path, item.signedUrl]));
}
