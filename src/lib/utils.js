// Utilities murni WARNOTO (formatters, doc number, SAP parser, enrichment,
// migration) — dipindah dari App.jsx (refactor Fase 3a). Tidak ada React/state.
import * as XLSX from "xlsx";
import { fmtNum } from "./ragShared.mjs";
import { ROMAN } from "../constants.js";

// ─── DOC NUMBER GENERATOR ─────────────────────────────────────────────
export function generateDocNumbers(seq, date, docCode) {
  const d = new Date(date);
  const roman = ROMAN[d.getMonth()];
  const year = d.getFullYear();
  const code = docCode || "LOG.00.02";
  const base = `${code}/UPT-SBYA/${roman}/${year}`;
  const baseUIT = `LOG/UIT-JBM/${roman}/${year}`;
  return {
    sj: `${seq}.SJ/${base}`,
    tug9: `${seq}.TUG-9/${base}`,
    tug8: `${seq}.TUG-8/${base}`,
    tug3: `${seq}.TUG-3/${base}`,
    tug4: `${seq}.TUG-4/${base}`,
    tug10: `${seq}.TUG-10/${base}`,
    tug5: `${seq}.TUG-5/LOG-UPT-SBYA/${roman}/${year}`, // format: 13.TUG-5/LOG-UPT-SBYA/VI/2026
    tug7: `${String(seq).padStart(3,"0")}.TUG7/${baseUIT}`, // format: 001.TUG7/LOG/UIT-JBM/VI/2026
  };
}

// ─── UTILITIES ───────────────────────────────────────────────────────
export function uid() { return "PLN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(); }

export function fmtDate(ts) { if (!ts) return "-"; return new Date(ts).toLocaleDateString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); }

export function fmtDateOnly(ts) { if (!ts) return "-"; return new Date(ts).toLocaleDateString("id-ID", { day:"2-digit", month:"long", year:"numeric" }); }

export function fmtRp(n) { return "Rp " + fmtNum(n); }

// ── Statistik Stok: saldo per jenis barang & persentase SAP vs Non-SAP ──
// Dipakai sebagai konteks tambahan untuk AI chat/forecast supaya bisa
// menjawab pertanyaan detail seperti "berapa saldo cadang", "berapa
// persentase material SAP" dll tanpa AI harus menghitung ulang dari mentah.
export function buildStockStats(stocks) {
  const byJenis = {};
  let sapCount = 0, sapValue = 0, nonSapCount = 0, nonSapValue = 0;
  stocks.forEach(s => {
    const jenis = s.jenisBarang || "Tidak Terklasifikasi";
    if (!byJenis[jenis]) byJenis[jenis] = { count: 0, qty: 0, value: 0 };
    byJenis[jenis].count += 1;
    byJenis[jenis].qty += s.qty || 0;
    byJenis[jenis].value += (s.qty || 0) * (s.price || 0);

    const isSap = String(s.id || "").startsWith("STK-SAP-");
    if (isSap) { sapCount += 1; sapValue += (s.qty || 0) * (s.price || 0); }
    else { nonSapCount += 1; nonSapValue += (s.qty || 0) * (s.price || 0); }
  });
  const totalCount = stocks.length || 1;
  const totalValue = sapValue + nonSapValue;
  return {
    byJenis,
    sap: { count: sapCount, value: sapValue, pctCount: (sapCount/totalCount*100).toFixed(1), pctValue: totalValue?(sapValue/totalValue*100).toFixed(1):"0.0" },
    nonSap: { count: nonSapCount, value: nonSapValue, pctCount: (nonSapCount/totalCount*100).toFixed(1), pctValue: totalValue?(nonSapValue/totalValue*100).toFixed(1):"0.0" },
  };
}

// Format ringkasan statistik stok jadi teks siap-pakai untuk system prompt AI.
export function formatStockStatsText(stocks) {
  const stats = buildStockStats(stocks);
  const jenisLines = Object.entries(stats.byJenis)
    .map(([jenis, d]) => `- ${jenis}: ${d.count} item | Saldo Qty: ${fmtNum(d.qty)} | Nilai: ${fmtRp(Math.round(d.value))}`)
    .join("\n");
  return `SALDO PER JENIS BARANG:
${jenisLines}

KOMPOSISI SAP vs NON-SAP:
- Material SAP (kode STK-SAP-...): ${stats.sap.count} item (${stats.sap.pctCount}% dari jumlah item, ${stats.sap.pctValue}% dari total nilai) | Nilai: ${fmtRp(Math.round(stats.sap.value))}
- Material Non-SAP (input manual): ${stats.nonSap.count} item (${stats.nonSap.pctCount}% dari jumlah item, ${stats.nonSap.pctValue}% dari total nilai) | Nilai: ${fmtRp(Math.round(stats.nonSap.value))}`;
}

