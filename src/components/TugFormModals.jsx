// Modal form transaksi TUG (dipindah dari App.jsx, refactor batch 1).
// Tug5FormModal, Tug98FormModal (TUG9/TUG8), Tug10FormModal, Tug3FormModal.
import { SearchableSelect } from "./SearchableSelect.jsx";
import { fmtNum } from "../lib/ragShared.mjs";
import { statusMaterialBadgeStyle } from "../lib/sap.js";
import { can } from "../lib/perms.js";
import { ROLES } from "../lib/roles.js";

export function Tug5FormModal({ txnForm, setTxnForm, setTxnModal, docSeq, uitList, ultgList, katalogList, tug5MaterialPage, setTug5MaterialPage, tug5ExpandedIdx, setTug5ExpandedIdx, addItemRow, removeItemRow, updateItemRow, saveTxn, isMobile, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir TUG-5 — Daftar Permintaan Barang</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.TUG-5/...</span>
                <button onClick={()=>setTxnModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            {txnForm.sourceType==="ULTG" ? (
              <>
                <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Alur: Admin Ajukan TUG-5 → Manager ULTG approve</div>
                <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>HEADER DOKUMEN</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
                  <div>
                    <label style={sty.label}>Unit ULTG Pengaju</label>
                    <input style={{...sty.input,background:"#f3f4f6"}} value={ultgList.find(u=>u.id===txnForm.ultgId)?.nama || "-"} disabled/>
                  </div>
                  <div>
                    <label style={sty.label}>Lokasi Pekerjaan *</label>
                    <input style={sty.input} value={txnForm.lokasiPekerjaan||""} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: Gardu Induk Rungkut"/>
                  </div>
                  <div style={{gridColumn:"1/-1"}}>
                    <label style={sty.label}>Nama Pekerjaan *</label>
                    <input style={sty.input} value={txnForm.namaPekerjaan||""} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value,keteranganUmum:e.target.value}))} placeholder="cth: Penggantian Isolator Komposit Bay Trafo 1"/>
                  </div>
                </div>
              </>
            ) : (
            <>
            <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Alur: Asman approve → Manager UPT approve → INTRACOMPANY: auto draft TUG-7 di UIT | INTERCOMPANY: auto draft TUG-5 UIT (cetak manual).</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>HEADER DOKUMEN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Kepada (UIT tujuan)</label>
                <select style={sty.select} value={txnForm.uitId||""} onChange={e=>setTxnForm(tf=>({...tf,uitId:e.target.value}))}>
                  <option value="">-- Pilih UIT --</option>
                  {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Jenis Transfer</label>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8}}>
                  {["INTRACOMPANY","INTERCOMPANY"].map(jt=>(
                    <button key={jt} type="button" style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${txnForm.jenisTransfer===jt?C.accent:C.border}`,background:txnForm.jenisTransfer===jt?"#eff6ff":"white",color:txnForm.jenisTransfer===jt?C.accent:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}} onClick={()=>setTxnForm(tf=>({...tf,jenisTransfer:jt}))}>
                      {jt==="INTRACOMPANY"?"🔄 Intracompany (sesama UIT-JBM)":"🌐 Intercompany (lintas UIT)"}
                    </button>
                  ))}
                </div>
                {txnForm.jenisTransfer==="INTRACOMPANY" && <div style={{fontSize:12,color:C.green,marginTop:4}}>→ Setelah approved: otomatis generate draft TUG-7 di UIT untuk ditentukan UPT pengirimnya.</div>}
                {txnForm.jenisTransfer==="INTERCOMPANY" && <div style={{fontSize:12,color:"#7c3aed",marginTop:4}}>→ Setelah approved: otomatis generate draft TUG-5 UIT untuk dikirim manual ke UIT lain.</div>}
              </div>
            </div>
            </>
            )}

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DAFTAR MATERIAL ({txnForm.stockItems.length}/10)</div>
            {(()=>{
              const pageStart = tug5MaterialPage*5;
              const pageIdxs = txnForm.stockItems.map((_,i)=>i).slice(pageStart, pageStart+5);
              return pageIdxs.map(idx=>{
                const si = txnForm.stockItems[idx];
                const kat = katalogList.find(k=>k.id===si.katalogId);
                const isExpanded = idx===tug5ExpandedIdx;
                if (!isExpanded) {
                  return (
                    <div key={idx} style={{display:"flex",alignItems:isMobile?"stretch":"center",flexDirection:isMobile?"column":"row",gap:8,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",marginBottom:8,background:C.surface,cursor:"pointer"}} onClick={()=>setTug5ExpandedIdx(idx)}>
                      <span style={{fontSize:12,fontWeight:700,color:C.muted}}>#{idx+1}</span>
                      <span style={{flex:1,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kat ? `${kat.name} [${kat.katalog||"-"}]` : <span style={{color:C.muted,fontStyle:"italic"}}>Belum dipilih</span>}</span>
                      <div style={{display:"flex",alignItems:"center",justifyContent:isMobile?"space-between":"flex-start",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:C.accent,fontWeight:700}}>Qty: {si.permintaan||0}{kat?.satuan?` ${kat.satuan}`:""}</span>
                        <span style={{fontSize:12,color:C.muted}}>✏️ Edit</span>
                        {txnForm.stockItems.length>1 && <button type="button" title="Hapus material TUG-5 ini" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={e=>{e.stopPropagation();removeItemRow(idx);if(tug5ExpandedIdx===idx)setTug5ExpandedIdx(Math.max(0,idx-1));}}>✕</button>}
                      </div>
                    </div>
                  );
                }
                return (
                <div key={idx} style={{border:`2px solid ${C.accent}`,borderRadius:8,padding:10,marginBottom:8,background:"#f9fafb"}}>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,alignItems:isMobile?"stretch":"flex-end",marginBottom:8}}>
                    <div style={{flex:isMobile?undefined:3}}>
                      <label style={sty.label}>Nama Barang {idx+1}</label>
                      <SearchableSelect
                        options={katalogList}
                        value={si.katalogId}
                        onChange={v=>updateItemRow(idx,"katalogId",v)}
                        getLabel={k=>`${k.name} [${k.katalog||"-"}]`}
                        getSearchText={k=>`${k.name} ${k.katalog||""}`}
                        placeholder="-- Cari & pilih dari Master Katalog --"
                        sty={sty} C={C} isMobile={isMobile}
                      />
                    </div>
                    {txnForm.stockItems.length>1 && <button type="button" title="Hapus material TUG-5 ini" style={{...sty.btn("danger","sm")}} onClick={()=>{removeItemRow(idx);setTug5ExpandedIdx(Math.max(0,idx-1));}}>✕</button>}
                  </div>
                  {kat && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Nomor Normalisasi: {kat.katalog||"-"} • Satuan: {kat.satuan}</div>}
                  {txnForm.sourceType==="ULTG" ? (
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8}}>
                      <div><label style={sty.label}>Sisa Persediaan <span style={{color:C.muted,fontWeight:400}}>(stok aktual UPT)</span></label><input style={{...sty.input,background:"#f3f4f6"}} type="number" inputMode="decimal" min="0" value={si.sisaPersediaan||0} disabled/></div>
                      <div><label style={sty.label}>Jumlah Permintaan {kat?.satuan && <span style={{color:C.muted,fontWeight:400}}>({kat.satuan})</span>}</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.permintaan||1} onChange={e=>updateItemRow(idx,"permintaan",Number(e.target.value))}/></div>
                    </div>
                  ) : (
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:8}}>
                      <div><label style={sty.label}>Pemakaian/Bulan</label><input style={sty.input} type="number" inputMode="decimal" min="0" value={si.pemakaianBulan||0} onChange={e=>updateItemRow(idx,"pemakaianBulan",Number(e.target.value))}/></div>
                      <div><label style={sty.label}>Sisa Persediaan</label><input style={sty.input} type="number" inputMode="decimal" min="0" value={si.sisaPersediaan||0} onChange={e=>updateItemRow(idx,"sisaPersediaan",Number(e.target.value))}/></div>
                      <div><label style={sty.label}>Jumlah Permintaan</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.permintaan||1} onChange={e=>updateItemRow(idx,"permintaan",Number(e.target.value))}/></div>
                    </div>
                  )}
                  <div style={{marginTop:8}}><label style={sty.label}>Keterangan</label><input style={sty.input} value={si.keterangan||""} onChange={e=>updateItemRow(idx,"keterangan",e.target.value)} placeholder="cth: Single Insulator Strings"/></div>
                </div>
                );
              });
            })()}
            {txnForm.stockItems.length>5 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <button type="button" style={sty.btn("ghost","sm")} disabled={tug5MaterialPage===0} onClick={()=>setTug5MaterialPage(p=>Math.max(0,p-1))}>← Sebelumnya</button>
                <span style={{fontSize:12,color:C.muted}}>Halaman {tug5MaterialPage+1} dari {Math.ceil(txnForm.stockItems.length/5)}</span>
                <button type="button" style={sty.btn("ghost","sm")} disabled={(tug5MaterialPage+1)*5>=txnForm.stockItems.length} onClick={()=>setTug5MaterialPage(p=>p+1)}>Selanjutnya →</button>
              </div>
            )}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} disabled={txnForm.stockItems.length>=10} onClick={addItemRow}>+ Tambah Material {txnForm.stockItems.length>=10?"(maks 10)":""}</button>

            {txnForm.sourceType!=="ULTG" && (
              <>
                <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>ADMINISTRASI</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10,marginBottom:16}}>
                  <div><label style={sty.label}>Keterangan Umum</label><input style={sty.input} value={txnForm.keteranganUmum||""} onChange={e=>setTxnForm(tf=>({...tf,keteranganUmum:e.target.value}))} placeholder="cth: Penggantian Isolator Komposit UPT Surabaya"/></div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:10}}>
                    <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={txnForm.perintahKerja||""} onChange={e=>setTxnForm(tf=>({...tf,perintahKerja:e.target.value}))}/></div>
                    <div><label style={sty.label}>Kode Perkiraan</label><input style={sty.input} value={txnForm.kodePerkiraan||""} onChange={e=>setTxnForm(tf=>({...tf,kodePerkiraan:e.target.value}))}/></div>
                    <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={txnForm.fungsi||""} onChange={e=>setTxnForm(tf=>({...tf,fungsi:e.target.value}))}/></div>
                  </div>
                </div>
              </>
            )}
            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTxnModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>📋 Ajukan TUG-5</button>
            </div>
          </div>
        </div>
  );
}

export function Tug98FormModal({ txnForm, setTxnForm, setTxnModal, docSeq, gudangList, satpamList, enrichedStocks, addItemRow, removeItemRow, updateItemRow, openScanner, handleImg, handleMaterialImg, editingDraftTxnId, setEditingDraftTxnId, saveTxn, isMobile, sty, C }) {
  const isDerivedDraft = Boolean(editingDraftTxnId);
  const handleFillDummy = () => {
    const validStock = enrichedStocks.find(s => s.jenisBarang === "Non-Stock" || Number(s.qty) > 0) || enrichedStocks[0];
    setTxnForm(tf => ({
      ...tf,
      namaPekerjaan: "Pemeliharaan Bay Trafo 70kV GI Ketintang",
      pekerjaan: "Pemeliharaan Bay Trafo 70kV GI Ketintang",
      lokasiPekerjaan: "GI Ketintang Surabaya",
      unitTujuan: tf.docType === "TUG8" ? "UPT Malang" : (tf.unitTujuan || ""),
      noNodin: "0012/LOG.00.02/UPT-SBY/2026",
      noPersetujuan: "0045/DAN.01.03/UPT-SBY/2026",
      penerimaNama: "Budi Santoso",
      penerimaJabatan: "Supervisor Pemeliharaan",
      penerimaUnit: "ULTG Surabaya",
      nopol: "L 1234 ABC",
      namaPengemudi: "Slamet",
      simKtp: "3578012345670001",
      satpamId: satpamList[0]?.id || tf.satpamId || "",
      keteranganBarang: "Pemakaian urgent perbaikan sistem",
      stockItems: validStock ? [{ stockId: validStock.id, qty: 1 }] : tf.stockItems,
    }));
  };
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div role="dialog" aria-modal="true" aria-label={`Formulir ${txnForm.docType.replace("TUG","TUG-")}`} style={{...sty.card,width:680,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir {txnForm.docType.replace("TUG","TUG-")} — {txnForm.docType==="TUG9"?"Bon Pemakaian":"Pemakaian Unit Lain"}</span>
              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                <button type="button" onClick={handleFillDummy} style={{background:"#2563eb",color:"white",border:"none",borderRadius:6,padding:"4px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}} title="Isi otomatis dengan data sampel dummy">🧪 Isi Data Contoh</button>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>{isDerivedDraft ? "DRAFT — nomor resmi saat diajukan" : `No: ${docSeq}.${txnForm.docType.replace("TUG","TUG-")}/...`}</span>
                <button onClick={()=>setTxnModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Pekerjaan *</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value,pekerjaan:e.target.value}))} placeholder="cth: Extension Bay Kapasitor"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Lokasi Pekerjaan *</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GI Paciran, GI New Pacitan"/></div>
              {txnForm.docType==="TUG8" && (
                <div style={{gridColumn:"1/-1"}}>
                  <label style={sty.label}>Unit / Sektor Tujuan (PLN Lain) *</label>
                  <input style={sty.input} value={txnForm.unitTujuan||""} onChange={e=>setTxnForm(tf=>({...tf,unitTujuan:e.target.value}))} placeholder="cth: UPT Malang, ULTG Pasuruan"/>
                </div>
              )}
              <div><label style={sty.label}>No. Surat / Nodin</label><input style={sty.input} value={txnForm.noNodin} onChange={e=>setTxnForm(tf=>({...tf,noNodin:e.target.value}))} placeholder="2175/LOG.00.02/F34000000/2026"/></div>
              <div><label style={sty.label}>No. Surat Persetujuan</label><input style={sty.input} value={txnForm.noPersetujuan} onChange={e=>setTxnForm(tf=>({...tf,noPersetujuan:e.target.value}))} placeholder="1861/DAN.01.03/F34000000/2026"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMA</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Nama Penerima *</label><input style={sty.input} value={txnForm.penerimaNama} onChange={e=>setTxnForm(tf=>({...tf,penerimaNama:e.target.value}))}/></div>
              <div><label style={sty.label}>Jabatan</label><input style={sty.input} value={txnForm.penerimaJabatan} onChange={e=>setTxnForm(tf=>({...tf,penerimaJabatan:e.target.value}))} placeholder="cth: Project Manager"/></div>
              <div><label style={sty.label}>Unit / Perusahaan</label><input style={sty.input} value={txnForm.penerimaUnit} onChange={e=>setTxnForm(tf=>({...tf,penerimaUnit:e.target.value}))} placeholder="cth: PT. Mitra Jaya"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>TRANSPORTASI (untuk Surat Jalan)</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Nopol Kendaraan</label><input style={sty.input} value={txnForm.nopol} onChange={e=>setTxnForm(tf=>({...tf,nopol:e.target.value}))} placeholder="L 9859 UK"/></div>
              <div><label style={sty.label}>Nama Pengemudi</label><input style={sty.input} value={txnForm.namaPengemudi} onChange={e=>setTxnForm(tf=>({...tf,namaPengemudi:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SIM / KTP</label><input style={sty.input} value={txnForm.simKtp} onChange={e=>setTxnForm(tf=>({...tf,simKtp:e.target.value}))}/></div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={sty.label}>Satpam Bertugas (Mengetahui di Surat Jalan)</label>
              <select style={sty.select} value={txnForm.satpamId||""} onChange={e=>setTxnForm(tf=>({...tf,satpamId:e.target.value}))}>
                <option value="">-- Pilih Satpam --</option>
                {gudangList.map(g=>{ const list=satpamList.filter(sp=>sp.gudangId===g.id); return list.length===0?null:(
                  <optgroup key={g.id} label={g.nama}>{list.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</optgroup>
                ); })}
                {(() => { const list=satpamList.filter(sp=>!sp.gudangId || !gudangList.some(g=>g.id===sp.gudangId)); return list.length===0?null:(
                  <optgroup label="Belum di-assign gudang">{list.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</optgroup>
                ); })()}
              </select>
              {satpamList.length===0 && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Belum ada data Satpam. Tambahkan di menu Master Data → tab Satpam.</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Barang yang sama bisa ada di lokasi berbeda — pastikan pilih baris dengan lokasi yang benar.</div>
            {txnForm.stockItems.map((si,idx)=>{
              const stockOpt = enrichedStocks.find(s=>s.id===si.stockId);
              return (
                <div key={idx} style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,marginBottom:8,alignItems:isMobile?"stretch":"flex-end"}}>
                  <div style={{flex:isMobile?undefined:3}}>
                    <label style={sty.label}>Barang {idx+1}</label>
                    <SearchableSelect
                      options={enrichedStocks}
                      value={si.stockId}
                      onChange={v=>updateItemRow(idx,"stockId",v)}
                      getLabel={s=>`${s.name} [${s.katalog}] @ ${s.lokasi}`}
                      getSearchText={s=>`${s.name} ${s.katalog} ${s.lokasi}`}
                      renderOption={s=>(
                        <div>
                          <div style={{fontWeight:600}}>{s.name} <span style={{color:C.muted,fontWeight:400}}>[{s.katalog}]</span></div>
                          <div style={{fontSize:12,color:C.muted}}>📍 {s.lokasi} • {s.jenisBarang!=="Non-Stock"?`Stok: ${fmtNum(s.qty)} ${s.unit}`:"Non-Stock"}</div>
                        </div>
                      )}
                      placeholder="-- Cari & pilih barang --"
                      sty={sty} C={C} isMobile={isMobile}
                    />
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                    <div style={{flex:1}}><label style={sty.label}>Qty</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                    <button type="button" title="Scan barcode" style={{...sty.btn("ghost","sm"),height:isMobile?44:36}} onClick={()=>openScanner({txnIndex:idx})}>📷</button>
                    {txnForm.stockItems.length>1 && <button type="button" title="Hapus baris barang ini" style={{...sty.btn("danger","sm"),height:isMobile?44:36}} onClick={()=>removeItemRow(idx)}>✕</button>}
                  </div>
                </div>
              );
            })}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Lain</button>

            <div style={{marginBottom:14}}><label style={sty.label}>Keterangan Barang{txnForm.docType!=="TUG8"?" (status proyek/non-stock)":""}</label><input style={sty.input} value={txnForm.keteranganBarang} onChange={e=>setTxnForm(tf=>({...tf,keteranganBarang:e.target.value}))} placeholder="cth: Untuk Proyek PT. Mitra Jaya"/></div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>📸 LAMPIRAN FOTO (opsional)</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={sty.label}>Foto Kendaraan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoKendaraan:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoKendaraan && <img src={txnForm.fotoKendaraan} alt="kendaraan" style={{width:"100%",height:isMobile?140:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
              <div>
                <label style={sty.label}>Foto SIM / KTP Pengemudi</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoSimKtp:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoSimKtp && <img src={txnForm.fotoSimKtp} alt="sim ktp" style={{width:"100%",height:isMobile?140:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
              <div>
                <label style={sty.label}>Surat Permintaan/Pengembalian</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoSuratPengembalian:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoSuratPengembalian && <img src={txnForm.fotoSuratPengembalian} alt="surat" style={{width:"100%",height:isMobile?140:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Foto Tiap Material</label>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginTop:6}}>
                {txnForm.stockItems.filter(si=>si.stockId).map((si,idx)=>{
                  const stock = enrichedStocks.find(s=>s.id===si.stockId);
                  const existingPhoto = txnForm.fotoMaterial.find(fm=>fm.stockId===si.stockId);
                  return (
                    <div key={idx} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:8}}>
                      <div style={{fontSize:12,fontWeight:600,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stock?.name||"-"}</div>
                      <input type="file" accept="image/*" capture="environment" onChange={e=>handleMaterialImg(e, si.stockId)} style={{fontSize:12,color:C.muted,width:"100%"}}/>
                      {existingPhoto && <img src={existingPhoto.img} alt={stock?.name} style={{width:"100%",height:60,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                    </div>
                  );
                })}
                {txnForm.stockItems.filter(si=>si.stockId).length===0 && <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Pilih barang terlebih dahulu untuk upload foto material</div>}
              </div>
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>{editingDraftTxnId?`Lengkapi & Ajukan ${txnForm.docType.replace("TUG","TUG-")}`:`📤 Ajukan ${txnForm.docType.replace("TUG","TUG-")}`}</button>
            </div>
          </div>
        </div>
  );
}

export function Tug10FormModal({ txnForm, setTxnForm, setTxnModal, setEditingDraftTxnId, docSeq, currentUser, rolePerms, tug10Highlight, tug10Refs, tug10Missing, tug10Collapsed, setTug10Collapsed, lokasiList, subGudangList, satpamList, gudangList, visibleGudangList, uptList, katalogList, CATEGORIES, STATUS_MATERIAL_RETUR, addItemRow, removeItemRow, updateItemRow, handleImg, savingTxn, saveTxn, isMobile, sty, C }) {
  const hl = key => tug10Highlight===key ? { boxShadow:"0 0 0 2px #dc2626", borderRadius:8 } : {};
  const setRef = key => el => { tug10Refs.current[key] = el; };
  const isLegacyGud = txnForm.gudangTujuanId==="__legacy__";
  const hasLegacyBlok = lokasiList.some(l=>!l.gudangId);
  const tug10Subs = subGudangList.filter(sg=>sg.gudangId===txnForm.gudangTujuanId);
  const tug10Bloks = isLegacyGud
    ? lokasiList.filter(l=>!l.gudangId)
    : (!txnForm.gudangTujuanId ? [] : lokasiList.filter(l=>l.gudangId===txnForm.gudangTujuanId && (tug10Subs.length===0 || (l.subGudangId||"")===(txnForm.subGudangTujuanId||""))));
  const gudSatpams = satpamList.filter(sp=>sp.gudangId && sp.gudangId===txnForm.gudangTujuanId);
  const selGud = gudangList.find(g=>g.id===txnForm.gudangTujuanId);
  const selSub = subGudangList.find(sg=>sg.id===txnForm.subGudangTujuanId);
  const selBlok = lokasiList.find(l=>l.id===txnForm.lokasiTujuanId);
  const breadcrumb = [selGud?.nama || (isLegacyGud?"Legacy (tanpa gudang)":null), selSub?.nama, selBlok?.kode].filter(Boolean).join(" › ");
  const missingList = tug10Missing(txnForm);
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir TUG-10 — Bon Pengembalian</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.TUG-10/...</span>
                <button onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman. Stok akan BERTAMBAH saat disetujui.</div>

            {!can(currentUser, "aksi.buatTransaksi", rolePerms) && (
              <div style={{background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#991b1b",marginBottom:16,fontWeight:600}}>🚫 Role kamu ({ROLES[currentUser?.role]||currentUser?.role||"-"}) tidak bisa mengajukan TUG-10 — hubungi Admin Gudang / TL Logistik.</div>
            )}

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Pekerjaan (jenis)</label><input style={sty.input} value={txnForm.pekerjaan} onChange={e=>setTxnForm(tf=>({...tf,pekerjaan:e.target.value}))} placeholder="cth: Penggantian"/></div>
              <div><label style={sty.label}>No. BA Penggantian</label><input style={sty.input} value={txnForm.noBAPenggantian} onChange={e=>setTxnForm(tf=>({...tf,noBAPenggantian:e.target.value}))} placeholder="0266/PT-SD/VI/2026"/></div>
              <div ref={setRef("namaPekerjaan")} style={{gridColumn:"1/-1",...hl("namaPekerjaan")}}><label style={sty.label}>Nama Pekerjaan *</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value}))} placeholder="cth: Pengembalian Material Relay GIS Darmo dan GIS Waru"/></div>
              <div ref={setRef("lokasiPekerjaan")} style={{gridColumn:"1/-1",...hl("lokasiPekerjaan")}}><label style={sty.label}>Lokasi Pekerjaan *</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GIS Darmo dan GIS Waru"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>PIHAK & LOKASI PENYIMPANAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div ref={setRef("menyerahkanNama")} style={{...hl("menyerahkanNama")}}>
                <label style={sty.label}>Yang Menyerahkan *</label>
                <input style={sty.input} value={txnForm.menyerahkanNama} onChange={e=>setTxnForm(tf=>({...tf,menyerahkanNama:e.target.value}))} placeholder="cth: PT. Mitra Jaya"/>
              </div>
              <div>
                <label style={sty.label}>Gudang Penyimpanan *</label>
                <select style={sty.select} value={txnForm.gudangTujuanId||""} onChange={e=>{ const gid=e.target.value; setTxnForm(tf=>{ const cand=satpamList.filter(sp=>sp.gudangId===gid); return {...tf, gudangTujuanId:gid, subGudangTujuanId:"", lokasiTujuanId:"", satpamId: cand.length===1?cand[0].id:""}; }); }}>
                  <option value="">-- Pilih Gudang --</option>
                  {visibleGudangList.map(g=>{ const up=uptList.find(u=>u.id===g.uptId); return <option key={g.id} value={g.id}>{g.nama}{up?` — ${up.nama}`:""}</option>; })}
                  {hasLegacyBlok && <option value="__legacy__">Blok tanpa gudang (legacy)</option>}
                </select>
                {gudangList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Master Gudang. Tambahkan dulu di Master Data → Master Gudang.</div>}
              </div>
              {!isLegacyGud && tug10Subs.length>0 && (
                <div>
                  <label style={sty.label}>Sub Gudang</label>
                  <select style={sty.select} value={txnForm.subGudangTujuanId||""} onChange={e=>setTxnForm(tf=>({...tf,subGudangTujuanId:e.target.value,lokasiTujuanId:""}))}>
                    <option value="">— Tanpa Sub Gudang —</option>
                    {tug10Subs.map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                  </select>
                </div>
              )}
              <div ref={setRef("lokasiTujuanId")} style={{...hl("lokasiTujuanId")}}>
                <label style={sty.label}>Blok Penyimpanan *</label>
                <select style={sty.select} value={txnForm.lokasiTujuanId||""} disabled={!txnForm.gudangTujuanId} onChange={e=>setTxnForm(tf=>({...tf,lokasiTujuanId:e.target.value}))}>
                  <option value="">{txnForm.gudangTujuanId?"-- Pilih Blok --":"Pilih gudang dulu"}</option>
                  {tug10Bloks.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan?`— ${l.keterangan}`:""}</option>)}
                </select>
                {txnForm.gudangTujuanId && tug10Bloks.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada blok pada pilihan ini. Tambahkan di Master Data → Master Gudang.</div>}
              </div>
              <div style={{gridColumn:isMobile?"auto":"1/-1"}}>
                <label style={sty.label}>Satpam Gudang (Mengetahui)</label>
                <select style={sty.select} value={txnForm.satpamId||""} disabled={!txnForm.gudangTujuanId||isLegacyGud} onChange={e=>setTxnForm(tf=>({...tf,satpamId:e.target.value}))}>
                  <option value="">{(!txnForm.gudangTujuanId||isLegacyGud)?"Pilih gudang dulu":"-- Pilih Satpam --"}</option>
                  {(gudSatpams.length>0?gudSatpams:(txnForm.gudangTujuanId&&!isLegacyGud?satpamList:[])).map(sp=><option key={sp.id} value={sp.id}>{sp.name}{gudSatpams.length===0?" (gudang lain)":""}</option>)}
                </select>
                {txnForm.gudangTujuanId && !isLegacyGud && gudSatpams.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada satpam untuk gudang ini — tambahkan di Master Data → Satpam. Sementara bisa pilih dari semua satpam.</div>}
              </div>
              {breadcrumb && <div style={{gridColumn:isMobile?"auto":"1/-1",fontSize:12,color:C.accent,fontWeight:700,background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:8,padding:"6px 10px"}}>📍 {breadcrumb}</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL RETUR</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>{
              const n = idx+1;
              const isAttb = si.statusMaterial==="Bongkaran ATTB (MTU)";
              const barangOk = si.katalogMode==="existing" ? !!si.katalogId : !!si.namaBaru?.trim();
              const qtyOk = si.qty>0;
              const fotoOk = !!si.fotoBarangRetur;
              const seriOk = !isAttb || !!si.noSeri?.trim();
              const nameplateOk = !isAttb || !!si.fotoNameplate;
              const complete = barangOk && qtyOk && fotoOk && seriOk && nameplateOk;
              const collapsed = complete && tug10Collapsed[idx];
              const kat = si.katalogMode==="existing" ? katalogList.find(k=>k.id===si.katalogId) : null;
              const namaDisplay = si.katalogMode==="existing" ? (kat?.name||"-") : (si.namaBaru||"(barang baru)");
              const satuanDisplay = si.katalogMode==="existing" ? (kat?.satuan||"") : (si.satuanBaru||"");
              const bs = statusMaterialBadgeStyle(si.statusMaterial);
              const hint = txt => <div style={{fontSize:12,color:"#be185d",marginTop:4}}>{txt}</div>;
              return (
              <div key={idx} ref={setRef(`item-${idx}`)} style={{border:`1px solid ${complete?"#bbf7d0":C.border}`,borderRadius:10,padding:12,marginBottom:10,background:complete?"#f6fefb":"#f9fafb",...hl(`item-${idx}`)}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:collapsed?0:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,fontWeight:800,color:C.accent}}>Barang #{n}</span>
                  <span style={{fontSize:12,fontWeight:700,padding:"1px 8px",borderRadius:20,background:bs.bg,color:bs.fg}}>{si.statusMaterial}</span>
                  {complete && <span style={{fontSize:12,color:"#16a34a",fontWeight:700}}>✓ Lengkap</span>}
                  <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                    {complete && <button type="button" style={{...sty.btn("ghost","sm")}} onClick={()=>setTug10Collapsed(c=>({...c,[idx]:!c[idx]}))}>{collapsed?"▼ Buka":"▲ Ringkas"}</button>}
                    {txnForm.stockItems.length>1 && <button type="button" title="Hapus barang retur ini" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
                  </div>
                </div>

                {collapsed ? (
                  <div onClick={()=>setTug10Collapsed(c=>({...c,[idx]:false}))} style={{cursor:"pointer",fontSize:12,color:C.text,paddingTop:6}}>
                    <b>{namaDisplay}</b> · {fmtNum(si.qty)} {satuanDisplay}{si.noAsset?` · Asset ${si.noAsset}`:""} · 📷 Foto ✓{isAttb?" · Nameplate ✓":""}
                  </div>
                ) : (<>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                </div>

                {si.katalogMode==="existing" ? (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Pilih Barang *</label>
                    <SearchableSelect
                      options={katalogList}
                      value={si.katalogId}
                      onChange={v=>updateItemRow(idx,"katalogId",v)}
                      getLabel={k=>`${k.name} [${k.katalog}]`}
                      getSearchText={k=>`${k.name} ${k.katalog||""}`}
                      placeholder="-- Cari & pilih dari Master Katalog --"
                      sty={sty} C={C} isMobile={isMobile}
                    />
                    {!barangOk && hint("Wajib: pilih barang dari katalog.")}
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru *</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: Relay CCP Bongkaran"/>{!barangOk && hint("Wajib: isi nama barang baru.")}</div>
                    <div><label style={sty.label}>Nomor Katalog</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)}/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: BH, pcs, unit"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                  <div><label style={sty.label}>Jumlah *</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/>{!qtyOk && hint("Wajib: jumlah harus lebih dari 0.")}</div>
                  <div><label style={sty.label}>Nomor Asset</label><input style={sty.input} value={si.noAsset} onChange={e=>updateItemRow(idx,"noAsset",e.target.value)}/></div>
                </div>

                <div style={{marginBottom:8}}>
                  <label style={sty.label}>Status Material</label>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8}}>
                    {STATUS_MATERIAL_RETUR.map(sm=>{
                      const smbs = statusMaterialBadgeStyle(sm);
                      const active = si.statusMaterial===sm;
                      return (
                        <button key={sm} type="button" style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${active?smbs.fg:C.border}`,background:active?smbs.bg:"white",color:active?smbs.fg:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}} onClick={()=>updateItemRow(idx,"statusMaterial",sm)}>{sm}</button>
                      );
                    })}
                  </div>
                  {si.statusMaterial==="Bongkaran" && <div style={{fontSize:12,color:"#854d0e",marginTop:4}}>ℹ️ Jenis Barang otomatis menjadi "Bongkaran".</div>}
                  {isAttb && <div style={{fontSize:12,color:"#92400e",marginTop:4}}>ℹ️ Jenis Barang otomatis menjadi "ATTB". Wajib lengkapi data tambahan di bawah.</div>}
                </div>

                <div style={{background:"#f0fdf4",border:`1px solid #bbf7d0`,borderRadius:8,padding:10,marginBottom:isAttb?8:0}}>
                  <label style={sty.label}>Foto Barang * (wajib untuk semua status)</label>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                    {si.fotoBarangRetur && <img src={si.fotoBarangRetur} alt="barang" style={{width:isMobile?"100%":72,height:isMobile?140:72,objectFit:"cover",borderRadius:6}}/>}
                    <label style={{...sty.btn("ghost","sm"),cursor:"pointer"}}>📷 {si.fotoBarangRetur?"Ganti Foto":"Ambil / Pilih Foto"}<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoBarangRetur",img))}/></label>
                    {si.fotoBarangRetur && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>updateItemRow(idx,"fotoBarangRetur",null)}>Hapus</button>}
                  </div>
                  {!fotoOk && hint("Wajib: unggah foto barang.")}
                </div>

                {isAttb && (
                  <div style={{background:"#fffbeb",border:`1px solid #fde68a`,borderRadius:8,padding:10}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:8}}>📋 Data Tambahan Wajib — Bongkaran ATTB (MTU)</div>
                    <div style={{marginBottom:8}}><label style={sty.label}>Nomor Seri Material *</label><input style={sty.input} value={si.noSeri} onChange={e=>updateItemRow(idx,"noSeri",e.target.value)} placeholder="cth: SN-2024-001"/>{!seriOk && hint("Wajib: isi nomor seri material.")}</div>
                    <div>
                      <label style={sty.label}>Foto Nameplate *</label>
                      <div style={{display:"flex",gap:10,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                        {si.fotoNameplate && <img src={si.fotoNameplate} alt="nameplate" style={{width:isMobile?"100%":72,height:isMobile?140:72,objectFit:"cover",borderRadius:6}}/>}
                        <label style={{...sty.btn("ghost","sm"),cursor:"pointer"}}>📷 {si.fotoNameplate?"Ganti Foto":"Ambil / Pilih Foto"}<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoNameplate",img))}/></label>
                        {si.fotoNameplate && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>updateItemRow(idx,"fotoNameplate",null)}>Hapus</button>}
                      </div>
                      {!nameplateOk && hint("Wajib: unggah foto nameplate.")}
                    </div>
                  </div>
                )}
                </>)}
              </div>
              );
            })}
            <button type="button" className="tug-add-item" onClick={addItemRow}><span className="tug-add-item__ic" aria-hidden="true">+</span>Tambah Barang Retur Lain</button>

            {txnForm.stockItems.some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && (
              <div ref={setRef("fotoBAPengembalian")} style={{marginBottom:16,...hl("fotoBAPengembalian")}}>
                <label style={sty.label}>Upload Surat BA Pengembalian * (foto)</label>
                <div style={{display:"flex",gap:10,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                  {txnForm.fotoBAPengembalian && <img src={txnForm.fotoBAPengembalian} alt="BA Pengembalian" style={{width:isMobile?"100%":72,height:isMobile?140:72,objectFit:"cover",borderRadius:6,border:`1px solid ${C.border}`}}/>}
                  <label style={{...sty.btn("ghost","sm"),cursor:"pointer"}}>📷 {txnForm.fotoBAPengembalian?"Ganti Foto":"Ambil / Pilih Foto"}<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoBAPengembalian:img})))}/></label>
                  {txnForm.fotoBAPengembalian && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>setTxnForm(tf=>({...tf,fotoBAPengembalian:null}))}>Hapus</button>}
                </div>
                {!txnForm.fotoBAPengembalian && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Wajib karena ada material Bongkaran ATTB (MTU).</div>}
              </div>
            )}

            <div style={{border:`1px solid ${missingList.length?"#fecaca":"#bbf7d0"}`,background:missingList.length?"#fef2f2":"#f0fdf4",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12}}>
              {missingList.length===0
                ? <div style={{color:"#166534",fontWeight:800}}>✅ Siap diajukan</div>
                : <div style={{color:"#be185d"}}><b>Kurang:</b> {missingList.map(m=>m.label).join(" · ")}</div>}
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}}>Batal</button>
              <button disabled={savingTxn} style={{...sty.btn("primary"),flex:2,opacity:savingTxn?0.7:1,cursor:savingTxn?"wait":"pointer"}} onClick={saveTxn}>{savingTxn?"⏳ Menyimpan...":"📤 Ajukan TUG-10"}</button>
            </div>
          </div>
        </div>
  );
}

