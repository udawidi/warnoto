// MASTER UPT (Unit Pelaksana Transmisi dalam UIT-JBM) — dipindah dari App.jsx (refactor Fase 2).
export const DEFAULT_UPT_LIST = [
  { id:"UPT-SBY", nama:"UPT Surabaya", kode:"UPT-SBYA", alamat:"Jl. Ketintang Baru No. 9 Surabaya", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-MLG", nama:"UPT Malang", kode:"UPT-MLG", alamat:"Malang, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-MDN", nama:"UPT Madiun", kode:"UPT-MDN", alamat:"Madiun, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-PBG", nama:"UPT Probolinggo", kode:"UPT-PBG", alamat:"Probolinggo, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-BLI", nama:"UPT Bali", kode:"UPT-BLI", alamat:"Bali", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-GRS", nama:"UPT Gresik", kode:"UPT-GRS", alamat:"Gresik, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
];

// Kode Plant SAP -> id UPT WARNOTO. Dipakai importer "SAP Langsung" (Migrasi Data) untuk
// menentukan UPT tujuan tiap baris dari export SAP resmi (kolom Plant).
export const SAP_PLANT_TO_UPT = { "3611":"UPT-SBY", "3612":"UPT-MLG", "3613":"UPT-MDN", "3614":"UPT-PBG", "3615":"UPT-BLI" };
