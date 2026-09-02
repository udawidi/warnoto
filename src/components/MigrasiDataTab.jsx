// Komponen MigrasiDataTab — dipindah dari App.jsx (refactor Fase 5c).
import { useState, useEffect } from "react";
import { UPT } from "../constants.js";
import { fmtDate, fmtDateOnly, parseIndoNumber, parseSAPNumber, uid } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { normalizeKatalog, resolveSapLabel } from "../lib/sap.js";
import { logAudit } from "../lib/audit.js";
import { can } from "../lib/perms.js";
import { keepRemoteStockPhoto } from "../lib/stockCache.js";
import { SAP_PLANT_TO_UPT } from "../data/masterUpt.js";
import { supabase } from "../supabaseClient.js";
import * as XLSX from "xlsx";
import { readXlsxArrayBufferSafe, readWorkbookSafe, sanitizeRows } from "../lib/xlsxImport.js";

// Jenis Barang enum persis dipakai template migrasi stok (lihat scripts/gen_template_migrasi_stok.mjs).
const TPL_JENIS_ENUM = new Set(["Persediaan", "Persediaan Bursa", "Pre Memory", "Cadang", "Non-Stock"]);
const tplNormUpt = v => String(v||"").trim().toLowerCase().replace(/^upt\s+/,"").replace(/\s+/g," ");
const tplNormLoose = v => String(v||"").trim().toLowerCase().replace(/\s+/g," ");
function tplNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Jenis TUG di kolom "Jenis" template Import Transaksi TUG Lama → docType/docNumbers key.
// Normalisasi terima "TUG-9"/"tug 9"/"TUG9" dsb (lihat normalizeJenis).
const LEGACY_TUG_DOCTYPE = { TUG3:"TUG3", TUG5:"TUG5", TUG7:"TUG7", TUG8:"TUG8", TUG9:"TUG9", TUG10:"TUG10" };
const LEGACY_TUG_DOCKEY = { TUG3:"tug3", TUG5:"tug5", TUG7:"tug7", TUG8:"tug8", TUG9:"tug9", TUG10:"tug10" };
function normalizeJenis(v) { return String(v||"").replace(/[^A-Z0-9]/gi,"").toUpperCase(); }

