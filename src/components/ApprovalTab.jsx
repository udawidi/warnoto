// Komponen ApprovalTab — dipindah dari App.jsx (refactor Fase 5i).
import { useState, useEffect } from "react";
import { KAPASITAS_LABEL, UIT, UPT } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole } from "../lib/roles.js";
import { statusMaterialBadgeStyle, resolveSapLabel } from "../lib/sap.js";
import { normalizeKatalogCode, canonicalKatalogCode } from "../lib/normalizeKatalogCode.js";
import { TugFinalReviewModal } from "./TugFinalReviewModal.jsx";

export function ApprovalTab({ pendingTxns, stocks, katalogList, lokasiList, users, sty, C, approveTxn, rejectTxn, currentUser, uptList, submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik, konfirmasiDraftTUG8, gudangCapacityImports, approveCapacityImport, rejectCapacityImport, approveLokasiChange, rejectLokasiChange, ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, heavyEquipmentPendingCount, opnamePendingCount=0, stockCountPendingCount=0, approvalTypeFilter="ALL", approvalPageSize=10, prepareReview, deleteDraftTug3, editDraftTug3, editTug5, editTug10, openEditCanonicalTug, timMutuList, submitTUG4DanLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman, approveTUG3_TL, rejectTUG3_TL }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug7Form, setTug7Form] = useState({});
  const [tug7Modal, setTug7Modal] = useState(null);
  const [tug4Form, setTug4Form] = useState({});
  const [tug4Modal, setTug4Modal] = useState(null);
  const [tug3ReviewTxn, setTug3ReviewTxn] = useState(null);
  const [tug3Previewed, setTug3Previewed] = useState(false);
  function openTug4Modal(txn) {
    // Sama seperti TUG3Tab.jsx openTug4Modal — status SAP/Non-SAP per barang diputuskan
    // di sini (TL, tahap TUG-4), default dibawa dari pilihan form TUG-3.
    const itemSapStatus = txn.stockItems.map(si => si.sapStatus==="Non-SAP" ? "Non-SAP" : "SAP");
    setTug4Form({ timMutuId:"", lokasiPenyerahan: uptList.find(u=>u.id===txn.uptId)?.nama || "", noSPK:"", tglSPK:"", hasilPemeriksaan:"Barang Diterima Sesuai Pengadaan", itemSapStatus });
    setTug4Modal(txn);
  }
  const [rejectingCapId, setRejectingCapId] = useState(null);
  const [capReason, setCapReason] = useState("");
  const [tugPage, setTugPage] = useState(1);
  const [capPage, setCapPage] = useState(1);
  const [lokasiPage, setLokasiPage] = useState(1);
  const [reviewingTxn, setReviewingTxn] = useState(null);
  const [tugTypeFilter, setTugTypeFilter] = useState("ALL");
  useEffect(() => { setTugPage(1); setCapPage(1); setLokasiPage(1); }, [approvalTypeFilter, approvalPageSize, tugTypeFilter]);
  const canApproveCap = hasRole(currentUser, "TL","ASMAN");
  const pendingCapacityImports = (gudangCapacityImports||[]).filter(i=>i.status==="PENDING_ASMAN");
  const pendingLokasiChanges = hasRole(currentUser, "TL") ? (lokasiList||[]).filter(l=>l.status==="PENDING") : [];
  const showTug = approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG";
  const showCap = approvalTypeFilter==="ALL"||approvalTypeFilter==="KAPASITAS";
  const showLokasi = approvalTypeFilter==="ALL"||approvalTypeFilter==="LOKASI";
  const sortedTxns = [...pendingTxns].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  // Guard: TUG-3 penerimaan menambah stok, tapi qty item negatif (typo) bisa bikin
  // proyeksi stok minus — Asman tidak boleh approve dalam kondisi itu.
  const tug3Minus = tug3ReviewTxn ? tug3ReviewTxn.stockItems.some(si => {
    const stok = stocks.find(s=>s.katalogId===si.katalogId && s.lokasiId===si.lokasiTujuanId);
    return (stok ? stok.qty + si.qty : si.qty) < 0;
  }) : false;
  const TUG_TYPE_ORDER = ["TUG3","TUG5","TUG7","TUG8","TUG9","TUG10"];
  const tugTypeCounts = TUG_TYPE_ORDER.map(dt=>({ dt, count: sortedTxns.filter(t=>t.docType===dt).length })).filter(x=>x.count>0);
  const visibleTxns = tugTypeFilter==="ALL" ? sortedTxns : sortedTxns.filter(t=>t.docType===tugTypeFilter);
  const pagedTxns = showTug ? visibleTxns.slice((tugPage-1)*approvalPageSize, tugPage*approvalPageSize) : [];
  const pagedCapacityImports = showCap ? pendingCapacityImports.slice((capPage-1)*approvalPageSize, capPage*approvalPageSize) : [];
  const pagedLokasiChanges = showLokasi ? pendingLokasiChanges.slice((lokasiPage-1)*approvalPageSize, lokasiPage*approvalPageSize) : [];
  function renderPager(page, setPage, totalItems) {
    if (totalItems <= approvalPageSize) return null;
    const totalPages = Math.max(1, Math.ceil(totalItems/approvalPageSize));
    return (
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginTop:8,marginBottom:12}}>
        <button style={{...sty.btn("ghost","sm")}} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
        <span style={{fontSize:12,color:C.muted,padding:"0 4px"}}>Halaman {page} / {totalPages}</span>
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
    if (t.docType==="TUG8" && t.stage==="DRAFT_TUG8") return "Draft TUG-8 — Lengkapi & Ajukan";
    if (t.docType==="TUG3") {
      if (t.stage==="PENDING_TL") return "Menunggu TL Logistik";
      if (t.stage==="PENDING_MANAGER") return "Menunggu Manager (TUG-4)";
      if (t.stage==="PENDING_ASMAN") return "Menunggu Asman Final";
    }
    return "PENDING";
  }

  function docNoOf(t) {
    if (!t.docNumbers) return t.draftLabel || t.id;
    if (t.docType==="TUG5") return t.docNumbers?.tug5||t.draftLabel||t.id;
    if (t.docType==="TUG7") return t.docNumbers?.tug7||t.draftLabel||t.id;
    if (t.docType==="TUG9") return t.docNumbers?.tug9||t.draftLabel||t.id;
    if (t.docType==="TUG8") return t.docNumbers?.tug8||t.draftLabel||t.id;
    if (t.docType==="TUG10") return t.docNumbers?.tug10||t.draftLabel||t.id;
    if (t.docType==="TUG3") return t.docNumbers?.tug3||t.draftLabel||t.id;
    return t.id;
  }

  function itemsOf(t) {
    if (t.docType==="TUG10") return (t.stockItems||[]).map((si,i)=>{
      const nama = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
      const bs = statusMaterialBadgeStyle(si.statusMaterial);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {nama} <b>x{si.qty}</b> <span style={{padding:"2px 6px",borderRadius: 14,fontSize:12,background:bs.bg,color:bs.fg,fontWeight:700}}>{si.statusMaterial}</span></div>;
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
    return <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:0.5,textTransform:"uppercase",margin:"14px 0 10px",paddingBottom:6,borderBottom:`2px solid ${C.border}`}}>{icon} {text}</div>;
  }

  return (
    <div className="approval-queue">
      {pendingTxns.length===0 && pendingCapacityImports.length===0 && pendingLokasiChanges.length===0 && pendingStockCount===0 && !(heavyEquipmentPendingCount>0) && !(opnamePendingCount>0) && !(stockCountPendingCount>0) ? (
        <div className="approval-empty" style={{...sty.card,textAlign:"center",padding:40}}>
          <div className="approval-empty__icon">✓</div>
          <div style={{fontSize:15,fontWeight:800}}>Semua pengajuan sudah diproses</div>
          <div style={{fontSize:12,color:C.muted,marginTop:5}}>Tidak ada keputusan yang menunggu tindakan Anda.</div>
        </div>
      ) : !showTug ? null : <>
      {approvalTypeFilter==="ALL" && pendingTxns.length>0 && sectionHeading("📄","Transaksi TUG")}
      {pendingTxns.length>0 && tugTypeCounts.length>1 && (
        <div role="group" aria-label="Filter tipe TUG" style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
          <button type="button" aria-pressed={tugTypeFilter==="ALL"} onClick={()=>setTugTypeFilter("ALL")} style={{padding:"6px 12px",minHeight:36,borderRadius: 14,border:`1px solid ${tugTypeFilter==="ALL"?C.accent:C.border}`,background:tugTypeFilter==="ALL"?C.accent:(C.surface||"white"),color:tugTypeFilter==="ALL"?"white":C.muted,fontSize:12,fontWeight:tugTypeFilter==="ALL"?700:500,cursor:"pointer"}}>Semua ({sortedTxns.length})</button>
          {tugTypeCounts.map(({dt,count})=>{
            const active = tugTypeFilter===dt;
            return <button key={dt} type="button" aria-pressed={active} onClick={()=>setTugTypeFilter(dt)} style={{padding:"6px 12px",minHeight:36,borderRadius: 14,border:`1px solid ${active?C.accent:C.border}`,background:active?C.accent:(C.surface||"white"),color:active?"white":C.muted,fontSize:12,fontWeight:active?700:500,cursor:"pointer"}}>{dt.replace("TUG","TUG-")} ({count})</button>;
          })}
        </div>
      )}
      {pagedTxns.map(t=>{
        const creator = users.find(u=>u.id===t.createdBy)||{};
        const isTUG8Draft = t.docType==="TUG8" && t.stage==="DRAFT_TUG8";
        const isTUG7Draft = t.docType==="TUG7" && t.stage==="DRAFT_UIT";
        const isTUG10 = t.docType==="TUG10";
        const stageColor = isTUG7Draft||isTUG8Draft?"#7c3aed":C.yellow;
        // Strip atas per jenis TUG untuk beda cepat: MASUK (TUG-3 terima, TUG-10 retur) hijau,
        // KELUAR (TUG-8/9 pengeluaran) merah, TUG-5 reservasi biru, TUG-7 ungu.
        const tugStripColor = ({TUG3:"#16a34a",TUG10:"#10b981",TUG8:"#dc2626",TUG9:"#ef4444",TUG5:"#2563eb",TUG7:"#7c3aed"})[t.docType] || "#94a3b8";
        return (
          <div key={t.id} className="approval-card" style={{...sty.card,marginBottom:12,borderTop:`4px solid ${tugStripColor}`,borderLeft:`4px solid ${stageColor}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:12,color:stageColor,fontWeight:800,textTransform:"uppercase"}}>{t.docType==="TUG5" && t.sourceType==="ULTG" ? "Slip Reservasi" : t.docType.replace("TUG","TUG-")} — {stageLabelOf(t)}</div>
                <div style={{fontSize:15,fontWeight:800}}>{t.namaPekerjaan||t.keteranganUmum||docNoOf(t)}</div>
                <div style={{fontSize:12,color:"#0098da",fontWeight:700}}>{docNoOf(t)}</div>
                {creator.name && <div style={{fontSize:12,color:C.muted}}>Diajukan: {creator.name} ({ROLES[creator.role]}) • {fmtDate(t.createdAt)}</div>}
              </div>
              <span style={{padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,background:"#fef3c7",color:"#92400e"}}>
                {isTUG8Draft?"DRAFT":isTUG7Draft?"DRAFT UIT":"PENDING"}
              </span>
            </div>

            {/* Info khusus per tipe */}
            {isTUG8Draft && (
              <div tabIndex={0} className="info-note" style={{background:"#f3e8ff",border:`1px solid #c4b5fd`,borderRadius: 10,padding:"6px 10px",fontSize:12,color:"#7c3aed",marginBottom:8}}>
                📦 Draft TUG-8 dari TUG-7 {t.noReferensiTug7} — UPT Pengirim: {t.lokasiPekerjaan}. Lengkapi data lalu ajukan; nomor resmi dibuat oleh server.
              </div>
            )}
            {isTUG10 && (
              <div style={{background:"#dcfce7",border:`1px solid #86efac`,borderRadius: 10,padding:"6px 10px",fontSize:12,color:"#166534",marginBottom:8}}>
                ℹ️ Pengembalian material — stok akan BERTAMBAH saat disetujui.
              </div>
            )}
            {t.docType==="TUG5" && t.sourceType==="ULTG" && (
              <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius: 10,padding:"6px 10px",fontSize:12,color:"#1d4ed8",marginBottom:8}}>
                🏘️ Dari ULTG {(ultgList||[]).find(u=>u.id===t.ultgId)?.nama||t.ultgId||"-"} — setelah disetujui, siap di-adopt Admin/TL UPT induk menjadi TUG-9.
              </div>
            )}
            {t.docType==="TUG5" && t.sourceType!=="ULTG" && (
              <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius: 10,padding:"6px 10px",fontSize:12,color:"#1d4ed8",marginBottom:8}}>
                {t.jenisTransfer==="INTRACOMPANY"?"🔄 Intracompany — setelah approved akan generate draft TUG-7 di UIT":"🌐 Intercompany — setelah approved akan generate draft TUG-5 UIT"}
              </div>
            )}

            {/* Items */}
            <div style={{background:"#f9fafb",borderRadius: 10,padding:8,border:`1px solid ${C.border}`,marginBottom:10}}>
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
            <div className="approval-actions">
              {/* TUG-9/8/10 standard approval */}
              {["TUG9","TUG8"].includes(t.docType) && !isTUG8Draft && (
                rejectingId===t.id
                  ? <><button className="approval-btn--danger" onClick={()=>{rejectTxn(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button className="approval-btn--approve" onClick={()=>t.canonical ? setReviewingTxn(t) : approveTxn(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>{t.canonical ? "Periksa Transaksi" : "Setujui"}</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></>
              )}
              {t.docType==="TUG10" && (
                rejectingId===t.id
                  ? <><button className="approval-btn--danger" onClick={()=>{rejectTxn(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button className="approval-btn--approve" onClick={()=>approveTxn(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui — Stok Masuk</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></>
              )}
              {/* TUG-8 Draft dari TUG-7 */}
              {isTUG8Draft && hasRole(currentUser, "ADMIN","TL") && (
                <button className="approval-btn--approve" onClick={()=>konfirmasiDraftTUG8(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Lengkapi & Ajukan TUG-8</button>
              )}
              {/* TUG-7 Draft UIT */}
              {isTUG7Draft && hasRole(currentUser, "ADMIN_UIT") && (
                <button className="approval-btn--primary" onClick={()=>{setTug7Form({uptPengirimId:"",atasBebanRekening:"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>Lengkapi TUG-7 (Pilih UPT Pengirim)</button>
              )}
              {t.docType==="TUG7" && t.stage==="PENDING_MGR_LOGISTIK" && hasRole(currentUser, "MGR_LOGISTIK_UIT") && (
                rejectingId===t.id
                  ? <><button className="approval-btn--danger" onClick={()=>{rejectTUG7_MgrLogistik(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button className="approval-btn--approve" onClick={()=>approveTUG7_MgrLogistik(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui TUG-7 → Draft TUG-8</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></>
              )}
              {/* TUG-3 PENDING_TL — approve/tolak TUG-3 Karantina, plus Hapus permanen (beda dari Tolak/REJECTED) */}
              {t.docType==="TUG3" && t.stage==="PENDING_TL" && hasRole(currentUser, "TL") && (
                rejectingId===t.id
                  ? <><button className="approval-btn--danger" onClick={()=>{rejectTUG3_TL(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button className="approval-btn--approve" onClick={()=>approveTUG3_TL(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui TUG-3 Karantina</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button><button className="approval-btn--danger" onClick={()=>{ if (window.confirm(`Hapus ${docNoOf(t)}? Tindakan ini permanen.`)) deleteDraftTug3?.(t); }}><span className="approval-btn__ic" aria-hidden="true">🗑️</span>Hapus</button></>
              )}
              {/* TUG-3 MENUNGGU_TUG4 — TL isi form TUG-4 (Tim Mutu, Lokasi, hasil pemeriksaan) */}
              {t.docType==="TUG3" && t.stage==="MENUNGGU_TUG4" && hasRole(currentUser, "TL") && (
                <button className="approval-btn--primary" onClick={()=>openTug4Modal(t)}>📋 Isi Form TUG-4</button>
              )}
              {/* TUG-3 PENDING_ASMAN — approval final Asman, stok bertambah */}
              {t.docType==="TUG3" && t.stage==="PENDING_ASMAN" && hasRole(currentUser, "ASMAN") && (
                rejectingId===t.id
                  ? <><button className="approval-btn--danger" onClick={()=>{rejectTUG3Final_Asman(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button className="approval-btn--primary" onClick={()=>{setTug3Previewed(false);setTug3ReviewTxn(t);}}>📋 Periksa & Setujui</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></>
              )}
              {/* TUG-5 dari ULTG — approval Manager ULTG */}
              {t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="PENDING_MGR_ULTG" && hasRole(currentUser, "MGR_ULTG") && (
                rejectingId===t.id
                  ? <><button className="approval-btn--danger" onClick={()=>{rejectTUG5_MgrULTG(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button className="approval-btn--approve" onClick={()=>approveTUG5_MgrULTG(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui (Manager ULTG)</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></>
              )}
              {/* TL/SUPERADMIN bisa perbaiki file ajuan admin yang salah input, tanpa reject-recreate */}
              {/* TUG-3 hanya editable in-place di stage PENDING_TL; stage MENUNGGU_TUG4/PENDING_ASMAN kalau diedit akan renumber+regress (isEditInPlace cuma cek PENDING_TL) */}
              {hasRole(currentUser, "TL","SUPERADMIN") && t.status==="PENDING" && rejectingId!==t.id && ["TUG3","TUG5","TUG8","TUG9","TUG10"].includes(t.docType) && (t.docType!=="TUG3" || t.stage==="PENDING_TL") && (
                <button className="approval-btn--cancel" onClick={()=>{
                  if (t.docType==="TUG3") editDraftTug3?.(t);
                  else if (t.docType==="TUG10") editTug10?.(t);
                  else if (t.docType==="TUG5") editTug5?.(t);
                  else if (["TUG8","TUG9"].includes(t.docType)) openEditCanonicalTug?.(t);
                }}><span className="approval-btn__ic" aria-hidden="true">✏️</span>Perbaiki</button>
              )}
            </div>
          </div>
        );
      })}
      </>}
      {showTug && renderPager(tugPage, setTugPage, visibleTxns.length)}

      {/* Approval Import Kapasitas Gudang — TL/Asman saja */}
      {approvalTypeFilter==="ALL" && showCap && canApproveCap && pendingCapacityImports.length>0 && sectionHeading("📐","Kapasitas Gudang")}
      {showCap && canApproveCap && pagedCapacityImports.map(imp=>(
        <div key={imp.id} className="approval-card" style={{...sty.card,marginBottom:12,borderLeft:"4px solid #f59e0b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div>
              <div style={{fontSize:12,color:"#92400e",fontWeight:800,textTransform:"uppercase"}}>Kapasitas Gudang — Menunggu Approval</div>
              <div style={{fontWeight:800,fontSize:13,marginTop:2}}>{imp.sourceFile}</div>
              <div style={{fontSize:12,color:C.muted}}>Diajukan {new Date(imp.importedAt).toLocaleString("id")} oleh {imp.importedBy}</div>
            </div>
            <span style={{padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,background:"#fefce8",color:"#92400e"}}>⏳ Pending</span>
          </div>
          <div style={{display:"flex",gap:14,fontSize:12,marginBottom:10}}>
            <span>Total: <b>{imp.totalRows}</b></span>
            <span style={{color:C.green}}>Valid: <b>{imp.validRows}</b></span>
            <span style={{color:C.red}}>Invalid: <b>{imp.invalidRows}</b></span>
          </div>
          <div className="mobile-card-table" style={{overflowX:"auto",maxHeight:200,overflowY:"auto",marginBottom:10,border:`1px solid ${C.border}`,borderRadius: 10}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
                <tr>{["UPT","Gudang","Sub Gudang","Luas Lahan","Terpakai","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {imp.records.slice(0,50).map((r,i)=>(
                  <tr tabIndex={0} className="mobile-card-table__row" key={i} style={{borderTop:`1px solid ${C.border}`}}>
                    <td data-label="UPT" style={{padding:"4px 8px"}}>{r.upt}</td>
                    <td data-label="Gudang" className="mobile-card-table__title" style={{padding:"4px 8px"}}>{r.gudang}</td>
                    <td data-label="Sub Gudang" style={{padding:"4px 8px"}}>{r.subGudang}</td>
                    <td data-label="Luas Lahan" style={{padding:"4px 8px",textAlign:"right"}}>{fmtNum(Math.round(r.luasLahanM2))}</td>
                    <td data-label="Terpakai" style={{padding:"4px 8px",textAlign:"right"}}>{fmtNum(Math.round(r.luasTerpakaiM2))}</td>
                    <td data-label="Status" style={{padding:"4px 8px",fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {imp.records.length>50 && <div style={{fontSize:12,color:C.muted,padding:6,textAlign:"center"}}>+{imp.records.length-50} baris lainnya</div>}
          </div>
          {rejectingCapId===imp.id ? (
            <>
              <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={capReason} onChange={e=>setCapReason(e.target.value)}/></div>
              <div className="approval-actions">
                <button className="approval-btn--danger" onClick={()=>{rejectCapacityImport(imp.id, capReason); setRejectingCapId(null); setCapReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Kirim Penolakan</button>
                <button className="approval-btn--cancel" onClick={()=>{setRejectingCapId(null);setCapReason("");}}>Batal</button>
              </div>
            </>
          ) : (
            <div className="approval-actions">
              <button className="approval-btn--approve" onClick={()=>approveCapacityImport(imp.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui & Publish</button>
              <button className="approval-btn--reject" onClick={()=>setRejectingCapId(imp.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
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
          <div key={l.id} className="approval-card" style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,color:"#92400e",fontWeight:800,textTransform:"uppercase"}}>Perubahan Lokasi/Blok</div>
                <div style={{fontSize:13,fontWeight:700,marginTop:2}}>{aksiLabel}: {l.pendingAction==="EDIT"?l.pendingData?.kode:l.kode}</div>
                <div style={{fontSize:12,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(l.requestedAt)}</div>
              </div>
              <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                <button className="approval-btn--approve" onClick={()=>approveLokasiChange(l.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                <button className="approval-btn--reject" onClick={()=>rejectLokasiChange(l.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
              </div>
            </div>
          </div>
        );
      })}
      {showLokasi && renderPager(lokasiPage, setLokasiPage, pendingLokasiChanges.length)}

      {reviewingTxn && <TugFinalReviewModal txn={reviewingTxn} stocks={stocks} katalogList={katalogList} users={users} pendingTxns={pendingTxns} sty={sty} C={C} prepareReview={async txn => prepareReview ? prepareReview(txn) : { unavailable:true }} onApprove={async review => { const ok = await approveTxn(reviewingTxn, review); if (ok) setReviewingTxn(null); }} onClose={()=>setReviewingTxn(null)} />}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
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
            <div className="approval-tug7-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
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

      {/* TUG-4 lengkapi modal (sama seperti TUG3Tab.jsx, supaya bisa langsung dari menu Approval) */}
      {tug4Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:500,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:17,fontWeight:800,marginBottom:6}}>Isi Form TUG-4 (Pemeriksaan)</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>untuk {tug4Modal.docNumbers.tug3}</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Paket Tim Mutu</label>
              <select style={sty.select} value={tug4Form.timMutuId||""} onChange={e=>setTug4Form(f=>({...f,timMutuId:e.target.value}))}>
                <option value="">-- Pilih Paket --</option>
                {(timMutuList||[]).filter(tm=>!tug4Modal?.uptId||tm.uptId===tug4Modal.uptId).map(tm=><option key={tm.id} value={tm.id}>{tm.label}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Lokasi Penyerahan</label>
              <input style={sty.input} value={tug4Form.lokasiPenyerahan||""} onChange={e=>setTug4Form(f=>({...f,lokasiPenyerahan:e.target.value}))} placeholder="cth: Gudang UPT Ketintang Surabaya"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>No. Surat Perjanjian / SPK</label>
              <input style={sty.input} value={tug4Form.noSPK||""} onChange={e=>setTug4Form(f=>({...f,noSPK:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Tanggal SPK</label>
              <input type="date" style={sty.input} value={tug4Form.tglSPK||""} onChange={e=>setTug4Form(f=>({...f,tglSPK:e.target.value}))}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Hasil Pemeriksaan</label>
              <input style={sty.input} value={tug4Form.hasilPemeriksaan||""} onChange={e=>setTug4Form(f=>({...f,hasilPemeriksaan:e.target.value}))} placeholder="Barang Diterima Sesuai Pengadaan"/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Status SAP per Barang</label>
              {tug4Modal.stockItems.map((si, idx) => {
                const katalogCode = canonicalKatalogCode(si.katalogMode==="existing"
                  ? (katalogList.find(k=>k.id===si.katalogId)?.katalog || "")
                  : normalizeKatalogCode(si.katalogBaru || ""));
                const status = tug4Form.itemSapStatus?.[idx] || "SAP";
                const label = status==="Non-SAP" ? "Non-SAP" : resolveSapLabel(katalogCode, "SAP");
                return (
                  <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"6px 0",borderBottom:idx<tug4Modal.stockItems.length-1?`1px solid ${C.border}`:"none"}}>
                    <span style={{fontSize:13}}>{si.namaBaru || katalogList.find(k=>k.id===si.katalogId)?.name || `Barang ${idx+1}`} <span style={{color:C.muted,fontSize:12}}>({label})</span></span>
                    <button type="button" style={sty.btn(status==="Non-SAP"?"ghost":"primary")} onClick={()=>setTug4Form(f=>{
                      const next = [...(f.itemSapStatus||tug4Modal.stockItems.map(()=>"SAP"))];
                      next[idx] = next[idx]==="Non-SAP" ? "SAP" : "Non-SAP";
                      return {...f, itemSapStatus: next};
                    })}>{status==="Non-SAP" ? "Jadikan SAP" : "Jadikan Non-SAP"}</button>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug4Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{ const ok = await submitTUG4DanLampiran(tug4Modal, tug4Form); if (ok !== false) setTug4Modal(null); }}>📋 Submit TUG-4</button>
            </div>
          </div>
        </div>
      )}

      {/* TUG-3 review final Asman — wajib buka preview dokumen sebelum boleh approve, stok bertambah */}
      {tug3ReviewTxn && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:600,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:.5}}>WAJIB PERIKSA SEBELUM APPROVAL FINAL</div>
            <h3 style={{fontSize:17,fontWeight:800,margin:"4px 0 10px"}}>Penerimaan TUG-3 / {tug3ReviewTxn.docNumbers?.tug3}</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,fontSize:12,marginBottom:14}}>
              <div><b>Nomor</b><br/>{tug3ReviewTxn.docNumbers?.tug3 || "-"}</div>
              <div><b>UPT</b><br/>{uptList.find(u=>u.id===tug3ReviewTxn.uptId)?.nama || "-"}</div>
              <div><b>Pekerjaan</b><br/>{tug3ReviewTxn.namaPekerjaan || tug3ReviewTxn.pekerjaan || "-"}</div>
              <div><b>Supplier/Penerima</b><br/>{tug3ReviewTxn.dariSupplier || "-"}</div>
            </div>
            <details style={{border:`1px solid ${C.border}`,borderRadius:10,padding:8,marginBottom:14}} onToggle={e=>{if(e.currentTarget.open)setTug3Previewed(true);}}>
              <summary style={{cursor:"pointer",fontWeight:700}}>Buka preview dokumen — barang yang akan diterima</summary>
              <div className="mobile-card-table" style={{overflowX:"auto",marginTop:8}}>
                <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"#f8fafc"}}><th style={{padding:6,textAlign:"left"}}>Material</th><th style={{padding:6,textAlign:"right"}}>Qty</th><th style={{padding:6,textAlign:"right"}}>Stok saat ini</th><th style={{padding:6,textAlign:"right"}}>Proyeksi</th></tr></thead>
                  <tbody>
                    {tug3ReviewTxn.stockItems.map((si, idx) => {
                      const nama = si.namaBaru || katalogList.find(k=>k.id===si.katalogId)?.name || `Barang ${idx+1}`;
                      const satuan = si.katalogMode==="existing" ? katalogList.find(k=>k.id===si.katalogId)?.satuan : si.satuanBaru;
                      const stok = stocks.find(s=>s.katalogId===si.katalogId && s.lokasiId===si.lokasiTujuanId);
                      return (
                        <tr key={idx} style={{borderTop:`1px solid ${C.border}`}}>
                          <td style={{padding:6}}>{nama}</td>
                          <td style={{padding:6,textAlign:"right"}}>{fmtNum(si.qty)} {satuan||""}</td>
                          <td style={{padding:6,textAlign:"right"}}>{stok ? fmtNum(stok.qty) : "baru"}</td>
                          <td style={{padding:6,textAlign:"right",fontWeight:700,color:(stok ? stok.qty + si.qty : si.qty) < 0 ? "#b91c1c" : undefined}}>{stok ? fmtNum(stok.qty + si.qty) : `+${fmtNum(si.qty)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug3ReviewTxn(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!tug3Previewed || tug3Minus} onClick={()=>{approveTUG3Final_Asman(tug3ReviewTxn);setTug3ReviewTxn(null);}}>✓ Setujui — Stok Masuk</button>
            </div>
            {tug3Minus && <div style={{fontSize:12,color:"#b91c1c",fontWeight:700,marginTop:7}}>Proyeksi stok minus — approval diblokir. Periksa qty barang (tidak boleh negatif).</div>}
            {!tug3Previewed && !tug3Minus && <div style={{fontSize:12,color:C.muted,marginTop:7}}>Buka preview dokumen terlebih dahulu sebelum menyetujui.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