// ── SAP File Parser (CSV + XLSX, handle BOM) ─────────────────────────────
export function parseSAPRowsFromCSV(text) {
  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, "").replace(/^\xEF\xBB\xBF/, "");
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header - handle quoted fields
  function splitCSVLine(line) {
    const result = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || "").trim(); });
    return mapSAPRow(obj);
  }).filter(r => r.katalog);
}

// Baca SEMUA sheet berformat SAP — bukan cuma sheet pertama saja (dulu cuma
// wb.Sheets[wb.SheetNames[0]]). Laporan SAP kadang diekspor multi-sheet (mis. per bulan/per
// gudang) — kalau ada 2 sheet, baca 2; kalau 3, baca 3, dst.
//
// PERBAIKAN 2026-07-07: percobaan pertama mencocokkan header PERSIS SELURUH kolom (exact set
// match) antar sheet — ternyata terlalu ketat untuk file nyata (user lapor upload 2 sheet tapi
// hasil cuma kebaca 1 sheet/151 item): kolom tambahan/beda dikit di 1 sheet (mis. kolom kosong
// tambahan yang ke-baca sebagai "__EMPTY" oleh sheet_to_json, atau urutan ekspor SAP yang sedikit
// beda per sheet) bikin exact-match gagal dan sheet itu di-skip diam-diam. Diperlonggar: sheet ikut
// dibaca asalkan punya kolom "Material" (kolom WAJIB — tanpa ini baris otomatis tidak valid lewat
// mapSAPRow di bawah juga), TIDAK PEDULI ada kolom tambahan/beda apa pun selain itu. Sheet yang
// sama sekali bukan format SAP (mis. sheet "Ringkasan"/catatan tanpa kolom Material) otomatis tetap
// terlewati karena tidak punya kolom itu.
// Baca file "USULAN_PENCOCOKAN_MARA..." (hasil kerja review MARA yang disiapkan di luar
// aplikasi, lihat outputs/warnoto-nonstock-review/) — dipakai sebagai starting point antrian
// "Tambah Material Ditemukan" di Opname Non-SAP, BUKAN jalur upload-langsung-masuk-sistem.
// Qty di file ini SENGAJA tidak dipercaya mentah-mentah — tetap wajib dihitung fisik ulang
// saat direview satu per satu di opname (lihat submitTambahMaterial), file cuma isi kandidat
// nama + kode MARA supaya Admin tidak perlu ketik/cari ulang dari nol.
export function parseUsulanPencocokanXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes("usulan") || n.toLowerCase().includes("pencocokan")) || wb.SheetNames.find(n => n.toLowerCase() !== "readme") || wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  return raw.map((r, i) => {
    const nama = String(r["Nama Material"] || "").trim();
    if (!nama) return null;
    const kandidatStr = String(r["Kandidat MARA (top 3)"] || "");
    // PENTING: pisahkan antar-kandidat pakai "; " (titik-koma + SPASI), BUKAN ";" polos —
    // nama MARA sendiri sering mengandung ";" tanpa spasi (mis. "CUB ACC;HEAT SHRINK TUBE"),
    // kalau split(";") mentah nama itu ikut kepotong jadi cuma "CUB ACC" (bug ditemukan &
    // diperbaiki 2026-07-08 setelah tes langsung ke file asli).
    const firstCandidate = kandidatStr.split("; ")[0] || "";
    const m = firstCandidate.match(/^\s*(\S+)\s*\|\s*([^(]+)/);
    const skor = String(r["Skor vs MARA"] || "").trim().toUpperCase();
    return {
      id: `Q-${i}-${nama.slice(0, 10)}`,
      nama,
      satuanFile: String(r["Satuan"] || "").trim(),
      katalogAsli: String(r["Katalog Asli (AppSheet)"] || "").trim(),
      qtyFile: r["Qty (Jumlah Stok)"] ?? "",
      skor: skor || "TIDAK_ADA_KANDIDAT",
      maraCode: (skor === "KUAT" || skor === "LEMAH") && m ? m[1].trim() : null,
      maraNama: (skor === "KUAT" || skor === "LEMAH") && m ? m[2].trim() : null,
      status: "PENDING", // "PENDING" | "DONE" | "SKIP"
    };
  }).filter(Boolean);
}

export function parseSAPRowsFromXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  let allRaw = [];
  wb.SheetNames.forEach(sheetName => {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
    if (raw.length === 0) return;
    const hasKolomMaterial = Object.keys(raw[0]).some(k => k.trim() === "Material");
    if (hasKolomMaterial) allRaw = allRaw.concat(raw);
  });
  return allRaw.map(obj => mapSAPRow(obj)).filter(r => r && r.katalog);
}

