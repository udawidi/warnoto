// SAP status detection + Pencarian Material (sinonim-aware PLN) — dipindah dari
// App.jsx (refactor Fase 3c). Pure string/data ops, tanpa React/state/supabase.
// CATEGORY_SYNONYMS/QUERY_SYNONYMS dipakai internal oleh mesin pencarian.

// ─── PENCARIAN MATERIAL: struktur nama (KATEGORI;SUBTIPE;SPEK...) di katalog
// TIDAK diubah — hanya cara membandingkannya saat search yang disesuaikan,
// supaya orang yang tidak tahu singkatan/istilah teknis PLN tetap bisa
// menemukan barangnya.
// Singkatan kategori PLN -> frasa deskriptif lengkap. SATU ARAH SAJA: hanya
// dipakai untuk memperkaya teks KATALOG (haystack), TIDAK dipakai untuk
// meng-expand kata yang diketik user. Kalau dipakai dua arah, kategori yang
// berbeda tapi berbagi kata umum di frasanya (mis. "pt" dan "ct" sama-sama
// punya kata "trafo"/"transformer") akan saling ketuker — cari "pt" ikut
// menampilkan semua barang "trf"/"ct" hanya karena kata "trafo" dibagi
// bersama. Makanya arah ini ditutup di sisi query.
export const CATEGORY_SYNONYMS = {
  trf: "transformator trafo",
  cb: "circuit breaker pemutus tenaga pmt",
  ds: "disconnecting switch pemisah pms",
  pt: "potential transformer trafo tegangan",
  ct: "current transformer trafo arus",
  acc: "accessories aksesoris",
  al: "aluminium",
  cu: "tembaga copper",
  ngr: "neutral grounding resistance resistor pentanahan",
  cond: "conductor kawat penghantar",
  gsw: "galvanized steel wire kawat baja",
  sw: "switch saklar",
  cub: "kubikel cubicle",
  relay: "rele",
  // Ditambah dari sheet PLN-Terminology, file CATALOG MASTER.xlsx (2026-07-06) —
  // sengaja TIDAK memasukkan singkatan 1 huruf (K/M/N/P/H) atau 2 huruf yang
  // terlalu ambigu (ST/PR/PB) karena berisiko salah cocok dengan kata lain yang
  // tidak berhubungan (lihat aturan exact-match utk kata <=2 huruf di
  // matchesMaterialSearch).
  la: "lightning arrester penangkal petir",
  gis: "gas insulation substation",
  oh: "over head line saluran udara",
  ug: "under ground bawah tanah saluran tanah",
  od: "out door outdoor terpasang di luar ruang gedung",
  id: "indoor terpasang di dalam ruang gedung",
  iso: "isolated isolasi",
  distan: "distance relay rele jarak",
  ocr: "over current relay rele arus lebih",
  ovr: "over voltage relay rele tegangan lebih",
  lw: "live working pekerjaan tanpa pemadaman",
  lvsb: "low voltage switch board papan hubung bagi rak tegangan rendah",
  mccb: "molded case circuit breaker",
  mcb: "mini circuit breaker pembatas arus",
  circl: "circular bulat bundar",
  strg: "straight lurus",
  pier: "piercing bergigi",
  wp: "water proof kedap air",
  cap: "capacity kapasitas",
  comb: "combo kombinasi",
  card: "modul module",
  mtr: "meter",
  rtu: "remote terminal unit",
  plc: "power line carrier",
  recl: "recloser",
  saco: "switch automatic change over",
  sclv: "single core low voltage",
  scmv: "single core medium voltage",
  nclbl: "non clamp block",
  llc: "live line connector",
  clv: "connector low voltage",
  conn: "connector",
  term: "termination terminal",
  diff: "differential",
  dist: "distribution",
  dt: "double tarif",
  ef: "earth fault",
  flv: "for low voltage",
  ind: "inductive",
  co: "cut out",
  cr: "capacitor",
};

