// Kontrak foto penerimaan TUG-3/TUG-10.
// Foto wajib hanya dianggap aman bila sudah menjadi URL objek tug-photos
// dengan folder transaksi satu tingkat dan index item yang tepat.

export const RECEIPT_PHOTO_BUCKET = "tug-photos";
export const RECEIPT_PHOTO_HOSTS = ["warnoto.com", "api-staging.warnoto.com"];

export function receiptPhotoPath(txnId, itemIndex, field) {
  return `${String(txnId)}/item${Number(itemIndex)}-${String(field)}.jpg`;
}

export function isReceiptPhotoReference(value, txnId, itemIndex, field) {
  if (typeof value !== "string" || !value || value.startsWith("data:") || value.startsWith("blob:")) return false;
  const path = receiptPhotoPath(txnId, itemIndex, field);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !RECEIPT_PHOTO_HOSTS.includes(url.hostname.toLowerCase())) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    const bucketIndex = parts.lastIndexOf(RECEIPT_PHOTO_BUCKET);
    // Prefix boleh berbeda pada draft lama/edit, tetapi tetap satu folder dan satu
    // keluarga dokumen (TUG-3 atau TUG-10); nama file tetap exact.
    const objectPath = parts.slice(bucketIndex + 1);
    const folder = objectPath[0] || "";
    const expectedFamily = String(txnId || "").split("-")[0];
    return objectPath.length === 2 && folder.startsWith(`${expectedFamily}-`) && parts.at(-1) === path.split("/").at(-1);
  } catch { return false; }
}

export function requiredReceiptPhotoField(docType) {
  return docType === "TUG10" ? "fotoBarangRetur" : "fotoBarang";
}

export function missingReceiptPhotos(txn, { requireStored = false } = {}) {
  const field = requiredReceiptPhotoField(txn?.docType);
  const txnId = txn?.id;
  const missing = [];
  (txn?.stockItems || []).forEach((item, index) => {
    // TUG-10 lama memakai fotoBarang; terima keduanya saat migrasi/approval.
    // Jalur form baru tetap menulis fotoBarangRetur.
    const photoCandidates = txn?.docType === "TUG10"
      ? [["fotoBarangRetur", item?.fotoBarangRetur], ["fotoBarang", item?.fotoBarang]]
      : [[field, item?.[field]]];
    const photo = photoCandidates.find(([candidateField, value]) => requireStored
      ? isReceiptPhotoReference(value, txnId, index, candidateField)
      : Boolean(value));
    const ok = !!photo;
    if (!ok) missing.push({ index, field, label: `Barang #${index + 1}: foto barang` });
    const nameplateOk = requireStored
      ? isReceiptPhotoReference(item?.fotoNameplate, txnId, index, "fotoNameplate")
      : Boolean(item?.fotoNameplate);
    if (txn?.docType === "TUG10" && item?.statusMaterial === "Bongkaran ATTB (MTU)" && !nameplateOk) {
      missing.push({ index, field: "fotoNameplate", label: `Barang #${index + 1}: foto nameplate (ATTB)` });
    }
  });
  return missing;
}
