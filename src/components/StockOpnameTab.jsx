// Komponen StockOpnameTab — dipindah dari App.jsx (refactor Fase 5c).
import { useState, useRef } from "react";
import { supabase } from "../supabaseClient.js";
import { fmtDate, parseSAPFile, parseUsulanPencocokanXLSX } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { ROLES, hasRole } from "../lib/roles.js";
import { buildBeritaAcaraHTML } from "../lib/docBuilders.js";
import { expandQueryForIlikeSearch, getSAPStatus, normalizeKatalog, extractKatalogIdFromScan } from "../lib/sap.js";
import * as XLSX from "xlsx";

export function StockOpnameTab({ opnameList, stocks, katalogList, currentUser, users, sty, C,
  saveOpname, submitOpname, approveOpname_Asman, approveOpname_Manager, rejectOpname, deleteOpname,
  openScanner, showToast, gudangList, lokasiList, addNonStockFoundItem, isMobile }) {

  const [activeTab, setActiveTab] = useState("list"); // "list"|"form-sap"|"form-nonsap"|"detail"
  const [activeOpname, setActiveOpname] = useState(null);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("semua");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [catatanApproval, setCatatanApproval] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [highlightIdx, setHighlightIdx] = useState(null); // baris hasil scan QR — cuma bantu temukan & fokus, bukan pengganti hitung fisik
  const qtyInputRefs = useRef({});
  const [pageSize, setPageSize] = useState(10);

  // "Tambah Material Ditemukan" (Opname Non-SAP) — form untuk barang fisik yang belum
  // tercatat sama sekali di sistem, ditemukan sambil opname jalan.
  const [tambahModal, setTambahModal] = useState(false);
  const [tambahForm, setTambahForm] = useState({ nama:"", satuan:"", qty:"", gudangId:"", lokasiId:"", foto:null });
  const [maraQuery, setMaraQuery] = useState("");
  const [maraResults, setMaraResults] = useState([]);
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraPicked, setMaraPicked] = useState(null); // {kode_material, nama, satuan} atau null
  const [maraSkip, setMaraSkip] = useState(false); // user pilih "Tidak ada di MARA / lewati dulu"
  const [tambahBusy, setTambahBusy] = useState(false);
  const [qrResult, setQrResult] = useState(null); // katalog object baru, tampilkan label QR setelah simpan

  // Antrian dari file "Usulan Pencocokan MARA" yang di-upload — starting point untuk
  // "Tambah Material Ditemukan", BUKAN jalur upload-langsung-masuk-sistem. Tiap baris tetap
  // wajib direview satu per satu (qty fisik + lokasi diisi ulang saat itu), cuma nama/kandidat
  // kode MARA-nya sudah keisi duluan supaya Admin tidak perlu cari dari nol.
  const [tambahQueue, setTambahQueue] = useState([]);
  const [queueUploadBusy, setQueueUploadBusy] = useState(false);
  const [activeQueueId, setActiveQueueId] = useState(null); // baris antrian yang sedang diproses di modal

  async function handleUploadUsulan(e) {
    const f = e.target.files[0]; if (!f) return;
    setQueueUploadBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const rows = parseUsulanPencocokanXLSX(buf);
      if (!rows.length) { showToast("File tidak punya baris yang bisa dibaca (cek sheet 'usulan_pencocokan').","error"); }
      else { setTambahQueue(rows); showToast(`✅ ${rows.length} baris usulan dimuat — proses satu per satu lewat daftar di bawah.`); }
    } catch (err) {
      showToast("Gagal membaca file: " + err.message, "error");
    }
    setQueueUploadBusy(false);
    e.target.value = "";
  }

  async function searchMaraForOpname(q) {
    setMaraQuery(q); setMaraPicked(null);
    if (!q || q.trim().length < 2) { setMaraResults([]); return; }
    if (!supabase) return;
    setMaraLoading(true);
    const terms = expandQueryForIlikeSearch(q);
    const orFilter = terms.map(t => `nama.ilike.%${t}%`).join(",");
    const { data, error } = await supabase.from("mara_catalog")
      .select("kode_material,nama,satuan").or(orFilter).limit(15);
    setMaraLoading(false);
    setMaraResults(error ? [] : (data || []));
  }

  function openTambahModal(queueItem) {
    setTambahForm({ nama:queueItem?.nama||"", satuan:queueItem?.satuanFile||"", qty:"", gudangId:"", lokasiId:"", foto:null });
    setMaraQuery(""); setMaraResults([]); setMaraSkip(false);
    // Kalau baris antrian sudah punya kandidat MARA (skor KUAT/LEMAH), langsung pre-fill —
    // Admin tetap bisa tap "Ganti" kalau ternyata salah/mau cari ulang.
    setMaraPicked(queueItem?.maraCode ? { kode_material: queueItem.maraCode, nama: queueItem.maraNama, satuan: queueItem.satuanFile } : null);
    setActiveQueueId(queueItem?.id || null);
    setQrResult(null);
    setTambahModal(true);
  }

  async function submitTambahMaterial() {
    const f = tambahForm;
    if (!f.nama.trim()) { showToast("Nama material wajib diisi.","error"); return; }
    if (!f.qty || Number(f.qty) <= 0) { showToast("Qty fisik wajib diisi.","error"); return; }
    if (!f.lokasiId) { showToast("Lokasi (Gudang/Blok) wajib diisi.","error"); return; }
    if (!maraPicked && !maraSkip) { showToast("Cari & pilih kode MARA dulu, atau tap \"Tidak ada di MARA / lewati dulu\".","error"); return; }
    setTambahBusy(true);
    const newKatalog = await addNonStockFoundItem({
      opnameId: activeOpname.id,
      nama: f.nama.trim(),
      katalogCode: maraPicked?.kode_material || null,
      satuan: maraPicked?.satuan || f.satuan || "-",
      qty: Number(f.qty),
      lokasiId: f.lokasiId,
      foto: f.foto,
      belumDicocokkanMara: !maraPicked && maraSkip,
    });
    setTambahBusy(false);
    if (!newKatalog) return;
    setActiveOpname(prev => ({
      ...prev,
      items: [...(prev.items||[]), {
        katalogId: newKatalog.id, namaBarang: newKatalog.name, noKatalog: newKatalog.katalog,
        satuan: newKatalog.satuan, qtySistem: 0, qtsFisik: Number(f.qty), selisih: 0,
        statusItem: "MATERIAL_BARU_NONSAP", keterangan: "", lokasiId: f.lokasiId,
        fotoKeseluruhan: f.foto || null, belumDicocokkanMara: !maraPicked && maraSkip,
      }],
    }));
    setQrResult(newKatalog);
    if (activeQueueId) {
      setTambahQueue(q => q.map(item => item.id === activeQueueId ? { ...item, status: "DONE" } : item));
    }
    showToast(`✅ "${newKatalog.name}" tersimpan (${newKatalog.katalog})`);
  }

  function skipQueueItem(id) {
    setTambahQueue(q => q.map(item => item.id === id ? { ...item, status: "SKIP" } : item));
  }

  // Scan QR label material (Kartu Gantung TUG-2) untuk LOMPAT ke baris yang benar di tabel opname
  // ini — TIDAK mengisi qty otomatis, cuma navigasi. Angka hasil hitung fisik tetap wajib diketik
  // manual (aturan yang disepakati user 2026-07-07: scan bukan pengganti hitung fisik).
  function handleScanQty() {
    openScanner({ onDetect: (code) => {
      const items = activeOpname?.items || [];
      const scannedKatalogId = extractKatalogIdFromScan(code);
      let idx = scannedKatalogId ? items.findIndex(it => it.katalogId === scannedKatalogId) : -1;
      if (idx < 0) idx = items.findIndex(it => it.noKatalog && normalizeKatalog(it.noKatalog) === normalizeKatalog(code));
      if (idx < 0) { showToast(`Kode ${code} tidak ditemukan di daftar item opname ini`, "error"); return; }
      setPage(Math.floor(idx / pageSize));
      setHighlightIdx(idx);
      showToast(`📷 Ditemukan: ${items[idx].namaBarang} — ketik qty hasil hitung fisik.`);
      setTimeout(() => {
        const el = qtyInputRefs.current[idx];
        if (el) { el.focus(); el.scrollIntoView({behavior:"smooth", block:"center"}); }
      }, 50);
    }});
  }

  // ── SAP CSV Parser ──────────────────────────────────────────────────────
  function buildItemsFromSAP(sapRows) {
    const items = [];
    const katalogByNo = {};
    katalogList.forEach(k=>{ if(k.katalog) katalogByNo[k.katalog]=k; });

    // Items from Data Stok — try match to SAP
    const allKids = [...new Set(stocks.map(s=>s.katalogId).filter(Boolean))];
    allKids.forEach(kid=>{
      const kat = katalogList.find(k=>k.id===kid); if(!kat) return;
      const qtySistem = stocks.filter(s=>s.katalogId===kid).reduce((a,s)=>a+(s.qty||0),0);
      const sapRow = sapRows.find(r=>r.katalog===kat.katalog);
      items.push({
        katalogId: kid, namaBarang: kat.name, noKatalog: kat.katalog||"-", satuan: kat.satuan||"-",
        qtySistem, qtySAP: sapRow?.qty??null,
        qtsFisik: qtySistem, selisih: 0,
        statusItem: sapRow==null?"TIDAK_ADA_DI_SAP":"SESUAI",
        keterangan: "",
      });
    });

    // Items in SAP but not in sistem
    sapRows.forEach(sr=>{
      const kat = katalogByNo[sr.katalog];
      if(!kat) {
        items.push({
          katalogId: null, namaBarang: sr.nama, noKatalog: sr.katalog, satuan: sr.satuan,
          qtySistem: 0, qtySAP: sr.qty, qtsFisik: 0, selisih: 0,
          statusItem: "TIDAK_ADA_DI_SISTEM", keterangan: "",
        });
      }
    });
    return items;
  }

  function buildItemsNonSAP() {
    // Only Non-SAP items from Data Stok
    return [...new Set(stocks.filter(s=>getSAPStatus(katalogList.find(k=>k.id===s.katalogId)?.katalog)==="Non-SAP").map(s=>s.katalogId))]
      .filter(Boolean).map(kid=>{
        const kat = katalogList.find(k=>k.id===kid);
        if(!kat) return null;
        const qtySistem = stocks.filter(s=>s.katalogId===kid).reduce((a,s)=>a+(s.qty||0),0);
        return { katalogId:kid, namaBarang:kat.name, noKatalog:kat.katalog||"-", satuan:kat.satuan||"-",
          qtySistem, qtsFisik:qtySistem, selisih:0, statusItem:"SESUAI", keterangan:"" };
      }).filter(Boolean);
  }

  function startOpname(jenisAlur) {
    const semester = (()=>{ const d=new Date(); return `${d.getFullYear()}-S${d.getMonth()<6?1:2}`; })();
    const id = "OPN-"+Date.now();
    const newOpn = {
      id, semester, jenisAlur, kategori: jenisAlur==="SAP"?"Material SAP":"Material Non-SAP",
      status:"DRAFT", items:jenisAlur==="NON_SAP"?buildItemsNonSAP():[],
      dibuatOleh:currentUser.id, dibuatAt:Date.now(),
      sapUploadedAt:null, totalRowsSAP:0,
      approvedByAsman:null, approvedAtAsman:null, catatanAsman:"",
      approvedByManager:null, approvedAtManager:null, catatanManager:"",
      submittedAt:null, rejectReason:"",
    };
    setActiveOpname(newOpn); setPage(0); setValidationErrors([]);
    setActiveTab(jenisAlur==="SAP"?"form-sap":"form-nonsap");
  }

  async function handleCSVUpload(e) {
    const f = e.target.files[0]; if(!f) return;
    setCsvLoading(true);
    try {
      const sapRows = await parseSAPFile(f);
      const items = buildItemsFromSAP(sapRows);
      setActiveOpname(prev=>({...prev, items, sapUploadedAt:Date.now(), totalRowsSAP:sapRows.length}));
    } catch(err) {
      alert("Gagal membaca file: " + err.message);
    }
    setCsvLoading(false);
  }

  function updateItem(realIdx, field, value) {
    setActiveOpname(prev=>{
      const items = [...prev.items];
      items[realIdx] = {...items[realIdx], [field]:value};
      // Item "🆕 Material Baru" (dari SAP maupun temuan Non-SAP) tetap ditandai begitu walau
      // qty-nya diedit ulang — jangan sampai berubah jadi status SESUAI/SELISIH biasa cuma
      // karena user koreksi angka setelah simpan awal.
      const isMaterialBaru = ["TIDAK_ADA_DI_SISTEM","MATERIAL_BARU_NONSAP"].includes(items[realIdx].statusItem);
      if(field==="qtsFisik" && !isMaterialBaru) {
        items[realIdx].selisih = Number(value) - items[realIdx].qtySistem;
        items[realIdx].statusItem = items[realIdx].selisih===0?"SESUAI":"SELISIH";
      }
      return {...prev, items};
    });
  }

  function validate() {
    const errors = [];
    const isNonSapSession = activeOpname?.jenisAlur === "NON_SAP";
    (activeOpname.items||[]).forEach((item,i)=>{
      if(item.qtsFisik==null||item.qtsFisik==="") errors.push(`Baris ${i+1}: qty fisik belum diisi`);
      if(item.selisih!==0 && !item.keterangan?.trim()) errors.push(`Baris ${i+1} (${item.namaBarang}): keterangan wajib diisi jika ada selisih`);
      // Opname Non-SAP: lokasi WAJIB diisi untuk semua item (baseline maupun temuan baru) —
      // ini yang membuktikan opname fisik benar-benar dilakukan, bukan cuma isi qty dari kursi.
      if(isNonSapSession && !item.lokasiId) errors.push(`Baris ${i+1} (${item.namaBarang}): lokasi (Gudang/Blok) wajib diisi`);
    });
    setValidationErrors(errors);
    // Tombol Submit sekarang cuma ada di bawah tabel (setelah paginasi) — kalau validasi gagal
    // dan cuma diam-diam set state tanpa toast, dengan item ratusan baris user tidak akan sadar
    // submit-nya gagal (kotak error tampil di ATAS tabel, jauh di luar layar). Sesi jadi
    // nyangkut DRAFT selamanya tanpa penjelasan — persis kasus yang dilaporkan user 2026-07-07
    // ("tidak masuk ke approval asman").
    if (errors.length>0) {
      showToast(`❌ Belum bisa disubmit — ${errors.length} item belum lengkap (qty fisik/keterangan). Scroll ke atas untuk detail.`, "error");
      setPage(0);
      if (typeof window!=="undefined") window.scrollTo({top:0, behavior:"smooth"});
    }
    return errors.length===0;
  }

  // ── Progress calculation ─────────────────────────────────────────────
  function getProgress() {
    if(!activeOpname?.items?.length) return {filled:0, total:0, pct:0};
    const total = activeOpname.items.length;
    const filled = activeOpname.items.filter(i=>i.qtsFisik!=null&&i.qtsFisik!=="").length;
    return {filled, total, pct:Math.round(filled/total*100)};
  }

  const statusColor = {DRAFT:"#6b7280",PENDING_ASMAN:"#f59e0b",PENDING_MANAGER:"#3b82f6",SELESAI:"#16a34a",DITOLAK:"#dc2626"};
  const statusLabel = {DRAFT:"Draft",PENDING_ASMAN:"Menunggu Asman",PENDING_MANAGER:"Menunggu Manager",SELESAI:"✅ Selesai",DITOLAK:"❌ Ditolak"};

  // ── FORM VIEW (SAP & Non-SAP) ──────────────────────────────────────────
  if(["form-sap","form-nonsap","detail"].includes(activeTab) && activeOpname) {
    const isSAP = activeOpname.jenisAlur==="SAP";
    const isReadOnly = activeOpname.status!=="DRAFT";
    const items = activeOpname.items||[];
    const totalPages = Math.ceil(items.length/pageSize);
    const pageItems = items.slice(page*pageSize, (page+1)*pageSize);
    const prog = getProgress();
    const selisihCount = items.filter(i=>i.selisih!==0).length;

    return (
      <div>
        {/* Header — cuma navigasi & judul. Tombol Simpan/Submit sengaja HANYA di bawah tabel
            (dulu sempat dobel atas+bawah, membingungkan user — keluhan 2026-07-07). */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <button style={{...sty.btn("ghost","sm"),marginBottom:6}} onClick={()=>{setActiveTab("list");setActiveOpname(null);}}>← Kembali ke Daftar</button>
            <h1 style={sty.pageTitle}>Stock Opname — {activeOpname.jenisAlur}</h1>
            <p style={{color:C.muted,fontSize:12}}>Semester {activeOpname.semester} • {activeOpname.kategori}</p>
          </div>
          {isReadOnly && activeOpname.status==="SELESAI" && (
            <button style={sty.btn("ghost")} onClick={()=>downloadBeritaAcara(activeOpname)}>📄 Download Berita Acara</button>
          )}
        </div>

        {/* Tambah Material Ditemukan + Upload Usulan Pencocokan — cuma Opname Non-SAP.
            Pola card biru + label sama persis dengan "Step 1: Upload File SAP" di bawah,
            supaya konsisten dengan menu Opname lain (keluhan user 2026-07-08). */}
        {!isSAP && !isReadOnly && (
          <>
            <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
              <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
                📋 Material Non-Stock yang Ditemukan
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <button style={{...sty.btn("primary"),width:"100%"}} onClick={()=>openTambahModal()}>
                  ➕ Tambah Material Ditemukan
                </button>
                <label style={{...sty.btn("ghost"),width:"100%",textAlign:"center",cursor:queueUploadBusy?"default":"pointer",opacity:queueUploadBusy?0.6:1}}>
                  {queueUploadBusy?"Memuat...":"📂 Upload Usulan Pencocokan"}
                  <input type="file" accept=".xlsx,.XLSX,.xls" style={{display:"none"}} onChange={handleUploadUsulan} disabled={queueUploadBusy}/>
                </label>
              </div>
              <div style={{fontSize:12,color:C.muted,marginTop:8}}>
                "Tambah Material" untuk barang yang belum pernah tercatat di mana pun. "Upload Usulan Pencocokan" untuk file review yang sudah disiapkan sebelumnya (kode MARA sudah dicocokkan, tinggal diverifikasi fisik).
              </div>
            </div>

            {/* Antrian dari file usulan — tiap baris tetap wajib direview manual (qty+lokasi
                diisi ulang saat itu), file cuma pre-fill nama & kandidat kode MARA-nya. */}
            {tambahQueue.length>0 && (
              <div style={{...sty.card,marginBottom:14,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:800}}>
                    📋 Antrian dari File ({tambahQueue.filter(q=>q.status==="DONE").length}/{tambahQueue.length} diproses)
                  </div>
                  <button title="Batalkan & tutup antrian ini" style={sty.btn("ghost","sm")} onClick={()=>{ if(window.confirm("Batalkan antrian ini? Baris yang belum diproses akan hilang dari daftar (material yang sudah tersimpan TIDAK ikut terhapus).")) setTambahQueue([]); }}>✕ Batal</button>
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:10}}>
                  Qty di file ini data lama (AppSheet) — bukan angka final. Tetap wajib dihitung fisik ulang & isi lokasi tiap kali diproses.
                </div>
                <div style={{maxHeight:280,overflowY:"auto"}}>
                  {tambahQueue.map(q=>(
                    <div key={q.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderBottom:`1px solid ${C.border}`,opacity:q.status!=="PENDING"?0.5:1}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.nama}</div>
                        <div style={{fontSize:12,color:C.muted}}>
                          Katalog asli: {q.katalogAsli||"-"} • Qty file: {q.qtyFile||"-"} •{" "}
                          <span style={{fontWeight:700,color:q.skor==="KUAT"?"#166534":q.skor==="LEMAH"?"#92400e":"#991b1b"}}>{q.skor}</span>
                          {q.maraCode && ` (${q.maraCode})`}
                        </div>
                      </div>
                      {q.status==="PENDING" ? (
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>openTambahModal(q)}>Proses</button>
                          <button style={sty.btn("ghost","sm")} onClick={()=>skipQueueItem(q.id)}>Lewati</button>
                        </div>
                      ) : (
                        <span style={{fontSize:12,fontWeight:700,color:q.status==="DONE"?C.green:C.muted,flexShrink:0}}>
                          {q.status==="DONE"?"✅ Selesai":"⏭️ Dilewati"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Upload CSV SAP */}
        {isSAP && !isReadOnly && (
          <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
            <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
              📂 Step 1: Upload File SAP
            </div>
            {/* Tombol berstyle, sama persis pola dengan Stock Count — dulu cuma <input type="file">
                polos tanpa styling di sini, beda tampilan dari upload SAP di tempat lain (keluhan
                user 2026-07-07: "samakan proses upload filenya agar user lebih familiar"). */}
            <label style={{...sty.btn("primary"),cursor:csvLoading?"default":"pointer",opacity:csvLoading?0.6:1}}>
              {csvLoading ? "Memproses..." : "📂 Upload CSV/XLSX SAP"}
              <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleCSVUpload} disabled={csvLoading} style={{display:"none"}}/>
            </label>
            {activeOpname.sapUploadedAt && (
              <div style={{fontSize:12,color:C.green,marginTop:6}}>
                ✅ {activeOpname.totalRowsSAP} baris SAP dibaca • {items.length} item total • {fmtDate(activeOpname.sapUploadedAt)}
              </div>
            )}
            <div style={{fontSize:12,color:C.muted,marginTop:6}}>
              Format: CSV/XLSX export SAP MM (PEMAT_DDMMYYYY). Kolom yang dipakai: Material, Material Description, Base Unit of Measure, Unrestricted Use Stock, Valuation Type. Kalau file punya lebih dari 1 sheet dengan header sama, semua ikut terbaca.
            </div>
          </div>
        )}

        {/* Progress bar + summary */}
        {items.length>0 && (
          <>
            <div style={{...sty.card,marginBottom:14,padding:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700}}>Progress Pengisian: {prog.filled}/{prog.total} item ({prog.pct}%)</div>
                <div style={{fontSize:12,color:selisihCount>0?C.red:C.green,fontWeight:700}}>
                  {selisihCount>0?`⚠️ ${selisihCount} item selisih`:"✅ Belum ada selisih"}
                </div>
              </div>
              <div style={{background:"#f1f5f9",borderRadius:6,height:8}}>
                <div style={{width:`${prog.pct}%`,height:8,borderRadius:6,background:prog.pct===100?C.green:C.accent,transition:"width 0.3s"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(80px,1fr))",gap:8,marginTop:10}}>
                {[
                  {label:"Total Item",val:items.length,color:C.accent},
                  {label:"Sesuai",val:items.filter(i=>i.statusItem==="SESUAI").length,color:C.green},
                  {label:"Selisih",val:selisihCount,color:C.red},
                  {label:"Tidak di SAP/Sistem",val:items.filter(i=>["TIDAK_ADA_DI_SAP","TIDAK_ADA_DI_SISTEM"].includes(i.statusItem)).length,color:"#f59e0b"},
                ].map((s,i)=>(
                  <div key={i} style={{textAlign:"center",padding:"6px",borderRadius:6,background:"#f9fafb",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:16,fontWeight:800,color:s.color}}>{s.val}</div>
                    <div style={{fontSize:12,color:C.muted}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation errors */}
            {validationErrors.length>0 && (
              <div style={{background:"#fee2e2",border:`1px solid #fca5a5`,borderRadius:8,padding:10,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:"#991b1b",marginBottom:4}}>❌ Perlu diperbaiki sebelum submit:</div>
                {validationErrors.slice(0,5).map((e,i)=><div key={i} style={{fontSize:12,color:"#991b1b"}}>• {e}</div>)}
                {validationErrors.length>5 && <div style={{fontSize:12,color:"#991b1b"}}>... dan {validationErrors.length-5} lainnya</div>}
              </div>
            )}

            {/* Tabel item */}
            <div style={{overflowX:"auto",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                {!isReadOnly ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button style={sty.btn("ghost","sm")} onClick={handleScanQty}>📷 Scan QR untuk cari baris</button>
                    <span style={{fontSize:12,color:C.muted}}>Scan cuma membantu temukan & lompat ke barisnya — qty hasil hitung fisik tetap wajib diketik manual.</span>
                  </div>
                ) : <div/>}
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.muted}}>
                  Tampilkan:
                  {[10,20,50].map(n=>(
                    <button key={n} onClick={()=>{setPageSize(n);setPage(0);}}
                      style={{padding:"3px 9px",borderRadius:5,border:`1px solid ${pageSize===n?C.accent:C.border}`,background:pageSize===n?C.accent:"white",color:pageSize===n?"white":C.text,fontSize:12,fontWeight:pageSize===n?700:400,cursor:"pointer"}}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center",width:36}}>No</th>}
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Nama Barang</th>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center"}}>No Katalog</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Sat</th>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Sistem</th>}
                    {isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty SAP</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Fisik</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Selisih</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Status</th>
                    {!isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>📍 Lokasi *</th>}
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Keterangan</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>📷 Foto</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item,pageIdx)=>{
                    const realIdx = page*pageSize + pageIdx;
                    const isHighlighted = highlightIdx===realIdx;
                    const rowBg = isHighlighted ? "#dbeafe" : item.statusItem==="MATERIAL_BARU_NONSAP" ? "#eff6ff" : item.statusItem==="SESUAI"?"white":item.statusItem==="TIDAK_ADA_DI_SISTEM"?"#fefce8":item.statusItem==="TIDAK_ADA_DI_SAP"?"#f8fafc":"#fff5f5";
                    const statusBadge = item.statusItem==="SESUAI"
                      ? {bg:"#dcfce7",fg:"#166534",label:"✅ Sesuai"}
                      : item.statusItem==="TIDAK_ADA_DI_SAP"
                      ? {bg:"#f3f4f6",fg:"#6b7280",label:"○ Tdk di SAP"}
                      : item.statusItem==="TIDAK_ADA_DI_SISTEM"
                      ? {bg:"#fef3c7",fg:"#92400e",label:"⚠️ Tdk di Sistem"}
                      : item.statusItem==="MATERIAL_BARU_NONSAP"
                      ? {bg:"#dbeafe",fg:"#1e40af",label:"🆕 Baru (Non-Stock)"}
                      : {bg:"#fee2e2",fg:"#991b1b",label:"🔴 Selisih"};
                    const itemGudangId = lokasiList?.find(l=>l.id===item.lokasiId)?.gudangId || "";
                    return (
                      <tr key={realIdx} style={{borderBottom:`1px solid ${C.border}`,background:rowBg,outline:isHighlighted?`2px solid #3b82f6`:"none"}}>
                        {!isMobile && <td style={{padding:"6px 8px",textAlign:"center",color:C.muted,fontSize:12}}>{realIdx+1}</td>}
                        <td style={{padding:"6px 8px",fontWeight:600,maxWidth:isMobile?120:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {item.namaBarang}
                          {item.statusItem==="TIDAK_ADA_DI_SISTEM" && (
                            <div style={{fontSize:12,fontWeight:700,color:"#92400e",whiteSpace:"normal"}}>🆕 Material baru — akan dibuatkan Master Katalog + Data Stok saat sesi ini disetujui Manager (kalau qty fisik diisi &gt;0)</div>
                          )}
                          {item.statusItem==="MATERIAL_BARU_NONSAP" && (
                            <div style={{fontSize:12,fontWeight:700,color:"#1e40af",whiteSpace:"normal"}}>🆕 Ditemukan saat opname — sudah aktif sebagai "Pending Approval", dikonfirmasi penuh saat Manager approve sesi ini.{item.belumDicocokkanMara && " ⚠️ Belum dicocokkan ke MARA."}</div>
                          )}
                        </td>
                        {!isMobile && <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{item.noKatalog}</td>}
                        <td style={{padding:"6px 8px",textAlign:"center"}}>{item.satuan}</td>
                        {!isMobile && <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{fmtNum(item.qtySistem)}</td>}
                        {isSAP && <td style={{padding:"6px 8px",textAlign:"center",color:item.qtySAP!=null?C.text:"#9ca3af"}}>{item.qtySAP!=null?fmtNum(item.qtySAP):"—"}</td>}
                        <td style={{padding:"4px 6px",textAlign:"center"}}>
                          {!isReadOnly
                            ? <input type="number" inputMode="decimal" min="0" value={item.qtsFisik} ref={el=>{qtyInputRefs.current[realIdx]=el;}}
                                onChange={e=>updateItem(realIdx,"qtsFisik",Number(e.target.value))}
                                style={{width:64,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:12,textAlign:"center"}}/>
                            : <span style={{fontWeight:700}}>{fmtNum(item.qtsFisik)}</span>}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"center",fontWeight:700,
                          color:item.selisih<0?"#dc2626":item.selisih>0?"#16a34a":"#6b7280"}}>
                          {item.selisih===0?"—":(item.selisih>0?"+":"")+fmtNum(item.selisih)}
                        </td>
                        <td style={{padding:"6px 8px"}}>
                          <span style={{padding:"2px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:statusBadge.bg,color:statusBadge.fg}}>
                            {statusBadge.label}
                          </span>
                        </td>
                        {!isSAP && (
                          <td style={{padding:"4px 6px"}}>
                            {!isReadOnly ? (
                              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                <select value={itemGudangId} onChange={e=>{ updateItem(realIdx,"lokasiId",""); updateItem(realIdx,"_gudangTmp",e.target.value); }}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:12}}>
                                  <option value="">-- Gudang --</option>
                                  {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                                </select>
                                <select value={item.lokasiId||""} onChange={e=>updateItem(realIdx,"lokasiId",e.target.value)}
                                  disabled={!itemGudangId && !item._gudangTmp}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${!item.lokasiId?C.red:C.border}`,borderRadius:4,fontSize:12}}>
                                  <option value="">-- Blok --</option>
                                  {(lokasiList||[]).filter(l=>l.gudangId===(itemGudangId||item._gudangTmp)).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                                </select>
                              </div>
                            ) : (
                              <span style={{fontSize:12}}>{lokasiList?.find(l=>l.id===item.lokasiId)?.kode || "-"}</span>
                            )}
                          </td>
                        )}
                        <td style={{padding:"4px 6px"}}>
                          {!isReadOnly
                            ? <input value={item.keterangan||""}
                                onChange={e=>updateItem(realIdx,"keterangan",e.target.value)}
                                placeholder={item.selisih!==0?"Wajib diisi...":"Opsional"}
                                style={{width:130,padding:"3px 6px",border:`1px solid ${item.selisih!==0&&!item.keterangan?C.red:C.border}`,borderRadius:4,fontSize:12}}/>
                            : <span style={{fontSize:12,color:C.muted}}>{item.keterangan||"-"}</span>}
                        </td>
                        <td style={{padding:"4px 6px"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            {[["fotoKeseluruhan","🖼️","Foto Keseluruhan"],["fotoNameplate","🏷️","Foto Nameplate"]].map(([field,icon,label])=>(
                              <label key={field} title={label}
                                style={{width:28,height:28,borderRadius:5,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:isReadOnly?"default":"pointer",overflow:"hidden",background:item[field]?"transparent":"#f9fafb",flexShrink:0}}>
                                {item[field]
                                  ? <img src={item[field]} alt={label} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  : <span style={{fontSize:12,color:"#9ca3af"}}>{icon}</span>}
                                {!isReadOnly && (
                                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                                    onChange={e=>{
                                      const f=e.target.files[0]; if(!f) return;
                                      const r=new FileReader();
                                      r.onload=ev=>updateItem(realIdx,field,ev.target.result);
                                      r.readAsDataURL(f);
                                    }}/>
                                )}
                              </label>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages>1 && (
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginBottom:16}}>
                <button style={{...sty.btn("ghost","sm"),opacity:page===0?0.4:1}} disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Sebelumnya</button>
                <div style={{display:"flex",gap:4}}>
                  {Array.from({length:Math.min(totalPages,7)}).map((_,i)=>{
                    const pg = totalPages<=7?i:(page<=3?i:page>=totalPages-4?totalPages-7+i:page-3+i);
                    return (
                      <button key={pg} onClick={()=>setPage(pg)}
                        style={{width:30,height:30,borderRadius:6,border:`1px solid ${pg===page?C.accent:C.border}`,background:pg===page?C.accent:"white",color:pg===page?"white":C.text,fontSize:12,cursor:"pointer",fontWeight:pg===page?700:400}}>
                        {pg+1}
                      </button>
                    );
                  })}
                </div>
                <button style={{...sty.btn("ghost","sm"),opacity:page===totalPages-1?0.4:1}} disabled={page===totalPages-1} onClick={()=>setPage(p=>p+1)}>Berikutnya →</button>
                <span style={{fontSize:12,color:C.muted}}>Hal {page+1} dari {totalPages}</span>
              </div>
            )}

            {/* Aksi Simpan/Submit — sengaja HANYA di sini (bawah tabel), bukan di header juga,
                supaya tidak dobel/membingungkan (keluhan user 2026-07-07). */}
            {!isReadOnly && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:16}}>
                <button style={sty.btn("ghost")} onClick={()=>saveOpname(activeOpname)}>💾 Simpan Draft</button>
                <button style={{...sty.btn("primary"), opacity:prog.pct<100?0.5:1}}
                  onClick={async ()=>{
                    // BUG KRITIS (ditemukan 2026-07-07): dulu saveOpname(activeOpname) dan
                    // submitOpname(activeOpname) dipanggil beruntun TANPA menunggu satu sama lain.
                    // submitOpname sudah menulis SELURUH data opn (spread {...opn}) + status
                    // PENDING_ASMAN — saveOpname menulis objek yang SAMA tapi masih status DRAFT.
                    // Karena keduanya sync ke Supabase secara paralel (network, bukan lagi
                    // localStorage yang instan), race condition: kalau upsert dari saveOpname
                    // (DRAFT) selesai BELAKANGAN dari upsert submitOpname (PENDING_ASMAN), hasil
                    // akhir di database balik jadi DRAFT lagi — submit "hilang" diam-diam padahal
                    // toast sukses tetap muncul. Ini akar masalah sesi opname tidak pernah sampai
                    // ke approval Asman walau semua qty sudah lengkap. Fix: submitOpname saja
                    // (sudah mencakup semua yang dilakukan saveOpname), di-await, baru pindah tab.
                    if(!validate()) return;
                    await submitOpname(activeOpname);
                    setActiveTab("list"); setActiveOpname(null);
                  }}>
                  📋 Submit ke Asman
                </button>
              </div>
            )}
          </>
        )}

        {/* Approval section for non-draft */}
        {isReadOnly && (
          <div style={{...sty.card,background:"#f0fdf4",marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Status Approval</div>
            {activeOpname.approvedByAsman && <div style={{fontSize:12,color:C.green}}>✅ Asman: {users.find(u=>u.id===activeOpname.approvedByAsman)?.name} • {fmtDate(activeOpname.approvedAtAsman)} {activeOpname.catatanAsman&&`— "${activeOpname.catatanAsman}"`}</div>}
            {activeOpname.approvedByManager && <div style={{fontSize:12,color:C.green,marginTop:4}}>✅ Manager: {users.find(u=>u.id===activeOpname.approvedByManager)?.name} • {fmtDate(activeOpname.approvedAtManager)} {activeOpname.catatanManager&&`— "${activeOpname.catatanManager}"`}</div>}
            {activeOpname.rejectReason && <div style={{fontSize:12,color:C.red,marginTop:4}}>❌ Ditolak: {activeOpname.rejectReason}</div>}
          </div>
        )}

        {/* MODAL: Tambah Material Ditemukan (Opname Non-SAP) — 1 layar per barang,
            cari kode MARA dulu, lalu isi qty/lokasi/foto, simpan langsung dapat QR untuk ditempel. */}
        {tambahModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:12}}>
            <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
              {qrResult ? (
                <>
                  <h3 style={{fontSize:16,fontWeight:800,marginBottom:14}}>🏷️ Label QR Siap Dicetak</h3>
                  {(() => {
                    const scanUrl = `${window.location.origin}/?scan=${encodeURIComponent(qrResult.id)}`;
                    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(scanUrl)}`;
                    return (
                      <div style={{border:`3px solid ${C.accent}`,borderRadius:10,padding:16,background:"white",textAlign:"center",marginBottom:14}}>
                        <img src={qrImgUrl} alt="QR" width={160} height={160} style={{display:"block",margin:"0 auto"}}/>
                        <div style={{fontSize:13,fontWeight:800,marginTop:10}}>{qrResult.name}</div>
                        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Kode: {qrResult.katalog}</div>
                        <span style={{display:"inline-block",marginTop:8,padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:"#dbeafe",color:"#1e40af"}}>Non-Stock — Pending Approval</span>
                      </div>
                    );
                  })()}
                  <div style={{fontSize:12,color:C.muted,textAlign:"center",marginBottom:16}}>
                    Screenshot/print gambar QR di atas, tempel ke barang fisik sekarang juga.
                  </div>
                  <button style={{...sty.btn("primary"),width:"100%",marginBottom:8}} onClick={()=>{ setTambahModal(false); setQrResult(null); setActiveQueueId(null); }}>
                    ➡️ Lanjut ke Material Berikutnya
                  </button>
                  <button style={{...sty.btn("ghost"),width:"100%"}} onClick={()=>setQrResult(null)}>← Lihat Ulang Form</button>
                </>
              ) : (
                <>
                  <h3 style={{fontSize:16,fontWeight:800,marginBottom:14}}>➕ Tambah Material Ditemukan</h3>
                  {activeQueueId && (() => {
                    const q = tambahQueue.find(x=>x.id===activeQueueId);
                    return q ? (
                      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:10,marginBottom:12,fontSize:12}}>
                        📋 Dari file usulan — Katalog asli AppSheet: <b>{q.katalogAsli||"-"}</b>, Qty file (data lama, cek ulang fisik): <b>{q.qtyFile||"-"}</b>
                      </div>
                    ) : null;
                  })()}
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Nama Material *</label>
                    <input style={sty.input} value={tambahForm.nama} onChange={e=>{setTambahForm(f=>({...f,nama:e.target.value})); searchMaraForOpname(e.target.value);}} placeholder="Ketik nama, sistem cari otomatis ke MARA..."/>
                  </div>
                  {maraLoading && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Mencari ke MARA...</div>}
                  {!maraPicked && maraResults.length>0 && (
                    <div style={{border:`1px solid ${C.border}`,borderRadius:8,marginBottom:10,maxHeight:160,overflowY:"auto"}}>
                      {maraResults.map(r=>(
                        <div key={r.kode_material} onClick={()=>{setMaraPicked(r); setMaraResults([]); setMaraSkip(false);}}
                          style={{padding:"6px 8px",fontSize:12,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
                          <b>{r.kode_material}</b> — {r.nama} ({r.satuan})
                        </div>
                      ))}
                    </div>
                  )}
                  {maraPicked ? (
                    <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:10,marginBottom:10,fontSize:12}}>
                      ✅ Dipilih: <b>{maraPicked.kode_material}</b> — {maraPicked.nama}
                      <button style={{...sty.btn("ghost","sm"),marginLeft:8}} onClick={()=>setMaraPicked(null)}>Ganti</button>
                    </div>
                  ) : (
                    <button style={{...sty.btn(maraSkip?"primary":"ghost","sm"),width:"100%",marginBottom:10}} onClick={()=>setMaraSkip(true)}>
                      ⏭️ Tidak ada di MARA / lewati dulu (kode sementara dibuat otomatis)
                    </button>
                  )}
                  {!maraPicked && (
                    <div style={{marginBottom:10}}>
                      <label style={sty.label}>Satuan {maraSkip?"*":""}</label>
                      <input style={sty.input} value={tambahForm.satuan} onChange={e=>setTambahForm(f=>({...f,satuan:e.target.value}))} placeholder="cth: BH, M, SET"/>
                    </div>
                  )}
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Qty Fisik *</label>
                    <input type="number" inputMode="decimal" min="0" style={sty.input} value={tambahForm.qty} onChange={e=>setTambahForm(f=>({...f,qty:e.target.value}))}/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Gudang *</label>
                    <select style={sty.select} value={tambahForm.gudangId} onChange={e=>setTambahForm(f=>({...f,gudangId:e.target.value,lokasiId:""}))}>
                      <option value="">-- Pilih Gudang --</option>
                      {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Blok Lokasi *</label>
                    <select style={sty.select} value={tambahForm.lokasiId} onChange={e=>setTambahForm(f=>({...f,lokasiId:e.target.value}))} disabled={!tambahForm.gudangId}>
                      <option value="">-- Pilih Blok --</option>
                      {(lokasiList||[]).filter(l=>l.gudangId===tambahForm.gudangId).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={sty.label}>📷 Foto Barang</label>
                    <label style={{...sty.btn("ghost"),display:"block",textAlign:"center",cursor:"pointer"}}>
                      {tambahForm.foto ? "✅ Foto sudah diambil (tap untuk ganti)" : "📷 Ambil Foto"}
                      <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                        onChange={e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setTambahForm(fm=>({...fm,foto:ev.target.result})); r.readAsDataURL(f); }}/>
                    </label>
                    {tambahForm.foto && <img src={tambahForm.foto} alt="preview" style={{width:"100%",maxHeight:160,objectFit:"cover",borderRadius:8,marginTop:8}}/>}
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTambahModal(false);setActiveQueueId(null);}} disabled={tambahBusy}>Batal</button>
                    <button style={{...sty.btn("primary"),flex:2,opacity:tambahBusy?0.6:1}} onClick={submitTambahMaterial} disabled={tambahBusy}>{tambahBusy?"Menyimpan...":"💾 Simpan & Lihat QR"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── LIST VIEW ────────────────────────────────────────────────────────────
  const pendingForMe = opnameList.filter(o=>
    (o.status==="PENDING_ASMAN"&&hasRole(currentUser, "ASMAN"))||
    (o.status==="PENDING_MANAGER"&&hasRole(currentUser, "MANAGER"))
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <p style={{color:C.muted,fontSize:13}}>Dilakukan 1× per semester — bandingkan data sistem vs lapangan & SAP</p>
        </div>
        {hasRole(currentUser, "ADMIN","TL") && (
          <div style={{display:"flex",gap:8}}>
            <button style={sty.btn("primary")} onClick={()=>startOpname("SAP")}>+ Opname SAP</button>
            <button style={sty.btn("ghost")} onClick={()=>startOpname("NON_SAP")}>+ Opname Non-SAP</button>
          </div>
        )}
      </div>

      {/* Pending approval cards */}
      {pendingForMe.map(opn=>(
        <div key={opn.id} style={{...sty.card,borderLeft:`4px solid #f59e0b`,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:4}}>⏳ Menunggu Approval Kamu ({ROLES[currentUser.role]})</div>
          <div style={{fontWeight:800,fontSize:14,marginBottom:2}}>Opname {opn.semester} — {opn.jenisAlur}</div>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>
            {opn.items?.length||0} item • Selisih: {opn.items?.filter(i=>i.selisih!==0).length||0} item
          </div>
          <div style={{marginBottom:8}}>
            <input style={sty.input} placeholder="Catatan approval (opsional)..." value={catatanApproval} onChange={e=>setCatatanApproval(e.target.value)}/>
          </div>
          {rejectingId===opn.id
            ? <div style={{display:"flex",gap:8}}>
                <input style={{...sty.input,flex:1}} placeholder="Alasan penolakan (wajib)..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                <div className="approval-actions">
                  <button className="approval-btn--danger" onClick={()=>{rejectOpname(opn,rejectReason);setRejectingId(null);setRejectReason("");}}><span className="approval-btn__ic" aria-hidden="true">✕</span>Konfirmasi Tolak</button>
                  <button className="approval-btn--cancel" onClick={()=>setRejectingId(null)}>Batal</button>
                </div>
              </div>
            : <div style={{display:"flex",gap:8}}>
                <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);setActiveTab("detail");}}>🔍 Review Detail</button>
                <div className="approval-actions">
                  <button className="approval-btn--approve" onClick={()=>{opn.status==="PENDING_ASMAN"?approveOpname_Asman(opn,catatanApproval):approveOpname_Manager(opn,catatanApproval);setCatatanApproval("");}}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setujui</button>
                  <button className="approval-btn--reject" onClick={()=>setRejectingId(opn.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                </div>
              </div>}
        </div>
      ))}

      {/* Filter status */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {["semua","DRAFT","PENDING_ASMAN","PENDING_MANAGER","SELESAI","DITOLAK"].map(s=>(
          <button key={s} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${filterStatus===s?C.accent:C.border}`,background:filterStatus===s?C.accent:"white",color:filterStatus===s?"white":C.muted,fontSize:12,cursor:"pointer"}}
            onClick={()=>setFilterStatus(s)}>
            {s==="semua"?"Semua":statusLabel[s]||s}
          </button>
        ))}
      </div>

      {/* Opname list */}
      {(filterStatus==="semua"?opnameList:opnameList.filter(o=>o.status===filterStatus))
        .slice().sort((a,b)=>b.dibuatAt-a.dibuatAt)
        .map(opn=>{
          const creator = users.find(u=>u.id===opn.dibuatOleh)||{};
          const selisihCount = (opn.items||[]).filter(i=>i.selisih!==0).length;
          return (
            <div key={opn.id} style={{...sty.card,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>Opname {opn.semester} — {opn.jenisAlur} <span style={{fontSize:12,fontWeight:400,color:C.muted}}>({opn.kategori})</span></div>
                  <div style={{fontSize:12,color:C.muted}}>{fmtDate(opn.dibuatAt)} • {creator.name||"-"} • {opn.items?.length||0} item • {selisihCount} selisih</div>
                </div>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:(statusColor[opn.status]||"#6b7280")+"22",color:statusColor[opn.status]||"#6b7280"}}>
                  {statusLabel[opn.status]||opn.status}
                </span>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);setActiveTab(opn.status==="DRAFT"?(opn.jenisAlur==="SAP"?"form-sap":"form-nonsap"):"detail");}}>
                  🔍 {opn.status==="DRAFT"?"Edit":"Lihat Detail"}
                </button>
                {opn.status==="SELESAI" && <button style={sty.btn("ghost","sm")} onClick={()=>downloadBeritaAcara(opn)}>📄 Berita Acara</button>}
                {opn.status==="DRAFT" && hasRole(currentUser, "ADMIN","TL") && <button title="Hapus sesi opname" style={sty.btn("danger","sm")} onClick={()=>deleteOpname(opn.id)}>🗑️</button>}
              </div>
            </div>
          );
        })}

      {opnameList.length===0 && (
        <div style={{...sty.card,textAlign:"center",padding:50,color:C.muted}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada sesi Stock Opname</div>
          <div style={{fontSize:12,marginTop:4}}>Klik "+ Opname SAP" atau "+ Opname Non-SAP" untuk memulai</div>
        </div>
      )}
    </div>
  );

  function downloadBeritaAcara(opn) {
    const html = buildBeritaAcaraHTML(opn, katalogList, users);
    const blob = new Blob([html],{type:"text/html"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`BA_Opname_${opn.semester}_${opn.jenisAlur}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
}
