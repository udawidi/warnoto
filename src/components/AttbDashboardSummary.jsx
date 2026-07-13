// Komponen AttbDashboardSummary — dipindah dari App.jsx (refactor Fase 4e).
import { UPT } from "../constants.js";
import { hasRole } from "../lib/roles.js";
import { fmtRp } from "../lib/utils.js";
import { ATTB_STAGES, attbStageIndex } from "../lib/attb.js";

// Ringkasan ATTB untuk Dashboard — fokus data yang dilihat manajemen: nilai aset yang
// akan dihapusbukukan, estimasi nilai lelang (recovery), sebaran tahap pipeline, item
// yang tertahan (bottleneck), dan inflow material bongkaran dari TUG-10.
export function AttbDashboardSummary({ attbList = [], bongkaranPool = [], C, sty, setTab, currentUser }) {
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = hasRole(currentUser, "MSB","Manager UIT");
  const scoped = isMSB ? attbList : attbList.filter(a=>a.upt===myUpt);
  const scopeLabel = isMSB ? "Semua UPT" : (myUpt || "UPT");
  if (attbList.length === 0 && bongkaranPool.length === 0) return null;

  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const nilaiPerolehan = scoped.reduce((a,x)=>a+num(x.nilaiPerolehan), 0);
  const nilaiBuku = scoped.reduce((a,x)=>a+num(x.nilaiBuku), 0);
  const estimasiLelang = scoped.reduce((a,x)=>a+num(x.estimasiNilaiTaksiran||x.nilaiTaksiranKJPP), 0);
  const ditahan = scoped.filter(a=>a.lanjutBelumLanjut).length;
  const menungguLelang = scoped.filter(a=>a.stage==="LELANG").length;
  const promotedKeys = new Set(attbList.map(a=>a.sourceTug10Key).filter(Boolean));
  const bongkaranBelum = bongkaranPool.filter(p=>!promotedKeys.has(p.key)).length;
  const stageCounts = ATTB_STAGES.map(s=>({ ...s, count: scoped.filter(a=>a.stage===s.code).length }));
  const maxStage = Math.max(1, ...stageCounts.map(s=>s.count));
  const stageColor = code => [C.accent,"#7c3aed","#0891b2","#ea580c",C.green][attbStageIndex(code)] || C.muted;

  const kpis = [
    {label:"Total Item", val:scoped.length, color:C.accent, sub:"aset dalam proses"},
    {label:"Nilai Perolehan", val:fmtRp(nilaiPerolehan), color:"#0891b2", sub:"total aset"},
    {label:"Nilai Buku", val:fmtRp(nilaiBuku), color:"#7c3aed", sub:"dihapusbukukan"},
    {label:"Estimasi Nilai Lelang", val:fmtRp(estimasiLelang), color:C.green, sub:"potensi recovery"},
    {label:"Tertahan", val:ditahan, color:ditahan?"#f59e0b":C.green, sub:"belum lanjut"},
    {label:"Menunggu Lelang", val:menungguLelang, color:menungguLelang?"#16a34a":C.muted, sub:"tahap akhir"},
  ];

  return (
    <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${ditahan?"#f59e0b":C.accent}`,cursor:"pointer"}} onClick={()=>setTab("attb")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:14,fontWeight:900}}>🗂️ Ringkasan ATTB — Penghapusan Aset</div>
          <div style={{fontSize:11,color:C.muted}}>Scope: <b>{scopeLabel}</b> — nilai aset, progres pipeline &amp; item tertahan.</div>
        </div>
        <button style={sty.btn("ghost","sm")} onClick={(e)=>{e.stopPropagation(); setTab("attb");}}>Buka Menu</button>
      </div>

      {/* KPI utama */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:12}}>
        {kpis.map(k=>(
          <div key={k.label} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:800,textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:k.val&&String(k.val).startsWith("Rp")?15:20,fontWeight:900,color:k.color}}>{k.val}</div>
            <div style={{fontSize:9,color:C.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Pipeline funnel — sebaran item per tahap + inflow bongkaran TUG-10 */}
      <div style={{display:"flex",alignItems:"stretch",gap:6,flexWrap:"wrap"}}>
        <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",justifyContent:"center",padding:"8px 10px",borderRadius:8,border:`1px dashed #cbd5e1`,background:"#f8fafc",minWidth:96}}>
          <div style={{fontSize:9,fontWeight:800,color:C.muted,textTransform:"uppercase"}}>🧰 Bongkaran</div>
          <div style={{fontSize:18,fontWeight:900,color:"#6b7280"}}>{bongkaranBelum}</div>
          <div style={{fontSize:9,color:C.muted}}>belum diusulkan</div>
        </div>
        {stageCounts.map((s,i)=>(
          <div key={s.code} style={{flex:1,minWidth:90,display:"flex",flexDirection:"column",gap:4,padding:"8px 8px",borderRadius:8,border:`1px solid ${C.border}`,background:"white"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:16,height:16,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,background:stageColor(s.code)+"22",color:stageColor(s.code)}}>{i+1}</span>
              <span style={{fontSize:16,fontWeight:900,color:stageColor(s.code)}}>{s.count}</span>
            </div>
            <div style={{fontSize:9,color:C.muted,lineHeight:1.2,minHeight:22}}>{s.label}</div>
            <div style={{height:4,borderRadius:3,background:"#eef2f7",overflow:"hidden"}}><div style={{height:"100%",width:`${(s.count/maxStage)*100}%`,background:stageColor(s.code)}}/></div>
          </div>
        ))}
      </div>
    </div>
  );
}
