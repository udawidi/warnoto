// Komponen AttbDashboardSummary — dipindah dari App.jsx (refactor Fase 4e).
import { getUserUptScope } from "../lib/roles.js";
import { fmtRp } from "../lib/utils.js";
import { ATTB_STAGES, attbStageIndex } from "../lib/attb.js";
import { FolderOpen, Toolbox } from "@phosphor-icons/react";

// Ringkasan ATTB untuk Dashboard — fokus data yang dilihat manajemen: nilai aset yang
// akan dihapusbukukan, estimasi nilai lelang (recovery), sebaran tahap pipeline, item
// yang tertahan (bottleneck), dan inflow material bongkaran dari TUG-10.
export function AttbDashboardSummary({ attbList = [], bongkaranPool = [], C, sty, setTab, currentUser, uptList }) {
  const myUpt = getUserUptScope(currentUser, uptList);
  const isMSB = currentUser?.role === "MSB" || currentUser?.role === "Manager UIT";
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

  // Rincian per UPT — hanya untuk viewer nasional/UIT saat scope-nya memang lintas-UPT
  const uptGroups = {};
  if (isMSB) {
    for (const a of scoped) {
      const key = a.upt || "(tanpa UPT)";
      if (!uptGroups[key]) uptGroups[key] = { upt: key, count: 0, nilaiBuku: 0, estimasiLelang: 0, tertahan: 0 };
      const g = uptGroups[key];
      g.count++;
      g.nilaiBuku += num(a.nilaiBuku);
      g.estimasiLelang += num(a.estimasiNilaiTaksiran || a.nilaiTaksiranKJPP);
      if (a.lanjutBelumLanjut) g.tertahan++;
    }
  }
  const perUpt = Object.values(uptGroups).sort((a,b)=>b.nilaiBuku-a.nilaiBuku);
  const showPerUpt = isMSB && perUpt.length > 1;

  return (
    <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${ditahan?"#f59e0b":C.accent}`,cursor:"pointer"}} onClick={()=>setTab("attb")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:13,fontWeight:900}}><FolderOpen weight="fill" size={14} style={{verticalAlign:"-0.15em",marginRight:5}}/>Ringkasan ATTB — Penghapusan Aset</div>
          <div style={{fontSize:12,color:C.muted}}>Scope: <b>{scopeLabel}</b> — nilai aset, progres pipeline &amp; item tertahan.</div>
        </div>
        <button style={sty.btn("ghost","sm")} onClick={(e)=>{e.stopPropagation(); setTab("attb");}}>Buka Menu</button>
      </div>

      {/* KPI utama */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:12}}>
        {kpis.map(k=>(
          <div key={k.label} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius: 10,padding:10}}>
            <div style={{fontSize:12,color:C.muted,fontWeight:800,textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:k.val&&String(k.val).startsWith("Rp")?15:20,fontWeight:900,color:k.color}}>{k.val}</div>
            <div style={{fontSize:12,color:C.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Pipeline funnel — sebaran item per tahap + inflow bongkaran TUG-10 */}
      <div style={{display:"flex",alignItems:"stretch",gap:6,flexWrap:"wrap"}}>
        <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",justifyContent:"center",padding:"8px 10px",borderRadius: 10,border:`1px dashed #cbd5e1`,background:"#f8fafc",minWidth:96}}>
          <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase"}}><Toolbox weight="fill" size={12} style={{verticalAlign:"-0.15em",marginRight:4}}/>Bongkaran</div>
          <div style={{fontSize:17,fontWeight:900,color: "#64748b"}}>{bongkaranBelum}</div>
          <div style={{fontSize:12,color:C.muted}}>belum diusulkan</div>
        </div>
        {stageCounts.map((s,i)=>(
          <div key={s.code} style={{flex:1,minWidth:90,display:"flex",flexDirection:"column",gap:4,padding:"8px 8px",borderRadius: 10,border:`1px solid ${C.border}`,background:"white"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:16,height:16,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,background:stageColor(s.code)+"22",color:stageColor(s.code)}}>{i+1}</span>
              <span style={{fontSize:15,fontWeight:900,color:stageColor(s.code)}}>{s.count}</span>
            </div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.2,minHeight:22}}>{s.label}</div>
            <div style={{height:4,borderRadius: 10,background:"#eef2f7",overflow:"hidden"}}><div style={{height:"100%",width:`${(s.count/maxStage)*100}%`,background:stageColor(s.code)}}/></div>
          </div>
        ))}
      </div>

      {/* Rincian per UPT — breakdown untuk viewer nasional/UIT saat scope mencakup >1 UPT */}
      {showPerUpt && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Rincian per UPT</div>
          {perUpt.map(u=>(
            <div key={u.upt} style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,padding:"8px 0",borderTop:`1px solid ${C.border}`}}>
              <div style={{fontSize:13,fontWeight:900,flex:"1 1 110px"}}>{u.upt}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(88px,1fr))",gap:8,flex:"3 1 260px"}}>
                <div><div style={{fontSize:12,color:C.muted}}>Item</div><div style={{fontSize:13,fontWeight:800}}>{u.count}</div></div>
                <div><div style={{fontSize:12,color:C.muted}}>Nilai Buku</div><div style={{fontSize:13,fontWeight:800}}>{fmtRp(u.nilaiBuku)}</div></div>
                <div><div style={{fontSize:12,color:C.muted}}>Est. Lelang</div><div style={{fontSize:13,fontWeight:800}}>{fmtRp(u.estimasiLelang)}</div></div>
                <div><div style={{fontSize:12,color:C.muted}}>Tertahan</div><div style={{fontSize:13,fontWeight:800,color:u.tertahan?"#f59e0b":C.muted}}>{u.tertahan}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