// Parser angka tunggal untuk SEMUA import file (SAP Opname/Stock Count, Migrasi Data, Kapasitas
// Gudang, Material Cadang) — sengaja SATU fungsi dipakai di mana-mana, bukan regex ad-hoc beda-beda
// per tempat (dulu qty & harga di mapSAPRow saja sudah pakai 2 logika beda: qty cuma
// replace(",",".") polos, TIDAK menangani titik-ribuan; harga sudah ada heuristik tapi cuma di
// situ). Inkonsistensi itu sumber bug qty "103,5 meter" kebaca jadi "1.035" yang dilaporkan user
// 2026-07-07 — SANGAT BERBAHAYA karena mendistorsi qty stok besar-besaran kalau salah baca.
//
// Aturan — SENGAJA TIDAK PERNAH MENEBAK kalau ambigu (revisi 2026-07-07: percobaan pertama pakai
// heuristik "titik tunggal + 3 digit di belakang = ribuan", ternyata berisiko salah tebak untuk
// qty/luas fisik yang presisi desimalnya bebas, mis. "103.500" meter bisa dimaksud 103,5 ATAU
// 103500 tergantung sumbernya — tidak ada cara pasti tanpa konteks. Aturan baru cuma menganggap
// titik = ribuan kalau BENAR-BENAR TIDAK AMBIGU, yaitu titik lebih dari 1 kali ATAU koma juga ada):
//   - Ada titik DAN koma  -> format Indonesia penuh: "1.234.567,89" -> 1234567.89
//   - Cuma koma           -> koma = desimal: "103,5" -> 103.5
//   - Titik lebih dari 1x -> pasti ribuan (satu angka tidak mungkin 2 titik desimal): "1.234.567" -> 1234567
//   - Cuma 1 titik, tanpa koma -> SELALU dianggap desimal, tidak pernah ditebak ribuan: "103.5" -> 103.5
//   - Tidak ada titik/koma -> angka polos: "1035" -> 1035
export function parseIndoNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.,-]/g, "");
  if (!cleaned) return 0;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) return parseFloat(cleaned.replace(/\./g, "").replace(",", ".")) || 0;
  if (hasComma) return parseFloat(cleaned.replace(",", ".")) || 0;
  if (hasDot) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) return parseInt(cleaned.replace(/\./g, ""), 10) || 0;
    return parseFloat(cleaned) || 0;
  }
  return parseFloat(cleaned) || 0;
}

export function mapSAPRow(obj) {
  // Normalize key lookup - try exact then trimmed
  const get = (key) => (obj[key] ?? obj[key.trim()] ?? "").toString().trim();

  const materialRaw = get("Material");
  const katalog = materialRaw.replace(/^0+/, "");
  if (!katalog) return null;

  // Qty & harga SEKARANG pakai 1 fungsi parser yang sama (parseIndoNumber) — dulu qty cuma
  // replace(",",".") polos (TIDAK menangani titik-ribuan sama sekali), sedangkan harga sudah
  // punya heuristik titik-ribuan vs desimal. Inkonsistensi ini sumber bug qty "103,5 meter"
  // kebaca "1.035" yang dilaporkan user 2026-07-07 — SANGAT BERBAHAYA karena mendistorsi qty
  // stok. Lihat definisi parseIndoNumber untuk aturan lengkapnya.
  const qty = parseIndoNumber(get("Unrestricted Use Stock"));
  const harga = Math.round(parseIndoNumber(get("Harga Satuan")));

  const valType = get("Valuation Type").toUpperCase();
  const digitCount = katalog.length;

  let jenisBarang;
  if (digitCount === 10) {
    jenisBarang = "Cadang";
  } else {
    if (valType === "PRE-MEMORY") jenisBarang = "Pre Memory";
    else if (valType === "BURSA") jenisBarang = "Persediaan Bursa";
    else jenisBarang = "Persediaan";
  }

  return {
    katalog,
    nama: get("Material Description"),
    satuan: get("Base Unit of Measure") || "U",
    qty,
    harga,
    jenisBarang,
    valuationType: valType,
    valuationDesc: get("Valuation Description"),
  };
}

export async function parseSAPFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const rows = parseSAPRowsFromXLSX(ev.target.result);
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.onerror = () => reject(new Error("Gagal membaca file XLSX"));
      reader.readAsArrayBuffer(file);
    } else {
      // CSV — try utf-8 first, handle BOM
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const rows = parseSAPRowsFromCSV(ev.target.result);
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.onerror = () => reject(new Error("Gagal membaca file CSV"));
      reader.readAsText(file, "utf-8");
    }
  });
}

