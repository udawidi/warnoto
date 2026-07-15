// Komponen DashboardAnalitikSection — dipindah dari App.jsx (refactor Fase 4f).
import { fmtNum, getSAPLabel } from "../lib/ragShared.mjs";
import { getSAPStatus, getSAPBadgeStyle } from "../lib/sap.js";
import { getTopPemakaian, getTopStokTerbanyak, getMaterialAkanHabis } from "../lib/analytics.js";

export function DashboardAnalitikSection({ txns, stocks, katalogList, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty }) {
  const topPemakaian = getTopPemakaian(txns, stocks, katalogList, pemakaianMode, topN);
  const topStok = getTopStokTerbanyak(stocks, katalogList, topN);
  const akanHabis = getMaterialAkanHabis(stocks, katalogList, txns, topN);

  const maxPemakaian = topPemakaian[0]?.[pemakaianMode==="frekuensi"?"frekuensi":"totalQty"] || 1;
  const maxStok = topStok[0]?.totalQty || 1;

  function BarRow({ label, sub, value, maxVal, badge, extra, color="#3b82f6" }) {
    const pct = Math.round((value/maxVal)*100);
    return (
      <div style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
            {sub && <div style={{fontSize:12,color:C.muted}}>{sub}</div>}
          </div>
          <div style={{textAlign:"right",marginLeft:8,flexShrink:0}}>
            <div style={{fontSize:12,fontWeight:700,color}}>{fmtNum(value)}</div>
            {extra && <div style={{fontSize:12,color:C.muted}}>{extra}</div>}
          </div>
        </div>
        <div style={{background:"#f1f5f9",borderRadius:4,height:6}}>
          <div style={{width:`${pct}%`,height:6,borderRadius:4,background:color,transition:"width 0.3s"}}/>
        </div>
        {badge && <span style={{fontSize:12,padding:"1px 5px",borderRadius:10,background:color+"22",color,fontWeight:700,marginTop:2,display:"inline-block"}}>{badge}</span>}
      </div>
    );
  }

  return (
    <div style={{marginTop:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h2 style={{fontSize:16,fontWeight:800}}>📊 Analitik Material</h2>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:12,color:C.muted}}>Tampilkan</span>
          <select style={{...sty.select,width:80,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,fontSize:12}} value={topN} onChange={e=>setTopN(Number(e.target.value))}>
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
          </select>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
        {/* Widget 1 — Paling Sering Dipakai */}
        <div style={{...sty.card}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:13}}>🔥 Paling Sering Dipakai</div>
            <div style={{display:"flex",gap:4}}>
              {["frekuensi","qty"].map(m=>(
                <button key={m} style={{padding:"3px 8px",borderRadius:20,border:`1px solid ${pemakaianMode===m?C.accent:C.border}`,background:pemakaianMode===m?C.accent:"white",color:pemakaianMode===m?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:pemakaianMode===m?700:400}} onClick={()=>setPemakaianMode(m)}>
                  {m==="frekuensi"?"Frekuensi":"Qty Keluar"}
                </button>
              ))}
            </div>
          </div>
          {topPemakaian.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data pemakaian</div>
            : topPemakaian.map((item,i)=>(
                <BarRow key={item.katalogId}
                  label={`${i+1}. ${item.nama}`}
                  sub={`${item.katalog} • ${getSAPLabel(item.katalog)}`}
                  value={pemakaianMode==="frekuensi"?item.frekuensi:item.totalQty}
                  maxVal={maxPemakaian}
                  extra={pemakaianMode==="frekuensi"?`${item.frekuensi}x bon`:item.satuan}
                  color="#f59e0b"
                />
              ))
          }
        </div>

        {/* Widget 2 — Stok Terbanyak */}
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📦 Stok Terbanyak di Gudang</div>
          {topStok.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data stok</div>
            : topStok.map((item,i)=>{
                const sapBs = getSAPBadgeStyle(item.katalog);
                return (
                  <BarRow key={item.katalogId}
                    label={`${i+1}. ${item.nama}`}
                    sub={<span style={{padding:"1px 5px",borderRadius:10,fontSize:12,fontWeight:700,background:sapBs.bg,color:sapBs.fg}}>{getSAPStatus(item.katalog)}</span>}
                    value={item.totalQty}
                    maxVal={maxStok}
                    extra={`${fmtNum(item.totalQty)} ${item.satuan}`}
                    badge={item.jenisBarang}
                    color={C.accent}
                  />
                );
              })
          }
        </div>

        {/* Widget 3 — Akan Habis */}
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>⚠️ Material Akan Habis</div>
          {akanHabis.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>✅ Semua stok dalam kondisi aman</div>
            : akanHabis.map((item,i)=>{
                const badgeColor = item.isKritis?"#dc2626":item.estimasiHari<=30?"#d97706":"#ea580c";
                const hariLabel = item.estimasiHari===Infinity?"Tidak ada data pakai":item.estimasiHari>365?">1 tahun":`~${item.estimasiHari} hari`;
                return (
                  <div key={item.katalogId} style={{marginBottom:10,padding:"8px 10px",borderRadius:8,border:`1px solid ${badgeColor}22`,background:`${badgeColor}0a`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.nama}</div>
                        <div style={{fontSize:12,color:C.muted}}>{item.katalog}</div>
                      </div>
                      <span style={{fontSize:12,fontWeight:700,color:badgeColor,marginLeft:6,flexShrink:0}}>{item.badge}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:12}}>
                      <span style={{color:C.muted}}>Stok: <b style={{color:"#111"}}>{fmtNum(item.totalQty)}</b> {item.satuan}</span>
                      <span style={{color:badgeColor,fontWeight:600}}>{hariLabel}</span>
                    </div>
                    {item.avgPerBulan>0 && <div style={{fontSize:12,color:C.muted}}>Rata-rata pakai: {item.avgPerBulan.toFixed(1)}/bulan</div>}
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}