// ════════════════════════════════════════════════════════════════════
// MIGRASI DATA TAB
// ════════════════════════════════════════════════════════════════════
export function MigrasiDataTab({ stocks, katalogList, lokasiList, uptList, gudangList, subGudangList, txns, migratedTug15History, setMigratedTug15History, migrasiPendingReview, setMigrasiPendingReview, currentUser, sty, C, saveToCloud, setStocks, setKatalogList, setTxns, showToast, rolePerms }) {
  // Import "SAP Langsung" (multi-UPT) — pelengkap data stock material dari file export
  // SAP resmi (Cara lain / Legacy). Menggantikan wizard cutover Surabaya lama.
  const [sapLangsungFile, setSapLangsungFile] = useState(null);
  const [sapLangsungRows, setSapLangsungRows] = useState(null); // null = belum upload; array hasil parse+scoping
  const [sapLangsungPreview, setSapLangsungPreview] = useState(null); // ringkasan KPI
  const [sapLangsungChecked, setSapLangsungChecked] = useState(new Set()); // Set rowId ("plant|material") terpilih utk diterapkan
  const [sapLangsungBusy, setSapLangsungBusy] = useState(false);
  const [sapLog, setSapLog] = useState([]);
  const [sapLogLoading, setSapLogLoading] = useState(true);
  const [sapLogReload, setSapLogReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!supabase) { setSapLog([]); setSapLogLoading(false); return; }
    setSapLogLoading(true);
    supabase.from("audit_log").select("at,user_name,detail").eq("entity","migrasi_sap_langsung").order("at",{ascending:false}).limit(15)
      .then(({ data, error }) => { if (!cancelled) { setSapLog(error ? [] : (data||[])); setSapLogLoading(false); } })
      .catch(() => { if (!cancelled) { setSapLog([]); setSapLogLoading(false); } });
    return () => { cancelled = true; };
  }, [sapLogReload]);
  // Import Transaksi TUG Lama — histori murni, independen dari wizard cutover SAP di atas.
  const [legacyTugRows, setLegacyTugRows] = useState(null); // null = belum upload; array grup per No Dokumen
  const [legacyTugChecked, setLegacyTugChecked] = useState(new Set());
  const [legacyTugBusy, setLegacyTugBusy] = useState(false);

  // ── Import Template Migrasi Stok (WARNOTO, per-UPT) — state TERPISAH dari
  // wizard SAP di atas supaya kedua alur tidak bentrok (lihat TUJUAN di spec). ──
  const [tplFile, setTplFile] = useState(null);
  const [tplRows, setTplRows] = useState(null); // null = belum upload; array hasil parse
  const [tplPreview, setTplPreview] = useState(null); // ringkasan KPI
  const [tplGuard, setTplGuard] = useState(null); // {ok, message, badRows}
  const [tplTargetUpt, setTplTargetUpt] = useState(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplSapMode, setTplSapMode] = useState("AUTO"); // "AUTO"|"SAP"|"NONSAP" — verifikasi Admin saat kolom "Status Material" kosong
  const [lastTplImport, setLastTplImport] = useState(null); // {katalogIdsBaru,stockIds,at,uptLabel,file} — undo import terakhir saja (YAGNI)

  // Parser "SAP Langsung" (multi-UPT) — baca sheet "UPT LAIN SAP" dari export SAP resmi
  // (layout tetap: preamble 6 baris, header di baris ber-kolom "Material"+"UU Stock", baris
  // pemisah "---" di antaranya) tapi deteksi header dicari, bukan hardcode index, supaya tetap
  // aman kalau preamble sedikit berubah panjang. Hanya baris Matl Type Desc mengandung
  // "Stock"/"Cadang" yang diambil (SAP-Persediaan/SAP-Cadang) — jenis lain diabaikan.
  function parseSapLangsung(workbook) {
    const ws = workbook.Sheets["UPT LAIN SAP"] || workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const norm = v => String(v||"").trim();
    let col = null, startIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const idxMaterial = r.findIndex(c => norm(c) === "Material");
      const idxStock = r.findIndex(c => norm(c).includes("UU Stock"));
      if (idxMaterial >= 0 && idxStock >= 0) {
        col = {
          plant: r.findIndex(c=>norm(c)==="Plant"),
          material: idxMaterial,
          name: r.findIndex(c=>norm(c)==="Material Description"),
          unit: r.findIndex(c=>norm(c)==="Unit"),
          matlType: r.findIndex(c=>norm(c).includes("Material Type Desc")),
          qty: idxStock,
          kategori: r.findIndex(c=>norm(c).includes("Valuation Description")),
        };
        startIdx = i + 1;
        break;
      }
    }
    if (!col) return [];

    // Agregasi per (plant+material) — 3 kasus di file resmi punya baris dobel dalam UPT
    // yang sama (harus dijumlah qty-nya), bukan duplikat entitas berbeda.
    const agg = new Map();
    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const materialRaw = r[col.material];
      if (materialRaw === null || materialRaw === undefined || materialRaw === "") continue;
      const matlType = norm(r[col.matlType]);
      const isCadang = /cadang/i.test(matlType);
      const isStock = /stock/i.test(matlType);
      if (!isCadang && !isStock) continue; // hanya SAP-Persediaan / SAP-Cadang
      const plant = norm(r[col.plant]);
      const material = normalizeKatalog(materialRaw);
      const name = norm(r[col.name]);
      const unit = norm(r[col.unit]);
      const qty = parseSAPNumber(r[col.qty]);
      const kategori = norm(r[col.kategori]);
      const jenisBarang = isCadang ? "Cadang" : "Persediaan";
      const key = plant + "|" + material;
      if (agg.has(key)) agg.get(key).qty += qty;
      else agg.set(key, { plant, material, name, unit, qty, jenisBarang, kategori });
    }
    return Array.from(agg.values());
  }

  async function handleSapLangsungFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSapLangsungBusy(true);
    try {
      const buf = await readXlsxArrayBufferSafe(file);
      const wb = XLSX.read(buf);
      const parsed = parseSapLangsung(wb);
      if (parsed.length === 0) { showToast("Tidak ada baris SAP-Persediaan/SAP-Cadang yang terbaca dari file ini.", "error"); setSapLangsungBusy(false); return; }

      // Scoping: uptList sudah discope parent (super admin = semua UPT, user UPT = UPT-nya
      // saja) — baris di luar scope atau Plant tak dikenal masuk "diabaikan", bukan error.
      const katalogByKode = new Map(katalogList.map(k => [normalizeKatalog(k.katalog), k]));
      // Stok existing per (uptId,katalogId) — dipakai hitung qty aktual & mode baru/update.
      // Sengaja INLINE per-UPT (bukan totalQtyForKatalog, itu lintas-UPT semua gudang).
      const stocksByUptKat = new Map();
      stocks.forEach(s => {
        const key = `${s.uptId||""}|${s.katalogId}`;
        if (!stocksByUptKat.has(key)) stocksByUptKat.set(key, []);
        stocksByUptKat.get(key).push(s);
      });
      let diabaikan = 0, baru = 0, updateBaseline = 0;
      const byUpt = {}, byJenis = { Persediaan: 0, Cadang: 0 };
      const katalogBaruSet = new Set();
      const checked = new Set();
      const rows = parsed.map(r => {
        const uptId = SAP_PLANT_TO_UPT[r.plant] || null;
        const katBaru = !katalogByKode.get(r.material);
        if (!uptId || !(uptList||[]).some(u => u.id === uptId)) {
          diabaikan++;
          const diabaikanReason = !uptId ? "Plant SAP tak dikenal" : "UPT di luar akses Anda";
          return { ...r, uptId, inScope: false, katBaru, diabaikanReason };
        }
        const upt = uptList.find(u => u.id === uptId);
        byUpt[upt.nama] = (byUpt[upt.nama]||0) + 1;
        byJenis[r.jenisBarang] = (byJenis[r.jenisBarang]||0) + 1;
        const kat = katalogByKode.get(r.material);
        const existingRows = kat ? (stocksByUptKat.get(`${uptId}|${kat.id}`) || []) : [];
        const mode = existingRows.length === 0 ? "baru" : "update";
        const qtyAktual = existingRows.reduce((s,x) => s + (Number(x.qty)||0), 0);
        const selisih = mode === "update" ? (r.qty - qtyAktual) : null;
        if (mode === "baru") baru++; else updateBaseline++;
        if (katBaru) katalogBaruSet.add(r.material);
        const rowId = r.plant + "|" + r.material;
        if (mode === "baru") checked.add(rowId);
        return { ...r, uptId, uptNama: upt.nama, inScope: true, katBaru, mode, qtyAktual, selisih, rowId };
      });

      // Urut: in-scope dulu (per UPT, lalu no katalog), diabaikan di paling bawah.
      rows.sort((a,b) => (a.inScope===b.inScope?0:a.inScope?-1:1) || (a.uptNama||"").localeCompare(b.uptNama||"") || a.material.localeCompare(b.material));
      setSapLangsungRows(rows);
      setSapLangsungPreview({ total: rows.length, diabaikan, baru, updateBaseline, byUpt, byJenis, katalogBaru: katalogBaruSet.size });
      setSapLangsungChecked(checked);
      setSapLangsungFile(file.name);
      showToast(`SAP Langsung: ${rows.length} baris terbaca.`, "success");
    } catch (err) {
      showToast("Gagal parse file: " + err.message, "error");
    }
    setSapLangsungBusy(false);
  }

  async function applySapLangsung() {
    const validRows = (sapLangsungRows||[]).filter(r => r.inScope && sapLangsungChecked.has(r.rowId));
    if (validRows.length === 0) { showToast("Pilih minimal satu baris untuk diterapkan.", "error"); return; }
    setSapLangsungBusy(true);
    try {
      // 1. Backup JSON dulu — jaring pengaman (mirror applyTplImport).
      const backup = { stocks, katalogList, backupAt: Date.now(), by: currentUser.id, note: "Pre-import backup SAP Langsung " + (sapLangsungFile||"") };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `warnoto_backup_pre_sap_langsung_${new Date().toISOString().slice(0,10)}.json`;
      a.click();

      const now = Date.now();
      // 2. Upsert katalog — mulai dari list existing, non-destruktif.
      const katalogByKode = new Map(katalogList.map(k => [normalizeKatalog(k.katalog), k]));
      const katalogChangedRows = [];
      validRows.forEach(r => {
        const existing = katalogByKode.get(r.material);
        if (existing) {
          const updated = { ...existing, name: existing.name || r.name, satuan: existing.satuan || r.unit, jenisBarang: existing.jenisBarang || r.jenisBarang, category: existing.category || r.kategori };
          katalogByKode.set(r.material, updated);
          katalogChangedRows.push(updated);
        } else {
          const kat = { id: "KAT-"+r.material, katalog: r.material, name: r.name, satuan: r.unit, jenisBarang: r.jenisBarang, category: r.kategori, sapStatus: "", createdAt: now };
          katalogByKode.set(r.material, kat);
          katalogChangedRows.push(kat);
        }
      });
      const nextKat = Array.from(katalogByKode.values());

      // 3. Upsert stocks — match existing by (uptId,katalogId) SAJA, ABAIKAN lokasiId (bug
      // lama: key ikutkan lokasiId → begitu admin isi lokasi, re-import cari key lokasi-kosong,
      // miss, bikin baris baru ber-ID sama "STK-SAP-plant-material" = collision). qty ADALAH
      // angka hidup (dimutasi TUG masuk/keluar & opname) — material baru insert qty SAP,
      // material sudah ada qty/lokasiId/id TIDAK disentuh, cuma baseline+identitas ringan.
      const stocksByUptKat = new Map();
      stocks.forEach(s => {
        const key = `${s.uptId||""}|${s.katalogId}`;
        if (!stocksByUptKat.has(key)) stocksByUptKat.set(key, []);
        stocksByUptKat.get(key).push(s);
      });
      const stocksChangedRows = [];
      validRows.forEach(r => {
        const kat = katalogByKode.get(r.material);
        const key = `${r.uptId}|${kat.id}`;
        const existingRows = stocksByUptKat.get(key) || [];
        if (existingRows.length === 0) {
          const row = {
            id: "STK-SAP-"+r.plant+"-"+r.material,
            katalogId: kat.id, uptId: r.uptId, lokasiId: null,
            qty: r.qty, unit: r.unit, name: r.name, katalog: r.material,
            category: r.kategori, jenisBarang: r.jenisBarang,
            sapBaselineQty: r.qty, sapBaselineAt: now,
            createdAt: now, updatedAt: now,
          };
          stocksByUptKat.set(key, [row]);
          stocksChangedRows.push(row);
        } else {
          const updatedRows = existingRows.map(s => ({
            ...s,
            name: s.name || r.name, unit: s.unit || r.unit,
            category: s.category || r.kategori, jenisBarang: s.jenisBarang || r.jenisBarang,
            sapBaselineQty: r.qty, sapBaselineAt: now, updatedAt: now,
          }));
          stocksByUptKat.set(key, updatedRows);
          stocksChangedRows.push(...updatedRows);
        }
      });
      const nextStocks = Array.from(stocksByUptKat.values()).flat();

      setKatalogList(nextKat);
      setStocks(nextStocks);
      // Katalog dulu supaya FK stocks.katalog_id valid sebelum stok diupsert.
      await saveToCloud({ katalogList: nextKat }, { katalogChangedRows });
      await saveToCloud({ stocks: nextStocks }, { stocksChangedRows });
      const baruCount = validRows.filter(r => r.mode==="baru").length;
      logAudit(currentUser, "IMPORT", "migrasi_sap_langsung", null, { total: validRows.length, baru: baruCount, updateBaseline: validRows.length-baruCount, perUpt: sapLangsungPreview?.byUpt || {} });

      showToast(`✅ SAP Langsung: ${baruCount} baru ditambah · ${validRows.length-baruCount} baseline diperbarui (qty aktual dijaga).`, "success");
      setSapLangsungRows(null); setSapLangsungPreview(null); setSapLangsungFile(null); setSapLangsungChecked(new Set());
      setSapLogReload(n => n+1);
    } catch (err) {
      showToast("Import gagal: " + err.message, "error");
    }
    setSapLangsungBusy(false);
  }

  function cancelSapLangsung() {
    setSapLangsungRows(null); setSapLangsungPreview(null); setSapLangsungFile(null); setSapLangsungChecked(new Set());
  }
  function toggleSapLangsungRow(rowId) {
    setSapLangsungChecked(prev => { const next = new Set(prev); next.has(rowId) ? next.delete(rowId) : next.add(rowId); return next; });
  }
  function toggleAllSapLangsung(checkedBool) {
    setSapLangsungChecked(checkedBool ? new Set((sapLangsungRows||[]).filter(r=>r.inScope).map(r=>r.rowId)) : new Set());
  }
  function selectOnlyBaruSapLangsung() {
    setSapLangsungChecked(new Set((sapLangsungRows||[]).filter(r=>r.inScope && r.mode==="baru").map(r=>r.rowId)));
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

  // ── IMPORT TRANSAKSI TUG LAMA — histori murni (APPROVED, legacyImport:true).
  // TIDAK memutasi stok, TIDAK masuk antrian approval, TIDAK menyentuh docSeq —
  // nomor dokumen dipakai apa adanya dari file, disimpan di docNumbers sesuai
  // key docType (pola sama dengan docKeyOf di App.jsx). ──
  function downloadLegacyTugTemplate() {
    const headers = ["No Dokumen","Jenis","Tanggal","Kode Katalog","Qty","Keterangan"];
    const rows = [
      headers,
      ["12.TUG-9/LOG.00.02/UPT-SBYA/I/2025","TUG-9","2025-01-15","KTL-001","10","Contoh baris 1 dokumen ini"],
      ["12.TUG-9/LOG.00.02/UPT-SBYA/I/2025","TUG-9","2025-01-15","KTL-002","5","Baris 2, No Dokumen sama = 1 transaksi"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{wch:32},{wch:10},{wch:12},{wch:14},{wch:8},{wch:32}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Transaksi Lama");
    XLSX.writeFile(wb, "Template_Import_Transaksi_TUG_Lama.xlsx");
  }

  async function handleLegacyTugFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const wb = await readWorkbookSafe(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = sanitizeRows(XLSX.utils.sheet_to_json(ws, { defval: "" }));
      if (raw.length === 0) { showToast("File kosong atau tidak ada baris data.", "error"); return; }
      if (!Object.prototype.hasOwnProperty.call(raw[0], "No Dokumen") || !Object.prototype.hasOwnProperty.call(raw[0], "Kode Katalog")) {
        showToast('Kolom wajib "No Dokumen" / "Kode Katalog" tidak ditemukan. Gunakan template.', "error"); return;
      }
      const groups = new Map(); // No Dokumen -> {docNo, docType, tanggal, items:[], errors:Set}
      let skippedNoDoc = 0;
      raw.forEach(r => {
        const docNo = String(r["No Dokumen"]||"").trim();
        if (!docNo) { skippedNoDoc++; return; }
        const docType = LEGACY_TUG_DOCTYPE[normalizeJenis(r["Jenis"])] || null;
        const tanggal = String(r["Tanggal"]||"").trim();
        const kodeKatalog = String(r["Kode Katalog"]||"").trim();
        const qty = parseIndoNumber(r["Qty"]);
        const keterangan = String(r["Keterangan"]||"").trim();
        const katalog = kodeKatalog ? katalogList.find(k=>(k.katalog||"").trim().toLowerCase()===kodeKatalog.toLowerCase()) : null;

        if (!groups.has(docNo)) groups.set(docNo, { docNo, docType, tanggal, items: [], errors: new Set() });
        const g = groups.get(docNo);
        if (!docType) g.errors.add("Jenis tidak dikenal");
        else if (g.docType && g.docType !== docType) g.errors.add("Jenis tidak konsisten untuk No Dokumen ini");
        if (!tanggal || isNaN(new Date(tanggal).getTime())) g.errors.add("Tanggal tidak valid");
        if (!kodeKatalog || !katalog) g.errors.add(`Katalog tidak dikenal: ${kodeKatalog||"(kosong)"}`);
        if (!qty || qty <= 0) g.errors.add("Qty tidak valid");
        g.items.push({ kodeKatalog, katalog, qty, keterangan });
      });

      // No Dokumen yang sudah ada di txns (cek semua docNumbers + id) dilewati, bukan error.
      const existingDocNos = new Set();
      txns.forEach(t => { Object.values(t.docNumbers||{}).forEach(v=>{ if (v) existingDocNos.add(v); }); existingDocNos.add(t.id); });

      const parsed = Array.from(groups.values()).map(g => ({ ...g, errors: Array.from(g.errors), alreadyExists: existingDocNos.has(g.docNo) }));
      setLegacyTugRows(parsed);
      setLegacyTugChecked(new Set(parsed.filter(g=>g.errors.length===0 && !g.alreadyExists).map(g=>g.docNo)));
      if (skippedNoDoc > 0) showToast(`${skippedNoDoc} baris diabaikan karena "No Dokumen" kosong.`, "info");
    } catch (err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
  }

  function toggleLegacyTugDoc(docNo) {
    setLegacyTugChecked(s => { const n = new Set(s); n.has(docNo) ? n.delete(docNo) : n.add(docNo); return n; });
  }

  async function applyLegacyTugImport() {
    const toApply = (legacyTugRows||[]).filter(g => legacyTugChecked.has(g.docNo) && g.errors.length===0 && !g.alreadyExists);
    if (toApply.length === 0) { showToast("Tidak ada dokumen valid yang dicentang.", "error"); return; }
    setLegacyTugBusy(true);
    const txnBaru = toApply.map(g => {
      const ts = new Date(g.tanggal).getTime() || Date.now();
      const keterangan = g.items.find(it=>it.keterangan)?.keterangan || `Import legacy ${g.docNo}`;
      return {
        id: `LEGACY-${uid().slice(-8)}`,
        docType: g.docType,
        docNumbers: { [LEGACY_TUG_DOCKEY[g.docType]]: g.docNo },
        stockItems: g.items.map(it => ({ katalogId: it.katalog.id, qty: it.qty, katalogMode: "existing", statusMaterial: "Material Sisa Baru" })),
        status: "APPROVED",
        legacyImport: true,
        keteranganUmum: keterangan,
        namaPekerjaan: keterangan,
        createdBy: currentUser.id, createdAt: ts,
        approvedBy: currentUser.id, approvedAt: ts,
      };
    });
    const newTxns = [...txnBaru, ...txns];
    setTxns(newTxns);
    await saveToCloud({ txns: newTxns });
    logAudit(currentUser, "IMPORT", "txns", null, { dokumen: txnBaru.length, rows: toApply.reduce((a,g)=>a+g.items.length,0) });
    showToast(`✅ ${txnBaru.length} dokumen transaksi lama berhasil diimpor (histori, tidak memutasi stok).`);
    setLegacyTugRows(null); setLegacyTugChecked(new Set());
    setLegacyTugBusy(false);
  }

  // ── Import Template Migrasi Stok (WARNOTO) — admin per-UPT memuat stok
  // mandiri via TEMPLATE_MIGRASI_STOK.xlsx (lihat scripts/gen_template_migrasi_stok.mjs). ──
  function downloadTplTemplate() {
    const headers = ["UPT","No Katalog","Nama Material","Satuan","Jenis Barang","Status Material","Merk","Type","Kategori","Qty","Harga Satuan","Min Qty","Gudang","Blok/Lokasi","Foto Nameplate","Foto Keseluruhan"];
    const contoh = ["UPT Gresik","1060011","TRF ACC;NGR 70kV 200 Ohm","U","Persediaan","SAP","","","HAR-Transformator",3,15000000,1,"Gudang Ketintang","Rak A-1","",""];
    const ws = XLSX.utils.aoa_to_sheet([headers, contoh]);
    ws["!cols"] = [{wch:14},{wch:12},{wch:36},{wch:8},{wch:16},{wch:16},{wch:12},{wch:12},{wch:22},{wch:8},{wch:14},{wch:8},{wch:20},{wch:14},{wch:42},{wch:42}];
    const petunjuk = [
      ["PETUNJUK PENGISIAN — TEMPLATE MIGRASI DATA STOK WARNOTO"],
      [""],
      ["1. Isi data di sheet \"Data Stok\". Satu baris = satu material di satu lokasi."],
      ["2. Kolom WAJIB: UPT, No Katalog, Nama Material, Satuan, Jenis Barang, Qty."],
      ["   SATU file = SATU UPT — jangan campur data antar-UPT dalam 1 file."],
      ["3. Jenis Barang harus persis: Persediaan | Persediaan Bursa | Pre Memory | Cadang"],
      ["   Status Material: SAP | Non-SAP (kosongkan = otomatis dari format kode katalog)"],
      ["4. Harga Satuan & Min Qty: angka saja, tanpa titik/koma/\"Rp\"."],
      ["5. Gudang & Blok/Lokasi: harus cocok Master Lokasi UPT tujuan, atau kosongkan (isi manual setelahnya)."],
      ["6. Foto: link URL https:// langsung tampil di aplikasi; boleh dikosongkan."],
      ["7. Hapus baris CONTOH sebelum diisi data asli."],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(petunjuk);
    wsInfo["!cols"] = [{wch:100}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsInfo, "Petunjuk");
    XLSX.utils.book_append_sheet(wb, ws, "Data Stok");
    XLSX.writeFile(wb, "TEMPLATE_MIGRASI_STOK.xlsx");
  }

  async function handleTplFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setTplBusy(true);
    try {
      const buf = await readXlsxArrayBufferSafe(file);
      const wb = XLSX.read(buf);
      const ws = wb.Sheets["Data Stok"] || wb.Sheets[wb.SheetNames.find(n => n !== "Petunjuk")] || wb.Sheets[wb.SheetNames[0]];
      const raw = sanitizeRows(XLSX.utils.sheet_to_json(ws, { defval: "" }));
      if (raw.length === 0) { showToast("File kosong atau tidak ada baris data.", "error"); setTplBusy(false); return; }
      const required = ["UPT","No Katalog","Nama Material","Satuan","Jenis Barang","Qty"];
      if (!required.every(h => Object.prototype.hasOwnProperty.call(raw[0], h))) {
        showToast("Kolom wajib tidak lengkap. Gunakan TEMPLATE_MIGRASI_STOK.xlsx.", "error"); setTplBusy(false); return;
      }

      // Guard UPT: file wajib 1 UPT, kosong/tercampur/tidak dikenal/bukan UPT admin -> blokir.
      const byUpt = new Map();
      const emptyRows = [];
      raw.forEach((r, i) => {
        const u = String(r["UPT"]||"").trim();
        const excelRow = i + 2;
        if (!u) { emptyRows.push(excelRow); return; }
        const key = tplNormUpt(u);
        if (!byUpt.has(key)) byUpt.set(key, { label: u, rows: [] });
        byUpt.get(key).rows.push(excelRow);
      });
      const uptGroups = [...byUpt.values()].sort((a,b) => b.rows.length - a.rows.length);
      let guard = { ok: true, message: "" };
      if (emptyRows.length) {
        guard = { ok: false, message: `Kolom UPT kosong di ${emptyRows.length} baris (Excel: ${emptyRows.slice(0,30).join(", ")}${emptyRows.length>30?", ...":""}).` };
      } else if (uptGroups.length > 1) {
        const [main, ...lain] = uptGroups;
        guard = { ok: false, message: `File tercampur ${uptGroups.length} UPT. Mayoritas "${main.label}" (${main.rows.length} baris). UPT lain: ` +
          lain.map(u => `"${u.label}" (baris Excel: ${u.rows.join(", ")})`).join("; ") + "." };
      }
      const targetUptLabel = uptGroups[0]?.label || "";
      const targetUpt = (uptList||[]).find(u => tplNormUpt(u.nama) === tplNormUpt(targetUptLabel));
      if (guard.ok && !targetUpt) {
        guard = { ok: false, message: `UPT "${targetUptLabel}" tidak dikenal di Master UPT.` };
      }
      if (guard.ok && currentUser?.uptId && targetUpt && currentUser.uptId !== targetUpt.id) {
        guard = { ok: false, message: `File ini untuk "${targetUptLabel}", bukan UPT Anda — tidak bisa diimpor.` };
      }

      const katalogKodeSet = new Set(katalogList.map(k => normalizeKatalog(k.katalog)));
      let lokasiKosong = 0, fotoCount = 0, katalogBaru = 0, katalogExisting = 0;
      const rows = raw.map((r, i) => {
        const excelRow = i + 2;
        const noKat = normalizeKatalog(String(r["No Katalog"]||"").trim());
        const nama = String(r["Nama Material"]||"").trim();
        const satuan = String(r["Satuan"]||"").trim();
        const jenisBarang = String(r["Jenis Barang"]||"").trim();
        const statusMaterial = String(r["Status Material"]||"").trim().toUpperCase();
        const sapStatus = statusMaterial === "NON-SAP" ? "Non-SAP" : statusMaterial === "SAP" ? "SAP" : "";
        const qty = tplNumOrNull(r["Qty"]);
        const errors = [];
        if (!noKat) errors.push("No Katalog kosong");
        if (!nama) errors.push("Nama Material kosong");
        if (!satuan) errors.push("Satuan kosong");
        if (!TPL_JENIS_ENUM.has(jenisBarang)) errors.push("Jenis Barang tidak valid");
        if (qty === null || qty < 0) errors.push("Qty tidak valid");

        const gudangNama = String(r["Gudang"]||"").trim();
        const blokKode = String(r["Blok/Lokasi"]||"").trim();
        let lokasiId = null, lokasiLabel = "";
        if (targetUpt && gudangNama) {
          const gudang = (gudangList||[]).find(g => g.uptId === targetUpt.id && (tplNormLoose(g.nama) === tplNormLoose(gudangNama) || tplNormLoose(g.kode) === tplNormLoose(gudangNama)));
          if (gudang && blokKode) {
            const lokasi = (lokasiList||[]).find(l => l.gudangId === gudang.id && tplNormLoose(l.kode) === tplNormLoose(blokKode));
            if (lokasi) { lokasiId = lokasi.id; lokasiLabel = `${gudang.nama} / ${lokasi.kode}`; }
          }
        }
        if (!lokasiId) lokasiKosong++;

        const fotoNameplate = keepRemoteStockPhoto(r["Foto Nameplate"]) || "";
        const fotoKeseluruhan = keepRemoteStockPhoto(r["Foto Keseluruhan"]) || "";
        if (fotoNameplate || fotoKeseluruhan) fotoCount++;

        const isNew = errors.length === 0 && !katalogKodeSet.has(noKat);
        if (errors.length === 0) { if (isNew) katalogBaru++; else katalogExisting++; }

        return {
          excelRow, noKat, nama, satuan, jenisBarang, sapStatus,
          merk: String(r["Merk"]||"").trim(), type: String(r["Type"]||"").trim(), kategori: String(r["Kategori"]||"").trim(),
          qty: qty || 0, harga: tplNumOrNull(r["Harga Satuan"]) || 0, minQty: tplNumOrNull(r["Min Qty"]) || 0,
          gudangNama, blokKode, lokasiId, lokasiLabel,
          fotoNameplate, fotoKeseluruhan,
          errors, isNew,
        };
      });

      setTplRows(rows);
      setTplGuard(guard);
      setTplTargetUpt(targetUpt || null);
      setTplPreview({
        total: rows.length,
        valid: rows.filter(r => r.errors.length === 0).length,
        invalid: rows.filter(r => r.errors.length > 0).length,
        katalogBaru, katalogExisting, lokasiKosong, foto: fotoCount,
      });
      setTplFile(file.name);
      showToast(`Template: ${rows.length} baris terbaca.`, guard.ok ? "success" : "error");
    } catch (err) {
      showToast("Gagal parse file: " + err.message, "error");
    }
    setTplBusy(false);
  }

  async function applyTplImport() {
    if (!tplGuard?.ok || !tplRows?.length || !tplTargetUpt) return;
    const validRows = tplRows.filter(r => r.errors.length === 0);
    if (validRows.length === 0) { showToast("Tidak ada baris valid untuk diterapkan.", "error"); return; }
    setTplBusy(true);
    try {
      // 1. Backup JSON dulu — jaring pengaman (mirror handleBackupAndApply di atas).
      const backup = { stocks, katalogList, lokasiList, backupAt: Date.now(), by: currentUser.id, note: "Pre-import backup Template Migrasi Stok " + (tplFile||"") };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `warnoto_backup_pre_tpl_migrasi_${new Date().toISOString().slice(0,10)}.json`;
      a.click();

      const now = Date.now();
      // 2. Merge katalog — upsert per kode, MULAI dari list existing (non-destruktif ke UPT lain).
      // katalogIdsTouched = baru+diupdate import ini (hint save ringan). katalogIdsBaru = HANYA
      // yang benar-benar baru dibuat (dipakai tombol Batalkan Migrasi — jangan ikut hapus katalog
      // existing yang cuma diupdate).
      const katalogByKode = new Map(katalogList.map(k => [normalizeKatalog(k.katalog), k]));
      const katalogIdsTouched = new Set();
      const katalogIdsBaru = [];
      validRows.forEach(r => {
        const sapStatus = r.sapStatus || (tplSapMode==="SAP" ? "SAP" : tplSapMode==="NONSAP" ? "Non-SAP" : "");
        const existing = katalogByKode.get(r.noKat);
        if (existing) {
          katalogByKode.set(r.noKat, { ...existing,
            satuan: r.satuan || existing.satuan,
            jenisBarang: r.jenisBarang || existing.jenisBarang,
            merk: r.merk || existing.merk,
            type: r.type || existing.type,
            keterangan: r.kategori || existing.keterangan,
            ...(sapStatus ? { sapStatus } : {}),
          });
          katalogIdsTouched.add(existing.id);
        } else {
          const katId = "KAT-" + r.noKat;
          katalogByKode.set(r.noKat, {
            id: katId, katalog: r.noKat, name: r.nama,
            category: r.kategori || r.nama.split(";")[0].trim() || "Material",
            jenisBarang: r.jenisBarang, satuan: r.satuan, merk: r.merk, type: r.type,
            keterangan: r.kategori, createdAt: now,
            ...(sapStatus ? { sapStatus } : {}),
          });
          katalogIdsTouched.add(katId);
          katalogIdsBaru.push(katId);
        }
      });
      const newKatalogList = Array.from(katalogByKode.values());

      // 3. Merge stocks — key upsert uptId+katalogId+lokasiId, non-destruktif ke baris lain.
      const stocksByKey = new Map(stocks.map(s => [`${s.uptId||""}|${s.katalogId}|${s.lokasiId||""}`, s]));
      const stockIdsTouched = new Set();
      validRows.forEach(r => {
        const kat = katalogByKode.get(r.noKat);
        const sapStatus = r.sapStatus || (tplSapMode==="SAP" ? "SAP" : tplSapMode==="NONSAP" ? "Non-SAP" : "");
        const key = `${tplTargetUpt.id}|${kat.id}|${r.lokasiId||""}`;
        const existing = stocksByKey.get(key);
        const row = {
          ...(existing||{}),
          id: existing?.id || uid(),
          katalogId: kat.id, lokasiId: r.lokasiId || null, uptId: tplTargetUpt.id,
          qty: r.qty, price: r.harga || existing?.price || 0, minQty: r.minQty || existing?.minQty || 0,
          unit: r.satuan, jenisBarang: r.jenisBarang, name: r.nama, katalog: r.noKat,
          category: kat.category,
          fotoNameplate: r.fotoNameplate || existing?.fotoNameplate,
          fotoKeseluruhan: r.fotoKeseluruhan || existing?.fotoKeseluruhan,
          sapBaselineQty: r.qty, sapBaselineAt: now,
          ...(sapStatus ? { sapStatus } : {}),
          createdAt: existing?.createdAt || now, updatedAt: now,
        };
        stocksByKey.set(key, row);
        stockIdsTouched.add(row.id);
      });
      const newStocks = Array.from(stocksByKey.values());

      setKatalogList(newKatalogList);
      setStocks(newStocks);
      // Katalog dulu supaya FK stocks.katalog_id valid sebelum stok di-upsert. Hint per baris
      // touched → sync ringan (bukan full-sync tabel `stocks`, yang bisa berat karena foto base64).
      await saveToCloud({ katalogList: newKatalogList }, { katalogChangedRows: newKatalogList.filter(k => katalogIdsTouched.has(k.id)) });
      await saveToCloud({ stocks: newStocks }, { stocksChangedRows: newStocks.filter(s => stockIdsTouched.has(s.id)) });
      logAudit(currentUser, "IMPORT", "migrasi_template", null, {
        rows: validRows.length, uptId: tplTargetUpt.id,
        katalogBaru: tplPreview?.katalogBaru||0, lokasiKosong: tplPreview?.lokasiKosong||0,
      });

      setLastTplImport({ katalogIdsBaru, stockIds: Array.from(stockIdsTouched), at: now, uptLabel: tplTargetUpt.nama, file: tplFile });

      showToast(
        `✅ Import selesai: ${tplPreview?.katalogBaru||0} katalog baru, ${validRows.length} baris stok diterapkan, ` +
        `${tplPreview?.lokasiKosong||0} lokasi belum termapping (isi manual), ${tplPreview?.foto||0} baris ada foto.`,
        "success"
      );
      setTplRows(null); setTplPreview(null); setTplGuard(null); setTplFile(null); setTplTargetUpt(null); setTplSapMode("AUTO");
    } catch (err) {
      showToast("Import gagal: " + err.message, "error");
    }
    setTplBusy(false);
  }

  // Undo import template terakhir — hapus baris stok+katalog baru yang dibuat import ini,
  // sync ke Supabase, lalu lupakan (cuma bisa undo yang TERAKHIR, bukan multi-level).
  async function undoLastTplImport() {
    if (!lastTplImport) return;
    if (!confirm(`Batalkan migrasi terakhir (${lastTplImport.uptLabel||"-"}, file ${lastTplImport.file||"-"})?\n${lastTplImport.stockIds.length} baris stok dan ${lastTplImport.katalogIdsBaru.length} katalog baru akan dihapus.`)) return;
    setTplBusy(true);
    try {
      const stockIdSet = new Set(lastTplImport.stockIds);
      const katIdSet = new Set(lastTplImport.katalogIdsBaru);
      const newStocks = stocks.filter(s => !stockIdSet.has(s.id));
      const newKatalogList = katalogList.filter(k => !katIdSet.has(k.id));
      setStocks(newStocks);
      setKatalogList(newKatalogList);
      // Tidak ada hint batch-delete di saveToCloud — hapus stok satu-satu (pola stocksDeletedId
      // existing). Katalog: tanpa hint → full sync dengan reconciliation-delete (mendeteksi baris
      // yang hilang), tabelnya jauh lebih kecil dari stocks jadi aman.
      for (const id of lastTplImport.stockIds) {
        await saveToCloud({ stocks: newStocks }, { stocksDeletedId: id });
      }
      if (katIdSet.size) await saveToCloud({ katalogList: newKatalogList });
      logAudit(currentUser, "DELETE", "migrasi_template_undo", null, { stockIds: lastTplImport.stockIds.length, katalogBaru: katIdSet.size });
      showToast(`↩️ Migrasi dibatalkan: ${lastTplImport.stockIds.length} baris stok dan ${katIdSet.size} katalog baru dihapus.`, "success");
      setLastTplImport(null);
    } catch (err) {
      showToast("Gagal membatalkan migrasi: " + err.message, "error");
    }
    setTplBusy(false);
  }

  // Blok "Import Histori Transaksi (TUG Lama)" — kolom kanan, sebelah Import Stok.
  const histBlock = can(currentUser, "aksi.import", rolePerms) ? (
    <div>
      <div style={{fontWeight:800,fontSize:13,color:C.text,marginBottom:10}}>Import Histori Transaksi (TUG Lama)</div>
      <div className="migration-upload-card migration-upload-card--legacy" style={{...sty.card,borderLeft:"4px solid #7c3aed"}}>
      <div style={{fontWeight:800,fontSize:13,marginBottom:6,color:"#6d28d9"}}>🕘 Import Transaksi TUG Lama</div>
      <p tabIndex={0} className="info-note" style={{fontSize:12,color:C.muted,marginBottom:12}}>
        Import histori transaksi TUG lama yang belum tercatat di WARNOTO. Hasilnya <b>histori murni</b> berstatus APPROVED — TIDAK memutasi stok, TIDAK masuk antrian approval. Baris dengan No Dokumen sama digabung jadi 1 transaksi multi-barang.
      </p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:legacyTugRows?14:0}}>
        <button style={sty.btn("ghost","sm")} onClick={downloadLegacyTugTemplate}>⬇️ Download Template</button>
        <label style={{...sty.btn("primary","sm"),cursor:"pointer"}}>
          📂 Upload File Excel
          <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleLegacyTugFile}/>
        </label>
        {legacyTugRows && <button style={sty.btn("ghost","sm")} onClick={()=>{setLegacyTugRows(null);setLegacyTugChecked(new Set());}}>Upload Ulang</button>}
      </div>
      {legacyTugRows && (
        <>
          <div style={{display:"flex",gap:14,fontSize:12,marginBottom:10,flexWrap:"wrap"}}>
            <span>Total Dokumen: <b>{legacyTugRows.length}</b></span>
            <span style={{color:C.green}}>Valid: <b>{legacyTugRows.filter(g=>g.errors.length===0 && !g.alreadyExists).length}</b></span>
            <span style={{color:C.red}}>Error: <b>{legacyTugRows.filter(g=>g.errors.length>0).length}</b></span>
            <span style={{color:"#92400e"}}>Sudah Ada: <b>{legacyTugRows.filter(g=>g.alreadyExists).length}</b></span>
          </div>
          <div className="mobile-card-table" style={{overflowX:"auto",maxHeight:340,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius: 10,marginBottom:14}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
                <tr>{["","No Dokumen","Jenis","Tanggal","Item","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {legacyTugRows.map(g => {
                  const disabled = g.errors.length>0 || g.alreadyExists;
                  const statusText = g.alreadyExists ? "Sudah ada, dilewati" : g.errors.length>0 ? g.errors.join("; ") : "OK";
                  return (
                    <tr tabIndex={0} className="mobile-card-table__row" key={g.docNo} style={{borderTop:`1px solid ${C.border}`,background:g.errors.length>0?"#fef2f2":g.alreadyExists?"#fefce8":undefined}}>
                      <td data-label="" style={{padding:"4px 8px"}}><input type="checkbox" checked={legacyTugChecked.has(g.docNo)} disabled={disabled} onChange={()=>toggleLegacyTugDoc(g.docNo)}/></td>
                      <td data-label="No Dokumen" className="mobile-card-table__title" style={{padding:"4px 8px",fontWeight:700}}>{g.docNo}</td>
                      <td data-label="Jenis" style={{padding:"4px 8px"}}>{g.docType||"-"}</td>
                      <td data-label="Tanggal" style={{padding:"4px 8px"}}>{g.tanggal||"-"}</td>
                      <td data-label="Item" style={{padding:"4px 8px"}}>{g.items.length}</td>
                      <td data-label="Status" style={{padding:"4px 8px",fontWeight:700,color:g.errors.length>0?C.red:g.alreadyExists?"#92400e":C.green}}>{statusText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button style={sty.btn("primary")} disabled={legacyTugBusy||legacyTugChecked.size===0} onClick={applyLegacyTugImport}>
            {legacyTugBusy?"Menyimpan...":`Terapkan (${legacyTugChecked.size} dokumen)`}
          </button>
        </>
      )}
      </div>
    </div>
  ) : null;

  return (
    <div className="admin-mobile-page migration-data-page">
      {/* Judul "Migrasi Data SAP/Non-SAP" sudah ditampilkan header Master Data
          di atas (lihat App.jsx ~line 5769) — h1 di sini dihapus supaya tidak
          dobel (ditemukan user 2026-07-04). */}

      {(migrasiPendingReview||[]).some(i=>i.status==="PENDING") && (
        <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid #f59e0b`}}>
          <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"#92400e"}}>
            📋 Menunggu Review Admin ({migrasiPendingReview.filter(i=>i.status==="PENDING").length} item baru dari Migrasi Data)
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
            {migrasiPendingReview.filter(i=>i.status==="PENDING").map(item=>(
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,border:`1px solid ${C.border}`,borderRadius: 10,padding:"8px 12px",background:"white"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{item.desc}</div>
                  <div style={{fontSize:12,color:C.muted}}>No. Katalog {item.noKat} • {item.jenisBarang} • Qty {item.qty} {item.satuan} • {item.harga?("Rp "+fmtNum(item.harga)):"-"} • dari {item.sourceFile}</div>
                </div>
                <span className="approval-actions approval-actions--compact">
                  <button className="approval-btn--approve" onClick={()=>approveMigrasiPending(item.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui</button>
                  <button className="approval-btn--reject" onClick={()=>rejectMigrasiPending(item.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="migration-upload-grid" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,alignItems:"start"}}>
        <div>
          <div style={{fontWeight:800,fontSize:13,color:C.text,marginBottom:10}}>Import Stok</div>
          <div className="migration-upload-card migration-upload-card--tpl" style={{...sty.card,marginBottom:12,borderLeft:"4px solid #16a34a"}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4,color:"#166534"}}>📦 Import Data Stok (Template WARNOTO)</div>
            <p style={{fontSize:12,color:C.muted,marginBottom:10}}>Migrasi stok per-UPT: katalog, qty, harga, foto, lokasi. Untuk semua UPT.</p>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <button style={sty.btn("ghost")} onClick={downloadTplTemplate}>⬇️ Download Template Kosong</button>
              <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                {tplBusy?"⏳ Memproses...":"📂 Upload Template (.xlsx)"}
                <input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleTplFile} disabled={tplBusy}/>
              </label>
              {tplFile && <span style={{fontSize:12,color:C.green,fontWeight:700}}>✅ {tplFile} ({tplRows?.length||0} baris)</span>}
              {lastTplImport && (
                <button style={sty.btn("ghost","sm")} disabled={tplBusy} onClick={undoLastTplImport}>↩️ Batalkan Migrasi Terakhir</button>
              )}
            </div>

            {tplPreview && (
              <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
                {!tplGuard?.ok ? (
                  <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius: 10,padding:12,marginBottom:12,fontSize:12,color:"#991b1b"}}>
                    <strong>⚠️ Import diblokir:</strong> {tplGuard?.message}
                  </div>
                ) : (
                  <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius: 10,padding:12,marginBottom:12,fontSize:12,color:"#166534"}}>
                    ✅ Guard UPT lolos — file untuk <strong>{tplTargetUpt?.nama}</strong>.
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:12}}>
                  {[
                    {label:"Total Baris",val:tplPreview.total},
                    {label:"Baris Valid",val:tplPreview.valid,color:C.green},
                    {label:"Baris Error",val:tplPreview.invalid,color:tplPreview.invalid?C.red:C.muted},
                    {label:"Katalog Baru",val:tplPreview.katalogBaru,color:"#f59e0b"},
                    {label:"Katalog Existing",val:tplPreview.katalogExisting},
                    {label:"Lokasi Tak Termapping",val:tplPreview.lokasiKosong,color:tplPreview.lokasiKosong?"#f59e0b":C.muted},
                    {label:"Foto Terpasang",val:tplPreview.foto},
                  ].map(kpi=>(
                    <div key={kpi.label} style={{...sty.card,padding:10}}>
                      <div style={{fontSize:12,color:C.muted}}>{kpi.label}</div>
                      <div style={{fontSize:15,fontWeight:800,color:kpi.color||C.text}}>{kpi.val}</div>
                    </div>
                  ))}
                </div>
                <div className="mobile-card-table" style={{...sty.card,padding:0,overflowX:"auto",marginBottom:12,maxHeight:300,overflowY:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:760}}>
                    <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                      <tr>{["Baris","No Katalog","Nama","Jenis","Status SAP","Qty","Lokasi","Foto","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {tplRows.slice(0,200).map((r,i)=>(
                        <tr tabIndex={0} className="mobile-card-table__row" key={i} style={{borderBottom:`1px solid ${C.border}`,background:r.errors.length?"#fef2f2":r.isNew?"#fefce8":"white"}}>
                          <td data-label="Baris" style={{padding:"5px 8px"}}>{r.excelRow}</td>
                          <td data-label="No Katalog" style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat||"-"}</td>
                          <td data-label="Nama" className="mobile-card-table__title" style={{padding:"5px 8px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{r.nama||"-"}</td>
                          <td data-label="Jenis" style={{padding:"5px 8px"}}>{r.jenisBarang||"-"}</td>
                          <td data-label="Status SAP" style={{padding:"5px 8px"}}>{resolveSapLabel(r.noKat, r.sapStatus || (tplSapMode==="SAP"?"SAP":tplSapMode==="NONSAP"?"Non-SAP":""))}</td>
                          <td data-label="Qty" style={{padding:"5px 8px",textAlign:"right"}}>{r.qty}</td>
                          <td data-label="Lokasi" style={{padding:"5px 8px"}}>{r.lokasiId ? r.lokasiLabel : <span style={{color:"#f59e0b"}}>— belum termapping</span>}</td>
                          <td data-label="Foto" style={{padding:"5px 8px",textAlign:"center"}}>{(r.fotoNameplate||r.fotoKeseluruhan)?"✅":"-"}</td>
                          <td data-label="Status" style={{padding:"5px 8px",fontWeight:700,color:r.errors.length?C.red:r.isNew?"#f59e0b":C.green}}>
                            {r.errors.length ? r.errors.join("; ") : r.isNew ? "🆕 Katalog baru" : "✅ Existing"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",marginBottom:12,fontSize:12,color:C.text}}>
                  <strong>Verifikasi Status Material:</strong>
                  {[["AUTO","Otomatis (dari kode)"],["SAP","Semua SAP"],["NONSAP","Semua Non-SAP"]].map(([val,label])=>(
                    <label key={val} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                      <input type="radio" name="tplSapMode" checked={tplSapMode===val} onChange={()=>setTplSapMode(val)}/>
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <button style={{...sty.btn("primary"),opacity:(!tplGuard?.ok||tplBusy)?0.6:1}} disabled={!tplGuard?.ok||tplBusy} onClick={applyTplImport}>
                    {tplBusy?"⏳ Menerapkan...":"✅ Terapkan Migrasi"}
                  </button>
                  <button style={sty.btn("ghost")} disabled={tplBusy} onClick={()=>{setTplRows(null);setTplPreview(null);setTplGuard(null);setTplFile(null);setTplTargetUpt(null);setTplSapMode("AUTO");}}>Upload Ulang</button>
                </div>
              </div>
            )}
          </div>

          <div className="migration-upload-card migration-upload-card--sap" style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.accent}`}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4,color:C.accent}}>📦 Import Data Stok (Template SAP)</div>
            <p tabIndex={0} className="info-note" style={{fontSize:12,color:C.muted,margin:"0 0 10px",lineHeight:1.5}}>Sumber: export SAP <code>ZM_LAP_PERS_LOG</code> (sheet "UPT LAIN SAP") — hanya material SAP-Persediaan &amp; SAP-Cadang. {currentUser?.uptId ? "Baris di luar UPT Anda otomatis diabaikan." : "Semua UPT diproses, terpisah per UPT."}</p>
            <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
              <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                {sapLangsungBusy?"⏳ Memproses...":"📂 Upload File Export SAP (.xlsx)"}
                <input type="file" accept=".xlsx" aria-label="Upload file export SAP Langsung (.xlsx)" style={{display:"none"}} onChange={handleSapLangsungFile} disabled={sapLangsungBusy}/>
              </label>
              {sapLangsungFile && <span style={{fontSize:12,color:C.text}}>{sapLangsungFile} · {sapLangsungRows?.length||0} baris terbaca</span>}
            </div>
            {sapLangsungPreview && (
              <div style={{marginTop:4,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
                <div style={{display:"flex",flexWrap:"wrap",alignItems:"baseline",gap:"4px 14px",padding:"10px 14px",marginBottom:12,background:C.bg||"#f8fafc",border:`1px solid ${C.border}`,borderRadius: 10,fontSize:12}}>
                  <span><b style={{fontSize:13,color:C.accent}}>{sapLangsungChecked.size}</b> terpilih</span>
                  <span style={{color:C.border}}>·</span>
                  <span><b style={{fontSize:13,color:"#b45309"}}>{sapLangsungPreview.baru}</b> baru</span>
                  <span style={{color:C.border}}>·</span>
                  <span><b style={{fontSize:13,color:C.text}}>{sapLangsungPreview.updateBaseline}</b> update baseline</span>
                  <span style={{color:C.border}}>·</span>
                  <span><b style={{fontSize:13,color:C.text}}>{sapLangsungPreview.katalogBaru}</b> katalog baru</span>
                  <span style={{color:C.border}}>·</span>
                  <span><b style={{fontSize:13,color:sapLangsungPreview.diabaikan?C.red:C.text}}>{sapLangsungPreview.diabaikan}</b> diabaikan</span>
                </div>
                {Object.keys(sapLangsungPreview.byUpt).length>0 && (
                  <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
                    Per UPT: {Object.entries(sapLangsungPreview.byUpt).map(([nama,n])=>`${nama} (${n})`).join(", ")}
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:8}}>
                  <button style={sty.btn("ghost","sm")} onClick={()=>toggleAllSapLangsung(true)}>Pilih semua (in-scope)</button>
                  <button style={sty.btn("ghost","sm")} onClick={selectOnlyBaruSapLangsung}>Hanya yang baru</button>
                </div>
                <div className="mobile-card-table" style={{maxHeight:360,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius: 10,marginBottom:12}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead style={{position:"sticky",top:0,background:C.surface,boxShadow:`0 1px 0 ${C.border}`}}>
                      <tr>
                        <th style={{padding:8,textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                          <input type="checkbox" aria-label="Pilih semua"
                            checked={sapLangsungRows.some(r=>r.inScope) && sapLangsungRows.filter(r=>r.inScope).every(r=>sapLangsungChecked.has(r.rowId))}
                            onChange={e=>toggleAllSapLangsung(e.target.checked)}
                          />
                        </th>
                        {["No Katalog","Nama Material","UPT","Jenis","Qty SAP","Status","Selisih"].map(h=>(
                          <th key={h} style={{textAlign:h==="Qty SAP"?"right":"left",padding:8,borderBottom:`1px solid ${C.border}`,color:C.muted,fontWeight:800,fontSize:12,textTransform:"uppercase",letterSpacing:".3px"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sapLangsungRows.map((r,i)=>(
                        <tr tabIndex={0} className="mobile-card-table__row" key={r.plant+"-"+r.material+"-"+i} style={{opacity:r.inScope?1:0.45}}>
                          <td data-label="" style={{padding:8,textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                            {r.inScope && <input type="checkbox" aria-label={`Pilih baris ${r.material}`} checked={sapLangsungChecked.has(r.rowId)} onChange={()=>toggleSapLangsungRow(r.rowId)}/>}
                          </td>
                          <td data-label="No Katalog" className="mobile-card-table__title" style={{padding:8,borderBottom:`1px solid ${C.border}`}}>
                            {r.material}
                            {r.katBaru && <span title="Katalog baru" style={{marginLeft:6,color:"#b45309",fontWeight:800}}>•</span>}
                          </td>
                          <td data-label="Nama Material" style={{padding:8,borderBottom:`1px solid ${C.border}`}}>{r.name}</td>
                          <td data-label="UPT" style={{padding:8,borderBottom:`1px solid ${C.border}`}}>{r.uptNama||"—"}</td>
                          <td data-label="Jenis" style={{padding:8,borderBottom:`1px solid ${C.border}`}}><span style={sty.jenisBadge(r.jenisBarang)}>{r.jenisBarang}</span></td>
                          <td data-label="Qty SAP" style={{padding:8,textAlign:"right",borderBottom:`1px solid ${C.border}`,fontVariantNumeric:"tabular-nums"}}>{fmtNum(r.qty)} {r.unit}</td>
                          {r.inScope ? (
                            <>
                              <td data-label="Status" style={{padding:8,borderBottom:`1px solid ${C.border}`}}>
                                <span style={{display:"inline-block",padding:"2px 8px",borderRadius:999,fontWeight:700,background:r.mode==="baru"?"#fef3c7":"#dbeafe",color:r.mode==="baru"?"#b45309":"#1d4ed8"}}>{r.mode==="baru"?"Baru":"Update baseline"}</span>
                              </td>
                              <td data-label="Selisih" style={{padding:8,borderBottom:`1px solid ${C.border}`,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>
                                {r.mode==="update" ? (
                                  <span style={{color:r.selisih<0?C.red:C.muted}}>{fmtNum(r.qtyAktual)} → {fmtNum(r.qty)} (Δ{r.selisih>0?"+":""}{fmtNum(r.selisih)})</span>
                                ) : "—"}
                              </td>
                            </>
                          ) : (
                            <td colSpan={2} style={{padding:8,borderBottom:`1px solid ${C.border}`,color:C.muted,fontStyle:"italic"}}>Diabaikan — {r.diabaikanReason}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center"}}>
                  <button style={sty.btn("ghost")} disabled={sapLangsungBusy} onClick={cancelSapLangsung}>↺ Batal / Upload Ulang</button>
                  <button style={{...sty.btn("primary"),opacity:(sapLangsungBusy||sapLangsungChecked.size===0)?0.6:1}} disabled={sapLangsungBusy||sapLangsungChecked.size===0} onClick={applySapLangsung}>
                    {sapLangsungBusy?"⏳ Menerapkan...":`✅ Terapkan (${sapLangsungChecked.size} terpilih)`}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{...sty.card,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Riwayat Import SAP Langsung</div>
            {sapLogLoading ? (
              <div style={{fontSize:12,color:C.muted}}>Memuat...</div>
            ) : sapLog.length === 0 ? (
              <div style={{fontSize:12,color:C.muted}}>Belum ada riwayat import.</div>
            ) : (
              <div>
                {sapLog.map((log,i) => (
                  <div key={i} style={{padding:"8px 0",borderBottom:i<sapLog.length-1?`1px solid ${C.border}`:"none"}}>
                    <div style={{fontSize:12,color:C.text}}>
                      {fmtDate(log.at)} · {log.user_name||"—"} · {log.detail?.total??0} material · {log.detail?.baru??0} baru · {log.detail?.updateBaseline??0} update baseline
                    </div>
                    {log.detail?.perUpt && Object.keys(log.detail.perUpt).length>0 && (
                      <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                        {Object.entries(log.detail.perUpt).map(([nama,n])=>`${nama} ${n}`).join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
                <div style={{fontSize:12,color:C.muted,marginTop:8}}>Riwayat lengkap ada di menu Audit Log.</div>
              </div>
            )}
          </div>
        </div>
        {histBlock}
        </div>

      {/* Riwayat migrasi TUG-15 */}
      {migratedTug15History.length > 0 && (
        <div style={{...sty.card,marginTop:16}}>
          <div style={{fontWeight:700,marginBottom:8}}>📋 Histori TUG-15 Migrasi ({migratedTug15History.length} transaksi)</div>
          <p tabIndex={0} className="info-note" style={{fontSize:12,color:C.muted,marginBottom:8}}>Data histori dari sebelum cutover — tampil di TUG-15 dengan badge "MIGRASI", tidak mempengaruhi stok aktif.</p>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {migratedTug15History.slice(0,20).map((t,i)=>(
              <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12,display:"flex",gap:12}}>
                <span style={{fontWeight:700,color:C.accent}}>{t.id}</span>
                <span style={{color:C.muted}}>{t.docType} — {fmtDateOnly(t.createdAt)}</span>
                <span style={{padding:"1px 6px",borderRadius: 10,background:"#f3f4f6",fontSize:12}}>MIGRASI</span>
              </div>
            ))}
            {migratedTug15History.length > 20 && <div style={{padding:8,color:C.muted,fontSize:12,textAlign:"center"}}>...dan {migratedTug15History.length-20} transaksi lainnya</div>}
          </div>
        </div>
      )}

    </div>
  );
}
