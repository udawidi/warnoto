// Komponen KPISaldoCards — dipindah dari App.jsx (refactor Fase 4d).
import { fmtRp } from "../lib/utils.js";
import { Circle } from "@phosphor-icons/react";

export function KPISaldoCards({ stocks, C, sty }) {
  const nilaiCadang         = stocks.filter(s=>s.jenisBarang==="Cadang").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaan     = stocks.filter(s=>s.jenisBarang==="Persediaan").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaanBursa= stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPreMemory      = stocks.filter(s=>s.jenisBarang==="Pre Memory").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);

  const cards = [
    { label:"Saldo Material Cadang",          nilai:nilaiCadang,          count:stocks.filter(s=>s.jenisBarang==="Cadang").length,          color:"#dc2626", bg:"#fff5f5" },
    { label:"Saldo Material Persediaan",       nilai:nilaiPersediaan,      count:stocks.filter(s=>s.jenisBarang==="Persediaan").length,       color:"#16a34a", bg:"#f0fdf4" },
    { label:"Saldo Persediaan Bursa",          nilai:nilaiPersediaanBursa, count:stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").length, color:"#ea580c", bg:"#fff7ed" },
    { label:"Saldo Pre Memory",                nilai:nilaiPreMemory,       count:stocks.filter(s=>s.jenisBarang==="Pre Memory").length,       color:"#1d4ed8", bg:"#eff6ff" },
  ];

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:20}}>
      {cards.map((c,i)=>(
        <div key={i} style={{...sty.card,borderLeft:`4px solid ${c.color}`,background:c.bg,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:3,lineHeight:1.3}}>{c.label}</div>
              <div style={{fontSize:15,fontWeight:900,color:c.color}}>{fmtRp(c.nilai)}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{c.count} item aktif</div>
            </div>
            <div style={{marginLeft:6,flexShrink:0,display:"flex",alignItems:"center"}}><Circle weight="fill" size={18} color={c.color}/></div>
          </div>
        </div>
      ))}
    </div>
  );
}
