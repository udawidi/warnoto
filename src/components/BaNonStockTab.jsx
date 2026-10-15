import { useMemo, useState } from "react";
import { hasRole } from "../lib/roles.js";
import { BaNonStockFormModal } from "./BaNonStockFormModal.jsx";

export function BaNonStockTab({ C, sty, currentUser, records=[], onSave, onSubmit, onApprove, onReject, onPreview, gudangList=[], satpamList=[], users=[], currentUptId, isMobile }) {
  const [open,setOpen] = useState(false);
  const [query,setQuery] = useState("");
  const [editing,setEditing] = useState(null);
  const list = useMemo(() => records.filter(record => !query || JSON.stringify(record).toLowerCase().includes(query.toLowerCase())), [records,query]);
  return <div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><input type="search" style={{...sty.input,flex:"1 1 240px"}} placeholder="Cari BA atau material…" value={query} onChange={event=>setQuery(event.target.value)} />{hasRole(currentUser,"ADMIN","SUPERADMIN")&&<button style={sty.btn("primary","sm")} onClick={()=>{setEditing(null);setOpen(true)}}>+ Buat BA Non Stock / Pinjam</button>}</div>
    {!list.length && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada BA Non Stock / Pinjam.</div>}
    {list.map(record=><div key={record.id} style={{...sty.card,marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>{record.docNumber || "Belum bernomor"} · {record.jenis === "PINJAM" ? "Pinjam" : "Non Stock"}</strong><span style={sty.statusBadge(record.status)}>{record.status === "PENDING" ? "Menunggu TL" : record.status}</span></div>
      <div style={{fontSize:12,color:C.muted,marginTop:5}}>{record.penerimaNama || "Penerima belum diisi"} · {record.items?.length || 0} material · {record.tanggal || "-"}</div>
      {record.rejectionReason && <div style={{fontSize:12,color:C.red,marginTop:5}}>Alasan penolakan: {record.rejectionReason}</div>}
      <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
        <button style={sty.btn("ghost","sm")} onClick={()=>onPreview?.(record)}>Pratinjau</button>
        {hasRole(currentUser,"ADMIN","SUPERADMIN") && ["DRAFT","REJECTED"].includes(record.status) && <button style={sty.btn("ghost","sm")} onClick={()=>{setEditing(record);setOpen(true)}}>Edit</button>}
        {hasRole(currentUser,"TL","SUPERADMIN") && record.stage === "PENDING_TL" && <><button className="approval-btn--approve" onClick={()=>onApprove?.(record)}>✓ Setujui</button><button className="approval-btn--reject" onClick={()=>onReject?.(record)}>✕ Tolak</button></>}
      </div>
    </div>)}
    {open&&<BaNonStockFormModal C={C} sty={sty} currentUser={currentUser} initialValue={editing} onClose={()=>setOpen(false)} onSave={onSave} onSubmit={onSubmit} gudangList={gudangList} satpamList={satpamList} users={users} currentUptId={currentUptId} isMobile={isMobile} />}
  </div>;
}
