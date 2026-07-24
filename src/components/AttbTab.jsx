// Komponen AttbTab — dipindah dari App.jsx (refactor Fase 5b).
import { useState, useEffect, Fragment } from "react";
import { UIT, UPT } from "../constants.js";
import { hasRole } from "../lib/roles.js";
import { getLokasiPetaInfo, subGudangKodeMap } from "../lib/masterSync.js";
import { ATTB_CORE_FIELDS, ATTB_FIELDS_BY_JENIS, ATTB_JENIS_ASET, ATTB_JENIS_ASET_LABEL, ATTB_STAGE2_FIELDS, ATTB_STAGE3_FIELDS, ATTB_STAGE4_FIELDS, ATTB_STAGE5_FIELDS, ATTB_STAGES, attbStageIndex, attbStageLabel, canApproveAttb, isPendingAttbApproval, parseAttbMaterialFile2, parseAttbMaterialFile4 } from "../lib/attb.js";
import * as XLSX from "xlsx";
import { OperationsHero } from "./OperationsHero.jsx";

// AttbTab — pipeline monitoring penghapusan aset material ATTB, lihat docs/ATTB_SPEC.md.
// Pola konsisten HeavyEquipmentTabV2: chip filter + kartu, scoping UPT via effectiveUptFilter.
export function AttbTab({ attbList, currentUser, users, sty, C, createItem, saveEdit, submitToKI, approveToKI, rejectToKI, advanceStage, markBelumLanjut, bulkImport, showToast, gudangList=[], subGudangList=[], lokasiList=[], setPetaMiniDetail, deleteItem, askConfirmDelete, bongkaranPool=[], handleImg }) {
  const canDelete = hasRole(currentUser, "ADMIN");
  // Key TUG-10 yang sudah "diusulkan" jadi item ATTB (untuk tandai pool yg sudah dipakai).
  const promotedKeys = new Set(attbList.map(a=>a.sourceTug10Key).filter(Boolean));
  const bongkaranBelum = bongkaranPool.filter(p=>!promotedKeys.has(p.key));
  // Batalkan tanda "Belum Lanjut" (lanjutkan lagi, tetap di tahap yang sama).
  async function resumeBelumLanjut(item) { await saveEdit(item.id, { lanjutBelumLanjut:false, keteranganTidakLanjut:"" }); }
  // Usulkan 1 material bongkaran (dari pool TUG-10) menjadi kandidat ATTB Tahap 1 (AE.1).
  async function promoteBongkaran(p) {
    await createItem({
      jenisAset:"MATERIAL",
      description: p.nama,
      nomorAT: p.noAsset || "",
      noEquipment: p.noSeri || "",
      kuantitas: p.qty!=null ? String(p.qty) : "",
      satuan: p.satuan || "",
      keterangan: `Eks Bongkaran ATTB (MTU) dari ${p.tug10No}${p.namaPekerjaan?` — ${p.namaPekerjaan}`:""}`,
      sourceTug10Key: p.key,
      // Preserve both TUG-10 photos on the promoted ATTB record.  `foto` is
      // retained as a backwards-compatible thumbnail for older records.
      fotoKeseluruhan: p.fotoKeseluruhan || p.foto || null,
      fotoNameplate: p.fotoNameplate || null,
      foto: p.fotoKeseluruhan || p.foto || p.fotoNameplate || null,
    });
  }
  const [attbGudangFilter, setAttbGudangFilter] = useState({}); // per-item id -> gudangId (utk filter dropdown Sub Gudang & Blok)
  const [attbSubGudangFilter, setAttbSubGudangFilter] = useState({}); // per-item id -> subGudangId (utk filter dropdown Blok)
  const subGudangCodes = subGudangKodeMap(subGudangList);
  // Resolve lokasi master-data yang tersimpan di item -> objek {lok, gdg, sg, petaInfo, teks}
  // untuk tampilan + tombol peta. Pola sama Data Stok, tapi ATTB juga simpan gudangId/subGudangId
  // sendiri (independen dari lokasiId/Blok) — ditemukan 2026-07-10: beberapa Sub Gudang (mis.
  // BUDURAN) belum punya Blok terdaftar sama sekali di Master Data, jadi kalau lokasi cuma
  // disimpan lewat lokasiId (harus sampai pilih Blok), pilihan Gudang/Sub Gudang untuk area
  // begitu tidak pernah bisa tersimpan — kelihatan "hilang" tiap kali halaman di-render ulang.
  const resolveLokasiMaster = (item) => {
    const lok = lokasiList.find(l=>l.id===item.lokasiId);
    if (lok) {
      const gdg = lok.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
      const sg = lok.subGudangId ? subGudangList.find(s=>s.id===lok.subGudangId) : null;
      const petaInfo = getLokasiPetaInfo(lok, gdg, subGudangList);
      const teks = [gdg?.nama, sg?.nama, lok.kode].filter(Boolean).join(" / ");
      return { lok, gdg, sg, petaInfo, teks };
    }
    if (item.gudangId) {
      const gdg = gudangList.find(g=>g.id===item.gudangId) || null;
      const sg = item.subGudangId ? subGudangList.find(s=>s.id===item.subGudangId) : null;
      const teks = [gdg?.nama, sg?.nama].filter(Boolean).join(" / ");
      return { lok:null, gdg, sg, petaInfo:null, teks };
    }
    return null;
  };
  async function setAttbLokasi(item, newLokasiId) {
    await saveEdit(item.id, { lokasiId: newLokasiId || null });
  }
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = hasRole(currentUser, "MSB","Manager UIT");
  const [myUptSelected, setMyUptSelected] = useState(isMSB ? "" : (myUpt || ""));
  const effectiveUptFilter = isMSB ? myUptSelected : (myUpt || "");
  const canManage = hasRole(currentUser, "ADMIN","TL");

  const [stageFilter, setStageFilter] = useState("USULAN_AE1"); // default buka langsung ke Tahap 1 (Usulan AE.1 ke Unit Induk)
  const [belumLanjutOnly, setBelumLanjutOnly] = useState(false);
  const [attbSearch, setAttbSearch] = useState("");
  const [jenisFilter, setJenisFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [waktuFilter, setWaktuFilter] = useState("ALL");
  const [attbPageSize, setAttbPageSize] = useState(20);
  const [attbPage, setAttbPage] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const emptyAddForm = { jenisAset:"MATERIAL", description:"", nomorAT:"", nomorATTB:"", assetClass:"", assetType:"", nilaiPerolehan:"", nilaiBuku:"", alasanPenghapusbukuan:"", keterangan:"" };
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [previewId, setPreviewId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [belumLanjutId, setBelumLanjutId] = useState(null);
  const [belumLanjutNote, setBelumLanjutNote] = useState("");

  // Import Excel (jenis MATERIAL) — lihat docs/ATTB_SPEC.md bagian 7a/7b.
  // UPT tidak dipilih manual — otomatis ikut UPT login admin (effectiveUptFilter/myUpt).
  const importUpt = effectiveUptFilter || myUpt || "";
  // Format baku Waktu Usulan Penghapusan: "Semester {1/2} - {tahun}". Tahun default =
  // tahun berjalan; sediakan juga tahun sebelumnya untuk data historis (mis. file 4).
  const currentYear = new Date().getFullYear();
  const attbTahunOptions = [currentYear, currentYear-1];
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importTarget, setImportTarget] = useState("TAHAP1");
  const [importSemester, setImportSemester] = useState("2"); // "1" / "2"
  const [importTahun, setImportTahun] = useState(currentYear);
  const importWaktu = `Semester ${importSemester} - ${importTahun}`;
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importIncludeHidden, setImportIncludeHidden] = useState(false); // default: baris hidden di Excel DILEWATI
  const [importOverwrite, setImportOverwrite] = useState(false); // "tiban": timpa data eksisting dgn Waktu Usulan sama
  const [importRaw, setImportRaw] = useState(null); // {rawRows, rowsMeta, sheetName, fileName} dari file terupload

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      // File 4 bisa ~200MB (banyak sheet dokumentasi foto) — parse metadata dulu
      // (bookSheets: cepat, cuma daftar nama sheet), cari sheet target, baru parse
      // HANYA sheet itu (opsi `sheets`). Tanpa ini browser bisa freeze/crash karena
      // memparse semua sheet gambar. cellStyles:true supaya `!rows` terisi -> tahu
      // baris mana yang di-hide/di-filter di Excel (dipakai untuk opsi sertakan/lewati).
      const wbMeta = XLSX.read(buf, { type:"array", bookSheets:true });
      const sheetName = wbMeta.SheetNames.find(s=>s.toUpperCase().includes("AE.3.1F")) || wbMeta.SheetNames.find(s=>s.toUpperCase().includes("AT OP")) || wbMeta.SheetNames[0];
      const wb = XLSX.read(buf, { type:"array", cellDates:true, cellStyles:true, sheets:[sheetName] });
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:"" });
      const rowsMeta = ws["!rows"] || [];
      setImportRaw({ rawRows, rowsMeta, sheetName, fileName: file.name });
    } catch(err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
    setImporting(false);
    e.target.value = "";
  }

  // Bangun ulang preview tiap raw data / opsi hidden / tiban / target / UPT / waktu berubah,
  // supaya semua toggle langsung mengubah hitungan tanpa upload ulang.
  useEffect(() => {
    if (!importRaw) { setImportPreview(null); return; }
    const { rawRows, rowsMeta, sheetName, fileName } = importRaw;
    const hiddenCount = rawRows.filter((_,i)=>rowsMeta[i] && rowsMeta[i].hidden===true).length;
    const rows = importIncludeHidden ? rawRows : rawRows.filter((_,i)=>!(rowsMeta[i] && rowsMeta[i].hidden===true));
    const opts = { upt: importUpt.trim(), waktuUsulanPenghapusan: importWaktu.trim() };
    const parsed = importTarget==="TAHAP1" ? parseAttbMaterialFile2(rows, opts) : parseAttbMaterialFile4(rows, opts);
    // Mode "tiban": item eksisting dgn Waktu Usulan (+UPT) sama akan ditimpa, jadi
    // TIDAK dihitung sebagai duplikat (nomornya akan dibuat ulang dari file).
    const matchWaktu = a => a.waktuUsulanPenghapusan===importWaktu && (a.upt||"")===(importUpt||"");
    const overwriteCount = importOverwrite ? attbList.filter(matchWaktu).length : 0;
    const keptNomorAT = new Set(attbList.filter(a => importOverwrite ? !matchWaktu(a) : true).map(a=>a.nomorAT).filter(Boolean));
    const withDup = parsed.map(r => ({ ...r, _duplicate: keptNomorAT.has(r.nomorAT) }));
    setImportPreview({ records: withDup, fileName, sheetName, newCount: withDup.filter(r=>!r._duplicate).length, dupCount: withDup.filter(r=>r._duplicate).length, hiddenCount, overwriteCount });
  }, [importRaw, importIncludeHidden, importOverwrite, importTarget, importUpt, importWaktu, attbList]);

  async function confirmImport() {
    if (!importPreview) return;
    // buang flag _duplicate sebelum simpan (cuma penanda UI)
    const records = importPreview.records.map(({_duplicate, ...r})=>r);
    const runImport = async () => {
      await bulkImport(records, importTarget, { overwrite: importOverwrite, waktu: importWaktu, upt: importUpt });
      setImportRaw(null);
      setImportPreview(null);
      setShowImportPanel(false);
    };
    // Mode tiban yang benar-benar menghapus data lama = destruktif -> konfirmasi dulu.
    if (importOverwrite && importPreview.overwriteCount>0 && askConfirmDelete) {
      askConfirmDelete({
        title:"Tiban (Timpa) Data Eksisting?",
        message:`${importPreview.overwriteCount} item lama dengan Waktu Usulan "${importWaktu}" (UPT ${importUpt}) akan DIHAPUS, lalu diganti ${importPreview.newCount} item dari file ini.`,
        warning:"Data lama yang ditimpa tidak bisa dikembalikan. Pastikan file sudah benar.",
        confirmLabel:"♻️ Ya, Tiban & Import",
        onConfirm: runImport,
      });
    } else {
      await runImport();
    }
  }

  const uptOptions = Array.from(new Set(attbList.map(a=>a.upt).filter(Boolean))).sort();
  const scopedList = attbList.filter(a => !effectiveUptFilter || a.upt===effectiveUptFilter);
  const stageCounts = ATTB_STAGES.reduce((acc,s)=>{ acc[s.code]=scopedList.filter(a=>a.stage===s.code).length; return acc; }, {});
  const belumLanjutCount = scopedList.filter(a=>a.lanjutBelumLanjut).length;
  const pendingApprovalCount = scopedList.filter(isPendingAttbApproval).length;
  // Opsi dropdown filter diturunkan dari data yang ada (bukan hardcode) supaya
  // hanya menampilkan nilai yang benar-benar dipakai.
  const jenisOptions = Array.from(new Set(scopedList.map(a=>a.jenisAset).filter(Boolean)));
  const statusOptions = Array.from(new Set(scopedList.map(a=>a.approvalStatus||"DRAFT").filter(Boolean)));
  const waktuOptions = Array.from(new Set(scopedList.map(a=>a.waktuUsulanPenghapusan).filter(Boolean))).sort();
  const q = attbSearch.trim().toLowerCase();
  const filteredList = scopedList
    .filter(a => stageFilter==="ALL" || a.stage===stageFilter)
    .filter(a => !belumLanjutOnly || a.lanjutBelumLanjut)
    .filter(a => jenisFilter==="ALL" || a.jenisAset===jenisFilter)
    .filter(a => statusFilter==="ALL" || (a.approvalStatus||"DRAFT")===statusFilter)
    .filter(a => waktuFilter==="ALL" || a.waktuUsulanPenghapusan===waktuFilter)
    .filter(a => !q || [a.nomorAT, a.nomorATTB, a.description, a.merkType, a.spesifikasi, a.bay, a.lokasi, a.noEquipment, a.keterangan].some(v => String(v||"").toLowerCase().includes(q)))
    // Tiebreaker pakai id (2026-07-10): data hasil import batch punya createdAt IDENTIK untuk
    // puluhan/ratusan baris sekaligus (cuma 2 nilai unik utk 151 item ATTB) - kalau createdAt
    // seri, urutannya jatuh ke urutan mentah hasil fetch Supabase, yang bisa berubah tiap baris
    // itu di-upsert (kena reorder di storage). Efeknya baris "melompat" posisi begitu lokasi
    // diisi. Tiebreaker stabil (id) bikin urutan selalu deterministik, tidak terpengaruh upsert.
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0) || String(a.id).localeCompare(String(b.id)));
  const attbTotalPages = Math.max(1, Math.ceil(filteredList.length / attbPageSize));
  const attbPageClamped = Math.min(attbPage, attbTotalPages);
  const pagedList = filteredList.slice((attbPageClamped-1)*attbPageSize, attbPageClamped*attbPageSize);
  // Reset ke halaman 1 saat filter/scope berubah supaya tidak nyangkut di halaman kosong.
  useEffect(()=>{ setAttbPage(1); }, [stageFilter, belumLanjutOnly, effectiveUptFilter, attbPageSize, attbSearch, jenisFilter, statusFilter, waktuFilter]);

  function renderField(field, form, setForm) {
    return (
      <div key={field.key} style={{marginBottom:8}}>
        <label style={sty.label}>{field.label}</label>
        {field.type==="select" ? (
          <select style={sty.select} value={form[field.key] ?? ""} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value}))}>
            <option value="">-- Pilih --</option>
            {field.options.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input style={sty.input} type={field.type==="number"?"number":field.type==="date"?"date":"text"}
            value={form[field.key] ?? ""} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value}))}/>
        )}
      </div>
    );
  }

  const previewItem = previewId ? attbList.find(a=>a.id===previewId) : null;
  // Older promoted records only persisted `foto`.  Rehydrate missing photo
  // fields from the live TUG-10 pool when the source key is still available.
  const previewSource = previewItem?.sourceTug10Key
    ? bongkaranPool.find(p=>p.key===previewItem.sourceTug10Key)
    : null;
  const previewPhotos = previewItem ? {
    keseluruhan: previewItem.fotoKeseluruhan || previewSource?.fotoKeseluruhan || previewItem.foto || null,
    nameplate: previewItem.fotoNameplate || previewSource?.fotoNameplate || null,
  } : { keseluruhan:null, nameplate:null };
  const formatPreviewValue = (field, value) => {
    if (value == null || value === "") return "";
    if (["nilaiPerolehan","nilaiBuku","nilaiTaksiranKJPP","estimasiRpPerKg","estimasiNilaiTaksiran"].includes(field.key)) {
      const n = Number(value); return Number.isFinite(n) ? `Rp ${n.toLocaleString("id-ID")}` : String(value);
    }
    if (/^https?:\/\//i.test(String(value).trim())) return <a href={String(value).trim()} target="_blank" rel="noreferrer">{String(value).trim()}</a>;
    return String(value);
  };
  const previewFieldGroups = (item) => {
    const groups = [{ title:"Data Inti", fields:ATTB_CORE_FIELDS }, { title:ATTB_JENIS_ASET_LABEL[item.jenisAset]||item.jenisAset, fields:ATTB_FIELDS_BY_JENIS[item.jenisAset]||[] }];
    const stageFields = [ATTB_STAGE2_FIELDS, ATTB_STAGE3_FIELDS, ATTB_STAGE4_FIELDS, ATTB_STAGE5_FIELDS];
    for (let i=0; i<=attbStageIndex(item.stage)-1; i++) groups.push({ title:`Tahap ${i+2}`, fields:stageFields[i] });
    return groups.map(g=>({...g, fields:g.fields.filter(f=>item[f.key]!==undefined&&item[f.key]!==null&&item[f.key]!=="")})).filter(g=>g.fields.length);
  };

  async function submitAdd() {
    await createItem(addForm);
    setAddForm(emptyAddForm);
    setShowAddForm(false);
  }

  const stageColor = stage => [C.accent,"#7c3aed","#0891b2","#ea580c",C.green][attbStageIndex(stage)] || C.muted;

  return (
    <div className="operations-page attb-page">
      <OperationsHero
        eyebrow="Asset Disposal Governance"
        title="ATTB — Penghapusan Aset"
        description="Kelola pipeline penghapusan aset secara tertib, transparan, dan terukur hingga proses lelang."
        scope={isMSB ? (myUptSelected||"Semua UPT") : `UPT ${myUpt||"Surabaya"}`}
        metrics={[
          {label:"Total item",value:scopedList.length},
          {label:"Pending approval",value:pendingApprovalCount,alert:pendingApprovalCount>0},
          {label:"Belum lanjut",value:belumLanjutCount,alert:belumLanjutCount>0},
          {label:"Sumber bongkaran",value:bongkaranBelum.length},
        ]}
        controls={isMSB ? (
          <div>
            <label>Filter UPT</label>
            <select value={myUptSelected} onChange={e=>setMyUptSelected(e.target.value)}>
              <option value="">Semua UPT</option>
              {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        ) : null}
      />

      {/* Pipeline ATTB: source + five stages + KI. Klik kartu untuk memfilter tabel. */}
      <div className="operations-section-heading"><div><span>Process Pipeline</span><h2>Tahapan Penghapusan</h2></div><small>Klik tahap untuk memfilter daftar</small></div>
      <div className="operations-segments">
        <button className={stageFilter==="ALL"?"is-active":""} onClick={()=>setStageFilter("ALL")} style={{"--segment-color":C.accent}}>
          <span style={{fontWeight:900,fontSize:14}}>{scopedList.length}</span><span>Semua Tahap</span>
        </button>
        {belumLanjutCount>0 && (
          <button className={belumLanjutOnly?"is-active":""} onClick={()=>setBelumLanjutOnly(b=>!b)} style={{"--segment-color":C.red}}>
            Belum Lanjut ({belumLanjutCount})
          </button>
        )}
      </div>
      <div className="attb-pipeline" aria-label="Pipeline penghapusan ATTB">
        {/* Pra-tahap: Material Bongkaran ATTB (MTU) dari TUG-10 — sumber kandidat sebelum AE.1 */}
        {(()=>{ const active = stageFilter==="SUMBER"; const color="#6b7280"; return (
          <Fragment key="SUMBER">
            <button className={`attb-stage-card is-source${active?" is-active":""}`} onClick={()=>setStageFilter("SUMBER")} title="Material Bongkaran ATTB dari TUG-10"
              style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"10px 12px",minWidth:120,borderRadius:12,border:`2px dashed ${active?color:"#cbd5e1"}`,background:active?color:"#f8fafc",color:active?"white":C.text,cursor:"pointer",boxShadow:active?`0 2px 10px ${color}55`:"none",transition:"all .15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span className="attb-stage-code">SRC</span>
                <span style={{fontSize:20,fontWeight:900,color:active?"white":color}}>{bongkaranBelum.length}</span>
              </div>
              <span style={{fontSize:12,fontWeight:700,textAlign:"center",lineHeight:1.2,color:active?"white":C.muted}}>Material Bongkaran<br/>(TUG-10)</span>
            </button>
          </Fragment>
        ); })()}
        {ATTB_STAGES.map((s,i)=>{
          const active = stageFilter===s.code;
          const color = stageColor(s.code);
          return (
            <Fragment key={s.code}>
              <button className={`attb-stage-card${active?" is-active":""}`} onClick={()=>setStageFilter(s.code)} title={`Filter: ${s.label}`}
                style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"10px 12px",minWidth:120,borderRadius:12,border:`2px solid ${active?color:C.border}`,background:active?color:"white",color:active?"white":C.text,cursor:"pointer",boxShadow:active?`0 2px 10px ${color}55`:"none",transition:"all .15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,background:active?"rgba(255,255,255,0.25)":color+"22",color:active?"white":color}}>{i+1}</span>
                  <span style={{fontSize:20,fontWeight:900,color:active?"white":color}}>{stageCounts[s.code]||0}</span>
                </div>
                <span style={{fontSize:12,fontWeight:700,textAlign:"center",lineHeight:1.2,color:active?"white":C.muted}}>{s.label}</span>
              </button>
            </Fragment>
          );
        })}
        {/* Tujuan akhir proses */}
        <div className="attb-pipeline__end">
          <span className="attb-stage-code">KI</span>
          <span style={{fontSize:12,fontWeight:800,color:C.green,textAlign:"center",lineHeight:1.2}}>LELANG<br/>oleh KI</span>
        </div>
      </div>

      {canManage && stageFilter!=="SUMBER" && (
        <div className="operations-actionbar">
          <button style={sty.btn("ghost")} onClick={()=>{setImportRaw(null);setImportPreview(null);setImportOverwrite(false);setImportIncludeHidden(false);setShowImportPanel(true);}}>Import Excel Material</button>
        </div>
      )}

      {/* ── PRA-TAHAP: Pool Material Bongkaran ATTB (MTU) dari TUG-10 ── */}
      {stageFilter==="SUMBER" && (
        <div>
          <div style={{...sty.card,marginBottom:12,background:"#f8fafc",borderLeft:`4px solid #6b7280`,padding:"10px 14px",fontSize:12,color:C.muted}}>
            🧰 Daftar material <b>Bongkaran ATTB (MTU)</b> yang masuk lewat TUG-10 (retur). Ini sumber kandidat sebelum diusulkan ke AE.1. Klik <b>Usulkan ATTB</b> untuk memindahkan material ke pipeline (Tahap 1 — Usulan AE.1 ke Unit Induk).
          </div>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Total <b style={{color:C.text}}>{bongkaranPool.length}</b> material bongkaran • <b style={{color:C.accent}}>{bongkaranBelum.length}</b> belum diusulkan</div>
          <div className="mobile-card-table attb-card-table" style={{...sty.card,padding:0,overflowX:"auto",marginBottom:24}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:820}}>
              <thead>
                <tr style={{background:C.sidebar,color:"white"}}>
                  {["Material","Qty","No Seri","No Asset","Sumber TUG-10","Tanggal","Status TUG-10","Aksi"].map(h=>(
                    <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"?"center":"left",whiteSpace:"nowrap",fontSize:12}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bongkaranPool.length===0 && (
                  <tr className="mobile-card-table__row"><td colSpan={8} style={{padding:30,textAlign:"center",color:C.muted}}>Belum ada material Bongkaran ATTB (MTU) dari TUG-10.</td></tr>
                )}
                {bongkaranPool.map(p=>{
                  const sudah = promotedKeys.has(p.key);
                  return (
                    <tr key={p.key} className="mobile-card-table__row" style={{borderBottom:`1px solid ${C.border}`,"--row-accent":sudah?C.green:"#6b7280",opacity:sudah?0.65:1}}>
                      <td className="mobile-card-table__title" style={{padding:"8px 10px",fontWeight:600,minWidth:180}}>{p.nama}</td>
                      <td data-label="Qty" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.qty} {p.satuan}</td>
                      <td data-label="No Seri" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.noSeri||"—"}</td>
                      <td data-label="No Asset" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.noAsset||"—"}</td>
                      <td data-label="Sumber TUG-10" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.tug10No}{p.namaPekerjaan?<div style={{fontSize:12,color:C.muted}}>{p.namaPekerjaan}</div>:null}</td>
                      <td data-label="Tanggal" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.tanggal?new Date(p.tanggal).toLocaleDateString("id-ID"):"—"}</td>
                      <td data-label="Status TUG-10" style={{padding:"8px 10px"}}><span style={{padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700,background:p.status==="APPROVED"?"#dcfce7":"#fef3c7",color:p.status==="APPROVED"?C.green:"#92400e"}}>{p.status||"-"}</span></td>
                      <td data-label="Aksi" style={{padding:"8px 10px",textAlign:"center"}}>
                        {sudah
                          ? <span style={{fontSize:12,fontWeight:700,color:C.green}}>✅ Sudah diusulkan</span>
                          : canManage
                            ? <button style={sty.btn("primary","sm")} onClick={()=>promoteBongkaran(p)}>➕ Usulkan ATTB</button>
                            : <span style={{fontSize:12,color:C.muted}}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stageFilter!=="SUMBER" && <>
      {/* Bar filter data — search bebas + dropdown jenis/status/waktu usulan */}
      <div className="operations-filterbar">
        <div style={{position:"relative",flex:1,minWidth:220}}>
          <input style={{...sty.input,paddingRight:28}} placeholder="Cari nomor AT/ATTB, deskripsi, merk, bay, atau lokasi" value={attbSearch} onChange={e=>setAttbSearch(e.target.value)}/>
          {attbSearch && <button onClick={()=>setAttbSearch("")} title="Hapus pencarian" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}>✕</button>}
        </div>
        {jenisOptions.length>1 && (
          <select style={{...sty.select,width:"auto",minWidth:130}} value={jenisFilter} onChange={e=>setJenisFilter(e.target.value)}>
            <option value="ALL">Semua Jenis</option>
            {jenisOptions.map(j=><option key={j} value={j}>{ATTB_JENIS_ASET_LABEL[j]||j}</option>)}
          </select>
        )}
        <select style={{...sty.select,width:"auto",minWidth:130}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="ALL">Semua Status</option>
          {statusOptions.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        {waktuOptions.length>0 && (
          <select style={{...sty.select,width:"auto",minWidth:150}} value={waktuFilter} onChange={e=>setWaktuFilter(e.target.value)}>
            <option value="ALL">Semua Waktu Usulan</option>
            {waktuOptions.map(w=><option key={w} value={w}>{w}</option>)}
          </select>
        )}
        {(attbSearch||jenisFilter!=="ALL"||statusFilter!=="ALL"||waktuFilter!=="ALL") && (
          <button style={sty.btn("ghost","sm")} onClick={()=>{setAttbSearch("");setJenisFilter("ALL");setStatusFilter("ALL");setWaktuFilter("ALL");}}>Reset filter</button>
        )}
      </div>

      <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Menampilkan <b style={{color:C.text}}>{filteredList.length}</b> item</div>

      {/* Tabel desktop — format identik Data Stok Gudang */}
      <div className="attb-table-wrap">
      <div className="operations-table-card" style={{...sty.card,padding:0,overflowX:"auto",marginBottom:0,boxShadow:"none",borderRadius:0}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:760}}>
          <thead>
            <tr style={{background:C.sidebar,color:"white"}}>
              {["Foto","Nama Barang","Kategori","Qty / Nilai","Lokasi","Status","Aksi"].map(h=>(
                <th key={h} style={{padding:"10px 12px",textAlign:h==="Aksi"?"center":"left",fontSize:13,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredList.length===0 && (
              <tr><td colSpan={7} style={{padding:30,textAlign:"center",color:C.muted}}>Belum ada item ATTB untuk filter ini.</td></tr>
            )}
            {pagedList.map(item=>{
              const canApproveThis = isPendingAttbApproval(item) && canApproveAttb(currentUser, item);
              const borderColor = item.lanjutBelumLanjut ? "#f59e0b" : stageColor(item.stage);
              const loc = resolveLokasiMaster(item);
              const selGudangId = attbGudangFilter[item.id] ?? item.gudangId ?? loc?.gdg?.id ?? "";
              const subsForGudang = subGudangList.filter(sg=>sg.gudangId===selGudangId);
              const selSubGudangId = attbSubGudangFilter[item.id] ?? item.subGudangId ?? loc?.sg?.id ?? "";
              const blokOptions = lokasiList.filter(l=>l.gudangId===selGudangId && (subsForGudang.length===0||(l.subGudangId||"")===selSubGudangId));
              const canLihatPeta = !!loc?.petaInfo;
              const jenisColor = {MATERIAL:"#3b82f6",PERALATAN_LISTRIK:"#8b5cf6",KENDARAAN:"#f59e0b",BANGUNAN:"#10b981",SALURAN_AIR:"#06b6d4",JALAN:"#64748b"}[item.jenisAset]||C.muted;
              // Status badge mirip "SAP — Persediaan"
              const stageLbl = attbStageLabel(item.stage);
              const stageClr = stageColor(item.stage);
              const locationParts = [
                { short: loc?.gdg?.kode || loc?.gdg?.nama, full: loc?.gdg?.nama },
                { short: loc?.sg?.kode || loc?.sg?.nama, full: loc?.sg?.nama },
                { short: loc?.lok?.kode || loc?.lok?.nama, full: loc?.lok?.nama },
              ].filter(part=>part.short);
              const locationTitle = locationParts.length ? locationParts.map(part=>part.full || part.short).join(" / ") : "Lokasi belum diatur";
              const locationGudang = loc?.gdg?.kode || loc?.gdg?.nama;
              const locationSub = loc?.sg && `SG: ${loc.sg.kode || subGudangCodes[loc.sg.id] || loc.sg.nama}`;
              const locationBlok = loc?.lok && `Blok: ${loc.lok.kode || loc.lok.nama}`;
              return (
                <Fragment key={item.id}>
                  <tr className="attb-preview-trigger" onClick={()=>setPreviewId(item.id)} style={{borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${borderColor}`,verticalAlign:"middle"}}>
                    {/* Foto */}
                    <td style={{padding:"8px 12px",width:52}}>
                      <div style={{width:40,height:40,borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`,background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {item.foto
                          ? <img src={item.foto} alt="foto" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                          : <span style={{fontSize:18,color:"#9ca3af"}}>📦</span>}
                      </div>
                    </td>
                    {/* Nama Barang — ATTB No + AT kode di bawah (mirip Nama + kode SAP) */}
                    <td style={{padding:"8px 12px",maxWidth:200}}>
                      <div style={{fontWeight:700,color:C.text,fontSize:13,lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{item.description||item.nomorATTB||"-"}</div>
                      <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                        <span style={{fontSize:11,color:C.muted}}>📋 {item.nomorATTB||item.nomorAT||item.id}</span>
                      </div>
                    </td>
                    {/* Kategori — badge jenis + UPT + waktu usulan */}
                    <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:2}}>
                        <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:jenisColor+"22",color:jenisColor,whiteSpace:"nowrap"}}>
                          {ATTB_JENIS_ASET_LABEL[item.jenisAset]||item.jenisAset}
                        </span>
                        {item.bay && <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:600,background:"#f3f4f6",color:C.muted,whiteSpace:"nowrap",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{item.bay}</span>}
                      </div>
                      <div style={{fontSize:11,color:C.muted}}>{item.upt}</div>
                    </td>
                    {/* Qty / Nilai — nilai perolehan + waktu usulan di bawah */}
                    <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                      <div style={{fontWeight:700,color:C.text,fontSize:13}}>
                        {item.nilaiPerolehan ? `Rp ${Number(item.nilaiPerolehan).toLocaleString("id-ID")}` : "Rp 0"}
                      </div>
                      {item.waktuUsulanPenghapusan && <div style={{fontSize:11,color:C.muted,marginTop:1}}>{item.waktuUsulanPenghapusan}</div>}
                    </td>
                    {/* Lokasi — ringkas dan read-only; pengeditan tetap melalui Edit/modal */}
                    <td style={{padding:"8px 12px",minWidth:180,maxWidth:230}} title={locationTitle} aria-label={`Lokasi: ${locationTitle}`}>
                      <div style={{fontSize:12,color:locationGudang?C.text:C.muted,fontStyle:locationGudang?"normal":"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {locationGudang || "—"}
                      </div>
                      {(locationSub || locationBlok) && (
                        <div style={{display:"flex",gap:6,marginTop:2,fontSize:11,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {locationSub && <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{locationSub}</span>}
                          {locationBlok && <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{locationBlok}</span>}
                        </div>
                      )}
                    </td>
                    {/* Status — format identik dengan "SAP — Persediaan" */}
                    <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                      {(() => {
                        let bg = "#dbeafe";
                        let fg = "#1d4ed8";
                        let label = `ATTB — ${stageLbl}`;

                        if (item.lanjutBelumLanjut) {
                          bg = "#fef2f2"; // merah (Cadang)
                          fg = "#ef4444";
                          label = "ATTB — Ditahan";
                        } else if (item.approvalStatus === "DRAFT") {
                          bg = "#f3f4f6"; // abu (Draft)
                          fg = "#6b7280";
                          label = "ATTB — Draft";
                        } else if (item.approvalStatus === "PENDING_ASMAN") {
                          bg = "#fef9c3"; // kuning (Pending)
                          fg = "#a16207";
                          label = "ATTB — Pending";
                        }

                        return (
                          <span style={{ padding: "2px 7px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: bg, color: fg, whiteSpace: "nowrap" }}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    {/* Aksi — persis Data Stok: Edit | Hapus | inline action buttons */}
                    <td onClick={e => e.stopPropagation()} style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                      <div className="table-actions">
                        {canManage && (
                          <button className="table-action-button" title="Edit data ATTB"
                            onClick={()=>{setEditingId(item.id);setEditForm({...item});}}>Edit</button>
                        )}
                        {canDelete && (
                          <button className="table-action-button is-danger" title="Hapus data ATTB"
                            onClick={()=>askConfirmDelete&&askConfirmDelete({title:"Hapus Item ATTB?",message:`${item.nomorATTB||item.nomorAT||item.id} — ${item.description||"-"}`,warning:"Data akan dihapus permanen.",confirmLabel:"🗑️ Ya, Hapus",onConfirm:()=>deleteItem(item.id)})}>Hapus</button>
                        )}
                        {canApproveThis && (
                          <>
                            <button className="table-action-button" title="Approve" onClick={()=>approveToKI(item.id)}>Approve</button>
                            <button className="table-action-button is-danger" title="Tolak" onClick={()=>{setRejectingId(item.id);setRejectReason("");}}>Tolak</button>
                          </>
                        )}
                        {canManage && ["USULAN_AE1","AE1_AE4"].includes(item.stage) && (
                          <>
                            <button className="table-action-button" title="Lanjut ke tahap berikutnya" onClick={()=>advanceStage(item.id)}>Lanjut</button>
                            <button className="table-action-button" title={item.lanjutBelumLanjut ? "Lanjutkan" : "Tandai Belum Lanjut"}
                              onClick={()=>{ if(item.lanjutBelumLanjut){ resumeBelumLanjut(item); } else { setBelumLanjutId(item.id); setBelumLanjutNote(""); } }}>
                              {item.lanjutBelumLanjut ? "Lanjutkan" : "Tahan"}
                            </button>
                          </>
                        )}
                        {canManage && ["CEK_DEKOM","CEK_KJPP"].includes(item.stage) && (
                          <button className="table-action-button" title="Lanjut ke tahap berikutnya" onClick={()=>advanceStage(item.id)}>Lanjut</button>
                        )}
                        {canLihatPeta && (
                          <button className="table-action-button is-icon" title="Lihat di Peta Gudang"
                            onClick={()=>setPetaMiniDetail&&setPetaMiniDetail({stock:item,lokasi:loc.lok,gudang:loc.gdg,petaInfo:loc.petaInfo})}>📍</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(rejectingId===item.id || belumLanjutId===item.id) && (
                    <tr style={{borderLeft:`3px solid ${borderColor}`}}>
                      <td colSpan={7} style={{padding:"10px 12px",background:"#fef2f2"}}>
                        {rejectingId===item.id && (
                          <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                            <textarea style={{...sty.input,minHeight:44,flex:1}} placeholder="Alasan penolakan..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                            <button style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>setRejectingId(null)}>Batal</button>
                            <button style={{...sty.btn("danger","sm"),flexShrink:0}} onClick={async()=>{await rejectToKI(item.id, rejectReason);setRejectingId(null);}}>Tolak</button>
                          </div>
                        )}
                        {belumLanjutId===item.id && (
                          <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                            <textarea style={{...sty.input,minHeight:44,flex:1}} placeholder="Alasan Belum Lanjut..." value={belumLanjutNote} onChange={e=>setBelumLanjutNote(e.target.value)}/>
                            <button style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>setBelumLanjutId(null)}>Batal</button>
                            <button style={{...sty.btn("danger","sm"),flexShrink:0}} onClick={async()=>{await markBelumLanjut(item.id, belumLanjutNote);setBelumLanjutId(null);}}>Simpan</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>{/* end attb-table-wrap */}


      {/* Mobile Card Layout — visible hanya di < 768px via CSS */}
      <div className="attb-mobile-cards">
        {filteredList.length===0 && (
          <div style={{padding:24,textAlign:"center",color:C.muted,fontSize:12}}>Belum ada item ATTB untuk filter ini.</div>
        )}
        {pagedList.map(item=>{
          const borderColor = item.lanjutBelumLanjut ? "#f59e0b" : stageColor(item.stage);
          const loc = resolveLokasiMaster(item);
          const canApproveThis = isPendingAttbApproval(item) && canApproveAttb(currentUser, item);
          const selGudangId = attbGudangFilter[item.id] ?? item.gudangId ?? loc?.gdg?.id ?? "";
          const subsForGudang = subGudangList.filter(sg=>sg.gudangId===selGudangId);
          const selSubGudangId = attbSubGudangFilter[item.id] ?? item.subGudangId ?? loc?.sg?.id ?? "";
          const blokOptions = lokasiList.filter(l=>l.gudangId===selGudangId && (subsForGudang.length===0||(l.subGudangId||"")===selSubGudangId));
          return (
            <Fragment key={item.id}>
            <div className="attb-mobile-card attb-preview-trigger" role="button" tabIndex={0} onClick={()=>setPreviewId(item.id)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setPreviewId(item.id);}}} style={{borderLeft:`4px solid ${borderColor}`}}>
              {/* Header: foto + nomor + badge tahap */}
              <div className="attb-mobile-card__header">
                {item.foto
                  ? <img src={item.foto} alt="foto" className="attb-mobile-card__foto"/>
                  : <div className="attb-mobile-card__foto-placeholder">📦</div>}
                <div className="attb-mobile-card__id">
                  <div style={{fontWeight:700,fontSize:13,color:C.text}}>{item.nomorATTB||item.nomorAT||item.id}</div>
                  {item.waktuUsulanPenghapusan && <div style={{fontSize:11,color:C.muted}}>{item.waktuUsulanPenghapusan}</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end",flexShrink:0}}>
                  <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:800,background:stageColor(item.stage)+"22",color:stageColor(item.stage),whiteSpace:"nowrap"}}>{attbStageLabel(item.stage)}</span>
                  {item.lanjutBelumLanjut && <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:800,background:"#fef3c7",color:"#92400e",whiteSpace:"nowrap"}}>⏸ Ditahan</span>}
                </div>
              </div>
              {/* Body: deskripsi, jenis, lokasi, nilai */}
              <div className="attb-mobile-card__body">
                <div style={{fontWeight:600,fontSize:13,color:C.text}}>{item.description||"-"}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{ATTB_JENIS_ASET_LABEL[item.jenisAset]||item.jenisAset} · {item.upt}</div>
                {item.bay && <div style={{fontSize:12,color:C.muted}}>⚡ Asal: {item.bay}</div>}
                {item.approvalStatus==="DRAFT" && item.alasanTolak && <div style={{fontSize:12,color:C.red,marginTop:2}}>Ditolak: {item.alasanTolak}</div>}
                <div className="attb-mobile-card__row" onClick={e=>e.stopPropagation()} style={{flexDirection:"column",alignItems:"stretch",gap:6,marginTop:6,marginBottom:6}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.text,display:"flex",alignItems:"center",gap:4}}>📍 Lokasi Penyimpanan:</div>
                  {canManage ? (
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <select value={selGudangId} style={{...sty.select,fontSize:12,padding:"6px 8px",width:"100%"}}
                        onChange={e=>{ const v=e.target.value; setAttbGudangFilter(prev=>({...prev,[item.id]:v})); setAttbSubGudangFilter(prev=>({...prev,[item.id]:""})); saveEdit(item.id,{gudangId:v||null,subGudangId:null,lokasiId:null}); }}>
                        <option value="">— Pilih Gudang —</option>
                        {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                      </select>
                      
                      <div style={{display:"flex",gap:6}}>
                        <select value={selSubGudangId}
                          disabled={!selGudangId || subsForGudang.length === 0}
                          style={{...sty.select,fontSize:12,padding:"6px 8px",flex:1}}
                          onChange={e=>{ const v=e.target.value; setAttbSubGudangFilter(prev=>({...prev,[item.id]:v})); saveEdit(item.id,{subGudangId:v||null,lokasiId:null}); }}>
                          <option value="">{subsForGudang.length > 0 ? "— Sub Gudang —" : "— Tanpa Sub —"}</option>
                          {subsForGudang.map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                        </select>
                        <select value={item.lokasiId||""}
                          disabled={!selGudangId}
                          style={{...sty.select,fontSize:12,padding:"6px 8px",flex:1}}
                          onChange={e=>setAttbLokasi(item, e.target.value)}>
                          <option value="">— Blok —</option>
                          {blokOptions.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <span style={{fontSize:12,color:loc?C.text:C.muted,fontStyle:loc?"normal":"italic"}}>
                      {loc ? loc.teks : "Belum diisi"}
                    </span>
                  )}
                </div>
                <div className="attb-mobile-card__row">
                  <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:"#f3f4f6",color:C.muted}}>{item.approvalStatus||"DRAFT"}</span>
                  {item.nilaiPerolehan && <span style={{fontSize:12,color:C.muted}}>Perolehan: <b style={{color:C.text}}>{Number(item.nilaiPerolehan).toLocaleString("id-ID")}</b></span>}
                </div>
              </div>
              {/* Actions */}
              <div className="attb-mobile-card__actions" onClick={e=>e.stopPropagation()}>
                {canManage && <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"5px 9px"}} onClick={()=>{setEditingId(item.id);setEditForm({...item});}}>✏️</button>}
                {canApproveThis && (
                  <span className="approval-actions approval-actions--compact">
                    <button className="approval-btn--approve" onClick={()=>approveToKI(item.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Approve</button>
                    <button className="approval-btn--reject" onClick={()=>{setRejectingId(item.id);setRejectReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                  </span>
                )}
                {canManage && ["USULAN_AE1","AE1_AE4"].includes(item.stage) && (
                  <div style={{display:"inline-flex",borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
                    <button title="Lanjut ke tahap berikutnya" onClick={()=>advanceStage(item.id)}
                      style={{border:"none",cursor:"pointer",padding:"5px 10px",fontSize:12,fontWeight:800,background:"#dcfce7",color:C.green,whiteSpace:"nowrap"}}>▶ Lanjut</button>
                    <button title={item.lanjutBelumLanjut?"Sedang Belum Lanjut — klik untuk lanjutkan lagi":"Tandai Belum Lanjut"}
                      onClick={()=>{ if(item.lanjutBelumLanjut){ resumeBelumLanjut(item); } else { setBelumLanjutId(item.id); setBelumLanjutNote(""); } }}
                      style={{border:"none",borderLeft:`1px solid ${C.border}`,cursor:"pointer",padding:"5px 10px",fontSize:12,fontWeight:800,background:item.lanjutBelumLanjut?"#f59e0b":"#fffbeb",color:item.lanjutBelumLanjut?"white":"#92400e",whiteSpace:"nowrap"}}>{item.lanjutBelumLanjut?"⏸ Ditahan":"⏸ Belum"}</button>
                  </div>
                )}
                {canManage && ["CEK_DEKOM","CEK_KJPP"].includes(item.stage) && (
                  <button style={sty.btn("ghost","sm")} onClick={()=>advanceStage(item.id)}>▶ Lanjut</button>
                )}
                {canDelete && (
                  <button title="Hapus item ATTB" style={{...sty.btn("danger","sm"),padding:"5px 8px"}}
                    onClick={()=>askConfirmDelete&&askConfirmDelete({title:"Hapus Item ATTB?",message:`${item.nomorATTB||item.nomorAT||item.id} — ${item.description||"-"}`,warning:"Data akan dihapus permanen dari daftar & database. Tindakan ini tidak bisa di-undo.",confirmLabel:"🗑️ Ya, Hapus",onConfirm:()=>deleteItem(item.id)})}>🗑️</button>
                )}
              </div>
            </div>
            {/* Inline reject / belum lanjut form untuk mobile card */}
            {(rejectingId===item.id || belumLanjutId===item.id) && (
              <div style={{background:"#fef2f2",border:`1px solid #fecaca`,borderRadius:10,padding:"10px 12px",marginTop:-8,marginBottom:10}}>
                {rejectingId===item.id && (
                  <div>
                    <textarea style={{...sty.input,minHeight:50}} placeholder="Alasan penolakan..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                    <div className="approval-actions approval-actions--compact" style={{marginTop:6}}>
                      <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                      <button className="approval-btn--danger" onClick={async()=>{await rejectToKI(item.id, rejectReason);setRejectingId(null);}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                    </div>
                  </div>
                )}
                {belumLanjutId===item.id && (
                  <div>
                    <textarea style={{...sty.input,minHeight:50}} placeholder="Alasan Belum Lanjut..." value={belumLanjutNote} onChange={e=>setBelumLanjutNote(e.target.value)}/>
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      <button style={sty.btn("ghost","sm")} onClick={()=>setBelumLanjutId(null)}>Batal</button>
                      <button style={sty.btn("danger","sm")} onClick={async()=>{await markBelumLanjut(item.id, belumLanjutNote);setBelumLanjutId(null);}}>Simpan</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </Fragment>
          );
        })}
      </div>{/* end attb-mobile-cards */}

      {filteredList.length > 0 && (
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
            Tampilkan
            <select style={{...sty.select,width:"auto",padding:"4px 8px",minHeight:"unset",fontSize:12}} value={attbPageSize} onChange={e=>setAttbPageSize(Number(e.target.value))}>
              {[20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            item per halaman — {filteredList.length} total
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button style={{...sty.btn("ghost","sm")}} disabled={attbPageClamped<=1} onClick={()=>setAttbPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
            <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {attbPageClamped} / {attbTotalPages}</span>
            <button style={{...sty.btn("ghost","sm")}} disabled={attbPageClamped>=attbTotalPages} onClick={()=>setAttbPage(p=>Math.min(attbTotalPages,p+1))}>Berikutnya →</button>
          </div>
        </div>
      )}
      </>}

      {/* MODAL IMPORT EXCEL — jenis MATERIAL, 2 format sumber -> 2 tahap target berbeda */}
      {showImportPanel && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:640,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:16,fontWeight:800,marginBottom:4}}>📥 Import Excel ATTB (Material)</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:14}}>Baris data dideteksi otomatis lewat kolom Nomor AT/ATTB. Baris yang nomor AT-nya sudah ada di daftar akan otomatis dilewati (tidak dobel). 💡 Kalau punya kedua file (kandidat baru + yang sudah disetujui), import <b>Tahap 2 dulu</b>, baru Tahap 1 — supaya item yang sudah disetujui otomatis ke-skip saat import Tahap 1, tidak dobel-catat.</p>

            <div style={{marginBottom:8}}>
              <label style={sty.label}>Target Tahap</label>
              <select style={sty.select} value={importTarget} onChange={e=>setImportTarget(e.target.value)}>
                <option value="TAHAP1">Tahap 1 — Kandidat Baru (format "Bursa Material belum diusulkan")</option>
                <option value="TAHAP2">Tahap 2 — Sudah Disetujui (format resmi "Template AE.3.1f")</option>
              </select>
            </div>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>UPT</label>
              <div style={{...sty.input,background:"#f3f4f6",color:C.text,display:"flex",alignItems:"center",fontWeight:600}}>{importUpt||"(UPT login tidak terdeteksi)"}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>Otomatis mengikuti UPT login admin.</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <label style={sty.label}>Waktu Usulan — Semester</label>
                <select style={sty.select} value={importSemester} onChange={e=>setImportSemester(e.target.value)}>
                  <option value="1">Semester 1</option>
                  <option value="2">Semester 2</option>
                </select>
              </div>
              <div>
                <label style={sty.label}>Tahun</label>
                <select style={sty.select} value={importTahun} onChange={e=>setImportTahun(Number(e.target.value))}>
                  {attbTahunOptions.map(y=><option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Tersimpan sebagai: <b style={{color:C.accent}}>{importWaktu}</b></div>

            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,marginBottom:8,cursor:"pointer",padding:"8px 10px",background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:8}}>
              <input type="checkbox" checked={importIncludeHidden} onChange={e=>setImportIncludeHidden(e.target.checked)}/>
              <span>Sertakan baris yang di-<b>hide</b>/di-filter di Excel
                {importPreview && importPreview.hiddenCount>0 && <span style={{color:"#92400e",fontWeight:700}}> — ada {importPreview.hiddenCount} baris hidden, saat ini <b>{importIncludeHidden?"disertakan":"dilewati"}</b></span>}
                {importPreview && importPreview.hiddenCount===0 && <span style={{color:C.muted}}> (file ini tidak punya baris hidden)</span>}
              </span>
            </label>

            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,marginBottom:12,cursor:"pointer",padding:"8px 10px",background:importOverwrite?"#fef2f2":"#f8fafc",border:`1px solid ${importOverwrite?"#fecaca":C.border}`,borderRadius:8}}>
              <input type="checkbox" checked={importOverwrite} onChange={e=>setImportOverwrite(e.target.checked)}/>
              <span>♻️ <b>Tiban (timpa)</b> semua data eksisting dengan Waktu Usulan = <b>{importWaktu}</b>
                {importOverwrite && importPreview && <span style={{color:C.red,fontWeight:700}}> — {importPreview.overwriteCount} item lama akan dihapus & diganti isi file</span>}
                {!importOverwrite && <span style={{color:C.muted}}> (default: data lama dipertahankan, hanya menambah yang baru)</span>}
              </span>
            </label>

            <label style={{...sty.btn("primary"),cursor:"pointer",display:"inline-block",marginBottom:12}}>
              {importing?"⏳ Memproses...":"📂 Upload File Excel"}
              <input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
            </label>

            {importPreview && (
              <div>
                <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Preview: {importPreview.fileName} (Sheet: {importPreview.sheetName})</div>
                <div style={{display:"flex",gap:10,marginBottom:10}}>
                  <div style={{padding:"6px 12px",borderRadius:8,background:"#f0fdf4",border:`1px solid #bbf7d0`,textAlign:"center"}}>
                    <div style={{fontSize:12,color:C.muted}}>Baru</div>
                    <div style={{fontSize:16,fontWeight:800,color:C.green}}>{importPreview.newCount}</div>
                  </div>
                  <div style={{padding:"6px 12px",borderRadius:8,background:"#f3f4f6",border:`1px solid ${C.border}`,textAlign:"center"}}>
                    <div style={{fontSize:12,color:C.muted}}>Dilewati (duplikat)</div>
                    <div style={{fontSize:16,fontWeight:800,color:C.muted}}>{importPreview.dupCount}</div>
                  </div>
                  {importPreview.hiddenCount>0 && (
                    <div style={{padding:"6px 12px",borderRadius:8,background:"#fef9c3",border:`1px solid #fde68a`,textAlign:"center"}}>
                      <div style={{fontSize:12,color:"#92400e"}}>Hidden di Excel (dilewati)</div>
                      <div style={{fontSize:16,fontWeight:800,color:"#92400e"}}>{importPreview.hiddenCount}</div>
                    </div>
                  )}
                </div>
                <div style={{overflowX:"auto",maxHeight:280,overflowY:"auto",marginBottom:12,border:`1px solid ${C.border}`,borderRadius:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:480}}>
                    <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                      <tr>{["Nomor AT","Description","Nilai Perolehan","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {importPreview.records.map((r,i)=>(
                        <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:r._duplicate?"#f9fafb":"white",opacity:r._duplicate?0.6:1}}>
                          <td style={{padding:"4px 8px"}}>{r.nomorAT}</td>
                          <td style={{padding:"4px 8px"}}>{r.description}</td>
                          <td style={{padding:"4px 8px",textAlign:"right"}}>{r.nilaiPerolehan?.toLocaleString("id-ID")}</td>
                          <td style={{padding:"4px 8px"}}>{r._duplicate?"Duplikat — dilewati":"Baru"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:10,marginTop:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setShowImportPanel(false);setImportRaw(null);setImportPreview(null);}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!importPreview || importPreview.newCount===0} onClick={confirmImport}>
                💾 Import {importPreview?.newCount||0} Item Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TAMBAH — pilih jenis aset dulu, field menyesuaikan (Tahap 1) */}
      {showAddForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:16,fontWeight:800,marginBottom:16}}>+ Tambah Kandidat ATTB (Tahap 1)</h3>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>Jenis Aset</label>
              <select style={sty.select} value={addForm.jenisAset} onChange={e=>setAddForm(f=>({...f,jenisAset:e.target.value}))}>
                {ATTB_JENIS_ASET.map(j=><option key={j} value={j}>{ATTB_JENIS_ASET_LABEL[j]}</option>)}
              </select>
            </div>
            {ATTB_CORE_FIELDS.map(f=>renderField(f, addForm, setAddForm))}
            {(ATTB_FIELDS_BY_JENIS[addForm.jenisAset]||[]).map(f=>renderField(f, addForm, setAddForm))}
            <div style={{display:"flex",gap:10,marginTop:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setShowAddForm(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={submitAdd}>💾 Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIT — field tahap berikutnya baru muncul setelah item mencapai tahap itu */}
      {editingId && (()=>{
        const item = attbList.find(a=>a.id===editingId);
        if (!item) return null;
        const stageIdx = attbStageIndex(item.stage);
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
            <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
              <h3 style={{fontSize:16,fontWeight:800,marginBottom:4}}>✏️ Edit ATTB</h3>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>{item.nomorATTB||item.id} — {ATTB_JENIS_ASET_LABEL[item.jenisAset]||item.jenisAset}</div>

              {/* Foto barang — bisa ditambah/diperbarui di semua tahap. Untuk material
                  eks Bongkaran TUG-10, foto awal sudah ter-isi dari input TUG-10. */}
              <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Foto Barang</div>
              <div style={{height:170,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8}}>
                {editForm.foto ? <img src={editForm.foto} alt="Foto barang ATTB" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{fontSize:36,color:"#9ca3af"}}>📦</div>}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <label style={{...sty.btn("ghost","sm"),flex:1,textAlign:"center",cursor:"pointer"}}>
                  📷 {editForm.foto?"Ganti Foto":"Upload Foto"}
                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg && handleImg(e, img=>setEditForm(f=>({...f,foto:img})))}/>
                </label>
                {editForm.foto && <button style={sty.btn("danger","sm")} onClick={()=>setEditForm(f=>({...f,foto:null}))}>🗑️ Hapus Foto</button>}
              </div>

              <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Data Inti</div>
              {ATTB_CORE_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              {(ATTB_FIELDS_BY_JENIS[item.jenisAset]||[]).map(f=>renderField(f, editForm, setEditForm))}

              {/* Lokasi Penyimpanan — dipindah ke sini dari kolom tabel supaya tabel lebih ringkas */}
              <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Lokasi Penyimpanan</div>
              <div style={{marginBottom:6}}>
                <label style={sty.label}>Gudang</label>
                <select style={sty.select} value={editForm.gudangId||""} onChange={e=>{ const v=e.target.value; setEditForm(f=>({...f,gudangId:v||null,subGudangId:null,lokasiId:null})); }}>
                  <option value="">-- Pilih Gudang --</option>
                  {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                </select>
              </div>
              {editForm.gudangId && subGudangList.filter(sg=>sg.gudangId===editForm.gudangId).length>0 && (
                <div style={{marginBottom:6}}>
                  <label style={sty.label}>Sub Gudang</label>
                  <select style={sty.select} value={editForm.subGudangId||""} onChange={e=>{ const v=e.target.value; setEditForm(f=>({...f,subGudangId:v||null,lokasiId:null})); }}>
                    <option value="">-- Pilih Sub Gudang --</option>
                    {subGudangList.filter(sg=>sg.gudangId===editForm.gudangId).map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                  </select>
                </div>
              )}
              {editForm.gudangId && (()=>{
                const subs = subGudangList.filter(sg=>sg.gudangId===editForm.gudangId);
                const blokOpts = lokasiList.filter(l=>l.gudangId===editForm.gudangId && (subs.length===0||(l.subGudangId||"")===(editForm.subGudangId||"")));
                if (blokOpts.length===0) return <div style={{fontSize:12,color:"#b45309",fontStyle:"italic",marginBottom:6}}>⚠️ Belum ada Blok terdaftar — pilihan Gudang/Sub Gudang tetap tersimpan.</div>;
                return (
                  <div style={{marginBottom:6}}>
                    <label style={sty.label}>Blok</label>
                    <select style={sty.select} value={editForm.lokasiId||""} onChange={e=>setEditForm(f=>({...f,lokasiId:e.target.value||null}))}>
                      <option value="">-- Pilih Blok --</option>
                      {blokOpts.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                    </select>
                  </div>
                );
              })()}

              {stageIdx>=1 && <>
                <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 2 — AE.1 s.d. AE.4</div>
                {ATTB_STAGE2_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
                {item.jenisAset==="MATERIAL" && (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Kategori Material</label>
                    <select style={sty.select} value={editForm.kategoriMaterial||""} onChange={e=>setEditForm(f=>({...f,kategoriMaterial:e.target.value}))}>
                      <option value="">-- Pilih --</option>
                      <option value="Trafo">Trafo</option>
                      <option value="Non Trafo">Non Trafo</option>
                    </select>
                  </div>
                )}
              </>}
              {stageIdx>=2 && <>
                <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 3 — Siap Cek Dekom</div>
                {ATTB_STAGE3_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              </>}
              {stageIdx>=3 && <>
                <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 4 — Cek KJPP</div>
                {ATTB_STAGE4_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              </>}
              {stageIdx>=4 && <>
                <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 5 — Menunggu Lelang</div>
                {ATTB_STAGE5_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              </>}

              {item.stageHistory?.length>0 && (
                <div style={{marginTop:12}}>
                  <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Riwayat Tahap</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:120,overflowY:"auto"}}>
                    {[...item.stageHistory].reverse().map((h,i)=>(
                      <div key={i} style={{fontSize:12,color:C.muted,borderLeft:`2px solid ${C.border}`,paddingLeft:8}}>
                        <b style={{color:C.text}}>{attbStageLabel(h.stage)}</b> — {users.find(u=>u.id===h.oleh)?.name||h.oleh} • {h.tanggal?new Date(h.tanggal).toLocaleString("id-ID"):"-"}
                        {h.catatan && <div>{h.catatan}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:10,marginTop:16}}>
                <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setEditingId(null)}>Batal</button>
                <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{await saveEdit(item.id, editForm);setEditingId(null);}}>💾 Simpan</button>
              </div>
            </div>
          </div>
        );
      })()}
      {previewItem && (
        <div className="attb-preview-backdrop" role="presentation" onClick={()=>setPreviewId(null)}>
          <section className="attb-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="attb-preview-title" onClick={e=>e.stopPropagation()}>
            <header className="attb-preview-header">
              <div><h3 id="attb-preview-title">{previewItem.nomorATTB||previewItem.nomorAT||previewItem.id}</h3><p>{previewItem.description||"Tanpa deskripsi"}</p></div>
              <div className="attb-preview-badges"><span>{ATTB_JENIS_ASET_LABEL[previewItem.jenisAset]||previewItem.jenisAset||"-"}</span><span>{attbStageLabel(previewItem.stage)}</span><span>{previewItem.approvalStatus||"DRAFT"}</span></div>
            </header>
            <div className="attb-preview-body">
              <div className="attb-preview-photos">
                {[{label:"Foto Keseluruhan", src:previewPhotos.keseluruhan, alt:"Foto Keseluruhan"}, {label:"Foto Nameplate", src:previewPhotos.nameplate, alt:"Foto Nameplate"}].map(photo=>(
                  <div className="attb-preview-photo-card" key={photo.label}>
                    <div className="attb-preview-photo-label">{photo.label}</div>
                    <div className="attb-preview-photo">{photo.src ? <img src={photo.src} alt={photo.label==="Foto Keseluruhan" ? `Foto ${previewItem.description||"material"}` : `${photo.alt} ${previewItem.description||"material"}`} /> : <div aria-label={`${photo.label} tidak tersedia`}>📦<small>Foto tidak tersedia</small></div>}</div>
                  </div>
                ))}
              </div>
              <div className="attb-preview-details">
                {previewFieldGroups(previewItem).map(group=><div className="attb-preview-group" key={group.title}><h4>{group.title}</h4><dl>{group.fields.map(f=><Fragment key={f.key}><dt>{f.label}</dt><dd>{formatPreviewValue(f,previewItem[f.key])}</dd></Fragment>)}</dl></div>)}
                <div className="attb-preview-group"><h4>Lokasi Penyimpanan</h4><dl><dt>Gudang</dt><dd>{resolveLokasiMaster(previewItem)?.gdg?.nama||"-"}</dd><dt>Sub Gudang</dt><dd>{resolveLokasiMaster(previewItem)?.sg?.nama||"-"}</dd><dt>Blok</dt><dd>{resolveLokasiMaster(previewItem)?.lok?.kode||resolveLokasiMaster(previewItem)?.lok?.nama||"-"}</dd></dl></div>
                {previewItem.stageHistory?.length>0 && <div className="attb-preview-group"><h4>Riwayat Tahap</h4><ul className="attb-preview-history">{[...previewItem.stageHistory].reverse().map((h,i)=><li key={i}><b>{attbStageLabel(h.stage)}</b> — {h.tanggal?new Date(h.tanggal).toLocaleDateString("id-ID"):"-"}{h.catatan?` · ${h.catatan}`:""}</li>)}</ul></div>}
              </div>
            </div>
            <footer className="attb-preview-footer"><button style={sty.btn("ghost")} onClick={()=>setPreviewId(null)}>Tutup</button>{canManage&&<button style={sty.btn("primary")} onClick={()=>{setPreviewId(null);setEditingId(previewItem.id);setEditForm({...previewItem});}}>Edit Data</button>}</footer>
          </section>
        </div>
      )}
    </div>
  );
}
