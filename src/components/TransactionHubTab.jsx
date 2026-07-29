// Komponen TransactionHubTab — dipindah dari App.jsx (refactor batch 2c).
// Murni relokasi blok hub pemilihan jenis TUG (tab==="transaction"); JSX/logic tidak berubah.
import { TUG3Tab } from "./TUG3Tab.jsx";
import { TUG5Tab } from "./TUG5Tab.jsx";
import { TUG15Tab } from "./TUG15Tab.jsx";
import { ROLES, hasRole } from "../lib/roles.js";
import { can } from "../lib/perms.js";
import { fmtDate } from "../lib/utils.js";
import { statusMaterialBadgeStyle } from "../lib/sap.js";

export function TransactionHubTab({
  C, sty, currentUser, isMobile,
  TUG_UI, TUG_GROUP_UI,
  tugGroup, tugSubTab, setTugSubTab,
  activeTugSummary, rolePerms,
  filterStatus, setFilterStatus,
  openNewTxn,
  txns, filteredTxns, users, enrichedStocks, stocks,
  katalogList, lokasiList, gudangList, timMutuList, uitList, uptList, ultgList,
  tug15Filter, setTug15Filter,
  setDocPreview, handleImg,
  approveTUG3_TL, rejectTUG3_TL,
  submitTUG4Form, approveTUG4_Manager, rejectTUG4_Manager,
  submitTUG3FinalLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman,
  approveTUG5_Asman, rejectTUG5_Asman, approveTUG5_Manager, rejectTUG5_Manager,
  submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik,
  konfirmasiDraftTUG8, approveTUG5_MgrULTG, rejectTUG5_MgrULTG,
  adoptTUG5ULTG, openDraftTug9,
}){
  return (
          <div className="workspace-page tug-page">
            <section className={`kpi-banner tug-summary-banner${tugSubTab==="TUG15"?" is-context-only":""}`} aria-label="Ringkasan transaksi TUG">
              <div className="tug-summary-banner__context">
                <div className="tug-summary-banner__copy">
                  <span>{(TUG_GROUP_UI[tugGroup]||{}).label}</span>
                  <strong>{tugSubTab==="TUG15"
                    ? `${(TUG_UI[tugSubTab]||{}).code || "TUG-15"} — ${(TUG_UI[tugSubTab]||{}).title || "Laporan Mutasi Stok"}`
                    : (TUG_UI[tugSubTab]||{}).title || "Dokumen TUG"}</strong>
                  <small>{(TUG_UI[tugSubTab]||{}).desc || ""}</small>
                </div>
              </div>
              {tugSubTab!=="TUG15" && (
                <div className="tug-summary-banner__metrics">
                  {activeTugSummary.map(metric=>(
                    <div key={metric.label} className={`kpi-banner__item${metric.cls?" "+metric.cls:""}`}>
                      <strong>{metric.val}</strong><span>{metric.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {tugSubTab!=="TUG15" && <section className="tug-process-tabs" aria-label="Pilihan jenis transaksi TUG">
              <div className="tug-process-tabs__header">
                <strong>Pilih jenis transaksi</strong>
                <span>Klik kartu untuk membuka proses yang dibutuhkan</span>
              </div>
              <div className="tug-process-tabs__options" role="tablist" aria-label="Pilih proses TUG">
                {(tugGroup==="penerimaan" ? ["TUG3","TUG10"]
                  : tugGroup==="pengeluaran" ? ["TUG9","TUG8"]
                  : tugGroup==="laporan" ? ["TUG15"]
                  : ["TUG5"]
                ).map(id=>{
                  const u = TUG_UI[id]||{}; const on = tugSubTab===id;
                  return (
                  <button key={id} className={on?"is-active":""} onClick={()=>setTugSubTab(id)} title={u.code} role="tab" aria-selected={on}>
                    <span>{u.code||id}</span>
                    <strong>{u.chip||id}</strong>
                    <small>{on?"Sedang dibuka":"Klik untuk buka"}</small>
                  </button>
                  );
                })}
              </div>
            </section>}
            {(can(currentUser, "aksi.buatTransaksi", rolePerms) || hasRole(currentUser, "ADMIN_ULTG")) && (tugSubTab==="TUG3"||tugSubTab==="TUG10"||tugSubTab==="TUG9"||tugSubTab==="TUG8"||tugSubTab==="TUG5") && (
              <div className="tug-action-row">
                <div><span>Aksi transaksi aktif</span><strong>{(TUG_UI[tugSubTab]||{}).title || "Dokumen TUG"}</strong></div>
                <button className="tug-primary-action" onClick={()=>openNewTxn(tugSubTab)}>{(TUG_UI[tugSubTab]||{}).buat || "Buat Baru"}</button>
              </div>
            )}
            {tugSubTab!=="TUG15" && <div className="tug-status-filter">
              <span>Status dokumen</span>
              {["ALL","PENDING","APPROVED","REJECTED","DRAFT"].map(s=>(
                <button key={s} className={filterStatus===s?"is-active":""} onClick={()=>setFilterStatus(s)}>{s==="ALL"?"Semua":s==="PENDING"?"Menunggu":s==="APPROVED"?"Disetujui":s==="REJECTED"?"Ditolak":"Draft"}</button>
              ))}
            </div>}

            {tugSubTab==="TUG3" ? (
              <TUG3Tab
                txns={txns.filter(t=>t.docType==="TUG3")}
                filterStatus={filterStatus}
                users={users} sty={sty} C={C} currentUser={currentUser}
                katalogList={katalogList} lokasiList={lokasiList} timMutuList={timMutuList}
                approveTUG3_TL={approveTUG3_TL} rejectTUG3_TL={rejectTUG3_TL}
                submitTUG4Form={submitTUG4Form} approveTUG4_Manager={approveTUG4_Manager} rejectTUG4_Manager={rejectTUG4_Manager}
                submitTUG3FinalLampiran={submitTUG3FinalLampiran} approveTUG3Final_Asman={approveTUG3Final_Asman} rejectTUG3Final_Asman={rejectTUG3Final_Asman}
                handleImg={handleImg} setDocPreview={setDocPreview}
              />
            ) : tugSubTab==="TUG5" ? (
              <TUG5Tab
                txns={txns}
                filterStatus={filterStatus}
                users={users} sty={sty} C={C} currentUser={currentUser}
                katalogList={katalogList} uitList={uitList} uptList={uptList}
                approveTUG5_Asman={approveTUG5_Asman} rejectTUG5_Asman={rejectTUG5_Asman}
                approveTUG5_Manager={approveTUG5_Manager} rejectTUG5_Manager={rejectTUG5_Manager}
                submitTUG7_AdminUIT={submitTUG7_AdminUIT}
                approveTUG7_MgrLogistik={approveTUG7_MgrLogistik} rejectTUG7_MgrLogistik={rejectTUG7_MgrLogistik}
                konfirmasiDraftTUG8={konfirmasiDraftTUG8}
                setDocPreview={setDocPreview}
                ultgList={ultgList}
                approveTUG5_MgrULTG={approveTUG5_MgrULTG} rejectTUG5_MgrULTG={rejectTUG5_MgrULTG}
                adoptTUG5ULTG={adoptTUG5ULTG} openDraftTug9={openDraftTug9}
                isMobile={isMobile}
              />
            ) : tugSubTab==="TUG15" ? (
              <TUG15Tab
                txns={txns} katalogList={katalogList} stocks={stocks}
                sty={sty} C={C}
                filter={{...tug15Filter, ultgList, uitList}} setFilter={setTug15Filter}
                lokasiList={lokasiList} gudangList={gudangList}
              />
            ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredTxns.filter(t=>t.docType===tugSubTab).length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada transaksi {tugSubTab.replace("TUG","TUG-")}</div>}
              {filteredTxns.filter(t=>t.docType===tugSubTab).map(t=>{
                const creator = users.find(u=>u.id===t.createdBy)||{};
                const approver = users.find(u=>u.id===t.approvedBy)||{};
                const dKey = t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":"tug10";
                const lokTujuan = lokasiList.find(l=>l.id===t.lokasiTujuanId);
                return (
                  <div key={t.id} style={{...sty.card}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:14}}>{t.namaPekerjaan}</div>
                        <div style={{fontSize:12,color:"#0098da",fontWeight:700}}>{t.docNumbers[dKey]}</div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        {t.legacyImport && <span title="Diimpor dari histori lama" style={{padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700,background:"#ede9fe",color:"#6d28d9"}}>🕘 Legacy</span>}
                        <span style={sty.statusBadge(t.status)}>{t.status}</span>
                      </div>
                    </div>
                    <div style={{fontSize:12,color:C.muted,display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
                      <span>📍 {t.lokasiPekerjaan}</span>
                      <span>📅 {fmtDate(t.createdAt)}</span>
                      <span>👷 {creator.name||"-"} ({ROLES[creator.role]})</span>
                      {t.docType==="TUG8" && <span>🏭 Unit Tujuan: {t.unitTujuan}</span>}
                      {(t.docType==="TUG9"||t.docType==="TUG8") && <span>🏢 Penerima: {t.penerimaNama} ({t.penerimaUnit})</span>}
                      {t.docType==="TUG10" && <span>📍 Disimpan di: {lokTujuan?.kode||"-"}</span>}
                      {t.docType==="TUG10" && <span>📤 Menyerahkan: {t.menyerahkanNama}</span>}
                    </div>
                    <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                      {t.docType!=="TUG10" ? t.stockItems.map((si,idx)=>{
                        const stock = enrichedStocks.find(s=>s.id===si.stockId);
                        return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {stock?.name||"?"} <b>x{si.qty}</b> {stock?.unit} <span style={{fontSize:12,color:C.muted}}>@ {stock?.lokasi}</span> <span style={sty.jenisBadge(stock?.jenisBarang)}>{stock?.jenisBarang}</span></div>;
                      }) : t.stockItems.map((si,idx)=>{
                        const namaBarang = si.katalogMode==="existing" ? (katalogList.find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
                        const bs = statusMaterialBadgeStyle(si.statusMaterial);
                        return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {namaBarang} <b>x{si.qty}</b> <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,background:bs.bg,color:bs.fg,fontWeight:700}}>{si.statusMaterial}</span>{si.noSeri && <span style={{fontSize:12,color:C.muted}}> • SN: {si.noSeri}</span>}</div>;
                      })}
                    </div>
                    {t.status==="APPROVED" && <div style={{fontSize:12,color:C.green,marginBottom:8}}>✅ Disetujui oleh {approver.name} ({ROLES[approver.role]}) • {fmtDate(t.approvedAt)} {t.asmanAutoApproved && "• Asman Konstruksi otomatis ikut menyetujui"}</div>}
                    {t.status==="REJECTED" && <div style={{fontSize:12,color:C.red,marginBottom:8}}>❌ Ditolak: {t.rejectReason}</div>}
                    {t.status==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat & Unduh Dokumen {t.docType.replace("TUG","TUG-")}</button>}
                  </div>
                );
              })}
            </div>
            )}
          </div>
  );
}
