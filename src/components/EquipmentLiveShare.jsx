// Layar operator "Lacak Alat" (Live Location Alat Berat — BATCH 2). Satu kartu
// bersih TANPA peta/tile (hemat baterai) — peta live ada di sisi internal (Batch 3).
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { getUserUptScope } from "../lib/roles.js";
import { uid } from "../lib/utils.js";
import { haversineMeters, pathDistance } from "../lib/geo.js";

const SEND_THROTTLE_MS = 25000; // ponytail: fix 25s, per-akun jika perlu upgrade
const MIN_MOVE_M = 25; // distance-filter — skip kirim kalau geser <25m
const GEO_OPTS = { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 };

export function EquipmentLiveShare({ currentUser, uptList, heavyEquipmentList, sty, C, showToast }) {
  const upt = getUserUptScope(currentUser, uptList);
  const units = (heavyEquipmentList || []).filter(e => e.tracked && e.upt === upt);

  const [equipmentId, setEquipmentId] = useState("");
  const [moving, setMoving] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [lastSentAt, setLastSentAt] = useState(null);
  const [pointCount, setPointCount] = useState(0);
  const [summary, setSummary] = useState(null); // ringkasan sesi setelah Stop
  const [geoError, setGeoError] = useState("");

  const watchIdRef = useRef(null);
  const lastSentPointRef = useRef(null); // {lat,lng,sentAt}
  const pathRef = useRef([]); // [[lat,lng,ts]]
  const startedAtRef = useRef(null);
  const activeEquipmentIdRef = useRef(""); // unit yang sedang MOVING (untuk finalize saat ganti/unmount)

  useEffect(() => () => stopWatch(), []); // cleanup wajib saat unmount — jangan bocor GPS

  function stopWatch() {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }

  async function finalizeTrip(eqId) {
    if (!eqId) return;
    const path = pathRef.current;
    const distanceM = pathDistance(path);
    const startedAt = startedAtRef.current || Date.now();
    const endedAt = Date.now();
    try {
      await supabase.from("equipment_location").upsert({
        equipment_id: eqId, updated_at: endedAt, updated_by: currentUser?.id, upt, status: "STOPPED",
      }, { onConflict: "equipment_id" });
      await supabase.from("equipment_trip").insert({
        id: uid(), equipment_id: eqId, operator_id: currentUser?.id, upt,
        started_at: startedAt, ended_at: endedAt, distance_m: distanceM, point_count: path.length, path,
      });
    } catch (e) {
      showToast?.("Gagal menyimpan riwayat perjalanan: " + (e?.message || e), "error");
    }
    return { durationMs: endedAt - startedAt, distanceKm: distanceM / 1000, pointCount: path.length };
  }

  function handlePosition(pos) {
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
    setAccuracy(acc);
    const now = Date.now();

    const last = lastSentPointRef.current;
    const movedEnough = !last || haversineMeters(last.lat, last.lng, lat, lng) >= MIN_MOVE_M;
    const throttleOk = !last || now - last.sentAt >= SEND_THROTTLE_MS;
    if (!movedEnough || !throttleOk) return; // titik tak lolos filter — tak dikirim & tak masuk path

    lastSentPointRef.current = { lat, lng, sentAt: now };
    setLastSentAt(now);
    pathRef.current.push([lat, lng, now]);
    setPointCount(pathRef.current.length);
    supabase.from("equipment_location").upsert({
      equipment_id: activeEquipmentIdRef.current, lat, lng, accuracy: acc,
      updated_at: now, updated_by: currentUser?.id, upt, status: "MOVING",
    }, { onConflict: "equipment_id" }).then(({ error }) => {
      if (error) showToast?.("Gagal kirim posisi: " + error.message, "error");
    });
  }

  function handleGeoError(err) {
    setGeoError(err.code === 1 ? "Aktifkan izin lokasi di browser." : "Gagal membaca lokasi: " + err.message);
  }

  async function startTracking() {
    if (!equipmentId) { showToast?.("Pilih unit dulu.", "error"); return; }
    if (!navigator.geolocation) { setGeoError("Perangkat tak dukung lokasi."); return; }
    if (moving) await stopTracking(); // guard: ganti unit saat MOVING → auto-Stop dulu

    setGeoError("");
    setSummary(null);
    pathRef.current = [];
    lastSentPointRef.current = null;
    setPointCount(0);
    startedAtRef.current = Date.now();
    activeEquipmentIdRef.current = equipmentId;
    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleGeoError, GEO_OPTS);
    setMoving(true);
  }

  async function stopTracking() {
    stopWatch();
    const eqId = activeEquipmentIdRef.current;
    setMoving(false);
    const result = await finalizeTrip(eqId);
    if (result) setSummary(result);
    activeEquipmentIdRef.current = "";
  }

  const secsAgo = lastSentAt ? Math.round((Date.now() - lastSentAt) / 1000) : null;

  return (
    <div style={{ ...sty.card, maxWidth: 480, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: C.text }}>Lacak Alat</h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: C.muted }}>Bagikan lokasi unit yang sedang Anda operasikan.</p>

      {!units.length && (
        <div style={{ padding: 12, borderRadius: 10, background: "#fef3c7", color: "#92400e", fontSize: 13 }}>
          Belum ada unit alat berat berstatus "Lacak lokasi" di UPT Anda.
        </div>
      )}

      {!!units.length && (
        <>
          <label style={sty.label}>Unit yang dipakai
            <select style={sty.select} value={equipmentId} disabled={moving} onChange={e => setEquipmentId(e.target.value)}>
              <option value="">Pilih unit…</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.nama} {u.merkType ? `(${u.merkType})` : ""}</option>)}
            </select>
          </label>

          {geoError && <div style={{ margin: "8px 0", padding: 10, borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontSize: 13 }}>{geoError}</div>}

          {!moving ? (
            <button style={{ ...sty.btn("primary"), width: "100%", marginTop: 12 }} onClick={startTracking}>▶ Mulai Kerja</button>
          ) : (
            <>
              <div style={{ margin: "12px 0", padding: 12, borderRadius: 10, background: "#dcfce7", color: "#166534", fontSize: 13, lineHeight: 1.7 }}>
                🟢 Sedang melacak…<br />
                Akurasi: {accuracy != null ? `${Math.round(accuracy)} m` : "-"}<br />
                Terkirim: {secsAgo != null ? `${secsAgo} dtk lalu` : "belum ada"}<br />
                Titik terekam: {pointCount}
              </div>
              <button style={{ ...sty.btn("danger"), width: "100%" }} onClick={stopTracking}>⏹ Stop</button>
            </>
          )}
        </>
      )}

      {summary && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "#eff6ff", color: "#1e3a8a", fontSize: 13, lineHeight: 1.7 }}>
          <strong>Ringkasan sesi</strong><br />
          Durasi: {Math.round(summary.durationMs / 60000)} menit<br />
          Jarak: {summary.distanceKm.toFixed(2)} km<br />
          Jumlah titik: {summary.pointCount}
        </div>
      )}
    </div>
  );
}
