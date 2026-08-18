// Perhitungan Material Cadang (Poisson service-level, Health Index, AI insight Groq) — dipindah dari App.jsx Fase 5h.
import { normalizeKatalog } from "./sap.js";
import { parseIndoNumber } from "./utils.js";
import { C } from "../theme.js";
import * as XLSX from "xlsx";

// Helper: hitung Poisson CDF P(X <= s) untuk lambda tertentu
function poissonCDF(lambda, s) {
  if (lambda <= 0) return 1;
  let sum = 0, term = Math.exp(-lambda);
  for (let k = 0; k <= s; k++) {
    sum += term;
    term *= lambda / (k + 1);
  }
  return sum;
}

// Helper: cari qty terkecil yg memenuhi service level (Poisson)
function poissonQtyForServiceLevel(lambda, serviceLevel) {
  if (lambda <= 0) return 0;
  for (let s = 0; s <= 50; s++) {
    if (poissonCDF(lambda, s) >= serviceLevel) return s;
  }
  return 50;
}

// Parse baris Material Cadang dari rows XLSX/CSV
export function parseMaterialCadangRows(rows, katalogList) {
  const COL = {
    noKatalog: ["No Katalog","NO KATALOG","no katalog"],
    namaMaterial: ["Nama Material","NAMA MATERIAL"],
    equipmentCluster: ["Equipment Cluster","EQUIPMENT CLUSTER"],
    populasi: ["Populasi Cluster","POPULASI CLUSTER"],
    failure5y: ["Failure 5 Tahun","FAILURE 5 TAHUN"],
    penggantian5y: ["Penggantian 5 Tahun","PENGGANTIAN 5 TAHUN"],
    emergency5y: ["Emergency Replacement 5 Tahun","EMERGENCY REPLACEMENT 5 TAHUN"],
    leadTime: ["Lead Time Hari","LEAD TIME HARI"],
    ttf: ["Time To Failure Hari","TIME TO FAILURE HARI"],
    breakdown: ["Breakdown","BREAKDOWN"],
    harga: ["Harga Satuan","HARGA SATUAN"],
    merk: ["Merk","MERK","merk"],
  };
  function findCol(row, keys) {
    for (const k of keys) { if (row[k] !== undefined) return row[k]; }
    return undefined;
  }
  const parsed = rows.map((row, idx) => {
    const noKat = normalizeKatalog(findCol(row, COL.noKatalog));
    const namaMaterial = String(findCol(row, COL.namaMaterial)||"").trim();
    const cluster = String(findCol(row, COL.equipmentCluster)||"").trim();
    const merk = String(findCol(row, COL.merk)||"").trim();
    // Semua field numerik pakai parseIndoNumber (standarisasi titik/koma, lihat definisinya) —
    // sebelumnya beda-beda tempat pakai regex ad-hoc yang tidak konsisten (bug dilaporkan user
    // 2026-07-07: qty "103,5" bisa kebaca "1.035" kalau titik-desimal diperlakukan sebagai ribuan).
    const populasi = parseIndoNumber(findCol(row, COL.populasi));
    const failure5y = parseIndoNumber(findCol(row, COL.failure5y));
    const penggantian5y = parseIndoNumber(findCol(row, COL.penggantian5y));
    const emergency5y = parseIndoNumber(findCol(row, COL.emergency5y));
    const leadTime = parseIndoNumber(findCol(row, COL.leadTime));
    const ttf = parseIndoNumber(findCol(row, COL.ttf));
    const breakdownRaw = String(findCol(row, COL.breakdown)||"TIDAK").trim().toUpperCase();
    const breakdown = ["YA","Y","YES","TRUE","1"].includes(breakdownRaw);
    const hargaInput = parseIndoNumber(findCol(row, COL.harga));

    if (!noKat) return { _idx:idx, status:"INVALID", error:"No Katalog kosong", noKat:"", namaMaterial, cluster, merk, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };
    if (populasi <= 0) return { _idx:idx, status:"INVALID", error:"Populasi harus > 0", noKat, namaMaterial, cluster, merk, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };
    if (leadTime <= 0) return { _idx:idx, status:"INVALID", error:"Lead Time harus > 0", noKat, namaMaterial, cluster, merk, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };
    if (ttf <= 0) return { _idx:idx, status:"INVALID", error:"Time To Failure harus > 0", noKat, namaMaterial, cluster, merk, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };

    const katalogMatch = katalogList.find(k => normalizeKatalog(k.katalog) === noKat);
    let status = "UNMATCHED";
    let warnings = [];
    if (katalogMatch) {
      status = "MATCH";
      if (namaMaterial && katalogMatch.name && namaMaterial.toUpperCase() !== katalogMatch.name.toUpperCase()) {
        status = "WARNING_NAME_DIFF";
        warnings.push(`Nama beda: file="${namaMaterial}", sistem="${katalogMatch.name}"`);
      }
    }
    return { _idx:idx, status, noKat, namaMaterial, cluster, merk, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput, katalogId: katalogMatch?.id, katalogName: katalogMatch?.name, katalogSatuan: katalogMatch?.satuan, katalogHarga: katalogMatch ? (hargaInput || 0) : 0, warnings };
  });

  // Dedup: gabung baris dengan No Katalog + Equipment Cluster + Merk yang sama
  // (Merk beda = material berbeda meski No Katalog sama, jadi TIDAK di-merge — permintaan user 2026-08-09)
  const merged = [];
  const seen = {};
  for (const r of parsed) {
    if (r.status === "INVALID") { merged.push(r); continue; }
    const key = `${r.noKat}||${r.cluster}||${r.merk||""}`;
    if (seen[key] !== undefined) {
      const ex = merged[seen[key]];
      ex.populasi = Math.max(ex.populasi, r.populasi);
      ex.failure5y += r.failure5y;
      ex.penggantian5y += r.penggantian5y;
      ex.emergency5y += r.emergency5y;
      ex.leadTime = Math.max(ex.leadTime, r.leadTime);
      ex.ttf = Math.max(ex.ttf, r.ttf);
      ex.hargaInput = Math.max(ex.hargaInput, r.hargaInput);
      if (!ex.warnings) ex.warnings = [];
      ex.warnings.push("DUPLICATE_MERGED");
      if (ex.status === "MATCH") ex.status = "WARNING_NAME_DIFF";
    } else {
      seen[key] = merged.length;
      merged.push({...r});
    }
  }
  return merged;
}

