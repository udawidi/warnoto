// Komponen DataStokTab — dipindah dari App.jsx (refactor batch 2a).
// Batch 1 simplifikasi tampilan (2026-08-11): tabel 5 kolom ringkas, detail
// lengkap (Kategori/Harga/Status/Gudang/Blok/Lokasi UPT/Edit/Hapus) pindah ke
// modal detail (App.jsx). Kolom Gudang/Blok pindah ke modal "Pindah Blok".
import { useState, useRef, useEffect } from "react";
import { JENIS_BARANG, STATUS_SAP } from "../constants.js";
import { resolveStockPhotoUrl } from "../lib/stockCache.js";
import { sapBadgeStyleForLabel, stockSapLabel } from "../lib/sap.js";
import { hasRole } from "../lib/roles.js";
import { getLokasiPetaInfo, sortBlokOptions } from "../lib/masterSync.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { Camera, X, ImageSquare, Tag, MapPin, ArrowsLeftRight, CaretUp, CaretDown, CaretRight, Clock, Barcode } from "@phosphor-icons/react";
import { OperationsHero } from "./OperationsHero.jsx";
import { PindahBlokModal } from "./PindahBlokModal.jsx";
import "../styles/stock.css";

export function DataStokTab({
  C, sty, currentUser, isMobile,
  search, setSearch, openScanner,
  setPhotoSearchImg, setPhotoSearchOpen,
  filterJenis, setFilterJenis,
  filterStatusSAP, setFilterStatusSAP,
  stockUptFilter, setStockUptFilter, stockUptFilterOptions, uptNama,
  stockGudangSelect, setStockGudangSelect, stockBlokSelect, setStockBlokSelect,
  stockQuickFilter, setStockQuickFilter, stockSort, setStockSort,
  stockViewMode, setStockViewMode, stockViewCount,
  filteredStocks, stocks, setStocks,
  photoSearchResults, setPhotoSearchResults, photoSearchResultMode, photoSearchOcrText,
  enrichedStocks, pagedStocks,
  setStockDetailId,
  katalogList, lokasiList, gudangList, uptList, subGudangList, visibleGudangList,
  stockGudangFilter, setStockGudangFilter,
  setPendingFoto, setLightboxImg,
  saveToCloud, showToast,
  deleteStock,
  setKartuGantungDetail, setPetaMiniDetail,
  stockPageSize, setStockPageSize, stockPageClamped, setStockPage, stockTotalPages,
}) {
  const [moveStock, setMoveStock] = useState(null); // {st, lok, gdg} — trigger modal Pindah Blok
  const searchInputRef = useRef(null);

  // Shortcut "/" fokus ke pencarian — diabaikan kalau sedang mengetik di field lain.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "/" || e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const kritisCount = enrichedStocks.filter(s => s.jenisBarang !== "Non-Stock" && s.qty <= s.minQty).length;
  const tanpaLokasiCount = enrichedStocks.filter(s => !s.lokasiId).length;
  const blokSelectOptions = stockGudangSelect ? sortBlokOptions(lokasiList.filter(l => l.gudangId === stockGudangSelect)) : [];
  const anyFilterActive = !!(search || filterJenis!=="ALL" || filterStatusSAP!=="ALL" || stockUptFilter || stockGudangSelect || stockBlokSelect || stockQuickFilter);
  const resetAllFilters = () => { setSearch(""); setFilterJenis("ALL"); setFilterStatusSAP("ALL"); setStockUptFilter(""); setStockGudangSelect(""); setStockBlokSelect(""); setStockQuickFilter(""); };
  const toggleSort = (key) => setStockSort(prev => prev.key===key ? {key, dir: prev.dir==="asc"?"desc":"asc"} : {key, dir:"asc"});
  const sortAria = (key) => stockSort.key===key ? (stockSort.dir==="asc"?"ascending":"descending") : "none";

  // Highlight potongan teks yang cocok dengan kata kunci pencarian (Nama Barang / no. katalog).
  // Substring case-insensitive saja — bukan tokenizer/fuzzy. Escape regex agar "(", "*", dll dari
  // input user tidak bikin RegExp invalid/crash.
  const highlightNeedle = search.trim().length >= 2 ? search.trim() : "";
  function highlightText(text) {
    const str = String(text ?? "");
    if (!highlightNeedle) return str;
    const escaped = highlightNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = str.split(new RegExp(`(${escaped})`, "gi"));
    if (parts.length === 1) return str;
    return parts.map((part, i) => part.toLowerCase() === highlightNeedle.toLowerCase()
      ? <mark key={i} style={{background:"#fef08a",color:"inherit",padding:0,fontSize:"inherit"}}>{part}</mark>
      : part);
  }

  return (
          <div className="workspace-page stock-page">
            <OperationsHero
              eyebrow="Persediaan"
              title="Data Stok"
              description="Pantau posisi stok material per lokasi gudang secara ringkas dan akurat."
              scope={stockUptFilterOptions?.length>0 ? (stockUptFilter ? (stockUptFilterOptions.find(u=>u.id===stockUptFilter)?.nama||"UPT terpilih") : "Semua UPT") : uptNama}
              metrics={[
                {label: stockViewMode==="katalog" ? "Total jenis barang" : "Total baris stok", value:stockViewCount},
                {label:"Stok kritis",value:kritisCount,alert:kritisCount>0},
                {label:"Belum ada lokasi",value:tanpaLokasiCount,alert:tanpaLokasiCount>0},
              ]}
            />
            <div className="workspace-filter-panel">
              <div style={{display:"flex",gap:8,alignItems:"stretch"}}>
                <div style={{position:"relative",flex:1}}>
                  <label className="stock-search-label" htmlFor="stock-search-input">Cari Data Stok</label>
                  <input ref={searchInputRef} id="stock-search-input" aria-label="Cari Data Stok" style={{...sty.input,paddingRight:32,fontSize:15}} placeholder="Cari nama/no. katalog… (tekan /)" value={search} onChange={e=>setSearch(e.target.value)}/>
                  {search && (
                    <button
                      onClick={()=>setSearch("")}
                      title="Hapus pencarian"
                      style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:13,color:C.muted,padding:4,lineHeight:1}}
                    ><X size={16} aria-hidden="true" /></button>
                  )}
                </div>
                {typeof openScanner === "function" && (
                  <button type="button" className="stock-scan-button" aria-label="Scan barcode" title="Scan barcode" onClick={()=>openScanner({onDetect:(code)=>setSearch(code)})}
                    style={{...sty.btn("ghost"),whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                    <Barcode size={18} weight="bold" aria-hidden="true" />
                    {!isMobile && <span>Scan</span>}
                  </button>
                )}
                <button type="button" className="stock-photo-search-button" aria-label="Cari barang berdasarkan foto" title="Cari barang berdasarkan foto" onClick={()=>{setPhotoSearchImg(null);setPhotoSearchOpen(true);}}
                  style={{...sty.btn("primary"),whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                  <Camera size={18} weight="bold" aria-hidden="true" />
                  {!isMobile && <span>Cari Foto</span>}
                </button>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select style={{...sty.select,maxWidth:280}} value={filterJenis} onChange={e=>setFilterJenis(e.target.value)}>
                  <option value="ALL">Semua Jenis</option>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}
                </select>
                <select style={{...sty.select,maxWidth:280}} value={filterStatusSAP} onChange={e=>setFilterStatusSAP(e.target.value)} aria-label="Filter Status Material">
                  <option value="ALL">Semua Status</option>{STATUS_SAP.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {/* Filter lokasi material per UPT — hanya muncul utk viewer multi-UPT (UIT/Pusat). */}
                {stockUptFilterOptions?.length>0 && (
                  <select style={{...sty.select,maxWidth:280}} value={stockUptFilter} onChange={e=>setStockUptFilter(e.target.value)} aria-label="Filter UPT">
                    <option value="">Semua UPT</option>{stockUptFilterOptions.map(u=><option key={u.id} value={u.id}>{u.nama}</option>)}
                  </select>
                )}
                <select style={{...sty.select,maxWidth:280}} value={stockGudangSelect} onChange={e=>{setStockGudangSelect(e.target.value);setStockBlokSelect("");}} aria-label="Filter Gudang">
                  <option value="">Semua Gudang</option>{visibleGudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                </select>
                <select style={{...sty.select,maxWidth:280}} value={stockBlokSelect} disabled={!stockGudangSelect} onChange={e=>setStockBlokSelect(e.target.value)} aria-label="Filter Blok">
                  <option value="">Semua Blok</option>{blokSelectOptions.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                </select>
              </div>
              <div className="operations-segments" role="group" aria-label="Filter cepat">
                <button type="button" className={stockQuickFilter==="kritis"?"is-active":""} style={{"--segment-color":"#dc2626"}} onClick={()=>setStockQuickFilter(f=>f==="kritis"?"":"kritis")}>
                  <span>⚠️</span> Stok kritis ({kritisCount})
                </button>
                <button type="button" className={stockQuickFilter==="tanpaLokasi"?"is-active":""} style={{"--segment-color":"#d97706"}} onClick={()=>setStockQuickFilter(f=>f==="tanpaLokasi"?"":"tanpaLokasi")}>
                  <span>📍</span> Belum ada lokasi ({tanpaLokasiCount})
                </button>
              </div>
              {anyFilterActive && (
                <div className="workspace-context-row">
                  {search && <span>Cari: "{search}" <button aria-label="Hapus filter pencarian" onClick={()=>setSearch("")} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  {filterJenis!=="ALL" && <span>Jenis: {filterJenis} <button aria-label="Hapus filter jenis" onClick={()=>setFilterJenis("ALL")} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  {filterStatusSAP!=="ALL" && <span>Status: {filterStatusSAP} <button aria-label="Hapus filter status" onClick={()=>setFilterStatusSAP("ALL")} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  {stockUptFilter && <span>UPT: {stockUptFilterOptions.find(u=>u.id===stockUptFilter)?.nama||"-"} <button aria-label="Hapus filter UPT" onClick={()=>setStockUptFilter("")} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  {stockGudangSelect && <span>Gudang: {visibleGudangList.find(g=>g.id===stockGudangSelect)?.kode||"-"} <button aria-label="Hapus filter gudang" onClick={()=>{setStockGudangSelect("");setStockBlokSelect("");}} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  {stockBlokSelect && <span>Blok: {lokasiList.find(l=>l.id===stockBlokSelect)?.kode||"-"} <button aria-label="Hapus filter blok" onClick={()=>setStockBlokSelect("")} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  {stockQuickFilter && <span>{stockQuickFilter==="kritis"?"Stok kritis":"Belum ada lokasi"} <button aria-label="Hapus filter cepat" onClick={()=>setStockQuickFilter("")} style={{background:"transparent",border:"none",cursor:"pointer",marginLeft:5,fontWeight:800}}>×</button></span>}
                  <button type="button" onClick={resetAllFilters} style={{...sty.btn("ghost","sm"),marginLeft:4}}>Reset semua</button>
                </div>
              )}
              {photoSearchResults && (
                <div style={{...sty.card,padding:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontWeight:800,fontSize:13}}><Camera size={16} weight="bold" style={{verticalAlign:"-0.15em",marginRight:5}} aria-hidden="true"/> Hasil pencarian foto — {photoSearchResults.length} barang {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
                    <button style={sty.btn("ghost","sm")} onClick={()=>setPhotoSearchResults(null)}><X size={15} aria-hidden="true" /> Reset</button>
                  </div>
                  {photoSearchResultMode==="nameplate" && photoSearchOcrText && (
                    <div style={{fontSize:12,color:C.muted,background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius: 10,padding:"6px 8px",marginBottom:10,whiteSpace:"pre-wrap",maxHeight:60,overflowY:"auto"}}>
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
                            {thumb ? <img src={thumb} alt="" style={{width:54,height:54,objectFit:"cover",borderRadius: 10,flexShrink:0,border:`1px solid ${C.border}`}}/> : <div style={{width:54,height:54,borderRadius: 10,background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><ImageSquare size={22} color={C.accent} aria-hidden="true"/></div>}
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontWeight:700,fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{est?.name||"(tidak ada di Data Stok)"}</div>
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
              <div tabIndex={0} className="info-note" style={{...sty.card,textAlign:"center",color:C.muted,padding:20,marginBottom:16}}>
                ℹ️ Belum ada Master Katalog. Tambahkan jenis barang dulu di menu "Master Data" → "Master Katalog" sebelum membuat Data Stok.
              </div>
            )}
            {/* Saklar mode tampilan — pola sama dengan saklar tema di header (.theme-switch):
                seluruh baris (teks + track) satu tombol, jadi area sentuhnya lega di HP. */}
            <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",marginBottom:8}}>
              <button
                type="button"
                role="switch"
                aria-checked={stockViewMode==="katalog"}
                aria-label="Gabungkan baris per katalog"
                title={stockViewMode==="katalog" ? "Satu baris per barang, qty dijumlah dari semua lokasi" : "Satu baris per blok penyimpanan"}
                className={`stock-view-switch${stockViewMode==="katalog"?" is-on":""}`}
                onClick={()=>setStockViewMode(stockViewMode==="katalog"?"lokasi":"katalog")}
              >
                <span className="stock-view-switch__label">Per Lokasi</span>
                <span className="stock-view-switch__track" aria-hidden="true"><span className="stock-view-switch__knob"/></span>
                <span className="stock-view-switch__label">Per Katalog</span>
              </button>
            </div>
            {/* Tampilan tabel horizontal ringkas — detail lengkap ada di modal
                setelah klik baris (App.jsx, stockDetailId). */}
            <div className="mobile-card-table stock-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:640}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    <th style={{padding:"9px 10px",textAlign:"center",whiteSpace:"nowrap",fontSize:12}}>Foto</th>
                    {[["nama","Nama Barang"],["qty","Qty"],["lokasi",stockViewMode==="katalog"?"Sebaran":"Lokasi"]].map(([key,label])=>(
                      <th key={key} aria-sort={sortAria(key)} style={{padding:0,textAlign:"left",whiteSpace:"nowrap",fontSize:12}}>
                        <button type="button" onClick={()=>toggleSort(key)} style={{background:"transparent",border:"none",color:"white",cursor:"pointer",font:"inherit",fontWeight:700,padding:"9px 10px",display:"flex",alignItems:"center",gap:4,width:"100%"}}>
                          {label}
                          {stockSort.key===key && (stockSort.dir==="asc" ? <CaretUp size={12} weight="bold" aria-hidden="true"/> : <CaretDown size={12} weight="bold" aria-hidden="true"/>)}
                        </button>
                      </th>
                    ))}
                    <th style={{padding:"9px 10px",textAlign:"center",whiteSpace:"nowrap",fontSize:12}}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedStocks.map(st=>{
                    const isAgg = String(st.id).startsWith("AGG-"); // baris sintetis mode "Per Katalog" — bukan stok nyata
                    const isLow = st.jenisBarang!=="Non-Stock" && st.qty<=st.minQty;
                    const noLokasi = !isAgg && !st.lokasiId;
                    const lok = lokasiList.find(l=>l.id===st.lokasiId);
                    // Fallback ke st.gudangId (declared, independen dari Blok) kalau belum ada Blok
                    // tersimpan — ditemukan 2026-07-10 (sama seperti bug ATTB): kalau Gudang yang
                    // dipilih ternyata tidak punya Blok terdaftar sama sekali, dropdown Blok kosong dan
                    // pilihan Gudang (yang tadinya cuma filter lokal, tidak pernah disimpan) hilang lagi
                    // tiap render ulang. Sekarang gudangId disimpan langsung ke stok begitu dipilih.
                    const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : (st.gudangId ? gudangList.find(g=>g.id===st.gudangId) : null);
                    const petaInfo = getLokasiPetaInfo(lok, gdg, subGudangList);
                    const canLihatPeta = !!petaInfo;
                    const hasDenah = !!(gdg?.denahImageData || (lok?.subGudangId && subGudangList.find(s=>s.id===lok.subGudangId)?.denahImageData));
                    // Baris agregat: bukan stok nyata, tidak ada modal detail — lompat ke mode
                    // "Per Lokasi" + cari nomor katalog ini, supaya pecahan per-blok langsung terlihat.
                    const openDetail = ()=>{
                      if (isAgg) { setStockViewMode("lokasi"); setSearch(st.katalog||""); return; }
                      setPendingFoto({}); setStockDetailId(st.id);
                    };
                    const sapLabel = stockSapLabel(st);
                    const sapBs = sapBadgeStyleForLabel(sapLabel);
                    return (
                      <tr className="mobile-card-table__row" key={st.id} tabIndex={0} onClick={openDetail}
                        onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail(); } }}
                        style={{cursor:"pointer",background:st.deletePending?"#fef2f2":undefined,borderBottom:`1px solid ${C.border}`,borderLeft:`3px ${st.deletePending?"dashed #dc2626":"solid"} ${st.deletePending?"#dc2626":noLokasi?"#f59e0b":isLow?C.red:st.jenisBarang==="Non-Stock"?"#be185d":C.green}`}}>
                        <td className="mobile-card-table__photo" data-label="Foto" onClick={e=>{ if(st.fotoKeseluruhan){e.stopPropagation(); setLightboxImg(resolveStockPhotoUrl(st.fotoKeseluruhan));} }} style={{padding:"8px 10px",textAlign:"center",cursor:st.fotoKeseluruhan?"zoom-in":"default"}}>
                          {st.fotoKeseluruhan ? <img src={resolveStockPhotoUrl(st.fotoKeseluruhan)} alt={st.name} width={48} height={48} loading="lazy" style={{width:48,height:48,borderRadius: 10,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                            : <div style={{width:48,height:48,background:"#eff6ff",borderRadius: 10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,border:`1px solid #bfdbfe`,margin:"0 auto"}}><ImageSquare size={22} color="#1d4ed8" aria-hidden="true"/></div>}
                        </td>
                        <td className="stock-mobile-summary" aria-label={`Ringkasan ${st.name}`}>
                          <div className="stock-mobile-summary__head"><strong>{st.name}</strong><span>{st.katalog||"-"}</span></div>
                          <div className="stock-mobile-summary__description">{st.keteranganBarang || "Keterangan barang belum diisi."}</div>
                          <div className="stock-mobile-summary__meta"><span><MapPin size={14} weight="bold" aria-hidden="true"/> {[gdg?.kode||gdg?.nama, lok?.kode||st.lokasi].filter(Boolean).join(" • ") || "Lokasi belum diisi"}</span><span className={isLow ? "is-critical" : "is-ok"}>{st.jenisBarang==="Non-Stock" ? "Project-Based" : `${fmtNum(st.qty)} ${st.unit}`}</span></div>
                          <div className="stock-mobile-summary__detail" aria-hidden="true">{isAgg ? "Lihat sebaran" : "Detail"} <CaretRight size={11} weight="bold" aria-hidden="true"/></div>
                        </td>
                        <td className="mobile-card-table__title" data-label="Nama Barang" style={{padding:"8px 10px",minWidth:200}}>
                          <div title={st.name} style={{fontWeight:700,color:C.text,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{highlightText(st.name)}</div>
                          <div style={{fontSize:12,color:C.muted,marginTop:2,display:"flex",alignItems:"center",gap:5,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            <Tag size={13} style={{flexShrink:0}} aria-hidden="true"/> {highlightText(st.katalog||"-")}
                            <span aria-hidden="true" style={{color:"#cbd5e1"}}>•</span>
                            <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:6,height:6,borderRadius:"50%",background:sapBs.fg,flexShrink:0}}/> {sapLabel}</span>
                          </div>
                          {(st.deletePending || st.editPending) && (
                            <div title={[st.deletePending&&"Menunggu approval Hapus", st.editPending&&"Ada perubahan menunggu approval TL"].filter(Boolean).join(" • ")}
                              style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:4,padding:"2px 7px",borderRadius: 10,fontSize:12,fontWeight:700,background:"#fffbeb",color:"#a16207"}}>
                              <Clock size={12} weight="bold" aria-hidden="true"/> Menunggu approval
                            </div>
                          )}
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
                        <td data-label={stockViewMode==="katalog"?"Sebaran":"Lokasi"} style={{padding:"8px 10px",minWidth:130}}>
                          {isAgg ? <span style={{color:C.text,display:"inline-flex",alignItems:"center",gap:4}}><MapPin size={14} weight="bold" aria-hidden="true"/> {st.lokasiCount} lokasi</span>
                            : noLokasi ? <span style={{color:"#f59e0b",fontWeight:700}}>⚠️ Belum diisi</span> : <span style={{color:C.text}}>{[gdg?.kode||gdg?.nama, lok?.kode||st.lokasi].filter(Boolean).join(" • ")||"—"}</span>}
                        </td>
                        <td data-label="Aksi" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px"}}>
                          <div className="stock-mobile-direct-actions" onClick={e=>e.stopPropagation()}>
                            {!isAgg && <button
                              className="table-action-button stock-mobile-action--location"
                              aria-label="Lokasi"
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !hasDenah ? "Denah belum diupload (Master Data → Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                              onClick={()=>{
                                if (canLihatPeta) { setPetaMiniDetail({stock:st, lokasi:lok, gudang:gdg, petaInfo}); return; }
                                if (!lok) { showToast("Blok/Lokasi belum diisi untuk material ini.","error"); return; }
                                if (!hasDenah) { showToast(`Denah "${gdg?.nama||lok?.kode||"-"}" belum diupload. Upload di Master Data → Master Gudang.`,"error"); return; }
                                showToast(`Blok ${lok?.kode||"-"} belum diplot koordinatnya di denah. Atur di Master Data → Master Gudang.`,"error");
                              }}><MapPin size={16} weight="bold" aria-hidden="true" /></button>}
                            <button className="table-action-button stock-mobile-action--card" aria-label="Kartu Gantung Digital" title="Kartu Gantung Digital"
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}><Tag size={16} weight="bold" aria-hidden="true" /> <span>Kartu Gantung</span></button>
                          </div>
                          <div className="stock-desktop-actions" onClick={e=>e.stopPropagation()}>
                            <div className="table-actions">
                            <button className="table-action-button is-icon" title="Kartu Gantung TUG-2"
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}><Tag size={16} weight="bold" aria-hidden="true" /></button>
                            {!isAgg && <button
                              className="table-action-button is-icon"
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !hasDenah ? "Denah belum diupload (Master Data → Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                              onClick={()=>{
                                if (canLihatPeta) { setPetaMiniDetail({stock:st, lokasi:lok, gudang:gdg, petaInfo}); return; }
                                if (!lok) { showToast("Blok/Lokasi belum diisi untuk material ini.","error"); return; }
                                if (!hasDenah) { showToast(`Denah "${gdg?.nama||lok?.kode||"-"}" belum diupload. Upload di Master Data → Master Gudang.`,"error"); return; }
                                showToast(`Blok ${lok?.kode||"-"} belum diplot koordinatnya di denah. Atur di Master Data → Master Gudang.`,"error");
                              }}><MapPin size={16} weight="bold" aria-hidden="true" /></button>}
                            {isAgg ? (
                              <button className="table-action-button is-icon" aria-label="Lihat lokasi" title="Lihat lokasi"
                                onClick={openDetail}><MapPin size={16} weight="bold" aria-hidden="true" /></button>
                            ) : hasRole(currentUser, "ADMIN","TL") && (
                              <button className="table-action-button is-icon" aria-label="Pindah Blok" title="Pindah Blok"
                                onClick={()=>setMoveStock({st, lok, gdg})}><ArrowsLeftRight size={16} weight="bold" aria-hidden="true" /></button>
                            )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {stocks.length===0 && (
                    <tr><td colSpan={5} style={{padding:30,textAlign:"center",color:C.muted}}>Belum ada data stok.</td></tr>
                  )}
                  {stocks.length>0 && filteredStocks.length===0 && (
                    <tr><td colSpan={5} style={{padding:30,textAlign:"center",color:C.muted}}>Tidak ada data stok untuk filter ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredStocks.length > 0 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
                  Tampilkan
                  <select style={{...sty.select,width:"auto",paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:"unset",fontSize:12}} value={stockPageSize} onChange={e=>setStockPageSize(Number(e.target.value))}>
                    {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  item per halaman — {stockViewCount} total
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button style={{...sty.btn("ghost","sm")}} disabled={stockPageClamped<=1} onClick={()=>setStockPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                  <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {stockPageClamped} / {stockTotalPages}</span>
                  <button style={{...sty.btn("ghost","sm")}} disabled={stockPageClamped>=stockTotalPages} onClick={()=>setStockPage(p=>Math.min(stockTotalPages,p+1))}>Berikutnya →</button>
                </div>
              </div>
            )}
            {moveStock && (
              <PindahBlokModal
                C={C} sty={sty} currentUser={currentUser}
                st={moveStock.st} lok={moveStock.lok} gdg={moveStock.gdg}
                stocks={stocks} setStocks={setStocks} lokasiList={lokasiList} visibleGudangList={visibleGudangList}
                stockGudangFilter={stockGudangFilter} setStockGudangFilter={setStockGudangFilter}
                saveToCloud={saveToCloud} showToast={showToast}
                onClose={()=>setMoveStock(null)}
              />
            )}
          </div>
  );
}
