import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CaretDown, Funnel, MagnifyingGlass, Package, Warehouse, WarningCircle } from "@phosphor-icons/react";
import { OperationsHero } from "../../components/OperationsHero.jsx";
import { hasRole } from "../../lib/roles.js";
import { decideMtuKhsChange, decideMtuKhsImport, friendlyMtuKhsError, loadApprovedTugItems, loadMtuKhsDocuments, loadMtuKhsPendingChanges, loadMtuKhsPendingImports, loadMtuKhsRecords, loadMtuKhsUsage, linkApprovedTugUsage, promoteMtuKhsImport, registerMtuKhsDocument, submitMtuKhsChange } from "./mtuKhsApi.js";
import { filterMtuRecords, isMtuNationalRole, MTU_KHS_LIFECYCLE_LABEL, sameYearDrawing } from "./mtuKhsModel.js";
import { MtuKhsDetail } from "./MtuKhsDetail.jsx";
import { MtuKhsImportPanel } from "./MtuKhsImportPanel.jsx";
import "./mtuKhs.css";

const years = ["", "2024", "2026"];
const statusColors = { VENDOR: "blue", IN_TRANSIT: "yellow", WAREHOUSE: "purple", ON_SITE: "orange", INSTALLED: "green", PLANNED_ARRIVAL: "yellow", CANCELLED: "neutral" };
const text = value => value == null || value === "" ? "-" : String(value);

