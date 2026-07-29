// Komponen KartuGantungModal — membedakan Halaman Depan (QR Code) & Halaman Belakang (Riwayat Transaksi) TUG.2.
import { useState } from "react";
import { fmtDate, fmtDateOnly } from "../lib/utils.js";
import { fmtNum, getSAPLabel } from "../lib/ragShared.mjs";
import { buildKartuGantungHistory, getSAPBadgeStyle, jenisBarangAccentColor } from "../lib/sap.js";
import { buildTUG2FrontHTML, buildTUG2BackHTML } from "../lib/docBuilders.js";
import { PLN_LOGO_DATA_URI } from "../assets/plnLogoBase64.js";
import { UPT } from "../constants.js";

export function KartuGantungModal({ katalog, stocks, txns, lokasiList, gudangList, sty, C, onClose }) {
  const [view, setView] = useState("front"); // "front" | "back"
  const history = buildKartuGantungHistory(katalog, txns, stocks, lokasiList);
  const lokasiTerkait = [...new Set((stocks||[]).filter(s=>s.katalogId===katalog.id).map(s=>s.lokasiId))].map(lid=>lokasiList.find(l=>l.id===lid)?.kode).filter(Boolean);
  const sampleFoto = stocks.find(s=>s.katalogId===katalog.id && s.img)?.img || null;
  const currentStockQty = (stocks||[]).filter(s=>s.katalogId===katalog.id).reduce((a,s)=>a+(s.qty||0),0);

  const scanUrl = `${window.location.origin}/?scan=${encodeURIComponent(katalog.id)}`;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(scanUrl)}`;

  const handlePrintFront = async () => {
    const html = await buildTUG2FrontHTML(katalog, stocks, lokasiList);
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  const handlePrintBack = async () => {
    const html = await buildTUG2BackHTML(katalog, stocks, txns, lokasiList);
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  // Baris yang diisi untuk preview & cetak kartu riwayat belakang TUG.2 (minimal 10 baris)
  const displayRows = [...history];
  const minRows = 10;
  for (let i = history.length; i < minRows; i++) {
    displayRows.push({ isBlank: true });
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:16}}>
      <div style={{...sty.card,width:760,maxWidth:"100%",maxHeight:"94vh",overflowY:"auto",background:"white",color:"#111",padding:20}}>
        
        {/* Header Control & Sub-Tabs */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,borderBottom:`1px solid ${C.border}`,paddingBottom:10,flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              {id:"front", label:"🏷️ Kartu Depan TUG.2 (Foto & QR Code)"},
              {id:"back", label:"📋 Riwayat Transaksi TUG.2 (Belakang)"}
            ].map(v=>(
              <button 
                key={v.id} 
                style={{
                  padding:"6px 16px",
                  borderRadius:20,
                  border:`1px solid ${view===v.id?C.accent:C.border}`,
                  background:view===v.id?C.accent:"#f8fafc",
                  color:view===v.id?"white":"#475569",
                  fontSize:12,
                  cursor:"pointer",
                  fontWeight:view===v.id?700:500
                }} 
                onClick={()=>setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600}} onClick={onClose}>✕ Tutup</button>
        </div>

        {/* TAB 1: HALAMAN DEPAN (FOTO BARANG & QR CODE) — SESUAI FOTO 1 */}
        {view === "front" && (
          <div>
            <div style={{border:"2px solid #0f172a",borderRadius:6,padding:16,background:"#fff",marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
              
              {/* Header: Logo PLN, Company, UPT, TUG.2 */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <img src={PLN_LOGO_DATA_URI} alt="PLN Logo" style={{height:44,width:"auto"}}/>
                  <div>
                    <div style={{fontSize:11,fontWeight:800,color:"#0f172a",lineHeight:1.2}}>PT PLN (PERSERO)</div>
                    <div style={{fontSize:10,fontWeight:700,color:"#334155",lineHeight:1.2}}>TRANSMISI JAWA BAGIAN TIMUR DAN BALI</div>
                    <div style={{fontSize:9.5,fontWeight:700,color:"#475569",lineHeight:1.2}}>{(UPT||"UNIT PELAKSANA SURABAYA").toUpperCase()}</div>
                  </div>
                </div>
                <div style={{fontSize:15,fontWeight:900,color:"#0f172a",letterSpacing:1}}>
                  TUG. 2
                </div>
              </div>

              {/* Title: KARTU GANTUNG BARANG */}
              <div style={{textAlign:"center",margin:"12px 0 14px"}}>
                <h3 style={{fontSize:16,fontWeight:900,textDecoration:"underline",color:"#0f172a",letterSpacing:0.5}}>KARTU GANTUNG BARANG</h3>
              </div>

              {/* Tabel Metadata Katalog / Item */}
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,border:"1.5px solid #0f172a",marginBottom:16}}>
                <tbody>
                  <tr>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc",width:110}}>No. Katalog :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:800,color:"#0284c7"}}>{katalog.katalog || "-"}</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc",width:90}}>Lokasi :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700}}>{lokasiTerkait.length>0 ? lokasiTerkait.join(", ") : "-"}</td>
                  </tr>
                  <tr>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc"}}>No. Aset :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px"}}>{katalog.noAset || "-"}</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc"}}>KARTU No. :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px"}}>{katalog.kartuNo || "-"}</td>
                  </tr>
                  <tr>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc"}}>NAMA BARANG :</td>
                    <td colSpan={2} style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:800,fontSize:12,color:"#0f172a"}}>{katalog.name || "-"}</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,textAlign:"center"}}><span style={{fontSize:9,color:"#64748b"}}>SATUAN</span><br/>{katalog.satuan || "BH"}</td>
                  </tr>
                </tbody>
              </table>

              {/* Section 2 Kolom: FOTO BARANG & QR CODE (Sesuai Foto 1) */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:10}}>
                <div style={{border:"1.5px solid #0f172a",borderRadius:4,padding:12,textAlign:"center",background:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:200}}>
                  <div style={{fontWeight:800,fontSize:11,marginBottom:8,letterSpacing:0.5,borderBottom:"1px solid #cbd5e1",width:"100%",paddingBottom:4,color:"#334155"}}>FOTO BARANG</div>
                  {sampleFoto ? (
                    <img src={sampleFoto} alt="Foto Barang" style={{maxWidth:"100%",maxHeight:140,objectFit:"contain",borderRadius:4}}/>
                  ) : (
                    <div style={{color:"#94a3b8",fontSize:10,fontStyle:"italic",padding:"30px 0"}}>&lt;&lt; [Foto Barang] &gt;&gt;</div>
                  )}
                </div>
                <div style={{border:"1.5px solid #0f172a",borderRadius:4,padding:12,textAlign:"center",background:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:200}}>
                  <div style={{fontWeight:800,fontSize:11,marginBottom:8,letterSpacing:0.5,borderBottom:"1px solid #cbd5e1",width:"100%",paddingBottom:4,color:"#334155"}}>QR CODE</div>
                  <img src={qrImgUrl} alt="QR Code TUG-2" style={{width:130,height:130,display:"block",margin:"0 auto"}}/>
                </div>
              </div>

            </div>

            {/* Print Button for Front Page */}
            <div style={{display:"flex",justifyContent:"center",marginTop:14}}>
              <button onClick={handlePrintFront} style={{...sty.btn("primary"),display:"flex",alignItems:"center",gap:8,padding:"10px 24px",fontSize:13,fontWeight:700}}>
                🖨️ Cetak Kartu Depan (Foto Barang & QR Code)
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: HALAMAN BELAKANG (TABEL RIWAYAT TRANSAKSI) — SESUAI FOTO 2 */}
        {view === "back" && (
          <div>
            <div style={{border:"2px solid #0f172a",borderRadius:6,padding:16,background:"#fff",marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
              
              {/* Header: Logo PLN, Company, UPT, TUG.2 */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <img src={PLN_LOGO_DATA_URI} alt="PLN Logo" style={{height:44,width:"auto"}}/>
                  <div>
                    <div style={{fontSize:11,fontWeight:800,color:"#0f172a",lineHeight:1.2}}>PT PLN (PERSERO)</div>
                    <div style={{fontSize:10,fontWeight:700,color:"#334155",lineHeight:1.2}}>TRANSMISI JAWA BAGIAN TIMUR DAN BALI</div>
                    <div style={{fontSize:9.5,fontWeight:700,color:"#475569",lineHeight:1.2}}>{(UPT||"UNIT PELAKSANA SURABAYA").toUpperCase()}</div>
                  </div>
                </div>
                <div style={{fontSize:15,fontWeight:900,color:"#0f172a",letterSpacing:1}}>
                  TUG. 2
                </div>
              </div>

              {/* Title: KARTU GANTUNG BARANG */}
              <div style={{textAlign:"center",margin:"12px 0 14px"}}>
                <h3 style={{fontSize:16,fontWeight:900,textDecoration:"underline",color:"#0f172a",letterSpacing:0.5}}>KARTU GANTUNG BARANG</h3>
              </div>

              {/* Tabel Metadata Katalog / Item */}
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,border:"1.5px solid #0f172a",marginBottom:14}}>
                <tbody>
                  <tr>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc",width:110}}>No. Katalog :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:800,color:"#0284c7"}}>{katalog.katalog || "-"}</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc",width:90}}>Lokasi :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700}}>{lokasiTerkait.length>0 ? lokasiTerkait.join(", ") : "-"}</td>
                  </tr>
                  <tr>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc"}}>No. Aset :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px"}}>{katalog.noAset || "-"}</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc"}}>KARTU No. :</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px"}}>{katalog.kartuNo || "-"}</td>
                  </tr>
                  <tr>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,background:"#f8fafc"}}>NAMA BARANG :</td>
                    <td colSpan={2} style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:800,fontSize:12,color:"#0f172a"}}>{katalog.name || "-"}</td>
                    <td style={{border:"1px solid #0f172a",padding:"6px 8px",fontWeight:700,textAlign:"center"}}><span style={{fontSize:9,color:"#64748b"}}>SATUAN</span><br/>{katalog.satuan || "BH"}</td>
                  </tr>
                </tbody>
              </table>

              {/* Header Tabel Riwayat Keluar-Masuk (SISA PERSEDIAAN: RAK / PETI / JMLH) */}
              <div style={{fontWeight:800,fontSize:11,marginBottom:6,color:"#0f172a",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>RIWAYAT KELUAR - MASUK BARANG</span>
                <span style={{fontSize:11,color:"#0284c7",fontWeight:700}}>Stok Saat Ini: {fmtNum(currentStockQty)} {katalog.satuan||"BH"}</span>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,border:"1.5px solid #0f172a"}}>
                  <thead>
                    <tr style={{background:"#f1f5f9",color:"#0f172a"}}>
                      <th rowSpan={2} style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center",width:75}}>TGL</th>
                      <th rowSpan={2} style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"left"}}>NO. BON</th>
                      <th rowSpan={2} style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center",width:55}}>MASUK</th>
                      <th rowSpan={2} style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center",width:55}}>KELUAR</th>
                      <th colSpan={3} style={{border:"1px solid #0f172a",padding:"5px 6px",textAlign:"center"}}>SISA PERSEDIAAN</th>
                      <th rowSpan={2} style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"left"}}>CATATAN</th>
                    </tr>
                    <tr style={{background:"#f1f5f9",color:"#0f172a"}}>
                      <th style={{border:"1px solid #0f172a",padding:"4px 4px",textAlign:"center",width:45}}>RAK</th>
                      <th style={{border:"1px solid #0f172a",padding:"4px 4px",textAlign:"center",width:45}}>PETI</th>
                      <th style={{border:"1px solid #0f172a",padding:"4px 4px",textAlign:"center",width:55}}>JMLH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((h,idx)=>{
                      if (h.isBlank) {
                        return (
                          <tr key={idx} style={{height:26}}>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                            <td style={{border:"1px solid #0f172a"}}>&nbsp;</td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={idx} style={{borderBottom:"1px solid #0f172a"}}>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center"}}>{fmtDateOnly(h.tgl)}</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",fontWeight:600}}>{h.noBon||"-"}</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center",color:"#15803d",fontWeight:700}}>{h.masuk>0?fmtNum(h.masuk):""}</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center",color:"#b91c1c",fontWeight:700}}>{h.keluar>0?fmtNum(h.keluar):""}</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center"}}>{fmtNum(h.sisa)}</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center"}}>-</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",textAlign:"center",fontWeight:700}}>{fmtNum(h.sisa)}</td>
                          <td style={{border:"1px solid #0f172a",padding:"6px 6px",color:"#475569"}}>{h.catatan||"-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

            </div>

            {/* Print Button for Back Page */}
            <div style={{display:"flex",justifyContent:"center",marginTop:14}}>
              <button onClick={handlePrintBack} style={{...sty.btn("primary"),display:"flex",alignItems:"center",gap:8,padding:"10px 24px",fontSize:13,fontWeight:700}}>
                🖨️ Cetak Lembar Riwayat Keluar-Masuk (Belakang)
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