// Hitung ABC analysis + policy + rekomendasi qty
export function hitungMaterialCadang(rows, stocks, katalogList, params = {}) {
  const { periodYears=5, slMandatory=0.99, slOptimum=0.95, slEconomic=0.90, threshA1Val=50, threshA1Item=3, threshA2Val=75, threshA2Item=10, threshBVal=95 } = params;

  // Hanya baris yang bisa dihitung
  const valid = rows.filter(r => ["MATCH","WARNING_NAME_DIFF","DUPLICATE_MERGED"].includes(r.status) && r.katalogId);

  // Harga dari stok jika tidak ada di file
  function getHarga(r) {
    if (r.hargaInput > 0) return r.hargaInput;
    const s = stocks.find(s => s.katalogId === r.katalogId);
    return s?.price || 0;
  }

  // Hitung riskUsageValue per baris
  const withRisk = valid.map(r => ({
    ...r,
    harga: getHarga(r),
    riskUsageValue: getHarga(r) * Math.max(r.failure5y, r.penggantian5y),
  }));

  // Sort descending riskUsageValue
  withRisk.sort((a,b) => b.riskUsageValue - a.riskUsageValue);
  const totalRisk = withRisk.reduce((s,r) => s + r.riskUsageValue, 0);

  // Kumulatif dan kelas ABC
  let cumulVal = 0, cumulItem = 0;
  const totalItem = withRisk.length;
  const results = withRisk.map((r, i) => {
    cumulVal += totalRisk > 0 ? (r.riskUsageValue / totalRisk * 100) : 0;
    cumulItem += totalItem > 0 ? (1 / totalItem * 100) : 0;

    let abcClass;
    if (cumulVal <= threshA1Val && cumulItem <= threshA1Item) abcClass = "A1";
    else if (cumulVal <= threshA2Val && cumulItem <= threshA2Item) abcClass = "A2";
    else if (cumulVal <= threshBVal) abcClass = "B1";
    else if (i < totalItem * 0.85) abcClass = "B2";
    else abcClass = "C";

    // Policy dan treatment
    let treatment, policy, mandatoryQty=null, poissonQty=null, economicQty=null, recommendedQty=0;
    const serviceLevel = abcClass==="A1" ? slMandatory : abcClass==="A2" ? slOptimum : slEconomic;

    if (abcClass === "C") {
      treatment = "Persediaan/Rutin"; policy = "Persediaan";
    } else if (abcClass === "A1") {
      treatment = "Material Cadang"; policy = "Mandatory";
      mandatoryQty = Math.max(1, Math.ceil(r.populasi * 0.02));
      recommendedQty = mandatoryQty;
    } else if (abcClass === "A2") {
      const isPersediaan = r.ttf >= r.leadTime && !r.breakdown && r.emergency5y === 0;
      if (isPersediaan) {
        treatment = "Persediaan/Rutin"; policy = "Persediaan";
      } else {
        treatment = "Material Cadang"; policy = "Optimum";
        const lambda = (r.failure5y / (periodYears * 365)) * r.leadTime;
        poissonQty = poissonQtyForServiceLevel(lambda, serviceLevel);
        recommendedQty = Math.max(poissonQty > 0 ? 1 : 0, poissonQty);
      }
    } else { // B1 / B2
      treatment = "Material Cadang"; policy = "Optimum & Economic";
      const lambda = (r.failure5y / (periodYears * 365)) * r.leadTime;
      poissonQty = poissonQtyForServiceLevel(lambda, serviceLevel);
      const rate = r.populasi > 0 ? r.penggantian5y / r.populasi : 0;
      economicQty = Math.ceil(rate * r.populasi);
      const finalQty = Math.max(poissonQty, economicQty);
      recommendedQty = finalQty > 0 ? Math.max(1, Math.ceil(finalQty)) : 0;
    }

    // Stok saat ini
    const currentQty = stocks.filter(s => s.katalogId === r.katalogId).reduce((a,s) => a + (s.qty||0), 0);
    const gapQty = Math.max(0, recommendedQty - currentQty);

    return {
      ...r, abcClass, treatment, policy, serviceLevel,
      mandatoryQty, poissonQty, economicQty, recommendedQty,
      currentQty, gapQty,
      cumulativeValuePct: parseFloat(cumulVal.toFixed(1)),
      cumulativeItemPct: parseFloat(cumulItem.toFixed(1)),
    };
  });

  return results;
}

