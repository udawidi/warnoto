import { MaturityAuditEditor, Form5STab } from "./MaturityAuditSystem.jsx";
import { AUDIT_ASPECTS } from "../data/auditAspects.js";
import { DEFAULT_UPT_LIST } from "../data/masterUpt.js";
import { fmtDate, fmtDateOnly } from "../lib/utils.js";

const HISTORY_STATUS_COLOR = {
  ARSIP: "#64748b",
  FINAL: "#1d4ed8",
  BERJALAN: "#0284c7",
};
const HISTORY_STATUS_LABEL = {
  ARSIP: "Arsip",
  FINAL: "Final",
  BERJALAN: "Berjalan",
};

export function MaturityDashboardTab({
  C, sty, currentUser, isMobile, hasRole,
  maturityAudits, maturityAuditHistory = [], maturity5SAssessments = [], selectedMaturityUpt, selectedMaturityUptId = "", setSelectedMaturityUpt, canSwitchMaturityUpt,
  maturitySubTab, setMaturitySubTab,
  maturityAuditModal, setMaturityAuditModal,
  auditListPage, setAuditListPage,
  maturityAuditForm, setMaturityAuditForm,
  maturityAuditEvidence, setMaturityAuditEvidence,
  expandedAspek, setExpandedAspek,
  activeAspectId, setActiveAspectId,
  aspectPage, setAspectPage,
  maturityAuditSaving,
  saveMaturityAudit, autosaveMaturityDraft, maturityDraftSavedAt, saveMaturity5SAssessment, deleteMaturityAudit, createMaturityAudit, openMaturityAudit, exportMaturityAuditExcel,
  calculateItemLevel, calcMaturityScore,
  gudangList, askConfirmDelete,
  MATURITY_LEVELS, MATURITY_WORKFLOW_LABEL, MATURITY_WORKFLOW_COLOR,
}) {
            const is3D = false;
            // Scoping per-UPT pakai id (FK) supaya tidak bergantung kecocokan
            // string nama; cocokkan nama hanya bila salah satu sisi belum punya id
            // (mis. Master UPT belum termuat / baris lama).
            const isSelectedUpt = row => (row.uptId && selectedMaturityUptId)
              ? row.uptId === selectedMaturityUptId
              : (row.upt || "UPT Surabaya") === selectedMaturityUpt;
            const uptAudits = maturityAudits.filter(isSelectedUpt);
            const latestAudit = uptAudits[0] || null;
            const calcResult = latestAudit ? calcMaturityScore(latestAudit.aspekScores || {}, latestAudit.evidence || {}) : { itemA: 0, itemB: 0, total: 0, level: 1 };
            const currentLevel = latestAudit ? calcResult.level : 1;
            const evidenceCount = latestAudit?.evidence ? Object.values(latestAudit.evidence).flat().length : 0;
            const statusLabel = latestAudit ? (MATURITY_WORKFLOW_LABEL[latestAudit.status] || latestAudit.status) : "Belum Ada Audit";
            const statusColor = latestAudit ? (MATURITY_WORKFLOW_COLOR[latestAudit.status] || "#64748b") : "#64748b";
            const uptAuditHistory = maturityAuditHistory
              .filter(isSelectedUpt)
              .sort((a, b) => (a.tahun - b.tahun) || (a.semester - b.semester));
            const latestHistory = uptAuditHistory[uptAuditHistory.length - 1] || null;
            const previousHistory = uptAuditHistory[uptAuditHistory.length - 2] || null;
            const historyChange = latestHistory && previousHistory ? latestHistory.score - previousHistory.score : null;
            const recentHistory = [...uptAuditHistory].reverse();
            return (
              <div className="operations-page">
              <div className="kpi-banner" style={{
                flexDirection: isMobile ? "column" : undefined,
                alignItems: isMobile ? "stretch" : undefined,
                justifyContent: "space-between",
                padding: isMobile ? "14px 16px" : "18px 24px",
                marginBottom: isMobile ? 16 : 24,
                flexWrap: "wrap",
                gap: isMobile ? 12 : 16
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "1.5px" }}>WILAYAH AUDIT</span>
                    <span style={{ padding: "2px 10px", borderRadius: 14, background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 12, fontWeight: 800, border: "1px solid rgba(255,255,255,0.25)" }}>{statusLabel}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "white", letterSpacing: "-0.4px" }}>{selectedMaturityUpt}</div>
                  <div style={{ fontSize: 13, color: "rgba(219,234,254,.82)", fontWeight: 500, marginTop: 4 }}>
                    Terakhir diperbarui: {latestAudit ? fmtDate(latestAudit.updatedAt || latestAudit.createdAt) : "—"}
                  </div>
                </div>

                <div style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 14,
                  padding: isMobile ? "10px 14px" : "12px 20px",
                  textAlign: isMobile ? "left" : "right"
                }}>
                  <div style={{ fontSize: 12, color: "#93c5fd", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Level Maturity</div>
                  <div style={{ fontSize: 24, fontWeight: 950, color: "white", margin: "2px 0", lineHeight: 1.1, letterSpacing: "-1px" }}>Level {currentLevel}</div>
                  <div style={{ fontSize: 12, color: "#93c5fd", fontWeight: 700 }}>{MATURITY_LEVELS[currentLevel] || "Basic"}</div>
                </div>

                {canSwitchMaturityUpt && isMobile && (
                  <select
                    value={selectedMaturityUpt}
                    onChange={e => setSelectedMaturityUpt(e.target.value)}
                    style={{
                      width: "100%",
                      minHeight: 44,
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: "#ffffff",
                      color: "#1e293b",
                      fontSize: 16,
                      fontWeight: 700
                    }}
                  >
                    {DEFAULT_UPT_LIST.map(u => <option key={u.id} value={u.nama}>{u.nama}</option>)}
                  </select>
                )}

                {canSwitchMaturityUpt && !isMobile && (
                  // width:100% memaksa switcher ke barisnya sendiri (baris atas tetap [UPT | Level],
                  // space-between pin kotak Level ke kanan — posisi tak bergeser saat ganti UPT).
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
                    {DEFAULT_UPT_LIST.map(u => {
                      const isSelected = selectedMaturityUpt === u.nama;
                      return (
                        <button
                          key={u.id}
                          onClick={() => setSelectedMaturityUpt(u.nama)}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 14,
                            border: "1px solid transparent",
                            background: isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.08)",
                            color: isSelected ? "#1e3a8a" : "#f1f5f9",
                            fontSize: 13,
                            fontWeight: isSelected ? 800 : 600,
                            cursor: "pointer",
                            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                            boxShadow: isSelected ? "0 4px 12px rgba(255, 255, 255, 0.25)" : "none",
                            backdropFilter: "blur(4px)",
                            outline: "none"
                          }}
                        >
                          {u.nama}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sub-tab navigation — dibungkus supaya punya separator ke konten di bawahnya */}
              <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: isMobile ? 14 : 16, marginBottom: isMobile ? 16 : 20 }}>
              <div style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                gap: 6,
                background: C.surface,
                borderRadius: 14,
                padding: 5,
                border: `1px solid ${C.border}`,
                boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
                overflowX: isMobile ? "visible" : "auto",
                WebkitOverflowScrolling: "touch"
              }}>
                {[
                  { id: "dashboard", label: "Dashboard Audit" },
                  { id: "pelaksanaan", label: "Pelaksanaan Audit" },
                  { id: "history", label: "History Audit" },
                  { id: "5s", label: "Form Pengisian 5S" },
                ].map(s => (
                  <button key={s.id} onClick={() => setMaturitySubTab(s.id)} style={{
                    ...(isMobile ? {} : { flex: 1 }),
                    padding: "10px 16px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                    background: maturitySubTab === s.id ? "linear-gradient(180deg,#2f6bf0,#1d4ed8)" : "transparent",
                    color: maturitySubTab === s.id ? "#ffffff" : C.text,
                    boxShadow: maturitySubTab === s.id ? "0 3px 10px rgba(29,78,216,0.35)" : "none",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    whiteSpace: "nowrap"
                  }}>{s.label}</button>
                ))}
              </div>
              </div>

              {/*  DASHBOARD AUDIT  */}
              {maturitySubTab === "dashboard" && (() => {
                return (
                  <div>
                    {/* Three Cards Row */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
                      {[
                        { title: "Jumlah Audit Terdaftar", value: `${uptAudits.length} Audit`, desc: `Riwayat asesmen ${selectedMaturityUpt}`, color: "#3b82f6", icon: (
                          <svg style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2" />
                          </svg>
                        ) },
                        { title: "Total Berkas Uploaded", value: `${evidenceCount} Berkas`, desc: "Bukti fisik terunggah ke Drive", color: "#10b981", icon: (
                          <svg style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        ) },
                        { title: "Status Asesmen Saat Ini", value: statusLabel, desc: `Posisi alur kerja untuk ${selectedMaturityUpt}`, color: statusColor, icon: (
                          <svg style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        ) }
                      ].map((c, i) => (
                        <div key={i} style={{
                          background: "white",
                          border: "1px solid #e2e8f0",
                          borderRadius: 14,
                          padding: "20px",
                          boxShadow: "0 4px 10px rgba(15, 23, 42, 0.03)",
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          transition: "all 0.2s ease"
                        }}>
                          <div style={{ width: 44, height: 44, borderRadius: 14, background: `${c.color}10`, color: c.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {c.icon}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.title}</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", margin: "4px 0 2px 0", letterSpacing: "-0.3px" }}>{c.value}</div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>{c.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* History Audit Block */}
                    <div style={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 24,
                      marginBottom: 20,
                      boxShadow: "0 4px 10px rgba(15, 23, 42, 0.03)"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
                        <div>
                          <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", margin: 0 }}>History Audit</h3>
                          <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0" }}>Tren skor audit beberapa semester terakhir.</p>
                        </div>
                        {historyChange !== null && <div style={{
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          borderRadius: 14,
                          padding: "4px 12px",
                          fontSize: 12,
                          fontWeight: 800,
                          color: historyChange >= 0 ? "#1d4ed8" : "#b91c1c",
                          display: "flex",
                          alignItems: "center",
                          gap: 4
                        }}>
                          <span>Perubahan terakhir</span>
                          <strong>{historyChange >= 0 ? "+" : ""}{historyChange.toFixed(2)}</strong>
                        </div>}
                      </div>

                      {uptAuditHistory.length === 0 ? (
                        <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "42px 16px", border: "1px dashed #cbd5e1", borderRadius: 14, background: "#f8fafc" }}>
                          Belum ada riwayat nilai audit untuk {selectedMaturityUpt}.
                        </div>
                      ) : (<div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1.2fr", gap: 24 }}>
                        {/* Bar Chart Container */}
                        <div style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 14,
                          padding: "20px 16px 16px 16px",
                          background: "#f8fafc",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          minHeight: 220
                        }}>
                          <div style={{ display: "flex", justifyContent: "center", gap: 4, alignItems: "flex-end", height: 160, paddingBottom: 10, borderBottom: "1.5px solid #cbd5e1" }}>
                            {uptAuditHistory.map(bar => {
                              const heightPct = (bar.score / 5) * 100;
                              return (
                                <div key={bar.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "1 1 0", minWidth: 0, maxWidth: 72, height: "100%", justifyContent: "flex-end" }}>
                                  <span style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>{bar.score.toFixed(2)}</span>
                                  <div style={{
                                    width: "100%",
                                    height: `${heightPct}%`,
                                    background: "linear-gradient(to top, #1e3a8a, #3b82f6)",
                                    borderRadius: "4px 4px 0 0",
                                    transition: "height 0.5s ease-out"
                                  }} />
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ display: "flex", justifyContent: "center", gap: 4, paddingTop: 8 }}>
                            {uptAuditHistory.map(item => (
                              <div key={item.id} style={{ flex: "1 1 0", minWidth: 0, maxWidth: 72, textAlign: "center", fontSize: 12, fontWeight: 800, color: "#64748b", lineHeight: 1.15 }}>S{item.semester} {item.tahun}</div>
                            ))}
                          </div>
                        </div>

                        {/* List Container */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {/* Latest Score Card */}
                          <div style={{
                            background: "#e0f2fe",
                            border: "1px solid #bae6fd",
                            borderRadius: 14,
                            padding: "12px 14px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}>
                            <div>
                              <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>Skor Terbaru</div>
                              <div style={{ fontSize: 20, fontWeight: 900, color: "#0369a1", margin: "2px 0", lineHeight: 1.1 }}>{latestHistory.score.toFixed(2)}</div>
                              <div style={{ fontSize: 12, color: HISTORY_STATUS_COLOR[latestHistory.status] || "#0284c7", fontWeight: 600 }}>Semester {latestHistory.semester} {latestHistory.tahun} - {HISTORY_STATUS_LABEL[latestHistory.status] || latestHistory.status}</div>
                            </div>
                          </div>

                          {/* History items list */}
                          {recentHistory.map(item => {
                            const color = HISTORY_STATUS_COLOR[item.status] || "#64748b";
                            return <div key={item.id} style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "10px 14px",
                              background: "white",
                              border: "1px solid #e2e8f0",
                              borderRadius: 14
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>S{item.semester} {item.tahun}</span>
                                <span style={{
                                  fontSize: 12,
                                  fontWeight: 800,
                                  padding: "2px 6px",
                                  borderRadius: 14,
                                  background: color + "15",
                                  color,
                                  textTransform: "uppercase"
                                }}>{item.status}</span>
                              </div>
                              <strong style={{ fontSize: 13, fontWeight: 950, color: "#0f172a" }}>{item.score.toFixed(2)}</strong>
                            </div>
                          })}
                        </div>
                      </div>
                    )}</div>

                    {/* Bottom 2x2 Grid */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 20 }}>
                      {/* Yang sudah bagus */}
                      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, boxShadow: "0 4px 10px rgba(15, 23, 42, 0.03)" }}>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>Yang Sudah Bagus</h3>
                        <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 14px 0" }}>Kategori dengan skor tertinggi</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {[
                            { title: "Tata Kelola", desc: "Sudah mendekati standar maturity yang diharapkan.", val: "1.10", color: "#1d4ed8", bg: "#eff6ff" },
                            { title: "Tenaga Kerja", desc: "Sudah mendekati standar maturity yang diharapkan.", val: "0.00", color: "#1d4ed8", bg: "#eff6ff" }
                          ].map((item, idx) => (
                            <div key={idx} style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "10px 14px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 14,
                              background: "#f8fafc"
                            }}>
                              <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{item.title}</div>
                                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.desc}</div>
                              </div>
                              <span style={{
                                background: item.bg,
                                color: item.color,
                                border: `1px solid ${item.color}33`,
                                borderRadius: 10,
                                padding: "4px 10px",
                                fontSize: 13,
                                fontWeight: 900
                              }}>{item.val}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Yang masih kurang */}
                      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, boxShadow: "0 4px 10px rgba(15, 23, 42, 0.03)" }}>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>Yang Masih Kurang</h3>
                        <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 14px 0" }}>Prioritas pemeriksaan berikutnya</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {[
                            { title: "Tenaga Kerja", desc: "Perlu penguatan evidence, konsistensi proses, dan catatan tindak lanjut.", val: "0.00", color: "#ea580c", bg: "#fff7ed" },
                            { title: "Sarana Prasarana", desc: "Perlu penguatan evidence, konsistensi proses, dan catatan tindak lanjut.", val: "0.00", color: "#ea580c", bg: "#fff7ed" }
                          ].map((item, idx) => (
                            <div key={idx} style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "10px 14px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 14,
                              background: "#f8fafc"
                            }}>
                              <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{item.title}</div>
                                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.desc}</div>
                              </div>
                              <span style={{
                                background: item.bg,
                                color: item.color,
                                border: `1px solid ${item.color}33`,
                                borderRadius: 10,
                                padding: "4px 10px",
                                fontSize: 13,
                                fontWeight: 900
                              }}>{item.val}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Peluang peningkatan nilai */}
                      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, boxShadow: "0 4px 10px rgba(15, 23, 42, 0.03)" }}>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>Peluang Peningkatan Nilai</h3>
                        <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 14px 0" }}>Target per kategori sampai akhir periode</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                          {[
                            { title: "Tenaga Kerja", target: "Naikkan dari 0.00 ke 4.00", val: 50 },
                            { title: "Sarana Prasarana", target: "Naikkan dari 0.00 ke 4.00", val: 35 }
                          ].map((item, idx) => (
                            <div key={idx}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{item.title}</span>
                                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{item.target}</span>
                              </div>
                              <div style={{ height: 6, borderRadius: 10, background: "#e2e8f0", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${item.val}%`, background: "#0e7490", borderRadius: 10 }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Target waktu */}
                      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, boxShadow: "0 4px 10px rgba(15, 23, 42, 0.03)" }}>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: 0 }}>Target Waktu</h3>
                        <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 14px 0" }}>Rencana penyelesaian audit berjalan</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative", paddingLeft: 16 }}>
                          {/* Vertical line */}
                          <div style={{ position: "absolute", left: 4, top: 8, bottom: 8, width: 2, background: "#cbd5e1" }} />
                          {[
                            { date: "31 Juli 2026", desc: "Input evidence wajib selesai oleh UPT." },
                            { date: "14 Agustus 2026", desc: "Review dan koreksi UIT selesai." },
                            { date: "31 Agustus 2026", desc: "Finalisasi skor auditor pusat." }
                          ].map((item, idx) => (
                            <div key={idx} style={{ position: "relative" }}>
                              {/* Bullet circle */}
                              <div style={{
                                position: "absolute",
                                left: -16.5,
                                top: 3.5,
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: "#2563eb",
                                border: "2px solid white",
                                boxShadow: "0 0 0 2px #2563eb33"
                              }} />
                              <div style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8" }}>{item.date}</div>
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{item.desc}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/*  PELAKSANAAN AUDIT  */}
              {maturitySubTab === "pelaksanaan" && (
                <div>
                  {/* HEADER — navigasi */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
                      {maturityAuditModal ? (maturityAuditModal.isNew ? "Audit Maturity Baru" : "Edit Audit Maturity") : "Pelaksanaan Audit Maturity"}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {maturityAuditModal && (
                        <button style={sty.btn("ghost")} onClick={() => setMaturityAuditModal(null)}>← Kembali ke Daftar</button>
                      )}
                    </div>
                  </div>

                  {maturityAuditModal && (() => {
                    return (
                      <MaturityAuditEditor
                        maturityAuditModal={maturityAuditModal}
                        setMaturityAuditModal={setMaturityAuditModal}
                        currentUser={currentUser}
                        hasRole={hasRole}
                        C={C}
                        sty={sty}
                        isMobile={isMobile}
                        maturityAuditForm={maturityAuditForm}
                        setMaturityAuditForm={setMaturityAuditForm}
                        maturityAuditEvidence={maturityAuditEvidence}
                        setMaturityAuditEvidence={setMaturityAuditEvidence}
                        expandedAspek={expandedAspek}
                        setExpandedAspek={setExpandedAspek}
                        activeAspectId={activeAspectId}
                        setActiveAspectId={setActiveAspectId}
                        aspectPage={aspectPage}
                        setAspectPage={setAspectPage}
                        saveMaturityAudit={saveMaturityAudit}
                        autosaveMaturityDraft={autosaveMaturityDraft}
                        maturityDraftSavedAt={maturityDraftSavedAt}
                        deleteMaturityAudit={deleteMaturityAudit}
                        maturityAuditSaving={maturityAuditSaving}
                        calculateItemLevel={calculateItemLevel}
                        selectedUpt={selectedMaturityUpt}
                        askConfirmDelete={askConfirmDelete}
                      />
                    );
                  })()}

                  {/*  DAFTAR AUDIT (bila tidak sedang input/edit)  */}
                  {!maturityAuditModal && (() => {
                    const _nowD = new Date();
                    const auditHasThisMonth = uptAudits.some(a => {
                      const d = new Date(a.createdAt);
                      return d.getMonth() === _nowD.getMonth() && d.getFullYear() === _nowD.getFullYear();
                    });
                    // Daftar audit ikut discope ke UPT terpilih — sebelumnya memakai
                    // `maturityAudits` mentah sehingga audit UPT lain ikut terdaftar.
                    const auditTotal = uptAudits.length;
                    const auditPageItems = uptAudits.slice((auditListPage - 1) * 5, auditListPage * 5);
                    return (
                    <>


                      {/* List audit */}
                      <div style={{
                        ...sty.card,
                        boxShadow: is3D ? "-6px 8px 20px rgba(15, 23, 42, 0.08)" : "0 2px 8px rgba(0,0,0,0.03)",
                        border: "1.5px solid #cbd5e1",
                        transition: "box-shadow 0.4s ease"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Daftar Audit Aktif</div>
                          <button
                            style={{ ...sty.btn("primary"), padding: "6px 14px", borderRadius: 10, fontSize: 13, fontWeight: 800, opacity: auditHasThisMonth ? 0.5 : 1, cursor: auditHasThisMonth ? "not-allowed" : "pointer" }}
                            onClick={createMaturityAudit}
                            disabled={auditHasThisMonth}
                            title={auditHasThisMonth ? "UPT ini sudah punya audit bulan ini — audit baru hanya 1x per bulan." : "Buat audit maturity baru"}
                          >
                            + Audit Baru
                          </button>
                        </div>
                        {uptAudits.length === 0 ? (
                          <div style={{ textAlign: "center", padding: 32 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Belum ada audit</div>
                            <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Klik "+ Audit Baru" untuk memulai asesmen maturity level gudang.</div>
                            <button style={sty.btn("primary")} onClick={createMaturityAudit}>
                              + Audit Baru
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {auditPageItems.map(a => {
                              // Matriks sama persis dengan policy "Maturity audits update by stage".
                              // ASMAN/MANAGER read-only di jenjang UPT (keputusan user 2026-08-02).
                              const canEditUPT = hasRole(currentUser, "ADMIN", "TL") && (a.status === "DRAFT" || a.status === "SELF_ASSESSMENT" || a.status === "REVISION");
                              const canEditUIT = hasRole(currentUser, "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT") && a.status === "REVIEW_UIT"; // SUPERADMIN ikut lolos
                              // Pusat = ADMIN_LOG_PUSAT (+ SUPERADMIN lewat hasRole). MANAGER sengaja
                              // TIDAK di sini — ia terikat satu UPT, jadi akan menilai final UPT-nya sendiri.
                              const canEditPusat = hasRole(currentUser, "ADMIN_LOG_PUSAT") && (a.status === "REVIEW_PUSAT" || a.status === "FINAL");
                              const canReview = canEditUPT || canEditUIT || canEditPusat;
                              return (
                                <div key={a.id} style={{
                                  padding: 14,
                                  borderRadius: 10,
                                  border: `1.5px solid #cbd5e1`,
                                  background: a.status === "FINAL" ? `${MATURITY_WORKFLOW_COLOR.FINAL}08` : "white",
                                  boxShadow: is3D ? "0 4px 12px rgba(15, 23, 42, 0.08), -2px 4px 8px rgba(0,0,0,0.04)" : "none",
                                  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                                  cursor: "default",
                                  position: "relative"
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.boxShadow = is3D ? "0 12px 28px rgba(15, 23, 42, 0.15), -4px 6px 16px rgba(0,0,0,0.08)" : "none";
                                  e.currentTarget.style.borderColor = "#2563eb";
                                  e.currentTarget.style.transform = "translateY(-2px)";
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.boxShadow = is3D ? "0 4px 12px rgba(15, 23, 42, 0.08), -2px 4px 8px rgba(0,0,0,0.04)" : "none";
                                  e.currentTarget.style.borderColor = "#cbd5e1";
                                  e.currentTarget.style.transform = "translateY(0)";
                                }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", position: "relative", zIndex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                      <div style={{ width: 44, height: 44, borderRadius: 10, background: MATURITY_WORKFLOW_COLOR[a.status], color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, flexShrink: 0 }}>{a.level || "—"}</div>
                                      <div>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Level {a.level || "?"} — {MATURITY_LEVELS[a.level] || "Proses"}</div>
                                        <div style={{ fontSize: 12, color: MATURITY_WORKFLOW_COLOR[a.status], fontWeight: 600, marginTop: 2 }}>{MATURITY_WORKFLOW_LABEL[a.status]}</div>
                                        {a.createdAt && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Dibuat: {fmtDateOnly(a.createdAt)}</div>}
                                      </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", position: "relative", zIndex: 20 }}>
                                      <button style={{ ...sty.btn("ghost", "sm"), fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", pointerEvents: "auto" }} onClick={e => { e.stopPropagation(); exportMaturityAuditExcel(a); }}>
                                        Excel
                                      </button>
                                      {canReview && <button style={{ ...sty.btn("primary", "sm"), fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", pointerEvents: "auto" }} onClick={e => { e.stopPropagation(); openMaturityAudit(a); }}>
                                        {canEditUPT ? "Input" : "Review"}
                                      </button>}
                                      {hasRole(currentUser, "ADMIN", "SUPERADMIN", "TL") && (
                                        <button style={{ ...sty.btn("ghost", "sm"), fontSize: 12, color: C.red, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", pointerEvents: "auto" }} onClick={e => { e.stopPropagation(); deleteMaturityAudit(a.id); }}>
                                          Hapus
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {a.aspekScores && (
                                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(2,1fr)", gap: 6, marginTop: 12 }}>
                                      {[
                                        { label: "Skor UIT", key: "uit" },
                                        { label: "Skor Pusat", key: "pusat" },
                                      ].map(col => {
                                        const avg = AUDIT_ASPECTS.reduce((s, as) => s + (a.aspekScores[as.id]?.[col.key] || 0), 0) / AUDIT_ASPECTS.length;
                                        return (
                                          <div key={col.key} style={{ padding: 8, borderRadius: 10, background: C.muted + "11", textAlign: "center" }}>
                                            <div style={{ fontSize: 12, color: C.muted }}>{col.label}</div>
                                            <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginTop: 2 }}>{avg > 0 ? avg.toFixed(1) : "—"}</div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {a.fileNama && <div style={{ fontSize: 12, color: C.muted, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>{a.fileNama}</div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {auditTotal > 5 && (
                          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
                            {auditListPage > 1 && (
                              <button className="approval-btn--cancel" onClick={() => setAuditListPage(p => Math.max(1, p - 1))}>‹ Sebelumnya</button>
                            )}
                            <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
                              Hal {auditListPage} / {Math.ceil(auditTotal / 5)}
                            </span>
                            {auditListPage * 5 < auditTotal && (
                              <button className="approval-btn--cancel" onClick={() => setAuditListPage(p => p + 1)}>Berikutnya ›</button>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                    );
                  })()}
                </div>
              )}

              {/*  HISTORY AUDIT  */}
              {maturitySubTab === "history" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Riwayat Audit Maturity</div>
                    <button style={sty.btn("ghost")} onClick={() => setMaturitySubTab("pelaksanaan")}>← Kembali</button>
                  </div>
                  <div style={{ ...sty.card }}>
                    {uptAudits.filter(a => a.status === "FINAL").length === 0 ? (
                      <div style={{ fontSize: 13, color: C.muted, textAlign: "center", padding: 32 }}>Belum ada audit yang final dinilai Pusat.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {uptAudits.filter(a => a.status === "FINAL").map(a => (
                          <div key={a.id} onClick={() => { openMaturityAudit(a); setMaturitySubTab("pelaksanaan"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.border}`, cursor: "pointer", transition: "background .15s" }} onMouseEnter={e => e.currentTarget.style.background = C.border} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                              <div style={{ width: 40, height: 40, borderRadius: 10, background: MATURITY_WORKFLOW_COLOR[a.status], color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17, flexShrink: 0 }}>{a.level || "—"}</div>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Level {a.level || "?"} — {MATURITY_LEVELS[a.level] || "Proses"}</div>
                                <div style={{ fontSize: 12, color: MATURITY_WORKFLOW_COLOR[a.status], fontWeight: 600 }}>{MATURITY_WORKFLOW_LABEL[a.status]}</div>
                                {a.catatanUPT && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>UPT: {a.catatanUPT.slice(0, 60)}{a.catatanUPT.length > 60 ? "…" : ""}</div>}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                              <div style={{ fontSize: 13, color: C.muted }}>{fmtDate(a.updatedAt || a.createdAt)}</div>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button style={{ ...sty.btn("ghost", "sm"), display: "inline-flex", alignItems: "center", gap: 4 }} onClick={e => { e.stopPropagation(); exportMaturityAuditExcel(a); }}>Export</button>
                                {hasRole(currentUser, "ADMIN", "SUPERADMIN", "TL") && (
                                  <button style={{ ...sty.btn("ghost", "sm"), color: C.red, display: "inline-flex", alignItems: "center", gap: 4 }} onClick={e => { e.stopPropagation(); deleteMaturityAudit(a.id); }}>Hapus</button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/*  FORM PENGISIAN 5S  */}
              {maturitySubTab === "5s" && (
                <Form5STab C={C} sty={sty} currentUser={currentUser} gudangList={gudangList}
                  maturity5SAssessments={maturity5SAssessments} saveMaturity5SAssessment={saveMaturity5SAssessment}
                  setMaturityAuditEvidence={setMaturityAuditEvidence} isMobile={isMobile} selectedUpt={selectedMaturityUpt}
                  askConfirmDelete={askConfirmDelete} />
              )}
            </div>
            );
}
