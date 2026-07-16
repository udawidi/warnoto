// Komponen StockCountTab — dipindah dari App.jsx (refactor Fase 5a).
import { useState } from "react";
import { fmtDate, parseSAPFile } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { hasRole } from "../lib/roles.js";
import * as XLSX from "xlsx";

export function StockCountTab({ stockCountList, currentUser, sty, C, previewStockCount, saveStockCountSession, approveStockCountItem, rejectStockCountItem, deleteStockCountSession }) {
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState(stockCountList[0]?.id || null);
  const [catatanDraft, setCatatanDraft] = useState({}); // itemId -> teks catatan sedang diketik
  const [draftItems, setDraftItems] = useState(null); // hasil baca file, BELUM disimpan — masih bisa direview/dicoret per item
  const [saving, setSaving] = useState(false);
  const [rejectingItemId, setRejectingItemId] = useState(null); // itemId yang sedang dikonfirmasi penolakannya (bisa Batal)

  async function handleFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const sapRows = await parseSAPFile(f);
      const items = previewStockCount(sapRows).map(it => ({ ...it, included: true }));
      setDraftItems(items);
    } catch (err) {
      alert("Gagal membaca file: " + err.message);
    }
    setUploading(false);
    e.target.value = "";
  }

  function toggleDraftItem(id) {
    setDraftItems(items => items.map(it => it.id===id ? {...it, included: !it.included} : it));
  }

  async function confirmSaveDraft() {
    const included = draftItems.filter(it => it.included).map(({included, ...it}) => it);
    setSaving(true);
    const session = await saveStockCountSession(included);
    setSaving(false);
    setDraftItems(null);
    setExpandedId(session.id);
  }

  const REKOMENDASI_LABEL = {
    TAMBAH_STOK: "➕ Disarankan: tambah stok baru di Data Stok (selisih kurang dari SAP)",
    BUAT_TUG_KELUAR: "📤 Disarankan: buat TUG-9/8 (kemungkinan ada pemakaian belum tercatat)",
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <p style={{color:C.muted,fontSize:13}}>Banding qty SAP vs Aplikasi untuk material ber-status SAP — temuan selisih perlu approval Asman.</p>
        </div>
        {hasRole(currentUser, "ADMIN") && !draftItems && (
          <label style={{...sty.btn("primary"),cursor:uploading?"default":"pointer",opacity:uploading?0.6:1}}>
            {uploading ? "Memproses..." : "📂 Upload CSV/XLSX SAP"}
            <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleFile} disabled={uploading} style={{display:"none"}}/>
          </label>
        )}
      </div>
      <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#1d4ed8",marginBottom:16}}>
        ℹ️ Stock Count ini cuma membaca & membandingkan — <b>tidak mengubah</b> Data Stok atau Master Katalog. Rekomendasi (tambah stok / buat TUG) cuma saran, tidak otomatis membuat apa pun. Kalau file punya lebih dari 1 sheet dengan header sama, semua ikut terbaca.
      </div>

      {/* DRAFT REVIEW — hasil upload belum tersimpan, belum terlihat Asman.
          Admin review satu per satu (termasuk material baru yang belum ada
          di Master Katalog) sebelum klik Simpan & Kirim. */}
      {draftItems && (() => {
        // Kolom perbandingan SAP vs Aplikasi dulu digepengkan jadi 1 baris teks kecil ("SAP X •
        // App Y"), dan material yang belum terdaftar di Master Katalog cuma ditandai badge kecil
        // di sebelah nama — qtyApp-nya tetap tampil angka "0" yang ambigu (kelihatan kayak "qty-nya
        // 0", padahal maksudnya "materialnya belum ada sama sekali"). Diubah jadi tabel dengan
        // kolom eksplisit + teks "Tidak terdaftar" (bukan angka 0) untuk material baru — keluhan
        // user 2026-07-07: "kolom perbandingan kurang jelas...terutama material yang kurang jelas".
        const akuratCount = draftItems.filter(i=>i.status==="AKURAT").length;
        const belumTerdaftarCount = draftItems.filter(i=>!i.katalogId).length;
        const selisihCount = draftItems.filter(i=>i.status!=="AKURAT" && i.katalogId).length;
        return (
        <div style={{...sty.card,marginBottom:20,border:`2px solid #f59e0b`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontWeight:800,fontSize:15}}>📝 Review Draft Stock Count ({draftItems.length} item)</div>
            <button style={sty.btn("ghost","sm")} onClick={()=>setDraftItems(null)}>✕ Batal</button>
          </div>
          <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Centang item yang mau disertakan. Item yang akurat tetap ditampilkan sebagai informasi, tidak akan masuk approval Asman.</div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:12}}>
            {[
              {label:"Total Item",val:draftItems.length,color:C.accent},
              {label:"Akurat",val:akuratCount,color:C.green},
              {label:"Selisih",val:selisihCount,color:"#dc2626"},
              {label:"Belum Terdaftar",val:belumTerdaftarCount,color:"#7c3aed"},
            ].map(s=>(
              <div key={s.label} style={{textAlign:"center",padding:"8px 6px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
                <div style={{fontSize:12,color:C.muted}}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{overflowX:"auto",maxHeight:420,overflowY:"auto",marginBottom:14,border:`1px solid ${C.border}`,borderRadius:8}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                  <th style={{padding:"7px 8px",width:30}}></th>
                  <th style={{padding:"7px 8px",textAlign:"left"}}>Nama Barang</th>
                  <th style={{padding:"7px 8px",textAlign:"center"}}>No. Katalog</th>
                  <th style={{padding:"7px 8px",textAlign:"center"}}>Qty SAP</th>
                  <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Aplikasi</th>
                  <th style={{padding:"7px 8px",textAlign:"center"}}>Selisih</th>
                  <th style={{padding:"7px 8px",textAlign:"center"}}>Status</th>
                  <th style={{padding:"7px 8px",textAlign:"left"}}>Rekomendasi</th>
                </tr>
              </thead>
              <tbody>
                {draftItems.map(item => {
                  const belumTerdaftar = !item.katalogId;
                  const rowBg = belumTerdaftar ? "#f3e8ff" : item.status==="AKURAT" ? "white" : "#fff5f5";
                  return (
                    <tr key={item.id} style={{borderBottom:`1px solid ${C.border}`,background:rowBg,opacity:item.included?1:0.4}}>
                      <td style={{padding:"6px 8px",textAlign:"center"}}>
                        <input type="checkbox" checked={item.included} onChange={()=>toggleDraftItem(item.id)}/>
                      </td>
                      <td style={{padding:"6px 8px",fontWeight:600,maxWidth:220}}>
                        {item.nama}
                        {belumTerdaftar && <div style={{fontSize:12,fontWeight:800,color:"#7c3aed"}}>🆕 Belum terdaftar di Master Katalog</div>}
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{item.katalogKode}</td>
                      <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600,whiteSpace:"nowrap"}}>{fmtNum(item.qtySap)} {item.satuan}</td>
                      <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600,whiteSpace:"nowrap"}}>
                        {belumTerdaftar ? <span style={{color:"#7c3aed",fontStyle:"italic",fontWeight:700}}>Tidak terdaftar</span> : `${fmtNum(item.qtyApp)} ${item.satuan}`}
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center",fontWeight:700,whiteSpace:"nowrap",color:item.selisih<0?"#dc2626":item.selisih>0?"#16a34a":"#6b7280"}}>
                        {item.status==="AKURAT" ? "—" : `${item.selisih>0?"+":""}${fmtNum(item.selisih)} (${item.selisihPct}%)`}
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center"}}>
                        {item.status==="AKURAT"
                          ? <span style={{fontSize:12,fontWeight:700,color:C.green}}>✓ Akurat</span>
                          : <span style={{fontSize:12,fontWeight:800,color:item.status==="APP_KURANG"?"#b45309":"#dc2626"}}>{item.status==="APP_KURANG"?"App Kurang":"App Lebih"}</span>}
                      </td>
                      <td style={{padding:"6px 8px",fontSize:12,color:"#1d4ed8"}}>{item.rekomendasi ? REKOMENDASI_LABEL[item.rekomendasi] : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button style={{...sty.btn("primary"),width:"100%"}} disabled={saving} onClick={confirmSaveDraft}>
            {saving ? "Menyimpan..." : `💾 Simpan & Kirim ke Asman (${draftItems.filter(i=>i.included).length} item)`}
          </button>
        </div>
        );
      })()}

      {stockCountList.length===0 ? (
        !draftItems && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada sesi Stock Count. {hasRole(currentUser, "ADMIN") && "Klik \"Upload CSV/XLSX SAP\" untuk mulai."}</div>
      ) : stockCountList.map(session => {
        const isOpen = expandedId===session.id;
        const mismatch = session.items.filter(i=>i.status!=="AKURAT").sort((a,b)=>b.selisihPct-a.selisihPct);
        return (
          <div key={session.id} style={{...sty.card,marginBottom:12,padding:0,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",cursor:"pointer",background:"#f9fafb"}} onClick={()=>setExpandedId(isOpen?null:session.id)}>
              <div>
                <div style={{fontWeight:800,fontSize:14}}>{fmtDate(session.uploadedAt)} — {session.summary.totalItem} item dibandingkan</div>
                <div style={{fontSize:12,color:C.muted}}>{session.summary.akuratCount} akurat • {mismatch.length} selisih{mismatch.some(i=>i.approval==="PENDING")&&` • ${mismatch.filter(i=>i.approval==="PENDING").length} menunggu approval`}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22,fontWeight:900,color:session.summary.akuratPct>=90?C.green:session.summary.akuratPct>=70?C.yellow:C.red}}>{session.summary.akuratPct}%</span>
                <span style={{fontSize:14,color:C.muted}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{padding:"0 16px 16px"}}>
                {hasRole(currentUser, "ADMIN") && (
                  <div style={{textAlign:"right",marginBottom:8}}>
                    <button style={sty.btn("danger","sm")} onClick={()=>deleteStockCountSession(session.id)}>🗑️ Hapus Sesi</button>
                  </div>
                )}
                {mismatch.length===0 ? (
                  <div style={{fontSize:12,color:C.green,fontWeight:700}}>✅ Semua item akurat, tidak ada selisih &gt;5%.</div>
                ) : mismatch.map(item => (
                  <div key={item.id} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:8,background:item.approval==="PENDING"?"#fffbeb":item.approval==="APPROVED"?"#f0fdf4":"#fef2f2"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:6}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13}}>{item.nama}</div>
                        <div style={{fontSize:12,color:C.muted}}>No. Katalog: {item.katalogKode}{!item.katalogId && " — tidak ada di Master Katalog"}</div>
                      </div>
                      <span style={{fontSize:12,fontWeight:800,color:item.status==="APP_KURANG"?"#b45309":"#dc2626",whiteSpace:"nowrap"}}>{item.selisih>0?"+":""}{fmtNum(item.selisih)} {item.satuan} ({item.selisihPct}%)</span>
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginBottom:6}}>SAP: {fmtNum(item.qtySap)} {item.satuan} • Aplikasi: {item.katalogId ? `${fmtNum(item.qtyApp)} ${item.satuan}` : <span style={{color:"#7c3aed",fontStyle:"italic",fontWeight:700}}>Tidak terdaftar</span>}</div>
                    <div style={{fontSize:12,fontWeight:600,color:"#1d4ed8",marginBottom:8}}>{REKOMENDASI_LABEL[item.rekomendasi]}</div>
                    {item.approval==="PENDING" ? (
                      hasRole(currentUser, "ASMAN") ? (
                        <div>
                          <input style={{...sty.input,fontSize:12,marginBottom:6}} placeholder="Catatan (opsional)" value={catatanDraft[item.id]||""} onChange={e=>setCatatanDraft(d=>({...d,[item.id]:e.target.value}))}/>
                          {rejectingItemId===item.id ? (
                            <div className="approval-actions approval-actions--compact">
                              <button className="approval-btn--danger" onClick={()=>{rejectStockCountItem(session.id, item.id, catatanDraft[item.id]); setRejectingItemId(null);}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                              <button className="approval-btn--cancel" onClick={()=>setRejectingItemId(null)}>Batal</button>
                            </div>
                          ) : (
                            <div className="approval-actions approval-actions--compact">
                              <button className="approval-btn--approve" onClick={()=>approveStockCountItem(session.id, item.id, catatanDraft[item.id])}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                              <button className="approval-btn--reject" onClick={()=>setRejectingItemId(item.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{fontSize:12,fontWeight:700,color:"#92400e"}}>⏳ Menunggu approval Asman</div>
                      )
                    ) : (
                      <div style={{fontSize:12,fontWeight:700,color:item.approval==="APPROVED"?C.green:C.red}}>
                        {item.approval==="APPROVED"?"✓ Disetujui":"✕ Ditolak"} oleh Asman{item.catatan && ` — "${item.catatan}"`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
