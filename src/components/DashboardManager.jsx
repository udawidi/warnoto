// Komponen DashboardManager — dipindah dari App.jsx (refactor Fase 4f).
import { fmtRp } from "../lib/utils.js";
import { fmtNum, getKritisAgg } from "../lib/ragShared.mjs";
import { buildMonthlySeriesByKatalog } from "../lib/analytics.js";
import { KPISaldoCards } from "./KPISaldoCards.jsx";
import { CollapsibleSection } from "./CollapsibleSection.jsx";
import { PendingWidget } from "./PendingWidget.jsx";
import { RencanaWidget } from "./RencanaWidget.jsx";
import { HeavyEquipmentDashboardSummary } from "./HeavyEquipmentDashboardSummary.jsx";
import { AttbDashboardSummary } from "./AttbDashboardSummary.jsx";
import { DashboardAnalitikSection } from "./DashboardAnalitikSection.jsx";
import { Package, Warning, Hourglass, Tractor, ClipboardText, Siren, Buildings } from "@phosphor-icons/react";

export function DashboardManager({ stocks, txns, katalogList, uptList, rencanaKedatanganList, myPendingApprovals, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, heavyEquipmentList, heavyEquipmentLoans, currentUser, uptNama, attbList, attbBongkaranPool, isMobile }) {
  const nilaiTotal = stocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  // Deret pemakaian bulanan per katalog — key-nya katalogId (bukan lokasi/UPT), jadi map yang
  // sama dipakai ulang untuk rekap per-UPT di tabel bawah.
  const monthlySeriesByKatalogId = buildMonthlySeriesByKatalog(txns, stocks);
  const stokKritis = getKritisAgg(stocks, monthlySeriesByKatalogId);
  const terlambat = rencanaKedatanganList.flatMap(r=>(r.items||[]).map(i=>({...i,tanggalSerahTerima:r.tanggalSerahTerima}))).filter(i=>i.tanggalSerahTerima && new Date(i.tanggalSerahTerima).getTime()<Date.now());
  const txnBulanIni = txns.filter(t=>{const d=new Date(t.createdAt); const now=new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});

  return (
    <div className="dashboard-manager">
      {/* Header Eksekutif */}
      <section className="dashboard-manager__hero">
        <div className="dashboard-manager__hero-layout">
          <div className="dashboard-manager__hero-copy">
            <span>PT PLN (Persero) · UIT JBM</span>
            <h2>Dashboard Eksekutif Material</h2>
            <p>Ringkasan posisi inventori dan aktivitas operasional {uptNama}</p>
            <small>{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</small>
          </div>
          <div className="dashboard-manager__inventory">
            <span>Total nilai inventori · {uptNama}</span>
            <strong>{fmtRp(nilaiTotal)}</strong>
          </div>
        </div>
      </section>

      {/* KPI Row */}
      <div className="dashboard-manager__kpis">
        {[
          {label:"Total Item Stok",val:stocks.length,icon:<Package weight="fill" size={22}/>,color:C.accent},
          {label:"Stok Kritis",val:stokKritis.length,icon:<Warning weight="fill" size={22}/>,color:stokKritis.length>0?"#dc2626":"#16a34a"},
          {label:"TUG Pending",val:myPendingApprovals.length,icon:<Hourglass weight="fill" size={22}/>,color:myPendingApprovals.length>0?"#f59e0b":"#16a34a"},
          {label:"Rencana Terlambat",val:terlambat.length,icon:<Warning weight="fill" size={22}/>,color:terlambat.length>0?"#dc2626":"#16a34a"},
          {label:"Transaksi Bulan Ini",val:txnBulanIni.length,icon:<ClipboardText weight="fill" size={22}/>,color:"#7c3aed"},
        ].map((s,i)=>(
          <div key={i} className="kpi-card" style={{"--kpi-color":s.color}}>
            <div className="kpi-card__icon" style={{"--kpi-tint":s.color+"1a"}}>{s.icon}</div>
            <div className="kpi-card__copy"><strong>{s.val}</strong><span>{s.label}</span></div>
          </div>
        ))}
      </div>

      <KPISaldoCards stocks={stocks} C={C} sty={sty}/>
      {(heavyEquipmentList?.length>0 || heavyEquipmentLoans?.length>0) && (
        <CollapsibleSection id="alatberat" title="Alat Berat" icon={<Tractor weight="fill" size={16} style={{verticalAlign:"-0.15em"}}/>} C={C}>
          <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser} uptList={uptList}/>
        </CollapsibleSection>
      )}
      {(attbList?.length>0 || attbBongkaranPool?.length>0) && (
        <CollapsibleSection id="attb" title="Aset ATTB (Penghapusan)" icon={<Buildings weight="fill" size={16} style={{verticalAlign:"-0.15em"}}/>} C={C}>
          <AttbDashboardSummary attbList={attbList} bongkaranPool={attbBongkaranPool} C={C} sty={sty} setTab={setTab} currentUser={currentUser} uptList={uptList}/>
        </CollapsibleSection>
      )}

      {/* Tabel per UPT */}
      <section className="dashboard-manager__upt-card">
        <div className="dashboard-manager__section-heading"><div><span>Network overview</span><h3>Ringkasan per UPT · UIT JBM</h3></div><small>Konsolidasi ketersediaan data unit</small></div>
        <div className="mobile-card-table network-card-table dashboard-manager__table-scroll">
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:C.sidebar,color:"white"}}>
                {["UPT","Total Item","Nilai Stok","Stok Kritis","Aktivitas Bulan Ini","Status"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:600}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uptList.map((upt,i)=>{
                const isSurabaya = upt.id==="UPT-SBY";
                const uptStocks = isSurabaya ? stocks : [];
                const uptNilai = uptStocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
                const uptKritis = getKritisAgg(uptStocks, monthlySeriesByKatalogId).length;
                const uptTxn = isSurabaya ? txnBulanIni.length : 0;
                return (
                  <tr className="mobile-card-table__row" key={upt.id} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                    <td data-label="UPT" className="mobile-card-table__title" style={{padding:"10px 10px",fontWeight:700}}>{upt.nama}</td>
                    <td data-label="Total Item" style={{padding:"10px 10px"}}>{isSurabaya?stocks.length:"—"}</td>
                    <td data-label="Nilai Stok" style={{padding:"10px 10px"}}>{isSurabaya?fmtRp(uptNilai):"—"}</td>
                    <td data-label="Stok Kritis" style={{padding:"10px 10px",color:uptKritis>0?"#dc2626":C.muted}}>{isSurabaya?uptKritis:"—"}</td>
                    <td data-label="Aktivitas Bulan Ini" style={{padding:"10px 10px"}}>{isSurabaya?`${uptTxn} TUG`:"—"}</td>
                    <td data-label="Status" className="is-key" style={{padding:"10px 10px"}}>
                      {isSurabaya
                        ? <span className="dashboard-manager-status is-active" style={{background:"#dcfce7",color:"#166534"}}>● Aktif</span>
                        : <span className="dashboard-manager-status" style={{background:"#f3f4f6",color: "#64748b"}}>○ Belum aktif</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dashboard-manager__table-note">* Data real hanya tersedia untuk UPT Surabaya (Fase 1). UPT lain akan terhubung di Fase 2.</div>
      </section>

      <div className="dashboard-manager__operations">
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          {/* Compliance — TUG pending lama */}
          {(()=>{
            const overdue = txns.filter(t=>t.status==="PENDING"&&(Date.now()-t.createdAt)>2*24*60*60*1000);
            if (overdue.length===0) return null;
            return (
              <div style={{...sty.card,borderLeft:`4px solid #dc2626`}}>
                <h3 style={{fontSize:13,fontWeight:700,color:"#dc2626",marginBottom:10}}><Siren weight="fill" size={14} style={{verticalAlign:"-0.15em",marginRight:4}}/>TUG Pending &gt; 2 Hari ({overdue.length})</h3>
                {overdue.slice(0,4).map((t,i)=>{
                  const days = Math.floor((Date.now()-t.createdAt)/(24*60*60*1000));
                  return (
                    <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
                      <div><div style={{fontSize:12,fontWeight:600}}>{t.namaPekerjaan}</div><div style={{fontSize:12,color:C.muted}}>{t.docType.replace("TUG","TUG-")}</div></div>
                      <div style={{fontSize:12,fontWeight:700,color:"#dc2626"}}>{days} hari</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        <div><RencanaWidget rencanaKedatanganList={rencanaKedatanganList} C={C} sty={sty} setTab={setTab}/></div>
      </div>

      <DashboardAnalitikSection txns={txns} stocks={stocks} katalogList={katalogList} topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode} C={C} sty={sty}/>
    </div>
  );
}
