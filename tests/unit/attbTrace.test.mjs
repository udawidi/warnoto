import test from "node:test";
import assert from "node:assert/strict";
import { attbPhotoUrl, attbSourceKey, attbPublicUrl, parseAttbPublicParams, isAttbUnitValid, safeAttbPhotoPath } from "../../src/lib/attbTrace.js";

test("ATTB trace uses canonical source key and fragment token", () => {
  assert.equal(attbSourceKey("txn-1", 2), "TUG10|txn-1|2");
  const url = attbPublicUrl("a&1", "token", "https://pln.warnoto.com");
  assert.deepEqual(parseAttbPublicParams(new URL(url).search, new URL(url).hash), { attbId: "a&1", token: "token" });
});
test("ATTB unit requires qty one and serial or asset", () => {
  assert.equal(isAttbUnitValid({ statusMaterial: "Bongkaran ATTB (MTU)", qty: 1, noSeri: "SN" }), true);
  assert.equal(isAttbUnitValid({ statusMaterial: "Bongkaran ATTB (MTU)", qty: 2, noSeri: "SN" }), false);
  assert.equal(isAttbUnitValid({ statusMaterial: "Bongkaran ATTB (MTU)", qty: 1 }), false);
});
test("public photos accept relative storage paths only", () => {
  assert.equal(attbPhotoUrl("T10-1/a.jpg", "https://warnoto.com/"), "https://warnoto.com/storage/v1/object/public/tug-photos/T10-1/a.jpg");
  assert.equal(safeAttbPhotoPath("https://evil.test/a.jpg"), "");
  assert.equal(safeAttbPhotoPath("../a.jpg"), "");
});
