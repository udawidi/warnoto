import { hasRole } from "../lib/roles.js";
import { logAudit } from "../lib/audit.js";
import { generateDocNumbers, uid } from "../lib/utils.js";
import { processTxnPhotos } from "../lib/supabaseSync.js";
import { upsertTug3Transaction } from "../lib/tug3Sync.js";
import { normalizeKatalogCode, canonicalKatalogCode } from "../lib/normalizeKatalogCode.js";
import { resolveSapLabel } from "../lib/sap.js";
import { STATUS_SAP } from "../constants.js";
import { supabase } from "../supabaseClient.js";
import { roleTier } from "../lib/roles.js";
import { collectTxnGudangIds, findActiveFreezeSession } from "../lib/opnameFreeze.js";

// Normalisasi nomor WA "0812xxx" -> "62812xxx" (Fonnte/WA API butuh country code,
// bukan 0 lokal). Tidak ada helper existing untuk ini (parseIndoNumber di lib/utils.js
// adalah parser angka desimal, bukan nomor telepon) — jadi ditulis di sini, lokal ke
// pemakaian notif. Return null kalau kosong/terlalu pendek (skip diam-diam).
function toWaNumber(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  return "62" + digits;
}

// Fondasi + generalisasi notif WA/Telegram (BATCH 2, 2026-09-03; opt-in per-user
// 2026-09-03). Dua event: COMPLETION (approval final) dan PENDING (masuk antrean
// Asman). Penerima diresolve FRESH dari `profiles.notif_events` (opt-in, bukan
// role-based hardcoded, bukan `users` state basi) via toWaNumber(official_phone),
// discope pakai roleTier: UIT lihat 1 uit_id, PUSAT/GLOBAL semua, sisanya (UPT)
// per upt_id. COMPLETION masih + akuntansi manual dari notif_recipients (pola
// lama). Dedup by nomor/target final supaya 1 orang 2 sumber tidak dobel kirim.
// try/catch — notif gagal TIDAK BOLEH menggagalkan approval.
async function enqueueTugNotif({ eventType, docType, docNumber, uptId, txnId, items, arah, users, uptList }) {
  try {
    const targets = []; // {channel, target}
    const pushWa = (u) => { const n = toWaNumber(u?.official_phone); if (n) targets.push({ channel: "WA", target: n }); };

    if (eventType === "COMPLETION") {
      const { data: recipients } = await supabase.from("notif_recipients").select("*").eq("active", true);
      (recipients || []).filter(r => r.upt_id == null || r.upt_id === uptId)
        .forEach(r => targets.push({ channel: r.channel, target: r.target }));
    }

    const uitId = (uptList || []).find(x => x.id === uptId)?.uitId;
    const { data: profs } = await supabase.from("profiles")
      .select("role,upt_id,uit_id,official_phone,notif_events")
      .contains("notif_events", [eventType]);
    (profs || []).filter(p => {
      const tier = roleTier(p.role);
      if (tier === "UIT") return p.uit_id === uitId;
      if (tier === "PUSAT" || tier === "GLOBAL") return true;
      return p.upt_id === uptId;
    }).forEach(pushWa);

    // Dedup by target final (nomor WA / chat_id Telegram) — 1 penerima, 1 pesan.
    const seen = new Set();
    const dedup = targets.filter(t => (seen.has(t.target) ? false : (seen.add(t.target), true)));
    if (!dedup.length) return;

    const rows = dedup.map(t => ({
      id: uid(),
      tug_txn_id: txnId,
      doc_type: docType,
      channel: t.channel,
      recipient: t.target,
      payload: { docNumber, docType, uptId, txnId, items, arah, eventType },
      status: "PENDING",
      attempts: 0,
      created_at: Date.now(),
    }));
    await supabase.from("notif_outbox").insert(rows);
    supabase.functions.invoke("notify-dispatch").catch(() => {});
  } catch (_e) {
    // Notif gagal TIDAK BOLEH menggagalkan approval — diam saja.
  }
}

