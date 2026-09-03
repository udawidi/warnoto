// Komponen StockOpnameTab — dipindah dari App.jsx (refactor Fase 5c).
import { useState, useRef, useEffect } from "react";
import { useHardwareScanner } from "../hooks/useHardwareScanner.js";
import { supabase } from "../supabaseClient.js";
import { fmtDate, parseSAPFile, parseUsulanPencocokanXLSX, scanUrlFor } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole } from "../lib/roles.js";
import { can } from "../lib/perms.js";
import { buildBeritaAcaraHTML, downloadLembarHitungHTML } from "../lib/docBuilders.js";
import { applyMaraNameSearch, katalogSapStatus, normalizeKatalog, extractKatalogIdFromScan, sumHitungPerLokasi, applyQtyToItem, itemCounted, allBloksSelesai, getItemBlocks, blokKeyOf, blokProgress } from "../lib/sap.js";
import { OperationsHero } from "./OperationsHero.jsx";
import { OpnameLapanganView } from "./OpnameLapanganView.jsx";
import * as XLSX from "xlsx";
import { readXlsxArrayBufferSafe } from "../lib/xlsxImport.js";

export function StockOpnameTab({ opnameList, stocks, katalogList, currentUser, users, sty, C,
  saveOpname, submitOpname, approveOpname_Asman, rejectOpname, deleteOpname, setOpnameFreeze,
  openScanner, showToast, gudangList, lokasiList, addNonStockFoundItem, isMobile, uptList, rolePerms }) {

  const [activeOpname, setActiveOpname] = useState(null);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("semua");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [catatanApproval, setCatatanApproval] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [highlightIdx, setHighlightIdx] = useState(null); // baris hasil scan QR — cuma bantu temukan & fokus, bukan pengganti hitung fisik
  const qtyInputRefs = useRef({});
  const [pageSize, setPageSize] = useState(10);
  const [dragActive, setDragActive] = useState(false); // Fase 0: dropzone PID
  const dropInputRef = useRef(null);
  // Fase 1d: blok (lokasiId | "_TANPA_LOKASI") yang disentuh perangkat INI, per sesi (keyed by
  // opn.id) — dikirim ke saveOpname supaya merge-on-save cuma menimpa blok yang benar diedit di
  // sini, blok lain (device lain) diambil dari server. Ref (bukan state) supaya persist per sesi
  // tanpa perlu direset manual tiap ganti activeOpname.
  const touchedRef = useRef({});
  // Fase 1e: dialog pilih gudang setelah PID di-parse & ternyata memuat >1 gudang.
  const [gudangSplitDialog, setGudangSplitDialog] = useState(null);
  // Fase 2d: layar hitung lapangan satu-tangan (HP/tablet) — overlay di atas panel ini, z-index
  // di BAWAH modal Tambah Material (1000) supaya modal itu tetap bisa dibuka dari lapangan tanpa
  // duplikasi form (lihat renderPanel -> tambahModal).
  const [lapanganMode, setLapanganMode] = useState(false);

  // Fase 3: gudang yang dicentang untuk di-freeze pada sesi yang sedang dibuka — direset
  // tiap ganti sesi (bukan tiap edit item, activeOpname.id stabil per sesi).
  const [freezeSel, setFreezeSel] = useState(new Set());
  useEffect(() => {
    if (!activeOpname) return;
    setFreezeSel(new Set(activeOpname.freeze?.gudangIds || (activeOpname.gudangId ? [activeOpname.gudangId] : [])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOpname?.id]);
  async function toggleFreeze(aktif) {
    const gudangIds = [...freezeSel];
    await setOpnameFreeze(activeOpname, { aktif, gudangIds });
    setActiveOpname(prev => prev && prev.id===activeOpname.id
      ? { ...prev, freeze: aktif ? { aktif:true, gudangIds, at:Date.now(), by:currentUser.id, unfrozenAt:null } : { ...(prev.freeze||{}), aktif:false, unfrozenAt:Date.now() } }
      : prev);
  }

  // Fase 2 (autosave lapangan): jaring recovery kalau tab/HP ketutup sebelum "Simpan Draft"
  // sempat ditekan. Sesi TIDAK punya field updatedAt yang di-bump tiap simpan (cuma dibuatAt
  // sekali saat dibuat) — jadi restore cukup digerbang oleh status masih "DRAFT" (begitu
  // submit/approve, status berubah dan draft lokal otomatis diabaikan, tak perlu bandingkan waktu).
  const draftKey = id => `warnoto_opname_draft_${id}`;
  useEffect(() => {
    if (!activeOpname?.id || activeOpname.status !== "DRAFT") return;
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(activeOpname.id)) || "null");
      if (draft?.items) {
        setActiveOpname(prev => (prev && prev.id === activeOpname.id ? { ...prev, items: draft.items } : prev));
        showToast("Hitungan lapangan lokal dipulihkan");
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOpname?.id]);
  useEffect(() => {
    if (!lapanganMode || !activeOpname?.id) return;
    try { localStorage.setItem(draftKey(activeOpname.id), JSON.stringify({ items: activeOpname.items, at: Date.now() })); } catch {}
  }, [activeOpname, lapanganMode]);

  // Fase 1f: filter Gudang/Blok di toolbar tabel item.
  const [filterGudangId, setFilterGudangId] = useState("");
  const [filterLokasiId, setFilterLokasiId] = useState("");

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
    setPage(Math.floor(idx / pageSize));
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
      return { lokasiId: s.lokasiId||null, lokasiKode: lok?.kode||null, gudangId: lok?.gudangId||null, gudangKode: gud?.kode||gud?.nama||null, qty: s.qty||0 };
    });
  }
  // Fase 1c: seed hitungPerLokasi dari qtySistem (default awal — belum benar-benar dihitung
  // fisik). Blok tunggal → kunci lokasinya; kosong/multi-blok → "_TANPA_LOKASI" (breakdown penuh
  // per-blok menyusul di mode lapangan Fase 2).
  function seedHitungPerLokasi(qtySistem, lokasiBreakdown) {
    if (!qtySistem) return {};
    const key = lokasiBreakdown.length===1 ? (lokasiBreakdown[0].lokasiId||"_TANPA_LOKASI") : "_TANPA_LOKASI";
    return { [key]: { qty: qtySistem, at: null, by: null } };
  }

  function buildItemsFromSAP(sapRows) {
    const items = [];
    // Fase 1a: key ternormalisasi (normalizeKatalog) dua arah — SAP kadang beda zero-padding
    // dari Master Katalog, perbandingan mentah sebelumnya bikin item ke-cap "Tidak ada di SAP"
    // padahal sebenarnya cocok.
    const katalogByNo = {};
    katalogList.forEach(k=>{ if(k.katalog) katalogByNo[normalizeKatalog(k.katalog)]=k; });

    // Items from Data Stok — try match to SAP
    const allKids = [...new Set(stocks.map(s=>s.katalogId).filter(Boolean))];
    allKids.forEach(kid=>{
      const kat = katalogList.find(k=>k.id===kid); if(!kat) return;
      const katRows = stocks.filter(s=>s.katalogId===kid);
      const qtySistem = katRows.reduce((a,s)=>a+(s.qty||0),0);
      const sapRow = sapRows.find(r=>normalizeKatalog(r.katalog)===normalizeKatalog(kat.katalog));
      const lokasiBreakdown = buildLokasiBreakdown(katRows);
      items.push({
        katalogId: kid, namaBarang: kat.name, noKatalog: kat.katalog||"-", satuan: kat.satuan||"-",
        qtySistem, qtySAP: sapRow?.qty??null,
        qtsFisik: null, selisih: 0,
        statusItem: sapRow==null?"TIDAK_ADA_DI_SAP":"SESUAI",
        keterangan: "", lokasiBreakdown, hitungPerLokasi: seedHitungPerLokasi(qtySistem, lokasiBreakdown),
      });
    });

    // Items in SAP but not in sistem
    sapRows.forEach(sr=>{
      const kat = katalogByNo[normalizeKatalog(sr.katalog)];
      if(!kat) {
        items.push({
          katalogId: null, namaBarang: sr.nama, noKatalog: sr.katalog, satuan: sr.satuan,
          qtySistem: 0, qtySAP: sr.qty, qtsFisik: 0, selisih: 0,
          statusItem: "TIDAK_ADA_DI_SISTEM", keterangan: "", lokasiBreakdown: [], hitungPerLokasi: {},
        });
      }
    });
    return items;
  }

  function buildItemsNonSAP() {
    // Only Non-SAP items from Data Stok
    return [...new Set(stocks.filter(s=>katalogSapStatus(katalogList.find(k=>k.id===s.katalogId))==="Non-SAP").map(s=>s.katalogId))]
      .filter(Boolean).map(kid=>{
        const kat = katalogList.find(k=>k.id===kid);
        if(!kat) return null;
        const katRows = stocks.filter(s=>s.katalogId===kid);
        const qtySistem = katRows.reduce((a,s)=>a+(s.qty||0),0);
        const lokasiBreakdown = buildLokasiBreakdown(katRows);
        return { katalogId:kid, namaBarang:kat.name, noKatalog:kat.katalog||"-", satuan:kat.satuan||"-",
          qtySistem, qtsFisik:null, selisih:0, statusItem:"SESUAI", keterangan:"",
          lokasiBreakdown, hitungPerLokasi: seedHitungPerLokasi(qtySistem, lokasiBreakdown) };
      }).filter(Boolean);
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
      id: "OPN-"+Date.now(), semester, jenisAlur, kategori: jenisAlur==="SAP"?"Material SAP":"Material Non-SAP",
      status:"DRAFT", items:jenisAlur==="NON_SAP"?buildItemsNonSAP():[],
      dibuatOleh:currentUser.id, dibuatAt:Date.now(),
      sapUploadedAt:null, totalRowsSAP:0,
      approvedByAsman:null, approvedAtAsman:null, catatanAsman:"",
      approvedByManager:null, approvedAtManager:null, catatanManager:"",
      submittedAt:null, rejectReason:"",
      ...extra,
    };
  }

  function startOpname(jenisAlur) {
    setActiveOpname(buildNewOpnameShell(jenisAlur));
    setPage(0); setValidationErrors([]);
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
  function handleBatal() {
    const persisted = opnameList.some(o=>o.id===activeOpname.id);
    if (!persisted && !window.confirm("Buang sesi opname ini? Data yang sudah diisi belum tersimpan dan akan hilang.")) return;
    setActiveOpname(null); setValidationErrors([]); setHighlightIdx(null);
  }

  // "Mulai Hitung" / "Lanjut Hitung" (Fase 0, sebelum scanner Fase 1 ada): scroll+fokus ke
  // baris qty kosong pertama.
  function scrollToFirstEmptyQty() {
    const items = activeOpname?.items || [];
    const idx = items.findIndex(i=>i.qtsFisik==null||i.qtsFisik==="");
    if (idx < 0) return;
    setPage(Math.floor(idx / pageSize));
    setTimeout(() => {
      const el = qtyInputRefs.current[idx];
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

  // Fase A — auto-freeze begitu hitung fisik pertama masuk (bukan lagi manual-only). Idempoten:
  // sekali freeze.aktif true, tidak ditulis ulang. gudangId sesi (SAP split per gudang) dipakai
  // langsung; kalau kosong (mis. Non-SAP), union gudangId dari lokasiBreakdown item ini.
  function ensureAutoFreeze(opn, item) {
    if (opn.freeze?.aktif) return opn.freeze;
    const gudangIds = opn.gudangId ? [opn.gudangId] : [...new Set((item.lokasiBreakdown||[]).map(b=>b.gudangId).filter(Boolean))];
    if (!gudangIds.length) return opn.freeze;
    return { aktif:true, gudangIds, at:Date.now(), by:currentUser?.id, unfrozenAt:null };
  }

  function updateItem(realIdx, field, value) {
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
        return {...prev, items, freeze: ensureAutoFreeze(prev, items[realIdx])};
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
      return {...prev, items};
    });
  }

  // Fase 2d: field mode (OpnameLapanganView) butuh nulis qty ke BLOK YANG SESUNGGUHNYA
  // (lokasiKey dari blok yang lagi aktif di HP) — beda dari updateItem desktop yang selalu pakai
  // itemLokasiKey (kolaps ke "_TANPA_LOKASI" utk item multi-blok, breakdown per-blok yang
  // sebenarnya memang menyusul di sini). extra dipakai utk flag tambahan (mis. usulPindahLokasi).
  function setQtyForBlok(realIdx, lokasiKey, qty, extra) {
    setActiveOpname(prev => {
      const items = [...prev.items];
      items[realIdx] = { ...applyQtyToItem(items[realIdx], lokasiKey, qty, currentUser?.id, { markRecount: true }), ...(extra||{}) };
      if (!touchedRef.current[prev.id]) touchedRef.current[prev.id] = new Set();
      touchedRef.current[prev.id].add(lokasiKey);
      return {...prev, items, freeze: ensureAutoFreeze(prev, items[realIdx])};
    });
  }

  // Fase 2e: konfirmasi hitung ulang (blind — tanpa lihat angka pertama) untuk item selisih.
  // Sama → dianggap benar, angka pertama tetap dipakai. Beda → angka kedua yang dipakai
  // (applyQtyToItem, kunci dari item.recount.key yang disimpan saat selisih pertama terjadi),
  // keterangan otomatis mencatat kedua angka.
  function confirmRecount(realIdx, qtyKedua) {
    setActiveOpname(prev => {
      const items = [...prev.items];
      const item = items[realIdx];
      const key = item.recount?.key || itemLokasiKey(item);
      const firstQty = item.qtsFisik;
      if (Number(qtyKedua) === Number(firstQty)) {
        items[realIdx] = { ...item, recount: { perluUlang:false, qtyUlang:Number(qtyKedua), at:Date.now(), by:currentUser?.id, cocok:true } };
      } else {
        const updated = applyQtyToItem(item, key, qtyKedua, currentUser?.id);
        const ket = `${item.keterangan ? item.keterangan+" — " : ""}Hitung ulang: awal ${firstQty}, ulang ${qtyKedua} (dipakai).`;
        items[realIdx] = { ...updated, keterangan: ket, recount: { perluUlang:false, qtyUlang:Number(qtyKedua), at:Date.now(), by:currentUser?.id, cocok:false } };
        if (!touchedRef.current[prev.id]) touchedRef.current[prev.id] = new Set();
        touchedRef.current[prev.id].add(key);
      }
      return {...prev, items};
    });
  }

  function validate() {
    const errors = [];
    if (activeOpname.stage !== "REKONSILIASI") {
      showToast("Buka Rekonsiliasi dulu sebelum submit.", "error");
      return false;
    }
    const isNonSapSession = activeOpname?.jenisAlur === "NON_SAP";
    (activeOpname.items||[]).forEach((item,i)=>{
      if(item.qtsFisik==null||item.qtsFisik==="") errors.push(`Baris ${i+1}: qty fisik belum diisi`);
      if(item.selisih!==0 && !item.keterangan?.trim()) errors.push(`Baris ${i+1} (${item.namaBarang}): keterangan wajib diisi jika ada selisih`);
      // Opname Non-SAP: lokasi WAJIB diisi untuk semua item (baseline maupun temuan baru) —
      // ini yang membuktikan opname fisik benar-benar dilakukan, bukan cuma isi qty dari kursi.
      if(isNonSapSession && !item.lokasiId) errors.push(`Baris ${i+1} (${item.namaBarang}): lokasi (Gudang/Blok) wajib diisi`);
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
      showToast(`❌ Belum bisa disubmit — ${errors.length} item belum lengkap (qty fisik/keterangan). Scroll ke atas untuk detail.`, "error");
      setPage(0);
      if (typeof window!=="undefined") window.scrollTo({top:0, behavior:"smooth"});
    }
    return errors.length===0;
  }

  // ── Progress calculation ─────────────────────────────────────────────
  function getProgress() {
    if(!activeOpname?.items?.length) return {filled:0, total:0, pct:0};
    const total = activeOpname.items.length;
    const filled = activeOpname.items.filter(itemCounted).length;
    return {filled, total, pct:Math.round(filled/total*100)};
  }

  const statusColor = {DRAFT:"#6b7280",PENDING_ASMAN:"#f59e0b",PENDING_MANAGER:"#3b82f6",SELESAI:"#16a34a",DITOLAK:"#dc2626"};
  const statusLabel = {DRAFT:"Draft",PENDING_ASMAN:"Menunggu Asman",PENDING_MANAGER:"Menunggu Manager",SELESAI:"✅ Selesai",DITOLAK:"❌ Ditolak"};

  // ── PANEL ANALISA (Fase 0: sama layar dengan daftar, bukan pindah tab) ────
  function renderPanel() {
    if (!activeOpname) return null;
    const isSAP = activeOpname.jenisAlur==="SAP";
    const isReadOnly = activeOpname.status!=="DRAFT";
    const items = activeOpname.items||[];
    // Fase 1f: filter Gudang/Blok — dikerjakan di atas indeks ASLI (bukan array baru) supaya
    // updateItem(realIdx,...) tetap menunjuk baris yang benar di activeOpname.items.
    const filteredIndexed = items.map((it,idx)=>({it,idx})).filter(({it})=>{
      if (!filterGudangId) return true;
      const bd = it.lokasiBreakdown||[];
      if (filterGudangId==="__NONE__") return !bd.length;
      if (filterLokasiId) return bd.some(b=>b.lokasiId===filterLokasiId);
      return bd.some(b=>b.gudangId===filterGudangId);
    });
    const totalPages = Math.ceil(filteredIndexed.length/pageSize);
    const pageEntries = filteredIndexed.slice(page*pageSize, (page+1)*pageSize);
    const prog = getProgress();
    const selisihCount = items.filter(i=>i.selisih!==0).length;

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
            {isSAP && !isReadOnly && (
              <label style={{fontSize:12,fontWeight:600,color:C.accent,cursor:csvLoading?"default":"pointer"}}>
                {csvLoading?"Memproses...":"Ganti File PID"}
                <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleReplaceCSV} disabled={csvLoading} style={{display:"none"}}/>
              </label>
            )}
            {isReadOnly && activeOpname.status==="SELESAI" && (
              <button style={sty.btn("ghost","sm")} onClick={()=>downloadBeritaAcara(activeOpname)}>📄 Download Berita Acara</button>
            )}
            {items.length>0 && (
              <button style={sty.btn("ghost","sm")} onClick={()=>downloadLembarHitungHTML(activeOpname, {lokasiList, gudangList,
                filterGudangId: filterGudangId==="__NONE__"?null:(filterGudangId||null), filterLokasiId: filterLokasiId||null})}>
                🖨️ Lembar Hitung
              </button>
            )}
            {isReadOnly && <button style={sty.btn("ghost","sm")} onClick={()=>setActiveOpname(null)}>← Kembali ke Daftar</button>}
            {!isReadOnly && <button style={sty.btn("ghost","sm")} onClick={handleBatal}>✕ Batal</button>}
          </div>
        </div>

        {/* Fase C: Dashboard progres per blok — klik chip untuk filter tabel ke blok itu. */}
        {!isReadOnly && (() => {
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
          return (
            <div style={{...sty.card,marginBottom:14,background:"#f8fafc",border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:8}}>📊 Progres Per Blok</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {bloks.map((b,bi)=>{
                  const { total, counted, selesai } = blokProgress(activeOpname, b.lokasiId, lokasiList, gudangList);
                  const bg = selesai ? "#dcfce7" : counted>0 ? "#fef3c7" : "#f1f5f9";
                  const fg = selesai ? "#166534" : counted>0 ? "#92400e" : "#6b7280";
                  const active = (filterGudangId===(b.gudangId||"__NONE__")) && filterLokasiId===(b.lokasiId||"");
                  return (
                    <button key={bi} onClick={()=>{ setFilterGudangId(b.gudangId||"__NONE__"); setFilterLokasiId(b.lokasiId||""); setPage(0); }}
                      style={{padding:"5px 10px",borderRadius: 10,border:`1px solid ${active?C.accent:bg}`,background:bg,color:fg,fontSize:12,fontWeight:700,cursor:"pointer",outline:active?`2px solid ${C.accent}`:"none"}}>
                      {selesai?"✓ ":""}{b.gudangKode||"?"} — {b.lokasiKode||"Tanpa Lokasi"} ({counted}/{total})
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Freeze Gudang — Fase A: BLOKIR KERAS transaksi TUG (bukan lagi peringatan). */}
        {hasRole(currentUser, "ADMIN","TL","ASMAN") && activeOpname.status!=="SELESAI" && activeOpname.status!=="DITOLAK" && (
          <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
            <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
              🧊 Freeze Gudang (Blokir Transaksi TUG saat Opname)
            </div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8}}>
              Gudang yang dicentang akan DIBLOKIR — transaksi TUG masuk/keluar dari/ke gudang itu ditolak selama sesi opname ini berjalan (otomatis aktif saat mulai hitung, lepas saat opname selesai/ditolak).
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
              {(gudangList||[]).map(g=>{
                const checked = freezeSel.has(g.id);
                return (
                  <label key={g.id} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:8,border:`1px solid ${checked?"#1d4ed8":C.border}`,background:checked?"#dbeafe":"white",fontSize:12,cursor:"pointer"}}>
                    <input type="checkbox" checked={checked} onChange={()=>setFreezeSel(s=>{const n=new Set(s); checked?n.delete(g.id):n.add(g.id); return n;})}/>
                    {g.kode||g.nama}
                  </label>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              {activeOpname.freeze?.aktif ? (
                <button style={sty.btn("danger","sm")} onClick={()=>toggleFreeze(false)}>❄️ Nonaktifkan Freeze</button>
              ) : (
                <button style={sty.btn("primary","sm")} disabled={!freezeSel.size} onClick={()=>toggleFreeze(true)}>🧊 Aktifkan Freeze</button>
              )}
              {activeOpname.freeze?.aktif && <span style={{fontSize:12,color:"#1d4ed8",fontWeight:700}}>🧊 Aktif sejak {fmtDate(activeOpname.freeze.at)}</span>}
            </div>
          </div>
        )}

        {/* Tambah Material Ditemukan + Upload Usulan Pencocokan — cuma Opname Non-SAP.
            Pola card biru + label sama persis dengan "Step 1: Upload File SAP" di bawah,
            supaya konsisten dengan menu Opname lain (keluhan user 2026-07-08). */}
        {!isSAP && !isReadOnly && (
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
        {isSAP && !isReadOnly && activeOpname.sapUploadedAt && (
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
                  {selisihCount>0?`⚠️ ${selisihCount} item selisih`:"✅ Belum ada selisih"}
                </div>
              </div>
              <div style={{background:"#f1f5f9",borderRadius: 10,height:8,marginBottom:10}}>
                <div style={{width:`${prog.pct}%`,height:8,borderRadius: 10,background:prog.pct===100?C.green:C.accent,transition:"width 0.3s"}}/>
              </div>
              {/* Ringkasan satu baris angka tenang — bukan 4 boks warna (gaya Apple-like, 0c) */}
              <div style={{fontSize:13,color:C.muted}}>
                <span style={{fontWeight:700,color:C.text}}>{items.length}</span> total
                {" • "}<span style={{fontWeight:700,color:C.green}}>{items.filter(i=>i.statusItem==="SESUAI").length}</span> sesuai
                {" • "}<span style={{fontWeight:700,color:C.red}}>{selisihCount}</span> selisih
                {" • "}<span style={{fontWeight:700,color:"#b45309"}}>{items.filter(i=>["TIDAK_ADA_DI_SAP","TIDAK_ADA_DI_SISTEM"].includes(i.statusItem)).length}</span> belum terdaftar
              </div>
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
                {!isReadOnly ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button style={sty.btn("ghost","sm")} onClick={handleScanQty}>📷 Scan QR untuk cari baris</button>
                    <span style={{fontSize:12,color:C.muted}}>Scan cuma membantu temukan & lompat ke barisnya — qty hasil hitung fisik tetap wajib diketik manual.</span>
                  </div>
                ) : <div/>}
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <select style={{...sty.select,fontSize:12,padding:"4px 8px",width:"auto"}} value={filterGudangId}
                    onChange={e=>{setFilterGudangId(e.target.value);setFilterLokasiId("");setPage(0);}}>
                    <option value="">Semua Gudang</option>
                    {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                    <option value="__NONE__">Tanpa Lokasi</option>
                  </select>
                  {filterGudangId && filterGudangId!=="__NONE__" && (
                    <select style={{...sty.select,fontSize:12,padding:"4px 8px",width:"auto"}} value={filterLokasiId}
                      onChange={e=>{setFilterLokasiId(e.target.value);setPage(0);}}>
                      <option value="">Semua Blok</option>
                      {(lokasiList||[]).filter(l=>l.gudangId===filterGudangId).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                    </select>
                  )}
                </div>
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
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center",width:36}}>No</th>}
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Nama Barang</th>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center"}}>No Katalog</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Sat</th>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Sistem</th>}
                    {isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty SAP</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Fisik</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Selisih</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Status</th>
                    {!isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>📍 Lokasi *</th>}
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Keterangan</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>📷 Foto</th>
                  </tr>
                </thead>
                <tbody>
                  {pageEntries.map(({it:item, idx:realIdx})=>{
                    const isHighlighted = highlightIdx===realIdx;
                    const rowBg = isHighlighted ? "#dbeafe" : item.statusItem==="MATERIAL_BARU_NONSAP" ? "#eff6ff" : item.statusItem==="SESUAI"?"white":item.statusItem==="TIDAK_ADA_DI_SISTEM"?"#fefce8":item.statusItem==="TIDAK_ADA_DI_SAP"?"#f8fafc":"#fff5f5";
                    const statusBadge = item.statusItem==="SESUAI"
                      ? {bg:"#dcfce7",fg:"#166534",label:"✅ Sesuai"}
                      : item.statusItem==="TIDAK_ADA_DI_SAP"
                      ? {bg:"#f3f4f6",fg:"#6b7280",label:"○ Tdk di SAP"}
                      : item.statusItem==="TIDAK_ADA_DI_SISTEM"
                      ? {bg:"#fef3c7",fg:"#92400e",label:"⚠️ Tdk di Sistem"}
                      : item.statusItem==="MATERIAL_BARU_NONSAP"
                      ? {bg:"#dbeafe",fg:"#1e40af",label:"🆕 Baru (Non-Stock)"}
                      : {bg:"#fee2e2",fg:"#991b1b",label:"🔴 Selisih"};
                    const itemGudangId = lokasiList?.find(l=>l.id===item.lokasiId)?.gudangId || "";
                    return (
                      <tr className="mobile-card-table__row" key={realIdx} style={{borderBottom:`1px solid ${C.border}`,background:rowBg,outline:isHighlighted?`2px solid #3b82f6`:"none"}}>
                        {!isMobile && <td data-label="No" className="is-key" style={{padding:"6px 8px",textAlign:"center",color:C.muted,fontSize:12}}>{realIdx+1}</td>}
                        <td data-label="Nama Barang" className="mobile-card-table__title" style={{padding:"6px 8px",fontWeight:600,maxWidth:isMobile?120:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>
                          {item.namaBarang}
                          {item.statusItem==="TIDAK_ADA_DI_SISTEM" && (
                            <div tabIndex={0} className="info-note" style={{fontSize:12,fontWeight:700,color:"#92400e",whiteSpace:"normal"}}>🆕 Material baru — akan dibuatkan Master Katalog + Data Stok saat sesi ini disetujui Manager (kalau qty fisik diisi &gt;0)</div>
                          )}
                          {item.statusItem==="MATERIAL_BARU_NONSAP" && (
                            <div tabIndex={0} className="info-note" style={{fontSize:12,fontWeight:700,color: "#1d4ed8",whiteSpace:"normal"}}>🆕 Ditemukan saat opname — sudah aktif sebagai "Pending Approval", dikonfirmasi penuh saat Manager approve sesi ini.{item.belumDicocokkanMara && " ⚠️ Belum dicocokkan ke MARA."}</div>
                          )}
                          {/* Fase 1f: chip blok — item bisa tersebar di beberapa lokasi dalam gudang ini */}
                          {item.lokasiBreakdown && item.lokasiBreakdown.length>0 && (
                            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                              {item.lokasiBreakdown.slice(0,3).map((b,bi)=>(
                                <span key={bi} style={{fontSize:12,padding:"1px 6px",borderRadius:999,background:"#f1f5f9",color:C.muted,fontWeight:600}}>{b.lokasiKode||"?"} ({b.qty})</span>
                              ))}
                              {item.lokasiBreakdown.length>3 && <span style={{fontSize:12,color:C.muted}}>+{item.lokasiBreakdown.length-3} lagi</span>}
                            </div>
                          )}
                        </td>
                        {!isMobile && <td data-label="No Katalog" className="is-key" style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{item.noKatalog}</td>}
                        <td data-label="Sat" className="is-key" style={{padding:"6px 8px",textAlign:"center"}}>{item.satuan}</td>
                        {!isMobile && <td data-label="Qty Sistem" className="is-key" style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{fmtNum(item.qtySistem)}</td>}
                        {isSAP && <td data-label="Qty SAP" className="is-key" style={{padding:"6px 8px",textAlign:"center",color:item.qtySAP!=null?C.text:"#9ca3af",whiteSpace:"nowrap"}}>{item.qtySAP!=null?fmtNum(item.qtySAP):"—"}</td>}
                        <td data-label="Qty Fisik" className="is-key" style={{padding:"4px 6px",textAlign:"center"}}>
                          {!isReadOnly
                            ? <input type="number" inputMode="decimal" min="0" placeholder="hitung…"
                                value={itemCounted(item) ? item.qtsFisik : ""}
                                ref={el=>{qtyInputRefs.current[realIdx]=el;}}
                                onChange={e=>updateItem(realIdx,"qtsFisik",Number(e.target.value))}
                                style={{width:64,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius: 10,fontSize:12,textAlign:"center"}}/>
                            : <span style={{fontWeight:700}}>{fmtNum(item.qtsFisik)}</span>}
                        </td>
                        <td data-label="Selisih" className="is-key" style={{padding:"6px 8px",textAlign:"center",fontWeight:700,whiteSpace:"nowrap",
                          color:item.selisih<0?"#dc2626":item.selisih>0?"#16a34a":"#6b7280"}}>
                          {item.qtsFisik==null?"—":item.selisih===0?"—":(item.selisih>0?"+":"")+fmtNum(item.selisih)}
                        </td>
                        <td data-label="Status" className="is-key" style={{padding:"6px 8px"}}>
                          <span title={itemCounted(item)?"Sudah dihitung":"Belum dihitung"} style={{marginRight:4,fontSize:12,fontWeight:700,color:itemCounted(item)?"#16a34a":"#9ca3af"}}>
                            {itemCounted(item)?"✓":"•"}
                          </span>
                          {item.qtsFisik==null ? (
                            <span style={{padding:"2px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:"#f3f4f6",color:"#6b7280"}}>—</span>
                          ) : (
                            <span style={{padding:"2px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:statusBadge.bg,color:statusBadge.fg}}>
                              {statusBadge.label}
                            </span>
                          )}
                        </td>
                        {!isSAP && (
                          <td data-label="📍 Lokasi" className="is-key" style={{padding:"4px 6px"}}>
                            {!isReadOnly ? (
                              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                <select value={itemGudangId} onChange={e=>{ updateItem(realIdx,"lokasiId",""); updateItem(realIdx,"_gudangTmp",e.target.value); }}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${C.border}`,borderRadius: 10,fontSize:12}}>
                                  <option value="">-- Gudang --</option>
                                  {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                                </select>
                                <select value={item.lokasiId||""} onChange={e=>updateItem(realIdx,"lokasiId",e.target.value)}
                                  disabled={!itemGudangId && !item._gudangTmp}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${!item.lokasiId?C.red:C.border}`,borderRadius: 10,fontSize:12}}>
                                  <option value="">-- Blok --</option>
                                  {(lokasiList||[]).filter(l=>l.gudangId===(itemGudangId||item._gudangTmp)).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                                </select>
                              </div>
                            ) : (
                              <span style={{fontSize:12}}>{lokasiList?.find(l=>l.id===item.lokasiId)?.kode || "-"}</span>
                            )}
                          </td>
                        )}
                        <td data-label="Keterangan" className="is-key" style={{padding:"4px 6px"}}>
                          {!isReadOnly
                            ? <input value={item.keterangan||""}
                                onChange={e=>updateItem(realIdx,"keterangan",e.target.value)}
                                placeholder={item.selisih!==0?"Wajib diisi...":"Opsional"}
                                style={{width:130,padding:"3px 6px",border:`1px solid ${item.selisih!==0&&!item.keterangan?C.red:C.border}`,borderRadius: 10,fontSize:12}}/>
                            : <span style={{fontSize:12,color:C.muted}}>{item.keterangan||"-"}</span>}
                        </td>
                        <td data-label="📷 Foto" className="is-key" style={{padding:"4px 6px"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            {[["fotoKeseluruhan","🖼️","Foto Keseluruhan"],["fotoNameplate","🏷️","Foto Nameplate"]].map(([field,icon,label])=>(
                              <label key={field} title={label}
                                style={{width:28,height:28,borderRadius: 10,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:isReadOnly?"default":"pointer",overflow:"hidden",background:item[field]?"transparent":"#f9fafb",flexShrink:0}}>
                                {item[field]
                                  ? <img src={item[field]} alt={label} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  : <span style={{fontSize:12,color: "#64748b"}}>{icon}</span>}
                                {!isReadOnly && (
                                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                                    onChange={e=>{
                                      const f=e.target.files[0]; if(!f) return;
                                      const r=new FileReader();
                                      r.onload=ev=>updateItem(realIdx,field,ev.target.result);
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
            {!isReadOnly && (
              <div className="approval-actions" style={{marginBottom:16}}>
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
                      await submitOpname(activeOpname);
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
          </div>
        )}

        {/* MODAL: Tambah Material Ditemukan (Opname Non-SAP) — 1 layar per barang,
            cari kode MARA dulu, lalu isi qty/lokasi/foto, simpan langsung dapat QR untuk ditempel. */}
        {lapanganMode && (
          <OpnameLapanganView
            activeOpname={activeOpname} setQtyForBlok={setQtyForBlok} confirmRecount={confirmRecount}
            lokasiList={lokasiList} gudangList={gudangList} currentUser={currentUser} sty={sty} C={C} showToast={showToast}
            onClose={()=>setLapanganMode(false)} onOpenTambahMaterial={()=>openTambahModal()}
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
                      {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Blok Lokasi *</label>
                    <select style={sty.select} value={tambahForm.lokasiId} onChange={e=>setTambahForm(f=>({...f,lokasiId:e.target.value}))} disabled={!tambahForm.gudangId}>
                      <option value="">-- Pilih Blok --</option>
                      {(lokasiList||[]).filter(l=>l.gudangId===tambahForm.gudangId).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
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
      <OperationsHero
        eyebrow="Stock Opname"
        title="Stock Opname"
        description="Dilakukan 1× per semester — bandingkan data sistem vs lapangan & SAP"
        scope={`${opnameList.length} sesi`}
        metrics={[
          {label:"Menunggu approval",value:pendingForMe.length,alert:pendingForMe.length>0},
          {label:"Draft berjalan",value:draftSessions.length},
          {label:"Selesai",value:opnameList.filter(o=>o.status==="SELESAI").length},
        ]}
      />

      {/* Zona upload PID — dropzone gantikan tombol "+ Opname SAP" (Fase 0, 0a). Sesi DRAFT
          baru cuma dibuat SETELAH file berhasil di-parse (startOpnameFromFile). */}
      {canCreate && (
        <div style={{marginBottom:20}}>
          {draftSessions.length>0 && draftSessions.slice(0,3).map(opn=>(
            <button key={opn.id} style={{...sty.btn("ghost","sm"),width:"100%",justifyContent:"flex-start",marginBottom:6}}
              onClick={()=>{setActiveOpname(opn);setPage(0);}}>
              📝 Lanjutkan draft {opn.semester} — {opn.jenisAlur} ({(opn.items||[]).length} item)
            </button>
          ))}
          <div
            onDragOver={e=>{e.preventDefault(); setDragActive(true);}}
            onDragLeave={()=>setDragActive(false)}
            onDrop={e=>{e.preventDefault(); setDragActive(false); handleDropzoneFiles(e.dataTransfer.files);}}
            onClick={()=>!csvLoading && dropInputRef.current?.click()}
            style={{border:`1px dashed ${dragActive?C.accent:C.border}`,borderRadius:14,padding:"28px 20px",textAlign:"center",cursor:csvLoading?"default":"pointer",background:dragActive?"#eff6ff":"transparent",transition:"border-color .15s,background .15s"}}>
            <div style={{fontSize:17,fontWeight:600,marginBottom:4}}>{csvLoading?"Memproses file...":"Tarik & lepas file PID di sini"}</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Format CSV/XLSX export SAP MM (PEMAT_DDMMYYYY)</div>
            <button type="button" style={sty.btn("primary")} disabled={csvLoading} onClick={e=>{ e.stopPropagation(); dropInputRef.current?.click(); }}>
              {csvLoading?"Memproses...":"📂 Pilih File"}
            </button>
            <input ref={dropInputRef} type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" style={{display:"none"}} disabled={csvLoading}
              onChange={e=>{ handleDropzoneFiles(e.target.files); e.target.value=""; }}/>
          </div>
          <button style={{...sty.btn("ghost","sm"),marginTop:10}} onClick={()=>startOpname("NON_SAP")}>Opname Non-SAP →</button>
        </div>
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
          <div style={{marginBottom:8}}>
            <input style={sty.input} placeholder="Catatan approval (opsional)..." value={catatanApproval} onChange={e=>setCatatanApproval(e.target.value)}/>
          </div>
          {rejectingId===opn.id
            ? <div style={{display:"flex",gap:8}}>
                <input style={{...sty.input,flex:1}} placeholder="Alasan penolakan (wajib)..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                <div className="approval-actions">
                  <button className="approval-btn--danger" onClick={()=>{rejectOpname(opn,rejectReason);setRejectingId(null);setRejectReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                  <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                </div>
              </div>
            : <div style={{display:"flex",gap:8}}>
                <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);}}>🔍 Review Detail</button>
                <div className="approval-actions">
                  <button className="approval-btn--approve" onClick={()=>{approveOpname_Asman(opn,catatanApproval);setCatatanApproval("");}}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui (final)</button>
                  <button className="approval-btn--reject" onClick={()=>setRejectingId(opn.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                </div>
              </div>}
        </div>
      ))}

      {/* Sekat: pisahkan proses opname (atas) dari riwayat (bawah) — hairline + judul seksi (Apple-like). */}
      <div style={{borderTop:`1px solid ${C.border}`,marginTop:24,paddingTop:16,marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:".4px"}}>Riwayat Opname</div>
      </div>

      {/* Filter status — chip compact (Apple-like) */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {["semua","DRAFT","PENDING_ASMAN","SELESAI","DITOLAK"].map(s=>(
          <button key={s} style={{padding:"4px 10px",borderRadius:999,border:`1px solid ${filterStatus===s?C.accent:C.border}`,background:filterStatus===s?C.accent:"transparent",color:filterStatus===s?"white":C.muted,fontSize:12,fontWeight:filterStatus===s?600:400,cursor:"pointer"}}
            onClick={()=>setFilterStatus(s)}>
            {s==="semua"?"Semua":statusLabel[s]||s}
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
            const selisihCount = (opn.items||[]).filter(i=>i.selisih!==0).length;
            return (
              <div key={opn.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-start",gap:6,marginBottom:6}}>
                  <div style={{minWidth:0,flex:"1 1 180px"}}>
                    <div style={{fontWeight:800,fontSize:13}}>Opname {opn.semester} — {opn.jenisAlur} <span style={{fontSize:12,fontWeight:400,color:C.muted}}>({opn.kategori}{opn.gudangId!==undefined?(opn.gudangKode?` • Gudang ${opn.gudangKode}`:" • Belum Beralamat"):""})</span></div>
                    <div style={{fontSize:12,color:C.muted}}>{fmtDate(opn.dibuatAt)} • {creator.name||"-"} • {opn.items?.length||0} item • {selisihCount} selisih</div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                    {opn.freeze?.aktif && (
                      <span style={{padding:"3px 10px",borderRadius:14,fontSize:12,fontWeight:700,whiteSpace:"nowrap",background:"#dbeafe",color:"#1d4ed8"}}>🧊 FREEZE</span>
                    )}
                    <span style={{padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,whiteSpace:"nowrap",background:(statusColor[opn.status]||"#6b7280")+"22",color:statusColor[opn.status]||"#6b7280"}}>
                      {statusLabel[opn.status]||opn.status}
                    </span>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);}}>
                    🔍 {opn.status==="DRAFT"?"Edit":"Lihat Detail"}
                  </button>
                  {opn.status==="SELESAI" && <button style={sty.btn("ghost","sm")} onClick={()=>downloadBeritaAcara(opn)}>📄 Berita Acara</button>}
                  {opn.status==="DRAFT" && hasRole(currentUser, "ADMIN","TL") && <button title="Hapus sesi opname" style={sty.btn("danger","sm")} onClick={()=>deleteOpname(opn.id)}>🗑️</button>}
                </div>
              </div>
            );
          })}

        {opnameList.length===0 && (
          <div style={{...sty.card,textAlign:"center",padding:50,color:C.muted}}>
            <div style={{fontSize:32,marginBottom:12}}>📋</div>
            <div style={{fontSize:13,fontWeight:700}}>Belum ada sesi Stock Opname</div>
            <div style={{fontSize:12,marginTop:4}}>Tarik file PID ke zona upload di atas untuk memulai</div>
          </div>
        )}
      </div>
    </div>
  );

  function downloadBeritaAcara(opn) {
    const w = window.open("", "_blank");
    const html = buildBeritaAcaraHTML(opn, katalogList, users, uptList);
    if (w) { w.document.write(html); w.document.close(); }
  }
}
