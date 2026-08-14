import { useEffect, useMemo, useState } from "react";
import { WAREHOUSE } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { supabase } from "../supabaseClient.js";
import * as XLSX from "xlsx";
import { Sparkline } from "./Sparkline.jsx";
import { MaterialCadangTab } from "./MaterialCadangTab.jsx";
import { computeKatalogRisk, computeProcurementList, DEFAULT_LEAD_TIME_DAYS, MIN_HISTORY_MONTHS } from "../lib/analytics.js";

const RISK_FILTERS = [
  {key:"critical",label:"Kritis"},
  {key:"attention",label:"Perhatian"},
  {key:"watch",label:"Waspada"},
  {key:"safe",label:"Aman"},
];
const RISK_PRIORITY = {critical:0,attention:1,watch:2,safe:3};
const RISK_COLORS = {critical:"#b91c1c",attention:"#b45309",watch:"#c2410c",safe:"#15803d"};
// Konstanta lead time & panjang histori minimum dipindah ke src/lib/analytics.js
// (computeKatalogRisk/computeProcurementList) supaya identik dengan Dashboard.

export function ForecastStokPage({ katalogList, setKatalogList, stocks, allStocks, setStocks, gudangList, lokasiList, txns, forecastDetail, setForecastDetail,
  forecastDetailResult, setForecastDetailResult, forecastDetailLoading, forecastDrillDown,
  setTab, sendChat,
  materialCadangData, setMaterialCadangData, maraReference, setMaraReference,
  materialCadangHealthData, setMaterialCadangHealthData,
  materialCadangAiInsights, setMaterialCadangAiInsights,
  catalogMasterRef, setCatalogMasterRef, saveToCloud, showToast, currentUser,
  uptList, uptScopeOptions, users, dataScope,
  C, sty }) {
  const [forecastView, setForecastView] = useState("forecast");
  const [uptLens, setUptLens] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("priority");
  const [mlForecasts, setMlForecasts] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // State pagination terpisah untuk tab Rekomendasi Pengadaan supaya pindah tab tidak
  // saling mereset posisi halaman tab satunya.
  const [procPage, setProcPage] = useState(1);
  const [procPageSize, setProcPageSize] = useState(20);
  const [procSearch, setProcSearch] = useState("");
  const [procStatusFilter, setProcStatusFilter] = useState("ALL");

  useEffect(() => { setPage(1); }, [statusFilter, search, sortMode, pageSize]);
  useEffect(() => { setProcPage(1); }, [procPageSize, procSearch, procStatusFilter]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      let q = supabase.from("forecast_predictions")
        .select("katalog_id,upt_id,tanggal_prediksi,qty_prediksi,estimasi_hari_sampai_habis,model_version,updated_at")
        .order("tanggal_prediksi", { ascending:true });
      if (dataScope) q = q.in("upt_id", dataScope);
      const { data, error } = await q;
      if (cancelled || error || !data) return;
      const grouped = {};
      data.forEach(row => {
        if (!grouped[row.katalog_id]) grouped[row.katalog_id] = {qtySum:0,qtyCount:0,estimasiHari:row.estimasi_hari_sampai_habis,modelVersion:row.model_version,updatedAt:row.updated_at,series:[]};
        const group = grouped[row.katalog_id];
        group.qtySum += row.qty_prediksi||0;
        group.qtyCount += 1;
        group.series.push(row.qty_prediksi||0);
        if (row.estimasi_hari_sampai_habis != null) group.estimasiHari = row.estimasi_hari_sampai_habis;
      });
      const result = {};
      Object.entries(grouped).forEach(([id,group]) => {
        result[id] = {
          estimasiHari:group.estimasiHari,
          avgQtyPrediksiHarian:group.qtyCount ? group.qtySum/group.qtyCount : 0,
          modelVersion:group.modelVersion,
          updatedAt:group.updatedAt,
          series:group.series,
        };
      });
      setMlForecasts(result);
    })();
    return () => { cancelled = true; };
  }, [dataScope]);

  // Lensa UPT/UIT: turunkan uptId tiap baris stok dari lokasiId→gudangId→uptId (pola sama
  // dengan App.jsx runPhotoSearch). Dropdown lensa hanya tampil bila showLens (scope ≥2 UPT).
  function uptOf(stock) {
    const gid = lokasiList.find(l=>l.id===stock.lokasiId)?.gudangId || stock.gudangId || null;
    return gid ? (gudangList.find(g=>g.id===gid)?.uptId || null) : null;
  }
  const distinctScopedUpts = useMemo(() => Array.from(new Set(stocks.map(uptOf).filter(Boolean))), [stocks, gudangList, lokasiList]);
  // Sumber lensa = scope permission user (uptScopeOptions dari App.jsx), BUKAN UPT yang
  // kebetulan punya stok — akun UIT dengan cuma 1 UPT berdata tetap harus lihat dropdown.
  const scopeUptIds = (uptScopeOptions && uptScopeOptions.length) ? uptScopeOptions.map(u=>u.id) : distinctScopedUpts;
  const showLens = (uptScopeOptions?.length || 0) >= 2;
  const viewStocks = uptLens==="ALL" ? stocks : stocks.filter(stock=>uptOf(stock)===uptLens);
  // txns tak punya uptId reliabel untuk difilter langsung — cukup filter stocks; risk/procurement
  // tetap benar karena enriched sudah menyempitkan daftar katalog lewat viewStocks.
  const viewTxns = txns;

  // Rumus TSB/ROP dipindah ke computeKatalogRisk (src/lib/analytics.js) supaya bisa dipakai
  // juga oleh Dashboard (computeProcurementList) tanpa duplikasi.
  function getRisk(katalog) {
    return computeKatalogRisk(katalog, viewStocks, viewTxns);
  }

  const enriched = useMemo(() => katalogList
    .filter(katalog=>viewStocks.some(stock=>stock.katalogId===katalog.id))
    .map(kat=>{
      const stockRows = viewStocks.filter(stock=>stock.katalogId===kat.id);
      const totalQty = stockRows.reduce((sum,stock)=>sum+(stock.qty||0),0);
      const risk = getRisk(kat);
      const ml = mlForecasts[kat.id];
      const divergent = ml?.estimasiHari!=null && risk.days!==Infinity && Math.abs(ml.estimasiHari-risk.days)/Math.max(risk.days,1)>0.4;
      return {kat,stockRows,totalQty,risk,ml,divergent};
    }), [katalogList,viewStocks,viewTxns,mlForecasts]);

  const counts = RISK_FILTERS.reduce((result,item)=>({...result,[item.key]:enriched.filter(entry=>entry.risk.key===item.key).length}),{});
  const mlReadyCount = enriched.filter(entry=>entry.ml).length;
  const visibleList = enriched
    .filter(entry=>statusFilter==="ALL" || entry.risk.key===statusFilter)
    .filter(entry=>{
      const keyword = search.trim().toLowerCase();
      return !keyword || `${entry.kat.name} ${entry.kat.katalog}`.toLowerCase().includes(keyword);
    })
    .sort((a,b)=>{
      if (sortMode==="name") return a.kat.name.localeCompare(b.kat.name,"id");
      if (sortMode==="stock") return a.totalQty-b.totalQty;
      if (sortMode==="days") return (a.risk.days===Infinity?Number.MAX_SAFE_INTEGER:a.risk.days)-(b.risk.days===Infinity?Number.MAX_SAFE_INTEGER:b.risk.days);
      return RISK_PRIORITY[a.risk.key]-RISK_PRIORITY[b.risk.key] || (a.risk.days-b.risk.days);
    });
  const totalPages = Math.max(1, Math.ceil(visibleList.length/pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pagedList = visibleList.slice((pageClamped-1)*pageSize, pageClamped*pageSize);

  // Daftar usulan pengadaan dipindah ke computeProcurementList (src/lib/analytics.js) supaya
  // ringkasannya bisa dipakai juga oleh Dashboard — rumus tidak berubah, cuma dipindah.
  const procurementResult = useMemo(() => computeProcurementList({
    katalogList, stocks: viewStocks, txns: viewTxns, materialCadangHealthData,
  }), [katalogList, viewStocks, viewTxns, materialCadangHealthData]);
  const procurementList = procurementResult.list;
  const procurementTotalQty = procurementResult.totalQty;
  const procurementTotalValue = procurementResult.totalValue;
  const filteredProcList = useMemo(()=> procurementList.filter(e => (procStatusFilter==="ALL" || e.risk.key===procStatusFilter) && (!procSearch.trim() || (e.kat.name+" "+e.kat.katalog).toLowerCase().includes(procSearch.trim().toLowerCase()))), [procurementList, procSearch, procStatusFilter]);
  const procTotalPages = Math.max(1, Math.ceil(filteredProcList.length/procPageSize));
  const procPageClamped = Math.min(procPage, procTotalPages);
  const pagedProcurementList = filteredProcList.slice((procPageClamped-1)*procPageSize, procPageClamped*procPageSize);

  // Kesehatan Material Cadang untuk cockpit: run terbaru PER UPT di scope (agregat ALL =
  // gabungan run terbaru tiap UPT; lensa single-UPT = run terbaru UPT itu saja). Mirror
  // reduce summary & sort top-priority dari MaterialCadangTab.jsx (L100-114, L647-671).
  const cockpitHealth = useMemo(() => {
    const runs = materialCadangHealthData?.analysisRuns || [];
    const healthResults = materialCadangHealthData?.healthResults || [];
    // Run lama tanpa uptId: infer UPT dari pembuatnya (baca-waktu saja, tidak menulis balik ke data).
    const runUptId = (r) => r.uptId || (users||[]).find(u=>u.id===r.createdBy)?.uptId || null;
    // Run ber-uit (dibuat scoped ke UIT, mis. oleh akun UIT tier) ikut terhitung untuk
    // semua user dalam UIT yang sama, walau uptId asalnya bukan UPT lensa saat ini.
    const runUitId = (r) => r.__uitId || r.uitId || null;
    const userUit = currentUser?.uitId || (uptList||[]).find(u=>u.id===currentUser?.uptId)?.uitId || null;
    let scopedRuns = [];
    if (uptLens !== "ALL") {
      const forThisUpt = runs.filter(r=>runUptId(r)===uptLens || (userUit && runUitId(r)===userUit));
      if (forThisUpt.length) scopedRuns = [forThisUpt.reduce((a,b)=>a.createdAt>b.createdAt?a:b)];
    } else {
      const latestByUpt = {};
      runs.forEach(r => {
        const rUpt = runUptId(r);
        const inUitScope = userUit && runUitId(r) === userUit;
        if (!inUitScope && (!rUpt || !scopeUptIds.includes(rUpt))) return;
        const bucketKey = rUpt || ("uit:" + runUitId(r));
        if (!latestByUpt[bucketKey] || r.createdAt > latestByUpt[bucketKey].createdAt) latestByUpt[bucketKey] = r;
      });
      scopedRuns = Object.values(latestByUpt);
    }
    const runIds = new Set(scopedRuns.map(r=>r.id));
    const results = healthResults.filter(r=>runIds.has(r.runId));
    const summary = results.reduce((acc, r) => {
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
    const topPriority = [...results]
      .filter(r=>r.treatment==="Material Cadang")
      .sort((a,b)=> a.abcClass!==b.abcClass ? a.abcClass.localeCompare(b.abcClass) : b.gapQty-a.gapQty)
      .slice(0,10);
    return { summary, topPriority, hasData: results.length>0 };
  }, [materialCadangHealthData, uptLens, scopeUptIds, currentUser, uptList]);

  // Strip banding per-UPT (pita 3, hanya lensa Agregat + scope ≥2 UPT) — usulan pengadaan
  // dihitung ulang per UPT dari computeProcurementList (rumus tidak berubah, cuma input).
  const perUptStrip = useMemo(() => {
    if (uptLens!=="ALL" || !showLens) return [];
    return uptScopeOptions.map(u => {
      const uptStocks = stocks.filter(stock=>uptOf(stock)===u.id);
      const result = computeProcurementList({ katalogList, stocks: uptStocks, txns, materialCadangHealthData });
      return { uptId: u.id, nama: u.nama || u.id, qty: result.totalQty, value: result.totalValue };
    });
  }, [uptLens, showLens, uptScopeOptions, stocks, katalogList, txns, materialCadangHealthData]);

  function formatDays(days) {
    if (days===Infinity) return "Belum ada data";
    if (days>365) return "> 1 tahun";
    return `± ${fmtNum(days)} hari`;
  }
  function downloadProcurementXLSX() {
    const listUntukExport = filteredProcList.length>0 ? filteredProcList : procurementList;
    const aoa = [
      ["No Katalog","Nama Material","Satuan","Status","Stok Saat Ini","Min Qty","Estimasi Habis","Usulan Qty Beli","Metode","Harga Satuan","Estimasi Nilai"],
      ...listUntukExport.map(e=>[e.kat.katalog, e.kat.name, e.kat.satuan, e.risk.label, e.totalQty, e.risk.minQty, formatDays(e.risk.days), e.qty, e.methodLabel||e.method||"", e.price||0, e.value||0]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekomendasi Pengadaan");
    const tanggal = new Date().toISOString().slice(0,10).replace(/-/g,"");
    XLSX.writeFile(wb, `REKOMENDASI_PENGADAAN_${uptLens}_${tanggal}.xlsx`);
    showToast?.(`Rekomendasi ${listUntukExport.length} material diunduh.`);
  }
  function openDetail(entry) {
    setForecastDetail({kat:entry.kat,stockRows:entry.stockRows});
    setForecastDetailResult(null);
    forecastDrillDown(entry.kat,entry.stockRows);
  }
  function continueInChat(prompt) {
    setTab("ai");
    setTimeout(()=>sendChat(prompt),100);
  }

  if (forecastDetail) {
    const kat = forecastDetail.kat;
    const stockRows = forecastDetail.stockRows||stocks.filter(stock=>stock.katalogId===kat.id);
    const totalQty = stockRows.reduce((sum,stock)=>sum+(stock.qty||0),0);
    const risk = getRisk(kat);
    const ml = mlForecasts[kat.id];
    return (
      <div className="workspace-page forecast-page forecast-detail-page">
        <button className="forecast-back" onClick={()=>{setForecastDetail(null);setForecastDetailResult(null);}}>← Kembali ke daftar material</button>
        <section className="forecast-detail-head">
          <div className="forecast-detail-head__copy">
            <span>{kat.katalog} · {kat.satuan}</span>
            <strong>{kat.name}</strong>
            <small>Stok saat ini <b>{fmtNum(totalQty)} {kat.satuan}</b></small>
          </div>
          <div className="forecast-detail-head__actions">
            <span className={`forecast-risk is-${risk.key}`}>{risk.label}</span>
            <button onClick={()=>continueInChat(`Berikan saran pengadaan untuk material: ${kat.name}`)}>Tanya Pak War</button>
          </div>
        </section>

        <div className="forecast-analysis-grid">
          <section className="forecast-analysis-panel is-ai">
            <div className="forecast-analysis-panel__head">
              <div><span>Analisis keputusan</span><strong>Heuristik dan rekomendasi AI</strong></div>
              <span className="forecast-analysis-panel__metric">{formatDays(risk.days)}</span>
            </div>
            <div className="forecast-analysis-panel__body">
              {forecastDetailLoading && <div className="forecast-analysis-loading"><span></span><strong>Pak War sedang menganalisis data material</strong><small>Biasanya membutuhkan 5–10 detik.</small></div>}
              {forecastDetailResult && !forecastDetailLoading && <div className="forecast-analysis-result" style={{color:C.text}}>{forecastDetailResult}</div>}
              {!forecastDetailResult && !forecastDetailLoading && <div className="forecast-analysis-empty">Belum ada hasil analisis untuk material ini.</div>}
            </div>
          </section>

          <section className="forecast-analysis-panel is-ml">
            <div className="forecast-analysis-panel__head">
              <div><span>Model statistik</span><strong>Prediksi ML Prophet</strong></div>
              <span className="forecast-analysis-panel__metric">{ml?.estimasiHari!=null?formatDays(ml.estimasiHari):"Data belum cukup"}</span>
            </div>
            <div className="forecast-analysis-panel__body">
              {ml ? <>
                <div className="forecast-ml-metrics">
                  <div><span>Prediksi harian</span><strong>{fmtNum(Math.round(ml.avgQtyPrediksiHarian))} {kat.satuan}</strong></div>
                  <div><span>Versi model</span><strong>{ml.modelVersion||"-"}</strong></div>
                </div>
                <div className="forecast-sparkline"><span>Tren prediksi 30 hari</span><Sparkline data={ml.series} color="#7c3aed" w={300} h={58}/></div>
                <small className="forecast-model-update">Pembaruan terakhir {fmtDate(new Date(ml.updatedAt).getTime())}</small>
              </> : <div className="forecast-analysis-empty">Minimal 5 transaksi keluar diperlukan sebelum prediksi ML tersedia.</div>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page forecast-page">
      <div className="forecast-view-switch" role="tablist" aria-label="Tampilan forecast">
        <button className={forecastView==="forecast"?"is-active":""} onClick={()=>setForecastView("forecast")} role="tab" aria-selected={forecastView==="forecast"}>Forecast Stok</button>
        <button className={forecastView==="material_cadang"?"is-active":""} onClick={()=>setForecastView("material_cadang")} role="tab" aria-selected={forecastView==="material_cadang"}>Material Cadang</button>
        <button className={forecastView==="procurement"?"is-active":""} onClick={()=>setForecastView("procurement")} role="tab" aria-selected={forecastView==="procurement"}>Rekomendasi Pengadaan</button>
      </div>

      {forecastView==="forecast" && (
        <section className="forecast-overview kpi-banner">
          <div className="forecast-overview__copy"><span>Proyeksi persediaan · {WAREHOUSE}</span><strong>Fokus pada material yang paling cepat membutuhkan tindakan</strong><small>Heuristik tersedia untuk seluruh material; prediksi ML muncul saat histori transaksi mencukupi.</small></div>
          <div className="forecast-overview__metrics">
            <button className={statusFilter==="critical"?"is-active":""} onClick={()=>setStatusFilter(statusFilter==="critical"?"ALL":"critical")}><span>Kritis</span><strong>{counts.critical}</strong></button>
            <button className={statusFilter==="attention"?"is-active":""} onClick={()=>setStatusFilter(statusFilter==="attention"?"ALL":"attention")}><span>Perhatian</span><strong>{counts.attention}</strong></button>
            <div><span>ML tersedia</span><strong>{mlReadyCount}</strong></div>
            <div><span>Total material</span><strong>{enriched.length}</strong></div>
          </div>
        </section>
      )}

      {forecastView==="procurement" && (
        <section className="forecast-overview kpi-banner forecast-cockpit-head">
          <div className="forecast-overview__copy">
            <span>Cockpit pengadaan</span>
            <strong>Rekomendasi Pengadaan</strong>
            <small>Gabungan kesehatan Material Cadang dan usulan beli — read-only, aksi tetap di tab Material Cadang.</small>
            {showLens && (
              <select className="forecast-cockpit-lens" value={uptLens} onChange={e=>setUptLens(e.target.value)}>
                <option value="ALL">Agregat (semua UPT)</option>
                {uptScopeOptions.map(u=><option key={u.id} value={u.id}>{u.nama}</option>)}
              </select>
            )}
          </div>
          <div className="forecast-overview__metrics">
            <div><span>Spare Kritis</span><strong>{cockpitHealth.summary.healthCounts.Critical||0}</strong></div>
            <div><span>Spare Kurang</span><strong>{cockpitHealth.summary.kurang}</strong></div>
            <div><span>Spare Kosong</span><strong>{cockpitHealth.summary.kosong}</strong></div>
            <div><span>Butuh tindakan</span><strong>{procurementList.length}</strong></div>
            <div><span>Total usulan qty</span><strong>{fmtNum(procurementTotalQty)}</strong></div>
            <div><span>Estimasi nilai</span><strong>{procurementTotalValue>0?`Rp ${procurementTotalValue.toLocaleString("id-ID")}`:"-"}</strong></div>
          </div>
        </section>
      )}

      {forecastView==="procurement" ? (
        <>
          {showLens && uptLens==="ALL" && perUptStrip.length>0 && (
            <div className="forecast-cockpit-strip">
              {perUptStrip.map(item=>(
                <button key={item.uptId} onClick={()=>setUptLens(item.uptId)}>
                  <span>{item.nama}</span>
                  <strong>Gap {fmtNum(item.qty)}</strong>
                  <span>{item.value>0?`Rp ${item.value.toLocaleString("id-ID")}`:"-"}</span>
                </button>
              ))}
            </div>
          )}

          <div className="forecast-cockpit-columns">
            <div style={sty.card}>
              <div className="forecast-cockpit-col-title"><strong>Material Cadang — Kesehatan Spare</strong></div>
              {!cockpitHealth.hasData ? (
                <div style={{textAlign:"center",padding:"28px 10px",color:C.muted}}>
                  <div style={{fontSize:13,marginBottom:12}}>Belum ada analisis Material Cadang untuk cakupan ini.</div>
                  <button style={sty.btn("ghost")} onClick={()=>setForecastView("material_cadang")}>Buka tab Material Cadang →</button>
                </div>
              ) : (
                <>
                  <div className="forecast-overview__metrics" style={{marginBottom:12}}>
                    <div><span>Critical</span><strong>{cockpitHealth.summary.healthCounts.Critical||0}</strong></div>
                    <div><span>High Risk</span><strong>{cockpitHealth.summary.healthCounts["High Risk"]||0}</strong></div>
                    <div><span>Watch</span><strong>{cockpitHealth.summary.healthCounts.Watch||0}</strong></div>
                    <div><span>Healthy</span><strong>{cockpitHealth.summary.healthCounts.Healthy||0}</strong></div>
                    <div><span>Avg Health</span><strong>{cockpitHealth.summary.avgHealth}/100</strong></div>
                    <div><span>Data Confidence</span><strong>{cockpitHealth.summary.avgConfidence}%</strong></div>
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead>
                        <tr style={{background:"#f9fafb"}}>
                          {["No Katalog","Nama","Merk","Kelas","Policy","Stok","Ideal","Gap","Status","Nilai Gap"].map(h=>(
                            <th key={h} style={{padding:"7px 8px",textAlign:"left",fontWeight:700,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cockpitHealth.topPriority.map((r,i)=>{
                          const status = r.currentQty===0?"Kosong/Kritis":r.currentQty<r.recommendedQty?"Kurang":"Aman";
                          const statusColor = r.currentQty===0?C.red:r.currentQty<r.recommendedQty?"#f59e0b":C.green;
                          return (
                            <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                              <td style={{padding:"6px 8px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                              <td style={{padding:"6px 8px",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                              <td style={{padding:"6px 8px",fontSize:12,color:C.muted,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.merk||"-"}</td>
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
                    <button style={sty.btn("ghost","sm")} onClick={()=>setForecastView("material_cadang")}>Kelola di Material Cadang →</button>
                  </div>
                </>
              )}
            </div>

            <div>
              <div className="forecast-cockpit-col-title"><strong>Forecast & Usulan Beli</strong><button className="forecast-cockpit-copy-btn" disabled={procurementList.length===0} onClick={downloadProcurementXLSX}>Download Rekomendasi</button></div>
              <div className="forecast-controls">
                <div className="forecast-search"><span aria-hidden="true">⌕</span><input value={procSearch} onChange={e=>setProcSearch(e.target.value)} placeholder="Cari nama atau nomor katalog..."/></div>
                <div className="forecast-status-filter">
                  <button className={procStatusFilter==="ALL"?"is-active":""} onClick={()=>setProcStatusFilter("ALL")}>Semua <b>{procurementList.length}</b></button>
                  {RISK_FILTERS.map(item=><button key={item.key} className={procStatusFilter===item.key?"is-active":""} onClick={()=>setProcStatusFilter(procStatusFilter===item.key?"ALL":item.key)}>{item.label} <b>{procurementList.filter(e=>e.risk.key===item.key).length}</b></button>)}
                </div>
              </div>
              <details className="forecast-methodology"><summary>Bagaimana usulan qty dihitung?</summary><p>Material yang sudah dianalisis di tab Material Cadang memakai angka gap dari perhitungan Poisson service-level per kelas ABC. Sisanya memakai ROP+ROQ: titik pesan ulang (pemakaian rata-rata selama lead time {DEFAULT_LEAD_TIME_DAYS} hari + safety stock Z×σ×√lead time, service level 98% untuk Kritis dan 95% untuk Waspada), ditambah satu lot pesan sebesar pemakaian rata-rata satu bulan atau stok minimum — mana yang lebih besar — agar tidak terjadi pembelian mini berulang. Material tanpa histori pemakaian (belum pernah keluar dari gudang) diusulkan sebesar selisih ke stok minimum saja, tanpa buffer statistik — gunakan tombol "Lihat detail" untuk verifikasi manual atau analisis lewat tab Material Cadang kalau nilainya signifikan. Stok minimum sendiri dihitung otomatis dari histori pemakaian (reorder point, service level 95%) bila datanya sudah ≥{MIN_HISTORY_MONTHS} bulan, dan baru memakai angka manual "Min Qty Alert" dari Data Stok kalau histori belum cukup. Hanya material berstatus Kritis dan Waspada yang ditampilkan.</p></details>

              <div className="forecast-table-card mobile-card-table forecast-card-table">
                <table className="forecast-table">
                  <thead><tr><th>Material</th><th>Status</th><th>Stok saat ini</th><th>Estimasi habis</th><th>Usulan qty beli</th><th>Estimasi nilai</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {pagedProcurementList.map(entry=><tr key={entry.kat.id} className="mobile-card-table__row" style={{"--risk-accent":RISK_COLORS[entry.risk.key]}}>
                      <td className="mobile-card-table__title"><strong>{entry.kat.name}</strong><span>{entry.kat.katalog} · {entry.kat.satuan}</span></td>
                      <td data-label="Status"><span className={`forecast-risk is-${entry.risk.key}`}>{entry.risk.label}</span></td>
                      <td data-label="Stok"><strong>{fmtNum(entry.totalQty)}</strong><span>min {fmtNum(entry.risk.minQty)} {entry.kat.satuan}{entry.risk.minQtySource==="computed"?" · dihitung dari histori":""}</span></td>
                      <td data-label="Estimasi habis"><strong>{formatDays(entry.risk.days)}</strong><span>berdasarkan transaksi</span></td>
                      <td data-label="Usulan qty">{entry.qty>0
                        ? <><strong>{fmtNum(entry.qty)}</strong><span>{entry.kat.satuan}</span><span>{entry.methodLabel}</span></>
                        : <><strong>Sudah di stok minimum</strong><span>{entry.method==="material_cadang"?"stok sudah memenuhi rekomendasi Material Cadang":"tidak perlu beli sekarang — belum ada histori pemakaian untuk hitung buffer"}</span></>}</td>
                      <td data-label="Estimasi nilai"><strong>{entry.qty>0&&entry.price>0?`Rp ${entry.value.toLocaleString("id-ID")}`:"-"}</strong><span>{entry.price>0?`@ Rp ${entry.price.toLocaleString("id-ID")}`:"harga belum ada"}</span></td>
                      <td data-label="Aksi"><div className="forecast-row-actions"><button onClick={()=>openDetail(entry)}>Lihat detail</button><button onClick={()=>continueInChat(`Buatkan rekomendasi pengadaan untuk material: ${entry.kat.name} [${entry.kat.katalog}] — stok saat ini ${fmtNum(entry.totalQty)} ${entry.kat.satuan}, usulan beli ${entry.qty>0?`${fmtNum(entry.qty)} ${entry.kat.satuan}`:"belum bisa dihitung otomatis"}`)}>Pak War</button></div></td>
                    </tr>)}
                  </tbody>
                </table>
                {filteredProcList.length > 0 && (
                  <div className="forecast-pagination">
                    <div className="forecast-pagination__size">
                      Tampilkan
                      <select value={procPageSize} onChange={e=>setProcPageSize(Number(e.target.value))}>
                        {[20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
                      </select>
                      item per halaman — {filteredProcList.length} total
                    </div>
                    <div className="forecast-pagination__nav">
                      <button disabled={procPageClamped<=1} onClick={()=>setProcPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                      <span>Halaman {procPageClamped} / {procTotalPages}</span>
                      <button disabled={procPageClamped>=procTotalPages} onClick={()=>setProcPage(p=>Math.min(procTotalPages,p+1))}>Berikutnya →</button>
                    </div>
                  </div>
                )}
                {procurementList.length===0 && <div className="forecast-empty"><strong>Tidak ada material kritis/waspada saat ini</strong><span>Kondisi stok aman, belum ada usulan pengadaan.</span></div>}
                {procurementList.length>0 && filteredProcList.length===0 && <div className="forecast-empty"><strong>Tidak ada material yang sesuai filter</strong><span>Ubah filter atau kata pencarian untuk melihat data lain.</span></div>}
              </div>
            </div>
          </div>
        </>
      ) : forecastView==="material_cadang" ? (
        <MaterialCadangTab
          materialCadangData={materialCadangData} setMaterialCadangData={setMaterialCadangData}
          materialCadangHealthData={materialCadangHealthData} setMaterialCadangHealthData={setMaterialCadangHealthData}
          materialCadangAiInsights={materialCadangAiInsights} setMaterialCadangAiInsights={setMaterialCadangAiInsights}
          maraReference={maraReference} setMaraReference={setMaraReference}
          catalogMasterRef={catalogMasterRef} setCatalogMasterRef={setCatalogMasterRef}
          katalogList={katalogList} setKatalogList={setKatalogList}
          stocks={stocks} allStocks={allStocks} setStocks={setStocks} gudangList={gudangList} lokasiList={lokasiList}
          txns={txns} currentUser={currentUser} sty={sty} C={C}
          saveToCloud={saveToCloud} showToast={showToast} users={users} uptList={uptList}
        />
      ) : (
        <>
          <div className="forecast-controls">
            <div className="forecast-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Cari nama atau nomor katalog..."/></div>
            <div className="forecast-status-filter">
              <button className={statusFilter==="ALL"?"is-active":""} onClick={()=>setStatusFilter("ALL")}>Semua <b>{enriched.length}</b></button>
              {RISK_FILTERS.map(item=><button key={item.key} className={statusFilter===item.key?"is-active":""} onClick={()=>setStatusFilter(statusFilter===item.key?"ALL":item.key)}>{item.label} <b>{counts[item.key]}</b></button>)}
            </div>
            <label className="forecast-sort"><span>Urutkan</span><select value={sortMode} onChange={event=>setSortMode(event.target.value)}><option value="priority">Prioritas tindakan</option><option value="days">Estimasi tercepat</option><option value="stock">Stok terendah</option><option value="name">Nama material</option></select></label>
          </div>

          <details className="forecast-methodology"><summary>Bagaimana angka forecast dihitung?</summary><p>Heuristik membandingkan pemakaian historis TUG-9/TUG-8 dengan stok saat ini. ML Prophet memakai histori TUG-15 dan memerlukan minimal 10 transaksi keluar per material.</p></details>

          <div className="forecast-table-card mobile-card-table forecast-card-table">
            <table className="forecast-table">
              <thead><tr><th>Material</th><th>Status</th><th>Stok saat ini</th><th>Estimasi heuristik</th><th>Prediksi ML</th><th>Validasi</th><th>Aksi</th></tr></thead>
              <tbody>
                {pagedList.map(entry=><tr key={entry.kat.id} className="mobile-card-table__row" onClick={()=>openDetail(entry)} style={{"--risk-accent":RISK_COLORS[entry.risk.key]}}>
                  <td className="mobile-card-table__title"><strong>{entry.kat.name}</strong><span>{entry.kat.katalog} · {entry.kat.satuan}</span></td>
                  <td data-label="Status"><span className={`forecast-risk is-${entry.risk.key}`}>{entry.risk.label}</span></td>
                  <td data-label="Stok"><strong>{fmtNum(entry.totalQty)}</strong><span>{entry.kat.satuan}</span></td>
                  <td data-label="Estimasi"><strong>{formatDays(entry.risk.days)}</strong><span>berdasarkan transaksi</span></td>
                  <td data-label="Prediksi ML"><strong>{entry.ml?.estimasiHari!=null?formatDays(entry.ml.estimasiHari):"Belum tersedia"}</strong><span>{entry.ml?.modelVersion||"histori belum cukup"}</span></td>
                  <td data-label="Validasi">{entry.divergent?<span className="forecast-validation is-warning">Perlu ditinjau</span>:<span className="forecast-validation">Selaras</span>}</td>
                  <td data-label="Aksi"><div className="forecast-row-actions"><button onClick={event=>{event.stopPropagation();openDetail(entry);}}>Analisis</button><button onClick={event=>{event.stopPropagation();continueInChat(`Analisis dan forecast stok untuk material: ${entry.kat.name} [${entry.kat.katalog}]`);}}>Pak War</button></div></td>
                </tr>)}
              </tbody>
            </table>
            {visibleList.length > 0 && (
              <div className="forecast-pagination">
                <div className="forecast-pagination__size">
                  Tampilkan
                  <select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>
                    {[20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  item per halaman — {visibleList.length} total
                </div>
                <div className="forecast-pagination__nav">
                  <button disabled={pageClamped<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                  <span>Halaman {pageClamped} / {totalPages}</span>
                  <button disabled={pageClamped>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya →</button>
                </div>
              </div>
            )}
            {enriched.length===0 && <div className="forecast-empty"><strong>Belum ada data stok untuk dianalisis</strong><span>Material akan muncul setelah data stok tersedia.</span></div>}
            {enriched.length>0 && visibleList.length===0 && <div className="forecast-empty"><strong>Tidak ada material yang sesuai</strong><span>Ubah filter atau kata pencarian untuk melihat data lain.</span></div>}
          </div>
        </>
      )}
    </div>
  );
}
