import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isReceiptPhotoReference, missingReceiptPhotos, receiptPhotoPath, normalizeTug10ReceiptPhotoSlots } from "../../src/lib/receiptPhoto.js";

const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const stockModal = fs.readFileSync(new URL("../../src/components/StockModals.jsx", import.meta.url), "utf8");
const txns = fs.readFileSync(new URL("../../src/hooks/useTugTransactions.js", import.meta.url), "utf8");
const approvals = fs.readFileSync(new URL("../../src/hooks/useTugApprovals.js", import.meta.url), "utf8");
const mtu = fs.readFileSync(new URL("../../supabase/migrations/20260916_receipt_photo_mtu.sql", import.meta.url), "utf8");

test("Data Stok photo fields are optional", () => {
  assert.doesNotMatch(app, /Foto Nameplate wajib diupload/);
  assert.doesNotMatch(app, /Foto Keseluruhan wajib diupload/);
  assert.match(stockModal, /Foto Nameplate \(opsional\)/);
  assert.match(stockModal, /Foto Keseluruhan \(opsional\)/);
});

test("Data Stok photo inputs support gallery selection", () => {
  const stockInputs = [...stockModal.matchAll(/<input type="file"[^>]*>/g)].map(match => match[0]);
  const detailInputs = [...app.matchAll(/<input type="file"[^>]*>/g)].map(match => match[0]);
  assert.equal(stockInputs.length, 3);
  assert.ok(stockInputs.every(input => input.includes('accept="image/*"') && !input.includes('capture=')));
  assert.ok(detailInputs.some(input => input.includes('accept="image/*"') && !input.includes('capture=') && input.includes('onChange')));
  assert.match(stockModal, /handleImg\(e, img=>setStockForm/);
  assert.match(app, /handleImg\(e, img=>setPendingFoto/);
});

test("receipt photo path is stable and strict", () => {
  const txnId = "TUG3-abc123";
  const expected = "https://warnoto.com/storage/v1/object/public/tug-photos/TUG3-abc123/item0-fotoBarang.jpg";
  assert.equal(receiptPhotoPath(txnId, 0, "fotoBarang"), "TUG3-abc123/item0-fotoBarang.jpg");
  assert.equal(isReceiptPhotoReference(expected, txnId, 0, "fotoBarang"), true);
  assert.equal(isReceiptPhotoReference(expected.replace("warnoto.com", "evil.com"), txnId, 0, "fotoBarang"), false);
  assert.equal(isReceiptPhotoReference(expected.replace("https://", "http://"), txnId, 0, "fotoBarang"), false);
  assert.equal(isReceiptPhotoReference("data:image/jpeg;base64,abc", txnId, 0, "fotoBarang"), false);
  assert.equal(isReceiptPhotoReference(expected.replace("item0", "item1"), txnId, 0, "fotoBarang"), false);
});

test("TUG-3 submit requires item photo while draft stays allowed", () => {
  assert.match(txns, /if \(!si\.fotoBarang\) missing\.push/);
  assert.match(txns, /targetStage !== "DRAFT"/);
  assert.match(txns, /missingReceiptPhotos\(\{ \.\.\.formData, id: txnId, docType \}/);
});

test("legacy TUG-3 and TUG-4 approval paths have photo defense", () => {
  assert.match(approvals, /approveTUG3_TL[\s\S]*missingReceiptPhotos\(txn, \{ requireStored: true \}\)/);
  assert.match(approvals, /submitTUG4DanLampiran[\s\S]*missingReceiptPhotos\(candidate, \{ requireStored: true \}\)/);
  assert.match(approvals, /approveTUG3Final_Asman[\s\S]*missingReceiptPhotos\(txn, \{ requireStored: true \}\)/);
});

test("MTU RPC validates exact object path and writes both stock photo fields", () => {
  assert.match(mtu, /storage\.objects/);
  assert.match(mtu, /https:\/\/warnoto\.com\/storage\/v1\/object\/public\/tug-photos/);
  assert.match(mtu, /https:\/\/api-staging\.warnoto\.com\/storage\/v1\/object\/public\/tug-photos/);
  assert.doesNotMatch(mtu, /not like '%\/storage\/v1\/object\/public\/tug-photos/);
  assert.match(mtu, /item' \|\| item_index \|\| '-fotoBarang\.jpg'/);
  assert.match(mtu, /'fotoKeseluruhan', foto_barang, 'img', foto_barang/);
  assert.match(mtu, /idempotency_key/);
});

test("missing receipt helper reports TUG-10 ATTB nameplate", () => {
  const txn = { id: "TUG10-1", docType: "TUG10", stockItems: [{ fotoBarangRetur: "ok", statusMaterial: "Bongkaran ATTB (MTU)" }] };
  const missing = missingReceiptPhotos(txn);
  assert.deepEqual(missing.map(x => x.field), ["fotoNameplate"]);
});

test("missing receipt helper accepts legacy TUG-10 fotoBarang attachment", () => {
  const txn = { id: "TUG10-legacy", docType: "TUG10", stockItems: [{ fotoBarang: "ok" }] };
  assert.deepEqual(missingReceiptPhotos(txn).map(x => x.field), []);
});

test("stored TUG-10 fotoBarang uses its actual legacy object path", () => {
  const txn = { id: "TUG10-legacy", docType: "TUG10", stockItems: [{ fotoBarang: "https://warnoto.com/storage/v1/object/public/tug-photos/TUG10-legacy/item0-fotoBarang.jpg" }] };
  assert.deepEqual(missingReceiptPhotos(txn, { requireStored: true }), []);
});

test("stored TUG-10 accepts legacy transaction prefix with exact item filename", () => {
  const txn = { id: "TUG10-current", docType: "TUG10", stockItems: [{ fotoBarangRetur: "https://warnoto.com/storage/v1/object/public/tug-photos/TUG10-old/item0-fotoBarangRetur.jpg" }] };
  assert.deepEqual(missingReceiptPhotos(txn, { requireStored: true }), []);
});

test("stored receipt photo rejects nested or cross-document paths", () => {
  const base = "https://warnoto.com/storage/v1/object/public/tug-photos/";
  const nested = { id: "TUG10-current", docType: "TUG10", stockItems: [{ fotoBarangRetur: `${base}TUG10-old/nested/item0-fotoBarangRetur.jpg` }] };
  const crossFamily = { id: "TUG10-current", docType: "TUG10", stockItems: [{ fotoBarangRetur: `${base}TUG3-old/item0-fotoBarangRetur.jpg` }] };
  assert.equal(missingReceiptPhotos(nested, { requireStored: true }).length, 1);
  assert.equal(missingReceiptPhotos(crossFamily, { requireStored: true }).length, 1);
});

test("TUG-10 photo slots survive row shifts and allocate the next free slot", () => {
  const txn = { id: "TUG10-shift", docType: "TUG10", stockItems: [
    { receiptPhotoSlot: 0, fotoBarangRetur: "a" },
    { receiptPhotoSlot: 1, fotoBarangRetur: "b" },
  ] };
  const normalized = normalizeTug10ReceiptPhotoSlots(txn);
  assert.deepEqual(normalized.stockItems.map(item => item.receiptPhotoSlot), [0, 1]);
  const added = normalizeTug10ReceiptPhotoSlots({ ...normalized, stockItems: [...normalized.stockItems, {}] });
  assert.equal(added.stockItems[2].receiptPhotoSlot, 2);
});

test("new TUG-10 rows get stable empty slots", () => {
  const normalized = normalizeTug10ReceiptPhotoSlots({ id: "TUG10-new", docType: "TUG10", stockItems: [{}, {}] });
  assert.deepEqual(normalized.stockItems.map(item => item.receiptPhotoSlot), [0, 1]);
  assert.match(txns, /docType === "TUG10"[\s\S]*receiptPhotoSlot:0/);
});

test("mixed empty and explicit TUG-10 slots remain unique", () => {
  const normalized = normalizeTug10ReceiptPhotoSlots({ id: "TUG10-mixed", docType: "TUG10", stockItems: [{}, { receiptPhotoSlot: 0 }] });
  assert.deepEqual(normalized.stockItems.map(item => item.receiptPhotoSlot), [1, 0]);
});

test("TUG-10 duplicate legacy slot keeps exact-index owner and marks conflict for repair", () => {
  const base = "https://warnoto.com/storage/v1/object/public/tug-photos/TUG10-old/";
  const txn = { id: "TUG10-current", docType: "TUG10", stockItems: [
    {},
    ...Array.from({ length: 17 }, () => ({})),
    { fotoBarangRetur: `${base}item19-fotoBarangRetur.jpg`, fotoNameplate: `${base}item19-fotoNameplate.jpg` },
    { fotoBarangRetur: `${base}item19-fotoBarangRetur.jpg`, fotoNameplate: `${base}item19-fotoNameplate.jpg` },
  ] };
  const normalized = normalizeTug10ReceiptPhotoSlots(txn);
  assert.equal(normalized.stockItems[18].receiptPhotoSlot, 0);
  assert.equal(normalized.stockItems[18].receiptPhotoRepair, true);
  assert.equal(normalized.stockItems[18].fotoBarangRetur, null);
  assert.equal(normalized.stockItems[19].receiptPhotoSlot, 19);
});

test("repair marker is cleared after replacement photo is present", () => {
  const normalized = normalizeTug10ReceiptPhotoSlots({ id: "TUG10-repair", docType: "TUG10", stockItems: [{ receiptPhotoSlot: 0, receiptPhotoRepair: true, fotoBarangRetur: "replacement" }] });
  assert.equal(Object.hasOwn(normalized.stockItems[0], "receiptPhotoRepair"), false);
});

test("ATTB repair marker needs both replacement photos", () => {
  const base = { id: "TUG10-repair-attb", docType: "TUG10", stockItems: [{ receiptPhotoSlot: 0, receiptPhotoRepair: true, statusMaterial: "Bongkaran ATTB (MTU)", fotoBarangRetur: "replacement" }] };
  assert.equal(Object.hasOwn(normalizeTug10ReceiptPhotoSlots(base).stockItems[0], "receiptPhotoRepair"), true);
  const complete = normalizeTug10ReceiptPhotoSlots({ ...base, stockItems: [{ ...base.stockItems[0], fotoNameplate: "nameplate" }] });
  assert.equal(Object.hasOwn(complete.stockItems[0], "receiptPhotoRepair"), false);
});
