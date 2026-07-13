// Konstanta global WARNOTO — dipindah dari App.jsx (refactor Fase 1).
export const COMPANY = "PT. PLN (Persero)";
export const UIT = "Unit Induk Transmisi Jawa Bagian Timur dan Bali";
export const UPT = "UPT Surabaya";
export const WAREHOUSE = "Gudang Ketintang";
export const DOC_CODE = "LOG.00.02";
export const APP_VERSION = "v3.0.0";
// Label tampilan status kapasitas gudang (kode data internal KRITIS/WASPADA/AMAN
// tetap dipakai untuk perbandingan & warna, hanya teks yang ditampilkan ke user berubah)
export const KAPASITAS_LABEL = { KRITIS: "Penuh", WASPADA: "Terbatas", AMAN: "Cukup" };

// Bulan romawi untuk nomor dokumen TUG (dipindah dari App.jsx Fase 3a).
export const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

// Jenis barang stok (dipindah dari App.jsx Fase 4f).
export const JENIS_BARANG = ["Pre Memory", "Cadang", "Persediaan", "Persediaan Bursa", "ATTB", "Non-Stock", "Bongkaran"];
