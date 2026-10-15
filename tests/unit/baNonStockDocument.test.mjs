import assert from "node:assert/strict";
import test from "node:test";
import { buildBaNonStockHTML } from "../../src/lib/docBuilders.js";

const approved = {
  id:"BA-TEST", docType:"BA_NON_STOCK", status:"APPROVED", docNumber:"001.BA/UPT-SBY/10/2026",
  tanggal:"2026-10-15", sumber:"ULTG Surabaya Selatan", tujuan:"GI Wonokromo", referensi:"SPK-01", keperluan:"Pemeliharaan",
  penerimaNama:"Penerima", penerimaJabatan:"Pengawas", satpamNama:"Satpam", tlNama:"Team Leader",
  items:[{ nama:"Kabel kontrol", qty:12, satuan:"METER", keterangan:"Pinjam sementara" }],
  foto1:"https://example.test/label.jpg", foto2:"https://example.test/loaded.jpg",
};

test("BA Non Stock approved prints all manual material columns and two evidence captions", () => {
  const html = buildBaNonStockHTML(approved);
  for (const value of ["001.BA/UPT-SBY/10/2026", "Nama Material", "Qty", "Satuan", "Keterangan", "Kabel kontrol", "12", "METER", "Foto label / packing list", "Foto material sudah dimuat", "Penerima Material", "Satpam", "Team Leader", "Dokumen Referensi", "Unit Tujuan"]) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /DRAFT \/ BELUM DISETUJUI/);
});

test("BA Non Stock draft is watermarked and stored values are escaped", () => {
  const html = buildBaNonStockHTML({ ...approved, status:"DRAFT", items:[{ nama:'<img src=x onerror=alert(1)>', qty:1, satuan:"BUAH", keterangan:'<script>alert(1)</script>' }] });
  assert.match(html, /DRAFT \/ BELUM DISETUJUI/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
