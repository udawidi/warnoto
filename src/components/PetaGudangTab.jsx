// Komponen PetaGudangTab — dipindah dari App.jsx (refactor Fase 5a).
import { useState, useEffect } from "react";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";

export function PetaGudangTab({ gudangList, subGudangList, lokasiList, stocks, sty, C, currentUser, gudangCapacityList }) {
  const [selectedGudangId, setSelectedGudangId] = useState(gudangList[0]?.id||"");
  const [hoveredLokasi, setHoveredLokasi] = useState(null);
  const [filterHanyaBerisi, setFilterHanyaBerisi] = useState(false);

  // gudangList dimuat async dari Supabase — kalau saat mount masih kosong,
  // selectedGudangId ke-stuck di "" dan peta tidak pernah tampil walau data sudah ada.
  // Kalau belum ada pilihan valid, prioritaskan Gudang yang sudah punya konten (denah sendiri
  // atau denah Sub Gudang) — supaya user tidak mendarat di gudang kosong lalu mengira peta belum tampil.
  useEffect(() => {
    const stillValid = gudangList.some(g=>g.id===selectedGudangId);
    if (selectedGudangId && stillValid) return;
    if (gudangList.length === 0) return;
    const withContent = gudangList.find(g => g.denahImageData || subGudangList.some(sg=>sg.gudangId===g.id && sg.denahImageData));
    setSelectedGudangId((withContent || gudangList[0]).id);
  }, [gudangList, subGudangList, selectedGudangId]);

  const gudang = gudangList.find(g=>g.id===selectedGudangId);
  const blokDiGudang = lokasiList.filter(l=>l.gudangId===selectedGudangId && l.mapX!=null);

  function stokDiBlok(lokasiId) {
    return stocks.filter(s=>s.lokasiId===lokasiId);
  }

  const blokTampil = filterHanyaBerisi
    ? blokDiGudang.filter(l=>stokDiBlok(l.id).length>0)
    : blokDiGudang;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>🗺️ Peta Utilisasi Gudang</h1>
          <p style={{color:C.muted,fontSize:13}}>Visualisasi lokasi blok dan material di denah gudang — data kapasitas m² dari import Excel. Untuk atur titik koordinat blok di denah, buka Master Data → Master Gudang.</p>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <label style={{fontSize:12,color:C.muted,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
            <input type="checkbox" checked={filterHanyaBerisi} onChange={e=>setFilterHanyaBerisi(e.target.checked)}/>
            Hanya blok berisi barang
          </label>
          <select style={{...sty.select,width:200}} value={selectedGudangId} onChange={e=>setSelectedGudangId(e.target.value)}>
            {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
          </select>
        </div>
      </div>

      {gudangList.length===0 && (
        <div style={{...sty.card,textAlign:"center",padding:60,color:C.muted}}>
          <div style={{fontSize:48,marginBottom:12}}>🏭</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada Gudang</div>
          <div style={{fontSize:12,marginTop:4}}>Tambahkan Gudang di Master Data → Master Gudang</div>
        </div>
      )}

      {gudang && !gudang.denahImageData && (
        <div style={{...sty.card,textAlign:"center",padding:60,color:C.muted}}>
          <div style={{fontSize:48,marginBottom:12}}>🗺️</div>
          <div style={{fontSize:14,fontWeight:700}}>Denah {gudang.nama} belum diupload</div>
          <div style={{fontSize:12,marginTop:4}}>Upload gambar denah (PNG/JPG) di Master Data → Master Gudang</div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>💡 Convert PDF denah ke gambar (screenshot/foto) sebelum upload</div>
        </div>
      )}

      {gudang && gudang.denahImageData && (() => {
        const totalBlok = blokDiGudang.length;
        const blokBerisi = blokDiGudang.filter(l=>stokDiBlok(l.id).length>0).length;
        const blokKosong = totalBlok - blokDiGudang.filter(l=>l.status==="PENDING").length - blokBerisi;
        const blokPending = blokDiGudang.filter(l=>l.status==="PENDING").length;
        const totalItem = blokDiGudang.reduce((a,l)=>a+stokDiBlok(l.id).length,0);
        return (
        <div>
          {blokDiGudang.length===0 && (
            <div style={{background:"#fef3c7",border:`1px solid #fde68a`,borderRadius:8,padding:"10px 14px",fontSize:12,color:"#92400e",marginBottom:14}}>
              ⚠️ Belum ada blok yang di-assign koordinat di peta ini. Pergi ke Master Data → Master Gudang → Konfigurasi Koordinat Blok.
            </div>
          )}

          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
            {[
              {label:"Total Blok",val:totalBlok,color:C.text},
              {label:"Berisi Barang",val:blokBerisi,color:C.green},
              {label:"Kosong",val:blokKosong,color:C.muted},
              {label:"Pending Approval",val:blokPending,color:"#92400e"},
              {label:"Total Item Tersimpan",val:totalItem,color:C.accent},
            ].map((s,i)=>(
              <div key={i} style={{...sty.card,padding:"8px 14px",display:"flex",flexDirection:"column",minWidth:110}}>
                <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{s.label}</div>
                <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 280px",gap:16}}>
            {/* Peta utama */}
            <div style={{position:"relative",...sty.card,padding:10,display:"flex",justifyContent:"center"}}>
              {/* Lebar wrapper dibatasi via maxWidth SAJA (bukan maxHeight/object-fit
                  pada img) — img tetap width:100% height:auto supaya gambar selalu
                  mengisi penuh box-nya tanpa letterbox, karena marker titik diposisikan
                  pakai persen (%) relatif ke box ini; kalau ada letterbox, persen jadi
                  tidak sinkron dengan piksel asli gambar dan titik jadi melebar/salah posisi. */}
              <div style={{position:"relative",maxWidth:680,width:"100%"}}>
              <img src={gudang.denahImageData} alt="Denah Gudang" style={{width:"100%",height:"auto",display:"block",borderRadius:10,border:`1px solid ${C.border}`}}/>
              {blokTampil.map(l=>{
                const stokList = stokDiBlok(l.id);
                const isEmpty = stokList.length===0;
                const isHovered = hoveredLokasi===l.id;
                const isPending = l.status==="PENDING";
                return (
                  <div key={l.id}
                    style={{position:"absolute",left:`${l.mapX}%`,top:`${l.mapY}%`,transform:"translate(-50%,-50%)",cursor:"pointer",zIndex:isHovered?10:5,
                      // Area sentuh dibuat lebih besar (36x36) dari titik visualnya
                      // (14-20px) — di HP jari lebih besar dari kursor mouse, kalau
                      // area klik sama persis dengan ukuran titik kecilnya, gampang
                      // tap-miss. Titik visual tetap kecil, cuma "hit area" yang dibesarkan.
                      width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}
                    onMouseEnter={()=>setHoveredLokasi(l.id)}
                    onMouseLeave={()=>setHoveredLokasi(null)}
                    onClick={()=>setHoveredLokasi(isHovered?null:l.id)}>
                    {/* Titik marker */}
                    <div style={{width:isHovered?20:14,height:isHovered?20:14,borderRadius:"50%",background:isPending?"#9ca3af":(isEmpty?"#9ca3af":"#dc2626"),border:isPending?"2px dashed white":"2px solid white",boxShadow:"0 2px 6px rgba(0,0,0,0.4)",transition:"all 0.15s"}}/>
                    {/* Label selalu tampil */}
                    <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:isPending?"rgba(146,64,14,0.9)":"rgba(0,0,0,0.75)",color:"white",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,whiteSpace:"nowrap",pointerEvents:"none"}}>
                      {l.kode}{isPending?" ⏳ Menunggu Approval":""}
                    </div>
                    {/* Popup saat hover/tap */}
                    {isHovered && (
                      <div style={{position:"absolute",top:32,left:"50%",transform:"translateX(-50%)",background:"white",border:`1px solid ${C.border}`,borderRadius:8,padding:10,minWidth:200,maxWidth:280,boxShadow:"0 4px 16px rgba(0,0,0,0.15)",zIndex:20}}>
                        <div style={{fontWeight:800,fontSize:12,marginBottom:6,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>📍 {l.kode} — {l.nama}</div>
                        {isPending && <div style={{fontSize:10,color:"#92400e",fontWeight:700,marginBottom:6}}>⏳ Blok ini belum final, menunggu approval TL</div>}
                        {isEmpty
                          ? <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Tidak ada barang di blok ini</div>
                          : stokList.slice(0,5).map((st,i)=>(
                              <div key={i} style={{fontSize:11,padding:"2px 0",display:"flex",justifyContent:"space-between"}}>
                                <span style={{color:"#111",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.name}</span>
                                <span style={{fontWeight:700,color:C.accent,marginLeft:8}}>{fmtNum(st.qty)} {st.unit}</span>
                              </div>
                            ))
                        }
                        {stokList.length>5 && <div style={{fontSize:10,color:C.muted,marginTop:4}}>+{stokList.length-5} item lainnya</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>

            {/* Panel legend kanan */}
            <div>
              <div style={{...sty.card,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Legenda</div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:"#dc2626",border:"2px solid white",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  <span style={{fontSize:11}}>Blok berisi barang</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:"#9ca3af",border:"2px solid white",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  <span style={{fontSize:11}}>Blok kosong</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:"#9ca3af",border:"2px dashed white",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  <span style={{fontSize:11}}>Menunggu approval TL</span>
                </div>
              </div>
              <div style={{...sty.card}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Daftar Blok ({blokTampil.length})</div>
                <div style={{maxHeight:400,overflowY:"auto"}}>
                  {blokTampil.map(l=>{
                    const n = stokDiBlok(l.id).length;
                    return (
                      <div key={l.id} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:hoveredLokasi===l.id?"#eff6ff":"transparent"}}
                        onMouseEnter={()=>setHoveredLokasi(l.id)}
                        onMouseLeave={()=>setHoveredLokasi(null)}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:12,fontWeight:600}}>{l.kode}</div>
                            <div style={{fontSize:10,color:C.muted}}>{l.nama||"-"}</div>
                          </div>
                          <span style={{fontSize:10,fontWeight:700,color:n>0?C.accent:C.muted}}>{n} item</span>
                        </div>
                      </div>
                    );
                  })}
                  {blokTampil.length===0 && <div style={{fontSize:11,color:C.muted,textAlign:"center",padding:16}}>Tidak ada blok untuk ditampilkan</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Galeri denah Sub Gudang (read-only) — hanya sub gudang yang sudah upload denah sendiri */}
      {gudang && (() => {
        const subsWithDenah = subGudangList.filter(sg=>sg.gudangId===gudang.id && sg.denahImageData);
        if (subsWithDenah.length===0) return null;
        return (
          <div style={{marginTop:24}}>
            <div style={{fontSize:14,fontWeight:800,marginBottom:10}}>🏢 Denah Sub Gudang</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
              {subsWithDenah.map(sg=>{
                const blokSub = lokasiList.filter(l=>l.subGudangId===sg.id && l.subMapX!=null);
                const blokBerisi = blokSub.filter(l=>stokDiBlok(l.id).length>0).length;
                return (
                  <div key={sg.id} style={{...sty.card,padding:12}}>
                    <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{sg.nama}</div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>
                      {gudang.nama} • {blokSub.length} blok terpetakan • {blokBerisi} berisi barang
                      {sg.denahUploadedAt && <> • diupdate {fmtDate(sg.denahUploadedAt)}</>}
                    </div>
                    <div style={{position:"relative",width:"100%"}}>
                      <img src={sg.denahImageData} alt={`Denah ${sg.nama}`} style={{width:"100%",height:"auto",display:"block",borderRadius:8,border:`1px solid ${C.border}`}}/>
                      {blokSub.map(l=>{
                        const stokList = stokDiBlok(l.id);
                        const isEmpty = stokList.length===0;
                        const isPending = l.status==="PENDING";
                        return (
                          <div key={l.id} title={`${l.kode}${isEmpty?" (kosong)":` — ${stokList.length} item`}`}
                            style={{position:"absolute",left:`${l.subMapX}%`,top:`${l.subMapY}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:isPending?"#9ca3af":(isEmpty?"#9ca3af":"#dc2626"),border:isPending?"2px dashed white":"2px solid white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
