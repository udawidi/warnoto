import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise, ArrowUp, ChartBar, ImageSquare, LinkSimple, PencilSimple,
  Trash, UploadSimple, WarningCircle, Warehouse, X,
} from "@phosphor-icons/react";
import { KAPASITAS_LABEL } from "../constants.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { hasRole, getScopeUptIds } from "../lib/roles.js";
import { supabase } from "../supabaseClient.js";
import {
  createWarehouseCapacityPhotoUrl,
  prepareWarehouseCapacityPhoto,
  removeWarehouseCapacityPhoto,
  uploadWarehouseCapacityPhoto,
} from "../lib/warehouseCapacityPhoto.js";
import { PetaGudangTab } from "./PetaGudangTab.jsx";
import { deriveWarehouseCapacity, validateWarehouseCapacity } from "../lib/warehouseCapacity.mjs";

const PHOTO_URL_TTL = 55 * 60 * 1000;
const photoUrlCache = new Map();

function statusFromUtil(pct) {
  // Terpakai otomatis dari total komposisi persentase.
  if (pct >= 0.90) return "KRITIS";
  if (pct >= 0.75) return "WASPADA";
  return "AMAN";
}

function percentLabel(value) {
  const percent = ((Number(value) || 0) * 100).toFixed(2).replace(/\.?(0+)$/, "");
  return `${percent}%`;
}

function areaLabel(value) {
  return `${(Number(value) || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} m²`;
}

function jakartaTimestamp() {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "medium",
  }).format(new Date());
}

function statusTone(status) {
  if (status === "KRITIS") return "critical";
  if (status === "WASPADA") return "warning";
  return "safe";
}

function findLegacyPhoto(record, gudangList) {
  const name = (record.gudang || "").trim().toLowerCase();
  const matched = (record.matchedGudangId && gudangList.find(g => g.id === record.matchedGudangId))
    || gudangList.find(g => (g.nama || "").trim().toLowerCase() === name);
  if (matched?.fotoGudang) return { src: matched.fotoGudang, label: "Foto gudang umum" };
  if (matched?.denahImageData) return { src: matched.denahImageData, label: "Denah gudang" };
  return null;
}

function useSignedPhoto(record, gudangList) {
  const [state, setState] = useState({ src: null, loading: false, error: false, legacy: false });
  useEffect(() => {
    let active = true;
    const legacy = findLegacyPhoto(record, gudangList);
    if (!record?.fotoPath) {
      setState({ src: legacy?.src || null, loading: false, error: false, legacy: Boolean(legacy) });
      return () => { active = false; };
    }
    const cached = photoUrlCache.get(record.fotoPath);
    if (cached && cached.expiresAt > Date.now()) {
      setState({ src: cached.src, loading: false, error: false, legacy: false });
      return () => { active = false; };
    }
    setState({ src: null, loading: true, error: false, legacy: false });
    createWarehouseCapacityPhotoUrl(record.fotoPath).then(src => {
      if (!active) return;
      if (src) photoUrlCache.set(record.fotoPath, { src, expiresAt: Date.now() + PHOTO_URL_TTL });
      setState({ src, loading: false, error: !src, legacy: false });
    }).catch(() => {
      if (active) setState({ src: legacy?.src || null, loading: false, error: true, legacy: Boolean(legacy) });
    });
    return () => { active = false; };
  }, [record?.fotoPath, record?.gudang, record?.matchedGudangId, gudangList]);
  return state;
}

