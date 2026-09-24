// Komponen StockOpnameTab — dipindah dari App.jsx (refactor Fase 5c).
import { useState, useRef, useEffect } from "react";
import { useHardwareScanner } from "../hooks/useHardwareScanner.js";
import { supabase } from "../supabaseClient.js";
import { fmtDate, parseSAPFile, parseUsulanPencocokanXLSX, scanUrlFor } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole } from "../lib/roles.js";
import { can } from "../lib/perms.js";
import { buildStockOpnamePackageHTML, downloadLembarHitungHTML } from "../lib/docBuilders.js";
import { applyMaraNameSearch, normalizeKatalog, extractKatalogIdFromScan, sumHitungPerLokasi, applyQtyToItem, itemCounted, allBloksSelesai, getItemBlocks, blokKeyOf, blokProgress, resolveSapLabel, stockSapLabel, sourceLotLabel, getSourceLot, sourceLotRowsForCatalog } from "../lib/sap.js";
import { OperationsHero } from "./OperationsHero.jsx";
import { OpnameLapanganView } from "./OpnameLapanganView.jsx";
import { PindahBlokModal } from "./PindahBlokModal.jsx";
import * as XLSX from "xlsx";
import { readXlsxArrayBufferSafe } from "../lib/xlsxImport.js";
import { SAP_OPNAME_CATEGORIES, getSapOpnameCategory, isSapOpnameItem, opnameProgress, childOpnameMatches, parseStockOpnamePidRefs, resolveStockOpnameDocumentIdentity, buildStockOpnameDocumentMeta, normalizeStockOpnamePerson, canRestoreOpnameDraft, mergeOpnameForSave } from "../lib/stockOpnameFlow.js";
import { ArrowRight, Barcode, CheckCircle, FileArrowUp, Image, Tag } from "@phosphor-icons/react";
import { StockOpnameApprovalReview } from "./StockOpnameApprovalReview.jsx";
import { comparisonForItem, itemNeedsStockOpnameNote, stockOpnameDiscrepancyNoteErrors } from "../lib/stockOpnameReconciliation.js";
import { downloadStockOpnameExcel } from "../lib/stockOpnameExcel.js";

