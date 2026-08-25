import { useState, useEffect, useRef } from "react";
import { uid, fmtDateOnly } from "../lib/utils.js";
import { CLOUD } from "../lib/cloud.js";
import { isDemoMode } from "../lib/demo.js";
import { logAudit } from "../lib/audit.js";
import { hasRole } from "../lib/roles.js";
import { AUDIT_ASPECTS, AUDIT_CATEGORIES } from "../data/auditAspects.js";
import { DEFAULT_UPT_LIST } from "../data/masterUpt.js";
import {
  getDefaultMaturityAuditHistory, upsertMaturityAssessment, upsertMaturityAudit,
  insertMaturity5SAssessment, deleteMaturityAuditRow, loadMaturityAuditHistory,
} from "../lib/maturitySync.js";
import { buildMaturitySheet } from "../lib/maturitySheetExport.js";
import { exportMaturitySheet } from "../lib/maturityDrive.js";

// Sama persis dengan readCachedList() di App.jsx — duplikasi 1 baris di sini
// lebih murah & lebih aman (hindari circular import App.jsx <-> hook) daripada
// export/import lintas file untuk helper sekecil ini.
function readCachedList(key) {
  try { return JSON.parse(localStorage.getItem('warnoto_' + key) || "null"); } catch { return null; }
}

