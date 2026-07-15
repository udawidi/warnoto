// Komponen DashboardAsman — dipindah dari App.jsx (refactor Fase 4f).
import { fmtRp } from "../lib/utils.js";
import { fmtNum, getKritisAgg } from "../lib/ragShared.mjs";
import { getMaterialAkanHabis } from "../lib/analytics.js";
import { KPISaldoCards } from "./KPISaldoCards.jsx";
import { PendingWidget } from "./PendingWidget.jsx";
import { RencanaWidget } from "./RencanaWidget.jsx";
import { HeavyEquipmentDashboardSummary } from "./HeavyEquipmentDashboardSummary.jsx";
import { AttbDashboardSummary } from "./AttbDashboardSummary.jsx";
import { DashboardAnalitikSection } from "./DashboardAnalitikSection.jsx";

export function DashboardAsman({ stocks, txns, katalogList, rencanaKedatanganList, myPendingApprovals, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, heavyEquipmentList, heavyEquipmentLoans, currentUser, attbList, attbBongkaranPool }) {
  const nilaiTotal = stocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const stokKritis = getKritisAgg(stocks);
  const akanHabis = getMaterialAkanHabis(stocks, katalogList, txns, 5);
  const txnBulanIni = txns.filter(t=>{const d=new Date(t.createdAt); const now=new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});

  return (
    <div>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <p style={{color:C.muted,fontSize:13}}>UPT Surabaya • {new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
          </div>
          <span style={{padding:"4px 12px",borderRadius:20,background:"#dbeafe",color:"#1d4ed8",fontSize:12,fontWeight:700}}>UPT Surabaya</span>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
        {[
          {label:"Total Nilai Inventori",val:fmtRp(nilaiTotal),icon:"💰",color:"#16a34a"},
          {label:"Total Item Stok",val:stocks.length,icon:"📦",color:C.accent},
          {label:"Stok Kritis",val:stokKritis.length,icon:"🔴",color:stokKritis.length>0?"#dc2626":"#16a34a"},
          {label:"Transaksi Bulan Ini",val:txnBulanIni.length,icon:"📋",color:"#7c3aed"},
          {label:"Butuh Approval Saya",val:myPendingApprovals.length,icon:"⏳",color:myPendingApprovals.length>0?"#f59e0b":"#16a34a"},
        ].map((s,i)=>(
          <div key={i} style={{...sty.card,borderTop:`3px solid ${s.color}`,padding:12}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:16,fontWeight:900,color:s.color}}>{s.val}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <KPISaldoCards stocks={stocks} C={C} sty={sty}/>

      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
          <AttbDashboardSummary attbList={attbList} bongkaranPool={attbBongkaranPool} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
          {/* Material Kritis */}
          {stokKritis.length>0 && (
            <div style={{...sty.card,borderLeft:`4px solid #dc2626`,marginBottom:16}}>
              <h3 style={{fontSize:13,fontWeight:700,color:"#dc2626",marginBottom:10}}>🔴 Material Stok Kritis ({stokKritis.length})</h3>
              {stokKritis.slice(0,5).map((s,i)=>(
                <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
                  <div><div style={{fontSize:12,fontWeight:600}}>{s.name}</div><div style={{fontSize:12,color:C.muted}}>{s.katalog}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,color:"#dc2626"}}>{fmtNum(s.qty)} {s.unit}</div><div style={{fontSize:12,color:C.muted}}>min: {fmtNum(s.minQty)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <RencanaWidget rencanaKedatanganList={rencanaKedatanganList} C={C} sty={sty} setTab={setTab}/>
          {/* Material Akan Habis */}
          {akanHabis.length>0 && (
            <div style={{...sty.card}}>
              <h3 style={{fontSize:13,fontWeight:700,marginBottom:10}}>⚠️ Akan Habis</h3>
              {akanHabis.slice(0,4).map((item,i)=>(
                <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <div style={{fontSize:12,fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.nama}</div>
                    <span style={{fontSize:12,fontWeight:700,color:item.isKritis?"#dc2626":"#d97706",marginLeft:6}}>{item.badge}</span>
                  </div>
                  <div style={{fontSize:12,color:C.muted}}>{fmtNum(item.totalQty)} {item.satuan} • {item.estimasiHari===Infinity?"tidak ada data":`~${item.estimasiHari} hari`}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DashboardAnalitikSection txns={txns} stocks={stocks} katalogList={katalogList} topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode} C={C} sty={sty}/>
    </div>
  );
}
