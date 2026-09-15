import { compressImage } from "./supabaseSync.js";
import { supabase } from "../supabaseClient.js";

export const WAREHOUSE_CAPACITY_PHOTO_BUCKET = "warehouse-capacity-photos";
export const WAREHOUSE_CAPACITY_PHOTO_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const WAREHOUSE_CAPACITY_PHOTO_MAX_BYTES = 800 * 1024;
export const WAREHOUSE_CAPACITY_PHOTO_MAX_DIM = 1600;
export const WAREHOUSE_CAPACITY_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("Format foto tidak valid.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] || "image/jpeg" });
}

export function validateWarehouseCapacityPhoto(file) {
  if (!file || !WAREHOUSE_CAPACITY_PHOTO_TYPES.has(String(file.type || "").toLowerCase())) {
    return { valid: false, error: "Pilih file foto yang valid." };
  }
  if (file.size > WAREHOUSE_CAPACITY_PHOTO_MAX_SOURCE_BYTES) {
    return { valid: false, error: "Ukuran foto maksimal 5 MB." };
  }
  return { valid: true };
}

export async function prepareWarehouseCapacityPhoto(file) {
  const validation = validateWarehouseCapacityPhoto(file);
  if (!validation.valid) throw new Error(validation.error);
  return compressImage(file, {
    maxDim: WAREHOUSE_CAPACITY_PHOTO_MAX_DIM,
    maxBytes: WAREHOUSE_CAPACITY_PHOTO_MAX_BYTES,
  });
}

function safeSegment(value) {
  return String(value || "record").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "record";
}

export function buildWarehouseCapacityPhotoPath(userId, recordId) {
  const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${safeSegment(userId)}/capacity/${safeSegment(recordId)}/${randomId}.jpg`;
}

export async function uploadWarehouseCapacityPhoto(dataUrl, recordId) {
  if (!supabase) throw new Error("Koneksi penyimpanan belum tersedia.");
  const { data: { user } = {}, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) throw new Error("Sesi login tidak tersedia. Silakan masuk ulang.");
  const path = buildWarehouseCapacityPhotoPath(user.id, recordId);
  const blob = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage.from(WAREHOUSE_CAPACITY_PHOTO_BUCKET).upload(path, blob, {
    upsert: false,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}

export async function removeWarehouseCapacityPhoto(path) {
  if (!supabase || !path) return;
  const { error } = await supabase.storage.from(WAREHOUSE_CAPACITY_PHOTO_BUCKET).remove([path]);
  if (error) throw error;
}

export async function createWarehouseCapacityPhotoUrl(path, expiresIn = 3600) {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from(WAREHOUSE_CAPACITY_PHOTO_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data?.signedUrl || null;
}
