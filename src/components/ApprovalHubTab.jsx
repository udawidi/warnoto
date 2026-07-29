// Komponen ApprovalHubTab — wrapper tab "Approval" (chip filter + seksi + riwayat),
// dipindah dari App.jsx (refactor batch 2e). Membungkus pemanggilan <ApprovalTab/>.
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole } from "../lib/roles.js";
import {
  getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt,
  getHeavyEquipmentLoanStartDate, getHeavyEquipmentLoanReturnDate, getHeavyEquipmentLoanJobName,
  isPendingHeavyEquipmentLoan, canApproveHeavyEquipmentLoan,
} from "../lib/heavyEquipment.js";
import { ApprovalTab } from "./ApprovalTab.jsx";

export function ApprovalHubTab({
  currentUser, sty, C, isMobile,
  myPendingApprovals, gudangCapacityImports, lokasiList, stocks,
  heavyEquipmentPendingCount, opnameList, stockCountPendingCount,
  approvalTypeFilter, setApprovalTypeFilter, approvalPageSize, setApprovalPageSize,
  enrichedStocks, katalogList, users,
  approveTxn, rejectTxn, uptList,
  submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik, konfirmasiDraftTUG8,
  startCapacityApproval, rejectCapacityImport,
  approveLokasiChange, rejectLokasiChange,
  ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, ultgPengajuanUntukAdopt, adoptTUG5ULTG, openDraftTug9,
  approvalStokPage, setApprovalStokPage, approveStockMove, rejectStockMove, renderApprovalPager,
  approvalStokGudangPage, setApprovalStokGudangPage,
  approvalEditStokPage, setApprovalEditStokPage, approveStockEdit, rejectStockEdit,
  approvalHapusStokPage, setApprovalHapusStokPage, approveStockDelete, rejectStockDelete,
  heavyEquipmentLoans, approvalAlatBeratPage, setApprovalAlatBeratPage, heavyEquipmentList,
  approveHeavyEquipmentLoan, rejectHeavyEquipmentLoan,
  approvalOpnamePage, setApprovalOpnamePage, approveOpname_Asman, approveOpname_Manager, rejectOpname,
  stockCountList, approvalStockCountPage, setApprovalStockCountPage, approveStockCountItem, rejectStockCountItem,
  txns, approvalHistoryList, approvalHistoryPage, setApprovalHistoryPage,
}) {
  const tugCount = myPendingApprovals.length;
  const capCount = hasRole(currentUser, "TL","ASMAN") ? gudangCapacityImports.filter(i=>i.status==="PENDING_ASMAN").length : 0;
  const lokasiCount = hasRole(currentUser, "TL") ? lokasiList.filter(l=>l.status==="PENDING").length : 0;
  const stokCount = hasRole(currentUser, "TL")
    ? stocks.filter(s=>(s.lokasiMovePending&&s.lokasiMoveApprover==="TL")||s.editPending||s.deletePending).length
    : hasRole(currentUser, "ASMAN") ? stocks.filter(s=>s.lokasiMovePending&&s.lokasiMoveApprover==="ASMAN").length : 0;
  const alatBeratCount = hasRole(currentUser, "ASMAN") ? heavyEquipmentPendingCount : 0;
  const opnameCount = hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length
    : hasRole(currentUser, "MANAGER") ? opnameList.filter(o=>o.status==="PENDING_MANAGER").length : 0;
  const stockCountCount = hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0;
  const total = tugCount+capCount+lokasiCount+stokCount+alatBeratCount+opnameCount+stockCountCount;
  const chips = [
    {id:"ALL", icon:"▦", label:"Semua", count:total},
    {id:"TUG", icon:"↔", label:"TUG", count:tugCount},
    {id:"ALAT_BERAT", icon:"⚙", label:"Alat Berat", count:alatBeratCount},
    {id:"OPNAME", icon:"▣", label:"Stock Opname", count:opnameCount},
    {id:"STOCK_COUNT", icon:"≋", label:"Stock Count", count:stockCountCount},
    {id:"STOK", icon:"□", label:"Perubahan Stok", count:stokCount},
    {id:"LOKASI", icon:"⌖", label:"Lokasi / Blok", count:lokasiCount},
    {id:"KAPASITAS", icon:"▥", label:"Kapasitas", count:capCount},
  ].filter(c=>c.id==="ALL"||c.count>0);
  return (
    <div className="approval-page">
      <div style={{marginBottom:16}}>
          <div className="approval-hero__summary approval-summary-strip kpi-banner">
            <div><strong>{total}</strong><span>Menunggu tindakan</span></div>
            <div><strong>{Math.max(0,chips.length-1)}</strong><span>Kategori aktif</span></div>
            <div className="approval-role-chip"><span>Wewenang</span><strong>{ROLES[currentUser.role]}</strong></div>
          </div>
        {/* Filter jenis approval + pageSize — tepat di bawah subtitle, langsung
            nyambung ke list di bawahnya (bukan 1 list panjang campur aduk semua jenis). */}
        {total>0 && (
          <div className="approval-filterbar">
            <div className="approval-filterbar__label"><span>FILTER ANTRIAN</span><small>Pilih kategori keputusan</small></div>
            <div className="approval-filterbar__items">
              {chips.map(c=>{
                const active = approvalTypeFilter===c.id;
                return (
                  <button key={c.id} className={active?"is-active":""} onClick={()=>setApprovalTypeFilter(c.id)}>
                    <span className="approval-filterbar__icon">{c.icon}</span>
                    <span>{c.label}</span>
                    <b>{c.count}</b>
                  </button>
                );
              })}
            </div>
            <div className="approval-pagesize">
              Tampilkan
              <select style={{...sty.select,width:"auto",padding:"3px 6px",minHeight:"unset",fontSize:12}} value={approvalPageSize} onChange={e=>setApprovalPageSize(Number(e.target.value))}>
                {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span>item</span>
            </div>
          </div>
        )}
      </div>

      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG") && (
        <div className="approval-section-title"><span>↔</span><div>Transaksi TUG<small>Dokumen operasional yang membutuhkan keputusan Anda</small></div></div>
      )}
      <ApprovalTab
        pendingTxns={myPendingApprovals}
        stocks={enrichedStocks} katalogList={katalogList} lokasiList={lokasiList}
        users={users} sty={sty} C={C}
        approveTxn={approveTxn} rejectTxn={rejectTxn} currentUser={currentUser}
        uptList={uptList}
        submitTUG7_AdminUIT={submitTUG7_AdminUIT}
        approveTUG7_MgrLogistik={approveTUG7_MgrLogistik} rejectTUG7_MgrLogistik={rejectTUG7_MgrLogistik}
        konfirmasiDraftTUG8={konfirmasiDraftTUG8}
        gudangCapacityImports={gudangCapacityImports}
        approveCapacityImport={startCapacityApproval}
        rejectCapacityImport={rejectCapacityImport}
        approveLokasiChange={approveLokasiChange}
        rejectLokasiChange={rejectLokasiChange}
        ultgList={ultgList}
        approveTUG5_MgrULTG={approveTUG5_MgrULTG}
        rejectTUG5_MgrULTG={rejectTUG5_MgrULTG}
        ultgPengajuanUntukAdopt={ultgPengajuanUntukAdopt}
        adoptTUG5ULTG={adoptTUG5ULTG}
        openDraftTug9={openDraftTug9}
        heavyEquipmentPendingCount={hasRole(currentUser, "ASMAN") ? heavyEquipmentPendingCount : 0}
        opnamePendingCount={hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length : hasRole(currentUser, "MANAGER") ? opnameList.filter(o=>o.status==="PENDING_MANAGER").length : 0}
        stockCountPendingCount={hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0}
        approvalTypeFilter={approvalTypeFilter}
        approvalPageSize={approvalPageSize}
      />

      {/* Perpindahan gudang oleh ADMIN wajib direview TL. */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.lokasiMovePending && s.lokasiMoveApprover==="TL") && (()=>{
        const list = stocks.filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="TL");
        const paged = list.slice((approvalStokPage-1)*approvalPageSize, approvalStokPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📦 Pemindahan Gudang Data Stok ({list.length})</div>
            {paged.map(s=>{
              const pemohon = users.find(u=>u.id===s.moveRequestedBy);
              const lokAsal = lokasiList.find(l=>l.id===s.lokasiId);
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                    <div style={{fontSize:12,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                  </div>
                  <div className="approval-actions approval-actions--compact">
                    <button className="approval-btn--approve" onClick={()=>approveStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                    <button className="approval-btn--reject" onClick={()=>rejectStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </div>
                </div>
              );
            })}
            {renderApprovalPager(approvalStokPage, setApprovalStokPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Pemindahan Gudang Data Stok — pindah Gudang oleh TL, wajib approval Asman UPT ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "ASMAN") && stocks.some(s=>s.lokasiMovePending && s.lokasiMoveApprover==="ASMAN") && (()=>{
        const list = stocks.filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="ASMAN");
        const paged = list.slice((approvalStokGudangPage-1)*approvalPageSize, approvalStokGudangPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📦 Pemindahan Gudang Data Stok ({list.length})</div>
            {paged.map(s=>{
              const pemohon = users.find(u=>u.id===s.moveRequestedBy);
              const lokAsal = lokasiList.find(l=>l.id===s.lokasiId);
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                    <div style={{fontSize:12,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                  </div>
                  <div className="approval-actions approval-actions--compact">
                    <button className="approval-btn--approve" onClick={()=>approveStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                    <button className="approval-btn--reject" onClick={()=>rejectStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </div>
                </div>
              );
            })}
            {renderApprovalPager(approvalStokGudangPage, setApprovalStokGudangPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Edit Data Stok (qty/harga/jenis) — khusus TL ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.editPending) && (()=>{
        const list = stocks.filter(s=>s.editPending);
        const paged = list.slice((approvalEditStokPage-1)*approvalPageSize, approvalEditStokPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>✏️ Edit Data Stok ({list.length})</div>
            {paged.map(s=>{
              const pemohon = users.find(u=>u.id===s.editRequestedBy);
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                    <div style={{fontSize:12,color:C.muted}}>
                      Qty {fmtNum(s.qty)}→{fmtNum(s.pendingEditData.qty)} • Harga Rp{fmtNum(s.price)}→Rp{fmtNum(s.pendingEditData.price)} • Jenis {s.jenisBarang}→{s.pendingEditData.jenisBarang}<br/>
                      Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.editRequestedAt)}
                    </div>
                  </div>
                  <div className="approval-actions approval-actions--compact">
                    <button className="approval-btn--approve" onClick={()=>approveStockEdit(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                    <button className="approval-btn--reject" onClick={()=>rejectStockEdit(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </div>
                </div>
              );
            })}
            {renderApprovalPager(approvalEditStokPage, setApprovalEditStokPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Hapus Data Stok — khusus TL ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.deletePending) && (()=>{
        const list = stocks.filter(s=>s.deletePending);
        const paged = list.slice((approvalHapusStokPage-1)*approvalPageSize, approvalHapusStokPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.red}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>🗑️ Hapus Data Stok ({list.length})</div>
            {paged.map(s=>{
              const pemohon = users.find(u=>u.id===s.deleteRequestedBy);
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                    <div style={{fontSize:12,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.deleteRequestedAt)}</div>
                  </div>
                  <div className="approval-actions approval-actions--compact">
                    <button className="approval-btn--approve" onClick={()=>approveStockDelete(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                    <button className="approval-btn--reject" onClick={()=>rejectStockDelete(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </div>
                </div>
              );
            })}
            {renderApprovalPager(approvalHapusStokPage, setApprovalHapusStokPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Peminjaman Alat Berat — khusus ASMAN ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="ALAT_BERAT") && hasRole(currentUser, "ASMAN") && heavyEquipmentLoans.some(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)) && (()=>{
        const list = heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l));
        const paged = list.slice((approvalAlatBeratPage-1)*approvalPageSize, approvalAlatBeratPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>🚜 Peminjaman Alat Berat ({list.length})</div>
            {paged.map(l=>{
              const alat = heavyEquipmentList.find(eq=>eq.id===l.equipmentId);
              const pemohon = users.find(u=>u.id===l.requestedBy);
              const ownerUpt = getHeavyEquipmentLoanOwnerUpt(l);
              const requesterUpt = getHeavyEquipmentLoanRequesterUpt(l);
              return (
                <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>{alat?.nama||l.equipmentId} • {ownerUpt} → {requesterUpt}</div>
                    <div style={{fontSize:12,color:C.muted}}>{getHeavyEquipmentLoanStartDate(l)} s/d {getHeavyEquipmentLoanReturnDate(l)} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(l.requestedAt)}</div>
                    <div style={{fontSize:12,color:C.text,marginTop:2}}>{getHeavyEquipmentLoanJobName(l)}{l.keperluan ? ` • ${l.keperluan}` : ""}</div>
                  </div>
                  <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                    <button className="approval-btn--approve" onClick={()=>approveHeavyEquipmentLoan(l.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                    <button className="approval-btn--reject" onClick={()=>{
                      const rejectReason = window.prompt("Alasan penolakan peminjaman alat?");
                      if (rejectReason) rejectHeavyEquipmentLoan(l.id, rejectReason);
                    }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </div>
                </div>
              );
            })}
            {renderApprovalPager(approvalAlatBeratPage, setApprovalAlatBeratPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Stock Opname — Asman/Manager (dulu cuma muncul di menu Stock Opname
          sendiri, tidak pernah tampil di halaman Approval terpusat ini — keluhan user
          2026-07-07 "tidak masuk ke approval asman"). ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="OPNAME") && hasRole(currentUser, "ASMAN","MANAGER") &&
        opnameList.some(o=>(hasRole(currentUser, "ASMAN")&&o.status==="PENDING_ASMAN")||(hasRole(currentUser, "MANAGER")&&o.status==="PENDING_MANAGER")) && (()=>{
        const list = opnameList.filter(o=>(hasRole(currentUser, "ASMAN")&&o.status==="PENDING_ASMAN")||(hasRole(currentUser, "MANAGER")&&o.status==="PENDING_MANAGER"));
        const paged = list.slice((approvalOpnamePage-1)*approvalPageSize, approvalOpnamePage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📋 Stock Opname ({list.length})</div>
            {paged.map(opn=>{
              const selisihCount = opn.items?.filter(i=>i.selisih!==0).length||0;
              const pengaju = users.find(u=>u.id===opn.dibuatOleh);
              return (
                <div key={opn.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>Opname {opn.semester} — {opn.jenisAlur}</div>
                    <div style={{fontSize:12,color:C.muted}}>{opn.items?.length||0} item • Selisih: {selisihCount} item • Diajukan oleh {pengaju?.name||"?"} • {fmtDate(opn.submittedAt)}</div>
                  </div>
                  <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                    <button className="approval-btn--approve" onClick={()=>hasRole(currentUser, "ASMAN")?approveOpname_Asman(opn,""):approveOpname_Manager(opn,"")}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                    <button className="approval-btn--reject" onClick={()=>{
                      const reason = window.prompt("Alasan penolakan Stock Opname ini?");
                      if (reason) rejectOpname(opn, reason);
                    }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </div>
                </div>
              );
            })}
            {renderApprovalPager(approvalOpnamePage, setApprovalOpnamePage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Stock Count — temuan selisih per-item, di-approve ASMAN (dulu cuma
          muncul di menu Stock Opname & Count sendiri, tidak pernah tampil di halaman
          Approval terpusat ini — gap visibilitas sama seperti Stock Opname). ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOCK_COUNT") && hasRole(currentUser, "ASMAN") &&
        stockCountList.some(s=>s.items.some(i=>i.approval==="PENDING")) && (()=>{
        const list = stockCountList.flatMap(s=>s.items.filter(i=>i.approval==="PENDING").map(i=>({session:s, item:i})));
        const paged = list.slice((approvalStockCountPage-1)*approvalPageSize, approvalStockCountPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📊 Stock Count ({list.length})</div>
            {paged.map(({session,item})=>(
              <div key={`${session.id}_${item.id}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700}}>{item.nama}</div>
                  <div style={{fontSize:12,color:C.muted}}>No. Katalog {item.katalogKode} • SAP {fmtNum(item.qtySap)} vs Aplikasi {item.katalogId?fmtNum(item.qtyApp):"Tidak terdaftar"} {item.satuan} • Selisih {item.selisih>0?"+":""}{fmtNum(item.selisih)} ({item.selisihPct}%) • {fmtDate(session.uploadedAt)}</div>
                </div>
                <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                  <button className="approval-btn--approve" onClick={()=>approveStockCountItem(session.id, item.id, "")}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                  <button className="approval-btn--reject" onClick={()=>{
                    const reason = window.prompt("Alasan penolakan temuan Stock Count ini?");
                    if (reason) rejectStockCountItem(session.id, item.id, reason);
                  }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                </div>
              </div>
            ))}
            {renderApprovalPager(approvalStockCountPage, setApprovalStockCountPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Riwayat Approval (gabungan semua jenis, terbaru di atas) ── */}
      {(()=>{
        const histTUG = txns.filter(t=>t.status==="APPROVED"||t.status==="REJECTED").map(t=>({
          id:`TUG-${t.id}`, type:"TUG", decision:t.status,
          title:`${t.docType||"TUG"} • ${t.id}`,
          decidedBy: t.status==="REJECTED" ? t.rejectedBy : t.approvedBy,
          decidedAt: t.status==="REJECTED" ? t.rejectedAt : t.approvedAt,
        }));
        const combinedAll = [...approvalHistoryList, ...histTUG].filter(h=>h.decidedAt).sort((a,b)=>b.decidedAt-a.decidedAt);
        const combined = combinedAll.slice((approvalHistoryPage-1)*approvalPageSize, approvalHistoryPage*approvalPageSize);
        const typeLabel = {LOKASI:"📍 Lokasi/Blok", STOCK_MOVE:"📦 Pemindahan Stok", STOCK_EDIT:"✏️ Edit Stok", STOCK_DELETE:"🗑️ Hapus Stok", HEAVY_EQUIPMENT_LOAN:"🚜 Peminjaman Alat", TUG:"🔄 TUG", OPNAME:"📋 Stock Opname", STOCK_COUNT:"📊 Stock Count"};
        const typeOrder = ["TUG","HEAVY_EQUIPMENT_LOAN","OPNAME","STOCK_COUNT","LOKASI","STOCK_MOVE","STOCK_EDIT","STOCK_DELETE"];
        const groupsByType = typeOrder
          .map(type=>({ type, items: combined.filter(h=>h.type===type) }))
          .filter(g=>g.items.length>0);
        // Jenis lain yang mungkin muncul di masa depan tapi belum ada di typeOrder — tetap ditampilkan.
        const knownTypes = new Set(typeOrder);
        combined.forEach(h=>{ if(!knownTypes.has(h.type)){ knownTypes.add(h.type); groupsByType.push({type:h.type, items:combined.filter(x=>x.type===h.type)}); } });
        return (
          <div style={{...sty.card,marginTop:16}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📜 Riwayat Approval ({combinedAll.length})</div>
            {combinedAll.length===0 && <div style={{textAlign:"center",color:C.muted,padding:20,fontSize:13}}>Belum ada riwayat approval.</div>}
            {groupsByType.map(g=>(
              <div key={g.type} style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:800,color:"#0098da",marginBottom:4}}>{typeLabel[g.type]||g.type} ({g.items.length})</div>
                {g.items.map(h=>{
                  const decider = users.find(u=>u.id===h.decidedBy);
                  return (
                    <div key={h.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700}}>{h.title}</div>
                        <div style={{fontSize:12,color:C.muted}}>Oleh {decider?.name||"?"} • {fmtDate(h.decidedAt)}</div>
                      </div>
                      <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:h.decision==="APPROVED"?"#dcfce7":"#fee2e2",color:h.decision==="APPROVED"?C.green:C.red}}>
                        {h.decision==="APPROVED"?"✓ Disetujui":"✕ Ditolak"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {renderApprovalPager(approvalHistoryPage, setApprovalHistoryPage, combinedAll.length)}
          </div>
        );
      })()}
    </div>
  );
}
