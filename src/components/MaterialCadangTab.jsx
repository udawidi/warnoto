// Komponen MaterialCadangTab — dipindah dari App.jsx (refactor Fase 5h).
import { useState } from "react";
import { fmtNum } from "../lib/ragShared.mjs";
import { fmtDate } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";
import { normalizeKatalog } from "../lib/sap.js";
import { CLOUD } from "../lib/cloud.js";
import { parseMaterialCadangRows, hitungMaterialCadang, enrichMaterialCadangHealthResults, generateMaterialCadangAiInsights } from "../lib/materialCadang.js";
import * as XLSX from "xlsx";

export function MaterialCadangTab({ materialCadangData, setMaterialCadangData, materialCadangHealthData, setMaterialCadangHealthData, materialCadangAiInsights, setMaterialCadangAiInsights, maraReference, setMaraReference, catalogMasterRef, setCatalogMasterRef, katalogList, setKatalogList, stocks, allStocks, setStocks, gudangList, lokasiList, txns, currentUser, sty, C, saveToCloud, showToast, users, uptList }) {
  const [subTab, setSubTab] = useState("hasil");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { rows, stats, fileName }
  const [analisisResult, setAnalisisResult] = useState(null); // hasil hitung terbaru
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraSearch, setMaraSearch] = useState("");
  const [applyConfirm, setApplyConfirm] = useState(null); // { item } yang akan di-apply ke minQty
  const [applyNotes, setApplyNotes] = useState("");
  const [detailItem, setDetailItem] = useState(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [applyAllConfirm, setApplyAllConfirm] = useState(false);
  const [approveAllConfirm, setApproveAllConfirm] = useState(false);
  const pageSize = 25;

  const canEdit = hasRole(currentUser, "ADMIN","TL");
  const canApprove = hasRole(currentUser, "ASMAN");

  // Gudang default approver = gudang pertama milik UPT-nya; lokasi default = lokasi
  // pertama di gudang itu. Dipakai saat approve Apply Min Qty untuk bikin/upsert baris
  // Data Stok (lihat ensureStockRow) supaya material masuk inventaris gudang.
  function resolveDefaultLokasi() {
    const gudang = (gudangList||[]).find(g => g.uptId === currentUser?.uptId);
    if (!gudang) return null;
    const lokasi = (lokasiList||[]).find(l => l.gudangId === gudang.id);
    return lokasi ? { gudangId: gudang.id, lokasiId: lokasi.id } : null;
  }

  // Upsert non-destruktif: baris sudah ada di gudang itu → minQty = max(existing, recommendedQty),
  // qty tidak disentuh. Belum ada → baris baru qty 0 di lokasi default.
  function ensureStockRow(stocksArr, katalogId, recommendedQty, gudangId, lokasiId) {
    const idx = stocksArr.findIndex(s => s.katalogId === katalogId &&
      ((lokasiList||[]).find(l => l.id === s.lokasiId)?.gudangId || s.gudangId) === gudangId);
    if (idx >= 0) {
      const existing = stocksArr[idx];
      const newMinQty = Math.max(existing.minQty||0, recommendedQty);
      if (newMinQty === existing.minQty) return stocksArr;
      const next = [...stocksArr];
      next[idx] = { ...existing, minQty: newMinQty, updatedAt: Date.now() };
      return next;
    }
    const kat = katalogList.find(k => k.id === katalogId);
    const now = Date.now();
    return [...stocksArr, {
      id: "STK-MC-" + katalogId + "-" + now,
      katalogId, lokasiId, qty: 0, price: 0, minQty: recommendedQty,
      unit: kat?.satuan || "-", jenisBarang: kat?.jenisBarang || "Persediaan",
      name: kat?.name || "", katalog: kat?.katalog || "",
      category: kat?.name ? kat.name.split(";")[0].trim() : "Material",
      createdAt: now, updatedAt: now,
    }];
  }

  // null | "PENDING" | "APPROVED" — dipakai gate tombol Apply per baris (#3) supaya
  // material yang sudah diajukan/di-apply tetap tampil di tabel tapi tombolnya nonaktif.
  function appliedStatusOf(katalogId) {
    const h = mcData.applyHistory.find(h => h.katalogId === katalogId && (h.status === "PENDING_ASMAN" || h.status === "APPROVED") && inMcScope(h));
    return h ? (h.status === "PENDING_ASMAN" ? "PENDING" : "APPROVED") : null;
  }

  // Guard defensif terhadap shape data lama/tidak lengkap dari localStorage/CLOUD
  // (mis. tersimpan sebelum field ini ada) — tanpa ini, akses .slice/.filter
  // langsung ke field undefined bikin seluruh halaman blank putih (belum ada
  // Error Boundary di app ini untuk menangkap crash render seperti ini).
  const mcData = { imports: materialCadangData?.imports||[], analyses: materialCadangData?.analyses||[], applyHistory: materialCadangData?.applyHistory||[] };
  const mcHealth = { imports: materialCadangHealthData?.imports||[], analysisRuns: materialCadangHealthData?.analysisRuns||[], healthResults: materialCadangHealthData?.healthResults||[], applyAudit: materialCadangHealthData?.applyAudit||[] };
  const mcAi = { runs: materialCadangAiInsights?.runs||[], materialInsights: materialCadangAiInsights?.materialInsights||[] };

  // Scope Material Cadang per UPT: UPT/Asman lihat uptId sendiri; role broad (UIT/Pusat) lihat semua.
  // Record lama tanpa uptId: infer UPT dari pembuatnya (baca-waktu saja, tidak menulis balik ke data).
  const broadScope = hasRole(currentUser, "ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT","ADMIN_LOG_PUSAT");
  const myUpt = currentUser?.uptId || null;
  const userUit = currentUser?.uitId || (uptList||[]).find(u => u.id === myUpt)?.uitId || null;
  const recUptId = (rec) => rec?.uptId
    || (users||[]).find(u => u.id === (rec?.createdBy || rec?.requestedBy || rec?.importedBy || rec?.uploadedBy))?.uptId
    || null;
  const legacySurabayaId = (uptList||[]).find(u => /surabaya/i.test(u.nama || ""))?.id || null;
  const inMcScope = (rec) => broadScope
    || ((rec?.__uitId || rec?.uitId) && (rec.__uitId || rec.uitId) === userUit)
    || (recUptId(rec) ? recUptId(rec) === myUpt : myUpt === legacySurabayaId);

  // Analisis terakhir dari data tersimpan
  const latestAnalysis = mcData.analyses.filter(inMcScope).slice(-1)[0] || null;
  const latestHealthRun = mcHealth.analysisRuns.filter(inMcScope).slice(-1)[0] || null;
  const latestHealthResults = latestHealthRun
    ? mcHealth.healthResults.filter(r => r.runId === latestHealthRun.id)
    : [];
  const latestResults = latestHealthResults.length ? latestHealthResults : enrichMaterialCadangHealthResults(latestAnalysis?.results || []);
  const latestAiInsight = latestHealthRun
    ? mcAi.runs.find(r => r.runId === latestHealthRun.id)
    : null;

  // Pending apply (menunggu Asman)
  const pendingApply = mcData.applyHistory.filter(h => h.status === "PENDING_ASMAN" && inMcScope(h));

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
      const fileUpt = (file.name.match(/UPT-[A-Z]{3}/i)?.[0] || "").toUpperCase();
      const broadScope = hasRole(currentUser, "ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT","ADMIN_LOG_PUSAT");
      const userUpt = String(currentUser?.uptId||"").toUpperCase();
      const uptWarning = (fileUpt && userUpt && fileUpt !== userUpt && !broadScope)
        ? `File ini untuk ${fileUpt}, tetapi Anda login sebagai ${userUpt}. Pastikan data yang diupload benar.`
        : null;
      setImportPreview({ rows: parsed, stats, fileName: file.name, uptWarning });
      if (uptWarning) showToast(uptWarning, "error");
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
      uptId: currentUser?.uptId || null,
      uitId: userUit,
      results,
      params: { periodYears:5, slMandatory:0.99, slOptimum:0.95, slEconomic:0.90 },
    };
    const importRecord = {
      id: "MCIMP-" + Date.now(),
      fileName: importPreview.fileName,
      importedBy: currentUser.id,
      importedAt: Date.now(),
      uptId: currentUser?.uptId || null,
      uitId: userUit,
      stats: importPreview.stats,
    };
    const healthRun = {
      id: runId,
      legacyAnalysisId: newAnalysis.id,
      importId: importRecord.id,
      importFileName: importPreview.fileName,
      createdBy: currentUser.id,
      createdAt: Date.now(),
      uptId: currentUser?.uptId || null,
      uitId: userUit,
      modelAi: "openai/gpt-oss-120b",
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
    setSubTab("hasil");
    showToast("Health Index Material Cadang berhasil dihitung.", "success");

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
      uptId: currentUser?.uptId || null,
      uitId: userUit,
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
    setApplyConfirm(null); setApplyNotes("");
    showToast("Pengajuan apply minQty dikirim ke Asman.", "success");
  }

  async function handleApplyAllPending() {
    const pendingKatalogIds = new Set(pendingApply.map(h => h.katalogId));
    const candidates = displayResults.filter(r =>
      r.treatment === "Material Cadang" && r.gapQty > 0 && !pendingKatalogIds.has(r.katalogId)
    );
    if (!candidates.length) { showToast("Tidak ada material yang bisa diajukan.", "error"); setApplyAllConfirm(false); return; }
    const now = Date.now();
    const entries = candidates.map((item, idx) => ({
      id: "MCAPPLY-" + (now + idx),
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
      requestedAt: now,
      uptId: currentUser?.uptId || null,
      notes: "",
    }));
    const updated = { ...mcData, applyHistory: [...mcData.applyHistory, ...entries] };
    const auditEntries = entries.map(entry => ({ ...entry, auditId:`${entry.id}-REQ`, action:"REQUEST_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now() }));
    const updatedHealth = { ...mcHealth, applyAudit: [...(mcHealth.applyAudit||[]), ...auditEntries] };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    setApplyAllConfirm(false);
    showToast(`${entries.length} material diajukan untuk approval Asman.`, "success");
  }

  async function handleApproveAllPending() {
    if (!pendingApply.length) { setApproveAllConfirm(false); return; }
    const now = Date.now();
    const recommendedByKatalog = {};
    pendingApply.forEach(h => { recommendedByKatalog[h.katalogId] = h.recommendedQty; });
    const updatedKatalog = katalogList.map(k =>
      k.id in recommendedByKatalog ? { ...k, minQty: recommendedByKatalog[k.id], minQtyUpdatedAt: now, minQtyUpdatedBy: currentUser.id } : k
    );
    const pendingIds = new Set(pendingApply.map(h => h.id));
    const updatedMC = {
      ...mcData,
      applyHistory: mcData.applyHistory.map(h =>
        pendingIds.has(h.id) ? { ...h, status: "APPROVED", approvedBy: currentUser.id, approvedAt: now } : h
      ),
    };
    const auditEntries = pendingApply.map(entry => ({ ...entry, auditId:`${entry.id}-APPROVE-${now}`, action:"APPROVE_APPLY_MIN_QTY", actor:currentUser.id, actedAt:now, appliedMinQty:entry.recommendedQty }));
    const updatedHealth = { ...mcHealth, applyAudit: [...(mcHealth.applyAudit||[]), ...auditEntries] };
    const defaultLoc = resolveDefaultLokasi();
    let nextStocks = allStocks;
    const touchedKatalogIds = new Set();
    if (defaultLoc) {
      pendingApply.forEach(h => {
        const before = nextStocks;
        nextStocks = ensureStockRow(nextStocks, h.katalogId, h.recommendedQty, defaultLoc.gudangId, defaultLoc.lokasiId);
        if (nextStocks !== before) touchedKatalogIds.add(h.katalogId);
      });
    } else {
      showToast("Gudang default tak ditemukan, min qty katalog tetap di-set.", "error");
    }
    const stocksHint = nextStocks.filter(s => touchedKatalogIds.has(s.katalogId) &&
      ((lokasiList||[]).find(l=>l.id===s.lokasiId)?.gudangId||s.gudangId) === defaultLoc?.gudangId);
    setKatalogList(updatedKatalog);
    setMaterialCadangData(updatedMC);
    setMaterialCadangHealthData(updatedHealth);
    if (nextStocks !== allStocks) setStocks(nextStocks);
    await saveToCloud({ katalogList: updatedKatalog, materialCadangData: updatedMC, materialCadangHealthData: updatedHealth, stocks: nextStocks }, { stocksChangedRows: stocksHint });
    setApproveAllConfirm(false);
    showToast(`${pendingApply.length} pengajuan disetujui.`, "success");
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
    const defaultLoc = resolveDefaultLokasi();
    let nextStocks = allStocks;
    if (defaultLoc) {
      nextStocks = ensureStockRow(nextStocks, entry.katalogId, entry.recommendedQty, defaultLoc.gudangId, defaultLoc.lokasiId);
    } else {
      showToast("Gudang default tak ditemukan, min qty katalog tetap di-set.", "error");
    }
    setMaterialCadangData(updatedMC);
    setMaterialCadangHealthData(updatedHealth);
    if (nextStocks !== allStocks) setStocks(nextStocks);
    const stocksHint = nextStocks !== allStocks ? nextStocks.filter(s => s.katalogId === entry.katalogId &&
      ((lokasiList||[]).find(l=>l.id===s.lokasiId)?.gudangId||s.gudangId) === defaultLoc?.gudangId) : [];
    await saveToCloud({ katalogList: updated, materialCadangData: updatedMC, materialCadangHealthData: updatedHealth, stocks: nextStocks }, { stocksChangedRows: stocksHint });
    showToast(`Min Qty ${entry.namaBarang} berhasil diperbarui ke ${entry.recommendedQty}.`, "success");
  }

  // Asman = approver, jadi apply-nya langsung berlaku (tanpa PENDING_ASMAN) — bikin entry
  // applyHistory berstatus APPROVED langsung, lalu jalankan langkah yang sama dengan approve
  // (minQty katalog + upsert Data Stok via ensureStockRow/resolveDefaultLokasi).
  async function handleApplyDirect(item) {
    const now = Date.now();
    const entry = {
      id: "MCAPPLY-" + now, katalogId: item.katalogId, namaBarang: item.katalogName || item.namaMaterial,
      noKatalog: item.noKat, recommendedQty: item.recommendedQty, abcClass: item.abcClass, policy: item.policy,
      runId: item.runId, healthIndex: item.healthIndex, healthStatus: item.healthStatus,
      status: "APPROVED", requestedBy: currentUser.id, requestedAt: now, approvedBy: currentUser.id, approvedAt: now,
      uptId: currentUser?.uptId || null, uitId: userUit, notes: "",
    };
    const updatedKatalog = katalogList.map(k => k.id === item.katalogId ? { ...k, minQty: item.recommendedQty, minQtyUpdatedAt: now, minQtyUpdatedBy: currentUser.id } : k);
    const updatedMC = { ...mcData, applyHistory: [...mcData.applyHistory, entry] };
    const auditEntry = { ...entry, auditId: `${entry.id}-APPROVE`, action: "APPROVE_APPLY_MIN_QTY", actor: currentUser.id, actedAt: now, appliedMinQty: item.recommendedQty };
    const updatedHealth = { ...mcHealth, applyAudit: [...(mcHealth.applyAudit||[]), auditEntry] };
    const defaultLoc = resolveDefaultLokasi();
    let nextStocks = allStocks;
    if (defaultLoc) nextStocks = ensureStockRow(nextStocks, item.katalogId, item.recommendedQty, defaultLoc.gudangId, defaultLoc.lokasiId);
    else showToast("Gudang default tak ditemukan, min qty katalog tetap di-set.", "error");
    setKatalogList(updatedKatalog);
    setMaterialCadangData(updatedMC);
    setMaterialCadangHealthData(updatedHealth);
    if (nextStocks !== allStocks) setStocks(nextStocks);
    const stocksHint = nextStocks !== allStocks ? nextStocks.filter(s => s.katalogId === item.katalogId &&
      ((lokasiList||[]).find(l=>l.id===s.lokasiId)?.gudangId||s.gudangId) === defaultLoc?.gudangId) : [];
    await saveToCloud({ katalogList: updatedKatalog, materialCadangData: updatedMC, materialCadangHealthData: updatedHealth, stocks: nextStocks }, { stocksChangedRows: stocksHint });
    setApplyConfirm(null); setApplyNotes("");
    showToast(`Min Qty ${entry.namaBarang} langsung diterapkan ke ${item.recommendedQty}.`, "success");
  }

  async function handleApplyAllDirect() {
    const candidates = displayResults.filter(r => r.treatment === "Material Cadang" && r.gapQty > 0 && !appliedStatusOf(r.katalogId));
    if (!candidates.length) { showToast("Tidak ada material yang bisa di-apply.", "error"); setApplyAllConfirm(false); return; }
    const now = Date.now();
    const entries = candidates.map((item, idx) => ({
      id: "MCAPPLY-" + (now + idx), katalogId: item.katalogId, namaBarang: item.katalogName || item.namaMaterial,
      noKatalog: item.noKat, recommendedQty: item.recommendedQty, abcClass: item.abcClass, policy: item.policy,
      runId: item.runId, healthIndex: item.healthIndex, healthStatus: item.healthStatus,
      status: "APPROVED", requestedBy: currentUser.id, requestedAt: now, approvedBy: currentUser.id, approvedAt: now,
      uptId: currentUser?.uptId || null, uitId: userUit, notes: "",
    }));
    const recommendedByKatalog = {};
    entries.forEach(e => { recommendedByKatalog[e.katalogId] = e.recommendedQty; });
    const updatedKatalog = katalogList.map(k => k.id in recommendedByKatalog ? { ...k, minQty: recommendedByKatalog[k.id], minQtyUpdatedAt: now, minQtyUpdatedBy: currentUser.id } : k);
    const updatedMC = { ...mcData, applyHistory: [...mcData.applyHistory, ...entries] };
    const auditEntries = entries.map(entry => ({ ...entry, auditId: `${entry.id}-APPROVE`, action: "APPROVE_APPLY_MIN_QTY", actor: currentUser.id, actedAt: now, appliedMinQty: entry.recommendedQty }));
    const updatedHealth = { ...mcHealth, applyAudit: [...(mcHealth.applyAudit||[]), ...auditEntries] };
    const defaultLoc = resolveDefaultLokasi();
    let nextStocks = allStocks;
    const touchedKatalogIds = new Set();
    if (defaultLoc) {
      entries.forEach(e => {
        const before = nextStocks;
        nextStocks = ensureStockRow(nextStocks, e.katalogId, e.recommendedQty, defaultLoc.gudangId, defaultLoc.lokasiId);
        if (nextStocks !== before) touchedKatalogIds.add(e.katalogId);
      });
    } else {
      showToast("Gudang default tak ditemukan, min qty katalog tetap di-set.", "error");
    }
    const stocksHint = nextStocks.filter(s => touchedKatalogIds.has(s.katalogId) &&
      ((lokasiList||[]).find(l=>l.id===s.lokasiId)?.gudangId||s.gudangId) === defaultLoc?.gudangId);
    setKatalogList(updatedKatalog);
    setMaterialCadangData(updatedMC);
    setMaterialCadangHealthData(updatedHealth);
    if (nextStocks !== allStocks) setStocks(nextStocks);
    await saveToCloud({ katalogList: updatedKatalog, materialCadangData: updatedMC, materialCadangHealthData: updatedHealth, stocks: nextStocks }, { stocksChangedRows: stocksHint });
    setApplyAllConfirm(false);
    showToast(`${entries.length} material langsung di-apply ke Min Qty.`, "success");
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
    {id:"hasil",label:"📋 Analisis"},
    {id:"ai",label:"AI Insight"},
    {id:"import",label:"📥 Import & Hitung"},
    {id:"apply",label:"✅ Apply Min Qty",badge:pendingApply.length},
  ];

  return (
    <div>
      <section className="forecast-overview kpi-banner" style={{marginBottom:16,gridTemplateColumns:"1fr"}}>
        <div className="forecast-overview__copy">
          <span>Material Cadang</span>
          <strong>Analisis ABC & Kesehatan Spare</strong>
          <small>Inventory policy dan rekomendasi jumlah ideal material cadang</small>
        </div>
      </section>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=>(
          <button key={t.id} style={{padding:"8px 16px",borderRadius: 10,border:`1px solid ${subTab===t.id?C.accent:C.border}`,background:subTab===t.id?C.accent:"white",color:subTab===t.id?"white":C.muted,fontWeight:700,fontSize:12,cursor:"pointer",position:"relative"}}
            onClick={()=>setSubTab(t.id)}>
            {t.label}{t.badge>0 && <span style={{marginLeft:6,background:"#dc2626",color:"white",borderRadius:10,padding:"1px 6px",fontSize:12}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* AI INSIGHT */}
      {subTab==="ai" && (
        <div>
          {!latestAiInsight ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>
              {aiInsightLoading ? "AI sedang menyusun insight manajemen..." : "AI insight belum tersedia. Jalankan Import & Hitung untuk membuat insight."}
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{...sty.card}}>
                <div style={{fontSize:12,color:C.muted,fontWeight:800,textTransform:"uppercase",marginBottom:6}}>Ringkasan Eksekutif</div>
                <div style={{fontSize:13,lineHeight:1.6,fontWeight:600}}>{latestAiInsight.executiveSummary}</div>
              </div>

              <div style={{...sty.card}}>
                <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Diagnosis Per-Material</div>
                {(latestAiInsight.materialInsights||[]).length===0 ? (
                  <div style={{fontSize:12,color:C.muted}}>Belum ada diagnosis per-material.</div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {(latestAiInsight.materialInsights||[]).map((x,i)=>(
                      <div key={i} style={{padding:"8px 10px",borderRadius: 10,border:`1px solid ${C.border}`}}>
                        <div style={{fontWeight:700,fontSize:12}}>{x?.nama||"-"} <span style={{color:C.muted,fontWeight:500}}>({x?.noKatalog||"-"})</span></div>
                        <div style={{fontSize:12,marginTop:3}}><b>Diagnosis:</b> {x?.diagnosis||"-"}</div>
                        {x?.penyebab && <div style={{fontSize:12,marginTop:2}}><b>Penyebab:</b> {x.penyebab}</div>}
                        {x?.rekomendasi && <div style={{fontSize:12,marginTop:2}}><b>Rekomendasi:</b> {x.rekomendasi}</div>}
                        {x?.confidence!=null && <div style={{fontSize:12,color:C.muted,marginTop:2}}>Confidence data: {x.confidence}%</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="material-spares-insight-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1.2fr) minmax(280px,.8fr)",gap:14}}>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:800,fontSize:13,marginBottom:8}}>Prioritas Pengadaan</div>
                  {(latestAiInsight.procurementPriority||[]).length===0 ? (
                    <div style={{fontSize:12,color:C.muted}}>Tidak ada prioritas pengadaan saat ini.</div>
                  ) : (latestAiInsight.procurementPriority||[]).map((x,i)=>(
                    typeof x==="string" ? (
                      <div key={i} style={{fontSize:12,padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>{x}</div>
                    ) : (
                      <div key={i} style={{fontSize:12,padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",gap:8}}>
                        <span>{i+1}. {x?.nama||x?.noKatalog||"-"} <span style={{color:C.muted}}>({x?.noKatalog||"-"})</span>{x?.alasan && <span style={{color:C.muted}}> - {x.alasan}</span>}</span>
                        <span style={{fontWeight:700,whiteSpace:"nowrap"}}>{x?.qty??"-"} unit{x?.estimasiNilai!=null ? ` / Rp${Number(x.estimasiNilai).toLocaleString("id-ID")}` : ""}</span>
                      </div>
                    )
                  ))}
                  <div className="material-spares-risk-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,marginTop:14}}>
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

              {latestAiInsight.methodology && (
                <div style={{...sty.card}}>
                  <div style={{fontWeight:800,fontSize:13,marginBottom:8}}>Metodologi (Cara AI Menghitung)</div>
                  <div style={{fontSize:12,lineHeight:1.6,color:C.muted}}>{latestAiInsight.methodology}</div>
                </div>
              )}
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
            <div className="material-spares-method-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14,fontSize:12}}>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>1. Klasifikasi ABC</div>
                <div style={{color: "#64748b",lineHeight:1.7}}>
                  <b>A1</b> — Kritis tinggi (failure besar, mahal, lead time panjang) → SL 99%<br/>
                  <b>A2</b> — Kritis sedang → SL 95%<br/>
                  <b>B1/B2</b> — Penting → SL 90%<br/>
                  <b>C</b> — Tidak kritikal → tidak direkomendasikan sebagai cadang<br/>
                  <span style={{color:C.muted,fontSize:12}}>Skor = (failure rate × 0.4) + (harga × 0.3) + (lead time × 0.3)</span>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>2. Policy Inventory</div>
                <div style={{color: "#64748b",lineHeight:1.7}}>
                  <b>Mandatory</b> — ceil(2% × populasi)<br/>
                  <b>Economic</b> — ceil(penggantian 5 tahun ÷ 5)<br/>
                  <b>Optimum</b> — Poisson CDF invers pada service level target<br/>
                  <span style={{color:C.muted,fontSize:12}}>λ = failure5y/5 × (leadTime/8760)</span>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>3. A2 Split Rule</div>
                <div style={{color: "#64748b",lineHeight:1.7}}>
                  A2 masuk <b>Persediaan</b> jika:<br/>
                  TTF ≥ Lead Time <b>DAN</b> tidak ada breakdown aktif <b>DAN</b> emergency = 0<br/>
                  Selain itu → <b>Material Cadang/Optimum</b>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>4. Rekomendasi Min Qty</div>
                <div style={{color: "#64748b",lineHeight:1.7}}>
                  Hasil akhir = <b>max(Mandatory, Economic, Optimum)</b><br/>
                  Gap = Rekomendasi − Stok Saat Ini<br/>
                  Apply ke <b>Min Qty</b> di Master Katalog memerlukan persetujuan Asman.
                </div>
              </div>
            </div>
          </div>
          <div style={{...sty.card,marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>📥 Upload Data Populasi/Failure Material Cadang</div>
            <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Format: CSV atau XLSX dengan header sesuai <code>TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx</code>. Header XLSX di baris ke-3.</p>
            {canEdit && (
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                  {importing?"⏳ Memproses...":"📂 Upload File CSV/XLSX"}
                  <input type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
                </label>
                <button type="button" style={sty.btn("ghost")} onClick={()=>{
                  const ref=(maraReference&&maraReference.length)?maraReference[0]:null;
                  const kat=(katalogList&&katalogList.length)?katalogList[0]:null;
                  const sampleKat=ref?ref.katalog:(kat?kat.katalog:"3.02.01.99.001");
                  const sampleNama=ref?(ref.prefix||ref.description||""):(kat?kat.name:"CT 150kV");
                  const aoa=[
                    ["TEMPLATE IMPORT MATERIAL CADANG — WARNOTO"],
                    [],
                    ["No Katalog","Nama Material","Equipment Cluster","Populasi Cluster","Failure 5 Tahun","Penggantian 5 Tahun","Emergency Replacement 5 Tahun","Lead Time Hari","Time To Failure Hari","Breakdown","Harga Satuan","Kriteria","Tanggal Penggantian","UPT","GI/GIS","Bay","Merk","Tipe","No. Seri","PHASA","Teg. (kV)","Tahun Buat","Tanggal Operasi"],
                    [sampleKat,sampleNama,"Current Transformer",120,8,5,1,180,3650,"TIDAK",45000000,"Kritis","2024-05-10","UPT Surabaya","GI Ketintang","Bay Trafo 1","ABB","IMB 145","SN-2019-00123","R",150,2018,"2019-03-01"]
                  ];
                  const ws=XLSX.utils.aoa_to_sheet(aoa);
                  const wb=XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb,ws,"Import Material Cadang");
                  XLSX.writeFile(wb,"TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx");
                }}>📄 Download Template</button>
              </div>
            )}
          </div>

          {importPreview && (
            <div style={{...sty.card,marginBottom:16}}>
              <div style={{fontWeight:700,marginBottom:10}}>Preview: {importPreview.fileName}</div>
              {importPreview.uptWarning && (
                <div style={{background:"#fef2f2",border:`1px solid ${C.red}`,color:C.red,fontWeight:700,fontSize:13,padding:"8px 12px",borderRadius: 10,marginBottom:12}}>
                  ⚠️ {importPreview.uptWarning}
                </div>
              )}
              <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
                {[
                  {label:"Total Baris",val:importPreview.stats.total,color:C.accent},
                  {label:"Match",val:importPreview.stats.match,color:C.green},
                  {label:"Warning",val:importPreview.stats.warning,color:"#f59e0b"},
                  {label:"Unmatched",val:importPreview.stats.unmatched,color:"#f59e0b"},
                  {label:"Invalid",val:importPreview.stats.invalid,color:C.red},
                ].map(s=>(
                  <div key={s.label} style={{padding:"8px 14px",borderRadius: 10,background:"#f9fafb",border:`1px solid ${C.border}`,textAlign:"center"}}>
                    <div style={{fontSize:12,color:C.muted}}>{s.label}</div>
                    <div style={{fontSize:17,fontWeight:800,color:s.color}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div className="mobile-card-table" style={{overflowX:"auto",marginBottom:14,maxHeight:300,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead style={{position:"sticky",top:0,background:C.sidebar,color:"white"}}>
                    <tr>
                      {["No Katalog","Nama Material","Merk","Cluster","Populasi","Failure","Penggantian","Lead Time","Status","Warning"].map(h=>(
                        <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((r,i)=>(
                      <tr tabIndex={0} className="mobile-card-table__row" key={i} style={{background:r.status==="INVALID"?"#fef2f2":r.status==="UNMATCHED"?"#fefce8":"white",borderBottom:`1px solid ${C.border}`}}>
                        <td data-label="No Katalog" style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat||"-"}</td>
                        <td data-label="Nama Material" className="mobile-card-table__title" style={{padding:"5px 8px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis"}}>{r.namaMaterial||"-"}</td>
                        <td data-label="Merk" style={{padding:"5px 8px",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{r.merk||"-"}</td>
                        <td data-label="Cluster" style={{padding:"5px 8px"}}>{r.cluster||"-"}</td>
                        <td data-label="Populasi" style={{padding:"5px 8px",textAlign:"right"}}>{r.populasi||0}</td>
                        <td data-label="Failure" style={{padding:"5px 8px",textAlign:"right"}}>{r.failure5y||0}</td>
                        <td data-label="Penggantian" style={{padding:"5px 8px",textAlign:"right"}}>{r.penggantian5y||0}</td>
                        <td data-label="Lead Time" style={{padding:"5px 8px",textAlign:"right"}}>{r.leadTime||0}h</td>
                        <td data-label="Status" style={{padding:"5px 8px"}}>
                          <span style={{padding:"2px 6px",borderRadius: 10,fontSize:12,fontWeight:700,background:r.status==="MATCH"?"#dcfce7":r.status==="INVALID"?"#fef2f2":"#fef9c3",color:r.status==="MATCH"?C.green:r.status==="INVALID"?C.red:"#92400e"}}>{r.status}</span>
                        </td>
                        <td data-label="Warning" style={{padding:"5px 8px",fontSize:12,color:C.muted,maxWidth:180}}>{r.error||(r.warnings||[]).join(", ")||"-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importPreview.stats.match + importPreview.stats.warning === 0 && (
                <div style={{color:C.red,fontWeight:700,fontSize:13,marginBottom:10}}>⚠️ Tidak ada baris yang bisa dihitung (semua UNMATCHED/INVALID). Periksa No Katalog di file.</div>
              )}
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {canEdit && importPreview.stats.match + importPreview.stats.warning > 0 && (
                  <button style={sty.btn("primary")} onClick={handleHitung}>🔢 Hitung Rekomendasi Material Cadang</button>
                )}
                <button style={sty.btn("ghost")} onClick={()=>setImportPreview(null)}>Batal</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ANALISIS (Health Index + Hasil digabung) */}
      {subTab==="hasil" && (
        <div>
          {displayResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>
              <div style={{marginBottom:12}}>Belum ada hasil analisis. Upload dan hitung di tab "Import & Hitung".</div>
              {canEdit && <button style={sty.btn("primary")} onClick={()=>setSubTab("import")}>📥 Buka Import & Hitung</button>}
            </div>
          ) : (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:12}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["ALL","Critical","High Risk","Watch","Healthy"].map(f=>(
                    <button key={f} style={{...sty.btn(statusFilter===f?"primary":"ghost","sm"),fontSize:12}}
                      onClick={()=>{ setStatusFilter(f); setPage(0); }}>{f==="ALL"?"Semua":f}</button>
                  ))}
                </div>
                {(canEdit||canApprove) && (
                  <button style={sty.btn("primary","sm")} onClick={()=>setApplyAllConfirm(true)}>✅ {canApprove?"Apply Min Qty Semua":"Ajukan Apply Semua"}</button>
                )}
              </div>
              {(() => {
                const filtered = [...displayResults]
                  .filter(r => statusFilter==="ALL" || r.healthStatus===statusFilter)
                  .sort((a,b)=>(a.healthIndex||100)-(b.healthIndex||100));
                const totalPages = Math.max(1, Math.ceil(filtered.length/pageSize));
                const paged = filtered.slice(page*pageSize, (page+1)*pageSize);
                return (
                  <div className="mobile-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1200}}>
                      <thead style={{background:C.sidebar,color:"white"}}>
                        <tr>
                          {["No Katalog","Nama Material","Merk","Health Index","Status","Confidence","Kelas","Policy","Stok","Ideal","Gap","Nilai Gap","AI Recommendation","Aksi"].map(h=>(
                            <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((r,i)=>{
                          const ai = aiByNoKatalog[normalizeKatalog(r.noKat)];
                          const rec = ai?.recommendation || r.aiRecommendation || "Monitor Saja";
                          const appliedStatus = appliedStatusOf(r.katalogId);
                          return (
                            <tr tabIndex={0} className="mobile-card-table__row" key={i} style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onClick={()=>setDetailItem(r)}>
                              <td data-label="No Katalog" style={{padding:"6px 10px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                              <td data-label="Nama Material" className="mobile-card-table__title" style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{r.katalogName||r.namaMaterial}</td>
                              <td data-label="Merk" style={{padding:"6px 10px",fontSize:12,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{r.merk||"-"}</td>
                              <td data-label="Health Index" style={{padding:"6px 10px",fontWeight:900,color:r.healthColor}}>{r.healthIndex}</td>
                              <td data-label="Status" className="is-key" style={{padding:"6px 10px"}}><span style={{padding:"2px 8px",borderRadius:999,background:r.healthBg,color:r.healthColor,fontWeight:800,fontSize:12}}>{r.healthStatus}</span></td>
                              <td data-label="Confidence" style={{padding:"6px 10px",fontWeight:700,color:(r.dataConfidence||0)<70?C.red:C.green}}>{r.dataConfidence}%</td>
                              <td data-label="Kelas" style={{padding:"6px 10px",fontWeight:700}}>{r.abcClass}</td>
                              <td data-label="Policy" style={{padding:"6px 10px",fontSize:12,color:C.muted}}>{r.policy}</td>
                              <td data-label="Stok" style={{padding:"6px 10px",fontWeight:700}}>{r.currentQty}</td>
                              <td data-label="Ideal" style={{padding:"6px 10px",fontWeight:700}}>{r.recommendedQty}</td>
                              <td data-label="Gap" style={{padding:"6px 10px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                              <td data-label="Nilai Gap" style={{padding:"6px 10px",color:r.gapQty>0?"#7c3aed":C.muted}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                              <td data-label="AI Recommendation" style={{padding:"6px 10px",fontWeight:700,color:rec==="Prioritaskan Pengadaan"?C.red:rec==="Ajukan Apply Min Qty"?"#f59e0b":C.muted}}>{rec}</td>
                              <td data-label="Aksi" style={{padding:"6px 10px"}} onClick={e=>e.stopPropagation()}>
                                {(canEdit||canApprove) && r.treatment==="Material Cadang" && r.recommendedQty>0 && !appliedStatus && (
                                  <button style={{...sty.btn("primary","sm"),fontSize:12}} onClick={()=>setApplyConfirm(r)}>{canApprove?"Apply Min Qty":"Ajukan Apply"}</button>
                                )}
                                {appliedStatus && (
                                  <button disabled style={{...sty.btn("ghost","sm"),fontSize:12,color:C.muted,cursor:"not-allowed",opacity:0.6}}>
                                    {appliedStatus==="PENDING"?"Sudah diajukan":"Sudah di-apply"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderTop:`1px solid ${C.border}`}}>
                      <button style={sty.btn("ghost","sm")} disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>‹ Sebelumnya</button>
                      <span style={{fontSize:12,color:C.muted}}>Hal {page+1}/{totalPages}</span>
                      <button style={sty.btn("ghost","sm")} disabled={page>=totalPages-1} onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}>Berikutnya ›</button>
                    </div>
                  </div>
                );
              })()}
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
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13}}>⏳ Menunggu Approval Asman ({pendingApply.length})</div>
                {canApprove && (
                  <button style={sty.btn("primary","sm")} onClick={()=>setApproveAllConfirm(true)}>✅ Setujui Semua</button>
                )}
              </div>
              {pendingApply.map(h=>(
                <div key={h.id} style={{padding:12,borderRadius: 10,border:`1px solid ${C.border}`,marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:13}}>{h.namaBarang} — No. Katalog: {h.noKatalog}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>Kelas: {h.abcClass} | Policy: {h.policy} | Recommended minQty: <strong>{h.recommendedQty}</strong></div>
                  {h.notes && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Catatan: {h.notes}</div>}
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>Diajukan: {new Date(h.requestedAt).toLocaleDateString("id")}</div>
                  {canApprove && (
                    <div className="approval-actions approval-actions--compact" style={{marginTop:10}}>
                      <button className="approval-btn--approve" onClick={()=>handleApproveApply(h.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju & Apply Min Qty</button>
                      <button className="approval-btn--reject" onClick={()=>handleRejectApply(h.id, "Ditolak Asman")}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {(() => {
            const history = [...mcData.applyHistory]
              .filter(h => h.status !== "PENDING_ASMAN" && inMcScope(h))
              .sort((a,b)=>(b.decidedAt||b.requestedAt||0)-(a.decidedAt||a.requestedAt||0));
            return (
              <div style={{...sty.card,marginTop:12}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Riwayat Apply Min Qty</div>
                {history.length === 0 ? (
                  <div style={{textAlign:"center",padding:20,color:C.muted,fontSize:12}}>Belum ada riwayat.</div>
                ) : (
                  <div className="mobile-card-table" style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead style={{background:C.sidebar,color:"white"}}>
                        <tr>
                          {["Nama Material","No Katalog","Min Qty","Status","Diajukan","Diputuskan","Catatan"].map(h=>(
                            <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h=>(
                          <tr tabIndex={0} className="mobile-card-table__row" key={h.id} style={{borderBottom:`1px solid ${C.border}`}}>
                            <td data-label="Nama Material" className="mobile-card-table__title" style={{padding:"6px 10px"}}>{h.namaBarang}</td>
                            <td data-label="No Katalog" style={{padding:"6px 10px"}}>{h.noKatalog}</td>
                            <td data-label="Min Qty" style={{padding:"6px 10px",fontWeight:700}}>{fmtNum(h.appliedMinQty ?? h.recommendedQty)}</td>
                            <td data-label="Status" style={{padding:"6px 10px"}}>
                              <span style={{padding:"2px 8px",borderRadius:999,fontWeight:700,fontSize:12,
                                background:h.status==="APPROVED"?"#dcfce7":"#fee2e2",
                                color:h.status==="APPROVED"?"#16a34a":"#dc2626"}}>{h.status==="APPROVED"?"Disetujui":"Ditolak"}</span>
                            </td>
                            <td data-label="Diajukan" style={{padding:"6px 10px",color:C.muted}}>{fmtDate(h.requestedAt)}</td>
                            <td data-label="Diputuskan" style={{padding:"6px 10px",color:C.muted}}>{fmtDate(h.decidedAt)}</td>
                            <td data-label="Catatan" style={{padding:"6px 10px",color:C.muted}}>{h.notes||"-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* MARA LOOKUP */}
      {/* Modal detail item */}
      {detailItem && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setDetailItem(null)}>
          <div style={{...sty.card,maxWidth:520,width:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <h3 style={{fontWeight:800,fontSize:15}}>{detailItem.katalogName||detailItem.namaMaterial}</h3>
              <button style={sty.btn("ghost","sm")} onClick={()=>setDetailItem(null)}>✕</button>
            </div>
            <div className="material-spares-detail-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12}}>
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
                <div key={k} style={{padding:"6px 8px",background:"#f9fafb",borderRadius: 10}}>
                  <div style={{fontSize:12,color:C.muted}}>{k}</div>
                  <div style={{fontWeight:700,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:12,padding:10,background:detailItem.healthBg||"#f8fafc",border:`1px solid ${detailItem.healthColor||C.border}`,borderRadius: 10}}>
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
              <div style={{marginTop:12,padding:10,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius: 10,fontSize:12}}>
                <div style={{fontWeight:800,color:"#1d4ed8",marginBottom:6}}>AI Insight</div>
                <div><b>Diagnosis:</b> {aiByNoKatalog[normalizeKatalog(detailItem.noKat)].diagnosis || "-"}</div>
                <div style={{marginTop:4}}><b>Rekomendasi:</b> {aiByNoKatalog[normalizeKatalog(detailItem.noKat)].recommendation || detailItem.aiRecommendation || "-"}</div>
              </div>
            )}
            {(detailItem.dataQualityFlags||[]).length > 0 && (
              <div style={{marginTop:8,padding:8,background:"#fff7ed",borderRadius: 10,fontSize:12,color:"#9a3412"}}>
                Data flags: {detailItem.dataQualityFlags.join(" | ")}
              </div>
            )}
            {(canEdit||canApprove) && detailItem.treatment==="Material Cadang" && detailItem.recommendedQty>0 && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
                {appliedStatusOf(detailItem.katalogId)==="PENDING"
                  ? <span style={{fontSize:12,color:"#f59e0b",fontWeight:800}}>Pengajuan apply minQty sedang menunggu Asman</span>
                  : appliedStatusOf(detailItem.katalogId)==="APPROVED"
                  ? <span style={{fontSize:12,color:"#16a34a",fontWeight:800}}>Min Qty sudah di-apply</span>
                  : <button style={sty.btn("primary","sm")} onClick={()=>{ setApplyConfirm(detailItem); setDetailItem(null); }}>{canApprove?"Apply Min Qty":"Ajukan Apply Min Qty"}</button>
                }
              </div>
            )}
            {(detailItem.warnings||[]).length > 0 && (
              <div style={{marginTop:12,padding:8,background:"#fef9c3",borderRadius: 10,fontSize:12,color:"#92400e"}}>
                ⚠️ {detailItem.warnings.join(" | ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal konfirmasi apply minQty */}
      {applyConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setApplyConfirm(null)}>
          <div style={{...sty.card,maxWidth:420,width:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800,marginBottom:12,fontSize:15}}>{canApprove?"Apply Min Qty":"Ajukan Apply Min Qty ke Asman"}</h3>
            <div style={{fontSize:13,marginBottom:12}}>
              <strong>{applyConfirm.katalogName||applyConfirm.namaMaterial}</strong> ({applyConfirm.noKat})<br/>
              Recommended minQty: <strong style={{color:C.accent}}>{applyConfirm.recommendedQty}</strong> (Kelas {applyConfirm.abcClass}, {applyConfirm.policy})
            </div>
            <textarea style={{...sty.input,height:70,resize:"vertical",marginBottom:12}} placeholder="Catatan (opsional)..." value={applyNotes} onChange={e=>setApplyNotes(e.target.value)}/>
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("primary")} onClick={()=>canApprove?handleApplyDirect(applyConfirm):handleAjukanApply(applyConfirm)}>{canApprove?"✅ Apply Min Qty":"📤 Kirim Pengajuan"}</button>
              <button style={sty.btn("ghost")} onClick={()=>setApplyConfirm(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}
      {/* Modal konfirmasi apply semua */}
      {applyAllConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setApplyAllConfirm(false)}>
          <div style={{...sty.card,maxWidth:420,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800,marginBottom:12,fontSize:15}}>{canApprove?"Apply Min Qty Semua?":"Ajukan Apply Min Qty Semua?"}</h3>
            <p style={{fontSize:13,marginBottom:12,color:C.muted}}>Semua material Material Cadang dengan gap qty &gt; 0 yang belum diajukan/di-apply akan {canApprove?"langsung di-apply":"dikirim ke Asman"} sekaligus.</p>
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("primary")} onClick={canApprove?handleApplyAllDirect:handleApplyAllPending}>{canApprove?"✅ Apply Semua":"📤 Ajukan Semua"}</button>
              <button style={sty.btn("ghost")} onClick={()=>setApplyAllConfirm(false)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal konfirmasi setujui semua */}
      {approveAllConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setApproveAllConfirm(false)}>
          <div style={{...sty.card,maxWidth:420,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800,marginBottom:12,fontSize:15}}>Setujui Semua Pengajuan?</h3>
            <p style={{fontSize:13,marginBottom:12,color:C.muted}}>{pendingApply.length} pengajuan akan disetujui dan Min Qty di Master Katalog diperbarui sekaligus.</p>
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("primary")} onClick={handleApproveAllPending}>✅ Setujui Semua</button>
              <button style={sty.btn("ghost")} onClick={()=>setApproveAllConfirm(false)}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
