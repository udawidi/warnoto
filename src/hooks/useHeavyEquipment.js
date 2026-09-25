import { useState } from "react";
import { uid } from "../lib/utils.js";
import { logAudit } from "../lib/audit.js";
import { compressImage, _isDataUrl, uploadPhotoToStorage, _withTimeout } from "../lib/supabaseSync.js";

const RETURN_EVIDENCE_MAX_BYTES = 1_000_000;

function isSmallJpegDataUrl(value) {
  const match = typeof value === "string" && value.match(/^data:image\/jpeg;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return false;
  const payload = match[1].replace(/\s/g, "");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor(payload.length * 3 / 4) - padding <= RETURN_EVIDENCE_MAX_BYTES;
}
import {
  normalizeHeavyEquipmentRecord,
  normalizeHeavyEquipmentLoan,
  heavyEquipmentQuantityBalance,
  getHeavyEquipmentLoanRemainingQuantity,
  getHeavyEquipmentUptId,
  getHeavyEquipmentLoanOwnerUptId,
  normalizeHeavyEquipmentUptName,
  isPendingHeavyEquipmentLoan,
  isActiveHeavyEquipmentLoan,
  getHeavyEquipmentLoanRuntimeStatus,
  canApproveHeavyEquipmentLoan,
  canCompleteHeavyEquipmentLoan,
} from "../lib/heavyEquipment.js";
import { getHeavyEquipmentUploadErrorMessage, getHeavyEquipmentProcessingErrorMessage } from "../lib/heavyEquipmentPhoto.js";

function readCachedList(key) {
  try { return JSON.parse(localStorage.getItem('warnoto_' + key) || "null"); } catch { return null; }
}

const SURAT_IZIN_MIME_EXT = { "application/pdf":"pdf", "image/jpeg":"jpg", "image/jpg":"jpg", "image/png":"png", "image/webp":"webp" };
function extFromDataUrl(dataUrl) {
  const mime = String(dataUrl).match(/^data:([^;]+);/)?.[1] || "";
  return SURAT_IZIN_MIME_EXT[mime] || null;
}

// Upload dokumen surat izin (PDF atau foto) ke Storage → URL publik. PDF diupload
// mentah (compressImage akan merusak file non-image), foto dikompres sama seperti
// foto alat. Dipakai saveHeavyEquipmentEdit & createHeavyEquipment.
async function uploadSuratIzin(dataUrl, equipmentId, showToast) {
  const ext = extFromDataUrl(dataUrl);
  if (!ext) { showToast("Format surat izin tidak didukung. Gunakan PDF, JPG, PNG, atau WebP.", "error"); return { ok:false }; }
  let toUpload = dataUrl;
  if (ext !== "pdf") {
    try { toUpload = await compressImage(dataUrl, {maxBytes:1_000_000}); }
    catch (e) { showToast(getHeavyEquipmentProcessingErrorMessage(e), "error"); return { ok:false }; }
  }
  try {
    const url = await _withTimeout(uploadPhotoToStorage(toUpload, "tug-photos", `alat-berat/surat-izin/${equipmentId}.${ext}`), 30_000, "unggah surat izin");
    return { ok:true, url };
  } catch (e) {
    console.warn("Upload surat izin alat berat gagal:", equipmentId, e?.message||e);
    showToast(getHeavyEquipmentUploadErrorMessage(e), "error");
    return { ok:false };
  }
}

// Domain Alat Berat: master alat + peminjaman antar-UPT (ajukan/approve/reject/selesai).
// saveToCloud diakses lewat stateRef.current (bukan langsung sbg param) karena hook ini
// dipanggil sebelum saveToCloud (useCallback) didefinisikan di PLNWarehouse — stateRef.current.saveToCloud
// diisi belakangan (lihat App.jsx setelah definisi saveToCloud), sama pola dgn stateRef utk data state.
export function useHeavyEquipment({ currentUser, uptList, showToast, stateRef, supabaseClient }) {
  const [heavyEquipmentList, setHeavyEquipmentList] = useState(() => readCachedList("pln_heavy_equipment_v1") ?? []);
  const [heavyEquipmentLoans, setHeavyEquipmentLoans] = useState(() => readCachedList("pln_heavy_equipment_loans_v1") ?? []);

  async function saveHeavyEquipmentEdit(equipmentId, updates) {
    if (currentUser?.role !== "TL") { showToast("Hanya TL yang bisa mengubah registry alat.","error"); return false; }
    const alat = heavyEquipmentList.find(eq=>eq.id===equipmentId);
    if (!alat) return false;
    const ownerUptId = getHeavyEquipmentUptId(alat, uptList);
    const ownsLegacy = !ownerUptId && currentUser?.uptId && normalizeHeavyEquipmentUptName(alat.upt) === normalizeHeavyEquipmentUptName(currentUser.upt);
    if ((!ownerUptId || ownerUptId !== currentUser?.uptId) && !ownsLegacy) { showToast("Alat berada di luar UPT akun.", "error"); return false; }
    if (["MAINTENANCE","KIR"].includes(updates.statusAlat) && alat.availabilityStatus==="DIPINJAM") {
      showToast("Alat sedang dipinjam, tidak bisa diubah ke status ini.","error"); return false;
    }
    // Foto ke Storage dulu (pola sama dengan Data Stok — JANGAN base64 mentah masuk
    // jsonb heavy_equipment.data, cegah pola insiden 2026-07-23 & 2026-07-28 terulang
    // di tabel lain). Bucket reuse "tug-photos" (sudah publik), folder alat-berat/.
    const canEditAllHeavyEquipment = currentUser?.role === "TL";
    // Jangan menyebarkan properti yang tidak memiliki input (id, availabilityStatus,
    // metadata audit, dst.) ketika Admin membuka form lengkap. Untuk TL, payload
    // sengaja hanya dua field yang memang diizinkan.
    const editableFields = ["upt","gudangId","lokasi","nama","jenis","merkType","kapasitas","nomorSeri","tahun","kondisi","suratIzinAlat","statusAlat","kategori","tracked","assetType","isCrossUptBorrowable","trackingMode","quantityTotal","unit","specification"];
    let upd = canEditAllHeavyEquipment
      ? Object.fromEntries(editableFields.map(key => [key, updates[key] ?? alat[key] ?? ""]))
      : { statusAlat: updates.statusAlat ?? alat.statusAlat };
    // URL lama bukan perubahan foto. Ini menghindari metadata foto berubah hanya
    // karena TL/Admin membuka lalu menyimpan status alat.
    const needsPhotoStorage = _isDataUrl(updates.foto);
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
    if (_isDataUrl(upd.suratIzinAlat)) {
      const result = await uploadSuratIzin(upd.suratIzinAlat, equipmentId, showToast);
      if (!result.ok) return false;
      upd = { ...upd, suratIzinAlat: result.url };
    }
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
    if (currentUser?.role !== "TL") { showToast("Hanya TL yang bisa menambah alat.", "error"); return false; }
    const uptId = currentUser?.uptId || form?.uptId;
    const uptName = uptList.find(u => u.id === uptId)?.nama?.replace(/^UPT\s+/i, "") || form?.upt;
    if (!uptId || !uptName || !form?.nama?.trim() || !form?.lokasi?.trim()) { showToast("UPT, nama, dan lokasi wajib diisi.", "error"); return false; }
    if (form?.trackingMode === "QUANTITY" && (!Number.isInteger(Number(form.quantityTotal)) || Number(form.quantityTotal) < 1)) { showToast("Jumlah awal pool wajib berupa bilangan bulat positif.", "error"); return false; }
    const now = Date.now();
    let item = normalizeHeavyEquipmentRecord({ ...form, uptId, upt:uptName, id:`HE-${uid().slice(-8)}`, availabilityStatus:"TERSEDIA", createdAt:now, createdBy:currentUser.id, updatedAt:now, updatedBy:currentUser.id, source:"Input TL UPT" });
    if (_isDataUrl(item.foto)) {
      let compressedPhoto;
      try { compressedPhoto = await compressImage(item.foto, {maxBytes:1_000_000}); }
      catch (e) { showToast(getHeavyEquipmentProcessingErrorMessage(e), "error"); return false; }
      try { item = { ...item, foto: await _withTimeout(uploadPhotoToStorage(compressedPhoto, "tug-photos", `alat-berat/${item.id}.jpg`), 30_000, "unggah foto") }; }
      catch (e) { console.warn("Upload foto alat berat gagal:", item.id, e?.message||e); showToast(getHeavyEquipmentUploadErrorMessage(e), "error"); return false; }
    }
    if (_isDataUrl(item.suratIzinAlat)) {
      const result = await uploadSuratIzin(item.suratIzinAlat, item.id, showToast);
      if (!result.ok) return false;
      item = { ...item, suratIzinAlat: result.url };
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
    const isHarUit = currentUser?.role === "HAR_UIT";
    if (!isHarUit && currentUser?.role !== "TL") { showToast("Hanya TL UPT pemilik atau HAR UIT yang bisa mencatat peminjaman alat.","error"); return false; }
    if (isHarUit && !currentUser?.uitId) { showToast("Akun HAR UIT belum memiliki UIT. Hubungi administrator.", "error"); return false; }
    const equipmentIds = [...new Set(form?.equipmentIds || (form?.equipmentId ? [form.equipmentId] : []))];
    if (!equipmentIds.length || !form.namaPekerjaan?.trim() || !form.tanggalAmbil || !form.tanggalKembali || !form.keperluan?.trim()) {
      showToast("Lengkapi alat, nama pekerjaan, tanggal, dan keperluan.","error"); return false;
    }
    if (form.tanggalKembali < form.tanggalAmbil) { showToast("Tanggal kembali tidak boleh sebelum tanggal ambil.", "error"); return false; }
    const assets = equipmentIds.map(id => heavyEquipmentList.find(eq => eq.id === id));
    if (assets.some(eq => !eq)) { showToast("Ada alat yang tidak ditemukan.", "error"); return false; }
    const ownerIds = [...new Set(assets.map(eq => getHeavyEquipmentUptId(eq, uptList) || (normalizeHeavyEquipmentUptName(eq.upt) === normalizeHeavyEquipmentUptName(currentUser?.upt) ? currentUser?.uptId : null)).filter(Boolean))];
    if (ownerIds.length !== 1) { showToast("Semua alat dalam satu transaksi harus milik UPT yang sama.", "error"); return false; }
    if (!isHarUit && ownerIds[0] !== currentUser?.uptId) { showToast("Peminjaman hanya dapat dicatat oleh TL UPT pemilik alat.", "error"); return false; }
    if (isHarUit) {
      const owner = uptList.find(u => u.id === ownerIds[0]);
      if (!owner || owner.uitId !== currentUser.uitId) { showToast("UPT pemilik berada di luar UIT akun.", "error"); return false; }
    }
    const hasQuantityPool = assets.some(eq => normalizeHeavyEquipmentRecord(eq).trackingMode === "QUANTITY");
    const quantities = Object.fromEntries(assets.map(eq => {
      const raw = form.quantities?.[eq.id] ?? form.quantityByEquipmentId?.[eq.id] ?? form.quantity ?? 1;
      return [eq.id, Number(raw)];
    }));
    if (assets.some(eq => ["MAINTENANCE", "KIR"].includes(eq.statusAlat))) {
      showToast("Ada alat yang tidak tersedia untuk dipinjam.", "error"); return false;
    }
    if (hasQuantityPool) {
      const invalidQuantity = assets.some(eq => {
        const normalized = normalizeHeavyEquipmentRecord(eq);
        const quantity = quantities[eq.id];
        if (!Number.isInteger(quantity) || quantity < 1) return true;
        if (normalized.trackingMode === "UNIT" && quantity !== 1) return true;
        return normalized.trackingMode === "QUANTITY" && quantity > heavyEquipmentQuantityBalance(normalized, heavyEquipmentLoans).available;
      });
      if (invalidQuantity) { showToast("Jumlah pinjaman melebihi saldo tersedia.", "error"); return false; }
    } else if (assets.some(eq => eq.availabilityStatus === "DIPINJAM" || heavyEquipmentLoans.some(l => l.equipmentId === eq.id && isActiveHeavyEquipmentLoan(l)))) {
      showToast("Ada alat yang tidak tersedia untuk dipinjam.", "error"); return false;
    }
    const borrowerType = isHarUit ? "HAR_UIT" : (form.borrowerType || "UPT");
    const requesterUptId = borrowerType === "UPT" ? form.requesterUptId : null;
    if (borrowerType === "HAR_UIT" && assets.some(eq => !eq.isCrossUptBorrowable)) { showToast("Ada alat yang belum diizinkan untuk peminjaman lintas-UPT.", "error"); return false; }
    if (borrowerType === "UPT" && (!requesterUptId || requesterUptId === ownerIds[0])) { showToast("Pilih UPT peminjam yang berbeda dari pemilik alat.", "error"); return false; }
    if (borrowerType === "UPT" && assets.some(eq => !eq.isCrossUptBorrowable)) { showToast("Ada alat yang belum diizinkan untuk peminjaman lintas-UPT.", "error"); return false; }
    if (borrowerType !== "UPT" && borrowerType !== "HAR_UIT" && (!form.borrowerName?.trim() || !form.borrowerPic?.trim() || !form.borrowerContact?.trim())) { showToast("Nama organisasi, PIC, dan kontak wajib diisi.", "error"); return false; }
    if (borrowerType === "HAR_UIT" && (!form.borrowerPic?.trim() || !form.borrowerContact?.trim())) { showToast("PIC dan kontak HAR UIT wajib diisi.", "error"); return false; }
    if (!supabaseClient?.rpc) { showToast("Server peminjaman alat belum tersedia.", "error"); return false; }
    const batchId = `HE-BATCH-${uid().slice(-12)}`;
    const evidence = isHarUit
      ? (form.loanLetter || form.suratPeminjaman || form.pickupEvidence || form.fotoKeluar)
      : (form.pickupEvidence || form.fotoKeluar);
    if (!isHarUit && !evidence) { showToast("Foto serah-terima wajib diunggah.", "error"); return false; }
    let evidencePath = null;
    try {
      if (evidence) {
        const extension = isHarUit ? extFromDataUrl(evidence) : "jpg";
        if (isHarUit && !extension) { showToast("Format surat tidak didukung. Gunakan PDF, JPG, PNG, atau WebP.", "error"); return false; }
        evidencePath = `${ownerIds[0]}/${batchId}/${isHarUit ? "loan-letter" : "pickup"}.${extension}`;
        const uploadData = isHarUit && extension === "pdf" ? evidence : await compressImage(evidence, { maxBytes: 1_000_000 });
        await _withTimeout(uploadPhotoToStorage(uploadData, "heavy-equipment-evidence", evidencePath, { upsert:false }), 30_000, isHarUit ? "unggah surat peminjaman" : "unggah bukti serah-terima");
      }
      const borrower = { borrowerType, borrowerName: isHarUit ? (form.borrowerName || `HAR UIT ${currentUser.uitId}`) : (form.borrowerName || form.requesterUpt || ""), borrowerRefId: requesterUptId, borrowerUitId: isHarUit ? currentUser.uitId : null, borrowerPic: form.borrowerPic || "", borrowerContact: form.borrowerContact || "" };
      const job = { batchId, namaPekerjaan: form.namaPekerjaan.trim(), tanggalAmbil: form.tanggalAmbil, tanggalKembali: form.tanggalKembali, keperluan: form.keperluan.trim(), catatan: form.catatan || "", requestedBy: currentUser.id };
      const rpcName = hasQuantityPool ? "checkout_heavy_equipment_batch_v2" : "checkout_heavy_equipment_batch";
      const rpcArgs = hasQuantityPool
        ? { p_items: equipmentIds.map(equipmentId => ({ equipmentId, quantity: quantities[equipmentId] })), p_borrower: borrower, p_job: job, p_pickup_evidence_path: evidencePath }
        : { p_equipment_ids: equipmentIds, p_borrower: borrower, p_job: job, p_pickup_evidence_path: evidencePath };
      const { data, error } = await supabaseClient.rpc(rpcName, rpcArgs);
      if (error || !data?.batchId) throw error || new Error("Respons server tidak lengkap.");
      const returnedLoans = Array.isArray(data.loans) ? data.loans.map(normalizeHeavyEquipmentLoan) : [];
      const returnedEquipment = Array.isArray(data.equipment) ? data.equipment : [];
      setHeavyEquipmentLoans(prev => [...returnedLoans, ...prev.filter(l => !returnedLoans.some(row => row.id === l.id))]);
      if (returnedEquipment.length) setHeavyEquipmentList(prev => prev.map(eq => returnedEquipment.find(row => row.id === eq.id) || eq));
      showToast(borrowerType === "UPT" || borrowerType === "HAR_UIT" ? "Peminjaman tercatat. Menunggu approval Asman pemilik." : "Peminjaman alat tercatat.");
      return true;
    } catch (e) {
      if (evidencePath) await supabaseClient.storage?.from("heavy-equipment-evidence").remove([evidencePath]).catch(() => {});
      showToast(`Gagal menyimpan peminjaman: ${e?.message || "server tidak dapat dihubungi."}`, "error");
      return false;
    }
  }

  async function approveHeavyEquipmentLoan(loanId, catatan="") {
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !isPendingHeavyEquipmentLoan(loan)) return;
    if (!canApproveHeavyEquipmentLoan(currentUser, loan, uptList)) { showToast("Hanya Asman UPT pemilik alat yang bisa approve peminjaman ini.","error"); return; }
    const alatCek = heavyEquipmentList.find(eq => eq.id === loan.equipmentId);
    const isQuantityPool = normalizeHeavyEquipmentRecord(alatCek || {}).trackingMode === "QUANTITY";
    const bentrok = !isQuantityPool && heavyEquipmentLoans.some(l => l.id !== loanId && l.equipmentId === loan.equipmentId && isActiveHeavyEquipmentLoan(l));
    if (bentrok || (!isQuantityPool && alatCek?.availabilityStatus === "DIPINJAM" && alatCek?.activeLoanId && alatCek.activeLoanId !== loanId)) { showToast("Alat sudah terkait peminjaman lain, tidak bisa disetujui.","error"); return false; }
    if (!supabaseClient?.rpc) { showToast("Server approval peminjaman belum tersedia.", "error"); return false; }
    const { data, error } = await supabaseClient.rpc("approve_heavy_equipment_batch", { p_loan_id: loanId, p_decision: "APPROVED", p_catatan: catatan || null });
    if (error || !data?.loans) { showToast(`Gagal menyetujui peminjaman: ${error?.message || "respons server tidak lengkap."}`, "error"); return false; }
    const rows = Array.isArray(data.loans) ? data.loans : [];
    setHeavyEquipmentLoans(prev => prev.map(l => rows.find(row => row.id === l.id) || l));
    if (Array.isArray(data.equipment)) setHeavyEquipmentList(prev => prev.map(eq => data.equipment.find(row => row.id === eq.id) || eq));
    showToast("Peminjaman alat disetujui.");
    return true;
  }

  async function rejectHeavyEquipmentLoan(loanId, reason) {
    if (!reason?.trim()) { showToast("Masukkan alasan penolakan.","error"); return; }
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !isPendingHeavyEquipmentLoan(loan)) return;
    if (!canApproveHeavyEquipmentLoan(currentUser, loan, uptList)) { showToast("Hanya Asman UPT pemilik alat yang bisa menolak peminjaman ini.","error"); return; }
    if (!supabaseClient?.rpc) { showToast("Server approval peminjaman belum tersedia.", "error"); return false; }
    const { data, error } = await supabaseClient.rpc("approve_heavy_equipment_batch", { p_loan_id: loanId, p_decision: "REJECTED", p_catatan: reason.trim() });
    if (error || !data?.loans) { showToast(`Gagal menolak peminjaman: ${error?.message || "respons server tidak lengkap."}`, "error"); return false; }
    const rows = Array.isArray(data.loans) ? data.loans : [];
    setHeavyEquipmentLoans(prev => prev.map(l => rows.find(row => row.id === l.id) || l));
    if (Array.isArray(data.equipment)) setHeavyEquipmentList(prev => prev.map(eq => data.equipment.find(row => row.id === eq.id) || eq));
    showToast("Peminjaman alat ditolak.", "error");
    return true;
  }

  async function completeHeavyEquipmentLoan(loanId, returnForm = {}) {
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !["DIPINJAM","OVERDUE"].includes(getHeavyEquipmentLoanRuntimeStatus(loan))) return false;
    if (!canCompleteHeavyEquipmentLoan(currentUser, loan, uptList)) { showToast("Hanya TL UPT pemilik alat yang bisa menandai alat kembali.","error"); return false; }
    if (!supabaseClient?.rpc) { showToast("Server pengembalian alat belum tersedia.", "error"); return false; }
    const evidence = returnForm.returnEvidence || returnForm.fotoKembali;
    if (!evidence) { showToast("Foto pengembalian wajib diunggah.", "error"); return false; }
    const ownerId = getHeavyEquipmentLoanOwnerUptId(loan, uptList) || currentUser?.uptId;
    if (!ownerId) { showToast("UPT pemilik alat tidak ditemukan. Muat ulang data lalu coba lagi.", "error"); return false; }
    const evidencePath = `${ownerId}/${loan.loanBatchId || loan.data?.loanBatchId || loanId}/return-${loanId}-${uid().slice(-10)}.jpg`;
    try {
      returnForm.onProgress?.("Menyiapkan bukti pengembalian…");
      const uploadEvidence = isSmallJpegDataUrl(evidence)
        ? evidence
        : await compressImage(evidence, { maxBytes: RETURN_EVIDENCE_MAX_BYTES });
      returnForm.onProgress?.("Mengunggah bukti pengembalian…");
      await _withTimeout(uploadPhotoToStorage(uploadEvidence, "heavy-equipment-evidence", evidencePath, { upsert:false }), 30_000, "unggah bukti pengembalian");
      const equipment = heavyEquipmentList.find(eq => eq.id === loan.equipmentId);
      const isQuantityLoan = normalizeHeavyEquipmentRecord(equipment || {}).trackingMode === "QUANTITY" || Number(loan.quantityBorrowed || loan.quantity_borrowed) > 1;
      const remaining = getHeavyEquipmentLoanRemainingQuantity(loan);
      const good = Number(returnForm.good ?? returnForm.quantityGood ?? returnForm.quantityReturnedGood ?? (isQuantityLoan ? remaining : 1));
      const damaged = Number(returnForm.damaged ?? returnForm.quantityDamaged ?? returnForm.quantityReturnedDamaged ?? 0);
      const lost = Number(returnForm.lost ?? returnForm.quantityLost ?? returnForm.quantityReturnedLost ?? 0);
      if (![good, damaged, lost].every(Number.isInteger) || good < 0 || damaged < 0 || lost < 0 || good + damaged + lost < 1 || good + damaged + lost > remaining) {
        throw new Error("Jumlah pengembalian tidak valid atau melebihi sisa pinjaman.");
      }
      if ((damaged > 0 || lost > 0) && !returnForm.conditionNote?.trim()) throw new Error("Catatan kondisi wajib untuk barang rusak atau hilang.");
      const rpcArgs = isQuantityLoan
        ? { p_loan_id: loanId, p_good: good, p_damaged: damaged, p_lost: lost, p_return_evidence_path: evidencePath, p_condition_note: returnForm.conditionNote || "" }
        : { p_loan_ids: [loanId], p_return_evidence_path: evidencePath, p_condition_note: returnForm.conditionNote || "" };
      returnForm.onProgress?.("Menyimpan pengembalian ke server…");
      const { data, error } = await _withTimeout(
        isQuantityLoan
          ? supabaseClient.rpc("complete_heavy_equipment_quantity_loan", rpcArgs)
          : supabaseClient.rpc("complete_heavy_equipment_batch", rpcArgs),
        30_000,
        "simpan pengembalian alat"
      );
      if (error || (isQuantityLoan ? !data?.loan : !data?.loans)) throw error || new Error("Respons server tidak lengkap.");
      const rows = Array.isArray(data.loans) ? data.loans.map(normalizeHeavyEquipmentLoan) : (data.loan ? [normalizeHeavyEquipmentLoan(data.loan)] : []);
      setHeavyEquipmentLoans(prev => prev.map(l => rows.find(row => row.id === l.id) || l));
      const returnedEquipment = Array.isArray(data.equipment) ? data.equipment : (data.equipment ? [data.equipment] : []);
      if (returnedEquipment.length) setHeavyEquipmentList(prev => prev.map(eq => returnedEquipment.find(row => row.id === eq.id) || eq));
      showToast("Alat ditandai sudah kembali.");
      return true;
    } catch (rpcError) {
      void supabaseClient.storage?.from("heavy-equipment-evidence").remove([evidencePath]).catch(() => {});
      showToast(`Gagal menandai alat kembali: ${rpcError?.message || "Server tidak dapat dihubungi."}`, "error");
      return false;
    }
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