export function StockOpnameTab({ opnameList, stocks, katalogList, currentUser, users, sty, C,
  saveOpname, submitOpname, approveOpname_Asman, rejectOpname, updateOpnameTugReference, saveOpnameDocumentMeta, deleteOpname,
  openScanner, showToast, gudangList, lokasiList, addNonStockFoundItem, isMobile, uptList, rolePerms,
  setStocks, saveToCloud, visibleGudangList, stockVisibleGudangList, stockGudangFilter, setStockGudangFilter,
  uploadStockFoto, showWork=true, showHistory=true, onOpenWork }) {

  const sortedGudangList = [...(gudangList || [])].sort((a,b) => String(a.kode || a.nama || "").localeCompare(String(b.kode || b.nama || ""), "id", { numeric:true, sensitivity:"base" }));
  const sortedLokasiList = [...(lokasiList || [])].sort((a,b) => String(a.kode || a.nama || "").localeCompare(String(b.kode || b.nama || ""), "id", { numeric:true, sensitivity:"base" }));

  const [activeOpname, setActiveOpname] = useState(null);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("semua");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reviewApproval, setReviewApproval] = useState(null);
  const [filterSelisihOnly, setFilterSelisihOnly] = useState(false);
  const reviewSelisihRef = useRef(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [tugReferenceDrafts, setTugReferenceDrafts] = useState({});
  const [highlightIdx, setHighlightIdx] = useState(null); // baris hasil scan QR — cuma bantu temukan & fokus, bukan pengganti hitung fisik
  const qtyInputRefs = useRef({});
  const [pageSize, setPageSize] = useState(10);
  const [dragActive, setDragActive] = useState(false); // Fase 0: dropzone PID
  const [showBlokProgress, setShowBlokProgress] = useState(false); // Progres per blok collapse default (opt-in, filter utama di toolbar)
  const dropInputRef = useRef(null);
  // Fase 1d: blok (lokasiId | "_TANPA_LOKASI") yang disentuh perangkat INI, per sesi (keyed by
  // opn.id) — dikirim ke saveOpname supaya merge-on-save cuma menimpa blok yang benar diedit di
  // sini, blok lain (device lain) diambil dari server. Ref (bukan state) supaya persist per sesi
  // tanpa perlu direset manual tiap ganti activeOpname.
  const touchedRef = useRef({});
  const lapanganSaveQueueRef = useRef(Promise.resolve());
  const activeOpnameRef = useRef(activeOpname);
  const desktopSaveTimerRef = useRef(null);
  const desktopDirtyRef = useRef(new Set());
  const editGenerationRef = useRef({});
  const [desktopSaveState, setDesktopSaveState] = useState("idle");
  // Fase 1e: dialog pilih gudang setelah PID di-parse & ternyata memuat >1 gudang.
  const [gudangSplitDialog, setGudangSplitDialog] = useState(null);
  const [moveStock, setMoveStock] = useState(null); // {st, lok, gdg} — trigger modal Pindah Blok dari chip

  function handleCloseMove() {
    const kid = moveStock?.st?.katalogId;
    const stockId = moveStock?.st?.id;
    if (kid) setActiveOpname(prev => prev ? { ...prev, items: prev.items.map(it => {
      // New sessions identify a lot by stockId; old sessions have no stockId.
      const matches = stockId ? it.stockId === stockId : it.katalogId === kid && !it.stockId;
      if (!matches) return it;
      const rows = stockId ? stocks.filter(s => s.id === stockId) : sourceLotRowsForCatalog(stocks, kid);
      return { ...it, lokasiBreakdown: buildLokasiBreakdown(rows) };
    }) } : prev);
    setMoveStock(null);
  }
  // Fase 2d: layar hitung lapangan satu-tangan (HP/tablet) — overlay di atas panel ini, z-index
  // di BAWAH modal Tambah Material (1000) supaya modal itu tetap bisa dibuka dari lapangan tanpa
  // duplikasi form (lihat renderPanel -> tambahModal).
  const [lapanganMode, setLapanganMode] = useState(false);

  // Fase F: metadata paket resmi disimpan pada JSON sesi selesai agar lintas perangkat.
  const [baPrintOpn, setBaPrintOpn] = useState(null);
  const [baForm, setBaForm] = useState(null);
  useEffect(() => { activeOpnameRef.current = activeOpname; }, [activeOpname]);
  useEffect(() => () => {
    if (desktopSaveTimerRef.current) clearTimeout(desktopSaveTimerRef.current);
  }, []);
  useEffect(() => {
    if (!activeOpname?.id) return;
    const incoming = opnameList.find(opn => opn.id === activeOpname.id);
    if (!incoming || Number(incoming.updatedAt || 0) <= Number(activeOpname.updatedAt || 0)) return;
    const dirty = desktopDirtyRef.current.has(activeOpname.id);
    setActiveOpname(prev => {
      if (!prev || prev.id !== incoming.id) return prev;
      if (!dirty) return incoming;
      try {
        return mergeOpnameForSave(prev, incoming, [...(touchedRef.current[incoming.id] || [])]);
      } catch {
        return prev;
      }
    });
  }, [opnameList, activeOpname?.id, activeOpname?.updatedAt]);
  useEffect(() => {
    if (!activeOpname) return;
    setSapCategoryFilter("");
    setFilterGudangId(""); setFilterLokasiId(""); setFilterJenis("");
    setFilterSelisihOnly(reviewSelisihRef.current);
    reviewSelisihRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOpname?.id]);
  // Recovery lokal hanya berlaku untuk versi server yang menjadi asal draft tersebut.
  // Cache lama/legacy tidak boleh menimpa hitungan yang lebih baru dari perangkat lain.
  const draftKey = id => `warnoto_opname_draft_${id}`;
  function persistDraftLocal(opn) {
    if (!opn?.id || opn.status !== "DRAFT") return;
    try {
      localStorage.setItem(draftKey(opn.id), JSON.stringify({
        items: opn.items,
        baseUpdatedAt: opn.updatedAt || null,
        at: Date.now(),
      }));
    } catch {}
  }

  function scheduleDesktopSave(delay = 450) {
    if (!activeOpnameRef.current?.id || activeOpnameRef.current.status !== "DRAFT") return;
    setDesktopSaveState("saving");
    if (desktopSaveTimerRef.current) clearTimeout(desktopSaveTimerRef.current);
    desktopSaveTimerRef.current = setTimeout(() => {
      desktopSaveTimerRef.current = null;
      saveDesktopQty();
    }, delay);
  }

  useEffect(() => {
    if (!activeOpname?.id || activeOpname.status !== "DRAFT") return;
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(activeOpname.id)) || "null");
      if (canRestoreOpnameDraft(activeOpname, draft)) {
        setActiveOpname(prev => (prev && prev.id === activeOpname.id ? { ...prev, items: draft.items } : prev));
        showToast("Hitungan lapangan lokal dipulihkan");
      } else if (draft?.items) {
        localStorage.removeItem(draftKey(activeOpname.id));
        showToast("Draft lokal lama tidak dipulihkan agar data server tidak tertimpa.", "error");
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOpname?.id]);
  useEffect(() => setTugReferenceDrafts({}), [activeOpname?.id]);
  useEffect(() => {
    if (!activeOpname?.id || (!lapanganMode && !desktopDirtyRef.current.has(activeOpname.id) && desktopSaveState !== "error")) return;
    try {
      localStorage.setItem(draftKey(activeOpname.id), JSON.stringify({
        items: activeOpname.items,
        baseUpdatedAt: activeOpname.updatedAt || null,
        at: Date.now(),
      }));
    } catch {}
  }, [activeOpname, lapanganMode, desktopSaveState]);

  // Fase 1f: filter Gudang/Blok di toolbar tabel item.
  const [filterGudangId, setFilterGudangId] = useState("");
  const [filterLokasiId, setFilterLokasiId] = useState("");
  const [filterJenis, setFilterJenis] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [sapCategoryFilter, setSapCategoryFilter] = useState("");

  // "Tambah Material Ditemukan" (Opname Non-SAP) — form untuk barang fisik yang belum
  // tercatat sama sekali di sistem, ditemukan sambil opname jalan.
  const [tambahModal, setTambahModal] = useState(false);
  const [tambahForm, setTambahForm] = useState({ nama:"", satuan:"", qty:"", gudangId:"", lokasiId:"", foto:null });
  const [maraQuery, setMaraQuery] = useState("");
  const [maraResults, setMaraResults] = useState([]);
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraPicked, setMaraPicked] = useState(null); // {kode_material, nama, satuan} atau null
  const [maraSkip, setMaraSkip] = useState(false); // user pilih "Tidak ada di MARA / lewati dulu"
  const [tambahBusy, setTambahBusy] = useState(false);
  const [qrResult, setQrResult] = useState(null); // katalog object baru, tampilkan label QR setelah simpan

  // Antrian dari file "Usulan Pencocokan MARA" yang di-upload — starting point untuk
  // "Tambah Material Ditemukan", BUKAN jalur upload-langsung-masuk-sistem. Tiap baris tetap
  // wajib direview satu per satu (qty fisik + lokasi diisi ulang saat itu), cuma nama/kandidat
  // kode MARA-nya sudah keisi duluan supaya Admin tidak perlu cari dari nol.
  const [tambahQueue, setTambahQueue] = useState([]);
  const [queueUploadBusy, setQueueUploadBusy] = useState(false);
  const [activeQueueId, setActiveQueueId] = useState(null); // baris antrian yang sedang diproses di modal

  async function handleUploadUsulan(e) {
    const f = e.target.files[0]; if (!f) return;
    setQueueUploadBusy(true);
    try {
      const buf = await readXlsxArrayBufferSafe(f);
      const rows = parseUsulanPencocokanXLSX(buf);
      if (!rows.length) { showToast("File tidak punya baris yang bisa dibaca (cek sheet 'usulan_pencocokan').","error"); }
      else { setTambahQueue(rows); showToast(`✅ ${rows.length} baris usulan dimuat — proses satu per satu lewat daftar di bawah.`); }
    } catch (err) {
      showToast("Gagal membaca file: " + err.message, "error");
    }
    setQueueUploadBusy(false);
    e.target.value = "";
  }

  async function searchMaraForOpname(q) {
    setMaraQuery(q); setMaraPicked(null);
    if (!q || q.trim().length < 2) { setMaraResults([]); return; }
    if (!supabase) return;
    setMaraLoading(true);
    const { data, error } = await applyMaraNameSearch(
      supabase.from("mara_catalog").select("kode_material,nama,satuan"),
      q
    ).limit(15);
    setMaraLoading(false);
    setMaraResults(error ? [] : (data || []));
  }

  function openTambahModal(queueItem) {
    setTambahForm({ nama:queueItem?.nama||"", satuan:queueItem?.satuanFile||"", qty:"", gudangId:"", lokasiId:"", foto:null });
    setMaraQuery(""); setMaraResults([]); setMaraSkip(false);
    // Kalau baris antrian sudah punya kandidat MARA (skor KUAT/LEMAH), langsung pre-fill —
    // Admin tetap bisa tap "Ganti" kalau ternyata salah/mau cari ulang.
    setMaraPicked(queueItem?.maraCode ? { kode_material: queueItem.maraCode, nama: queueItem.maraNama, satuan: queueItem.satuanFile } : null);
    setActiveQueueId(queueItem?.id || null);
    setQrResult(null);
    setTambahModal(true);
  }

  async function submitTambahMaterial() {
    const f = tambahForm;
    if (!f.nama.trim()) { showToast("Nama material wajib diisi.","error"); return; }
    if (!f.qty || Number(f.qty) <= 0) { showToast("Qty fisik wajib diisi.","error"); return; }
    if (!f.lokasiId) { showToast("Lokasi (Gudang/Blok) wajib diisi.","error"); return; }
    if (!maraPicked && !maraSkip) { showToast("Cari & pilih kode MARA dulu, atau tap \"Tidak ada di MARA / lewati dulu\".","error"); return; }
    setTambahBusy(true);
    const newKatalog = await addNonStockFoundItem({
      opnameId: activeOpname.id,
      nama: f.nama.trim(),
      katalogCode: maraPicked?.kode_material || null,
      satuan: maraPicked?.satuan || f.satuan || "-",
      qty: Number(f.qty),
      lokasiId: f.lokasiId,
      foto: f.foto,
      belumDicocokkanMara: !maraPicked && maraSkip,
    });
    setTambahBusy(false);
    if (!newKatalog) return;
    setActiveOpname(prev => ({
      ...prev,
      items: [...(prev.items||[]), {
        katalogId: newKatalog.id, namaBarang: newKatalog.name, noKatalog: newKatalog.katalog,
        satuan: newKatalog.satuan, qtySistem: 0, qtsFisik: Number(f.qty), selisih: 0,
        statusItem: "MATERIAL_BARU_NONSAP", keterangan: "", lokasiId: f.lokasiId,
        lokasiBreakdown: [], hitungPerLokasi: { [f.lokasiId]: { qty:Number(f.qty), at:Date.now(), by:currentUser?.id } },
        fotoKeseluruhan: newKatalog.fotoKeseluruhan || null, belumDicocokkanMara: !maraPicked && maraSkip,
      }],
    }));
    setQrResult(newKatalog);
    if (activeQueueId) {
      setTambahQueue(q => q.map(item => item.id === activeQueueId ? { ...item, status: "DONE" } : item));
    }
    showToast(`✅ "${newKatalog.name}" tersimpan (${newKatalog.katalog})`);
  }

  function skipQueueItem(id) {
    setTambahQueue(q => q.map(item => item.id === id ? { ...item, status: "SKIP" } : item));
  }

  // Scan QR label material (Kartu Gantung TUG-2) untuk LOMPAT ke baris yang benar di tabel opname
  // ini — TIDAK mengisi qty otomatis, cuma navigasi. Angka hasil hitung fisik tetap wajib diketik
  // manual (aturan yang disepakati user 2026-07-07: scan bukan pengganti hitung fisik).
  function runOpnameScan(code) {
    const items = activeOpname?.items || [];
    const scannedKatalogId = extractKatalogIdFromScan(code);
    let idx = scannedKatalogId ? items.findIndex(it => it.katalogId === scannedKatalogId) : -1;
    if (idx < 0) idx = items.findIndex(it => it.noKatalog && normalizeKatalog(it.noKatalog) === normalizeKatalog(code));
    if (idx < 0) { showToast(`Kode ${code} tidak ditemukan di daftar item opname ini`, "error"); return; }
    const filteredPosition = getFilteredIndexed().findIndex(({ idx: filteredIdx }) => filteredIdx === idx);
    if (filteredPosition < 0) {
      showToast(`Material ${items[idx].namaBarang} tidak ada pada filter/blok aktif.`, "error");
      return;
    }
    setPage(Math.floor(filteredPosition / pageSize));
    setHighlightIdx(idx);
    showToast(`📷 Ditemukan: ${items[idx].namaBarang} — ketik qty hasil hitung fisik.`);
    setTimeout(() => {
      const el = qtyInputRefs.current[idx];
      if (el) { el.focus(); el.scrollIntoView({behavior:"smooth", block:"center"}); }
    }, 50);
  }

  function handleScanQty() {
    openScanner({ onDetect: runOpnameScan });
  }

  // Scanner hardware — hanya aktif saat form opname (SAP/Non-SAP) sedang dibuka.
  useHardwareScanner(runOpnameScan, { enabled: activeOpname?.status==="DRAFT" });

  // ── SAP CSV Parser ──────────────────────────────────────────────────────
  // Fase 1b: pecah qty sistem per lokasi/gudang (dari baris stok yang SUDAH difilter untuk
  // menghitung qtySistem — tanpa query baru, cuma map di loop yang sama).
  function buildLokasiBreakdown(katRows) {
    return katRows.map(s=>{
      const lok = lokasiList?.find(l=>l.id===s.lokasiId);
      const gud = gudangList?.find(g=>g.id===lok?.gudangId);
      return { stockId:s.id, sourceLabel:sourceLotLabel(s), lokasiId: s.lokasiId||null, lokasiKode: lok?.kode||null, gudangId: lok?.gudangId||null, gudangKode: gud?.kode||gud?.nama||null, qty: s.qty||0 };
    });
  }
  // Setiap blok perlu bukti hitung tersendiri; angka buku bukan hasil hitung fisik.
  function seedHitungPerLokasi(_qtySistem, lokasiBreakdown) {
    const keys = [...new Set(lokasiBreakdown.map(b=>b.lokasiId||"_TANPA_LOKASI"))];
    return Object.fromEntries(keys.map(key=>[key, { qty:0, at:null, by:null }]));
  }

  function opnameStockSapLabel(stock) {
    const kat = katalogList.find(k => k.id === stock?.katalogId);
    if (stock?.sapStatus === "Non-SAP" || String(stock?.id || "").startsWith("STK-PREMEM-")) return "Non-SAP";
    return stockSapLabel({ ...stock, katalog: stock?.katalog || kat?.katalog, sapStatus: stock?.sapStatus || kat?.sapStatus, jenisBarang: kat?.jenisBarang || stock?.jenisBarang });
  }

  function buildItemsFromSAP(sapRows) {
    const items = [];
    const allowedSapRows = (sapRows || []).filter(row => {
      const category = getSapOpnameCategory(row?.jenisBarang || row?.sapLabel || row?.kategori);
      return SAP_OPNAME_CATEGORIES.includes(category);
    });
    // Fase 1a: key ternormalisasi (normalizeKatalog) dua arah — SAP kadang beda zero-padding
    // dari Master Katalog, perbandingan mentah sebelumnya bikin item ke-cap "Tidak ada di SAP"
    // padahal sebenarnya cocok.
    const katalogByNo = {};
    katalogList.forEach(k=>{ if(k.katalog) katalogByNo[normalizeKatalog(k.katalog)]=k; });
    const representedSapKeys = new Set();

    // Items from Data Stok — try match to SAP
    const allKids = [...new Set(stocks.filter(stock => isSapOpnameItem({ sapLabel: opnameStockSapLabel(stock) })).map(s=>s.katalogId).filter(Boolean))];
    allKids.forEach(kid=>{
      const kat = katalogList.find(k=>k.id===kid); if(!kat) return;
      const katRows = sourceLotRowsForCatalog(stocks, kid).filter(stock => isSapOpnameItem({ sapLabel: opnameStockSapLabel(stock) }));
      const sapRow = allowedSapRows.find(r=>normalizeKatalog(r.katalog)===normalizeKatalog(kat.katalog));
      const sapCategory = getSapOpnameCategory(sapRow?.jenisBarang || sapRow?.sapLabel || sapRow?.kategori || opnameStockSapLabel(katRows[0]));
      if (sapRow && katRows.length) representedSapKeys.add(normalizeKatalog(sapRow.katalog));
      katRows.forEach((stockRow, rowIndex)=>{
        const qtySistem = Number(stockRow.qty) || 0;
        const lokasiBreakdown = buildLokasiBreakdown([stockRow]);
        items.push({
          stockId: stockRow.id,
          sourceLabel: sourceLotLabel(stockRow),
          sourceLot: getSourceLot(stockRow),
          katalogId: kid, namaBarang: kat.name, noKatalog: kat.katalog||"-", satuan: kat.satuan||"-",
          qtySistem, // SAP qty is catalog-level; expose it once to avoid double-counting.
          qtySAP: rowIndex===0 ? sapRow?.qty??null : null,
          qtsFisik: null, selisih: 0,
          statusItem: sapRow==null?"TIDAK_ADA_DI_SAP":"SESUAI",
          sapCategory,
          keterangan: "", lokasiBreakdown, hitungPerLokasi: seedHitungPerLokasi(qtySistem, lokasiBreakdown),
        });
      });
    });

    // Items in SAP but not in sistem
    allowedSapRows.forEach(sr=>{
      const sapKey = normalizeKatalog(sr.katalog);
      const kat = katalogByNo[normalizeKatalog(sr.katalog)];
      if(!representedSapKeys.has(sapKey)) {
        items.push({
          katalogId: kat?.id || null, namaBarang: sr.nama || kat?.name || sr.katalog, noKatalog: sr.katalog || kat?.katalog || "-", satuan: sr.satuan || kat?.satuan || "-",
          qtySistem: 0, qtySAP: sr.qty, qtsFisik: null, selisih: 0,
          statusItem: "TIDAK_ADA_DI_SISTEM", keterangan: "", lokasiBreakdown: [], hitungPerLokasi: {},
          sapCategory: getSapOpnameCategory(sr.jenisBarang || sr.sapLabel || sr.kategori),
        });
      }
    });
    return items;
  }

  function buildItemsNonSAP(gudangId = null) {
    // Only Non-SAP items from Data Stok
    const scopedStocks = stocks.filter(stock => {
      if (isSapOpnameItem({ sapLabel: opnameStockSapLabel(stock) })) return false;
      const lokasi = lokasiList?.find(l => l.id === stock.lokasiId);
      const stockGudangId = lokasi?.gudangId || null;
      return stockGudangId === gudangId;
    });
    return [...new Set(scopedStocks.map(s=>s.katalogId))]
      .filter(Boolean).map(kid=>{
        const kat = katalogList.find(k=>k.id===kid);
        if(!kat) return null;
        return sourceLotRowsForCatalog(scopedStocks, kid).map(stockRow=>{
          const qtySistem = Number(stockRow.qty) || 0;
          const lokasiBreakdown = buildLokasiBreakdown([stockRow]);
          return { stockId:stockRow.id, sourceLabel:sourceLotLabel(stockRow), sourceLot:getSourceLot(stockRow),
            katalogId:kid, namaBarang:kat.name, noKatalog:kat.katalog||"-", satuan:kat.satuan||"-",
            qtySistem, qtsFisik:null, selisih:0, statusItem:"SESUAI", keterangan:"",
            lokasiBreakdown, hitungPerLokasi: seedHitungPerLokasi(qtySistem, lokasiBreakdown) };
        });
      }).filter(Boolean).flat();
  }

  // Fase 1e: kelompokkan item hasil parse PID per gudang (dari lokasi PERTAMA di
  // lokasiBreakdown — item yang stoknya tersebar di >1 gudang ikut gudang lokasi pertama, kasus
  // jarang & bisa dikoreksi manual belakangan). Item tanpa alamat → grup "Belum Beralamat".
  function groupItemsByGudang(items) {
    const map = new Map();
    items.forEach(item=>{
      const primary = item.lokasiBreakdown?.[0];
      const gudangId = primary?.gudangId || null;
      const gudangKode = gudangId ? primary?.gudangKode : null;
      const key = gudangId || "_NONE";
      if (!map.has(key)) map.set(key, { gudangId, gudangKode, items: [] });
      map.get(key).items.push(item);
    });
    const groups = [...map.values()];
    groups.sort((a,b)=>(a.gudangId?0:1)-(b.gudangId?0:1));
    return groups;
  }

  // Kerangka sesi baru dipakai ulang oleh startOpname (Non-SAP, tanpa file) dan
  // startOpnameFromFile (SAP, sesi dibuat SETELAH file berhasil di-parse — Fase 0).
  function buildNewOpnameShell(jenisAlur, extra) {
    const semester = (()=>{ const d=new Date(); return `${d.getFullYear()}-S${d.getMonth()<6?1:2}`; })();
    return {
      id: "OPN-"+Date.now()+"-"+Math.random().toString(36).slice(2,7), semester, jenisAlur, kategori: jenisAlur==="SAP"?"Material SAP":"Material Non-SAP",
      flowVersion: 2, status:"DRAFT", items:jenisAlur==="NON_SAP"?buildItemsNonSAP(extra?.gudangId ?? null):[],
      dibuatOleh:currentUser.id, dibuatAt:Date.now(), uptId:currentUser?.uptId || currentUser?.upt_id || null,
      sapUploadedAt:null, totalRowsSAP:0,
      approvedByAsman:null, approvedAtAsman:null, catatanAsman:"",
      approvedByManager:null, approvedAtManager:null, catatanManager:"",
      submittedAt:null, rejectReason:"",
      ...extra,
    };
  }

  function startOpname(jenisAlur) {
    if (jenisAlur === "NON_SAP") {
      showToast("Sesi Non-SAP dibuka dari sesi SAP yang sudah selesai per gudang.", "error");
      return;
    }
    setActiveOpname(buildNewOpnameShell(jenisAlur));
    setPage(0); setValidationErrors([]);
  }

  async function openOrCreateNonSapChild(parent) {
    if (!parent || parent.flowVersion !== 2 || parent.jenisAlur !== "SAP") return;
    const progress = opnameProgress(parent.items || [], null, { requireTimestamp: true });
    if (progress.total === 0 || progress.filled !== progress.total) {
      showToast("Selesaikan hitungan SAP per gudang terlebih dahulu.", "error");
      return;
    }
    // Parent SAP is a complete per-gudang session at this point. Save the full snapshot here so
    // reopening the parent can still expose the same 100% gate without a second network merge.
    const parentSaved = await saveOpname(parent);
    if (parentSaved === false) return;
    const existing = opnameList.find(child => childOpnameMatches(child, parent));
    if (existing) {
      setActiveOpname(existing);
      setPage(0);
      setValidationErrors([]);
      return;
    }
    const gudang = gudangList?.find(g => g.id === parent.gudangId);
    const child = buildNewOpnameShell("NON_SAP", {
      flowVersion: 2,
      sourceSapOpnameId: parent.id,
      uptId: parent.uptId || parent.upt_id || currentUser?.uptId || currentUser?.upt_id || null,
      gudangId: parent.gudangId ?? null,
      gudangKode: parent.gudangKode || gudang?.kode || gudang?.nama || null,
      semester: parent.semester,
      items: buildItemsNonSAP(parent.gudangId ?? null),
    });
    const ok = await saveOpname(child);
    if (ok === false) return;
    setActiveOpname(child);
    setPage(0);
    setValidationErrors([]);
    showToast(`Sesi Non-SAP ${child.gudangKode || "tanpa gudang"} siap diisi.`);
  }

  // Dropzone PID (Opname SAP): sesi DRAFT baru cuma dibuat kalau file berhasil di-parse —
  // gagal parse TIDAK meninggalkan draft kosong di daftar.
  async function startOpnameFromFile(file) {
    setCsvLoading(true);
    try {
      const sapRows = await parseSAPFile(file);
      const items = buildItemsFromSAP(sapRows);
      const groups = groupItemsByGudang(items);
      const meta = { sapUploadedAt:Date.now(), totalRowsSAP:sapRows.length };
      if (groups.length <= 1) {
        // Cuma 1 gudang (atau semuanya tanpa alamat) — tidak perlu tanya, langsung 1 sesi.
        const only = groups[0] || { gudangId:null, gudangKode:null, items };
        setActiveOpname(buildNewOpnameShell("SAP", { ...meta, items: only.items, gudangId: only.gudangId, gudangKode: only.gudangKode }));
        setPage(0); setValidationErrors([]);
      } else {
        setGudangSplitDialog({ groups, meta, selected: new Set(groups.map(g=>g.gudangId||"_NONE")) });
      }
    } catch(err) {
      showToast("Gagal membaca file: " + err.message, "error");
    }
    setCsvLoading(false);
  }

  // Fase 1e: konfirmasi dialog pilih gudang — bikin 1 sesi DRAFT per gudang yang dicentang,
  // langsung tersimpan (opnameList), lalu buka sesi pertama untuk lanjut diisi.
  async function confirmGudangSplit() {
    const dlg = gudangSplitDialog;
    if (!dlg) return;
    const chosen = dlg.groups.filter(g=>dlg.selected.has(g.gudangId||"_NONE"));
    setGudangSplitDialog(null);
    if (!chosen.length) return;
    const sessions = chosen.map(g=>buildNewOpnameShell("SAP", { ...dlg.meta, items: g.items, gudangId: g.gudangId, gudangKode: g.gudangKode }));
    for (const s of sessions) { await saveOpname(s); }
    setActiveOpname(sessions[0]); setPage(0); setValidationErrors([]);
    showToast(`✅ ${sessions.length} sesi dibuat (1 per gudang).`);
  }

  function handleDropzoneFiles(fileList) {
    const f = fileList?.[0]; if (!f || csvLoading) return;
    const panelUnsaved = activeOpname && activeOpname.status==="DRAFT" && !opnameList.some(o=>o.id===activeOpname.id);
    if (panelUnsaved && !window.confirm("Ada sesi opname yang belum tersimpan. Ganti dengan file baru? Sesi lama akan hilang.")) return;
    startOpnameFromFile(f);
  }

  async function handleCSVUpload(e) {
    const f = e.target.files[0]; if(!f) return;
    setCsvLoading(true);
    try {
      const sapRows = await parseSAPFile(f);
      const items = buildItemsFromSAP(sapRows);
      setActiveOpname(prev=>({...prev, items, sapUploadedAt:Date.now(), totalRowsSAP:sapRows.length}));
    } catch(err) {
      alert("Gagal membaca file: " + err.message);
    }
    setCsvLoading(false);
  }

  // Ganti File PID (header panel, sesi SAP DRAFT) — reuse handleCSVUpload, cuma tambah
  // konfirmasi kalau sudah ada qty yang diisi (biar tidak hilang diam-diam).
  async function handleReplaceCSV(e) {
    const hasProgress = (activeOpname.items||[]).some(itemCounted);
    if (hasProgress && !window.confirm("Ganti file PID menyusun ulang daftar item. Qty yang sudah diisi bisa hilang. Lanjutkan?")) {
      e.target.value=""; return;
    }
    await handleCSVUpload(e);
  }

  // Kontrak tombol Batal (Fase 0): sesi belum tersimpan (belum pernah saveOpname/submitOpname)
  // → konfirmasi buang. Sesi sudah tersimpan → tutup panel saja, tetap DRAFT di daftar.
  function clearDesktopDraftTracking(id) {
    if (desktopSaveTimerRef.current) {
      clearTimeout(desktopSaveTimerRef.current);
      desktopSaveTimerRef.current = null;
    }
    if (id) {
      desktopDirtyRef.current.delete(id);
      delete editGenerationRef.current[id];
      try { localStorage.removeItem(draftKey(id)); } catch {}
    }
    setDesktopSaveState("idle");
  }

  async function handleBatal() {
    if (!activeOpname?.id) return;
    const id = activeOpname.id;
    const persisted = opnameList.some(o=>o.id===id);
    if (!persisted && !window.confirm("Buang sesi opname ini? Data yang sudah diisi belum tersimpan dan akan hilang.")) return;
    if (persisted && desktopDirtyRef.current.has(id)) {
      const saved = await saveDesktopQty();
      if (!saved || desktopDirtyRef.current.has(id)) {
        showToast("Perubahan belum tersimpan. Sesi tetap dibuka agar dapat diperbaiki.", "error");
        return;
      }
    }
    clearDesktopDraftTracking(id);
    setActiveOpname(null); setValidationErrors([]); setHighlightIdx(null);
  }

  // hormati override manual sapStatus lewat katalogList; fallback ke kode saat katalogId null
  // Label SAP/Non-SAP item opname — turunkan dari BARIS STOK (sama seperti Data Stok:
  // stockSapLabel hormati Status Material per-baris + heuristik STK-PREMEM-*). Pakai katalog
  // saja (katalogSapLabel) salah cap material Non-SAP buatan app yang kodenya numerik → filter
  // Non-SAP kosong. Fallback kode katalog untuk item SAP-only tanpa baris stok.
  function itemSapLabel(item) {
    if (item.katalogId) {
      const s = (stocks||[]).find(s=>item.stockId ? s.id===item.stockId : s.katalogId===item.katalogId);
      if (s) return opnameStockSapLabel(s);
    }
    return resolveSapLabel(item.noKatalog);
  }

  // Fase 1f: filter Gudang/Blok + Jenis SAP di toolbar tabel item — dikerjakan di atas indeks
  // ASLI (bukan array baru) supaya updateItem(realIdx,...) tetap menunjuk baris yang benar.
  function getFilteredIndexed() {
    const items = activeOpname?.items || [];
    return items.map((it,idx)=>({it,idx})).filter(({it})=>{
      if (filterSelisihOnly && (!itemCounted(it, { requireTimestamp: activeOpname?.flowVersion===2 }) || Number(it.selisih) === 0)) return false;
      if (activeOpname?.flowVersion === 2 && activeOpname?.jenisAlur === "SAP" && sapCategoryFilter) {
        if (getSapOpnameCategory(it.sapCategory || it.sapLabel) !== sapCategoryFilter) return false;
      }
      if (filterJenis) {
        const bin = itemSapLabel(it).startsWith("SAP") ? "SAP" : "Non-SAP";
        if (bin !== filterJenis) return false;
      }
      const query = materialSearch.trim().toLowerCase();
      if (query && ![it.noKatalog, it.namaBarang].some(value => String(value || "").toLowerCase().includes(query))) return false;
      const bd = it.lokasiBreakdown||[];
      if (filterLokasiId) return bd.some(b=>b.lokasiId===filterLokasiId);
      if (filterGudangId==="__NONE__") return !bd.length;
      if (filterGudangId) return bd.some(b=>b.gudangId===filterGudangId);
      return true;
    });
  }

  // "Mulai Hitung" / "Lanjut Hitung" (Fase 0, sebelum scanner Fase 1 ada): scroll+fokus ke
  // baris qty kosong pertama (di antara yang lolos filter aktif).
  function scrollToFirstEmptyQty() {
    const fi = getFilteredIndexed();
    const pos = fi.findIndex(({it})=>!itemCounted(it, { requireTimestamp: activeOpname?.flowVersion===2 }));
    if (pos < 0) return;
    const realIdx = fi[pos].idx;
    setPage(Math.floor(pos / pageSize));
    setTimeout(() => {
      const el = qtyInputRefs.current[realIdx];
      if (el) { el.focus(); el.scrollIntoView({behavior:"smooth", block:"center"}); }
    }, 50);
  }

  // Blok (kunci hitungPerLokasi) yang mewakili item ini di UI desktop Fase 1 — blok tunggal kalau
  // Non-SAP (lokasiId eksplisit) atau lokasiBreakdown persis 1 entri; sisanya "_TANPA_LOKASI"
  // (breakdown qty PER blok yang sesungguhnya untuk item multi-lokasi menyusul di mode lapangan
  // Fase 2 — di sini kita cuma catat total-nya dulu supaya data model sudah siap dipakai).
  function itemLokasiKey(item) {
    if (item.lokasiId) return item.lokasiId;
    if (item.lokasiBreakdown?.length === 1) return item.lokasiBreakdown[0].lokasiId || "_TANPA_LOKASI";
    return "_TANPA_LOKASI";
  }

  function updateItem(realIdx, field, value) {
    if (activeOpname?.id) {
      desktopDirtyRef.current.add(activeOpname.id);
      bumpEditGeneration(activeOpname.id);
    }
    setActiveOpname(prev=>{
      const items = [...prev.items];
      const before = items[realIdx];
      items[realIdx] = {...before, [field]:value};
      // Item "🆕 Material Baru" (dari SAP maupun temuan Non-SAP) tetap ditandai begitu walau
      // qty-nya diedit ulang — jangan sampai berubah jadi status SESUAI/SELISIH biasa cuma
      // karena user koreksi angka setelah simpan awal.
      if(field==="qtsFisik") {
        // Fase 1c: qtsFisik jadi TURUNAN — tulis ke blok item ini, lalu jumlahkan ulang.
        // Fase 2e: applyQtyToItem juga menurunkan selisih/statusItem (dipakai sama oleh
        // OpnameLapanganView) — satu tempat, tidak dobel logic. markRecount TIDAK diset di sini:
        // recount-wajib itu fitur lapangan (verifikasi fisik kedua), desktop cukup keterangan wajib.
        const key = itemLokasiKey(items[realIdx]);
        items[realIdx] = applyQtyToItem(items[realIdx], key, value, currentUser?.id);
        if (!touchedRef.current[prev.id]) touchedRef.current[prev.id] = new Set();
        touchedRef.current[prev.id].add(key);
        const next = {...prev, items};
        activeOpnameRef.current = next;
        return next;
      } else if (field==="lokasiId") {
        // Non-SAP: kalau qty sudah sempat diisi sebelum lokasi dipilih/diganti, pindahkan entri
        // hitungPerLokasi ke kunci lokasi yang baru supaya tidak nyangkut di "_TANPA_LOKASI".
        const oldKey = itemLokasiKey(before);
        const newKey = value || "_TANPA_LOKASI";
        if (before.hitungPerLokasi?.[oldKey] && oldKey!==newKey) {
          const hitung = {...before.hitungPerLokasi};
          hitung[newKey] = hitung[oldKey];
          delete hitung[oldKey];
          items[realIdx].hitungPerLokasi = hitung;
          if (!touchedRef.current[prev.id]) touchedRef.current[prev.id] = new Set();
          touchedRef.current[prev.id].add(newKey);
        }
      }
      const next = {...prev, items};
      activeOpnameRef.current = next;
      return next;
    });
  }

  async function handleOpnamePhoto(realIdx, field, file) {
    if (!file || !uploadStockFoto || !activeOpname) return;
    const item = activeOpname.items?.[realIdx];
    const sessionUptId = activeOpname.uptId || activeOpname.upt_id;
    if (!sessionUptId) { showToast("Sesi opname tidak memiliki UPT. Foto tidak disimpan.", "error"); return; }
    try {
      const dataUrl = typeof file === "string" ? file : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("File foto tidak dapat dibaca."));
        reader.readAsDataURL(file);
      });
      const katalogId = item?.katalogId || item?.noKatalog || item?.stockId;
      if (!katalogId) throw new Error("Foto tidak memiliki identitas material.");
      const url = await uploadStockFoto(katalogId, field, dataUrl, sessionUptId);
      const next = { ...activeOpname, items: activeOpname.items.map((entry, index) => index === realIdx ? { ...entry, [field]: url } : entry) };
      const photoKey = item?.stockId || item?.katalogId || item?.noKatalog || String(realIdx);
      const saved = await saveOpname(next, [...(touchedRef.current[activeOpname.id] || [])], { silent:true, forceMerge:true, touchedPhotoItemKeys:[photoKey] });
      if (saved === false) { setActiveOpname(next); return; }
      setActiveOpname(saved || next);
      showToast("✅ Foto tersimpan.");
    } catch (error) {
      showToast(error?.message || "Gagal menyimpan foto.", "error");
    }
  }

  // Fase 2d: field mode (OpnameLapanganView) butuh nulis qty ke BLOK YANG SESUNGGUHNYA
  // (lokasiKey dari blok yang lagi aktif di HP) — beda dari updateItem desktop yang selalu pakai
  // itemLokasiKey (kolaps ke "_TANPA_LOKASI" utk item multi-blok, breakdown per-blok yang
  // sebenarnya memang menyusul di sini). extra dipakai utk flag tambahan (mis. usulPindahLokasi).
  function bumpEditGeneration(id) {
    if (!id) return 0;
    const next = (editGenerationRef.current[id] || 0) + 1;
    editGenerationRef.current[id] = next;
    return next;
  }

  function queueLapanganSave(next, touchedLokasiIds, { generation = null } = {}) {
    setActiveOpname(next); // local recovery remains available when the server is offline
    activeOpnameRef.current = next;
    const job = lapanganSaveQueueRef.current.then(async () => {
      try {
        const saved = await saveOpname(next, touchedLokasiIds, { silent: true, forceMerge: true });
        const isLatest = generation === null || editGenerationRef.current[next.id] === generation;
        if (isLatest) {
          const resolved = saved === false ? next : (saved || next);
          setActiveOpname(resolved);
          activeOpnameRef.current = resolved;
        } else if (saved === false) {
          // A newer local edit owns the active state; keep it available for the next retry.
          setDesktopSaveState("error");
          persistDraftLocal(activeOpnameRef.current || next);
        }
        return saved !== false;
      } catch (error) {
        const isLatest = generation === null || editGenerationRef.current[next.id] === generation;
        if (isLatest) {
          setActiveOpname(next);
          activeOpnameRef.current = next;
        }
        showToast(error?.message || "Gagal menyimpan hitungan ke server. Draft lokal tetap tersedia.", "error");
        return false;
      }
    });
    lapanganSaveQueueRef.current = job;
    return job;
  }

  async function saveDesktopQty() {
    if (desktopSaveTimerRef.current) {
      clearTimeout(desktopSaveTimerRef.current);
      desktopSaveTimerRef.current = null;
    }
    const opn = activeOpnameRef.current;
    if (!opn) return false;
    if (!desktopDirtyRef.current.has(opn.id)) {
      setDesktopSaveState("saved");
      return true;
    }
    setDesktopSaveState("saving");
    persistDraftLocal(opn);
    const generation = editGenerationRef.current[opn.id] || 0;
    const saved = await queueLapanganSave(opn, [...(touchedRef.current[opn.id] || [])], { generation });
    const isLatest = editGenerationRef.current[opn.id] === generation;
    if (saved && isLatest) {
      desktopDirtyRef.current.delete(opn.id);
      setDesktopSaveState("saved");
      try { localStorage.removeItem(draftKey(opn.id)); } catch {}
    } else if (saved && !isLatest) {
      // The request saved an older snapshot. Requeue the current ref without clearing its dirty bit.
      setDesktopSaveState("saving");
      scheduleDesktopSave(0);
    } else {
      setDesktopSaveState("error");
      persistDraftLocal(activeOpnameRef.current || opn);
    }
    return saved;
  }

  function setQtyForBlok(realIdx, lokasiKey, qty, extra) {
    if (!activeOpname) return Promise.resolve(false);
    const items = [...activeOpname.items];
    items[realIdx] = { ...applyQtyToItem(items[realIdx], lokasiKey, qty, currentUser?.id, { markRecount: true }), ...(extra||{}) };
    if (!touchedRef.current[activeOpname.id]) touchedRef.current[activeOpname.id] = new Set();
    touchedRef.current[activeOpname.id].add(lokasiKey);
    const next = { ...activeOpname, items };
    const generation = bumpEditGeneration(activeOpname.id);
    return queueLapanganSave(next, [...touchedRef.current[activeOpname.id]], { generation });
  }

  // Fase 2e: konfirmasi hitung ulang (blind — tanpa lihat angka pertama) untuk item selisih.
  // Sama → dianggap benar, angka pertama tetap dipakai. Beda → angka kedua yang dipakai
  // (applyQtyToItem, kunci dari item.recount.key yang disimpan saat selisih pertama terjadi),
  // keterangan otomatis mencatat kedua angka.
  function confirmRecount(realIdx, qtyKedua) {
    if (!activeOpname) return Promise.resolve(false);
    const items = [...activeOpname.items];
    const item = items[realIdx];
    const key = item.recount?.key || itemLokasiKey(item);
    const firstQty = item.qtsFisik;
    if (Number(qtyKedua) === Number(firstQty)) {
      items[realIdx] = { ...item, recount: { perluUlang:false, qtyUlang:Number(qtyKedua), at:Date.now(), by:currentUser?.id, cocok:true } };
    } else {
      const updated = applyQtyToItem(item, key, qtyKedua, currentUser?.id);
      const ket = `${item.keterangan ? item.keterangan+" — " : ""}Hitung ulang: awal ${firstQty}, ulang ${qtyKedua} (dipakai).`;
      items[realIdx] = { ...updated, keterangan: ket, recount: { perluUlang:false, qtyUlang:Number(qtyKedua), at:Date.now(), by:currentUser?.id, cocok:false } };
    }
    if (!touchedRef.current[activeOpname.id]) touchedRef.current[activeOpname.id] = new Set();
    touchedRef.current[activeOpname.id].add(key);
    const generation = bumpEditGeneration(activeOpname.id);
    return queueLapanganSave({ ...activeOpname, items }, [...touchedRef.current[activeOpname.id]], { generation });
  }

  function validate() {
    const errors = [];
    if (activeOpname.stage !== "REKONSILIASI") {
      showToast("Buka Rekonsiliasi dulu sebelum submit.", "error");
      return false;
    }
    const isNonSapSession = activeOpname?.jenisAlur === "NON_SAP";
    (activeOpname.items||[]).forEach((item,i)=>{
      if(!itemCounted(item, { requireTimestamp: activeOpname.flowVersion===2 })) errors.push(`Baris ${i+1}: qty fisik belum dihitung`);
      // Opname Non-SAP: lokasi WAJIB diisi untuk semua item (baseline maupun temuan baru) —
      // ini yang membuktikan opname fisik benar-benar dilakukan, bukan cuma isi qty dari kursi.
      if(isNonSapSession && !item.lokasiId) errors.push(`Baris ${i+1} (${item.namaBarang}): lokasi (Gudang/Blok) wajib diisi`);
    });
    stockOpnameDiscrepancyNoteErrors(activeOpname.items || [], { isSap: !isNonSapSession }).forEach(({ index }) => {
      const item = activeOpname.items[index];
      errors.push(`Baris ${index + 1} (${item?.namaBarang || "Material"}): keterangan wajib diisi jika ada selisih SAP/fisik/WARNOTO`);
    });
    // Fase 2e: item selisih wajib hitung ulang (blind) sebelum submit — cegah "asal ketik ulang"
    // tanpa verifikasi fisik kedua kali. Satu pesan ringkas (bukan per baris) supaya tidak
    // membanjiri kotak error di atas kalau selisihnya banyak.
    const recountPending = (activeOpname.items||[]).filter(i=>i.recount?.perluUlang).length;
    if (recountPending>0) errors.push(`${recountPending} item selisih belum dikonfirmasi hitung ulang — buka "📱 Mode Lapangan" untuk hitung ulang.`);
    setValidationErrors(errors);
    // Tombol Submit sekarang cuma ada di bawah tabel (setelah paginasi) — kalau validasi gagal
    // dan cuma diam-diam set state tanpa toast, dengan item ratusan baris user tidak akan sadar
    // submit-nya gagal (kotak error tampil di ATAS tabel, jauh di luar layar). Sesi jadi
    // nyangkut DRAFT selamanya tanpa penjelasan — persis kasus yang dilaporkan user 2026-07-07
    // ("tidak masuk ke approval asman").
    if (errors.length>0) {
      showToast(`❌ Belum bisa disubmit — ${errors.length} data belum lengkap (qty fisik/lokasi/keterangan). Scroll ke atas untuk detail.`, "error");
      setPage(0);
      if (typeof window!=="undefined") window.scrollTo({top:0, behavior:"smooth"});
    }
    return errors.length===0;
  }

  // ── Progress calculation ─────────────────────────────────────────────
  function getProgress() {
    return opnameProgress(activeOpname?.items || [], null, { requireTimestamp: activeOpname?.flowVersion===2 });
  }

  const statusColor = {DRAFT:"#6b7280",PENDING_ASMAN:"#f59e0b",PENDING_MANAGER:"#3b82f6",SELESAI:"#16a34a",DITOLAK:"#dc2626"};
  const statusLabel = {DRAFT:"Draft",PENDING_ASMAN:"Menunggu Asman",PENDING_MANAGER:"Menunggu Manager",SELESAI:"✅ Selesai",DITOLAK:"❌ Ditolak"};

  // ── PANEL ANALISA (Fase 0: sama layar dengan daftar, bukan pindah tab) ────
  function renderPanel() {
    if (!activeOpname) return null;
    const isSAP = activeOpname.jenisAlur==="SAP";
    const isReadOnly = activeOpname.status!=="DRAFT";
    // Qty fisik adalah hasil hitung manual Admin/TL/Superadmin. Asman dan Manager
    // tetap dapat membuka draft untuk review, tetapi tidak boleh mengubahnya.
    const canEditDraft = !isReadOnly && hasRole(currentUser, "ADMIN", "TL", "SUPERADMIN");
    const items = activeOpname.items||[];
    const countedItem = item => itemCounted(item, { requireTimestamp: activeOpname.flowVersion===2 });
    // Sesi v2 selalu scoped ke 1 gudang — dropdown Gudang jadi no-op, sembunyikan.
    const sesiGudangIds = new Set();
    for (const it of items) {
      for (const b of getItemBlocks(it, lokasiList, gudangList)) {
        if (b.gudangId) sesiGudangIds.add(b.gudangId);
      }
    }
    if (!sesiGudangIds.size && activeOpname.gudangId) sesiGudangIds.add(activeOpname.gudangId);
    const singleGudangId = sesiGudangIds.size <= 1 ? ([...sesiGudangIds][0] || activeOpname.gudangId || null) : null;
    const isSingleGudang = !!singleGudangId && sesiGudangIds.size <= 1;
    const filteredIndexed = getFilteredIndexed();
    const totalPages = Math.ceil(filteredIndexed.length/pageSize);
    const pageEntries = filteredIndexed.slice(page*pageSize, (page+1)*pageSize);
    const prog = getProgress();
    const selisihCount = items.filter(i=>countedItem(i) && i.selisih!==0).length;

    return (
      <div className="opname-panel" style={{...sty.card,marginBottom:20}}>
        {/* Header panel — judul + aksi navigasi. Tombol Simpan/Submit sengaja HANYA di bawah
            tabel (dulu sempat dobel atas+bawah, membingungkan user — keluhan 2026-07-07). */}
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:12}}>
          <div style={{minWidth:0,flex:"1 1 180px"}}>
            <h1 style={{...sty.pageTitle,fontSize:17}}>Opname {activeOpname.jenisAlur==="SAP"?"SAP":"Non-SAP"} — {activeOpname.semester}{activeOpname.gudangId!==undefined && (activeOpname.gudangKode?` • Gudang ${activeOpname.gudangKode}`:" • Belum Beralamat")}</h1>
            <p style={{color:C.muted,fontSize:13}}>{activeOpname.kategori}</p>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
            {isSAP && canEditDraft && (
              <label style={{fontSize:12,fontWeight:600,color:C.accent,cursor:csvLoading?"default":"pointer"}}>
                {csvLoading?"Memproses...":"Ganti File PID"}
                <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleReplaceCSV} disabled={csvLoading} style={{display:"none"}}/>
              </label>
            )}
            {items.length>0 && (
              <button style={sty.btn("ghost","sm")} onClick={()=>downloadLembarHitungHTML(activeOpname, {lokasiList, gudangList,
                filterGudangId: filterGudangId==="__NONE__"?null:(filterGudangId||null), filterLokasiId: filterLokasiId||null})}>
                🖨️ Lembar Hitung
              </button>
            )}
            {isReadOnly && <button style={sty.btn("ghost","sm")} onClick={()=>setActiveOpname(null)}>← Kembali ke Daftar</button>}
          </div>
        </div>

        {activeOpname.flowVersion === 2 && (
          <div className="opname-stage-rail" aria-label="Tahapan Stock Opname">
            <div className={`opname-stage-rail__step ${isSAP ? "is-active" : "is-done"}`}>
              <span className="opname-stage-rail__index">1</span><span>SAP</span>
            </div>
            <div className={`opname-stage-rail__step ${!isSAP ? "is-active" : ""}`}>
              <span className="opname-stage-rail__index">2</span><span>Non-SAP</span>
            </div>
          </div>
        )}

        {activeOpname.flowVersion === 2 && isSAP && items.length > 0 && (
          <div className="opname-category-segment" aria-label="Filter kategori SAP">
            <button type="button" className={!sapCategoryFilter ? "is-active" : ""} onClick={()=>{setSapCategoryFilter("");setPage(0);}}>Semua <span>{items.length}</span></button>
            {SAP_OPNAME_CATEGORIES.map(category => {
              const categoryProgress = opnameProgress(items, category, { requireTimestamp: activeOpname.flowVersion===2 });
              return <button type="button" key={category} className={sapCategoryFilter===category ? "is-active" : ""} onClick={()=>{setSapCategoryFilter(category);setPage(0);}}>{category} <span>{categoryProgress.filled}/{categoryProgress.total}</span></button>;
            })}
          </div>
        )}

        {/* Fase C: Dashboard progres per blok — klik chip untuk filter tabel ke blok itu.
            Default terlipat (opt-in) — filter Gudang/Blok utama ada di toolbar tabel. */}
        {canEditDraft && (() => {
          const seen = new Set();
          const bloks = [];
          for (const it of items) {
            for (const b of getItemBlocks(it, lokasiList, gudangList)) {
              const key = blokKeyOf(b.lokasiId);
              if (seen.has(key)) continue;
              seen.add(key);
              bloks.push(b);
            }
          }
          if (!bloks.length) return null;
          bloks.sort((a,b)=>(a.lokasiKode||"").localeCompare(b.lokasiKode||"",undefined,{numeric:true}));
          return (
            <div style={{marginBottom:14,background:"#fff",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 12px"}}>
              <button type="button" onClick={()=>setShowBlokProgress(v=>!v)} aria-expanded={showBlokProgress}
                style={{display:"flex",width:"100%",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",padding:0,cursor:"pointer",marginBottom:showBlokProgress?8:0}}>
                <span style={{fontSize:12,fontWeight:600,color:C.muted,letterSpacing:.2}}>
                  {showBlokProgress?"▾":"▸"} Progres per blok
                </span>
                <span style={{fontSize:12,color:C.muted}}>{bloks.filter(b=>blokProgress(activeOpname,b.lokasiId,lokasiList,gudangList).selesai).length}/{bloks.length} blok</span>
              </button>
              {showBlokProgress && (
              <div style={{display:"flex",flexWrap:"wrap",gap:6,rowGap:6,lineHeight:1.5}}>
                {bloks.map((b,bi)=>{
                  const { total, counted, selesai } = blokProgress(activeOpname, b.lokasiId, lokasiList, gudangList);
                  const dot = selesai ? "#22c55e" : counted>0 ? "#f59e0b" : "#cbd5e1";
                  const active = (filterGudangId===(b.gudangId||"__NONE__")) && filterLokasiId===(b.lokasiId||"");
                  return (
                    <button key={bi} onClick={()=>{ setFilterGudangId(b.gudangId||"__NONE__"); setFilterLokasiId(b.lokasiId||""); setPage(0); }}
                      title={`${counted}/${total} item dihitung`}
                      style={{display:"inline-flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:999,whiteSpace:"nowrap",cursor:"pointer",
                        fontSize:12,fontWeight:500,color:C.text,
                        border:`1px solid ${active?C.accent:"#e5e7eb"}`,background:active?"#eff6ff":"#fafafa"}}>
                      <span style={{width:7,height:7,borderRadius:999,background:dot,flexShrink:0}}/>
                      {selesai && <span style={{color:"#22c55e",fontWeight:700}}>✓</span>}
                      {b.lokasiKode||"Tanpa Lokasi"}
                      <span style={{color:C.muted}}>{counted}/{total}</span>
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          );
        })()}

        {/* Tambah Material Ditemukan + Upload Usulan Pencocokan — cuma Opname Non-SAP.
            Pola card biru + label sama persis dengan "Step 1: Upload File SAP" di bawah,
            supaya konsisten dengan menu Opname lain (keluhan user 2026-07-08). */}
        {!isSAP && canEditDraft && (
          <>
            <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
              <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
                📋 Material Non-Stock yang Ditemukan
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                <button style={{...sty.btn("primary"),minHeight:44}} onClick={()=>openTambahModal()}>
                  ➕ Tambah Material
                </button>
                <label style={{...sty.btn("ghost"),minHeight:44,display:"inline-flex",alignItems:"center",cursor:queueUploadBusy?"default":"pointer",opacity:queueUploadBusy?0.6:1}}>
                  {queueUploadBusy?"Memuat...":"📂 Upload Usulan"}
                  <input type="file" accept=".xlsx,.XLSX,.xls" style={{display:"none"}} onChange={handleUploadUsulan} disabled={queueUploadBusy}/>
                </label>
              </div>
              <div style={{fontSize:12,color:C.muted,lineHeight:1.45,marginTop:8}}>
                "Tambah Material" untuk barang yang belum pernah tercatat di mana pun. "Upload Usulan" untuk file review yang sudah disiapkan sebelumnya (kode MARA sudah dicocokkan, tinggal diverifikasi fisik).
              </div>
            </div>

            {/* Antrian dari file usulan — tiap baris tetap wajib direview manual (qty+lokasi
                diisi ulang saat itu), file cuma pre-fill nama & kandidat kode MARA-nya. */}
            {tambahQueue.length>0 && (
              <div style={{...sty.card,marginBottom:14,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:800}}>
                    📋 Antrian dari File ({tambahQueue.filter(q=>q.status==="DONE").length}/{tambahQueue.length} diproses)
                  </div>
                  <button title="Batalkan & tutup antrian ini" style={sty.btn("ghost","sm")} onClick={()=>{ if(window.confirm("Batalkan antrian ini? Baris yang belum diproses akan hilang dari daftar (material yang sudah tersimpan TIDAK ikut terhapus).")) setTambahQueue([]); }}>✕ Batal</button>
                </div>
                <div tabIndex={0} className="info-note" style={{fontSize:12,color:C.muted,marginBottom:10}}>
                  Qty di file ini data lama (AppSheet) — bukan angka final. Tetap wajib dihitung fisik ulang & isi lokasi tiap kali diproses.
                </div>
                <div style={{maxHeight:280,overflowY:"auto"}}>
                  {tambahQueue.map(q=>(
                    <div key={q.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderBottom:`1px solid ${C.border}`,opacity:q.status!=="PENDING"?0.5:1}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{q.nama}</div>
                        <div style={{fontSize:12,color:C.muted}}>
                          Katalog asli: {q.katalogAsli||"-"} • Qty file: {q.qtyFile||"-"} •{" "}
                          <span style={{fontWeight:700,color:q.skor==="KUAT"?"#166534":q.skor==="LEMAH"?"#92400e":"#991b1b"}}>{q.skor}</span>
                          {q.maraCode && ` (${q.maraCode})`}
                        </div>
                      </div>
                      {q.status==="PENDING" ? (
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>openTambahModal(q)}>Proses</button>
                          <button style={sty.btn("ghost","sm")} onClick={()=>skipQueueItem(q.id)}>Lewati</button>
                        </div>
                      ) : (
                        <span style={{fontSize:12,fontWeight:700,color:q.status==="DONE"?C.green:C.muted,flexShrink:0}}>
                          {q.status==="DONE"?"✅ Selesai":"⏭️ Dilewati"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Ringkasan file PID sudah terbaca — upload awal sekarang lewat dropzone di daftar
            (Fase 0), sesi SAP baru selalu sudah bawa item saat panel ini dibuka. Ganti file
            pakai link "Ganti File PID" di header panel. */}
        {isSAP && canEditDraft && activeOpname.sapUploadedAt && (
          <div tabIndex={0} className="info-note" style={{fontSize:12,color:C.green,marginBottom:14}}>
            ✅ {activeOpname.totalRowsSAP} baris SAP dibaca • {items.length} item total • {fmtDate(activeOpname.sapUploadedAt)}
          </div>
        )}

        {/* Progress bar + summary */}
        {items.length>0 && (
          <>
            <div style={{...sty.card,marginBottom:14,padding:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700}}>Progress Pengisian: {prog.filled}/{prog.total} item ({prog.pct}%)</div>
                <div style={{fontSize:12,color:selisihCount>0?C.red:C.green,fontWeight:700}}>
                  {prog.filled<prog.total?`⏳ ${prog.total-prog.filled} belum dihitung`:selisihCount>0?`⚠️ ${selisihCount} item selisih`:"✅ Belum ada selisih"}
                </div>
              </div>
              <div style={{background:"#f1f5f9",borderRadius: 10,height:8,marginBottom:10}}>
                <div style={{width:`${prog.pct}%`,height:8,borderRadius: 10,background:prog.pct===100?C.green:C.accent,transition:"width 0.3s"}}/>
              </div>
              {/* Ringkasan satu baris angka tenang — bukan 4 boks warna (gaya Apple-like, 0c) */}
              <div style={{fontSize:13,color:C.muted}}>
                <span style={{fontWeight:700,color:C.text}}>{items.length}</span> total
                {" • "}<span style={{fontWeight:700,color:C.green}}>{items.filter(i=>countedItem(i) && i.statusItem==="SESUAI").length}</span> sesuai
                {" • "}<span style={{fontWeight:700,color:C.red}}>{selisihCount}</span> selisih
                {" • "}<span style={{fontWeight:700,color:"#b45309"}}>{items.filter(i=>countedItem(i) && ["TIDAK_ADA_DI_SAP","TIDAK_ADA_DI_SISTEM"].includes(i.statusItem)).length}</span> belum terdaftar
              </div>
              {activeOpname.flowVersion === 2 && isSAP && prog.total > 0 && prog.filled === prog.total && canEditDraft && (
                <div className="opname-next-stage">
                  <div><strong>SAP selesai untuk {activeOpname.gudangKode || "gudang ini"}.</strong><span> Non-SAP (opsional) dapat dibuka pada gudang yang sama setelah SAP selesai.</span></div>
                  <button type="button" className="opname-next-stage__button" onClick={()=>openOrCreateNonSapChild(activeOpname)}><ArrowRight size={16} weight="bold" aria-hidden="true" />Input Non-SAP (opsional)</button>
                </div>
              )}
            </div>

            {/* Validation errors */}
            {validationErrors.length>0 && (
              <div style={{background:"#fee2e2",border:`1px solid #fca5a5`,borderRadius: 10,padding:10,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:"#991b1b",marginBottom:4}}>❌ Perlu diperbaiki sebelum submit:</div>
                {validationErrors.slice(0,5).map((e,i)=><div key={i} style={{fontSize:12,color:"#991b1b"}}>• {e}</div>)}
                {validationErrors.length>5 && <div style={{fontSize:12,color:"#991b1b"}}>... dan {validationErrors.length-5} lainnya</div>}
              </div>
            )}

            {/* Tabel item */}
            <div className="mobile-card-table opname-card-table" style={{overflowX:"auto",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                {canEditDraft ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button style={sty.btn("ghost","sm")} onClick={handleScanQty}><Barcode size={16} aria-hidden="true" /> Scan QR untuk cari baris</button>
                    <span style={{fontSize:12,color:C.muted}}>Scan cuma membantu temukan & lompat ke barisnya — qty hasil hitung fisik tetap wajib diketik manual.</span>
                  </div>
                ) : <div/>}
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {isSingleGudang ? (() => {
                    // Blok yang benar-benar ada di sesi ini (reuse pola getItemBlocks di chip progres),
                    // fallback ke daftar lokasi gudang kalau item belum punya blok sama sekali.
                    const seen = new Set();
                    let bloks = [];
                    for (const it of items) {
                      for (const b of getItemBlocks(it, lokasiList, gudangList)) {
                        if (seen.has(b.lokasiId)) continue;
                        seen.add(b.lokasiId);
                        bloks.push(b);
                      }
                    }
                    if (!bloks.length) bloks = sortedLokasiList.filter(l=>l.gudangId===singleGudangId).map(l=>({lokasiId:l.id, lokasiKode:l.kode}));
                    bloks.sort((a,b)=>(a.lokasiKode||"").localeCompare(b.lokasiKode||"",undefined,{numeric:true}));
                    return (
                      <select style={{...sty.select,fontSize:12,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:"unset",width:"auto"}} value={filterLokasiId}
                        onChange={e=>{const v=e.target.value; setFilterLokasiId(v); setFilterGudangId(v?singleGudangId:""); setPage(0);}}>
                        <option value="">Semua Blok</option>
                        {bloks.map(b=><option key={b.lokasiId||"none"} value={b.lokasiId||""}>{b.lokasiKode||"Tanpa Lokasi"}</option>)}
                      </select>
                    );
                  })() : (
                    <>
                      <select style={{...sty.select,fontSize:12,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:"unset",width:"auto"}} value={filterGudangId}
                        onChange={e=>{setFilterGudangId(e.target.value);setFilterLokasiId("");setPage(0);}}>
                        <option value="">Semua Gudang</option>
                        {sortedGudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                        <option value="__NONE__">Tanpa Lokasi</option>
                      </select>
                      {filterGudangId && filterGudangId!=="__NONE__" && (
                        <select style={{...sty.select,fontSize:12,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:"unset",width:"auto"}} value={filterLokasiId}
                          onChange={e=>{setFilterLokasiId(e.target.value);setPage(0);}}>
                          <option value="">Semua Blok</option>
                          {sortedLokasiList.filter(l=>l.gudangId===filterGudangId).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                        </select>
                      )}
                    </>
                  )}
                  {activeOpname.flowVersion < 2 && (
                    <select style={{...sty.select,fontSize:12,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:"unset",width:"auto"}} value={filterJenis}
                      onChange={e=>{setFilterJenis(e.target.value);setPage(0);}}>
                      <option value="">Semua Jenis</option>
                      <option value="SAP">SAP</option>
                      <option value="Non-SAP">Non-SAP</option>
                    </select>
                  )}
                  <select aria-label="Filter selisih" style={{...sty.select,fontSize:12,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:"unset",width:"auto"}} value={filterSelisihOnly?"selisih":"semua"}
                    onChange={e=>{setFilterSelisihOnly(e.target.value==="selisih");setPage(0);}}>
                    <option value="semua">Semua</option>
                    <option value="selisih">Selisih saja</option>
                  </select>
                </div>
                <input type="search" value={materialSearch} onChange={e=>{setMaterialSearch(e.target.value);setPage(0);}} placeholder="Cari no katalog atau nama material" aria-label="Cari no katalog atau nama material" style={{...sty.input,fontSize:16,minWidth:220,flex:"1 1 220px"}} />
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.muted}}>
                  Tampilkan:
                  {[10,20,50].map(n=>(
                    <button key={n} onClick={()=>{setPageSize(n);setPage(0);}}
                      style={{padding:"3px 9px",borderRadius: 10,border:`1px solid ${pageSize===n?C.accent:C.border}`,background:pageSize===n?C.accent:"white",color:pageSize===n?"white":C.text,fontSize:12,fontWeight:pageSize===n?700:400,cursor:"pointer"}}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                {(() => { const thBase = {padding:"7px 8px",fontSize:12,fontWeight:700,letterSpacing:".3px",textTransform:"uppercase"}; return (
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    {!isMobile && <th style={{...thBase,textAlign:"center",width:36}}>No</th>}
                    <th style={{...thBase,textAlign:"left"}}>Nama Barang</th>
                    {!isMobile && <th style={{...thBase,textAlign:"center"}}>No Katalog</th>}
                    <th style={{...thBase,textAlign:"center"}}>Sat</th>
                    {!isMobile && <th style={{...thBase,textAlign:"center"}}>Qty Sistem</th>}
                    {isSAP && <th style={{...thBase,textAlign:"center"}}>Qty SAP</th>}
                    <th style={{...thBase,textAlign:"center"}}>Qty Fisik</th>
                    <th style={{...thBase,textAlign:"center"}}>Selisih</th>
                    <th style={{...thBase,textAlign:"center"}}>Status</th>
                    {!isSAP && <th style={{...thBase,textAlign:"center"}}>Lokasi *</th>}
                    <th style={{...thBase,textAlign:"left"}}>Keterangan</th>
                    <th style={{...thBase,textAlign:"center"}}>Foto</th>
                  </tr>
                </thead>
                ); })()}
                <tbody>
                  {pageEntries.map(({it:item, idx:realIdx})=>{
                    const isHighlighted = highlightIdx===realIdx;
                    const counted = countedItem(item);
                    const needsNote = itemNeedsStockOpnameNote(activeOpname.items || [], realIdx, { isSap: isSAP });
                    const rowBg = isHighlighted ? "#dbeafe" : "white";
                    const statusBadge = item.statusItem==="SESUAI"
                      ? {bg:"#dcfce7",fg:"#166534",label:"Sesuai"}
                      : item.statusItem==="TIDAK_ADA_DI_SAP"
                      ? {bg:"#f3f4f6",fg:"#6b7280",label:"Tdk di SAP"}
                      : item.statusItem==="TIDAK_ADA_DI_SISTEM"
                      ? {bg:"#fef3c7",fg:"#92400e",label:"Tdk di Sistem"}
                      : item.statusItem==="MATERIAL_BARU_NONSAP"
                      ? {bg:"#dbeafe",fg:"#1e40af",label:"Baru (Non-Stock)"}
                      : {bg:"#fee2e2",fg:"#991b1b",label:"Selisih"};
                    const itemGudangId = lokasiList?.find(l=>l.id===item.lokasiId)?.gudangId || "";
                    return (
                      <tr className="mobile-card-table__row" key={realIdx} style={{borderBottom:`1px solid ${C.border}`,background:rowBg,outline:isHighlighted?`2px solid #3b82f6`:"none","--opname-accent":counted?statusBadge.fg:"#dbe3ef"}}>
                        {!isMobile && <td data-label="No" className="is-key" style={{padding:"6px 8px",textAlign:"center",color:C.muted,fontSize:12}}>{realIdx+1}</td>}
                        <td data-label="Nama Barang" className="mobile-card-table__title opname-item-name" style={{padding:"6px 8px",fontWeight:600,maxWidth:isMobile?180:260,overflowWrap:"anywhere",whiteSpace:"normal",lineHeight:1.35,minWidth:0}}>
                          <div style={{fontWeight:700,overflowWrap:"anywhere",whiteSpace:"normal"}}>{item.namaBarang}</div>
                          {isMobile && <div style={{fontSize:12,fontWeight:400,color:C.muted,fontFamily:"monospace",marginTop:2}}>No. Katalog: {item.noKatalog}</div>}
                          <div style={{fontSize:12,color:C.muted,marginTop:3,whiteSpace:"normal",overflowWrap:"anywhere"}}>{itemSapLabel(item)}</div>
                          {item.statusItem==="TIDAK_ADA_DI_SISTEM" && (
                            <div tabIndex={0} className="info-note" style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:10,padding:"6px 10px",marginTop:4,whiteSpace:"normal"}}>Material baru — akan dibuatkan Master Katalog + Data Stok saat sesi ini disetujui Manager (kalau qty fisik diisi &gt;0)</div>
                          )}
                          {item.statusItem==="MATERIAL_BARU_NONSAP" && (
                            <div tabIndex={0} className="info-note" style={{fontSize:12,fontWeight:700,color:"#1d4ed8",background:"#dbeafe",border:"1px solid #93c5fd",borderRadius:10,padding:"6px 10px",marginTop:4,whiteSpace:"normal"}}>Ditemukan saat opname — sudah aktif sebagai "Pending Approval", dikonfirmasi penuh saat Manager approve sesi ini.{item.belumDicocokkanMara && " Belum dicocokkan ke MARA."}</div>
                          )}
                          {/* Fase 1f: item bisa tersebar di beberapa lokasi dalam gudang ini */}
                          {item.lokasiBreakdown && item.lokasiBreakdown.length>0 && (
                            <div style={{display:"flex",flexDirection:"column",gap:4,marginTop:5,alignItems:"flex-start"}}>
                              {item.lokasiBreakdown.slice(0,3).map((b,bi)=>{
                                const st = canEditDraft && b.stockId ? stocks.find(s=>s.id===b.stockId) : null;
                                const box = {display:"inline-flex",flexDirection:"column",gap:1,padding:"3px 9px",borderRadius:8,border:`1px solid ${st?`${C.accent}55`:C.border}`,background:st?`${C.accent}0f`:"#f8fafc",textAlign:"left",maxWidth:"100%"};
                                const content = <>
                                  <span style={{fontSize:12,color:st?C.accent:C.text}}><strong style={{fontWeight:700}}>{b.lokasiKode||"Tanpa Lokasi"}</strong> · {b.qty}</span>
                                  <span style={{fontSize:12,color:C.muted,overflowWrap:"anywhere"}}>{b.sourceLabel}</span>
                                </>;
                                return st
                                  ? <button type="button" key={bi} title="Ketuk untuk ubah lokasi"
                                      onClick={()=>setMoveStock({ st, lok: lokasiList.find(l=>l.id===st.lokasiId)||null, gdg: gudangList.find(g=>g.id===st.gudangId)||null })}
                                      style={{...box,font:"inherit",cursor:"pointer"}}>{content}</button>
                                  : <span key={bi} style={box}>{content}</span>;
                              })}
                              {item.lokasiBreakdown.length>3 && <span style={{fontSize:12,color:C.muted}}>+{item.lokasiBreakdown.length-3} lagi</span>}
                            </div>
                          )}
                        </td>
                        {!isMobile && <td data-label="No Katalog" className="is-key" style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{item.noKatalog}</td>}
                        <td data-label="Sat" className="is-key" style={{padding:"6px 8px",textAlign:"center"}}>{item.satuan}</td>
                        {!isMobile && <td data-label="Qty Sistem" className="is-key" style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{fmtNum(item.qtySistem)}</td>}
                        {isSAP && <td data-label="Qty SAP" className="is-key" style={{padding:"6px 8px",textAlign:"center",color:item.qtySAP!=null?C.text:"#9ca3af",whiteSpace:"nowrap"}}>{item.qtySAP!=null?fmtNum(item.qtySAP):"—"}</td>}
                        <td data-label="Qty Fisik" className="is-key" style={{padding:"4px 6px",textAlign:"center"}}>
                          {canEditDraft
                            ? <input type="number" inputMode="decimal" min="0" placeholder="hitung…"
                                value={counted ? item.qtsFisik : ""}
                                ref={el=>{qtyInputRefs.current[realIdx]=el;}}
                                onChange={e=>{ updateItem(realIdx,"qtsFisik",e.target.value); scheduleDesktopSave(); }}
                                onBlur={saveDesktopQty}
                                style={{width:64,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius: 10,fontSize:12,textAlign:"center"}}/>
                            : <span style={{fontWeight:700}}>{counted?fmtNum(item.qtsFisik):"—"}</span>}
                        </td>
                        <td data-label="Selisih" className="is-key" style={{padding:"6px 8px",textAlign:"center",fontWeight:700,whiteSpace:"nowrap",
                          color:item.selisih<0?"#dc2626":item.selisih>0?"#16a34a":"#6b7280"}}>
                          {!counted?"—":item.selisih===0?"—":(item.selisih>0?"+":"")+fmtNum(item.selisih)}
                        </td>
                        <td data-label="Status" className="is-key" style={{padding:"6px 8px"}}>
                          <span title={counted?"Sudah dihitung":"Belum dihitung"} style={{marginRight:4,display:"inline-flex",verticalAlign:"middle",color:counted?"#16a34a":"#9ca3af"}}>
                            {counted ? <CheckCircle size={14} weight="fill"/> : "•"}
                          </span>
                          {!counted ? (
                            <span style={{padding:"2px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:"#f3f4f6",color:"#6b7280"}}>Belum dihitung</span>
                          ) : (
                            <span style={{padding:"2px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:statusBadge.bg,color:statusBadge.fg}}>
                              {statusBadge.label}
                            </span>
                          )}
                        </td>
                        {!isSAP && (
                          <td data-label="Lokasi" className="is-key" style={{padding:"4px 6px"}}>
                            {canEditDraft ? (
                              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                <select value={itemGudangId} onChange={e=>{ updateItem(realIdx,"lokasiId",""); updateItem(realIdx,"_gudangTmp",e.target.value); scheduleDesktopSave(0); }}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${C.border}`,borderRadius: 10,fontSize:12}}>
                                  <option value="">-- Gudang --</option>
                                  {sortedGudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                                </select>
                                <select value={item.lokasiId||""} onChange={e=>{ updateItem(realIdx,"lokasiId",e.target.value); scheduleDesktopSave(0); }}
                                  disabled={!itemGudangId && !item._gudangTmp}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${!item.lokasiId?C.red:C.border}`,borderRadius: 10,fontSize:12}}>
                                  <option value="">-- Blok --</option>
                                  {sortedLokasiList.filter(l=>l.gudangId===(itemGudangId||item._gudangTmp)).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                                </select>
                              </div>
                            ) : (
                              <span style={{fontSize:12}}>{lokasiList?.find(l=>l.id===item.lokasiId)?.kode || "-"}</span>
                            )}
                          </td>
                        )}
                        <td data-label="Keterangan" className="is-key" style={{padding:"4px 6px"}}>
                          {canEditDraft
                            ? <textarea rows={2} value={item.keterangan||""}
                                onChange={e=>{ updateItem(realIdx,"keterangan",e.target.value); scheduleDesktopSave(); }}
                                onBlur={saveDesktopQty}
                                placeholder={needsNote?"Wajib diisi...":"Opsional"}
                                style={{width:"100%",minHeight:32,padding:"6px 8px",border:`1px solid ${needsNote&&!item.keterangan?C.red:C.border}`,borderRadius: 10,fontSize:13,resize:"none",fontFamily:"inherit"}}/>
                            : <span style={{fontSize:12,color:C.muted}}>{item.keterangan||"-"}</span>}
                          {isReadOnly && activeOpname.status === "SELESAI" && hasRole(currentUser, "ADMIN", "TL") && needsNote && (
                            <div style={{display:"flex",gap:5,marginTop:6}}>
                              <input aria-label={`Referensi TUG ${item.noKatalog || item.namaBarang}`} value={Object.prototype.hasOwnProperty.call(tugReferenceDrafts, item.stockId || item.id || item.katalogId || item.noKatalog) ? tugReferenceDrafts[item.stockId || item.id || item.katalogId || item.noKatalog] : (item.tugReference || "")} onChange={event => { const key = item.stockId || item.id || item.katalogId || item.noKatalog; setTugReferenceDrafts(prev => ({...prev, [key]: event.target.value})); }} placeholder="Referensi TUG (opsional)" style={{...sty.input,flex:1,minWidth:0,padding:"5px 7px",fontSize:11}} />
                              <button type="button" style={sty.btn("ghost","sm")} onClick={async () => { const key = item.stockId || item.id || item.katalogId || item.noKatalog; const ok = await updateOpnameTugReference(activeOpname, key, tugReferenceDrafts[key] ?? item.tugReference ?? ""); if (ok) setActiveOpname(prev => prev ? {...prev, items: prev.items.map(entry => String(entry.stockId || entry.id || entry.katalogId || entry.noKatalog) === String(key) ? {...entry, tugReference: tugReferenceDrafts[key] ?? item.tugReference ?? ""} : entry)} : prev); }}>Simpan</button>
                            </div>
                          )}
                          {(!isSAP || item.statusItem==="MATERIAL_BARU_NONSAP") && activeOpname.stage==="REKONSILIASI" && canEditDraft && (
                            <div style={{marginTop:4}}>
                              <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:2}}>Pindah ke SAP:</label>
                              <select value={item.pindahJenis||""} onChange={e=>{ updateItem(realIdx,"pindahJenis",e.target.value); scheduleDesktopSave(0); }}
                                style={{...sty.select,width:130,paddingTop:3,paddingBottom:3,paddingLeft:6,paddingRight:6,minHeight:"unset",fontSize:12}}>
                                <option value="">-- pindahkan? --</option>
                                <option value="Cadang">Cadang</option>
                                <option value="Persediaan">Persediaan</option>
                                <option value="Pre Memory">Pre Memory</option>
                              </select>
                            </div>
                          )}
                        </td>
                        <td data-label="Foto" className="is-key" style={{padding:"4px 6px"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            {[["fotoKeseluruhan",Image,"Foto Keseluruhan (opsional)"],["fotoNameplate",Tag,"Foto Nameplate (opsional)"]].map(([field,Icon,label])=>(
                              <label key={field} title={label}
                                style={{width:28,height:28,borderRadius: 10,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:canEditDraft?"pointer":"default",overflow:"hidden",background:item[field]?"transparent":"#f9fafb",flexShrink:0}}>
                                {item[field]
                                  ? <img src={item[field]} alt={label} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  : <Icon size={16} color="#64748b"/>}
                                {canEditDraft && (
                                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                                    onChange={e=>{
                                      const f=e.target.files[0]; if(!f) return;
                                      const r=new FileReader();
                                      r.onload=ev=>handleOpnamePhoto(realIdx, field, ev.target.result);
                                      r.readAsDataURL(f);
                                    }}/>
                                )}
                              </label>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages>1 && (
              <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",alignItems:"center",gap:10,marginBottom:16}}>
                <button style={{...sty.btn("ghost","sm"),opacity:page===0?0.4:1}} disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Sebelumnya</button>
                <div style={{display:"flex",gap:4}}>
                  {Array.from({length:Math.min(totalPages,7)}).map((_,i)=>{
                    const pg = totalPages<=7?i:(page<=3?i:page>=totalPages-4?totalPages-7+i:page-3+i);
                    return (
                      <button key={pg} onClick={()=>setPage(pg)}
                        style={{width:30,height:30,borderRadius: 10,border:`1px solid ${pg===page?C.accent:C.border}`,background:pg===page?C.accent:"white",color:pg===page?"white":C.text,fontSize:12,cursor:"pointer",fontWeight:pg===page?700:400}}>
                        {pg+1}
                      </button>
                    );
                  })}
                </div>
                <button style={{...sty.btn("ghost","sm"),opacity:page===totalPages-1?0.4:1}} disabled={page===totalPages-1} onClick={()=>setPage(p=>p+1)}>Berikutnya →</button>
                <span style={{fontSize:12,color:C.muted}}>Hal {page+1} dari {totalPages}</span>
              </div>
            )}

            {/* Bar aksi bertahap (Fase 0, 0b): Batal · Simpan Draft selalu ada; tombol ketiga
                berubah sesuai progress — Submit HANYA muncul kalau semua qty sudah terisi.
                Sengaja HANYA di sini (bawah tabel), bukan di header juga (keluhan 2026-07-07). */}
            {canEditDraft && (
              <div className="approval-actions opname-action-bar" style={{marginBottom:16}}>
                {desktopSaveState !== "idle" && <span role="status" style={{fontSize:12,color:desktopSaveState === "error" ? C.red : C.muted,alignSelf:"center"}}>
                  {desktopSaveState === "saving" ? "Menyimpan..." : desktopSaveState === "error" ? "Gagal — draft lokal dipertahankan" : "Tersimpan"}
                </span>}
                <button className="approval-btn--cancel" onClick={handleBatal}>✕ Batal</button>
                <button className="approval-btn--cancel" onClick={async ()=>{ const ok = await saveOpname(activeOpname, [...(touchedRef.current[activeOpname.id]||[])]); if (ok) { try { localStorage.removeItem(draftKey(activeOpname.id)); } catch {} } }}>💾 Simpan Draft</button>
                {allBloksSelesai(activeOpname) && activeOpname.stage!=="REKONSILIASI" ? (
                  <button className="approval-btn--primary"
                    onClick={async ()=>{
                      const next = {...activeOpname, stage:"REKONSILIASI"};
                      setActiveOpname(next);
                      await saveOpname(next, [...(touchedRef.current[activeOpname.id]||[])]);
                    }}>
                    ✅ Semua item terhitung → Buka Rekonsiliasi
                  </button>
                ) : activeOpname.stage==="REKONSILIASI" && allBloksSelesai(activeOpname) ? (
                  <button className="approval-btn--primary"
                    onClick={async ()=>{
                      // BUG KRITIS (ditemukan 2026-07-07): dulu saveOpname(activeOpname) dan
                      // submitOpname(activeOpname) dipanggil beruntun TANPA menunggu satu sama lain.
                      // submitOpname sudah menulis SELURUH data opn (spread {...opn}) + status
                      // PENDING_ASMAN — saveOpname menulis objek yang SAMA tapi masih status DRAFT.
                      // Karena keduanya sync ke Supabase secara paralel (network, bukan lagi
                      // localStorage yang instan), race condition: kalau upsert dari saveOpname
                      // (DRAFT) selesai BELAKANGAN dari upsert submitOpname (PENDING_ASMAN), hasil
                      // akhir di database balik jadi DRAFT lagi — submit "hilang" diam-diam padahal
                      // toast sukses tetap muncul. Ini akar masalah sesi opname tidak pernah sampai
                      // ke approval Asman walau semua qty sudah lengkap. Fix: submitOpname saja
                      // (sudah mencakup semua yang dilakukan saveOpname), di-await, baru pindah tab.
                      if(!validate()) return;
                      const submitted = await submitOpname(activeOpname, [...(touchedRef.current[activeOpname.id]||[])]);
                      if (submitted === false) return;
                      try { localStorage.removeItem(draftKey(activeOpname.id)); } catch {}
                      setActiveOpname(null);
                    }}>
                    📋 Submit ke Asman
                  </button>
                ) : (
                  <button className="approval-btn--primary" onClick={()=> isMobile ? setLapanganMode(true) : scrollToFirstEmptyQty()}>
                    {prog.filled===0 ? "Mulai Hitung" : `Lanjut Hitung — ${prog.filled}/${prog.total}`}
                  </button>
                )}
                {/* Fase 2d: desktop tetap bisa buka mode lapangan juga (mis. tablet lebar/laptop touch).
                    Di HP juga WAJIB tampil saat progres 100%: di titik itu "Mulai/Lanjut Hitung" (satu-
                    satunya pintu HP ke overlay) sudah berganti jadi Submit, jadi tanpa ini user HP dgn
                    recount pending mentok — tak ada jalan balik ke overlay untuk hitung ulang. */}
                {(!isMobile || prog.pct===100) && <button className="approval-btn--cancel" onClick={()=>setLapanganMode(true)}>📱 Mode Lapangan</button>}
              </div>
            )}
          </>
        )}

        {/* Approval section for non-draft */}
        {isReadOnly && (
          <div style={{...sty.card,background:"#f0fdf4",marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Status Approval</div>
            {activeOpname.approvedByAsman && <div style={{fontSize:12,color:C.green}}>✅ Asman: {users.find(u=>u.id===activeOpname.approvedByAsman)?.name} • {fmtDate(activeOpname.approvedAtAsman)} {activeOpname.catatanAsman&&`— "${activeOpname.catatanAsman}"`}</div>}
            {activeOpname.approvedByManager && <div style={{fontSize:12,color:C.green,marginTop:4}}>✅ Manager: {users.find(u=>u.id===activeOpname.approvedByManager)?.name} • {fmtDate(activeOpname.approvedAtManager)} {activeOpname.catatanManager&&`— "${activeOpname.catatanManager}"`}</div>}
            {activeOpname.rejectReason && <div style={{fontSize:12,color:C.red,marginTop:4}}>❌ Ditolak: {activeOpname.rejectReason}</div>}
            {activeOpname.status==="SELESAI" && activeOpname.jenisAlur==="SAP" && (
              <button style={{...sty.btn("primary"),marginTop:12,width:"100%"}} onClick={()=>openBaPrintDialog(activeOpname)}>📄 Cetak BA + TUG-15</button>
            )}
          </div>
        )}

        {/* MODAL: Tambah Material Ditemukan (Opname Non-SAP) — 1 layar per barang,
            cari kode MARA dulu, lalu isi qty/lokasi/foto, simpan langsung dapat QR untuk ditempel. */}
        {lapanganMode && (
          <OpnameLapanganView
            activeOpname={activeOpname} setQtyForBlok={setQtyForBlok} confirmRecount={confirmRecount}
            lokasiList={lokasiList} gudangList={gudangList} currentUser={currentUser} sty={sty} C={C} showToast={showToast}
            onClose={()=>setLapanganMode(false)} onOpenTambahMaterial={()=>openTambahModal()} onUploadPhoto={handleOpnamePhoto}
            onSimpanDraft={async ()=>{ const ok = await saveOpname(activeOpname, [...(touchedRef.current[activeOpname.id]||[])]); if (ok) { try { localStorage.removeItem(draftKey(activeOpname.id)); } catch {} } }}
          />
        )}

        {tambahModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:12}}>
            <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
              {qrResult ? (
                <>
                  <h3 style={{fontSize:15,fontWeight:800,marginBottom:14}}>🏷️ Label QR Siap Dicetak</h3>
                  {(() => {
                    const scanUrl = scanUrlFor(qrResult.id);
                    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(scanUrl)}`;
                    return (
                      <div style={{border:`3px solid ${C.accent}`,borderRadius:10,padding:16,background:"white",textAlign:"center",marginBottom:14}}>
                        <img src={qrImgUrl} alt="QR" width={160} height={160} style={{display:"block",margin:"0 auto"}}/>
                        <div style={{fontSize:13,fontWeight:800,marginTop:10}}>{qrResult.name}</div>
                        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Kode: {qrResult.katalog}</div>
                        <span style={{display:"inline-block",marginTop:8,padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,background:"#dbeafe",color: "#1d4ed8"}}>Non-Stock — Pending Approval</span>
                      </div>
                    );
                  })()}
                  <div style={{fontSize:12,color:C.muted,textAlign:"center",marginBottom:16}}>
                    Screenshot/print gambar QR di atas, tempel ke barang fisik sekarang juga.
                  </div>
                  <button style={{...sty.btn("primary"),width:"100%",marginBottom:8}} onClick={()=>{ setTambahModal(false); setQrResult(null); setActiveQueueId(null); }}>
                    ➡️ Lanjut ke Material Berikutnya
                  </button>
                  <button style={{...sty.btn("ghost"),width:"100%"}} onClick={()=>setQrResult(null)}>← Lihat Ulang Form</button>
                </>
              ) : (
                <>
                  <h3 style={{fontSize:15,fontWeight:800,marginBottom:14}}>➕ Tambah Material Ditemukan</h3>
                  {activeQueueId && (() => {
                    const q = tambahQueue.find(x=>x.id===activeQueueId);
                    return q ? (
                      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius: 10,padding:10,marginBottom:12,fontSize:12}}>
                        📋 Dari file usulan — Katalog asli AppSheet: <b>{q.katalogAsli||"-"}</b>, Qty file (data lama, cek ulang fisik): <b>{q.qtyFile||"-"}</b>
                      </div>
                    ) : null;
                  })()}
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Nama Material *</label>
                    <input style={sty.input} value={tambahForm.nama} onChange={e=>{setTambahForm(f=>({...f,nama:e.target.value})); searchMaraForOpname(e.target.value);}} placeholder="Ketik nama, sistem cari otomatis ke MARA..."/>
                  </div>
                  {maraLoading && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Mencari ke MARA...</div>}
                  {!maraPicked && maraResults.length>0 && (
                    <div style={{border:`1px solid ${C.border}`,borderRadius: 10,marginBottom:10,maxHeight:160,overflowY:"auto"}}>
                      {maraResults.map(r=>(
                        <div key={r.kode_material} onClick={()=>{setMaraPicked(r); setMaraResults([]); setMaraSkip(false);}}
                          style={{padding:"6px 8px",fontSize:12,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
                          <b>{r.kode_material}</b> — {r.nama} ({r.satuan})
                        </div>
                      ))}
                    </div>
                  )}
                  {maraPicked ? (
                    <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius: 10,padding:10,marginBottom:10,fontSize:12}}>
                      ✅ Dipilih: <b>{maraPicked.kode_material}</b> — {maraPicked.nama}
                      <button style={{...sty.btn("ghost","sm"),marginLeft:8}} onClick={()=>setMaraPicked(null)}>Ganti</button>
                    </div>
                  ) : (
                    <button style={{...sty.btn(maraSkip?"primary":"ghost","sm"),width:"100%",marginBottom:10}} onClick={()=>setMaraSkip(true)}>
                      ⏭️ Tidak ada di MARA / lewati dulu (kode sementara dibuat otomatis)
                    </button>
                  )}
                  {!maraPicked && (
                    <div style={{marginBottom:10}}>
                      <label style={sty.label}>Satuan {maraSkip?"*":""}</label>
                      <input style={sty.input} value={tambahForm.satuan} onChange={e=>setTambahForm(f=>({...f,satuan:e.target.value}))} placeholder="cth: BH, M, SET"/>
                    </div>
                  )}
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Qty Fisik *</label>
                    <input type="number" inputMode="decimal" min="0" style={sty.input} value={tambahForm.qty} onChange={e=>setTambahForm(f=>({...f,qty:e.target.value}))}/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Gudang *</label>
                    <select style={sty.select} value={tambahForm.gudangId} onChange={e=>setTambahForm(f=>({...f,gudangId:e.target.value,lokasiId:""}))}>
                      <option value="">-- Pilih Gudang --</option>
                      {sortedGudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Blok Lokasi *</label>
                    <select style={sty.select} value={tambahForm.lokasiId} onChange={e=>setTambahForm(f=>({...f,lokasiId:e.target.value}))} disabled={!tambahForm.gudangId}>
                      <option value="">-- Pilih Blok --</option>
                      {sortedLokasiList.filter(l=>l.gudangId===tambahForm.gudangId).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={sty.label}>📷 Foto Barang</label>
                    <label style={{...sty.btn("ghost"),display:"block",textAlign:"center",cursor:"pointer"}}>
                      {tambahForm.foto ? "✅ Foto sudah diambil (tap untuk ganti)" : "📷 Ambil Foto"}
                      <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                        onChange={e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setTambahForm(fm=>({...fm,foto:ev.target.result})); r.readAsDataURL(f); }}/>
                    </label>
                    {tambahForm.foto && <img src={tambahForm.foto} alt="preview" style={{width:"100%",maxHeight:160,objectFit:"cover",borderRadius: 10,marginTop:8}}/>}
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTambahModal(false);setActiveQueueId(null);}} disabled={tambahBusy}>Batal</button>
                    <button style={{...sty.btn("primary"),flex:2,opacity:tambahBusy?0.6:1}} onClick={submitTambahMaterial} disabled={tambahBusy}>{tambahBusy?"Menyimpan...":"💾 Simpan & Lihat QR"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── LIST VIEW (Fase 0: satu layar — dropzone, panel analisa, riwayat) ─────
  const pendingForMe = opnameList.filter(o=>
    o.status==="PENDING_ASMAN"&&hasRole(currentUser, "ASMAN")
  );
  const draftSessions = opnameList.filter(o=>o.status==="DRAFT" && o.id!==activeOpname?.id);
  const canCreate = can(currentUser, "aksi.import", rolePerms);

  return (
    <div>
      <div style={{display:showWork?"block":"none"}}>
      <OperationsHero
        eyebrow="Stock Opname"
        title="Stock Opname"
        description="Hitung SAP per gudang; Non-SAP dapat dibuka setelah SAP selesai"
        scope={`${opnameList.length} sesi`}
        metrics={[
          {label:"Menunggu approval",value:pendingForMe.length,alert:pendingForMe.length>0},
          {label:"Draft berjalan",value:draftSessions.length},
          {label:"Selesai",value:opnameList.filter(o=>o.status==="SELESAI").length},
        ]}
      />

      {/* Zona upload PID — dropzone gantikan tombol "+ Opname SAP" (Fase 0, 0a). Sesi DRAFT
          baru cuma dibuat SETELAH file berhasil di-parse (startOpnameFromFile). */}
      {canCreate && !activeOpname && (
        <div style={{marginBottom:20}}>
          {draftSessions.length>0 && <section aria-labelledby="opname-draft-title" style={{border:`1px solid ${C.accent}55`,borderRadius:14,padding:"14px 16px",marginBottom:12,background:`${C.accent}0d`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10}}>
              <div>
                <div id="opname-draft-title" style={{fontSize:15,fontWeight:850,color:C.text||"#111827"}}>Ada opname yang bisa dilanjutkan</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>Selesaikan hitungan yang masih tersimpan sebagai draft.</div>
              </div>
              <span style={{minWidth:28,height:28,padding:"0 8px",display:"inline-flex",alignItems:"center",justifyContent:"center",borderRadius:999,background:C.accent,color:"white",fontSize:13,fontWeight:800}}>{draftSessions.length}</span>
            </div>
            <div style={{display:"grid",gap:8}}>
              {draftSessions.slice(0,3).map(opn=>{
                const progress = opnameProgress(opn.items||[], null, { requireTimestamp: opn.flowVersion===2 });
                return <div key={opn.id} style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",padding:"10px 12px",borderRadius:10,background:C.surface||"white",border:`1px solid ${C.border}`}}>
                  <div style={{flex:"1 1 220px",minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",fontSize:13,fontWeight:800}}>
                      <span>{opn.semester || "Semester belum diisi"}</span><span style={{color:C.muted,fontWeight:500}}>• {opn.jenisAlur || opn.kategori || "Stock Opname"}</span>
                      {opn.flowVersion !== 2 && <span className="opname-legacy-badge">Legacy</span>}
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginTop:3}}>{opn.gudangKode || "Gudang belum dipilih"} • {progress.filled}/{progress.total} item terhitung • {fmtDate(opn.dibuatAt)}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flex:"0 0 auto"}}>
                    <span style={{fontSize:11,fontWeight:800,color:"#92400e",background:"#fef3c7",padding:"4px 8px",borderRadius:999}}>Draft</span>
                    <button type="button" aria-label={`Lanjutkan opname ${opn.semester||""}`} style={{...sty.btn("primary","sm"),whiteSpace:"nowrap"}} onClick={()=>{setActiveOpname(opn);setPage(0);}}>Lanjutkan opname <ArrowRight size={14} aria-hidden="true" /></button>
                  </div>
                </div>;
              })}
            </div>
            {draftSessions.length>3 && <div style={{fontSize:11,color:C.muted,marginTop:8}}>Menampilkan 3 draft terbaru.</div>}
          </section>}
          <div
            onDragOver={e=>{e.preventDefault(); setDragActive(true);}}
            onDragLeave={()=>setDragActive(false)}
            onDrop={e=>{e.preventDefault(); setDragActive(false); handleDropzoneFiles(e.dataTransfer.files);}}
            onClick={()=>!csvLoading && dropInputRef.current?.click()}
            style={{border:`1px dashed ${dragActive?C.accent:C.border}`,borderRadius:14,padding:"28px 20px",textAlign:"center",cursor:csvLoading?"default":"pointer",background:dragActive?"#eff6ff":"transparent",transition:"border-color .15s,background .15s"}}>
            <div style={{fontSize:17,fontWeight:600,marginBottom:4}}>{csvLoading?"Memproses file...":"Tarik & lepas file PID di sini"}</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Format CSV/XLSX export SAP MM (PEMAT_DDMMYYYY)</div>
            <button type="button" style={sty.btn("primary")} disabled={csvLoading} onClick={e=>{ e.stopPropagation(); dropInputRef.current?.click(); }}>
{csvLoading?"Memproses...":<><FileArrowUp size={16} aria-hidden="true" /> Pilih File</>}
            </button>
            <input ref={dropInputRef} type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" style={{display:"none"}} disabled={csvLoading}
              onChange={e=>{ handleDropzoneFiles(e.target.files); e.target.value=""; }}/>
          </div>
          <div className="opname-flow-note">Sesi baru dimulai dari SAP. Non-SAP dapat dibuka per gudang setelah seluruh item SAP terhitung, tetapi tidak wajib untuk submit SAP.</div>
        </div>
      )}

      {moveStock && (
        <PindahBlokModal C={C} sty={sty} currentUser={currentUser}
          st={moveStock.st} lok={moveStock.lok} gdg={moveStock.gdg}
          stocks={stocks} setStocks={setStocks} lokasiList={lokasiList}
          visibleGudangList={stockVisibleGudangList || visibleGudangList} stockGudangFilter={stockGudangFilter}
          setStockGudangFilter={setStockGudangFilter} saveToCloud={saveToCloud}
          showToast={showToast} onClose={handleCloseMove} />
      )}

      {/* Fase 1e: dialog pilih gudang — muncul kalau file PID memuat item dari >1 gudang */}
      {gudangSplitDialog && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:12}}>
          <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
            <h3 style={{fontSize:15,fontWeight:800,marginBottom:6}}>📦 Pilih Gudang untuk Sesi Opname</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:14}}>File PID memuat item dari beberapa gudang — satu sesi opname dibuat per gudang yang dipilih.</p>
            {gudangSplitDialog.groups.map(g=>{
              const key = g.gudangId||"_NONE";
              const checked = gudangSplitDialog.selected.has(key);
              return (
                <label key={key} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
                  <input type="checkbox" checked={checked} onChange={()=>setGudangSplitDialog(d=>{
                    const sel = new Set(d.selected); checked?sel.delete(key):sel.add(key); return {...d,selected:sel};
                  })}/>
                  <span style={{flex:1,fontSize:13,fontWeight:600}}>{g.gudangKode || "Belum Beralamat"}</span>
                  <span style={{fontSize:12,color:C.muted}}>{g.items.length} item</span>
                </label>
              );
            })}
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setGudangSplitDialog(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={confirmGudangSplit}>Buat Sesi ({gudangSplitDialog.selected.size})</button>
            </div>
          </div>
        </div>
      )}

      {/* Panel analisa — muncul di halaman yang sama, di bawah dropzone (bukan pindah layar) */}
      {renderPanel()}

      {/* Pending approval cards */}
      {pendingForMe.map(opn=>(
        <div key={opn.id} style={{...sty.card,borderLeft:`4px solid #f59e0b`,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:4}}>⏳ Menunggu Approval Kamu ({ROLES[currentUser.role]})</div>
          <div style={{fontWeight:800,fontSize:13,marginBottom:2}}>Opname {opn.semester} — {opn.jenisAlur}</div>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>
            {opn.items?.length||0} item • Selisih: {opn.items?.filter(i=>i.selisih!==0).length||0} item
          </div>
          {rejectingId===opn.id
            ? <div style={{display:"flex",gap:8}}>
                <input style={{...sty.input,flex:1}} placeholder="Alasan penolakan (wajib)..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                <div className="approval-actions">
                  <button className="approval-btn--danger" onClick={()=>{rejectOpname(opn,rejectReason);setRejectingId(null);setRejectReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                  <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                </div>
              </div>
            : <div className="opname-pending-actions" style={{display:"flex",gap:8}}>
                <button style={sty.btn("ghost","sm")} onClick={()=>{reviewSelisihRef.current=true;setActiveOpname(opn);setFilterSelisihOnly(true);setPage(0);}}>🔍 Review Detail (Selisih)</button>
                <div className="approval-actions">
                  <button className="approval-btn--approve" onClick={()=>setReviewApproval(opn)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Periksa &amp; Setujui</button>
                  <button className="approval-btn--reject" onClick={()=>setRejectingId(opn.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                </div>
              </div>}
        </div>
      ))}

      <StockOpnameApprovalReview opn={reviewApproval} C={C} sty={sty} users={users} lokasiList={lokasiList}
        onApprove={approveOpname_Asman} onClose={()=>setReviewApproval(null)} />
      {/* Sekat: pisahkan proses opname (atas) dari riwayat (bawah) — hairline + judul seksi (Apple-like). */}
      </div>

      {/* Fase F: metadata resmi disimpan di JSON sesi sebelum popup diisi. Sengaja di LUAR
          div showWork/showHistory — dipicu tombol dari dua tempat (panel kerja & Riwayat),
          kalau nempel di salah satu div bakal ikut display:none saat tab satunya aktif. */}
      {baPrintOpn && baForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:12}}>
            <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
              <h3 style={{fontSize:15,fontWeight:800,marginBottom:6}}>📄 Cetak Berita Acara + TUG-15</h3>
              <p style={{fontSize:12,color:C.muted,marginBottom:14}}>UPT {baForm.identity?.upt?.nama || baForm.identity?.uptId || "-"} • Gudang {baPrintOpn.gudangKode || "-"} • {baPrintOpn.semester}</p>
            {baForm.identity?.candidateUptIds?.length > 1 && <>
              <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:4}}>Pilih UPT sesi</label>
              <select style={{...sty.input,marginBottom:10}} value={baForm.identity.uptId || ""} onChange={e=>selectBaPrintUpt(e.target.value)}>
                <option value="">Pilih UPT yang benar...</option>
                {baForm.identity.candidateUptIds.map(id=><option key={id} value={id}>{uptList.find(u=>String(u.id)===String(id))?.nama || id}</option>)}
              </select>
            </>}
            {baForm.errors?.length > 0 && <div style={{padding:"10px 12px",borderRadius:8,background:"#fef2f2",color:"#b91c1c",fontSize:12,marginBottom:12}}>
              <strong>Cetak diblokir:</strong><ul style={{margin:"5px 0 0 18px"}}>{baForm.errors.map(error=><li key={error}>{error}</li>)}</ul>
            </div>}
            {baForm.childWarning && <div style={{padding:"8px 10px",borderRadius:8,background:"#fffbeb",color:"#92400e",fontSize:12,marginBottom:12}}>⚠️ {baForm.childWarning}</div>}

            <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:4}}>Tanggal</label>
            <input type="date" style={{...sty.input,marginBottom:10}} value={baForm.tanggal} onChange={e=>setBaForm(f=>({...f,tanggal:e.target.value}))}/>

            <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:4}}>No. PID</label>
            <textarea style={{...sty.input,minHeight:54,marginBottom:10}} placeholder="Pisahkan dengan koma, titik koma, atau baris baru" value={baForm.pidRefsText} onChange={e=>setBaForm(f=>({...f,pidRefsText:e.target.value}))}/>

            <label style={{fontSize:12,fontWeight:700,display:"block",marginBottom:6}}>Tim Pemeriksa</label>
            {baForm.examiners.map((t,i)=>{
              const listId = `examiner-candidates-${i}`;
              return (
              <div key={i} style={{display:"grid",gridTemplateColumns:"24px minmax(0,1fr) 24px",gap:8,marginBottom:10,alignItems:"start"}}>
                <strong style={{fontSize:12,paddingTop:9,textAlign:"center",color:C.muted}}>{i + 1}</strong>
                <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:8}}>
                <input list={listId} style={{...sty.input,flex:1}} placeholder={`Nama ${i+1}`} value={t.name}
                  onChange={e=>{
                    const value = e.target.value;
                    const matched = baForm.examinerCandidates.find(user=>(user.name || user.nama || "").trim().toLowerCase() === value.trim().toLowerCase());
                    setBaForm(f=>({...f,examiners:f.examiners.map((x,xi)=>xi===i?(matched ? normalizeStockOpnamePerson(matched, f.identity?.uptId) : {...x,name:value,userId:null}):x)}));
                  }}/>
                <datalist id={listId}>
                  {baForm.examinerCandidates.map(user=><option key={user.id} value={user.name || user.nama || user.id}/>)}
                </datalist>
                <input style={{...sty.input,flex:1}} placeholder="Jabatan" value={t.position}
                  onChange={e=>setBaForm(f=>({...f,examiners:f.examiners.map((x,xi)=>xi===i?{...x,position:e.target.value}:x)}))}/>
                </div>
                <button type="button" title="Hapus pemeriksa" aria-label={`Hapus pemeriksa ${i+1}`} style={{border:"none",background:"transparent",color:C.muted,cursor:"pointer",fontSize:14,paddingTop:8}}
                  onClick={()=>setBaForm(f=>({...f,examiners:f.examiners.filter((_,xi)=>xi!==i)}))}>✕</button>
              </div>
              );
            })}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:16}}
              onClick={()=>setBaForm(f=>({...f,examiners:[...f.examiners,{userId:null,name:"",position:"",uptId:f.identity?.uptId||null}]}))}>+ Tambah Pemeriksa</button>

            <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:4}}>Manager UPT (read-only)</label>
            <input style={{...sty.input,marginBottom:16,background:C.surfaceMuted||"#f8fafc"}} readOnly value={baForm.manager?.name ? `${baForm.manager.name} — ${baForm.manager.position || "MANAGER"}` : "-"}/>

            <div style={{display:"flex",gap:10,position:"sticky",bottom:-1,background:"#fff",paddingTop:10,paddingBottom:2,marginTop:6,borderTop:`1px solid ${C.border}`}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setBaPrintOpn(null);setBaForm(null);}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2,opacity:baForm.errors?.length||baForm.saving?0.55:1}} disabled={baForm.errors?.length>0||baForm.saving} onClick={cetakBaTug15}>{baForm.saving?"Menyimpan...":"🖨️ Cetak"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="inventory-assurance-history" style={{display:showHistory?"block":"none"}}>
      <div style={{borderTop:`1px solid ${C.border}`,marginTop:24,paddingTop:16,marginBottom:10}}>
        <div className="inventory-assurance-history__title">Riwayat Opname</div>
      </div>

      {/* Filter status — chip compact (Apple-like) */}
      <div className="inventory-assurance-history__filters" style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {["semua","DRAFT","PENDING_ASMAN","SELESAI","DITOLAK"].map(s=>(
          <button key={s} style={{padding:"4px 10px",borderRadius:999,border:`1px solid ${filterStatus===s?C.accent:C.border}`,background:filterStatus===s?C.accent:"transparent",color:filterStatus===s?"white":C.muted,fontSize:12,fontWeight:filterStatus===s?600:400,cursor:"pointer"}}
            onClick={()=>setFilterStatus(s)}>
            {s==="semua"?"Semua":statusLabel[s]||s} <span style={{opacity:.8}}>({s==="semua"?opnameList.length:opnameList.filter(o=>o.status===s).length})</span>
          </button>
        ))}
      </div>

      {/* Riwayat sesi — garis rambut (bukan kartu berbayang, 0c); mengecil & bisa discroll
          sendiri saat panel analisa terbuka supaya tidak berebut layar. */}
      <div style={activeOpname ? {maxHeight:320,overflowY:"auto",paddingRight:4} : undefined}>
        {(filterStatus==="semua"?opnameList:opnameList.filter(o=>o.status===filterStatus))
          .slice().sort((a,b)=>b.dibuatAt-a.dibuatAt)
          .map(opn=>{
            const creator = users.find(u=>u.id===opn.dibuatOleh)||{};
            const selisihCount = (opn.items||[]).filter(i=>itemCounted(i, { requireTimestamp: opn.flowVersion===2 }) && i.selisih!==0).length;
            return (
              <div key={opn.id} className="inventory-assurance-history__row inventory-assurance-history__row--summary" style={{padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-start",gap:6,marginBottom:6}}>
                  <div style={{minWidth:0,flex:"1 1 180px"}}>
                    {opn.flowVersion !== 2 && <span className="opname-legacy-badge">Legacy</span>}
                    <div style={{fontWeight:800,fontSize:13}}>Opname {opn.semester} — {opn.jenisAlur} <span style={{fontSize:12,fontWeight:400,color:C.muted}}>({opn.kategori}{opn.gudangId!==undefined?(opn.gudangKode?` • Gudang ${opn.gudangKode}`:" • Belum Beralamat"):""})</span></div>
                    <div style={{fontSize:11,color:C.muted,marginTop:3}}>{fmtDate(opn.dibuatAt)} • dibuat oleh {creator.name||"-"}</div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                    <span style={{padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,whiteSpace:"nowrap",background:(statusColor[opn.status]||"#6b7280")+"22",color:statusColor[opn.status]||"#6b7280"}}>
                      {statusLabel[opn.status]||opn.status}
                    </span>
                  </div>
                </div>
                <div className="inventory-assurance-history__metrics" style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginBottom:8,fontSize:11}}>
                  <div style={{padding:"6px 8px",borderRadius:7,background:C.surfaceMuted||"#f8fafc"}}><span style={{display:"block",color:C.muted}}>Total item</span><strong style={{fontSize:13}}>{opn.items?.length||0}</strong></div>
                  <div style={{padding:"6px 8px",borderRadius:7,background:C.surfaceMuted||"#f8fafc"}}><span style={{display:"block",color:C.muted}}>Terhitung</span><strong style={{fontSize:13}}>{opnameProgress(opn.items||[], null, { requireTimestamp: opn.flowVersion===2 }).filled}</strong></div>
                  <div style={{padding:"6px 8px",borderRadius:7,background:selisihCount?"#fff7ed":(C.surfaceMuted||"#f8fafc")}}><span style={{display:"block",color:C.muted}}>Selisih</span><strong style={{fontSize:13,color:selisihCount?"#c2410c":"inherit"}}>{selisihCount}</strong></div>
                </div>
                <div className="opname-history-actions" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);onOpenWork?.();}}>
                    🔍 {opn.status==="DRAFT"?"Edit":"Lihat Detail"}
                  </button>
                  {opn.status==="SELESAI" && opn.jenisAlur==="SAP" && <button style={sty.btn("ghost","sm")} onClick={()=>openBaPrintDialog(opn)}>📄 Cetak BA + TUG-15</button>}
                  {opn.status==="SELESAI" && opn.approvedAtAsman && <button style={sty.btn("ghost","sm")} onClick={()=>downloadStockOpnameExcel(opn)}>⬇️ Download Excel</button>}
                  {opn.status==="DRAFT" && hasRole(currentUser, "ADMIN","TL") && <button title="Hapus sesi opname" style={sty.btn("danger","sm")} onClick={()=>deleteOpname(opn.id)}>🗑️</button>}
                </div>
              </div>
            );
          })}

        {(filterStatus==="semua"?opnameList:opnameList.filter(o=>o.status===filterStatus)).length===0 && (
          <div style={{...sty.card,textAlign:"center",padding:50,color:C.muted}}>
            <div style={{fontSize:32,marginBottom:12}}>📋</div>
            <div style={{fontSize:13,fontWeight:700}}>{filterStatus==="semua"?"Belum ada sesi Stock Opname":"Tidak ada opname dengan status ini"}</div>
            <div style={{fontSize:12,marginTop:4}}>{filterStatus==="semua"?"Tarik file PID ke zona upload di atas untuk memulai":"Coba pilih filter status lain."}</div>
          </div>
        )}
      </div>
      </div>
    </div>
  );

  function openBaPrintDialog(opn) {
    const saved = opn.documentMeta?.version === 1 ? opn.documentMeta : null;
    const identity = resolveStockOpnameDocumentIdentity({ opn, users, uptList, gudangList, currentUser, childList: opnameList, selectedUptId:saved?.manager?.uptId || null });
    const tglSrc = opn.approvedAtAsman || opn.dibuatAt || Date.now();
    const candidates = (users || []).filter(user => String(user?.uptId || user?.upt_id || "") === String(identity.uptId || ""));
    const savedExaminers = Array.isArray(saved?.examiners) && saved.examiners.length ? saved.examiners : identity.examiners;
    setBaPrintOpn(opn);
    setBaForm({
      identity,
      manager: saved?.manager || identity.manager,
      examinerCandidates: candidates,
      examiners: [...savedExaminers, ...Array(Math.max(0, 3 - savedExaminers.length)).fill(null)].map(person => normalizeStockOpnamePerson(person, identity.uptId) || { userId:null, name:"", position:"", uptId:identity.uptId }),
      pidRefsText: Array.isArray(saved?.pidRefs) ? saved.pidRefs.join(", ") : "",
      tanggal: saved?.tanggal || new Date(tglSrc).toISOString().slice(0,10),
      errors: identity.errors || [],
      childWarning: identity.childWarning || "",
      saving: false,
    });
  }

  function selectBaPrintUpt(selectedUptId) {
    if (!baPrintOpn) return;
    const identity = resolveStockOpnameDocumentIdentity({ opn:baPrintOpn, users, uptList, gudangList, currentUser, childList:opnameList, selectedUptId:selectedUptId || null });
    const candidates = (users || []).filter(user => String(user?.uptId || user?.upt_id || "") === String(identity.uptId || ""));
    const examiners = [...identity.examiners, ...Array(Math.max(0, 3 - identity.examiners.length)).fill(null)]
      .map(person => normalizeStockOpnamePerson(person, identity.uptId) || { userId:null, name:"", position:"", uptId:identity.uptId });
    setBaForm(form => ({...form, identity, manager:identity.manager, examinerCandidates:candidates, examiners, errors:identity.errors, childWarning:identity.childWarning}));
  }

  async function cetakBaTug15() {
    if (!baPrintOpn || !baForm || baForm.errors?.length || baForm.saving) return;
    const examiners = baForm.examiners.map(person => normalizeStockOpnamePerson(person, baForm.identity?.uptId));
    const validationErrors = [];
    if (!baForm.tanggal) validationErrors.push("Tanggal wajib diisi.");
    if (!examiners.length || examiners.some(person => !person?.name || !person?.position)) validationErrors.push("Nama dan jabatan pemeriksa wajib diisi.");
    const duplicateKeys = new Set();
    examiners.forEach(person => {
      const key = person.userId ? `id:${person.userId}` : `person:${String(person.name).trim().toUpperCase()}|${String(person.position).trim().toUpperCase()}`;
      if (duplicateKeys.has(key)) validationErrors.push("Pemeriksa tidak boleh duplikat.");
      duplicateKeys.add(key);
    });
    if (validationErrors.length) {
      setBaForm(form => ({...form, errors:validationErrors}));
      return;
    }

    // Popup harus dibuat dari event klik sebelum saveOpname await agar tidak diblokir browser.
    let popup;
    try { popup = window.open("", "_blank"); } catch { popup = null; }
    if (!popup) { showToast("Popup cetak diblokir browser. Izinkan popup lalu coba lagi.", "error"); return; }
    setBaForm(form => ({...form, saving:true}));
    const meta = buildStockOpnameDocumentMeta({
      identity: baForm.identity,
      tanggal: baForm.tanggal,
      pidRefs: parseStockOpnamePidRefs(baForm.pidRefsText),
      examiners,
      manager: baForm.identity.manager,
      savedAt: new Date().toISOString(),
      savedBy: currentUser?.id || null,
    });
    const updated = {...baPrintOpn, uptId: baForm.identity.uptId, documentMeta: meta};
    try {
      const saved = await saveOpnameDocumentMeta(baPrintOpn, meta);
      if (saved === false) throw new Error("Penyimpanan metadata gagal.");
      popup.document.write(buildStockOpnamePackageHTML(updated, baForm.identity.child, meta, {katalogList, uptList}));
      popup.document.close();
      setBaPrintOpn(null);
      setBaForm(null);
    } catch (error) {
      try { popup.close(); } catch {}
      setBaForm(form => ({...form, saving:false}));
      showToast(`Gagal menyimpan metadata dokumen: ${error?.message || "coba lagi"}`, "error");
    }
  }
}
