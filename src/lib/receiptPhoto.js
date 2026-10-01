// Kontrak foto penerimaan TUG-3/TUG-10.
// Foto wajib hanya dianggap aman bila sudah menjadi URL objek tug-photos
// dengan folder transaksi satu tingkat dan index item yang tepat.

export const RECEIPT_PHOTO_BUCKET = "tug-photos";
export const RECEIPT_PHOTO_HOSTS = ["warnoto.com", "api-staging.warnoto.com"];

export function receiptPhotoPath(txnId, itemIndex, field) {
  return `${String(txnId)}/item${Number(itemIndex)}-${String(field)}.jpg`;
}

function photoSlotFromUrl(value, txnId) {
  if (typeof value !== "string" || !value || value.startsWith("data:") || value.startsWith("blob:")) return null;
  const family = String(txnId || "").split("-")[0];
  try {
    const url = new URL(value);
    if (!RECEIPT_PHOTO_HOSTS.includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(new RegExp(`/${family}-[^/]+/item(\\d+)-`));
    return match ? Number(match[1]) : null;
  } catch { return null; }
}

export function normalizeTug10ReceiptPhotoSlots(txn) {
  if (!txn || txn.docType !== "TUG10" || !Array.isArray(txn.stockItems)) return txn;
  const items = txn.stockItems.map(item => ({ ...item }));
  const candidates = items.map((item, index) => item.receiptPhotoSlot ?? photoSlotFromUrl(item.fotoBarangRetur || item.fotoBarang || item.fotoNameplate, txn.id) ?? null);
  const owners = new Map();
  candidates.forEach((slot, index) => { if (slot != null && !owners.has(slot)) owners.set(slot, index); });
  candidates.forEach((slot, index) => { if (slot === index) owners.set(slot, index); });
  const used = new Set(owners.keys());
  const assigned = Array(items.length);
  candidates.forEach((candidate, index) => {
    if (candidate == null || owners.get(candidate) !== index) return;
    assigned[index] = candidate; used.add(candidate);
  });
  candidates.forEach((candidate, index) => {
    if (candidate == null || assigned[index] != null) return;
    let slot = 0; while (used.has(slot)) slot++;
    assigned[index] = slot; used.add(slot);
  });
  for (let index = 0; index < assigned.length; index++) {
    const slot = assigned[index];
    if (slot != null) continue;
    let next = 0; while (used.has(next)) next++;
    assigned[index] = next; used.add(next);
  }
  return { ...txn, stockItems: items.map((item, index) => {
    const candidate = candidates[index];
    const conflict = candidate != null && owners.get(candidate) !== index;
    const slot = assigned[index] ?? index;
    const hasBarang = item.fotoBarangRetur || item.fotoBarang;
    const hasRequiredPhotos = hasBarang && (item.statusMaterial !== "Bongkaran ATTB (MTU)" || item.fotoNameplate);
    const repaired = !conflict && item.receiptPhotoRepair && hasRequiredPhotos;
    const cleanItem = repaired ? (() => { const { receiptPhotoRepair: _repair, ...rest } = item; return rest; })() : item;
    return { ...cleanItem, receiptPhotoSlot: slot, ...(conflict ? { fotoBarangRetur: null, fotoBarang: null, fotoNameplate: null, receiptPhotoRepair: true } : {}) };
  }) };
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
  const normalized = txn?.docType === "TUG10" ? normalizeTug10ReceiptPhotoSlots(txn) : txn;
  (normalized?.stockItems || []).forEach((item, index) => {
    const photoIndex = normalized?.docType === "TUG10" ? (item.receiptPhotoSlot ?? index) : index;
    // TUG-10 lama memakai fotoBarang; terima keduanya saat migrasi/approval.
    // Jalur form baru tetap menulis fotoBarangRetur.
    const photoCandidates = txn?.docType === "TUG10"
      ? [["fotoBarangRetur", item?.fotoBarangRetur], ["fotoBarang", item?.fotoBarang]]
      : [[field, item?.[field]]];
    const photo = photoCandidates.find(([candidateField, value]) => requireStored
      ? isReceiptPhotoReference(value, txnId, photoIndex, candidateField)
      : Boolean(value));
    const ok = !!photo;
    if (!ok) missing.push({ index, field, label: `Barang #${index + 1}: foto barang${item?.receiptPhotoRepair ? " (unggah ulang)" : ""}` });
    const nameplateOk = requireStored
      ? isReceiptPhotoReference(item?.fotoNameplate, txnId, photoIndex, "fotoNameplate")
      : Boolean(item?.fotoNameplate);
    if (txn?.docType === "TUG10" && item?.statusMaterial === "Bongkaran ATTB (MTU)" && !nameplateOk) {
      missing.push({ index, field: "fotoNameplate", label: `Barang #${index + 1}: foto nameplate (ATTB)` });
    }
  });
  return missing;
}
