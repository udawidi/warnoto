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
  const k = String(kodeKatalog).trim().replace(/^0+/, "");
  if (/^\d{10}$/.test(k)) return "SAP — Cadang";
  if (/^\d{7,8}$/.test(k)) return "SAP — Persediaan";
  return "Non-SAP";
}

// Label status SAP yang menghormati override manual (field `sapStatus`, disimpan di jsonb)
// dan material non-stock hasil migrasi (id STK-PREMEM-* = Non-SAP). Tinggal di sini, bukan di
// src/lib/sap.js, karena nightly_sync.mjs (Node) tidak bisa mengimpor sap.js — kalau logikanya
// disalin, status di bot Telegram/web akan menyimpang dari yang dilihat user di aplikasi.
export function resolveSapLabel(kodeKatalog, override) {
  if (override === "Non-SAP") return "Non-SAP";
  if (override === "SAP — Persediaan" || override === "SAP — Cadang") return override;
  const derived = getSAPLabel(kodeKatalog);
  if (override === "SAP") return derived === "Non-SAP" ? "SAP — Persediaan" : derived;
  return derived;
}

// Untuk satu baris Data Stok / Master Katalog (punya .katalog, .sapStatus, .id).
// Non-SAP eksplisit tetap menang; jenis Pre Memory mengoreksi label SAP turunan/legacy.
export function rowSapLabel(row) {
  if (row?.sapStatus === "Non-SAP") return "Non-SAP";
  if (row?.jenisBarang === "Pre Memory") return "SAP — Pre Memory";
  if (row?.sapStatus) return resolveSapLabel(row?.katalog, row.sapStatus);
  if (String(row?.id || "").startsWith("STK-PREMEM-")) return "Non-SAP";
  return getSAPLabel(row?.katalog);
}

export function meanStdev(series) {
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  const stdev = Math.sqrt(series.reduce((sum, value) => sum + (value - mean) ** 2, 0) / series.length);
  return { mean, stdev };
}

// Inverse normal CDF (algoritma Acklam), akurasi ~1e-9, dipakai utk Z-score safety stock.
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= phigh) {
    q = p - 0.5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1-p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// Ubah map {"YYYY-MM": qty} (yang cuma menyimpan bulan berisi transaksi) menjadi array
// berurutan dari bulan tertua sampai `now`, dengan bulan kosong diisi 0. Rumahnya di sini
// (bukan tsbForecast.js) karena sekarang dipakai lintas browser + Node (nightly_sync.mjs).
export function expandMonthlySeriesFromMap(historyMap, now = Date.now()) {
  const keys = Object.keys(historyMap);
  if (keys.length === 0) return [];
  const toIndex = (key) => { const [y, m] = key.split("-").map(Number); return y * 12 + (m - 1); };
  const nowDate = new Date(now);
  const endIdx = nowDate.getFullYear() * 12 + nowDate.getMonth();
  const startIdx = Math.min(...keys.map(toIndex));
  const series = [];
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    series.push(historyMap[key] || 0);
  }
  return series;
}

// Stok minimum EFEKTIF: kalau histori pemakaian sudah cukup panjang, hitung sendiri sebagai
// reorder point (lead time demand + safety stock 95%) dan abaikan angka manual "Min Qty Alert";
// kalau belum, pakai angka manual. SATU rumus untuk Forecast Stok, Dashboard, dan bot Telegram
// — jangan disalin ke tempat lain, semua pemakai harus import dari sini.
export function computeEffectiveMinQty({ monthlySeries = [], manualMinQty = 0, leadTimeMonths = 1, serviceLevel = 0.95, minHistoryMonths = 3 } = {}) {
  if (monthlySeries.length < minHistoryMonths) return { minQty: manualMinQty, minQtySource: "manual" };
  const { mean, stdev } = meanStdev(monthlySeries);
  const minQty = Math.ceil(mean * leadTimeMonths + normInv(serviceLevel) * stdev * Math.sqrt(leadTimeMonths));
  return { minQty, minQtySource: "computed" };
}

