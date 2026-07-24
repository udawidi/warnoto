import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChartBar, FolderSimple, Pulse, UploadSimple, FileText, Check, CaretRight, CaretLeft, Sparkle, CheckCircle, Info } from "@phosphor-icons/react";
import { AUDIT_ASPECTS, AUDIT_CATEGORIES } from "../data/auditAspects.js";

// =========================================================================
// CONSTANTS & ICONS
// =========================================================================

const MATURITY_LEVELS = { 1: "Basic", 2: "Developing", 3: "Defined", 4: "Managed", 5: "Excellent" };
const MATURITY_WORKFLOW_LABEL = { DRAFT: "Draft", SELF_ASSESSMENT: "Self Assessment (UPT)", REVIEW_UIT: "Review UIT", REVISION: "Revisi", FINAL: "Nilai Final (Pusat)" };
const MATURITY_WORKFLOW_COLOR = { DRAFT: "#64748b", SELF_ASSESSMENT: "#3b82f6", REVIEW_UIT: "#f59e0b", REVISION: "#ef4444", FINAL: "#1d4ed8" };

// Temporary hard-stop: no Drive relay, object URL, base64, or file bytes may be
// attached to a Maturity record while the canonical persistence rollout is active.
function uploadFileToDrive() {
  return Promise.reject(new Error("Upload evidence Maturity sedang dinonaktifkan."));
}

// Icon set diselaraskan ke @phosphor-icons/react (dipakai app-wide di 3 varian
// dashboard). Dibungkus di bawah nama lama `Icons.*` supaya seluruh call-site
// (<Icons.Chart /> dst) tidak berubah — murni ganti glyph, bukan logika.
// Warna ikut `currentColor` sehingga otomatis theme-aware lewat prop warna induk.
const Icons = {
  Chart: (p) => <ChartBar size={18} weight="fill" {...p} />,
  Folder: (p) => <FolderSimple size={18} weight="fill" {...p} />,
  Activity: (p) => <Pulse size={18} weight="bold" {...p} />,
  Upload: (p) => <UploadSimple size={14} weight="bold" {...p} />,
  File: (p) => <FileText size={14} {...p} />,
  Check: (p) => <Check size={14} weight="bold" {...p} />,
  ChevronRight: (p) => <CaretRight size={14} weight="bold" {...p} />,
  ChevronLeft: (p) => <CaretLeft size={14} weight="bold" {...p} />,
  Sparkles: (p) => <Sparkle size={16} weight="fill" {...p} />,
  AutoCheck: (p) => <CheckCircle size={13} weight="fill" {...p} />,
  Info: (p) => <Info size={16} weight="bold" {...p} />,
};

// =========================================================================
// CATATAN PORT: DashboardMaturityBanner versi sumber TIDAK di-export di sini.
// Project ini sudah punya widget `src/components/DashboardMaturityBanner.jsx`
// tersendiri (dipakai 3 varian dashboard). File ini HANYA meng-export
// MaturityAuditEditor + Form5STab (kontrak port Tahap 2).
// =========================================================================

// =========================================================================
// COMPONENT: MaturityAuditEditor
// =========================================================================