// Domain "Penilaian Maturity" (audit berjenjang UPT → UIT → Pusat + Form 5S) —
// diekstrak murni dari PLNWarehouse() (App.jsx), TANPA perubahan logic.
// deps: cross-dependency dari luar domain maturity (dioper dari komponen pemanggil).
export function useMaturity({ currentUser, showToast, uptList, currentUserUptId, askConfirmDelete, MATURITY_LEVELS, MATURITY_WORKFLOW_LABEL }) {
  const [maturityAssessments, setMaturityAssessments] = useState(() => readCachedList("pln_maturity_v1") ?? []); // cache fallback read-only; DB adalah canonical
  const [maturityAudits, setMaturityAudits] = useState(() => readCachedList("pln_maturity_audits_v1") ?? []); // cache fallback read-only; DB adalah canonical
  // Fallback default hanya berlaku untuk UPT pemilik angkanya (lihat getDefaultMaturityAuditHistory);
  // profil cache sudah terbaca di atas, jadi UPT user tersedia sejak render pertama.
  const [maturityAuditHistory, setMaturityAuditHistory] = useState(() => readCachedList("pln_maturity_audit_history_v1") ?? getDefaultMaturityAuditHistory(currentUser?.uptId)); // cache/fallback read-only; DB adalah canonical
  const [maturity5SAssessments, setMaturity5SAssessments] = useState(() => readCachedList("pln_maturity_5s_assessments_v1") ?? []); // cache fallback read-only; DB adalah canonical

  const [maturityModal, setMaturityModal] = useState(false);
  const [maturityForm, setMaturityForm] = useState({ level:3, catatan:"", tanggalAsesmen:Date.now() });
  // ─── Penilaian Maturity (audit workflow) — UI state ───────────────────
  const [maturitySubTab, setMaturitySubTab] = useState("dashboard"); // dashboard | pelaksanaan | history | 5s
  // Peninjau lintas UPT saja. MANAGER dibuang: tiap UPT punya tepat satu MANAGER
  // dan cakupannya HANYA UPT itu (keputusan user 2026-08-02).
  const canSwitchMaturityUpt = hasRole(currentUser, "ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT","ADMIN_LOG_PUSAT","SUPERADMIN");
  const [selectedMaturityUpt, setSelectedMaturityUpt] = useState(() => {
    const match = (uptList.length ? uptList : DEFAULT_UPT_LIST).find(u => u.id === currentUser?.uptId);
    return match?.nama || "UPT Surabaya";
  });
  // Scoping UI Maturity pakai id UPT (FK), bukan kecocokan string nama — nama di
  // Master UPT bisa berbeda ejaan dengan nama yang tersimpan di baris audit.
  const selectedMaturityUptId = uptIdByNama(selectedMaturityUpt);
  const [maturityAuditModal, setMaturityAuditModal] = useState(null); // null | {isNew:true,...} (new) | auditObj (edit/review)
  const [maturityAuditForm, setMaturityAuditForm] = useState({ aspekScores:{}, catatanUPT:"", catatanUIT:"", catatanPusat:"", fileUrl:"", fileNama:"" });
  const [maturityAuditSaving, setMaturityAuditSaving] = useState(false);
  const [maturityDraftSavedAt, setMaturityDraftSavedAt] = useState(null);
  // ponytail: in-flight/dirty flags via ref (bukan state) — tak perlu re-render, cukup gate concurrency
  const autosaveInFlight = useRef(false);
  const autosaveDirty = useRef(false);
  const [maturityAuditEvidence, setMaturityAuditEvidence] = useState({}); // {aspekId: [{url,name,size,itemId,...}]}
  const maturityAuditEvidenceRef = useRef(maturityAuditEvidence);
  maturityAuditEvidenceRef.current = maturityAuditEvidence;
  const [expandedAspek, setExpandedAspek] = useState(null); // kategori aktif di editor
  const [activeAspectId, setActiveAspectId] = useState(null);
  const [aspectPage, setAspectPage] = useState(1);
  const [auditListPage, setAuditListPage] = useState(1); // pagination "Daftar Audit Aktif" (5/hal)
  useEffect(() => { setAuditListPage(1); }, [selectedMaturityUpt]);

  // Nama UPT → id UPT (FK upt.id). Master UPT bisa belum termuat, jadi jatuh ke DEFAULT_UPT_LIST.
  function uptIdByNama(nama) {
    return (uptList.length ? uptList : DEFAULT_UPT_LIST).find(item => item.nama === nama)?.id || "";
  }

  // Gate tulis Maturity — cerminan persis policy "Maturity audits update by stage":
  // pelaku ditentukan oleh status BARIS SAAT INI, bukan status tujuan.
  //   DRAFT/SELF_ASSESSMENT/REVISION → ADMIN/TL UPT-nya (can_write_maturity_upt)
  //   REVIEW_UIT                     → ADMIN_UIT/ASMAN_LOG_UIT/MGR_LOGISTIK_UIT (can_review_maturity_uit)
  //   REVIEW_PUSAT/FINAL             → ADMIN_LOG_PUSAT (can_review_maturity_pusat)
  // SUPERADMIN lolos di semua jenjang (hasRole), sama seperti helper SQL-nya —
  // tanpa itu audit yang macet di meja UIT tidak bisa ditolong siapa pun.
  // Dicek di klien supaya penolakan server tidak muncul sebagai
  // "server tidak dapat dihubungi".
  // `status` null = aksi di luar jenjang audit (asesmen/5S/hapus) → tetap ADMIN/TL.
  function guardMaturityWrite(aksi, status = null) {
    if (isDemoMode()) { showToast(`Mode demo: ${aksi} tidak disimpan ke server.`, "error"); return false; }
    if (status === "REVIEW_UIT") {
      if (hasRole(currentUser, "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT")) return true; // hasRole = SUPERADMIN ikut lolos (lihat can_review_maturity_uit)
      showToast(`Audit ada di tahap Review UIT — hanya Admin / Asman / Manager Logistik UIT yang boleh ${aksi}.`, "error");
      return false;
    }
    if (status === "REVIEW_PUSAT" || status === "FINAL") {
      if (hasRole(currentUser, "ADMIN_LOG_PUSAT")) return true;
      showToast(`Audit ada di tahap Pusat — hanya Admin Logistik Pusat yang boleh ${aksi}.`, "error");
      return false;
    }
    if (!hasRole(currentUser, "ADMIN", "TL")) { showToast(`Hanya Admin Gudang / TL Logistik yang boleh ${aksi}.`, "error"); return false; }
    return true;
  }

  // Simpan 1 entri baru riwayat Maturity Level Gudang (khusus Admin, input manual)
  async function saveMaturityAssessment(form) {
    if (!guardMaturityWrite("menyimpan Asesmen Maturity")) return false;
    const entry = { id:`MAT-${uid().slice(-8)}`, level:form.level, catatan:form.catatan||"", tanggalAsesmen:form.tanggalAsesmen||Date.now(), createdBy:currentUser.id, createdAt:Date.now() };
    const saved = await upsertMaturityAssessment(entry);
    if (!saved) {
      showToast("Asesmen Maturity tidak tersimpan karena server tidak dapat dihubungi.", "error");
      return false;
    }
    setMaturityAssessments(current => [entry, ...current.filter(item => item.id !== entry.id)]);
    logAudit(currentUser, "CREATE", "maturity_assessment", entry.id, { level: entry.level });
    showToast("✅ Asesmen Maturity Level disimpan!");
  }

  // ─── Penilaian Maturity — audit berjenjang (UPT → UIT → Pusat) ─────────
  // Skor per-aspek: dari rasio bukti ter-upload, atau override manual UIT/Pusat.
  // Form 5S bersifat append-only supaya audit ulang pada periode yang sama
  // tetap mempunyai jejak tersendiri. State/cache baru diperbarui setelah
  // INSERT self-host berhasil, bukan ketika pengguna hanya menekan tombol.
  async function saveMaturity5SAssessment(form) {
    if (!guardMaturityWrite("mengisi Form 5S")) return null;
    const uptNama = form.upt || selectedMaturityUpt || "UPT Surabaya";
    const entry = {
      ...form,
      id: `M5S-${uid().slice(-10)}`,
      upt: uptNama,
      // Wajib: kolom upt_id jadi NOT NULL + RLS per-UPT di GELOMBANG B.
      uptId: form.uptId || uptIdByNama(uptNama) || currentUserUptId || currentUser?.uptId || "",
      createdAt: Date.now(),
      createdBy: currentUser?.id || null,
    };
    const saved = await insertMaturity5SAssessment(entry);
    if (!saved) {
      showToast("Checklist 5S belum tersimpan karena server tidak dapat dihubungi.", "error");
      return null;
    }
    setMaturity5SAssessments(current => {
      const next = [saved, ...current.filter(item => item.id !== saved.id)];
      CLOUD.set("pln_maturity_5s_assessments_v1", next);
      return next;
    });
    logAudit(currentUser, "CREATE", "maturity_5s_assessment", saved.id, {
      upt: saved.upt, gudang: saved.gudangNama, tahun: saved.tahun,
      bulan: saved.bulan, scorePercent: saved.scorePercent,
    });
    return saved;
  }

  function getCurrentMonth5SEvidence(upt) {
    const nowD = new Date();
    const latest = maturity5SAssessments
      .filter(item => (item.upt || "UPT Surabaya") === (upt || selectedMaturityUpt || "UPT Surabaya")
        && item.tahun === nowD.getFullYear() && item.bulan === nowD.getMonth() + 1)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (!latest) return [];
    const savedAt = latest.createdAt || Date.now();
    const timestamp = new Date(savedAt).toLocaleString("id-ID");
    const user = latest.auditor || "Pengguna";
    const checklistEvidence = {
      id: "k3_5s_chk",
      name: `Checklist 5S — ${latest.gudangNama || "Gudang"}, ${latest.bulan}/${latest.tahun} (${Number(latest.scorePercent || 0).toFixed(1)}%)`,
      url: `#form-5s-history-${latest.id}`,
      size: 0,
      auto: true,
      source: "Form Pengisian 5S",
      assessment5SId: latest.id,
      meta: `Diisi oleh: ${user} | Skor: ${Number(latest.scorePercent || 0).toFixed(2)}% (${latest.totalChecked}/${latest.totalItems}) | Disimpan: ${timestamp}`,
      savedAt,
    };
    const photos = (latest.samplePhotos || []).map((photo, index) => ({
      id: "k3_5s_foto",
      name: `Foto Sampling 5S ${index + 1} — ${photo.name || "Foto"}`,
      url: photo.url,
      size: photo.size || 0,
      auto: true,
      source: "Form Pengisian 5S",
      assessment5SId: latest.id,
      meta: `Referensi Form 5S: ${latest.id} | Disimpan: ${timestamp}`,
    }));
    return [checklistEvidence, ...photos];
  }

  function mergeCurrentMonth5SEvidence(evidence, upt) {
    const existing = Object.entries(evidence || {}).reduce((next, [aspectId, files]) => {
      next[aspectId] = Array.isArray(files) ? [...files] : [];
      return next;
    }, {});
    const current5S = getCurrentMonth5SEvidence(upt);
    if (!current5S.length) return existing;
    // Bukti otomatis 5S mewakili rekam periode berjalan yang paling baru;
    // bukti manual 4.5 tetap utuh. Ini mencegah skor maturity menghitung
    // beberapa Form 5S sebagai evidence yang berbeda.
    const nonCurrent5S = (existing["4.5"] || []).filter(file => file?.source !== "Form Pengisian 5S");
    return { ...existing, "4.5": [...current5S, ...nonCurrent5S] };
  }

  function calculateItemLevel(uploadedCount, totalRequired) {
    if (uploadedCount === 0) return 1;
    if (uploadedCount === totalRequired) return 5;
    const ratio = uploadedCount / totalRequired;
    if (ratio < 0.35) return 2;
    if (ratio < 0.7) return 3;
    return 4;
  }
  function createMaturityAudit() {
    // Batasi 1 audit baru per bulan kalender per UPT
    const nowD = new Date();
    const existingAudit = maturityAudits.find(a => {
      if ((a.upt || "UPT Surabaya") !== selectedMaturityUpt) return false;
      const d = new Date(a.createdAt);
      return d.getMonth() === nowD.getMonth() && d.getFullYear() === nowD.getFullYear();
    });
    if (existingAudit) {
      showToast(`⚠️ UPT ini sudah punya audit bulan ini (dibuat ${fmtDateOnly(existingAudit.createdAt)}). Audit baru cuma bisa dibuat 1x per bulan.`, "error");
      return;
    }
    const scores = {};
    AUDIT_ASPECTS.forEach(a => { scores[a.id] = { upt:0, uit:0, pusat:0 }; });
    setMaturityAuditForm({ aspekScores: scores, catatanUPT:"", catatanUIT:"", catatanPusat:"", fileUrl:"", fileNama:"" });
    setMaturityAuditEvidence(mergeCurrentMonth5SEvidence({}, selectedMaturityUpt));
    setExpandedAspek(AUDIT_CATEGORIES[0]?.id || null);
    setActiveAspectId(null);
    setAspectPage(1);
    // ID dibuat saat draft dibuka agar evidence Google Drive dapat memiliki
    // stable key sebelum tombol Simpan Audit ditekan; record audit tetap hanya
    // dipersist ketika alur Simpan yang ada dijalankan.
    setMaturityAuditModal({ id: `MA-${uid().slice(-8)}`, isNew:true, upt: selectedMaturityUpt, createdAt: Date.now() });
    setMaturitySubTab("pelaksanaan");
  }
  function openMaturityAudit(audit) {
    setMaturityAuditForm({ aspekScores: JSON.parse(JSON.stringify(audit.aspekScores || {})), catatanUPT: audit.catatanUPT || "", catatanUIT: audit.catatanUIT || "", catatanPusat: audit.catatanPusat || "", fileUrl: audit.fileUrl || "", fileNama: audit.fileNama || "" });
    setMaturityAuditEvidence(mergeCurrentMonth5SEvidence(JSON.parse(JSON.stringify(audit.evidence || {})), audit.upt));
    setExpandedAspek(AUDIT_CATEGORIES[0]?.id || null);
    setActiveAspectId(null);
    setAspectPage(1);
    setMaturityAuditModal(audit);
  }
  // Skor akhir: getScore pilih pusat>uit>upt(rasio bukti), rata 5 kategori,
  // A = avg(5 kategori)*0.75 + B = avg(sarana_prasarana,k3,teknologi)*0.25;
  // level dibucket dari threshold 1.5 / 2.5 / 3.5 / 4.5.
  function calcMaturityScore(scores = {}, evidence = {}) {
    const getAspectScore = (a) => {
      const centerscore = scores[a.id]?.pusat || 0;
      if (centerscore > 0) return centerscore;
      const uitscore = scores[a.id]?.uit || 0;
      if (uitscore > 0) return uitscore;
      const uptscore = scores[a.id]?.upt || 0;
      if (uptscore > 0) return uptscore;
      const uploadedCount = (evidence[a.id] || []).length;
      return calculateItemLevel(uploadedCount, a.requiredEvidence.length);
    };
    const getCatAvg = (catId) => {
      const catAspects = AUDIT_ASPECTS.filter(a => a.category === catId);
      if (catAspects.length === 0) return 0;
      const sum = catAspects.reduce((acc, a) => acc + getAspectScore(a), 0);
      return sum / catAspects.length;
    };
    const c1 = getCatAvg("tata_kelola");
    const c2 = getCatAvg("tenaga_kerja");
    const c3 = getCatAvg("sarana_prasarana");
    const c4 = getCatAvg("k3");
    const c5 = getCatAvg("teknologi");
    const itemA = ((c1 + c2 + c3 + c4 + c5) / 5) * 0.75;
    const itemB = ((c3 + c4 + c5) / 3) * 0.25;
    const total = itemA + itemB;
    let level = 1;
    if (total >= 4.5) level = 5;
    else if (total >= 3.5) level = 4;
    else if (total >= 2.5) level = 3;
    else if (total >= 1.5) level = 2;
    else level = 1;
    // aspectScores: level efektif per-aspek (bulat, sama seperti dipakai kalkulasi
    // di atas) — dipakai export Sheet Maturity, bukan cuma ringkasan kategori.
    const aspectScores = Object.fromEntries(AUDIT_ASPECTS.map(a => [a.id, getAspectScore(a)]));
    return { c1, c2, c3, c4, c5, itemA, itemB, total, level, aspectScores };
  }
  function calcMaturityLevel(scores, evidence = {}) {
    return calcMaturityScore(scores, evidence).level;
  }
  async function saveMaturityAudit(audit, newStatus) {
    // Yang menentukan siapa boleh bertindak adalah status LAMA (klausa USING policy);
    // audit baru belum punya baris di server, jadi diperlakukan sebagai DRAFT.
    if (!guardMaturityWrite("menyimpan Audit Maturity", audit?.isNew ? "DRAFT" : (audit?.status || "DRAFT"))) return;
    setMaturityAuditSaving(true);
    try {
      // Draft Drive sekarang sudah menerima ID stabil sebelum Simpan. ID saja
      // bukan berarti record sudah ada di state/UI; bedakan dengan lookup
      // canonical agar audit baru tetap masuk sebagai CREATE, bukan UPDATE.
      const isExistingAudit = maturityAudits.some(item => item.id === audit?.id);
      const { isNew: _isNew, ...auditData } = audit || {};
      const scores = maturityAuditForm.aspekScores;
      const scoreResult = calcMaturityScore(scores, maturityAuditEvidence);
      const level = scoreResult.level;
      const createdAt = auditData.createdAt || Date.now();
      const createdDate = new Date(createdAt);
      const periodKey = auditData.periodKey || `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
      const uptName = auditData.upt || selectedMaturityUpt || "UPT Surabaya";
      const uptId = auditData.uptId || uptIdByNama(uptName) || null;
      const entry = {
        ...(isExistingAudit ? auditData : {}),
        id: auditData.id || `MA-${uid().slice(-8)}`,
        upt: uptName,
        uptId,
        status: newStatus,
        level,
        score: Number(scoreResult.total.toFixed(2)),
        periodKey,
        aspekScores: scores,
        evidence: maturityAuditEvidence,
        catatanUPT: maturityAuditForm.catatanUPT,
        catatanUIT: maturityAuditForm.catatanUIT,
        catatanPusat: maturityAuditForm.catatanPusat,
        fileUrl: maturityAuditForm.fileUrl,
        fileNama: maturityAuditForm.fileNama,
        createdAt,
        createdBy: auditData.createdBy || currentUser.id,
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
        history: [...(auditData.history || []), { action: newStatus, by: currentUser.id, at: Date.now() }],
      };
      const saved = await upsertMaturityAudit(entry);
      if (!saved) {
        showToast("Audit Maturity tidak tersimpan karena server tidak dapat dihubungi.", "error");
        return;
      }
      setMaturityAudits(current => isExistingAudit ? current.map(a => a.id === entry.id ? entry : a) : [entry, ...current]);
      logAudit(currentUser, isExistingAudit ? "UPDATE" : "CREATE", "maturity_audit", entry.id, { status: newStatus, level, upt: entry.upt });
      if (newStatus === "FINAL") {
        // Trigger DB menerbitkan baris history sendiri saat audit masuk FINAL,
        // jadi state & cache klien langsung basi — muat ulang dari server.
        const freshHistory = await loadMaturityAuditHistory();
        if (freshHistory) {
          setMaturityAuditHistory(freshHistory);
          CLOUD.set("pln_maturity_audit_history_v1", freshHistory);
        }
      }
      setMaturityAuditModal(null);
      showToast(`Audit ${entry.upt} disimpan — ${MATURITY_WORKFLOW_LABEL[newStatus]}${newStatus === "FINAL" ? " (Nilai Final)" : ""}`);
    } finally { setMaturityAuditSaving(false); }
  }
  // Autosave draft audit yang sedang dibuka (evidence/skor UPT) TANPA menutup
  // modal, TANPA toast, TANPA append history — beda dari saveMaturityAudit yang
  // dipicu tombol "Simpan Draft" manual. Gate izin (canScoreUPT) ada di sisi
  // pemanggil (komponen), bukan guardMaturityWrite, supaya kegagalan izin tak
  // memicu toast berulang saat mengetik.
  async function autosaveMaturityDraft(evidenceOverride) {
    if (!maturityAuditModal?.id) return;
    if (autosaveInFlight.current) { autosaveDirty.current = true; return; }
    autosaveInFlight.current = true;
    try {
      const ev = evidenceOverride || maturityAuditEvidenceRef.current;
      const audit = maturityAuditModal;
      const isExistingAudit = maturityAudits.some(item => item.id === audit.id);
      const { isNew: _isNew, ...auditData } = audit;
      const scores = maturityAuditForm.aspekScores;
      const scoreResult = calcMaturityScore(scores, ev);
      const createdAt = auditData.createdAt || Date.now();
      const createdDate = new Date(createdAt);
      const periodKey = auditData.periodKey || `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
      const uptName = auditData.upt || selectedMaturityUpt || "UPT Surabaya";
      const uptId = auditData.uptId || uptIdByNama(uptName) || null;
      const entry = {
        ...(isExistingAudit ? auditData : {}),
        id: audit.id,
        upt: uptName,
        uptId,
        status: auditData.status || "DRAFT", // status TETAP — autosave bukan pindah tahap
        level: scoreResult.level,
        score: Number(scoreResult.total.toFixed(2)),
        periodKey,
        aspekScores: scores,
        evidence: ev,
        catatanUPT: maturityAuditForm.catatanUPT,
        catatanUIT: maturityAuditForm.catatanUIT,
        catatanPusat: maturityAuditForm.catatanPusat,
        fileUrl: maturityAuditForm.fileUrl,
        fileNama: maturityAuditForm.fileNama,
        createdAt,
        createdBy: auditData.createdBy || currentUser.id,
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
        history: auditData.history || [], // tidak append — bukan aksi tahap
      };
      const saved = await upsertMaturityAudit(entry);
      if (!saved) return; // diam-diam — retry alami di siklus autosave berikutnya
      setMaturityAudits(current => isExistingAudit ? current.map(a => a.id === entry.id ? entry : a) : [entry, ...current]);
      // Sinkronkan id/isNew ke modal supaya autosave berikutnya jadi UPDATE, bukan CREATE (hindari duplikat 23505)
      setMaturityAuditModal(prev => (prev && prev.id === entry.id) ? { ...prev, ...entry, isNew: false } : prev);
      setMaturityDraftSavedAt(Date.now());
    } finally {
      autosaveInFlight.current = false;
      if (autosaveDirty.current) { autosaveDirty.current = false; autosaveMaturityDraft(); }
    }
  }
  async function deleteMaturityAudit(id) {
    if (!guardMaturityWrite("menghapus Audit Maturity")) return;
    const audit = maturityAudits.find(a => a.id === id);
    const evidenceCount = Object.values(audit?.evidence || {}).flat().length;
    // Hapus audit dijaga ekstra: 2 konfirmasi berturut + peringatan jumlah evidence,
    // karena satu audit bisa memuat banyak berkas hasil upload.
    askConfirmDelete({
      title: "Hapus Audit Maturity? (1/2)",
      message: <>Anda akan menghapus audit <b>{audit?.upt || "UPT"}</b> (Level {audit?.level || "?"}). Audit ini memuat <b>{evidenceCount} berkas evidence</b> terunggah beserta seluruh penilaiannya.</>,
      warning: "Menghapus audit menghapus catatan penilaian & tautan evidence-nya. Tindakan ini TIDAK bisa dibatalkan.",
      confirmLabel: "Lanjut Hapus…",
      onConfirm: () => askConfirmDelete({
        title: "Konfirmasi Terakhir (2/2)",
        message: <>Yakin hapus <b>PERMANEN</b> audit <b>{audit?.upt || "UPT"}</b>? {evidenceCount} berkas evidence &amp; semua nilai akan hilang dan tak bisa dikembalikan.</>,
        warning: "Ini konfirmasi terakhir — setelah ini data hilang permanen.",
        confirmLabel: "🗑️ Ya, Hapus Permanen",
        onConfirm: async () => {
        const deleted = await deleteMaturityAuditRow(id);
        if (!deleted) {
          // Bisa gagal koneksi ATAU ditolak server (angka audit memang tidak
          // boleh dihapus). Apa pun sebabnya, state TIDAK boleh ikut berubah.
          showToast("Audit Maturity TIDAK dihapus — ditolak server atau server tidak dapat dihubungi. Data di server tetap utuh.", "error");
          return;
        }
        setMaturityAudits(current => current.filter(a => a.id !== id));
        logAudit(currentUser, "DELETE", "maturity_audit", id, { upt: audit?.upt });
        showToast("Riwayat audit maturity berhasil dihapus.");
        if (maturityAuditModal && maturityAuditModal.id === id) setMaturityAuditModal(null);
      }
      })
    });
  }
  async function exportMaturityAuditExcel(audit) {
    const XLSX = await import("xlsx");
    const rows = [["Aspek ID", "Deskripsi", "Skor UPT", "Skor UIT", "Skor Pusat", "Evidence"]];
    AUDIT_ASPECTS.forEach(a => {
      const s = audit.aspekScores?.[a.id] || {};
      const evi = audit.evidence?.[a.id] || [];
      const uploadedCount = evi.length;
      const uptScore = calculateItemLevel(uploadedCount, a.requiredEvidence.length);
      rows.push([a.id, a.title, uptScore, s.uit || 0, s.pusat || 0, evi.map(e => e.name).join("; ") || "—"]);
    });
    rows.push([]);
    rows.push(["Level Akhir", MATURITY_LEVELS[audit.level] || "—"]);
    rows.push(["Status", MATURITY_WORKFLOW_LABEL[audit.status] || audit.status]);
    rows.push(["Catatan UPT", audit.catatanUPT || ""]);
    rows.push(["Catatan UIT", audit.catatanUIT || ""]);
    rows.push(["Catatan Pusat", audit.catatanPusat || ""]);
    rows.push(["Lampiran Umum", audit.fileNama || audit.fileUrl || ""]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Audit Maturity");
    XLSX.writeFile(wb, `Audit_Maturity_${audit.id}.xlsx`);
    showToast("File Excel berhasil didownload!");
  }
  // Export ke Google Sheet berformat baku (template pemerintah) — isi nilai
  // per-aspek ke folder Drive khusus. Fase 1: manual, tanpa tabel/skema baru.
  async function exportMaturityGoogleSheet(audit) {
    try {
      const scoreResult = calcMaturityScore(audit.aspekScores || {}, audit.evidence || {});
      const tahun = new Date(audit.createdAt || Date.now()).getFullYear();
      const namaUpt = audit.upt || selectedMaturityUpt;
      const { base64, filename } = await buildMaturitySheet({ scoresByAspek: scoreResult.aspectScores, tahun, namaUpt });
      const result = await exportMaturitySheet({ base64, filename, namaUpt });
      showToast("Google Sheet Maturity berhasil dibuat.");
      return result;
    } catch (err) {
      showToast(err?.message || "Export Google Sheet Maturity gagal.", "error");
      throw err;
    }
  }

  return {
    maturityAssessments, setMaturityAssessments,
    maturityAudits, setMaturityAudits,
    maturityAuditHistory, setMaturityAuditHistory,
    maturity5SAssessments, setMaturity5SAssessments,
    maturityModal, setMaturityModal,
    maturityForm, setMaturityForm,
    maturitySubTab, setMaturitySubTab,
    canSwitchMaturityUpt,
    selectedMaturityUpt, setSelectedMaturityUpt,
    selectedMaturityUptId,
    maturityAuditModal, setMaturityAuditModal,
    maturityAuditForm, setMaturityAuditForm,
    maturityAuditSaving, setMaturityAuditSaving,
    maturityDraftSavedAt,
    autosaveMaturityDraft,
    maturityAuditEvidence, setMaturityAuditEvidence,
    expandedAspek, setExpandedAspek,
    activeAspectId, setActiveAspectId,
    aspectPage, setAspectPage,
    auditListPage, setAuditListPage,
    uptIdByNama,
    guardMaturityWrite,
    saveMaturityAssessment,
    saveMaturity5SAssessment,
    getCurrentMonth5SEvidence,
    mergeCurrentMonth5SEvidence,
    calculateItemLevel,
    createMaturityAudit,
    openMaturityAudit,
    calcMaturityScore,
    calcMaturityLevel,
    saveMaturityAudit,
    deleteMaturityAudit,
    exportMaturityAuditExcel,
    exportMaturityGoogleSheet,
  };
}