export function Tug3FormModal({ txnForm, setTxnForm, setTxnModal, docSeq, katalogList, lokasiList, CATEGORIES, addItemRow, removeItemRow, updateItemRow, saveTxn, isMobile, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir TUG-3 Karantina — Bon Penerimaan</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.TUG-3/...</span>
                <button onClick={()=>setTxnModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Setelah diajukan: TL Logistik approve → lanjut isi TUG-4 → Manager approve → lengkapi lampiran → Asman approve → stok masuk gudang.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div><label style={sty.label}>Tanggal Diterima *</label><input type="date" style={sty.input} value={txnForm.tanggalDiterima} onChange={e=>setTxnForm(tf=>({...tf,tanggalDiterima:e.target.value}))}/></div>
              <div><label style={sty.label}>Dari (Supplier) *</label><input style={sty.input} value={txnForm.dariSupplier} onChange={e=>setTxnForm(tf=>({...tf,dariSupplier:e.target.value}))} placeholder="cth: PT. Sedayu"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Dengan</label><input style={sty.input} value={txnForm.denganKirim} onChange={e=>setTxnForm(tf=>({...tf,denganKirim:e.target.value}))} placeholder="cth: Dikirim Langsung"/></div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Dokumen Pengiriman</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div><label style={sty.label}>No. Surat Jalan</label><input style={sty.input} value={txnForm.noSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,noSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Surat Jalan</label><input type="date" style={sty.input} value={txnForm.tglSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,tglSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SPK / Surat Pesanan</label><input style={sty.input} value={txnForm.noSpk} onChange={e=>setTxnForm(tf=>({...tf,noSpk:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. SPK</label><input type="date" style={sty.input} value={txnForm.tglSpk} onChange={e=>setTxnForm(tf=>({...tf,tglSpk:e.target.value}))}/></div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Dokumen Keuangan</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>No. Faktur / Bukti Kas</label><input style={sty.input} value={txnForm.noFaktur} onChange={e=>setTxnForm(tf=>({...tf,noFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Faktur</label><input type="date" style={sty.input} value={txnForm.tglFaktur} onChange={e=>setTxnForm(tf=>({...tf,tglFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>No. Amandemen/Kontrak</label><input style={sty.input} value={txnForm.noAmandemen} onChange={e=>setTxnForm(tf=>({...tf,noAmandemen:e.target.value}))}/></div>
              <div><label style={sty.label}>Biaya Angkutan</label><input type="number" inputMode="decimal" style={sty.input} value={txnForm.biayaAngkutan} onChange={e=>setTxnForm(tf=>({...tf,biayaAngkutan:Number(e.target.value)}))}/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / SPARE PARTS</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>(
              <div key={idx} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10,background:"#f9fafb"}}>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                  {txnForm.stockItems.length>1 && <button type="button" title="Hapus barang ini" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
                </div>
                {si.katalogMode==="existing" ? (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Pilih Barang</label>
                    <SearchableSelect
                      options={katalogList}
                      value={si.katalogId}
                      onChange={v=>updateItemRow(idx,"katalogId",v)}
                      getLabel={k=>`${k.name} [${k.katalog}]`}
                      getSearchText={k=>`${k.name} ${k.katalog||""}`}
                      placeholder="-- Cari & pilih dari Master Katalog --"
                      sty={sty} C={C} isMobile={isMobile}
                    />
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: INSUL MEDIA;OIL;NAPHTHENIC"/></div>
                    <div><label style={sty.label}>Nomor Katalog</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)} placeholder="cth: 4180023"/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: L, BH, pcs"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:8}}>
                  <div><label style={sty.label}>Jumlah</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                  <div><label style={sty.label}>Harga Satuan</label><input style={sty.input} type="number" inputMode="decimal" min="0" value={si.harga} onChange={e=>updateItemRow(idx,"harga",Number(e.target.value))}/></div>
                  <div>
                    <label style={sty.label}>Lokasi Tujuan</label>
                    <select style={sty.select} value={si.lokasiTujuanId||""} onChange={e=>updateItemRow(idx,"lokasiTujuanId",e.target.value)}>
                      <option value="">-- Pilih --</option>
                      {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Lain</button>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>ADMINISTRASI</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={sty.label}>Nota No.</label><input style={sty.input} value={txnForm.notaNo} onChange={e=>setTxnForm(tf=>({...tf,notaNo:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Perkiraan</label><input style={sty.input} value={txnForm.kodePerkiraan} onChange={e=>setTxnForm(tf=>({...tf,kodePerkiraan:e.target.value}))}/></div>
              <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={txnForm.perintahKerja} onChange={e=>setTxnForm(tf=>({...tf,perintahKerja:e.target.value}))}/></div>
              <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={txnForm.fungsi} onChange={e=>setTxnForm(tf=>({...tf,fungsi:e.target.value}))}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Keterangan</label><input style={sty.input} value={txnForm.keteranganTug3} onChange={e=>setTxnForm(tf=>({...tf,keteranganTug3:e.target.value}))} placeholder="Baik"/></div>
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTxnModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>📤 Ajukan TUG-3 Karantina</button>
            </div>
          </div>
        </div>
  );
}
