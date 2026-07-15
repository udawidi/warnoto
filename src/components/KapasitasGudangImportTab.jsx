// Komponen KapasitasGudangImportTab (+ helper parse sheet) — dipindah dari App.jsx (refactor Fase 5d).
import { useState } from "react";
import { KAPASITAS_LABEL, UIT, UPT } from "../constants.js";
import { parseIndoNumber } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";
import * as XLSX from "xlsx";

// Convert Excel serial date → string YYYY-MM-DD
function excelSerialToDate(serial) {
  if (!serial || isNaN(serial)) return String(serial||"");
  if (typeof serial === "string" && serial.includes("-")) return serial;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split("T")[0];
}

// Parse sheet KAPASITAS GUDANG dari XLSX
function parseKapasitasGudangSheet(rows) {
  // Parse angka format Indonesia: "1.234,56" (titik ribuan, koma desimal) atau format polos "1234.56"
  function parseIdNumber(v) {
    // Delegasi ke parseIndoNumber global (standarisasi 1 aturan titik/koma di semua import,
    // 2026-07-07) — cuma beda di sini: string kosong balikin NaN (bukan 0), supaya pemanggil di
    // bawah (normPct/normNum, lat/lng) tetap bisa bedakan "kosong/tidak diisi" dari "memang 0".
    const s = String(v==null?"":v).trim();
    if (!s) return NaN;
    return parseIndoNumber(s);
  }
  // Normalisasi persen: nilai bisa 0.95 (ratio) atau 95 (persen)
  function normPct(v) {
    const n = parseIdNumber(v);
    if (isNaN(n)) return 0;
    return n > 1 ? n / 100 : n; // store as 0-1
  }
  function normNum(v) { const n = parseIdNumber(v); return isNaN(n) ? 0 : n; }

  const COL_MAP = {
    upt: ["UPT"], gudang: ["GUDANG"], subGudang: ["SUB GUDANG"],
    typeGudang: ["SUB/TYPE GUDANG","TYPE GUDANG"], alamat: ["ALAMAT"],
    latitude: ["KOORDINAT LATITUDE","LATITUDE"], longitude: ["KOORDINAT LONGITUDE","LONGITUDE"],
    luasLahan: ["LUAS LAHAN (M2)","LUAS LAHAN"], luasTerpakai: ["LUAS TERPAKAI (M2)","LUAS TERPAKAI"],
    sisaLuas: ["SISA LUAS LAHAN (M2)","SISA LUAS"], pctTerpakai: ["PERSENTASE TERPAKAI (%)","PERSENTASE TERPAKAI"],
    persediaanPct: ["PERSEDIAAN (%)","PERSEDIAAN"], cadangPct: ["CADANG (%)","CADANG"],
    preMemoryPct: ["PRE-MEMORY (%)","PRE-MEMORY"], attbPct: ["ATTB (%)","ATTB"],
    lainnyaPct: ["LAINNYA (LIMBAH NON B3, ALAT ANGKUT, DLL) (%)","LAINNYA"],
    contactPerson: ["CONTACT PERSON"], waktuUpdate: ["WAKTU UPDATE"],
    keterangan: ["KETERANGAN"], linkGudang: ["LINK GUDANG"],
  };

  function getVal(row, aliases) {
    for (const a of aliases) {
      const k = Object.keys(row).find(k => k.trim().toUpperCase() === a.toUpperCase());
      if (k !== undefined && row[k] !== undefined && row[k] !== "") return row[k];
    }
    return "";
  }

  const results = [];
  for (const row of rows) {
    const upt = String(getVal(row, COL_MAP.upt)||"").trim();
    const gudang = String(getVal(row, COL_MAP.gudang)||"").trim();
    const subGudang = String(getVal(row, COL_MAP.subGudang)||"").trim();
    // Skip baris section-divider (merged cell nama UPT sebagai pemisah section) —
    // baris data asli selalu punya UPT dan GUDANG terisi bersamaan.
    if (!upt && !gudang) continue;
    if (!upt && !gudang && !subGudang) continue; // skip empty rows

    const luasLahan = normNum(getVal(row, COL_MAP.luasLahan));
    const luasTerpakai = normNum(getVal(row, COL_MAP.luasTerpakai));
    const sisaLuas = luasLahan > 0 ? luasLahan - luasTerpakai : normNum(getVal(row, COL_MAP.sisaLuas));
    const pctTerpakai = luasLahan > 0 ? luasTerpakai / luasLahan : normPct(getVal(row, COL_MAP.pctTerpakai));

    let statusKapasitas = "AMAN";
    if (pctTerpakai >= 0.90) statusKapasitas = "KRITIS";
    else if (pctTerpakai >= 0.75) statusKapasitas = "WASPADA";

    const errors = [];
    const warnings = [];
    if (!upt || !gudang || !subGudang) errors.push("UPT/GUDANG/SUB GUDANG wajib ada");
    if (luasLahan <= 0) errors.push("Luas lahan tidak valid");
    if (luasTerpakai < 0) errors.push("Luas terpakai negatif");

    const latRaw = parseIdNumber(getVal(row, COL_MAP.latitude));
    const lngRaw = parseIdNumber(getVal(row, COL_MAP.longitude));
    const lat = isNaN(latRaw) ? null : latRaw;
    const lng = isNaN(lngRaw) ? null : lngRaw;
    if (!lat || !lng) warnings.push("Koordinat kosong");

    const waktuRaw = getVal(row, COL_MAP.waktuUpdate);
    const waktuUpdate = typeof waktuRaw === "number" ? excelSerialToDate(waktuRaw) : String(waktuRaw||"").trim();

    results.push({
      id: `CAP-${upt}-${gudang}-${subGudang}`.replace(/\s+/g,"-").toUpperCase(),
      upt: upt.toUpperCase(),
      gudang, subGudang,
      typeGudang: String(getVal(row, COL_MAP.typeGudang)||"").trim(),
      alamat: String(getVal(row, COL_MAP.alamat)||"").trim(),
      latitude: lat, longitude: lng,
      luasLahanM2: luasLahan, luasTerpakaiM2: luasTerpakai, sisaLuasM2: sisaLuas,
      persentaseTerpakai: pctTerpakai,
      persediaanPct: normPct(getVal(row, COL_MAP.persediaanPct)),
      cadangPct: normPct(getVal(row, COL_MAP.cadangPct)),
      preMemoryPct: normPct(getVal(row, COL_MAP.preMemoryPct)),
      attbPct: normPct(getVal(row, COL_MAP.attbPct)),
      lainnyaPct: normPct(getVal(row, COL_MAP.lainnyaPct)),
      statusKapasitas,
      contactPerson: String(getVal(row, COL_MAP.contactPerson)||"").trim(),
      waktuUpdate,
      keterangan: String(getVal(row, COL_MAP.keterangan)||"").trim(),
      linkGudang: String(getVal(row, COL_MAP.linkGudang)||"").trim(),
      matchedGudangId: null, matchedLokasiId: null, mappingStatus: "UNMATCHED",
      _errors: errors, _warnings: warnings, _valid: errors.length === 0,
    });
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════
// KAPASITAS GUDANG — IMPORT & REVIEW (dipasang di Master Data > Master Gudang)
// ════════════════════════════════════════════════════════════════════
export function KapasitasGudangImportTab({ gudangCapacityImports, setGudangCapacityImports, currentUser, sty, C, saveToCloud, showToast }) {
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const canEdit = hasRole(currentUser, "ADMIN","TL");

  function revalidateRecord(r) {
    const luasLahan = Number(r.luasLahanM2) || 0;
    const luasTerpakai = Number(r.luasTerpakaiM2) || 0;
    const sisaLuas = luasLahan > 0 ? luasLahan - luasTerpakai : 0;
    const pctTerpakai = luasLahan > 0 ? luasTerpakai / luasLahan : 0;
    let statusKapasitas = "AMAN";
    if (pctTerpakai >= 0.90) statusKapasitas = "KRITIS";
    else if (pctTerpakai >= 0.75) statusKapasitas = "WASPADA";
    const errors = [];
    if (!r.upt?.trim() || !r.gudang?.trim() || !r.subGudang?.trim()) errors.push("UPT/GUDANG/SUB GUDANG wajib ada");
    if (luasLahan <= 0) errors.push("Luas lahan tidak valid");
    if (luasTerpakai < 0) errors.push("Luas terpakai negatif");
    const warnings = (!r.latitude || !r.longitude) ? ["Koordinat kosong"] : [];
    return { ...r, luasLahanM2:luasLahan, luasTerpakaiM2:luasTerpakai, sisaLuasM2:sisaLuas,
      persentaseTerpakai:pctTerpakai, statusKapasitas, _errors:errors, _warnings:warnings, _valid:errors.length===0 };
  }

  function updatePreviewField(idx, field, value) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.map((r,i) => i===idx ? revalidateRecord({...r, [field]:value}) : r);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function addPreviewRow() {
    setImportPreview(prev => {
      if (!prev) return prev;
      const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
      const defaultUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
      const blank = revalidateRecord({
        upt: defaultUpt.toUpperCase(), gudang:"", subGudang:"", typeGudang:"", alamat:"",
        latitude:null, longitude:null, luasLahanM2:0, luasTerpakaiM2:0, sisaLuasM2:0,
        persentaseTerpakai:0, persediaanPct:0, cadangPct:0, preMemoryPct:0, attbPct:0, lainnyaPct:0,
        statusKapasitas:"AMAN", contactPerson:"", waktuUpdate:"", keterangan:"Ditambahkan manual", linkGudang:"",
        matchedGudangId:null, matchedLokasiId:null, mappingStatus:"UNMATCHED",
      });
      const records = [...prev.records, blank];
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function deletePreviewRow(idx) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.filter((_,i)=>i!==idx);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function deletePreviewByUpt(uptToRemove) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.filter(r=>r.upt!==uptToRemove);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function keepOnlyUpt(uptToKeep) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.filter(r=>r.upt===uptToKeep);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheetName = wb.SheetNames.find(s=>s.toUpperCase().includes("KAPASITAS GUDANG")) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:"", raw:false });
      let headerRowIdx = 0;
      for (let i=0; i<Math.min(15, rawRows.length); i++) {
        const hasUpt = rawRows[i].some(cell => String(cell||"").trim().toUpperCase()==="UPT");
        if (hasUpt) { headerRowIdx = i; break; }
      }
      const rows = XLSX.utils.sheet_to_json(ws, { defval:"", range: headerRowIdx });
      const parsed = parseKapasitasGudangSheet(rows);
      if (parsed.length === 0) {
        showToast("File terbaca tapi 0 baris data ditemukan. Cek apakah baris header (UPT, GUDANG, dst) ada di file.", "error");
      } else if (parsed.every(r=>!r._valid)) {
        showToast(`File terbaca (${parsed.length} baris) tapi semua tidak valid. Cek kolom UPT/GUDANG/SUB GUDANG/LUAS LAHAN.`, "error");
      }
      const valid = parsed.filter(r=>r._valid);
      const invalid = parsed.filter(r=>!r._valid);
      const warnings = parsed.filter(r=>r._valid && r._warnings.length>0);
      setImportPreview({ records: parsed, valid, invalid, warnings, fileName: file.name, sheetName });
    } catch(err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
    setImporting(false);
    e.target.value = "";
  }

  async function handleSubmitForApproval() {
    if (!importPreview) return;
    const toPublish = importPreview.valid.map(r => ({...r, _errors:undefined, _warnings:undefined, _valid:undefined}));
    const batchId = "CAPIMP-"+Date.now();
    const importRecord = {
      id: batchId, sourceFile: importPreview.fileName, sheetName: importPreview.sheetName,
      importedBy: currentUser.id, importedAt: Date.now(),
      totalRows: importPreview.records.length, validRows: importPreview.valid.length,
      invalidRows: importPreview.invalid.length, warningRows: importPreview.warnings.length,
      status: "PENDING_ASMAN", records: toPublish,
    };
    const newImports = [...gudangCapacityImports, importRecord];
    setGudangCapacityImports(newImports);
    await saveToCloud({ gudangCapacityImports: newImports });
    setImportPreview(null);
    showToast(`Diajukan ke Asman untuk approval (${toPublish.length} record). Lihat status di menu Approval.`, "success");
  }

  return (
    <div>
      <div style={{...sty.card,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>📥 Import Laporan Kapasitas Gudang (XLSX)</div>
        <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Upload file KAPASITAS GUDANG UIT JBM.xlsx. Sheet yang dibaca: <strong>KAPASITAS GUDANG</strong>.</p>
        {canEdit && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <label style={{...sty.btn("primary"),cursor:"pointer"}}>
              {importing?"⏳ Memproses...":"📂 Upload XLSX Kapasitas Gudang"}
              <input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
            </label>
            {!importPreview && (
              <button style={sty.btn("ghost")} onClick={()=>setImportPreview({records:[],valid:[],invalid:[],warnings:[],fileName:"(manual, tanpa file)",sheetName:"-"})}>
                ➕ Buat Manual (tanpa file)
              </button>
            )}
          </div>
        )}
      </div>

      {importPreview && (
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,marginBottom:10}}>Preview: {importPreview.fileName} (Sheet: {importPreview.sheetName})</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
            {[
              {label:"Total",val:importPreview.records.length,color:C.accent},
              {label:"Valid",val:importPreview.valid.length,color:C.green},
              {label:"Warning",val:importPreview.warnings.length,color:"#f59e0b"},
              {label:"Invalid",val:importPreview.invalid.length,color:C.red},
            ].map(s=>(
              <div key={s.label} style={{padding:"8px 14px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`,textAlign:"center"}}>
                <div style={{fontSize:12,color:C.muted}}>{s.label}</div>
                <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
              </div>
            ))}
          </div>
          {importPreview.invalid.length > 0 && (
            <div style={{color:C.red,fontWeight:700,fontSize:12,marginBottom:8}}>⚠️ Ada {importPreview.invalid.length} baris invalid — edit langsung di tabel (sel putih = bisa diedit) untuk memperbaiki, atau baris akan diabaikan saat submit.</div>
          )}
          {canEdit && (()=>{
            const uptsInPreview = [...new Set(importPreview.records.map(r=>r.upt))].filter(Boolean).sort();
            if (uptsInPreview.length <= 1) return null;
            return (
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:10,padding:"8px 10px",background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8}}>
                <span style={{fontSize:12,color:C.muted,fontWeight:700}}>File berisi {uptsInPreview.length} UPT — hapus cepat:</span>
                {uptsInPreview.map(u=>(
                  <span key={u} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                    <button style={{...sty.btn("ghost","sm"),padding:"3px 8px",fontSize:12}} onClick={()=>keepOnlyUpt(u)} title={`Hanya simpan ${u}, hapus sisanya`}>Hanya {u}</button>
                    <button style={{...sty.btn("danger","sm"),padding:"3px 8px",fontSize:12}} onClick={()=>deletePreviewByUpt(u)} title={`Hapus semua baris ${u}`}>🗑️ {u}</button>
                  </span>
                ))}
              </div>
            );
          })()}
          <div style={{overflowX:"auto",maxHeight:440,overflowY:"auto",marginBottom:14}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1050}}>
              <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                <tr>
                  {["UPT","Gudang","Sub Gudang","Luas Lahan (m²)","Terpakai (m²)","Utilization","Status","Warning","Aksi"].map(h=>(
                    <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importPreview.records.map((r,i)=>{
                  const cellStyle = {padding:"3px 6px",border:`1px solid ${C.border}`,borderRadius:5,fontSize:12,width:"100%",background:"white"};
                  return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:!r._valid?"#fef2f2":r._warnings.length>0?"#fefce8":"white"}}>
                    <td style={{padding:"4px 6px"}}><input style={cellStyle} value={r.upt} onChange={e=>updatePreviewField(i,"upt",e.target.value.toUpperCase())} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={cellStyle} value={r.gudang} onChange={e=>updatePreviewField(i,"gudang",e.target.value)} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={{...cellStyle,fontWeight:600,minWidth:160}} value={r.subGudang} onChange={e=>updatePreviewField(i,"subGudang",e.target.value)} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={{...cellStyle,textAlign:"right",width:80}} type="number" value={r.luasLahanM2} onChange={e=>updatePreviewField(i,"luasLahanM2",parseFloat(e.target.value)||0)} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={{...cellStyle,textAlign:"right",width:80}} type="number" value={r.luasTerpakaiM2} onChange={e=>updatePreviewField(i,"luasTerpakaiM2",parseFloat(e.target.value)||0)} disabled={!canEdit}/></td>
                    <td style={{padding:"5px 8px",fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{(r.persentaseTerpakai*100).toFixed(1)}%</td>
                    <td style={{padding:"5px 8px"}}><span style={{fontSize:12,fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</span></td>
                    <td style={{padding:"5px 8px",fontSize:12,color:C.muted,maxWidth:200}}>{[...r._errors,...r._warnings].join(", ")||"-"}</td>
                    <td style={{padding:"4px 6px"}}>{canEdit && <button style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>deletePreviewRow(i)} title="Hapus baris ini">🗑️</button>}</td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button style={sty.btn("ghost")} onClick={addPreviewRow}>➕ Tambah Gudang</button>
              <button style={sty.btn("primary")} disabled={importPreview.valid.length===0} onClick={handleSubmitForApproval}>
                📤 Kirim ke Asman untuk Approval ({importPreview.valid.length} record valid)
              </button>
            </div>
          )}
          {importPreview.invalid.length > 0 && (
            <div style={{color:C.red,fontSize:12,marginTop:6}}>Baris invalid ({importPreview.invalid.length}) akan diabaikan otomatis — perbaiki dulu di tabel jika ingin ikut disertakan.</div>
          )}
        </div>
      )}

      {gudangCapacityImports.length > 0 && (
        <div style={{...sty.card,marginTop:16}}>
          <div style={{fontWeight:700,marginBottom:8}}>Riwayat Import</div>
          {[...gudangCapacityImports].reverse().map(imp=>{
            const statusMeta = {
              PENDING_ASMAN:{label:"⏳ Menunggu Asman",bg:"#fefce8",fg:"#92400e"},
              APPROVED:{label:"✅ Disetujui",bg:"#f0fdf4",fg:C.green},
              REJECTED:{label:"❌ Ditolak",bg:"#fef2f2",fg:C.red},
            }[imp.status] || {label:"— (legacy, langsung publish)",bg:"#f9fafb",fg:C.muted};
            return (
            <div key={imp.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontWeight:700}}>{imp.sourceFile}</div>
                <span style={{padding:"2px 8px",borderRadius:10,fontSize:12,fontWeight:700,background:statusMeta.bg,color:statusMeta.fg}}>{statusMeta.label}</span>
              </div>
              <div style={{color:C.muted,fontSize:12}}>{new Date(imp.importedAt).toLocaleString("id")} — {imp.validRows} valid / {imp.invalidRows} invalid</div>
              {imp.status==="REJECTED" && imp.rejectReason && <div style={{color:C.red,fontSize:12,marginTop:2}}>Alasan: {imp.rejectReason}</div>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
