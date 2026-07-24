import { supabase } from "../supabaseClient.js";
import { isDemoMode } from "./demo.js";
import { compressImage } from "./supabaseSync.js";

const INSPECTION_BUCKET = "material-inspection-photos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asOptionalUuid = value => typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim() : null;
const asEpoch = (value, fallback = Date.now()) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function rowToItem(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    stockId: row.stock_id ?? row.data?.stockId ?? null,
    katalogId: row.katalog_id ?? row.data?.katalogId ?? null,
    noKatalog: row.no_katalog ?? row.data?.noKatalog ?? "-",
    namaBarang: row.nama_barang ?? row.data?.namaBarang ?? "",
    lokasiNama: row.lokasi_nama ?? row.data?.lokasiNama ?? "",
    kondisi: row.kondisi ?? row.data?.kondisi ?? "BAIK",
    statusKelayakan: row.status_kelayakan ?? row.data?.statusKelayakan ?? "READY",
    jenisMtu: row.jenis_mtu ?? row.data?.jenisMtu ?? "Lainnya",
    inspectorId: row.inspector_id ?? row.data?.inspectorId ?? null,
    createdAt: asEpoch(row.created_at, row.data?.createdAt),
    updatedAt: asEpoch(row.updated_at, row.data?.updatedAt),
  };
}

function itemToRow(item) {
  const now = Date.now();
  return {
    id: item.id,
    data: item,
    stock_id: item.stockId || null,
    katalog_id: item.katalogId || null,
    no_katalog: item.noKatalog || "-",
    nama_barang: item.namaBarang || "",
    lokasi_nama: item.lokasiNama || "",
    kondisi: item.kondisi || "BAIK",
    status_kelayakan: item.statusKelayakan || "READY",
    jenis_mtu: item.jenisMtu || "Lainnya",
    inspector_id: asOptionalUuid(item.inspectorId),
    created_at: asEpoch(item.createdAt, now),
    updated_at: now,
  };
}

async function uploadPhoto(photo, inspectionId, index) {
  if (!photo?.file) return photo?.url ? { name: photo.name || `Foto ${index + 1}`, url: photo.url } : null;
  const compressedDataUrl = await compressImage(photo.file, { maxBytes: 1_000_000, maxDim: 1600 });
  const blob = await fetch(compressedDataUrl).then(response => response.blob());
  const path = `${inspectionId}/foto-${index + 1}.jpg`;
  const { error } = await supabase.storage.from(INSPECTION_BUCKET).upload(path, blob, {
    upsert: false,
    contentType: "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(INSPECTION_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("URL foto inspeksi tidak tersedia setelah upload.");
  return { name: photo.name || `Foto ${index + 1}`, url: data.publicUrl, size: blob.size, contentType: "image/jpeg" };
}

export async function loadMaterialInspections() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("material_inspections").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error(`load material_inspections: ${error.message}`, error);
    return null;
  }
  return data.map(rowToItem);
}

// Upload must finish before the database row is written: durable records never
// contain base64/blob previews, and callers only receive a success value after
// the self-host database accepts the inspection.
export async function createMaterialInspection(item, photoInputs = []) {
  if (isDemoMode()) return { ...item, fotos: photoInputs.map((photo, index) => ({ name: photo?.name || `Foto ${index + 1}`, url: photo?.url || "" })).filter(photo => photo.url) };
  if (!supabase) return null;
  try {
    const fotos = (await Promise.all(photoInputs.map((photo, index) => uploadPhoto(photo, item.id, index)))).filter(Boolean);
    const persistedItem = { ...item, fotos, updatedAt: Date.now() };
    const { data, error } = await supabase.from("material_inspections").upsert(itemToRow(persistedItem), { onConflict: "id" }).select().single();
    if (error) throw error;
    return rowToItem(data);
  } catch (error) {
    console.error("create material inspection:", error);
    return null;
  }
}
