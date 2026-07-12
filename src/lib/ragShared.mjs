// WARNOTO — helper RAG yang dipakai BERSAMA oleh App.jsx (Vite/browser) dan
// scripts/nightly_sync.mjs (Node). Dulu ketiga fungsi ini disalin manual di dua tempat;
// itu sumber drift nyata — isi chunk katalog wajib identik antara sinkron browser & cron
// malam, kalau beda keduanya saling menimpa (persis bug 2026-07-12). Satu sumber di sini.
//
// Ditulis sebagai ESM murni (hanya fungsi pure string/angka, tanpa API browser/Node) supaya
// bisa diimpor App.jsx via Vite maupun nightly_sync.mjs via Node. Node butuh ekstensi .mjs
// untuk memperlakukan file .js sebagai ESM (package.json tanpa "type":"module") — lihat
// nightly_sync.mjs yang mengimpor "../src/lib/ragShared.mjs".

export function fmtNum(n) {
  return Number(n || 0).toLocaleString("id-ID");
}

export function getSAPLabel(kodeKatalog) {
  if (!kodeKatalog || String(kodeKatalog).trim() === "") return "Non-SAP";
  const k = String(kodeKatalog).trim();
  if (/^\d{10}$/.test(k)) return "SAP — Cadang";
  if (/^\d{7,8}$/.test(k)) return "SAP — Persediaan";
  return "Non-SAP";
}

// Material kritis AGREGAT per katalog: total qty semua lokasi (dalam 1 UPT) <= minimum.
// Dipakai bersama App.jsx (dashboard) & nightly_sync.mjs (bot) supaya definisi "kritis" identik
// — mencegah beda hitung per-lokasi vs agregat. Objek hasil meniru 1 baris stok representatif
// (spread ...s) tapi qty=total & minQty=max, jadi kode pemakai (m.name/m.qty/m.minQty) tetap jalan.
export function getKritisAgg(stocks) {
  const g = {};
  (stocks || []).forEach((s) => {
    if (s.jenisBarang === "Non-Stock") return;
    const kid = s.katalogId || s.id;
    if (!g[kid]) g[kid] = { ...s, id: kid, katalogId: kid, qty: 0, minQty: 0, lokasi: null };
    g[kid].qty += s.qty || 0;
    g[kid].minQty = Math.max(g[kid].minQty, s.minQty || 0);
  });
  return Object.values(g).filter((m) => m.minQty > 0 && m.qty <= m.minQty);
}

// Isi 1 chunk RAG "katalog": nama, kode, kategori, status SAP, qty + harga Rupiah, lokasi fisik.
export function buildKatalogRagContent(k, stockInfo) {
  const sap = getSAPLabel(k.katalog);
  if (!stockInfo) return `Material: ${k.name}. Nomor Katalog: ${k.katalog || "-"}. Kategori: ${k.category || "-"}. Jenis Barang: ${k.jenisBarang || "-"}. Satuan: ${k.satuan || "-"}. Keterangan: ${k.keterangan || "-"}. Status: ${sap}. Belum ada data stok untuk material ini.`;
  const angka = ` Qty saat ini: ${fmtNum(stockInfo.qty)} ${k.satuan || "-"}. Harga satuan: Rp ${fmtNum(Math.round(stockInfo.price))}. Nilai total: Rp ${fmtNum(Math.round(stockInfo.qty * stockInfo.price))}.`;
  const lokasiText = (stockInfo.locations || []).length === 0 ? " Lokasi: belum diisi." :
    ` Lokasi fisik: ${stockInfo.locations.map((l) => `${fmtNum(l.qty)} ${k.satuan || ""} di ${l.gudang || "Gudang tidak diketahui"} blok ${l.blok || "-"}`).join("; ")}.`;
  return `Material: ${k.name}. Nomor Katalog: ${k.katalog || "-"}. Kategori: ${k.category || "-"}. Jenis Barang: ${k.jenisBarang || "-"}. Satuan: ${k.satuan || "-"}. Keterangan: ${k.keterangan || "-"}. Status: ${sap}.${angka}${lokasiText}`;
}
