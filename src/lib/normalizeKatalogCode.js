// Normalisasi kode katalog gaya lama (AppSheet) -> kode katalog WARNOTO sekarang.
// Port JS dari ml/lib/normalize_katalog_code.py — logic HARUS identik, jangan menyimpang.
export function normalizeKatalogCode(raw) {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 10 && digits.startsWith("100")) return digits.slice(3);
  return digits;
}

// Bentuk kanonik kode katalog UNTUK TAMPILAN/BANDING SAJA — tidak menyentuh DB.
// Master katalog lama campur zero-padded ("000000007020273") dan bersih ("4160002");
// strip leading zero (regex, bukan Number() — kode SAP bisa >15 digit, Number kehilangan presisi).
export function canonicalKatalogCode(raw) {
  const s = String(raw ?? "").trim();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
}

// ponytail self-check — jalankan langsung: `node src/lib/normalizeKatalogCode.js`
// (guard typeof process: file ini juga di-bundle ke browser via Vite, di mana `process` tak ada;
// banding basename saja — file:// URL beda encoding spasi dari process.argv[1] mentah, dan
// top-level await/pathToFileURL bikin build browser gagal karena target esbuild lama)
if (typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  console.assert(canonicalKatalogCode("000000007020273") === "7020273", "strip leading zero");
  console.assert(canonicalKatalogCode("4160002") === "4160002", "kode bersih tak berubah");
  console.assert(canonicalKatalogCode("0") === "0", "nol tunggal tetap 0");
  console.assert(canonicalKatalogCode("ABC-123") === "ABC-123", "non-numeric utuh, tak diutak-atik");
  console.log("canonicalKatalogCode self-check OK");
}
