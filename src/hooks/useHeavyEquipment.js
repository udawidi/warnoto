import { useState } from "react";
import { uid } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";
import { logAudit } from "../lib/audit.js";
import { isDemoMode } from "../lib/demo.js";
import { compressImage, _isDataUrl, uploadPhotoToStorage, _withTimeout } from "../lib/supabaseSync.js";
import {
  normalizeHeavyEquipmentRecord,
  getHeavyEquipmentLoanOwnerUpt,
  getHeavyEquipmentLoanRequesterUpt,
  getHeavyEquipmentLoanReturnDate,
  getHeavyEquipmentLoanJobName,
  isPendingHeavyEquipmentLoan,
  getHeavyEquipmentLoanRuntimeStatus,
  canApproveHeavyEquipmentLoan,
} from "../lib/heavyEquipment.js";
import { getHeavyEquipmentUploadErrorMessage, getHeavyEquipmentProcessingErrorMessage } from "../lib/heavyEquipmentPhoto.js";

function readCachedList(key) {
  try { return JSON.parse(localStorage.getItem('warnoto_' + key) || "null"); } catch { return null; }
}

// Domain Alat Berat: master alat + peminjaman antar-UPT (ajukan/approve/reject/selesai).
// saveToCloud diakses lewat stateRef.current (bukan langsung sbg param) karena hook ini
// dipanggil sebelum saveToCloud (useCallback) didefinisikan di PLNWarehouse — stateRef.current.saveToCloud
// diisi belakangan (lihat App.jsx setelah definisi saveToCloud), sama pola dgn stateRef utk data state.
export function useHeavyEquipment({ currentUser, uptList, showToast, stateRef, logApprovalHistory }) {
  const [heavyEquipmentList, setHeavyEquipmentList] = useState(() => readCachedList("pln_heavy_equipment_v1") ?? []);
  const [heavyEquipmentLoans, setHeavyEquipmentLoans] = useState(() => readCachedList("pln_heavy_equipment_loans_v1") ?? []);

  async function saveHeavyEquipmentEdit(equipmentId, updates) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa mengubah data alat.","error"); return false; }
    const alat = heavyEquipmentList.find(eq=>eq.id===equipmentId);
    if (!alat) return false;
    if (["MAINTENANCE","KIR"].includes(updates.statusAlat) && alat.availabilityStatus==="DIPINJAM") {
      showToast("Alat sedang dipinjam, tidak bisa diubah ke status ini.","error"); return false;
    }
    // Foto ke Storage dulu (pola sama dengan Data Stok — JANGAN base64 mentah masuk
    // jsonb heavy_equipment.data, cegah pola insiden 2026-07-23 & 2026-07-28 terulang
    // di tabel lain). Bucket reuse "tug-photos" (sudah publik), folder alat-berat/.
    const canEditAllHeavyEquipment = hasRole(currentUser, "ADMIN");
    // Jangan menyebarkan properti yang tidak memiliki input (id, availabilityStatus,
    // metadata audit, dst.) ketika Admin membuka form lengkap. Untuk TL, payload
    // sengaja hanya dua field yang memang diizinkan.
    const editableFields = ["upt","lokasi","nama","jenis","merkType","kapasitas","nomorSeri","tahun","kondisi","suratIzinAlat","statusAlat","kategori","tracked"];
    let upd = canEditAllHeavyEquipment
      ? Object.fromEntries(editableFields.map(key => [key, updates[key] ?? alat[key] ?? ""]))
      : { statusAlat: updates.statusAlat ?? alat.statusAlat };
    // URL lama bukan perubahan foto. Ini menghindari metadata foto berubah hanya
    // karena TL/Admin membuka lalu menyimpan status alat.
    const needsPhotoStorage = _isDataUrl(updates.foto) && !isDemoMode();
    // Foto lama berbentuk data URL (dari sebelum migrasi Storage) harus ikut
    // dipindahkan pada penyimpanan berikutnya, walau pengguna tidak memilih file baru.
    const isPhotoChanged = updates.foto !== alat.foto || needsPhotoStorage;
    if (needsPhotoStorage) {
      let compressedPhoto;
      try { compressedPhoto = await compressImage(updates.foto, {maxBytes:1_000_000}); }
      catch (e) { showToast(getHeavyEquipmentProcessingErrorMessage(e), "error"); return false; }
      try {
        const url = await _withTimeout(uploadPhotoToStorage(compressedPhoto, "tug-photos", `alat-berat/${equipmentId}.jpg`), 30_000, "unggah foto");
        upd = { ...upd, foto: url };
      } catch (e) {
        console.warn("Upload foto alat berat gagal:", equipmentId, e?.message||e);
        showToast(getHeavyEquipmentUploadErrorMessage(e),"error"); return false;
      }
    }
    if (isPhotoChanged && !_isDataUrl(updates.foto)) upd = { ...upd, foto: updates.foto || null };
    upd = { ...upd, updatedAt:Date.now(), updatedBy:currentUser.id };
    const next = heavyEquipmentList.map(eq => eq.id === equipmentId ? { ...eq, ...upd, ...(isPhotoChanged ? {fotoUpdatedAt:Date.now(), fotoUpdatedBy:currentUser.id} : {}) } : eq);
    const ok = await stateRef.current.saveToCloud({heavyEquipmentList: next}, {heavyEquipmentChangedRows:[next.find(eq=>eq.id===equipmentId)]});
    if (!ok) return false;
    setHeavyEquipmentList(next);
    logAudit(currentUser, "UPDATE", "heavy_equipment", equipmentId, {nama:alat.nama});
    showToast("✅ Data alat berat disimpan.");
    return true;
  }

  async function createHeavyEquipment(form) {
    if (!hasRole(currentUser, "ADMIN")) { showToast("Hanya Admin Gudang yang bisa menambah alat.", "error"); return false; }
    if (!form?.upt || !form?.nama?.trim() || !form?.lokasi?.trim()) { showToast("UPT, nama, dan lokasi wajib diisi.", "error"); return false; }
    const now = Date.now();
    let item = normalizeHeavyEquipmentRecord({ ...form, id:`HE-${uid().slice(-8)}`, availabilityStatus:"TERSEDIA", createdAt:now, createdBy:currentUser.id, updatedAt:now, updatedBy:currentUser.id, source:"Input Admin Gudang" });
    if (_isDataUrl(item.foto) && !isDemoMode()) {
      let compressedPhoto;
      try { compressedPhoto = await compressImage(item.foto, {maxBytes:1_000_000}); }
      catch (e) { showToast(getHeavyEquipmentProcessingErrorMessage(e), "error"); return false; }
      try { item = { ...item, foto: await _withTimeout(uploadPhotoToStorage(compressedPhoto, "tug-photos", `alat-berat/${item.id}.jpg`), 30_000, "unggah foto") }; }
      catch (e) { console.warn("Upload foto alat berat gagal:", item.id, e?.message||e); showToast(getHeavyEquipmentUploadErrorMessage(e), "error"); return false; }
    }
    const next = [item, ...heavyEquipmentList];
    const ok = await stateRef.current.saveToCloud({heavyEquipmentList: next}, {heavyEquipmentChangedRows:[item]});
    if (!ok) return false;
    setHeavyEquipmentList(next);
    logAudit(currentUser, "CREATE", "heavy_equipment", item.id, {nama:item.nama});
    showToast("✅ Alat berat ditambahkan.");
    return true;
  }

  async function createHeavyEquipmentLoan(form) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa mengajukan peminjaman alat.","error"); return; }
    if (!form.equipmentId || !form.requesterUpt || !form.namaPekerjaan?.trim() || !form.tanggalAmbil || !form.tanggalKembali || !form.keperluan?.trim()) {
      showToast("Lengkapi alat, UPT peminjam, nama pekerjaan, tanggal, dan keperluan.","error"); return;
    }
    const alat = heavyEquipmentList.find(eq=>eq.id===form.equipmentId);
    if (!alat) { showToast("Alat tidak ditemukan.","error"); return; }
    if (alat.availabilityStatus === "DIPINJAM") { showToast("Alat sedang dipinjam, tidak bisa diajukan lagi.","error"); return; }
    if (alat.statusAlat === "MAINTENANCE") { showToast("Alat sedang maintenance, tidak bisa dipinjam UPT lain.","error"); return; }
    if (alat.statusAlat === "KIR") { showToast("Alat sedang KIR, tidak bisa dipinjam UPT lain.","error"); return; }
    if (alat.upt === form.requesterUpt) { showToast("Peminjaman harus antar UPT. Pilih UPT peminjam yang berbeda dari UPT pemilik alat.","error"); return; }
    const loan = {
      id: `HLOAN-${uid().slice(-8)}`,
      equipmentId: form.equipmentId,
      ownerUpt: alat.upt,
      requesterUpt: form.requesterUpt,
      fromUpt: alat.upt,
      toUpt: form.requesterUpt,
      namaPekerjaan: form.namaPekerjaan.trim(),
      tanggalAmbil: form.tanggalAmbil,
      tanggalKembali: form.tanggalKembali,
      tanggalMulai: form.tanggalAmbil,
      tanggalSelesai: form.tanggalKembali,
      keperluan: form.keperluan.trim(),
      catatan: form.catatan || "",
      status: "PENDING_OWNER_ASMAN",
      requestedBy: currentUser.id,
      requestedAt: Date.now(),
      requiredApprover: "ASMAN",
      requiredApproverUpt: alat.upt,
    };
    const nextLoans = [loan, ...heavyEquipmentLoans];
    setHeavyEquipmentLoans(nextLoans);
    await stateRef.current.saveToCloud({heavyEquipmentLoans: nextLoans}, {heavyEquipmentLoansChangedRows: [loan]});
    showToast("Peminjaman alat diajukan. Menunggu approval Asman.");
  }

  async function approveHeavyEquipmentLoan(loanId, catatan="") {
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !isPendingHeavyEquipmentLoan(loan)) return;
    if (!canApproveHeavyEquipmentLoan(currentUser, loan, uptList)) { showToast("Hanya Asman UPT pemilik alat yang bisa approve peminjaman ini.","error"); return; }
    const ownerUpt = getHeavyEquipmentLoanOwnerUpt(loan);
    const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, ownerUpt, requesterUpt, status:"DIPINJAM", approvedBy:currentUser.id, approvedAt:Date.now(), catatanApproval:catatan } : l);
    const nextEquipment = heavyEquipmentList.map(eq=>eq.id===loan.equipmentId ? { ...eq, availabilityStatus:"DIPINJAM", activeLoanId:loanId, borrowedToUpt:requesterUpt, borrowedJobName:getHeavyEquipmentLoanJobName(loan), borrowedUntil:getHeavyEquipmentLoanReturnDate(loan) } : eq);
    setHeavyEquipmentLoans(nextLoans);
    setHeavyEquipmentList(nextEquipment);
    await stateRef.current.saveToCloud({heavyEquipmentLoans: nextLoans, heavyEquipmentList: nextEquipment}, {heavyEquipmentLoansChangedRows: [nextLoans.find(l=>l.id===loanId)]});
    await logApprovalHistory({type:"HEAVY_EQUIPMENT_LOAN", decision:"APPROVED", title:`Peminjaman alat ${loan.equipmentId}: ${ownerUpt} -> ${requesterUpt}`, requestedBy:loan.requestedBy, requestedAt:loan.requestedAt});
    showToast("Peminjaman alat disetujui.");
  }

  async function rejectHeavyEquipmentLoan(loanId, reason) {
    if (!reason?.trim()) { showToast("Masukkan alasan penolakan.","error"); return; }
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !isPendingHeavyEquipmentLoan(loan)) return;
    if (!canApproveHeavyEquipmentLoan(currentUser, loan, uptList)) { showToast("Hanya Asman UPT pemilik alat yang bisa menolak peminjaman ini.","error"); return; }
    const ownerUpt = getHeavyEquipmentLoanOwnerUpt(loan);
    const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, ownerUpt, requesterUpt, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason.trim() } : l);
    setHeavyEquipmentLoans(nextLoans);
    await stateRef.current.saveToCloud({heavyEquipmentLoans: nextLoans}, {heavyEquipmentLoansChangedRows: [nextLoans.find(l=>l.id===loanId)]});
    await logApprovalHistory({type:"HEAVY_EQUIPMENT_LOAN", decision:"REJECTED", title:`Peminjaman alat ${loan.equipmentId}: ${ownerUpt} -> ${requesterUpt}`, requestedBy:loan.requestedBy, requestedAt:loan.requestedAt});
    showToast("Peminjaman alat ditolak.", "error");
  }

  async function completeHeavyEquipmentLoan(loanId) {
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !["DIPINJAM","OVERDUE"].includes(getHeavyEquipmentLoanRuntimeStatus(loan))) return;
    if (!hasRole(currentUser, "ADMIN","TL","ASMAN")) { showToast("Role kamu tidak bisa menandai alat kembali.","error"); return; }
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, status:"SELESAI", returnedBy:currentUser.id, returnedAt:Date.now() } : l);
    const nextEquipment = heavyEquipmentList.map(eq=>eq.id===loan.equipmentId ? { ...eq, availabilityStatus:"TERSEDIA", activeLoanId:null, borrowedToUpt:null, borrowedJobName:null, borrowedUntil:null } : eq);
    setHeavyEquipmentLoans(nextLoans);
    setHeavyEquipmentList(nextEquipment);
    await stateRef.current.saveToCloud({heavyEquipmentLoans: nextLoans, heavyEquipmentList: nextEquipment}, {heavyEquipmentLoansChangedRows: [nextLoans.find(l=>l.id===loanId)]});
    showToast("Alat ditandai sudah kembali.");
  }

  return {
    heavyEquipmentList, setHeavyEquipmentList,
    heavyEquipmentLoans, setHeavyEquipmentLoans,
    saveHeavyEquipmentEdit,
    createHeavyEquipment,
    createHeavyEquipmentLoan,
    approveHeavyEquipmentLoan,
    rejectHeavyEquipmentLoan,
    completeHeavyEquipmentLoan,
  };
}
