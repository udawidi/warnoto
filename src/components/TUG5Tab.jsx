// Komponen TUG5Tab — dipindah dari App.jsx (refactor Fase 5b).
import { useState } from "react";
import { UIT, UPT } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";

export function TUG5Tab({ txns, filterStatus, users, sty, C, currentUser, katalogList, uitList, uptList,
  approveTUG5_Asman, rejectTUG5_Asman, approveTUG5_Manager, rejectTUG5_Manager,
  submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik,
  konfirmasiDraftTUG8, setDocPreview,
  ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, adoptTUG5ULTG, openDraftTug9, isMobile=false }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug7Modal, setTug7Modal] = useState(null);
  const [tug7Form, setTug7Form] = useState({});
  const [ultgExpandedId, setUltgExpandedId] = useState(null); // id TUG-5 ULTG yang sedang dibuka penuh
  const [ultgListPage, setUltgListPage] = useState(0); // 5 per halaman

  // Show TUG-5 + TUG-7 drafts + TUG-8 drafts (from TUG-7) all in one view
  const tug5Txns = txns.filter(t=>t.docType==="TUG5"&&!t.docSubType&&t.sourceType!=="ULTG");
  const tug5UltgTxns = txns.filter(t=>t.docType==="TUG5"&&t.sourceType==="ULTG").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const tug7Txns = txns.filter(t=>t.docType==="TUG7");
  const tug8Drafts = txns.filter(t=>t.docType==="TUG8"&&t.stage==="DRAFT_TUG8");

  // Pool pengajuan ULTG yang sudah disetujui Manager ULTG, siap di-adopt Admin/TL UPT induknya.
  // currentUser.uptId biasanya kosong untuk akun ADMIN/TL biasa — fallback cocokkan nama UPT
  // konstan global ke Master UPT (sama seperti pola appUptShort di komponen lain).
  const appUptShort5 = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const currentUserUptId = currentUser?.uptId
    || (ultgList||[]).find(u=>u.id===currentUser?.ultgId)?.parentUptId
    || (uptList||[]).find(u=>String(u.nama||"").toUpperCase().includes(appUptShort5.toUpperCase()))?.id;
  const ultgPoolAdopt = hasRole(currentUser, "ADMIN","TL") ? tug5UltgTxns.filter(t =>
    t.stage==="APPROVED_ULTG" && !t.adoptedBy &&
    (currentUser?.role==="SUPERADMIN" || (ultgList||[]).find(u=>u.id===t.ultgId)?.parentUptId === currentUserUptId)
  ) : [];

  function stageBadge5(t) {
    const map = {
      PENDING_ASMAN:{label:"Menunggu Asman",bg:"#fef3c7",fg:"#92400e"},
      PENDING_MANAGER:{label:"Menunggu Manager",bg:"#fef3c7",fg:"#92400e"},
      PENDING_MGR_ULTG:{label:"Menunggu Manager ULTG",bg:"#fef3c7",fg:"#92400e"},
      APPROVED_ULTG:{label:t.adoptedBy?"Sudah Diadopsi":"Siap Diadopsi UPT",bg:t.adoptedBy?"#dcfce7":"#e0f2fe",fg:t.adoptedBy?"#166534":"#0369a1"},
      APPROVED:{label:"APPROVED",bg:"#dcfce7",fg:"#166534"},
      REJECTED:{label:"DITOLAK",bg:"#fee2e2",fg:"#991b1b"},
    };
    const m = map[t.stage]||{label:t.stage,bg:"#f3f4f6",fg:"#6b7280"};
    return <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:m.bg,color:m.fg}}>{m.label}</span>;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* TUG-5 Permintaan UPT — disembunyikan untuk role ULTG (tidak relevan bagi mereka) */}
      {!hasRole(currentUser, "ADMIN_ULTG","MGR_ULTG") && (
      <>
      <div style={{fontSize:13,fontWeight:800,color:C.accent,borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginBottom:4}}>📋 TUG-5 — Permintaan Barang UPT</div>
      {tug5Txns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-5.</div>}
      {tug5Txns.map(t=>{
        const uit = uitList.find(u=>u.id===t.uitId);
        const creator = users.find(u=>u.id===t.createdBy)||{};
        return (
          <div key={t.id} style={{...sty.card}}>
            <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug5}</div>
                <div style={{fontSize:12,color:C.muted}}>Kepada: {uit?.kode||"-"} • {t.jenisTransfer} • {fmtDate(t.createdAt)}</div>
                <div style={{fontSize:12,color:C.muted}}>👷 {creator.name} • {t.keteranganUmum||"-"}</div>
              </div>
              {stageBadge5(t)}
            </div>
            <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
              {(t.stockItems||[]).map((si,idx)=>{
                const kat = katalogList.find(k=>k.id===si.katalogId);
                return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>Permintaan: {si.permintaan}</b> {kat?.satuan} {si.keterangan&&<span style={{color:C.muted}}>— {si.keterangan}</span>}</div>;
              })}
            </div>
            {t.status==="REJECTED" && <div style={{fontSize:12,color:C.red,marginBottom:8}}>❌ {t.rejectReason}</div>}
            {rejectingId===t.id && <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/></div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {t.stage==="PENDING_ASMAN" && hasRole(currentUser, "ASMAN") && (
                rejectingId===t.id
                  ? <span className="approval-actions"><button className="approval-btn--danger" onClick={()=>{rejectTUG5_Asman(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></span>
                  : <span className="approval-actions"><button className="approval-btn--approve" onClick={()=>approveTUG5_Asman(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui (Asman)</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></span>
              )}
              {t.stage==="PENDING_MANAGER" && hasRole(currentUser, "MANAGER") && (
                rejectingId===t.id
                  ? <span className="approval-actions"><button className="approval-btn--danger" onClick={()=>{rejectTUG5_Manager(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></span>
                  : <span className="approval-actions"><button className="approval-btn--approve" onClick={()=>approveTUG5_Manager(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui (Manager) → Generate {t.jenisTransfer==="INTRACOMPANY"?"TUG-7":"TUG-5 UIT"}</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></span>
              )}
              {t.stage==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat Dokumen TUG-5</button>}
            </div>
          </div>
        );
      })}
      </>
      )}

      {/* TUG-5 dari ULTG */}
      {(hasRole(currentUser, "ADMIN_ULTG","MGR_ULTG","ADMIN","TL")) && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:"#0369a1",borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>🏘️ TUG-5 — Permintaan Material dari ULTG</div>
          {currentUser.role==="MGR_ULTG" && !currentUser.ultgId && (
            <div style={{...sty.card,background:"#fef2f2",border:"1px solid #fecaca",color:"#991b1b",fontSize:12,padding:12,marginBottom:8}}>
              ⚠️ Akun kamu belum terhubung ke unit ULTG manapun, jadi tombol "Setujui" tidak akan muncul di list manapun. Hubungi Admin untuk melengkapi field ULTG di profil kamu.
            </div>
          )}
          {tug5UltgTxns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-5 dari ULTG.</div>}
          {tug5UltgTxns.slice(ultgListPage*5, ultgListPage*5+5).map(t=>{
            const ultg = (ultgList||[]).find(u=>u.id===t.ultgId);
            const creator = users.find(u=>u.id===t.createdBy)||{};
            const canApprove = t.stage==="PENDING_MGR_ULTG" && (currentUser.role==="SUPERADMIN" || (currentUser.role==="MGR_ULTG" && t.ultgId===currentUser.ultgId));
            const canAdopt = t.stage==="APPROVED_ULTG" && !t.adoptedBy && hasRole(currentUser, "ADMIN","TL") &&
              (currentUser.role==="SUPERADMIN" || ultg?.parentUptId === currentUserUptId);
            const isExpanded = ultgExpandedId===t.id;

            if (!isExpanded) {
              return (
                <div key={t.id} style={{display:"flex",alignItems:isMobile?"stretch":"center",flexDirection:isMobile?"column":"row",gap:10,border:`1px solid ${C.border}`,borderLeft:"3px solid #0369a1",borderRadius:8,padding:"8px 12px",marginBottom:6,background:"white",cursor:"pointer"}} onClick={()=>setUltgExpandedId(t.id)}>
                  <span style={{fontWeight:700,fontSize:12}}>{t.docNumbers?.tug5}</span>
                  <span style={{fontSize:12,color:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ultg?.nama||t.ultgId} • {t.namaPekerjaan||t.keteranganUmum||"-"} • {fmtDate(t.createdAt)}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {stageBadge5(t)}
                    {canAdopt && <span style={{fontSize:12,fontWeight:700,color:"#0369a1"}}>👉 Siap Diadopsi</span>}
                  </div>
                </div>
              );
            }

            return (
              <div key={t.id} style={{...sty.card,borderLeft:"3px solid #0369a1"}}>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug5}</div>
                    <div style={{fontSize:12,color:C.muted}}>Dari: {ultg?.nama||t.ultgId} • {fmtDate(t.createdAt)}</div>
                    <div style={{fontSize:12,color:C.muted}}>👤 {creator.name} • {t.namaPekerjaan||t.keteranganUmum||"-"}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {stageBadge5(t)}
                    <button type="button" style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>setUltgExpandedId(null)}>▲ Tutup</button>
                  </div>
                </div>
                <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                  {(t.stockItems||[]).map((si,idx)=>{
                    const kat = katalogList.find(k=>k.id===si.katalogId);
                    return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>Permintaan: {si.permintaan}</b> {kat?.satuan} {si.keterangan&&<span style={{color:C.muted}}>— {si.keterangan}</span>}</div>;
                  })}
                </div>
                {t.status==="REJECTED" && <div style={{fontSize:12,color:C.red,marginBottom:8}}>❌ {t.rejectReason}</div>}
                {t.adoptedBy && <div style={{fontSize:12,color:C.green,marginBottom:8}}>✅ Sudah diadopsi, jadi draft TUG-9</div>}
                {rejectingId===t.id && <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/></div>}
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {canApprove && (
                    rejectingId===t.id
                      ? <span className="approval-actions"><button className="approval-btn--danger" onClick={()=>{rejectTUG5_MgrULTG(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></span>
                      : <span className="approval-actions"><button className="approval-btn--approve" onClick={()=>approveTUG5_MgrULTG(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui (Manager ULTG)</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></span>
                  )}
                  {canAdopt && (
                    <button style={sty.btn("primary","sm")} onClick={async()=>{ const draft = await adoptTUG5ULTG(t); if(draft) openDraftTug9(draft); }}>📋 Adopt → Buat Draft TUG-9</button>
                  )}
                  {(t.stage==="APPROVED_ULTG"||t.status==="APPROVED") && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat Dokumen TUG-5</button>}
                </div>
              </div>
            );
          })}
          {tug5UltgTxns.length>5 && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4,marginBottom:8}}>
              <button type="button" style={sty.btn("ghost","sm")} disabled={ultgListPage===0} onClick={()=>setUltgListPage(p=>Math.max(0,p-1))}>← Sebelumnya</button>
              <span style={{fontSize:12,color:C.muted}}>Halaman {ultgListPage+1} dari {Math.ceil(tug5UltgTxns.length/5)}</span>
              <button type="button" style={sty.btn("ghost","sm")} disabled={(ultgListPage+1)*5>=tug5UltgTxns.length} onClick={()=>setUltgListPage(p=>p+1)}>Selanjutnya →</button>
            </div>
          )}
        </>
      )}

      {/* TUG-7 Perintah Penyerahan (UIT) */}
      {(hasRole(currentUser, "ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN","TL","ASMAN","MANAGER")) && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:"#7c3aed",borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>🏢 TUG-7 — Perintah Penyerahan Barang (Level UIT)</div>
          {tug7Txns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-7.</div>}
          {tug7Txns.map(t=>{
            const uptPengirim = uptList.find(u=>u.id===t.uptPengirimId);
            const tug5Ref = txns.find(x=>x.id===t.tug5Id);
            return (
              <div key={t.id} style={{...sty.card,borderLeft:`3px solid #7c3aed`}}>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug7||t.id}</div>
                    <div style={{fontSize:12,color:C.muted}}>Ref TUG-5: {tug5Ref?.docNumbers?.tug5||t.tug5DocNo||"-"}</div>
                    <div style={{fontSize:12,color:C.muted}}>UPT Pengirim: {uptPengirim?.nama||"Belum ditentukan"} • Penerima: {t.unitPenerima}</div>
                  </div>
                  <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:t.stage==="APPROVED"?"#dcfce7":t.stage==="DRAFT_UIT"?"#f3e8ff":"#fef3c7",color:t.stage==="APPROVED"?"#166534":t.stage==="DRAFT_UIT"?"#7c3aed":"#92400e"}}>
                    {t.stage==="DRAFT_UIT"?"Draft (Perlu dilengkapi Admin UIT)":t.stage==="PENDING_MGR_LOGISTIK"?"Menunggu Mgr Logistik":t.stage==="APPROVED"?"APPROVED":"DITOLAK"}
                  </span>
                </div>
                <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                  {(t.stockItems||[]).map((si,idx)=>{
                    const kat = katalogList.find(k=>k.id===si.katalogId);
                    return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>x{si.qty||si.permintaan}</b> {kat?.satuan}</div>;
                  })}
                </div>
                {rejectingId===t.id && <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/></div>}
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {t.stage==="DRAFT_UIT" && hasRole(currentUser, "ADMIN_UIT") && (
                    <button style={sty.btn("primary","sm")} onClick={()=>{setTug7Form({uptPengirimId:t.uptPengirimId||"",atasBebanRekening:t.atasBebanRekening||"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>📝 Lengkapi TUG-7</button>
                  )}
                  {t.stage==="PENDING_MGR_LOGISTIK" && hasRole(currentUser, "MGR_LOGISTIK_UIT") && (
                    rejectingId===t.id
                      ? <span className="approval-actions"><button className="approval-btn--danger" onClick={()=>{rejectTUG7_MgrLogistik(t,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button><button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button></span>
                      : <span className="approval-actions"><button className="approval-btn--approve" onClick={()=>approveTUG7_MgrLogistik(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui TUG-7 → Generate Draft TUG-8</button><button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></span>
                  )}
                  {t.stage==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat TUG-7</button>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Draft TUG-8 dari TUG-7 (perlu konfirmasi UPT Pengirim) */}
      {tug8Drafts.length>0 && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:C.green,borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>📦 Draft TUG-8 — Perlu Konfirmasi UPT Pengirim</div>
          {tug8Drafts.map(t=>(
            <div key={t.id} style={{...sty.card,borderLeft:`3px solid ${C.green}`}}>
              <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug8||t.id}</div>
                  <div style={{fontSize:12,color:C.muted}}>Berdasarkan: {t.noReferensiTug7} • Tujuan: {t.unitTujuan}</div>
                  <div style={{fontSize:12,color:C.muted}}>UPT Pengirim: {t.lokasiPekerjaan}</div>
                </div>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:"#dcfce7",color:"#166534"}}>DRAFT</span>
              </div>
              <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                {(t.stockItems||[]).map((si,idx)=>{
                  const kat = katalogList.find(k=>k.id===si.katalogId);
                  return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>x{si.qty}</b> {kat?.satuan}</div>;
                })}
              </div>
              <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",borderRadius:6,padding:"6px 10px",marginBottom:8}}>⚠️ Draft ini perlu dikonfirmasi oleh Admin Gudang / TL UPT Pengirim sebelum masuk antrian approval TUG-8.</div>
              {hasRole(currentUser, "ADMIN","TL") && (
                <div className="approval-actions"><button className="approval-btn--approve" onClick={()=>konfirmasiDraftTUG8(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Konfirmasi — Aktifkan TUG-8 ini</button></div>
              )}
            </div>
          ))}
        </>
      )}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Lengkapi TUG-7</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Pilih UPT Pengirim dan lengkapi administrasi.</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>UPT Pengirim *</label>
              <select style={sty.select} value={tug7Form.uptPengirimId||""} onChange={e=>setTug7Form(f=>({...f,uptPengirimId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {uptList.filter(u=>u.uitId===tug7Modal.uitId).map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}><label style={sty.label}>Atas Beban Rekening</label><input style={sty.input} value={tug7Form.atasBebanRekening||""} onChange={e=>setTug7Form(f=>({...f,atasBebanRekening:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:8,marginBottom:16}}>
              <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={tug7Form.perintahKerja||""} onChange={e=>setTug7Form(f=>({...f,perintahKerja:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Akun</label><input style={sty.input} value={tug7Form.kodeAkun||""} onChange={e=>setTug7Form(f=>({...f,kodeAkun:e.target.value}))}/></div>
              <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={tug7Form.fungsi||""} onChange={e=>setTug7Form(f=>({...f,fungsi:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug7Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG7_AdminUIT(tug7Modal,tug7Form);setTug7Modal(null);}}>📋 Submit TUG-7 → Menunggu Manager Logistik</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
