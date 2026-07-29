// Komponen TUG3Tab — dipindah dari App.jsx (refactor Fase 5b).
import { useState } from "react";
import { UPT } from "../constants.js";
import { fmtDate } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";

export function TUG3Tab({ txns, filterStatus, users, sty, C, currentUser, katalogList, lokasiList, timMutuList, approveTUG3_TL, rejectTUG3_TL, submitTUG4Form, approveTUG4_Manager, rejectTUG4_Manager, submitTUG3FinalLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman, handleImg, setDocPreview }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug4Modal, setTug4Modal] = useState(null); // txn being filled
  const [tug4Form, setTug4Form] = useState({});
  const [finalModal, setFinalModal] = useState(null); // txn being finalized
  const [finalForm, setFinalForm] = useState({});

  const filtered = filterStatus==="ALL" ? txns : txns.filter(t => {
    const s = (t.status || "").toUpperCase();
    const st = (t.stage || "").toUpperCase();
    if (filterStatus === "PENDING") return s.includes("PENDING") || st.includes("PENDING") || st.startsWith("MENUNGGU_");
    if (filterStatus === "APPROVED") return s.includes("APPROVED") || st.includes("APPROVED");
    if (filterStatus === "REJECTED") return s.includes("REJECTED") || st.includes("REJECTED");
    if (filterStatus === "DRAFT") return s.includes("DRAFT") || st.includes("DRAFT");
    return s === filterStatus;
  });

  function stageBadge(stage) {
    const map = {
      PENDING_TL: { label:"Menunggu TL Logistik", bg:"#fef3c7", fg:"#92400e" },
      MENUNGGU_TUG4: { label:"Isi Form TUG-4", bg:"#dbeafe", fg:"#1e40af" },
      PENDING_MANAGER: { label:"Menunggu Manager", bg:"#fef3c7", fg:"#92400e" },
      MENUNGGU_FINAL: { label:"Lengkapi Lampiran Final", bg:"#dbeafe", fg:"#1e40af" },
      PENDING_ASMAN: { label:"Menunggu Asman Konstruksi", bg:"#fef3c7", fg:"#92400e" },
      APPROVED: { label:"APPROVED — Stok Bertambah", bg:"#dcfce7", fg:"#166534" },
      REJECTED: { label:"DITOLAK", bg:"#fee2e2", fg:"#991b1b" },
    };
    const m = map[stage] || { label:stage, bg:"#f3f4f6", fg:C.muted };
    return <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:m.bg,color:m.fg}}>{m.label}</span>;
  }

  function openTug4Modal(txn) { setTug4Form({ timMutuId:"", lokasiPenyerahan:"", hasilPemeriksaan:"Barang Diterima Sesuai Pengadaan" }); setTug4Modal(txn); }
  function openFinalModal(txn) { setFinalForm({ fotoKendaraan:null, fotoSimKtp:null, fotoSuratJalanImg:null, fotoKontrak:null }); setFinalModal(txn); }

  return (
    <div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada transaksi TUG-3</div>}
        {filtered.map(t=>{
          const creator = users.find(u=>u.id===t.createdBy)||{};
          const tlUser = users.find(u=>u.id===t.approvedByTL)||{};
          const mgrUser = users.find(u=>u.id===t.approvedByManager)||{};
          const asmanUser = users.find(u=>u.id===t.approvedByAsman)||{};
          const tm = timMutuList.find(x=>x.id===t.timMutuId);
          return (
            <div key={t.id} className="tug-card-enterprise">
              <div className="tug-card-header-bar">
                <div>
                  <div style={{fontWeight:700,fontSize:14,color:"#0f172a"}}>{t.dariSupplier}</div>
                  <div className="tug-doc-tag" style={{marginTop:3}}>{t.docNumbers?.tug3}</div>
                </div>
                {stageBadge(t.stage)}
              </div>
              <div style={{padding:16}}>
                <div style={{display:"flex",gap:20,fontSize:12,color:"#64748b",marginBottom:12,background:"#f8fafc",padding:"8px 12px",borderRadius:6,border:"1px solid #f1f5f9"}}>
                  <span><strong>Tanggal Diterima:</strong> {t.tanggalDiterima||"-"}</span>
                  <span><strong>Metode Kirim:</strong> {t.denganKirim||"Dikirim Langsung"}</span>
                  <span><strong>Diajukan Oleh:</strong> {creator.name||"-"}</span>
                </div>

                <table className="tug-table-preview">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Nama Barang / Material</th>
                      <th>Katalog</th>
                      <th style={{textAlign:"right"}}>Volume (Qty)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.stockItems.map((si,idx)=>{
                      const isExist = si.katalogMode==="existing";
                      const kat = isExist ? katalogList.find(k=>k.id===si.katalogId) : null;
                      const namaBarang = isExist ? (kat?.name||"?") : si.namaBaru;
                      const noKatalog = isExist ? (kat?.katalog||"-") : (si.katalogBaru||"-");
                      return (
                        <tr key={idx}>
                          <td style={{width:30,color:"#94a3b8"}}>{idx+1}</td>
                          <td style={{fontWeight:600}}>{namaBarang}</td>
                          <td style={{fontFamily:"monospace",color:"#0284c7"}}>{noKatalog}</td>
                          <td style={{textAlign:"right",fontWeight:700}}>{si.qty} BH</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {t.approvedByTL && <div style={{fontSize:12,color:"#166534",marginBottom:4,fontWeight:600}}>✓ TUG-3 Karantina disetujui TL: {tlUser.name} • {fmtDate(t.approvedAtTL)}</div>}
                {t.approvedByManager && <div style={{fontSize:12,color:"#166534",marginBottom:4,fontWeight:600}}>✓ TUG-4 disetujui Manager: {mgrUser.name} • {fmtDate(t.approvedAtManager)} {tm && `(Tim: ${tm.label})`}</div>}
                {t.approvedByAsman && <div style={{fontSize:12,color:"#166534",marginBottom:4,fontWeight:600}}>✓ TUG-3 Final disetujui Asman: {asmanUser.name} • {fmtDate(t.approvedAtAsman)}</div>}
                {t.status==="REJECTED" && <div style={{fontSize:12,color:"#b91c1c",marginBottom:8,fontWeight:600}}>✕ Ditolak: {t.rejectReason}</div>}

              {rejectingId===t.id && (
                <div style={{marginBottom:10}}>
                  <input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/>
                </div>
              )}

              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
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
                {/* Stage 2a: Admin/TL fills TUG-4 form */}
                {t.stage==="MENUNGGU_TUG4" && hasRole(currentUser, "ADMIN","TL") && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openTug4Modal(t)}>Isi Form TUG-4</button>
                )}
                {/* Stage 2b: Manager approves TUG-4 */}
                {t.stage==="PENDING_MANAGER" && hasRole(currentUser, "MANAGER") && (
                  rejectingId===t.id ? (
                    <span className="approval-actions">
                      <button className="approval-btn--danger" onClick={()=>{rejectTUG4_Manager(t,reason); setRejectingId(null); setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                      <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                    </span>
                  ) : (
                    <span className="approval-actions">
                      <button className="approval-btn--approve" onClick={()=>approveTUG4_Manager(t)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui TUG-4</button>
                      <button className="approval-btn--reject" onClick={()=>{setRejectingId(t.id);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                    </span>
                  )
                )}
                {/* Stage 3a: Admin/TL completes final lampiran */}
                {t.stage==="MENUNGGU_FINAL" && hasRole(currentUser, "ADMIN","TL") && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openFinalModal(t)}>Lengkapi Lampiran Final</button>
                )}
                {/* Stage 3b: Asman approves final */}
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
                <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>Lihat Dokumen TUG-3/4</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>

      {/* TUG-4 FORM MODAL */}
      {tug4Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Formulir TUG-4 — Pemeriksaan Mutu</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>untuk {tug4Modal.docNumbers.tug3}</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Paket Tim Mutu</label>
              <select style={sty.select} value={tug4Form.timMutuId||""} onChange={e=>setTug4Form(f=>({...f,timMutuId:e.target.value}))}>
                <option value="">-- Pilih Paket --</option>
                {timMutuList.map(tm=><option key={tm.id} value={tm.id}>{tm.label}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Lokasi Penyerahan</label>
              <input style={sty.input} value={tug4Form.lokasiPenyerahan||""} onChange={e=>setTug4Form(f=>({...f,lokasiPenyerahan:e.target.value}))} placeholder="cth: Gudang UPT Ketintang Surabaya"/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Hasil Pemeriksaan</label>
              <input style={sty.input} value={tug4Form.hasilPemeriksaan||""} onChange={e=>setTug4Form(f=>({...f,hasilPemeriksaan:e.target.value}))} placeholder="Barang Diterima Sesuai Pengadaan"/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug4Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG4Form(tug4Modal, tug4Form); setTug4Modal(null);}}>📋 Submit TUG-4</button>
            </div>
          </div>
        </div>
      )}

      {/* TUG-3 FINAL LAMPIRAN MODAL */}
      {finalModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:500,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Lampiran Final TUG-3</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>untuk {finalModal.docNumbers.tug3}</p>
            <div className="tug3-attachment-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={sty.label}>Foto Kendaraan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoKendaraan:img})))} style={{fontSize:12,color:C.muted}}/>
                {finalForm.fotoKendaraan && <img src={finalForm.fotoKendaraan} alt="kendaraan" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
              <div>
                <label style={sty.label}>SIM / KTP</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoSimKtp:img})))} style={{fontSize:12,color:C.muted}}/>
                {finalForm.fotoSimKtp && <img src={finalForm.fotoSimKtp} alt="sim ktp" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
              <div>
                <label style={sty.label}>Surat Jalan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoSuratJalanImg:img})))} style={{fontSize:12,color:C.muted}}/>
                {finalForm.fotoSuratJalanImg && <img src={finalForm.fotoSuratJalanImg} alt="surat jalan" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
              <div>
                <label style={sty.label}>Foto Kontrak</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoKontrak:img})))} style={{fontSize:12,color:C.muted}}/>
                {finalForm.fotoKontrak && <img src={finalForm.fotoKontrak} alt="kontrak" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setFinalModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG3FinalLampiran(finalModal, finalForm); setFinalModal(null);}}>📎 Submit Lampiran Final</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
