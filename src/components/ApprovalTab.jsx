// Komponen ApprovalTab — dipindah dari App.jsx (refactor Fase 5i).
import { useState, useEffect } from "react";
import { KAPASITAS_LABEL, UIT, UPT } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole } from "../lib/roles.js";
import { statusMaterialBadgeStyle } from "../lib/sap.js";

export function ApprovalTab({ pendingTxns, stocks, katalogList, lokasiList, users, sty, C, approveTxn, rejectTxn, currentUser, uptList, submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik, konfirmasiDraftTUG8, gudangCapacityImports, approveCapacityImport, rejectCapacityImport, approveLokasiChange, rejectLokasiChange, ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, heavyEquipmentPendingCount, opnamePendingCount=0, stockCountPendingCount=0, approvalTypeFilter="ALL", approvalPageSize=10 }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug7Form, setTug7Form] = useState({});
  const [tug7Modal, setTug7Modal] = useState(null);
  const [rejectingCapId, setRejectingCapId] = useState(null);
  const [capReason, setCapReason] = useState("");
  const [tugPage, setTugPage] = useState(1);
  const [capPage, setCapPage] = useState(1);
  const [lokasiPage, setLokasiPage] = useState(1);
  useEffect(() => { setTugPage(1); setCapPage(1); setLokasiPage(1); }, [approvalTypeFilter, approvalPageSize]);
  const canApproveCap = hasRole(currentUser, "TL","ASMAN");
  const pendingCapacityImports = (gudangCapacityImports||[]).filter(i=>i.status==="PENDING_ASMAN");
  const pendingLokasiChanges = hasRole(currentUser, "TL") ? (lokasiList||[]).filter(l=>l.status==="PENDING") : [];
  const showTug = approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG";
  const showCap = approvalTypeFilter==="ALL"||approvalTypeFilter==="KAPASITAS";
  const showLokasi = approvalTypeFilter==="ALL"||approvalTypeFilter==="LOKASI";
  const pagedTxns = showTug ? pendingTxns.slice((tugPage-1)*approvalPageSize, tugPage*approvalPageSize) : [];
  const pagedCapacityImports = showCap ? pendingCapacityImports.slice((capPage-1)*approvalPageSize, capPage*approvalPageSize) : [];
  const pagedLokasiChanges = showLokasi ? pendingLokasiChanges.slice((lokasiPage-1)*approvalPageSize, lokasiPage*approvalPageSize) : [];
  function renderPager(page, setPage, totalItems) {
    if (totalItems <= approvalPageSize) return null;
    const totalPages = Math.max(1, Math.ceil(totalItems/approvalPageSize));
    return (
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginTop:8,marginBottom:12}}>
        <button style={{...sty.btn("ghost","sm")}} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
        <span style={{fontSize:11,color:C.muted,padding:"0 4px"}}>Halaman {page} / {totalPages}</span>
        <button style={{...sty.btn("ghost","sm")}} disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya →</button>
      </div>
    );
  }
  // BUG DITEMUKAN 2026-07-04 (fix layout 2026-07-06): panel "Pemindahan Blok/
  // Gudang Data Stok"/"Edit Data Stok"/"Hapus Data Stok"/"Peminjaman Alat
  // Berat" dirender inline SESUDAH <ApprovalTab> (lihat App.jsx ~line 6510-
  // 6650, ApprovalTab sengaja dipanggil PALING AWAL supaya judul "Approval"
  // tidak tertimbun di bawah panel-panel itu), tapi hitungan "X item menunggu
  // persetujuan" dan status kosong "Semua sudah diproses" di ApprovalTab
  // TIDAK tahu soal panel-panel itu — jadi kelihatan kontradiktif (badge
  // bilang 0/"selesai" padahal ada 1 item nyata di bawahnya) dan sidebar juga
  // tidak ikut kasih notifikasi badge untuk ini. Tambahkan ke hitungan supaya
  // konsisten.
  const pendingStockMoves = hasRole(currentUser, "TL") ? (stocks||[]).filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="TL")
    : hasRole(currentUser, "ASMAN") ? (stocks||[]).filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="ASMAN") : [];
  const pendingStockEdits = hasRole(currentUser, "TL") ? (stocks||[]).filter(s=>s.editPending) : [];
  const pendingStockDeletes = hasRole(currentUser, "TL") ? (stocks||[]).filter(s=>s.deletePending) : [];
  const pendingStockCount = pendingStockMoves.length + pendingStockEdits.length + pendingStockDeletes.length;

  function stageLabelOf(t) {
    if (t.docType==="TUG5") return t.stage==="PENDING_ASMAN"?"Menunggu Asman":"Menunggu Manager";
    if (t.docType==="TUG7") return t.stage==="DRAFT_UIT"?"Draft — Perlu dilengkapi Admin UIT":"Menunggu Mgr Logistik UIT";
    if (t.docType==="TUG8" && t.stage==="DRAFT_TUG8") return "Draft TUG-8 — Perlu Konfirmasi";
    if (t.docType==="TUG3") {
      if (t.stage==="PENDING_TL") return "Menunggu TL Logistik";
      if (t.stage==="PENDING_MANAGER") return "Menunggu Manager (TUG-4)";
      if (t.stage==="PENDING_ASMAN") return "Menunggu Asman Final";
    }
    return "PENDING";
  }

  function docNoOf(t) {
    if (!t.docNumbers) return t.id;
    if (t.docType==="TUG5") return t.docNumbers.tug5||t.id;
    if (t.docType==="TUG7") return t.docNumbers.tug7||t.id;
    if (t.docType==="TUG9") return t.docNumbers.tug9||t.id;
    if (t.docType==="TUG8") return t.docNumbers.tug8||t.id;
    if (t.docType==="TUG10") return t.docNumbers.tug10||t.id;
    if (t.docType==="TUG3") return t.docNumbers.tug3||t.id;
    return t.id;
  }

  function itemsOf(t) {
    if (t.docType==="TUG10") return (t.stockItems||[]).map((si,i)=>{
      const nama = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
      const bs = statusMaterialBadgeStyle(si.statusMaterial);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {nama} <b>x{si.qty}</b> <span style={{padding:"2px 6px",borderRadius:20,fontSize:10,background:bs.bg,color:bs.fg,fontWeight:700}}>{si.statusMaterial}</span></div>;
    });
    if (t.docType==="TUG5") return (t.stockItems||[]).map((si,i)=>{
      const kat = (katalogList||[]).find(k=>k.id===si.katalogId);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>Permintaan: {si.permintaan}</b> {kat?.satuan}</div>;
    });
    if (t.docType==="TUG7") return (t.stockItems||[]).map((si,i)=>{
      const kat = (katalogList||[]).find(k=>k.id===si.katalogId);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>x{si.qty||si.permintaan}</b> {kat?.satuan}</div>;
    });
    if (t.docType==="TUG3") return (t.stockItems||[]).map((si,i)=>{
      const nama = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {nama} <b>x{si.qty}</b></div>;
    });
    return (t.stockItems||[]).map((si,i)=>{
      const stock = stocks.find(s=>s.id===si.stockId);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {stock?.name||"?"} <b>x{si.qty}</b> {stock?.unit}</div>;
    });
  }

  // Heading section — cuma tampil kalau filter "Semua" dipilih (kalau filter spesifik sudah
  // dipilih, judul filter itu sendiri sudah cukup jelas). Sebelumnya TUG/Kapasitas Gudang/
  // Lokasi-Blok dirender berurutan sebagai satu list tanpa pemisah visual, jadi approval
  // "Tambah/Ubah/Hapus Blok" terkesan ikut masuk ke approval transaksi TUG (keluhan user
  // 2026-07-06).
  function sectionHeading(icon, text) {
    return <div style={{fontSize:11,fontWeight:800,color:C.muted,letterSpacing:0.5,textTransform:"uppercase",margin:"14px 0 10px",paddingBottom:6,borderBottom:`2px solid ${C.border}`}}>{icon} {text}</div>;
  }

  return (
    <div>
      {pendingTxns.length===0 && pendingCapacityImports.length===0 && pendingLokasiChanges.length===0 && pendingStockCount===0 && !(heavyEquipmentPendingCount>0) && !(opnamePendingCount>0) && !(stockCountPendingCount>0) ? (
        <div style={{...sty.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontSize:16,fontWeight:700}}>Semua sudah diproses</div>
        </div>
      ) : !showTug ? null : <>
      {approvalTypeFilter==="ALL" && pendingTxns.length>0 && sectionHeading("📄","Transaksi TUG")}
      {pagedTxns.map(t=>{
        const creator = users.find(u=>u.id===t.createdBy)||{};
        const isTUG8Draft = t.docType==="TUG8" && t.stage==="DRAFT_TUG8";
        const isTUG7Draft = t.docType==="TUG7" && t.stage==="DRAFT_UIT";
        const isTUG10 = t.docType==="TUG10";
        const stageColor = isTUG7Draft||isTUG8Draft?"#7c3aed":C.yellow;
        return (
          <div key={t.id} style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${stageColor}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:11,color:stageColor,fontWeight:800,textTransform:"uppercase"}}>{t.docType.replace("TUG","TUG-")} — {stageLabelOf(t)}</div>
                <div style={{fontSize:15,fontWeight:800}}>{t.namaPekerjaan||t.keteranganUmum||docNoOf(t)}</div>
                <div style={{fontSize:11,color:"#0098da",fontWeight:700}}>{docNoOf(t)}</div>
                {creator.name && <div style={{fontSize:11,color:C.muted}}>Diajukan: {creator.name} ({ROLES[creator.role]}) • {fmtDate(t.createdAt)}</div>}
              </div>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"#fef3c7",color:"#92400e"}}>
                {isTUG8Draft?"DRAFT":isTUG7Draft?"DRAFT UIT":"PENDING"}
              </span>
            </div>

            {/* Info khusus per tipe */}
            {isTUG8Draft && (
              <div style={{background:"#f3e8ff",border:`1px solid #c4b5fd`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#7c3aed",marginBottom:8}}>
                📦 Draft TUG-8 dari TUG-7 {t.noReferensiTug7} — UPT Pengirim: {t.lokasiPekerjaan}. Konfirmasi untuk aktifkan ke antrian approval TUG-8 biasa.
              </div>
            )}
            {isTUG10 && (
              <div style={{background:"#dcfce7",border:`1px solid #86efac`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#166534",marginBottom:8}}>
                ℹ️ Pengembalian material — stok akan BERTAMBAH saat disetujui.
              </div>
            )}
            {t.docType==="TUG5" && t.sourceType==="ULTG" && (
              <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#1d4ed8",marginBottom:8}}>
                🏘️ Dari ULTG {(ultgList||[]).find(u=>u.id===t.ultgId)?.nama||t.ultgId||"-"} — setelah disetujui, siap di-adopt Admin/TL UPT induk menjadi TUG-9.
              </div>
            )}
            {t.docType==="TUG5" && t.sourceType!=="ULTG" && (
              <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#1d4ed8",marginBottom:8}}>
                {t.jenisTransfer==="INTRACOMPANY"?"🔄 Intracompany — setelah approved akan generate draft TUG-7 di UIT":"🌐 Intercompany — setelah approved akan generate draft TUG-5 UIT"}
              </div>
            )}

            {/* Items */}
            <div style={{background:"#f9fafb",borderRadius:8,padding:8,border:`1px solid ${C.border}`,marginBottom:10}}>
              {itemsOf(t)}
            </div>

            {/* Reject reason input */}
            {rejectingId===t.id && (
              <div style={{marginBottom:10}}>
                <label style={sty.label}>Alasan Penolakan *</label>
                <input style={sty.input} placeholder="Jelaskan alasan..." value={reason} onChange={e=>setReason(e.target.value)}/>
              </div>
            )}

            {/* Action buttons */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {/* TUG-9/8/10 standard approval */}
              {["TUG9","TUG8"].includes(t.docType) && !isTUG8Draft && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTxn(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTxn(t)}>✅ SETUJUI</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {t.docType==="TUG10" && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTxn(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTxn(t)}>✅ SETUJUI — Stok Masuk</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {/* TUG-8 Draft dari TUG-7 */}
              {isTUG8Draft && hasRole(currentUser, "ADMIN","TL") && (
                <button style={{...sty.btn("success"),flex:1}} onClick={()=>konfirmasiDraftTUG8(t)}>✅ Konfirmasi Draft TUG-8 — Aktifkan</button>
              )}
              {/* TUG-7 Draft UIT */}
              {isTUG7Draft && hasRole(currentUser, "ADMIN_UIT") && (
                <button style={{...sty.btn("primary"),flex:1}} onClick={()=>{setTug7Form({uptPengirimId:"",atasBebanRekening:"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>📝 Lengkapi TUG-7 (Pilih UPT Pengirim)</button>
              )}
              {t.docType==="TUG7" && t.stage==="PENDING_MGR_LOGISTIK" && hasRole(currentUser, "MGR_LOGISTIK_UIT") && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTUG7_MgrLogistik(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTUG7_MgrLogistik(t)}>✅ SETUJUI TUG-7 → Generate Draft TUG-8</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {/* TUG-5 dari ULTG — approval Manager ULTG */}
              {t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="PENDING_MGR_ULTG" && hasRole(currentUser, "MGR_ULTG") && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTUG5_MgrULTG(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTUG5_MgrULTG(t)}>✅ SETUJUI (Manager ULTG)</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
            </div>
          </div>
        );
      })}
      </>}
      {showTug && renderPager(tugPage, setTugPage, pendingTxns.length)}

      {/* Approval Import Kapasitas Gudang — TL/Asman saja */}
      {approvalTypeFilter==="ALL" && showCap && canApproveCap && pendingCapacityImports.length>0 && sectionHeading("📐","Kapasitas Gudang")}
      {showCap && canApproveCap && pagedCapacityImports.map(imp=>(
        <div key={imp.id} style={{...sty.card,marginBottom:12,borderLeft:"4px solid #f59e0b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div>
              <div style={{fontSize:11,color:"#92400e",fontWeight:800,textTransform:"uppercase"}}>Kapasitas Gudang — Menunggu Approval</div>
              <div style={{fontWeight:800,fontSize:13,marginTop:2}}>{imp.sourceFile}</div>
              <div style={{fontSize:11,color:C.muted}}>Diajukan {new Date(imp.importedAt).toLocaleString("id")} oleh {imp.importedBy}</div>
            </div>
            <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"#fefce8",color:"#92400e"}}>⏳ Pending</span>
          </div>
          <div style={{display:"flex",gap:14,fontSize:12,marginBottom:10}}>
            <span>Total: <b>{imp.totalRows}</b></span>
            <span style={{color:C.green}}>Valid: <b>{imp.validRows}</b></span>
            <span style={{color:C.red}}>Invalid: <b>{imp.invalidRows}</b></span>
          </div>
          <div style={{overflowX:"auto",maxHeight:200,overflowY:"auto",marginBottom:10,border:`1px solid ${C.border}`,borderRadius:8}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
                <tr>{["UPT","Gudang","Sub Gudang","Luas Lahan","Terpakai","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {imp.records.slice(0,50).map((r,i)=>(
                  <tr key={i} style={{borderTop:`1px solid ${C.border}`}}>
                    <td style={{padding:"4px 8px"}}>{r.upt}</td>
                    <td style={{padding:"4px 8px"}}>{r.gudang}</td>
                    <td style={{padding:"4px 8px"}}>{r.subGudang}</td>
                    <td style={{padding:"4px 8px",textAlign:"right"}}>{fmtNum(Math.round(r.luasLahanM2))}</td>
                    <td style={{padding:"4px 8px",textAlign:"right"}}>{fmtNum(Math.round(r.luasTerpakaiM2))}</td>
                    <td style={{padding:"4px 8px",fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {imp.records.length>50 && <div style={{fontSize:10,color:C.muted,padding:6,textAlign:"center"}}>+{imp.records.length-50} baris lainnya</div>}
          </div>
          {rejectingCapId===imp.id ? (
            <div style={{display:"flex",gap:8}}>
              <input style={{...sty.input,flex:1}} placeholder="Alasan penolakan..." value={capReason} onChange={e=>setCapReason(e.target.value)}/>
              <button style={sty.btn("danger","sm")} onClick={()=>{rejectCapacityImport(imp.id, capReason); setRejectingCapId(null); setCapReason("");}}>Kirim Penolakan</button>
              <button style={sty.btn("ghost","sm")} onClick={()=>{setRejectingCapId(null);setCapReason("");}}>Batal</button>
            </div>
          ) : (
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("success","sm")} onClick={()=>approveCapacityImport(imp.id)}>✅ Setujui & Publish</button>
              <button style={sty.btn("danger","sm")} onClick={()=>setRejectingCapId(imp.id)}>❌ Tolak</button>
            </div>
          )}
        </div>
      ))}
      {showCap && canApproveCap && renderPager(capPage, setCapPage, pendingCapacityImports.length)}

      {/* Approval Perubahan Lokasi/Blok — TL saja. Heading "Lokasi & Gudang" ini sengaja
          mencakup juga panel "Pemindahan Blok/Edit/Hapus Data Stok" yang dirender di parent
          SESUDAH ApprovalTab (lihat komentar pendingStockMoves di atas) — keduanya sama-sama
          soal lokasi fisik gudang, dan tidak ada konten lain di antaranya jadi tetap terlihat
          1 section yang sama. */}
      {approvalTypeFilter==="ALL" && showLokasi && (pendingLokasiChanges.length>0 || pendingStockCount>0) && sectionHeading("📍","Lokasi & Gudang")}
      {showLokasi && pagedLokasiChanges.map(l=>{
        const pemohon = users.find(u=>u.id===l.requestedBy);
        const aksiLabel = {ADD:"Tambah Blok Baru",EDIT:"Ubah Data Blok",DELETE:"Hapus Blok"}[l.pendingAction]||l.pendingAction;
        return (
          <div key={l.id} style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                <div style={{fontSize:11,color:"#92400e",fontWeight:800,textTransform:"uppercase"}}>Perubahan Lokasi/Blok</div>
                <div style={{fontSize:13,fontWeight:700,marginTop:2}}>{aksiLabel}: {l.pendingAction==="EDIT"?l.pendingData?.kode:l.kode}</div>
                <div style={{fontSize:11,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(l.requestedAt)}</div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button style={sty.btn("primary","sm")} onClick={()=>approveLokasiChange(l.id)}>✓ Setuju</button>
                <button style={sty.btn("danger","sm")} onClick={()=>rejectLokasiChange(l.id)}>✕ Tolak</button>
              </div>
            </div>
          </div>
        );
      })}
      {showLokasi && renderPager(lokasiPage, setLokasiPage, pendingLokasiChanges.length)}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:17,fontWeight:800,marginBottom:6}}>Lengkapi TUG-7</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:14}}>Pilih UPT Pengirim dan lengkapi administrasi.</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>UPT Pengirim *</label>
              <select style={sty.select} value={tug7Form.uptPengirimId||""} onChange={e=>setTug7Form(f=>({...f,uptPengirimId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {(uptList||[]).map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}><label style={sty.label}>Atas Beban Rekening</label><input style={sty.input} value={tug7Form.atasBebanRekening||""} onChange={e=>setTug7Form(f=>({...f,atasBebanRekening:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={tug7Form.perintahKerja||""} onChange={e=>setTug7Form(f=>({...f,perintahKerja:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Akun</label><input style={sty.input} value={tug7Form.kodeAkun||""} onChange={e=>setTug7Form(f=>({...f,kodeAkun:e.target.value}))}/></div>
              <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={tug7Form.fungsi||""} onChange={e=>setTug7Form(f=>({...f,fungsi:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug7Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG7_AdminUIT(tug7Modal,tug7Form);setTug7Modal(null);}}>📋 Submit → Menunggu Mgr Logistik</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