export function MaturityAuditEditor({
  maturityAuditModal,
  setMaturityAuditModal,
  currentUser,
  hasRole,
  C,
  sty,
  isMobile,
  maturityAuditForm,
  setMaturityAuditForm,
  maturityAuditEvidence,
  setMaturityAuditEvidence,
  expandedAspek,
  setExpandedAspek,
  activeAspectId: propsActiveAspectId,
  setActiveAspectId: propsSetActiveAspectId,
  aspectPage,
  setAspectPage,
  saveMaturityAudit,
  deleteMaturityAudit,
  maturityAuditSaving,
  calculateItemLevel,
  selectedUpt
}) {
  const [internalActiveAspectId, setInternalActiveAspectId] = useState(null);
  const [uploadingItems, setUploadingItems] = useState({});
  const [, setUploadError] = useState("");
  const activeAspectId = propsActiveAspectId ?? internalActiveAspectId;
  const setActiveAspectId = (id) => {
    setInternalActiveAspectId(id);
    if (propsSetActiveAspectId) propsSetActiveAspectId(id);
  };
  const is3D = false; // Disabled to fix click target registration bugs
  const isEdit = maturityAuditModal !== "new";
  const audit = isEdit ? maturityAuditModal : {};
  const currentUptName = selectedUpt || audit.upt || "UPT Surabaya";
  const isUPT = hasRole(currentUser, "ADMIN", "TL", "ASMAN", "MANAGER");
  const isUIT = hasRole(currentUser, "ADMIN_UIT", "MGR_LOGISTIK_UIT");
  const isPusat = hasRole(currentUser, "SUPERADMIN", "MANAGER");
  const status = audit.status || "DRAFT";
  const canScoreUPT = isUPT && (status === "DRAFT" || status === "SELF_ASSESSMENT" || status === "REVISION");
  const canScoreUIT = isUIT && status === "REVIEW_UIT";
  const canScorePusat = isPusat && status === "FINAL";

  const scoreBtn = (active, color) => ({
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: `1.5px solid ${active ? color : C.border}`,
    background: active ? color : "transparent",
    color: active ? "white" : C.muted,
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
    boxShadow: active ? `0 4px 10px ${color}40` : "none"
  });

  const getScore = (item, roleType) => {
    if (roleType === "pusat") {
      const pScore = maturityAuditForm.aspekScores[item.id]?.pusat;
      if (pScore > 0) return pScore;
    }
    if (roleType === "uit" || roleType === "pusat") {
      const uScore = maturityAuditForm.aspekScores[item.id]?.uit;
      if (uScore > 0) return uScore;
    }
    const uptScore = maturityAuditForm.aspekScores[item.id]?.upt;
    if (uptScore > 0) return uptScore;
    const uploadedCount = (maturityAuditEvidence[item.id] || []).length;
    return calculateItemLevel(uploadedCount, item.requiredEvidence.length);
  };

  const getCategoryScore = (catId, roleType) => {
    const catItems = AUDIT_ASPECTS.filter(a => a.category === catId);
    if (catItems.length === 0) return 0;
    const sum = catItems.reduce((acc, item) => acc + getScore(item, roleType), 0);
    return sum / catItems.length;
  };

  const activeRoleType = isUIT ? "uit" : (isPusat ? "pusat" : "upt");

  const scoreCat1 = getCategoryScore("tata_kelola", activeRoleType);
  const scoreCat2 = getCategoryScore("tenaga_kerja", activeRoleType);
  const scoreCat3 = getCategoryScore("sarana_prasarana", activeRoleType);
  const scoreCat4 = getCategoryScore("k3", activeRoleType);
  const scoreCat5 = getCategoryScore("teknologi", activeRoleType);

  const matlevScoreA = ((scoreCat1 + scoreCat2 + scoreCat3 + scoreCat4 + scoreCat5) / 5) * 0.75;
  const matlevScoreB = ((scoreCat3 + scoreCat4 + scoreCat5) / 3) * 0.25;
  const matlevTotalScore = matlevScoreA + matlevScoreB;

  const overallScoreVal = matlevTotalScore;

  const completedAspectsCount = AUDIT_ASPECTS.filter(
    a => (maturityAuditEvidence[a.id] || []).length >= a.requiredEvidence.length
  ).length;

  const uitReviewedCount = AUDIT_ASPECTS.filter(a => (maturityAuditForm.aspekScores[a.id]?.uit || 0) > 0).length;
  const pusatReviewedCount = AUDIT_ASPECTS.filter(a => (maturityAuditForm.aspekScores[a.id]?.pusat || 0) > 0).length;

  const activeCategory = AUDIT_CATEGORIES.find(c => c.id === expandedAspek) || AUDIT_CATEGORIES[0];
  const activeCategoryIdx = AUDIT_CATEGORIES.findIndex(c => c.id === expandedAspek) + 1;

  const categoryAspects = AUDIT_ASPECTS.filter(a => a.category === activeCategory.id);
  const pageSize = 4;
  const totalPages = Math.ceil(categoryAspects.length / pageSize);
  const paginatedAspects = categoryAspects.slice((aspectPage - 1) * pageSize, aspectPage * pageSize);

  const activeAspect = AUDIT_ASPECTS.find(a => a.id === activeAspectId);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", paddingBottom: 40 }}>
      {/* Main Header — banner navy korporat selaras .kpi-banner / .operations-hero--summary-only */}
      <div className="maturity-hero">
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(219,234,254,.85)", textTransform: "uppercase", letterSpacing: "1px" }}>MATLEV AUDIT SYSTEM</span>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: "#fff", margin: "3px 0 0", letterSpacing: "-0.2px" }}>Input Evidence Audit {currentUptName}</h2>
          <p style={{ fontSize: 12, color: "rgba(219,234,254,.82)", margin: "5px 0 0", lineHeight: 1.45 }}>Area kerja pengelolaan kelengkapan bukti fisik dan penilaian skor kematangan.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          <span style={{ padding: "5px 13px", borderRadius: 999, background: `${MATURITY_WORKFLOW_COLOR[status]}26`, color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: ".3px", border: `1px solid ${MATURITY_WORKFLOW_COLOR[status]}66`, boxShadow: `inset 0 0 0 1px ${MATURITY_WORKFLOW_COLOR[status]}33` }}>
            {MATURITY_WORKFLOW_LABEL[status]}
          </span>
        </div>
      </div>

      <div>
        {/* Metric Cards Grid */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
          <div style={{ ...sty.card, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${C.accent}1a`, color: C.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icons.Chart />
            </div>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Skor Terlihat (View)</span>
              <strong style={{ fontSize: 22, fontWeight: 800, color: C.text, display: "block", marginTop: 2, fontVariantNumeric: "tabular-nums", letterSpacing: "-.2px" }}>{overallScoreVal > 0 ? overallScoreVal.toFixed(2) : "0.00"}</strong>
              <span style={{ fontSize: 12, color: C.muted }}>Penilaian role {activeRoleType.toUpperCase()}</span>
            </div>
          </div>
          <div style={{ ...sty.card, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${C.accent}1a`, color: C.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icons.Folder />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Kelengkapan Dokumen</span>
              <strong style={{ fontSize: 22, fontWeight: 800, color: C.text, display: "block", marginTop: 2, fontVariantNumeric: "tabular-nums", letterSpacing: "-.2px" }}>{completedAspectsCount}/{AUDIT_ASPECTS.length} Aspek</strong>
              <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(completedAspectsCount / AUDIT_ASPECTS.length) * 100}%`, background: C.accent, borderRadius: 2 }} />
              </div>
            </div>
          </div>
          <div style={{ ...sty.card, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${C.yellow}1f`, color: C.yellow, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icons.Activity />
            </div>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Progress Review</span>
              <strong style={{ fontSize: 22, fontWeight: 800, color: C.text, display: "block", marginTop: 2, fontVariantNumeric: "tabular-nums", letterSpacing: "-.2px" }}>{uitReviewedCount}/{AUDIT_ASPECTS.length}</strong>
              <span style={{ fontSize: 12, color: C.muted }}>{pusatReviewedCount} Disetujui Pusat</span>
            </div>
          </div>
        </div>

        {/* Aspect Detail / Upload Screen */}
        {activeAspectId && activeAspect ? (() => {
          const aspectFiles = maturityAuditEvidence[activeAspect.id] || [];
          const uploadedCount = aspectFiles.length;
          const calculatedLevel = calculateItemLevel(uploadedCount, activeAspect.requiredEvidence.length);
          const statusSkorUIT = maturityAuditForm.aspekScores[activeAspect.id]?.uit || 0;
          const statusSkorPusat = maturityAuditForm.aspekScores[activeAspect.id]?.pusat || 0;

          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12, transform: is3D ? "translateZ(8px)" : "none" }}>
                <div>
                  <span style={{ fontSize: 12, color: C.accent, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>Upload Evidence Wajib</span>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: "2px 0" }}>{activeAspect.id} {activeAspect.title}</h3>
                  <span style={{ fontSize: 12, color: C.muted }}>Lengkapi dokumen bukti untuk penentuan level akhir.</span>
                </div>
                <button style={{ ...sty.btn("ghost", "sm"), border: `1.5px solid ${C.border}`, borderRadius: 8, background: C.surface, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, color: C.text }} onClick={() => setActiveAspectId(null)}>
                  <Icons.ChevronLeft /> Kembali ke Daftar Aspek
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(260px, 300px)", gap: 16, width: "100%", maxWidth: "100%" }}>
                {/* Left Column */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                  {/* Drive Banner */}
                  <div style={{
                    background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)",
                    borderRadius: 12,
                    padding: "16px 20px",
                    color: "white",
                    marginBottom: 4,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    boxShadow: "0 2px 8px rgba(29, 78, 216, 0.2)",
                    transform: is3D ? "translateZ(10px)" : "none"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", flexShrink: 0 }}>
                        <Icons.File />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "1px" }}>BERKAS EVIDENCE OFFICIAL</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "white" }}>Pencatatan Evidence Audit</div>
                        <div style={{ fontSize: 12, color: "#dbeafe", marginTop: 2 }}>Upload file dan foto sedang dinonaktifkan sementara. Audit hanya menyimpan metadata penilaian.</div>
                      </div>
                    </div>
                  </div>

                  {activeAspect.requiredEvidence.map((eviItem, eviIdx) => {
                    const itemFiles = aspectFiles.filter(f => f.itemId === eviItem.id);
                    const isUploaded = itemFiles.length > 0;
                    const isAutoFilled = isUploaded && itemFiles.every(f => f.auto === true);
                    const targetFolderPath = `${currentUptName} / ${activeCategory.label} / Aspek ${activeAspect.id} / ${eviItem.label}`;
                    return (
                      <div key={eviItem.id} style={{
                        background: isAutoFilled ? `${C.green}14` : C.surface,
                        border: `1.5px solid ${isAutoFilled ? C.green : isUploaded ? C.accent : C.border}`,
                        borderRadius: 12,
                        padding: "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
                        transform: is3D ? "translateZ(10px)" : "none",
                        transition: "all 0.2s"
                      }}>
                        <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", gap: 14, flexWrap: isMobile ? "wrap" : "nowrap", width: "100%" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                            <div style={{
                              width: 30,
                              height: 30,
                              borderRadius: "50%",
                              background: isAutoFilled ? C.green : isUploaded ? C.accent : C.border,
                              color: isUploaded ? "white" : C.muted,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 800,
                              flexShrink: 0,
                              marginTop: 2,
                              border: `1.5px solid ${isAutoFilled ? C.green : isUploaded ? C.accent : C.border}`
                            }}>
                              {isUploaded ? <Icons.Check /> : eviIdx + 1}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{eviItem.label}</span>
                                {isAutoFilled && (
                                  <span style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    padding: "2px 8px",
                                    borderRadius: 20,
                                    background: `${C.green}22`,
                                    color: C.green,
                                    border: `1px solid ${C.green}55`,
                                    letterSpacing: "0.3px",
                                    textTransform: "uppercase",
                                    whiteSpace: "nowrap"
                                  }}>
                                    ✓ Auto dari Form 5S
                                  </span>
                                )}
                              </div>
                              <div style={{
                                fontSize: 12,
                                color: C.accent,
                                background: `${C.accent}12`,
                                border: `1px solid ${C.accent}33`,
                                padding: "3px 10px",
                                borderRadius: 6,
                                marginTop: 6,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                maxWidth: "100%",
                                minWidth: 0,
                                boxSizing: "border-box"
                              }}>
                                <span style={{ fontWeight: 800, fontSize: 12, color: C.accent, flexShrink: 0 }}>📍 Sub-Bagian Target:</span>
                                <span style={{ fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{targetFolderPath}</span>
                              </div>
                            </div>
                          </div>

                          {canScoreUPT && !isAutoFilled && <span style={{ fontSize: 12, color: C.muted, fontWeight: 800 }}>Upload bukti sementara nonaktif</span>}
                          {canScoreUPT && !isAutoFilled && (
                            <label style={{
                              padding: "8px 18px",
                              borderRadius: 10,
                              background: uploadingItems[eviItem.id] ? "#fffbeb" : isUploaded ? C.surface : "linear-gradient(135deg, #2563eb, #1d4ed8)",
                              color: uploadingItems[eviItem.id] ? "#b45309" : isUploaded ? C.text : "#ffffff",
                              border: `1.5px solid ${uploadingItems[eviItem.id] ? "#fde68a" : isUploaded ? C.border : "#1d4ed8"}`,
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: uploadingItems[eviItem.id] ? "wait" : "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                              marginLeft: isMobile ? 0 : "auto",
                              boxShadow: isUploaded ? "0 1px 2px rgba(0,0,0,0.05)" : "0 3px 10px rgba(37,99,235,0.25)",
                              transition: "all 0.15s ease"
                            }}>
                              <Icons.Upload />
                              <span>{uploadingItems[eviItem.id] ? "⌛ Mengunggah..." : isUploaded ? "+ Tambah / Ganti File" : "Pilih File / Foto"}</span>
                              <input
                                type="file"
                                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt,.csv"
                                multiple
                                disabled
                                hidden
                                onChange={async (e) => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length === 0) return;

                                  setUploadError("");
                                  setUploadingItems(prev => ({ ...prev, [eviItem.id]: true }));
                                  try {
                                    const uploadedFiles = await Promise.all(files.map(f => uploadFileToDrive({
                                      file: f,
                                      upt: currentUptName,
                                      category: activeCategory.label,
                                      aspectId: activeAspect.id,
                                      itemLabel: eviItem.label
                                    })));
                                    const newFiles = uploadedFiles.map(res => ({
                                      itemId: eviItem.id,
                                      itemLabel: eviItem.label,
                                      aspectId: activeAspect.id,
                                      aspectTitle: activeAspect.title,
                                      category: activeCategory.label,
                                      upt: currentUptName,
                                      folderPath: res.folderPath || targetFolderPath,
                                      driveRepositoryUrl: res.targetFolderId ? `https://drive.google.com/drive/folders/${res.targetFolderId}` : null,
                                      name: res.name,
                                      size: res.size,
                                      url: res.url,
                                      isDrive: res.isDrive,
                                      syncedToDrive: res.syncedToDrive
                                    }));

                                    setMaturityAuditEvidence(prev => {
                                      const cur = prev[activeAspect.id] || [];
                                      return { ...prev, [activeAspect.id]: [...cur, ...newFiles] };
                                    });
                                  } catch (err) {
                                    console.warn("Upload evidence Maturity gagal:", err);
                                    setUploadError(err?.message || "Upload evidence Maturity gagal.");
                                  } finally {
                                    setUploadingItems(prev => ({ ...prev, [eviItem.id]: false }));
                                    e.target.value = "";
                                  }
                                }}
                              />
                            </label>
                          )}
                          {canScoreUPT && isAutoFilled && (
                            <div style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              background: `${C.green}22`,
                              color: C.green,
                              border: `1.5px solid ${C.green}55`,
                              fontSize: 12,
                              fontWeight: 800,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              whiteSpace: "nowrap",
                              flexShrink: 0
                            }}>
                              <Icons.Check /> Terisi Otomatis
                            </div>
                          )}
                        </div>

                        <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 8 }}>
                          {isUploaded ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {itemFiles.map((f, fi) => {
                                const globalIdx = aspectFiles.indexOf(f);
                                const targetUrl = f.url || "#";
                                const fullFolderPath = f.folderPath || targetFolderPath;
                                return (
                                  <div key={fi} style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    background: isAutoFilled ? `${C.green}1f` : `${C.accent}14`,
                                    border: `1.5px solid ${isAutoFilled ? `${C.green}55` : `${C.accent}44`}`,
                                    padding: "4px 10px",
                                    borderRadius: 8,
                                    fontSize: 12
                                  }}>
                                    <span style={{ color: isAutoFilled ? C.green : C.accent }}>
                                      <Icons.File />
                                    </span>
                                    <a
                                      href={targetUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        color: C.text,
                                        fontWeight: 700,
                                        maxWidth: 240,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        textDecoration: "none"
                                      }}
                                      title={`File: ${f.name}\n📍 Sub-Bagian: ${fullFolderPath}`}
                                    >
                                      {f.name}
                                    </a>
                                    <span style={{
                                       fontSize: 12,
                                       color: f.isDrive ? "#0284c7" : "#b45309",
                                       background: f.isDrive ? "#e0f2fe" : "#fef3c7",
                                       padding: "1px 6px",
                                       borderRadius: 4,
                                       fontWeight: 700
                                     }}>
                                       {f.isDrive ? "✓ Google Drive" : "⚡ Berkas Lokal"}
                                     </span>
                                    {canScoreUPT && !f.auto && (
                                      <button
                                        onClick={() => {
                                          setMaturityAuditEvidence(prev => {
                                            const cur = prev[activeAspect.id] || [];
                                            return { ...prev, [activeAspect.id]: cur.filter((_, ci) => ci !== globalIdx) };
                                          });
                                        }}
                                        style={{ background: "transparent", border: "none", color: C.red, cursor: "pointer", fontWeight: 800, padding: 0, marginLeft: 4, fontSize: 14 }}
                                        title="Hapus file"
                                      >×</button>
                                    )}
                                  </div>
                                );
                              })}
                              {isAutoFilled && itemFiles[0]?.meta && (
                                <div style={{ fontSize: 12, color: C.green, marginTop: 2, width: "100%" }}>
                                  {itemFiles[0].meta}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>
                              Belum melampirkan berkas bukti fisik.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Column */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                  <div style={{ ...sty.card }}>
                    <h4 style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      <Icons.Info /> Catatan Evidence
                    </h4>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, color: C.muted, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 6 }}>
                      {activeAspect.catatan.map((n, ni) => (
                        <li key={ni} style={{ position: "relative", paddingLeft: 16 }}>
                          <span style={{ position: "absolute", left: 2, top: 0, color: C.accent, fontWeight: 700 }}>•</span>{n}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ ...sty.card }}>
                    <h4 style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      <Icons.Activity /> Penentuan Level
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {activeAspect.levels.map((lvlText, lvlIdx) => {
                        const lvlNum = lvlIdx + 1;
                        const isActive = calculatedLevel === lvlNum;
                        return (
                          <div key={lvlIdx} style={{
                            padding: "10px 12px",
                            border: `1.5px solid ${isActive ? C.accent : C.border}`,
                            borderRadius: 8,
                            background: isActive ? `${C.accent}14` : "transparent",
                            borderLeft: isActive ? `3px solid ${C.accent}` : `1.5px solid ${C.border}`,
                            fontSize: 12,
                            color: isActive ? C.text : C.muted,
                            fontWeight: isActive ? 600 : 400,
                            transition: "all 0.15s ease"
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <strong>Level {lvlNum}</strong>
                              {isActive && <span style={{ background: C.accent, color: "white", padding: "1px 6px", borderRadius: 4, fontSize: 12, fontWeight: 800 }}>TERVERIFIKASI</span>}
                            </div>
                            <div style={{ marginTop: 2, lineHeight: 1.3 }}>{lvlText.replace(/^Level \d:\s*/, "")}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ ...sty.card, background: C.bg }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ color: C.accent }}><Icons.Sparkles /></span>
                      <h4 style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>Rekomendasi AI</h4>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{activeAspect.aiNote}</p>
                  </div>

                  {(canScoreUIT || canScorePusat || statusSkorUIT > 0 || statusSkorPusat > 0) && (
                    <div style={{ ...sty.card, borderLeft: `3px solid ${C.yellow}` }}>
                      <h4 style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: "0 0 10px 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>Skoring Evaluasi</h4>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Skor UIT:</div>
                        {canScoreUIT ? (
                          <div style={{ display: "flex", gap: 4 }}>
                            {[1, 2, 3, 4, 5].map(v => (
                              <button key={v} className="score-btn" style={scoreBtn(statusSkorUIT === v, C.yellow)} onClick={() => {
                                setMaturityAuditForm(f => ({
                                  ...f,
                                  aspekScores: { ...f.aspekScores, [activeAspect.id]: { ...(f.aspekScores[activeAspect.id] || {}), uit: v } }
                                }));
                              }}>{v}</button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 700, color: statusSkorUIT > 0 ? C.yellow : C.muted }}>
                            {statusSkorUIT > 0 ? `Level ${statusSkorUIT} — ${MATURITY_LEVELS[statusSkorUIT]}` : "Belum dinilai UIT"}
                          </span>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Skor Pusat:</div>
                        {canScorePusat ? (
                          <div style={{ display: "flex", gap: 4 }}>
                            {[1, 2, 3, 4, 5].map(v => (
                              <button key={v} className="score-btn" style={scoreBtn(statusSkorPusat === v, "#1d4ed8")} onClick={() => {
                                setMaturityAuditForm(f => ({
                                  ...f,
                                  aspekScores: { ...f.aspekScores, [activeAspect.id]: { ...(f.aspekScores[activeAspect.id] || {}), pusat: v } }
                                }));
                              }}>{v}</button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 700, color: statusSkorPusat > 0 ? "#1d4ed8" : C.muted }}>
                            {statusSkorPusat > 0 ? `Level ${statusSkorPusat} — ${MATURITY_LEVELS[statusSkorPusat]}` : "Belum dinilai Pusat"}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })() : (
          // Category List View
          <div>
            <div className="operations-segments" style={{ marginBottom: 20 }}>
              {AUDIT_CATEGORIES.map(cat => {
                const isActive = expandedAspek === cat.id;
                return (
                  <button
                    key={cat.id}
                    className={isActive ? "is-active" : ""}
                    onClick={() => { setExpandedAspek(cat.id); setAspectPage(1); }}
                    style={{ "--segment-color": C.accent, flex: 1, justifyContent: "center", whiteSpace: "nowrap" }}
                  >{cat.label}</button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2.1fr 1fr", gap: 20, marginBottom: 20 }}>
              {/* Left Column: Aspect list */}
              <div style={{ ...sty.card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <strong style={{ fontSize: 13, color: C.text, fontWeight: 800 }}>{activeCategory.label}</strong>
                  <span style={{ fontSize: 12, color: C.muted }}>Halaman {aspectPage} dari {totalPages} — {categoryAspects.length} Aspek</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  {paginatedAspects.map(aspect => {
                    const aspectAllFiles = maturityAuditEvidence[aspect.id] || [];
                    const filesCount = aspectAllFiles.length;
                    const reqCount = aspect.requiredEvidence.length;
                    const itemUptScore = calculateItemLevel(filesCount, reqCount);
                    const itemUitScore = maturityAuditForm.aspekScores[aspect.id]?.uit || 0;
                    const itemPusatScore = maturityAuditForm.aspekScores[aspect.id]?.pusat || 0;
                    const isAspectAutoFilled = filesCount > 0 && aspectAllFiles.every(f => f.auto === true);

                    const badgeBox = (val, lbl) => (
                      <div style={{
                        width: 50,
                        padding: "6px 2px",
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        textAlign: "center",
                        background: val > 0 ? "transparent" : C.bg,
                      }}>
                        <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", fontWeight: 800 }}>{lbl}</div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: val > 0 ? C.text : C.muted, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
                          {val > 0 ? val : "—"}
                        </div>
                      </div>
                    );

                    return (
                      <div
                        key={aspect.id}
                        className="maturity-aspect-row"
                        onClick={() => setActiveAspectId(aspect.id)}
                        role="button"
                        tabIndex={0}
                        title={`Klik untuk membuka & upload evidence: ${aspect.id} ${aspect.title}`}
                        style={{
                          display: "flex",
                          flexDirection: isMobile ? "column" : "row",
                          justifyContent: "space-between",
                          alignItems: isMobile ? "stretch" : "center",
                          padding: isMobile ? "12px 14px" : "14px 18px",
                          gap: isMobile ? 10 : 14,
                          cursor: "pointer",
                          background: isAspectAutoFilled ? `${C.green}12` : "transparent",
                          userSelect: "none"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                          <div style={{
                            width: 4,
                            height: 28,
                            borderRadius: 2,
                            background: isAspectAutoFilled ? C.green : filesCount >= reqCount ? C.accent : C.yellow,
                            flexShrink: 0
                          }} />
                          <div style={{ marginLeft: 4, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 800, color: C.text }}>{aspect.id} {aspect.title}</span>
                              {isAspectAutoFilled && (
                                <span style={{
                                  fontSize: 12,
                                  fontWeight: 800,
                                  padding: "1px 6px",
                                  borderRadius: 20,
                                  background: `${C.green}22`,
                                  color: C.green,
                                  border: `1px solid ${C.green}55`,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.3px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3
                                }}>
                                  <Icons.AutoCheck /> Auto Form 5S
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 2, fontWeight: 500 }}>{aspect.subtext}</div>
                          </div>
                        </div>

                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: isMobile ? "space-between" : "flex-end",
                          gap: 10,
                          marginLeft: isMobile ? 0 : 16,
                          marginTop: isMobile ? 4 : 0,
                          width: isMobile ? "100%" : "auto"
                        }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {badgeBox(itemUptScore, "upt")}
                            {badgeBox(itemUitScore, "uit")}
                            <div style={{
                              width: 52,
                              padding: "6px 2px",
                              borderRadius: 8,
                              border: `1px solid ${C.border}`,
                              textAlign: "center",
                              background: itemPusatScore > 0 ? "transparent" : C.bg
                            }}>
                              <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", fontWeight: 800 }}>Final</div>
                              <div style={{ fontSize: 12, fontWeight: 900, color: itemPusatScore > 0 ? C.text : C.muted, marginTop: 1, wordBreak: "break-all", fontVariantNumeric: "tabular-nums" }}>
                                {itemPusatScore > 0 ? itemPusatScore : "Belum"}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveAspectId(aspect.id);
                            }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              background: `${C.accent}14`,
                              color: C.accent,
                              border: `1.5px solid ${C.accent}44`,
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              whiteSpace: "nowrap"
                            }}
                          >
                            <span>Kelola Evidence</span>
                            <Icons.ChevronRight />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Halaman {aspectPage} dari {totalPages}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {aspectPage > 1 && (
                      <button style={{ ...sty.btn("ghost", "sm"), padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.text, display: "flex", alignItems: "center", gap: 4 }} onClick={() => setAspectPage(p => p - 1)}>
                        <Icons.ChevronLeft /> Sebelum
                      </button>
                    )}
                    {aspectPage < totalPages && (
                      <button style={{ ...sty.btn("ghost", "sm"), padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.text, display: "flex", alignItems: "center", gap: 4 }} onClick={() => setAspectPage(p => p + 1)}>
                        Berikut <Icons.ChevronRight />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Category Scores overview */}
              <div style={{ ...sty.card, height: "fit-content" }}>
                <h4 style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: "0 0 14px 0", borderBottom: `1px solid ${C.border}`, paddingBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Skor Per Kategori</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {AUDIT_CATEGORIES.map(cat => {
                    const catScore = getCategoryScore(cat.id, activeRoleType);
                    return (
                      <div key={cat.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.text, marginBottom: 4, fontWeight: 600 }}>
                          <span>{cat.label}</span>
                          <strong style={{ color: catScore > 0 ? C.accent : C.muted, fontVariantNumeric: "tabular-nums" }}>{catScore > 0 ? catScore.toFixed(2) : "0.00"}</strong>
                        </div>
                        <div style={{ height: 5, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${(catScore / 5) * 100}%`,
                            background: catScore >= 4 ? C.green : catScore >= 2.5 ? C.yellow : C.accent,
                            borderRadius: 2,
                            transition: "width 0.4s ease-out"
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Penilaian Matlev Weighted Calculation Table */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${C.border}` }}>
                  <h5 style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: "0 0 10px 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>Penilaian Matlev (A + B)</h5>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, boxShadow: "0 4px 6px rgba(15,23,42,0.01)" }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)", textAlign: "left", color: "white" }}>
                        <th style={{ padding: "8px 10px", border: `1px solid ${C.border}`, fontWeight: 800 }}>Item</th>
                        <th style={{ padding: "8px 10px", border: `1px solid ${C.border}`, fontWeight: 800, textAlign: "right" }}>Nilai Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: "8px 10px", border: `1px solid ${C.border}`, background: C.surface, fontWeight: 700, color: C.text }}>
                          Gudang Persediaan (A)
                        </td>
                        <td style={{ padding: "8px 10px", border: `1px solid ${C.border}`, fontWeight: 800, textAlign: "right", background: C.bg, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
                          {matlevScoreA.toFixed(2)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "8px 10px", border: `1px solid ${C.border}`, background: C.surface, fontWeight: 700, color: C.text }}>
                          Gudang MRWI (B)
                        </td>
                        <td style={{ padding: "8px 10px", border: `1px solid ${C.border}`, fontWeight: 800, textAlign: "right", background: C.bg, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
                          {matlevScoreB.toFixed(2)}
                        </td>
                      </tr>
                      <tr style={{ fontWeight: 900, background: `${C.accent}14` }}>
                        <td style={{ padding: "8px 10px", border: `1px solid ${C.border}`, color: C.accent }}>Total (A + B)</td>
                        <td style={{ padding: "8px 10px", border: `1px solid ${C.border}`, textAlign: "right", color: C.accent, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                          {matlevTotalScore.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Action buttons — kelas approval-btn baku app-wide */}
            <div className="approval-actions" style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              {isEdit && audit.id && deleteMaturityAudit && hasRole(currentUser, "ADMIN", "SUPERADMIN", "TL") && (
                <button className="approval-btn--danger" style={{ marginRight: "auto" }} onClick={() => deleteMaturityAudit(audit.id)}>Hapus Audit Ini</button>
              )}
              <button className="approval-btn--cancel" onClick={() => setMaturityAuditModal(null)}>Batal</button>
              {canScoreUPT && (
                <>
                  <button className="approval-btn--cancel" disabled={maturityAuditSaving} onClick={() => saveMaturityAudit(audit, "DRAFT")}>Simpan Draft</button>
                  <button className="approval-btn--primary" disabled={maturityAuditSaving} onClick={() => saveMaturityAudit(audit, "SELF_ASSESSMENT")}>Kirim Hasil ke UIT</button>
                </>
              )}
              {canScoreUIT && (
                <>
                  <button className="approval-btn--reject" disabled={maturityAuditSaving} onClick={() => saveMaturityAudit(audit, "REVISION")}>Ajukan Revisi</button>
                  <button className="approval-btn--primary" disabled={maturityAuditSaving} onClick={() => saveMaturityAudit(audit, "FINAL")}>Kirim Hasil ke Pusat</button>
                </>
              )}
              {canScorePusat && (
                <>
                  <button className="approval-btn--reject" disabled={maturityAuditSaving} onClick={() => saveMaturityAudit(audit, "REVISION")}>Ajukan Revisi</button>
                  <button className="approval-btn--approve" disabled={maturityAuditSaving} onClick={() => saveMaturityAudit(audit, "FINAL")}>Finalisasi & Simpan</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// COMPONENT 3: Form5STab
// =========================================================================

const FORM_5S = [
  {
    id: "sort",
    label: "Sort\n(Seiri)",
    color: "#0f4c81",
    definition: "Memindahkan barang yang tidak perlu dari area kerja, seperti stok usang, rusak, dan berlebih",
    indicators: [
      "Tidak ada mesin atau peralatan yang tidak digunakan di area kerja",
      "Lantai bersih dari alat, suku cadang, dan perlengkapan yang tidak diperlukan",
      "Limbah dan sampah dibuang ke tempat yang sesuai",
      "Area kerja bebas dari hambatan atau bahaya tersandung",
    ],
  },
  {
    id: "set",
    label: "Set in Order\n(Seiton)",
    color: "#0f4c81",
    definition: "Menata barang dengan efisien dan efektif, seperti melabeli lokasi dan meletakkan barang yang sering digunakan di tempat yang mudah diakses",
    indicators: [
      "Rak penyimpanan memiliki label atau gambar yang jelas",
      "Memiliki tanda yang menunjukkan lokasi peralatan dan area kerja",
      "Lokasi atau tempat penyimpanan alat diberi tanda dan menggunakan shadow board",
      "Barang tidak diletakkan sembarangan, tetapi disimpan di tempatnya",
      "Forklift dan kendaraan yang tidak digunakan diparkir di area yang telah ditentukan",
      "Papan pengumuman atau tanda di area kerja dalam kondisi baik dan ter-update",
    ],
  },
  {
    id: "shine",
    label: "Shine\n(Seiso)",
    color: "#0f4c81",
    definition: "Membersihkan area secara menyeluruh dan membuat jadwal pembersihan",
    indicators: [
      "Peralatan Material Handling dalam kondisi bersih, rapi, dan dalam kondisi baik",
      "Terdapat jadwal / checklist kebersihan",
      "Terdapat penanggung jawab khusus / petugas kebersihan",
      "Peralatan atau perlengkapan kebersihan tersedia serta mudah diakses",
    ],
  },
  {
    id: "standardize",
    label: "Standardize\n(Seiketsu)",
    color: "#0f4c81",
    definition: "Menciptakan standar untuk setiap area kerja, seperti mendokumentasikan prosedur praktik terbaik",
    indicators: [
      "Standar operasional telah ditetapkan dan terdokumentasi",
      "Audit 5S dilakukan secara rutin menggunakan checklist dan formulir evaluasi",
      "Tempat peralatan diberi label serta disimpan dengan benar",
      "Terdapat tanda lantai atau rambu keselamatan digunakan untuk mengidentifikasi bahaya di area kerja",
    ],
  },
  {
    id: "sustain",
    label: "Sustain\n(Shitsuke)",
    color: "#0f4c81",
    definition: "5S telah diterapkan dalam pekerjaan sehari-hari",
    indicators: [
      "Terdapat rutinitas pembersihan yang dijalankan sesuai jadwal",
      "Semua pekerja menggunakan alat pelindung diri (APD) yang sesuai selama pekerjaan berlangsung",
      "Label darurat, peta, dan peralatan keselamatan terlihat dengan jelas",
      "Hasil audit 5S diperbarui dan ditampilkan di papan informasi",
      "Jadwal dan prosedur 5S telah dipatuhi",
    ],
  },
];

const MONTH_LABELS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const HEADER_COLOR = "#1e3a8a";
const HEADER_BG = "linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)";
const SUBHDR_BG = "#f8fafc";
const ROW_ALT = "#f8fafc";
const BORDER_CLR = "#e2e8f0";

export function Form5STab({ C, sty, currentUser, lokasiList = [], setMaturityAuditEvidence, onBack, isMobile, selectedUpt }) {
  const now = new Date();
  const [bulan, setBulan] = useState(now.getMonth());
  const [tahun, setTahun] = useState(now.getFullYear());
  const [gudang, setGudang] = useState("");
  const [auditor, setAuditor] = useState(currentUser?.name || "");
  const [catatan, setCatatan] = useState("");
  const [saved, setSaved] = useState(false);
  const [uploading5S, setUploading5S] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");

  const initChecks = () =>
    Object.fromEntries(FORM_5S.map(cat => [cat.id, Array(cat.indicators.length).fill(false)]));
  const [checks, setChecks] = useState(initChecks);
  const [samplePhotos, setSamplePhotos] = useState([]);

  const addPhotos = async (files) => {
    const remaining = 3 - samplePhotos.length;
    if (remaining <= 0) return;
    const taken = Array.from(files).slice(0, remaining);
    setPhotoUploadError("");
    setUploading5S(true);
    try {
      const uploaded = await Promise.all(taken.map(f => uploadFileToDrive({
        file: f,
        upt: selectedUpt || "UPT Surabaya",
        category: "K3",
        aspectId: "4.5",
        itemLabel: "Foto Sampling 5S"
      })));
      const newEntries = uploaded.map(res => ({
        name: res.name,
        url: res.url,
        size: res.size,
        driveFileId: res.driveFileId,
        isDrive: res.isDrive,
        syncedToDrive: res.syncedToDrive
      }));
      setSamplePhotos(prev => [...prev, ...newEntries]);
      setSaved(false);
    } catch (err) {
      console.warn("Upload foto 5S gagal:", err);
      setPhotoUploadError(err?.message || "Upload foto 5S gagal.");
    } finally {
      setUploading5S(false);
    }
  };

  const removePhoto = (idx) => {
    setSamplePhotos(prev => prev.filter((_, i) => i !== idx));
    setSaved(false);
  };

  const toggle = (catId, idx) => {
    setChecks(prev => ({
      ...prev,
      [catId]: prev[catId].map((v, i) => (i === idx ? !v : v)),
    }));
    setSaved(false);
  };

  const totalItems = FORM_5S.reduce((s, c) => s + c.indicators.length, 0);
  const totalChecked = FORM_5S.reduce((s, c) => s + checks[c.id].filter(Boolean).length, 0);
  const scorePct = totalItems > 0 ? (totalChecked / totalItems) * 100 : 0;

  const handleReset = () => { setChecks(initChecks()); setSamplePhotos([]); setSaved(false); };

  const handleSave = () => {
    setSaved(true);
    if (setMaturityAuditEvidence) {
      const ts = new Date().toLocaleString("id-ID");
      const user = currentUser?.name || currentUser?.username || "Pengguna";

      const chkEntry = {
        id: "k3_5s_chk",
        name: `Checklist 5S — ${MONTH_LABELS[bulan]} ${tahun} (${scorePct.toFixed(1)}%)`,
        url: "#form-5s",
        size: 0,
        auto: true,
        source: "Form Pengisian 5S",
        meta: `Diisi oleh: ${user} | Skor: ${scorePct.toFixed(2)}% (${totalChecked}/${totalItems}) | Disimpan: ${ts}`,
      };

      const fotoEntries = samplePhotos.map((p, i) => ({
        id: "k3_5s_foto",
        name: `Foto Sampling 5S ${i + 1} — ${p.name}`,
        url: p.url,
        size: p.size,
        auto: true,
        source: "Form Pengisian 5S",
        meta: `Upload oleh: ${user} | Disimpan: ${ts}`,
      }));

      setMaturityAuditEvidence(prev => {
        const existing = (prev["4.5"] || []).filter(
          f => f.id !== "k3_5s_chk" && f.id !== "k3_5s_foto"
        );
        return { ...prev, "4.5": [chkEntry, ...fotoEntries, ...existing] };
      });
    }
    setTimeout(() => setSaved(false), 4000);
  };

  const handlePrint = () => window.print();

  const tdBase = {
    border: `1px solid ${C.border}`,
    padding: "10px 14px",
    verticalAlign: "middle",
    fontSize: 12,
    lineHeight: 1.5,
    color: C.text
  };
  const thBase = {
    ...tdBase,
    background: C.bg,
    color: C.muted,
    fontWeight: 800,
    textAlign: "center",
    padding: "12px 14px",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  };

  return (
    <div style={{ paddingBottom: 48, fontFamily: "inherit" }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            marginBottom: "16px",
            border: "none",
            backgroundColor: "transparent",
            color: C.accent,
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "600"
          }}
        >
          <Icons.ChevronLeft /> Kembali ke Menu Asesmen
        </button>
      )}

      {/* ── Metadata ── */}
      <div style={{ ...sty.card, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 14 }}>
          Data Pengisian
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: 16 }}>
          <div>
            <label style={sty.label}>Periode Bulan</label>
            <select style={sty.select} value={bulan} onChange={e => setBulan(Number(e.target.value))}>
              {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={sty.label}>Tahun</label>
            <input style={sty.input} type="number" min={2020} max={2099} value={tahun}
              onChange={e => setTahun(Number(e.target.value))} />
          </div>
          <div>
            <label style={sty.label}>Gudang / Lokasi</label>
            {lokasiList.length > 0 ? (
              <select style={sty.select} value={gudang} onChange={e => setGudang(e.target.value)}>
                <option value="">-- Pilih Gudang --</option>
                {lokasiList.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.kode}{l.keterangan ? ` — ${l.keterangan}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input style={sty.input} placeholder="Nama gudang..." value={gudang}
                onChange={e => setGudang(e.target.value)} />
            )}
          </div>
          <div>
            <label style={sty.label}>Nama Auditor</label>
            <input style={sty.input} placeholder="Nama auditor..." value={auditor}
              onChange={e => setAuditor(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Main Table ── */}
      <div style={{ ...sty.card, padding: 0, overflowX: "auto", marginBottom: 20 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, background: C.surface }}>
          <thead>
            <tr>
              <td colSpan={4} style={{
                background: HEADER_BG, color: "white", textAlign: "center",
                fontWeight: 900, fontSize: 15, padding: "14px 16px",
                letterSpacing: "1px", textTransform: "uppercase"
              }}>
                Form Checklist 5S
              </td>
            </tr>
            <tr>
              <th style={{ ...thBase, width: 110 }}>5S</th>
              <th style={{ ...thBase, width: 220 }}>Definition</th>
              <th style={{ ...thBase }}>Indikator</th>
              <th style={{ ...thBase, width: 90 }}>Checklist</th>
            </tr>
          </thead>

          <tbody>
            {FORM_5S.map((cat) => {
              const catChecked = checks[cat.id].filter(Boolean).length;
              const rows = cat.indicators.length;
              return cat.indicators.map((ind, ii) => (
                <tr key={`${cat.id}-${ii}`}
                  style={{ background: ii % 2 === 0 ? C.surface : C.bg }}>
                  {ii === 0 && (
                    <td rowSpan={rows} style={{
                      ...tdBase,
                      background: C.bg,
                      fontWeight: 800,
                      textAlign: "center",
                      whiteSpace: "pre-line",
                      fontSize: 13,
                      color: C.text,
                      verticalAlign: "middle",
                    }}>
                      {cat.label}
                      <div style={{ marginTop: 8, fontSize: 12, color: C.muted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {catChecked}/{rows}
                      </div>
                    </td>
                  )}
                  {ii === 0 && (
                    <td rowSpan={rows} style={{
                      ...tdBase,
                      fontSize: 12,
                      color: C.muted,
                      fontStyle: "italic",
                      background: C.bg,
                      verticalAlign: "top",
                      paddingTop: 12,
                    }}>
                      {cat.definition}
                    </td>
                  )}
                  <td style={{ ...tdBase, color: C.text }}>{ind}</td>
                  <td style={{ ...tdBase, textAlign: "center" }}>
                    <button
                      onClick={() => toggle(cat.id, ii)}
                      title={checks[cat.id][ii] ? "Klik untuk hapus centang" : "Klik untuk centang"}
                      style={{
                        width: 24, height: 24,
                        borderRadius: 6,
                        border: `2px solid ${checks[cat.id][ii] ? C.green : C.border}`,
                        background: checks[cat.id][ii] ? C.green : C.surface,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        flexShrink: 0,
                        boxShadow: checks[cat.id][ii] ? "0 2px 8px rgba(16, 185, 129, 0.2)" : "none",
                        outline: "none"
                      }}
                    >
                      {checks[cat.id][ii] && (
                        <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                          <polyline points="2,7 5,10 11,3" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              ));
            })}

            <tr>
              <td colSpan={3} style={{
                ...tdBase,
                textAlign: "center",
                fontWeight: 800,
                fontSize: 12,
                background: C.bg,
                color: C.text,
                letterSpacing: "0.5px",
                textTransform: "uppercase"
              }}>
                Skor Akumulasi 5S
              </td>
              <td style={{
                ...tdBase,
                textAlign: "center",
                fontWeight: 900,
                fontSize: 14,
                fontVariantNumeric: "tabular-nums",
                background: scorePct >= 80 ? "#d1fae5" : scorePct >= 60 ? "#dbeafe" : scorePct >= 40 ? "#fef9c3" : "#fee2e2",
                color: scorePct >= 80 ? "#065f46" : scorePct >= 60 ? "#1e3a8a" : scorePct >= 40 ? "#713f12" : "#991b1b",
              }}>
                {scorePct.toFixed(2)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Score Summary Bar ── */}
      <div style={{ ...sty.card, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Progres Pengisian Checklist
          </div>
          <div style={{
            fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums",
            color: scorePct >= 80 ? C.green : scorePct >= 60 ? C.accent : scorePct >= 40 ? C.yellow : C.red,
          }}>
            {scorePct.toFixed(2)}%
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: C.border, overflow: "hidden", marginBottom: 16 }}>
          <div style={{
            width: `${scorePct}%`, height: "100%", borderRadius: 4, transition: "width .4s ease-out",
            background: scorePct >= 80 ? "linear-gradient(90deg, #10b981, #34d399)" : scorePct >= 60 ? "linear-gradient(90deg, #3b82f6, #60a5fa)" : scorePct >= 40 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, #ef4444, #f87171)",
          }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: 12 }}>
          {FORM_5S.map(cat => {
            const n = cat.indicators.length;
            const c = checks[cat.id].filter(Boolean).length;
            const p = n > 0 ? Math.round((c / n) * 100) : 0;
            return (
              <div key={cat.id} style={{
                textAlign: "center",
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "10px 8px"
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 6, whiteSpace: "pre-line", minHeight: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {cat.label.replace("\n", " ")}
                </div>
                <div style={{ height: 4, borderRadius: 2, background: C.border, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ width: `${p}%`, height: "100%", background: C.accent, transition: "width .3s" }} />
                </div>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c}/{n} ({p}%)</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Catatan ── */}
      <div style={{ ...sty.card, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 800, color: C.muted, display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Catatan / Temuan / Tindak Lanjut
        </label>
        <textarea
          value={catatan}
          onChange={e => setCatatan(e.target.value)}
          rows={3}
          placeholder="Tuliskan temuan, rekomendasi perbaikan, atau rencana tindak lanjut..."
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: C.surface, outline: "none", boxSizing: "border-box", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }}
        />
      </div>

      {/* ── Upload 3 Sampling Foto ── */}
      <div style={{ ...sty.card, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 3 }}>
              📷 Sampling Foto Implementasi 5S di Gudang
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              Upload foto sedang dinonaktifkan sementara sampai penyimpanan Drive selesai disiapkan.
            </div>
          </div>
          {samplePhotos.length < 3 && (
            <label style={{
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white", fontSize: 12, fontWeight: 700,
              border: "none", userSelect: "none", marginLeft: 12,
            }}>
              Upload Foto Belum Tersedia
              <input
                type="file"
                accept="image/*"
                multiple
                disabled
                hidden
                onChange={e => { addPhotos(e.target.files); e.target.value = ""; }}
              />
            </label>
          )}
        </div>

        {photoUploadError && (
          <div role="alert" style={{ marginBottom: 14, padding: "9px 12px", borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 12, fontWeight: 700 }}>
            {photoUploadError}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 16 }}>
          {[0, 1, 2].map(slot => {
            const photo = samplePhotos[slot];
            return (
              <div key={slot} style={{
                position: "relative",
                borderRadius: 12,
                border: photo ? `1px solid #1e3a8a` : `2.5px dashed #cbd5e1`,
                background: photo ? "transparent" : "#f8fafc",
                overflow: "hidden",
                aspectRatio: "4/3",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease"
              }}>
                {photo ? (
                  <>
                    <img
                      src={photo.url}
                      alt={`Sampling ${slot + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0,
                      background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)",
                      padding: "20px 8px 7px 8px",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-end",
                    }}>
                      <div style={{ color: "white", fontSize: 12, fontWeight: 700, maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Foto {slot + 1} — {photo.name}
                      </div>
                      <button
                        onClick={() => removePhoto(slot)}
                        title="Hapus foto"
                        style={{
                          width: 22, height: 22, borderRadius: "50%",
                          background: "rgba(255,50,50,0.85)", color: "white",
                          border: "none", cursor: "pointer", fontSize: 13, fontWeight: 900,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >×</button>
                    </div>
                    <div style={{
                      position: "absolute", top: 7, left: 7,
                      background: "#1e3a8a", color: "white",
                      borderRadius: 6, padding: "2px 7px", fontSize: 12, fontWeight: 800,
                    }}>
                      {slot + 1}/3
                    </div>
                  </>
                ) : (
                  <label style={{ cursor: "not-allowed", textAlign: "center", padding: 16, display: "block", width: "100%" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                    <div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Foto Sampling {slot + 1}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {samplePhotos.length <= slot ? "Belum tersedia" : "—"}
                    </div>
                    {samplePhotos.length === slot && (
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled
                        hidden
                        onChange={e => { addPhotos(e.target.files); e.target.value = ""; }}
                      />
                    )}
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ height: 4, flex: 1, borderRadius: 99, background: "#e2e8f0", overflow: "hidden" }}>
            <div style={{
              width: `${(samplePhotos.length / 3) * 100}%`, height: "100%", borderRadius: 99,
              background: samplePhotos.length === 3 ? "#10b981" : "#1e3a8a", transition: "width .3s",
            }} />
          </div>
          <div style={{
            fontSize: 12, fontWeight: 700,
            color: samplePhotos.length === 3 ? "#059669" : C.muted,
          }}>
            {samplePhotos.length}/3 foto {samplePhotos.length === 3 ? "✓ Lengkap" : ""}
          </div>
        </div>
      </div>

      {/* ── Info ── */}
      {setMaturityAuditEvidence && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: "#eff6ff", border: "1px solid #bfdbfe",
          borderRadius: 12, padding: "14px 18px", marginBottom: 14,
        }}>
          <div style={{ fontSize: 18, flexShrink: 0 }}>ℹ️</div>
          <div style={{ fontSize: 12, color: "#1e40af", lineHeight: 1.55 }}>
            <strong>Auto-selesai poin audit 4.5</strong><br />
            Setelah klik <em>Simpan Checklist</em>, <strong>2 evidence</strong> pada poin{" "}
            <strong>4.5 — Implementasi 5S di Gudang</strong> akan otomatis terisi:{" "}
            <em>(1) Hasil Checklist Form 5S</em> dan{" "}
            <em>(2) {samplePhotos.length}/3 Sampling Foto</em>.
            {samplePhotos.length < 3 && (
              <span style={{ color: "#dc2626" }}> Upload {3 - samplePhotos.length} foto lagi agar evidence foto juga lengkap.</span>
            )}
          </div>
        </div>
      )}

      {/* ── Success banner ── */}
      {saved && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "#d1fae5", border: "1px solid #6ee7b7",
          borderRadius: 12, padding: "14px 18px", marginBottom: 14,
          animation: "fadeIn .3s ease",
        }}>
          <div style={{ fontSize: 20 }}>✅</div>
          <div style={{ fontSize: 12.5, color: "#064e3b", lineHeight: 1.55 }}>
            <strong>Checklist 5S berhasil disimpan!</strong><br />
            Poin <strong>4.5 › Evidence 1 — Hasil Checklist Form 5S</strong> telah otomatis
            ditandai selesai. Buka tab <em>Pelaksanaan Audit</em> untuk melihat hasilnya.
          </div>
        </div>
      )}

      {/* ── Action Buttons ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
        <button
          onClick={handleReset}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "white",
            color: "#475569",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
        >
          ↺ Reset Form
        </button>
        <button
          onClick={handlePrint}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            color: "#1d4ed8",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
        >
          🖨️ Cetak / PDF
        </button>
        <button
          onClick={handleSave}
          disabled={saved}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            background: saved ? "#10b981" : "linear-gradient(135deg, #2563eb, #1d4ed8)",
            color: "white",
            fontSize: 12,
            fontWeight: 800,
            cursor: saved ? "default" : "pointer",
            boxShadow: saved ? "none" : "0 4px 12px rgba(37,99,235,0.25)",
            transition: "all 0.2s ease"
          }}
        >
          {saved ? "✓ Tersimpan!" : "💾 Simpan Checklist"}
        </button>
      </div>
    </div>
  );
}
