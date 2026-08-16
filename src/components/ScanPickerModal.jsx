// Modal pilih material saat scan (kamera/hardware) di form TUG cocok >1 stok —
// no.katalog WARNOTO tidak unik (paket 5-tuple MARA) & 1 material bisa ada di
// banyak lokasi, jadi tidak boleh auto-pilih di transaksi (App.jsx applyTxnScan).
import { fmtNum } from "../lib/ragShared.mjs";

export function ScanPickerModal({ scanPicker, setScanPicker, chooseScanPickerMatch, sty, C, isMobile }) {
  if (!scanPicker) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:20}}>
      <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
        <div style={sty.modalHeader}>
          <span style={{fontWeight:800,fontSize:15}}>Pilih material — kode cocok &gt;1</span>
          <button onClick={()=>setScanPicker(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Kode tidak unik, pilih material &amp; lokasi yang benar.</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {scanPicker.candidates.map(s=>(
            <button key={s.id} type="button" onClick={()=>chooseScanPickerMatch(s)}
              style={{...sty.card,textAlign:"left",cursor:"pointer",padding:12,border:`1px solid ${C.border}`}}>
              <div style={{fontWeight:700,fontSize:14}}>{s.name} <span style={{color:C.muted,fontWeight:400}}>[{s.katalog}]</span></div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{s.category} • {s.unit}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>📍 {s.lokasi} • Stok: {fmtNum(s.qty)} {s.unit}</div>
            </button>
          ))}
        </div>
        <div style={sty.stickyFooter}>
          <button type="button" style={{...sty.btn("ghost"),flex:1}} onClick={()=>setScanPicker(null)}>Batal</button>
        </div>
      </div>
    </div>
  );
}
