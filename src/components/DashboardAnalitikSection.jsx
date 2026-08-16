// Komponen DashboardAnalitikSection — dipindah dari App.jsx (refactor Fase 4f).
import { fmtNum } from "../lib/ragShared.mjs";
import { katalogSapLabel, katalogSapStatus } from "../lib/sap.js";
import { getTopPemakaian, getTopStokTerbanyak, getMaterialAkanHabis } from "../lib/analytics.js";
import { ChartBar, Fire, Package, Warning, CheckCircle } from "@phosphor-icons/react";

export function DashboardAnalitikSection({ txns, stocks, katalogList, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty }) {
  const topPemakaian = getTopPemakaian(txns, stocks, katalogList, pemakaianMode, topN);
  const topStok = getTopStokTerbanyak(stocks, katalogList, topN);
  const akanHabis = getMaterialAkanHabis(stocks, katalogList, txns, topN);

  // Baris seragam untuk ketiga widget: [rank] nama ...... nilai kanan, dipisah garis rambut (bukan box per baris).
  function MaterialRow({ rank, label, sub, badge, value, valueColor, extra, isLast }) {
    return (
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 0",borderBottom:isLast?"none":`1px solid ${C.border}`}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{rank}. {label}</div>
          {(sub || badge) && <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2,fontSize:12,color:C.muted,overflow:"hidden"}}>
            {sub && <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{sub}</span>}
            {badge}
          </div>}
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:700,color:valueColor||C.text}}>{value}</div>
          {extra && <div style={{fontSize:12,color:C.muted,marginTop:1}}>{extra}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-analytics">
      <div className="dashboard-analytics__heading">
        <h2 style={{fontSize:15,fontWeight:800}}><ChartBar weight="fill" size={18} style={{verticalAlign:"-0.15em",marginRight:5}}/>Analitik Material</h2>
        <div className="dashboard-analytics__limit">
          <span style={{fontSize:12,color:C.muted}}>Tampilkan</span>
          <select style={{...sty.select,width:80,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,fontSize:12}} value={topN} onChange={e=>setTopN(Number(e.target.value))}>
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
          </select>
        </div>
      </div>

      <div className="dashboard-analytics-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
        {/* Widget 1 — Paling Sering Dipakai */}
          <div className="dashboard-analytics-card" style={{...sty.card}}>
          <div className="dashboard-analytics-card__heading">
            <div style={{fontWeight:700,fontSize:13}}><Fire weight="fill" size={15} style={{verticalAlign:"-0.15em",marginRight:4}}/>Paling Sering Dipakai</div>
            <div className="dashboard-analytics-toggle">
              {["frekuensi","qty"].map(m=>(
                <button key={m} style={{padding:"3px 8px",borderRadius: 10,border:`1px solid ${pemakaianMode===m?C.accent:C.border}`,background:pemakaianMode===m?C.accent:"white",color:pemakaianMode===m?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:pemakaianMode===m?700:400}} onClick={()=>setPemakaianMode(m)}>
                  {m==="frekuensi"?"Frekuensi":"Qty Keluar"}
                </button>
              ))}
            </div>
          </div>
          {topPemakaian.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data pemakaian</div>
            : topPemakaian.map((item,i)=>(
                <MaterialRow key={item.katalogId}
                  rank={i+1}
                  label={item.nama}
                  sub={`${item.katalog} • ${katalogSapLabel(item)}`}
                  value={fmtNum(pemakaianMode==="frekuensi"?item.frekuensi:item.totalQty)}
                  extra={pemakaianMode==="frekuensi"?`${item.frekuensi}x bon`:item.satuan}
                  isLast={i===topPemakaian.length-1}
                />
              ))
          }
        </div>

        {/* Widget 2 — Stok Terbanyak */}
        <div className="dashboard-analytics-card" style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}><Package weight="fill" size={15} style={{verticalAlign:"-0.15em",marginRight:4}}/>Stok Terbanyak di Gudang</div>
          {topStok.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data stok</div>
            : topStok.map((item,i)=>(
                <MaterialRow key={item.katalogId}
                  rank={i+1}
                  label={item.nama}
                  sub={katalogSapStatus(item)}
                  badge={<span style={sty.jenisBadge(item.jenisBarang)}>{item.jenisBarang}</span>}
                  value={fmtNum(item.totalQty)}
                  extra={item.satuan}
                  isLast={i===topStok.length-1}
                />
              ))
          }
        </div>

        {/* Widget 3 — Akan Habis */}
        <div className="dashboard-analytics-card" style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}><Warning weight="fill" size={15} style={{verticalAlign:"-0.15em",marginRight:4}}/>Material Akan Habis</div>
          {akanHabis.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}><CheckCircle weight="fill" size={14} color={C.green} style={{verticalAlign:"-0.15em",marginRight:4}}/>Semua stok dalam kondisi aman</div>
            : akanHabis.map((item,i)=>{
                const statusColor = item.isKritis?"#dc2626":item.estimasiHari<=30?"#d97706":"#ea580c";
                const hariLabel = item.estimasiHari===Infinity?"Tidak ada data pakai":item.estimasiHari>365?">1 tahun":`~${item.estimasiHari} hari`;
                const sub = item.katalog + (item.avgPerBulan>0?` • ±${item.avgPerBulan.toFixed(1)}/bln`:"");
                return (
                  <MaterialRow key={item.katalogId}
                    rank={i+1}
                    label={item.nama}
                    sub={sub}
                    value={hariLabel}
                    valueColor={statusColor}
                    extra={`Stok ${fmtNum(item.totalQty)} ${item.satuan}`}
                    isLast={i===akanHabis.length-1}
                  />
                );
              })
          }
        </div>
      </div>
    </div>
  );
}