function PhotoView({ record, gudangList, className = "" }) {
  const photo = useSignedPhoto(record, gudangList);
  const [retrySrc, setRetrySrc] = useState(null);
  const [broken, setBroken] = useState(false);
  const retryRef = useRef(false);
  useEffect(() => { retryRef.current = false; setRetrySrc(null); setBroken(false); }, [record?.fotoPath]);
  async function retrySignedUrl() {
    if (!record?.fotoPath || retryRef.current) { setBroken(true); return; }
    retryRef.current = true;
    try {
      const src = await createWarehouseCapacityPhotoUrl(record.fotoPath);
      if (!src) throw new Error("Signed URL kosong");
      photoUrlCache.set(record.fotoPath, { src, expiresAt: Date.now() + PHOTO_URL_TTL });
      setRetrySrc(src);
    } catch { setBroken(true); }
  }
  if (photo.loading) return <div className={`capacity-photo capacity-photo--loading ${className}`} aria-label="Memuat foto" />;
  if (photo.src && !broken) return <div className={`capacity-photo ${className}`}><img src={retrySrc || photo.src} alt={`Foto ${record.subGudang || "sub-gudang"}`} onError={retrySignedUrl} /><span className="capacity-photo__caption">{photo.legacy ? "Foto gudang umum" : "Foto sub-gudang"}</span></div>;
  return <div className={`capacity-photo capacity-photo--empty ${className}`}><ImageSquare size={30} aria-hidden /><span>{photo.error ? "Foto tidak dapat dimuat" : "Belum ada foto sub-gudang"}</span></div>;
}

function Field({ label, children, className = "" }) {
  return <label className={`capacity-field ${className}`}><span>{label}</span>{children}</label>;
}

