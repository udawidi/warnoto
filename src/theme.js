// Design tokens WARNOTO — palet warna C (statik) + factory makeSty(isMobile).
// Dipindah dari PLNWarehouse (App.jsx) supaya ScanPublicView (fungsi module-level
// utk halaman scan publik ?scan=) bisa memakai C — sebelumnya C scoped di dalam
// PLNWarehouse sehingga ScanPublicView ReferenceError saat render (bug laten).
// sty jadi factory karena bergantung isMobile (state, bukan statik).

export const C = { bg:"#f4f6fb", surface:"#ffffff", sidebar:"#0b2559", accent:"#1d4ed8", yellow:"#f59e0b", green:"#16a34a", red:"#dc2626", text:"#0f172a", muted:"#64748b", border:"#e6eaf1" };

export function makeSty(isMobile) {
  return {
    btn:(v="primary",sz="md")=>({ padding:isMobile?(sz==="sm"?"10px 14px":"12px 18px"):(sz==="sm"?"5px 10px":"9px 18px"), minHeight:isMobile?44:undefined, borderRadius:10, border:"none", cursor:"pointer", fontWeight:600, fontSize:isMobile?(sz==="sm"?13:14):(sz==="sm"?11:13), background: v==="primary"?C.accent:v==="danger"?C.red:v==="success"?C.green:v==="warn"?C.yellow:"#f3f4f6", color:v==="ghost"?C.text:"white", boxShadow:(v==="primary"||v==="danger"||v==="success"||v==="warn")?"0 1px 2px rgba(15,23,42,0.16), 0 1px 3px rgba(15,23,42,0.10)":"inset 0 0 0 1px rgba(15,23,42,0.07)" }),
    card:{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, padding:20, boxShadow:"0 1px 2px rgba(16,24,40,0.04), 0 8px 20px -8px rgba(16,24,40,0.10)" },
    // Tombol Batal/Simpan "menempel" di bawah kartu modal (position:sticky)
    // supaya di form panjang (banyak baris material) user tidak perlu scroll
    // balik ke bawah cuma untuk menemukan tombol submit. bottom/marginBottom
    // negatif menutupi padding bawah sty.card (20px) supaya menempel pas di
    // tepi, bukan menggantung dengan jarak kosong di bawahnya.
    stickyFooter:{ display:"flex", gap:10, position:"sticky", bottom:-20, background:C.surface, padding:"14px 0 0", marginTop:14, marginBottom:-20, borderTop:`1px solid ${C.border}` },
    // Pakai padding longhand (bukan shorthand "Npx Mpx") supaya tempat yang
    // perlu override paddingRight sendiri (mis. input cari + tombol clear)
    // tidak bentrok shorthand-vs-longhand di style yang sama (React warning
    // "Updating padding paddingRight").
    input:{ background:"#f9fafb", border:`1px solid ${C.border}`, borderRadius:10, color:C.text, paddingTop:isMobile?12:8, paddingBottom:isMobile?12:8, paddingLeft:isMobile?14:12, paddingRight:isMobile?14:12, minHeight:isMobile?44:undefined, fontSize:isMobile?16:13, outline:"none", width:"100%" },
    select:{ background:"#f9fafb", border:`1px solid ${C.border}`, borderRadius:10, color:C.text, paddingTop:isMobile?12:8, paddingBottom:isMobile?12:8, paddingLeft:isMobile?14:12, paddingRight:isMobile?14:12, minHeight:isMobile?44:undefined, fontSize:isMobile?16:13, outline:"none", width:"100%" },
    label:{ fontSize:11, color:C.muted, display:"block", marginBottom:4, fontWeight:600, textTransform:"uppercase", letterSpacing:".5px" },
    statusBadge:(s)=>({ padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:700, background:s==="APPROVED"?"#dcfce7":s==="PENDING"?"#fef3c7":s==="REJECTED"?"#fee2e2":"#f3f4f6", color:s==="APPROVED"?C.green:s==="PENDING"?C.yellow:s==="REJECTED"?C.red:C.muted }),
    jenisBadge:(j)=>({ padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:700,
      background: j==="Pre Memory"?"#dbeafe":j==="Cadang"?"#f3e8ff":j==="Persediaan"?"#dcfce7":j==="Persediaan Bursa"?"#fff7ed":j==="ATTB"?"#fef3c7":j==="Non-Stock"?"#fce7f3":"#f3f4f6",
      color: j==="Pre Memory"?"#1d4ed8":j==="Cadang"?"#7c3aed":j==="Persediaan"?C.green:j==="Persediaan Bursa"?"#ea580c":j==="ATTB"?C.yellow:j==="Non-Stock"?"#be185d":C.muted }),
  };
}
