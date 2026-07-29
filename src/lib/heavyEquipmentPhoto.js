export const HEAVY_EQUIPMENT_IMAGE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function validateHeavyEquipmentPhotoFile(file) {
  if (!file) return { ok: false, message: "Pilih file foto terlebih dahulu." };
  const type = String(file.type || "").toLowerCase();
  const extension = String(file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const extensionAllowed = ["jpg", "jpeg", "png", "webp"].includes(extension);
  if (type && !HEAVY_EQUIPMENT_IMAGE_TYPES.includes(type)) {
    return {
      ok: false,
      message: "Format foto tidak didukung. Gunakan JPG, PNG, atau WebP (HEIC belum didukung).",
    };
  }
  if (!type && !extensionAllowed) {
    return {
      ok: false,
      message: "Format foto tidak didukung. Gunakan JPG, PNG, atau WebP (HEIC belum didukung).",
    };
  }
  return { ok: true };
}

export function getHeavyEquipmentUploadErrorMessage(error) {
  const message = String(error?.message || "").trim();
  return message ? `Gagal upload foto ke server: ${message}` : "Gagal upload foto ke server. Coba lagi.";
}

export function getHeavyEquipmentProcessingErrorMessage(error) {
  return `Gagal memproses foto: ${String(error?.message || "format atau isi file tidak dapat diproses")}.`;
}
