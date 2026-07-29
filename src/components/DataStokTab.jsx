// Komponen DataStokTab — dipindah dari App.jsx (refactor batch 2a).
// Murni relokasi tab "Data Stok" (tab==="stock"); JSX/logic tidak berubah.
import { JENIS_BARANG } from "../constants.js";
import { resolveStockPhotoUrl } from "../lib/stockCache.js";
import { buildAdminStockLocationUpdate } from "../lib/stockLocationApproval.js";
import { getSAPBadgeStyle } from "../lib/sap.js";
import { hasRole } from "../lib/roles.js";
import { getLokasiPetaInfo } from "../lib/masterSync.js";
import { fmtNum, getSAPLabel } from "../lib/ragShared.mjs";
import { Camera, X, ImageSquare, Tag, MapPin } from "@phosphor-icons/react";
import "../styles/stock.css";

// Keep block selectors deterministic without changing the source lokasiList.
// Numeric-aware locale sorting makes codes such as BLOK-2 come before BLOK-10;
// the name (then id) provides stable tie-breakers for duplicate/blank codes.
function sortBlokOptions(options) {
  return [...options].sort((a, b) => {
    const byKode = String(a?.kode || "").localeCompare(String(b?.kode || ""), "id", { numeric: true, sensitivity: "base" });
    if (byKode !== 0) return byKode;
    const byNama = String(a?.nama || "").localeCompare(String(b?.nama || ""), "id", { numeric: true, sensitivity: "base" });
    if (byNama !== 0) return byNama;
    return String(a?.id || "").localeCompare(String(b?.id || ""), "id", { numeric: true, sensitivity: "base" });
  });
}