// Pasangan istilah 1:1 (awam <-> teknis) yang AMAN dipakai dua arah karena
// kata penggantinya spesifik/tidak dibagi kategori lain — ini yang membuat
// "klem" nemu "CLAMP", "saklar" nemu kata "switch" (hasil expand DS di atas),
// "sekring" nemu "FUSE", dst.
export const QUERY_SYNONYMS = {
  klem: "clamp",
  clamp: "klem",
  saklar: "switch",
  sekring: "fuse",
  fuse: "sekring",
  terminasi: "term terminal",
  terminal: "term",
  term: "terminal",
  box: "kotak",
  kotak: "box",
  joint: "sambungan",
  conn: "sambungan",
  sambungan: "joint conn",
  bolt: "baut",
  baut: "bolt",
  rod: "batang",
  batang: "rod",
};

// Samakan variasi penulisan biar bisa dibandingkan apa adanya: hilangkan
// pemisah `;`/`,`/`-`, lowercase, rapatkan spasi antara angka dan satuan
// (550 mm2 -> 550mm2) tanpa pernah menulis balik ke data aslinya.
export function normalizeSearchText(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[;,\-]/g, " ")
    .replace(/(\d)\s+(mm2|mm|cm|kv|kn|kva|kw|ka|ohm|va|a|v)\b/gi, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// Haystack katalog diperkaya dengan KEDUA kamus (kategori + istilah 1:1) —
// aman di sisi ini karena hanya mempengaruhi item itu sendiri, tidak
// menjembatani ke item lain.
export function expandHaystackSynonyms(normalizedText) {
  return normalizedText
    .split(" ")
    .map(w => {
      const exp = CATEGORY_SYNONYMS[w] || QUERY_SYNONYMS[w];
      return exp ? `${w} ${exp}` : w;
    })
    .join(" ");
}

// Setiap KATA yang diketik user jadi satu "grup alternatif" (kata itu sendiri
// + sinonim 1:1-nya saja, BUKAN kamus kategori) — posisi itu lolos kalau
// SALAH SATU alternatif ketemu di katalog (OR per grup), tapi user tetap
// harus mengetik SEMUA kata yang ia masukkan (AND antar grup).
export function queryTokenGroups(query) {
  return normalizeSearchText(query).split(" ").filter(Boolean).map(w => {
    const syn = QUERY_SYNONYMS[w];
    return syn ? [w, ...syn.split(" ")] : [w];
  });
}

// Kata pendek (<=2 huruf, mis. "al"/"cb"/"ct"/"cu") HARUS sama persis dengan
// satu kata di katalog — kalau dibolehkan prefix, "cu" bisa nyangkut di kata
// tak terkait yang juga diawali "cu" (mis. "CUB"/"CURRENT"), jadi ikut
// memunculkan barang yang salah klasifikasi. Kata yang lebih panjang (>=3
// huruf) tetap dicocokkan sebagai prefix supaya bisa diketik sebagian
// ("trans" -> "transformator", "550" -> "550mm2").
// Untuk pencarian server-side (Supabase `.ilike`, mis. cari referensi MARA) yang
// tidak bisa memakai expandHaystackSynonyms/queryTokenGroups di sisi klien
// (haystack-nya ada di database, bukan di memori). Cari padanan tiap kata yang
// diketik lewat QUERY_SYNONYMS (1:1) DAN CATEGORY_SYNONYMS (reverse lookup: kalau
// kata yang diketik ada di deskripsi suatu kategori, ikutkan singkatannya juga —
// mis. "pemutus" -> ikut cari "cb"). Dibatasi 6 istilah biar query `.or()` tidak
// terlalu panjang.
export function expandQueryForIlikeSearch(query) {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  const terms = new Set([query.trim()]);
  words.forEach(w => {
    if (QUERY_SYNONYMS[w]) QUERY_SYNONYMS[w].split(" ").forEach(s => terms.add(s));
    Object.entries(CATEGORY_SYNONYMS).forEach(([abbr, desc]) => {
      if (desc.split(" ").includes(w)) terms.add(abbr);
    });
  });
  return Array.from(terms).filter(Boolean).slice(0, 6);
}

export function matchesMaterialSearch(fields, query) {
  if (!query || !query.trim()) return true;
  const haystackWords = expandHaystackSynonyms(normalizeSearchText(
    fields.filter(Boolean).join(" ")
  )).split(" ").filter(Boolean);
  const groups = queryTokenGroups(query);
  return groups.every(alts => alts.some(t => haystackWords.some(w => (t.length <= 2 ? w === t : w.startsWith(t)))));
}

export function matchesStockSearch(stock, query) {
  return matchesMaterialSearch([
    stock.name, stock.id, stock.katalog, stock.lokasi, stock.blok, stock.gudang,
    stock.merk, stock.category, stock.keteranganBarang, stock.lokasiKeterangan,
  ], query);
}

// Master Katalog Barang: sama persis mesinnya dengan Data Stok (matchesStockSearch),
// dipakai untuk kotak pencarian yang sebelumnya tidak ada sama sekali di halaman ini.
export function matchesKatalogSearch(k, query) {
  return matchesMaterialSearch([k.name, k.katalog, k.id, k.category, k.jenisBarang, k.keterangan], query);
}

// Total quantity of a catalog item across ALL locations (used for forecast /
// dashboard totals where "this item" should mean the sum, not one location).
export function totalQtyForKatalog(katalogId, stocks) {
  return (stocks||[]).filter(s => s.katalogId === katalogId).reduce((a,s)=>a+(s.qty||0), 0);
}

// How much capacity is used at a given location (sum of qty of all stock rows there)
export function lokasiUsedCapacity(lokasiId, stocks) {
  return (stocks||[]).filter(s => s.lokasiId === lokasiId).reduce((a,s)=>a+(s.qty||0), 0);
}

// Badge color scheme for the 3 TUG-10 return statuses
export function statusMaterialBadgeStyle(status) {
  if (status === "Bongkaran ATTB (MTU)") return { bg:"#fef3c7", fg:"#92400e" };
  if (status === "Bongkaran") return { bg:"#fef9c3", fg:"#854d0e" };
  return { bg:"#dcfce7", fg:"#166534" }; // Material Sisa Baru
}

// ─── SAP STATUS DETECTION ────────────────────────────────────────────────
// Detects SAP/Non-SAP automatically from katalog number format:
//   10-digit pure number → SAP (Cadang)
//   7-digit pure number  → SAP (Persediaan / Pre Memory terdaftar SAP)
//   anything else        → Non-SAP
export function getSAPStatus(katalog) {
  if (!katalog || katalog.trim() === "") return "Non-SAP";
  const k = katalog.trim();
  if (/^\d{10}$/.test(k)) return "SAP";
  if (/^\d{7,8}$/.test(k)) return "SAP";
  return "Non-SAP";
}

// getSAPLabel pindah ke src/lib/ragShared.mjs (dipakai bersama nightly_sync.mjs).
export function getSAPBadgeStyle(katalog) {
  return getSAPStatus(katalog) === "SAP"
    ? { bg:"#dbeafe", fg:"#1d4ed8" }
    : { bg:"#f3f4f6", fg:"#6b7280" };
}

// Accent color per Jenis Barang, used on the printable QR label
export function jenisBarangAccentColor(jenisBarang) {
  const map = {
    "Persediaan": "#16a34a",
    "Persediaan Bursa": "#ea580c",
    "Cadang": "#dc2626",
    "Pre Memory": "#1d4ed8",
    "ATTB": "#d97706",
    "Non-Stock": "#be185d",
    "Bongkaran": "#6b7280",
  };
  return map[jenisBarang] || "#9ca3af";
}

// Builds the Kartu Gantung Digital (TUG-2) history for one Master Katalog item,
// pulling from every APPROVED transaction across all locations that touched it.
// Each row carries a running balance (sisa) computed in chronological order.
//
// Resolution notes:
// - TUG9/TUG8 items store stockId (a Data Stok row); we resolve katalogId via `stocks`.
// - TUG10/TUG3 items reference katalogId directly when katalogMode==="existing".
//   For katalogMode==="new" items, the transaction itself doesn't retain the
//   auto-created katalogId, so we match by name against the current katalogList entry instead.
export function buildKartuGantungHistory(katalog, txns, stocks, lokasiList) {
  const katalogId = katalog.id;
  const events = [];
  (txns||[]).forEach(t => {
    if (t.status !== "APPROVED" && !(t.docType==="TUG3" && t.stage==="APPROVED")) return;
    if (t.docType === "TUG9" || t.docType === "TUG8") {
      t.stockItems.forEach(si => {
        const stockRow = (stocks||[]).find(s=>s.id===si.stockId);
        if (stockRow && stockRow.katalogId === katalogId) {
          const lok = (lokasiList||[]).find(l=>l.id===stockRow.lokasiId);
          events.push({ tgl: t.approvedAt||t.createdAt, noBon: t.docNumbers?.[t.docType==="TUG9"?"tug9":"tug8"], masuk:0, keluar:si.qty, lokasi: lok?.kode||"-", catatan: t.namaPekerjaan||"-" });
        }
      });
    } else if (t.docType === "TUG10") {
      t.stockItems.forEach(si => {
        const isMatch = si.katalogMode==="existing" ? si.katalogId===katalogId : si.namaBaru===katalog.name;
        if (isMatch) {
          const lok = (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId);
          events.push({ tgl: t.approvedAt||t.createdAt, noBon: t.docNumbers?.tug10, masuk:si.qty, keluar:0, lokasi: lok?.kode||"-", catatan: t.namaPekerjaan||"-" });
        }
      });
    } else if (t.docType === "TUG3" && t.stage === "APPROVED") {
      t.stockItems.forEach(si => {
        const isMatch = si.katalogMode==="existing" ? si.katalogId===katalogId : si.namaBaru===katalog.name;
        if (isMatch) {
          const lok = (lokasiList||[]).find(l=>l.id===si.lokasiTujuanId);
          events.push({ tgl: t.approvedAtAsman||t.createdAt, noBon: t.docNumbers?.tug3, masuk:si.qty, keluar:0, lokasi: lok?.kode||"-", catatan: `Penerimaan dari ${t.dariSupplier||"-"}` });
        }
      });
    }
  });
  events.sort((a,b)=>(a.tgl||0)-(b.tgl||0));
  // Hitung Sisa MUNDUR dari qty stok nyata saat ini (ground truth dari Data Stok),
  // bukan maju dari 0 — supaya baris terbaru selalu pas dengan qty sebenarnya,
  // walau ada stok awal yang tidak tercatat lewat transaksi TUG.
  const currentQty = (stocks||[]).filter(s=>s.katalogId===katalogId).reduce((a,s)=>a+(s.qty||0),0);
  const withSisa = new Array(events.length);
  let running = currentQty;
  for (let i = events.length-1; i >= 0; i--) {
    withSisa[i] = { ...events[i], sisa: running };
    running -= (events[i].masuk - events[i].keluar);
  }
  return withSisa;
}

// Normalisasi nomor katalog (buang zero-padding) untuk pencocokan — dipindah dari App.jsx Fase 5c.
export function normalizeKatalog(k) { return String(k||"").trim().replace(/^0+/, "") || ""; }

// QR di label Kartu Gantung TUG-2 (lihat KartuGantungModal "Label QR Print") berisi URL lengkap
// "?scan=<katalogId>", bukan sekadar nomor katalog. Ekstrak katalogId-nya supaya scan QR fisik di
// rak langsung match ke material yang benar, baik via URL utuh maupun fallback regex kalau kamera
// cuma menangkap sebagian teks. Top-level (bukan nested di komponen App) supaya dipakai ulang di
// komponen anak juga (mis. StockOpnameTab), bukan cuma di handleScanResult.
export function extractKatalogIdFromScan(code) {
  try { const u = new URL(code); const id = u.searchParams.get("scan"); if (id) return id; } catch {}
  const m = code.match(/[?&]scan=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
