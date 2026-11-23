import { MasterMediaImage } from "./MasterMediaImage.jsx";
// Modal-modal terkait stok & dokumen (dipindah dari App.jsx, refactor batch 1).
// StockDetailModal (form tambah/edit stok), MaturityAssessmentModal (asesmen manual),
// DocPreviewModal (preview & unduh dokumen TUG).
import { useEffect, useMemo, useRef, useState } from "react";
import { JENIS_BARANG, STATUS_SAP } from "../constants.js";
import { resolvePrivPhoto } from "../lib/supabaseSync.js";
import { resolveStockPhotoUrl } from "../lib/stockCache.js";
import { resolveSapLabel } from "../lib/sap.js";
import { canonicalKatalogCode } from "../lib/normalizeKatalogCode.js";
import { buildTUG9HTML, buildTUG10HTML, downloadTUG10HTML, buildTUG5HTML, buildTUG7HTML, downloadTUG5HTML, buildTUG3HTML, downloadTUG3HTML, downloadTUG9HTML, downloadTUG7HTML, buildBaNonStockHTML, downloadBaNonStockHTML } from "../lib/docBuilders.js";
import { SearchableSelect } from "./SearchableSelect.jsx";
import { sortBlokOptions } from "../lib/masterSync.js";
import { resolveBaNonStockPrintNames } from "../lib/baNonStockSync.js";