function getMaterialCadangHealthStatus(score) {
  if (score <= 30) return { label:"Critical", color:"#dc2626", bg:"#fef2f2" };
  if (score <= 55) return { label:"High Risk", color:"#ea580c", bg:"#fff7ed" };
  if (score <= 75) return { label:"Watch", color:"#f59e0b", bg:"#fefce8" };
  return { label:"Healthy", color:"#16a34a", bg:"#dcfce7" };
}

function getMaterialCadangAction(r) {
  if (r.treatment !== "Material Cadang") return "Monitor Saja";
  if ((r.dataConfidence||100) < 65) return "Validasi Data Failure";
  if ((r.healthIndex||100) <= 30) return r.gapQty > 0 ? "Prioritaskan Pengadaan" : "Review Lead Time";
  if ((r.healthIndex||100) <= 55) return r.gapQty > 0 ? "Ajukan Apply Min Qty" : "Review Lead Time";
  if ((r.healthIndex||100) <= 75) return "Monitor Saja";
  return "Monitor Saja";
}

function calculateMaterialCadangHealthIndex(result, context = {}) {
  const maxLeadTime = context.maxLeadTime || 1;
  const maxGapValue = context.maxGapValue || 1;
  const stockCoverage = result.recommendedQty > 0 ? Math.min(1, (result.currentQty||0) / result.recommendedQty) : 1;
  const stockRisk = result.treatment === "Material Cadang" ? (1 - stockCoverage) * 35 : 0;
  const classRisk = { A1:20, A2:15, B1:10, B2:7, C:2 }[result.abcClass] || 5;
  const leadRisk = Math.min(1, (result.leadTime||0) / maxLeadTime) * 15;
  const failureBase = Math.max(result.failure5y||0, result.penggantian5y||0, result.emergency5y||0);
  const failureRisk = Math.min(15, failureBase * 3 + (result.breakdown ? 4 : 0) + ((result.emergency5y||0) > 0 ? 4 : 0));
  const valueRisk = Math.min(10, ((result.gapQty||0) * (result.harga||0) / maxGapValue) * 10);
  let confidence = 100;
  const flags = [];
  if (!result.harga || result.harga <= 0) { confidence -= 12; flags.push("Harga kosong"); }
  if ((result.warnings||[]).length) { confidence -= Math.min(18, result.warnings.length * 8); flags.push(...result.warnings); }
  if (!result.cluster) { confidence -= 10; flags.push("Equipment cluster kosong"); }
  if ((result.failure5y||0) === 0 && ((result.penggantian5y||0) > 0 || (result.emergency5y||0) > 0)) {
    confidence -= 15; flags.push("Failure 0 tetapi ada penggantian/emergency");
  }
  if ((result.leadTime||0) <= 0 || (result.ttf||0) <= 0) { confidence -= 20; flags.push("Lead time/TTF tidak valid"); }
  confidence = Math.max(20, Math.min(100, Math.round(confidence)));
  const confidencePenalty = (100 - confidence) * 0.15;
  const riskScore = Math.min(100, Math.round(stockRisk + classRisk + leadRisk + failureRisk + valueRisk + confidencePenalty));
  const healthIndex = Math.max(0, Math.min(100, 100 - riskScore));
  const status = getMaterialCadangHealthStatus(healthIndex);
  return {
    healthIndex,
    healthStatus: status.label,
    healthColor: status.color,
    healthBg: status.bg,
    riskScore,
    dataConfidence: confidence,
    aiRecommendation: getMaterialCadangAction({ ...result, healthIndex, dataConfidence: confidence }),
    healthBreakdown: {
      stockRisk: Math.round(stockRisk),
      classRisk: Math.round(classRisk),
      leadTimeRisk: Math.round(leadRisk),
      failureRisk: Math.round(failureRisk),
      valueRisk: Math.round(valueRisk),
      confidencePenalty: Math.round(confidencePenalty),
    },
    dataQualityFlags: flags,
  };
}

