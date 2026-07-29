// Komponen MasterDataTab — dipindah dari App.jsx (refactor batch 2b).
// Murni relokasi tab "Master Data" (tab==="master") beserta semua sub-tab
// (katalog, satpam, timmutu, organisasi, gudang, akun, migrasi, auditLog, perms).
// JSX/logic tidak diubah — hanya relokasi.
import { can } from "../lib/perms.js";
import { ROLES, hasRole } from "../lib/roles.js";
import { getSAPBadgeStyle } from "../lib/sap.js";
import { getSAPLabel } from "../lib/ragShared.mjs";
import { uid, fmtDate } from "../lib/utils.js";
import { subGudangKodeMap } from "../lib/masterSync.js";
import { KapasitasGudangImportTab } from "./KapasitasGudangImportTab.jsx";
import { ImportLokasiModal, downloadLokasiTemplate } from "./ImportLokasiModal.jsx";
import { GudangCoordConfigPanel } from "./GudangCoordConfigPanel.jsx";
import { MigrasiDataTab } from "./MigrasiDataTab.jsx";
import { AuditLogPage } from "./AuditLogPage.jsx";
import { PermMatrixPage } from "./PermMatrixPage.jsx";

export function MasterDataTab({ C, sty, currentUser, isMobile, rolePerms, stockSubTab, filteredKatalog, satpamList, timMutuList, uitList, uptList, ultgList, users, gudangList, lokasiList, subGudangList, visibleGudangList, openAddKatalog, openAddSatpam, openAddUIT, openAddGudang, openAddAkun, importGudangOpen, setImportGudangOpen, showGudangMaintenance, setShowGudangMaintenance, importLokasiOpen, setImportLokasiOpen, gudangCapacityImports, setGudangCapacityImports, saveToCloud, showToast, backfillGudangCoordFromCapacity, dedupeGudangDanSubGudang, isKodeDuplicateInSubGudang, setLokasiList, syncLokasi, maraUploadProgress, maraUploadLoading, uploadMaraToDB, katalogList, katalogSearch, setKatalogSearch, katalogFilterBelumMara, setKatalogFilterBelumMara, setBarcodePrintOpen, pagedKatalog, stocks, openEditKatalog, deleteKatalog, katalogPageSize, setKatalogPageSize, katalogPageClamped, setKatalogPage, katalogTotalPages, openEditSatpam, deleteSatpam, openEditTimMutu, orgSearch, setOrgSearch, collapsedUitIds, setCollapsedUitIds, openAddUPT, openEditUIT, deleteUIT, openAddULTG, openEditUPT, deleteUPT, openEditULTG, deleteULTG, expandedGudangId, setExpandedGudangId, openEditGudang, deleteGudang, showGudangDenahTools, setShowGudangDenahTools, uploadDenahGudang, denahLoading, mapConfigGudangId, setMapConfigGudangId, pendingMapLokasi, setPendingMapLokasi, manualAddMode, setManualAddMode, ocrSuggestGudangId, setOcrSuggestGudangId, ocrSuggestSubGudangId, setOcrSuggestSubGudangId, ocrSuggestions, setOcrSuggestions, assignLokasiKoordinat, suggestKodeFromOcr, expandedSubGudangToolsIds, setExpandedSubGudangToolsIds, uploadDenahSubGudang, denahSubLoading, mapConfigSubGudangId, setMapConfigSubGudangId, pendingMapLokasiSub, setPendingMapLokasiSub, manualAddModeSub, setManualAddModeSub, assignLokasiKoordinatSub, openEditLokasi, requestDeleteLokasi, selectedSubGudangId, setSelectedSubGudangId, openEditAkun, txns, migratedTug15History, setMigratedTug15History, migrasiPendingReview, setMigrasiPendingReview, maraReference, setMaraReference, setStocks, setKatalogList, setTxns, reloadRolePerms }) {
  return (
          <div className={`workspace-page master-page master-page--${stockSubTab}`}>
            <div className="workspace-page-toolbar">
              <div className="workspace-context-row">
                <span>
                  {stockSubTab==="katalog"?`${filteredKatalog.length} jenis barang terdaftar`:stockSubTab==="satpam"?`${satpamList.length} satpam terdaftar`:stockSubTab==="timmutu"?`${timMutuList.length} paket tim mutu`:stockSubTab==="organisasi"?`${uitList.length} UIT • ${uptList.length} UPT • ${ultgList.length} ULTG`:stockSubTab==="akun"?`${users.length} akun terdaftar`:stockSubTab==="migrasi"?"Cutover terkontrol data stok dari SAP — wajib backup sebelum apply":`${gudangList.length} gudang • ${lokasiList.length} blok lokasi terdaftar`}
                </span>
              </div>
              <div className="workspace-page-toolbar__actions">
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="katalog" && <button style={sty.btn("primary")} onClick={openAddKatalog}>+ Tambah Katalog Barang</button>}
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="satpam" && <button style={sty.btn("primary")} onClick={openAddSatpam}>+ Tambah Satpam</button>}
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="organisasi" && <button style={sty.btn("primary")} onClick={openAddUIT}>+ Tambah UIT</button>}
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="gudang" && <button style={sty.btn("primary")} onClick={openAddGudang}>+ Tambah Gudang Baru</button>}
                {can(currentUser, "aksi.kelolaAkun", rolePerms) && stockSubTab==="akun" && <button style={sty.btn("primary")} onClick={openAddAkun}>+ Daftarkan Akun Baru</button>}
              </div>
            </div>
            {stockSubTab==="gudang" && (
              <div style={{...sty.card,marginBottom:12,background:"#eff6ff",borderLeft:"4px solid #0369a1",padding:"10px 14px",fontSize:12,color:"#0369a1"}}>
                ℹ️ Sebagian besar Gudang biasanya <b>otomatis terbentuk sendiri</b> dari import Excel Kapasitas Gudang (tombol di bawah) setelah disetujui Asman. Kalau ada Gudang yang belum tercakup di laporan itu, tambahkan manual lewat tombol "+ Tambah Gudang Baru" di kanan atas.
              </div>
            )}
            {stockSubTab==="gudang" && can(currentUser, "aksi.import", rolePerms) && (
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <button style={sty.btn(importGudangOpen?"danger":"primary")} onClick={()=>setImportGudangOpen(o=>!o)}>
                    {importGudangOpen?"✕ Tutup Import Data Gudang":"📥 Import Data Gudang (Excel Kapasitas Gudang)"}
                  </button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={()=>setShowGudangMaintenance(o=>!o)}>
                    {showGudangMaintenance?"✕ Tutup Alat Perbaikan":"🔧 Alat Perbaikan Data Lanjutan"}
                  </button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={downloadLokasiTemplate}>⬇️ Download Template Lokasi</button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={()=>setImportLokasiOpen(true)}>📥 Import Excel Lokasi</button>
                </div>
                {importGudangOpen && (
                  <div style={{marginTop:12}}>
                    <KapasitasGudangImportTab
                      gudangCapacityImports={gudangCapacityImports}
                      setGudangCapacityImports={setGudangCapacityImports}
                      currentUser={currentUser}
                      sty={sty} C={C}
                      saveToCloud={saveToCloud}
                      showToast={showToast}
                    />
                  </div>
                )}
                {/* Dulu 2 tombol ini sejajar dengan "Import Data Gudang" tanpa penjelasan,
                    keliatan seperti 3 hal setara padahal cuma dipakai kalau ada masalah data
                    spesifik, bukan pemakaian rutin (keluhan user 2026-07-06: "kenapa ada 3
                    inputan"). Sekarang disembunyikan di balik toggle + dikasih penjelasan
                    kapan masing-masing dipakai. */}
                {showGudangMaintenance && (
                  <div style={{marginTop:12,...sty.card,background:"#fafafa",border:`1px dashed ${C.border}`,padding:14}}>
                    <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
                      Dua alat ini <b>bukan untuk pemakaian rutin</b> — cuma dipakai kalau menemukan masalah data spesifik berikut:
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div>
                        <button style={sty.btn("ghost","sm")} onClick={backfillGudangCoordFromCapacity}>🔄 Sinkron Koordinat dari Kapasitas Gudang</button>
                        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Pakai kalau titik lokasi Gudang di peta hilang/salah, padahal data Kapasitas Gudang untuk gudang itu sudah live — menarik ulang koordinat lat/lng dari sana.</div>
                      </div>
                      <div>
                        <button style={sty.btn("ghost","sm")} onClick={() => dedupeGudangDanSubGudang()}>🧹 Gabungkan Gudang Duplikat</button>
                        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Pakai kalau ada 2 Gudang/Sub Gudang dengan nama sama yang seharusnya satu (biasanya bikin denah/koordinat kelihatan "hilang" karena data nyasar ke ID yang berbeda).</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {importLokasiOpen && (
              <ImportLokasiModal
                onClose={()=>setImportLokasiOpen(false)}
                lokasiList={lokasiList} gudangList={gudangList} subGudangList={subGudangList}
                isKodeDuplicateInSubGudang={isKodeDuplicateInSubGudang}
                setLokasiList={setLokasiList} syncLokasi={syncLokasi}
                currentUser={currentUser} showToast={showToast}
                sty={sty} C={C}
              />
            )}
            {/* ── SUB-TAB: MASTER KATALOG ── */}
            {stockSubTab==="katalog" && hasRole(currentUser, "ADMIN") && (
              <div style={{...sty.card,marginBottom:12,borderLeft:"4px solid #0369a1",padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#0369a1"}}>📚 Referensi Katalog MARA</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>Upload file MARA agar tersedia sebagai referensi saat menambah katalog baru.</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    {maraUploadProgress && (
                      <span style={{fontSize:12,color:"#0369a1",fontWeight:700,padding:"4px 10px",background:"#e0f2fe",borderRadius:6}}>{maraUploadProgress}</span>
                    )}
                    <label style={{...sty.btn(maraUploadLoading?"ghost":"ghost","sm"),cursor:"pointer",borderColor:"#0369a1",color:"#0369a1"}}>
                      {maraUploadLoading ? "⏳ Mengupload..." : "📂 Upload MARA (.xlsx)"}
                      <input type="file" accept=".xlsx" style={{display:"none"}} disabled={maraUploadLoading}
                        onChange={e=>{ if(e.target.files?.[0]) uploadMaraToDB(e.target.files[0]); e.target.value=""; }}/>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {stockSubTab==="katalog" && katalogList.length>0 && (
              <div style={{marginBottom:12,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{position:"relative",maxWidth:420,flex:1,minWidth:220}}>
                  <input style={{...sty.input,paddingRight:32}} placeholder="🔍 Cari nama barang, no. katalog, kategori, jenis..." value={katalogSearch} onChange={e=>setKatalogSearch(e.target.value)}/>
                  {katalogSearch && (
                    <button
                      onClick={()=>setKatalogSearch("")}
                      title="Hapus pencarian"
                      style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                    >✕</button>
                  )}
                </div>
                {katalogList.some(k=>k.belumDicocokkanMara) && (
                  <button onClick={()=>setKatalogFilterBelumMara(v=>!v)}
                    style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${katalogFilterBelumMara?"#f59e0b":C.border}`,background:katalogFilterBelumMara?"#fef3c7":"white",color:katalogFilterBelumMara?"#92400e":C.text,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                    ⚠️ Belum Dicocokkan MARA ({katalogList.filter(k=>k.belumDicocokkanMara).length})
                  </button>
                )}
                {hasRole(currentUser, "ADMIN") && (
                  <button onClick={()=>setBarcodePrintOpen(true)} title="Cetak semua barcode/QR kartu gantung sekaligus"
                    style={{...sty.btn("primary","sm"),whiteSpace:"nowrap"}}>🖨️ Cetak Semua Barcode</button>
                )}
              </div>
            )}

            {stockSubTab==="katalog" && (
              katalogList.length===0
              ? <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Katalog. {hasRole(currentUser, "ADMIN") && "Klik \"+ Tambah Katalog Barang\" untuk menambahkan."}</div>
              : filteredKatalog.length===0
              ? <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Tidak ada hasil untuk "{katalogSearch}".</div>
              : (
              <div className="mobile-card-table catalog-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:860}}>
                  <thead>
                    <tr style={{background:C.sidebar,color:"white"}}>
                      {["Foto","No Katalog","Nama Barang","Kategori","Jenis","Satuan","Status","Aksi"].map(h=>(
                        <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"||h==="Foto"?"center":"left",whiteSpace:"nowrap",fontSize:12}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedKatalog.map(k=>{
                      const sampleFoto = stocks.find(s=>s.katalogId===k.id && s.img)?.img || null;
                      const bs = getSAPBadgeStyle(k.katalog);
                      return (
                        <tr className="mobile-card-table__row" key={k.id} style={{borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${C.accent}`}}>
                          <td className="mobile-card-table__photo" data-label="Foto" style={{padding:"8px 10px",textAlign:"center"}}>
                            {sampleFoto ? <img src={sampleFoto} alt={k.name} style={{width:40,height:40,borderRadius:6,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                              : <div style={{width:40,height:40,background:"#eff6ff",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,border:`1px solid #bfdbfe`,margin:"0 auto"}}>📦</div>}
                          </td>
                          <td className="catalog-card-table__meta" data-label="No Katalog" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                            <div style={{fontSize:12,color:"#0098da",fontWeight:700}}>📑 {k.katalog}</div>
                            <div style={{fontSize:12,color:C.muted}}>{k.id}</div>
                          </td>
                          <td className="mobile-card-table__title" data-label="Nama Barang" style={{padding:"8px 10px",minWidth:200,fontWeight:700}}>{k.name}</td>
                          <td data-label="Kategori" style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:12,background:"#f3f4f6",color:C.muted,whiteSpace:"nowrap"}}>{(k.name||"").split(";")[0]?.trim()||k.category||"Lainnya"}</span></td>
                          <td data-label="Jenis" style={{padding:"8px 10px"}}>
                            <span style={sty.jenisBadge(k.jenisBarang)}>{k.jenisBarang||"-"}</span>
                            {k.pendingOpnameId && <div style={{marginTop:3}}><span style={{padding:"1px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:"#dbeafe",color:"#1e40af"}}>⏳ Pending Approval</span></div>}
                            {k.belumDicocokkanMara && <div style={{marginTop:3}}><span style={{padding:"1px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:"#fef3c7",color:"#92400e"}}>⚠️ Belum MARA</span></div>}
                          </td>
                          <td data-label="Satuan" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{k.satuan}</td>
                          <td data-label="Status" style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(k.katalog)}</span></td>
                          <td data-label="Aksi" style={{padding:"8px 10px"}}>
                            {hasRole(currentUser, "ADMIN") && (
                              <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                                <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"6px 8px"}} onClick={()=>openEditKatalog(k)}>✏️</button>
                                <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"6px 8px"}} onClick={()=>deleteKatalog(k.id)}>🗑️</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )
            )}
            {stockSubTab==="katalog" && katalogList.length>0 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
                  Tampilkan
                  <select style={{...sty.select,width:"auto",padding:"4px 8px",minHeight:"unset",fontSize:12}} value={katalogPageSize} onChange={e=>setKatalogPageSize(Number(e.target.value))}>
                    {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  item per halaman — {katalogList.length} total
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button style={{...sty.btn("ghost","sm")}} disabled={katalogPageClamped<=1} onClick={()=>setKatalogPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                  <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {katalogPageClamped} / {katalogTotalPages}</span>
                  <button style={{...sty.btn("ghost","sm")}} disabled={katalogPageClamped>=katalogTotalPages} onClick={()=>setKatalogPage(p=>Math.min(katalogTotalPages,p+1))}>Berikutnya →</button>
                </div>
              </div>
            )}

            {/* ── SUB-TAB: SATPAM (dikelompokkan per gudang) ── */}
            {stockSubTab==="satpam" && (() => {
              if (satpamList.length===0) return <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada data Satpam. {hasRole(currentUser, "ADMIN") && "Klik \"+ Tambah Satpam\" untuk menambahkan."}</div>;
              const groups = [
                ...gudangList.map(g=>({ id:g.id, nama:g.nama, list:satpamList.filter(sp=>sp.gudangId===g.id) })),
                { id:"__none__", nama:"Belum di-assign gudang", list:satpamList.filter(sp=>!sp.gudangId || !gudangList.some(g=>g.id===sp.gudangId)) },
              ].filter(grp=>grp.list.length>0);
              const renderCard = sp => (
                <div key={sp.id} style={{...sty.card,borderTop:`3px solid ${C.accent}`}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                    {sp.foto
                      ? <img src={sp.foto} alt={sp.name} style={{width:44,height:44,borderRadius:"50%",objectFit:"cover",border:`1px solid #bfdbfe`,flexShrink:0}}/>
                      : <div style={{width:44,height:44,borderRadius:"50%",background:"#0b2559",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,flexShrink:0}}>{(sp.name||"?").trim().charAt(0).toUpperCase()}</div>}
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{sp.name}</div>
                      <div style={{fontSize:12,color:C.muted}}>{sp.id}{sp.telp ? ` • ${sp.telp}` : ""}</div>
                    </div>
                  </div>
                  {hasRole(currentUser, "ADMIN") && (
                    <div style={{display:"flex",gap:6}}>
                      <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>openEditSatpam(sp)}>✏️ Edit</button>
                      <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>deleteSatpam(sp.id)}>🗑️ Hapus</button>
                    </div>
                  )}
                </div>
              );
              return (
                <div style={{display:"flex",flexDirection:"column",gap:18}}>
                  {groups.map(grp=>(
                    <div key={grp.id}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:13,fontWeight:800,color:grp.id==="__none__"?C.muted:C.accent}}>
                        <span>{grp.id==="__none__"?"⚠️":"🏢"} {grp.nama}</span>
                        <span style={{fontSize:12,fontWeight:600,color:C.muted,background:"#eef2ff",borderRadius:20,padding:"1px 8px"}}>{grp.list.length}</span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
                        {grp.list.map(renderCard)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── SUB-TAB: TIM MUTU (2 paket tetap, hanya bisa diedit anggotanya) ── */}
            {stockSubTab==="timmutu" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
                {timMutuList.map(tm=>(
                  <div key={tm.id} style={{...sty.card,borderTop:`3px solid ${C.accent}`}}>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:8}}>👥 {tm.label}</div>
                    <div style={{fontSize:12,lineHeight:1.8}}>
                      <div><b>Ketua:</b> {tm.ketua||"-"}</div>
                      <div><b>Sekretaris:</b> {tm.sekretaris||"-"}</div>
                      <div><b>Anggota 1:</b> {tm.anggota1||"-"}</div>
                      <div><b>Anggota 2:</b> {tm.anggota2||"-"}</div>
                      <div><b>Anggota 3:</b> {tm.anggota3||"-"}</div>
                    </div>
                    {hasRole(currentUser, "ADMIN") && (
                      <button style={{...sty.btn("ghost","sm"),marginTop:10,width:"100%"}} onClick={()=>openEditTimMutu(tm)}>✏️ Edit Anggota</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── SUB-TAB: STRUKTUR ORGANISASI (UIT → UPT → ULTG, satu kesatuan) ── */}
            {stockSubTab==="organisasi" && (() => {
              const orgQ = orgSearch.trim().toLowerCase();
              const hit = (...vals) => vals.some(v => (v||"").toLowerCase().includes(orgQ));
              const uptMatchesSearch = (upt) => !orgQ || hit(upt.kode, upt.nama) || ultgList.some(x=>x.parentUptId===upt.id && hit(x.kode, x.nama));
              const uitMatchesSearch = (uit) => !orgQ || hit(uit.kode, uit.nama) || uptList.some(u=>u.uitId===uit.id && uptMatchesSearch(u));
              const visibleUit = uitList.filter(uitMatchesSearch);
              return (
              <div className="master-organization-page">
                {/* Ringkasan — sebelumnya cuma teks kecil di subtitle halaman, sekarang
                    KPI supaya langsung kelihatan skala struktur org tanpa harus scroll/
                    expand semua (keluhan user 2026-07-06: "kurang informatif"). */}
                <div className="master-organization-kpis" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
                  {[
                    {label:"Total UIT",val:uitList.length,color:C.accent},
                    {label:"Total UPT",val:uptList.length,color:"#0369a1"},
                    {label:"Total ULTG",val:ultgList.length,color:"#0891b2"},
                  ].map(kpi=>(
                    <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14,textAlign:"center"}}>
                      <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                      <div style={{fontSize:24,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
                    </div>
                  ))}
                </div>

                {uitList.length>0 && (
                  <div style={{position:"relative",maxWidth:420,marginBottom:16}}>
                    <input style={{...sty.input,paddingRight:32}} placeholder="🔍 Cari UIT, UPT, atau ULTG..." value={orgSearch} onChange={e=>setOrgSearch(e.target.value)}/>
                    {orgSearch && (
                      <button onClick={()=>setOrgSearch("")} title="Hapus pencarian"
                        style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                      >✕</button>
                    )}
                  </div>
                )}

                {uitList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master UIT.</div>}
                {uitList.length>0 && visibleUit.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Tidak ada hasil untuk "{orgSearch}".</div>}

                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {visibleUit.map(uit=>{
                    const uptOfUit = uptList.filter(u=>u.uitId===uit.id).filter(u=>!orgQ || uptMatchesSearch(u));
                    const totalUltgOfUit = ultgList.filter(x=>uptList.some(u=>u.uitId===uit.id && u.id===x.parentUptId)).length;
                    const isOpen = orgQ ? true : !collapsedUitIds.has(uit.id);
                    const toggleUit = () => setCollapsedUitIds(prev => {
                      const next = new Set(prev);
                      if (next.has(uit.id)) next.delete(uit.id); else next.add(uit.id);
                      return next;
                    });
                    return (
                      <div className="master-organization-card" key={uit.id} style={{...sty.card,padding:0,overflow:"hidden",borderLeft:"4px solid #003087"}}>
                        <div className="master-organization-card__header" style={{background:"#f8fafc"}} onClick={toggleUit}>
                          <div style={{display:"flex",gap:10,alignItems:"flex-start",minWidth:0}}>
                            <div style={{fontSize:22,flexShrink:0}}>🏢</div>
                            <div style={{minWidth:0}}>
                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                <span style={{fontSize:12,fontWeight:800,color:"white",background:C.sidebar,padding:"2px 6px",borderRadius:4,letterSpacing:0.5}}>UIT</span>
                                <span style={{fontWeight:800,fontSize:14}}>{uit.kode} — {uit.nama}</span>
                              </div>
                              <div style={{fontSize:12,color:C.muted,marginTop:3}}>📍 {uit.alamat||"Alamat belum diisi"}</div>
                              <div style={{fontSize:12,color:C.muted,marginTop:1}}>{uptOfUit.length} UPT • {totalUltgOfUit} ULTG</div>
                            </div>
                          </div>
                          <div className="master-organization-card__actions" onClick={e=>e.stopPropagation()}>
                            {hasRole(currentUser, "ADMIN") && (<>
                              <button style={sty.btn("ghost","sm")} onClick={()=>openAddUPT(uit.id)}>+ UPT</button>
                              <button title="Edit" style={sty.btn("ghost","sm")} onClick={()=>openEditUIT(uit)}>✏️</button>
                              <button title="Hapus" style={sty.btn("danger","sm")} onClick={()=>deleteUIT(uit.id)}>🗑️</button>
                            </>)}
                            <span onClick={toggleUit} style={{fontSize:14,color:C.muted,transition:"transform 0.15s",transform:isOpen?"rotate(90deg)":"rotate(0deg)",display:"inline-block",marginLeft:4,cursor:"pointer"}}>▶</span>
                          </div>
                        </div>

                        {isOpen && (
                          <div style={{padding:"0 14px 14px 14px"}}>
                            {uptOfUit.length===0
                              ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic",paddingLeft:14,paddingTop:10}}>Belum ada UPT di bawah UIT ini.</div>
                              : <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:18,borderLeft:`2px dashed ${C.border}`,marginTop:10}}>
                                  {uptOfUit.map(upt=>{
                                    const ultgOfUpt = ultgList.filter(x=>x.parentUptId===upt.id).filter(x=>!orgQ || hit(x.kode,x.nama) || hit(upt.kode,upt.nama));
                                    return (
                                      <div className="master-organization-upt" key={upt.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                                        <div className="master-organization-upt__header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                                          <div style={{display:"flex",gap:8,alignItems:"flex-start",minWidth:0}}>
                                            <div style={{fontSize:16,flexShrink:0}}>📍</div>
                                            <div style={{minWidth:0}}>
                                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                                <span style={{fontSize:12,fontWeight:800,color:"#0369a1",background:"#e0f2fe",padding:"1px 6px",borderRadius:4}}>UPT</span>
                                                <span style={{fontWeight:700,fontSize:13}}>{upt.kode} — {upt.nama}</span>
                                              </div>
                                              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{upt.alamat||"Alamat belum diisi"} • {ultgOfUpt.length} ULTG</div>
                                            </div>
                                          </div>
                                          {hasRole(currentUser, "ADMIN") && (
                                            <div className="master-organization-upt__actions" style={{display:"flex",gap:4,flexShrink:0}}>
                                              <button style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openAddULTG(upt.id)}>+ ULTG</button>
                                              <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openEditUPT(upt)}>✏️</button>
                                              <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>deleteUPT(upt.id)}>🗑️</button>
                                            </div>
                                          )}
                                        </div>
                                        {ultgOfUpt.length>0 && (
                                          <div className="master-organization-ultg-list" style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8,paddingLeft:24}}>
                                            {ultgOfUpt.map(ultg=>(
                                              <div className="master-organization-ultg" key={ultg.id} style={{display:"flex",alignItems:"center",gap:6,background:"#f0fdf4",border:`1px solid #bbf7d0`,borderRadius:20,padding:"4px 10px",fontSize:12}}>
                                                <span>🏘️ <b>{ultg.kode}</b> {ultg.nama}</span>
                                                {hasRole(currentUser, "ADMIN") && (
                                                  <span style={{display:"flex",gap:2,marginLeft:2}}>
                                                    <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"1px 4px",fontSize:12}} onClick={()=>openEditULTG(ultg)}>✏️</button>
                                                    <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"1px 4px",fontSize:12}} onClick={()=>deleteULTG(ultg.id)}>🗑️</button>
                                                  </span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                            }
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* ── SUB-TAB: MASTER GUDANG ── */}
            {stockSubTab==="gudang" && (
              <div className="master-warehouse-page">
                {/* Notifikasi approval blok lokasi sudah dipindahkan ke menu "✅ Approval" — lihat di sana. */}
                {gudangList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Gudang.</div>}
                {visibleGudangList.map(g=>{
                  const upt = uptList.find(u=>u.id===g.uptId);
                  const bloklokasi = lokasiList.filter(l=>l.gudangId===g.id);
                  const blokWithCoord = bloklokasi.filter(l=>l.mapX!=null);
                  const isExpanded = expandedGudangId===g.id;
                  const subsOfGudang = subGudangList.filter(sg=>sg.gudangId===g.id);
                  return (
                    <div className="master-warehouse-card" key={g.id} style={{...sty.card,marginBottom:10,borderTop:`3px solid #003087`}}>
                      <div className="master-warehouse-card__header" onClick={()=>setExpandedGudangId(isExpanded?null:g.id)}>
                        <div className="master-warehouse-card__copy">
                          <div style={{fontWeight:800,fontSize:15}}>🏭 {g.nama}</div>
                          <div style={{fontSize:12,color:C.muted}}>{g.kode} • {upt?.nama||"-"} • {g.alamat||"-"}</div>
                          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{bloklokasi.length} blok terkait, {blokWithCoord.length} sudah ter-peta{subsOfGudang.length>0?` • ${subsOfGudang.length} Sub Gudang`:""}</div>
                        </div>
                        <div className="master-warehouse-card__actions">
                          {hasRole(currentUser, "ADMIN") && (
                            <div className="master-warehouse-card__admin-actions" style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                              <button aria-label="Edit gudang" title="Edit gudang" style={sty.btn("ghost","sm")} onClick={()=>openEditGudang(g)}>{isMobile?"✏️":"✏️ Edit"}</button>
                              <button title="Hapus" style={sty.btn("danger","sm")} onClick={()=>deleteGudang(g.id)}>🗑️</button>
                            </div>
                          )}
                          <span style={{fontSize:14,color:C.muted,transition:"transform 0.15s",transform:isExpanded?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>▶</span>
                        </div>
                      </div>

                      {isExpanded && <div style={{marginTop:14}}>

                      {/* Denah + Konfigurasi Koordinat level Gudang — disembunyikan di balik toggle
                          collapsed-by-default (dulu selalu terbuka penuh: upload + preview + panel
                          konfigurasi besar, bikin halaman kepanjangan padahal yang paling dibutuhkan
                          user cuma Daftar Blok Lokasi di bawah — keluhan user 2026-07-06). Kalau
                          Gudang ini PUNYA Sub Gudang, tombol Konfigurasi Koordinat di level ini
                          SENGAJA tidak ditampilkan — dot Blok baru cuma boleh dikonfigurasi di peta
                          Sub Gudang masing-masing, bukan di peta keseluruhan Gudang (aturan baru). */}
                      <button style={{...sty.btn("ghost","sm"),marginBottom:12}} onClick={()=>setShowGudangDenahTools(o=>!o)}>
                        {showGudangDenahTools?"✕ Tutup Denah & Koordinat Gudang":"🛠️ Kelola Denah & Koordinat Gudang"}
                      </button>

                      {showGudangDenahTools && (
                      <div style={{marginBottom:12}}>
                        {hasRole(currentUser, "ADMIN") && (
                          <div style={{marginBottom:12}}>
                            <label style={sty.label}>Upload Denah Gudang (PNG / JPG) — peta keseluruhan</label>
                            <div style={{fontSize:12,color:C.muted,marginBottom:4}}>
                              💡 Convert PDF denah ke gambar terlebih dahulu (screenshot, foto, atau export dari PDF viewer)
                            </div>
                            <input type="file" accept="image/*" capture="environment"
                              onChange={e=>{const f=e.target.files[0];if(f)uploadDenahGudang(g.id,f);}}
                              style={{fontSize:12,color:C.muted}}/>
                            {denahLoading && (
                              <div style={{fontSize:12,color:"#1d4ed8",marginTop:4}}>
                                ⏳ Mengompres dan menyimpan gambar...
                              </div>
                            )}
                            {g.denahUploadedAt && !denahLoading && (
                              <div style={{fontSize:12,color:C.green,marginTop:4}}>
                                ✅ Denah tersimpan • {fmtDate(g.denahUploadedAt)}
                              </div>
                            )}
                          </div>
                        )}

                        {g.denahImageData && (
                          <div style={{marginBottom:12}}>
                            <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah (peta keseluruhan Gudang):</div>
                            <img src={g.denahImageData} alt="Denah Gudang" style={{width:"100%",maxHeight:200,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                          </div>
                        )}

                        {hasRole(currentUser, "ADMIN") && g.denahImageData && (
                          subsOfGudang.length===0 ? (
                            <GudangCoordConfigPanel
                              label="Gudang"
                              denahImage={g.denahImageData}
                              isOpen={mapConfigGudangId===g.id}
                              onToggleOpen={()=>{const willOpen=mapConfigGudangId!==g.id;setMapConfigGudangId(willOpen?g.id:null);setPendingMapLokasi(null);setManualAddMode(willOpen);}}
                              manualAddMode={manualAddMode} setManualAddMode={setManualAddMode}
                              pendingMapLokasi={pendingMapLokasi} setPendingMapLokasi={setPendingMapLokasi}
                              blocksInScope={bloklokasi}
                              getCoord={l=>l.mapX!=null?{x:l.mapX,y:l.mapY}:null}
                              draftDots={ocrSuggestGudangId===g.id && !ocrSuggestSubGudangId ? ocrSuggestions : []}
                              onAssignCoord={(lokasiId,xPct,yPct)=>assignLokasiKoordinat(lokasiId,xPct,yPct,g.id)}
                              onAddDraft={(xPct,yPct)=>{
                                const totalUsulan = bloklokasi.length + ocrSuggestions.length;
                                const kodeUsulan = suggestKodeFromOcr(g, xPct, yPct) || `${g.kode||"BLOK"}-${String(totalUsulan+1).padStart(2,"0")}`;
                                setOcrSuggestions(prev=>[...prev, { id: uid(), kode: kodeUsulan, jenisArea:"Rak Tertutup", luasan:"", xPct, yPct, checked: true }]);
                                setOcrSuggestGudangId(g.id);
                                setOcrSuggestSubGudangId(null);
                              }}
                              onFinishAdding={()=>{setManualAddMode(false);setPendingMapLokasi(null);setMapConfigGudangId(null);}}
                              ocrNotReady={g.denahOcrWords==null}
                              sty={sty} C={C} showToast={showToast}
                            />
                          ) : (
                            <div style={{fontSize:12,color:"#0369a1",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px"}}>
                              ℹ️ Gudang ini punya {subsOfGudang.length} Sub Gudang — atur koordinat Blok baru di peta masing-masing Sub Gudang di bawah, bukan di peta keseluruhan ini.
                            </div>
                          )
                        )}
                      </div>
                      )}

                      {/* Sub Gudang milik Gudang ini, tiap Sub Gudang punya daftar Blok + denah sendiri.
                          Kalau Gudang ini punya Sub Gudang, klik Gudang cuma tampilkan MENU Sub Gudang
                          dulu (nama + jumlah blok) — klik salah satu Sub Gudang baru tampil Daftar Blok
                          Lokasi-nya. Kalau Gudang tidak punya Sub Gudang sama sekali, langsung tampilkan
                          daftar bloknya (tidak ada yang perlu dipilih) — permintaan user 2026-07-06. */}
                      <div style={{marginTop:16}}>
                        {(() => {
                          const knownSubIds = new Set(subsOfGudang.map(sg=>sg.id));
                          const subKodeMap = subGudangKodeMap(subsOfGudang);
                          const umumBlok = bloklokasi.filter(l=>!l.subGudangId || !knownSubIds.has(l.subGudangId));
                          const groups = [
                            ...subsOfGudang.map(sg=>({ id:sg.id, sg, nama:sg.nama, blok: bloklokasi.filter(l=>l.subGudangId===sg.id) })),
                            { id:null, sg:null, nama:"Umum / Belum Dikelompokkan", blok: umumBlok },
                          ];

                          function renderGroupDetail(grp) {
                            const isSubToolsOpen = grp.sg ? expandedSubGudangToolsIds.has(grp.sg.id) : false;
                            const toggleSubTools = () => { if (!grp.sg) return; setExpandedSubGudangToolsIds(prev=>{
                              const next = new Set(prev);
                              if (next.has(grp.sg.id)) next.delete(grp.sg.id); else next.add(grp.sg.id);
                              return next;
                            }); };
                            // Blok "tidak terdaftar" (belum di-assign ke Sub Gudang manapun, padahal Gudang
                            // ini SUDAH punya Sub Gudang) — tidak perlu tombol "+ Tambah Blok" di sini,
                            // cukup arahkan Admin assign dulu lewat ✏️ Edit lalu atur koordinatnya di Sub
                            // Gudang yang benar (permintaan user 2026-07-06).
                            const isUnregistered = !grp.sg && subsOfGudang.length>0;
                            return (
                            <div key={grp.id||"umum"} style={{marginBottom:18,paddingLeft:10,borderLeft:`3px solid ${C.border}`}}>
                              {grp.sg && <div style={{fontSize:13,fontWeight:800,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>🏢 Sub Gudang: {grp.nama}{subKodeMap[grp.sg.id] && <span title="Kode singkatan Sub Gudang (dipakai sebagai tag di depan kode blok)" style={{fontSize:12,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 7px",borderRadius:6}}>{subKodeMap[grp.sg.id]}</span>}</div>}

                              {/* Denah + Konfigurasi Koordinat level Sub Gudang — collapsed by default,
                                  sama alasan seperti level Gudang di atas. Hanya untuk grup real (grp.sg),
                                  "Umum" tidak pernah dikasih tools konfigurasi sendiri. Ditaruh di atas
                                  Daftar Blok Lokasi (permintaan user 2026-07-09) supaya user langsung
                                  ketemu tools denah/koordinat sebelum scroll ke daftar blok. */}
                              {grp.sg && (
                                <div style={{marginBottom:14}}>
                                  <button style={sty.btn("ghost","sm")} onClick={toggleSubTools}>
                                    {isSubToolsOpen?"✕ Tutup Denah & Koordinat Sub Gudang":"🛠️ Kelola Denah & Koordinat Sub Gudang"}
                                  </button>
                                  {isSubToolsOpen && (
                                    <div style={{marginTop:10}}>
                                      {hasRole(currentUser, "ADMIN") && (
                                        <div style={{marginBottom:10}}>
                                          <label style={{...sty.label,fontSize:12}}>Upload Denah Sub Gudang (PNG / JPG) — opsional, fallback ke denah Gudang jika kosong</label>
                                          <div>
                                            <input type="file" accept="image/*" capture="environment"
                                              onChange={e=>{const f=e.target.files[0];if(f)uploadDenahSubGudang(grp.sg.id,g.id,f);}}
                                              style={{fontSize:12,color:C.muted}}/>
                                          </div>
                                          {denahSubLoading && <div style={{fontSize:12,color:"#1d4ed8",marginTop:4}}>⏳ Mengompres dan menyimpan gambar...</div>}
                                          {grp.sg.denahUploadedAt && !denahSubLoading && <div style={{fontSize:12,color:C.green,marginTop:4}}>✅ Denah tersimpan • {fmtDate(grp.sg.denahUploadedAt)}</div>}
                                        </div>
                                      )}
                                      {grp.sg?.denahImageData && (
                                        <div style={{marginBottom:10}}>
                                          <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah Sub Gudang:</div>
                                          <img src={grp.sg.denahImageData} alt="Denah Sub Gudang" style={{width:"100%",maxHeight:180,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                                        </div>
                                      )}
                                      {hasRole(currentUser, "ADMIN") && grp.sg.denahImageData && (
                                        <GudangCoordConfigPanel
                                          label="Sub Gudang"
                                          denahImage={grp.sg.denahImageData}
                                          isOpen={mapConfigSubGudangId===grp.sg.id}
                                          onToggleOpen={()=>{const willOpen=mapConfigSubGudangId!==grp.sg.id;setMapConfigSubGudangId(willOpen?grp.sg.id:null);setPendingMapLokasiSub(null);setManualAddModeSub(willOpen);}}
                                          manualAddMode={manualAddModeSub} setManualAddMode={setManualAddModeSub}
                                          pendingMapLokasi={pendingMapLokasiSub} setPendingMapLokasi={setPendingMapLokasiSub}
                                          blocksInScope={grp.blok}
                                          getCoord={l=>l.subMapX!=null?{x:l.subMapX,y:l.subMapY}:null}
                                          draftDots={ocrSuggestSubGudangId===grp.sg.id ? ocrSuggestions : []}
                                          onAssignCoord={(lokasiId,xPct,yPct)=>assignLokasiKoordinatSub(lokasiId,xPct,yPct,grp.sg.id,g.id)}
                                          onAddDraft={(xPct,yPct)=>{
                                            const totalUsulan = grp.blok.length + ocrSuggestions.length;
                                            const kodeUsulan = suggestKodeFromOcr(grp.sg, xPct, yPct) || `${grp.sg.nama?.slice(0,6).toUpperCase()||"BLOK"}-${String(totalUsulan+1).padStart(2,"0")}`;
                                            setOcrSuggestions(prev=>[...prev, { id: uid(), kode: kodeUsulan, jenisArea:"Rak Tertutup", luasan:"", xPct, yPct, checked: true }]);
                                            setOcrSuggestGudangId(g.id);
                                            setOcrSuggestSubGudangId(grp.sg.id);
                                          }}
                                          onFinishAdding={()=>{setManualAddModeSub(false);setPendingMapLokasiSub(null);setMapConfigSubGudangId(null);}}
                                          ocrNotReady={false}
                                          sty={sty} C={C} showToast={showToast}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {isUnregistered && grp.blok.length>0 && (
                                <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
                                  ⚠️ {grp.blok.length} blok belum dikelompokkan ke Sub Gudang manapun. Klik ✏️ di baris blok untuk assign ke Sub Gudang yang benar, baru atur koordinatnya di sana.
                                </div>
                              )}

                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                <div style={{fontSize:12,color:C.muted}}>📍 Daftar Blok Lokasi ({grp.blok.length})</div>
                                {hasRole(currentUser, "ADMIN") && !isUnregistered && <span style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>➕ Tambah blok lewat 🛠️ Kelola Denah & Koordinat di atas</span>}
                              </div>
                              {grp.blok.length===0
                                ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic",marginBottom:8}}>Belum ada blok lokasi di sub gudang ini.</div>
                                : <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                                    {grp.blok.map(l=>{
                                      const n = stocks.filter(s=>s.lokasiId===l.id).length;
                                      const hasCoord = grp.sg ? l.subMapX!=null : l.mapX!=null;
                                      return (
                                        <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:6,fontSize:12}}>
                                          <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                                            {grp.sg && subKodeMap[grp.sg.id] && <span title={`Sub Gudang: ${grp.sg.nama}`} style={{fontSize:12,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 6px",borderRadius:6,flexShrink:0}}>{subKodeMap[grp.sg.id]}</span>}
                                            <span style={{fontWeight:700}}>{l.kode}</span>
                                            {l.nama && <span style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.nama}</span>}
                                            {l.status==="PENDING" && <span style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>MENUNGGU APPROVAL TL</span>}
                                            {!hasCoord && <span style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>BELUM ADA KOORDINAT</span>}
                                          </div>
                                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                                            <span style={{fontSize:12,color:n>0?C.accent:C.muted,fontWeight:700}}>{n} item</span>
                                            {hasRole(currentUser, "ADMIN") && <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"2px 8px"}} onClick={()=>openEditLokasi(l)}>✏️</button>}
                                            {hasRole(currentUser, "ADMIN") && <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"2px 8px"}} onClick={()=>requestDeleteLokasi(l)}>🗑️</button>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                              }
                            </div>
                            );
                          }

                          if (subsOfGudang.length === 0) {
                            // Tidak ada Sub Gudang sama sekali — tidak ada yang perlu "dipilih", langsung
                            // tampilkan daftar blok (grup "Umum" satu-satunya).
                            return renderGroupDetail(groups[0]);
                          }

                          const menuGroups = groups.filter(grp => grp.sg || grp.blok.length>0);
                          return (
                            <>
                              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                                {menuGroups.map(grp=>{
                                  const key = grp.id||"umum";
                                  const isSelected = selectedSubGudangId===key;
                                  return (
                                    <div key={key}>
                                      <div onClick={()=>setSelectedSubGudangId(isSelected?null:key)}
                                        style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:isSelected?"#eff6ff":"#f9fafb",border:`1px solid ${isSelected?"#93c5fd":C.border}`,borderRadius:8,cursor:"pointer"}}>
                                        <div style={{fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>{grp.sg?"🏢":"📦"} {grp.nama}{grp.sg && subKodeMap[grp.sg.id] && <span style={{fontSize:12,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 6px",borderRadius:6}}>{subKodeMap[grp.sg.id]}</span>}</div>
                                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                                          <span style={{fontSize:12,color:C.muted}}>{grp.blok.length} blok</span>
                                          <span style={{fontSize:12,color:C.muted,transition:"transform 0.15s",transform:isSelected?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>▶</span>
                                        </div>
                                      </div>
                                      {isSelected && renderGroupDetail(grp)}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SUB-TAB: KELOLA AKUN (aksi.kelolaAkun, default ADMIN) ── */}
            {stockSubTab==="akun" && can(currentUser, "aksi.kelolaAkun", rolePerms) && (
              <div style={sty.card}>
                {users.length===0 ? (
                  <div style={{textAlign:"center",color:C.muted,padding:30}}>Belum ada akun terdaftar.</div>
                ) : (
                  <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{width:"100%",minWidth:640,borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{borderBottom:`2px solid ${C.border}`,textAlign:"left"}}>
                        <th style={{padding:"8px 6px"}}>Nama</th>
                        <th style={{padding:"8px 6px"}}>Username</th>
                        <th style={{padding:"8px 6px"}}>Role</th>
                        <th style={{padding:"8px 6px"}}>Jabatan</th>
                        <th style={{padding:"8px 6px"}}>UPT</th>
                        <th style={{padding:"8px 6px"}}>ULTG</th>
                        <th style={{padding:"8px 6px"}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u=>(
                        <tr key={u.id} style={{borderBottom:`1px solid ${C.border}`}}>
                          <td style={{padding:"8px 6px",fontWeight:700}}>{u.name}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{u.username}</td>
                          <td style={{padding:"8px 6px"}}>{ROLES[u.role]||u.role}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{u.jabatan||"-"}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{uptList.find(p=>p.id===u.uptId)?.nama||"-"}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{ultgList.find(g=>g.id===u.ultgId)?.nama||"-"}</td>
                          <td style={{padding:"8px 6px"}}><button style={sty.btn("ghost","sm")} onClick={()=>openEditAkun(u)}>✏️ Edit</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )}

            {/* ── SUB-TAB: MIGRASI DATA (ADMIN only) ── */}
            {stockSubTab==="migrasi" && hasRole(currentUser, "ADMIN") && (
              <MigrasiDataTab
                stocks={stocks}
                katalogList={katalogList}
                lokasiList={lokasiList}
                txns={txns}
                migratedTug15History={migratedTug15History}
                setMigratedTug15History={setMigratedTug15History}
                migrasiPendingReview={migrasiPendingReview}
                setMigrasiPendingReview={setMigrasiPendingReview}
                maraReference={maraReference}
                setMaraReference={setMaraReference}
                maraUploadLoading={maraUploadLoading}
                maraUploadProgress={maraUploadProgress}
                uploadMaraToDB={uploadMaraToDB}
                currentUser={currentUser}
                sty={sty} C={C}
                saveToCloud={saveToCloud}
                setStocks={setStocks}
                setKatalogList={setKatalogList}
                setTxns={setTxns}
                showToast={showToast}
                rolePerms={rolePerms}
              />
            )}

            {/* ── SUB-TAB: AUDIT LOG (ADMIN only) ── */}
            {stockSubTab==="auditLog" && hasRole(currentUser, "ADMIN") && (
              <AuditLogPage sty={sty} C={C}/>
            )}

            {/* ── SUB-TAB: MATRIX IZIN (ADMIN only) ── */}
            {stockSubTab==="perms" && hasRole(currentUser, "ADMIN") && (
              <PermMatrixPage sty={sty} C={C} currentUser={currentUser} rolePerms={rolePerms} reloadRolePerms={reloadRolePerms} showToast={showToast}/>
            )}
          </div>
  );
}
