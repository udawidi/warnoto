// Komponen MigrasiDataTab — dipindah dari App.jsx (refactor Fase 5c).
import { useState } from "react";
import { UPT } from "../constants.js";
import { supabase } from "../supabaseClient.js";
import { fmtDateOnly, parseIndoNumber } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { normalizeKatalog } from "../lib/sap.js";
import * as XLSX from "xlsx";

// ════════════════════════════════════════════════════════════════════
// MIGRASI DATA TAB
// ════════════════════════════════════════════════════════════════════
export function MigrasiDataTab({ stocks, katalogList, lokasiList, txns, migratedTug15History, setMigratedTug15History, migrasiPendingReview, setMigrasiPendingReview, maraReference, setMaraReference, maraUploadLoading, maraUploadProgress, uploadMaraToDB, currentUser, sty, C, saveToCloud, setStocks, setKatalogList, setTxns, showToast }) {
  const [step, setStep] = useState("upload"); // "upload" | "preview" | "backup" | "done"
  const [sapFile, setSapFile] = useState(null);
  const [sapRows, setSapRows] = useState([]);
  // Baris "Match WARNOTO" (sudah ada di katalog) TIDAK ditimpa secara default —
  // Admin harus centang eksplisit per baris kalau memang mau timpa dengan data
  // import ini (2026-07-04, permintaan user: jangan pernah timpa data existing
  // diam-diam).
  const [overwriteRows, setOverwriteRows] = useState(new Set());
  const [applyProgress, setApplyProgress] = useState(""); // teks progres tahap-per-tahap saat Apply Cutover, supaya kelihatan jalan/stuck
  const [applyProgressPct, setApplyProgressPct] = useState(0); // 0-100, dipakai bareng applyProgress untuk progress bar bernomor
  const [lastCutoverSummary, setLastCutoverSummary] = useState(null); // ringkasan hasil cutover terakhir, ditampilkan di step "done"
  const [nonSapRows, setNonSapRows] = useState([]);
  const [parsedSAP, setParsedSAP] = useState([]);
  const [parsedNonSAP, setParsedNonSAP] = useState([]);
  const [previewStats, setPreviewStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [maraLoading, setMaraLoading] = useState(false);

  // Parse CSV SAP format PEMAT
  // Referensi format export SAP (diajarkan user 2026-07-02, lihat memory
  // warnoto_sap_export_format.md): Plant=kode UPT (3611=UPT Surabaya),
  // Material Type ZST1=Persediaan/ZCAD=Cadang (sumber utama), panjang kode
  // katalog (10 digit=Cadang) TETAP dipakai sebagai referensi pembanding/
  // validasi silang (bukan cuma fallback) — kalau dua sinyal ini beda,
  // di-flag `materialTypeMismatch` untuk direview, bukan diam-diam dipilih
  // salah satu. Valuation Type (BURSA/PRE-MEMORY) HANYA berlaku untuk
  // sub-klasifikasi material Persediaan (ZST1) — kalau ZCAD (Cadang), jangan
  // di-override jadi Bursa/Pre-Memory walau valType kebetulan cocok string-nya.
  // Quality Inspection/Blocked/In Transit Stock TIDAK auto-include maupun
  // auto-exclude ke qty utama — cuma di-flag `needsStockReview` supaya Admin
  // yang putuskan manual di preview, sesuai instruksi eksplisit user.
  function parseSAPMigration(rows) {
    return rows.map(row => {
      const material = String(row["Material"]||row["material"]||"").trim();
      const noKat = normalizeKatalog(material);
      const desc = String(row["Material Description"]||row["material description"]||"").trim();
      const satuan = String(row["Base Unit of Measure"]||"").trim() || "BH";
      // Dulu SELALU menghapus semua titik dulu baru konversi koma — kalau nilai aslinya pakai
      // titik sebagai TANDA DESIMAL (mis. "103.5", bukan ribuan), titiknya ikut terhapus jadi
      // "1035" (SANGAT BERBAHAYA, qty stok terdistorsi 10x). Sekarang pakai parseIndoNumber yang
      // membedakan titik-ribuan vs titik-desimal berdasar polanya, bukan asumsi buta (bug
      // dilaporkan user 2026-07-07).
      const qty = parseIndoNumber(row["Unrestricted Use Stock"]||row["unrestricted use stock"]);
      const valType = String(row["Valuation Type"]||"").trim().toUpperCase();
      const harga = parseIndoNumber(row["Harga Satuan"]);
      const materialType = String(row["Material Type"]||"").trim().toUpperCase();
      const plant = String(row["Plant"]||"").trim();
      const qiStock = parseIndoNumber(row["Quality Inspection Stock"]);
      const blockedStock = parseIndoNumber(row["Blocked Stock"]);
      const transitStock = parseIndoNumber(row["In Transit Stock"]);

      const kodePanjang10 = noKat.length === 10;
      let jenisBarang;
      if (materialType === "ZCAD") jenisBarang = "Cadang";
      else if (materialType === "ZST1") jenisBarang = "Persediaan";
      else jenisBarang = kodePanjang10 ? "Cadang" : "Persediaan"; // Material Type tidak dikenali, andalkan panjang kode
      // Valuation Type cuma sub-klasifikasi untuk jalur Persediaan (ZST1) — default "Persediaan"
      // (normal) kalau bukan BURSA/PRE-MEMORY. Tidak berlaku untuk Cadang (ZCAD).
      if (jenisBarang === "Persediaan") {
        if (valType === "BURSA") jenisBarang = "Persediaan Bursa";
        else if (valType === "PRE-MEMORY") jenisBarang = "Pre Memory";
      }
      // Validasi silang: Material Type vs panjang kode katalog beda sinyal -> flag review,
      // bukan diam-diam pilih salah satu (cuma relevan kalau Material Type dikenali).
      const materialTypeMismatch = (materialType==="ZCAD" && !kodePanjang10) || (materialType==="ZST1" && kodePanjang10);

      const plantMismatch = !!(plant && plant !== "3611");
      const needsStockReview = qiStock>0 || blockedStock>0 || transitStock>0;

      return { noKat, material, desc, satuan, qty, jenisBarang, harga, valType, materialType, plant, qiStock, blockedStock, transitStock, plantMismatch, needsStockReview, materialTypeMismatch, _valid: noKat.length > 0 && qty >= 0 };
    }).filter(r => r.noKat);
  }

  async function handleSAPFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const clean = text.replace(/^﻿/, ""); // strip BOM
        const lines = clean.replace(/\r/g,"").split("\n").filter(Boolean);
        const sep = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,""));
        rows = lines.slice(1).map(l => {
          const vals = l.split(sep).map(v=>v.trim().replace(/^"|"$/g,""));
          const obj = {}; headers.forEach((h,i)=>{ obj[h]=vals[i]||""; }); return obj;
        });
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""});
      }
      const parsed = parseSAPMigration(rows);
      setSapRows(parsed);
      setSapFile(file.name);
      showToast(`SAP: ${parsed.length} baris berhasil diparse.`, "success");
    } catch(err) { showToast("Gagal parse SAP: " + err.message, "error"); }
    setBusy(false);
    e.target.value = "";
  }

  async function handleLoadMara(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaraLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet1 = wb.Sheets["Sheet1"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet1, {defval:""});
      const ref = rows.map(r => ({
        katalog: normalizeKatalog(String(r["Material"]||"").trim()),
        description: String(r["Material Description"]||"").trim(),
        satuan: String(r["Base Unit of Measure"]||"").trim(),
        materialType: String(r["Material Type"]||"").trim(),
      }));
      setMaraReference(ref);
      showToast(`MARA dimuat: ${ref.length} material (session-only).`, "success");
    } catch(err) { showToast("Gagal load MARA: " + err.message, "error"); }
    setMaraLoading(false);
    e.target.value = "";
  }

  // BUG DITEMUKAN 2026-07-02: matchMara sebelumnya cek ke `maraReference` (state session-only,
  // diisi lewat tombol upload TERPISAH khusus di tab ini) — BUKAN tabel Supabase `mara_catalog`
  // yang sungguhan dipakai user (42.703 baris, diupload lewat Master Data → Master Katalog).
  // Karena user tidak pernah upload lewat tombol yang di tab ini, maraReference selalu kosong,
  // jadi SEMUA baris salah tampil "tidak match MARA". Fix: query mara_catalog langsung, dengan
  // normalisasi kode (MARA pakai 15 digit zero-padded, App pakai kode pendek tanpa padding —
  // sama seperti bug yang sudah pernah difix di applyMaraToKatalog/backfill kategori).
  async function buildPreview() {
    setBusy(true);
    setApplyProgress("🔄 Menyiapkan perbandingan data...");
    setApplyProgressPct(2);
    const warnotoSet = new Set(katalogList.map(k=>normalizeKatalog(k.katalog)));

    // BUG DITEMUKAN 2026-07-04: query tanpa .range() cuma balikin ~1000 baris
    // pertama (default limit PostgREST/Supabase) — mara_catalog punya 42.703
    // baris, jadi kode yang bukan di 1000 baris pertama SELALU "tidak match"
    // walau sebenarnya ada di referensi MARA (dikonfirmasi manual oleh user).
    // Fix: ambil semua baris per halaman 1000 sampai habis. Ini butuh puluhan
    // request berurutan (~43 halaman untuk 42.703 baris) — kasih progress
    // bernomor 1-100% per halaman supaya kelihatan jalan, bukan stuck
    // (permintaan user 2026-07-04).
    let maraSet = new Set();
    if (supabase) {
      // Hitung dulu total baris supaya persentase progres akurat (bukan cuma teks).
      const { count: maraTotal } = await supabase.from("mara_catalog").select("*", { count: "exact", head: true });
      let from = 0;
      const pageSize = 1000;
      let fetchError = null;
      let page = 1;
      while (true) {
        const pct = maraTotal ? Math.min(98, 5 + Math.round((from / maraTotal) * 85)) : Math.min(90, 5 + page * 5);
        setApplyProgressPct(pct);
        setApplyProgress(`📥 Memuat referensi MARA (${maraSet.size}${maraTotal?`/${maraTotal}`:""} kode terbaca)...`);
        const { data, error } = await supabase.from("mara_catalog").select("kode_material").range(from, from + pageSize - 1);
        if (error) { fetchError = error; break; }
        if (!data || data.length === 0) break;
        data.forEach(m => maraSet.add(m.kode_material.replace(/^0+/, "")));
        if (data.length < pageSize) break;
        from += pageSize;
        page++;
      }
      if (fetchError) showToast("Gagal cek referensi MARA: " + fetchError.message, "error");
    }
    setApplyProgressPct(95);
    setApplyProgress("🧮 Menghitung status match & selisih qty...");

    // Qty existing di aplikasi per No Katalog (dijumlah semua lokasi) — dipakai
    // untuk banding qty file upload vs qty aplikasi (permintaan user 2026-07-04):
    // sama persis → "Match", beda → otomatis tandai opsi Timpa (bukan cuma
    // tersedia, tapi di-pre-check) supaya Admin sadar ada selisih qty.
    const qtyByKatalog = new Map();
    stocks.forEach(s => {
      const k = katalogList.find(kk=>kk.id===s.katalogId);
      if (!k) return;
      const kode = normalizeKatalog(k.katalog);
      qtyByKatalog.set(kode, (qtyByKatalog.get(kode)||0) + (s.qty||0));
    });

    const sapResult = sapRows.map(r => {
      const matchWarnoto = warnotoSet.has(r.noKat);
      const existingQty = matchWarnoto ? (qtyByKatalog.get(r.noKat)||0) : null;
      const qtyMatch = matchWarnoto ? existingQty === r.qty : null;
      return {
        ...r,
        matchWarnoto,
        matchMara: maraSet.has(r.noKat),
        existingQty,
        qtyMatch,
      };
    });
    // Baris matched dengan qty BEDA otomatis di-pre-check "Timpa" (bukan dipaksa,
    // Admin masih bisa un-check kalau memang mau pertahankan qty existing) —
    // baris dengan qty SAMA tidak perlu keputusan apa-apa, dibiarkan default.
    setOverwriteRows(new Set(sapResult.filter(r=>r.matchWarnoto && r.qtyMatch===false).map(r=>r.noKat)));

    const byJenis = {};
    sapResult.forEach(r => { byJenis[r.jenisBarang] = (byJenis[r.jenisBarang]||0) + 1; });

    const totalQty = sapResult.reduce((s,r)=>s+r.qty,0);
    const totalNilai = sapResult.reduce((s,r)=>s+(r.qty*r.harga),0);

    setPreviewStats({ sapResult, byJenis, totalQty, totalNilai });
    setApplyProgressPct(100);
    setStep("preview");
    setBusy(false);
    setApplyProgress("");
    setApplyProgressPct(0);
  }

  // Recompute ringkasan (byJenis/totalQty/totalNilai) setelah sapResult diubah manual di preview.
  function recomputeStats(sapResult) {
    const byJenis = {};
    sapResult.forEach(r => { byJenis[r.jenisBarang] = (byJenis[r.jenisBarang]||0) + 1; });
    const totalQty = sapResult.reduce((s,r)=>s+r.qty,0);
    const totalNilai = sapResult.reduce((s,r)=>s+(r.qty*r.harga),0);
    return { sapResult, byJenis, totalQty, totalNilai };
  }
  // Aksi review manual: gabung qty Quality Inspection/Blocked/In Transit ke qty utama (Unrestricted).
  function moveReviewToUnrestricted(noKat) {
    setPreviewStats(ps => {
      if (!ps) return ps;
      const sapResult = ps.sapResult.map(r => {
        if (r.noKat !== noKat) return r;
        const tambahan = (r.qiStock||0) + (r.blockedStock||0) + (r.transitStock||0);
        return { ...r, qty: r.qty + tambahan, qiStock:0, blockedStock:0, transitStock:0, needsStockReview:false };
      });
      return recomputeStats(sapResult);
    });
    showToast(`Qty review digabung ke Unrestricted untuk ${noKat}.`, "success");
  }
  // Aksi review manual: keluarkan baris ini total dari daftar yang akan diimpor.
  function removeFromImportList(noKat) {
    setPreviewStats(ps => {
      if (!ps) return ps;
      const sapResult = ps.sapResult.filter(r => r.noKat !== noKat);
      return recomputeStats(sapResult);
    });
    showToast(`${noKat} dihapus dari daftar impor.`, "success");
  }

  async function handleBackupAndApply() {
    if (!previewStats) return;
    setBusy(true);
    setApplyProgressPct(5);
    setApplyProgress("⏳ Menyiapkan backup JSON...");
    try {
      // 1. Backup data sebelum cutover
      const backup = {
        stocks, katalogList, lokasiList, txns,
        backupAt: Date.now(), by: currentUser.id,
        note: "Pre-migration backup sebelum cutover SAP " + (sapFile||""),
      };
      const backupStr = JSON.stringify(backup, null, 2);
      const blobBackup = new Blob([backupStr], {type:"application/json"});
      const aBackup = document.createElement("a");
      aBackup.href = URL.createObjectURL(blobBackup);
      aBackup.download = `warnoto_backup_pre_migrasi_${new Date().toISOString().slice(0,10)}.json`;
      aBackup.click();

      setApplyProgressPct(25);
      setApplyProgress("🔄 Menghitung baris yang perlu diperbarui...");

      // 2. Build katalog — MERGE ke katalogList existing, BUKAN timpa total. Bug lama: array
      // hasil cuma berisi baris dari file yang lagi diupload (previewStats.sapResult), jadi
      // upload kedua (mis. file Material Cadang setelah Persediaan) menghapus semua katalog/
      // stok dari upload pertama yang tidak ada di file kedua. Sekarang mulai dari list
      // existing, cuma upsert baris yang ada di file ini — baris lain yang tidak disentuh
      // TETAP ada.
      // Baris "Match WARNOTO" (sudah ada di katalog): DEFAULT dibiarkan apa adanya,
      // hanya ditimpa kalau Admin eksplisit centang "Timpa" untuk baris itu
      // (overwriteRows). Baris baru (tidak match) TIDAK langsung masuk ke
      // katalogList/stocks — dikumpulkan ke antrian migrasiPendingReview,
      // menunggu Admin approve satu-satu (2026-07-04).
      const now = Date.now();
      const katalogById = new Map(katalogList.map(k=>[normalizeKatalog(k.katalog), k]));
      const newPendingReview = [];
      previewStats.sapResult.forEach(r => {
        const existing = katalogById.get(r.noKat);
        if (existing) {
          if (overwriteRows.has(r.noKat)) {
            katalogById.set(r.noKat, { ...existing, jenisBarang: r.jenisBarang, satuan: r.satuan || existing.satuan });
          }
          // else: biarkan data existing apa adanya, tidak disentuh.
        } else {
          newPendingReview.push({
            id: "MIGREV-" + r.noKat + "-" + now,
            noKat: r.noKat,
            desc: r.desc,
            satuan: r.satuan,
            jenisBarang: r.jenisBarang,
            harga: r.harga,
            qty: r.qty,
            sourceFile: sapFile || "",
            status: "PENDING",
            requestedBy: currentUser.id,
            requestedAt: now,
          });
        }
      });
      const newKatalog = Array.from(katalogById.values());
      const updatedPendingReview = [...(migrasiPendingReview||[]), ...newPendingReview];

      // 3. Build stocks — HANYA update qty/harga baris yang match DAN ditandai timpa.
      // Baris baru TIDAK dibuat di sini (masuk migrasiPendingReview di atas, baru
      // dibuat stok-nya kalau Admin approve).
      // BUG DITEMUKAN 2026-07-04: kalau 1 katalog punya >1 baris stok (beda lokasi/blok),
      // Map stockByKode dulu cuma nyimpen baris TERAKHIR (yang lain ketiban/hilang dari
      // Map) — qty SAP (angka total, bukan per-lokasi) ditimpakan ke SATU baris lokasi
      // secara acak, baris lokasi lain dibiarkan basi. User laporkan "data stock tidak
      // update" — akar masalahnya kemungkinan ini untuk katalog yang stoknya tersebar di
      // banyak lokasi. Fix: kalau katalog ini py >1 baris stok, JANGAN auto-update (kita
      // tidak tahu qty SAP itu harus dialokasikan ke lokasi mana) — masukkan ke daftar
      // multiLokasiSkipped, biar Admin sesuaikan manual per lokasi lewat Edit Data Stok.
      const stocksByKode = new Map(); // kode -> array baris stok
      stocks.forEach(s => {
        const k = katalogList.find(kk=>kk.id===s.katalogId);
        if (!k) return;
        const kode = normalizeKatalog(k.katalog);
        if (!stocksByKode.has(kode)) stocksByKode.set(kode, []);
        stocksByKode.get(kode).push(s);
      });
      const multiLokasiSkipped = [];
      const stocksById = new Map(stocks.map(s=>[s.id, s]));
      previewStats.sapResult.filter(r=>r.qty>0 && overwriteRows.has(r.noKat)).forEach(r => {
        const kat = katalogById.get(r.noKat);
        if (!kat) return; // baru/tidak match — ditangani lewat pending review
        const rows = stocksByKode.get(r.noKat) || [];
        if (rows.length > 1) {
          multiLokasiSkipped.push({ noKat: r.noKat, desc: r.desc, qtyFile: r.qty, lokasiCount: rows.length });
          return; // ambigu, jangan auto-timpa salah satu lokasi — Admin sesuaikan manual
        }
        // rows.length===0: BUG DITEMUKAN 2026-07-04 — sebelumnya kasus ini malah
        // di-skip diam-diam (katalog match tapi belum pernah punya baris stok
        // sama sekali), jadi katalog "masuk" tapi Data Stok Gudang tetap 0 baris.
        // Sekarang: kalau belum ada baris stok, BUAT baris baru (bukan cuma
        // update baris existing) — sama seperti perilaku untuk item benar-benar
        // baru, cuma katalog-nya sudah ada duluan.
        // BUG DITEMUKAN 2026-07-04 (laporan kedua): default ke lokasiList[0] (lokasi
        // PERTAMA di seluruh Master Lokasi, tidak ada hubungannya dengan file yang
        // diupload — kolom Storage Location di SAP memang sengaja diabaikan, jadi
        // WARNOTO tidak punya info lokasi real untuk item baru). Sekarang dibiarkan
        // KOSONG ("— Belum diisi —") — Admin isi manual lewat dropdown Gudang/Blok
        // yang sudah ada di Data Stok, bukan ditebak sistem.
        const existing = rows[0] || null;
        const row = {
          ...(existing || {}),
          id: existing?.id || ("STK-MIG-"+r.noKat+"-"+now),
          katalogId: kat.id,
          lokasiId: existing?.lokasiId || null,
          qty: r.qty,
          price: r.harga || existing?.price || 0,
          minQty: existing?.minQty || 0,
          unit: r.satuan,
          jenisBarang: r.jenisBarang,
          name: r.desc,
          katalog: r.noKat,
          category: existing?.category || r.desc.split(";")[0].trim() || "Material",
          sapBaselineQty: r.qty,
          sapBaselineAt: now,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        stocksById.set(row.id, row);
      });
      const newStocks = Array.from(stocksById.values());

      // 4. Arsipkan histori TUG lama sebagai migrasi — cuma sekali (run pertama). Kalau wizard
      // ini dijalankan berkali-kali (mis. Persediaan lalu Cadang), jangan wipe txns aktif yang
      // sudah berjalan normal di antara 2 proses migrasi itu.
      const isFirstMigration = (migratedTug15History||[]).length === 0;
      const migHistory = isFirstMigration ? txns.map(t => ({...t, _migrasiSource:"WARNOTO_TEST"})) : migratedTug15History;
      if (isFirstMigration) setMigratedTug15History(migHistory);
      const newTxns = isFirstMigration ? [] : txns;

      // 5. Apply cutover
      setKatalogList(newKatalog);
      setStocks(newStocks);
      setTxns(newTxns);
      setMigrasiPendingReview(updatedPendingReview);
      setApplyProgressPct(60);
      setApplyProgress("☁️ Menyimpan ke localStorage & Supabase (katalog, stok, antrian review)...");
      await saveToCloud({
        katalogList: newKatalog,
        stocks: newStocks,
        txns: newTxns,
        migratedTug15History: migHistory,
        migrasiPendingReview: updatedPendingReview,
      });

      setApplyProgressPct(100);
      setApplyProgress("✅ Selesai.");
      setStep("done");
      const overwriteCount = previewStats.sapResult.filter(r => katalogById.has(r.noKat) && overwriteRows.has(r.noKat)).length - multiLokasiSkipped.length;
      setLastCutoverSummary({ overwriteCount, newItemCount: newPendingReview.length, multiLokasiSkipped });
      showToast(
        `Cutover selesai. ${overwriteCount} baris stok diperbarui, ` +
        `${newPendingReview.length} item baru masuk antrian review Admin` +
        (multiLokasiSkipped.length ? `, ${multiLokasiSkipped.length} baris DILEWATI karena tersebar di >1 lokasi (perlu update manual)` : "") +
        `. Sisanya data existing dibiarkan apa adanya.`,
        "success"
      );
    } catch(err) {
      showToast("Cutover gagal: " + err.message, "error");
      setApplyProgress("");
      setApplyProgressPct(0);
    }
    setBusy(false);
  }

  // Progress bar bernomor 1-100% (bukan cuma teks "Memproses...") supaya
  // Admin bisa lihat apakah proses jalan atau macet (permintaan user 2026-07-04).
  function ProgressBar() {
    if (!busy) return null;
    const pct = Math.max(1, applyProgressPct);
    return (
      <div style={{width:"100%",maxWidth:420,marginTop:8}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.accent,fontWeight:700,marginBottom:3}}>
          <span>{applyProgress || "Memproses..."}</span>
          <span>{pct}%</span>
        </div>
        <div style={{width:"100%",height:8,background:"#e5e7eb",borderRadius:6,overflow:"hidden"}}>
          <div style={{width:`${pct}%`,height:"100%",background:C.accent,borderRadius:6,transition:"width 0.2s"}}/>
        </div>
      </div>
    );
  }

  function toggleOverwriteRow(noKat) {
    setOverwriteRows(prev => {
      const next = new Set(prev);
      if (next.has(noKat)) next.delete(noKat); else next.add(noKat);
      return next;
    });
  }

  // Admin approve 1 item dari antrian review — baru di sini katalog+stok
  // benar-benar dibuat (merge-safe, sama seperti pola cutover di atas).
  async function approveMigrasiPending(itemId) {
    const item = (migrasiPendingReview||[]).find(i => i.id === itemId);
    if (!item) return;
    const now = Date.now();
    const katId = "KAT-MIG-" + item.noKat;
    const existingKat = katalogList.find(k => normalizeKatalog(k.katalog) === item.noKat);
    const newKatalogList = existingKat ? katalogList : [...katalogList, {
      id: katId, katalog: item.noKat, name: item.desc,
      category: item.desc.split(";")[0].trim() || "Material",
      jenisBarang: item.jenisBarang, satuan: item.satuan,
      keterangan: "Import migrasi SAP " + (item.sourceFile||"") + " (disetujui Admin)",
      createdAt: now,
    }];
    const finalKatId = existingKat?.id || katId;
    // Sama seperti fix di handleBackupAndApply: JANGAN tebak lokasi — kosongkan,
    // Admin isi manual (lihat catatan bug 2026-07-04 di atas).
    const newStocksList = item.qty > 0 ? [...stocks, {
      id: "STK-MIG-" + item.noKat + "-" + now,
      katalogId: finalKatId, lokasiId: null,
      qty: item.qty, price: item.harga || 0, minQty: 0, unit: item.satuan,
      jenisBarang: item.jenisBarang, name: item.desc, katalog: item.noKat,
      category: item.desc.split(";")[0].trim() || "Material",
      sapBaselineQty: item.qty, sapBaselineAt: now, createdAt: now, updatedAt: now,
    }] : stocks;
    const newPending = migrasiPendingReview.map(i => i.id===itemId ? {...i, status:"APPROVED", decidedBy:currentUser.id, decidedAt:now} : i);
    setKatalogList(newKatalogList);
    setStocks(newStocksList);
    setMigrasiPendingReview(newPending);
    await saveToCloud({ katalogList: newKatalogList, stocks: newStocksList, migrasiPendingReview: newPending });
    showToast(`${item.desc} disetujui dan ditambahkan ke Master Katalog/Data Stok.`, "success");
  }

  async function rejectMigrasiPending(itemId) {
    const newPending = migrasiPendingReview.map(i => i.id===itemId ? {...i, status:"REJECTED", decidedBy:currentUser.id, decidedAt:Date.now()} : i);
    setMigrasiPendingReview(newPending);
    await saveToCloud({ migrasiPendingReview: newPending });
    showToast("Item ditolak, tidak ditambahkan ke Master Katalog.", "success");
  }

  // Bug lokasi ditemukan 2026-07-04: sebelum fix di atas, baris stok baru hasil
  // migrasi (id berawalan "STK-MIG-") auto-diisi lokasiList[0] (lokasi PERTAMA
  // di Master Lokasi, bukan hasil pembacaan file). Tidak bisa dibedakan otomatis
  // mana yang memang ditinggal begitu vs yang sudah sengaja dikonfirmasi manual
  // oleh Admin ke lokasi yang sama — jadi ditampilkan sebagai daftar review,
  // Admin putuskan satu-per-satu (atau sekaligus) pertahankan/kosongkan.
  //
  // PERBAIKAN 2026-07-04 (kedua): filter awal membandingkan ke lokasiId ===
  // lokasiList[0]?.id — tapi urutan baris dari Supabase TIDAK terjamin stabil
  // antar reload (query lokasi tidak pakai ORDER BY), jadi lokasiList[0] bisa
  // beda tiap kali app dimuat, dan panel jadi tidak menangkap baris yang
  // sebelumnya memang salah. Fix: tangkap SEMUA baris hasil migrasi yang
  // punya lokasi tapi belum direview — tidak bergantung ke lokasi mana pun.
  //
  // PERBAIKAN 2026-07-04 (ketiga): filter cuma cek prefix "STK-MIG-", tapi
  // banyak baris ternyata berasal dari fitur "Import dari SAP" LAMA (sudah
  // dihapus tombolnya, lihat commit 5958153) yang pakai prefix "STK-SAP-" —
  // baris-baris itu masih ada di data existing dan ikut kena bug lokasi yang
  // sama. Fix: terima kedua prefix.
  const locationReviewCandidates = (stocks||[]).filter(s =>
    /^STK-(MIG|SAP)-/.test(String(s.id||"")) && s.lokasiId && !s.locationReviewed
  );

  async function keepMigrasiLocation(stockId) {
    const newStocks = stocks.map(s => s.id===stockId ? {...s, locationReviewed:true} : s);
    setStocks(newStocks);
    await saveToCloud({ stocks: newStocks });
    showToast("Lokasi dipertahankan.", "success");
  }

  async function clearMigrasiLocation(stockId) {
    const newStocks = stocks.map(s => s.id===stockId ? {...s, lokasiId:null, locationReviewed:true} : s);
    setStocks(newStocks);
    await saveToCloud({ stocks: newStocks });
    showToast("Lokasi dikosongkan — isi manual lewat Data Stok.", "success");
  }

  async function clearAllMigrasiLocations() {
    if (!window.confirm(`Kosongkan lokasi untuk SEMUA ${locationReviewCandidates.length} baris ini sekaligus? Tindakan ini tidak bisa di-undo.`)) return;
    const ids = new Set(locationReviewCandidates.map(s=>s.id));
    const newStocks = stocks.map(s => ids.has(s.id) ? {...s, lokasiId:null, locationReviewed:true} : s);
    setStocks(newStocks);
    await saveToCloud({ stocks: newStocks });
    showToast(`${ids.size} baris dikosongkan — isi manual lewat Data Stok.`, "success");
  }

  return (
    <div>
      {/* Judul "Migrasi Data SAP/Non-SAP" sudah ditampilkan header Master Data
          di atas (lihat App.jsx ~line 5769) — h1 di sini dihapus supaya tidak
          dobel (ditemukan user 2026-07-04). */}

      {(migrasiPendingReview||[]).some(i=>i.status==="PENDING") && (
        <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid #f59e0b`}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:10,color:"#92400e"}}>
            📋 Menunggu Review Admin ({migrasiPendingReview.filter(i=>i.status==="PENDING").length} item baru dari Migrasi Data)
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
            {migrasiPendingReview.filter(i=>i.status==="PENDING").map(item=>(
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",background:"white"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.desc}</div>
                  <div style={{fontSize:12,color:C.muted}}>No. Katalog {item.noKat} • {item.jenisBarang} • Qty {item.qty} {item.satuan} • {item.harga?("Rp "+fmtNum(item.harga)):"-"} • dari {item.sourceFile}</div>
                </div>
                <button style={sty.btn("primary","sm")} onClick={()=>approveMigrasiPending(item.id)}>✅ Setujui</button>
                <button style={sty.btn("danger","sm")} onClick={()=>rejectMigrasiPending(item.id)}>✕ Tolak</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {locationReviewCandidates.length > 0 && (
        <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid #dc2626`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:6}}>
            <div style={{fontWeight:800,fontSize:14,color:"#991b1b"}}>
              📍 Review Lokasi Otomatis ({locationReviewCandidates.length} baris stok)
            </div>
            <button style={sty.btn("danger","sm")} onClick={clearAllMigrasiLocations}>🗑️ Kosongkan Semua ({locationReviewCandidates.length})</button>
          </div>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>
            Baris-baris ini pernah dibuat migrasi lalu dengan lokasi ditebak otomatis (bug yang sudah diperbaiki) —
            sebagian mungkin sudah Anda konfirmasi/set manual, sebagian mungkin belum. Cek satu-satu:
            kalau lokasinya memang benar, klik "Pertahankan". Kalau bukan, klik "Kosongkan" lalu isi lokasi yang
            benar manual lewat Data Stok. Kalau Anda yakin SEMUA baris ini memang belum pernah diisi manual,
            pakai "Kosongkan Semua" di kanan atas.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
            {locationReviewCandidates.map(s=>{
              const kat = katalogList.find(k=>k.id===s.katalogId);
              const lok = lokasiList.find(l=>l.id===s.lokasiId);
              const gudang = lok?.gudangId;
              return (
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",background:"white"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name||kat?.name}</div>
                    <div style={{fontSize:12,color:C.muted}}>No. Katalog {s.katalog||kat?.katalog} • Qty {s.qty} • Lokasi saat ini: {lok?.kode||"-"}</div>
                  </div>
                  <button style={sty.btn("primary","sm")} onClick={()=>keepMigrasiLocation(s.id)}>✅ Pertahankan</button>
                  <button style={sty.btn("danger","sm")} onClick={()=>clearMigrasiLocation(s.id)}>🗑️ Kosongkan</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div style={{display:"flex",gap:4,marginBottom:20,flexWrap:"wrap"}}>
        {["upload","preview","backup","done"].map((s,i)=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:step===s?C.accent:["upload","preview","backup","done"].indexOf(step)>i?"#16a34a":"#e5e7eb",color:step===s?"white":["upload","preview","backup","done"].indexOf(step)>i?"white":"#9ca3af",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
            <span style={{fontSize:12,fontWeight:step===s?700:400,color:step===s?C.accent:C.muted,textTransform:"capitalize"}}>{s==="backup"?"Backup & Apply":s}</span>
            {i<3 && <span style={{color:C.border,marginLeft:4}}>→</span>}
          </div>
        ))}
      </div>

      {step==="upload" && (
        <div>
          <div style={{...sty.card,marginBottom:12}}>
            <div style={{fontWeight:700,marginBottom:8}}>1. Upload File SAP (PEMAT format)</div>
            <p style={{fontSize:12,color:C.muted,marginBottom:10}}>Format CSV atau XLSX dengan kolom: Material, Material Description, Base Unit of Measure, Unrestricted Use Stock, Valuation Type, Harga Satuan.</p>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                {busy?"⏳ Memproses...":"📂 Upload File SAP (CSV/XLSX)"}
                <input type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={handleSAPFile} disabled={busy}/>
              </label>
              {sapFile && <span style={{fontSize:12,color:C.green,fontWeight:700}}>✅ {sapFile} ({sapRows.length} baris)</span>}
            </div>
            {/* Tombol "Lanjut" sengaja DI DALAM kotak upload yang sama, dan baru
                muncul setelah file berhasil diupload (bukan selalu tampil abu-abu
                menunggu diaktifkan) — sebelumnya dirender terpisah di luar kotak
                ini, terkesan tidak nyambung dengan langkah 1 (keluhan user 2026-07-06). */}
            {sapRows.length>0 && (
              <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <button style={sty.btn("primary")} disabled={busy} onClick={buildPreview}>
                  {busy ? "⏳ Memproses..." : "Lanjut → Preview Rekonsiliasi"}
                </button>
                {busy && <button style={{...sty.btn("ghost","sm")}} onClick={()=>{setBusy(false);setApplyProgress("");setApplyProgressPct(0);}}>Reset (jika stuck)</button>}
              </div>
            )}
          </div>
          <ProgressBar/>
        </div>
      )}

      {step==="preview" && previewStats && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
            {[
              {label:"Total Baris SAP",val:previewStats.sapResult.length,color:C.accent},
              {label:"Total Qty",val:fmtNum(Math.round(previewStats.totalQty)),color:"#7c3aed"},
              {label:"Total Nilai",val:"Rp "+fmtNum(previewStats.totalNilai),color:C.green,small:true},
              {label:"Match WARNOTO",val:previewStats.sapResult.filter(r=>r.matchWarnoto).length,color:C.green},
              {label:"Baru (tidak di WARNOTO)",val:previewStats.sapResult.filter(r=>!r.matchWarnoto).length,color:"#f59e0b"},
              {label:"⚠️ Perlu Review Stok",val:previewStats.sapResult.filter(r=>r.needsStockReview).length,color:C.red},
              {label:"⚠️ Plant ≠ 3611",val:previewStats.sapResult.filter(r=>r.plantMismatch).length,color:C.red},
              {label:"⚠️ Jenis Barang Beda Sinyal",val:previewStats.sapResult.filter(r=>r.materialTypeMismatch).length,color:C.red},
            ].map(kpi=>(
              <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14}}>
                <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                <div style={{fontSize:kpi.small?13:20,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
              </div>
            ))}
          </div>
          <div style={{...sty.card,marginBottom:12}}>
            <div style={{fontWeight:700,marginBottom:8}}>Distribusi Jenis Barang</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {Object.entries(previewStats.byJenis).map(([j,n])=>(
                <div key={j} style={{padding:"6px 12px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`,fontSize:12}}>
                  <strong>{j}:</strong> {n} item
                </div>
              ))}
            </div>
          </div>
          {previewStats.sapResult.some(r=>r.needsStockReview) && (
            <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`}}>
              <div style={{fontWeight:700,marginBottom:4,color:C.red}}>⚠️ Perlu Review Manual — Qty di luar "Unrestricted Use Stock"</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Baris ini punya qty di Quality Inspection/Blocked/In Transit Stock — TIDAK otomatis ditambahkan ke Data Stok. Putuskan per baris: gabung ke Unrestricted, atau hapus barisnya dari daftar impor. Kalau dibiarkan, qty tambahan ini tetap diabaikan (cuma qty Unrestricted yang ikut masuk).</div>
              <div style={{maxHeight:220,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"#fef2f2"}}>{["No Katalog","Deskripsi","Unrestricted","Quality Insp.","Blocked","In Transit","Aksi"].map(h=><th key={h} style={{padding:"5px 8px",textAlign:"left"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {previewStats.sapResult.filter(r=>r.needsStockReview).map((r,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat}</td>
                        <td style={{padding:"5px 8px"}}>{r.desc}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.qty}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:r.qiStock>0?C.red:C.muted}}>{r.qiStock||"-"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:r.blockedStock>0?C.red:C.muted}}>{r.blockedStock||"-"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:r.transitStock>0?C.red:C.muted}}>{r.transitStock||"-"}</td>
                        <td style={{padding:"5px 8px",whiteSpace:"nowrap"}}>
                          <button style={{...sty.btn("ghost","sm"),padding:"3px 8px",marginRight:4}} onClick={()=>moveReviewToUnrestricted(r.noKat)}>➡️ Ke Unrestricted</button>
                          <button style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>removeFromImportList(r.noKat)}>🗑️ Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {previewStats.sapResult.some(r=>r.plantMismatch) && (
            <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`}}>
              <div style={{fontWeight:700,color:C.red}}>⚠️ {previewStats.sapResult.filter(r=>r.plantMismatch).length} baris punya kode Plant selain 3611 (UPT Surabaya)</div>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>Data ini tetap ikut diproses sebagai UPT Surabaya — kalau ini sebenarnya milik UPT lain, hapus dulu barisnya dari file sebelum upload ulang.</div>
            </div>
          )}
          {previewStats.sapResult.some(r=>r.materialTypeMismatch) && (
            <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`}}>
              <div style={{fontWeight:700,color:C.red}}>⚠️ {previewStats.sapResult.filter(r=>r.materialTypeMismatch).length} baris: Material Type dan panjang kode katalog beda sinyal</div>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>Contoh: Material Type bilang ZCAD (Cadang) tapi kodenya bukan 10 digit, atau sebaliknya ZST1 (Persediaan) tapi kodenya 10 digit. Jenis barang yang dipakai sistem tetap ikut Material Type (kolom "Jenis" di tabel) — cek manual baris ini sebelum apply, siapa tahu ada data yang salah input.</div>
            </div>
          )}
          <div style={{...sty.card,padding:0,overflowX:"auto",marginBottom:16,maxHeight:350,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:700}}>
              <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                <tr>
                  {["No Katalog","Deskripsi","Jenis","Qty File","Qty Aplikasi","Harga","Match WARNOTO","Match MARA","Timpa?","Review"].map(h=>(
                    <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewStats.sapResult.slice(0,200).map((r,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:r.needsStockReview||r.plantMismatch||r.materialTypeMismatch?"#fef2f2":!r.matchWarnoto?"#fefce8":"white"}}>
                    <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat}</td>
                    <td style={{padding:"5px 8px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.desc}</td>
                    <td style={{padding:"5px 8px",fontSize:12}}>{r.jenisBarang}</td>
                    <td style={{padding:"5px 8px",textAlign:"right"}}>{r.qty}</td>
                    <td style={{padding:"5px 8px",textAlign:"right",color:r.qtyMatch===false?C.red:r.qtyMatch===true?C.green:C.muted,fontWeight:r.qtyMatch===false?700:400}}>
                      {r.matchWarnoto ? r.existingQty : "-"}
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"right"}}>{r.harga?fmtNum(r.harga):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.matchWarnoto?"✅":"🆕"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.matchMara?"✅":"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>
                      {!r.matchWarnoto ? (
                        <span style={{fontSize:12,color:"#f59e0b",fontWeight:700}}>📋 Review Admin</span>
                      ) : r.qtyMatch ? (
                        <span style={{fontSize:12,color:C.green,fontWeight:700}}>✅ Qty sama</span>
                      ) : (
                        <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",fontSize:12,color:overwriteRows.has(r.noKat)?C.red:C.muted}}>
                          <input type="checkbox" checked={overwriteRows.has(r.noKat)} onChange={()=>toggleOverwriteRow(r.noKat)} />
                          Timpa
                        </label>
                      )}
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.needsStockReview?"⚠️ Stok":r.plantMismatch?"⚠️ Plant":r.materialTypeMismatch?"⚠️ Jenis":""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.accent}`,fontSize:12}}>
            <strong>ℹ️ Aturan Apply:</strong> baris <strong>Match WARNOTO ✅</strong> dengan qty file = qty aplikasi otomatis
            <strong> "✅ Qty sama"</strong> — tidak ada yang perlu diputuskan, dibiarkan apa adanya.
            Kalau qty-nya <strong>beda</strong>, kotak "Timpa" otomatis TERCENTANG (Admin bisa un-check kalau tetap mau
            pertahankan qty aplikasi) — total <strong>{overwriteRows.size} baris</strong> ditandai timpa saat ini.
            Baris <strong>🆕 baru</strong> (belum ada di katalog) TIDAK langsung ditambahkan — masuk ke antrian "Menunggu Review Admin"
            di bawah, baru dibuat setelah di-approve satu-per-satu.
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={sty.btn("ghost")} onClick={()=>setStep("upload")}>← Kembali</button>
            <button style={sty.btn("primary")} onClick={()=>setStep("backup")}>Lanjut → Backup & Apply</button>
          </div>
        </div>
      )}

      {step==="backup" && (() => {
        const newItemCount = previewStats?.sapResult?.filter(r=>!r.matchWarnoto).length || 0;
        const nothingToChange = overwriteRows.size === 0 && newItemCount === 0;
        if (nothingToChange) {
          return (
            <div style={{...sty.card,textAlign:"center",padding:30}}>
              <div style={{fontSize:36,marginBottom:10}}>✅</div>
              <div style={{fontWeight:800,fontSize:15,marginBottom:6}}>Tidak ada perubahan yang perlu di-apply</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>
                Semua {previewStats?.sapResult?.length||0} baris di file ini sudah cocok 100% dengan data di aplikasi
                (qty sama, tidak ada item baru) — tidak perlu backup/cutover, data existing tidak disentuh sama sekali.
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                <button style={sty.btn("ghost")} onClick={()=>setStep("preview")}>← Kembali ke Preview</button>
                <button style={sty.btn("primary")} onClick={()=>{ setStep("upload"); setSapFile(null); setSapRows([]); setPreviewStats(null); }}>Selesai, Upload File Lain</button>
              </div>
            </div>
          );
        }
        return (
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:16,marginBottom:12}}>⚠️ Konfirmasi Backup & Apply Cutover</div>
          <div style={{background:"#fef9c3",border:"1px solid #fbbf24",borderRadius:8,padding:14,marginBottom:16,fontSize:13}}>
            <strong>Tindakan ini akan:</strong>
            <ul style={{marginTop:8,paddingLeft:20,lineHeight:1.8}}>
              <li>Mendownload backup JSON lengkap data sebelum cutover</li>
              <li>Baris <strong>Match WARNOTO</strong> yang TIDAK dicentang "Timpa" akan dibiarkan apa adanya (aman)</li>
              <li>Baris <strong>Match WARNOTO</strong> yang dicentang "Timpa" ({overwriteRows.size} baris) akan diperbarui dengan data dari file ini</li>
              <li>Baris <strong>baru</strong> ({newItemCount} item) masuk antrian "Menunggu Review Admin" — belum masuk Master Katalog/Data Stok</li>
              <li>Mengosongkan transaksi TUG test lama (disimpan ke histori migrasi, hanya sekali di run pertama)</li>
              <li>Data yang ditimpa <strong>tidak bisa di-undo</strong> kecuali restore dari backup</li>
            </ul>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <button style={{...sty.btn("danger"),opacity:busy?0.6:1}} onClick={handleBackupAndApply} disabled={busy}>
              {busy?"⏳ Memproses...":"📥 Download Backup & Apply Cutover"}
            </button>
            <button style={sty.btn("ghost")} onClick={()=>setStep("preview")} disabled={busy}>← Batal</button>
            {busy && <button style={{...sty.btn("ghost","sm")}} onClick={()=>{setBusy(false);setApplyProgress("");setApplyProgressPct(0);}}>Reset (jika stuck)</button>}
          </div>
          <ProgressBar/>
        </div>
        );
      })()}

      {step==="done" && (
        <div style={{...sty.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontWeight:800,fontSize:18,marginBottom:8,color:C.green}}>Cutover Selesai!</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:12}}>
            Data existing yang TIDAK dicentang "Timpa" dibiarkan apa adanya. Histori TUG lama tersimpan di "Migrasi TUG-15".
          </div>
          {lastCutoverSummary && (
            <div style={{textAlign:"left",display:"inline-block",background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:16,fontSize:12}}>
              <div>✅ <strong>{lastCutoverSummary.overwriteCount}</strong> baris stok diperbarui (sesuai centang "Timpa")</div>
              <div>📋 <strong>{lastCutoverSummary.newItemCount}</strong> item baru masuk antrian Menunggu Review Admin</div>
              {lastCutoverSummary.multiLokasiSkipped.length > 0 && (
                <div style={{marginTop:8,color:"#b91c1c"}}>
                  <div>⚠️ <strong>{lastCutoverSummary.multiLokasiSkipped.length}</strong> baris DILEWATI — katalog ini tersebar di lebih dari 1 lokasi, sistem tidak tahu qty file SAP harus dialokasikan ke lokasi mana. Sesuaikan manual lewat Edit Data Stok:</div>
                  <ul style={{marginTop:4,paddingLeft:18}}>
                    {lastCutoverSummary.multiLokasiSkipped.slice(0,10).map((m,i)=>(
                      <li key={i}>{m.noKat} — {m.desc} (qty file: {m.qtyFile}, tersebar di {m.lokasiCount} lokasi)</li>
                    ))}
                    {lastCutoverSummary.multiLokasiSkipped.length > 10 && <li>...dan {lastCutoverSummary.multiLokasiSkipped.length-10} lainnya</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            <button style={sty.btn("primary")} onClick={()=>{setStep("upload");setLastCutoverSummary(null);}}>Lakukan Migrasi Lagi</button>
          </div>
        </div>
      )}

      {/* Riwayat migrasi TUG-15 */}
      {migratedTug15History.length > 0 && (
        <div style={{...sty.card,marginTop:16}}>
          <div style={{fontWeight:700,marginBottom:8}}>📋 Histori TUG-15 Migrasi ({migratedTug15History.length} transaksi)</div>
          <p style={{fontSize:12,color:C.muted,marginBottom:8}}>Data histori dari sebelum cutover — tampil di TUG-15 dengan badge "MIGRASI", tidak mempengaruhi stok aktif.</p>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {migratedTug15History.slice(0,20).map((t,i)=>(
              <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12,display:"flex",gap:12}}>
                <span style={{fontWeight:700,color:C.accent}}>{t.id}</span>
                <span style={{color:C.muted}}>{t.docType} — {fmtDateOnly(t.createdAt)}</span>
                <span style={{padding:"1px 6px",borderRadius:4,background:"#f3f4f6",fontSize:12}}>MIGRASI</span>
              </div>
            ))}
            {migratedTug15History.length > 20 && <div style={{padding:8,color:C.muted,fontSize:12,textAlign:"center"}}>...dan {migratedTug15History.length-20} transaksi lainnya</div>}
          </div>
        </div>
      )}
    </div>
  );
}
