import { useState, useEffect } from "react";
import { uid } from "../lib/utils.js";
import { logAudit } from "../lib/audit.js";
import { CLOUD } from "../lib/cloud.js";
import { syncMasterTable } from "../lib/masterSync.js";

// Diperketat: hilangkan tanda baca umum, rapatkan spasi — TIDAK mengubah data asli,
// cuma dipakai saat membandingkan. Lihat komentar asli di App.jsx (sebelum ekstraksi
// tranche Konfigurasi Gudang) untuk latar belakang lengkap kenapa perlu dinormalisasi.
function normalizeGudangName(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Saran Gudang existing yang "mirip" (token overlap nama) di UPT yang sama — dipakai di
// panel konfirmasi Admin saat import Kapasitas Gudang mendeteksi kandidat Gudang baru.
function suggestSimilarGudang(name, uptId, gudangList) {
  const targetWords = normalizeGudangName(name).split(" ").filter(Boolean);
  if (!targetWords.length) return [];
  return gudangList
    .filter(g => g.uptId === uptId)
    .map(g => {
      const words = normalizeGudangName(g.nama).split(" ").filter(Boolean);
      const overlap = targetWords.filter(w => words.includes(w)).length;
      return { g, overlap };
    })
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 5)
    .map(x => x.g);
}

