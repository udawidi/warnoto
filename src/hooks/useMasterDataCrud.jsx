import { useState } from "react";
import { uid } from "../lib/utils.js";
import { CLOUD } from "../lib/cloud.js";
import { logAudit } from "../lib/audit.js";
import { syncMasterTable } from "../lib/masterSync.js";

// Domain: CRUD entitas organisasi (Satpam, Tim Mutu, UIT, UPT, ULTG) + Master Katalog
// Barang. saveToCloud diakses lewat stateRef.current (bukan langsung sbg param) karena
// hook ini dipanggil sebelum saveToCloud (useCallback) didefinisikan di PLNWarehouse —
// sama pola dgn useHeavyEquipment.js. Satpam/TimMutu/UIT/UPT/ULTG pakai syncMasterTable
// (import modul langsung, tidak kena TDZ) + CLOUD.set, katalog pakai saveToCloud (pola
// lama, ada stocksChangedRows dsb.).
export function useMasterDataCrud({ currentUser, showToast, stateRef, askConfirmDelete, katalogList, setKatalogList, stocks, satpamList, setSatpamList, timMutuList, setTimMutuList, uitList, setUitList, uptList, setUptList, ultgList, setUltgList }) {
  const [katalogModal, setKatalogModal] = useState(null);
  const [katalogForm, setKatalogForm] = useState({});
  const [satpamModal, setSatpamModal] = useState(null);
  const [satpamForm, setSatpamForm] = useState({});
  const [timMutuModal, setTimMutuModal] = useState(null);
  const [timMutuForm, setTimMutuForm] = useState({});
  const [uitModal, setUitModal] = useState(null);
  const [uitForm, setUitForm] = useState({});
  const [uptModal, setUptModal] = useState(null);
  const [uptForm, setUptForm] = useState({});
  const [ultgModal, setUltgModal] = useState(null);
  const [ultgForm, setUltgForm] = useState({});

  // ── MASTER KATALOG BARANG CRUD ──
  function openAddKatalog() {
    setKatalogForm({ id:`KAT-${uid().slice(-6)}`, katalog:"", name:"", category:"Lainnya", satuan:"" });
    setKatalogModal("add");
  }
  function openEditKatalog(k) { setKatalogForm({...k}); setKatalogModal("edit"); }
  async function saveKatalog() {
    if (!katalogForm.name?.trim()) { showToast("Nama barang tidak boleh kosong!","error"); return; }
    if (!katalogForm.katalog?.trim()) { showToast("Nomor Katalog tidak boleh kosong!","error"); return; }
    // Cegah duplikat: 1 barang fisik seharusnya cuma punya 1 katalogId. Kode katalog (nomor
    // SAP) harus unik mutlak; nama juga dicek (case-insensitive, exact match) karena barang
    // yang sama sering ke-input dobel dengan kode beda kalau tidak dicek di sini.
    const kodeDup = katalogList.find(k => k.id!==katalogForm.id && (k.katalog||"").trim().toLowerCase()===katalogForm.katalog.trim().toLowerCase());
    if (kodeDup) { showToast(`Nomor Katalog "${katalogForm.katalog}" sudah dipakai oleh "${kodeDup.name}"!`, "error"); return; }
    const namaDup = katalogList.find(k => k.id!==katalogForm.id && (k.name||"").trim().toLowerCase()===katalogForm.name.trim().toLowerCase());
    if (namaDup) { showToast(`Nama barang "${katalogForm.name}" sudah ada (kode ${namaDup.katalog||"-"}). Kalau ini barang yang sama, edit yang sudah ada — jangan buat baru.`, "error"); return; }
    // _maraLocked cuma flag UI (kunci form), bukan bagian data katalog — jangan ikut tersimpan.
    const { _maraLocked, ...katalogClean } = katalogForm;
    let nk;
    if (katalogModal==="edit") nk = katalogList.map(k=>k.id===katalogForm.id?{...katalogClean}:k);
    else nk = [...katalogList, {...katalogClean, createdAt:Date.now()}];
    setKatalogList(nk); setKatalogModal(null);
    // Cuma 1 baris katalog berubah (edit/tambah id===katalogForm.id) — sync ringan baris itu.
    await stateRef.current.saveToCloud({katalogList: nk}, {katalogChangedRows: nk.filter(k=>k.id===katalogForm.id)});
    logAudit(currentUser, katalogModal==="edit"?"UPDATE":"CREATE", "katalog", katalogClean.katalog||katalogClean.id, {kode:katalogClean.katalog, nama:katalogClean.name});
    showToast(katalogModal==="edit" ? "Master Katalog diupdate!" : "Katalog barang baru ditambahkan!");
  }
  async function deleteKatalog(id) {
    if (stocks.some(s=>s.katalogId===id)) { showToast("Tidak bisa hapus: katalog ini masih dipakai di Data Stok!","error"); return; }
    const k = katalogList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus Katalog Barang?",
      message: <>Apakah Anda yakin ingin menghapus katalog barang <b>{k?.name||"-"}</b> (No. Katalog {k?.katalog||"-"})?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nk = katalogList.filter(x=>x.id!==id);
        setKatalogList(nk); await stateRef.current.saveToCloud({katalogList: nk});
        logAudit(currentUser, "DELETE", "katalog", k?.katalog||id, {nama:k?.name});
        showToast("Katalog dihapus.");
      }
    });
  }

  // ── Satpam CRUD ──
  function openAddSatpam() { setSatpamForm({ id:"SP"+uid().slice(-6), name:"", telp:"", gudangId:"" }); setSatpamModal("add"); }
  function openEditSatpam(sp) { setSatpamForm({...sp}); setSatpamModal("edit"); }
  async function saveSatpam() {
    if (!satpamForm.name?.trim()) { showToast("Nama Satpam tidak boleh kosong!","error"); return; }
    if (!satpamForm.gudangId) { showToast("Satpam wajib ditugaskan di gudang!","error"); return; }
    const prevList = satpamList;
    let nsp;
    if (satpamModal==="edit") nsp = satpamList.map(s=>s.id===satpamForm.id?{...satpamForm}:s);
    else nsp = [...satpamList, {...satpamForm, createdAt:Date.now()}];
    setSatpamList(nsp); setSatpamModal(null);
    const ok = await syncMasterTable("satpam", nsp);
    if (!ok) { setSatpamList(prevList); showToast("Gagal menyimpan ke server, perubahan Satpam DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_satpam_v1", nsp);
    logAudit(currentUser, satpamModal==="edit"?"UPDATE":"CREATE", "satpam", satpamForm.id, {nama:satpamForm.name});
    showToast(satpamModal==="edit" ? "Data Satpam diupdate!" : "Satpam baru ditambahkan!");
  }
  async function deleteSatpam(id) {
    const s = satpamList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus Data Satpam?",
      message: <>Apakah Anda yakin ingin menghapus data Satpam <b>{s?.name||"-"}</b>?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const prevList = satpamList;
        const nsp = satpamList.filter(x=>x.id!==id);
        setSatpamList(nsp);
        const ok = await syncMasterTable("satpam", nsp);
        if (!ok) { setSatpamList(prevList); showToast("Gagal menghapus di server, data Satpam DIKEMBALIKAN. Coba lagi.","error"); return; }
        CLOUD.set("pln_satpam_v1", nsp);
        logAudit(currentUser, "DELETE", "satpam", id, {nama:s?.name});
        showToast("Satpam dihapus.");
      }
    });
  }

  // ── Master Tim Mutu CRUD (2 paket TETAP — hanya edit anggota, tidak tambah/hapus paket) ──
  function openEditTimMutu(tm) { setTimMutuForm({...tm}); setTimMutuModal("edit"); }
  async function saveTimMutu() {
    const prevList = timMutuList;
    const ntm = timMutuList.map(t=>t.id===timMutuForm.id?{...timMutuForm}:t);
    setTimMutuList(ntm); setTimMutuModal(null);
    const ok = await syncMasterTable("tim_mutu", ntm);
    if (!ok) { setTimMutuList(prevList); showToast("Gagal menyimpan ke server, perubahan Tim Mutu DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_tim_mutu_v1", ntm);
    logAudit(currentUser, "UPDATE", "tim_mutu", timMutuForm.id);
    showToast("Paket Tim Mutu diupdate!");
  }

  // ── Master UIT CRUD ──
  function openAddUIT() { setUitForm({id:"UIT-"+uid().slice(-6).toUpperCase(), nama:"", kode:"", alamat:"", createdAt:Date.now()}); setUitModal("add"); }
  function openEditUIT(u) { setUitForm({...u}); setUitModal("edit"); }
  async function saveUIT() {
    if (!uitForm.nama?.trim()||!uitForm.kode?.trim()) { showToast("Nama dan Kode UIT wajib diisi!","error"); return; }
    const prevList = uitList;
    const nu = uitModal==="add" ? [...uitList, uitForm] : uitList.map(u=>u.id===uitForm.id?uitForm:u);
    setUitList(nu); setUitModal(null);
    const ok = await syncMasterTable("uit", nu);
    if (!ok) { setUitList(prevList); showToast("Gagal menyimpan ke server, perubahan UIT DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_uit_v1", nu);
    logAudit(currentUser, uitModal==="add"?"CREATE":"UPDATE", "uit", uitForm.id, {nama:uitForm.nama, kode:uitForm.kode});
    showToast(uitModal==="add"?"UIT ditambahkan!":"UIT diupdate!");
  }
  async function deleteUIT(id) {
    const u = uitList.find(x=>x.id===id);
    const uptCount = uptList.filter(p=>p.uitId===id).length;
    askConfirmDelete({
      title: "Hapus UIT?",
      message: <>Apakah Anda yakin ingin menghapus UIT <b>{u?.nama||"-"}</b>?</>,
      warning: uptCount>0 ? `Tindakan ini tidak bisa dibatalkan dan ada ${uptCount} UPT yang masih terhubung ke UIT ini.` : "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const prevList = uitList;
        const nu = uitList.filter(x=>x.id!==id);
        setUitList(nu);
        const ok = await syncMasterTable("uit", nu);
        if (!ok) { setUitList(prevList); showToast("Gagal menghapus di server, UIT DIBATALKAN. Coba lagi.","error"); return; }
        CLOUD.set("pln_uit_v1", nu);
        logAudit(currentUser, "DELETE", "uit", id, {nama:u?.nama});
        showToast("UIT dihapus.");
      }
    });
  }

  // ── Master ULTG CRUD (unit di bawah UPT) ──
  function syncUltg(nu) { return syncMasterTable("ultg", nu, u => ({ upt_id: u.parentUptId || null })); }
  function openAddULTG(presetUptId) { setUltgForm({id:"ULTG-"+uid().slice(-6).toUpperCase(), nama:"", kode:"", parentUptId: presetUptId || uptList[0]?.id||"", createdAt:Date.now()}); setUltgModal("add"); }
  function openEditULTG(u) { setUltgForm({...u}); setUltgModal("edit"); }
  async function saveULTG() {
    if (!ultgForm.nama?.trim()||!ultgForm.kode?.trim()) { showToast("Nama dan Kode ULTG wajib diisi!","error"); return; }
    if (!ultgForm.parentUptId) { showToast("Pilih UPT induk!","error"); return; }
    const prevList = ultgList;
    const nu = ultgModal==="add" ? [...ultgList, ultgForm] : ultgList.map(u=>u.id===ultgForm.id?ultgForm:u);
    setUltgList(nu); setUltgModal(null);
    const ok = await syncUltg(nu);
    if (!ok) { setUltgList(prevList); showToast("Gagal menyimpan ke server, perubahan ULTG DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_ultg_v1", nu);
    logAudit(currentUser, ultgModal==="add"?"CREATE":"UPDATE", "ultg", ultgForm.id, {nama:ultgForm.nama, kode:ultgForm.kode});
    showToast(ultgModal==="add"?"ULTG ditambahkan!":"ULTG diupdate!");
  }
  async function deleteULTG(id) {
    const u = ultgList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus ULTG?",
      message: <>Apakah Anda yakin ingin menghapus ULTG <b>{u?.nama||"-"}</b>?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const prevList = ultgList;
        const nu = ultgList.filter(x=>x.id!==id);
        setUltgList(nu);
        const ok = await syncUltg(nu);
        if (!ok) { setUltgList(prevList); showToast("Gagal menghapus di server, ULTG DIBATALKAN. Coba lagi.","error"); return; }
        CLOUD.set("pln_ultg_v1", nu);
        logAudit(currentUser, "DELETE", "ultg", id, {nama:u?.nama});
        showToast("ULTG dihapus.");
      }
    });
  }

  // ── Master UPT CRUD ──
  function openAddUPT(presetUitId) { setUptForm({id:"UPT-"+uid().slice(-6).toUpperCase(), nama:"", kode:"", alamat:"", uitId: presetUitId || uitList[0]?.id||"", createdAt:Date.now()}); setUptModal("add"); }
  function openEditUPT(u) { setUptForm({...u}); setUptModal("edit"); }
  function syncUpt(nu) { return syncMasterTable("upt", nu, u => ({ uit_id: u.uitId || null })); }
  async function saveUPT() {
    if (!uptForm.nama?.trim()||!uptForm.kode?.trim()) { showToast("Nama dan Kode UPT wajib diisi!","error"); return; }
    const prevList = uptList;
    const nu = uptModal==="add" ? [...uptList, uptForm] : uptList.map(u=>u.id===uptForm.id?uptForm:u);
    setUptList(nu); setUptModal(null);
    const ok = await syncUpt(nu);
    if (!ok) { setUptList(prevList); showToast("Gagal menyimpan ke server, perubahan UPT DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_upt_v1", nu);
    logAudit(currentUser, uptModal==="add"?"CREATE":"UPDATE", "upt", uptForm.id, {nama:uptForm.nama, kode:uptForm.kode});
    showToast(uptModal==="add"?"UPT ditambahkan!":"UPT diupdate!");
  }
  async function deleteUPT(id) {
    const u = uptList.find(x=>x.id===id);
    const ultgCount = ultgList.filter(g=>g.parentUptId===id).length;
    askConfirmDelete({
      title: "Hapus UPT?",
      message: <>Apakah Anda yakin ingin menghapus UPT <b>{u?.nama||"-"}</b>?</>,
      warning: ultgCount>0 ? `Tindakan ini tidak bisa dibatalkan dan ada ${ultgCount} ULTG yang masih terhubung ke UPT ini.` : "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const prevList = uptList;
        const nu = uptList.filter(x=>x.id!==id);
        setUptList(nu);
        const ok = await syncUpt(nu);
        if (!ok) { setUptList(prevList); showToast("Gagal menghapus di server, UPT DIBATALKAN. Coba lagi.","error"); return; }
        CLOUD.set("pln_upt_v1", nu);
        logAudit(currentUser, "DELETE", "upt", id, {nama:u?.nama});
        showToast("UPT dihapus.");
      }
    });
  }

  return {
    katalogModal, setKatalogModal, katalogForm, setKatalogForm,
    openAddKatalog, openEditKatalog, saveKatalog, deleteKatalog,
    satpamModal, setSatpamModal, satpamForm, setSatpamForm,
    openAddSatpam, openEditSatpam, saveSatpam, deleteSatpam,
    timMutuModal, setTimMutuModal, timMutuForm, setTimMutuForm,
    openEditTimMutu, saveTimMutu,
    uitModal, setUitModal, uitForm, setUitForm,
    openAddUIT, openEditUIT, saveUIT, deleteUIT,
    uptModal, setUptModal, uptForm, setUptForm,
    openAddUPT, openEditUPT, saveUPT, deleteUPT,
    ultgModal, setUltgModal, ultgForm, setUltgForm,
    openAddULTG, openEditULTG, saveULTG, deleteULTG,
  };
}
