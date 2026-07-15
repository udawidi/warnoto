import { useEffect, useMemo, useState } from "react";
import { WAREHOUSE } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { supabase } from "../supabaseClient.js";
import { Sparkline } from "./Sparkline.jsx";
import { MaterialCadangTab } from "./MaterialCadangTab.jsx";

const RISK_FILTERS = [
  {key:"critical",label:"Kritis"},
  {key:"attention",label:"Perhatian"},
  {key:"watch",label:"Waspada"},
  {key:"safe",label:"Aman"},
];
const RISK_PRIORITY = {critical:0,attention:1,watch:2,safe:3};

export function ForecastStokPage({ katalogList, setKatalogList, stocks, txns, forecastDetail, setForecastDetail,
  forecastDetailResult, setForecastDetailResult, forecastDetailLoading, forecastDrillDown,
  setTab, sendChat,
  materialCadangData, setMaterialCadangData, maraReference, setMaraReference,
  materialCadangHealthData, setMaterialCadangHealthData,
  materialCadangAiInsights, setMaterialCadangAiInsights,
  catalogMasterRef, setCatalogMasterRef, saveToCloud, showToast, currentUser,
  C, sty }) {
  const [forecastView, setForecastView] = useState("forecast");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("priority");
  const [mlForecasts, setMlForecasts] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => { setPage(1); }, [statusFilter, search, sortMode, pageSize]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("forecast_predictions")
        .select("katalog_id,tanggal_prediksi,qty_prediksi,estimasi_hari_sampai_habis,model_version,updated_at")
        .order("tanggal_prediksi", { ascending:true });
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
  }, []);

  function getRisk(katalog) {
    const stockRows = stocks.filter(stock=>stock.katalogId===katalog.id);
    const totalQty = stockRows.reduce((sum,stock)=>sum+(stock.qty||0),0);
    const minQty = stockRows.reduce((max,stock)=>Math.max(max,stock.minQty||0),0);
    const usageItems = [];
    txns.filter(txn=>["TUG9","TUG8"].includes(txn.docType)&&txn.status==="APPROVED").forEach(txn=>{
      (txn.stockItems||[]).forEach(item=>{
        const stock = stocks.find(row=>row.id===item.stockId);
        if (stock?.katalogId===katalog.id) usageItems.push({qty:item.qty||0,ts:txn.approvedAt||txn.createdAt});
      });
    });
    const totalUsage = usageItems.reduce((sum,item)=>sum+item.qty,0);
    const oldest = usageItems.length ? Math.min(...usageItems.map(item=>item.ts)) : Date.now();
    const months = Math.max(1,(Date.now()-oldest)/(30*24*60*60*1000));
    const averageMonthly = totalUsage/months;
    const estimatedDays = averageMonthly>0 ? Math.round(totalQty/(averageMonthly/30)) : Infinity;
    const critical = minQty>0 && totalQty<=minQty;
    if (critical || estimatedDays<=30) return {key:"critical",label:"Kritis",days:estimatedDays};
    if (estimatedDays<=90) return {key:"attention",label:"Perhatian",days:estimatedDays};
    if (estimatedDays<=180) return {key:"watch",label:"Waspada",days:estimatedDays};
    return {key:"safe",label:"Aman",days:estimatedDays};
  }

  const enriched = useMemo(() => katalogList
    .filter(katalog=>stocks.some(stock=>stock.katalogId===katalog.id))
    .map(kat=>{
      const stockRows = stocks.filter(stock=>stock.katalogId===kat.id);
      const totalQty = stockRows.reduce((sum,stock)=>sum+(stock.qty||0),0);
      const risk = getRisk(kat);
      const ml = mlForecasts[kat.id];
      const divergent = ml?.estimasiHari!=null && risk.days!==Infinity && Math.abs(ml.estimasiHari-risk.days)/Math.max(risk.days,1)>0.4;
      return {kat,stockRows,totalQty,risk,ml,divergent};
    }), [katalogList,stocks,txns,mlForecasts]);

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

  function formatDays(days) {
    if (days===Infinity) return "Belum ada data";
    if (days>365) return "> 1 tahun";
    return `± ${fmtNum(days)} hari`;
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
              </> : <div className="forecast-analysis-empty">Minimal 10 transaksi keluar diperlukan sebelum prediksi ML tersedia.</div>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page forecast-page">
      <section className="forecast-overview kpi-banner">
        <div className="forecast-overview__copy"><span>Proyeksi persediaan · {WAREHOUSE}</span><strong>Fokus pada material yang paling cepat membutuhkan tindakan</strong><small>Heuristik tersedia untuk seluruh material; prediksi ML muncul saat histori transaksi mencukupi.</small></div>
        <div className="forecast-overview__metrics">
          <button disabled={forecastView!=="forecast"} className={forecastView==="forecast"&&statusFilter==="critical"?"is-active":""} onClick={()=>setStatusFilter(statusFilter==="critical"?"ALL":"critical")}><span>Kritis</span><strong>{counts.critical}</strong></button>
          <button disabled={forecastView!=="forecast"} className={forecastView==="forecast"&&statusFilter==="attention"?"is-active":""} onClick={()=>setStatusFilter(statusFilter==="attention"?"ALL":"attention")}><span>Perhatian</span><strong>{counts.attention}</strong></button>
          <div><span>ML tersedia</span><strong>{mlReadyCount}</strong></div>
          <div><span>Total material</span><strong>{enriched.length}</strong></div>
        </div>
      </section>

      <div className="forecast-view-switch" role="tablist" aria-label="Tampilan forecast">
        <button className={forecastView==="forecast"?"is-active":""} onClick={()=>setForecastView("forecast")} role="tab" aria-selected={forecastView==="forecast"}>Forecast Stok</button>
        <button className={forecastView==="material_cadang"?"is-active":""} onClick={()=>setForecastView("material_cadang")} role="tab" aria-selected={forecastView==="material_cadang"}>Material Cadang</button>
      </div>

      {forecastView==="material_cadang" ? (
        <MaterialCadangTab
          materialCadangData={materialCadangData} setMaterialCadangData={setMaterialCadangData}
          materialCadangHealthData={materialCadangHealthData} setMaterialCadangHealthData={setMaterialCadangHealthData}
          materialCadangAiInsights={materialCadangAiInsights} setMaterialCadangAiInsights={setMaterialCadangAiInsights}
          maraReference={maraReference} setMaraReference={setMaraReference}
          catalogMasterRef={catalogMasterRef} setCatalogMasterRef={setCatalogMasterRef}
          katalogList={katalogList} setKatalogList={setKatalogList}
          stocks={stocks} txns={txns} currentUser={currentUser} sty={sty} C={C}
          saveToCloud={saveToCloud} showToast={showToast}
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

          <div className="forecast-table-card">
            <table className="forecast-table">
              <thead><tr><th>Material</th><th>Status</th><th>Stok saat ini</th><th>Estimasi heuristik</th><th>Prediksi ML</th><th>Validasi</th><th>Aksi</th></tr></thead>
              <tbody>
                {pagedList.map(entry=><tr key={entry.kat.id} onClick={()=>openDetail(entry)}>
                  <td><strong>{entry.kat.name}</strong><span>{entry.kat.katalog} · {entry.kat.satuan}</span></td>
                  <td><span className={`forecast-risk is-${entry.risk.key}`}>{entry.risk.label}</span></td>
                  <td><strong>{fmtNum(entry.totalQty)}</strong><span>{entry.kat.satuan}</span></td>
                  <td><strong>{formatDays(entry.risk.days)}</strong><span>berdasarkan transaksi</span></td>
                  <td><strong>{entry.ml?.estimasiHari!=null?formatDays(entry.ml.estimasiHari):"Belum tersedia"}</strong><span>{entry.ml?.modelVersion||"histori belum cukup"}</span></td>
                  <td>{entry.divergent?<span className="forecast-validation is-warning">Perlu ditinjau</span>:<span className="forecast-validation">Selaras</span>}</td>
                  <td><div className="forecast-row-actions"><button onClick={event=>{event.stopPropagation();openDetail(entry);}}>Analisis</button><button onClick={event=>{event.stopPropagation();continueInChat(`Analisis dan forecast stok untuk material: ${entry.kat.name} [${entry.kat.katalog}]`);}}>Pak War</button></div></td>
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
