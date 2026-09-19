import { useMemo, useState } from "react";
import { Form5STab } from "./MaturityAuditSystem.jsx";
import { maturityUptOptions } from "../lib/maturityUit.js";

function latestFor(assessments, uptId) {
  return (assessments || [])
    .filter(item => item.uptId === uptId)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;
}

function photoStatus(assessments, uptId) {
  const rows = (assessments || []).filter(item => item.uptId === uptId);
  const photos = rows.flatMap(item => item.samplePhotos || []);
  if (!photos.length) return "Belum ada";
  return photos.every(photo => photo.storagePath && photo.storageStatus === "BACKUP_RECORDED") ? "Self-host" : "Perlu sinkron";
}

export function Form5SPage({
  C, sty, currentUser, isMobile, uptList = [], gudangList = [], assessments = [],
  selectedUpt, selectedUptId, setSelectedUpt, canSwitchMaturityUpt,
  saveMaturity5SAssessment, maturity5SDraft, saveMaturity5SDraft, clearMaturity5SDraft,
  setMaturityAuditEvidence, askConfirmDelete, users = [],
}) {
  const options = useMemo(() => maturityUptOptions(currentUser, uptList), [currentUser?.role, currentUser?.uitId, currentUser?.uptId, uptList]);
  const selected = options.find(u => u.id === selectedUptId) || options.find(u => u.nama === selectedUpt) || options[0] || null;
  const activeUptId = selected?.id || selectedUptId || "";
  const activeUptName = selected?.nama || selectedUpt || "";
  const canWrite = ["ADMIN", "TL", "SUPERADMIN"].includes(currentUser?.role);
  const [historyRequest, setHistoryRequest] = useState("");
  const activeGudang = useMemo(
    () => (gudangList || []).filter(gudang => gudang.uptId === activeUptId || gudang.upt_id === activeUptId),
    [gudangList, activeUptId]
  );
  const rows = options.map(upt => {
    const latest = latestFor(assessments, upt.id);
    const records = assessments.filter(item => item.uptId === upt.id);
    return {
      upt,
      latest,
      records: records.length,
      photos: records.reduce((sum, item) => sum + (item.samplePhotos || []).length, 0),
      storage: photoStatus(assessments, upt.id),
    };
  });

  const openHistory = row => {
    setSelectedUpt(row.upt.nama);
    setHistoryRequest(`${row.upt.id}:${Date.now()}`);
  };

  return (
    <div className="operations-page">
      <div className="kpi-banner" style={{ padding: isMobile ? "14px 16px" : "16px 22px", marginBottom: 16 }}>
        <div>
          <div style={{ color: "#93c5fd", fontSize: 12, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase" }}>Warehouse 5S</div>
          <div style={{ color: "white", fontSize: 20, fontWeight: 900, marginTop: 3 }}>Form Pengisian 5S</div>
          <div style={{ color: "rgba(219,234,254,.82)", fontSize: 13, marginTop: 3 }}>
            {canSwitchMaturityUpt ? "Ringkasan pengisian per UPT dalam scope Anda." : `Pengisian dan history ${activeUptName}.`}
          </div>
        </div>
      </div>

      {canSwitchMaturityUpt && (
        <div style={{ ...sty.card, padding: isMobile ? 10 : 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, lineHeight: 1.25, fontWeight: 900, color: C.text }}>Ringkasan UPT</div>
              <div style={{ fontSize: 12, lineHeight: 1.4, color: C.muted, marginTop: 2 }}>{rows.filter(row => row.latest).length}/{rows.length} UPT sudah mengisi</div>
            </div>
            <label style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: 6, color: C.muted, fontSize: 12, lineHeight: 1.3 }}>
              <span>Filter UPT</span>
              <select
                aria-label="Filter UPT"
                value={activeUptId}
                onChange={event => {
                  const next = options.find(option => option.id === event.target.value);
                  if (!next) return;
                  setSelectedUpt(next.nama);
                  setHistoryRequest(`${next.id}:${Date.now()}`);
                }}
                style={{ minHeight: 44, minWidth: isMobile ? "100%" : 190, maxWidth: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface || "white", color: C.text, fontSize: 13, fontWeight: 700 }}
              >
                {options.map(option => <option key={option.id} value={option.id}>{option.nama}</option>)}
              </select>
            </label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="mobile-card-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>{["UPT", "Periode terakhir", "Gudang", "Skor", "Pengisian", "Foto", "Backup", "Diperbarui"].map(label => <th key={label} style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 11, lineHeight: 1.3, fontWeight: 800, textTransform: "uppercase" }}>{label}</th>)}</tr></thead>
              <tbody>{rows.map(row => {
                const active = row.upt.id === activeUptId;
                const latest = row.latest;
                return <tr key={row.upt.id} onClick={() => openHistory(row)} style={{ cursor: "pointer", background: active ? `${C.accent}12` : "transparent" }}>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 800 }}>{row.upt.nama}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 13 }}>{latest ? `${latest.bulan}/${latest.tahun}` : "Belum mengisi"}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 13 }}>{latest?.gudangNama || "-"}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 800 }}>{latest ? `${Number(latest.scorePercent || 0).toFixed(1)}%` : "-"}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 13 }}>{row.records}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 13 }}>{row.photos}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, color: row.storage === "Self-host" ? C.green : C.muted, fontSize: 13 }}>{row.storage}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 13 }}>{latest?.createdAt ? new Date(latest.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      <Form5STab
        key={`${activeUptId}:${historyRequest}`}
        C={C} sty={sty} currentUser={currentUser} gudangList={activeGudang}
        maturity5SAssessments={assessments} saveMaturity5SAssessment={canWrite ? saveMaturity5SAssessment : null}
        maturity5SDraft={canWrite ? maturity5SDraft : null}
        saveMaturity5SDraft={canWrite ? saveMaturity5SDraft : null}
        clearMaturity5SDraft={canWrite ? clearMaturity5SDraft : null}
        setMaturityAuditEvidence={setMaturityAuditEvidence} isMobile={isMobile} selectedUpt={activeUptName}
        uptId={activeUptId} users={users} uptList={uptList} askConfirmDelete={askConfirmDelete}
        readOnly={!canWrite} defaultSubTab={canWrite ? "entry" : "history"}
      />
    </div>
  );
}
