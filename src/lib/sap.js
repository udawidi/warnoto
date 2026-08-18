// SAP status detection + Pencarian Material (sinonim-aware PLN) — dipindah dari
// App.jsx (refactor Fase 3c). Pure string/data ops, tanpa React/state/supabase.
// CATEGORY_SYNONYMS/QUERY_SYNONYMS dipakai internal oleh mesin pencarian.
import { subGudangKodeMap } from "./masterSync.js";
import { getSAPLabel, resolveSapLabel as resolveSapLabelShared, rowSapLabel } from "./ragShared.mjs";

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
// Pencarian MARA per-kata untuk Supabase `.ilike` (menggantikan expandQueryForIlikeSearch
// yang lama menaruh seluruh FRASA sebagai satu ilike → menuntut substring kontigu sesuai
// urutan/format). Tiap KATA yang diketik jadi grup alternatif: kata itu sendiri + sinonim
// 1:1 (QUERY_SYNONYMS) + singkatan kategori reverse (CATEGORY_SYNONYMS, mis. "pemutus"->"cb").
// AND antar kata, OR dalam grup → order/format-independent, bisa cari per-kata material.
export function maraQueryGroups(query) {
  return normalizeSearchText(query).split(" ").filter(Boolean).map(w => {
    const alts = new Set([w]);
    if (QUERY_SYNONYMS[w]) QUERY_SYNONYMS[w].split(" ").forEach(s => alts.add(s));
    Object.entries(CATEGORY_SYNONYMS).forEach(([abbr, desc]) => {
      if (desc.split(" ").includes(w)) alts.add(abbr);
    });
    return Array.from(alts);
  });
}

// Terapkan maraQueryGroups ke query builder Supabase pada kolom `nama`. Tiap grup jadi
// satu `.or(...)`; beberapa `.or()` yang dirantai di-AND-kan oleh PostgREST → AND-of-OR.
// ponytail: ilike %x% seq-scan (tak ada index trigram); cukup utk interaktif limit kecil,
// upgrade ke pg_trgm/tsvector kalau mara_catalog membesar signifikan.
export function applyMaraNameSearch(builder, query) {
  return maraQueryGroups(query).reduce(
    (b, alts) => b.or(alts.map(t => `nama.ilike.%${t}%`).join(",")),
    builder
  );
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
  const k = katalog.trim().replace(/^0+/, "");
  if (/^\d{10}$/.test(k)) return "SAP";
  if (/^\d{7,8}$/.test(k)) return "SAP";
  return "Non-SAP";
}

// Override eksplisit menang; "SAP" tetap pakai turunan Persediaan/Cadang, fallback generic bila kode non-numerik.
// STATUS_SAP[0]/[1] ("SAP — Persediaan"/"SAP — Cadang") = user memaksa label spesifik secara
// eksplisit (mis. dari form Edit), lolos apa pun format kode katalognya. "Non-SAP" dan "SAP"
// lama TIDAK diubah perilakunya — data hasil import lama memakai keduanya.
export function resolveSapLabel(code, override) { return resolveSapLabelShared(code, override); }
export function katalogSapLabel(k) { return resolveSapLabel(k?.katalog, k?.sapStatus); }
export function katalogSapStatus(k) {
  if (k?.sapStatus === "Non-SAP") return "Non-SAP";
  // Nilai apa pun yang diawali "SAP" ("SAP", "SAP — Persediaan", "SAP — Cadang") = status SAP.
  if (String(k?.sapStatus || "").startsWith("SAP")) return "SAP";
  return getSAPStatus(k?.katalog);
}

// getSAPLabel pindah ke src/lib/ragShared.mjs (dipakai bersama nightly_sync.mjs).
// Badge 3-warna berdasar LABEL (SAP — Persediaan / SAP — Cadang / Non-SAP),
// bukan cuma SAP vs Non-SAP. Dipakai kolom Status Data Stok agar 3 status
// terbedakan warnanya; material Non-SAP (input manual) dipaksa lewat label.
export function sapBadgeStyleForLabel(label) {
  const l = String(label || "");
  if (l.includes("Cadang")) return { bg:"#fee2e2", fg:"#b91c1c" };
  if (l.includes("Persediaan")) return { bg:"#dbeafe", fg:"#1d4ed8" };
  return { bg:"#f3f4f6", fg:"#6b7280" }; // Non-SAP
}
export function getSAPBadgeStyle(katalog) {
  return sapBadgeStyleForLabel(getSAPLabel(katalog));
}

