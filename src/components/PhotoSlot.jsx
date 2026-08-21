// Slot upload foto minimalist reusable (pola diangkat dari AttbTab.renderPhotoSlot).
// Preview thumbnail + tombol berlabel (bukan input[type=file] telanjang) + tombol hapus.
import { Camera, Image, Trash } from "@phosphor-icons/react";

export function PhotoSlot({ label, value, onChange, onRemove, handleImg, sty, C, required }) {
  return (
    <div>
      <label style={sty.label}>{label}{required && <span style={{color:C.red}}> *</span>}</label>
      <div style={{height:90,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,marginBottom:6}}>
        {value ? <img src={value} alt={label} width={120} height={90} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : (<><Image size={24} weight="duotone" color="#9ca3af" aria-hidden="true" /><span style={{fontSize:11,color:C.muted}}>Belum ada foto</span></>)}
      </div>
      <div style={{display:"flex",gap:6}}>
        <label tabIndex={0} style={{...sty.btn("ghost","sm"),flex:1,textAlign:"center",cursor:"pointer",minHeight:44,touchAction:"manipulation",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); e.currentTarget.querySelector("input[type=file]")?.click(); } }}>
          <Camera size={15} weight="bold" aria-hidden="true" /> {value?"Ganti Foto":"Ambil Foto"}
          <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, onChange)}/>
        </label>
        {value && <button type="button" style={{...sty.btn("danger","sm"),minHeight:44,touchAction:"manipulation"}} aria-label={`Hapus ${label}`} onClick={onRemove}><Trash size={15} weight="bold" aria-hidden="true" /></button>}
      </div>
    </div>
  );
}
