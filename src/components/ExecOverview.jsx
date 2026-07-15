// Komponen ExecOverview — dipindah dari App.jsx (refactor Fase 4d).
import { useState } from "react";
import { fmtNum } from "../lib/ragShared.mjs";
import { fmtRp } from "../lib/utils.js";

// Ringkasan eksekutif Dashboard (tab "Ringkasan") — status + 4 KPI + panel "Butuh Perhatian".
// Prinsip manage-by-exception: sorot yang bermasalah/menunggu keputusan; detail via tab lain.
export function ExecOverview({ totalVal, kritisMaterials=[], forecastSoon=[], approvalCount, stockCountPendingCount, attbActionCount, akurasi, maturity, setTab, setOpnameSubTab, C, sty, isMobile }) {
  const [openIdx, setOpenIdx] = useState(null);
  const kritisCount = (kritisMaterials||[]).length;
  const attention = [
    approvalCount>0 && { icon:"✅", text:`${approvalCount} dokumen menunggu approval Anda`, go:()=>setTab("approval") },
    stockCountPendingCount>0 && { icon:"📊", text:`${stockCountPendingCount} temuan Stock Count menunggu keputusan`, go:()=>{ setTab("opname"); setOpnameSubTab && setOpnameSubTab("stockCount"); } },
    kritisCount>0 && { icon:"🔴", text:`${kritisCount} material stok kritis sekarang (≤ minimum)`,
      items:(kritisMaterials||[]).slice(0,8).map(m=>`${m.name} — total ${fmtNum(m.qty)} ${m.unit||""} (min ${fmtNum(m.minQty)})`),
      more:Math.max(0,kritisCount-8), goLabel:"Buka Data Stok", go:()=>setTab("stock") },
    forecastSoon.length>0 && { icon:"📈", text:`${forecastSoon.length} material diprediksi habis ≤ 30 hari (forecast)`,
      items:forecastSoon.slice(0,8).map(r=>`${r.nama} — ~${r.estimasiHari} hari lagi (sisa ${fmtNum(r.totalQty)} ${r.satuan||""})`),
      more:Math.max(0,forecastSoon.length-8), goLabel:"Buka Forecast Stok", go:()=>setTab("forecastStok") },
    attbActionCount>0 && { icon:"🗂️", text:`${attbActionCount} aset ATTB butuh tindak lanjut`, go:()=>setTab("attb") },
  ].filter(Boolean);
  const kpis = [
    { icon:"💰", label:"Nilai Inventory", val:fmtRp(totalVal), color:C.green },
    { icon:"🔴", label:"Material Kritis", val:kritisCount, color:kritisCount>0?C.red:C.green },
    { icon:"🎯", label:"Akurasi SAP vs Fisik", val:akurasi!=null?akurasi+"%":"—", color:akurasi==null?C.muted:akurasi>=90?C.green:akurasi>=70?C.yellow:C.red },
    { icon:"⏳", label:"Butuh Tindakan", val:attention.length, color:attention.length?C.yellow:C.green },
  ];
  return (
    <div className="exec-overview">
      <div className="exec-overview__kpis">
        {kpis.map(k=>(
          <div key={k.label} className="exec-kpi">
            <div className="exec-kpi__icon">{k.icon}</div>
            <div className="exec-kpi__copy">
              <strong style={{color:k.color}}>{k.val}</strong>
              <span>{k.label}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="exec-attention">
        <div className="exec-attention__header"><span>Prioritas operasional</span><strong>{attention.length} perlu ditinjau</strong></div>
        {attention.length===0 ? (
          <div className="exec-attention__empty">Tidak ada pekerjaan yang menunggu keputusan Anda saat ini.</div>
        ) : (
          <div className="exec-attention__list">
            {attention.map((a,i)=>{
              const hasDetail = !!a.items && a.items.length>0;
              const isOpen = openIdx===i;
              return (
              <div key={i} className="exec-attention__item">
                <button onClick={()=> hasDetail ? setOpenIdx(isOpen?null:i) : a.go()}>
                  <span className="exec-attention__icon">{a.icon}</span>
                  <span className="exec-attention__text">{a.text}</span>
                  <span className="exec-attention__arrow">{hasDetail?(isOpen?"−":"+"):"→"}</span>
                </button>
                {hasDetail && isOpen && (
                  <div className="exec-attention__detail">
                    {a.items.map((t,j)=>(
                      <div key={j} style={{fontSize:12,color:C.text,padding:"5px 0",borderTop:`1px solid ${C.border}`}}>• {t}</div>
                    ))}
                    {a.more>0 && <div style={{fontSize:12,color:C.muted,padding:"6px 0 2px"}}>+{a.more} material lainnya…</div>}
                    <button onClick={a.go} style={{...sty.btn("primary","sm"),marginTop:10}}>{a.goLabel} →</button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
