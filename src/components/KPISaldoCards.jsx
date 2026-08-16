// Komponen KPISaldoCards — dipindah dari App.jsx (refactor Fase 4d).
import { fmtRp } from "../lib/utils.js";
import { Circle } from "@phosphor-icons/react";

export function KPISaldoCards({ stocks, C, sty }) {
  const nilaiCadang         = stocks.filter(s=>s.jenisBarang==="Cadang").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaan     = stocks.filter(s=>s.jenisBarang==="Persediaan").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaanBursa= stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPreMemory      = stocks.filter(s=>s.jenisBarang==="Pre Memory").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);

  const cards = [
    { label:"Saldo Material Cadang",          nilai:nilaiCadang,          count:stocks.filter(s=>s.jenisBarang==="Cadang").length,          color:"#dc2626" },
    { label:"Saldo Material Persediaan",       nilai:nilaiPersediaan,      count:stocks.filter(s=>s.jenisBarang==="Persediaan").length,       color:"#16a34a" },
    { label:"Saldo Persediaan Bursa",          nilai:nilaiPersediaanBursa, count:stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").length, color:"#ea580c" },
    { label:"Saldo Pre Memory",                nilai:nilaiPreMemory,       count:stocks.filter(s=>s.jenisBarang==="Pre Memory").length,       color:"#1d4ed8" },
  ];

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:20}}>
      {cards.map((c,i)=>(
        <div key={i} className="kpi-card" style={{"--kpi-color":c.color}}>
          <div className="kpi-card__icon" style={{"--kpi-tint":c.color+"1a"}}><Circle weight="fill" size={16}/></div>
          <div className="kpi-card__copy">
            <strong>{fmtRp(c.nilai)}</strong>
            <span>{c.label}</span>
            <small>{c.count} item aktif</small>
          </div>
        </div>
      ))}
    </div>
  );
}
