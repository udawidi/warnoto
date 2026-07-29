const NAVY=[0,48,135], GREEN=[22,163,74], RED=[220,38,38], SLATE=[71,85,105];
const pageWidth = doc => doc.internal.pageSize.getWidth();
const compactTotals = (totals, limit=2) => {
  if (!totals.length) return "-";
  const visible = totals.slice(0, limit).map(({ unit, quantity }) => `${quantity.toLocaleString("id-ID")} ${unit || "satuan"}`);
  if (totals.length > limit) visible.push(`+${totals.length - limit} satuan`);
  return visible.join(" | ");
};
function header(doc, title, subtitle) { const width=pageWidth(doc); doc.setFillColor(...NAVY); doc.rect(0,0,width,10,"F"); doc.setTextColor(...NAVY); doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.text(title,14,21); doc.setFont("helvetica","normal"); doc.setTextColor(...SLATE); doc.setFontSize(8); doc.text(subtitle,14,27); }
function card(doc,x,label,value,color=NAVY) { doc.setDrawColor(203,213,225); doc.roundedRect(x,34,63,22,2,2,"S"); doc.setFontSize(7); doc.setTextColor(...SLATE); doc.text(label,x+4,41); doc.setFont("helvetica","bold"); doc.setTextColor(...color); doc.setFontSize(value.length>23?6.5:10); doc.text(value,x+4,49); doc.setFont("helvetica","normal"); }
function chart(doc, values, x, y, width, height, unit) { const shown=values.slice(-12); const max=Math.max(1,...shown.flatMap(v=>[v.masuk,v.keluar])); doc.setDrawColor(203,213,225); doc.line(x,y+height,x+width,y+height); doc.setTextColor(...SLATE); doc.setFontSize(7); doc.text(`${unit} - ${values.length>12?"12 periode terbaru":"periode terfilter"}`,x,y-3); const slot=width/Math.max(1,shown.length); shown.forEach((v,i)=>{ const bx=x+i*slot+2, bw=Math.max(2,slot/3-2); const a=v.masuk/max*(height-12), b=v.keluar/max*(height-12); doc.setFillColor(...GREEN); doc.rect(bx,y+height-a,bw,a,"F"); doc.setFillColor(...RED); doc.rect(bx+bw+1,y+height-b,bw,b,"F"); doc.setTextColor(...SLATE); doc.setFontSize(5.5); doc.text(v.period.slice(4),bx,y+height+4); }); doc.setFillColor(...GREEN);doc.rect(x+width-38,y-5,3,3,"F");doc.setTextColor(...SLATE);doc.setFontSize(6);doc.text("Masuk",x+width-33,y-2);doc.setFillColor(...RED);doc.rect(x+width-19,y-5,3,3,"F");doc.text("Keluar",x+width-14,y-2); }
function textList(doc, lines, x, y, width, maxLines=6) { doc.setTextColor(...SLATE); doc.setFontSize(8); let cursor=y; lines.slice(0,maxLines).forEach((line,index)=>{ const allWrapped=doc.splitTextToSize(`${index+1}. ${line}`,width); const wrapped=allWrapped.slice(0,2); if(allWrapped.length>2) wrapped[1]=`${wrapped[1].replace(/\.*$/,"")}...`; doc.text(wrapped,x,cursor,{lineHeightFactor:1.3}); cursor+=wrapped.length*3.8+2; }); }

