// Komponen DashboardManager — dipindah dari App.jsx (refactor Fase 4f).
import { fmtRp } from "../lib/utils.js";
import { fmtNum, getKritisAgg } from "../lib/ragShared.mjs";
import { KPISaldoCards } from "./KPISaldoCards.jsx";
import { CollapsibleSection } from "./CollapsibleSection.jsx";
import { PendingWidget } from "./PendingWidget.jsx";
import { RencanaWidget } from "./RencanaWidget.jsx";
import { HeavyEquipmentDashboardSummary } from "./HeavyEquipmentDashboardSummary.jsx";
import { AttbDashboardSummary } from "./AttbDashboardSummary.jsx";
import { DashboardAnalitikSection } from "./DashboardAnalitikSection.jsx";

export function DashboardManager({ stocks, txns, katalogList, uptList, rencanaKedatanganList, myPendingApprovals, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, heavyEquipmentList, heavyEquipmentLoans, currentUser, attbList, attbBongkaranPool }) {
  const nilaiTotal = stocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiCadang = stocks.filter(s=>s.jenisBarang==="Cadang").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaan = stocks.filter(s=>s.jenisBarang==="Persediaan").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaanBursa = stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPreMemory = stocks.filter(s=>s.jenisBarang==="Pre Memory").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const stokKritis = getKritisAgg(stocks);
  const terlambat = rencanaKedatanganList.flatMap(r=>(r.items||[]).map(i=>({...i,tanggalSerahTerima:r.tanggalSerahTerima}))).filter(i=>i.tanggalSerahTerima && new Date(i.tanggalSerahTerima).getTime()<Date.now());
  const txnBulanIni = txns.filter(t=>{const d=new Date(t.createdAt); const now=new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});

  return (
    <div>
      {/* Header Eksekutif */}
      <div style={{background:"linear-gradient(135deg,#003087,#0098da)",borderRadius:12,padding:"20px 24px",marginBottom:20,color:"white"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:11,opacity:0.7,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>PT PLN (Persero) UIT-JBM</div>
            <div style={{fontSize:20,fontWeight:900}}>Dashboard Eksekutif Material</div>
            <div style={{fontSize:12,opacity:0.8,marginTop:4}}>{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,opacity:0.7,marginBottom:4}}>Total Nilai Inventori (UPT Surabaya)</div>
            <div style={{fontSize:26,fontWeight:900,marginBottom:8}}>{fmtRp(nilaiTotal)}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {[
                {label:"Cadang",val:nilaiCadang,color:"#fca5a5"},
                {label:"Persediaan",val:nilaiPersediaan,color:"#86efac"},
                {label:"Bursa",val:nilaiPersediaanBursa,color:"#fdba74"},
                {label:"Pre Memory",val:nilaiPreMemory,color:"#93c5fd"},
              ].map((b,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.15)",borderRadius:6,padding:"4px 8px",textAlign:"right"}}>
                  <div style={{fontSize:9,opacity:0.8}}>{b.label}</div>
                  <div style={{fontSize:11,fontWeight:700,color:b.color}}>{fmtRp(b.val)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
        {[
          {label:"Total Item Stok",val:stocks.length,icon:"📦",color:C.accent},
          {label:"Stok Kritis",val:stokKritis.length,icon:"🔴",color:stokKritis.length>0?"#dc2626":"#16a34a"},
          {label:"TUG Pending",val:myPendingApprovals.length,icon:"⏳",color:myPendingApprovals.length>0?"#f59e0b":"#16a34a"},
          {label:"Rencana Terlambat",val:terlambat.length,icon:"⚠️",color:terlambat.length>0?"#dc2626":"#16a34a"},
          {label:"Transaksi Bulan Ini",val:txnBulanIni.length,icon:"📋",color:"#7c3aed"},
        ].map((s,i)=>(
          <div key={i} style={{...sty.card,borderTop:`3px solid ${s.color}`,padding:12}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:18,fontWeight:900,color:s.color}}>{s.val}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <KPISaldoCards stocks={stocks} C={C} sty={sty}/>
      {(heavyEquipmentList?.length>0 || heavyEquipmentLoans?.length>0) && (
        <CollapsibleSection id="alatberat" title="Alat Berat" icon="🏗️" C={C}>
          <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
        </CollapsibleSection>
      )}
      {(attbList?.length>0 || attbBongkaranPool?.length>0) && (
        <CollapsibleSection id="attb" title="Aset ATTB (Penghapusan)" icon="🏢" C={C}>
          <AttbDashboardSummary attbList={attbList} bongkaranPool={attbBongkaranPool} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
        </CollapsibleSection>
      )}

      {/* Tabel per UPT */}
      <div style={{...sty.card,marginBottom:20}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>📊 Ringkasan per UPT — UIT JBM</h3>
        <div style={{overflowX:"auto"}}>
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
                const uptKritis = getKritisAgg(uptStocks).length;
                const uptTxn = isSurabaya ? txnBulanIni.length : 0;
                return (
                  <tr key={upt.id} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                    <td style={{padding:"10px 10px",fontWeight:700}}>{upt.nama}</td>
                    <td style={{padding:"10px 10px"}}>{isSurabaya?stocks.length:"—"}</td>
                    <td style={{padding:"10px 10px"}}>{isSurabaya?fmtRp(uptNilai):"—"}</td>
                    <td style={{padding:"10px 10px",color:uptKritis>0?"#dc2626":C.muted}}>{isSurabaya?uptKritis:"—"}</td>
                    <td style={{padding:"10px 10px"}}>{isSurabaya?`${uptTxn} TUG`:"—"}</td>
                    <td style={{padding:"10px 10px"}}>
                      {isSurabaya
                        ? <span style={{padding:"3px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"#dcfce7",color:"#166534"}}>🟢 Aktif</span>
                        : <span style={{padding:"3px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"#f3f4f6",color:"#6b7280"}}>⚪ Belum terhubung</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{fontSize:10,color:C.muted,marginTop:8}}>* Data real hanya tersedia untuk UPT Surabaya (Fase 1). UPT lain akan terhubung di Fase 2.</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          {/* Compliance — TUG pending lama */}
          {(()=>{
            const overdue = txns.filter(t=>t.status==="PENDING"&&(Date.now()-t.createdAt)>2*24*60*60*1000);
            if (overdue.length===0) return null;
            return (
              <div style={{...sty.card,borderLeft:`4px solid #dc2626`}}>
                <h3 style={{fontSize:13,fontWeight:700,color:"#dc2626",marginBottom:10}}>🚨 TUG Pending &gt; 2 Hari ({overdue.length})</h3>
                {overdue.slice(0,4).map((t,i)=>{
                  const days = Math.floor((Date.now()-t.createdAt)/(24*60*60*1000));
                  return (
                    <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
                      <div><div style={{fontSize:11,fontWeight:600}}>{t.namaPekerjaan}</div><div style={{fontSize:10,color:C.muted}}>{t.docType.replace("TUG","TUG-")}</div></div>
                      <div style={{fontSize:11,fontWeight:700,color:"#dc2626"}}>{days} hari</div>
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
