// Komponen KartuGantungModal — dipindah dari App.jsx (refactor Fase 5e).
import { useState } from "react";
import { fmtDate } from "../lib/utils.js";
import { fmtNum, getSAPLabel } from "../lib/ragShared.mjs";
import { buildKartuGantungHistory, getSAPBadgeStyle, jenisBarangAccentColor } from "../lib/sap.js";
import { buildBarcodeSheetHTML } from "../lib/docBuilders.js";

export function KartuGantungModal({ katalog, stocks, txns, lokasiList, gudangList, sty, C, onClose }) {
  const [view, setView] = useState("riwayat"); // "riwayat" | "label"
  const history = buildKartuGantungHistory(katalog, txns, stocks, lokasiList);
  const lokasiTerkait = [...new Set(stocks.filter(s=>s.katalogId===katalog.id).map(s=>s.lokasiId))].map(lid=>lokasiList.find(l=>l.id===lid)?.kode).filter(Boolean);
  const dominantJenis = stocks.find(s=>s.katalogId===katalog.id)?.jenisBarang || "Persediaan";
  const accent = jenisBarangAccentColor(dominantJenis);
  const sampleFoto = stocks.find(s=>s.katalogId===katalog.id && s.img)?.img || null;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
      <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div>
            <h3 style={{fontSize:17,fontWeight:800}}>🏷️ Kartu Gantung Digital — TUG.2</h3>
            <p style={{fontSize:12,color:C.muted}}>No. Katalog: {katalog.katalog||"-"}</p>
            <div style={{display:"flex",gap:6,marginTop:4}}>
              <span style={{padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700,background:"#f3f4f6",color:"#374151"}}>{dominantJenis}</span>
              {(()=>{const bs=getSAPBadgeStyle(katalog.katalog);return <span style={{padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg}}>{getSAPLabel(katalog.katalog)}</span>;})()}
            </div>
          </div>
          <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600}} onClick={onClose}>✕ Tutup</button>
        </div>

        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[{id:"riwayat",label:"📋 Riwayat Keluar-Masuk"},{id:"label",label:"🏷️ Label QR Print"}].map(v=>(
            <button key={v.id} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${view===v.id?C.accent:C.border}`,background:view===v.id?C.accent:"white",color:view===v.id?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:view===v.id?700:400}} onClick={()=>setView(v.id)}>{v.label}</button>
          ))}
        </div>

        {view==="riwayat" && (
          <div>
            <div style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{katalog.name}</div>
              <div style={{fontSize:12,color:C.muted}}>Satuan: {katalog.satuan} • Lokasi: {lokasiTerkait.length>0?lokasiTerkait.join(", "):"Belum ada"}</div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>TGL</th>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>NO. BON</th>
                    <th style={{padding:"6px 8px",textAlign:"center"}}>MASUK</th>
                    <th style={{padding:"6px 8px",textAlign:"center"}}>KELUAR</th>
                    <th style={{padding:"6px 8px",textAlign:"center"}}>SISA</th>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>RAK</th>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>CATATAN</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length===0 && <tr><td colSpan={7} style={{padding:14,textAlign:"center",color:C.muted}}>Belum ada riwayat transaksi untuk barang ini.</td></tr>}
                  {history.map((h,idx)=>(
                    <tr key={idx} style={{borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:"5px 8px"}}>{fmtDate(h.tgl)}</td>
                      <td style={{padding:"5px 8px"}}>{h.noBon||"-"}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",color:C.green,fontWeight:700}}>{h.masuk>0?fmtNum(h.masuk):""}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",color:C.red,fontWeight:700}}>{h.keluar>0?fmtNum(h.keluar):""}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{fmtNum(h.sisa)}</td>
                      <td style={{padding:"5px 8px"}}>{h.lokasi}</td>
                      <td style={{padding:"5px 8px",color:C.muted}}>{h.catatan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view==="label" && (()=>{
          const scanUrl = `${window.location.origin}/?scan=${encodeURIComponent(katalog.id)}`;
          const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(scanUrl)}`;
          return (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{border:`3px solid ${accent}`,borderRadius:10,padding:16,background:"white",width:260,textAlign:"center",marginBottom:16}}>
                <img src={qrImgUrl} alt="QR Scan TUG-2" width={140} height={140} style={{display:"block",margin:"0 auto"}}/>
                <div style={{fontSize:12,fontWeight:800,marginTop:10,lineHeight:1.3}}>{katalog.name}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:4}}>No. Katalog: {katalog.katalog||"-"}</div>
                <span style={{display:"inline-block",marginTop:8,padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:accent,color:dominantJenis==="Pre Memory"?"#111":"white",border:dominantJenis==="Pre Memory"?`1px solid #d1d5db`:"none"}}>{dominantJenis}</span>
              </div>
              <button onClick={async()=>{
                const lokMap={};
                (stocks||[]).filter(s=>s.katalogId===katalog.id).forEach(s=>{
                  const lok=(lokasiList||[]).find(l=>l.id===s.lokasiId);
                  const gdg=lok?.gudangId?(gudangList||[]).find(g=>g.id===lok.gudangId):null;
                  const txt=`${gdg?.nama||""}${lok?.kode?" / "+lok.kode:""}`.trim();
                  if(txt){(lokMap[katalog.id]=lokMap[katalog.id]||new Set()).add(txt);}
                });
                if(lokMap[katalog.id])lokMap[katalog.id]=Array.from(lokMap[katalog.id]);
                const w=window.open("","_blank");
                const html=await buildBarcodeSheetHTML([katalog],lokMap);
                if(w){w.document.write(html);w.document.close();}
              }} style={{...sty.btn("primary"),marginBottom:12}}>🖨️ Cetak Label (Print / Save PDF)</button>
              <div style={{fontSize:12,color:C.muted,textAlign:"center",marginBottom:14,maxWidth:320}}>
                Klik "Cetak Label" untuk print/simpan PDF label 5×5 cm (QR + nama + lokasi). Scan QR dari HP untuk lihat riwayat TUG-2 material ini tanpa login.
              </div>
              <div style={{fontSize:12,color:"#0369a1",background:"#f0f9ff",border:`1px solid #bae6fd`,borderRadius:8,padding:"8px 10px",maxWidth:340,textAlign:"center",wordBreak:"break-all"}}>
                🔗 {scanUrl}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