// Material kritis AGREGAT per katalog: total qty semua lokasi (dalam 1 UPT) <= minimum.
// Dipakai bersama App.jsx (dashboard) & nightly_sync.mjs (bot) supaya definisi "kritis" identik
// — mencegah beda hitung per-lokasi vs agregat. Objek hasil meniru 1 baris stok representatif
// (spread ...s) tapi qty=total & minQty=max, jadi kode pemakai (m.name/m.qty/m.minQty) tetap jalan.
// `monthlySeriesByKatalogId` opsional: kalau diisi (lihat buildMonthlySeriesByKatalog di
// analytics.js), minQty dihitung otomatis dari histori; kalau tidak, perilakunya sama seperti
// dulu (murni angka manual) supaya caller lama tetap jalan.
export function getKritisAgg(stocks, monthlySeriesByKatalogId = {}) {
  const g = {};
  (stocks || []).forEach((s) => {
    if (s.jenisBarang === "Non-Stock") return;
    const kid = s.katalogId || s.id;
    if (!g[kid]) g[kid] = { ...s, id: kid, katalogId: kid, qty: 0, minQty: 0, lokasi: null };
    g[kid].qty += s.qty || 0;
    g[kid].minQty = Math.max(g[kid].minQty, s.minQty || 0);
  });
  return Object.values(g)
    .map((m) => {
      const { minQty, minQtySource } = computeEffectiveMinQty({
        monthlySeries: monthlySeriesByKatalogId[m.katalogId] || [],
        manualMinQty: m.minQty,
      });
      return { ...m, minQty, minQtySource };
    })
    .filter((m) => m.minQty > 0 && m.qty <= m.minQty);
}

// Pisahkan chunk yang perlu di-embed ulang (baru atau content beda dari yang tersimpan di
// rag_chunks) dari yang sudah identik persis (skip total, hemat kuota Cohere trial). Dipakai
// baik oleh App.jsx (syncRagChunks, tombol manual + auto-sync debounced) maupun
// nightly_sync.mjs (cron malam) supaya keduanya konsisten skip chunk yang tidak berubah.
export function splitChunksForEmbed(allChunks, existingContentById) {
  return allChunks.filter((c) => existingContentById.get(c.id) !== c.content);
}

// Isi 1 chunk RAG "forecast": proyeksi bulan-ke-habis + reorder point, dipakai nightly_sync.mjs.
// Rumus bulan-ke-habis = qty / rata-rata pemakaian bulanan (meanStdev dari monthlySeries) —
// SATU sumber, jangan dihitung ulang di tempat lain.
export function buildForecastRagContent({ nama, satuan, qty, monthlySeries = [], effectiveMinQty = 0 }) {
  const mean = monthlySeries.length ? meanStdev(monthlySeries).mean : 0;
  const rop = ` Titik pesan ulang (reorder point): ${fmtNum(effectiveMinQty)} ${satuan}.`;
  if (mean <= 0) {
    return `Proyeksi kebutuhan ${nama}: stok saat ini ${fmtNum(qty)} ${satuan}, belum ada histori pemakaian, proyeksi belum tersedia.${rop}`;
  }
  const bulanHabis = qty / mean;
  const status = qty <= effectiveMinQty ? "PERLU PENGADAAN SEGERA" : bulanHabis < 2 ? "pantau" : "aman";
  return `Proyeksi kebutuhan ${nama}: stok saat ini ${fmtNum(qty)} ${satuan}, rata-rata pemakaian ${fmtNum(mean)}/bulan, perkiraan habis dalam ~${fmtNum(Math.round(bulanHabis))} bulan.${rop} Status: ${status}.`;
}

// Isi 1 chunk RAG "katalog": nama, kode, kategori, status SAP, qty + harga Rupiah, lokasi fisik.
export function buildKatalogRagContent(k, stockInfo) {
  const sap = rowSapLabel(k);
  if (!stockInfo) return `Material: ${k.name}. Nomor Katalog: ${k.katalog || "-"}. Kategori: ${k.category || "-"}. Jenis Barang: ${k.jenisBarang || "-"}. Satuan: ${k.satuan || "-"}. Keterangan: ${k.keterangan || "-"}. Status: ${sap}. Belum ada data stok untuk material ini.`;
  const angka = ` Qty saat ini: ${fmtNum(stockInfo.qty)} ${k.satuan || "-"}. Harga satuan: Rp ${fmtNum(Math.round(stockInfo.price))}. Nilai total: Rp ${fmtNum(Math.round(stockInfo.qty * stockInfo.price))}.`;
  const lokasiText = (stockInfo.locations || []).length === 0 ? " Lokasi: belum diisi." :
    ` Lokasi fisik: ${stockInfo.locations.map((l) => `${fmtNum(l.qty)} ${k.satuan || ""} di ${l.gudang || "Gudang tidak diketahui"} blok ${l.blok || "-"}`).join("; ")}.`;
  return `Material: ${k.name}. Nomor Katalog: ${k.katalog || "-"}. Kategori: ${k.category || "-"}. Jenis Barang: ${k.jenisBarang || "-"}. Satuan: ${k.satuan || "-"}. Keterangan: ${k.keterangan || "-"}. Status: ${sap}.${angka}${lokasiText}`;
}