// Field-field form edit Data Stok — dipakai INLINE di dalam modal detail (App.jsx,
// mode stockModal==="edit") supaya view+edit jadi SATU modal (bukan dua pop-up
// berlapis). Dulunya bagian dari StockDetailModal (form tambah+edit terpisah),
// tapi jalur "Tambah Data Stok Baru" sudah tidak ada pemanggilnya lagi — jadi ini
// murni form edit sekarang.
export function StockEditFields({ stockModal, stockForm, setStockForm, katalogList, lokasiList, subGudangList = [], setLightboxImg, handleImg, isMobile, sty, C }) {
  const subById = new Map(subGudangList.map(s => [s.id, s]));
  const groups = [...new Map(lokasiList.map(l => [l.subGudangId || "__umum__", l.subGudangId && subById.has(l.subGudangId) ? subById.get(l.subGudangId) : null])).entries()]
    .sort((a,b) => { if (a[0] === "__umum__") return 1; if (b[0] === "__umum__") return -1; return String(a[1]?.nama || "").localeCompare(String(b[1]?.nama || ""), "id", {numeric:true,sensitivity:"base"}); });
  const lokasiGroups = groups.map(([groupId, sg]) => ({ id: groupId, label: sg?.nama || "Umum / Tanpa Sub Gudang", options: sortBlokOptions(lokasiList.filter(l => (l.subGudangId && subById.has(l.subGudangId) ? l.subGudangId : "__umum__") === groupId)) }));
  return (
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Barang (dari Master Katalog)</label>
                <SearchableSelect
                  options={katalogList}
                  value={stockForm.katalogId||""}
                  onChange={id=>setStockForm(sf=>({...sf,katalogId:id}))}
                  getLabel={k=>`${k.name} [${canonicalKatalogCode(k.katalog)}]`}
                  getSearchText={k=>[k.name, k.katalog, k.category, k.jenisBarang, k.keterangan].filter(Boolean).join(" ")}
                  placeholder="-- Cari nama / no katalog / kategori --"
                  sty={sty} C={C} isMobile={isMobile}
                />
                {katalogList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Master Katalog. Tambahkan dulu di tab "Master Katalog".</div>}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Lokasi (dari Master Lokasi)</label>
                <select style={sty.select} value={stockForm.lokasiId||""} onChange={e=>setStockForm(sf=>({...sf,lokasiId:e.target.value}))}>
                  <option value="">-- Pilih Lokasi --</option>
                  {lokasiGroups.map(group=><optgroup key={group.id} label={group.label}>{group.options.map(l=><option key={l.id} value={l.id}>{l.kode || l.nama || l.id}{l.keterangan ? ` — ${l.keterangan}` : ""}</option>)}</optgroup>)}
                </select>
                {lokasiList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Blok Lokasi. Tambahkan dulu di Master Data → Master Gudang.</div>}
              </div>
              <div><label style={sty.label}>Harga Satuan (Rp)</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.price||0} onChange={e=>setStockForm(sf=>({...sf,price:Number(e.target.value)}))}/></div>
              <div>
                <label style={sty.label}>Qty di Lokasi Ini</label>
                <input style={{...sty.input, ...(stockModal==="edit"?{background:"#f3f4f6",cursor:"not-allowed"}:{})}} type="number" inputMode="decimal" value={stockForm.qty||0} disabled={stockModal==="edit"} onChange={e=>setStockForm(sf=>({...sf,qty:Number(e.target.value)}))}/>
                {stockModal==="edit" && <div style={{fontSize:12,color: "#64748b",marginTop:4}}>Qty berubah lewat transaksi TUG, tidak diedit manual.</div>}
              </div>
              <div><label style={sty.label}>Min Qty Alert</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.minQty||0} onChange={e=>setStockForm(sf=>({...sf,minQty:Number(e.target.value)}))}/></div>
              <div>
                <label style={sty.label}>Jenis Barang</label>
                <select style={sty.select} value={stockForm.jenisBarang||"Cadang"} onChange={e=>setStockForm(sf=>({...sf,jenisBarang:e.target.value}))}>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}</select>
                {stockForm.jenisBarang==="Non-Stock" && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>ℹ️ Barang khusus proyek — tidak dihitung dalam alert stok minimum</div>}
              </div>
              <div>
                <label style={sty.label}>Status Material</label>
                <select style={sty.select} value={stockForm.sapStatus||""} onChange={e=>setStockForm(sf=>({...sf,sapStatus:e.target.value}))}>
                  <option value="">Otomatis (ikuti format no. katalog)</option>
                  {STATUS_SAP.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {!stockForm.sapStatus && (
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>
                    Otomatis → {resolveSapLabel(canonicalKatalogCode(stockForm.katalog || katalogList.find(k=>k.id===stockForm.katalogId)?.katalog), "")}
                  </div>
                )}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Foto Kondisi Barang (opsional)</label>
                {stockForm.img && <MasterMediaImage src={resolveStockPhotoUrl(stockForm.img)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.img))} style={{width:80,height:80,objectFit:"cover",borderRadius: 10,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Nameplate (opsional)</label>
                {stockForm.fotoNameplate && <img src={resolveStockPhotoUrl(stockForm.fotoNameplate)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.fotoNameplate))} style={{width:80,height:80,objectFit:"cover",borderRadius: 10,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoNameplate:img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Keseluruhan (opsional)</label>
                {stockForm.fotoKeseluruhan && <img src={resolveStockPhotoUrl(stockForm.fotoKeseluruhan)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.fotoKeseluruhan))} style={{width:80,height:80,objectFit:"cover",borderRadius: 10,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoKeseluruhan:img})))} style={{display:"none"}}/>
                </label>
              </div>
              {Array.isArray(stockForm.kontrakRefs) && stockForm.kontrakRefs.length > 0 && (
                <div style={{gridColumn:"1/-1"}}>
                  <label style={sty.label}>Sumber Kontrak (riwayat, read-only)</label>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {stockForm.kontrakRefs.map((r,i) => (
                      <div key={i} style={{fontSize:12,color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
                        {r.supplier || "-"} — {r.noKontrak || "-"}{r.suratPesananNo ? ` · SP ${r.suratPesananNo}${r.suratPesananTgl ? ` (${r.suratPesananTgl})` : ""}` : ""} · masuk {new Date(r.tglMasuk).toLocaleDateString("id-ID")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {stockForm.id?.startsWith("STK-SAP-") && (
                <div tabIndex={0} className="info-note" style={{gridColumn:"1/-1",fontSize:12,color:C.muted}}>ℹ️ Data hasil import SAP (PEMAT) — foto Nameplate/Keseluruhan akan disinkronkan saat import data PEMAT berikutnya, tidak wajib diisi sekarang.</div>
              )}
            </div>
  );
}

export function MaturityAssessmentModal({ setMaturityModal, maturityForm, setMaturityForm, saveMaturityAssessment, MATURITY_LEVELS, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:17,fontWeight:800,marginBottom:20}}>🏆 Asesmen Maturity Level Baru</h3>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Level (1-5)</label>
              <select style={sty.select} value={maturityForm.level} onChange={e=>setMaturityForm(f=>({...f,level:Number(e.target.value)}))}>
                {[1,2,3,4,5].map(lv=><option key={lv} value={lv}>Level {lv} — {MATURITY_LEVELS[lv]}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Tanggal Asesmen</label>
              <input style={sty.input} type="date" value={new Date(maturityForm.tanggalAsesmen).toISOString().slice(0,10)} onChange={e=>setMaturityForm(f=>({...f,tanggalAsesmen:new Date(e.target.value).getTime()}))}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Catatan (opsional)</label>
              <textarea style={{...sty.input,minHeight:70}} value={maturityForm.catatan} onChange={e=>setMaturityForm(f=>({...f,catatan:e.target.value}))} placeholder="cth: Hasil audit internal triwulan II"/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setMaturityModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{if (await saveMaturityAssessment(maturityForm) !== false) setMaturityModal(false);}}>💾 Simpan</button>
            </div>
          </div>
        </div>
  );
}

// The iframe paints the document before starting its attachments. A retry can
// replace a failed image in place without resetting scroll position or text.
function loadPreviewImage(image, photoLinks, signal) {
  const source = image.dataset.previewSrc;
  const isPrivate = source.startsWith("priv:");
  return new Promise(resolve => {
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (!ok && isPrivate && !signal.aborted) photoLinks.delete(source);
      resolve(ok);
    };
    const loaded = () => finish(image.naturalWidth > 0);
    const failed = () => finish(false);
    const aborted = () => finish(false);
    const timer = setTimeout(failed, 30000);
    signal.addEventListener("abort", aborted, { once: true });
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
    if (!isPrivate) {
      image.src = source;
      return;
    }
    const cached = photoLinks.get(source);
    if (cached && cached.expires > Date.now()) {
      image.src = cached.url;
      return;
    }
    resolvePrivPhoto(source).then(url => {
      if (settled) return;
      if (!url || url === source) return failed();
      // Links last an hour at Storage. Reuse briefly inside this account only.
      if (photoLinks.size >= 32) photoLinks.delete(photoLinks.keys().next().value);
      photoLinks.set(source, { url, expires: Date.now() + 300000 });
      image.src = url;
    }, failed);
  });
}

export function DocPreviewModal({ docPreview, setDocPreview, photoLinks, mastersReady, masterLoadFailed, onRetryMasters, docKeyOf, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, timMutuList, uitList, uptList, ultgList, enrichedStocks, showToast, sty, C }) {
  const dp = useMemo(() => docPreview.docType === "BA_NON_STOCK"
    ? resolveBaNonStockPrintNames(docPreview, { satpamList, users })
    : docPreview, [docPreview, satpamList, users]);
  const iframeRef = useRef(null);
  const previewViewportRef = useRef(null);
  const attemptRef = useRef(null);
  const [assets, setAssets] = useState(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewHeight, setPreviewHeight] = useState(1123);
  const documentHtml = useMemo(() => {
    switch (dp.docType) {
      case "BA_NON_STOCK": return buildBaNonStockHTML(dp);
      case "TUG10": return buildTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, uptList);
      case "TUG3": return buildTUG3HTML(dp, katalogList, lokasiList, timMutuList, users, satpamList, uptList);
      case "TUG5": return buildTUG5HTML(dp, katalogList, uitList, users, ultgList, uptList);
      case "TUG7": return buildTUG7HTML(dp, katalogList, uitList, uptList, users);
      default: return buildTUG9HTML(dp, enrichedStocks, users, satpamList, uptList, gudangList);
    }
  }, [dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, timMutuList, uitList, uptList, ultgList, enrichedStocks]);
  const previewHtml = useMemo(() => documentHtml
    .replace(/<div class="(?:bar|print-bar)">[\s\S]*?<\/div>/, "")
    .replace(/(<img\b[^>]*?\s)src="/gi, '$1data-preview-src="'), [documentHtml]);
  const currentAssets = assets?.html === previewHtml ? assets : null;
  const previewReady = Boolean(mastersReady && currentAssets && !currentAssets.errors.length);

  useEffect(() => () => attemptRef.current?.abort(), []);
  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return undefined;
    const updateScale = () => setPreviewScale(Math.min(1, Math.max(0.1, (viewport.clientWidth - 36) / 794)));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const handlePreviewLoad = async () => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument?.body || frameDocument.URL === "about:blank") return;
    attemptRef.current?.abort();
    const attempt = new AbortController();
    attemptRef.current = attempt;
    setAssets(null);
    const updateHeight = () => setPreviewHeight(Math.max(1123, frameDocument.documentElement?.scrollHeight || 0));
    updateHeight();
    const images = Array.from(frameDocument.querySelectorAll("img[data-preview-src]"));
    const pending = images.filter(image => !image.complete || !image.naturalWidth);
    const [results] = await Promise.all([
      Promise.all(pending.map(image => loadPreviewImage(image, photoLinks, attempt.signal))),
      frameDocument.fonts?.ready,
    ]);
    if (attempt.signal.aborted || iframeRef.current?.contentDocument !== frameDocument) return;
    const errors = pending.filter((_, index) => !results[index]).map(image => image.alt || "Gambar dokumen");
    const privateImage = images.find(image => image.dataset.previewSrc === dp.fotoSimKtp);
    setAssets({ html: previewHtml, errors: [...new Set(errors)], privateUrl: privateImage?.src });
    updateHeight();
  };
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",flexDirection:"column",zIndex:1500}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",background:C.sidebar,flexShrink:0}}>
            <div style={{color:"white",fontWeight:700,fontSize:13}}>📄 Dokumen {dp.docType.replace("TUG","TUG-")} — {dp.docNumbers?.[docKeyOf(dp)]||dp.draftLabel||dp.id}</div>
            <div style={{display:"flex",gap:8}}>
              <button disabled={!previewReady} aria-disabled={!previewReady} style={{...sty.btn("success"),padding:"7px 16px"}} onClick={()=>{
                const printable = currentAssets.privateUrl ? { ...dp, fotoSimKtp: currentAssets.privateUrl } : dp;
                if (dp.docType==="BA_NON_STOCK") downloadBaNonStockHTML(printable, showToast);
                else if (dp.docType==="TUG10") downloadTUG10HTML(printable, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, showToast, uptList);
                else if (dp.docType==="TUG3") downloadTUG3HTML(printable, katalogList, lokasiList, timMutuList, users, satpamList, showToast, uptList);
                else if (dp.docType==="TUG5") downloadTUG5HTML(printable, katalogList, uitList, users, showToast, ultgList, uptList);
                else if (dp.docType==="TUG7") downloadTUG7HTML(printable, katalogList, uitList, uptList, users, showToast);
                else downloadTUG9HTML(printable, enrichedStocks, users, satpamList, showToast, uptList, gudangList);
              }}>⬇️ Unduh File (untuk Print/PDF)</button>
              <button disabled={!previewReady} aria-disabled={!previewReady} style={{...sty.btn("primary"),padding:"7px 16px"}} onClick={()=>iframeRef.current?.contentWindow?.print()}>🖨️ Print / Save PDF</button>
              <button style={sty.btn("danger","sm")} onClick={()=>setDocPreview(null)}>✕ Tutup</button>
            </div>
          </div>
          <div ref={previewViewportRef} style={{flex:1,background:"#e5e7eb",overflowY:"auto",overflowX:"hidden",padding:"18px 0"}}>
            <div style={{width:`${794 * previewScale}px`,height:`${previewHeight * previewScale}px`,margin:"0 auto",position:"relative"}}>
            <iframe
              ref={iframeRef}
              title="Document Preview"
              srcDoc={previewHtml}
                /* print-bar (onclick window.print) diblok CSP di iframe app → buang dari PREVIEW; modal punya tombol Print React. File unduhan/window.open (tanpa CSP) tetap punya tombol yang jalan. */
              onLoad={handlePreviewLoad}
              style={{width:"794px",height:`${previewHeight}px`,border:"none",display:"block",transform:`scale(${previewScale})`,transformOrigin:"top left"}}
            />
            </div>
          </div>
          <div tabIndex={0} className="info-note" style={{padding:"8px 18px",background:"#fef3c7",fontSize:12,color:"#92400e",flexShrink:0}}>
            <span role="status">{currentAssets?.errors.length
              ? `Gagal memuat: ${currentAssets.errors.join(", ")}. `
              : !currentAssets ? "Memuat lampiran dokumen... "
              : masterLoadFailed ? "Data referensi cetak belum tersedia. "
              : !mastersReady ? "Menunggu data referensi dokumen untuk cetak. "
              : "Dokumen siap dicetak. "}</span>
            {masterLoadFailed && <button onClick={onRetryMasters}>Muat ulang data referensi</button>}
            {currentAssets?.errors.length > 0 && <button onClick={handlePreviewLoad}>Coba lagi</button>}

          </div>
        </div>
  );
}