export function MtuKhsTab({ currentUser, uptList = [], ultgList = [], gudangList = [], supplierList = [], katalogList = [], C, sty, isMobile }) {
  const [records, setRecords] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [usage, setUsage] = useState([]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("monitoring");
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  const [vendor, setVendor] = useState("");
  const [upt, setUpt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [changeDraft, setChangeDraft] = useState(null);
  const [pendingChanges, setPendingChanges] = useState([]);
  const [pendingImports, setPendingImports] = useState([]);
  const [approvedImports, setApprovedImports] = useState([]);
  const [approvedTugItems, setApprovedTugItems] = useState([]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    Promise.all([loadMtuKhsRecords({ user: currentUser, uptList, year: year || undefined }), loadMtuKhsDocuments(), loadMtuKhsPendingChanges(), loadMtuKhsPendingImports("REVIEW"), loadMtuKhsPendingImports("APPROVED"), loadApprovedTugItems()])
      .then(([recordResult, documentResult, changesResult, importsResult, approvedResult, tugResult]) => {
        if (!alive) return;
        setRecords(recordResult.data || []); setDocuments(documentResult.data || []); setPendingChanges(changesResult.data || []); setPendingImports(importsResult.data || []); setApprovedImports(approvedResult.data || []); setApprovedTugItems(tugResult.data || []);
        if (recordResult.error) setError(friendlyMtuKhsError(recordResult.error));
      }).catch(caught => alive && setError(friendlyMtuKhsError(caught)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [currentUser, uptList, year, refreshKey]);

  const scopeRecords = useMemo(() => filterMtuRecords(records, currentUser, uptList), [records, currentUser, uptList]);
  const vendors = useMemo(() => [...new Set(scopeRecords.map(record => record.vendor).filter(Boolean))].sort(), [scopeRecords]);
  const uptOptions = useMemo(() => uptList.filter(item => isMtuNationalRole(currentUser) || filterMtuRecords([{ uptId: item.id }], currentUser, uptList).length).sort((a, b) => String(a.nama).localeCompare(String(b.nama))), [currentUser, uptList]);
  const filtered = useMemo(() => scopeRecords.filter(record => {
    const haystack = [record.materialName, record.materialDescription, record.catalogNumber, record.mtuCode, record.vendor, record.giName, record.bayName, record.noKontrak, record.uptName].join(" ").toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (!year || String(record.procurementYear) === year) && (!status || record.lifecycleStatus === status) && (!vendor || record.vendor === vendor) && (!upt || record.uptId === upt);
  }), [scopeRecords, search, year, status, vendor, upt]);
  const metrics = useMemo(() => ({ total: filtered.length, qty: filtered.reduce((total, record) => total + (record.physicalQty || 0), 0), onsite: filtered.filter(record => ["ON_SITE", "INSTALLED"].includes(record.lifecycleStatus)).length, installed: filtered.filter(record => record.lifecycleStatus === "INSTALLED").length, drawing: filtered.filter(record => !documents.some(document => (document.recordId === record.id || document.record_id === record.id || sameYearDrawing(record, document)) && document.url)).length }), [filtered, documents]);
  const canChange = hasRole(currentUser, "TL", "PENGADAAN");
  const canImport = hasRole(currentUser, "PENGADAAN", "ADMIN_LOG_PUSAT", "SUPERADMIN");
  const canDecideImport = hasRole(currentUser, "ASMAN_LOG_UIT", "SUPERADMIN");
  const canRegisterDocument = hasRole(currentUser, "PENGADAAN", "SUPERADMIN");
  const canLinkUsage = hasRole(currentUser, "TL", "PENGADAAN", "SUPERADMIN");
  const scopeLabel = isMtuNationalRole(currentUser) ? "Nasional" : uptList.filter(item => filterMtuRecords([{ uptId: item.id }], currentUser, uptList).length).map(item => item.nama).join(", ") || "Scope akun";

  async function openDetail(record) {
    setSelected(record);
    const result = await loadMtuKhsUsage(record.id);
    setUsage(result.data || []);
  }
  async function requestChange(record) {
    setChangeDraft({ record, location: record.location || "", onsiteDate: record.onsiteDate || "", installationStatus: record.installationStatus || "", installationPlanDate: record.installationPlanDate || "", installationDate: record.installationDate || "", vendor: record.vendor || "", noKontrak: record.noKontrak || "", tanggalKontrak: record.tanggalKontrak || "", noSpmk: record.noSpmk || "", tanggalSerahTerima: record.tanggalSerahTerima || "", price: record.price || "", mtuCode: record.mtuCode || "", note: "" });
  }
  async function submitChangeDraft() {
    const { record, note, ...fields } = changeDraft || {};
    if (!record) return setChangeDraft(null);
    const editable = currentUser?.role === "PENGADAAN" ? ["vendor","noKontrak","tanggalKontrak","noSpmk","tanggalSerahTerima","price","mtuCode"] : ["location","onsiteDate","installationStatus","installationPlanDate","installationDate"];
    const patch = Object.fromEntries(editable.filter(key => String(fields[key] ?? "") !== String(record[key] ?? "")).map(key => [key, String(fields[key] ?? "").trim()]));
    if (!Object.keys(patch).length) return setChangeDraft(null);
    patch.reason = note.trim() || "Update data MTU";
    const result = await submitMtuKhsChange({ recordId: record.id, expectedVersion: record.version || 1, patch, currentUser });
    if (result.error) setError(result.error.message || "Perubahan belum terkirim");
    else setError("Perubahan diajukan dan menunggu approval.");
    setChangeDraft(null);
  }
  return <div className="mtu-khs-page">
    <OperationsHero eyebrow="Material Transmisi Utama" title="MTU KHS" description="Satu workspace untuk pengadaan, lokasi, onsite, pemasangan, drawing, dan pemakaian material." scope={scopeLabel} metrics={[{ label: "Record", value: metrics.total }, { label: "Qty fisik", value: metrics.qty }, { label: "Onsite", value: metrics.onsite }, { label: "Terpasang", value: metrics.installed }, { label: "Drawing belum ada", value: metrics.drawing, alert: metrics.drawing > 0 }]} controls={<button type="button" className="approval-btn approval-btn--secondary" onClick={() => setRefreshKey(value => value + 1)}><ArrowClockwise size={17} /> Refresh</button>} />
    <div className="mtu-khs-tabs" role="tablist"><button type="button" className={view === "monitoring" ? "is-active" : ""} onClick={() => setView("monitoring")}>Monitoring MTU</button>{canImport && <button type="button" className={view === "import" ? "is-active" : ""} onClick={() => setView("import")}>Import & Review</button>}{["ASMAN", "ASMAN_LOG_UIT", "SUPERADMIN", "ADMIN_LOG_PUSAT"].includes(currentUser?.role) && <button type="button" className={view === "approvals" ? "is-active" : ""} onClick={() => setView("approvals")}>Approval</button>}</div>
    {view === "import" && <MtuKhsImportPanel C={C} uptList={uptList} ultgList={ultgList} gudangList={gudangList} supplierList={supplierList} katalogList={katalogList} currentUser={currentUser} onParsed={() => setError("")} />}
    {view === "approvals" && <section className="mtu-khs-import-panel"><span className="mtu-khs-eyebrow">Decision center</span><h2>Approval MTU KHS</h2>{pendingChanges.length === 0 && pendingImports.length === 0 && approvedImports.length === 0 && <p className="mtu-khs-muted">Tidak ada pengajuan yang menunggu approval.</p>}{pendingChanges.map(change => <div className="mtu-khs-approval-row" key={change.id}><div><strong>{change.record_id}</strong><small>{change.requester_role} → {change.approver_role}</small></div><div className="mtu-khs-dialog-actions"><button type="button" className="approval-btn approval-btn--secondary" onClick={async () => { const result = await decideMtuKhsChange({ changeId: change.id, decision: "REJECTED" }); if (result.error) setError(friendlyMtuKhsError(result.error)); else setPendingChanges(items => items.filter(item => item.id !== change.id)); }}>Tolak</button><button type="button" className="approval-btn approval-btn--primary" onClick={async () => { const result = await decideMtuKhsChange({ changeId: change.id, decision: "APPROVED" }); if (result.error) setError(friendlyMtuKhsError(result.error)); else setPendingChanges(items => items.filter(item => item.id !== change.id)); }}>Setujui</button></div></div>)}{pendingImports.map(batch => <div className="mtu-khs-approval-row" key={batch.id}><div><strong>Import {batch.procurement_year}</strong><small>{batch.source_file} · {batch.uit_id || "UIT belum dipilih"}</small></div>{canDecideImport && <div className="mtu-khs-dialog-actions"><button type="button" className="approval-btn approval-btn--primary" onClick={async () => { const approved = await decideMtuKhsImport(batch.id, "APPROVED"); if (approved.error) setError(friendlyMtuKhsError(approved.error)); else setPendingImports(items => items.filter(item => item.id !== batch.id)); }}>Setujui batch</button></div>}</div>)}{approvedImports.map(batch => <div className="mtu-khs-approval-row" key={batch.id}><div><strong>Import siap commit {batch.procurement_year}</strong><small>{batch.source_file} · {batch.uit_id || "UIT belum dipilih"}</small></div>{canImport && <button type="button" className="approval-btn approval-btn--primary" onClick={async () => { const committed = await promoteMtuKhsImport(batch.id); if (committed.error) setError(friendlyMtuKhsError(committed.error)); else setApprovedImports(items => items.filter(item => item.id !== batch.id)); }}>Commit batch</button>}</div>)}</section>}
    {view === "monitoring" && <>
      <section className="mtu-khs-filter-bar" aria-label="Filter MTU KHS"><div className="mtu-khs-search"><MagnifyingGlass size={18} /><input aria-label="Cari MTU" placeholder="Cari material, kode, kontrak, GI..." value={search} onChange={event => setSearch(event.target.value)} /></div><button type="button" className="approval-btn approval-btn--secondary mtu-khs-mobile-filter" onClick={() => setMobileFilters(value => !value)}><Funnel size={17} /> Filter</button><div className={`mtu-khs-filters${mobileFilters ? " is-open" : ""}`}><select aria-label="Tahun" value={year} onChange={event => setYear(event.target.value)}>{years.map(option => <option key={option} value={option}>{option || "Semua tahun"}</option>)}</select><select aria-label="UPT" value={upt} onChange={event => setUpt(event.target.value)}><option value="">Semua UPT</option>{uptOptions.map(option => <option key={option.id} value={option.id}>{option.nama}</option>)}</select><select aria-label="Vendor" value={vendor} onChange={event => setVendor(event.target.value)}><option value="">Semua vendor</option>{vendors.map(option => <option key={option} value={option}>{option}</option>)}</select><select aria-label="Status lokasi" value={status} onChange={event => setStatus(event.target.value)}><option value="">Semua status</option>{Object.entries(MTU_KHS_LIFECYCLE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></section>
      {error && <div className="mtu-khs-alert mtu-khs-alert--info"><WarningCircle size={18} /> {error}</div>}
      {loading ? <div className="mtu-khs-state"><div className="mtu-khs-skeleton" /><div className="mtu-khs-skeleton" /><div className="mtu-khs-skeleton" /></div> : filtered.length === 0 ? <div className="mtu-khs-state"><Package size={32} /><strong>{records.length ? "Tidak ada record sesuai filter" : "Data MTU KHS belum tersedia"}</strong><p>{records.length ? "Ubah filter atau pencarian." : "Import workbook 2024/2026 melalui tab Import & Review setelah migration aktif."}</p></div> : <div className="mtu-khs-table-wrap mobile-card-table"><table><thead><tr><th>Material / Kode</th><th>Vendor</th><th>UPT · GI / Bay</th><th>Qty</th><th>Status</th><th>Drawing</th><th>Aksi</th></tr></thead><tbody>{filtered.map(record => { const hasDrawing = documents.some(document => (document.recordId === record.id || document.record_id === record.id) && document.url); return <tr key={record.id} tabIndex={0} className="mobile-card-table__row" onDoubleClick={() => openDetail(record)}><td data-label="Material" className="mobile-card-table__title"><strong>{text(record.materialName || record.mtuCode)}</strong><small>{text(record.mtuCode)} · KHS {text(record.procurementYear)}</small></td><td data-label="Vendor">{text(record.vendor)}</td><td data-label="Lokasi"><strong>{text(record.uptName)}</strong><small>{text(record.giName)} / {text(record.bayName)}</small></td><td data-label="Qty" className="is-key"><strong>{record.physicalQty || 0}</strong><small>{text(record.unit || "unit")}</small></td><td data-label="Status"><span className={`mtu-khs-status mtu-khs-status--${statusColors[record.lifecycleStatus] || "neutral"}`}>{MTU_KHS_LIFECYCLE_LABEL[record.lifecycleStatus] || record.lifecycleStatus}</span></td><td data-label="Drawing">{hasDrawing ? <span className="mtu-khs-status mtu-khs-status--green">PDF tersedia</span> : <span className="mtu-khs-muted">Belum tersedia</span>}</td><td data-label="Aksi"><button type="button" className="table-action-button" onClick={() => openDetail(record)}>Lihat detail <CaretDown size={15} /></button></td></tr>; })}</tbody></table></div>}
    </>}
    {selected && <MtuKhsDetail record={selected} documents={documents.filter(document => document.recordId === selected.id || document.record_id === selected.id || sameYearDrawing(selected, document))} usage={usage} approvedTugItems={approvedTugItems} canEdit={canChange} canRegisterDocument={canRegisterDocument} canLinkUsage={canLinkUsage} onClose={() => setSelected(null)} onSubmit={requestChange} onRegisterDocument={async (recordId, draft) => { const result = await registerMtuKhsDocument({ recordId, title: draft.title, url: draft.url, revision: draft.revision }); if (result.error) setError(friendlyMtuKhsError(result.error)); else setRefreshKey(value => value + 1); }} onLinkUsage={async (recordId, tugItemId, qty) => { const result = await linkApprovedTugUsage({ recordId, tugItemId, qty }); if (result.error) setError(friendlyMtuKhsError(result.error)); else { setError("Link TUG approved tersimpan."); const next = await loadMtuKhsUsage(recordId); setUsage(next.data || []); } }} C={C} sty={sty} />}
    {changeDraft && <div className="mtu-khs-detail-backdrop" role="presentation"><section className="mtu-khs-change-dialog" role="dialog" aria-modal="true" aria-labelledby="mtu-change-title"><h2 id="mtu-change-title">Ajukan perubahan MTU</h2><p className="mtu-khs-muted">Field kosong berarti clear intent dan tetap melalui approval.</p>{(currentUser?.role === "PENGADAAN" ? [["vendor","Vendor"],["noKontrak","No. kontrak"],["tanggalKontrak","Tanggal kontrak"],["noSpmk","No. SPMK"],["tanggalSerahTerima","Delivery"],["price","Harga"],["mtuCode","Kode MTU"]] : [["location","Lokasi"],["onsiteDate","Tanggal onsite"],["installationStatus","Status pemasangan"],["installationPlanDate","Rencana pemasangan"],["installationDate","Tanggal terpasang"]]).map(([key, title], index) => <label key={key}>{title}<input autoFocus={index === 0} value={changeDraft[key] || ""} onChange={event => setChangeDraft(draft => ({ ...draft, [key]: event.target.value }))} /></label>)}<label>Catatan<textarea value={changeDraft.note} onChange={event => setChangeDraft(draft => ({ ...draft, note: event.target.value }))} /></label><div className="mtu-khs-dialog-actions"><button type="button" className="approval-btn approval-btn--secondary" onClick={() => setChangeDraft(null)}>Batal</button><button type="button" className="approval-btn approval-btn--primary" onClick={submitChangeDraft}>Kirim untuk approval</button></div></section></div>}
  </div>;
}
