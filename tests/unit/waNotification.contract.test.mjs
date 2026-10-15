import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hook = await readFile(new URL("../../src/hooks/useTugApprovals.js", import.meta.url), "utf8");
const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");
const dispatcher = await readFile(new URL("../../supabase/functions/notify-dispatch/index.ts", import.meta.url), "utf8");

test("notif snapshot mempertahankan header pekerjaan, lokasi, kontrak, penerima, asal", () => {
  assert.match(hook, /pekerjaan, lokasi, kontrak, penerima, asal, kendaraan, pengemudi/);
  assert.match(hook, /pekerjaan, lokasi, kontrak, penerima, asal, kendaraan, pengemudi,\s*\n\s*\}/);
  assert.match(app, /docType: txn\.docType[\s\S]*lokasi: txn\.lokasiPekerjaan/);
  assert.match(app, /docType: "TUG10"[\s\S]*lokasi: txn\.lokasiPekerjaan/);
});

test("dispatcher punya fallback tabel dedicated TUG-3/TUG-10", () => {
  assert.match(dispatcher, /docType === "TUG3" \? "tug3_transactions"/);
  assert.match(dispatcher, /docType === "TUG10" \? "tug10_transactions"/);
  assert.match(dispatcher, /mapDocumentItems\(doc\)/);
  assert.match(dispatcher, /const isReceipt = docType === "TUG3"/);
  assert.match(dispatcher, /pekerjaan: isReceipt \? ""/);
});

test("payload field kosong tidak dipaksa menjadi label palsu", () => {
  assert.match(dispatcher, /const kontrak = docType === "TUG3" && hasValues\(p\.kontrak\) \? p\.kontrak : kontrakFromDoc/);
  assert.match(dispatcher, /const asal = hasValues\(p\.asal\) \? p\.asal : asalFromDoc/);
  assert.match(dispatcher, /lokasi: p\.lokasi \|\| \(isReceipt \? doc\.lokasiPenyerahan : doc\.lokasiPekerjaan\) \|\| ""/);
});
