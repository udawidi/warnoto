// Riwayat Perjalanan Alat Berat (Live Location — BATCH 3a). Sisi internal: list trip
// equipment_trip + klik baris untuk gambar rute (polyline Leaflet) start→stop.
// Fetch on-demand (bukan bootstrap App.jsx) — trip bukan data yang dibutuhkan tiap layar,
// hemat 1 query dari load awal (pola sama alasan tug3LoadPromise on-demand lain di App.jsx).
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { fmtDate } from "../lib/utils.js";

function TripRouteMap({ trip, onClose }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!divRef.current || typeof window.L === "undefined") return;
    const path = Array.isArray(trip.path) ? trip.path : [];
    const map = window.L.map(divRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    if (path.length > 0) {
      const latlngs = path.map(p => [p[0], p[1]]);
      window.L.polyline(latlngs, { color: "#2563eb", weight: 4 }).addTo(map);
      window.L.marker(latlngs[0], { icon: window.L.divIcon({ html: '<div style="width:16px;height:16px;border-radius:50%;background:#16a34a;border:2px solid white;"></div>', className: "", iconSize: [16, 16] }) }).addTo(map).bindPopup("Start");
      window.L.marker(latlngs[latlngs.length - 1], { icon: window.L.divIcon({ html: '<div style="width:16px;height:16px;border-radius:50%;background:#dc2626;border:2px solid white;"></div>', className: "", iconSize: [16, 16] }) }).addTo(map).bindPopup("Stop");
      map.fitBounds(latlngs, { padding: [24, 24], maxZoom: 16 });
    } else {
      map.setView([-7.2945, 112.7321], 12);
    }
    setTimeout(() => map.invalidateSize(), 100);
    return () => { map.remove(); mapRef.current = null; };
  }, [trip]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div role="dialog" aria-label="Rute Perjalanan" style={{ background: "#fff", borderRadius: 14, width: 640, maxWidth: "100%", padding: 16 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Rute Perjalanan</strong>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div ref={divRef} style={{ height: 360, borderRadius: 10, overflow: "hidden" }} />
      </div>
    </div>
  );
}

export function RiwayatPerjalananPanel({ active, equipmentList, users, uptScopeFilter, sty, C }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!active || loadedRef.current || !supabase) return;
    loadedRef.current = true;
    setLoading(true);
    supabase.from("equipment_trip").select("*").order("started_at", { ascending: false }).limit(300)
      .then(({ data, error }) => { if (!error) setTrips(data || []); })
      .finally(() => setLoading(false));
  }, [active]);

  const scopedTrips = uptScopeFilter ? trips.filter(t => t.upt === uptScopeFilter) : trips;

  return (
    <div>
      <div className="operations-section-heading"><div><span>Trip History</span><h2>Riwayat Perjalanan</h2></div><small>{scopedTrips.length} sesi</small></div>
      {loading && <div style={{ ...sty.card, textAlign: "center", color: C.muted, padding: 20, fontSize: 13 }}>Memuat riwayat…</div>}
      {!loading && scopedTrips.length === 0 && <div style={{ ...sty.card, textAlign: "center", color: C.muted, padding: 20, fontSize: 13 }}>Belum ada riwayat perjalanan.</div>}
      {!loading && scopedTrips.length > 0 && (
        <div style={{ ...sty.card, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {scopedTrips.map(t => {
              const unit = equipmentList.find(e => e.id === t.equipment_id);
              const operator = users.find(u => u.id === t.operator_id);
              const durasiMin = t.ended_at && t.started_at ? Math.round((t.ended_at - t.started_at) / 60000) : "-";
              const jarakKm = ((t.distance_m || 0) / 1000).toFixed(2);
              return (
                <div key={t.id} onClick={() => setSelectedTrip(t)} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: 12, borderBottom: `1px solid ${C.border}`, cursor: "pointer", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{unit?.nama || t.equipment_id}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(t.started_at)} • {operator?.name || "-"} • {t.upt || "-"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 14, fontSize: 12, color: C.muted }}>
                    <span>Durasi: <b style={{ color: C.text }}>{durasiMin}{durasiMin !== "-" ? " mnt" : ""}</b></span>
                    <span>Jarak: <b style={{ color: C.text }}>{jarakKm} km</b></span>
                    <span>Titik: <b style={{ color: C.text }}>{t.point_count ?? (Array.isArray(t.path) ? t.path.length : "-")}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {selectedTrip && <TripRouteMap trip={selectedTrip} onClose={() => setSelectedTrip(null)} />}
    </div>
  );
}