// Domain Konfigurasi Gudang: Gudang CRUD (+ wizard 3 langkah), Lokasi/Blok CRUD, Sub Gudang,
// denah-tools (upload+OCR koordinat) level Gudang & Sub Gudang, dan Kapasitas Gudang
// (approve/reject import, dedupe, backfill koordinat).
// gudangList/subGudangList/lokasiList/gudangCapacityList/gudangCapacityImports TETAP dimiliki
// App.jsx (dipakai luas di banyak domain lain & sebagian sudah dipakai sebelum stateRef/hook
// ini sempat terpanggil — lihat setGudangCapacityList di loadCloud) — di sini cuma diterima
// sbg param (read + setter), sama pola dgn useDenahOcr. runOcrOnDenah/runOcrOnDenahSub/
// ocrSuggestions/setOcrSuggestions/setDenahLoading/setDenahSubLoading juga dari useDenahOcr —
// TAPI hook ini dipanggil SEBELUM useDenahOcr di App.jsx (useDenahOcr perlu syncGudang/
// syncSubGudang/syncLokasi dari sini), jadi arahnya kebalik dari pola stateRef biasa: diakses
// lewat stateRef.current.* (diisi App.jsx setelah useDenahOcr dipanggil), bukan param langsung.
export function useWarehouseConfig({
  currentUser, uptList, showToast, stateRef, askConfirmDelete, logApprovalHistory,
  gudangList, setGudangList, subGudangList, setSubGudangList, lokasiList, setLokasiList, stocks,
  gudangCapacityList, setGudangCapacityList, gudangCapacityImports, setGudangCapacityImports,
}) {
  // ── MASTER LOKASI GUDANG CRUD ──
  const [lokasiModal, setLokasiModal] = useState(null);
  const [lokasiForm, setLokasiForm] = useState({});
  const [lokasiDeleteConfirm, setLokasiDeleteConfirm] = useState(null); // blok gudang (lokasi) yang sedang dikonfirmasi hapus
  const [showGudangMaintenance, setShowGudangMaintenance] = useState(false); // toggle 2 alat perbaikan (bukan pemakaian rutin) di Master Gudang
  const [mapConfigSubGudangId, setMapConfigSubGudangId] = useState(null);
  const [pendingMapLokasiSub, setPendingMapLokasiSub] = useState(null);
  const [manualAddModeSub, setManualAddModeSub] = useState(false);
  const [showGudangDenahTools, setShowGudangDenahTools] = useState(false);
  const [expandedSubGudangToolsIds, setExpandedSubGudangToolsIds] = useState(() => new Set());
  const [selectedSubGudangId, setSelectedSubGudangId] = useState(null);

  // Tambah/edit/hapus blok lokasi langsung berlaku, tanpa approval siapapun —
  // menu ini cuma bisa diakses ADMIN (lihat gating hasRole di render Master
  // Gudang), jadi tidak perlu alur PENDING/approval TL lagi (permintaan user 2026-07-09).
  // Tambah Blok manual (modal tanpa denah) sudah dihapus — blok baru sekarang HANYA
  // ditambahkan lewat "Kelola Denah & Koordinat" (klik titik di denah), jadi tiap blok
  // dijamin punya koordinat. Modal Lokasi tinggal dipakai untuk EDIT saja.
  function openEditLokasi(l) { setLokasiForm({...l}); setLokasiModal("edit"); }

  // Cek kode blok sudah dipakai DI SUB GUDANG yang sama (termasuk usulan pending EDIT lain).
  // Kode boleh sama antar Sub Gudang berbeda (mis. Blok A di Sub Gudang Terbuka & Tertutup itu
  // wajar) — jadi scope duplikat = gudang yang sama DAN sub gudang yang sama (null=grup "Umum").
  // Blok tanpa gudangId (belum di-assign) tidak dicek silang, karena belum "di dalam" gudang manapun.
  function isKodeDuplicateInSubGudang(kode, gudangId, subGudangId, excludeId) {
    if (!gudangId || !kode?.trim()) return false;
    const norm = kode.trim().toLowerCase();
    const sub = subGudangId || null;
    return lokasiList.some(l => {
      if (l.id === excludeId) return false;
      if (l.gudangId !== gudangId) return false;
      if ((l.subGudangId || null) !== sub) return false;
      if (l.pendingAction === "DELETE") return false;
      const kodeAktif = (l.pendingAction === "EDIT" && l.pendingData?.kode) ? l.pendingData.kode : l.kode;
      return (kodeAktif||"").trim().toLowerCase() === norm;
    });
  }

  function syncLokasi(nl) { return syncMasterTable("lokasi", nl, l => ({ gudang_id: l.gudangId || null, status: l.status || null })); }

  async function saveLokasi() {
    if (!lokasiForm.gudangId) { showToast("Pilih Gudang dulu sebelum mengisi Blok! Data harus berjenjang: Gudang → Blok.","error"); return; }
    if (!lokasiForm.kode?.trim()) { showToast("Kode Lokasi tidak boleh kosong!","error"); return; }
    if (isKodeDuplicateInSubGudang(lokasiForm.kode, lokasiForm.gudangId, lokasiForm.subGudangId, lokasiModal==="edit"?lokasiForm.id:null)) {
      showToast(`Kode blok "${lokasiForm.kode}" sudah dipakai di sub gudang ini!`,"error"); return;
    }
    let nl;
    if (lokasiModal==="edit") {
      nl = lokasiList.map(l => l.id===lokasiForm.id ? { ...l, ...lokasiForm, status:"APPROVED", pendingAction:null, pendingData:null } : l);
    } else {
      const baru = { ...lokasiForm, createdAt:Date.now(), status:"APPROVED", pendingAction:null, requestedBy:currentUser.id, requestedAt:Date.now() };
      nl = [...lokasiList, baru];
    }
    const prevList = lokasiList;
    setLokasiList(nl); setLokasiModal(null);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan ke server, perubahan Lokasi DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    logAudit(currentUser, lokasiModal==="edit"?"UPDATE":"CREATE", "lokasi", lokasiForm.kode, {kode:lokasiForm.kode});
    showToast(lokasiModal==="edit" ? "Master Lokasi diupdate!" : "Lokasi gudang baru ditambahkan!");
  }
  // Buka popup konfirmasi hapus blok gudang (bukan langsung hapus) —
  // tombol pemanggil hanya dirender untuk role ADMIN.
  function requestDeleteLokasi(l) {
    if (stocks.some(s=>s.lokasiId===l.id)) { showToast("Tidak bisa hapus: lokasi ini masih dipakai di Data Stok!","error"); return; }
    setLokasiDeleteConfirm(l);
  }
  async function confirmDeleteLokasi() {
    const l = lokasiDeleteConfirm;
    if (!l) return;
    const prevList = lokasiList;
    const nl = lokasiList.filter(x=>x.id!==l.id);
    setLokasiList(nl); setLokasiDeleteConfirm(null);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menghapus di server, Lokasi DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    logAudit(currentUser, "DELETE", "lokasi", l.kode, {kode:l.kode});
    showToast("Lokasi dihapus.");
  }

  // ── Master Gudang CRUD ──
  const [gudangModal, setGudangModal] = useState(null);
  const [gudangForm, setGudangForm] = useState({});
  const [mapConfigGudangId, setMapConfigGudangId] = useState(null);
  const [pendingMapLokasi, setPendingMapLokasi] = useState(null);
  const [expandedGudangId, setExpandedGudangId] = useState(null); // accordion: hanya 1 gudang terbuka sekaligus di Master Gudang
  useEffect(() => { setShowGudangDenahTools(false); setSelectedSubGudangId(null); }, [expandedGudangId]);
  const [gudangWizardStep, setGudangWizardStep] = useState(1); // 1=Data Gudang, 2=Upload Denah, 3=Tambah Blok (hanya untuk mode "add")
  const [wizardBlokDraft, setWizardBlokDraft] = useState(null); // {kode,keterangan,kapasitas,xPct,yPct} saat klik titik di denah pada wizard step 3
  const [manualAddMode, setManualAddMode] = useState(false); // mode "Tambah Blok Baru" di Konfigurasi Koordinat Blok: klik di peta menambah draft usulan (belum dikirim ke TL)
  const [capacityReviewImportId, setCapacityReviewImportId] = useState(null); // import kapasitas gudang yang sedang direview Admin sebelum approve (ada kandidat Gudang baru)
  const [capacityReviewCandidates, setCapacityReviewCandidates] = useState([]); // hasil previewCapacityGudangMatch untuk import di atas
  const [capacityReviewDecisions, setCapacityReviewDecisions] = useState({}); // key "UPT|GUDANG" -> {action:"NEW"} | {action:"MAP",mappedGudangId}

  function openAddGudang() { setGudangForm({id:"GDG-"+uid().slice(-6), nama:"", kode:"", alamat:"", uptId:uptList[0]?.id||"", denahImageData:null, denahUploadedAt:null, fotoGudang:null, createdAt:Date.now()}); setGudangModal("add"); setGudangWizardStep(1); setWizardBlokDraft(null); }
  function openEditGudang(g) { setGudangForm({...g}); setGudangModal("edit"); }
  function closeGudangWizard() { setGudangModal(null); setGudangWizardStep(1); setWizardBlokDraft(null); }
  function syncGudang(ng) { return syncMasterTable("gudang", ng, g => ({ upt_id: g.uptId || null })); }
  function syncSubGudang(nsg) { return syncMasterTable("sub_gudang", nsg, sg => ({ gudang_id: sg.gudangId || null })); }

  // Cari Master UPT yang cocok dengan label string UPT dari laporan kapasitas (fuzzy, uppercase)
  function findMatchingUpt(uptLabel) {
    const needle = String(uptLabel||"").trim().toUpperCase();
    if (!needle) return null;
    return uptList.find(u =>
      String(u.nama||"").toUpperCase().includes(needle) ||
      needle.includes(String(u.nama||"").toUpperCase().replace(/^UPT\s+/,"")) ||
      String(u.kode||"").toUpperCase()===needle
    ) || null;
  }

  // Auto-create/merge Master Gudang + Sub Gudang dari record kapasitas yang disetujui.
  // Data yang sudah ada (manual atau dari import sebelumnya) TIDAK di-overwrite,
  // hanya alamat kosong yang dilengkapi. UPT yang tidak match di-skip + dilaporkan.
  // Pencocokan nama Gudang pakai normalizeGudangName (diperketat 2026-07-06 — lihat
  // komentar di fungsi itu). `decisions` (opsional): map key "UPT|GUDANG" -> hasil
  // konfirmasi manual Admin dari panel review (lihat startCapacityApproval) —
  // { action:"MAP", mappedGudangId } artinya JANGAN buat Gudang baru, pakai yang
  // sudah ada itu; { action:"NEW" } atau tidak ada entry sama sekali = perilaku lama
  // (cocokkan otomatis via normalizeGudangName, baru buat baru kalau benar2 tidak ada).
  function syncGudangCapacityToMasterGudang(records, decisions = {}) {
    let gList = [...gudangList];
    let sgList = [...subGudangList];
    const created = [];
    const createdSub = [];
    const skippedNoUpt = [];
    const uniqueRows = new Map(); // key: "UPT|GUDANG|SUBGUDANG" -> record
    records.forEach(r => {
      const key = `${r.upt}|${r.gudang}|${r.subGudang}`;
      if (!uniqueRows.has(key)) uniqueRows.set(key, r);
    });
    uniqueRows.forEach(r => {
      const uptMatch = findMatchingUpt(r.upt);
      if (!uptMatch) { skippedNoUpt.push(`${r.upt} / ${r.gudang}`); return; }

      const gudangKey = `${r.upt}|${r.gudang}`;
      const decision = decisions[gudangKey];
      let gudangEntry = decision?.action === "MAP"
        ? gList.find(g => g.id === decision.mappedGudangId)
        : gList.find(g => g.uptId===uptMatch.id && normalizeGudangName(g.nama)===normalizeGudangName(r.gudang));
      if (gudangEntry) {
        const patch = {};
        if (!gudangEntry.alamat && r.alamat) patch.alamat = r.alamat;
        if (gudangEntry.lat == null && r.latitude != null) patch.lat = r.latitude;
        if (gudangEntry.lng == null && r.longitude != null) patch.lng = r.longitude;
        if (Object.keys(patch).length) {
          gList = gList.map(g => g.id===gudangEntry.id ? {...g, ...patch} : g);
          gudangEntry = {...gudangEntry, ...patch};
        }
      } else {
        gudangEntry = {
          id: `GDG-CAP-${r.upt}-${r.gudang}`.replace(/\s+/g,"-").toUpperCase(),
          nama: r.gudang, kode: "", alamat: r.alamat||"", uptId: uptMatch.id,
          lat: r.latitude ?? null, lng: r.longitude ?? null,
          denahImageData: null, denahUploadedAt: null, createdAt: Date.now(),
          sourceCapacityImport: true,
        };
        gList.push(gudangEntry);
        created.push(r.gudang);
      }

      if (!r.subGudang) return;
      const existingSub = sgList.find(sg => sg.gudangId===gudangEntry.id && normalizeGudangName(sg.nama)===normalizeGudangName(r.subGudang));
      if (!existingSub) {
        sgList.push({
          id: `SGD-CAP-${r.upt}-${r.gudang}-${r.subGudang}`.replace(/\s+/g,"-").toUpperCase(),
          nama: r.subGudang, gudangId: gudangEntry.id, createdAt: Date.now(),
          sourceCapacityImport: true,
        });
        createdSub.push(r.subGudang);
      }
    });
    return { gList, sgList, created, createdSub, skippedNoUpt };
  }

  // Preview (read-only, tidak mengubah apa pun) — dipakai SEBELUM approve untuk deteksi
  // baris mana yang bakal jadi Gudang BARU kalau langsung di-approve, supaya Admin bisa
  // konfirmasi dulu satu-satu ("ini memang Gudang baru" vs "ini sebenarnya Gudang X yang
  // sudah ada, cuma beda tulisan") — permintaan user 2026-07-06 supaya duplikat Gudang
  // dari import tidak terus berulang.
  function previewCapacityGudangMatch(records) {
    const seen = new Set();
    const newCandidates = [];
    records.forEach(r => {
      const gudangKey = `${r.upt}|${r.gudang}`;
      if (seen.has(gudangKey)) return;
      seen.add(gudangKey);
      const uptMatch = findMatchingUpt(r.upt);
      if (!uptMatch) return; // sudah dilaporkan terpisah sebagai skippedNoUpt saat approve
      const existing = gudangList.find(g => g.uptId===uptMatch.id && normalizeGudangName(g.nama)===normalizeGudangName(r.gudang));
      if (existing) return;
      newCandidates.push({
        key: gudangKey, upt: r.upt, gudang: r.gudang, uptId: uptMatch.id,
        suggestions: suggestSimilarGudang(r.gudang, uptMatch.id, gudangList),
      });
    });
    return newCandidates;
  }

  // Sinkron ulang koordinat lat/lng + alamat Master Gudang dari data Kapasitas Gudang yang
  // sudah live (gudangCapacityList) — dipakai saat data lama sudah live tapi lat/lng belum
  // sempat ikut ke Master Gudang (mis. dibuat sebelum field koordinat ditambahkan).
  async function backfillGudangCoordFromCapacity() {
    if (!gudangCapacityList.length) { showToast("Belum ada data Kapasitas Gudang live.", "error"); return; }
    const prevGudangList = gudangList;
    const prevSubGudangList = subGudangList;
    const { gList: newGudangList, sgList: newSubGudangList } = syncGudangCapacityToMasterGudang(gudangCapacityList);
    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    const okG = await syncGudang(newGudangList);
    const okSG = okG && await syncSubGudang(newSubGudangList);
    if (!okG || !okSG) {
      setGudangList(prevGudangList); setSubGudangList(prevSubGudangList);
      showToast("Gagal menyimpan ke server, sinkronisasi koordinat Gudang DIBATALKAN. Coba lagi.","error");
      return;
    }
    CLOUD.set("pln_gudang_v1", newGudangList);
    CLOUD.set("pln_sub_gudang_v1", newSubGudangList);
    showToast("✅ Koordinat & data Master Gudang disinkron ulang dari Kapasitas Gudang.", "success");
  }

  // Gabungkan Gudang/Sub Gudang duplikat (nama sama, ID beda — biasanya karena satu dibuat manual
  // dan satu lagi otomatis dari import Kapasitas Gudang). Ini penyebab umum denah/koordinat "hilang":
  // datanya nyasar ke ID duplikat yang sedang tidak ditampilkan. Blok Lokasi & Sub Gudang direassign
  // ke ID "primary" yang dipilih (prioritas: sudah punya denah > sudah punya koordinat > paling lama).
  async function dedupeGudangDanSubGudang(silent = false) {
    const norm = s => String(s||"").trim().toUpperCase().replace(/\s+/g," ");
    let newGudangList = [...gudangList];
    let newSubGudangList = [...subGudangList];
    let newLokasiList = [...lokasiList];
    let mergedGudang = 0, mergedSub = 0;

    const gGroups = new Map();
    gudangList.forEach(g => {
      const key = `${g.uptId||""}|${norm(g.nama)}`;
      if (!gGroups.has(key)) gGroups.set(key, []);
      gGroups.get(key).push(g);
    });
    gGroups.forEach(list => {
      if (list.length <= 1) return;
      mergedGudang += list.length - 1;
      const primary = [...list].sort((a,b) => {
        const scoreA = (a.denahImageData?2:0)+(a.lat!=null?1:0);
        const scoreB = (b.denahImageData?2:0)+(b.lat!=null?1:0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (a.createdAt||0) - (b.createdAt||0);
      })[0];
      const losers = list.filter(g=>g.id!==primary.id);
      const loserIds = new Set(losers.map(g=>g.id));
      let merged = {...primary};
      losers.forEach(l => {
        if (!merged.denahImageData && l.denahImageData) { merged.denahImageData=l.denahImageData; merged.denahUploadedAt=l.denahUploadedAt; merged.denahOcrWords=l.denahOcrWords; }
        if (merged.lat == null && l.lat != null) { merged.lat=l.lat; merged.lng=l.lng; }
        if (!merged.alamat && l.alamat) merged.alamat = l.alamat;
        if (!merged.kode && l.kode) merged.kode = l.kode;
      });
      newGudangList = newGudangList.filter(g=>!loserIds.has(g.id)).map(g=>g.id===primary.id?merged:g);
      newLokasiList = newLokasiList.map(l => loserIds.has(l.gudangId) ? {...l, gudangId: primary.id} : l);
      newSubGudangList = newSubGudangList.map(sg => loserIds.has(sg.gudangId) ? {...sg, gudangId: primary.id} : sg);
    });

    const sgGroups = new Map();
    newSubGudangList.forEach(sg => {
      const key = `${sg.gudangId}|${norm(sg.nama)}`;
      if (!sgGroups.has(key)) sgGroups.set(key, []);
      sgGroups.get(key).push(sg);
    });
    sgGroups.forEach(list => {
      if (list.length <= 1) return;
      mergedSub += list.length - 1;
      const primary = [...list].sort((a,b) => {
        const scoreA = a.denahImageData?1:0, scoreB = b.denahImageData?1:0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (a.createdAt||0) - (b.createdAt||0);
      })[0];
      const losers = list.filter(sg=>sg.id!==primary.id);
      const loserIds = new Set(losers.map(sg=>sg.id));
      let merged = {...primary};
      losers.forEach(l => { if (!merged.denahImageData && l.denahImageData) { merged.denahImageData=l.denahImageData; merged.denahUploadedAt=l.denahUploadedAt; merged.denahOcrWords=l.denahOcrWords; } });
      newSubGudangList = newSubGudangList.filter(sg=>!loserIds.has(sg.id)).map(sg=>sg.id===primary.id?merged:sg);
      newLokasiList = newLokasiList.map(l => loserIds.has(l.subGudangId) ? {...l, subGudangId: primary.id} : l);
    });

    if (mergedGudang===0 && mergedSub===0) { if (!silent) showToast("Tidak ada Gudang/Sub Gudang duplikat ditemukan.", "success"); return; }

    const prevGudangList = gudangList;
    const prevSubGudangList = subGudangList;
    const prevLokasiList = lokasiList;
    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    setLokasiList(newLokasiList);
    const okG = await syncGudang(newGudangList);
    const okSG = okG && await syncSubGudang(newSubGudangList);
    const okL = okSG && await syncLokasi(newLokasiList);
    if (!okG || !okSG || !okL) {
      setGudangList(prevGudangList); setSubGudangList(prevSubGudangList); setLokasiList(prevLokasiList);
      showToast("Gagal menyimpan ke server, penggabungan Gudang/Sub Gudang duplikat DIBATALKAN. Coba lagi.","error");
      return;
    }
    CLOUD.set("pln_gudang_v1", newGudangList);
    CLOUD.set("pln_sub_gudang_v1", newSubGudangList);
    CLOUD.set("pln_lokasi_v4", newLokasiList);
    showToast(`✅ ${mergedGudang} Gudang duplikat & ${mergedSub} Sub Gudang duplikat digabungkan.`, "success");
  }

  async function approveCapacityImport(importId, decisions = {}) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    // id stabil per baris (UPT+Gudang+SubGudang) supaya upsert Supabase konsisten
    // antar batch — kalau baris yang sama diimport ulang di batch berikutnya,
    // dia menimpa dirinya sendiri (bukan duplikat), bukan menimpa baris lain.
    const batchRecords = imp.records.map(r => ({
      ...r,
      id: r.id || `CAP-${r.upt}-${r.gudang}-${r.subGudang}`.replace(/\s+/g,"-").toUpperCase(),
      importBatchId: imp.id,
    }));
    const newList = [...gudangCapacityList.filter(r => r.importBatchId !== imp.id), ...batchRecords];
    const newImports = gudangCapacityImports.map(i => i.id===importId
      ? {...i, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now()} : i);
    const { gList: newGudangList, sgList: newSubGudangList, created, createdSub, skippedNoUpt } = syncGudangCapacityToMasterGudang(newList, decisions);
    const prevGudangList = gudangList;
    const prevSubGudangList = subGudangList;
    setGudangCapacityList(newList);
    setGudangCapacityImports(newImports);
    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    await stateRef.current.saveToCloud({ gudangCapacityList: newList, gudangCapacityImports: newImports });
    const okG = await syncGudang(newGudangList);
    const okSG = okG && await syncSubGudang(newSubGudangList);
    if (!okG || !okSG) {
      setGudangList(prevGudangList); setSubGudangList(prevSubGudangList);
      showToast("Gagal menyimpan Master Gudang/Sub Gudang ke server, coba approve ulang.","error");
      return;
    }
    CLOUD.set("pln_gudang_v1", newGudangList);
    CLOUD.set("pln_sub_gudang_v1", newSubGudangList);
    await logApprovalHistory({ type:"KAPASITAS_GUDANG_IMPORT", refId:imp.id, decision:"APPROVED", note:`${imp.sourceFile} — ${newList.length} record, ${created.length} Gudang + ${createdSub.length} Sub Gudang baru` });
    let msg = `Import disetujui — ${newList.length} record kapasitas gudang kini live.`;
    if (created.length || createdSub.length) msg += ` ${created.length} Gudang, ${createdSub.length} Sub Gudang baru dibuat otomatis.`;
    showToast(msg, "success");
    if (skippedNoUpt.length) {
      showToast(`⚠️ ${skippedNoUpt.length} gudang di-skip dari Master Gudang (UPT tidak dikenal): ${skippedNoUpt.slice(0,3).join(", ")}${skippedNoUpt.length>3?"...":""}`, "error");
    }
  }

  // Dipanggil dari tombol "Setujui & Publish" di Approval (menggantikan panggilan
  // langsung approveCapacityImport) — cek dulu apakah ada kandidat Gudang BARU yang
  // bakal otomatis dibuat; kalau ada, buka panel konfirmasi Admin dulu (permintaan
  // user 2026-07-06) sebelum benar-benar approve. Kalau tidak ada kandidat baru sama
  // sekali (semua baris cocok Gudang existing), langsung approve seperti biasa tanpa
  // friksi tambahan.
  function startCapacityApproval(importId) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    const candidates = previewCapacityGudangMatch(imp.records);
    if (candidates.length === 0) { approveCapacityImport(importId); return; }
    setCapacityReviewImportId(importId);
    setCapacityReviewCandidates(candidates);
    setCapacityReviewDecisions(Object.fromEntries(candidates.map(c => [c.key, { action: "NEW" }])));
  }
  function confirmCapacityApproval() {
    if (!capacityReviewImportId) return;
    approveCapacityImport(capacityReviewImportId, capacityReviewDecisions);
    setCapacityReviewImportId(null);
    setCapacityReviewCandidates([]);
    setCapacityReviewDecisions({});
  }

  async function rejectCapacityImport(importId, reason) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    const newImports = gudangCapacityImports.map(i => i.id===importId
      ? {...i, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : i);
    setGudangCapacityImports(newImports);
    await stateRef.current.saveToCloud({ gudangCapacityImports: newImports });
    await logApprovalHistory({ type:"KAPASITAS_GUDANG_IMPORT", refId:imp.id, decision:"REJECTED", note:reason });
    showToast("Import ditolak.", "success");
  }
  async function saveGudang() {
    if (!gudangForm.nama?.trim()) { showToast("Nama Gudang wajib diisi!","error"); return; }
    const prevList = gudangList;
    const ng = gudangModal==="add" ? [...gudangList, gudangForm] : gudangList.map(g=>g.id===gudangForm.id?gudangForm:g);
    setGudangList(ng); setGudangModal(null);
    const ok = await syncGudang(ng);
    if (!ok) { setGudangList(prevList); showToast("Gagal menyimpan ke server, perubahan Gudang DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_gudang_v1", ng);
    logAudit(currentUser, gudangModal==="add"?"CREATE":"UPDATE", "gudang", gudangForm.id, {nama:gudangForm.nama});
    showToast(gudangModal==="add"?"Gudang ditambahkan!":"Gudang diupdate!");
  }
  // Step 1 wizard: simpan data gudang lalu lanjut ke Step 2 (upload denah) tanpa menutup modal
  async function gudangWizardNext() {
    if (!gudangForm.nama?.trim()) { showToast("Nama Gudang wajib diisi!","error"); return; }
    const prevList = gudangList;
    const exists = gudangList.some(g=>g.id===gudangForm.id);
    const ng = exists ? gudangList.map(g=>g.id===gudangForm.id?gudangForm:g) : [...gudangList, gudangForm];
    setGudangList(ng);
    const ok = await syncGudang(ng);
    if (!ok) { setGudangList(prevList); showToast("Gagal menyimpan ke server, perubahan Gudang DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_gudang_v1", ng);
    logAudit(currentUser, exists?"UPDATE":"CREATE", "gudang", gudangForm.id, {nama:gudangForm.nama});
    setGudangWizardStep(2);
  }
  async function deleteGudang(id) {
    const g = gudangList.find(x=>x.id===id);
    const blokCount = lokasiList.filter(l=>l.gudangId===id).length;
    askConfirmDelete({
      title: "Hapus Gudang?",
      message: <>Apakah Anda yakin ingin menghapus Gudang <b>{g?.nama||"-"}</b>?</>,
      warning: `Tindakan ini tidak bisa dibatalkan dan ada ${blokCount} Blok Lokasi terkait yang akan kehilangan koordinat denah.`,
      onConfirm: async () => {
        const prevList = gudangList;
        const ng = gudangList.filter(x=>x.id!==id);
        setGudangList(ng);
        const ok = await syncGudang(ng);
        if (!ok) { setGudangList(prevList); showToast("Gagal menghapus di server, Gudang DIBATALKAN. Coba lagi.","error"); return; }
        CLOUD.set("pln_gudang_v1", ng);
        logAudit(currentUser, "DELETE", "gudang", id, {nama:g?.nama});
        showToast("Gudang dihapus.");
      }
    });
  }
  // Tambah blok langsung dari klik titik di denah pada wizard step 3 (tanpa modal Lokasi terpisah)
  async function addWizardBlok() {
    if (!wizardBlokDraft?.kode?.trim()) { showToast("Kode blok tidak boleh kosong!","error"); return; }
    if (isKodeDuplicateInSubGudang(wizardBlokDraft.kode, gudangForm.id, null, null)) {
      showToast(`Kode blok "${wizardBlokDraft.kode}" sudah dipakai di gudang ini!`,"error"); return;
    }
    const baru = {
      id: `LOK-${uid().slice(-6)}`,
      kode: wizardBlokDraft.kode.trim(), keterangan: wizardBlokDraft.keterangan||"", kapasitas: wizardBlokDraft.kapasitas||50,
      mapX: wizardBlokDraft.xPct, mapY: wizardBlokDraft.yPct, gudangId: gudangForm.id,
      createdAt: Date.now(),
      status: "APPROVED", pendingAction: null,
      requestedBy: currentUser.id, requestedAt: Date.now(),
    };
    const prevList = lokasiList;
    const nl = [...lokasiList, baru];
    setLokasiList(nl);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan ke server, Blok DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    setWizardBlokDraft(null);
    showToast("✅ Blok ditambahkan!");
  }

  // Upload gambar denah gudang (PNG/JPG) — kompres otomatis jika > 1MB
  async function uploadDenahGudang(gudangId, file) {
    stateRef.current.setDenahLoading?.(true);
    try {
      const imgData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            // Target max dimension 1400px, JPEG 80% — menghasilkan ~300-800KB
            const maxDim = 1400;
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim/w, maxDim/h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.80));
          };
          img.onerror = () => reject(new Error("Gagal membaca gambar"));
          img.src = ev.target.result;
        };
        reader.onerror = () => reject(new Error("Gagal membaca file"));
        reader.readAsDataURL(file);
      });
      const prevList = gudangList;
      const ng = gudangList.map(g=>g.id===gudangId ? {...g, denahImageData:imgData, denahUploadedAt:Date.now(), denahOcrWords:null} : g);
      setGudangList(ng);
      const ok = await syncGudang(ng);
      if (!ok) { setGudangList(prevList); showToast("Gagal menyimpan denah ke server, upload DIBATALKAN. Coba lagi.","error"); return; }
      CLOUD.set("pln_gudang_v1", ng);
      showToast("✅ Denah gudang berhasil diupload! Membaca label blok di gambar...");
      await stateRef.current.runOcrOnDenah(gudangId, imgData);
    } catch(e) {
      showToast("Gagal upload denah: " + e.message, "error");
    } finally {
      stateRef.current.setDenahLoading?.(false);
    }
  }

  // Edit/hapus baris usulan blok hasil OCR sebelum dikonfirmasi
  function updateOcrSuggestion(id, patch) {
    stateRef.current.setOcrSuggestions(s => s.map(x => x.id===id ? {...x, ...patch} : x));
  }
  function removeOcrSuggestion(id) {
    stateRef.current.setOcrSuggestions(s => s.filter(x => x.id!==id));
  }
  // Konfirmasi: usulan yang dicentang ditambahkan langsung ke Master Lokasi (tanpa approval —
  // tools ini hanya bisa diakses ADMIN). subGudangId non-null = usulan berasal dari denah Sub
  // Gudang -> koordinat disimpan di subMapX/subMapY (bukan mapX/mapY denah Gudang keseluruhan).
  async function confirmOcrSuggestions(gudangId, subGudangId=null) {
    const checked = stateRef.current.ocrSuggestions.filter(s => s.checked);
    if (checked.length === 0) { showToast("Tidak ada usulan yang dicentang.","error"); return; }
    if (checked.some(s => !s.kode.trim())) { showToast("Nama Area wajib diisi untuk semua usulan yang dicentang!","error"); return; }

    // Saring duplikat kode: terhadap blok yang sudah ada di gudang ini, DAN antar sesama usulan yang dicentang.
    const seenInBatch = new Set();
    const valid = [], duplikat = [];
    checked.forEach(s => {
      const norm = s.kode.trim().toLowerCase();
      if (seenInBatch.has(norm) || isKodeDuplicateInSubGudang(s.kode, gudangId, subGudangId, null)) {
        duplikat.push(s.kode);
      } else {
        seenInBatch.add(norm);
        valid.push(s);
      }
    });
    if (valid.length === 0) { showToast(`Semua usulan terpilih duplikat kode dengan blok yang sudah ada di ${subGudangId?"sub gudang":"gudang"} ini.`,"error"); return; }

    const baru = valid.map(s => ({
      id: `LOK-${uid().slice(-6)}`,
      kode: s.kode.trim(), keterangan: "", kapasitas: 50,
      jenisArea: s.jenisArea||"Rak Tertutup", luasan: s.luasan||"",
      ...(subGudangId ? { subMapX: s.xPct, subMapY: s.yPct, subGudangId } : { mapX: s.xPct, mapY: s.yPct }),
      gudangId,
      createdAt: Date.now(),
      status: "APPROVED", pendingAction: null,
      requestedBy: currentUser.id, requestedAt: Date.now(),
    }));
    const prevList = lokasiList;
    const nl = [...lokasiList, ...baru];
    setLokasiList(nl);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan ke server, blok usulan OCR DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    stateRef.current.setOcrSuggestions(s => s.filter(x => !checked.includes(x)));
    const dupMsg = duplikat.length ? ` (${duplikat.length} dilewati karena duplikat kode: ${duplikat.join(", ")})` : "";
    showToast(`✅ ${baru.length} blok ditambahkan!` + dupMsg);
  }

  async function uploadDenahSubGudang(subGudangId, gudangId, file) {
    stateRef.current.setDenahSubLoading?.(true);
    try {
      const imgData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            const maxDim = 1400;
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim/w, maxDim/h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.80));
          };
          img.onerror = () => reject(new Error("Gagal membaca gambar"));
          img.src = ev.target.result;
        };
        reader.onerror = () => reject(new Error("Gagal membaca file"));
        reader.readAsDataURL(file);
      });
      const prevList = subGudangList;
      const nsg = subGudangList.map(sg=>sg.id===subGudangId ? {...sg, denahImageData:imgData, denahUploadedAt:Date.now(), denahOcrWords:null} : sg);
      setSubGudangList(nsg);
      const ok = await syncSubGudang(nsg);
      if (!ok) { setSubGudangList(prevList); showToast("Gagal menyimpan denah ke server, upload DIBATALKAN. Coba lagi.","error"); return; }
      CLOUD.set("pln_sub_gudang_v1", nsg);
      showToast("✅ Denah Sub Gudang berhasil diupload! Membaca label blok di gambar...");
      await stateRef.current.runOcrOnDenahSub(subGudangId, gudangId, imgData);
    } catch(e) {
      showToast("Gagal upload denah: " + e.message, "error");
    } finally {
      stateRef.current.setDenahSubLoading?.(false);
    }
  }

  return {
    lokasiModal, setLokasiModal, lokasiForm, setLokasiForm, lokasiDeleteConfirm, setLokasiDeleteConfirm,
    showGudangMaintenance, setShowGudangMaintenance,
    mapConfigSubGudangId, setMapConfigSubGudangId, pendingMapLokasiSub, setPendingMapLokasiSub, manualAddModeSub, setManualAddModeSub,
    showGudangDenahTools, setShowGudangDenahTools, expandedSubGudangToolsIds, setExpandedSubGudangToolsIds,
    selectedSubGudangId, setSelectedSubGudangId,
    openEditLokasi, isKodeDuplicateInSubGudang, syncLokasi, saveLokasi, requestDeleteLokasi, confirmDeleteLokasi,
    gudangModal, setGudangModal, gudangForm, setGudangForm,
    mapConfigGudangId, setMapConfigGudangId, pendingMapLokasi, setPendingMapLokasi, expandedGudangId, setExpandedGudangId,
    gudangWizardStep, setGudangWizardStep, wizardBlokDraft, setWizardBlokDraft, manualAddMode, setManualAddMode,
    capacityReviewImportId, setCapacityReviewImportId, capacityReviewCandidates, setCapacityReviewCandidates,
    capacityReviewDecisions, setCapacityReviewDecisions,
    openAddGudang, openEditGudang, closeGudangWizard, syncGudang, syncSubGudang,
    backfillGudangCoordFromCapacity, dedupeGudangDanSubGudang,
    startCapacityApproval, confirmCapacityApproval, rejectCapacityImport,
    saveGudang, gudangWizardNext, deleteGudang, addWizardBlok,
    uploadDenahGudang, updateOcrSuggestion, removeOcrSuggestion, confirmOcrSuggestions, uploadDenahSubGudang,
  };
}
