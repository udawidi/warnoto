// Komponen TUG15Tab — dipindah dari App.jsx (refactor Fase 5g).
import { useState } from "react";
import { JENIS_BARANG, UPT } from "../constants.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { getSAPBadgeStyle } from "../lib/sap.js";
import { buildMutasiRows, buildTUG15HTML, syncTUG15ToSupabase, syncStockQtyToSupabase, syncFotoMaterialToSupabase } from "../lib/supabaseSync.js";
import * as XLSX from "xlsx";

export function TUG15Tab({ txns, katalogList, stocks, sty, C, filter, setFilter, lokasiList }) {
  const rows = buildMutasiRows(txns, katalogList, stocks, filter, lokasiList);
  const [syncState, setSyncState] = useState({ loading:false, msg:"" });

  async function handleSyncSupabase() {
    setSyncState({ loading:true, msg:"" });
    try {
      const histRes = await syncTUG15ToSupabase(rows, katalogList);
      const stockRes = await syncStockQtyToSupabase(stocks, katalogList);
      const fotoRes = await syncFotoMaterialToSupabase(stocks, katalogList);
      const parts = [];
      parts.push(histRes.historyCount>0 ? `${histRes.historyCount} baris histori baru` : "tidak ada histori baru");
      parts.push(`qty ${stockRes.stockCount} katalog`);
      if (fotoRes.uploadCount>0) parts.push(`${fotoRes.uploadCount} foto baru diupload`);
      setSyncState({ loading:false, msg: `✓ Tersinkron: ${parts.join(", ")}.` });
    } catch (err) {
      setSyncState({ loading:false, msg: `✗ Gagal sync: ${err.message}` });
    }
  }

  function downloadTUG15() {
    const html = buildTUG15HTML(rows, filter, katalogList);
    const blob = new Blob([html], {type:"text/html"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TUG15_Mutasi_${filter.dateFrom||"all"}_${filter.dateTo||"all"}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }

  function downloadTUG15Excel() {
    try {
      const headers = ["No","No Katalog","Deskripsi Material","Status SAP","Jenis Barang","Merk","Type","Satuan","Valuasi","Saldo Awal","Stok Masuk","Stok Keluar","Saldo Akhir","UPT","TUG/BA & Tgl","Keterangan","Tanggal Mutasi"];
      const dataRows = rows.map(r=>[
        r.no, r.katalog, r.deskripsi, r.sapStatus||"", r.jenisBarang||"",
        r.merk||"-", r.type||"-", r.satuan, r.valuasi||0,
        r.saldoAwal, r.masuk, r.keluar, r.saldoAkhir,
        r.upt, r.tugBaDoc, r.keterangan, r.tanggalMutasi
      ]);
      const totalRow = ["TOTAL","","","","","","","","","",
        rows.reduce((a,r)=>a+r.masuk,0),
        rows.reduce((a,r)=>a+r.keluar,0),
        "","","","",""
      ];
      const wsData = [headers, ...dataRows, totalRow];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [5,12,30,10,12,8,8,7,14,10,10,10,10,12,18,20,12].map(w=>({wch:w}));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "TUG-15 Mutasi Stok");
      const infoData = [
        ["LAPORAN MUTASI STOK MATERIAL - TUG 15"],
        ["PT PLN (PERSERO) UPT SURABAYA"],
        [""],
        ["Periode", `${filter.dateFrom||"Semua"} s/d ${filter.dateTo||"Semua"}`],
        ["Kategori SAP", filter.sapStatus==="ALL"?"SAP + Non-SAP":filter.sapStatus],
        ["Jenis Barang", filter.jenisBarang==="ALL"?"Semua":filter.jenisBarang],
        ["Total Baris", rows.length],
        ["Total Masuk", rows.reduce((a,r)=>a+r.masuk,0)],
        ["Total Keluar", rows.reduce((a,r)=>a+r.keluar,0)],
        ["Digenerate", new Date().toLocaleString("id-ID")],
      ];
      const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
      wsInfo["!cols"] = [{wch:20},{wch:40}];
      XLSX.utils.book_append_sheet(wb, wsInfo, "Info Laporan");
      XLSX.writeFile(wb, `TUG15_Mutasi_${filter.dateFrom||"all"}_${filter.dateTo||"all"}.xlsx`);
    } catch(err) {
      alert("Export Excel gagal: " + err.message + ". Gunakan format HTML/PDF sebagai alternatif.");
    }
  }

  const docTypeLabels = {TUG9:"TUG-9",TUG8:"TUG-8",TUG10:"TUG-10",TUG3:"TUG-3"};

  return (
    <div>
      {/* Filter Panel */}
      <div style={{...sty.card,marginBottom:16,background:"#f8fafc"}}>
        <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:12}}>🔍 Filter Laporan TUG-15</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={sty.label}>Dari Tanggal</label>
            <input type="date" style={sty.input} value={filter.dateFrom} onChange={e=>setFilter(f=>({...f,dateFrom:e.target.value}))}/>
          </div>
          <div>
            <label style={sty.label}>Sampai Tanggal</label>
            <input type="date" style={sty.input} value={filter.dateTo} onChange={e=>setFilter(f=>({...f,dateTo:e.target.value}))}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={sty.label}>Kategori SAP</label>
            <select style={sty.select} value={filter.sapStatus||"ALL"} onChange={e=>setFilter(f=>({...f,sapStatus:e.target.value}))}>
              <option value="ALL">Semua (SAP + Non-SAP)</option>
              <option value="SAP">Material SAP</option>
              <option value="Non-SAP">Material Non-SAP</option>
            </select>
          </div>
          <div>
            <label style={sty.label}>Jenis Barang</label>
            <select style={sty.select} value={filter.jenisBarang||"ALL"} onChange={e=>setFilter(f=>({...f,jenisBarang:e.target.value}))}>
              <option value="ALL">Semua Jenis Barang</option>
              {JENIS_BARANG.map(jb=><option key={jb} value={jb}>{jb}</option>)}
            </select>
          </div>
          <div>
            <label style={sty.label}>Filter Barang Spesifik</label>
            <select style={sty.select} value={filter.katalogId} onChange={e=>setFilter(f=>({...f,katalogId:e.target.value}))}>
              <option value="ALL">Semua Barang</option>
              {katalogList.map(k=><option key={k.id} value={k.id}>{k.name} [{k.katalog||"-"}]</option>)}
            </select>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={sty.label}>Filter Jenis Transaksi</label>
          <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
            {["TUG9","TUG8","TUG10","TUG3"].map(dt=>{
              const active = filter.docTypes.includes(dt);
              return (
                <button key={dt} type="button" style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${active?C.accent:C.border}`,background:active?C.accent:"white",color:active?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:active?700:400}}
                  onClick={()=>setFilter(f=>({...f,docTypes:active?f.docTypes.filter(x=>x!==dt):[...f.docTypes,dt]}))}>
                  {docTypeLabels[dt]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <button style={{...sty.btn("ghost","sm")}} onClick={()=>setFilter({dateFrom:"",dateTo:"",katalogId:"ALL",jenisBarang:"ALL",sapStatus:"ALL",docTypes:["TUG9","TUG8","TUG10","TUG3"]})}>↺ Reset Filter</button>
          <span style={{fontSize:11,color:C.muted}}>{rows.length} baris ditemukan</span>
          <div style={{marginLeft:"auto",display:"flex",gap:8}}>
            <button style={{...sty.btn("ghost"),border:`1px solid #0ea5e9`,color:"#0ea5e9"}} onClick={handleSyncSupabase} disabled={rows.length===0||syncState.loading}>
              {syncState.loading?"⏳ Sinkron...":"☁️ Sync ke Supabase"}
            </button>
            <button style={{...sty.btn("ghost"),border:`1px solid ${C.green}`,color:C.green}} onClick={downloadTUG15Excel} disabled={rows.length===0}>📊 Download Excel (.xlsx)</button>
            <button style={sty.btn("success")} onClick={downloadTUG15} disabled={rows.length===0}>⬇️ Download HTML/PDF</button>
          </div>
        </div>
        {syncState.msg && <div style={{marginTop:10,fontSize:12,color:syncState.msg.startsWith("✗")?C.red||"#dc2626":"#0ea5e9",fontWeight:600}}>{syncState.msg}</div>}
      </div>

      {/* Preview Tabel */}
      {rows.length===0 ? (
        <div style={{...sty.card,textAlign:"center",color:C.muted,padding:40}}>
          <div style={{fontSize:36,marginBottom:12}}>📊</div>
          <div style={{fontSize:14,fontWeight:700}}>Tidak ada data mutasi untuk filter ini</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>Coba ubah rentang tanggal atau jenis transaksi</div>
        </div>
      ) : (
        <div style={{overflowX:"auto"}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Preview {rows.length} baris — scroll kanan untuk lihat semua kolom</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1050}}>
            <thead>
              <tr style={{background:C.sidebar,color:"white"}}>
                {["No","No Katalog","Deskripsi","Status SAP","Jenis","Satuan","Saldo Awal","Masuk","Keluar","Saldo Akhir","TUG/BA","Keterangan","Tgl Mutasi"].map(h=>(
                  <th key={h} style={{padding:"6px 8px",textAlign:["No","Saldo Awal","Masuk","Keluar","Saldo Akhir"].includes(h)?"center":"left",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>{
                const sapBs = getSAPBadgeStyle(r.katalog);
                return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.muted}}>{r.no}</td>
                    <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10}}>{r.katalog}</td>
                    <td style={{padding:"5px 8px",fontWeight:600,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.deskripsi}</td>
                    <td style={{padding:"5px 8px"}}><span style={{padding:"2px 6px",borderRadius:20,fontSize:10,fontWeight:700,background:sapBs.bg,color:sapBs.fg}}>{r.sapStatus}</span></td>
                    <td style={{padding:"5px 8px",fontSize:10}}>{r.jenisBarang||"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.satuan}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.muted}}>{fmtNum(r.saldoAwal)}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.green,fontWeight:r.masuk>0?700:400}}>{r.masuk>0?fmtNum(r.masuk):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.red,fontWeight:r.keluar>0?700:400}}>{r.keluar>0?fmtNum(r.keluar):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{fmtNum(r.saldoAkhir)}</td>
                    <td style={{padding:"5px 8px",fontSize:10,color:"#0098da",whiteSpace:"nowrap"}}>{r.tugBaDoc}</td>
                    <td style={{padding:"5px 8px",fontSize:10,color:C.muted,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.keterangan}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",fontSize:10,whiteSpace:"nowrap"}}>{r.tanggalMutasi}</td>
                  </tr>
                );
              })}
              <tr style={{background:"#f1f5f9",fontWeight:700,borderTop:`2px solid ${C.border}`}}>
                <td colSpan={7} style={{padding:"6px 8px",textAlign:"right"}}>TOTAL</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.green}}>{fmtNum(rows.reduce((a,r)=>a+r.masuk,0))}</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.red}}>{fmtNum(rows.reduce((a,r)=>a+r.keluar,0))}</td>
                <td colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
