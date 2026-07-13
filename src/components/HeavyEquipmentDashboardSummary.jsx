// Komponen HeavyEquipmentDashboardSummary — dipindah dari App.jsx (refactor Fase 4e).
import { UPT } from "../constants.js";
import { hasRole } from "../lib/roles.js";
import { getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt, getHeavyEquipmentLoanRuntimeStatus, isPendingHeavyEquipmentLoan, getEquipmentCategory } from "../lib/heavyEquipment.js";

export function HeavyEquipmentDashboardSummary({ equipmentList = [], loans = [], C, sty, setTab, currentUser }) {
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = hasRole(currentUser, "MSB","Manager UIT");
  const scopedEquipment = isMSB ? equipmentList : equipmentList.filter(e=>e.upt===myUpt);
  const scopedLoans = isMSB ? loans : loans.filter(l=>
    (getHeavyEquipmentLoanOwnerUpt(l)===myUpt)||(getHeavyEquipmentLoanRequesterUpt(l)===myUpt)
  );
  const scopeLabel = isMSB ? "Semua UPT" : (myUpt || "UPT");
  const overdueLoans = scopedLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="OVERDUE");
  const pendingLoans = scopedLoans.filter(isPendingHeavyEquipmentLoan);
  const borrowedLoans = scopedLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="DIPINJAM");
  const availableCount = scopedEquipment.filter(e=>e.availabilityStatus!=="DIPINJAM" && !["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
  const issueCount = scopedEquipment.filter(e=>["PERLU_SERVICE","RUSAK"].includes(e.statusAlat)).length;
  const catIcons = {
    crane:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="12" y="4" width="2.5" height="18" rx="1" fill="currentColor"/>
        <rect x="2" y="4" width="12" height="2" rx="1" fill="currentColor" opacity=".85"/>
        <line x1="12" y1="5" x2="24" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="10" y="20" width="6" height="5" rx="1" fill="currentColor" opacity=".7"/>
        <rect x="5" y="22" width="16" height="2.5" rx="1" fill="currentColor" opacity=".5"/>
      </svg>
    ),
    forklift:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="2" y="10" width="14" height="10" rx="2" fill="currentColor" opacity=".85"/>
        <rect x="16" y="14" width="8" height="6" rx="1" fill="currentColor" opacity=".6"/>
        <rect x="2" y="3" width="2.5" height="14" rx="1" fill="currentColor"/>
        <rect x="6" y="3" width="2.5" height="14" rx="1" fill="currentColor"/>
        <circle cx="6" cy="23" r="2.5" fill="currentColor"/>
        <circle cx="18" cy="23" r="2.5" fill="currentColor"/>
      </svg>
    ),
    manlift:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="9" y="2" width="10" height="8" rx="1.5" fill="currentColor" opacity=".85"/>
        <rect x="11" y="10" width="6" height="10" rx="1" fill="currentColor" opacity=".7"/>
        <rect x="6" y="18" width="16" height="4" rx="1.5" fill="currentColor" opacity=".5"/>
        <circle cx="9" cy="25" r="2" fill="currentColor"/>
        <circle cx="19" cy="25" r="2" fill="currentColor"/>
      </svg>
    ),
    pendukung:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="2" y="12" width="18" height="4" rx="1" fill="currentColor" opacity=".85"/>
        <path d="M18 14 Q22 14 22 8 L24 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
        <rect x="3" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        <rect x="11" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        <circle cx="5" cy="25" r="2" fill="currentColor"/>
        <circle cx="14" cy="25" r="2" fill="currentColor"/>
      </svg>
    ),
  };
  const catBreakdown = [
    {key:"crane",    label:"Crane"},
    {key:"forklift", label:"Forklift"},
    {key:"manlift",  label:"Manlift"},
    {key:"pendukung",label:"Alat Pendukung"},
  ].map(c=>({...c, count:scopedEquipment.filter(e=>getEquipmentCategory(e)===c.key).length}));

  if (equipmentList.length === 0 && loans.length === 0) return null;
  return (
    <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${overdueLoans.length?C.red:C.accent}`,cursor:"pointer"}} onClick={()=>setTab("heavyEquipment")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:14,fontWeight:900}}>🚜 Ringkasan Alat Berat</div>
          <div style={{fontSize:11,color:C.muted}}>Scope: <b>{scopeLabel}</b> — status peminjaman, ketersediaan &amp; kondisi alat.</div>
        </div>
        <button style={sty.btn("ghost","sm")} onClick={(e)=>{e.stopPropagation(); setTab("heavyEquipment");}}>Buka Menu</button>
      </div>

      {/* Kategori alat dengan icon */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:8,marginBottom:12}}>
        {catBreakdown.map(c=>(
          <div key={c.key} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 8px",background:"#f0f9ff",border:`1px solid #bae6fd`,borderRadius:10}}>
            <span style={{color:C.accent}}>{catIcons[c.key]}</span>
            <span style={{fontSize:20,fontWeight:900,color:C.accent}}>{c.count}</span>
            <span style={{fontSize:10,fontWeight:700,color:C.muted,textAlign:"center"}}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* KPI status */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8}}>
        {[
          {label:"Total", val:scopedEquipment.length, color:C.accent},
          {label:"Tersedia", val:availableCount, color:C.green},
          {label:"Dipinjam", val:borrowedLoans.length, color:"#c2410c"},
          {label:"Overdue", val:overdueLoans.length, color:overdueLoans.length?C.red:C.green},
          {label:"Pending", val:pendingLoans.length, color:pendingLoans.length?"#92400e":C.green},
          {label:"Perlu Tindakan", val:issueCount, color:issueCount?C.red:C.green},
        ].map(k=>(
          <div key={k.label} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:800,textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:900,color:k.color}}>{k.val}</div>
          </div>
        ))}
      </div>
      {/* Dipinjam aktif list */}
      {(borrowedLoans.length > 0 || overdueLoans.length > 0) && (
        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:4}}>
          {[...overdueLoans, ...borrowedLoans].slice(0,3).map(l=>{
            const status = getHeavyEquipmentLoanRuntimeStatus(l);
            const ownerUpt = getHeavyEquipmentLoanOwnerUpt(l);
            const requesterUpt = getHeavyEquipmentLoanRequesterUpt(l);
            const returnDate = getHeavyEquipmentLoanReturnDate(l);
            const jobName = getHeavyEquipmentLoanJobName(l);
            return (
              <div key={l.id} style={{fontSize:11,display:"flex",gap:6,alignItems:"center",padding:"4px 8px",borderRadius:6,background:status==="OVERDUE"?"#fef2f2":"#fff7ed"}}>
                <span style={{fontWeight:700,color:status==="OVERDUE"?C.red:"#c2410c",minWidth:54}}>{status==="OVERDUE"?"⚠ OVERDUE":"📌 Dipinjam"}</span>
                <span style={{color:C.text}}>{l.equipmentId||"-"}</span>
                <span style={{color:C.muted}}>→ {requesterUpt}</span>
                {!isMSB && ownerUpt!==myUpt && <span style={{color:C.muted,fontStyle:"italic"}}>dari {ownerUpt}</span>}
                <span style={{marginLeft:"auto",color:C.muted}}>s/d {returnDate||"-"}</span>
              </div>
            );
          })}
          {(borrowedLoans.length+overdueLoans.length)>3&&<div style={{fontSize:11,color:C.muted,paddingLeft:8}}>+{borrowedLoans.length+overdueLoans.length-3} peminjaman lainnya</div>}
        </div>
      )}
    </div>
  );
}
