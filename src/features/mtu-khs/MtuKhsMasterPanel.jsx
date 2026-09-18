import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Plus, Trash, X } from "@phosphor-icons/react";
import { deleteMtuKhsMasterRow, friendlyMtuKhsError, loadMtuKhsMaster, saveMtuKhsMasterRow } from "./mtuKhsApi.js";

const label = item => item?.nama || item?.name || item?.id || "-";
const norm = value => String(value || "").trim().toLowerCase();
const blank = { name: "", code: "", lat: "", lng: "", mapSourceUrl: "" };
const coordOf = item => {
  const latText = String(item?.lat ?? "").trim(), lngText = String(item?.lng ?? "").trim();
  if (!latText || !lngText) return null;
  const lat = Number(latText), lng = Number(lngText);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
};
const rounded = value => Math.round(value * 1e6) / 1e6;
const osmPointUrl = ({ lat, lng }) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

export function MtuKhsMasterPanel({ currentUser, uptList = [], ultgList = [], onGiSaved }) {
  const [gis, setGis] = useState([]), [bays, setBays] = useState([]), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [uptId, setUptId] = useState(""), [ultgId, setUltgId] = useState(""), [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(null), [draft, setDraft] = useState(blank), [saving, setSaving] = useState(false);
  const [bayName, setBayName] = useState(""), [bayError, setBayError] = useState(""), [baySaving, setBaySaving] = useState(false);
  const mapDivRef = useRef(null), mapRef = useRef(null), markerRef = useRef(null);
  const canManage = ["SUPERADMIN", "ADMIN_LOG_PUSAT", "ADMIN_UIT", "TL"].includes(currentUser?.role);
  const ownUpt = currentUser?.role === "TL" ? (currentUser.uptId || currentUser.upt_id || "") : "";
  const editableUpts = ownUpt ? uptList.filter(item => item.id === ownUpt) : uptList;

  async function refresh() {
    const [giResult, bayResult] = await Promise.all([
      loadMtuKhsMaster("mtu_khs_gardu_induk", { user: currentUser, uptList }),
      loadMtuKhsMaster("mtu_khs_gardu_induk_bay", { user: currentUser, uptList }),
    ]);
    if (giResult.error || bayResult.error) { setError(friendlyMtuKhsError(giResult.error || bayResult.error)); return; }
    setGis(giResult.data || []); setBays(bayResult.data || []);
  }
  useEffect(() => { refresh(); }, [currentUser, uptList]);
  useEffect(() => { if (ownUpt) setUptId(ownUpt); }, [ownUpt]);

  const ultgMap = useMemo(() => new Map(ultgList.map(item => [item.id, item])), [ultgList]);
  const uptMap = useMemo(() => new Map(uptList.map(item => [item.id, item])), [uptList]);
  const parentUpt = gi => gi.uptId || ultgMap.get(gi.ultgId)?.parentUptId || ultgMap.get(gi.ultgId)?.uptId || "";
  const visible = useMemo(() => gis.filter(gi => (!uptId || parentUpt(gi) === uptId) && (!ultgId || gi.ultgId === ultgId) && (!query || norm([label(gi), gi.kode, gi.code, gi.id].join(" ")).includes(norm(query))) && (!missing || !coordOf(gi))), [gis, uptId, ultgId, query, missing, ultgMap]);
  const selectedBays = editing ? bays.filter(item => item.garduIndukId === editing.id) : [];
  const editorPeers = useMemo(() => editing ? gis.filter(item => item.id !== editing.id && (item.ultgId === editing.ultgId || parentUpt(item) === parentUpt(editing))) : [], [editing, gis, ultgMap]);
  const mapStart = coordOf(draft) || coordOf(editorPeers[0]) || { lat: -7.2575, lng: 112.7521 };

  function open(gi) {
    setError(""); setBayError(""); setBayName("");
    const next = gi ? { ...gi, isNew: false } : { id: `GI-${Date.now()}`, isNew: true, uptId: ownUpt, ultgId: "" };
    setEditing(next);
    setDraft(gi ? { name: label(gi), code: gi.kode || gi.code || "", lat: gi.lat ?? "", lng: gi.lng ?? "", mapSourceUrl: gi.mapSourceUrl || "" } : blank);
  }
  const setValue = (key, value) => { setError(""); setDraft(previous => ({ ...previous, [key]: value })); };

  async function save() {
    if (!canManage) return;
    const name = draft.name.trim(), latText = String(draft.lat).trim(), lngText = String(draft.lng).trim();
    if (!name) return setError("Nama GI wajib diisi");
    if (!editing.ultgId) return setError("ULTG wajib dipilih");
    if ((latText === "") !== (lngText === "")) return setError("Latitude dan longitude harus diisi berpasangan");
    const lat = latText ? Number(latText) : null, lng = lngText ? Number(lngText) : null;
    if (latText && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) return setError("Koordinat tidak valid");
    const src = draft.mapSourceUrl.trim();
    if (src) { try { const parsed = new URL(src); if (parsed.protocol !== "https:" || !parsed.hostname) throw Error(); } catch { return setError("Sumber peta harus URL HTTPS yang valid"); } }
    setSaving(true);
    const { isNew: _isNew, ...identity } = editing;
    const row = { ...identity, nama: name, name, normalizedName: norm(name), kode: draft.code.trim(), code: draft.code.trim(), lat, lng, mapSourceUrl: src || null };
    const result = await saveMtuKhsMasterRow("mtu_khs_gardu_induk", row);
    setSaving(false);
    if (result.error) return setError(friendlyMtuKhsError(result.error));
    onGiSaved?.(row); await refresh(); setEditing(null);
  }

  async function addBay() {
    if (!canManage || !editing?.id) return;
    const name = bayName.trim(); if (!name) return setBayError("Nama Bay wajib diisi");
    setBaySaving(true); setBayError("");
    const result = await saveMtuKhsMasterRow("mtu_khs_gardu_induk_bay", { id: `BAY-${Date.now()}`, garduIndukId: editing.id, nama: name, normalizedName: norm(name), active: true });
    setBaySaving(false);
    if (result.error) return setBayError(friendlyMtuKhsError(result.error));
    setBayName(""); await refresh();
  }
  async function removeBay(id) {
    if (!canManage) return;
    setBayError(""); const result = await deleteMtuKhsMasterRow("mtu_khs_gardu_induk_bay", id);
    if (result.error) return setBayError(friendlyMtuKhsError(result.error));
    await refresh();
  }

  useEffect(() => {
    const node = mapDivRef.current;
    if (!editing || !node || typeof window.L === "undefined") return undefined;
    const map = window.L.map(node, { scrollWheelZoom: false }).setView([mapStart.lat, mapStart.lng], coordOf(draft) ? 15 : 11);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    const updateFromClick = event => {
      if (!canManage) return;
      const lat = rounded(event.latlng.lat), lng = rounded(event.latlng.lng);
      setDraft(previous => ({ ...previous, lat: String(lat), lng: String(lng), mapSourceUrl: osmPointUrl({ lat, lng }) }));
      setError("");
    };
    if (canManage) map.on("click", updateFromClick);
    requestAnimationFrame(() => map.invalidateSize());
    return () => { map.off("click", updateFromClick); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [editing?.id, canManage]);

  useEffect(() => {
    const map = mapRef.current, coord = coordOf(draft);
    if (!map) return;
    if (!coord) { if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; } return; }
    if (!markerRef.current) markerRef.current = window.L.marker([coord.lat, coord.lng]).addTo(map);
    else markerRef.current.setLatLng([coord.lat, coord.lng]);
  }, [draft.lat, draft.lng]);

  return <section className="mtu-khs-master-panel">
    <div className="mtu-khs-master-panel__head"><span className="mtu-khs-eyebrow">Master data</span><h2>Gardu Induk / GI</h2><p>Cari GI, pilih satu, lalu buka editor.</p></div>
    <div className="mtu-khs-gi-toolbar"><input aria-label="Cari GI" placeholder="Cari nama atau kode GI" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Filter UPT" value={uptId} onChange={event => { setUptId(event.target.value); setUltgId(""); }}><option value="">Semua UPT</option>{editableUpts.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select><select aria-label="Filter ULTG" value={ultgId} onChange={event => setUltgId(event.target.value)}><option value="">Semua ULTG</option>{ultgList.filter(item => !uptId || (item.parentUptId || item.uptId) === uptId).map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select><label className="mtu-khs-check"><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)} /> Belum ada titik</label>{canManage && <button type="button" className="approval-btn approval-btn--primary" onClick={() => open()}><Plus size={17} /> GI baru</button>}</div>
    {error && !editing && <p className="mtu-khs-alert mtu-khs-alert--error">{error}</p>}
    <div className="mtu-khs-gi-list"><div className="mtu-khs-gi-list__count">{visible.length} GI ditemukan</div>{visible.map(gi => <button type="button" className="mtu-khs-gi-card" key={gi.id} onClick={() => open(gi)}><span><strong>{label(gi)}</strong><small>{gi.kode || gi.code || "Tanpa kode"} · {label(ultgMap.get(gi.ultgId))} · {label(uptMap.get(parentUpt(gi)))}</small></span><span className={`mtu-khs-status ${coordOf(gi) ? "mtu-khs-status--green" : "mtu-khs-status--yellow"}`}>{coordOf(gi) ? "Ada titik" : "Belum ada titik"}</span></button>)}{!visible.length && <p className="mtu-khs-muted">GI tidak ditemukan.</p>}</div>
    {editing && <div className="mtu-khs-gi-editor-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !saving && setEditing(null)}><aside className="mtu-khs-gi-editor" role="dialog" aria-modal="true" aria-labelledby="mtu-khs-gi-editor-title">
      <header><div><span className="mtu-khs-eyebrow">{editing.isNew ? "Tambah GI" : "Edit GI"}</span><h2 id="mtu-khs-gi-editor-title">{editing.isNew ? "Gardu Induk baru" : label(editing)}</h2></div><button className="mtu-khs-icon-button" type="button" aria-label="Tutup" onClick={() => !saving && setEditing(null)}><X size={20} /></button></header>
      <div className="mtu-khs-gi-editor__body">{error && <p className="mtu-khs-alert mtu-khs-alert--error">{error}</p>}<div className="mtu-khs-editor-fields">
        <label>Nama GI<input disabled={!canManage} value={draft.name} onChange={event => setValue("name", event.target.value)} /></label><label>Kode GI<input disabled={!canManage} value={draft.code} onChange={event => setValue("code", event.target.value)} /></label>
        {editing.isNew ? <><label>UPT<select disabled={!canManage} value={editing.uptId || ""} onChange={event => setEditing(previous => ({ ...previous, uptId: event.target.value, ultgId: "" }))}><option value="">Pilih UPT</option>{editableUpts.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label><label>ULTG<select disabled={!canManage} value={editing.ultgId || ""} onChange={event => setEditing(previous => ({ ...previous, ultgId: event.target.value }))}><option value="">Pilih ULTG</option>{ultgList.filter(item => !editing.uptId || (item.parentUptId || item.uptId) === editing.uptId).map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label></> : <div className="mtu-khs-readonly"><span>UPT / ULTG</span><strong>{label(uptMap.get(parentUpt(editing)))} · {label(ultgMap.get(editing.ultgId))}</strong></div>}
        <label>Latitude<input disabled={!canManage} type="number" step="any" min="-90" max="90" value={draft.lat} onChange={event => setValue("lat", event.target.value)} /></label><label>Longitude<input disabled={!canManage} type="number" step="any" min="-180" max="180" value={draft.lng} onChange={event => setValue("lng", event.target.value)} /></label><label className="mtu-khs-editor-fields__wide">Sumber peta (HTTPS)<input disabled={!canManage} type="url" value={draft.mapSourceUrl} onChange={event => setValue("mapSourceUrl", event.target.value)} /></label>
      </div><div ref={mapDivRef} className="mtu-khs-map-preview__canvas" role="application" aria-label="Peta lokasi GI" />{coordOf(draft) && <a className="mtu-khs-map-preview__link" href={osmPointUrl(coordOf(draft))} target="_blank" rel="noreferrer"><MapPin size={15} /> Buka peta</a>}
      <section className="mtu-khs-bay-section"><h3>Bay ({selectedBays.length})</h3>{canManage && <div className="mtu-khs-bay-add"><input aria-label="Nama Bay baru" placeholder="Nama Bay" value={bayName} onChange={event => { setBayName(event.target.value); setBayError(""); }} /><button type="button" onClick={addBay} disabled={baySaving}><Plus size={15} /> {baySaving ? "Menyimpan..." : "Tambah Bay"}</button></div>}{bayError && <p className="mtu-khs-alert mtu-khs-alert--error">{bayError}</p>}{selectedBays.map(item => <div className="mtu-khs-bay-row" key={item.id}><span>{label(item)}</span>{canManage && <button type="button" aria-label={`Hapus ${label(item)}`} onClick={() => removeBay(item.id)}><Trash size={16} /></button>}</div>)}</section></div>
      <footer><button type="button" className="approval-btn" onClick={() => setEditing(null)} disabled={saving}>Tutup</button>{canManage && <button type="button" className="approval-btn approval-btn--primary" onClick={save} disabled={saving}>{saving ? "Menyimpan..." : "Simpan GI"}</button>}</footer>
    </aside></div>}
  </section>;
}
