// Komponen GudangCoordConfigPanel — dipindah dari App.jsx (refactor Fase 4).

// Digabung dari 2 salinan JSX yang tadinya nyaris identik (satu untuk denah Gudang
// keseluruhan, satu untuk denah Sub Gudang) — dipakai HANYA saat Gudang tidak punya
// Sub Gudang (level Gudang) atau selalu untuk tiap Sub Gudang (level Sub Gudang, aturan
// baru 2026-07-06: dot Blok baru tidak lagi boleh dikonfigurasi di peta Gudang
// keseluruhan kalau Gudang itu punya Sub Gudang). Kedua opsi ("assign koordinat ke blok
// existing" vs "tambah blok baru") sekarang langsung kelihatan begitu panel dibuka —
// sebelumnya opsi kedua disembunyikan di balik toggle terpisah di dalam panel, terasa
// seperti "klik di dalam klik" (keluhan user).
export function GudangCoordConfigPanel({
  label, denahImage, isOpen, onToggleOpen,
  manualAddMode, setManualAddMode, pendingMapLokasi, setPendingMapLokasi,
  blocksInScope, getCoord, draftDots, onAssignCoord, onAddDraft, onFinishAdding,
  ocrNotReady, sty, C, showToast,
}) {
  if (!isOpen) {
    return (
      <button style={{...sty.btn("primary","sm")}} onClick={onToggleOpen}>
        ⚙️ Konfigurasi Koordinat Blok{label==="Sub Gudang"?" (Sub Gudang)":""}
      </button>
    );
  }
  const unassigned = blocksInScope.filter(l => l.status!=="PENDING" && !getCoord(l));
  const withCoord = blocksInScope.filter(l => getCoord(l));
  return (
    <div>
      <button style={{...sty.btn("danger","sm"),marginBottom:8}} onClick={onToggleOpen}>✕ Tutup Mode Konfigurasi</button>
      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:12}}>
        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          <button style={sty.btn(manualAddMode?"danger":"primary","sm")} onClick={()=>{setManualAddMode(m=>!m);setPendingMapLokasi(null);}}>
            {manualAddMode?"✕ Batal Mode Tambah Blok Baru":"➕ Mode Tambah Blok Baru"}
          </button>
        </div>

        {manualAddMode ? (
          <div style={{fontSize:12,color:"#1d4ed8",fontWeight:700,marginBottom:8}}>Klik titik-titik di denah untuk menambah blok baru (bisa beberapa kali). Usulan akan muncul di panel untuk dikonfirmasi & dikirim ke TL.</div>
        ) : (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:6}}>Atau, blok yang belum punya koordinat — klik untuk pilih, lalu klik titik di denah:</div>
            {unassigned.length===0
              ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Semua blok di sini sudah punya koordinat.</div>
              : <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {unassigned.map(l=>(
                    <button key={l.id} style={sty.btn(pendingMapLokasi===l.id?"danger":"ghost","sm")} onClick={()=>setPendingMapLokasi(pendingMapLokasi===l.id?null:l.id)}>
                      📍 {l.kode}{pendingMapLokasi===l.id?" (klik di peta)":""}
                    </button>
                  ))}
                </div>
            }
          </div>
        )}

        {ocrNotReady && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>⏳ OCR denah belum tersedia, jalankan ulang upload denah untuk membaca label otomatis.</div>}

        <div style={{maxWidth:380,margin:"0 auto"}}>
          <div style={{position:"relative",cursor:(manualAddMode||pendingMapLokasi)?"crosshair":"default",width:"100%"}}
            onClick={e=>{
              if (!manualAddMode && !pendingMapLokasi) { showToast("Aktifkan 'Mode Tambah Blok Baru' atau pilih blok di daftar dulu!","error"); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              const xPct = Number(((e.clientX - rect.left) / rect.width * 100).toFixed(1));
              const yPct = Number(((e.clientY - rect.top) / rect.height * 100).toFixed(1));
              if (manualAddMode) { onAddDraft(xPct, yPct); }
              else if (pendingMapLokasi) { onAssignCoord(pendingMapLokasi, xPct, yPct); setPendingMapLokasi(null); }
            }}>
            <img src={denahImage} alt="Denah" style={{width:"100%",height:"auto",borderRadius:6,border:"2px dashed #3b82f6",display:"block"}}/>
            {withCoord.map(l=>{
              const c = getCoord(l);
              return (
                <div key={l.id} title={pendingMapLokasi===l.id?`${l.kode} — klik posisi baru di denah`:`${l.kode} — klik untuk pindah koordinat`}
                  style={{position:"absolute",left:`${c.x}%`,top:`${c.y}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:pendingMapLokasi===l.id?"#22c55e":(l.status==="PENDING"?"#9ca3af":"#dc2626"),border:l.status==="PENDING"?"2px dashed white":"2px solid white",cursor:"pointer",boxShadow:pendingMapLokasi===l.id?"0 0 0 3px rgba(34,197,94,.35)":"0 1px 4px rgba(0,0,0,0.4)"}}
                  onClick={e=>{e.stopPropagation();setPendingMapLokasi(pendingMapLokasi===l.id?null:l.id);setManualAddMode(false);}}/>
              );
            })}
            {draftDots.map(s=>(
              <div key={s.id} title={`${s.kode} (draft, belum dikirim)`} style={{position:"absolute",left:`${s.xPct}%`,top:`${s.yPct}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:"#22c55e",border:"2px dashed white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
            ))}
          </div>
        </div>

        {manualAddMode && (
          <button style={{...sty.btn("success","sm"),marginTop:10}} onClick={onFinishAdding}>💾 Save Blok</button>
        )}
        <div style={{fontSize:12,color:C.muted,marginTop:6}}>💡 Klik titik yang sudah ada, lalu klik posisi baru di denah untuk memindahkan koordinatnya (titik jadi hijau saat aktif). Titik hijau putus-putus = blok baru draft (belum dikirim ke TL).</div>
      </div>
    </div>
  );
}