export function DataStokTab({
  C, sty, currentUser, isMobile,
  search, setSearch,
  setPhotoSearchImg, setPhotoSearchOpen,
  filterJenis, setFilterJenis,
  filteredStocks, stocks, setStocks,
  photoSearchResults, setPhotoSearchResults, photoSearchResultMode, photoSearchOcrText,
  enrichedStocks, pagedStocks,
  setStockDetailId,
  katalogList, lokasiList, gudangList, subGudangList, visibleGudangList,
  stockGudangFilter, setStockGudangFilter,
  setPendingFoto, setLightboxImg,
  saveToCloud, showToast,
  openEditStock, deleteStock,
  setKartuGantungDetail, setPetaMiniDetail,
  stockPageSize, setStockPageSize, stockPageClamped, setStockPage, stockTotalPages,
}) {
  return (
          <div className="workspace-page stock-page">
            <div className="workspace-filter-panel">
              <div style={{display:"flex",gap:8,alignItems:"stretch"}}>
                <div style={{position:"relative",flex:1}}>
                  <label className="stock-search-label" htmlFor="stock-search-input">Cari Data Stok</label>
                  <input id="stock-search-input" aria-label="Cari Data Stok" style={{...sty.input,paddingRight:32,fontSize:16}} placeholder="Cari nama, kode, keterangan, lokasi..." value={search} onChange={e=>setSearch(e.target.value)}/>
                  {search && (
                    <button
                      onClick={()=>setSearch("")}
                      title="Hapus pencarian"
                      style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                    ><X size={16} aria-hidden="true" /></button>
                  )}
                </div>
                <button type="button" className="stock-photo-search-button" aria-label="Cari barang berdasarkan foto" title="Cari barang berdasarkan foto" onClick={()=>{setPhotoSearchImg(null);setPhotoSearchOpen(true);}}
                  style={{...sty.btn("primary"),whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                  <Camera size={18} weight="bold" aria-hidden="true" />
                  {!isMobile && <span>Cari Foto</span>}
                </button>
              </div>
              <select style={{...sty.select,maxWidth:280}} value={filterJenis} onChange={e=>setFilterJenis(e.target.value)}>
                <option value="ALL">Semua Jenis</option>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}
              </select>
              <div className="workspace-context-row">
                <span><strong>{filteredStocks.length}</strong> baris stok</span>
                <span>Barang × lokasi</span>
                {stocks.filter(s=>!s.lokasiId).length>0 && <span className="is-warning">{stocks.filter(s=>!s.lokasiId).length} material belum memiliki lokasi</span>}
              </div>
              {photoSearchResults && (
                <div style={{...sty.card,padding:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontWeight:800,fontSize:13}}><Camera size={16} weight="bold" style={{verticalAlign:"-0.15em",marginRight:5}} aria-hidden="true"/> Hasil pencarian foto — {photoSearchResults.length} barang {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
                    <button style={sty.btn("ghost","sm")} onClick={()=>setPhotoSearchResults(null)}><X size={15} aria-hidden="true" /> Reset</button>
                  </div>
                  {photoSearchResultMode==="nameplate" && photoSearchOcrText && (
                    <div style={{fontSize:12,color:C.muted,background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",marginBottom:10,whiteSpace:"pre-wrap",maxHeight:60,overflowY:"auto"}}>
                      <b>Teks nameplate terbaca:</b> {photoSearchOcrText}
                    </div>
                  )}
                  {photoSearchResults.length===0 ? (
                    <div style={{fontSize:12,color:C.muted}}>{photoSearchResultMode==="nameplate"?"Tidak ada katalog yang cocok dengan teks nameplate. Pastikan nomor katalog/type terbaca jelas, atau coba foto lebih dekat & fokus.":"Tidak ada barang dengan kemiripan ≥75%. Coba foto lain atau sudut/pencahayaan berbeda."}</div>
                  ) : (
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
                      {photoSearchResults.map(r=>{
                        const est = enrichedStocks.find(s=>String(s.katalog)===String(r.katalog));
                        const thumb = resolveStockPhotoUrl(est?.fotoKeseluruhan || est?.img);
                        const pct = Math.round((r.similarity||0)*100);
                        return (
                          <div key={r.katalog} onClick={()=>est&&setStockDetailId(est.id)} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:10,cursor:est?"pointer":"default",display:"flex",gap:10,alignItems:"center",background:C.surface}}>
                            {thumb ? <img src={thumb} alt="" style={{width:54,height:54,objectFit:"cover",borderRadius:8,flexShrink:0,border:`1px solid ${C.border}`}}/> : <div style={{width:54,height:54,borderRadius:8,background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ImageSquare size={22} color={C.accent} aria-hidden="true"/></div>}
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontWeight:700,fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{est?.name||"(tidak ada di Data Stok)"}</div>
                              <div style={{fontSize:12,color:"#0098da",fontWeight:700}}><Tag size={13} style={{verticalAlign:"-0.15em",marginRight:3}} aria-hidden="true"/> {r.katalog}</div>
                              <div style={{fontSize:12,fontWeight:800,color:pct>=80?C.green:pct>=70?"#d97706":C.muted,marginTop:2}}>{pct}% {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {katalogList.length===0 && (
              <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20,marginBottom:16}}>
                ℹ️ Belum ada Master Katalog. Tambahkan jenis barang dulu di menu "Master Data" → "Master Katalog" sebelum membuat Data Stok.
              </div>
            )}
            {/* Tampilan tabel horizontal (data & fungsi tidak berubah, cuma cara
                merendernya — semua handler/state sama persis dengan versi kartu
                sebelumnya). */}
            <div className="mobile-card-table stock-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:980}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    {["Foto","Nama Barang","Kategori","Qty","Gudang","Blok","Harga","Status","Aksi"].map(h=>(
                      <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"||h==="Foto"?"center":"left",whiteSpace:"nowrap",fontSize:12}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedStocks.map(st=>{
                    const isLow = st.jenisBarang!=="Non-Stock" && st.qty<=st.minQty;
                    const noLokasi = !st.lokasiId;
                    const lok = lokasiList.find(l=>l.id===st.lokasiId);
                    // Fallback ke st.gudangId (declared, independen dari Blok) kalau belum ada Blok
                    // tersimpan — ditemukan 2026-07-10 (sama seperti bug ATTB): kalau Gudang yang
                    // dipilih ternyata tidak punya Blok terdaftar sama sekali, dropdown Blok kosong dan
                    // pilihan Gudang (yang tadinya cuma filter lokal, tidak pernah disimpan) hilang lagi
                    // tiap render ulang. Sekarang gudangId disimpan langsung ke stok begitu dipilih.
                    const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : (st.gudangId ? gudangList.find(g=>g.id===st.gudangId) : null);
                    const effGudangIdForBlok = stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? "";
                    const blokOptionsForStock = sortBlokOptions(lokasiList.filter(l=>l.gudangId===effGudangIdForBlok));
                    const petaInfo = getLokasiPetaInfo(lok, gdg, subGudangList);
                    const canLihatPeta = !!petaInfo;
                    const hasDenah = !!(gdg?.denahImageData || (lok?.subGudangId && subGudangList.find(s=>s.id===lok.subGudangId)?.denahImageData));
                    return (
                      <tr className="mobile-card-table__row" key={st.id} onClick={()=>{setPendingFoto({}); setStockDetailId(st.id);}} style={{cursor:"pointer",background:st.deletePending?"#fef2f2":undefined,borderBottom:`1px solid ${C.border}`,borderLeft:`3px ${st.deletePending?"dashed #dc2626":"solid"} ${st.deletePending?"#dc2626":noLokasi?"#f59e0b":isLow?C.red:st.jenisBarang==="Non-Stock"?"#be185d":C.green}`}}>
                        <td className="mobile-card-table__photo" data-label="Foto" onClick={e=>{ if(st.fotoKeseluruhan){e.stopPropagation(); setLightboxImg(resolveStockPhotoUrl(st.fotoKeseluruhan));} }} style={{padding:"8px 10px",textAlign:"center",cursor:st.fotoKeseluruhan?"zoom-in":"default"}}>
                          {st.fotoKeseluruhan ? <img src={resolveStockPhotoUrl(st.fotoKeseluruhan)} alt={st.name} style={{width:48,height:48,borderRadius:6,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                            : <div style={{width:48,height:48,background:"#eff6ff",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,border:`1px solid #bfdbfe`,margin:"0 auto"}}><ImageSquare size={22} color="#1d4ed8" aria-hidden="true"/></div>}
                        </td>
                        <td className="stock-mobile-summary" aria-label={`Ringkasan ${st.name}`}>
                          <div className="stock-mobile-summary__head"><strong>{st.name}</strong><span>{st.katalog||"-"}</span></div>
                          <div className="stock-mobile-summary__description">{st.keteranganBarang || "Keterangan barang belum diisi."}</div>
                          <div className="stock-mobile-summary__meta"><span><MapPin size={14} weight="bold" aria-hidden="true"/> {[gdg?.kode||gdg?.nama, lok?.kode||st.lokasi].filter(Boolean).join(" • ") || "Lokasi belum diisi"}</span><span className={isLow ? "is-critical" : "is-ok"}>{st.jenisBarang==="Non-Stock" ? "Project-Based" : `${fmtNum(st.qty)} ${st.unit}`}</span></div>
                        </td>
                        <td className="mobile-card-table__title" data-label="Nama Barang" style={{padding:"8px 10px",minWidth:200}}>
                          <div style={{fontWeight:700,color:C.text}}>{st.name}</div>
                          <div style={{fontSize:12,color:"#0098da",fontWeight:700,marginTop:1}}><Tag size={13} style={{verticalAlign:"-0.15em",marginRight:3}} aria-hidden="true"/> {st.katalog||"-"}</div>
                          {st.deletePending && <div style={{fontSize:12,color:"#dc2626",fontWeight:700,marginTop:2}}>⏳ Menunggu approval Hapus</div>}
                          {st.editPending && <div style={{fontSize:12,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Ada perubahan menunggu approval TL</div>}
                        </td>
                        <td data-label="Kategori" style={{padding:"8px 10px"}}>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",maxWidth:160}}>
                            <span style={sty.jenisBadge(st.jenisBarang)}>{st.jenisBarang}</span>
                            <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,background:"#f3f4f6",color:C.muted}}>{st.category}</span>
                          </div>
                        </td>
                        <td data-label="Qty" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                          {st.jenisBarang==="Non-Stock"
                            ? <span style={{color:C.muted}}>Project-Based</span>
                            : <div>
                                <span style={{fontWeight:700,color:isLow?C.red:C.green}}>{fmtNum(st.qty)} {st.unit}</span>
                                <div style={{fontSize:12,color:C.muted}}>Min {fmtNum(st.minQty)} {st.unit}</div>
                              </div>}
                          {isLow && <div style={{fontSize:12,color:C.red,fontWeight:700,marginTop:2}}>⚠️ Stok kritis</div>}
                        </td>
                        <td data-label="Gudang" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:120}}>
                          {hasRole(currentUser, "ADMIN","TL") ? (
                            <select
                              value={stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? ""}
                              style={{...sty.select,fontSize:12,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8}}
                              onChange={async e=>{
                                const v = e.target.value;
                                setStockGudangFilter(prev=>({...prev,[st.id]:v}));
                                // Gudang selector only scopes the target Blok options. The
                                // canonical stock gudang/location changes together when a
                                // concrete Blok is selected below; this prevents an approval
                                // from combining a new gudang with the old lokasi.
                              }}>
                              <option value="">-- Pilih Gudang --</option>
                              {visibleGudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                            </select>
                          ) : (
                            <span style={{color:C.text}}>{gdg?.kode||gdg?.nama||"—"}</span>
                          )}
                        </td>
                        <td data-label="Blok" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:150}}>
                          {hasRole(currentUser, "ADMIN") ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                style={{...sty.select,fontSize:12,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:noLokasi?"#fffbeb":"#f9fafb"}}
                                onChange={async e=>{
                                  const newLokasiId = e.target.value;
                                  const lokSel = lokasiList.find(l=>l.id===newLokasiId);
                                  const sourceLocation = lokasiList.find(l=>l.id===st.lokasiId) || (st.lokasiId ? { gudangId: st.gudangId } : null);
                                  const updated = buildAdminStockLocationUpdate(st, sourceLocation, lokSel, currentUser.id);
                                  const ns = stocks.map(s=>s.id===st.id?updated:s);
                                  setStocks(ns);
                                  // Update lokasi/blok 1 barang — cuma baris ini yang berubah (sync ringan, bukan 212 baris ~18.7MB).
                                  await saveToCloud({stocks:ns}, {stocksChangedRows: [updated]});
                                  showToast(`📍 Lokasi ${st.name} → ${lokSel?.kode||"-"} disimpan.`);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {blokOptionsForStock.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {effGudangIdForBlok && blokOptionsForStock.length===0 && <div style={{fontSize:12,color:"#b45309",fontStyle:"italic",marginTop:2}}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
                            </>
                          ) : hasRole(currentUser, "TL") ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                disabled={st.lokasiMovePending}
                                style={{...sty.select,fontSize:12,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:st.lokasiMovePending?"#f3f4f6":noLokasi?"#fffbeb":"#f9fafb"}}
                                onChange={async e=>{
                                  const newLokasiId = e.target.value;
                                  const lokSel = lokasiList.find(l=>l.id===newLokasiId);
                                  // TL yang pindahkan stok yang SUDAH punya lokasi ke Gudang lain wajib
                                  // approval Asman (TL sendiri yang biasanya approve pemindahan Admin,
                                  // jadi pemindahan lintas Gudang oleh TL butuh persetujuan Asman UPT).
                                  // Isi lokasi PERTAMA KALI (lok kosong) tetap langsung tanpa approval,
                                  // sama seperti pindah blok dalam Gudang yang sama.
                                  const pindahGudang = !!lok && (lokSel?.gudangId||null) !== (lok?.gudangId||null);
                                  let updated, msg;
                                  if (pindahGudang) {
                                    updated = {...st, lokasiMovePending:true, lokasiMoveApprover:"ASMAN", pendingLokasiId:newLokasiId, pendingLokasiKode:lokSel?.kode||"-", moveRequestedBy:currentUser.id, moveRequestedAt:Date.now()};
                                    msg = `📨 Pemindahan ${st.name} ke Gudang lain (${lokSel?.kode||"-"}) diajukan! Menunggu approval Asman.`;
                                  } else {
                                    updated = {...st, lokasiId:newLokasiId, lokasi:lokSel?.kode||"-", lokasiMovePending:false, lokasiMoveApprover:null, pendingLokasiId:null, pendingLokasiKode:null};
                                    msg = `📍 Blok ${st.name} → ${lokSel?.kode||"-"}`;
                                  }
                                  const ns = stocks.map(s=>s.id===st.id?updated:s);
                                  setStocks(ns);
                                  // Update lokasi/blok 1 barang — cuma baris ini yang berubah (sync ringan, bukan 212 baris ~18.7MB).
                                  await saveToCloud({stocks:ns}, {stocksChangedRows: [updated]});
                                  showToast(msg);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {blokOptionsForStock.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {effGudangIdForBlok && blokOptionsForStock.length===0 && <div style={{fontSize:12,color:"#b45309",fontStyle:"italic",marginTop:2}}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
                              {st.lokasiMovePending && <div style={{fontSize:12,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Menunggu approval {st.lokasiMoveApprover||"Asman"} → {st.pendingLokasiKode}</div>}
                            </>
                          ) : (
                            <span style={{color:noLokasi?"#f59e0b":C.text,fontWeight:noLokasi?700:400}}>{noLokasi?"⚠️ Belum diisi":st.lokasi||"—"}</span>
                          )}
                        </td>
                        <td data-label="Harga" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>Rp {fmtNum(st.price)}</td>
                        <td data-label="Status" style={{padding:"8px 10px"}}>
                          {(()=>{const bs=getSAPBadgeStyle(st.katalog);return <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(st.katalog)}</span>})()}
                        </td>
                        <td data-label="Aksi" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px"}}>
                          <div className="stock-mobile-direct-actions" onClick={e=>e.stopPropagation()}>
                            <button
                              className="table-action-button stock-mobile-action--location"
                              aria-label="Lokasi"
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !hasDenah ? "Denah belum diupload (Master Data â†’ Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                              onClick={()=>{
                                if (canLihatPeta) { setPetaMiniDetail({stock:st, lokasi:lok, gudang:gdg, petaInfo}); return; }
                                if (!lok) { showToast("Blok/Lokasi belum diisi untuk material ini.","error"); return; }
                                if (!hasDenah) { showToast(`Denah "${gdg?.nama||lok?.kode||"-"}" belum diupload. Upload di Master Data â†’ Master Gudang.`,"error"); return; }
                                showToast(`Blok ${lok?.kode||"-"} belum diplot koordinatnya di denah. Atur di Master Data â†’ Master Gudang.`,"error");
                              }}><MapPin size={16} weight="bold" aria-hidden="true" /></button>
                            <button className="table-action-button stock-mobile-action--card" aria-label="Kartu Gantung Digital" title="Kartu Gantung Digital"
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}><Tag size={16} weight="bold" aria-hidden="true" /> <span>Kartu Gantung</span></button>
                          </div>
                          <div className="stock-desktop-actions" onClick={e=>e.stopPropagation()}>
                            <div className="table-actions">
                            {hasRole(currentUser, "ADMIN") && (
                              <>
                                <button className="table-action-button" title="Edit data stok" disabled={st.deletePending} onClick={()=>openEditStock(st)}>Edit</button>
                                <button className="table-action-button is-danger" title="Hapus data stok" disabled={st.deletePending} onClick={()=>deleteStock(st.id)}>Hapus</button>
                              </>
                            )}
                            <button className="table-action-button is-icon" title="Kartu Gantung TUG-2"
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}><Tag size={16} weight="bold" aria-hidden="true" /></button>
                            <button
                              className="table-action-button is-icon"
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !hasDenah ? "Denah belum diupload (Master Data → Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                              onClick={()=>{
                                if (canLihatPeta) { setPetaMiniDetail({stock:st, lokasi:lok, gudang:gdg, petaInfo}); return; }
                                if (!lok) { showToast("Blok/Lokasi belum diisi untuk material ini.","error"); return; }
                                if (!hasDenah) { showToast(`Denah "${gdg?.nama||lok?.kode||"-"}" belum diupload. Upload di Master Data → Master Gudang.`,"error"); return; }
                                showToast(`Blok ${lok?.kode||"-"} belum diplot koordinatnya di denah. Atur di Master Data → Master Gudang.`,"error");
                              }}><MapPin size={16} weight="bold" aria-hidden="true" /></button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredStocks.length===0 && (
                    <tr><td colSpan={9} style={{padding:30,textAlign:"center",color:C.muted}}>Tidak ada data stok untuk filter ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredStocks.length > 0 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
                  Tampilkan
                  <select style={{...sty.select,width:"auto",padding:"4px 8px",minHeight:"unset",fontSize:12}} value={stockPageSize} onChange={e=>setStockPageSize(Number(e.target.value))}>
                    {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  item per halaman — {filteredStocks.length} total
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button style={{...sty.btn("ghost","sm")}} disabled={stockPageClamped<=1} onClick={()=>setStockPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                  <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {stockPageClamped} / {stockTotalPages}</span>
                  <button style={{...sty.btn("ghost","sm")}} disabled={stockPageClamped>=stockTotalPages} onClick={()=>setStockPage(p=>Math.min(stockTotalPages,p+1))}>Berikutnya →</button>
                </div>
              </div>
            )}
          </div>
  );
}