// Label status SAP untuk sebuah Data Stok. Override manual (sapStatus terisi, mis. user
// memilih dari form Edit) SELALU menang. Kalau kosong, baru berlaku heuristik lama: material
// non-stock yg baru diupload (id STK-PREMEM-*) = Non-SAP (kandidat masuk SAP, belum terdaftar).
// Perubahan urutan ini DISENGAJA (2026-08-11, keputusan arsitek) — bukan regresi.
export function stockSapLabel(stock) { return rowSapLabel(stock); }

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
export function buildKartuGantungHistory(katalog, txns, stocks, lokasiList, subGudangList, gudangList) {
  const katalogId = katalog.id;
  // Sub Gudang (LOKASI) untuk sebuah lokasi record: kode singkatan 3-huruf subGudangKodeMap
  // (kolom LOKASI tabel Riwayat sempit, nama Sub Gudang penuh terlalu lebar) kalau ada
  // subGudangId, fallback ke nama gudangList lewat gudangId, fallback "-".
  const resolveSubGudang = (lok) => {
    if (!lok) return "-";
    if (lok.subGudangId) {
      const subsOfGudang = (subGudangList||[]).filter(sg=>sg.gudangId===lok.gudangId);
      return subGudangKodeMap(subsOfGudang)[lok.subGudangId] || "-";
    }
    if (lok.gudangId) return (gudangList||[]).find(g=>g.id===lok.gudangId)?.nama || "-";
    return "-";
  };
  const events = [];
  (txns||[]).forEach(t => {
    if (t.status !== "APPROVED" && !(t.docType==="TUG3" && t.stage==="APPROVED")) return;
    if (t.docType === "TUG9" || t.docType === "TUG8") {
      t.stockItems.forEach(si => {
        const stockRow = (stocks||[]).find(s=>s.id===si.stockId);
        if (stockRow && stockRow.katalogId === katalogId) {
          const lok = (lokasiList||[]).find(l=>l.id===stockRow.lokasiId);
          events.push({ docType: t.docType, tgl: t.approvedAt||t.createdAt, noBon: t.docNumbers?.[t.docType==="TUG9"?"tug9":"tug8"], masuk:0, keluar:si.qty, rak: lok?.kode||"-", subGudang: resolveSubGudang(lok), catatan: t.namaPekerjaan||"-" });
        }
      });
    } else if (t.docType === "TUG10") {
      t.stockItems.forEach(si => {
        const isMatch = si.katalogMode==="existing" ? si.katalogId===katalogId : si.namaBaru===katalog.name;
        if (isMatch) {
          const lok = (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId);
          events.push({ docType: "TUG10", tgl: t.approvedAt||t.createdAt, noBon: t.docNumbers?.tug10, masuk:si.qty, keluar:0, rak: lok?.kode||"-", subGudang: resolveSubGudang(lok), catatan: t.namaPekerjaan||"-" });
        }
      });
    } else if (t.docType === "TUG3" && t.stage === "APPROVED") {
      t.stockItems.forEach(si => {
        const isMatch = si.katalogMode==="existing" ? si.katalogId===katalogId : si.namaBaru===katalog.name;
        if (isMatch) {
          const lok = (lokasiList||[]).find(l=>l.id===si.lokasiTujuanId);
          events.push({ docType: "TUG3", tgl: t.approvedAtAsman||t.createdAt, noBon: t.docNumbers?.tug3, masuk:si.qty, keluar:0, rak: lok?.kode||"-", subGudang: resolveSubGudang(lok), catatan: `Penerimaan dari ${t.dariSupplier||"-"}` });
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
  // Baris baseline "Migrasi Data" — belum ada arsip lama yang diimpor, jadi saldo awal
  // (running setelah loop mundur = saldo sebelum event tertua) diisi sebagai satu baris
  // keterangan migrasi, bukan detail transaksi nyata. RAK/LOKASI diisi dari lokasi stok
  // material ini saat ini di Data Stok (representatif, sama pola dengan field single-value
  // lain seperti foto/kategori di KartuGantungModal).
  const baselineStock = (stocks||[]).find(s=>s.katalogId===katalogId);
  const baselineLok = baselineStock ? (lokasiList||[]).find(l=>l.id===baselineStock.lokasiId) : null;
  const baselineRow = { tgl: null, noBon: "-", masuk: 0, keluar: 0, rak: baselineLok?.kode||"-", subGudang: resolveSubGudang(baselineLok), catatan: "Migrasi Data", sisa: running };
  return [baselineRow, ...withSisa];
}

// "Lokasi :" ringkas di header Kartu Gantung TUG.2 (Depan & Belakang) — gabungan Gudang +
// Sub Gudang + Blok Gudang per lokasi unik stok katalog ini, dipisah bullet, level kosong
// diskip. Beberapa kombinasi lokasi unik digabung dengan ", ". Dipakai di JSX preview
// (KartuGantungModal) & HTML print (docBuilders buildTUG2FrontHTML/BackHTML).
export function resolveLokasiLengkap(katalog, stocks, lokasiList, subGudangList, gudangList) {
  const katalogId = katalog.id;
  const lokasiIds = [...new Set((stocks||[]).filter(s=>s.katalogId===katalogId).map(s=>s.lokasiId))];
  const combos = lokasiIds.map(lid => {
    const lok = (lokasiList||[]).find(l=>l.id===lid);
    if (!lok) return null;
    const gudangNama = (gudangList||[]).find(g=>g.id===lok.gudangId)?.nama;
    const subGudangNama = lok.subGudangId ? (subGudangList||[]).find(sg=>sg.id===lok.subGudangId)?.nama : null;
    return [gudangNama, subGudangNama, lok.kode].filter(Boolean).join(" • ");
  }).filter(Boolean);
  return [...new Set(combos)].join(", ") || "-";
}

// Normalisasi nomor katalog (buang zero-padding) untuk pencocokan — dipindah dari App.jsx Fase 5c.
export function normalizeKatalog(k) { return String(k||"").trim().replace(/^0+/, "") || ""; }

// Fase 1c Stock Opname: qtsFisik jadi TURUNAN dari hitungPerLokasi ({ [lokasiId|"_TANPA_LOKASI"]:
// {qty,at,by} }) — dipakai StockOpnameTab (edit qty) & useStockOpname (approve/merge) supaya
// definisi "jumlah total" satu tempat saja, tidak dobel logic penjumlahan.
export function sumHitungPerLokasi(hitungPerLokasi) {
  return Object.values(hitungPerLokasi || {}).reduce((a, e) => a + (Number(e?.qty) || 0), 0);
}

// Tulis qty hasil hitung fisik ke SATU blok (lokasiKey) sebuah item opname, lalu turunkan ulang
// qtsFisik/selisih/statusItem/recount — dipakai StockOpnameTab (edit tabel desktop, kunci dari
// itemLokasiKey) DAN OpnameLapanganView (mode HP, kunci dari blok yang lagi aktif) supaya logic
// "apa artinya selisih & kapan wajib hitung ulang" satu tempat saja, tidak dobel/berisiko drift.
// Item "Material Baru" (belum ada di sistem) sengaja TIDAK dihitung selisih/recount (sama seperti
// sebelumnya) — statusnya tetap MATERIAL_BARU_*.
export function applyQtyToItem(item, lokasiKey, qty, userId, { markRecount = false } = {}) {
  const isMaterialBaru = ["TIDAK_ADA_DI_SISTEM", "MATERIAL_BARU_NONSAP"].includes(item.statusItem);
  const hitungPerLokasi = { ...(item.hitungPerLokasi || {}), [lokasiKey]: { qty: Number(qty) || 0, at: Date.now(), by: userId } };
  const qtsFisik = sumHitungPerLokasi(hitungPerLokasi);
  const next = { ...item, hitungPerLokasi, qtsFisik };
  if (!isMaterialBaru) {
    next.selisih = qtsFisik - (item.qtySistem || 0);
    next.statusItem = next.selisih === 0 ? "SESUAI" : "SELISIH";
    // Fase 2e: selisih -> wajib hitung ulang, TAPI cuma untuk jalur lapangan (markRecount=true,
    // OpnameLapanganView) yang memang menyediakan layar konfirmasi kedua. Edit desktop biasa
    // (markRecount default false) tak boleh menandai/menimpa recount — kalau tak markRecount,
    // biarkan next.recount apa adanya (jangan disentuh sama sekali, termasuk tak dihapus jadi null).
    if (markRecount) next.recount = next.selisih !== 0 ? { perluUlang: true, qtyUlang: null, at: null, by: null, key: lokasiKey } : null;
  }
  return next;
}

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

// QR di label blok gudang (lihat lokasiScanUrlFor, Fase 2 Stock Opname) berisi URL lengkap
// "?loc=<lokasiId>" — sejajar extractKatalogIdFromScan di atas.
export function extractLokasiIdFromScan(code) {
  try { const u = new URL(code); const id = u.searchParams.get("loc"); if (id) return id; } catch {}
  const m = code.match(/[?&]loc=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