// Domain: mesin approval transisi TUG-3/4/5/5-ULTG/7 (dan turunan draft TUG-8/9).
// Murni relokasi — semua state (txns/stocks/katalogList/docSeq/dst.) tetap dimiliki
// PLNWarehouse dan dioper sbg param, karena semuanya SUDAH terdefinisi di App.jsx
// sebelum titik pemanggilan hook ini (lihat lokasi lama fungsi2 ini, baris ~3186+).
export function useTugApprovals({
  currentUser, showToast,
  txns, setTxns, saveToCloud,
  stocks, setStocks, katalogList, setKatalogList,
  docSeq, setDocSeq,
  uptList, ultgList, currentUserUptId, users,
  canonicalActionKeysRef,
  setTxnForm, setEditingDraftTxnId, setTxnModal, editingDraftTxnId,
  commitNewTxn, stateRef,
  opnameList, lokasiList, gudangList,
}) {
  // Wrapper lokal — semua titik enqueue di hook ini otomatis dapat users/uptList
  // tanpa mengulang di tiap pemanggilan.
  const notify = (args) => enqueueTugNotif({ ...args, users, uptList });
  // ══════════════════════════════════════════════════════════════════
  // TUG-3 / TUG-4 — 2-stage approval chain on a single transaction:
  //   Stage 1: PENDING_TL    -> TL Logistik approves                -> MENUNGGU_TUG4
  //   Stage 2: MENUNGGU_TUG4 -> Admin/TL isi TUG-4 + lampiran final -> PENDING_ASMAN
  //   Stage 3: PENDING_ASMAN -> Asman approves (TUG-3 Final)        -> APPROVED (stock increases)
  // Approval Manager (MUP) dihapus dari alur; Asman satu-satunya approval final.
  // ══════════════════════════════════════════════════════════════════

  // Stage 1: TL Logistik approves the TUG-3 Karantina submission
  async function approveTUG3_TL(txn) {
    if (!hasRole(currentUser, "TL")) { showToast("Hanya TL Logistik yang bisa menyetujui TUG-3 Karantina.","error"); return; }
    if (txn.stage !== "PENDING_TL") { showToast("Transaksi ini tidak dalam tahap menunggu TL.","error"); return; }
    // BUG 7 fix: requiredApprover tetap "TL" di tahap MENUNGGU_TUG4 (TL yang isi form
    // TUG-4), baru pindah ke "ASMAN" saat submitTUG4DanLampiran — sebelumnya langsung
    // "ASMAN" di sini bikin item muncul prematur di antrean Asman padahal TUG-4 belum diisi.
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_TUG4", approvedByTL:currentUser.id, approvedAtTL:Date.now(), requiredApprover:"TL" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    await upsertTug3Transaction(newTxns.find(t => t.id===txn.id));
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug3, {stage:"MENUNGGU_TUG4"});
    showToast(`✅ ${txn.docNumbers.tug3} disetujui TL Logistik! Lanjut ke tahap TUG-4 (Pemeriksaan Mutu).`);
  }
  async function rejectTUG3_TL(txn, reason) {
    if (!hasRole(currentUser, "TL")) { showToast("Hanya TL Logistik yang bisa menolak TUG-3 Karantina.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    await upsertTug3Transaction(newTxns.find(t => t.id===txn.id));
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug3, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug3} DITOLAK oleh TL Logistik.`, "error");
  }

  // Stage 2: Admin/TL isi data pemeriksaan TUG-4 (Tim Mutu, Lokasi Penyerahan, hasil
  // pemeriksaan) + lampiran final (foto kendaraan, SIM/KTP, surat jalan, kontrak) SEKALIGUS
  // dalam satu langkah — langsung ke antrean Asman (Manager dihapus dari approval).
  async function submitTUG4DanLampiran(txn, data) {
    if (!data.timMutuId) { showToast("Pilih paket Tim Mutu!","error"); return false; }
    if (!data.lokasiPenyerahan?.trim()) { showToast("Lokasi Penyerahan wajib diisi!","error"); return false; }
    // Foto lampiran (fotoKendaraan/fotoSimKtp/fotoSuratJalanImg/fotoKontrak) masuk sebagai
    // base64 dari PhotoSlot — upload ke Storage dulu (jalur sama commitNewTxn) supaya baris
    // DB tidak menyimpan blob base64. Gagal upload → tetap base64 + toast.
    const { data: uploadedData, pending } = await processTxnPhotos(data, txn.id, () => {});
    if (pending.length) showToast(`⚠️ ${pending.length} foto lampiran belum terunggah (sinyal?). Data tetap tersimpan; foto disinkron otomatis saat online.`, "info");
    // Status SAP/Non-SAP per barang DIPUTUSKAN di sini (TL, tahap TUG-4), bukan lagi
    // di form TUG-3 — data.itemSapStatus (array "SAP"/"Non-SAP" per index, opsional)
    // menimpa si.sapStatus; label lengkap (Persediaan/Cadang by digit) diresolusi nanti
    // di approveTUG3Final_Asman lewat resolveSapLabel.
    const stockItems = data.itemSapStatus
      ? txn.stockItems.map((si, idx) => data.itemSapStatus[idx] ? { ...si, sapStatus: data.itemSapStatus[idx] } : si)
      : txn.stockItems;
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, ...uploadedData, stockItems, stage:"PENDING_ASMAN", requiredApprover:"ASMAN" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    await upsertTug3Transaction(newTxns.find(t => t.id===txn.id));
    showToast(`📋 TUG-4 & lampiran dilengkapi! Menunggu approval Asman Konstruksi.`);
    notify({
      eventType: "PENDING",
      docType: "TUG3",
      docNumber: txn.docNumbers?.tug3 || "",
      uptId: txn.uptId,
      txnId: txn.id,
      arah: "MASUK",
      items: stockItems.map(si => ({
        kode: (si.katalogMode === "existing" ? katalogList.find(k => k.id === si.katalogId)?.katalog : si.katalogBaru) || "",
        nama: (si.katalogMode === "existing" ? katalogList.find(k => k.id === si.katalogId)?.name : si.namaBaru) || "",
        qty: si.qty,
        satuan: (si.katalogMode === "existing" ? katalogList.find(k => k.id === si.katalogId)?.satuan : si.satuanBaru) || "",
      })),
    });
    return true;
  }
  // Stage 3: Asman Konstruksi approves the final receipt — THIS is when stock actually increases
  async function approveTUG3Final_Asman(txn) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-3 Final.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("Transaksi ini tidak dalam tahap menunggu Asman.","error"); return; }
    // Fase A — gudang tujuan lagi di-opname: tunda approve (blokir keras, sama seperti
    // commitNewTxn) supaya stok tak berubah di tengah hitung fisik.
    const frozen = findActiveFreezeSession(collectTxnGudangIds("TUG3", txn, lokasiList), opnameList);
    if (frozen) { showToast("🧊 DITOLAK — gudang tujuan sedang Stock Opname. Approve TUG-3 ditunda sampai opname selesai.","error"); return; }

    // Same incoming-material logic as TUG-10 approval: bump existing Data Stok
    // row or auto-create new Master Katalog + Data Stok entry.
    let newKatalog = [...katalogList];
    let newStocks = [...stocks];
    let nextKatNum = newKatalog.length + 1;
    let nextStkNum = newStocks.length + 1;
    // Lacak baris stok & katalog yang benar-benar berubah/ditambah (pola sama TUG-10) —
    // sync ke Supabase cuma mengirim baris itu, bukan seluruh tabel `stocks`.
    const touchedStockIds = new Set();
    const touchedKatalogIds = new Set();

    // Fitur A LITE: sumber kontrak TUG-3 melekat ke stok sbg daftar historis (bukan
    // per-batch/FIFO — upgrade ke situ kalau nanti butuh lacak batch per kontrak).
    const kontrakEntry = {
      noKontrak: txn.judulKontrak || "",
      supplier: txn.dariSupplier || "",
      suratPesananNo: txn.suratPesananNo || "",
      suratPesananTgl: txn.suratPesananTgl || "",
      amandemenNo: txn.amandemenNo || "",
      tglMasuk: Date.now(),
      docNo: txn.docNumbers?.tug3 || "",
    };
    const appendKontrakRef = (refs) => {
      const list = refs || [];
      const dup = list.some(r => r.docNo === kontrakEntry.docNo && r.noKontrak === kontrakEntry.noKontrak);
      return dup ? list : [...list, kontrakEntry];
    };
    // Fitur B Bagian 1: katalogId yang barusan bertambah stoknya lewat TUG-3 ini —
    // dipakai untuk flag reaktif reservasi ULTG yang menunggu (lihat newTxns di bawah).
    const arrivedKatalogIds = new Set();

    txn.stockItems.forEach(si => {
      const lokasiId = si.lokasiTujuanId || txn.stockItems[0]?.lokasiTujuanId;
      if (!lokasiId) return;
      // FIX 3: kode katalog baru dari TUG-3 dinormalisasi (buang prefix "100" 10-digit
      // gaya AppSheet) supaya konsisten dengan format katalog yang sudah ada.
      const katalogCodeBaru = normalizeKatalogCode(si.katalogBaru || "");
      // Status Barang: default dipilih di form TUG-3, TL bisa timpa di tahap TUG-4
      // (si.sapStatus bisa berupa label eksplisit ATAU raw "SAP"/"Non-SAP" dari TUG-4)
      // — resolveSapLabel mengurai keduanya dan, untuk "SAP", menurunkan label spesifik
      // dari panjang digit kode katalog (7→Persediaan, 10→Cadang).
      const katalogCodeForSap = si.katalogMode === "existing"
        ? katalogList.find(k => k.id===si.katalogId)?.katalog
        : katalogCodeBaru;
      const sapStatus = resolveSapLabel(katalogCodeForSap, si.sapStatus || STATUS_SAP[0]);
      const jenisBarang = sapStatus === "SAP — Cadang" ? "Cadang" : "Persediaan";
      // FIX 2: foto barang diisi dari lampiran TUG-3 (si.fotoBarang, sudah berupa URL
      // Storage sejak commitNewTxn -> processTxnPhotos), bukan lagi null.
      const fotoBarang = si.fotoBarang || null;
      if (si.katalogMode === "existing" && si.katalogId) {
        arrivedKatalogIds.add(si.katalogId);
        const existingRow = newStocks.find(s => s.katalogId===si.katalogId && s.lokasiId===lokasiId);
        if (existingRow) {
          // Jangan timpa foto lama kalau baris existing sudah punya foto sendiri.
          // fotoKeseluruhan = field kanonik yang dirender sel Foto tabel Data Stok
          // (DataStokTab.jsx:291); img cuma dipakai thumbnail fallback lain — isi dua-duanya.
          newStocks = newStocks.map(s => s.id===existingRow.id ? { ...s, qty: s.qty + si.qty, img: s.img || fotoBarang, fotoKeseluruhan: s.fotoKeseluruhan || fotoBarang, kontrakRefs: appendKontrakRef(s.kontrakRefs) } : s);
          touchedStockIds.add(existingRow.id);
        } else {
          const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId, qty:si.qty, minQty:0, price:si.hargaSatuan||0, jenisBarang, sapStatus, img:fotoBarang, fotoKeseluruhan:fotoBarang, createdAt:Date.now(), kontrakRefs:[kontrakEntry] });
          touchedStockIds.add(newId);
        }
      } else {
        // FIX bug 3: master katalog lama campur zero-padded ("000000007020273") dan
        // bersih ("7020273") — sebelum bikin katalog baru, cek dulu apakah kode kanoniknya
        // sudah ada (cocok TUG-4 baru vs master lama), supaya tak dobel entri katalog.
        const dupKatalog = katalogCodeBaru && newKatalog.find(k => canonicalKatalogCode(k.katalog) === canonicalKatalogCode(katalogCodeBaru));
        const katId = dupKatalog ? dupKatalog.id : `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(-6)}`;
        arrivedKatalogIds.add(katId);
        if (!dupKatalog) {
          newKatalog.push({ id:katId, katalog:katalogCodeBaru, name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
          touchedKatalogIds.add(katId);
        }
        const existingRow2 = newStocks.find(s => s.katalogId===katId && s.lokasiId===lokasiId);
        if (existingRow2) {
          newStocks = newStocks.map(s => s.id===existingRow2.id ? { ...s, qty: s.qty + si.qty, img: s.img || fotoBarang, fotoKeseluruhan: s.fotoKeseluruhan || fotoBarang, kontrakRefs: appendKontrakRef(s.kontrakRefs) } : s);
          touchedStockIds.add(existingRow2.id);
        } else {
          const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newStocks.push({ id:newStkId, katalogId:katId, lokasiId, qty:si.qty, minQty:0, price:si.hargaSatuan||0, jenisBarang, sapStatus, img:fotoBarang, fotoKeseluruhan:fotoBarang, createdAt:Date.now(), kontrakRefs:[kontrakEntry] });
          touchedStockIds.add(newStkId);
        }
      }
    });

    // Fitur B Bagian 1: flag reaktif reservasi ULTG yang menunggu katalog yang barusan
    // tiba — dibangun di atas engine Reservasi yang sudah ada, cuma nambah flag,
    // BUKAN model request/approval baru.
    const uptIdForMatch = txn.uptId || currentUserUptId;
    const siapDiambilNow = [];
    const now = Date.now();
    const newTxns = txns.map(t => {
      if (t.id === txn.id) return { ...t, stage:"APPROVED", status:"APPROVED", approvedByAsman:currentUser.id, approvedAtAsman:Date.now() };
      if (t.docType === "TUG5" && t.sourceType === "ULTG" && t.stage === "APPROVED_ULTG" && !t.siapDiambil) {
        const ultg = ultgList.find(u => u.id === t.ultgId);
        const cocok = ultg?.parentUptId === uptIdForMatch && (t.stockItems||[]).some(si => arrivedKatalogIds.has(si.katalogId));
        if (cocok) { siapDiambilNow.push(t); return { ...t, siapDiambil:true, siapDiambilAt: now }; }
      }
      return t;
    });
    setTxns(newTxns); setStocks(newStocks); setKatalogList(newKatalog);
    await saveToCloud({txns: newTxns, stocks: newStocks, katalogList: newKatalog}, {
      stocksChangedRows: newStocks.filter(s => touchedStockIds.has(s.id)),
      katalogChangedRows: newKatalog.filter(k => touchedKatalogIds.has(k.id)),
    });
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug3, {stage:"APPROVED"});
    await upsertTug3Transaction(newTxns.find(t => t.id===txn.id));
    showToast(`✅ ${txn.docNumbers.tug3} DISETUJUI FINAL! Stok bertambah ke gudang.`);
    // Notif WA/Telegram — TUG-3 legacy blob, tidak punya row di tug_transactions
    // (trigger DB tidak nangkap) jadi enqueue dari client. Fire-and-forget.
    notify({
      eventType: "COMPLETION",
      docType: "TUG3",
      docNumber: txn.docNumbers?.tug3 || "",
      uptId: txn.uptId,
      txnId: txn.id,
      arah: "MASUK",
      items: txn.stockItems.map(si => ({
        kode: (si.katalogMode === "existing" ? katalogList.find(k => k.id === si.katalogId)?.katalog : si.katalogBaru) || "",
        nama: (si.katalogMode === "existing" ? katalogList.find(k => k.id === si.katalogId)?.name : si.namaBaru) || "",
        qty: si.qty,
        satuan: (si.katalogMode === "existing" ? katalogList.find(k => k.id === si.katalogId)?.satuan : si.satuanBaru) || "",
      })),
      kontrak: { nama: txn.judulKontrak || "", noSP: txn.suratPesananNo || "", pt: txn.dariSupplier || "" },
    });
    siapDiambilNow.forEach(t => {
      logAudit(currentUser, "UPDATE", "txns", t.docNumbers?.tug5 || t.id, {siapDiambil:true});
      showToast(`📦 Material reservasi ${t.docNumbers?.tug5 || t.id} sudah tiba, siap diambil.`);
    });
  }
  async function rejectTUG3Final_Asman(txn, reason) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-3 Final.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    await upsertTug3Transaction(newTxns.find(t => t.id===txn.id));
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug3, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug3} DITOLAK oleh Asman Konstruksi (tahap final).`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-5 APPROVAL CHAIN: Asman → Manager UPT
  // Setelah Manager approve → auto-generate TUG-7 (Intracompany)
  //                        atau draft TUG-5 UIT (Intercompany)
  // ══════════════════════════════════════════════════════════════════

  async function approveTUG5_Asman(txn) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("TUG-5 ini tidak dalam tahap menunggu Asman.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"PENDING_MANAGER", requiredApprover:"MANAGER", approvedByAsman:currentUser.id, approvedAtAsman:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"PENDING_MANAGER"});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui Asman! Menunggu approval Manager.`);
  }
  async function rejectTUG5_Asman(txn, reason) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug5, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Asman.`, "error");
  }

  async function approveTUG5_Manager(txn) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_MANAGER") { showToast("TUG-5 ini tidak dalam tahap menunggu Manager.","error"); return; }

    if (txn.jenisTransfer === "INTRACOMPANY") {
      // Auto-generate draft TUG-7 di level UIT
      const seq = docSeq;
      const docNumbers = generateDocNumbers(seq, Date.now());
      const newTug7 = {
        id: `TUG7-` + uid().slice(-6),
        docType: "TUG7",
        docSeq: seq, docNumbers,
        tug5Id: txn.id,
        tug5DocNo: txn.docNumbers.tug5,
        uitId: txn.uitId,
        uptPengirimId: "", // diisi Admin UIT
        atasBebanRekening: "",
        perintahKerja: txn.perintahKerja||"", kodeAkun: txn.kodePerkiraan||"", fungsi: txn.fungsi||"",
        stockItems: txn.stockItems.map(si=>({...si, qty: si.permintaan||si.qty||0})),
        stage: "DRAFT_UIT",
        status: "PENDING",
        requiredApprover: "ADMIN_UIT",
        approvedByAdminUIT: null, approvedAtAdminUIT: null,
        approvedByMgrLogistik: null, approvedAtMgrLogistik: null,
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdAt: Date.now(),
        unitPenerima: "UPT Surabaya",
      };
      const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED", status:"APPROVED", approvedByManager:currentUser.id, approvedAtManager:Date.now(), tug7Id:newTug7.id} : t);
      const allTxns = [...newTxns, newTug7];
      const newSeq = seq + 1;
      setTxns(allTxns); setDocSeq(newSeq);
      await saveToCloud({txns: allTxns, docSeq: newSeq});
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"APPROVED", generated:newTug7.docNumbers.tug7});
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-7 otomatis dibuat untuk UIT. 📋`);
    } else {
      // INTERCOMPANY — generate draft TUG-5 UIT (untuk dikirim ke UIT lain)
      const seq = docSeq;
      const docNumbers = generateDocNumbers(seq, Date.now());
      const draftTug5UIT = {
        id: `TUG5UIT-` + uid().slice(-6),
        docType: "TUG5",
        docSubType: "UIT_INTERCOMPANY",
        docSeq: seq, docNumbers,
        tug5UptId: txn.id, // referensi ke TUG-5 UPT asal
        uitId: txn.uitId,
        jenisTransfer: "INTERCOMPANY",
        keteranganUmum: txn.keteranganUmum,
        perintahKerja: txn.perintahKerja||"", kodePerkiraan: txn.kodePerkiraan||"", fungsi: txn.fungsi||"",
        stockItems: txn.stockItems.map(si=>({...si})),
        stage: "DRAFT_UIT",
        status: "PENDING",
        createdAt: Date.now(),
        namaPekerjaan: txn.keteranganUmum||"Permintaan Intercompany",
        lokasiPekerjaan: "UIT-JBM",
      };
      const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED", status:"APPROVED", approvedByManager:currentUser.id, approvedAtManager:Date.now(), draftTug5UITId:draftTug5UIT.id} : t);
      const allTxns = [...newTxns, draftTug5UIT];
      const newSeq = seq + 1;
      setTxns(allTxns); setDocSeq(newSeq);
      await saveToCloud({txns: allTxns, docSeq: newSeq});
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"APPROVED", generated:draftTug5UIT.docNumbers.tug5});
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-5 UIT (Intercompany) dibuat — cetak & kirim manual ke UIT tujuan. 📄`);
    }
  }
  async function rejectTUG5_Manager(txn, reason) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug5, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Manager.`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-5 DARI ULTG: Manager ULTG approve (1 tahap) → jadi pengajuan siap di-adopt
  // Admin/TL UPT induk ULTG tersebut. Adopt = auto-create draft TUG-9 (editable).
  // ══════════════════════════════════════════════════════════════════

  async function approveTUG5_MgrULTG(txn) {
    if (!hasRole(currentUser, "MGR_ULTG")) { showToast("Hanya Manager ULTG yang bisa menyetujui Reservasi ini.","error"); return; }
    if (currentUser.role !== "SUPERADMIN") {
      if (!currentUser.ultgId) { showToast("Akun kamu belum terhubung ke unit ULTG manapun. Hubungi Admin untuk melengkapi profil.","error"); return; }
      if (txn.ultgId !== currentUser.ultgId) { showToast("Reservasi ini bukan dari unit ULTG kamu.","error"); return; }
    }
    if (txn.stage !== "PENDING_MGR_ULTG") { showToast("Reservasi ini tidak dalam tahap menunggu Manager ULTG.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED_ULTG", status:"APPROVED", approvedByMgrUltg:currentUser.id, approvedAtMgrUltg:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"APPROVED_ULTG"});
    showToast(`✅ Reservasi ${txn.docNumbers.tug5} disetujui! Siap di-adopt Admin/TL UPT.`);
  }
  async function rejectTUG5_MgrULTG(txn, reason) {
    if (!hasRole(currentUser, "MGR_ULTG")) { showToast("Hanya Manager ULTG yang bisa menolak Reservasi ini.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug5, {stage:"REJECTED", alasan:reason});
    showToast(`❌ Reservasi ${txn.docNumbers.tug5} DITOLAK oleh Manager ULTG.`, "error");
  }
  // Admin/TL UPT induk "mengadopsi" pengajuan ULTG → auto-create draft TUG-9 (editable, stok dipilih sendiri)
  async function adoptTUG5ULTG(txn) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL UPT yang bisa mengadopsi pengajuan ini.","error"); return; }
    if (txn.adoptedBy) { showToast("Pengajuan ini sudah di-adopt UPT lain.","error"); return; }
    const ultg = ultgList.find(u=>u.id===txn.ultgId);
    // Cocokkan katalogId dari pengajuan TUG-5 ULTG ke baris stok aktual (pilih stok dengan
    // qty terbesar untuk katalog tsb) — supaya list material TIDAK hilang saat masuk draft TUG-9,
    // karena form TUG-9 me-render item lewat stocks.find(s=>s.id===si.stockId), bukan katalogId.
    const draftTug9 = {
      id: `DRAFT-TUG9-` + uid().slice(-6),
      docType: "TUG9", draftLabel:"DRAFT — nomor resmi saat diajukan",
      uptId: currentUserUptId || currentUser?.uptId || "",
      tug5Id: txn.id, tug5DocNo: txn.docNumbers.tug5,
      namaPekerjaan: txn.keteranganUmum || "Reservasi Material ULTG",
      lokasiPekerjaan: ultg?.nama || "ULTG",
      perkiraanPembebanan: "", kodePerkiraan: txn.kodePerkiraan||"",
      keteranganBarang: txn.namaPekerjaan || txn.keteranganUmum || `Adopsi dari pengajuan ${ultg?.nama||""} — ${txn.docNumbers.tug5}`,
      stockItems: txn.stockItems.map(si=>{
        const matches = stocks.filter(s=>s.katalogId===si.katalogId).sort((a,b)=>(b.qty||0)-(a.qty||0));
        return { stockId: matches[0]?.id || "", qty: si.permintaan||si.qty||1, _katalogHint: si.katalogId };
      }),
      noNodin: "", noPersetujuan: "",
      nopol: "", simKtp: "", namaPengemudi: "",
      penerimaNama: "", penerimaJabatan: "", penerimaUnit: ultg?.nama||"",
      satpamId: "",
      fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null, fotoMaterial: [],
      status: "DRAFT",
      createdBy: currentUser.id, createdAt: Date.now(),
    };
    const newTxns = txns.map(t => t.id===txn.id ? {...t, adoptedBy:currentUser.id, adoptedAt:Date.now(), adoptedTug9Id:draftTug9.id} : t);
    const allTxns = [...newTxns, draftTug9];
    setTxns(allTxns);
    await saveToCloud({txns: allTxns});
    showToast(`📋 Reservasi diadopsi! Draft TUG-9 dibuat — lengkapi & edit materialnya sebelum submit.`);
    return draftTug9;
  }
  // Buka draft TUG-8/9 di form biasa. Nomor resmi hanya dibuat oleh RPC canonical
  // setelah seluruh data, stok, dan lampiran lolos validasi.
  function openDraftTug9(txn) {
    canonicalActionKeysRef.current = null;
    setTxnForm({ ...txn, uptId:txn.uptId || currentUserUptId || currentUser?.uptId || "", stockItems: txn.stockItems.length ? txn.stockItems : [{stockId:"",qty:1}] });
    setEditingDraftTxnId(txn.id);
    setTxnModal(true);
  }
  // Submit draft turunan mengganti satu baris local draft dengan record canonical.
  // Ajukan draft TUG-8/9 (baik draft turunan ULTG maupun draft user biasa dari
  // list) — validasi sama seperti saveTxn cabang TUG9/8, lalu promote ke canonical.
  // replaceDraftId pakai formData.id (bukan closure editingDraftTxnId) supaya jalan
  // juga saat dipanggil langsung dari kartu draft di list (form belum dibuka).
  async function submitDraftTug9(formData) {
    const draftId = formData?.id || editingDraftTxnId;
    if (!draftId) throw new Error("Draft transaksi tidak ditemukan.");
    if (!formData.penerimaNama?.trim()) { showToast("Nama Penerima wajib diisi!","error"); return; }
    if (formData.docType === "TUG8" && !formData.unitTujuan?.trim()) { showToast("Unit/Sektor Tujuan wajib diisi untuk TUG-8!","error"); return; }
    const submittedItems = formData.stockItems || [];
    if (submittedItems.length === 0 || submittedItems.some(si => !si.stockId || !(Number(si.qty) > 0))) {
      showToast("Setiap baris material wajib memiliki stok dan jumlah lebih dari nol.","error"); return;
    }
    for (const si of submittedItems) {
      const stock = stateRef?.current?.enrichedStocks?.find(s=>s.id===si.stockId);
      if (!stock) { showToast("Referensi stok tidak ditemukan. Pilih ulang material dari daftar stok.","error"); return; }
      if (stock.jenisBarang !== "Non-Stock" && stock.qty < si.qty) {
        showToast(`Stok ${stock.name} di ${stock.lokasi} tidak cukup! Tersedia: ${stock.qty} ${stock.unit}`,"error"); return;
      }
    }
    await commitNewTxn(formData.docType, formData, { replaceDraftId: draftId });
  }
  // Hapus draft TUG-8/9 lokal (blob-only, belum pernah submit ke server canonical
  // jadi tidak ada baris server untuk dibersihkan) — pola sama deleteDraftTug3/10.
  async function deleteDraftTug9(txn) {
    if (txn.createdBy !== currentUser.id) { showToast("Tidak diizinkan menghapus transaksi ini.","error"); return; }
    const newTxns = txns.filter(t => t.id !== txn.id);
    setTxns(newTxns);
    await saveToCloud({ txns: newTxns });
    logAudit(currentUser, "DELETE", "txns", txn.docNumbers?.[txn.docType==="TUG8"?"tug8":"tug9"] || txn.id);
    showToast(`🗑️ ${txn.docType.replace("TUG","TUG-")} draft dihapus.`);
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-7 APPROVAL CHAIN: Admin UIT (lengkapi) → Manager Logistik UIT (approve)
  // Setelah Manager Logistik approve → auto-generate draft TUG-8 di UPT Pengirim
  // ══════════════════════════════════════════════════════════════════

  async function submitTUG7_AdminUIT(txn, tug7Data) {
    if (!hasRole(currentUser, "ADMIN_UIT")) { showToast("Hanya Admin UIT yang bisa melengkapi TUG-7.","error"); return; }
    if (!tug7Data.uptPengirimId) { showToast("Pilih UPT Pengirim terlebih dahulu!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, ...tug7Data, stage:"PENDING_MGR_LOGISTIK", requiredApprover:"MGR_LOGISTIK_UIT", approvedByAdminUIT:currentUser.id, approvedAtAdminUIT:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`📋 TUG-7 ${txn.docNumbers.tug7} dilengkapi! Menunggu approval Manager Logistik UIT.`);
  }
  async function approveTUG7_MgrLogistik(txn) {
    if (!hasRole(currentUser, "MGR_LOGISTIK_UIT")) { showToast("Hanya Manager Logistik UIT yang bisa menyetujui TUG-7.","error"); return; }
    if (txn.stage !== "PENDING_MGR_LOGISTIK") { showToast("TUG-7 ini tidak dalam tahap menunggu Manager Logistik.","error"); return; }

    // Auto-generate local draft TUG-8 in the sending UPT. It intentionally has
    // no official number/sequence; the canonical RPC allocates those on submit.
    const uptPengirim = uptList.find(u=>u.id===txn.uptPengirimId);
    const tug5Ref = txns.find(t=>t.id===txn.tug5Id);
    const newTug8Draft = {
      id: `DRAFT-TUG8-` + uid().slice(-6),
      docType: "TUG8",
      draftLabel:"DRAFT — nomor resmi saat diajukan",
      tug7Id: txn.id,
      tug5Id: txn.tug5Id,
      noReferensiTug7: txn.docNumbers.tug7,
      noReferensiTug5: tug5Ref?.docNumbers?.tug5 || "",
      unitTujuan: txn.unitPenerima || "UPT Surabaya",
      uptPengirimId: txn.uptPengirimId,
      uptId: txn.uptPengirimId,
      namaPekerjaan: `Berdasarkan TUG-7 ${txn.docNumbers.tug7}`,
      lokasiPekerjaan: uptPengirim?.nama || "-",
      perkiraanPembebanan: "", kodePerkiraan: txn.kodeAkun||"",
      stockItems: txn.stockItems.map(si=>({stockId:"", katalogId:si.katalogId, qty:si.qty||si.permintaan||0})),
      keteranganBarang: `Berdasarkan TUG-5 ${tug5Ref?.docNumbers?.tug5||""} dan TUG-7 ${txn.docNumbers.tug7}`,
      stage: "DRAFT_TUG8", // Admin UPT Pengirim harus konfirmasi dulu
      status: "DRAFT",
      penerimaNama:"", penerimaJabatan:"", penerimaUnit:"",
      nopol:"", namaPengemudi:"", simKtp:"", satpamId:"",
      fotoKendaraan:null, fotoSimKtp:null, fotoSuratPengembalian:null, fotoMaterial:[],
      createdAt: Date.now(),
    };
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED", status:"APPROVED", approvedByMgrLogistik:currentUser.id, approvedAtMgrLogistik:Date.now(), tug8DraftId:newTug8Draft.id} : t);
    const allTxns = [...newTxns, newTug8Draft];
    setTxns(allTxns);
    await saveToCloud({txns: allTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug7, {stage:"APPROVED", generated:"DRAFT_TUG8"});
    showToast(`✅ TUG-7 DISETUJUI! Draft TUG-8 otomatis muncul di UPT ${uptPengirim?.nama||"Pengirim"}. 📦`);
  }
  async function rejectTUG7_MgrLogistik(txn, reason) {
    if (!hasRole(currentUser, "MGR_LOGISTIK_UIT")) { showToast("Hanya Manager Logistik UIT yang bisa menolak TUG-7.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug7, {stage:"REJECTED", alasan:reason});
    showToast(`❌ TUG-7 DITOLAK oleh Manager Logistik UIT.`, "error");
  }

  // Draft TUG-8 must be completed in the form; it may not bypass canonical
  // create+submit or browser-side stock handling through a direct confirmation.
  async function konfirmasiDraftTUG8(txn) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin Gudang / TL yang bisa mengkonfirmasi draft TUG-8.","error"); return; }
    openDraftTug9(txn);
    showToast("Lengkapi TUG-8, pilih stok dan jumlah, lalu ajukan untuk membuat nomor resmi canonical.");
  }

  return {
    approveTUG3_TL, rejectTUG3_TL,
    submitTUG4DanLampiran,
    approveTUG3Final_Asman, rejectTUG3Final_Asman,
    approveTUG5_Asman, rejectTUG5_Asman,
    approveTUG5_Manager, rejectTUG5_Manager,
    approveTUG5_MgrULTG, rejectTUG5_MgrULTG, adoptTUG5ULTG,
    openDraftTug9, submitDraftTug9, deleteDraftTug9,
    submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik,
    konfirmasiDraftTUG8,
    enqueueTugNotif: notify,
  };
}
