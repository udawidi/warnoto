import { useState, useRef } from "react";
import { hasRole, ROLES } from "../lib/roles.js";
import { can } from "../lib/perms.js";
import { isDemoMode } from "../lib/demo.js";
import { logAudit } from "../lib/audit.js";
import { generateDocNumbers, generateReservasiDocNo, uid } from "../lib/utils.js";
import { processTxnPhotos, _isDataUrl } from "../lib/supabaseSync.js";
import { createAndSubmitCanonicalTug, amendCanonicalTug, newCanonicalActionKeys } from "../lib/tugCanonical.js";
import { upsertTug3Transaction, deleteTug3Transaction } from "../lib/tug3Sync.js";
import { upsertTug10Transaction, deleteTug10Transaction } from "../lib/tug10Sync.js";
import { STATUS_SAP } from "../constants.js";
import { nextSafeDocSeq } from "../lib/docSeqGuard.js";

const CANONICAL_TUG_REQUIRED = import.meta.env.VITE_TUG_CANONICAL_REQUIRED !== "false";

// Field wajib saat "Ajukan ke TL" TUG-3 (Simpan Draft boleh belum lengkap). Amandemen &
// semua foto lampiran (diisi di TUG-4) sengaja TIDAK wajib. Dipakai jalur form (saveTxn)
// & jalur cepat dari kartu draft (submitDraftTug3) — satu sumber, jangan duplikasi.
function tug3MissingForSubmit(tf) {
  const missing = [];
  if (!tf.dariSupplier?.trim()) missing.push("Dari (Supplier)");
  if (!tf.tanggalDiterima) missing.push("Tanggal Diterima");
  if (!tf.denganKirim?.trim()) missing.push("Dengan");
  if (!tf.noSuratJalan?.trim()) missing.push("No. Surat Jalan");
  if (!tf.tglSuratJalan) missing.push("Tgl. Surat Jalan");
  if (!tf.suratPesananNo?.trim()) missing.push("No. Surat Pesanan");
  if (!tf.suratPesananTgl) missing.push("Tgl. Surat Pesanan");
  if (!tf.keteranganTug3?.trim()) missing.push("Keterangan");
  if (!tf.gudangTujuanId) missing.push("Gudang Tujuan");
  (tf.stockItems||[]).forEach((si,idx)=>{
    const n = idx+1;
    const barangOk = si.katalogMode==="existing" ? !!si.katalogId : !!(si.namaBaru?.trim() && si.katalogBaru?.trim() && si.satuanBaru?.trim());
    if (!barangOk) missing.push(`Barang #${n}: pilih/isi barang`);
    if (!(si.qty > 0)) missing.push(`Barang #${n}: jumlah`);
    if (si.hargaSatuan===undefined || si.hargaSatuan===null || si.hargaSatuan==="") missing.push(`Barang #${n}: harga satuan`);
    if (!si.lokasiTujuanId) missing.push(`Barang #${n}: lokasi tujuan`);
  });
  return missing;
}

