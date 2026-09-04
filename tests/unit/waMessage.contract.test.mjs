import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWaMessage } from "../../supabase/functions/notify-dispatch/renderWaMessage.mjs";

test("COMPLETION KELUAR penuh — semua baris muncul", () => {
  const msg = renderWaMessage({
    eventType: "COMPLETION", arah: "KELUAR", docType: "TUG9", docLabel: "TUG-9 Pengeluaran",
    docNumber: "230.TUG-9/LOG.00.02/SBYA/VIII/2026",
    uptNama: "UPT Surabaya", gudang: "TANAH LOT",
    tanggal: "4 September 2026, 09.27 WIB",
    pekerjaan: "Pekerjaan proteksi", lokasi: "GI BUDURAN",
    penerima: "ARIFIN (ULTG SBS)",
    kendaraan: "L 9987 BE", pengemudi: "Atim",
    approver: "Super Admin", tl: "Widi Ferdian R",
    items: [{ kode: "4160028", nama: "CABLE CTRL", qty: 250, satuan: "M" }],
    totalItem: 1,
  });
  assert.match(msg, /TUG-9 Pengeluaran — DISETUJUI FINAL/);
  assert.match(msg, /UPT Surabaya · Gudang TANAH LOT/);
  assert.match(msg, /Tujuan: ARIFIN \(ULTG SBS\)/);
  assert.match(msg, /Kendaraan: L 9987 BE · Pengemudi: Atim/);
  assert.match(msg, /Disetujui: Super Admin · TL: Widi Ferdian R/);
  assert.match(msg, /Material — 1 item:/);
  assert.match(msg, /https:\/\/pln\.warnoto\.com/);
  assert.doesNotMatch(msg, /undefined/);
});

test("COMPLETION MASUK — kontrak & asal, cap 8 item + sisa", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ kode: `K${i}`, nama: `Material ${i}`, qty: i + 1, satuan: "PCS" }));
  const msg = renderWaMessage({
    eventType: "COMPLETION", arah: "MASUK", docType: "TUG3", docLabel: "TUG-3 Penerimaan",
    docNumber: "DOC-3", uptNama: "UPT Bali", tanggal: "1 Januari 2026, 08.00 WIB",
    kontrak: { nama: "Pengadaan Kabel", noSP: "SP-99", pt: "PT Sumber Jaya" },
    asal: { vendor: "PT Sumber Jaya", pic: "Budi" }, kendaraan: "B 1 ABC",
    items, totalItem: items.length,
  });
  assert.match(msg, /TUG-3 Penerimaan — DISETUJUI FINAL/);
  assert.match(msg, /Kontrak: Pengadaan Kabel · No\.SP SP-99 · PT Sumber Jaya/);
  assert.match(msg, /Asal\/Vendor: PT Sumber Jaya · PIC Budi · Nopol B 1 ABC/);
  assert.match(msg, /Material — 10 item:/);
  assert.match(msg, /_\+2 material lagi_/);
  assert.match(msg, /Barang telah masuk gudang\./);
  const bullets = msg.split("\n").filter(l => l.startsWith("• "));
  assert.equal(bullets.length, 8);
});

test("PENDING — header beda, pengaju, tanpa approver", () => {
  const msg = renderWaMessage({
    eventType: "PENDING", arah: "KELUAR", docType: "TUG9", docLabel: "TUG-9 Pengeluaran",
    docNumber: "DOC-9", pengaju: "Fajar Sutomo", items: [{ kode: "A", nama: "B", qty: 1, satuan: "PCS" }], totalItem: 1,
  });
  assert.match(msg, /MENUNGGU PERSETUJUAN ASMAN/);
  assert.match(msg, /Diajukan oleh: Fajar Sutomo/);
  assert.match(msg, /Mohon segera diproses\./);
  assert.doesNotMatch(msg, /Disetujui:/);
  assert.doesNotMatch(msg, /undefined/);
});

test("field kosong -> baris tidak dicetak, tak ada separator menggantung", () => {
  const msg = renderWaMessage({ eventType: "COMPLETION", arah: "KELUAR", docType: "TUG9", docLabel: "TUG-9 Pengeluaran" });
  assert.doesNotMatch(msg, /undefined/);
  assert.doesNotMatch(msg, /UPT/);
  assert.doesNotMatch(msg, /Tujuan:/);
  assert.doesNotMatch(msg, /Kendaraan:/);
  assert.doesNotMatch(msg, /Material —/);
  // Tanpa items -> hanya header + footer, satu SEP saja (bukan dobel/tiga).
  const sepCount = (msg.match(/━━━━━━━━━━━━━━━━━━━━/g) || []).length;
  assert.equal(sepCount, 1);
});
