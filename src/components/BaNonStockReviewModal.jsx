import { useEffect, useState } from "react";
import { fmtDate } from "../lib/utils.js";

const CHECKS = [
  ["identity", "UPT, gudang, satpam, pengirim, tujuan, dan penerima sudah diperiksa."],
  ["items", "Material, qty, satuan, dan keperluan sudah sesuai."],
  ["evidence", "Dua foto bukti dan preview dokumen sudah diperiksa."],
];

export function BaNonStockReviewModal({ record, C, sty, onLoad, onApprove, onReject, onClose, onPreview, uptList=[], gudangList=[], satpamList=[], users=[] }) {
  const [fresh,setFresh] = useState(record);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [previewed,setPreviewed] = useState(false);
  const [checked,setChecked] = useState({});
  const [reason,setReason] = useState("");
  const [error,setError] = useState("");
  useEffect(()=>{let alive=true;setFresh(record);setError("");setLoading(true);Promise.resolve(onLoad?.(record)).then(row=>{if(alive&&row)setFresh(row);}).catch(()=>{if(alive)setError("Data BA terbaru tidak dapat dimuat.");}).finally(()=>alive&&setLoading(false));return()=>{alive=false}},[record?.id]);
  const data=fresh||record;
  const readOnly=["APPROVED","REJECTED"].includes(data?.status);
  const label=(list,id)=>list.find(item=>item.id===id)?.nama||list.find(item=>item.id===id)?.name||list.find(item=>item.id===id)?.data?.nama||id||"-";
  const uptName=label(uptList,data.uptId);
  const gudangName=label(gudangList,data.gudangId);
  const satpamName=data.satpamNama||label(satpamList,data.satpamId);
  const creatorName=label(users,data.createdBy);
  const approverName=data.tlNama||data.tlSnapshot?.name||label(users,data.approvedBy||data.rejectedBy||data.tlSnapshot?.id||data.tlId);
  const recipientUnit=[data.penerimaUnit,data.penerimaPerusahaan].filter(Boolean).join(" · ")||"-";
  const materialRows=data.items||[];
  const missingChecks=CHECKS.filter(([key])=>!checked[key]).map(([,label])=>label);
  const canApprove=!loading&&!busy&&!error&&!readOnly&&previewed&&CHECKS.every(([key])=>checked[key]);
  function printBa() {
    // Membuka cetakan adalah pemeriksaan preview yang diwajibkan sebelum approval.
    setPreviewed(true);
    onPreview?.(data);
  }
  async function reloadLatest(){setLoading(true);setError("");try{const row=await onLoad?.(data);if(row)setFresh(row);}catch(error){setError(error?.message||"Data BA terbaru tidak dapat dimuat.");}finally{setLoading(false);}}
  async function reloadAfterFailure(message){setError(message);try{const row=await onLoad?.(data);if(row)setFresh(row);}catch(error){setError(`${message} ${error?.message||"Data terbaru juga gagal dimuat."}`);}}
  async function approve(){if(!canApprove)return;setBusy(true);setError("");try{const ok=await onApprove?.(data);if(ok)onClose?.();else await reloadAfterFailure("Approval gagal karena data BA berubah.");}finally{setBusy(false)}}
  async function reject(){if(!reason.trim())return setError("Alasan penolakan wajib diisi.");setBusy(true);setError("");try{const ok=await onReject?.(data,reason.trim());if(ok)onClose?.();else await reloadAfterFailure("Penolakan gagal karena data BA berubah.");}finally{setBusy(false)}}
  return <div role="dialog" aria-modal="true" aria-label="Periksa BA Non Stock sebelum approval" style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{...sty.card,width:760,maxWidth:"100%",maxHeight:"92dvh",overflowY:"auto"}}>
      <div style={sty.modalHeader}><div><strong>Periksa BA Non Stock / Pinjam</strong><div style={{fontSize:12,opacity:.85}}>{data.docNumber||"Belum bernomor"} · {uptName}</div></div><button type="button" onClick={onClose} disabled={busy} aria-label="Tutup" style={{background:"transparent",border:0,color:"white",fontSize:24}}>×</button></div>
      {loading&&<div role="status" style={{padding:16,color:C.muted}}>Memuat snapshot BA terbaru…</div>}
      {!loading&&<div style={{padding:16}}>
        {error&&<div style={{color:C.red,background:"#fee2e2",padding:10,borderRadius:8,marginBottom:12}}>{error}<button type="button" style={{...sty.btn("ghost","sm"),marginLeft:8}} onClick={reloadLatest} disabled={busy||loading}>Coba Lagi</button></div>}
        {!readOnly&&!loading&&!error&&<div role="status" style={{color:canApprove?C.green:C.muted,background:canApprove?"#dcfce7":"#f8fafc",padding:10,borderRadius:8,marginBottom:12,fontSize:12}}>{canApprove?"Semua syarat terpenuhi. BA siap disetujui.":<>Syarat Setujui: {previewed?"preview sudah dibuka":"buka preview"}; {missingChecks.length?`${missingChecks.length} checklist belum dicentang`:"semua checklist sudah dicentang"}.</>}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,fontSize:12,marginBottom:14}}>{[["Status",data.status === "APPROVED" ? "Disetujui" : data.status === "REJECTED" ? "Ditolak" : data.status],["UPT",uptName],["Jenis",data.jenis === "NON_STOCK" ? "Non Stock" : data.jenis],["Tanggal transaksi",data.tanggal],["Gudang",gudangName],["Satpam",satpamName],["Pengirim",data.sumber],["Tujuan",data.tujuan],["Dokumen referensi",data.referensi||data.referenceDocument],["Penerima",data.penerimaNama],["Unit/perusahaan penerima",recipientUnit],["Jabatan",data.penerimaJabatan],["Keperluan",data.keperluan],["Diajukan oleh",creatorName],["Waktu diajukan",fmtDate(data.submittedAt||data.createdAt)],["TL approver",approverName],["Waktu diputus",fmtDate(data.approvedAt||data.rejectedAt)]].map(([fieldLabel,value])=><div key={fieldLabel}><b>{fieldLabel}</b><br/>{value||"-"}</div>)}</div>
        <details open={readOnly} onToggle={event=>{if(event.currentTarget.open)setPreviewed(true)}} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:10,marginBottom:12}}><summary style={{cursor:"pointer",fontWeight:700}}>Buka preview dokumen final</summary><div style={{marginTop:10}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr><th style={{textAlign:"left",padding:6}}>Material</th><th style={{textAlign:"right",padding:6}}>Qty</th><th style={{textAlign:"left",padding:6}}>Satuan</th><th style={{textAlign:"left",padding:6}}>Keterangan</th></tr></thead><tbody>{materialRows.map((item,index)=><tr key={index} style={{borderTop:`1px solid ${C.border}`}}><td style={{padding:6}}>{item.materialName||item.nama||"-"}</td><td style={{padding:6,textAlign:"right"}}>{item.qty??"-"}</td><td style={{padding:6}}>{item.unit||item.satuan||"-"}</td><td style={{padding:6}}>{item.keterangan||item.description||"-"}</td></tr>)}</tbody></table></div></details>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>{[["Foto label / packing list",data.photoLabelUrl||data.foto1],["Foto material dimuat",data.photoLoadedUrl||data.foto2]].map(([label,url])=><div key={label}><div style={{fontSize:12,fontWeight:700,marginBottom:5}}>{label}</div>{url?<img src={url} alt={label} style={{width:"100%",maxHeight:180,objectFit:"contain",border:`1px solid ${C.border}`,borderRadius:8}}/>:<div style={{padding:20,color:C.red,border:`1px solid ${C.border}`,borderRadius:8}}>Foto belum tersedia</div>}</div>)}</div>
        {!readOnly && CHECKS.map(([key,label])=><label key={key} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12,marginBottom:8}}><input type="checkbox" checked={!!checked[key]} onChange={event=>setChecked(value=>({...value,[key]:event.target.checked}))} disabled={busy}/><span>{label}{key==="evidence"&&!previewed?" (buka preview terlebih dahulu)":""}</span></label>)}
        {!readOnly && <label style={{display:"block",fontSize:12,fontWeight:700,marginTop:12}}>Alasan penolakan (isi bila menolak)<textarea style={{...sty.input,width:"100%",minHeight:70,marginTop:5}} value={reason} onChange={event=>setReason(event.target.value)} disabled={busy}/></label>}
        <div className="approval-actions" style={{marginTop:14}}><button className="approval-btn--cancel" onClick={onClose} disabled={busy}>Kembali</button><button type="button" style={sty.btn("ghost","sm")} onClick={printBa} disabled={busy}>🖨️ Print BA</button>{!readOnly && <><button className="approval-btn--reject" onClick={reject} disabled={busy||!reason.trim()}>Tolak</button><button className="approval-btn--approve" onClick={approve} disabled={!canApprove}>{busy?"Memproses…":"Setujui BA"}</button></>}</div>
      </div>}
    </div>
  </div>;
}