export function terbilangHari(ts) {
  const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  return days[new Date(ts).getDay()];
}

// ─── ENRICHMENT: join Data Stok rows with Master Katalog + Master Lokasi ─
// Returns a "flat" view shaped like the old combined stock record, so the
// rest of the UI (cards, forms, PDF builder, forecast, etc.) can keep using
// familiar fields (name, katalog, category, unit, lokasi) without needing
// to know about the master-data split under the hood.
export function enrichStock(stock, katalogList, lokasiList) {
  const kat = (katalogList||[]).find(k => k.id === stock.katalogId) || {};
  const lok = (lokasiList||[]).find(l => l.id === stock.lokasiId) || {};
  return {
    ...stock,
    name: kat.name || stock.name || "(Katalog tidak ditemukan)",
    katalog: kat.katalog || stock.katalog || "-",
    category: kat.category || "Lainnya",
    keteranganBarang: kat.keterangan || stock.keteranganBarang || "",
    unit: kat.satuan || stock.unit || "unit",
    lokasi: lok.kode || stock.lokasi || "-",
    lokasiKeterangan: lok.keterangan || "",
    // jenisBarang: Master Katalog adalah sumber kebenaran.
    // Jika katalog tidak ditemukan, fallback ke nilai di Data Stok.
    jenisBarang: kat.jenisBarang || stock.jenisBarang || "Cadang",
  };
}

export function enrichStocks(stocks, katalogList, lokasiList) {
  return (stocks||[]).map(s => enrichStock(s, katalogList, lokasiList));
}

// Buang entri dengan `id` ganda (simpan kemunculan PERTAMA saja). Dipakai saat
// memuat data dari storage — data lama yang sudah tersimpan di localStorage
// user (sebelum bug id ganda di seed data diperbaiki) tidak ikut diperbaiki
// oleh perubahan source code, karena begitu ada data tersimpan, app selalu
// memuat dari storage, bukan dari DEFAULT_* lagi. Jadi pembersihan id ganda
// harus dilakukan saat load, bukan cuma di seed.
export function dedupeById(arr) {
  const seen = new Set();
  const list = [];
  let removed = 0;
  for (const item of (arr || [])) {
    if (item && item.id != null) {
      if (seen.has(item.id)) { removed++; continue; }
      seen.add(item.id);
    }
    list.push(item);
  }
  return { list, removed };
}

// ─── MIGRATION: convert legacy flat-stock records (pre-master-data) ───
// into the new {katalog, lokasi, stock} structure. Safe to run on data
// that's already in the new shape (returns it unchanged via a marker).
export function migrateLegacyStocks(rawStocks) {
  if (!rawStocks || rawStocks.length === 0) return null;
  // New-shape rows have katalogId/lokasiId; legacy rows have name/katalog/lokasi directly.
  const isLegacy = rawStocks.some(s => s.katalogId === undefined && s.name !== undefined);
  if (!isLegacy) return null; // already migrated / not applicable

  const katalogMap = new Map(); // name+katalog -> katalogId
  const lokasiMap = new Map();  // lokasi string -> lokasiId
  const katalog = [];
  const lokasi = [];
  const stocks = [];

  rawStocks.forEach((s, idx) => {
    const katKey = `${s.katalog}|${s.name}`;
    let katalogId = katalogMap.get(katKey);
    if (!katalogId) {
      katalogId = `KAT-${String(katalog.length+1).padStart(3,"0")}`;
      katalogMap.set(katKey, katalogId);
      katalog.push({ id:katalogId, katalog:s.katalog||"", name:s.name, category:s.category||"Lainnya", satuan:s.unit||"unit", createdAt:s.createdAt||Date.now() });
    }
    const lokKey = s.lokasi || "Belum Ditentukan";
    let lokasiId = lokasiMap.get(lokKey);
    if (!lokasiId) {
      lokasiId = `LOK-${String(lokasi.length+1).padStart(3,"0")}`;
      lokasiMap.set(lokKey, lokasiId);
      lokasi.push({ id:lokasiId, kode:lokKey, keterangan:"Hasil migrasi otomatis", kapasitas:50, createdAt:Date.now() });
    }
    stocks.push({
      id: `STK-${String(idx+1).padStart(3,"0")}`,
      katalogId, lokasiId,
      qty: s.qty||0, minQty: s.minQty||0, price: s.price||0,
      jenisBarang: s.jenisBarang||"Cadang", img: s.img||null,
      createdAt: s.createdAt||Date.now(),
    });
  });

  return { katalog, lokasi, stocks };
}
