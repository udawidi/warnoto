// Komponen MaterialCadangTab — dipindah dari App.jsx (refactor Fase 5h).
import { useState } from "react";
import { fmtNum } from "../lib/ragShared.mjs";
import { hasRole } from "../lib/roles.js";
import { normalizeKatalog } from "../lib/sap.js";
import { syncMaterialCadangRows } from "../lib/masterSync.js";
import { CLOUD } from "../lib/cloud.js";
import { parseMaterialCadangRows, hitungMaterialCadang, enrichMaterialCadangHealthResults, generateMaterialCadangAiInsights, mapApplyAuditRow } from "../lib/materialCadang.js";
import * as XLSX from "xlsx";

export function MaterialCadangTab({ materialCadangData, setMaterialCadangData, materialCadangHealthData, setMaterialCadangHealthData, materialCadangAiInsights, setMaterialCadangAiInsights, maraReference, setMaraReference, catalogMasterRef, setCatalogMasterRef, katalogList, setKatalogList, stocks, txns, currentUser, sty, C, saveToCloud, showToast }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { rows, stats, fileName }
  const [analisisResult, setAnalisisResult] = useState(null); // hasil hitung terbaru
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraSearch, setMaraSearch] = useState("");
  const [applyConfirm, setApplyConfirm] = useState(null); // { item } yang akan di-apply ke minQty
  const [applyNotes, setApplyNotes] = useState("");
  const [detailItem, setDetailItem] = useState(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);

  const canEdit = hasRole(currentUser, "ADMIN","TL");
  const canApprove = hasRole(currentUser, "ASMAN");

  // Guard defensif terhadap shape data lama/tidak lengkap dari localStorage/CLOUD
  // (mis. tersimpan sebelum field ini ada) — tanpa ini, akses .slice/.filter
  // langsung ke field undefined bikin seluruh halaman blank putih (belum ada
  // Error Boundary di app ini untuk menangkap crash render seperti ini).
  const mcData = { imports: materialCadangData?.imports||[], analyses: materialCadangData?.analyses||[], applyHistory: materialCadangData?.applyHistory||[] };
  const mcHealth = { imports: materialCadangHealthData?.imports||[], analysisRuns: materialCadangHealthData?.analysisRuns||[], healthResults: materialCadangHealthData?.healthResults||[], applyAudit: materialCadangHealthData?.applyAudit||[] };
  const mcAi = { runs: materialCadangAiInsights?.runs||[], materialInsights: materialCadangAiInsights?.materialInsights||[] };

  // Analisis terakhir dari data tersimpan
  const latestAnalysis = mcData.analyses.slice(-1)[0] || null;
  const latestHealthRun = mcHealth.analysisRuns.slice(-1)[0] || null;
  const latestHealthResults = latestHealthRun
    ? mcHealth.healthResults.filter(r => r.runId === latestHealthRun.id)
    : [];
  const latestResults = latestHealthResults.length ? latestHealthResults : enrichMaterialCadangHealthResults(latestAnalysis?.results || []);
  const latestAiInsight = latestHealthRun
    ? mcAi.runs.find(r => r.runId === latestHealthRun.id)
    : null;

  // Summary dari hasil analisis
  const summary = latestResults.reduce((acc, r) => {
    acc.total++;
    if (r.healthStatus) acc.healthCounts[r.healthStatus] = (acc.healthCounts[r.healthStatus]||0) + 1;
    acc.healthSum += r.healthIndex || 0;
    acc.confidenceSum += r.dataConfidence || 0;
    if (r.treatment !== "Material Cadang") { acc.persediaan++; return acc; }
    if (r.currentQty >= r.recommendedQty && r.recommendedQty > 0) acc.aman++;
    else if (r.currentQty > 0 && r.currentQty < r.recommendedQty) acc.kurang++;
    else if (r.recommendedQty > 0 && r.currentQty === 0) acc.kosong++;
    acc.gapQty += r.gapQty;
    acc.gapNilai += r.gapQty * (r.harga || 0);
    return acc;
  }, { total:0, aman:0, kurang:0, kosong:0, persediaan:0, gapQty:0, gapNilai:0, healthSum:0, confidenceSum:0, healthCounts:{} });
  summary.avgHealth = summary.total ? Math.round(summary.healthSum / summary.total) : 0;
  summary.avgConfidence = summary.total ? Math.round(summary.confidenceSum / summary.total) : 0;

  // Pending apply (menunggu Asman)
  const pendingApply = mcData.applyHistory.filter(h => h.status === "PENDING_ASMAN");

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
        // CSV: cari baris header (baris ke-1 atau yang mengandung "No Katalog")
        let hIdx = 0;
        for (let i=0; i<Math.min(5,lines.length); i++) {
          if (lines[i].toLowerCase().includes("no katalog")) { hIdx = i; break; }
        }
        const headers = lines[hIdx].split(",").map(h => h.trim().replace(/^"|"$/g,""));
        rows = lines.slice(hIdx+1).filter(l=>l.trim()).map(l => {
          const vals = l.split(",").map(v => v.trim().replace(/^"|"$/g,""));
          const obj = {};
          headers.forEach((h,i) => { obj[h] = vals[i] || ""; });
          return obj;
        });
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        // Cari sheet Import Material Cadang, atau sheet pertama
        const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes("import material cadang")) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        // Header di baris ke-3 (index 2)
        const raw = XLSX.utils.sheet_to_json(ws, { header:1 });
        const hRowIdx = raw.findIndex((row,i) => i>=1 && Array.isArray(row) && row.some(c => String(c||"").toLowerCase().includes("no katalog")));
        const hRow = raw[hRowIdx >= 0 ? hRowIdx : 0];
        rows = raw.slice((hRowIdx >= 0 ? hRowIdx : 0) + 1).filter(r => r.some(Boolean)).map(r => {
          const obj = {};
          hRow.forEach((h,i) => { obj[String(h||"").trim()] = r[i] !== undefined ? r[i] : ""; });
          return obj;
        });
      }
      const parsed = parseMaterialCadangRows(rows, katalogList);
      const stats = {
        total: parsed.length,
        match: parsed.filter(r=>r.status==="MATCH").length,
        warning: parsed.filter(r=>r.status==="WARNING_NAME_DIFF"||r.status==="DUPLICATE_MERGED").length,
        unmatched: parsed.filter(r=>r.status==="UNMATCHED").length,
        invalid: parsed.filter(r=>r.status==="INVALID").length,
      };
      setImportPreview({ rows: parsed, stats, fileName: file.name });
    } catch(err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
    setImporting(false);
    e.target.value = "";
  }

  async function handleHitung() {
    if (!importPreview) return;
    const baseResults = hitungMaterialCadang(importPreview.rows, stocks, katalogList);
    const results = enrichMaterialCadangHealthResults(baseResults);
    const runId = "MCHI-" + Date.now();
    const newAnalysis = {
      id: "MCANA-" + Date.now(),
      importFileName: importPreview.fileName,
      createdBy: currentUser.id,
      createdAt: Date.now(),
      results,
      params: { periodYears:5, slMandatory:0.99, slOptimum:0.95, slEconomic:0.90 },
    };
    const importRecord = {
      id: "MCIMP-" + Date.now(),
      fileName: importPreview.fileName,
      importedBy: currentUser.id,
      importedAt: Date.now(),
      stats: importPreview.stats,
    };
    const healthRun = {
      id: runId,
      legacyAnalysisId: newAnalysis.id,
      importId: importRecord.id,
      importFileName: importPreview.fileName,
      createdBy: currentUser.id,
      createdAt: Date.now(),
      modelAi: "llama-3.3-70b-versatile",
      params: newAnalysis.params,
    };
    const healthRows = results.map(r => ({ ...r, runId, resultId:`${runId}-${r.katalogId||r.noKat}-${String(r.cluster||"").replace(/\s+/g,"_")}` }));
    const updated = { ...mcData, analyses: [...mcData.analyses, newAnalysis] };
    const updatedHealth = {
      ...mcHealth,
      imports: [...(mcHealth.imports||[]), importRecord],
      analysisRuns: [...(mcHealth.analysisRuns||[]), healthRun],
      healthResults: [...(mcHealth.healthResults||[]), ...healthRows],
    };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    setAnalisisResult(healthRows);
    setSubTab("health");
    showToast("Health Index Material Cadang berhasil dihitung.", "success");

    // Backup ke Supabase (audit trail) — append-only, tidak mengubah angka
    // deterministic di atas, murni menyimpan apa yang sudah dihitung lokal.
    syncMaterialCadangRows("material_cadang_imports", [importRecord], r => ({
      id: r.id, file_name: r.fileName, imported_by: r.importedBy, imported_at: r.importedAt,
      total_rows: r.stats?.total||0, valid_rows: r.stats?.match||0, warning_rows: r.stats?.warning||0,
      invalid_rows: (r.stats?.invalid||0)+(r.stats?.unmatched||0), data_quality: r.stats||{}, raw_meta: {},
    }));
    syncMaterialCadangRows("material_cadang_analysis_runs", [healthRun], r => ({
      id: r.id, import_id: r.importId, legacy_analysis_id: r.legacyAnalysisId, created_by: r.createdBy,
      created_at: r.createdAt, model_ai: r.modelAi, params: r.params||{}, summary: {},
    }));
    syncMaterialCadangRows("material_cadang_health_results", healthRows, r => ({
      id: r.resultId, run_id: r.runId, katalog_id: r.katalogId||null, no_katalog: r.noKat||null,
      nama_material: r.katalogName||r.namaMaterial||null, health_index: r.healthIndex, health_status: r.healthStatus,
      risk_score: r.riskScore, data_confidence: r.dataConfidence, abc_class: r.abcClass, policy: r.policy,
      current_qty: r.currentQty, recommended_qty: r.recommendedQty, gap_qty: r.gapQty,
      gap_value: (r.gapQty||0)*(r.harga||0), deterministic_breakdown: r.healthBreakdown||{},
      data_quality_flags: r.dataQualityFlags||[], result_payload: r,
    }));

    setAiInsightLoading(true);
    const aiRun = await generateMaterialCadangAiInsights(healthRun, healthRows, stocks, katalogList, txns);
    const materialInsights = (aiRun.materialInsights||[]).map((m, idx)=>({ ...m, id:`${aiRun.id}-MI-${idx}`, runId }));
    const updatedAi = {
      runs: [...(mcAi.runs||[]), { ...aiRun, materialInsights: undefined }],
      materialInsights: [...(mcAi.materialInsights||[]), ...materialInsights],
    };
    setMaterialCadangAiInsights(updatedAi);
    await saveToCloud({ materialCadangAiInsights: updatedAi });
    setAiInsightLoading(false);
    if (aiRun.status === "ANSWERED") showToast("AI Management Insight berhasil dibuat.", "success");
    else showToast("Health Index selesai. AI insight belum tersedia, data lokal tetap aman.", "error");

    // Backup insight ke Supabase — 1 baris scope RUN (ringkasan) + N baris scope
    // MATERIAL (per item). AI cuma menulis kolom insight/diagnosis/rekomendasi,
    // tidak ada kolom angka resmi (healthIndex dst) di tabel ini sama sekali.
    const runInsightRow = {
      id: aiRun.id, runId: aiRun.runId, insight_scope: "RUN", model: aiRun.model, status: aiRun.status,
      confidence: null, executive_summary: aiRun.executiveSummary||null, diagnosis: null, recommendation: null,
      flags: aiRun.dataQualityFindings||[], created_at: aiRun.createdAt,
      insight_payload: { topRisks: aiRun.topRisks, recommendedActions: aiRun.recommendedActions, procurementPriority: aiRun.procurementPriority, validationNeeded: aiRun.validationNeeded },
    };
    syncMaterialCadangRows("material_cadang_ai_insights", [runInsightRow], r => ({
      id: r.id, run_id: r.runId, no_katalog: null, insight_scope: r.insight_scope, model: r.model,
      status: r.status, confidence: r.confidence, executive_summary: r.executive_summary,
      diagnosis: r.diagnosis, recommendation: r.recommendation, flags: r.flags, insight_payload: r.insight_payload,
      created_at: r.created_at,
    }));
    if (materialInsights.length) {
      syncMaterialCadangRows("material_cadang_ai_insights", materialInsights, r => ({
        id: r.id, run_id: r.runId, no_katalog: r.noKatalog||null, insight_scope: "MATERIAL", model: aiRun.model,
        status: aiRun.status, confidence: r.confidence ?? null, executive_summary: null,
        diagnosis: r.diagnosis||null, recommendation: r.recommendation||null, flags: [], insight_payload: r,
        created_at: aiRun.createdAt,
      }));
    }
  }

  async function handleAjukanApply(item) {
    const existing = mcData.applyHistory.find(h => h.katalogId === item.katalogId && h.status === "PENDING_ASMAN");
    if (existing) { showToast("Pengajuan untuk material ini sudah ada, tunggu keputusan Asman.", "error"); return; }
    const entry = {
      id: "MCAPPLY-" + Date.now(),
      katalogId: item.katalogId,
      namaBarang: item.katalogName || item.namaMaterial,
      noKatalog: item.noKat,
      recommendedQty: item.recommendedQty,
      abcClass: item.abcClass,
      policy: item.policy,
      runId: item.runId,
      healthIndex: item.healthIndex,
      healthStatus: item.healthStatus,
      status: "PENDING_ASMAN",
      requestedBy: currentUser.id,
      requestedAt: Date.now(),
      notes: applyNotes.trim(),
    };
    const updated = { ...mcData, applyHistory: [...mcData.applyHistory, entry] };
    const auditEntry = { ...entry, auditId:`${entry.id}-REQ`, action:"REQUEST_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now() };
    const updatedHealth = {
      ...mcHealth,
      applyAudit: [...(mcHealth.applyAudit||[]), auditEntry],
    };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    syncMaterialCadangRows("material_cadang_apply_audit", [auditEntry], mapApplyAuditRow);
    setApplyConfirm(null); setApplyNotes("");
    showToast("Pengajuan apply minQty dikirim ke Asman.", "success");
  }

  async function handleApproveApply(applyId) {
    const entry = mcData.applyHistory.find(h => h.id === applyId);
    if (!entry) return;
    // Update minQty di katalogList
    const updated = katalogList.map(k =>
      k.id === entry.katalogId ? { ...k, minQty: entry.recommendedQty, minQtyUpdatedAt: Date.now(), minQtyUpdatedBy: currentUser.id } : k
    );
    setKatalogList(updated);
    // Tandai apply sebagai APPROVED
    const updatedMC = {
      ...mcData,
      applyHistory: mcData.applyHistory.map(h =>
        h.id===applyId ? {...h, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now()} : h
      )
    };
    const approveAuditEntry = { ...entry, auditId:`${applyId}-APPROVE-${Date.now()}`, action:"APPROVE_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now(), appliedMinQty:entry.recommendedQty };
    const updatedHealth = {
      ...mcHealth,
      applyAudit: [...(mcHealth.applyAudit||[]), approveAuditEntry],
    };
    setMaterialCadangData(updatedMC);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ katalogList: updated, materialCadangData: updatedMC, materialCadangHealthData: updatedHealth });
    syncMaterialCadangRows("material_cadang_apply_audit", [approveAuditEntry], mapApplyAuditRow);
    showToast(`Min Qty ${entry.namaBarang} berhasil diperbarui ke ${entry.recommendedQty}.`, "success");
  }

  async function handleRejectApply(applyId, reason) {
    const entry = mcData.applyHistory.find(h => h.id === applyId);
    const updated = {
      ...mcData,
      applyHistory: mcData.applyHistory.map(h => h.id===applyId ? {...h, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : h)
    };
    const rejectAuditEntry = { ...(entry||{}), auditId:`${applyId}-REJECT-${Date.now()}`, action:"REJECT_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now(), rejectReason:reason };
    const updatedHealth = {
      ...mcHealth,
      applyAudit: [...(mcHealth.applyAudit||[]), rejectAuditEntry],
    };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    syncMaterialCadangRows("material_cadang_apply_audit", [rejectAuditEntry], mapApplyAuditRow);
    showToast("Pengajuan ditolak.", "success");
  }

  async function handleLoadMara(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaraLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet1 = wb.Sheets["Sheet1"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet1, { defval:"" });
      const unblockSheet = wb.Sheets["Katalog Unblock"];
      const unblockSet = new Set();
      if (unblockSheet) {
        XLSX.utils.sheet_to_json(unblockSheet, {defval:""}).forEach(r => {
          const raw = String(r["Material"]||r[Object.keys(r)[0]]||"").trim();
          unblockSet.add(normalizeKatalog(raw));
        });
      }
      const ref = rows.map(r => {
        const raw = String(r["Material"]||"").trim();
        const kat = normalizeKatalog(raw);
        return {
          materialRaw: raw,
          katalog: kat,
          materialType: String(r["Material Type"]||"").trim(),
          materialGroup: String(r["Material Group"]||"").trim(),
          satuan: String(r["Base Unit of Measure"]||"").trim(),
          status: String(r["X-plant matl status"]||"").trim(),
          description: String(r["Material Description"]||"").trim(),
          prefix: String(r["Material Description"]||"").split(";")[0].trim(),
          isCadang: String(r["Material Type"]||"").trim()==="ZCAD" || kat.length===10,
          isUnblocked: unblockSet.has(kat),
        };
      });
      setMaraReference(ref);
      showToast(`MARA reference berhasil dimuat: ${ref.length} material (session-only, tidak disimpan ke cloud).`, "success");
    } catch(err) {
      showToast("Gagal load MARA: " + err.message, "error");
    }
    setMaraLoading(false);
    e.target.value = "";
  }

  const displayResults = analisisResult || latestResults;
  const latestMaterialInsights = latestHealthRun
    ? mcAi.materialInsights.filter(m => m.runId === latestHealthRun.id)
    : [];
  const aiByNoKatalog = {};
  latestMaterialInsights.forEach(m => { if (m.noKatalog) aiByNoKatalog[normalizeKatalog(m.noKatalog)] = m; });
  const TABS = [
    {id:"health",label:"Health Index"},
    {id:"ai",label:"AI Insight"},
    {id:"dashboard",label:"📊 Dashboard"},
    {id:"import",label:"📥 Import & Hitung"},
    {id:"hasil",label:"📋 Hasil Analisis"},
    {id:"apply",label:"✅ Apply Min Qty",badge:pendingApply.length},
  ];

  return (
    <div>
      <div style={{marginBottom:16}}>
        <p style={{color:C.muted,fontSize:13}}>Analisis ABC, inventory policy, dan rekomendasi jumlah ideal material cadang</p>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=>(
          <button key={t.id} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${subTab===t.id?C.accent:C.border}`,background:subTab===t.id?C.accent:"white",color:subTab===t.id?"white":C.muted,fontWeight:700,fontSize:12,cursor:"pointer",position:"relative"}}
            onClick={()=>setSubTab(t.id)}>
            {t.label}{t.badge>0 && <span style={{marginLeft:6,background:"#dc2626",color:"white",borderRadius:10,padding:"1px 6px",fontSize:12}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* DASHBOARD */}
      {subTab==="dashboard" && (
        <div>
          {latestResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:40,color:C.muted}}>
              <div style={{fontSize:40,marginBottom:12}}>🔩</div>
              <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Material Cadang belum dianalisis</div>
              <div style={{fontSize:13,marginBottom:20}}>Upload data populasi/failure terlebih dahulu di tab "Import & Hitung"</div>
              {canEdit && <button style={sty.btn("primary")} onClick={()=>setSubTab("import")}>📥 Upload Data Populasi/Failure</button>}
            </div>
          ) : (
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
                {[
                  {label:"Total Dianalisis",val:summary.total,color:C.accent},
                  {label:"Aman ✅",val:summary.aman,color:C.green},
                  {label:"Kurang ⚠️",val:summary.kurang,color:"#f59e0b"},
                  {label:"Kosong/Kritis 🔴",val:summary.kosong,color:C.red},
                  {label:"Gap Qty",val:summary.gapQty,color:"#7c3aed"},
                  {label:"Estimasi Nilai Gap",val:"Rp "+fmtNum(summary.gapNilai),color:"#dc2626",small:true},
                ].map(kpi=>(
                  <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14}}>
                    <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                    <div style={{fontSize:kpi.small?14:22,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:16}}>
                {[
                  {label:"Critical",val:summary.healthCounts.Critical||0,color:"#dc2626"},
                  {label:"High Risk",val:summary.healthCounts["High Risk"]||0,color:"#ea580c"},
                  {label:"Watch",val:summary.healthCounts.Watch||0,color:"#f59e0b"},
                  {label:"Healthy",val:summary.healthCounts.Healthy||0,color:"#16a34a"},
                  {label:"Avg Health",val:summary.avgHealth+"/100",color:C.accent},
                  {label:"Data Confidence",val:summary.avgConfidence+"%",color:"#0f766e"},
                ].map(kpi=>(
                  <div key={kpi.label} style={{...sty.card,borderLeft:`4px solid ${kpi.color}`,padding:12}}>
                    <div style={{fontSize:12,color:C.muted,marginBottom:4,fontWeight:700}}>{kpi.label}</div>
                    <div style={{fontSize:20,fontWeight:900,color:kpi.color}}>{kpi.val}</div>
                  </div>
                ))}
              </div>
              <div style={{...sty.card,marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>🏆 Prioritas Tindakan (Top 10)</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:"#f9fafb"}}>
                        {["No Katalog","Nama","Kelas","Policy","Stok","Ideal","Gap","Status","Nilai Gap"].map(h=>(
                          <th key={h} style={{padding:"7px 8px",textAlign:"left",fontWeight:700,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...displayResults]
                        .filter(r=>r.treatment==="Material Cadang")
                        .sort((a,b)=>{
                          if (a.abcClass!==b.abcClass) return a.abcClass.localeCompare(b.abcClass);
                          return b.gapQty - a.gapQty;
                        })
                        .slice(0,10)
                        .map((r,i)=>{
                          const status = r.currentQty===0?"Kosong/Kritis":r.currentQty<r.recommendedQty?"Kurang":"Aman";
                          const statusColor = r.currentQty===0?C.red:r.currentQty<r.recommendedQty?"#f59e0b":C.green;
                          return (
                            <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                              <td style={{padding:"6px 8px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                              <td style={{padding:"6px 8px",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                              <td style={{padding:"6px 8px"}}><span style={{background:r.abcClass==="A1"?"#fef2f2":r.abcClass==="A2"?"#fff7ed":r.abcClass==="B1"?"#eff6ff":"#f9fafb",color:r.abcClass==="A1"?C.red:r.abcClass==="A2"?"#ea580c":C.accent,padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:12}}>{r.abcClass}</span></td>
                              <td style={{padding:"6px 8px",fontSize:12,color:C.muted}}>{r.policy}</td>
                              <td style={{padding:"6px 8px",fontWeight:700}}>{r.currentQty}</td>
                              <td style={{padding:"6px 8px",fontWeight:700}}>{r.recommendedQty}</td>
                              <td style={{padding:"6px 8px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                              <td style={{padding:"6px 8px"}}><span style={{color:statusColor,fontWeight:700,fontSize:12}}>{status}</span></td>
                              <td style={{padding:"6px 8px",color:r.gapQty>0?"#7c3aed":C.muted}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:10,textAlign:"right"}}>
                  <button style={sty.btn("ghost","sm")} onClick={()=>setSubTab("hasil")}>Lihat semua hasil →</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HEALTH INDEX */}
      {subTab==="health" && (
        <div>
          {displayResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>Belum ada Health Index. Upload dan hitung data Material Cadang terlebih dahulu.</div>
          ) : (
            <div style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1100}}>
                <thead style={{background:C.sidebar,color:"white"}}>
                  <tr>
                    {["No Katalog","Nama Material","Health Index","Status","Confidence","Kelas","Policy","Stok","Ideal","Gap","Nilai Gap","AI Recommendation"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...displayResults].sort((a,b)=>(a.healthIndex||100)-(b.healthIndex||100)).map((r,i)=>{
                    const ai = aiByNoKatalog[normalizeKatalog(r.noKat)];
                    const rec = ai?.recommendation || r.aiRecommendation || "Monitor Saja";
                    return (
                      <tr key={i} style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onClick={()=>setDetailItem(r)}>
                        <td style={{padding:"6px 10px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                        <td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                        <td style={{padding:"6px 10px",fontWeight:900,color:r.healthColor}}>{r.healthIndex}</td>
                        <td style={{padding:"6px 10px"}}><span style={{padding:"2px 8px",borderRadius:999,background:r.healthBg,color:r.healthColor,fontWeight:800,fontSize:12}}>{r.healthStatus}</span></td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:(r.dataConfidence||0)<70?C.red:C.green}}>{r.dataConfidence}%</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.abcClass}</td>
                        <td style={{padding:"6px 10px",fontSize:12,color:C.muted}}>{r.policy}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.currentQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.recommendedQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                        <td style={{padding:"6px 10px",color:r.gapQty>0?"#7c3aed":C.muted}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:rec==="Prioritaskan Pengadaan"?C.red:rec==="Ajukan Apply Min Qty"?"#f59e0b":C.muted}}>{rec}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* AI INSIGHT */}
      {subTab==="ai" && (
        <div>
          {!latestAiInsight ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>
              {aiInsightLoading ? "AI sedang menyusun insight manajemen..." : "AI insight belum tersedia. Jalankan Import & Hitung untuk membuat insight."}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.2fr) minmax(280px,.8fr)",gap:14}}>
              <div style={{...sty.card}}>
                <div style={{fontSize:12,color:C.muted,fontWeight:800,textTransform:"uppercase",marginBottom:6}}>Executive Summary</div>
                <div style={{fontSize:14,lineHeight:1.6,fontWeight:600,marginBottom:16}}>{latestAiInsight.executiveSummary}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:13,marginBottom:8,color:C.red}}>Top Risks</div>
                    {(latestAiInsight.topRisks||[]).slice(0,8).map((x,i)=><div key={i} style={{fontSize:12,padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>{typeof x==="string"?x:(x.nama||x.noKatalog||JSON.stringify(x))}</div>)}
                  </div>
                  <div>
                    <div style={{fontWeight:800,fontSize:13,marginBottom:8,color:"#f59e0b"}}>Data Quality Findings</div>
                    {(latestAiInsight.dataQualityFindings||[]).slice(0,8).map((x,i)=><div key={i} style={{fontSize:12,padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>{typeof x==="string"?x:JSON.stringify(x)}</div>)}
                  </div>
                </div>
              </div>
              <div style={{...sty.card}}>
                <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Recommended Actions</div>
                {(latestAiInsight.recommendedActions||[]).slice(0,10).map((x,i)=><div key={i} style={{fontSize:12,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>{typeof x==="string"?x:JSON.stringify(x)}</div>)}
                <div style={{fontWeight:800,fontSize:13,marginTop:16,marginBottom:8}}>Validation Needed</div>
                {(latestAiInsight.validationNeeded||[]).length===0 ? <div style={{fontSize:12,color:C.muted}}>Tidak ada material yang ditandai wajib validasi.</div> : (latestAiInsight.validationNeeded||[]).slice(0,12).map((x,i)=><span key={i} style={{display:"inline-block",fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",borderRadius:999,padding:"3px 8px",margin:"0 5px 5px 0"}}>{typeof x==="string"?x:(x.noKatalog||JSON.stringify(x))}</span>)}
                <div style={{fontSize:12,color:C.muted,marginTop:12}}>Status: {latestAiInsight.status || "-"} {latestAiInsight.errorMessage ? `- ${latestAiInsight.errorMessage}` : ""}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* IMPORT & HITUNG */}
      {subTab==="import" && (
        <div>
          {/* Keterangan cara perhitungan */}
          <div style={{...sty.card,marginBottom:16,background:"#f0f9ff",border:`1px solid #bae6fd`}}>
            <div style={{fontWeight:800,fontSize:13,color:"#0369a1",marginBottom:10}}>📐 Cara Perhitungan Material Cadang</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14,fontSize:12}}>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>1. Klasifikasi ABC</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  <b>A1</b> — Kritis tinggi (failure besar, mahal, lead time panjang) → SL 99%<br/>
                  <b>A2</b> — Kritis sedang → SL 95%<br/>
                  <b>B1/B2</b> — Penting → SL 90%<br/>
                  <b>C</b> — Tidak kritikal → tidak direkomendasikan sebagai cadang<br/>
                  <span style={{color:C.muted,fontSize:12}}>Skor = (failure rate × 0.4) + (harga × 0.3) + (lead time × 0.3)</span>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>2. Policy Inventory</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  <b>Mandatory</b> — ceil(2% × populasi)<br/>
                  <b>Economic</b> — ceil(penggantian 5 tahun ÷ 5)<br/>
                  <b>Optimum</b> — Poisson CDF invers pada service level target<br/>
                  <span style={{color:C.muted,fontSize:12}}>λ = failure5y/5 × (leadTime/8760)</span>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>3. A2 Split Rule</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  A2 masuk <b>Persediaan</b> jika:<br/>
                  TTF ≥ Lead Time <b>DAN</b> tidak ada breakdown aktif <b>DAN</b> emergency = 0<br/>
                  Selain itu → <b>Material Cadang/Optimum</b>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>4. Rekomendasi Min Qty</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  Hasil akhir = <b>max(Mandatory, Economic, Optimum)</b><br/>
                  Gap = Rekomendasi − Stok Saat Ini<br/>
                  Apply ke <b>Min Qty</b> di Master Katalog memerlukan persetujuan Asman.
                </div>
              </div>
            </div>
          </div>
          <div style={{...sty.card,marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>📥 Upload Data Populasi/Failure Material Cadang</div>
            <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Format: CSV atau XLSX dengan header sesuai <code>TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx</code>. Header XLSX di baris ke-3.</p>
            {canEdit && (
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                  {importing?"⏳ Memproses...":"📂 Upload File CSV/XLSX"}
                  <input type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
                </label>
                <a href={`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,`} download="TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx" style={{display:"none"}}></a>
              </div>
            )}
          </div>

          {importPreview && (
            <div style={{...sty.card,marginBottom:16}}>
              <div style={{fontWeight:700,marginBottom:10}}>Preview: {importPreview.fileName}</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
                {[
                  {label:"Total Baris",val:importPreview.stats.total,color:C.accent},
                  {label:"Match",val:importPreview.stats.match,color:C.green},
                  {label:"Warning",val:importPreview.stats.warning,color:"#f59e0b"},
                  {label:"Unmatched",val:importPreview.stats.unmatched,color:"#f59e0b"},
                  {label:"Invalid",val:importPreview.stats.invalid,color:C.red},
                ].map(s=>(
                  <div key={s.label} style={{padding:"8px 14px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`,textAlign:"center"}}>
                    <div style={{fontSize:12,color:C.muted}}>{s.label}</div>
                    <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{overflowX:"auto",marginBottom:14,maxHeight:300,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead style={{position:"sticky",top:0,background:C.sidebar,color:"white"}}>
                    <tr>
                      {["No Katalog","Nama Material","Cluster","Populasi","Failure","Penggantian","Lead Time","Status","Warning"].map(h=>(
                        <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((r,i)=>(
                      <tr key={i} style={{background:r.status==="INVALID"?"#fef2f2":r.status==="UNMATCHED"?"#fefce8":"white",borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat||"-"}</td>
                        <td style={{padding:"5px 8px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis"}}>{r.namaMaterial||"-"}</td>
                        <td style={{padding:"5px 8px"}}>{r.cluster||"-"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.populasi||0}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.failure5y||0}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.penggantian5y||0}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.leadTime||0}h</td>
                        <td style={{padding:"5px 8px"}}>
                          <span style={{padding:"2px 6px",borderRadius:4,fontSize:12,fontWeight:700,background:r.status==="MATCH"?"#dcfce7":r.status==="INVALID"?"#fef2f2":"#fef9c3",color:r.status==="MATCH"?C.green:r.status==="INVALID"?C.red:"#92400e"}}>{r.status}</span>
                        </td>
                        <td style={{padding:"5px 8px",fontSize:12,color:C.muted,maxWidth:180}}>{r.error||(r.warnings||[]).join(", ")||"-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && importPreview.stats.match + importPreview.stats.warning > 0 && (
                <button style={sty.btn("primary")} onClick={handleHitung}>🔢 Hitung Rekomendasi Material Cadang</button>
              )}
              {importPreview.stats.match + importPreview.stats.warning === 0 && (
                <div style={{color:C.red,fontWeight:700,fontSize:13}}>⚠️ Tidak ada baris yang bisa dihitung (semua UNMATCHED/INVALID). Periksa No Katalog di file.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* HASIL ANALISIS */}
      {subTab==="hasil" && (
        <div>
          {displayResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>Belum ada hasil analisis. Upload dan hitung di tab "Import & Hitung".</div>
          ) : (
            <div style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
                <thead style={{background:C.sidebar,color:"white"}}>
                  <tr>
                    {["No Katalog","Nama Material","Cluster","Kelas","Policy","Stok Saat Ini","Ideal","Gap","Status","Nilai Gap","Aksi"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayResults.map((r,i)=>{
                    const status = r.treatment!=="Material Cadang"?"Persediaan/Rutin":r.currentQty===0&&r.recommendedQty>0?"Kosong/Kritis":r.currentQty<r.recommendedQty?"Kurang":"Aman";
                    const statusColor = status==="Kosong/Kritis"?C.red:status==="Kurang"?"#f59e0b":status==="Aman"?C.green:C.muted;
                    const hasPending = mcData.applyHistory.find(h=>h.katalogId===r.katalogId&&h.status==="PENDING_ASMAN");
                    return (
                      <tr key={i} style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onClick={()=>setDetailItem(r)}>
                        <td style={{padding:"6px 10px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                        <td style={{padding:"6px 10px",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                        <td style={{padding:"6px 10px",fontSize:12}}>{r.cluster}</td>
                        <td style={{padding:"6px 10px"}}><span style={{background:r.abcClass==="A1"?"#fef2f2":r.abcClass==="A2"?"#fff7ed":r.abcClass==="B1"?"#eff6ff":"#f9fafb",color:r.abcClass==="A1"?C.red:r.abcClass==="A2"?"#ea580c":C.accent,padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:12}}>{r.abcClass}</span></td>
                        <td style={{padding:"6px 10px",fontSize:12,color:C.muted}}>{r.policy}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.currentQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.recommendedQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                        <td style={{padding:"6px 10px"}}><span style={{color:statusColor,fontWeight:700,fontSize:12}}>{status}</span></td>
                        <td style={{padding:"6px 10px",color:"#7c3aed"}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                        <td style={{padding:"6px 10px"}} onClick={e=>e.stopPropagation()}>
                          {canEdit && r.treatment==="Material Cadang" && r.recommendedQty>0 && !hasPending && (
                            <button style={{...sty.btn("primary","sm"),fontSize:12}} onClick={()=>setApplyConfirm(r)}>Apply Min Qty</button>
                          )}
                          {hasPending && <span style={{fontSize:12,color:"#f59e0b",fontWeight:700}}>⏳ Pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* APPLY MIN QTY */}
      {subTab==="apply" && (
        <div>
          {pendingApply.length === 0 && !canApprove ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>Tidak ada pengajuan apply minQty yang menunggu.</div>
          ) : null}
          {pendingApply.length > 0 && (
            <div style={{...sty.card}}>
              <div style={{fontWeight:700,marginBottom:12}}>⏳ Menunggu Approval Asman ({pendingApply.length})</div>
              {pendingApply.map(h=>(
                <div key={h.id} style={{padding:12,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:10}}>
                  <div style={{fontWeight:700}}>{h.namaBarang} — No. Katalog: {h.noKatalog}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>Kelas: {h.abcClass} | Policy: {h.policy} | Recommended minQty: <strong>{h.recommendedQty}</strong></div>
                  {h.notes && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Catatan: {h.notes}</div>}
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>Diajukan: {new Date(h.requestedAt).toLocaleDateString("id")}</div>
                  {canApprove && (
                    <div style={{display:"flex",gap:8,marginTop:10}}>
                      <button style={sty.btn("primary","sm")} onClick={()=>handleApproveApply(h.id)}>Setuju & Apply Min Qty</button>
                      <button style={sty.btn("danger","sm")} onClick={()=>handleRejectApply(h.id, "Ditolak Asman")}>Tolak</button>
                    </div>
                  )}
                  {false && canApprove && (
                    <div style={{display:"flex",gap:8,marginTop:10}}>
                      <button style={sty.btn("primary","sm")} onClick={async ()=>{
                        const updated = {...mcData, applyHistory: mcData.applyHistory.map(x=>x.id===h.id?{...x,status:"APPROVED_APPLIED",decidedBy:currentUser.id,decidedAt:Date.now()}:x)};
                        setMaterialCadangData(updated);
                        await saveToCloud({materialCadangData:updated});
                        showToast("Apply minQty disetujui.", "success");
                      }}>✅ Setuju</button>
                      <button style={sty.btn("danger","sm")} onClick={async ()=>{
                        const updated = {...mcData, applyHistory: mcData.applyHistory.map(x=>x.id===h.id?{...x,status:"REJECTED",decidedBy:currentUser.id,decidedAt:Date.now()}:x)};
                        setMaterialCadangData(updated);
                        await saveToCloud({materialCadangData:updated});
                        showToast("Pengajuan ditolak.", "success");
                      }}>❌ Tolak</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MARA LOOKUP */}
      {/* Modal detail item */}
      {detailItem && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setDetailItem(null)}>
          <div style={{...sty.card,maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <h3 style={{fontWeight:800,fontSize:16}}>{detailItem.katalogName||detailItem.namaMaterial}</h3>
              <button style={sty.btn("ghost","sm")} onClick={()=>setDetailItem(null)}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12}}>
              {[
                ["No Katalog",detailItem.noKat],["Equipment Cluster",detailItem.cluster],
                ["Kelas ABC",detailItem.abcClass],["Policy",detailItem.policy],
                ["Populasi",detailItem.populasi],["Failure 5th",detailItem.failure5y],
                ["Penggantian 5th",detailItem.penggantian5y],["Emergency 5th",detailItem.emergency5y],
                ["Lead Time",detailItem.leadTime+" hari"],["TTF",detailItem.ttf+" hari"],
                ["Breakdown",detailItem.breakdown?"YA":"TIDAK"],["Harga",detailItem.harga?"Rp "+fmtNum(detailItem.harga):"-"],
                ["Stok Saat Ini",detailItem.currentQty+" "+detailItem.katalogSatuan],["Rekomendasi Qty",detailItem.recommendedQty],
                ["Gap",detailItem.gapQty>0?"−"+detailItem.gapQty:"0 (cukup)"],["Cumul Value %",detailItem.cumulativeValuePct+"%"],
              ].map(([k,v])=>(
                <div key={k} style={{padding:"6px 8px",background:"#f9fafb",borderRadius:6}}>
                  <div style={{fontSize:12,color:C.muted}}>{k}</div>
                  <div style={{fontWeight:700,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:12,padding:10,background:detailItem.healthBg||"#f8fafc",border:`1px solid ${detailItem.healthColor||C.border}`,borderRadius:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:8}}>
                <div>
                  <div style={{fontSize:12,color:C.muted,fontWeight:800,textTransform:"uppercase"}}>Health Index</div>
                  <div style={{fontSize:24,fontWeight:900,color:detailItem.healthColor||C.text}}>{detailItem.healthIndex ?? "-"} / 100</div>
                </div>
                <span style={{padding:"4px 10px",borderRadius:999,background:"white",color:detailItem.healthColor||C.text,fontWeight:900,fontSize:12}}>{detailItem.healthStatus||"-"}</span>
              </div>
              {detailItem.healthBreakdown && (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,fontSize:12}}>
                  {Object.entries(detailItem.healthBreakdown).map(([k,v])=>(
                    <div key={k}><span style={{color:C.muted}}>{k}</span><div style={{fontWeight:800}}>{v}</div></div>
                  ))}
                </div>
              )}
            </div>
            {aiByNoKatalog[normalizeKatalog(detailItem.noKat)] && (
              <div style={{marginTop:12,padding:10,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:12}}>
                <div style={{fontWeight:800,color:"#1d4ed8",marginBottom:6}}>AI Insight</div>
                <div><b>Diagnosis:</b> {aiByNoKatalog[normalizeKatalog(detailItem.noKat)].diagnosis || "-"}</div>
                <div style={{marginTop:4}}><b>Rekomendasi:</b> {aiByNoKatalog[normalizeKatalog(detailItem.noKat)].recommendation || detailItem.aiRecommendation || "-"}</div>
              </div>
            )}
            {(detailItem.dataQualityFlags||[]).length > 0 && (
              <div style={{marginTop:8,padding:8,background:"#fff7ed",borderRadius:6,fontSize:12,color:"#9a3412"}}>
                Data flags: {detailItem.dataQualityFlags.join(" | ")}
              </div>
            )}
            {canEdit && detailItem.treatment==="Material Cadang" && detailItem.recommendedQty>0 && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
                {mcData.applyHistory.find(h=>h.katalogId===detailItem.katalogId&&h.status==="PENDING_ASMAN")
                  ? <span style={{fontSize:12,color:"#f59e0b",fontWeight:800}}>Pengajuan apply minQty sedang menunggu Asman</span>
                  : <button style={sty.btn("primary","sm")} onClick={()=>{ setApplyConfirm(detailItem); setDetailItem(null); }}>Ajukan Apply Min Qty</button>
                }
              </div>
            )}
            {(detailItem.warnings||[]).length > 0 && (
              <div style={{marginTop:12,padding:8,background:"#fef9c3",borderRadius:6,fontSize:12,color:"#92400e"}}>
                ⚠️ {detailItem.warnings.join(" | ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal konfirmasi apply minQty */}
      {applyConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setApplyConfirm(null)}>
          <div style={{...sty.card,maxWidth:420,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800,marginBottom:12}}>Ajukan Apply Min Qty ke Asman</h3>
            <div style={{fontSize:13,marginBottom:12}}>
              <strong>{applyConfirm.katalogName||applyConfirm.namaMaterial}</strong> ({applyConfirm.noKat})<br/>
              Recommended minQty: <strong style={{color:C.accent}}>{applyConfirm.recommendedQty}</strong> (Kelas {applyConfirm.abcClass}, {applyConfirm.policy})
            </div>
            <textarea style={{...sty.input,height:70,resize:"vertical",marginBottom:12}} placeholder="Catatan untuk Asman (opsional)..." value={applyNotes} onChange={e=>setApplyNotes(e.target.value)}/>
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("primary")} onClick={()=>handleAjukanApply(applyConfirm)}>📤 Kirim Pengajuan</button>
              <button style={sty.btn("ghost")} onClick={()=>setApplyConfirm(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
