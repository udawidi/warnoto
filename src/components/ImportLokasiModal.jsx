// Import massal Master Lokasi (Blok) dari Excel — alur review-first: upload →
// preview per baris (OK/error) → centang baris OK → Terapkan. Blok baru dari
// import ini TIDAK punya koordinat denah (beda dari alur "Kelola Denah &
// Koordinat" klik-titik) — Admin bisa plot koordinatnya manual belakangan.
import { useState } from "react";
import { uid } from "../lib/utils.js";
import { logAudit } from "../lib/audit.js";
import * as XLSX from "xlsx";
import { readWorkbookSafe, sanitizeRows } from "../lib/xlsxImport.js";

const TEMPLATE_HEADERS = ["Gudang", "Sub Gudang", "Kode Blok", "Keterangan"];

export function downloadLokasiTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ["Gudang Ketintang", "Terbuka", "A-01", "Contoh: rak material trafo"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template Lokasi");
  XLSX.writeFile(wb, "Template_Import_Lokasi.xlsx");
}

export function ImportLokasiModal({ onClose, lokasiList, gudangList, subGudangList, isKodeDuplicateInSubGudang, setLokasiList, syncLokasi, currentUser, showToast, sty, C }) {
  const [rows, setRows] = useState(null); // null = belum upload; array = hasil parse
  const [checked, setChecked] = useState(new Set());
  const [busy, setBusy] = useState(false);

  function findGudang(nama) {
    const n = nama.trim().toLowerCase();
    return gudangList.find(g => (g.nama||"").trim().toLowerCase() === n);
  }
  function findSubGudang(gudangId, nama) {
    const n = nama.trim().toLowerCase();
    return subGudangList.find(sg => sg.gudangId===gudangId && (sg.nama||"").trim().toLowerCase() === n);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const wb = await readWorkbookSafe(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = sanitizeRows(XLSX.utils.sheet_to_json(ws, { defval: "" }));
      if (raw.length === 0) { showToast("File kosong atau tidak ada baris data.", "error"); return; }
      const hasCols = TEMPLATE_HEADERS.slice(0,1).concat(["Kode Blok"]).every(h => Object.prototype.hasOwnProperty.call(raw[0], h));
      if (!hasCols) { showToast('Kolom wajib "Gudang" / "Kode Blok" tidak ditemukan. Gunakan template.', "error"); return; }

      const seenInFile = new Set(); // cegah duplikat dalam file yang sama
      const parsed = raw.map(r => {
        const gudangNama = String(r["Gudang"]||"").trim();
        const subGudangNama = String(r["Sub Gudang"]||"").trim();
        const kode = String(r["Kode Blok"]||"").trim();
        const keterangan = String(r["Keterangan"]||"").trim();
        let error = null;
        const gudang = gudangNama ? findGudang(gudangNama) : null;
        const subGudang = (gudang && subGudangNama) ? findSubGudang(gudang.id, subGudangNama) : null;
        if (!kode) error = "Kode Blok kosong";
        else if (!gudangNama || !gudang) error = "Gudang tidak dikenal";
        else if (subGudangNama && !subGudang) error = "Sub Gudang tidak dikenal";
        else if (isKodeDuplicateInSubGudang(kode, gudang.id, subGudang?.id||null, null)) error = "Duplikat kode di sub gudang yang sama (sudah ada)";
        else {
          const key = `${gudang.id}|${subGudang?.id||""}|${kode.toLowerCase()}`;
          if (seenInFile.has(key)) error = "Duplikat kode di sub gudang yang sama (dalam file ini)";
          seenInFile.add(key);
        }
        return { gudangNama, subGudangNama, kode, keterangan, gudang, subGudang, error };
      });
      setRows(parsed);
      setChecked(new Set(parsed.map((r,i)=>i).filter(i=>!parsed[i].error)));
    } catch (err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
  }

  function toggleRow(i) {
    setChecked(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  async function applyImport() {
    const toApply = (rows||[]).filter((r,i) => checked.has(i) && !r.error);
    if (toApply.length === 0) { showToast("Tidak ada baris valid yang dicentang.", "error"); return; }
    setBusy(true);
    const now = Date.now();
    const entriesBaru = toApply.map(r => ({
      id: uid(), kode: r.kode, keterangan: r.keterangan||"",
      gudangId: r.gudang.id, subGudangId: r.subGudang?.id||null,
      status: "APPROVED", pendingAction: null,
      requestedBy: currentUser.id, requestedAt: now, createdAt: now,
    }));
    const merged = [...lokasiList, ...entriesBaru];
    setLokasiList(merged);
    await syncLokasi(merged);
    logAudit(currentUser, "IMPORT", "lokasi", null, { rows: entriesBaru.length });
    showToast(`✅ ${entriesBaru.length} Blok Lokasi berhasil diimpor.`);
    setBusy(false);
    onClose();
  }

  const okCount = (rows||[]).filter(r=>!r.error).length;
  const errCount = (rows||[]).length - okCount;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
      <div style={{...sty.card,width:720,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <h3 style={{fontSize:17,fontWeight:800,margin:0}}>Import Master Lokasi (Excel)</h3>
          <button style={sty.btn("ghost","sm")} onClick={onClose}>✕ Tutup</button>
        </div>
        <p tabIndex={0} className="info-note" style={{fontSize:12,color:C.muted,marginBottom:14}}>Upload file Excel dengan kolom Gudang, Sub Gudang (opsional), Kode Blok, Keterangan. Baris bermasalah tidak bisa dicentang — perbaiki di file lalu upload ulang.</p>

        {!rows ? (
          <label style={{...sty.btn("primary"),cursor:"pointer",display:"inline-flex"}}>
            📂 Pilih File Excel
            <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleFile}/>
          </label>
        ) : (
          <>
            <div style={{display:"flex",gap:14,fontSize:12,marginBottom:10}}>
              <span>Total: <b>{rows.length}</b></span>
              <span style={{color:C.green}}>OK: <b>{okCount}</b></span>
              <span style={{color:C.red}}>Error: <b>{errCount}</b></span>
              <span>Dicentang: <b>{checked.size}</b></span>
            </div>
            <div className="mobile-card-table" style={{overflowX:"auto",maxHeight:340,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius: 10,marginBottom:14}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
                  <tr>{["","Gudang","Sub Gudang","Kode Blok","Keterangan","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left"}}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r,i)=>(
                    <tr tabIndex={0} className="mobile-card-table__row" key={i} style={{borderTop:`1px solid ${C.border}`,background:r.error?"#fef2f2":undefined}}>
                      <td data-label="" style={{padding:"4px 8px"}}><input type="checkbox" checked={checked.has(i)} disabled={!!r.error} onChange={()=>toggleRow(i)}/></td>
                      <td data-label="Gudang" style={{padding:"4px 8px"}}>{r.gudangNama||"-"}</td>
                      <td data-label="Sub Gudang" style={{padding:"4px 8px"}}>{r.subGudangNama||"-"}</td>
                      <td data-label="Kode Blok" className="mobile-card-table__title" style={{padding:"4px 8px",fontWeight:700}}>{r.kode||"-"}</td>
                      <td data-label="Keterangan" style={{padding:"4px 8px",color:C.muted}}>{r.keterangan||"-"}</td>
                      <td data-label="Status" style={{padding:"4px 8px",fontWeight:700,color:r.error?C.red:C.green}}>{r.error||"OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setRows(null);setChecked(new Set());}}>Upload Ulang</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={busy||checked.size===0} onClick={applyImport}>{busy?"Menyimpan...":`Terapkan (${checked.size} baris)`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
