import test from "node:test";
import assert from "node:assert/strict";
import {
  validateHeavyEquipmentPhotoFile,
  getHeavyEquipmentUploadErrorMessage,
  getHeavyEquipmentProcessingErrorMessage,
} from "../../src/lib/heavyEquipmentPhoto.js";

test("unsupported format is rejected immediately with an Indonesian message", () => {
  const result = validateHeavyEquipmentPhotoFile({ name: "alat.heic", type: "image/heic" });
  assert.equal(result.ok, false);
  assert.match(result.message, /JPG, PNG, atau WebP/);
  assert.match(result.message, /HEIC/);
});

test("server upload failure preserves the safe server cause", () => {
  assert.equal(
    getHeavyEquipmentUploadErrorMessage(new Error("Bucket tug-photos tidak tersedia")),
    "Gagal upload foto ke server: Bucket tug-photos tidak tersedia",
  );
});

test("image processing failure is classified separately from Storage failure", () => {
  assert.equal(getHeavyEquipmentProcessingErrorMessage(new Error("canvas gagal")), "Gagal memproses foto: canvas gagal.");
});

test("valid JPEG, PNG, and WebP files are accepted for the update path", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.deepEqual(validateHeavyEquipmentPhotoFile({ type }), { ok: true });
  }
  assert.deepEqual(validateHeavyEquipmentPhotoFile({ name: "alat.JPG", type: "" }), { ok: true });
});
