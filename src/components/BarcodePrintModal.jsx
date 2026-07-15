// Komponen BarcodePrintModal — dipindah dari App.jsx (refactor Fase 5e).
import { useState } from "react";
import { JENIS_BARANG } from "../constants.js";
import { getSAPLabel } from "../lib/ragShared.mjs";
import { buildBarcodeSheetHTML } from "../lib/docBuilders.js";

// Modal Admin: filter (jenis barang + SAP/Non-SAP) lalu cetak lembar barcode massal.
export function BarcodePrintModal({ katalogList, stocks, lokasiList, gudangList, C, sty, onClose }) {
  const [jenisSel, setJenisSel] = useState(() => new Set(JENIS_BARANG));
  const [sapSel, setSapSel] = useState("ALL"); // ALL | SAP | NONSAP
  const [busy, setBusy] = useState(false);

  const lokasiByKatalog = {};
  (stocks || []).forEach((s) => {
    if (!s.katalogId) return;
    const lok = lokasiList.find((l) => l.id === s.lokasiId);
    const gdg = lok?.gudangId ? gudangList.find((g) => g.id === lok.gudangId) : null;
    const txt = `${gdg?.nama || ""}${lok?.kode ? " / " + lok.kode : ""}`.trim();
    if (txt) { (lokasiByKatalog[s.katalogId] = lokasiByKatalog[s.katalogId] || new Set()).add(txt); }
  });
  Object.keys(lokasiByKatalog).forEach((k) => { lokasiByKatalog[k] = Array.from(lokasiByKatalog[k]); });

  const allJenis = jenisSel.size === JENIS_BARANG.length;
  const filtered = katalogList.filter((k) => {
    const jenisOk = allJenis ? true : jenisSel.has(k.jenisBarang);
    const isSap = getSAPLabel(k.katalog).startsWith("SAP");
    const sapOk = sapSel === "ALL" || (sapSel === "SAP" && isSap) || (sapSel === "NONSAP" && !isSap);
    return jenisOk && sapOk;
  });
  const toggleJenis = (j) => setJenisSel((prev) => { const n = new Set(prev); n.has(j) ? n.delete(j) : n.add(j); return n; });

  async function cetak() {
    if (!filtered.length || busy) return;
    setBusy(true);
    try {
      const w = window.open("", "_blank");
      const html = await buildBarcodeSheetHTML(filtered, lokasiByKatalog);
      if (w) { w.document.write(html); w.document.close(); }
    } finally { setBusy(false); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div style={{ ...sty.card, maxWidth:560, width:"100%", maxHeight:"90vh", overflowY:"auto" }} onClick={(e)=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:17, fontWeight:800 }}>🖨️ Cetak Semua Barcode (Kartu Gantung)</div>
          <button onClick={onClose} style={{ background:"transparent", border:"none", fontSize:20, cursor:"pointer", color:C.muted }}>✕</button>
        </div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Label QR 5×5 cm untuk ditempel di kartu gantung fisik. QR meng-encode ID katalog yang sama dengan label TUG-2 — kartu lama tetap valid.</div>
        <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Jenis Barang</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
          {JENIS_BARANG.map((j) => {
            const on = jenisSel.has(j);
            return <button key={j} onClick={()=>toggleJenis(j)} style={{ padding:"5px 12px", borderRadius:20, border:`1px solid ${on?C.accent:C.border}`, background:on?C.accent:"white", color:on?"white":C.muted, fontSize:12, fontWeight:700, cursor:"pointer" }}>{j}</button>;
          })}
        </div>
        <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Status SAP</div>
        <div style={{ display:"flex", gap:6, marginBottom:16 }}>
          {[{id:"ALL",label:"Semua"},{id:"SAP",label:"SAP"},{id:"NONSAP",label:"Non-SAP"}].map((o)=>(
            <button key={o.id} onClick={()=>setSapSel(o.id)} style={{ padding:"5px 14px", borderRadius:20, border:`1px solid ${sapSel===o.id?C.accent:C.border}`, background:sapSel===o.id?C.accent:"white", color:sapSel===o.id?"white":C.muted, fontSize:12, fontWeight:700, cursor:"pointer" }}>{o.label}</button>
          ))}
        </div>
        <div style={{ background:C.bg, borderRadius:10, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:13, color:C.text }}>Akan dicetak</span>
          <span style={{ fontSize:20, fontWeight:800, color:C.accent }}>{filtered.length} label</span>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ ...sty.btn("ghost"), flex:1 }}>Batal</button>
          <button onClick={cetak} disabled={!filtered.length || busy} style={{ ...sty.btn("primary"), flex:2, opacity:(!filtered.length||busy)?0.5:1 }}>{busy ? "Menyiapkan QR..." : `🖨️ Cetak ${filtered.length} Label`}</button>
        </div>
      </div>
    </div>
  );
}
