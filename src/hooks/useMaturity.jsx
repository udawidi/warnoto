import { useState, useEffect, useRef } from "react";
import { uid, fmtDateOnly } from "../lib/utils.js";
import { CLOUD } from "../lib/cloud.js";
import { logAudit } from "../lib/audit.js";
import { hasRole } from "../lib/roles.js";
import { AUDIT_ASPECTS, AUDIT_CATEGORIES } from "../data/auditAspects.js";
import { DEFAULT_UPT_LIST } from "../data/masterUpt.js";
import {
  getDefaultMaturityAuditHistory, upsertMaturityAssessment, upsertMaturityAudit,
  insertMaturity5SAssessment, deleteMaturityAuditRow, loadMaturityAuditHistory,
  loadAspectReviews, upsertAspectReview, upsertMaturityAuditHistory,
} from "../lib/maturitySync.js";
import { buildMaturitySheet } from "../lib/maturitySheetExport.js";
import { exportMaturitySheet } from "../lib/maturityDrive.js";
import {
  MATURITY_WAREHOUSE_TYPES, MATURITY_SHARED_ASPECTS,
  createMaturityWarehouseAssessments, normalizeMaturityAudit,
  calculateMaturityDualScore, maturityAspectKey, isMaturityAspectApplicable,
  countCompletedEvidenceParents, countRequiredEvidenceUnits,
  canonicalMaturityItemId, maturityItemIdsForReview, selectedMaturityRequiredItems,
} from "../lib/maturityWarehouse.js";

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
  // Resync: init useState di atas jalan sekali saat mount, sebelum currentUser/uptList
  // tentu sudah siap (auth async) → bisa nyangkut fallback "UPT Surabaya" selamanya.
  // User UPT biasa (tanpa switcher): selalu paksa ke UPT-nya sendiri kalau beda.
  // Peninjau lintas-UPT (switcher aktif): resync SEKALI saja di awal, lalu biarkan bebas pilih.
  const didInitUptRef = useRef(false);
  useEffect(() => {
    const ownUptNama = (uptList.length ? uptList : DEFAULT_UPT_LIST).find(u => u.id === currentUser?.uptId)?.nama;
    if (!ownUptNama) return;
    if (!canSwitchMaturityUpt) {
      if (ownUptNama !== selectedMaturityUpt) setSelectedMaturityUpt(ownUptNama);
    } else if (!didInitUptRef.current) {
      didInitUptRef.current = true;
      setSelectedMaturityUpt(ownUptNama);
    }
  }, [currentUser?.uptId, uptList, canSwitchMaturityUpt]);
  const [maturityAuditModal, setMaturityAuditModal] = useState(null); // null | {isNew:true,...} (new) | auditObj (edit/review)
  const [maturityAuditForm, setMaturityAuditForm] = useState({ aspekScores:{}, catatanUPT:"", catatanUIT:"", catatanPusat:"", fileUrl:"", fileNama:"", aiAnalysis:{}, warehouseAssessments: createMaturityWarehouseAssessments() });
  const maturityAuditFormRef = useRef(maturityAuditForm);
  maturityAuditFormRef.current = maturityAuditForm;
  const [maturityWarehouseType, setMaturityWarehouseTypeState] = useState(MATURITY_WAREHOUSE_TYPES.PERSEDIAAN);
  const maturityWarehouseTypeRef = useRef(maturityWarehouseType);
  maturityWarehouseTypeRef.current = maturityWarehouseType;
  const [maturityAuditSaving, setMaturityAuditSaving] = useState(false);
  const [maturityDraftSavedAt, setMaturityDraftSavedAt] = useState(null);
  // ponytail: in-flight/dirty flags via ref (bukan state) — tak perlu re-render, cukup gate concurrency
  const autosaveInFlight = useRef(false);
  const autosaveDirty = useRef(false);
  const autosaveWaiters = useRef([]);
  const [maturityAuditEvidence, setMaturityAuditEvidence] = useState({}); // active warehouse: {aspekId: [{url,name,size,itemId,...}]}
  const maturityAuditEvidenceRef = useRef(maturityAuditEvidence);
  maturityAuditEvidenceRef.current = maturityAuditEvidence;
  // Review paralel per-aspek (UIT Check/Reject sebelum UPT kirim semua aspek):
  // {aspekId: {state,note,reviewedBy,reviewedAt}} — hidup di tabel terpisah, dimuat
  // ulang tiap audit dibuka (lihat createMaturityAudit/openMaturityAudit).
  const [maturityAspectReviews, setMaturityAspectReviews] = useState({});
  const [expandedAspek, setExpandedAspek] = useState(null); // kategori aktif di editor
  const [activeAspectId, setActiveAspectId] = useState(null);
  const [aspectPage, setAspectPage] = useState(1);
  const [auditListPage, setAuditListPage] = useState(1); // pagination "Daftar Audit Aktif" (5/hal)
  useEffect(() => { setAuditListPage(1); }, [selectedMaturityUpt]);

  // Nama UPT → id UPT (FK upt.id). Master UPT bisa belum termuat, jadi jatuh ke DEFAULT_UPT_LIST.
  function uptIdByNama(nama) {
    return (uptList.length ? uptList : DEFAULT_UPT_LIST).find(item => item.nama === nama)?.id || "";
  }

  function assessmentFor(type, source = maturityAuditForm) {
    return source?.warehouseAssessments?.[type] || { aspekScores: {}, evidence: {}, aiAnalysis: {} };
  }
  function assessmentsWithActive(form = maturityAuditForm, evidence = maturityAuditEvidence, warehouseType = maturityWarehouseType) {
    const next = { ...createMaturityWarehouseAssessments(), ...(form?.warehouseAssessments || {}) };
    next[warehouseType] = {
      ...assessmentFor(warehouseType, form),
      aspekScores: form?.aspekScores || {}, evidence: evidence || {}, aiAnalysis: form?.aiAnalysis || {},
    };
    return next;
  }
  function setMaturityWarehouseType(type) {
    if (!Object.values(MATURITY_WAREHOUSE_TYPES).includes(type) || type === maturityWarehouseType) return;
    const nextAssessments = assessmentsWithActive();
    const target = nextAssessments[type] || { aspekScores: {}, evidence: {}, aiAnalysis: {} };
    setMaturityWarehouseTypeState(type);
    setMaturityAuditForm(form => ({ ...form, warehouseAssessments: nextAssessments, aspekScores: target.aspekScores || {}, aiAnalysis: target.aiAnalysis || {} }));
    setMaturityAuditEvidence(target.evidence || {});
    setActiveAspectId(null);
    setAspectPage(1);
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
    const warehouseAssessments = createMaturityWarehouseAssessments();
    Object.keys(warehouseAssessments).forEach(type => AUDIT_ASPECTS.forEach(a => {
      if (type === MATURITY_WAREHOUSE_TYPES.PERSEDIAAN || ["3.4", "3.5", "3.6", "3.7", "4.3", "4.4", "5.2", "5.4"].includes(a.id)) {
        warehouseAssessments[type].aspekScores[a.id] = { upt:0, uit:0, pusat:0 };
      }
    }));
    setMaturityWarehouseTypeState(MATURITY_WAREHOUSE_TYPES.PERSEDIAAN);
    const evidence = mergeCurrentMonth5SEvidence({}, selectedMaturityUpt);
    warehouseAssessments.PERSEDIAAN.evidence = evidence;
    setMaturityAuditForm({ aspekScores: warehouseAssessments.PERSEDIAAN.aspekScores, catatanUPT:"", catatanUIT:"", catatanPusat:"", fileUrl:"", fileNama:"", aiAnalysis:{}, warehouseAssessments });
    setMaturityAuditEvidence(evidence);
    setMaturityAspectReviews({}); // audit baru — belum ada review tersimpan
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
    const normalized = normalizeMaturityAudit(audit);
    const assessments = JSON.parse(JSON.stringify(normalized.warehouseAssessments || createMaturityWarehouseAssessments()));
    const active = assessments.PERSEDIAAN || { aspekScores: {}, evidence: {}, aiAnalysis: {} };
    const evidence = mergeCurrentMonth5SEvidence(active.evidence || {}, normalized.upt);
    active.evidence = evidence;
    setMaturityWarehouseTypeState(MATURITY_WAREHOUSE_TYPES.PERSEDIAAN);
    setMaturityAuditForm({ aspekScores: active.aspekScores || {}, catatanUPT: normalized.catatanUPT || "", catatanUIT: normalized.catatanUIT || "", catatanPusat: normalized.catatanPusat || "", fileUrl: normalized.fileUrl || "", fileNama: normalized.fileNama || "", aiAnalysis: active.aiAnalysis || {}, warehouseAssessments: assessments });
    setMaturityAuditEvidence(evidence);
    setExpandedAspek(AUDIT_CATEGORIES[0]?.id || null);
    setActiveAspectId(null);
    setAspectPage(1);
    setMaturityAuditModal(audit);
    setMaturityAspectReviews({});
    if (audit?.id) {
      loadAspectReviews(audit.id).then(rows => {
        setMaturityAspectReviews(Object.fromEntries(rows.map(r => [`${r.aspectId}::${r.itemId}`, r])));
      });
    }
  }
  // UIT/Pusat Check/Reject satu ITEM evidence (bukan seluruh aspek) — paralel
  // dgn UPT yang masih mengunggah item lain (tabel terpisah, tidak menyentuh
  // baris maturity_audits). Key state lokal: "aspectId::itemId".
  async function setAspectReview(aspectId, itemId, state, note = "", warehouseType = maturityWarehouseType) {
    const audit = maturityAuditModal;
    if (!audit?.id) return;
    const uptName = audit.upt || selectedMaturityUpt || "UPT Surabaya";
    const uptId = audit.uptId || uptIdByNama(uptName) || null;
    const reviewedBy = currentUser?.name || currentUser?.username || currentUser?.id || null;
    const typedAspectId = maturityAspectKey(warehouseType, aspectId);
    const saved = await upsertAspectReview({ auditId: audit.id, aspectId: typedAspectId, itemId, uptId, state, note, reviewedBy });
    if (!saved) {
      showToast("Review item tidak tersimpan karena server tidak dapat dihubungi.", "error");
      return;
    }
    setMaturityAspectReviews(current => ({ ...current, [`${typedAspectId}::${itemId}`]: saved }));
    logAudit(currentUser, "UPDATE", "maturity_aspect_review", `${audit.id}:${typedAspectId}:${itemId}`, { state });
  }
  // Nilai final Pusat 1 ITEM evidence (1-5) — merge dengan review existing
  // (state/note UIT tidak boleh terhapus oleh upsert ini). Setelah tersimpan,
  // agregasi ke aspekScores[aspek].pusat = mean(finalScore item non-auto aspek
  // itu), hanya kalau SEMUA item non-auto aspek sudah dinilai (else biarkan
  // 0 → calcMaturityScore jatuh ke fallback uit/upt/rasio).
  async function setAspectItemScore(aspectId, itemId, score, warehouseType = maturityWarehouseType) {
    const audit = maturityAuditModal;
    if (!audit?.id) return;
    const typedAspectId = maturityAspectKey(warehouseType, aspectId);
    const key = `${typedAspectId}::${itemId}`;
    const reviewIds = maturityItemIdsForReview(itemId);
    const existing = reviewIds.map(id => maturityAspectReviews[`${typedAspectId}::${id}`]).find(Boolean)
      || (warehouseType === MATURITY_WAREHOUSE_TYPES.PERSEDIAAN ? reviewIds.map(id => maturityAspectReviews[`${aspectId}::${id}`]).find(Boolean) : undefined)
      || {};
    const uptName = audit.upt || selectedMaturityUpt || "UPT Surabaya";
    const uptId = audit.uptId || uptIdByNama(uptName) || null;
    const reviewedBy = existing.reviewedBy || currentUser?.name || currentUser?.username || currentUser?.id || null;
    const saved = await upsertAspectReview({ auditId: audit.id, aspectId: typedAspectId, itemId, uptId, state: existing.state || "PENDING", note: existing.note || "", reviewedBy, finalScore: score });
    if (!saved) {
      showToast("Nilai item tidak tersimpan karena server tidak dapat dihubungi.", "error");
      return;
    }
    const nextReviews = { ...maturityAspectReviews, [key]: saved };
    setMaturityAspectReviews(nextReviews);
    const aspect = AUDIT_ASPECTS.find(a => a.id === aspectId);
    if (aspect) {
      const evidence = maturityAuditEvidenceRef.current;
      const scorable = selectedMaturityRequiredItems(aspect, evidence[aspectId] || []).filter(item => {
        const files = (evidence[aspectId] || []).filter(f => canonicalMaturityItemId(f.itemId) === item.id);
        return !(files.length > 0 && files.every(f => f.auto === true)); // exclude item auto-filled Form 5S
      });
      const scores = scorable.map(item => nextReviews[`${typedAspectId}::${item.id}`]?.finalScore);
      if (scorable.length > 0 && scores.every(s => s != null)) {
        const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        setMaturityAuditForm(f => ({ ...f, aspekScores: { ...f.aspekScores, [aspectId]: { ...(f.aspekScores[aspectId] || {}), pusat: mean } } }));
      }
    }
    logAudit(currentUser, "UPDATE", "maturity_aspect_review", `${audit.id}:${typedAspectId}:${itemId}`, { finalScore: score });
  }
  // Skor akhir: getScore pilih pusat>uit>upt(rasio bukti), rata 5 kategori,
  // A = avg(5 kategori)*0.75 + B = avg(sarana_prasarana,k3,teknologi)*0.25;
  // level dibucket dari threshold 1.5 / 2.5 / 3.5 / 4.5.
  function calcMaturityScore(scores = {}, evidence = {}, aiAnalysis = {}) {
    if (scores?.PERSEDIAAN || scores?.ATTB_MRWI) {
      const dual = calculateMaturityDualScore(AUDIT_ASPECTS, scores, calculateItemLevel);
      return { c1: dual.persediaan.categories.tata_kelola || 0, c2: dual.persediaan.categories.tenaga_kerja || 0, c3: dual.persediaan.categories.sarana_prasarana || 0, c4: dual.persediaan.categories.k3 || 0, c5: dual.persediaan.categories.teknologi || 0, itemA: dual.itemA, itemB: dual.itemB, total: dual.total, score: dual.score, level: dual.level, aspectScores: dual.persediaan.aspectScores, warehouseScores: dual };
    }
    const getAspectScore = (a) => {
      const centerscore = scores[a.id]?.pusat || 0;
      if (centerscore > 0) return centerscore;
      const uitscore = scores[a.id]?.uit || 0;
      if (uitscore > 0) return uitscore;
      const uptscore = scores[a.id]?.upt || 0;
      if (uptscore > 0) return uptscore;
      const aiLevel = Math.round(aiAnalysis?.[a.id]?.result?.estimasiLevel || 0);
      if (aiLevel >= 1 && aiLevel <= 5) return aiLevel;
      const uploadedCount = countCompletedEvidenceParents(a, evidence[a.id] || []);
      return calculateItemLevel(uploadedCount, countRequiredEvidenceUnits(a));
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
  function calcMaturityLevel(scores, evidence = {}, aiAnalysis = {}) {
    return calcMaturityScore(scores, evidence, aiAnalysis).level;
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
      const warehouseAssessments = assessmentsWithActive();
      const scoreResult = calcMaturityScore(warehouseAssessments);
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
        formatVersion: 2,
        warehouseAssessments,
        aspekScores: warehouseAssessments.PERSEDIAAN.aspekScores,
        evidence: warehouseAssessments.PERSEDIAAN.evidence,
        catatanUPT: maturityAuditForm.catatanUPT,
        catatanUIT: maturityAuditForm.catatanUIT,
        catatanPusat: maturityAuditForm.catatanPusat,
        fileUrl: maturityAuditForm.fileUrl,
        fileNama: maturityAuditForm.fileNama,
        aiAnalysis: warehouseAssessments.PERSEDIAAN.aiAnalysis || {},
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
  // Set target nilai maturity per baris riwayat (UPT/tahun/semester) — item harus
  // sudah ada (row lahir dari trigger DB saat audit FINAL), jadi ini UPDATE murni,
  // bukan CREATE. Gate role dicek di komponen (canSwitchMaturityUpt) sebelum tombol
  // ini kepanggil; di sini tetap upsert row apa adanya (server RLS jadi pagar terakhir).
  async function saveMaturityTarget(item, target) {
    const entry = { ...item, target };
    const saved = await upsertMaturityAuditHistory(entry);
    if (!saved) {
      showToast("Target tidak tersimpan karena server tidak dapat dihubungi.", "error");
      return;
    }
    setMaturityAuditHistory(current => current.map(h => h.id === entry.id ? entry : h));
    logAudit(currentUser, "UPDATE", "maturity_audit_history_target", entry.id, { target });
    showToast(`Target ${entry.upt} S${entry.semester} ${entry.tahun} disimpan.`);
  }
  // Autosave draft audit yang sedang dibuka (evidence/skor UPT) TANPA menutup
  // modal, TANPA toast, TANPA append history — beda dari saveMaturityAudit yang
  // dipicu tombol "Simpan Draft" manual. Gate izin (canScoreUPT) ada di sisi
  // pemanggil (komponen), bukan guardMaturityWrite, supaya kegagalan izin tak
  // memicu toast berulang saat mengetik.
  async function autosaveMaturityDraft(evidenceOverride) {
    if (!maturityAuditModal?.id) return false;
    if (autosaveInFlight.current) {
      autosaveDirty.current = true;
      return new Promise(resolve => autosaveWaiters.current.push(resolve));
    }
    autosaveInFlight.current = true;
    let currentResult = false;
    try {
      const ev = evidenceOverride || maturityAuditEvidenceRef.current;
      const audit = maturityAuditModal;
      const isExistingAudit = maturityAudits.some(item => item.id === audit.id);
      const { isNew: _isNew, ...auditData } = audit;
      const form = maturityAuditFormRef.current;
      const warehouseType = maturityWarehouseTypeRef.current;
      const warehouseAssessments = assessmentsWithActive(form, ev, warehouseType);
      const savedSnapshot = JSON.stringify({ warehouseAssessments, catatanUPT: form.catatanUPT, catatanUIT: form.catatanUIT, catatanPusat: form.catatanPusat, fileUrl: form.fileUrl, fileNama: form.fileNama });
      const scoreResult = calcMaturityScore(warehouseAssessments);
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
        formatVersion: 2,
        warehouseAssessments,
        aspekScores: warehouseAssessments.PERSEDIAAN.aspekScores,
        evidence: warehouseAssessments.PERSEDIAAN.evidence,
        catatanUPT: form.catatanUPT,
        catatanUIT: form.catatanUIT,
        catatanPusat: form.catatanPusat,
        fileUrl: form.fileUrl,
        fileNama: form.fileNama,
        aiAnalysis: warehouseAssessments.PERSEDIAAN.aiAnalysis || {},
        createdAt,
        createdBy: auditData.createdBy || currentUser.id,
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
        history: auditData.history || [], // tidak append — bukan aksi tahap
      };
      const saved = await upsertMaturityAudit(entry);
      if (!saved) return false; // diam-diam — retry alami di siklus autosave berikutnya
      setMaturityAudits(current => isExistingAudit ? current.map(a => a.id === entry.id ? entry : a) : [entry, ...current]);
      // Sinkronkan id/isNew ke modal supaya autosave berikutnya jadi UPDATE, bukan CREATE (hindari duplikat 23505)
      setMaturityAuditModal(prev => (prev && prev.id === entry.id) ? { ...prev, ...entry, isNew: false } : prev);
      const latestForm = maturityAuditFormRef.current;
      const latestAssessments = assessmentsWithActive(latestForm, maturityAuditEvidenceRef.current, maturityWarehouseTypeRef.current);
      const latestSnapshot = JSON.stringify({ warehouseAssessments: latestAssessments, catatanUPT: latestForm.catatanUPT, catatanUIT: latestForm.catatanUIT, catatanPusat: latestForm.catatanPusat, fileUrl: latestForm.fileUrl, fileNama: latestForm.fileNama });
      if (latestSnapshot !== savedSnapshot) autosaveDirty.current = true;
      // Jangan laporkan "tersimpan" sebelum perubahan yang datang saat request
      // berjalan ikut disimpan oleh putaran berikutnya.
      if (!autosaveDirty.current) setMaturityDraftSavedAt(Date.now());
      currentResult = true;
      return true;
    } finally {
      autosaveInFlight.current = false;
      if (autosaveDirty.current) {
        autosaveDirty.current = false;
        const result = await autosaveMaturityDraft();
        autosaveWaiters.current.splice(0).forEach(resolve => resolve(result));
        return result;
      } else {
        autosaveWaiters.current.splice(0).forEach(resolve => resolve(currentResult));
      }
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
    const normalized = normalizeMaturityAudit(audit);
    const assessments = normalized.warehouseAssessments || createMaturityWarehouseAssessments();
    const rows = [["Gudang", "Aspek ID", "Deskripsi", "Skor UPT", "Skor UIT", "Skor Pusat", "Evidence"]];
    Object.entries(assessments).forEach(([type, assessment]) => AUDIT_ASPECTS.forEach(a => {
      if (!assessment.aspekScores?.[a.id] && !assessment.evidence?.[a.id]) return;
      const s = assessment.aspekScores?.[a.id] || {};
      const evi = assessment.evidence?.[a.id] || [];
      rows.push([type, a.id, a.title, calculateItemLevel(countCompletedEvidenceParents(a, evi), countRequiredEvidenceUnits(a)), s.uit || 0, s.pusat || 0, evi.map(e => e.name).join("; ") || "—"]);
    }));
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
      const normalized = normalizeMaturityAudit(audit);
      const scoreResult = calcMaturityScore(normalized.warehouseAssessments || {});
      const tahun = new Date(audit.createdAt || Date.now()).getFullYear();
      const namaUpt = audit.upt || selectedMaturityUpt;
      const { base64, filename } = await buildMaturitySheet({ scoresByWarehouse: { PERSEDIAAN: scoreResult.warehouseScores?.persediaan?.aspectScores || {}, ATTB_MRWI: scoreResult.warehouseScores?.attbMrwi?.aspectScores || {} }, tahun, namaUpt });
      const result = await exportMaturitySheet({ base64, filename, namaUpt });
      showToast("Google Sheet Maturity berhasil dibuat.");
      return result;
    } catch (err) {
      showToast(err?.message || "Export Google Sheet Maturity gagal.", "error");
      throw err;
    }
  }

  // Export PPT editable — cover, ringkasan 5 kategori, 1 slide per kategori
  // (tabel aspek + insight AI ringkas kalau ada), slide rekomendasi menyeluruh.
  // Sibling exportMaturityAuditExcel/exportMaturityGoogleSheet: dynamic import,
  // try/catch → showToast error (pola exportGoogleSheet).
  async function exportMaturityAuditPptx(audit) {
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      const NAVY = "1E3A5F", BLUE = "2563EB", GRAY = "64748B";
      const normalized = normalizeMaturityAudit(audit);
      const warehouseAssessments = normalized.warehouseAssessments || createMaturityWarehouseAssessments();
      const scoreResult = calcMaturityScore(warehouseAssessments);
      const namaUpt = audit.upt || selectedMaturityUpt || "UPT";
      const tahun = new Date(audit.createdAt || Date.now()).getFullYear();
      const warehouseConfigs = [
        { type: MATURITY_WAREHOUSE_TYPES.PERSEDIAAN, label: "Persediaan", score: scoreResult.warehouseScores?.persediaan, assessment: warehouseAssessments.PERSEDIAAN || {} },
        { type: MATURITY_WAREHOUSE_TYPES.ATTB_MRWI, label: "ATTB/MRWI", score: scoreResult.warehouseScores?.attbMrwi, assessment: warehouseAssessments.ATTB_MRWI || {} },
      ];
      const catLevel = v => Math.max(1, Math.min(5, Math.round(v)));

      // Slide 1 — Cover
      const cover = pptx.addSlide();
      cover.background = { color: NAVY };
      cover.addText("Audit Maturity Gudang", { x: 0.5, y: 1.3, w: 9, h: 0.8, fontSize: 32, bold: true, color: "FFFFFF" });
      cover.addText(namaUpt, { x: 0.5, y: 2.1, w: 9, h: 0.6, fontSize: 22, color: "CBD5E1" });
      cover.addText(`Periode: ${tahun}`, { x: 0.5, y: 2.7, w: 9, h: 0.4, fontSize: 14, color: "94A3B8" });
      cover.addText(`Level ${scoreResult.level} — ${MATURITY_LEVELS[scoreResult.level] || "—"}`, { x: 0.5, y: 3.4, w: 9, h: 0.5, fontSize: 20, bold: true, color: "FFFFFF" });
      cover.addText(`Skor Total: ${scoreResult.total.toFixed(2)} | Status: ${MATURITY_WORKFLOW_LABEL[audit.status] || audit.status || "—"}`, { x: 0.5, y: 3.9, w: 9, h: 0.4, fontSize: 14, color: "CBD5E1" });

      // Slide 2 — subtotal per gudang dan ringkasan kategori
      const sum = pptx.addSlide();
      sum.addText("Ringkasan Dua Gudang", { x: 0.4, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: NAVY });
      const subtotalRows = [[
        { text: "Gudang", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
        { text: "Subtotal", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
        { text: "Bobot", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
        { text: "Level", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
      ]];
      warehouseConfigs.forEach((warehouse, index) => {
        const value = warehouse.score?.score || 0;
        subtotalRows.push([warehouse.label, value.toFixed(2), index === 0 ? "75%" : "25%", `${catLevel(value)} — ${MATURITY_LEVELS[catLevel(value)] || "—"}`]);
      });
      subtotalRows.push(["Gabungan", scoreResult.total.toFixed(2), "100%", `${scoreResult.level} — ${MATURITY_LEVELS[scoreResult.level] || "—"}`]);
      sum.addTable(subtotalRows, { x: 0.4, y: 0.9, w: 9, colW: [3.1, 1.7, 1.5, 2.7], fontSize: 12, border: { type: "solid", color: "CBD5E1", pt: 0.5 } });

      const sumRows = [[
        { text: "Gudang", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
        { text: "Kategori", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
        { text: "Skor Rata", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
      ]];
      warehouseConfigs.forEach(warehouse => AUDIT_CATEGORIES.forEach(cat => {
        const v = warehouse.score?.categories?.[cat.id] || 0;
        sumRows.push([warehouse.label, cat.label, `${v.toFixed(2)} — ${MATURITY_LEVELS[catLevel(v)] || "—"}`]);
      }));
      sum.addTable(sumRows, { x: 0.4, y: 3.1, w: 9, colW: [2.2, 3.5, 3.3], fontSize: 10, border: { type: "solid", color: "CBD5E1", pt: 0.5 } });

      // Slide per kategori — tabel aspek + insight AI ringkas
      AUDIT_CATEGORIES.forEach(cat => {
        const slide = pptx.addSlide();
        slide.addText(cat.label, { x: 0.4, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: NAVY });
        const aspects = warehouseConfigs.flatMap(warehouse => AUDIT_ASPECTS
          .filter(a => a.category === cat.id && isMaturityAspectApplicable(a.id, warehouse.type))
          .map(aspect => ({ aspect, warehouse })));
        const rows = [[
          { text: "Gudang", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
          { text: "Aspek", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
          { text: "UPT", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
          { text: "UIT", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
          { text: "Pusat", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
          { text: "AI Est.", options: { bold: true, fill: { color: BLUE }, color: "FFFFFF" } },
        ]];
        aspects.forEach(({ aspect: a, warehouse }) => {
          const s = warehouse.assessment.aspekScores?.[a.id] || {};
          const ai = warehouse.assessment.aiAnalysis?.[a.id]?.result;
          rows.push([warehouse.label, `${a.id} ${a.title}`, s.upt || "—", s.uit || "—", s.pusat || "—", ai?.estimasiLevel != null ? String(ai.estimasiLevel) : "—"]);
        });
        slide.addTable(rows, { x: 0.4, y: 0.85, w: 9, colW: [1.2, 3.3, 1.1, 1.1, 1.1, 1.1], fontSize: 9, border: { type: "solid", color: "CBD5E1", pt: 0.5 } });

        // Insight AI ringkas — hanya aspek yang punya aiAnalysis, di bawah tabel
        const insightLines = aspects
          .map(({ aspect: a, warehouse }) => ({ a, warehouse, ai: warehouse.assessment.aiAnalysis?.[a.id]?.result }))
          .filter(x => x.ai)
          .map(({ a, ai }) => {
            const gap = (ai.gap || [])[0];
            const rekom = (ai.rekomendasi || [])[0];
            return `${warehouse.label} ${a.id}: ${ai.alasanPenilaian || "—"}${gap ? ` | Gap: ${gap}` : ""}${rekom ? ` | Rekom: ${rekom}` : ""}`;
          });
        if (insightLines.length) {
          const yStart = 0.85 + 0.35 * (aspects.length + 1) / 2 + 0.3; // perkiraan tinggi tabel
          slide.addText(insightLines.join("\n"), { x: 0.4, y: Math.min(yStart, 4.2), w: 9, h: 5 - Math.min(yStart, 4.2), fontSize: 9, color: GRAY, valign: "top" });
        }
      });

      // Slide akhir — rekomendasi menyeluruh
      const rec = pptx.addSlide();
      rec.addText("Rekomendasi Menyeluruh", { x: 0.4, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: NAVY });
      const allRekom = [];
      const allMenuju = [];
      warehouseConfigs.forEach(warehouse => AUDIT_ASPECTS.filter(a => isMaturityAspectApplicable(a.id, warehouse.type)).forEach(a => {
        const ai = warehouse.assessment.aiAnalysis?.[a.id]?.result;
        if (!ai) return;
        (ai.rekomendasi || []).forEach(r => allRekom.push(`${warehouse.label} ${a.id}: ${r}`));
        (ai.menujuLevelMaksimal || []).forEach(m => allMenuju.push(`${warehouse.label} ${a.id}: ${m.poin ? `[${m.poin}] ` : ""}${m.aksi || ""}`));
      }));
      let y = 0.9;
      if (allRekom.length) {
        rec.addText("Rekomendasi:", { x: 0.4, y, w: 9, h: 0.3, fontSize: 13, bold: true, color: BLUE });
        y += 0.35;
        rec.addText(allRekom.slice(0, 12).join("\n"), { x: 0.4, y, w: 9, h: 1.6, fontSize: 9, color: "1E293B", valign: "top" });
        y += 1.7;
      }
      if (allMenuju.length) {
        rec.addText("Menuju Level 5:", { x: 0.4, y, w: 9, h: 0.3, fontSize: 13, bold: true, color: BLUE });
        y += 0.35;
        rec.addText(allMenuju.slice(0, 10).join("\n"), { x: 0.4, y, w: 9, h: 1.4, fontSize: 9, color: "1E293B", valign: "top" });
        y += 1.5;
      }
      const catatan = [
        audit.catatanUPT ? `Catatan UPT: ${audit.catatanUPT}` : "",
        audit.catatanUIT ? `Catatan UIT: ${audit.catatanUIT}` : "",
        audit.catatanPusat ? `Catatan Pusat: ${audit.catatanPusat}` : "",
      ].filter(Boolean);
      if (catatan.length) {
        rec.addText(catatan.join("\n"), { x: 0.4, y: Math.min(y, 6.5), w: 9, h: 6.9 - Math.min(y, 6.5), fontSize: 9, color: GRAY, valign: "top" });
      }

      const safeUpt = namaUpt.replace(/[^a-zA-Z0-9]+/g, "_");
      await pptx.writeFile({ fileName: `Maturity_${safeUpt}_${tahun}.pptx` });
      showToast("File PPT berhasil didownload!");
    } catch (err) {
      showToast(err?.message || "Export PPT Maturity gagal.", "error");
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
    maturityWarehouseType, setMaturityWarehouseType,
    maturityAuditSaving, setMaturityAuditSaving,
    maturityDraftSavedAt,
    autosaveMaturityDraft,
    maturityAuditEvidence, setMaturityAuditEvidence,
    maturityAspectReviews, setAspectReview, setAspectItemScore,
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
    saveMaturityTarget,
    deleteMaturityAudit,
    exportMaturityAuditExcel,
    exportMaturityGoogleSheet,
    exportMaturityAuditPptx,
  };
}
