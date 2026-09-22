// Komponen ApprovalHubTab — wrapper tab "Approval" (chip filter + seksi + riwayat),
// dipindah dari App.jsx (refactor batch 2e). Membungkus pemanggilan <ApprovalTab/>.
import { useState, useEffect } from "react";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole, getScopeUptIds, inScopeUpt } from "../lib/roles.js";
import {
  getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt,
  getHeavyEquipmentLoanStartDate, getHeavyEquipmentLoanReturnDate, getHeavyEquipmentLoanJobName,
  isPendingHeavyEquipmentLoan, canApproveHeavyEquipmentLoan,
} from "../lib/heavyEquipment.js";
import { ApprovalTab } from "./ApprovalTab.jsx";
import { formatKontrakSumber } from "../lib/sap.js";
import { StockOpnameApprovalReview } from "./StockOpnameApprovalReview.jsx";

export function ApprovalHubTab({
  currentUser, sty, C, isMobile,
  myPendingApprovals, gudangCapacityImports, lokasiList, stocks,
  heavyEquipmentPendingCount, opnameList, stockCountPendingCount,
  approvalTypeFilter, setApprovalTypeFilter, approvalPageSize, setApprovalPageSize,
  enrichedStocks, katalogList, users,
  approveTxn, rejectTxn, prepareReview, uptList,
  submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik, konfirmasiDraftTUG8,
  startCapacityApproval, rejectCapacityImport,
  approveLokasiChange, rejectLokasiChange,
  ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, ultgPengajuanUntukAdopt, adoptTUG5ULTG, openDraftTug9,
  approvalStokPage, setApprovalStokPage, approveStockMove, rejectStockMove, renderApprovalPager,
  approvalEditStokPage, setApprovalEditStokPage, approveStockEdit, rejectStockEdit,
  approvalHapusStokPage, setApprovalHapusStokPage, approveStockDelete, rejectStockDelete,
  heavyEquipmentLoans, approvalAlatBeratPage, setApprovalAlatBeratPage, heavyEquipmentList,
  approveHeavyEquipmentLoan, rejectHeavyEquipmentLoan,
  approvalOpnamePage, setApprovalOpnamePage, approveOpname_Asman, rejectOpname,
  stockCountList, approvalStockCountPage, setApprovalStockCountPage, approveStockCountItem, approveStockCountItems, rejectStockCountItem,
  txns, approvalHistoryList, approvalHistoryPage, setApprovalHistoryPage,
  approvalHistoryMineOnly, setApprovalHistoryMineOnly,
  approvalHistorySearch, setApprovalHistorySearch,
  approvalHistoryDateFrom, setApprovalHistoryDateFrom,
  approvalHistoryDateTo, setApprovalHistoryDateTo,
  approvalHistoryShowAll, setApprovalHistoryShowAll,
  deleteDraftTug3, editDraftTug3, editTug5, editTug10, openEditCanonicalTug, timMutuList, submitTUG4DanLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman,
  approveTUG3_TL, rejectTUG3_TL,
  handleImg,
}) {
  // UIT dulu dianggap "global" (nasional) — sekarang dibatasi ke semua UPT di UIT-nya lewat
  // getScopeUptIds/inScopeUpt (sumber tunggal 3-tier, lihat src/lib/roles.js).
  const historyScope = getScopeUptIds(currentUser, uptList);
  const userUptById = new Map((users || []).map(u => [u.id, u.uptId]));
  const scopedApprovalHistory = historyScope === null
    ? approvalHistoryList
    : approvalHistoryList.filter(h => inScopeUpt(userUptById.get(h.decidedBy), historyScope) || inScopeUpt(userUptById.get(h.requestedBy), historyScope) || inScopeUpt(h.uptId, historyScope));
  const tugCount = myPendingApprovals.length;
  const capCount = hasRole(currentUser, "TL","ASMAN") ? gudangCapacityImports.filter(i=>i.status==="PENDING_ASMAN").length : 0;
  const lokasiCount = hasRole(currentUser, "TL") ? lokasiList.filter(l=>l.status==="PENDING").length : 0;
  const stokCount = hasRole(currentUser, "TL")
    ? stocks.filter(s=>(s.lokasiMovePending&&["TL", "ASMAN"].includes(s.lokasiMoveApprover))||s.editPending||s.deletePending).length
    : 0;
  const alatBeratCount = hasRole(currentUser, "ASMAN") ? heavyEquipmentPendingCount : 0;
  const opnameCount = hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length : 0;
  const stockCountCount = hasRole(currentUser, "ASMAN", "TL") ? stockCountPendingCount : 0;
  const [selectedStockCount, setSelectedStockCount] = useState(() => new Set()); // key `${sessionId}_${itemId}`
  const [reviewApproval, setReviewApproval] = useState(null);
  const [historyTugFilter, setHistoryTugFilter] = useState("ALL");
  useEffect(() => { setApprovalHistoryPage(1); }, [historyTugFilter]);
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
              <select style={{...sty.select,width:"auto",paddingTop:3,paddingBottom:3,paddingLeft:6,paddingRight:6,minHeight:"unset",fontSize:12}} value={approvalPageSize} onChange={e=>setApprovalPageSize(Number(e.target.value))}>
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
        approveTxn={approveTxn} rejectTxn={rejectTxn} prepareReview={prepareReview} currentUser={currentUser}
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
        opnamePendingCount={hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length : 0}
        stockCountPendingCount={hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0}
        approvalTypeFilter={approvalTypeFilter}
        approvalPageSize={approvalPageSize}
        deleteDraftTug3={deleteDraftTug3}
        editDraftTug3={editDraftTug3} editTug5={editTug5} editTug10={editTug10} openEditCanonicalTug={openEditCanonicalTug}
        timMutuList={timMutuList}
        submitTUG4DanLampiran={submitTUG4DanLampiran}
        approveTUG3Final_Asman={approveTUG3Final_Asman}
        rejectTUG3Final_Asman={rejectTUG3Final_Asman}
        approveTUG3_TL={approveTUG3_TL}
        rejectTUG3_TL={rejectTUG3_TL}
        handleImg={handleImg}
      />

      {/* Perpindahan gudang oleh ADMIN wajib direview TL. */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.lokasiMovePending && ["TL", "ASMAN"].includes(s.lokasiMoveApprover)) && (()=>{
        const list = stocks.filter(s=>s.lokasiMovePending && ["TL", "ASMAN"].includes(s.lokasiMoveApprover));
        const paged = list.slice((approvalStokPage-1)*approvalPageSize, approvalStokPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>📦 Pemindahan Gudang Data Stok ({list.length})</div>
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

      {/* ── BAGIAN: Edit Data Stok (qty/harga/jenis) — khusus TL ── */}
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.editPending) && (()=>{
        const list = stocks.filter(s=>s.editPending);
        const paged = list.slice((approvalEditStokPage-1)*approvalPageSize, approvalEditStokPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>✏️ Edit Data Stok ({list.length})</div>
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
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>🗑️ Hapus Data Stok ({list.length})</div>
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
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="ALAT_BERAT") && hasRole(currentUser, "ASMAN") && heavyEquipmentLoans.some(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l, uptList)) && (()=>{
        const list = heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l, uptList));
        const paged = list.slice((approvalAlatBeratPage-1)*approvalPageSize, approvalAlatBeratPage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>🚜 Peminjaman Alat Berat ({list.length})</div>
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
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="OPNAME") && hasRole(currentUser, "ASMAN") &&
        opnameList.some(o=>o.status==="PENDING_ASMAN") && (()=>{
        const list = opnameList.filter(o=>o.status==="PENDING_ASMAN");
        const paged = list.slice((approvalOpnamePage-1)*approvalPageSize, approvalOpnamePage*approvalPageSize);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>📋 Stock Opname ({list.length})</div>
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
                    <button className="approval-btn--approve" onClick={()=>setReviewApproval(opn)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Periksa &amp; Setujui</button>
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
      {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOCK_COUNT") && hasRole(currentUser, "ASMAN", "TL") &&
        stockCountList.some(s=>s.items.some(i=>i.approval==="PENDING")) && (()=>{
        const list = stockCountList.flatMap(s=>s.items.filter(i=>i.approval==="PENDING").map(i=>({session:s, item:i})));
        const paged = list.slice((approvalStockCountPage-1)*approvalPageSize, approvalStockCountPage*approvalPageSize);
        const selectedPairs = list.filter(({session,item})=>selectedStockCount.has(`${session.id}_${item.id}`)).map(({session,item})=>({sessionId:session.id,itemId:item.id}));
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:10}}>
              <div style={{fontWeight:800,fontSize:13}}>📊 Stock Count ({list.length})</div>
              <button style={sty.btn("primary","sm")} disabled={selectedPairs.length===0} onClick={()=>{approveStockCountItems(selectedPairs); setSelectedStockCount(new Set());}}>
                ✓ Setuju terpilih ({selectedPairs.length})
              </button>
            </div>
            {paged.map(({session,item})=>{
              const key = `${session.id}_${item.id}`;
              return (
              <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <input type="checkbox" style={{marginTop:3}} checked={selectedStockCount.has(key)} onChange={()=>setSelectedStockCount(s=>{const n=new Set(s); n.has(key)?n.delete(key):n.add(key); return n;})}/>
                  <div>
                    <div style={{fontSize:12,fontWeight:700}}>{item.nama}</div>
                    <div style={{fontSize:12,color:C.muted}}>No. Katalog {item.katalogKode} • SAP {fmtNum(item.qtySap)} vs Aplikasi {item.katalogId?fmtNum(item.qtyApp):"Tidak terdaftar"} {item.satuan} • Selisih {item.selisih>0?"+":""}{fmtNum(item.selisih)} ({item.selisihPct}%) • {fmtDate(session.uploadedAt)}</div>
                  </div>
                </div>
                <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                  <button className="approval-btn--reject" onClick={()=>{
                    const reason = window.prompt("Alasan penolakan temuan Stock Count ini?");
                    if (reason) rejectStockCountItem(session.id, item.id, reason);
                  }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                </div>
              </div>
              );
            })}
            {renderApprovalPager(approvalStockCountPage, setApprovalStockCountPage, list.length)}
          </div>
        );
      })()}

      {/* ── BAGIAN: Riwayat Approval (gabungan semua jenis, terbaru di atas) ── */}
      {(()=>{
        const docKeyMap = {TUG3:"tug3",TUG5:"tug5",TUG7:"tug7",TUG8:"tug8",TUG9:"tug9",TUG10:"tug10"};
        const histTUG = txns.filter(t=>t.status==="APPROVED"||t.status==="REJECTED").map(t=>({
          id:`TUG-${t.id}`, type:"TUG", docType:t.docType, decision:t.status,
          title:`${t.docType||"TUG"} • ${t.docNumbers?.[docKeyMap[t.docType]] || t.id}`,
          decidedBy: t.status==="REJECTED" ? t.rejectedBy : (t.approvedBy || t.approvedByAsman),
          decidedAt: t.status==="REJECTED" ? t.rejectedAt : (t.approvedAt || t.approvedAtAsman),
          uptId:t.uptId, requestedBy:t.createdBy,
          requester: users.find(u=>u.id===t.createdBy),
          approver: users.find(u=>u.id===(t.status==="REJECTED" ? t.rejectedBy : (t.approvedBy || t.approvedByAsman))),
          upt: uptList.find(u=>u.id===t.uptId),
          reason: t.rejectionReason || t.rejectReason || t.catatan || t.keterangan,
          metadata: [
            ["Pekerjaan", t.namaPekerjaan || t.keteranganUmum], ["Lokasi pekerjaan", t.lokasiPekerjaan || t.lokasiTujuan],
            ["Supplier", t.dariSupplier], ["Penerima", [t.penerimaNama,t.penerimaJabatan,t.penerimaUnit].filter(Boolean).join(" • ")], ["Unit tujuan", t.unitTujuan || t.uptTujuan],
            ["Penyerah", [t.menyerahkanNama,t.menyerahkanUnit].filter(Boolean).join(" • ")], ["Tanggal transaksi", (t.tanggalTransaksi || t.tanggalDiterima) ? fmtDate(t.tanggalTransaksi || t.tanggalDiterima) : ""],
            ["No kendaraan", t.noKendaraan || t.nomorKendaraan], ["Surat jalan", t.noSuratJalan]
          ].filter(([,value])=>value),
          items: (t.stockItems||[]).map(si=>{
            const katalog = katalogList.find(k=>k.id===si.katalogId);
            const stock = enrichedStocks.find(s=>s.id===si.stockId);
            const lokasi = lokasiList.find(l=>l.id===(si.lokasiId || si.lokasiGudangId || si.lokasiTujuanId || stock?.lokasiId));
            const source = si.sourceSnapshot || si.sourceLot || si.data?.sourceLot;
            return {label: si.namaBaru || katalog?.name || "Item", katalog: katalog?.katalog || si.katalog || si.katalogId, qty: si.qty, satuan: si.unit || si.satuan || stock?.unit || stock?.satuan || katalog?.satuan, lokasi: lokasi?.nama || lokasi?.kode || stock?.lokasi || stock?.lokasiNama, sumber: formatKontrakSumber(source, stock?.kontrakRefs) || "Sumber belum dicatat"};
          }),
        }));
        const scopedHistTug = historyScope === null ? histTUG : histTUG.filter(h => inScopeUpt(userUptById.get(h.decidedBy), historyScope) || inScopeUpt(userUptById.get(h.requestedBy), historyScope) || inScopeUpt(h.uptId, historyScope));
        const combinedAll = [...scopedApprovalHistory, ...scopedHistTug].filter(h=>h.decidedAt).sort((a,b)=>b.decidedAt-a.decidedAt);
        // Filter jenis (chip filter atas) juga berlaku ke riwayat — sebelumnya diabaikan.
        const typeFilterMap = {TUG:["TUG"], ALAT_BERAT:["HEAVY_EQUIPMENT_LOAN"], OPNAME:["OPNAME"], STOCK_COUNT:["STOCK_COUNT"], STOK:["STOCK_MOVE","STOCK_EDIT","STOCK_DELETE"], LOKASI:["LOKASI"], KAPASITAS:["KAPASITAS"]};
        const byType = approvalTypeFilter==="ALL" ? combinedAll : combinedAll.filter(h=>(typeFilterMap[approvalTypeFilter]||[approvalTypeFilter]).includes(h.type));
        const historyTugTypes = ["TUG3","TUG5","TUG7","TUG8","TUG9","TUG10"];
        const historyTugCounts = historyTugTypes.map(docType=>({docType,count:byType.filter(h=>h.type==="TUG"&&h.docType===docType).length}));
        const subtypeFiltered = (approvalTypeFilter!=="ALL" && approvalTypeFilter!=="TUG") || historyTugFilter === "ALL"
          ? byType
          : byType.filter(h=>h.type==="TUG" && h.docType===historyTugFilter);
        const mine = approvalHistoryMineOnly ? subtypeFiltered.filter(h=>h.decidedBy===currentUser.id) : subtypeFiltered;
        const q = approvalHistorySearch.trim().toLowerCase();
        const searched = q ? mine.filter(h => [h.title,h.note,h.reason,h.refId,h.requestedAt,h.requester?.name,h.upt?.name,...(h.metadata||[]).flat(),...(h.items||[]).flatMap(it=>[it.label,it.katalog,it.lokasi,it.sumber])].filter(Boolean).join(" ").toLowerCase().includes(q)) : mine;
        const fromMs = approvalHistoryDateFrom ? new Date(approvalHistoryDateFrom+"T00:00:00").getTime() : null;
        const toMs = approvalHistoryDateTo ? new Date(approvalHistoryDateTo+"T23:59:59").getTime() : null;
        const filtered = searched.filter(h => (fromMs===null || h.decidedAt>=fromMs) && (toMs===null || h.decidedAt<=toMs));
        const combined = approvalHistoryShowAll ? filtered : filtered.slice((approvalHistoryPage-1)*approvalPageSize, approvalHistoryPage*approvalPageSize);
        const typeLabel = {LOKASI:"📍 Lokasi/Blok", STOCK_MOVE:"📦 Pemindahan Stok", STOCK_EDIT:"✏️ Edit Stok", STOCK_DELETE:"🗑️ Hapus Stok", HEAVY_EQUIPMENT_LOAN:"🚜 Peminjaman Alat", TUG:"🔄 TUG", OPNAME:"📋 Stock Opname", STOCK_COUNT:"📊 Stock Count", ATTB:"🧾 ATTB"};
        const typeOrder = ["TUG","HEAVY_EQUIPMENT_LOAN","OPNAME","STOCK_COUNT","LOKASI","STOCK_MOVE","STOCK_EDIT","STOCK_DELETE","ATTB"];
        const groupsByType = typeOrder
          .map(type=>({ type, items: combined.filter(h=>h.type===type) }))
          .filter(g=>g.items.length>0);
        // Jenis lain yang mungkin muncul di masa depan tapi belum ada di typeOrder — tetap ditampilkan.
        const knownTypes = new Set(typeOrder);
        combined.forEach(h=>{ if(!knownTypes.has(h.type)){ knownTypes.add(h.type); groupsByType.push({type:h.type, items:combined.filter(x=>x.type===h.type)}); } });
        return (
          <div style={{...sty.card,marginTop:16}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>📜 Riwayat Approval ({filtered.length})</div>
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG") && <div className="approval-tug-filters" role="group" aria-label="Filter riwayat tipe TUG">
              {[{docType:"ALL",label:"Semua TUG",count:byType.filter(h=>h.type==="TUG").length}, ...historyTugCounts.map(x=>({docType:x.docType,label:x.docType==="TUG3"?"TUG-3/4":x.docType.replace("TUG","TUG-"),count:x.count}))].map(({docType,label,count})=><button className="approval-tug-filter" type="button" key={docType} aria-pressed={historyTugFilter===docType} onClick={()=>setHistoryTugFilter(docType)} style={{borderColor:historyTugFilter===docType?C.accent:C.border,background:historyTugFilter===docType?C.accent:(C.surface||"white"),color:historyTugFilter===docType?"white":C.muted,fontWeight:historyTugFilter===docType?700:500}}>{label} ({count})</button>)}
            </div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:12}}>
              <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,cursor:"pointer"}}>
                <input type="checkbox" checked={approvalHistoryMineOnly} onChange={e=>setApprovalHistoryMineOnly(e.target.checked)}/>
                Approval saya
              </label>
              <input type="text" placeholder="Cari judul/barang…" value={approvalHistorySearch} onChange={e=>setApprovalHistorySearch(e.target.value)}
                style={{...sty.input,width:"auto",flex:"1 1 160px",minHeight:"unset",padding:"4px 8px",fontSize:12}}/>
              <input type="date" value={approvalHistoryDateFrom} onChange={e=>setApprovalHistoryDateFrom(e.target.value)}
                style={{...sty.input,width:"auto",minHeight:"unset",padding:"4px 8px",fontSize:12}}/>
              <span style={{fontSize:12,color:C.muted}}>s/d</span>
              <input type="date" value={approvalHistoryDateTo} onChange={e=>setApprovalHistoryDateTo(e.target.value)}
                style={{...sty.input,width:"auto",minHeight:"unset",padding:"4px 8px",fontSize:12}}/>
              <button style={sty.btn(approvalHistoryShowAll?"primary":"ghost","sm")} onClick={()=>setApprovalHistoryShowAll(v=>!v)}>
                {approvalHistoryShowAll ? "Tampilkan per halaman" : "Tampilkan semua"}
              </button>
            </div>
            {filtered.length===0 && <div style={{textAlign:"center",color:C.muted,padding:20,fontSize:13}}>Belum ada riwayat approval.</div>}
            {groupsByType.map(g=>(
              <div key={g.type} style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:800,color:"#0098da",marginBottom:4}}>{typeLabel[g.type]||g.type} ({g.items.length})</div>
                {g.items.map(h=>{
                  const decider = users.find(u=>u.id===h.decidedBy);
                  const requester = h.requester || users.find(u=>u.id===h.requestedBy);
                  const upt = h.upt || uptList.find(u=>u.id===h.uptId);
                  return (
                    <div key={h.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>{h.title}</div>
                          <div style={{fontSize:12,color:C.muted}}>Oleh {decider?.name||"?"} • {fmtDate(h.decidedAt)}</div>
                        </div>
                        <span style={{padding:"3px 10px",borderRadius: 14,fontSize:12,fontWeight:700,background:h.decision==="APPROVED"?"#dcfce7":"#fee2e2",color:h.decision==="APPROVED"?C.green:C.red}}>
                          {h.decision==="APPROVED"?"✓ Disetujui":"✕ Ditolak"}
                        </span>
                      </div>
                      {(h.items?.length > 0 || h.metadata?.length > 0 || h.reason || h.note || h.refId || h.requestedAt || h.requestedBy) && (
                        <details style={{marginTop:4}}>
                          <summary style={{fontSize:12,color:"#0098da",cursor:"pointer"}}>{h.items?.length || 0} item{h.metadata?.length ? " • Detail transaksi" : ""}</summary>
                          <div style={{marginTop:4,paddingLeft:12}}>
                            {h.metadata?.length > 0 && <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:"3px 12px",marginBottom:7}}>{h.metadata.map(([label,value])=><div key={label} style={{fontSize:11,color:C.muted}}><b>{label}:</b> {value}</div>)}</div>}
                            <div style={{display:"grid",gap:5}}>
                            {(h.items||[]).map((it,idx)=>(
                              <div key={idx} style={{fontSize:12,color:C.muted,lineHeight:1.35}}>
                                <div>📦 {it.label}{it.qty!=null && <> <b>x{fmtNum(it.qty)}{it.satuan ? ` ${it.satuan}` : ""}</b></>}</div>
                                {(it.katalog || it.lokasi || it.sumber) && <div style={{fontSize:11,paddingLeft:18}}> {it.katalog && `Katalog: ${it.katalog}`} {it.lokasi && ` • Lokasi: ${it.lokasi}`} {it.sumber && ` • Sumber: ${it.sumber}`}</div>}
                              </div>
                            ))}
                            </div>
                            <div style={{fontSize:11,color:C.muted,marginTop:7,paddingTop:6,borderTop:`1px solid ${C.border}`}}>
                              Pengaju: {requester?.name||"-"}{(upt?.nama||upt?.name||upt?.kode) ? ` • UPT: ${upt.nama||upt.name||upt.kode}` : ""}{h.requestedAt ? ` • Diajukan: ${fmtDate(h.requestedAt)}` : ""}{h.refId ? ` • Ref: ${h.refId}` : ""}{(h.reason||h.note) ? ` • Catatan: ${h.reason||h.note}` : ""}
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!approvalHistoryShowAll && renderApprovalPager(approvalHistoryPage, setApprovalHistoryPage, filtered.length)}
          </div>
        );
      })()}
      <StockOpnameApprovalReview opn={reviewApproval} C={C} sty={sty} users={users} lokasiList={lokasiList}
        onApprove={approveOpname_Asman} onClose={()=>setReviewApproval(null)} />
    </div>
  );
}
