// Komponen TUG15Tab — dipindah dari App.jsx (refactor Fase 5g).
import { useEffect, useMemo, useRef, useState } from "react";
import { JENIS_BARANG, UPT } from "../constants.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { getSAPBadgeStyle } from "../lib/sap.js";
import { buildMutasiRows, loadLegacyHistoryArchive, resolveLegacyPrivateUrl, syncTUG15ToSupabase, syncStockQtyToSupabase, syncFotoMaterialToSupabase } from "../lib/supabaseSync.js";
import { buildMonitoringWorkbook, buildTUG15ReportModel } from "../lib/tug15Report.js";

export function TUG15Tab({ txns, katalogList, stocks, sty, C, filter, setFilter, lokasiList, gudangList }) {
  const [legacy, setLegacy] = useState({ rows:[], documents:[], loading:true, error:null });
  const autoSyncedRef = useRef(false);
  const [historyItem, setHistoryItem] = useState(null);
  const [attachmentState, setAttachmentState] = useState({ loading:false, error:"" });
  const [exportState, setExportState] = useState({ kind:"", error:"" });
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    loadLegacyHistoryArchive().then(result => {
      if (!active) return;
      setLegacy({ ...result, loading:false });
    }).catch(error => {
      if (active) setLegacy({ rows:[], documents:[], loading:false, error });
    });
    return () => { active = false; };
  }, []);

  const rows = buildMutasiRows(txns, katalogList, stocks, filter, lokasiList, legacy.rows, { gudangList });
  const allHistoryRows = useMemo(() => buildMutasiRows(txns, katalogList, stocks, {
    ...filter, dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL", source:"ALL", searchText:"",
    docTypes:["TUG9","TUG8","TUG10","TUG3","TUG5"],
  }, lokasiList, legacy.rows, { gudangList }), [txns, katalogList, stocks, filter, lokasiList, legacy.rows, gudangList]);
  const selectedHistoryRows = useMemo(() => historyItem
    ? allHistoryRows.filter(row => row.materialKey === historyItem.materialKey).sort((a,b)=>(b.ts||0)-(a.ts||0))
    : [], [allHistoryRows, historyItem]);
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);
  useEffect(() => { setPage(1); }, [filter, legacy.rows]);
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
    setPage(current => Math.min(current, maxPage));
  }, [rows.length, pageSize]);

  const documentsByKey = useMemo(() => new Map(legacy.documents.map(doc => [`${doc.doc_type}|${doc.doc_id}`, doc])), [legacy.documents]);

  async function openAttachment(url) {
    if (!url) return;
    setAttachmentState({ loading:true, error:"" });
    try {
      const resolved = await resolveLegacyPrivateUrl(url);
      if (!resolved) throw new Error("Lampiran tidak tersedia.");
      window.open(resolved, "_blank", "noopener,noreferrer");
      setAttachmentState({ loading:false, error:"" });
    } catch (err) {
      setAttachmentState({ loading:false, error:err.message || "Lampiran tidak dapat dibuka." });
    }
  }

  async function handleSyncSupabase() {
    try {
      // Arsip legacy bersifat read-only dan tidak boleh masuk ke histori transaksi live.
      // Pakai allHistoryRows (rentang & filter penuh), BUKAN rows (bisa dipersempit filter UI).
      const liveRows = allHistoryRows.filter(row => row.source !== "LAMA");
      await syncTUG15ToSupabase(liveRows, katalogList);
      await syncStockQtyToSupabase(stocks, katalogList);
      await syncFotoMaterialToSupabase(stocks, katalogList);
    } catch (err) {
      console.warn("Sync TUG-15 ke Supabase gagal:", err);
    }
  }

  // Sync otomatis diam-diam (background) begitu arsip legacy selesai dimuat — bukan lagi dipicu klik user.
  // Guard useRef supaya hanya jalan sekali per mount, tidak retry-loop kalau gagal.
  useEffect(() => {
    if (autoSyncedRef.current) return;
    if (legacy.loading) return;
    if (allHistoryRows.length === 0) return;
    autoSyncedRef.current = true;
    handleSyncSupabase();
  }, [legacy.loading, allHistoryRows]);

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function downloadTUG15() {
    if (exportState.kind) return;
    if (!filter.dateFrom || !filter.dateTo) {
      if (!confirm("Anda belum memilih rentang tanggal — export akan mencakup SELURUH riwayat (bisa sangat besar). Lanjutkan?")) return;
    }
    setExportState({ kind:"pdf", error:"" });
    try {
      // Library generator hanya dimuat saat user mengunduh, bukan initial chunk.
      const [{ jsPDF }, pdfRenderer] = await Promise.all([
        import("jspdf"), import("../lib/tug15Pdf.js"),
      ]);
      const report = buildTUG15ReportModel(rows, filter);
      const doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4", compress:true });
      pdfRenderer.renderTUG15Pdf(doc, report);
      const blob = doc.output("blob");
      // Metadata non-serialized untuk observabilitas download; isi PDF tetap Blob asli.
      blob.__warnotoPdfPageCount = doc.getNumberOfPages();
      if (blob.type !== "application/pdf") throw new Error("Generator tidak menghasilkan berkas PDF.");
      downloadBlob(blob, `TUG15_Ringkasan_${filter.dateFrom||"all"}_${filter.dateTo||"all"}.pdf`);
    } catch (err) {
      setExportState({ kind:"", error:err?.message || "PDF tidak dapat dibuat." });
      return;
    }
    setExportState({ kind:"", error:"" });
  }

  async function downloadTUG15Excel() {
    if (exportState.kind) return;
    if (!filter.dateFrom || !filter.dateTo) {
      if (!confirm("Anda belum memilih rentang tanggal — export akan mencakup SELURUH riwayat (bisa sangat besar). Lanjutkan?")) return;
    }
    setExportState({ kind:"excel", error:"" });
    try {
      const XLSX = await import("xlsx");
      const report = buildTUG15ReportModel(rows, filter);
      const wb = buildMonitoringWorkbook(XLSX, report);
      XLSX.writeFile(wb, `TUG15_Monitoring_Persediaan_${filter.dateFrom||"all"}_${filter.dateTo||"all"}.xlsx`);
    } catch(err) {
      setExportState({ kind:"", error:err?.message || "Excel tidak dapat dibuat." });
      return;
    }
    setExportState({ kind:"", error:"" });
  }

  return (
    <div>
      {/* Filter Panel */}
      <div style={{...sty.card,marginBottom:16,background:"#f8fafc"}}>
        <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:12}}>🔍 Filter Laporan TUG-15</div>
        <div style={{marginBottom:12}}>
          <label style={sty.label}>Sumber Data</label>
          <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
            {[{id:"ALL",label:"Semua Sumber"},{id:"BARU",label:"Baru"},{id:"LAMA",label:"Lama"}].map(option=>{
              const active = (filter.source||"ALL") === option.id;
              return <button key={option.id} type="button" style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${active?C.accent:C.border}`,background:active?C.accent:"white",color:active?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:active?700:400}} onClick={()=>setFilter(f=>({...f,source:option.id}))}>{option.label}</button>;
            })}
          </div>
        </div>
        <div className="tug15-filter-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
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
        <div className="tug15-action-row" style={{display:"flex",gap:10,alignItems:"center"}}>
          <div className="tug15-action-summary" style={{display:"flex",gap:10,alignItems:"center"}}>
            <button style={{...sty.btn("ghost","sm")}} onClick={()=>setFilter({dateFrom:"",dateTo:"",katalogId:"ALL",jenisBarang:"ALL",sapStatus:"ALL",source:"ALL",searchText:"",docTypes:["TUG9","TUG8","TUG10","TUG3","TUG5"]})}>↺ Reset Filter</button>
            <span style={{fontSize:12,color:C.muted}}>{rows.length} baris ditemukan</span>
          </div>
        </div>
        {legacy.loading && <div style={{marginTop:10,fontSize:12,color:C.muted}}>Memuat arsip history lama…</div>}
        {legacy.error && <div style={{marginTop:10,fontSize:12,color:C.red||"#dc2626"}}>Arsip history lama belum dapat dimuat: {legacy.error.message || "periksa koneksi atau ketersediaan tabel arsip."}</div>}
      </div>

      <div style={{...sty.card, marginBottom:16, border:`2px solid ${C.accent}`, background:"#eff6ff"}}>
        <div style={{fontSize:14,fontWeight:800,color:C.sidebar,marginBottom:8}}>Cari Riwayat Material</div>
        <div className="tug15-date-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div><label style={sty.label}>Dari Tanggal</label><input type="date" style={sty.input} value={filter.dateFrom} onChange={e=>setFilter(f=>({...f,dateFrom:e.target.value}))}/></div>
          <div><label style={sty.label}>Sampai Tanggal</label><input type="date" style={sty.input} value={filter.dateTo} onChange={e=>setFilter(f=>({...f,dateTo:e.target.value}))}/></div>
        </div>
        <div className="tug15-quick-finder" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input aria-label="Cari di Seluruh Riwayat" style={{...sty.input,flex:1,minWidth:220,fontSize:15,padding:12}} value={filter.searchText||""} placeholder="Pekerjaan, lokasi, vendor/ULTG, tanggal, dokumen, SPK/kontrak, atau catatan" onChange={e=>setFilter(f=>({...f,searchText:e.target.value}))}/>
          <button type="button" style={sty.btn("primary")} onClick={()=>setFilter(f=>({...f,searchText:f.searchText||""}))}>Cari</button>
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:6}}>Bisa memakai beberapa kata sekaligus. Jika tanggal dan kata pencarian diisi, keduanya diterapkan bersama.</div>
        {exportState.error && <div role="alert" style={{marginTop:10,fontSize:12,color:C.red||"#dc2626"}}>Unduhan laporan gagal: {exportState.error}</div>}
        {exportState.kind && <div role="status" style={{marginTop:8,fontSize:12,color:C.muted}}>Menyiapkan {exportState.kind === "pdf" ? "PDF asli" : "workbook Excel"}...</div>}
        <div className="tug15-export-actions" aria-busy={Boolean(exportState.kind)} style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
          <button style={{...sty.btn("ghost"),border:`1px solid ${C.green}`,color:C.green}} onClick={downloadTUG15Excel} disabled={rows.length===0}>Download Excel (.xlsx)</button>
          <button style={sty.btn("success")} onClick={downloadTUG15} disabled={rows.length===0}>Download Ringkasan (PDF)</button>
        </div>
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
          <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Preview {rows.length} baris — scroll kanan untuk lihat semua kolom</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1050}}>
            <thead>
              <tr style={{background:C.sidebar,color:"white"}}>
                {["No","Sumber","No Katalog","Deskripsi","Status SAP","Jenis","Satuan","Saldo Awal","Masuk","Keluar","Saldo Akhir","TUG/BA","Keterangan","Tgl Mutasi","Riwayat"].map(h=>(
                  <th key={h} style={{padding:"6px 8px",textAlign:["No","Saldo Awal","Masuk","Keluar","Saldo Akhir"].includes(h)?"center":"left",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r,i)=>{
                const sapBs = getSAPBadgeStyle(r.katalog);
                return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.muted}}>{(page-1)*pageSize+i+1}</td>
                    <td style={{padding:"5px 8px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:11,fontWeight:700,background:r.source==="LAMA"?"#fef3c7":"#dbeafe",color:r.source==="LAMA"?"#92400e":"#1d4ed8"}}>{r.sourceLabel||"Baru"}</span></td>
                    <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:12}}>{r.katalog}</td>
                    <td style={{padding:"5px 8px",fontWeight:600,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.deskripsi}</td>
                    <td style={{padding:"5px 8px"}}><span style={{padding:"2px 6px",borderRadius:20,fontSize:12,fontWeight:700,background:r.source==="LAMA"?"#f3f4f6":sapBs.bg,color:r.source==="LAMA"?"#4b5563":sapBs.fg}}>{r.sapStatus}</span></td>
                    <td style={{padding:"5px 8px",fontSize:12}}>{r.jenisBarang||"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.satuan}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.muted}}>{r.affectsSaldo===false?"—":fmtNum(r.saldoAwal)}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.green,fontWeight:r.masuk>0?700:400}}>{r.masuk>0?fmtNum(r.masuk):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.red,fontWeight:r.keluar>0?700:400}}>{r.keluar>0?fmtNum(r.keluar):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{r.affectsSaldo===false?"—":fmtNum(r.saldoAkhir)}</td>
                    <td style={{padding:"5px 8px",fontSize:12,color:"#0098da",whiteSpace:"nowrap"}}>{r.tugBaDoc}</td>
                    <td style={{padding:"5px 8px",fontSize:12,color:C.muted,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.keterangan}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",fontSize:12,whiteSpace:"nowrap"}}>{r.tanggalMutasi}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}><button type="button" style={{...sty.btn("ghost","sm"),whiteSpace:"nowrap"}} onClick={()=>setHistoryItem(r)}>Riwayat lengkap</button></td>
                  </tr>
                );
              })}
              <tr style={{background:"#f1f5f9",fontWeight:700,borderTop:`2px solid ${C.border}`}}>
                <td colSpan={8} style={{padding:"6px 8px",textAlign:"right"}}>TOTAL</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.green}}>{fmtNum(rows.reduce((a,r)=>a+r.masuk,0))}</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.red}}>{fmtNum(rows.reduce((a,r)=>a+r.keluar,0))}</td>
                <td colSpan={5}></td>
              </tr>
            </tbody>
          </table>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",padding:"10px 0",fontSize:12,color:C.muted}}>
            <span>{rows.length ? `${(page-1)*pageSize+1}–${Math.min(page*pageSize,rows.length)} dari ${rows.length}` : "0 dari 0"}</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}><label>Baris <select aria-label="Baris per halaman" value={pageSize} onChange={e=>{setPage(1);setPageSize(Number(e.target.value));}}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" style={sty.btn("ghost","sm")} disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Sebelumnya</button><button type="button" style={sty.btn("ghost","sm")} disabled={page>=Math.ceil(rows.length/pageSize)} onClick={()=>setPage(p=>p+1)}>Berikutnya</button></div>
          </div>
        </div>
      )}
      {historyItem && (
        <div role="dialog" aria-modal="true" aria-label="Riwayat lengkap material" style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(15,23,42,.48)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onMouseDown={()=>setHistoryItem(null)}>
          <aside style={{width:"min(760px,100%)",maxHeight:"min(86vh,760px)",overflowY:"auto",background:C.surface||"white",borderRadius:16,padding:24,boxShadow:"0 24px 60px rgba(15,23,42,.28)",border:`1px solid ${C.border}`}} onMouseDown={e=>e.stopPropagation()}>
            <div style={{display:"flex",gap:12,alignItems:"start",marginBottom:16}}>
              <div style={{flex:1}}>
                <div style={{fontSize:17,fontWeight:800,color:C.sidebar}}>Riwayat lengkap</div>
                <div style={{fontSize:13,fontWeight:700,marginTop:4}}>{historyItem.deskripsi}</div>
                <div style={{fontSize:12,color:C.muted,fontFamily:"monospace",marginTop:2}}>{historyItem.katalog}</div>
              </div>
              <button type="button" aria-label="Tutup riwayat" style={sty.btn("ghost","sm")} onClick={()=>setHistoryItem(null)}>Tutup</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
              <div style={{padding:10,border:`1px solid ${C.border}`,borderRadius:8}}><div style={{fontSize:11,color:C.muted}}>Total masuk</div><div style={{fontWeight:800,color:C.green}}>{fmtNum(selectedHistoryRows.reduce((sum,row)=>sum+row.masuk,0))}</div></div>
              <div style={{padding:10,border:`1px solid ${C.border}`,borderRadius:8}}><div style={{fontSize:11,color:C.muted}}>Total keluar</div><div style={{fontWeight:800,color:C.red}}>{fmtNum(selectedHistoryRows.reduce((sum,row)=>sum+row.keluar,0))}</div></div>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Arsip lama ditautkan hanya bila nomor katalog sama persis; data arsip tidak mengubah saldo stok aktif.</div>
            {attachmentState.error && <div style={{fontSize:12,color:C.red||"#dc2626",marginBottom:10}}>{attachmentState.error}</div>}
            {attachmentState.loading && <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Menyiapkan lampiran…</div>}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {selectedHistoryRows.map((row,index)=>{
                const doc = row.source === "LAMA" ? documentsByKey.get(`${row.docType}|${row.legacyDocId}`) : null;
                const hasContractRef = row.contractRefs && row.contractRefs !== "-";
                const contractText = hasContractRef
                  ? `${row.contractRefs}${row.docType==="TUG3"?" (referensi penerimaan, bukan penelusuran lot)":""}`
                  : (row.eventKind==="KELUAR" ? "Tidak terlacak per lot" : "Tidak tercatat");
                const priorReceipt = row.eventKind === "KELUAR"
                  ? selectedHistoryRows.find(candidate => candidate.docType === "TUG3"
                    && candidate.ts <= row.ts
                    && candidate.contractRefs
                    && candidate.contractRefs !== "-")
                  : null;
                const attachments = row.source === "LAMA" ? [
                  ["Foto barang",row.fotoBarangUrl], ["Surat jalan",doc?.foto_surat_jalan_url], ["SIM/KTP",doc?.foto_sim_ktp_url],
                  ["Foto kendaraan",doc?.foto_kendaraan_url], ["PDF",doc?.pdf_url], ["Berita acara",doc?.berita_acara_url], ["Lampiran",doc?.lampiran_url],
                ].filter(([,url])=>url) : [];
                return <div key={`${row.source}-${row.legacyId||row.no}-${index}`} style={{padding:12,border:`1px solid ${C.border}`,borderRadius:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}><span style={{fontSize:12,fontWeight:800,color:row.source==="LAMA"?"#92400e":"#1d4ed8"}}>{row.sourceLabel||"Baru"}</span><span style={{fontSize:12,color:C.muted}}>{row.tanggalMutasi}</span></div>
                  <div style={{fontSize:13,fontWeight:700,marginTop:4}}>{row.eventKind || (row.docType === "TUG5" ? "PERMINTAAN" : "EVENT")} · {row.tugBaDoc}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>{row.keterangan}</div>
                  <div className="tug15-history-detail-grid" style={{fontSize:12,marginTop:8,display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}><span>Tanggal: {row.eventDate || row.tanggalMutasi}</span><span>Pekerjaan: {row.jobName && row.jobName!=="-" ? row.jobName : "Tidak tercatat"}</span><span>Dipakai/lokasi kerja: {row.workLocation && row.workLocation!=="-" ? row.workLocation : "Tidak tercatat"}</span><span>Vendor/ULTG/pihak: {(row.counterparty && row.counterparty!=="-" ? row.counterparty : row.unit) || "Tidak tercatat"}</span><span>Lokasi simpan: {row.storageLocation && row.storageLocation!=="-" ? row.storageLocation : "Tidak tercatat"}</span><span>Kontrak/penerimaan: {contractText}</span><span>Referensi dokumen: {row.documentRefs && row.documentRefs!=="-" ? row.documentRefs : "Tidak tersedia"}</span><span>Catatan: {row.notes && row.notes!=="-" ? row.notes : "Tidak tercatat"}</span></div>
                  {row.eventKind === "KELUAR" && <div style={{fontSize:11,color:C.muted,marginTop:7}}>Penerimaan sebelumnya: {priorReceipt ? `${priorReceipt.contractRefs} · ${priorReceipt.tanggalMutasi}` : "tidak ditemukan pada history ini"} — hanya referensi, bukan penelusuran lot.</div>}
                  {row.quality && row.quality !== "-" && <div style={{fontSize:11,color:"#92400e",marginTop:6}}>Quality flags: {row.quality}</div>}
                  {row.docType === "TUG5" ? <div style={{fontSize:12,color:C.muted,marginTop:8}}>Permintaan (bukan mutasi stok); qty/saldo tidak berlaku.</div> : <div style={{display:"flex",gap:12,fontSize:12,marginTop:8}}><span style={{color:C.green}}>Masuk {fmtNum(row.masuk)}</span><span style={{color:C.red}}>Keluar {fmtNum(row.keluar)}</span></div>}
                  {attachments.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>{attachments.map(([label,url])=><button key={label} type="button" style={sty.btn("ghost","sm")} onClick={()=>openAttachment(url)}>{label}</button>)}</div>}
                </div>;
              })}
              {selectedHistoryRows.length === 0 && <div style={{color:C.muted,fontSize:13}}>Belum ada riwayat lain untuk barang ini.</div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