// Dashboard eksekutif tetap: tepat dua halaman A4 landscape.
export function renderTUG15Pdf(doc, report) {
  const width=pageWidth(doc); const period=`${report.filter.dateFrom||"Semua"} s/d ${report.filter.dateTo||"Semua"}`;
  header(doc,"RINGKASAN PEMAKAIAN MATERIAL",`TUG-15 | Periode ${period} | Filter aktif diterapkan`);
  card(doc,14,"Baris transaksi",String(report.kpi.transactionRows)); card(doc,82,"Material bergerak",String(report.kpi.materialGroups)); card(doc,150,"Qty masuk",compactTotals(report.kpi.masuk),GREEN); card(doc,218,"Qty keluar",compactTotals(report.kpi.keluar),RED);
  const byUnit=new Map(); report.monthly.forEach(row=>{if(!byUnit.has(row.unit))byUnit.set(row.unit,[]);byUnit.get(row.unit).push(row);}); const units=[...byUnit.entries()].sort(([a],[b])=>a.localeCompare(b,"id"));
  doc.setTextColor(...NAVY);doc.setFont("helvetica","bold");doc.setFontSize(11);doc.text("Tren pemakaian / keluar",14,68); doc.setFont("helvetica","normal");
  const visibleUnits=units.slice(0,3);
  visibleUnits.forEach(([unit,values],index)=>chart(doc,values,14+(index%2)*138,78+Math.floor(index/2)*55,index===2?269:125,35,unit));
  const hiddenUnits=Math.max(0,units.length-visibleUnits.length); if(hiddenUnits){doc.setTextColor(...SLATE);doc.setFontSize(7);doc.text(`+${hiddenUnits} satuan lain diringkas di halaman 2; kuantitas tidak dijumlahkan lintas satuan.`,14,174);}
  const source=report.rawRows.reduce((out,row)=>{out[row.source==="LAMA"?"lama":"baru"]++;return out;},{baru:0,lama:0}); const strongest=report.allMaterialTotals.filter(row=>row.keluar>0).sort((a,b)=>b.keluar-a.keluar)[0];
  doc.setDrawColor(203,213,225);doc.roundedRect(14,182,269,19,2,2,"S");doc.setTextColor(...NAVY);doc.setFont("helvetica","bold");doc.setFontSize(9);doc.text("Insight utama",18,189);doc.setFont("helvetica","normal");doc.setTextColor(...SLATE);doc.setFontSize(7.5); doc.text(`Sumber: ${source.baru} Baru / ${source.lama} Lama. Material pemakaian tertinggi: ${strongest?`${strongest.deskripsi||strongest.katalog} (${strongest.keluar} ${strongest.satuan})`:"belum ada pengeluaran"}.`,18,196,{maxWidth:258});

  doc.addPage(); header(doc,"DETAIL PRIORITAS MATERIAL",`TUG-15 | ${period} | halaman 2 dari 2`);
  doc.setTextColor(...NAVY);doc.setFont("helvetica","bold");doc.setFontSize(11);doc.text("Top material pemakaian",14,43); doc.setFont("helvetica","normal");
  const top=report.allMaterialTotals.filter(row=>row.keluar>0).sort((a,b)=>b.keluar-a.keluar).slice(0,8); textList(doc,top.map(row=>`${row.deskripsi||row.katalog} - ${row.keluar} ${row.satuan} keluar; ${row.masuk} masuk`),14,51,130,8);
  const remaining=Math.max(0,report.allMaterialTotals.filter(row=>row.keluar>0).length-top.length); if(remaining){doc.setTextColor(...SLATE);doc.setFontSize(7);doc.text(`+ ${remaining} material lainnya diringkas pada workbook Excel.`,14,90);}
  doc.setTextColor(...NAVY);doc.setFont("helvetica","bold");doc.setFontSize(11);doc.text("Ringkasan satuan & gudang",151,43);doc.setFont("helvetica","normal");
  const warehouses=[...new Map(report.monitoring.map(row=>[row.location,(row.masuk||0)+(row.keluar||0)])).entries()].sort((a,b)=>b[1]-a[1]).slice(0,6); textList(doc,[`Masuk: ${compactTotals(report.kpi.masuk,4)}`,`Keluar: ${compactTotals(report.kpi.keluar,4)}`,...warehouses.map(([name])=>`Gudang: ${name}`)],151,51,125,8);
  doc.setDrawColor(203,213,225);doc.roundedRect(14,142,269,31,2,2,"S");doc.setTextColor(...NAVY);doc.setFont("helvetica","bold");doc.setFontSize(9);doc.text("Catatan",18,150);doc.setFont("helvetica","normal");doc.setTextColor(...SLATE);doc.setFontSize(7.2); const caveat=["Kuantitas disajikan per satuan dan tidak dibandingkan lintas satuan.","Stok historis, SAP, status/moving/umur, dan field finance/aset kosong bila tidak ada sumber sah.",report.hasUndatedRows?"Ada baris TANPA_PERIODE karena tanggal mutasi tidak tercatat.":"Lokasi gudang memakai nama gudang utama bila relasi lokasi tersedia."]; doc.text(caveat,18,157,{maxWidth:258,lineHeightFactor:1.35}); doc.setFontSize(7);doc.text("Dibuat otomatis oleh WARNOTO - bukan dokumen resmi bertanda tangan.",14,202);
}