export function enrichMaterialCadangHealthResults(results) {
  const materialResults = (results||[]).filter(r => r.treatment === "Material Cadang");
  const maxLeadTime = Math.max(1, ...materialResults.map(r => r.leadTime||0));
  const maxGapValue = Math.max(1, ...materialResults.map(r => (r.gapQty||0) * (r.harga||0)));
  return (results||[]).map(r => {
    const health = calculateMaterialCadangHealthIndex(r, { maxLeadTime, maxGapValue });
    return { ...r, ...health };
  });
}

function buildMaterialCadangAiContext(run, results, stocks, katalogList, txns) {
  const material = (results||[]).filter(r => r.treatment === "Material Cadang");
  const topRisks = [...material].sort((a,b) => (a.healthIndex||100) - (b.healthIndex||100)).slice(0,12);
  const counts = results.reduce((acc,r)=>{
    const st = r.healthStatus || "Unclassified";
    acc[st] = (acc[st]||0)+1;
    return acc;
  }, {});
  const clusterBreakdown = material.reduce((acc,r)=>{
    const key = r.cluster || "Tanpa Cluster";
    if (!acc[key]) acc[key] = { count:0, gapQty:0, gapValue:0 };
    acc[key].count += 1;
    acc[key].gapQty += (r.gapQty||0);
    acc[key].gapValue += (r.gapQty||0)*(r.harga||0);
    return acc;
  }, {});
  const abcBreakdown = material.reduce((acc,r)=>{
    const key = r.abcClass || "Unclassified";
    if (!acc[key]) acc[key] = { count:0, gapQty:0, gapValue:0 };
    acc[key].count += 1;
    acc[key].gapQty += (r.gapQty||0);
    acc[key].gapValue += (r.gapQty||0)*(r.harga||0);
    return acc;
  }, {});
  const procurementPriority = material
    .filter(r => (r.gapQty||0) > 0)
    .sort((a,b) => ((b.gapQty||0)*(b.harga||0)) - ((a.gapQty||0)*(a.harga||0)))
    .slice(0,10)
    .map(r => ({
      noKatalog:r.noKat, nama:r.katalogName||r.namaMaterial, qty:r.gapQty,
      estimasiNilai:(r.gapQty||0)*(r.harga||0), abcClass:r.abcClass, healthStatus:r.healthStatus,
    }));
  return {
    runId: run?.id,
    createdAt: run?.createdAt,
    totalItems: results.length,
    statusCounts: counts,
    avgHealthIndex: results.length ? Math.round(results.reduce((a,r)=>a+(r.healthIndex||0),0)/results.length) : 0,
    avgDataConfidence: results.length ? Math.round(results.reduce((a,r)=>a+(r.dataConfidence||0),0)/results.length) : 0,
    totalGapQty: material.reduce((a,r)=>a+(r.gapQty||0),0),
    totalGapValue: material.reduce((a,r)=>a+((r.gapQty||0)*(r.harga||0)),0),
    clusterBreakdown,
    abcBreakdown,
    procurementPriority,
    topRisks: topRisks.map(r=>({
      katalogId:r.katalogId, noKatalog:r.noKat, nama:r.katalogName||r.namaMaterial, cluster:r.cluster,
      healthIndex:r.healthIndex, healthStatus:r.healthStatus, dataConfidence:r.dataConfidence,
      abcClass:r.abcClass, policy:r.policy, currentQty:r.currentQty, recommendedQty:r.recommendedQty,
      gapQty:r.gapQty, gapValue:(r.gapQty||0)*(r.harga||0), leadTime:r.leadTime,
      failure5y:r.failure5y, penggantian5y:r.penggantian5y, emergency5y:r.emergency5y,
      dataQualityFlags:r.dataQualityFlags||[], aiRecommendation:r.aiRecommendation,
    })),
  };
}