// Domain: form & commit transaksi TUG (sisi "buat") — buka form (openNewTxn),
// tambah/hapus/ubah baris material (stockItems), validasi per docType, dan
// commitNewTxn yang menulis transaksi baru (Barang Masuk/Keluar/Minta Barang).
// Murni relokasi dari PLNWarehouse() (App.jsx), TANPA perubahan logic.
//
// enrichedStocks (dihitung belakangan di App.jsx, setelah stocks/katalogList/
// lokasiList) dan submitDraftTug9 (dari useTugApprovals, dipanggil belakangan
// karena butuh commitNewTxn dari hook ini) diakses lewat stateRef.current —
// pola sama dengan useHeavyEquipment.js (stateRef.current.saveToCloud dst).
export function useTugTransactions({
  currentUser, showToast, rolePerms,
  txns, setTxns, stocks, setStocks, katalogList, setKatalogList,
  docSeq, setDocSeq,
  uitList, uptList, ultgList, currentUserUptId,
  saveToCloud,
  canonicalActionKeysRef,
  stateRef,
  lokasiList, gudangList, opnameList,
}) {
  const [txnModal, setTxnModal] = useState(false);
  const [txnForm, setTxnForm] = useState(null);
  const [editingDraftTxnId, setEditingDraftTxnId] = useState(null); // non-null = sedang edit draft TUG-9 hasil adopt ULTG
  const editingTxnRef = useRef(null); // txn asli yang sedang diedit (dipakai saveTxn cek .canonical utk routing amend)
  const [tugGroup, setTugGroup] = useState("penerimaan");
  const [tug5ExpandedIdx, setTug5ExpandedIdx] = useState(0); // index baris material TUG-5 yang sedang terbuka penuh (baris lain collapse)
  const [tug5MaterialPage, setTug5MaterialPage] = useState(0); // 5 item per halaman, max 10 (2 halaman)
  const [tug3ExpandedIdx, setTug3ExpandedIdx] = useState(0); // index baris barang TUG-3 yang sedang terbuka penuh (baris lain collapse), pola sama tug5ExpandedIdx
  const savingTxnRef = useRef(false); // cegah double-submit transaksi saat upload foto berjalan
  const [savingTxn, setSavingTxn] = useState(false); // mirror React untuk tombol Ajukan (disabled + "Menyimpan...")
  const [savingInfo, setSavingInfo] = useState(null); // {label, done, total} — overlay progres simpan transaksi
  const [tug10Collapsed, setTug10Collapsed] = useState({}); // {idx:true} kartu barang retur yang diringkas
  const [tug98Collapsed, setTug98Collapsed] = useState({}); // {idx:true} baris barang TUG-8/9 yang diringkas, pola sama tug10Collapsed
  const [tug10Highlight, setTug10Highlight] = useState(null); // key field yang di-highlight setelah gagal validasi
  const tug10Refs = useRef({}); // anchor scroll per seksi/field TUG-10

  function setMaterialPhoto(stockId, dataUrl) {
    setTxnForm(tf => {
      const existing = tf.fotoMaterial.filter(fm => fm.stockId !== stockId);
      return { ...tf, fotoMaterial: [...existing, { stockId, img: dataUrl }] };
    });
  }
  function handleMaterialImg(e, stockId) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => setMaterialPhoto(stockId, ev.target.result); r.readAsDataURL(f);
  }

  // ── Transaction (TUG-9) ──
  function openNewTxn(docType = "TUG9") {
    const canonicalUptId = currentUserUptId || currentUser?.uptId || "";
    const base = {
      docType,
      pekerjaan: "", namaPekerjaan: "", lokasiPekerjaan: "",
      perkiraanPembebanan: "", kodePerkiraan: "",
      stockItems: [{ stockId: "", qty: 1 }],
      keteranganBarang: "",
    };
    if (docType === "TUG9") {
      setTxnForm({
        ...base,
        uptId: canonicalUptId,
        gudangId: "",
        noNodin: "", noPersetujuan: "",
        nopol: "", simKtp: "", namaPengemudi: "",
        penerimaNama: "", penerimaJabatan: "", penerimaUnit: "",
        satpamId: "",
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null,
        fotoMaterial: [],
      });
    } else if (docType === "TUG8") {
      setTxnForm({
        ...base,
        uptId: canonicalUptId,
        gudangId: "",
        unitTujuan: "",
        noNodin: "", noPersetujuan: "",
        nopol: "", simKtp: "", namaPengemudi: "",
        penerimaNama: "", penerimaJabatan: "", penerimaUnit: "",
        satpamId: "",
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null,
        fotoMaterial: [],
      });
    } else if (docType === "TUG10") {
      setTxnForm({
        ...base,
        uptId: canonicalUptId,
        stockItems: [{ katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, statusMaterial:"Material Sisa Baru", noAsset:"", noSeri:"", fotoNameplate:null, fotoBarangRetur:null }],
        noBAPenggantian: "",
        // For TUG10 the flow is reversed: external party hands back to PLN
        menyerahkanUnit: "", menyerahkanNama: "",
        gudangTujuanId: "", subGudangTujuanId: "", // cascade Gudang → Sub Gudang → Blok
        lokasiTujuanId: "", // which Master Lokasi (Blok) the returned items go into
        satpamId: "", // satpam gudang penyimpanan (Mengetahui di dokumen)
        fotoBAPengembalian: null,
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null,
      });
    } else if (docType === "TUG3") {
      setTug3ExpandedIdx(0);
      setTxnForm({
        ...base,
        uptId: canonicalUptId,
        stockItems: [{ katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, hargaSatuan:0, lokasiTujuanId:"", sapStatus:STATUS_SAP[0] }],
        gudangTujuanId: "", // scope Lokasi Tujuan per-item ke gudang ini
        tanggalDiterima: "", dariSupplier: "", denganKirim: "Dikirim Langsung",
        noSuratJalan: "", tglSuratJalan: "",
        judulKontrak: "",
        suratPesananNo: "", suratPesananTgl: "",
        amandemenNo: "", amandemenTgl: "",
        keteranganTug3: "Baik",
        timMutuId: "",
        lokasiPenyerahan: "",
        hasilPemeriksaan: "Barang Diterima Sesuai Pengadaan",
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratJalanImg: null, fotoKontrak: null,
        fotoMaterial: [],
      });
    } else if (docType === "TUG5") {
      setTug5ExpandedIdx(0); setTug5MaterialPage(0);
      if (hasRole(currentUser, "ADMIN_ULTG")) {
        // TUG-5 dari ULTG: tujuan implisit = UPT induk ULTG-nya, tidak perlu pilih UIT/jenis transfer
        setTxnForm({
          ...base,
          sourceType: "ULTG",
          ultgId: currentUser.ultgId || "",
          lokasiPekerjaan: "",
          keteranganUmum: "",
          perintahKerja: "", kodePerkiraan: "", fungsi: "",
          stockItems: [{ katalogId:"", pemakaianBulan:0, sisaPersediaan:0, permintaan:1, keterangan:"" }],
        });
      } else {
        setTxnForm({
          ...base,
          // TUG-5 header
          uitId: uitList[0]?.id || "",       // Kepada: UIT tujuan
          jenisTransfer: "INTRACOMPANY",     // INTRACOMPANY | INTERCOMPANY
          keteranganUmum: "",
          perintahKerja: "", kodePerkiraan: "", fungsi: "",
          // Per-item fields for TUG-5 tabel
          stockItems: [{ katalogId:"", pemakaianBulan:0, sisaPersediaan:0, permintaan:1, keterangan:"" }],
        });
      }
    }
    setTxnModal(true);
  }
  function addItemRow() {
    if (txnForm.docType === "TUG5" && txnForm.stockItems.length >= 10) {
      showToast("Maksimal 10 item material per TUG-5.","error");
      return;
    }
    if (txnForm.docType === "TUG5") {
      const newIdx = txnForm.stockItems.length;
      setTug5ExpandedIdx(newIdx);
      setTug5MaterialPage(Math.floor(newIdx/5));
    }
    if (txnForm.docType === "TUG3") {
      setTug3ExpandedIdx(txnForm.stockItems.length);
    }
    setTxnForm(tf => {
      if (tf.docType === "TUG10") {
        return { ...tf, stockItems: [...tf.stockItems, { katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, statusMaterial:"Material Sisa Baru", noAsset:"", noSeri:"", fotoNameplate:null, fotoBarangRetur:null }] };
      }
      if (tf.docType === "TUG5") {
        return { ...tf, stockItems: [...tf.stockItems, { katalogId:"", pemakaianBulan:0, sisaPersediaan:0, permintaan:1, keterangan:"" }] };
      }
      if (tf.docType === "TUG3") {
        return { ...tf, stockItems: [...tf.stockItems, { katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, hargaSatuan:0, lokasiTujuanId:"", sapStatus:STATUS_SAP[0] }] };
      }
      return { ...tf, stockItems: [...tf.stockItems, { stockId:"", qty:1 }] };
    });
  }
  function removeItemRow(i) { setTug10Collapsed({}); setTxnForm(tf => ({ ...tf, stockItems: tf.stockItems.filter((_,idx)=>idx!==i) })); }
  function updateItemRow(i, key, val) {
    setTxnForm(tf => {
      const items=[...tf.stockItems];
      items[i] = {...items[i], [key]: val};
      // TUG-5 dari ULTG: begitu pilih katalog, auto-isi Sisa Persediaan dari total stok aktual UPT
      // (dijumlah lintas gudang/lokasi) — ULTG tidak punya stok sendiri untuk diketik manual.
      if (tf.docType==="TUG5" && tf.sourceType==="ULTG" && key==="katalogId") {
        const totalQty = stateRef.current.enrichedStocks.filter(s=>s.katalogId===val).reduce((a,s)=>a+(s.qty||0),0);
        items[i].sisaPersediaan = totalQty;
      }
      return {...tf, stockItems: items};
    });
  }

  // Daftar syarat TUG-10 yang belum terpenuhi (dipakai checklist live + validasi submit).
  // Tiap entri punya scrollKey (anchor di tug10Refs) supaya bisa di-scroll & di-highlight.
  function tug10Missing(tf) {
    if (!tf) return [];
    const m = [];
    if (!tf.namaPekerjaan?.trim()) m.push({ scrollKey:"namaPekerjaan", label:"Nama Pekerjaan" });
    if (!tf.lokasiPekerjaan?.trim()) m.push({ scrollKey:"lokasiPekerjaan", label:"Lokasi Pekerjaan" });
    if (!tf.menyerahkanUnit?.trim()) m.push({ scrollKey:"menyerahkanUnit", label:"PT / Perusahaan Pengirim" });
    if (!tf.menyerahkanNama?.trim()) m.push({ scrollKey:"menyerahkanNama", label:"Nama Penyerah" });
    if (!tf.lokasiTujuanId) m.push({ scrollKey:"lokasiTujuanId", label:"Lokasi Penyimpanan (Blok)" });
    (tf.stockItems||[]).forEach((si,idx)=>{
      const n = idx+1;
      const barangOk = si.katalogMode==="existing" ? !!si.katalogId : !!si.namaBaru?.trim();
      if (!barangOk) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: pilih/nama barang` });
      if (!(si.qty>0)) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: jumlah` });
      if (!si.fotoBarangRetur) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: foto barang` });
      if (si.statusMaterial==="Bongkaran ATTB (MTU)") {
        if (!si.noSeri?.trim()) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: nomor seri (ATTB)` });
        if (!si.fotoNameplate) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: foto nameplate (ATTB)` });
      }
    });
    if ((tf.stockItems||[]).some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && !tf.fotoBAPengembalian) {
      m.push({ scrollKey:"fotoBAPengembalian", label:"Foto Surat BA Pengembalian (ada item ATTB)" });
    }
    return m;
  }
  function flagTug10Invalid(key) {
    if (!key) return;
    if (key.startsWith("item-")) { const idx = Number(key.split("-")[1]); setTug10Collapsed(c=>({...c,[idx]:false})); }
    setTug10Highlight(key);
    setTimeout(()=>{ tug10Refs.current[key]?.scrollIntoView({ behavior:"smooth", block:"center" }); }, 60);
    setTimeout(()=> setTug10Highlight(h=> h===key?null:h), 3000);
  }

  async function saveTxn(targetStage) {
    if (savingTxn) { showToast("Sedang menyimpan, tunggu sebentar...","info"); return; }
    const canCreateULTG = hasRole(currentUser, "ADMIN_ULTG") && txnForm?.docType==="TUG5";
    // Bypass "aksi.buatTransaksi" hanya utk edit yang sah: pembuat asli mengedit
    // draftnya sendiri, ATAU TL/SUPERADMIN memperbaiki ajuan PENDING (amend).
    const isOwnerEdit = !!editingDraftTxnId && editingTxnRef.current?.createdBy === currentUser.id;
    const isTLAmendEdit = !!editingDraftTxnId && hasRole(currentUser, "TL", "SUPERADMIN");
    if (!can(currentUser, "aksi.buatTransaksi", rolePerms) && !canCreateULTG && !isOwnerEdit && !isTLAmendEdit) { showToast("Role kamu tidak dapat mengajukan transaksi!","error"); return; }
    const docType = txnForm.docType;

    if (docType !== "TUG3" && docType !== "TUG10") {
      if (!txnForm.namaPekerjaan.trim()) { showToast("Nama Pekerjaan wajib diisi!","error"); return; }
      if (!txnForm.lokasiPekerjaan.trim()) { showToast("Lokasi Pekerjaan wajib diisi!","error"); return; }
    }

    if (docType === "TUG9" || docType === "TUG8") {
      if (targetStage === "DRAFT") {
        // Draft: simpan apa adanya (boleh belum lengkap) ke blob lokal, TIDAK ke server
        // canonical — pola sama draft TUG-3/10.
        await commitNewTxn(docType, { ...txnForm }, { targetStage: "DRAFT", replaceDraftId: editingDraftTxnId });
        return;
      }
      // Canonical TUG8/9 (tugCanonical.js) selalu menulis ke RPC server sungguhan,
      // tidak ada jalur simulasi mode demo untuk dokumen resmi ini — blokir di sini
      // (pola sama dengan larangan mode demo lain di file ini) daripada diam-diam
      // menulis data uji ke server produksi.
      if (isDemoMode()) { showToast("Mode demo: TUG-8/TUG-9 (dokumen resmi) tidak bisa dibuat di sini — akan menulis ke server sungguhan. Nonaktifkan mode demo untuk transaksi ini.","error"); return; }
      if (!txnForm.penerimaNama.trim()) { showToast("Nama Penerima wajib diisi!","error"); return; }
      if (docType === "TUG8" && !txnForm.unitTujuan?.trim()) { showToast("Unit/Sektor Tujuan wajib diisi untuk TUG-8!","error"); return; }
      const submittedItems = txnForm.stockItems || [];
      if (submittedItems.some(si => !si.stockId || !(Number(si.qty) > 0))) {
        showToast("Setiap baris material wajib memiliki stok dan jumlah lebih dari nol.","error"); return;
      }
      const validItems = submittedItems.filter(si => si.stockId && Number(si.qty) > 0);
      if (validItems.length === 0) { showToast("Minimal 1 barang harus dipilih!","error"); return; }
      for (const si of validItems) {
        const stock = stateRef.current.enrichedStocks.find(s=>s.id===si.stockId);
        if (!stock) { showToast("Referensi stok tidak ditemukan. Pilih ulang material dari daftar stok.","error"); return; }
        if (stock && stock.jenisBarang !== "Non-Stock" && stock.qty < si.qty) {
          showToast(`Stok ${stock.name} di ${stock.lokasi} tidak cukup! Tersedia: ${stock.qty} ${stock.unit}`,"error"); return;
        }
      }
      if (editingDraftTxnId && editingTxnRef.current?.canonical) {
        // TL amend: txn sudah PENDING di server canonical, bukan draft blob lokal —
        // update in-place lewat RPC tug_amend, JANGAN commitNewTxn/submitDraftTug9
        // (keduanya akan membuat ajuan baru / menganggap ini masih draft).
        const res = await amendCanonicalTug({ txn: editingTxnRef.current, formData: { ...txnForm, stockItems: validItems }, currentUser });
        if (res.unavailable) { showToast("Perbaikan TUG-8/9 belum tersedia di server ini.","error"); return; }
        const docKey = docType === "TUG9" ? "tug9" : "tug8";
        const docNo = editingTxnRef.current.docNumbers?.[docKey] || res.data.docNumber;
        const editedId = editingDraftTxnId;
        const newTxns = txns.map(t => t.id === editedId ? { ...t, ...txnForm, stockItems: validItems, canonicalVersion: res.data.version } : t);
        setTxns(newTxns);
        setTxnModal(false); setEditingDraftTxnId(null); editingTxnRef.current = null;
        await saveToCloud({ txns: newTxns });
        logAudit(currentUser, "UPDATE", "txns", docNo, { docType });
        showToast(`✏️ ${docNo} diperbarui. Masih menunggu approval.`);
        return;
      }
      if (editingDraftTxnId) { await stateRef.current.submitDraftTug9({ ...txnForm, stockItems: validItems }); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems });
      return;
    }

    if (docType === "TUG10") {
      if (targetStage === "DRAFT") {
        // Draft: simpan apa adanya (boleh belum lengkap), tanpa validasi kelengkapan.
        await commitNewTxn(docType, { ...txnForm }, { targetStage: "DRAFT", replaceDraftId: editingDraftTxnId });
        return;
      }
      const missing = tug10Missing(txnForm);
      if (missing.length) {
        flagTug10Invalid(missing[0].scrollKey);
        showToast(`Belum lengkap — ${missing[0].label}${missing.length>1?` (dan ${missing.length-1} lainnya)`:""}`,"error");
        return;
      }
      const validItems = txnForm.stockItems.filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems }, { replaceDraftId: editingDraftTxnId });
      return;
    }

    if (docType === "TUG3") {
      // TUG-3/4 tidak punya jalur simulasi mode demo — sama seperti TUG8/9 (dokumen
      // resmi, RPC canonical/blob server sungguhan), jangan diam-diam "berhasil".
      if (isDemoMode()) { showToast("Mode demo: TUG-3 tidak disimpan ke server.","error"); return; }
      if (targetStage === "DRAFT") {
        // Draft: simpan apa adanya (boleh belum lengkap), tanpa nomor dokumen.
        await commitNewTxn(docType, { ...txnForm }, { targetStage: "DRAFT", replaceDraftId: editingDraftTxnId });
        return;
      }
      const missingTug3 = tug3MissingForSubmit(txnForm);
      if (missingTug3.length) { showToast(`Belum lengkap — ${missingTug3.join(", ")}`,"error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
      if (validItems.length === 0) { showToast("Minimal 1 barang harus diisi!","error"); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems, namaPekerjaan: txnForm.namaPekerjaan || txnForm.dariSupplier, lokasiPekerjaan: txnForm.lokasiPekerjaan || "Gudang Ketintang" }, { targetStage: "PENDING_TL", replaceDraftId: editingDraftTxnId });
      return;
    }

    if (docType === "TUG5" && txnForm.sourceType === "ULTG") {
      if (!txnForm.ultgId) { showToast("Unit ULTG kamu tidak terdeteksi. Hubungi Admin.","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.katalogId && si.permintaan > 0);
      if (validItems.length === 0) { showToast("Minimal 1 material harus diisi!","error"); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems, keteranganUmum: txnForm.namaPekerjaan }, { replaceDraftId: editingDraftTxnId });
      return;
    }

    if (docType === "TUG5") {
      if (!txnForm.uitId) { showToast("Pilih UIT tujuan (Kepada)!","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.katalogId && si.permintaan > 0);
      if (validItems.length === 0) { showToast("Minimal 1 material harus diisi!","error"); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems, namaPekerjaan: txnForm.keteranganUmum || "Permintaan Material", lokasiPekerjaan: "UPT Surabaya" }, { replaceDraftId: editingDraftTxnId });
      return;
    }
  }

  // Fase 3 — gudang mana yang tersentuh transaksi ini, dipakai buat cek freeze opname.
  // TUG8/TUG9 sudah punya gudangId langsung di form (scope-gudang #4); TUG3/TUG10 baru
  // pilih lokasi (blok) tujuan, jadi diturunkan lewat lokasiList (pola warehouseNameForLokasi
  // di supabaseSync.js). TUG5 sengaja tidak diikutkan — permintaan level UPT, tidak terikat
  // gudang/blok spesifik.
  function collectTxnGudangIds(docType, formData) {
    if (docType === "TUG8" || docType === "TUG9") return formData.gudangId ? [formData.gudangId] : [];
    if (docType === "TUG3" || docType === "TUG10") {
      const lokasiIds = [formData.lokasiTujuanId, ...(formData.stockItems||[]).map(si=>si.lokasiTujuanId)].filter(Boolean);
      return lokasiIds.map(lid => (lokasiList||[]).find(l=>l.id===lid)?.gudangId).filter(Boolean);
    }
    return [];
  }
  function findActiveFreezeSession(gudangIds) {
    if (!gudangIds.length) return null;
    return (opnameList||[]).find(o => o.freeze?.aktif && (o.freeze.gudangIds||[]).some(gid=>gudangIds.includes(gid)));
  }

  async function commitNewTxn(docType, formData, { replaceDraftId = null, targetStage = null } = {}) {
    if (savingTxnRef.current) return;       // cegah double-submit saat upload foto berjalan
    const frozenSession = findActiveFreezeSession(collectTxnGudangIds(docType, formData));
    if (frozenSession) {
      const namaGudang = frozenSession.freeze.gudangIds.map(gid=>(gudangList||[]).find(g=>g.id===gid)?.nama).filter(Boolean).join(", ") || "gudang ini";
      const lanjut = window.confirm(`⚠️ ${namaGudang} sedang di-FREEZE untuk Stock Opname "${frozenSession.semester||""} (${frozenSession.jenisAlur||""})".\n\nTransaksi tetap bisa dilanjutkan, tapi bisa memengaruhi selisih hitung opname. Lanjutkan simpan?`);
      if (!lanjut) return;
      formData = { ...formData, freezeWarnOpnameId: frozenSession.id };
    }
    savingTxnRef.current = true;
    setSavingTxn(true);
    setSavingInfo({ label: "Menyiapkan data...", done: 0, total: 0 });
    try {
    // Local draft metadata must never become part of the official server document.
    const { id:_draftId, docSeq:_draftSeq, docNumbers:_draftNumbers, status:_draftStatus,
      stage:_draftStage, requiredApprover:_draftApprover, canonical:_draftCanonical,
      canonicalId:_draftCanonicalId, canonicalVersion:_draftCanonicalVersion,
      draftLabel:_draftLabel, ...submittedForm } = formData || {};
    formData = submittedForm;
    // Upload foto base64 ke Storage dulu → blob transaksi jadi ringan. Gagal upload
    // (offline) → foto tetap base64 + _fotoPending; transaksi & dokumen tetap jadi,
    // auto-sync menyusul saat online (syncPendingTxnPhotos).
    let txnId = `${docType}-${uid().slice(-6)}`;
    const _hasFoto = formData && ([formData.fotoKendaraan,formData.fotoSimKtp,formData.fotoSuratPengembalian,formData.fotoBAPengembalian,formData.fotoSuratJalanImg,formData.fotoKontrak].some(_isDataUrl) || (formData.fotoMaterial||[]).some(fm=>_isDataUrl(fm?.img)) || (formData.stockItems||[]).some(si=>_isDataUrl(si.fotoNameplate)||_isDataUrl(si.fotoBarangRetur)||_isDataUrl(si.fotoBarang)));
    if (_hasFoto) setSavingInfo({ label: "Mengunggah foto...", done: 0, total: 0 });
    const { data: _fd, pending: _pend } = await processTxnPhotos(formData, txnId, (done, total) => setSavingInfo({ label: "Mengunggah foto...", done, total }));
    formData = _fd;
    if (_pend.length && ["TUG8", "TUG9"].includes(docType) && targetStage !== "DRAFT") {
      throw new Error("Foto TUG-8/TUG-9 belum aman di Storage. Periksa koneksi lalu ajukan ulang; dokumen resmi belum dibuat.");
    }
    if (_pend.length) showToast(`⚠️ ${_pend.length} foto belum terunggah (sinyal?). Transaksi & dokumen tetap tersimpan; foto disinkron otomatis saat online.`, "info");

    if ((docType === "TUG9" || docType === "TUG8") && targetStage === "DRAFT") {
      // Draft TUG-8/9: blob-only (canonical:false), belum submit ke tug_transactions
      // server sampai user "Ajukan" (submitDraftTug9 lalu promote lewat commitNewTxn biasa).
      const replacedDraft98 = replaceDraftId ? txns.find(t => t.id === replaceDraftId) : null;
      const nt98 = {
        id: replacedDraft98?.id || txnId,
        docType,
        docSeq: null,
        docNumbers: {},
        draftLabel: "DRAFT — nomor resmi saat diajukan",
        ...formData,
        stage: "DRAFT",
        status: "DRAFT",
        canonical: false,
        createdBy: replacedDraft98?.createdBy ?? currentUser.id, createdAt: replacedDraft98?.createdAt ?? Date.now(),
      };
      const newTxns98 = replaceDraftId ? txns.map(t => t.id === replaceDraftId ? nt98 : t) : [...txns, nt98];
      setTxns(newTxns98); setTxnModal(false); setEditingDraftTxnId(null);
      await saveToCloud({txns: newTxns98});
      showToast(`💾 Draft ${docType.replace("TUG","TUG-")} disimpan. Lengkapi lalu ajukan saat siap.`);
      return;
    }

    // FIX bug counter: docSeq global bisa ketinggalan dari transaksi yang sudah ada
    // (mis. dipulihkan/diimpor manual) — jangan pakai docSeq mentah, pastikan seq baru
    // tidak lebih kecil dari nomor tertinggi yang sudah dipakai txn client-numbered manapun.
    let seq = nextSafeDocSeq(docSeq, txns);
    const docCode = (docType === "TUG10" || docType === "TUG3") ? "LOG.00.01" : "LOG.00.02";
    const docKey = docType === "TUG9" ? "tug9" : docType === "TUG8" ? "tug8" : docType === "TUG10" ? "tug10" : docType === "TUG5" ? "tug5" : "tug3";
    let docNumbers = generateDocNumbers(seq, Date.now(), docCode);
    let canonicalSubmission = null;
    // TUG-8/TUG-9 uses the canonical server record when its reviewed migration
    // is available. A deployment before the migration retains the legacy path.
    if (["TUG8", "TUG9"].includes(docType)) {
      canonicalActionKeysRef.current ||= newCanonicalActionKeys();
      canonicalSubmission = await createAndSubmitCanonicalTug({ docType, formData, currentUser, idempotencyKeys: canonicalActionKeysRef.current });
      if (canonicalSubmission.unavailable && CANONICAL_TUG_REQUIRED) {
        throw new Error("Penyimpanan transaksi TUG canonical belum tersedia. Dokumen resmi tidak dibuat.");
      }
      if (!canonicalSubmission.unavailable) {
        txnId = canonicalSubmission.id;
        seq = Number(canonicalSubmission.docSequence);
        docNumbers = { ...docNumbers, [docKey]: canonicalSubmission.docNumber };
      }
    }

    if (docType === "TUG5" && formData.sourceType === "ULTG") {
      // Slip Reservasi dari ULTG: 1-stage approval oleh Manager ULTG unit yang sama.
      // Setelah approve, jadi pengajuan yang bisa di-adopt Admin/TL UPT induk (bukan auto-chain TUG-7).
      const parentUptId = ultgList.find(u => u.id === formData.ultgId)?.parentUptId || currentUser?.uptId;
      const uptKode = uptList.find(u => u.id === parentUptId)?.kode || "UPT-SBY";
      // TL amend: mengedit TUG-5 yang masih PENDING (belum final) di-update in-place —
      // nomor dok/stage/approval progress dipertahankan, bukan bikin ajuan baru.
      const replacedDraft5u = replaceDraftId ? txns.find(t => t.id === replaceDraftId) : null;
      const isEditInPlace5u = replacedDraft5u?.status === "PENDING";
      docNumbers = { ...docNumbers, tug5: generateReservasiDocNo(seq, Date.now(), uptKode) };
      const nt5u = {
        id: replacedDraft5u?.id || txnId,
        docType,
        docSeq: isEditInPlace5u ? replacedDraft5u.docSeq : seq,
        docNumbers: isEditInPlace5u ? replacedDraft5u.docNumbers : docNumbers,
        ...formData,
        uptId: formData.uptId || parentUptId,
        stage: isEditInPlace5u ? replacedDraft5u.stage : "PENDING_MGR_ULTG",
        status: "PENDING",
        requiredApprover: isEditInPlace5u ? replacedDraft5u.requiredApprover : "MGR_ULTG",
        approvedByMgrUltg: isEditInPlace5u ? (replacedDraft5u.approvedByMgrUltg ?? null) : null,
        approvedAtMgrUltg: isEditInPlace5u ? (replacedDraft5u.approvedAtMgrUltg ?? null) : null,
        adoptedBy: isEditInPlace5u ? (replacedDraft5u.adoptedBy ?? null) : null,
        adoptedAt: isEditInPlace5u ? (replacedDraft5u.adoptedAt ?? null) : null,
        adoptedTug9Id: isEditInPlace5u ? (replacedDraft5u.adoptedTug9Id ?? null) : null,
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdBy: replacedDraft5u?.createdBy ?? currentUser.id, createdAt: replacedDraft5u?.createdAt ?? Date.now(),
      };
      const newTxnsU = replaceDraftId ? txns.map(t => t.id === replaceDraftId ? nt5u : t) : [...txns, nt5u];
      const newSeqU = isEditInPlace5u ? docSeq : seq + 1;
      setTxns(newTxnsU); setDocSeq(newSeqU); setTxnModal(false); setEditingDraftTxnId(null);
      setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
      await saveToCloud({txns: newTxnsU, docSeq: newSeqU});
      if (isEditInPlace5u) {
        logAudit(currentUser, "UPDATE", "txns", nt5u.docNumbers.tug5, { docType, jumlahBarang: (formData.stockItems||[]).length });
        showToast(`✏️ ${nt5u.docNumbers.tug5} diperbarui. Masih menunggu approval.`);
      } else {
        logAudit(currentUser, "CREATE", "txns", nt5u.docNumbers.tug5, { docType, jumlahBarang: (formData.stockItems||[]).length });
        showToast(`${nt5u.docNumbers.tug5} dibuat! Menunggu approval Manager ULTG. ⏳`);
      }
      return;
    }

    if (docType === "TUG5") {
      // TUG-5: 2-stage approval: Asman → Manager UPT
      // Then auto-generates: INTRACOMPANY → draft TUG-7, INTERCOMPANY → draft TUG-5 UIT
      // TL amend (pola sama blok ULTG di atas): edit PENDING in-place, jangan bikin baru.
      const replacedDraft5 = replaceDraftId ? txns.find(t => t.id === replaceDraftId) : null;
      const isEditInPlace5 = replacedDraft5?.status === "PENDING";
      const nt5 = {
        id: replacedDraft5?.id || txnId,
        docType,
        docSeq: isEditInPlace5 ? replacedDraft5.docSeq : seq,
        docNumbers: isEditInPlace5 ? replacedDraft5.docNumbers : docNumbers,
        ...formData,
        stage: isEditInPlace5 ? replacedDraft5.stage : "PENDING_ASMAN",
        status: "PENDING",
        requiredApprover: isEditInPlace5 ? replacedDraft5.requiredApprover : "ASMAN",
        approvedByAsman: isEditInPlace5 ? (replacedDraft5.approvedByAsman ?? null) : null,
        approvedAtAsman: isEditInPlace5 ? (replacedDraft5.approvedAtAsman ?? null) : null,
        approvedByManager: isEditInPlace5 ? (replacedDraft5.approvedByManager ?? null) : null,
        approvedAtManager: isEditInPlace5 ? (replacedDraft5.approvedAtManager ?? null) : null,
        tug7Id: isEditInPlace5 ? (replacedDraft5.tug7Id ?? null) : null, // will be set when TUG-7 is auto-generated
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdBy: replacedDraft5?.createdBy ?? currentUser.id, createdAt: replacedDraft5?.createdAt ?? Date.now(),
      };
      const newTxns5 = replaceDraftId ? txns.map(t => t.id === replaceDraftId ? nt5 : t) : [...txns, nt5];
      const newSeq5 = isEditInPlace5 ? docSeq : seq + 1;
      setTxns(newTxns5); setDocSeq(newSeq5); setTxnModal(false); setEditingDraftTxnId(null);
      setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
      await saveToCloud({txns: newTxns5, docSeq: newSeq5});
      if (isEditInPlace5) {
        logAudit(currentUser, "UPDATE", "txns", nt5.docNumbers.tug5, { docType, jumlahBarang: (formData.stockItems||[]).length });
        showToast(`✏️ ${nt5.docNumbers.tug5} diperbarui. Masih menunggu approval.`);
      } else {
        logAudit(currentUser, "CREATE", "txns", nt5.docNumbers.tug5, { docType, jumlahBarang: (formData.stockItems||[]).length });
        showToast(`${nt5.docNumbers.tug5} dibuat! Menunggu approval Asman Konstruksi. ⏳`);
      }
      return;
    }

    if (docType === "TUG3") {
      // TUG-3/4 is a 2-stage approval chain on a single transaction (Manager dihapus):
      // DRAFT (bebas diedit, tanpa nomor dok) -> PENDING_TL (masih bisa diedit pembuat)
      // -> (TL approves) -> MENUNGGU_TUG4 -> (Admin/TL isi TUG-4 + lampiran final sekaligus)
      // -> PENDING_ASMAN -> (Asman approves) -> APPROVED
      const isDraft3 = targetStage === "DRAFT";
      const replacedDraft3 = replaceDraftId ? txns.find(t => t.id === replaceDraftId) : null;
      // Edit-until-TL: mengedit transaksi yang sudah PENDING_TL (bukan DRAFT) adalah
      // update in-place — bukan pengajuan baru, jadi TIDAK boleh menimpa nomor dokumen
      // yang sudah dipakai atau memakan nomor urut baru.
      const isEditInPlace = replacedDraft3?.stage === "PENDING_TL";
      // Draft juga langsung dapat nomor dokumen (bukan cuma saat diajukan) supaya kartu
      // draft tidak menampilkan "belum ada nomor". Kalau draft yang diedit SUDAH punya
      // nomor (disimpan sebelumnya), pertahankan — jangan generate nomor baru tiap edit.
      const hasExistingDraftDocs = !!replacedDraft3?.docNumbers?.tug3;
      const keepExistingDocs = isEditInPlace || (isDraft3 && hasExistingDraftDocs);
      const nt3 = {
        id: replacedDraft3?.id || txnId,
        docType,
        docSeq: keepExistingDocs ? (replacedDraft3?.docSeq ?? null) : seq,
        docNumbers: keepExistingDocs ? (replacedDraft3?.docNumbers || {}) : docNumbers,
        ...formData,
        // Fallback data-loss: draft lama (dibuat sebelum uptId disetel di openNewTxn) atau
        // formData yang lolos tanpa uptId — isi dari user saat ini supaya upsert DB tak gagal.
        uptId: formData.uptId || currentUser?.uptId || currentUserUptId || "",
        stage: isDraft3 ? "DRAFT" : "PENDING_TL",
        status: isDraft3 ? "DRAFT" : "PENDING", // kept for compatibility with generic PENDING/APPROVED/REJECTED filters
        requiredApprover: "TL",
        approvedByTL: null, approvedAtTL: null,
        approvedByAsman: null, approvedAtAsman: null,
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdBy: replacedDraft3?.createdBy ?? currentUser.id, createdAt: replacedDraft3?.createdAt ?? Date.now(),
      };
      const newTxns3 = replaceDraftId ? txns.map(t => t.id === replaceDraftId ? nt3 : t) : [...txns, nt3];
      // Draft/edit-in-place tidak menambah nomor urut dokumen — nomor baru diberi saat
      // benar-benar diajukan, supaya draft yang dibatalkan tidak meninggalkan gap nomor.
      const newSeq3 = keepExistingDocs ? docSeq : seq + 1;
      setTxns(newTxns3); setDocSeq(newSeq3); setTxnModal(false); setEditingDraftTxnId(null);
      setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
      await saveToCloud({txns: newTxns3, docSeq: newSeq3});
      // DB (tug3_transactions) jadi sumber kebenaran saat load; blob tetap ditulis di atas
      // sebagai jaring pengaman (dobel-tulis aman untuk sekarang). Gagal upsert DB tidak
      // membatalkan transaksi yang sudah tersimpan di blob — cukup diberi tahu.
      if (!(await upsertTug3Transaction(nt3))) {
        showToast("⚠️ Gagal simpan ke database (transaksi belum tersimpan permanen) — cek koneksi & coba lagi.", "error");
      }
      if (isDraft3) {
        showToast(`💾 Draft ${nt3.docNumbers.tug3} disimpan. Lengkapi lalu ajukan ke TL saat siap.`);
      } else if (isEditInPlace) {
        logAudit(currentUser, "UPDATE", "txns", nt3.docNumbers.tug3, { docType, jumlahBarang: (formData.stockItems||[]).length });
        showToast(`✏️ ${nt3.docNumbers.tug3} diperbarui. Masih menunggu approval TL Logistik.`);
      } else {
        logAudit(currentUser, "CREATE", "txns", nt3.docNumbers.tug3, { docType, jumlahBarang: (formData.stockItems||[]).length });
        showToast(`Transaksi ${nt3.docNumbers.tug3} dibuat! Menunggu approval TL Logistik (TUG-3 Karantina). ⏳`);
      }
      return;
    }

    const requiredApprover = canonicalSubmission && !canonicalSubmission.unavailable
      ? (canonicalSubmission.stage === "PENDING_TL" ? "TL" : "ASMAN")
      : (hasRole(currentUser, "ADMIN") ? "TL" : "ASMAN");
    const replacedDraft = replaceDraftId ? txns.find(t => t.id === replaceDraftId) : null;
    const { draftLabel:_localDraftLabel, ...draftBase } = replacedDraft || {};
    // TUG-10 draft: boleh disimpan belum lengkap, tanpa approval-required. Nomor dok
    // dipertahankan kalau draft yang diedit sudah punya satu (pola sama TUG-3
    // keepExistingDocs) supaya tidak makan nomor urut tiap kali disimpan ulang.
    const isDraft10 = docType === "TUG10" && targetStage === "DRAFT";
    // TL amend TUG-10: mengedit transaksi yang sudah PENDING (bukan DRAFT) adalah
    // update in-place — pertahankan nomor dok & progress approval (pola sama TUG-3/5).
    const isEditInPlace10 = docType === "TUG10" && replacedDraft?.status === "PENDING";
    const keepExistingDocs10 = (isDraft10 || isEditInPlace10) && !!replacedDraft?.docNumbers?.[docKey];
    const nt = {
      ...draftBase,
      id: replacedDraft?.id || txnId,
      docType,
      docSeq: keepExistingDocs10 ? (replacedDraft?.docSeq ?? null) : seq,
      docNumbers: keepExistingDocs10 ? (replacedDraft?.docNumbers || {}) : docNumbers,
      ...formData,
      // Fallback data-loss (pola sama TUG-3 nt3): draft lama/formData tanpa uptId → isi
      // dari user saat ini supaya upsert tug10_transactions tak ditolak (upt_id NOT NULL).
      uptId: formData.uptId || currentUser?.uptId || currentUserUptId || "",
      status: isDraft10 ? "DRAFT" : "PENDING",
      canonical: !!canonicalSubmission && !canonicalSubmission.unavailable,
      canonicalId: canonicalSubmission?.id || null,
      canonicalVersion: canonicalSubmission?.version || null,
      identitySnapshot: canonicalSubmission?.identitySnapshot || null,
      stage: isDraft10 ? "DRAFT" : (isEditInPlace10 ? replacedDraft?.stage : (canonicalSubmission?.stage || undefined)),
      requiredApprover: isEditInPlace10 ? (replacedDraft?.requiredApprover ?? requiredApprover) : requiredApprover,
      approvedBy: isEditInPlace10 ? (replacedDraft?.approvedBy ?? null) : null,
      approvedAt: isEditInPlace10 ? (replacedDraft?.approvedAt ?? null) : null,
      asmanAutoApproved: isEditInPlace10 ? !!replacedDraft?.asmanAutoApproved : false,
      rejectedBy: null, rejectedAt: null, rejectReason: null,
      createdBy: replacedDraft?.createdBy ?? currentUser.id, createdAt: replacedDraft?.createdAt ?? Date.now(),
    };
    const draftReplaced = replaceDraftId
      ? txns.map(t => t.id === replaceDraftId ? nt : t)
      : [...txns, nt];
    // Source transactions must point at the canonical record, never a local
    // draft id. This preserves both TUG-5 -> TUG-9 and TUG-7 -> TUG-8 chains.
    const newTxns = replaceDraftId
      ? draftReplaced.map(t => t.adoptedTug9Id === replaceDraftId
        ? { ...t, adoptedTug9Id:txnId }
        : t.tug8DraftId === replaceDraftId ? { ...t, tug8DraftId:txnId } : t)
      : draftReplaced;
    const newSeq = (canonicalSubmission && !canonicalSubmission.unavailable) || keepExistingDocs10 ? docSeq : seq + 1;
    setTxns(newTxns); setDocSeq(newSeq); setTxnModal(false); setEditingDraftTxnId(null);
    setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
    await saveToCloud({txns: newTxns, docSeq: newSeq});
    if (docType === "TUG10") {
      if (!(await upsertTug10Transaction(nt))) {
        showToast("⚠️ Gagal simpan TUG-10 ke database (transaksi belum tersimpan permanen) — cek koneksi & coba lagi.", "error");
      }
    }
    canonicalActionKeysRef.current = null;
    if (isDraft10) {
      showToast(`💾 Draft ${nt.docNumbers[docKey]} disimpan. Lengkapi lalu ajukan saat siap.`);
    } else if (isEditInPlace10) {
      logAudit(currentUser, "UPDATE", "txns", nt.docNumbers[docKey], { docType, jumlahBarang: (formData.stockItems||[]).length });
      showToast(`✏️ ${nt.docNumbers[docKey]} diperbarui. Masih menunggu approval.`);
    } else {
      logAudit(currentUser, "CREATE", "txns", nt.docNumbers[docKey], { docType, jumlahBarang: (formData.stockItems||[]).length });
      showToast(`Transaksi ${nt.docNumbers[docKey]} dibuat! Menunggu approval ${ROLES[requiredApprover]}. ⏳`);
    }
    } catch (err) {
      console.error("commitNewTxn gagal:", err);
      showToast(`❌ Gagal menyimpan transaksi: ${err?.message||err}`, "error");
    } finally { savingTxnRef.current = false; setSavingTxn(false); setSavingInfo(null); }
  }

  // ── Draft TUG-3 (Karantina) — buka utk edit, ajukan tanpa buka form, atau hapus ──
  function editDraftTug3(txn) {
    setTxnForm({ ...txn });
    setEditingDraftTxnId(txn.id);
    editingTxnRef.current = txn;
    setTug3ExpandedIdx(0);
    setTxnModal(true);
  }
  async function submitDraftTug3(txn) {
    if (isDemoMode()) { showToast("Mode demo: TUG-3 tidak disimpan ke server.","error"); return; }
    const missingTug3 = tug3MissingForSubmit(txn);
    if (missingTug3.length) { showToast(`Belum lengkap — ${missingTug3.join(", ")}`,"error"); return; }
    const validItems = (txn.stockItems||[]).filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
    if (validItems.length === 0) { showToast("Minimal 1 barang harus diisi sebelum diajukan!","error"); return; }
    await commitNewTxn("TUG3", { ...txn, stockItems: validItems }, { targetStage: "PENDING_TL", replaceDraftId: txn.id });
  }
  async function deleteDraftTug3(txn) {
    // Pembuat boleh hapus draftnya sendiri; TL juga boleh hapus TUG-3 yang sedang
    // menunggu approvalnya (PENDING_TL) langsung dari menu Approval (keputusan user).
    const isOwner = txn.createdBy === currentUser.id;
    const isTLPending = hasRole(currentUser, "TL") && txn.stage === "PENDING_TL";
    if (!isOwner && !isTLPending) { showToast("Tidak diizinkan menghapus transaksi ini.","error"); return; }
    const newTxns = txns.filter(t => t.id !== txn.id);
    setTxns(newTxns);
    await saveToCloud({ txns: newTxns });
    await deleteTug3Transaction(txn.id); // no-op aman kalau txn ini belum sempat ke-upsert ke DB
    logAudit(currentUser, "DELETE", "txns", txn.docNumbers?.tug3 || txn.id);
    showToast("🗑️ TUG-3 dihapus.");
  }

  // ── Draft TUG-10 (Barang Kembali) — sama pola dengan draft TUG-3 di atas ──
  function editDraftTug10(txn) {
    setTxnForm({ ...txn });
    setEditingDraftTxnId(txn.id);
    editingTxnRef.current = txn;
    setTug10Collapsed({});
    setTxnModal(true);
  }
  async function submitDraftTug10(txn) {
    const missing = tug10Missing(txn);
    if (missing.length) { showToast(`Belum lengkap — ${missing[0].label}${missing.length>1?` (dan ${missing.length-1} lainnya)`:""}`,"error"); return; }
    const validItems = (txn.stockItems||[]).filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
    await commitNewTxn("TUG10", { ...txn, stockItems: validItems }, { replaceDraftId: txn.id });
  }
  async function deleteDraftTug10(txn) {
    if (txn.createdBy !== currentUser.id) { showToast("Tidak diizinkan menghapus transaksi ini.","error"); return; }
    const newTxns = txns.filter(t => t.id !== txn.id);
    setTxns(newTxns);
    await saveToCloud({ txns: newTxns });
    await deleteTug10Transaction(txn.id); // no-op aman kalau txn ini belum sempat ke-upsert ke DB
    logAudit(currentUser, "DELETE", "txns", txn.docNumbers?.tug10 || txn.id);
    showToast("🗑️ TUG-10 dihapus.");
  }

  // ── TL "Perbaiki" — edit in-place TUG-5 (belum punya konsep draft) & TUG-8/9
  // canonical (buka form dari row server), pola sama editDraftTug3/editDraftTug10.
  function editTug5(txn) {
    setTxnForm({ ...txn });
    setEditingDraftTxnId(txn.id);
    editingTxnRef.current = txn;
    setTug5ExpandedIdx(0);
    setTug5MaterialPage(0);
    setTxnModal(true);
  }
  function editCanonicalTug98(txn) {
    // Data lama (sebelum #4 scope-gudang) belum punya gudangId — backfill dari barang
    // pertama biar SearchableSelect material tak terkunci "pilih gudang dulu" saat edit.
    const firstStock = stateRef.current.enrichedStocks.find(s=>s.id===txn.stockItems?.[0]?.stockId);
    setTxnForm({ ...txn, gudangId: txn.gudangId || firstStock?.gudangId || "" });
    setEditingDraftTxnId(txn.id);
    editingTxnRef.current = txn;
    setTug98Collapsed({});
    setTxnModal(true);
  }

  return {
    txnModal, setTxnModal, txnForm, setTxnForm,
    editingDraftTxnId, setEditingDraftTxnId,
    tugGroup, setTugGroup,
    tug5ExpandedIdx, setTug5ExpandedIdx, tug5MaterialPage, setTug5MaterialPage,
    savingTxn, setSavingTxn, savingInfo, setSavingInfo,
    tug3ExpandedIdx, setTug3ExpandedIdx,
    tug10Collapsed, setTug10Collapsed, tug10Highlight, setTug10Highlight, tug10Refs,
    tug98Collapsed, setTug98Collapsed,
    setMaterialPhoto, handleMaterialImg,
    openNewTxn, addItemRow, removeItemRow, updateItemRow,
    tug10Missing, flagTug10Invalid,
    saveTxn, commitNewTxn,
    editDraftTug3, submitDraftTug3, deleteDraftTug3,
    editDraftTug10, submitDraftTug10, deleteDraftTug10,
    editTug10: editDraftTug10, editTug5, editCanonicalTug98,
  };
}