function Metric({ label, value, tone = "" }) {
  return <div className={`capacity-metric ${tone ? `capacity-metric--${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function ModalShell({ children, title, eyebrow, onClose, wide = false }) {
  return <div className="capacity-modal-backdrop" onClick={() => onClose({ reason: "backdrop" })}>
    <section className={`capacity-modal ${wide ? "capacity-modal--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="capacity-modal-title" onClick={event => event.stopPropagation()}>
      <header className="capacity-modal__header"><div><span className="capacity-eyebrow">{eyebrow}</span><h2 id="capacity-modal-title">{title}</h2></div><button type="button" className="capacity-icon-button" aria-label="Tutup" onClick={() => onClose({ reason: "button" })}><X size={20} weight="bold" aria-hidden /></button></header>
      {children}
    </section>
  </div>;
}

export function KapasitasGudangTab({ gudangCapacityList, gudangCapacityImports = [], gudangList, subGudangList, lokasiList, stocks, currentUser, uptList = [], sty, C, setTab, setStockSubTab, showToast, onSynced, onSaveCapacityRow }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [filterUPT, setFilterUPT] = useState("ALL");
  const [petaUptFilter, setPetaUptFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [modal, setModal] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [photoDraft, setPhotoDraft] = useState(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = hasRole(currentUser, "ADMIN", "TL", "SUPERADMIN");
  const pendingImports = gudangCapacityImports.filter(item => item.status === "PENDING_ASMAN").length;
  const resetPhotoDraft = () => { setPhotoDraft(null); setPhotoRemoved(false); };
  const openDetail = record => { resetPhotoDraft(); setEditRecord(null); setModal({ mode: "detail", record }); };
  const openEdit = record => { setEditRecord({ ...record }); resetPhotoDraft(); setModal({ mode: "edit", record }); };
  const closeModal = reason => { if (!saving && !photoBusy) { if (!reason && modal?.mode === "edit" && modal.record) { setModal({ mode: "detail", record: modal.record }); setEditRecord(null); resetPhotoDraft(); return; } setModal(null); setEditRecord(null); resetPhotoDraft(); } };

  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try { setPhotoDraft({ dataUrl: await prepareWarehouseCapacityPhoto(file), fileName: file.name }); setPhotoRemoved(false); }
    catch (error) { showToast(error.message || "Foto tidak dapat diproses.", "error"); }
    finally { setPhotoBusy(false); }
  }

  async function saveEditRecord() {
    if (saving || pushing || !editRecord) return;
    if (photoBusy) return;
    setSaving(true);
    let uploadedPath = null;
    try {
      const luasLahanM2 = Number(editRecord.luasLahanM2);
      const validation = validateWarehouseCapacity({ ...editRecord, luasLahanM2 });
      if (!validation.valid) { showToast(validation.errors[0], "error"); return; }
      if (validation.warning) showToast(validation.warning, "warning");
      const derived = deriveWarehouseCapacity({ luasLahanM2, ...editRecord });
      const oldPhotoPath = editRecord.fotoPath || null;
      let fotoPath = Object.prototype.hasOwnProperty.call(editRecord, "fotoPath") ? editRecord.fotoPath : undefined;
      if (photoRemoved) fotoPath = null;
      if (photoDraft) { uploadedPath = await uploadWarehouseCapacityPhoto(photoDraft.dataUrl, editRecord.id); fotoPath = uploadedPath; }
      const updated = { ...editRecord, luasLahanM2, ...derived, ...(fotoPath !== undefined ? { fotoPath } : {}), statusKapasitas: statusFromUtil(derived.persentaseTerpakai), waktuUpdate: jakartaTimestamp() };
      const saved = await onSaveCapacityRow?.(updated);
      if (!saved) { if (uploadedPath) await removeWarehouseCapacityPhoto(uploadedPath).catch(() => {}); return; }
      if (oldPhotoPath && oldPhotoPath !== fotoPath) await removeWarehouseCapacityPhoto(oldPhotoPath).catch(() => {});
      setEditRecord(null); setModal({ mode: "detail", record: updated }); resetPhotoDraft();
      setPushing(true);
      try {
        const { data: preview, error: previewError } = await supabase.functions.invoke("push-kapasitas", { body: { rows: [toPushRow(updated)], dryRun: true } });
        if (previewError || preview?.error) throw new Error(preview?.error || previewError?.message || "Preview gagal");
        if (confirm(`Database sudah tersimpan. Sinkronkan ke Google Sheet?\n${preview.toUpdate} sel update, ${preview.toInsert} baris baru.`)) {
          const { data, error } = await supabase.functions.invoke("push-kapasitas", { body: { rows: [toPushRow(updated)] } });
          if (error || data?.error) throw new Error(data?.error || error?.message || "Push gagal");
          showToast("Database dan Google Sheet berhasil diperbarui.", "success");
        } else showToast("Database tersimpan. Sinkron Sheet dibatalkan.", "warning");
      } catch (error) { showToast(`Database tersimpan, tetapi Sheet gagal: ${error.message}`, "warning"); }
      finally { setPushing(false); }
    } catch (error) { if (uploadedPath) await removeWarehouseCapacityPhoto(uploadedPath).catch(() => {}); showToast(`Gagal menyimpan kapasitas: ${error.message}`, "error"); }
    finally { setSaving(false); }
  }

  function toPushRow(record) {
    return { upt: record.upt, gudang: record.gudang, sub_gudang: record.subGudang, type_gudang: record.typeGudang, alamat: record.alamat, latitude: record.latitude, longitude: record.longitude, luas_lahan_m2: record.luasLahanM2, luas_terpakai_m2: record.luasTerpakaiM2, sisa_luas_m2: record.sisaLuasM2, persentase_terpakai: record.persentaseTerpakai, persediaan_pct: record.persediaanPct, cadang_pct: record.cadangPct, pre_memory_pct: record.preMemoryPct, attb_pct: record.attbPct, lainnya_pct: record.lainnyaPct, contact_person: record.contactPerson, keterangan: record.keterangan, link_gudang: record.linkGudang };
  }

  async function syncFromSheet() {
    if (syncing) return;
    if (!confirm("Sinkron data kapasitas dari Google Sheet? Data kapasitas akan diperbarui.")) return;
    setSyncing(true);
    try { const { data, error } = await supabase.functions.invoke("sync-kapasitas", { method: "POST" }); const err = error || data?.error; if (err) { showToast(`Gagal sinkron: ${data?.error || error?.message || String(err)}`, "error"); return; } showToast(`Sinkron berhasil: ${data.kapasitas} kapasitas, ${data.gudang} gudang, ${data.sub_gudang} sub-gudang.`, "success"); await onSynced?.(); }
    catch (error) { showToast(`Gagal sinkron: ${error.message}`, "error"); } finally { setSyncing(false); }
  }

  async function pushToSheet() {
    if (saving || pushing || gudangCapacityList.length === 0) return;
    setPushing(true);
    try { const rows = gudangCapacityList.map(toPushRow); const { data: preview, error: previewError } = await supabase.functions.invoke("push-kapasitas", { body: { rows, dryRun: true } }); if (previewError || preview?.error) { showToast(`Gagal cek preview: ${preview?.error || previewError?.message}`, "error"); return; } if (!confirm(`Push ke Google Sheet?\n${preview.toUpdate} sel update, ${preview.toInsert} baris baru akan ditambah.`)) return; const { data, error } = await supabase.functions.invoke("push-kapasitas", { body: { rows } }); if (error || data?.error) { showToast(`Gagal push: ${data?.error || error?.message}`, "error"); return; } showToast(`Push berhasil: ${data.updated} sel diperbarui, ${data.inserted} baris baru ditambah.`, "success"); }
    catch (error) { showToast(`Gagal push: ${error.message}`, "error"); } finally { setPushing(false); }
  }

  const uptLabelList = [...new Set(gudangCapacityList.map(row => row.upt))].sort();
  const filtered = gudangCapacityList.filter(row => (filterUPT === "ALL" || row.upt === filterUPT) && (filterStatus === "ALL" || row.statusKapasitas === filterStatus));
  const petaScope = getScopeUptIds(currentUser, uptList);
  const petaUptOptions = petaScope === null ? uptList : (Array.isArray(petaScope) && petaScope.length > 1 ? uptList.filter(item => petaScope.includes(item.id)) : []);
  const petaGudangList = petaUptFilter ? gudangList.filter(item => item.uptId === petaUptFilter) : gudangList;
  const totalLahan = gudangCapacityList.reduce((sum, row) => sum + (Number(row.luasLahanM2) || 0), 0);
  const totalTerpakai = gudangCapacityList.reduce((sum, row) => sum + (Number(row.luasTerpakaiM2) || 0), 0);
  const totalSisa = totalLahan - totalTerpakai;
  const utilTotal = totalLahan > 0 ? totalTerpakai / totalLahan : 0;
  const kritis = gudangCapacityList.filter(row => row.statusKapasitas === "KRITIS").length;
  const waspada = gudangCapacityList.filter(row => row.statusKapasitas === "WASPADA").length;
  const aman = gudangCapacityList.filter(row => row.statusKapasitas === "AMAN").length;
  const uptRanking = Object.entries(gudangCapacityList.reduce((acc, row) => { if (!acc[row.upt]) acc[row.upt] = { lahan: 0, terpakai: 0 }; acc[row.upt].lahan += Number(row.luasLahanM2) || 0; acc[row.upt].terpakai += Number(row.luasTerpakaiM2) || 0; return acc; }, {})).map(([upt, value]) => ({ upt, util: value.lahan > 0 ? value.terpakai / value.lahan : 0, ...value })).sort((a, b) => b.util - a.util);
  const tabs = [{ id: "dashboard", label: "Ringkasan", caption: "KPI dan utilisasi" }, { id: "data", label: "Data Kapasitas", caption: "Luas dan pemakaian" }, { id: "peta", label: "Peta Utilisasi", caption: "Sebaran gudang" }];
  const detailRecord = modal?.mode === "detail" ? modal.record : null;
  const edit = modal?.mode === "edit" ? editRecord : null;

  return <div className="workspace-page capacity-page">
    <section className="capacity-hero" aria-label="Ringkasan kapasitas gudang"><div className="capacity-hero__top"><div><span className="capacity-eyebrow">Warehouse capacity</span><h1>Data Kapasitas Gudang</h1><p>Utilisasi luas gudang berbasis m², UIT JBM</p></div><div className="capacity-hero__actions">{hasRole(currentUser, "ADMIN") && <button type="button" className="capacity-button capacity-button--light" disabled={syncing} onClick={syncFromSheet}><ArrowClockwise size={17} className={syncing ? "capacity-spin" : ""} />{syncing ? "Menyinkronkan" : "Sinkron dari Sheet"}</button>}{canEdit && <button type="button" className="capacity-button capacity-button--light" disabled={saving || pushing} onClick={pushToSheet}><ArrowUp size={17} />{pushing ? "Mengirim" : "Push ke Google Sheet"}</button>}</div></div>{gudangCapacityList.length > 0 && <div className="capacity-hero__metrics"><Metric label="Total lahan" value={`${fmtNum(Math.round(totalLahan))} m²`} /><Metric label="Terpakai" value={`${fmtNum(Math.round(totalTerpakai))} m²`} /><Metric label="Sisa lahan" value={`${fmtNum(Math.round(totalSisa))} m²`} /><Metric label="Utilisasi" value={`${(utilTotal * 100).toFixed(1)}%`} tone={statusTone(statusFromUtil(utilTotal))} /><Metric label="Penuh" value={kritis} tone="critical" /><Metric label="Terbatas" value={waspada} tone="warning" /><Metric label="Cukup" value={aman} tone="safe" /></div>}</section>
    <div className="capacity-tabs" role="tablist" aria-label="Tampilan kapasitas gudang">{tabs.map(tab => <button key={tab.id} type="button" className={subTab === tab.id ? "is-active" : ""} onClick={() => setSubTab(tab.id)} role="tab" aria-selected={subTab === tab.id}><strong>{tab.label}</strong><span>{tab.caption}</span></button>)}</div>
    <div className="capacity-content">{syncing && <div className="capacity-sync-state"><ArrowClockwise size={18} className="capacity-spin" /> Memuat data kapasitas terbaru</div>}
      {subTab === "dashboard" && <div>{gudangCapacityList.length === 0 ? <div className="capacity-empty"><Warehouse size={40} aria-hidden /><h2>Data kapasitas belum tersedia</h2><p>{pendingImports > 0 ? `${pendingImports} file import menunggu approval Asman.` : "Import file KAPASITAS GUDANG UIT JBM melalui Master Data."}</p>{canEdit && <button type="button" className="capacity-button capacity-button--primary" onClick={() => { setTab("master"); setStockSubTab("gudang"); }}>Buka Master Gudang</button>}</div> : <div className="capacity-dashboard-grid"><section className="capacity-panel"><div className="capacity-panel__title"><ChartBar size={18} /> Ranking UPT</div>{uptRanking.map((item, index) => <div className="capacity-ranking-row" key={item.upt}><div><strong>#{index + 1} {item.upt}</strong><span>{fmtNum(Math.round(item.terpakai))} / {fmtNum(Math.round(item.lahan))} m²</span></div><div className="capacity-ranking-value"><strong>{(item.util * 100).toFixed(1)}%</strong><div className="capacity-progress"><i className={`is-${statusTone(statusFromUtil(item.util))}`} style={{ width: `${Math.min(100, item.util * 100)}%` }} /></div></div></div>)}</section><section className="capacity-panel"><div className="capacity-panel__title capacity-panel__title--critical"><WarningCircle size={18} /> Sub-gudang paling penuh</div>{gudangCapacityList.filter(row => row.statusKapasitas === "KRITIS").sort((a, b) => b.persentaseTerpakai - a.persentaseTerpakai).slice(0, 8).map(row => <button type="button" className="capacity-critical-row" key={row.id} onClick={() => openDetail(row)}><span><strong>{row.subGudang}</strong><small>{row.upt} · {row.gudang}</small></span><b>{percentLabel(row.persentaseTerpakai)}</b></button>)}{gudangCapacityList.every(row => row.statusKapasitas !== "KRITIS") && <p className="capacity-muted">Tidak ada sub-gudang penuh saat ini.</p>}</section></div>}</div>}
      {subTab === "data" && <div><div className="capacity-filterbar"><select aria-label="Filter UPT" value={filterUPT} onChange={event => setFilterUPT(event.target.value)}><option value="ALL">Semua UPT</option>{uptLabelList.map(item => <option key={item}>{item}</option>)}</select><select aria-label="Filter status" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="ALL">Semua status</option><option value="KRITIS">Penuh</option><option value="WASPADA">Terbatas</option><option value="AMAN">Cukup</option></select><span>{filtered.length} record</span></div><div className="capacity-data-list"><table><thead><tr>{["UPT", "Gudang", "Sub-gudang", "Luas lahan", "Terpakai", "Sisa", "Utilisasi", "Status", "Diperbarui", "Aksi"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr className="capacity-data-card" key={row.id}><td data-label="UPT"><strong>{row.upt}</strong></td><td data-label="Gudang">{row.gudang}</td><td data-label="Sub-gudang"><strong>{row.subGudang}</strong></td><td data-label="Luas lahan">{fmtNum(Math.round(row.luasLahanM2))} m²</td><td data-label="Terpakai">{fmtNum(Math.round(row.luasTerpakaiM2))} m²</td><td data-label="Sisa">{fmtNum(Math.round(row.sisaLuasM2))} m²</td><td data-label="Utilisasi"><div className="capacity-util-cell"><div className="capacity-progress"><i className={`is-${statusTone(row.statusKapasitas)}`} style={{ width: `${Math.min(100, row.persentaseTerpakai * 100)}%` }} /></div><strong>{percentLabel(row.persentaseTerpakai)}</strong></div></td><td data-label="Status"><span className={`capacity-status capacity-status--${statusTone(row.statusKapasitas)}`}>{KAPASITAS_LABEL[row.statusKapasitas] || row.statusKapasitas}</span></td><td data-label="Diperbarui">{row.waktuUpdate || "-"}</td><td data-label="Aksi"><div className="capacity-row-actions"><button type="button" className="capacity-button capacity-button--small" onClick={() => openDetail(row)}>Detail</button>{canEdit && <button type="button" className="capacity-button capacity-button--small capacity-button--primary" onClick={() => openEdit(row)}>Edit</button>}</div></td></tr>)}{filtered.length === 0 && <tr><td colSpan={10} className="capacity-table-empty">Tidak ada data</td></tr>}</tbody></table></div></div>}
      {subTab === "peta" && <PetaGudangTab gudangList={petaGudangList} subGudangList={subGudangList} lokasiList={lokasiList} stocks={stocks || []} sty={sty} C={C} gudangCapacityList={gudangCapacityList} uptOptions={petaUptOptions} uptFilter={petaUptFilter} setUptFilter={setPetaUptFilter} />}
    </div>
    {detailRecord && <ModalShell eyebrow="Detail sub-gudang" title={detailRecord.subGudang} onClose={closeModal} wide><div className="capacity-modal__meta">{detailRecord.upt} · {detailRecord.gudang}</div><PhotoView record={detailRecord} gudangList={gudangList} className="capacity-photo--hero" /><div className="capacity-detail-summary"><Metric label="Utilisasi" value={percentLabel(detailRecord.persentaseTerpakai)} tone={statusTone(detailRecord.statusKapasitas)} /><Metric label="Terpakai" value={areaLabel(detailRecord.luasTerpakaiM2)} /><Metric label="Sisa" value={areaLabel(detailRecord.sisaLuasM2)} /></div><div className="capacity-detail-grid">{[["UPT", detailRecord.upt], ["Gudang", detailRecord.gudang], ["Tipe", detailRecord.typeGudang || "-"], ["Alamat", detailRecord.alamat || "-"], ["Luas lahan", areaLabel(detailRecord.luasLahanM2)], ["Narahubung", detailRecord.contactPerson || "-"], ["Persediaan", percentLabel(detailRecord.persediaanPct)], ["Cadang", percentLabel(detailRecord.cadangPct)], ["Pre-Memory", percentLabel(detailRecord.preMemoryPct)], ["ATTB", percentLabel(detailRecord.attbPct)], ["Lainnya", percentLabel(detailRecord.lainnyaPct)], ["Total komposisi", percentLabel([detailRecord.persediaanPct, detailRecord.cadangPct, detailRecord.preMemoryPct, detailRecord.attbPct, detailRecord.lainnyaPct].reduce((sum, value) => sum + (Number(value) || 0), 0))]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{detailRecord.keterangan && <p className="capacity-note">{detailRecord.keterangan}</p>}{detailRecord.linkGudang && <a className="capacity-link" href={detailRecord.linkGudang} target="_blank" rel="noreferrer"><LinkSimple size={16} /> Buka link gudang</a>}{canEdit && <div className="capacity-modal__footer"><button type="button" className="capacity-button capacity-button--primary" onClick={() => openEdit(detailRecord)}><PencilSimple size={17} /> Edit data</button></div>}</ModalShell>}
    {edit && <ModalShell eyebrow="Edit sub-gudang" title={edit.subGudang} onClose={closeModal} wide><div className="capacity-modal__meta">{edit.upt} · {edit.gudang}</div><div className="capacity-editor-photo"><PhotoView record={photoDraft ? { ...edit, fotoPath: null } : edit} gudangList={gudangList} className="capacity-photo--editor" />{photoDraft && <img className="capacity-photo__draft" src={photoDraft.dataUrl} alt="Pratinjau foto baru" />}<div className="capacity-photo-actions"><label className="capacity-button capacity-button--secondary"><UploadSimple size={17} />{photoDraft || edit.fotoPath ? "Ganti foto" : "Upload foto"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectPhoto} hidden /></label>{(photoDraft || edit.fotoPath) && <button type="button" className="capacity-button capacity-button--danger" onClick={() => { setPhotoDraft(null); setPhotoRemoved(true); setEditRecord(record => ({ ...record, fotoPath: null })); }}><Trash size={17} /> Hapus foto</button>}</div><p className="capacity-photo-hint">Foto privat sub-gudang. Maksimal 5 MB sebelum kompresi.</p></div><div className="capacity-form-grid"><Field label="Luas lahan (m²)"><input type="number" min="0" step="any" value={edit.luasLahanM2 ?? 0} onChange={event => setEditRecord(record => ({ ...record, luasLahanM2: Number(event.target.value) || 0 }))} /></Field><div className="capacity-derived"><span>Luas terpakai otomatis</span><strong>{areaLabel(deriveWarehouseCapacity({ luasLahanM2: edit.luasLahanM2, ...edit }).luasTerpakaiM2)}</strong><small>Diambil dari total persentase komposisi</small></div>{[["Persediaan (%)", "persediaanPct"], ["Cadang (%)", "cadangPct"], ["Pre-Memory (%)", "preMemoryPct"], ["ATTB (%)", "attbPct"], ["Lainnya (%)", "lainnyaPct"]].map(([label, key]) => <Field label={label} key={key}><input type="number" min="0" max="100" step="any" value={(Number(edit[key]) || 0) * 100} onChange={event => setEditRecord(record => ({ ...record, [key]: (Number(event.target.value) || 0) / 100 }))} /></Field>)}<Field label="Narahubung"><input value={edit.contactPerson || ""} onChange={event => setEditRecord(record => ({ ...record, contactPerson: event.target.value }))} /></Field><Field label="Link gudang" className="capacity-field--wide"><input value={edit.linkGudang || ""} onChange={event => setEditRecord(record => ({ ...record, linkGudang: event.target.value }))} /></Field><Field label="Keterangan" className="capacity-field--wide"><textarea value={edit.keterangan || ""} onChange={event => setEditRecord(record => ({ ...record, keterangan: event.target.value }))} /></Field></div><div className="capacity-derived capacity-derived--summary"><span>Total komposisi</span><strong>{percentLabel(deriveWarehouseCapacity({ luasLahanM2: edit.luasLahanM2, ...edit }).persentaseTerpakai)}</strong><small>Maksimal 100%. Sisa luas dan status dihitung otomatis.</small></div><div className="capacity-modal__footer capacity-modal__footer--split"><button type="button" className="capacity-button capacity-button--secondary" disabled={saving || pushing || photoBusy} onClick={() => { if (detailRecord) setModal({ mode: "detail", record: detailRecord }); else closeModal(); }}>Batal</button><button type="button" className="capacity-button capacity-button--primary" disabled={saving || pushing || photoBusy} onClick={saveEditRecord}>{saving ? "Menyimpan" : "Simpan perubahan"}</button></div></ModalShell>}
  </div>;
}