const MATERIAL_CADANG_METHODOLOGY_TEXT = "Health Index dihitung 100 dikurangi skor risiko tiap material: makin sering gagal/emergency, makin panjang lead time, dan makin besar kekurangan stok terhadap kebutuhan, makin rendah nilainya (0-100). Kelas ABC membagi material berdasarkan nilai risiko (gapQty x harga) - kelas A adalah kontributor nilai risiko terbesar yang paling perlu diprioritaskan, C paling kecil. Service level pakai distribusi Poisson: dari rata-rata pemakaian per periode dihitung peluang kebutuhan terpenuhi pada berbagai level stok, lalu dipilih qty minimum yang memenuhi target service level kebijakan (policy) material tersebut.";

export async function generateMaterialCadangAiInsights(run, results, stocks, katalogList, txns) {
  const context = buildMaterialCadangAiContext(run, results, stocks, katalogList, txns);
  const fallback = {
    id: "MCAI-" + Date.now(),
    runId: run.id,
    status: import.meta.env.VITE_GROQ_API_KEY ? "UNAVAILABLE" : "NO_API_KEY",
    model: "openai/gpt-oss-120b",
    createdAt: Date.now(),
    executiveSummary: (import.meta.env.VITE_GROQ_API_KEY ? "AI insight belum tersedia (Groq gagal/kosong). " : "AI insight belum tersedia karena VITE_GROQ_API_KEY belum diisi. ") + `Ringkasan lokal: total gap ${context.totalGapQty} unit senilai Rp${(context.totalGapValue||0).toLocaleString("id-ID")} pada ${context.totalItems} material. Cek tabel Health Index untuk detail.`,
    topRisks: context.topRisks.slice(0,5).map(r => `${r.nama} (${r.noKatalog}) - ${r.healthStatus}, HI ${r.healthIndex}`),
    dataQualityFindings: ["Gunakan tabel Health Index untuk melihat flag kualitas data per material."],
    recommendedActions: ["Review material Critical/High Risk dan ajukan apply minQty melalui approval Asman."],
    procurementPriority: context.procurementPriority.map(r => ({
      noKatalog:r.noKatalog, nama:r.nama, qty:r.qty, estimasiNilai:r.estimasiNilai,
      alasan:`Kelas ABC ${r.abcClass||"-"}, status ${r.healthStatus||"-"}`,
    })),
    validationNeeded: context.topRisks.filter(r => (r.dataConfidence||100) < 70).map(r => r.noKatalog),
    materialInsights: context.topRisks.slice(0,8).map(r => ({
      noKatalog:r.noKatalog, nama:r.nama,
      diagnosis:`Health Index ${r.healthIndex} (${r.healthStatus}), gap ${r.gapQty||0} unit.`,
      penyebab:`Failure ${r.failure5y||0}x/5th, emergency ${r.emergency5y||0}x, lead time ${r.leadTime||0} hari.`,
      rekomendasi:(r.gapQty||0)>0 ? "Ajukan penambahan stok minimum melalui apply." : "Pantau, belum ada gap stok mendesak.",
      confidence:r.dataConfidence,
    })),
    methodology: MATERIAL_CADANG_METHODOLOGY_TEXT,
  };
  if (!import.meta.env.VITE_GROQ_API_KEY) return fallback;
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${import.meta.env.VITE_GROQ_API_KEY}` },
      body:JSON.stringify({
        model:"openai/gpt-oss-120b",
        temperature:0.2,
        max_tokens:1800,
        messages:[
          { role:"system", content:`Kamu adalah AI analis manajemen Material Cadang WARNOTO PLN. Jawab hanya JSON valid. Jangan mengubah angka resmi (pakai persis angka dari konteks). Beri insight manajemen detail, actionable, audit-friendly, dan rekomendasi read-only. Bahasa Indonesia, jelas untuk pembaca non-teknis.` },
          { role:"user", content:`Buat AI insight Health Index Material Cadang dari konteks berikut, mencakup 4 aspek: (1) diagnosis per-material, (2) ringkasan eksekutif actionable, (3) prioritas pengadaan dengan estimasi nilai, (4) penjelasan metodologi bahasa awam. Output JSON dengan key persis berikut:
- executiveSummary (string): total gap qty & nilai, cluster/kelas ABC paling kritis, 1-2 rekomendasi utama.
- materialInsights (array of {noKatalog,nama,diagnosis,penyebab,rekomendasi,confidence}): diagnosis & penyebab spesifik kenapa material berisiko (failure/lead time/gap stok), untuk material di topRisks.
- procurementPriority (array of {noKatalog,nama,qty,estimasiNilai,alasan}): urut prioritas pengadaan tertinggi dulu, ambil dari context.procurementPriority.
- methodology (string): jelaskan awam cara hitung Poisson service level, ABC (by risk value), dan Health Index (100 dikurangi risk score) SESUAI konteks, jangan mengarang rumus lain.
- dataQualityFindings (array of string), recommendedActions (array of string), validationNeeded (array of noKatalog string), topRisks (array of string ringkas).
Konteks:\n${JSON.stringify(context).slice(0,14000)}` }
        ]
      })
    });
    if (!resp.ok) throw new Error(`Groq ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText);
    return { ...fallback, ...parsed, status:"ANSWERED", createdAt:Date.now(), runId:run.id };
  } catch (err) {
    return { ...fallback, status:"ERROR", errorMessage:err.message, createdAt:Date.now() };
  }
}

export function mapApplyAuditRow(r) {
  return {
    id: r.auditId, apply_id: r.id, run_id: r.runId||null, katalog_id: r.katalogId||null,
    no_katalog: r.noKatalog||null, requested_min_qty: r.recommendedQty ?? null,
    previous_min_qty: null, approved_min_qty: r.appliedMinQty ?? null, action: r.action,
    actor: r.actor, acted_at: r.actedAt, note: r.notes || r.rejectReason || null, audit_payload: r,
  };
}
