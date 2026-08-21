// Komponen TUG3Tab — dipindah dari App.jsx (refactor Fase 5b).
import { useState } from "react";
import { UPT } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";

export function TUG3Tab({ txns, filterStatus, users, sty, C, currentUser, katalogList, lokasiList, timMutuList, approveTUG3_TL, rejectTUG3_TL, submitTUG4DanLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman, editDraftTug3, submitDraftTug3, deleteDraftTug3, handleImg, setDocPreview }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug4Modal, setTug4Modal] = useState(null); // txn being filled (TUG-4 + lampiran final)
  const [tug4Form, setTug4Form] = useState({});

  const filtered = filterStatus==="ALL" ? txns : txns.filter(t=>t.status===filterStatus || (filterStatus==="PENDING" && t.status==="PENDING"));

  function stageBadge(stage) {
    const map = {
      DRAFT: { label:"Draft", bg:"#f3f4f6", fg:"#4b5563" },
      PENDING_TL: { label:"Menunggu TL Logistik", bg:"#fef3c7", fg:"#92400e" },
      MENUNGGU_TUG4: { label:"Isi Form TUG-4", bg:"#dbeafe", fg:"#1e40af" },
      PENDING_ASMAN: { label:"Menunggu Asman Konstruksi", bg:"#fef3c7", fg:"#92400e" },
      APPROVED: { label:"APPROVED — Stok Bertambah", bg:"#dcfce7", fg:"#166534" },
      REJECTED: { label:"DITOLAK", bg:"#fee2e2", fg:"#991b1b" },
    };
    const m = map[stage] || { label:stage, bg:"#f3f4f6", fg:C.muted };
    return <span style={{padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,background:m.bg,color:m.fg}}>{m.label}</span>;
  }

  function openTug4Modal(txn) { setTug4Form({ timMutuId:"", lokasiPenyerahan:"", noSPK:"", tglSPK:"", hasilPemeriksaan:"Barang Diterima Sesuai Pengadaan" }); setTug4Modal(txn); }

  // Satu baris progres approval (TL/Asman) menggantikan 3 baris riwayat lama.
  function approvalLine(t, tlUser, asmanUser) {
    const parts = [];
    if (t.approvedByTL) parts.push(`TL ✓ ${tlUser.name||"-"}`);
    else if (t.stage==="PENDING_TL") parts.push("TL ⏳ menunggu");
    if (t.approvedByAsman) parts.push(`Asman ✓ ${asmanUser.name||"-"}`);
    else if (t.stage==="PENDING_ASMAN") parts.push("Asman ⏳ menunggu");
    return parts.join(" · ");
  }

  return (
    <div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada transaksi TUG-3</div>}
        {filtered.map(t=>{
          const tlUser = users.find(u=>u.id===t.approvedByTL)||{};
          const asmanUser = users.find(u=>u.id===t.approvedByAsman)||{};
          const tm = timMutuList.find(x=>x.id===t.timMutuId);
          const approval = approvalLine(t, tlUser, asmanUser);
          return (
            <div key={t.id} style={{...sty.card,padding:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",minWidth:0}}>
                  <span style={{fontWeight:800,fontSize:13}}>{t.dariSupplier}</span>
                  <span style={{fontSize:12,color:"#0098da",fontWeight:700}}>{t.docNumbers?.tug3 || (t.stage==="DRAFT" ? "Draft" : "-")}</span>
                  <span style={{fontSize:12,color:C.muted}}>{t.tanggalDiterima||"-"} · {t.stockItems.length} barang{tm ? ` · Tim: ${tm.label}` : ""}</span>
                </div>
                {stageBadge(t.stage)}
              </div>

              {approval && <div style={{fontSize:12,color:C.muted,marginBottom:6}}>{approval}</div>}

              <details style={{marginBottom:6}}>
                <summary style={{cursor:"pointer",color:C.muted,fontSize:12}}>Lihat item ({t.stockItems.length})</summary>
                <div style={{background:"#f9fafb",borderRadius: 10,padding:8,marginTop:4}}>
                  {t.stockItems.map((si,idx)=>{
                    const namaBarang = si.katalogMode==="existing" ? (katalogList.find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
                    return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {namaBarang} <b>x{si.qty}</b></div>;
                  })}
                </div>
              </details>

              {t.status==="REJECTED" && <div style={{fontSize:12,color:C.red,marginBottom:8}}>❌ Ditolak: {t.rejectReason}</div>}

              {rejectingId===t.id && (
                <div style={{marginBottom:10}}>
                  <input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/>
                </div>
              )}

              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {/* Edit: pembuat, selama belum di-approve TL (DRAFT atau PENDING_TL) */}
                {(t.stage==="DRAFT" || t.stage==="PENDING_TL") && t.createdBy===currentUser.id && (
                  <button style={sty.btn("ghost","sm")} onClick={()=>editDraftTug3(t)}>✏️ Edit</button>
                )}
                {/* Draft: hanya pembuat, belum diajukan */}
                {t.stage==="DRAFT" && t.createdBy===currentUser.id && (
                  <>
                    <button style={sty.btn("primary","sm")} onClick={()=>submitDraftTug3(t)}>📤 Ajukan ke TL</button>
                    <button style={sty.btn("danger","sm")} onClick={()=>{ if (window.confirm("Hapus draft TUG-3 ini?")) deleteDraftTug3(t); }}>🗑️ Hapus</button>
                  </>
                )}
                {/* Stage 1: TL approves Karantina */}
                {t.stage==="PENDING_TL" && hasRole(currentUser, "TL") && (
                  rejectingId===t.id ? (
                    <span className="approval-actions">
                      <button className="approval-btn--danger" onClick={()=>{rejectTUG3_TL(t,reason); setRejectingId(null); setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                      <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                    </span>
                  ) : (
                    <span className="approval-actions">
                      <button className="approval-btn--approve" onClick={()=>approveTUG3_TL(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui TUG-3 Karantina</button>
                      <button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                    </span>
                  )
                )}
                {/* Stage 2: Admin/TL isi TUG-4 + lampiran final sekaligus */}
                {t.stage==="MENUNGGU_TUG4" && hasRole(currentUser, "ADMIN","TL") && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openTug4Modal(t)}>📋 Isi Form TUG-4</button>
                )}
                {/* Stage 3: Asman approves final */}
                {t.stage==="PENDING_ASMAN" && hasRole(currentUser, "ASMAN") && (
                  rejectingId===t.id ? (
                    <span className="approval-actions">
                      <button className="approval-btn--danger" onClick={()=>{rejectTUG3Final_Asman(t,reason); setRejectingId(null); setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                      <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                    </span>
                  ) : (
                    <span className="approval-actions">
                      <button className="approval-btn--approve" onClick={()=>approveTUG3Final_Asman(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui Final (Stok Masuk)</button>
                      <button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                    </span>
                  )
                )}
                {t.stage!=="DRAFT" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat & Pratinjau Dokumen TUG-3 / TUG-4</button>}
              </div>
            </div>
          );
        })}
      </div>

      {/* TUG-4 + LAMPIRAN FINAL MODAL (digabung — satu langkah) */}
      {tug4Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:500,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:17,fontWeight:800,marginBottom:6}}>Isi Form TUG-4 (Pemeriksaan)</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>untuk {tug4Modal.docNumbers.tug3}</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Paket Tim Mutu</label>
              <select style={sty.select} value={tug4Form.timMutuId||""} onChange={e=>setTug4Form(f=>({...f,timMutuId:e.target.value}))}>
                <option value="">-- Pilih Paket --</option>
                {timMutuList.filter(tm=>!tug4Modal?.uptId||tm.uptId===tug4Modal.uptId).map(tm=><option key={tm.id} value={tm.id}>{tm.label}</option>)}
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
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug4Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG4DanLampiran(tug4Modal, tug4Form); setTug4Modal(null);}}>📋 Submit TUG-4</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
