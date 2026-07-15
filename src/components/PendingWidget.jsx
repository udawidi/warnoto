// Komponen PendingWidget — dipindah dari App.jsx (refactor Fase 4d).

export function PendingWidget({ myPendingApprovals, C, sty, setTab }) {
  if (myPendingApprovals.length===0) return null;
  return (
    <div style={{...sty.card,borderLeft:`4px solid #f59e0b`,marginBottom:16}}>
      <h3 style={{fontSize:13,fontWeight:700,color:"#92400e",marginBottom:10}}>⏳ Butuh Tindakan ({myPendingApprovals.length})</h3>
      {myPendingApprovals.slice(0,4).map(t=>{
        const docNo = t.docNumbers?.[t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":t.docType==="TUG10"?"tug10":t.docType==="TUG5"?"tug5":t.docType==="TUG7"?"tug7":"tug3"]||t.id;
        const label = t.docType==="TUG5"?t.keteranganUmum||"Permintaan Material":t.docType==="TUG7"?`TUG-7 → ${t.unitPenerima||"UPT"}`:t.namaPekerjaan||"-";
        return (
          <div key={t.id} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:12,fontWeight:600}}>{label}</div>
              <div style={{fontSize:12,color:"#0098da"}}>{t.docType.replace("TUG","TUG-")} • {docNo}</div>
            </div>
            <button style={sty.btn("primary","sm")} onClick={()=>setTab("approval")}>Review</button>
          </div>
        );
      })}
      {myPendingApprovals.length>4 && <div style={{fontSize:12,color:C.muted,marginTop:6,textAlign:"center"}}>+{myPendingApprovals.length-4} lainnya</div>}
    </div>
  );
}
