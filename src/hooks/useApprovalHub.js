import { useState, useEffect } from "react";
import { CLOUD } from "../lib/cloud.js";

// Domain Approval Hub: approve/reject perubahan blok Lokasi + state
// pagination/filter UI tab Approval (dipisah dari App.jsx, 2026-08-10).
// logApprovalHistory TETAP di App.jsx (dipakai hook approval lain via param
// juga) — dioper ke sini sbg param. syncLokasi baru tersedia dari
// useWarehouseConfig SETELAH hook ini dipanggil, jadi diakses lewat
// stateRef.current.syncLokasi (App.jsx mengisinya setelah useWarehouseConfig,
// pola sama dgn stateRef.current.runOcrOnDenah di useDenahOcr).
export function useApprovalHub({ currentUser, showToast, stateRef, logApprovalHistory, lokasiList, setLokasiList }) {
  const [approvalHistoryList, setApprovalHistoryList] = useState([]); // log keputusan approval (Lokasi/Blok, Pemindahan Stok, dkk) — TUG tetap diturunkan dari txns

  // sebelumnya semua jenis approval digabung jadi 1 list panjang tanpa pemisah,
  // susah dibaca kalau lagi banyak. 1 pageSize dropdown dipakai bareng semua
  // section, tapi tiap section punya cursor halaman sendiri-sendiri.
  const [approvalTypeFilter, setApprovalTypeFilter] = useState("ALL");
  const [approvalPageSize, setApprovalPageSize] = useState(10);
  const [approvalStokPage, setApprovalStokPage] = useState(1);
  const [approvalStokGudangPage, setApprovalStokGudangPage] = useState(1);
  const [approvalEditStokPage, setApprovalEditStokPage] = useState(1);
  const [approvalHapusStokPage, setApprovalHapusStokPage] = useState(1);
  const [approvalAlatBeratPage, setApprovalAlatBeratPage] = useState(1);
  const [approvalOpnamePage, setApprovalOpnamePage] = useState(1);
  const [approvalStockCountPage, setApprovalStockCountPage] = useState(1);
  const [approvalHistoryPage, setApprovalHistoryPage] = useState(1);
  // Filter riwayat: "Approval saya", cari teks (title + item), rentang tanggal
  // native <input type=date>, opsi lihat semua (bypass paginasi).
  const [approvalHistoryMineOnly, setApprovalHistoryMineOnly] = useState(false);
  const [approvalHistorySearch, setApprovalHistorySearch] = useState("");
  const [approvalHistoryDateFrom, setApprovalHistoryDateFrom] = useState("");
  const [approvalHistoryDateTo, setApprovalHistoryDateTo] = useState("");
  const [approvalHistoryShowAll, setApprovalHistoryShowAll] = useState(false);
  useEffect(() => {
    setApprovalStokPage(1); setApprovalStokGudangPage(1); setApprovalEditStokPage(1);
    setApprovalHapusStokPage(1); setApprovalAlatBeratPage(1); setApprovalOpnamePage(1); setApprovalHistoryPage(1);
  }, [approvalTypeFilter, approvalPageSize, approvalHistoryMineOnly, approvalHistorySearch, approvalHistoryDateFrom, approvalHistoryDateTo]);

  // Approve/reject pengajuan perubahan blok lokasi (khusus role TL)
  async function approveLokasiChange(id) {
    const item = lokasiList.find(l=>l.id===id);
    if (!item) return;
    let nl;
    if (item.pendingAction === "DELETE") {
      nl = lokasiList.filter(l=>l.id!==id);
    } else if (item.pendingAction === "EDIT") {
      nl = lokasiList.map(l=>l.id===id ? {...l, ...item.pendingData, status:"APPROVED", pendingAction:null, pendingData:null, approvedBy:currentUser.id, approvedAt:Date.now()} : l);
    } else {
      nl = lokasiList.map(l=>l.id===id ? {...l, status:"APPROVED", pendingAction:null, approvedBy:currentUser.id, approvedAt:Date.now()} : l);
    }
    const prevList = lokasiList;
    setLokasiList(nl);
    const ok = await stateRef.current.syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan ke server, approval Blok Lokasi DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    const aksiLabel = {ADD:"Tambah Blok Baru",EDIT:"Ubah Data Blok",DELETE:"Hapus Blok"}[item.pendingAction]||item.pendingAction;
    const kode = item.pendingAction==="EDIT"?item.pendingData?.kode:item.kode;
    await logApprovalHistory({type:"LOKASI", decision:"APPROVED", title:`${aksiLabel}: ${kode}`, items:[{label:kode}], requestedBy:item.requestedBy, requestedAt:item.requestedAt});
    showToast("✅ Perubahan Blok Lokasi disetujui.");
  }
  async function rejectLokasiChange(id) {
    const item = lokasiList.find(l=>l.id===id);
    if (!item) return;
    let nl;
    if (item.pendingAction === "ADD") {
      nl = lokasiList.filter(l=>l.id!==id);
    } else {
      nl = lokasiList.map(l=>l.id===id ? {...l, status:"APPROVED", pendingAction:null, pendingData:null} : l);
    }
    const prevList = lokasiList;
    setLokasiList(nl);
    const ok = await stateRef.current.syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan ke server, penolakan Blok Lokasi DIBATALKAN. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    const aksiLabel = {ADD:"Tambah Blok Baru",EDIT:"Ubah Data Blok",DELETE:"Hapus Blok"}[item.pendingAction]||item.pendingAction;
    const kode = item.pendingAction==="EDIT"?item.pendingData?.kode:item.kode;
    await logApprovalHistory({type:"LOKASI", decision:"REJECTED", title:`${aksiLabel}: ${kode}`, items:[{label:kode}], requestedBy:item.requestedBy, requestedAt:item.requestedAt});
    showToast("❌ Perubahan Blok Lokasi ditolak.");
  }

  return {
    approvalHistoryList, setApprovalHistoryList,
    approvalTypeFilter, setApprovalTypeFilter,
    approvalPageSize, setApprovalPageSize,
    approvalStokPage, setApprovalStokPage,
    approvalStokGudangPage, setApprovalStokGudangPage,
    approvalEditStokPage, setApprovalEditStokPage,
    approvalHapusStokPage, setApprovalHapusStokPage,
    approvalAlatBeratPage, setApprovalAlatBeratPage,
    approvalOpnamePage, setApprovalOpnamePage,
    approvalStockCountPage, setApprovalStockCountPage,
    approvalHistoryPage, setApprovalHistoryPage,
    approvalHistoryMineOnly, setApprovalHistoryMineOnly,
    approvalHistorySearch, setApprovalHistorySearch,
    approvalHistoryDateFrom, setApprovalHistoryDateFrom,
    approvalHistoryDateTo, setApprovalHistoryDateTo,
    approvalHistoryShowAll, setApprovalHistoryShowAll,
    approveLokasiChange, rejectLokasiChange,
  };
}
