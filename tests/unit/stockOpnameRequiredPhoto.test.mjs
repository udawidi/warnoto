import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isValidOpnamePhotoUrl, missingRequiredOpnamePhotos } from "../../src/lib/stockOpnamePhotoSecurity.js";

test("stock opname requires self-host Foto Keseluruhan only for positive qty", () => {
  const url = "https://warnoto.com/storage/v1/object/public/stock-photos/upt-sby/KAT-1/utama-x.jpg";
  assert.equal(isValidOpnamePhotoUrl(url), true);
  assert.equal(isValidOpnamePhotoUrl("data:image/jpeg;base64,abc"), false);
  assert.equal(isValidOpnamePhotoUrl("https://example.com/photo.jpg"), false);
  assert.equal(isValidOpnamePhotoUrl("https://example.com/storage/v1/object/public/stock-photos/upt-sby/a.jpg"), false);
  const missing = missingRequiredOpnamePhotos({ items: [
    { qtsFisik: 2 },
    { qtsFisik: 0 },
    { qtsFisik: 3, fotoKeseluruhan: url },
  ] });
  assert.deepEqual(missing.map(x => x.index), [0]);
});

test("required photo migration guards submit and final approval", () => {
  const sql = fs.readFileSync("supabase/migrations/20260921_stock_opname_required_photo.sql", "utf8");
  assert.match(sql, /stock_opname_photo_url_valid/);
  assert.match(sql, /storage\.objects/);
  assert.match(sql, /https:\/\/warnoto\[\.\]com\/storage\/v1\/object/);
  assert.match(sql, /new\.status in \('PENDING_ASMAN', 'SELESAI'\)/);
  assert.match(sql, /OPNAME_REQUIRED_PHOTO_MISSING/);
});

test("field mode, approval, and Kartu Gantung use the required-photo flow", () => {
  const fieldMode = fs.readFileSync("src/components/OpnameLapanganView.jsx", "utf8");
  const hook = fs.readFileSync("src/hooks/useStockOpname.js", "utf8");
  const card = fs.readFileSync("src/components/KartuGantungModal.jsx", "utf8");
  const docs = fs.readFileSync("src/lib/docBuilders.js", "utf8");
  assert.match(fieldMode, /accept="image\/\*" capture="environment"/);
  assert.match(fieldMode, /Number\(qtyInput\) > 0 && !item\.fotoKeseluruhan/);
  assert.match(hook, /missingRequiredOpnamePhotos\(normalized\)/);
  assert.match(hook, /fotoByStockId\[photoTarget\]/);
  assert.match(card, /Telah dilakukan Stock Opname pada tanggal/);
  assert.match(docs, /Telah dilakukan Stock Opname pada tanggal/);
});
