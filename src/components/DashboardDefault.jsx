// Komponen DashboardDefault — dipindah dari App.jsx (refactor Fase 4f).
import { useState } from "react";
import { WAREHOUSE, JENIS_BARANG } from "../constants.js";
import { fmtRp } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { summarizeTxnDashboard } from "../lib/analytics.js";
import { KPISaldoCards } from "./KPISaldoCards.jsx";
import { CollapsibleSection } from "./CollapsibleSection.jsx";
import { PendingWidget } from "./PendingWidget.jsx";
import { RencanaWidget } from "./RencanaWidget.jsx";
import { HeavyEquipmentDashboardSummary } from "./HeavyEquipmentDashboardSummary.jsx";
import { AttbDashboardSummary } from "./AttbDashboardSummary.jsx";
import { DashboardAnalitikSection } from "./DashboardAnalitikSection.jsx";
import { Package, Money, Warning, Hourglass, Tractor, ClockCounterClockwise, ChartLineUp, CalendarBlank, MapPin, Buildings, Nut, CheckCircle, Circle } from "@phosphor-icons/react";

export function DashboardDefault({ stocks, txns, katalogList, lokasiList, rencanaKedatanganList, myPendingApprovals, lowStocks, totalVal, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, currentUser, heavyEquipmentList, heavyEquipmentLoans, materialCadangData, attbList, attbBongkaranPool, isMobile = false }) {
  const [dashModal, setDashModal] = useState(null); // null | "totalItem" | "nilai" | "kritis" | "tindakan"

  const jenisBreakdown = JENIS_BARANG.map(jb => ({
    jenis: jb,
    count: stocks.filter(s=>s.jenisBarang===jb).length,
    qty: stocks.filter(s=>s.jenisBarang===jb).reduce((a,s)=>a+(s.qty||0),0),
    nilai: stocks.filter(s=>s.jenisBarang===jb).reduce((a,s)=>a+(s.qty||0)*(s.price||0),0),
  })).filter(r=>r.count>0);

  const kpiCards = [
    {key:"totalItem",label:"Total Item",val:stocks.length,icon:<Package weight="fill" size={22}/>,color:C.accent,sub:"jenis barang"},
    {key:"nilai",label:"Nilai Inventory",val:fmtRp(totalVal),icon:<Money weight="fill" size={22}/>,color:"#16a34a",sub:"estimasi total"},
    {key:"kritis",label:"Stok Kritis",val:lowStocks.length,icon:<Warning weight="fill" size={22}/>,color:lowStocks.length>0?"#dc2626":"#16a34a",sub:"perlu reorder"},
    {key:"tindakan",label:"Butuh Tindakan",val:myPendingApprovals.length,icon:<Hourglass weight="fill" size={22}/>,color:myPendingApprovals.length>0?"#f59e0b":"#16a34a",sub:"menunggu kamu"},
  ];

  return (
    <div className="dashboard-overview">
      <div className="dashboard-overview__context">
        <span>Overview operasional</span>
        <strong>{WAREHOUSE}</strong>
        <small>{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</small>
      </div>
      <div className="dashboard-overview__kpis">
        {kpiCards.map((s,i)=>(
          <button key={i} className="dashboard-overview-kpi" style={{"--dashboard-kpi-color":s.color}} onClick={()=>setDashModal(s.key)} title="Klik untuk lihat ringkasan">
            <div className="dashboard-overview-kpi__copy">
              <span>{s.label}</span>
              <strong>{s.val}</strong>
              <small>{s.sub}</small>
            </div>
            <div className="dashboard-overview-kpi__icon" style={{color:s.color}}>{s.icon}</div>
          </button>
        ))}
      </div>
      <div className="dashboard-default-saldo"><KPISaldoCards stocks={stocks} C={C} sty={sty}/></div>
      {(heavyEquipmentList?.length>0 || heavyEquipmentLoans?.length>0) && (
        <CollapsibleSection id={isMobile ? "default-mobile-alatberat" : "alatberat"} title="Alat Berat" icon={<Tractor weight="fill" size={16} style={{verticalAlign:"-0.15em"}}/>} defaultOpen={!isMobile} C={C}>
          <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
        </CollapsibleSection>
      )}
      {(attbList?.length>0 || attbBongkaranPool?.length>0) && (
        <CollapsibleSection id={isMobile ? "default-mobile-attb" : "attb"} title="Aset ATTB (Penghapusan)" icon="🏢" defaultOpen={!isMobile} C={C}>
          <AttbDashboardSummary attbList={attbList} bongkaranPool={attbBongkaranPool} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
        </CollapsibleSection>
      )}
      {(()=>{
        const results = materialCadangData?.analyses?.slice(-1)[0]?.results || [];
        if (!results.length) return null;
        const cadang = results.filter(r=>r.treatment==="Material Cadang");
        const aman = cadang.filter(r=>r.currentQty>=r.recommendedQty&&r.recommendedQty>0).length;
        const kurang = cadang.filter(r=>r.currentQty>0&&r.currentQty<r.recommendedQty).length;
        const kosong = cadang.filter(r=>r.recommendedQty>0&&r.currentQty===0).length;
        const gapVal = cadang.reduce((s,r)=>s+r.gapQty*(r.harga||0),0);
        const topGap = [...cadang].filter(r=>r.gapQty>0).sort((a,b)=>b.gapQty*b.harga-a.gapQty*a.harga).slice(0,3);
        return (
          <div className="dashboard-overview__analysis" style={{...sty.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontWeight:800,fontSize:13,color:"#7c3aed"}}><Nut weight="fill" size={14} style={{verticalAlign:"-0.15em",marginRight:4}}/>Material Cadang — Ringkasan Analisis</div>
              <button style={{...sty.btn("ghost","sm"),fontSize:12}} onClick={()=>setTab("forecastStok")}>Lihat detail →</button>
            </div>
            <div style={{display:"flex",gap:20,flexWrap:"wrap",marginBottom:10}}>
              {[
                {id:"total",label:"Total Analisis",val:cadang.length,color:C.accent},
                {id:"aman",label:(<>Aman <CheckCircle weight="fill" size={12} color={C.green} style={{verticalAlign:"-0.15em"}}/></>),val:aman,color:C.green},
                {id:"kurang",label:(<>Kurang <Warning weight="fill" size={12} color="#f59e0b" style={{verticalAlign:"-0.15em"}}/></>),val:kurang,color:"#f59e0b"},
                {id:"kosong",label:(<>Kosong <Circle weight="fill" size={12} color={C.red} style={{verticalAlign:"-0.15em"}}/></>),val:kosong,color:C.red},
                {id:"gap",label:"Est. Gap Nilai",val:"Rp "+fmtNum(gapVal),color:"#7c3aed"},
              ].map(k=>(
                <div key={k.id}>
                  <div style={{fontSize:12,color:C.muted}}>{k.label}</div>
                  <div style={{fontSize:15,fontWeight:800,color:k.color,fontVariantNumeric:"tabular-nums"}}>{k.val}</div>
                </div>
              ))}
            </div>
            {topGap.length>0 && <div style={{fontSize:12,color:C.muted}}>
              Prioritas: {topGap.map(r=><span key={r.noKat} style={{marginRight:8}}><b style={{color:C.red}}>{r.noKat}</b> gap {r.gapQty} pcs</span>)}
            </div>}
          </div>
        );
      })()}
      <CollapsibleSection id={isMobile ? "default-mobile-aktivitas" : "aktivitas"} title="Aktivitas Terbaru & Rencana Kedatangan" icon={<ClockCounterClockwise weight="fill" size={16} style={{verticalAlign:"-0.15em"}}/>} defaultOpen={!isMobile} C={C}>
      <div className="dashboard-overview__activity">
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          <div style={sty.card}>
            <h3 style={{fontSize:13,fontWeight:700,marginBottom:10}}>Transaksi Terbaru</h3>
            {txns.length===0 && <div style={{textAlign:"center",padding:"16px 0",color:C.muted,fontSize:12}}>Belum ada transaksi.</div>}
            {txns.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,6).map(t=>{
              const r = summarizeTxnDashboard(t, stocks, lokasiList);
              return (
                <div key={t.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700}}>{r.noTugLabel}</div>
                      <div style={{fontSize:12,color:C.text,marginTop:1}}>{r.pekerjaan}</div>
                    </div>
                    <span style={sty.statusBadge(t.status)}>{t.status}</span>
                  </div>
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>
                    <CalendarBlank weight="fill" size={12} style={{verticalAlign:"-0.15em"}}/> {r.tanggal} • <MapPin weight="fill" size={12} style={{verticalAlign:"-0.15em"}}/> {r.lokasiLabel} • <Buildings weight="fill" size={12} style={{verticalAlign:"-0.15em"}}/> {r.pihakLabel}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div><RencanaWidget rencanaKedatanganList={rencanaKedatanganList} C={C} sty={sty} setTab={setTab}/></div>
      </div>
      </CollapsibleSection>
      <CollapsibleSection id={isMobile ? "default-mobile-analitik" : "analitik"} title="Analitik & Grafik" icon={<ChartLineUp weight="fill" size={16} style={{verticalAlign:"-0.15em"}}/>} defaultOpen={!isMobile} C={C}>
      <DashboardAnalitikSection txns={txns} stocks={stocks} katalogList={katalogList} topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode} C={C} sty={sty}/>
      </CollapsibleSection>

      {/* ── POPUP RINGKASAN KPI ── */}
      {dashModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}} onClick={()=>setDashModal(null)}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{fontSize:15,fontWeight:800}}>
                {dashModal==="totalItem"&&<><Package weight="fill" size={16} style={{verticalAlign:"-0.15em",marginRight:4}}/>Ringkasan Total Item</>}
                {dashModal==="nilai"&&<><Money weight="fill" size={16} style={{verticalAlign:"-0.15em",marginRight:4}}/>Ringkasan Nilai Inventory</>}
                {dashModal==="kritis"&&<><Warning weight="fill" size={16} style={{verticalAlign:"-0.15em",marginRight:4}}/>Material Stok Kritis</>}
                {dashModal==="tindakan"&&<><Hourglass weight="fill" size={16} style={{verticalAlign:"-0.15em",marginRight:4}}/>Butuh Tindakan Anda</>}
              </h3>
              <button style={{background:"transparent",border:"none",fontSize:18,cursor:"pointer",color:C.muted,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setDashModal(null)}>✕</button>
            </div>

            {(dashModal==="totalItem"||dashModal==="nilai") && (
              <div>
                {jenisBreakdown.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data stok.</div>}
                {jenisBreakdown.map(r=>(
                  <div key={r.jenis} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:600}}>{r.jenis}</div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{dashModal==="nilai"?fmtRp(r.nilai):`${r.count} item`}</div>
                      <div style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtNum(r.qty)} qty total</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dashModal==="kritis" && (
              <div>
                {lowStocks.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}><CheckCircle weight="fill" size={14} color={C.green} style={{verticalAlign:"-0.15em",marginRight:4}}/>Tidak ada material kritis saat ini.</div>}
                {lowStocks.map(s=>(
                  <div key={s.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                      <div style={{fontSize:12,color:C.muted}}><MapPin weight="fill" size={12} style={{verticalAlign:"-0.15em"}}/> {s.lokasi||"-"}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#dc2626",fontVariantNumeric:"tabular-nums"}}>{fmtNum(s.qty)} / min {fmtNum(s.minQty)}</div>
                      <div style={{fontSize:12,color:C.muted}}>{s.unit}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dashModal==="tindakan" && (
              <div>
                {myPendingApprovals.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}><CheckCircle weight="fill" size={14} color={C.green} style={{verticalAlign:"-0.15em",marginRight:4}}/>Tidak ada yang menunggu tindakan Anda.</div>}
                {myPendingApprovals.map(t=>{
                  const r = summarizeTxnDashboard(t, stocks, lokasiList);
                  return (
                    <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600}}>{r.noTugLabel}</div>
                        <div style={{fontSize:12,color:C.muted}}>{r.pekerjaan}</div>
                      </div>
                      <button style={sty.btn("primary","sm")} onClick={()=>{setDashModal(null);setTab("approval");}}>Review</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
