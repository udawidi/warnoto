// Komponen HeavyEquipmentTabV2 — dipindah dari App.jsx (refactor Fase 5b).
import { useState } from "react";
import { UIT, UPT } from "../constants.js";
import { hasRole } from "../lib/roles.js";
import { downloadHeavyEquipmentLoanHTML } from "../lib/docBuilders.js";
import { canApproveHeavyEquipmentLoan, getEquipmentCategory, getHeavyEquipmentLoanJobName, getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt, getHeavyEquipmentLoanReturnDate, getHeavyEquipmentLoanRuntimeStatus, getHeavyEquipmentLoanStartDate, isPendingHeavyEquipmentLoan, normalizeHeavyEquipmentLoanStatus } from "../lib/heavyEquipment.js";
import { OperationsHero } from "./OperationsHero.jsx";

export function HeavyEquipmentTabV2({ equipmentList, loans, currentUser, users, sty, C, handleImg, saveEdit, createLoan, approveLoan, rejectLoan, completeLoan, showToast }) {
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = hasRole(currentUser, "MSB","Manager UIT");
  // Dulu 2 sub-tab terpisah ("List Alat" vs "Peminjaman & Histori") dengan filter UPT yang
  // di-reset kontradiktif tiap pindah tab (list pakai UPT sendiri, loans di-reset ke "Semua UPT"
  // padahal unifiedLoans-nya sendiri tidak pernah benar-benar difilter UPT) — digabung jadi 1
  // halaman tunggal (permintaan user 2026-07-06). `effectiveUptFilter` jadi SATU sumber kebenaran
  // scoping: non-MSB dikunci ke UPT sendiri (tidak bisa diubah — mereka cuma boleh urus UPT-nya),
  // MSB/Manager UIT tetap bebas pilih "Semua UPT" atau fokus ke 1 UPT tertentu via dropdown.
  const [viewMode, setViewMode] = useState("armada");
  const [myUptSelected, setMyUptSelected] = useState(isMSB ? "" : (myUpt || ""));
  const effectiveUptFilter = isMSB ? myUptSelected : (myUpt || "");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [kondisiFilter, setKondisiFilter] = useState("ALL");
  const [loanCategoryFilter, setLoanCategoryFilter] = useState("ALL");
  const [loanForm, setLoanForm] = useState({equipmentId:"", requesterUpt:myUpt||"", namaPekerjaan:"", tanggalAmbil:"", tanggalKembali:"", keperluan:"", catatan:""});
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [editForm, setEditForm] = useState({statusAlat:"LAYAK", foto:null});

  const normalizedLoans = loans.map(l=>({
    ...l,
    ownerUpt:getHeavyEquipmentLoanOwnerUpt(l),
    requesterUpt:getHeavyEquipmentLoanRequesterUpt(l),
    tanggalAmbil:getHeavyEquipmentLoanStartDate(l),
    tanggalKembali:getHeavyEquipmentLoanReturnDate(l),
    namaPekerjaan:getHeavyEquipmentLoanJobName(l),
    runtimeStatus:getHeavyEquipmentLoanRuntimeStatus(l),
  })).sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  // Loan yang MENYANGKUT UPT yang sedang di-scope (pemilik ATAU peminjam) — dulu tidak ada
  // filter UPT sama sekali di sini, jadi peminjaman antar 2 UPT lain (sama sekali tidak
  // melibatkan UPT Surabaya) ikut nongol ke semua orang yang buka menu ini. Dipakai untuk
  // Overdue panel, KPI ringkasan, dan Peminjaman & Histori sekaligus supaya konsisten.
  const scopedLoans = normalizedLoans.filter(l => !effectiveUptFilter || l.ownerUpt===effectiveUptFilter || l.requesterUpt===effectiveUptFilter);
  const uptOptions = Array.from(new Set([
    ...equipmentList.map(e=>e.upt),
    ...normalizedLoans.map(l=>l.ownerUpt),
    ...normalizedLoans.map(l=>l.requesterUpt),
  ].filter(Boolean))).sort();
  const canManage = hasRole(currentUser, "ADMIN","TL");
  // Ajukan Peminjaman = "kita mau pinjam alat", jadi alat yang ditawarkan HARUS di luar UPT
  // sendiri (non-MSB) — pinjam alat sendiri lewat form sendiri tidak masuk akal. MSB/Manager UIT
  // memfasilitasi peminjaman UPT mana pun, jadi tetap lihat semua alat.
  const borrowableEquipment = equipmentList.filter(e => e.availabilityStatus!=="DIPINJAM" && !["MAINTENANCE","KIR"].includes(e.statusAlat) && (isMSB || e.upt!==myUpt));
  const selectedEquipment = equipmentList.find(e=>e.id===loanForm.equipmentId);
  const requesterOptions = selectedEquipment ? uptOptions.filter(u=>u!==selectedEquipment.upt) : uptOptions;
  const pendingCount = scopedLoans.filter(isPendingHeavyEquipmentLoan).length;
  const dipinjamCount = scopedLoans.filter(l=>l.runtimeStatus==="DIPINJAM").length;
  const overdueCount = scopedLoans.filter(l=>l.runtimeStatus==="OVERDUE").length;
  const issueCount = equipmentList.filter(e=>["PERLU_SERVICE","RUSAK"].includes(e.statusAlat)).length;
  const availableCount = equipmentList.filter(e=>e.availabilityStatus!=="DIPINJAM" && !["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
  const maintenanceCount = equipmentList.filter(e=>e.statusAlat==="MAINTENANCE").length;

  // 5 status alat yang bisa dipilih Admin/TL lewat tombol Edit Alat
  const STATUS_ALAT_OPTIONS = [
    {value:"LAYAK", label:"Layak"},
    {value:"MAINTENANCE", label:"Maintenance"},
    {value:"PERLU_SERVICE", label:"Perlu Servis"},
    {value:"RUSAK", label:"Rusak"},
    {value:"KIR", label:"Sedang KIR"},
  ];

  const statusMeta = {
    LAYAK:{label:"Layak", bg:"#dcfce7", fg:C.green},
    PERLU_SERVICE:{label:"Perlu Servis", bg:"#fef3c7", fg:"#92400e"},
    RUSAK:{label:"Rusak", bg:"#fee2e2", fg:C.red},
    KIR:{label:"Sedang KIR", bg:"#dbeafe", fg:"#1d4ed8"},
    TERSEDIA:{label:"Tersedia", bg:"#e0f2fe", fg:"#0369a1"},
    DIPINJAM:{label:"Dipinjam", bg:"#ffedd5", fg:"#c2410c"},
    MAINTENANCE:{label:"Maintenance", bg:"#e5e7eb", fg:"#4b5563"},
    PENDING_OWNER_ASMAN:{label:"Menunggu Asman Pemilik", bg:"#fef3c7", fg:"#92400e"},
    OVERDUE:{label:"Overdue", bg:"#fee2e2", fg:C.red},
    REJECTED:{label:"Ditolak", bg:"#fee2e2", fg:C.red},
    SELESAI:{label:"Selesai", bg:"#e0f2fe", fg:"#0369a1"},
  };
  const Badge = ({metaKey}) => {
    const key = normalizeHeavyEquipmentLoanStatus(metaKey);
    const m = statusMeta[key] || {label:key, bg:"#f3f4f6", fg:C.muted};
    return <span style={{padding:"3px 9px",borderRadius:20,fontSize:12,fontWeight:800,background:m.bg,color:m.fg,whiteSpace:"nowrap"}}>{m.label}</span>;
  };
  const loanBorderColor = status => status==="OVERDUE" ? C.red : status==="PENDING_OWNER_ASMAN" ? C.yellow : status==="DIPINJAM" ? "#c2410c" : status==="REJECTED" ? C.red : "#0369a1";
  const loanUserName = userId => users.find(u=>u.id===userId)?.name || "-";
  const latestLoanForEquipment = equipmentId => normalizedLoans.find(l=>l.equipmentId===equipmentId);
  const activeLoanForEquipment = equipmentId => normalizedLoans.find(l=>l.equipmentId===equipmentId && ["DIPINJAM","OVERDUE"].includes(l.runtimeStatus));

  const EQUIPMENT_CATEGORIES = [
    { id:"ALL", label:"Semua", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" opacity=".7"/><rect x="16" y="2" width="10" height="10" rx="2" fill="currentColor" opacity=".5"/><rect x="2" y="16" width="10" height="10" rx="2" fill="currentColor" opacity=".5"/><rect x="16" y="16" width="10" height="10" rx="2" fill="currentColor" opacity=".3"/></svg>
    )},
    { id:"crane", label:"Crane", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Truck body */}
        <rect x="2" y="17" width="16" height="7" rx="1.5" fill="currentColor" opacity=".85"/>
        {/* Cab */}
        <rect x="14" y="14" width="7" height="10" rx="1" fill="currentColor" opacity=".7"/>
        {/* Wheels */}
        <circle cx="6" cy="25" r="2.5" fill="currentColor"/>
        <circle cx="17" cy="25" r="2.5" fill="currentColor"/>
        {/* Crane arm */}
        <line x1="8" y1="17" x2="8" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <line x1="8" y1="4" x2="22" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <line x1="22" y1="8" x2="22" y2="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1"/>
        {/* Hook */}
        <circle cx="22" cy="15" r="1.5" fill="currentColor" opacity=".6"/>
      </svg>
    )},
    { id:"forklift", label:"Forklift", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Body */}
        <rect x="7" y="11" width="14" height="11" rx="2" fill="currentColor" opacity=".85"/>
        {/* Mast */}
        <rect x="4" y="4" width="3" height="18" rx="1" fill="currentColor" opacity=".7"/>
        {/* Forks */}
        <rect x="1" y="19" width="6" height="2" rx="0.5" fill="currentColor"/>
        <rect x="1" y="22" width="6" height="2" rx="0.5" fill="currentColor"/>
        {/* Wheels */}
        <circle cx="10" cy="24" r="2.5" fill="currentColor"/>
        <circle cx="20" cy="24" r="2.5" fill="currentColor"/>
        {/* Cab detail */}
        <rect x="14" y="13" width="5" height="5" rx="1" fill="white" opacity=".3"/>
      </svg>
    )},
    { id:"manlift", label:"Manlift", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Base / truck */}
        <rect x="2" y="18" width="18" height="7" rx="1.5" fill="currentColor" opacity=".85"/>
        {/* Wheels */}
        <circle cx="6" cy="26" r="2" fill="currentColor"/>
        <circle cx="16" cy="26" r="2" fill="currentColor"/>
        {/* Boom arm (telescopic) */}
        <line x1="10" y1="18" x2="10" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="10" y1="8" x2="20" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        {/* Basket */}
        <rect x="18" y="1" width="8" height="6" rx="1" fill="currentColor" opacity=".7"/>
        {/* Person */}
        <circle cx="22" cy="3" r="1.2" fill="white" opacity=".8"/>
      </svg>
    )},
    { id:"pendukung", label:"Alat Pendukung", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Hand pallet silhouette */}
        {/* Platform */}
        <rect x="2" y="12" width="18" height="4" rx="1" fill="currentColor" opacity=".85"/>
        {/* Handle */}
        <path d="M18 14 Q22 14 22 8 L24 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
        {/* Forks */}
        <rect x="3" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        <rect x="11" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        {/* Wheels */}
        <circle cx="5" cy="25" r="2" fill="currentColor"/>
        <circle cx="14" cy="25" r="2" fill="currentColor"/>
        <circle cx="22" cy="7" r="1.5" fill="currentColor" opacity=".5"/>
      </svg>
    )},
  ];

  const categoryCounts = EQUIPMENT_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = cat.id==="ALL" ? equipmentList.length : equipmentList.filter(e=>getEquipmentCategory(e)===cat.id).length;
    return acc;
  }, {});

  const filteredEquipment = equipmentList.filter(e =>
    (!effectiveUptFilter || e.upt===effectiveUptFilter) &&
    (categoryFilter==="ALL" || getEquipmentCategory(e)===categoryFilter) &&
    (kondisiFilter==="ALL" || e.statusAlat===kondisiFilter || (kondisiFilter==="DIPINJAM" && !!activeLoanForEquipment(e.id)))
  );
  const unifiedLoans = scopedLoans
    .filter(l=>(loanCategoryFilter==="ALL"||getEquipmentCategory(equipmentList.find(e=>e.id===l.equipmentId)||{})===loanCategoryFilter))
    .sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));


  async function submitLoan() {
    await createLoan(loanForm);
    setLoanForm({equipmentId:"", requesterUpt:myUpt||"", namaPekerjaan:"", tanggalAmbil:"", tanggalKembali:"", keperluan:"", catatan:""});
  }

  // Kondisi overview data
  const kondisiGroups = [
    {id:"ALL",      label:"Semua Alat",     color:C.accent,   count:equipmentList.filter(e=>!effectiveUptFilter||e.upt===effectiveUptFilter).length},
    {id:"LAYAK",    label:"Layak",          color:C.green,    count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="LAYAK").length},
    {id:"DIPINJAM", label:"Dipinjam",       color:"#c2410c",  count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&activeLoanForEquipment(e.id)).length},
    {id:"MAINTENANCE", label:"Maintenance", color:"#4b5563",  count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="MAINTENANCE").length},
    {id:"KIR",      label:"Sedang KIR",     color:"#1d4ed8",  count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="KIR").length},
    {id:"PERLU_SERVICE", label:"Perlu Servis", color:"#f59e0b", count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="PERLU_SERVICE").length},
    {id:"RUSAK",    label:"Rusak",          color:C.red,      count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="RUSAK").length},
  ].filter(g=>g.id==="ALL"||g.count>0);
  const scopedEquipment = equipmentList.filter(e=>!effectiveUptFilter||e.upt===effectiveUptFilter);
  const scopedMaintenance = scopedEquipment.filter(e=>["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
  const scopedAvailable = scopedEquipment.filter(e=>!activeLoanForEquipment(e.id) && !["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
  const scopedBorrowed = scopedEquipment.filter(e=>activeLoanForEquipment(e.id)?.runtimeStatus==="DIPINJAM").length;

  return (
    <div className="operations-page heavy-equipment-page">
      <OperationsHero
        eyebrow="Fleet Operations"
        title="Alat Berat & Peminjaman"
        description="Pantau kesiapan alat, perpindahan antar-UPT, dan keputusan peminjaman dalam satu workspace."
        scope={isMSB ? (myUptSelected||"Semua UPT") : `UPT ${myUpt||"Surabaya"}`}
        metrics={[
          {label:"Total alat",value:scopedEquipment.length},
          {label:"Tersedia",value:scopedAvailable},
          {label:"Dipinjam",value:scopedBorrowed},
          {label:"Maintenance / KIR",value:scopedMaintenance},
          {label:"Pending approval",value:pendingCount,alert:pendingCount>0},
          {label:"Overdue",value:overdueCount,alert:overdueCount>0},
        ]}
        controls={isMSB ? (
          <div>
            <label>Filter UPT</label>
            <select value={myUptSelected} onChange={e=>setMyUptSelected(e.target.value)}>
              <option value="">Semua UPT</option>
              {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        ) : null}
      />

      {/* Blok khusus Overdue — sekarang discope ke UPT yang sedang di-scope (dulu tidak difilter
          UPT sama sekali, jadi overdue milik UPT lain ikut nongol & bisa "Ditandai Kembali" oleh
          Admin/TL/Asman Surabaya yang tidak ada urusan sama sekali — keluhan user 2026-07-06). */}
      {overdueCount > 0 && (
        <div className="operations-alert is-danger" style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`,background:"#fef2f2"}}>
          <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:C.red}}>Alat melewati jadwal pengembalian ({overdueCount})</div>
          {scopedLoans.filter(l=>l.runtimeStatus==="OVERDUE").map(l=>{
            const eq = equipmentList.find(e=>e.id===l.equipmentId);
            const pemohon = users.find(u=>u.id===l.requestedBy);
            return (
              <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700}}>{eq?.nama||l.equipmentId} • {l.ownerUpt} → {l.requesterUpt}</div>
                  <div style={{fontSize:12,color:C.muted}}>Rencana kembali: {l.tanggalKembali||"-"} • {l.namaPekerjaan||"-"} • Diajukan oleh {pemohon?.name||"?"}</div>
                </div>
                {hasRole(currentUser, "ADMIN","TL","ASMAN") && (
                  <button style={sty.btn("success","sm")} onClick={()=>completeLoan(l.id)}>Tandai Kembali</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mode switch (pola dashboard) — ringkasan/overdue di atas tetap tampil di kedua mode */}
      <div className="dashboard-mode-switch" role="tablist" aria-label="Tampilan alat berat" style={{marginBottom:12}}>
        {[{id:"armada",label:"Daftar Alat",caption:"Registry & kondisi armada"},{id:"peminjaman",label:"Peminjaman & Histori",caption:"Pengajuan, approval, dan riwayat"}].map(item=>(
          <button key={item.id} className={viewMode===item.id?"is-active":""} onClick={()=>setViewMode(item.id)} role="tab" aria-selected={viewMode===item.id}>
            <strong>{item.label}{item.id==="peminjaman"&&pendingCount>0&&<span style={{marginLeft:6,padding:"1px 7px",borderRadius:20,fontSize:12,fontWeight:800,background:C.red,color:"#fff"}}>{pendingCount}</span>}</strong><span>{item.caption}</span>
          </button>
        ))}
      </div>

      {viewMode==="armada" && (<>
      {/* ── SECTION: Daftar Alat Berat ── */}
      <div className="operations-section-heading"><div><span>Fleet Registry</span><h2>Daftar Alat Berat</h2></div><small>{filteredEquipment.length} alat sesuai filter</small></div>
      {/* Kategori (kiri, wrap) + dropdown kondisi ringkas (kanan) — satu baris, hilangkan dualisme chip. */}
      <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:10}}>
        <div className="operations-category-filters" style={{flex:1,minWidth:0,marginBottom:0}}>
          {EQUIPMENT_CATEGORIES.map(cat=>{
            const active = categoryFilter===cat.id;
            const count = equipmentList.filter(e=>
              (!effectiveUptFilter||e.upt===effectiveUptFilter)&&
              (cat.id==="ALL"||getEquipmentCategory(e)===cat.id)&&
              (kondisiFilter==="ALL"||e.statusAlat===kondisiFilter||(kondisiFilter==="DIPINJAM"&&!!activeLoanForEquipment(e.id)))
            ).length;
            return (
              <button key={cat.id} className={active?"is-active":""} onClick={()=>setCategoryFilter(cat.id)}>
                <span style={{color:active?C.accent:"#9ca3af",display:"flex"}}>{cat.icon}</span>
                <span style={{fontSize:12,fontWeight:active?800:500,whiteSpace:"nowrap"}}>{cat.label}</span>
                <span style={{fontSize:12,fontWeight:700,color:active?C.accent:C.muted}}>{count}</span>
              </button>
            );
          })}
        </div>
        <label style={{display:"flex",flexDirection:"column",gap:4,flex:"0 0 auto",width:190}}>
          <span style={{fontSize:12,fontWeight:700,color:C.muted}}>Kondisi</span>
          <select value={kondisiFilter} onChange={e=>setKondisiFilter(e.target.value)}
            style={{width:"100%",minHeight:36,padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:9,outline:0,background:"#fff",color:C.text,fontSize:13}}>
            {kondisiGroups.map(g=>(
              <option key={g.id} value={g.id}>{g.label} ({g.count})</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{fontSize:12,color:C.muted,marginBottom:10}}>
        Menampilkan <b style={{color:C.text}}>{filteredEquipment.length}</b> alat
        {kondisiFilter!=="ALL"&&<span> • Kondisi: <b style={{color:C.accent}}>{kondisiGroups.find(g=>g.id===kondisiFilter)?.label}</b></span>}
        {categoryFilter!=="ALL"&&<span> • Kategori: <b style={{color:C.accent}}>{EQUIPMENT_CATEGORIES.find(c=>c.id===categoryFilter)?.label}</b></span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12,marginBottom:24}}>
        {filteredEquipment.map(eq=>{
          const activeLoan = activeLoanForEquipment(eq.id);
          const lastLoan = latestLoanForEquipment(eq.id);
          return (
            <div key={eq.id} className="operations-card equipment-card" style={{...sty.card,padding:14,display:"flex",flexDirection:"column",gap:10,borderLeft:activeLoan?`4px solid ${loanBorderColor(activeLoan.runtimeStatus)}`:undefined}}>
              <div style={{height:150,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {eq.foto ? <img src={eq.foto} alt={eq.nama} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div className="equipment-placeholder">EQ</div>}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
                <div><div style={{fontSize:14,fontWeight:900}}>{eq.nama}</div><div style={{fontSize:12,color:C.muted}}>{eq.upt} • {eq.lokasi}</div></div>
                <Badge metaKey={activeLoan?.runtimeStatus || eq.availabilityStatus || "TERSEDIA"}/>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}><Badge metaKey={eq.statusAlat}/><span style={{padding:"3px 9px",borderRadius:20,fontSize:12,fontWeight:700,background:"#f3f4f6",color:C.muted}}>{eq.jenis}</span></div>
              <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>Merk/Type: <b>{eq.merkType||"-"}</b><br/>Kapasitas: <b>{eq.kapasitas||"-"}</b> • Tahun: <b>{eq.tahun||"-"}</b><br/>No Seri: <b>{eq.nomorSeri||"-"}</b><br/>Kondisi: <b>{eq.kondisi||"-"}</b><br/>Surat Izin: <b>{eq.suratIzinAlat||"Belum ada data"}</b></div>
              {activeLoan && <div style={{background:activeLoan.runtimeStatus==="OVERDUE"?"#fef2f2":"#fff7ed",border:`1px solid ${activeLoan.runtimeStatus==="OVERDUE"?"#fecaca":"#fed7aa"}`,borderRadius:8,padding:10,fontSize:12,lineHeight:1.5}}><div style={{fontWeight:900,color:activeLoan.runtimeStatus==="OVERDUE"?C.red:"#c2410c"}}>{activeLoan.runtimeStatus==="OVERDUE"?"OVERDUE":"Sedang dipinjam"}</div><div>{activeLoan.requesterUpt} • {activeLoan.namaPekerjaan || "-"}</div><div style={{color:C.muted}}>Rencana kembali: {activeLoan.tanggalKembali || "-"}</div></div>}
              {["MAINTENANCE","KIR"].includes(eq.statusAlat) && <div style={{background:"#f3f4f6",border:`1px solid ${C.border}`,borderRadius:8,padding:10,fontSize:12,lineHeight:1.5}}><div style={{fontWeight:900,color:"#4b5563"}}>{eq.statusAlat==="KIR"?"🔵 Sedang KIR":"🔧 Sedang Maintenance"}</div><div style={{color:C.muted}}>Tidak bisa dipinjam UPT lain sampai statusnya berubah.</div></div>}
              {lastLoan && <div style={{fontSize:12,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:8}}>Terakhir dipinjam oleh <b>{lastLoan.requesterUpt || "-"}</b> untuk pekerjaan <b>{lastLoan.namaPekerjaan || "-"}</b>.</div>}
              {canManage && <button style={sty.btn("ghost","sm")} onClick={()=>{setEditingEquipment(eq.id);setEditForm({statusAlat:eq.statusAlat||"LAYAK", foto:eq.foto||null});}}>Edit data alat</button>}
            </div>
          );
        })}
      </div>

      </>)}

      {viewMode==="peminjaman" && (<>
      {/* ── SECTION: Ajukan Peminjaman + Peminjaman & Histori ── */}
      <div className="operations-section-heading"><div><span>Loan Operations</span><h2>Peminjaman & Histori</h2></div><small>{unifiedLoans.length} transaksi</small></div>
      <div className="operations-category-filters is-compact">
        {EQUIPMENT_CATEGORIES.map(cat=>{
          const active = loanCategoryFilter===cat.id;
          const base = equipmentList.filter(e=>(cat.id==="ALL"||getEquipmentCategory(e)===cat.id));
          const countActive = base.filter(e=>activeLoanForEquipment(e.id)).length;
          const countTotal = base.length;
          return (
            <button key={cat.id} className={active?"is-active":""} onClick={()=>setLoanCategoryFilter(cat.id)}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 12px",minWidth:64,borderRadius:10,border:`2px solid ${active?C.accent:C.border}`,background:active?"#eff6ff":"white",color:active?C.accent:C.muted,cursor:"pointer",boxShadow:active?"0 2px 8px rgba(0,152,218,.15)":"none"}}>
              <span style={{color:active?C.accent:"#9ca3af"}}>{cat.icon}</span>
              <span style={{fontSize:12,fontWeight:active?800:500,whiteSpace:"nowrap"}}>{cat.label}</span>
              <span style={{fontSize:12,color:active?C.accent:C.muted}}><b>{countActive}</b>/{countTotal}</span>
            </button>
          );
        })}
        <div style={{display:"flex",alignItems:"center",fontSize:12,color:C.muted,paddingLeft:4}}>dipinjam/total</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:canManage?"minmax(260px,300px) 1fr":"1fr",gap:14,alignItems:"start"}}>

        {/* Form ajukan (Admin/TL only) — alat yang ditawarkan HARUS di luar UPT sendiri untuk
            role non-MSB (Surabaya selalu peminjam di form ini, lihat borrowableEquipment). */}
        {canManage && (
          <div className="operations-form-panel" style={sty.card}>
            <div style={{fontSize:13,fontWeight:900,marginBottom:10}}>Ajukan Peminjaman</div>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>Alat {!isMSB && <span style={{fontWeight:400,color:C.muted}}>(di luar UPT {myUpt||"Surabaya"})</span>}</label>
              <select style={sty.select} value={loanForm.equipmentId} onChange={e=>setLoanForm(f=>({...f,equipmentId:e.target.value,requesterUpt:isMSB?"":(myUpt||"")}))}>
                <option value="">-- Pilih alat --</option>
                {borrowableEquipment.map(e=><option key={e.id} value={e.id}>{e.upt} — {e.nama} ({e.kapasitas||"-"})</option>)}
              </select>
              {selectedEquipment&&<div style={{fontSize:12,color:C.muted,marginTop:3}}>Pemilik: <b>{selectedEquipment.upt}</b></div>}
            </div>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>UPT Peminjam</label>
              {isMSB ? (
                <select style={sty.select} value={loanForm.requesterUpt} onChange={e=>setLoanForm(f=>({...f,requesterUpt:e.target.value}))}>
                  <option value="">-- Pilih UPT --</option>
                  {requesterOptions.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              ) : (
                <div style={{...sty.input,background:"#f3f4f6",color:C.muted,display:"flex",alignItems:"center"}}>UPT {myUpt||"Surabaya"}</div>
              )}
            </div>
            <div style={{marginBottom:8}}><label style={sty.label}>Nama Pekerjaan</label><input style={sty.input} value={loanForm.namaPekerjaan} onChange={e=>setLoanForm(f=>({...f,namaPekerjaan:e.target.value}))} placeholder="Contoh: Penggantian PMT Bay Trafo 1"/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}><div><label style={sty.label}>Tgl Ambil</label><input style={sty.input} type="date" value={loanForm.tanggalAmbil} onChange={e=>setLoanForm(f=>({...f,tanggalAmbil:e.target.value}))}/></div><div><label style={sty.label}>Tgl Kembali</label><input style={sty.input} type="date" value={loanForm.tanggalKembali} onChange={e=>setLoanForm(f=>({...f,tanggalKembali:e.target.value}))}/></div></div>
            <div style={{marginBottom:8}}><label style={sty.label}>Keperluan</label><textarea style={{...sty.input,minHeight:60}} value={loanForm.keperluan} onChange={e=>setLoanForm(f=>({...f,keperluan:e.target.value}))}/></div>
            <div style={{marginBottom:10}}><label style={sty.label}>Catatan</label><input style={sty.input} value={loanForm.catatan} onChange={e=>setLoanForm(f=>({...f,catatan:e.target.value}))}/></div>
            <button style={{...sty.btn("primary"),width:"100%"}} onClick={submitLoan}>Ajukan Peminjaman</button>
          </div>
        )}

        {/* Unified loan list: aktif + histori, discope ke UPT yang sedang aktif, newest first */}
        <div>
          <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
            {isMSB && !myUptSelected ? "Peminjaman & Histori — Semua UPT" : `Peminjaman & Histori — UPT ${effectiveUptFilter||myUpt||"Surabaya"}`}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:640,overflowY:"auto"}}>
            {unifiedLoans.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20,fontSize:13}}>Belum ada data peminjaman.</div>}
            {unifiedLoans.map(loan=>{
              const eq=equipmentList.find(e=>e.id===loan.equipmentId);
              const isActive=["PENDING_OWNER_ASMAN","DIPINJAM","OVERDUE"].includes(loan.runtimeStatus);
              return (
                <div key={loan.id} className="operations-row-card" style={{...sty.card,padding:12,borderLeft:`4px solid ${loanBorderColor(loan.runtimeStatus)}`,opacity:isActive?1:0.85}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start",marginBottom:4}}>
                    <div>
                      <div style={{fontWeight:900,fontSize:13}}>{eq?.nama||loan.equipmentId}</div>
                      <div style={{fontSize:12,color:C.muted}}>{loan.ownerUpt} → {loan.requesterUpt}</div>
                    </div>
                    <Badge metaKey={loan.runtimeStatus}/>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:2}}>{loan.namaPekerjaan||"-"}</div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:isActive?6:0}}>{loan.tanggalAmbil} s/d {loan.tanggalKembali}</div>
                  {isActive&&isPendingHeavyEquipmentLoan(loan)&&canApproveHeavyEquipmentLoan(currentUser,loan)&&(
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                      {rejectingId===loan.id
                        ?<><input style={{...sty.input,flex:"1 1 160px"}} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Alasan penolakan"/><span className="approval-actions approval-actions--compact"><button className="approval-btn--danger" onClick={()=>{rejectLoan(loan.id,reason);setRejectingId(null);setReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button><button className="approval-btn--cancel" onClick={()=>{setRejectingId(null);setReason("");}}>Batal</button></span></>
                        :<span className="approval-actions approval-actions--compact"><button className="approval-btn--approve" onClick={()=>approveLoan(loan.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui</button><button className="approval-btn--reject" onClick={()=>setRejectingId(loan.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button></span>}
                    </div>
                  )}
                  {isActive&&["DIPINJAM","OVERDUE"].includes(loan.runtimeStatus)&&hasRole(currentUser, "ADMIN","TL","ASMAN")&&(
                    <button style={{...sty.btn("ghost","sm"),marginTop:6}} onClick={()=>completeLoan(loan.id)}>Tandai Kembali</button>
                  )}
                  {["DIPINJAM","OVERDUE","SELESAI"].includes(loan.runtimeStatus) && (
                    <button style={{...sty.btn("ghost","sm"),marginTop:6,marginLeft:isActive&&["DIPINJAM","OVERDUE"].includes(loan.runtimeStatus)&&hasRole(currentUser, "ADMIN","TL","ASMAN")?6:0}} onClick={()=>downloadHeavyEquipmentLoanHTML(loan, eq, users, showToast)}>Cetak dokumen</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      </>)}

      {/* MODAL EDIT ALAT — status alat + upload foto sekaligus, Admin/TL saja */}
      {editingEquipment && (()=>{
        const eq = equipmentList.find(e=>e.id===editingEquipment);
        if (!eq) return null;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
            <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
              <h3 style={{fontSize:16,fontWeight:800,marginBottom:4}}>✏️ Edit Alat</h3>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>{eq.nama} — {eq.upt}</div>
              <div style={{height:150,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}>
                {editForm.foto ? <img src={editForm.foto} alt={eq.nama} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{fontSize:38,color:"#9ca3af"}}>🚜</div>}
              </div>
              <label style={{...sty.btn("ghost","sm"),textAlign:"center",display:"block",marginBottom:16}}>
                📷 {editForm.foto?"Ganti Foto":"Upload Foto"}
                <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>setEditForm(f=>({...f,foto:img})))}/>
              </label>
              <div style={{marginBottom:16}}>
                <label style={sty.label}>Status Alat</label>
                <select style={sty.select} value={editForm.statusAlat} onChange={e=>setEditForm(f=>({...f,statusAlat:e.target.value}))}>
                  {STATUS_ALAT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {["MAINTENANCE","KIR"].includes(editForm.statusAlat) && <div style={{fontSize:12,color:C.muted,marginTop:4}}>⚠️ Alat tidak bisa dipinjam UPT lain selama status ini.</div>}
                {eq.availabilityStatus==="DIPINJAM" && ["MAINTENANCE","KIR"].includes(editForm.statusAlat) && <div style={{fontSize:12,color:C.red,marginTop:4}}>Alat sedang dipinjam — tidak bisa diubah ke status ini sampai kembali.</div>}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setEditingEquipment(null)}>Batal</button>
                <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{await saveEdit(eq.id, editForm);setEditingEquipment(null);}}>💾 Simpan</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
