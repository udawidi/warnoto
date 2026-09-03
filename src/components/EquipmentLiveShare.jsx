// Layar operator "Sesi Kerja" (Live Location Alat Berat — BATCH 2, dulu "Lacak Alat"
// — rename framing 2026-09-03, key tab/perm "lacakAlat" sengaja TIDAK diubah). Satu
// kartu bersih TANPA peta/tile (hemat baterai) — peta live ada di sisi internal (Batch 3).
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { getUserUptScope, stripUptPrefix } from "../lib/roles.js";
import { uid } from "../lib/utils.js";
import { haversineMeters, pathDistance } from "../lib/geo.js";
import { getEquipmentCategory } from "../lib/heavyEquipment.js";

const CATEGORY_ICON = { crane: "🏗️", truck: "🚚", manlift: "🛗", forklift: "🚜", pendukung: "🔧" };

const SEND_THROTTLE_MS = 25000; // ponytail: fix 25s, per-akun jika perlu upgrade
const MIN_MOVE_M = 25; // distance-filter — skip kirim kalau geser <25m
const GEO_OPTS = { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 };

// Checklist inspeksi pra-kerja — satu daftar generik sama utk semua kategori alat.
// ponytail: item draft, user boleh revisi nanti; longgarin "semua wajib" kalau perlu.
const INSPEKSI_ALAT = [
  "Rem berfungsi", "Ban & tekanan baik", "Lampu & sein normal", "Oli/pelumas cukup",
  "Air radiator cukup", "Kaca spion lengkap", "Sabuk pengaman", "Klakson berfungsi",
  "Bahan bakar cukup", "Tidak ada kebocoran", "APAR tersedia", "Dokumen & SIM lengkap",
];

export function EquipmentLiveShare({ currentUser, uptList, heavyEquipmentList, sty, C, showToast }) {
  const upt = getUserUptScope(currentUser, uptList);
  // Cocokkan UPT dgn normalisasi stripUptPrefix (pola overlay agregat App.jsx) — e.upt
  // bisa ber-prefix "UPT " sedangkan getUserUptScope balik nama ter-strip; exact-match gagal.
  const uptKey = stripUptPrefix(upt);
  const units = (heavyEquipmentList || []).filter(e => e.tracked && stripUptPrefix(e.upt) === uptKey);

  const [equipmentId, setEquipmentId] = useState("");
  const [moving, setMoving] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [lastSentAt, setLastSentAt] = useState(null);
  const [pointCount, setPointCount] = useState(0);
  const [summary, setSummary] = useState(null); // ringkasan sesi setelah Stop
  const [geoError, setGeoError] = useState("");
  const [checks, setChecks] = useState(() => Array(INSPEKSI_ALAT.length).fill(false));

  const watchIdRef = useRef(null);
  const lastSentPointRef = useRef(null); // {lat,lng,sentAt}
  const pathRef = useRef([]); // [[lat,lng,ts]]
  const startedAtRef = useRef(null);
  const activeEquipmentIdRef = useRef(""); // unit yang sedang MOVING (untuk finalize saat ganti/unmount)
  const inspectionRef = useRef(null); // snapshot checklist saat Berangkat
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const mapDivRef = useRef(null);
  const wakeLockRef = useRef(null);

  useEffect(() => () => stopWatch(), []); // cleanup wajib saat unmount — jangan bocor GPS

  const allChecked = checks.every(Boolean);
  const toggleCheck = (i) => setChecks(prev => prev.map((v, idx) => idx === i ? !v : v));

  // Wake Lock — layar HP jangan sleep selama sesi MOVING (browser lepas otomatis
  // saat tab background, jadi re-acquire on visibilitychange).
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return; // ponytail: skip diam kalau tak didukung
    try { wakeLockRef.current = await navigator.wakeLock.request("screen"); } catch { /* bisa reject, abaikan */ }
  }
  useEffect(() => {
    if (!moving) return;
    requestWakeLock();
    const onVisible = () => { if (document.visibilityState === "visible") requestWakeLock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [moving]);

  // Peta live posisi terkini — tiru pola TripRouteMap (RiwayatPerjalananPanel.jsx).
  useEffect(() => {
    if (!moving || !mapDivRef.current || typeof window.L === "undefined") return;
    const map = window.L.map(mapDivRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    const start = pathRef.current[pathRef.current.length - 1] || [-7.2945, 112.7321];
    map.setView([start[0], start[1]], 16);
    markerRef.current = window.L.marker([start[0], start[1]]).addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [moving]);

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
        inspection: inspectionRef.current,
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
    markerRef.current?.setLatLng([lat, lng]);
    mapRef.current?.setView([lat, lng]);
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
    if (!allChecked) { showToast?.("Selesaikan checklist inspeksi dulu.", "error"); return; }
    if (!navigator.geolocation) { setGeoError("Perangkat tak dukung lokasi."); return; }
    if (!confirm("Sudah yakin ingin berangkat? Pastikan inspeksi sudah benar.")) return;
    if (moving) await stopTracking(); // guard: ganti unit saat MOVING → auto-Stop dulu

    setGeoError("");
    setSummary(null);
    pathRef.current = [];
    lastSentPointRef.current = null;
    setPointCount(0);
    startedAtRef.current = Date.now();
    activeEquipmentIdRef.current = equipmentId;
    inspectionRef.current = { at: Date.now(), items: INSPEKSI_ALAT.map((label, i) => ({ label, checked: checks[i] })) };
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
    setChecks(Array(INSPEKSI_ALAT.length).fill(false)); // wajib isi ulang checklist tiap sesi baru
  }

  // Stop dari tombol user → konfirmasi dulu. stopTracking() sendiri TIDAK konfirmasi
  // (dipakai juga oleh auto-Stop ganti-unit & cleanup unmount).
  function handleStopClick() {
    if (!confirm("Sudah yakin ingin berhenti bekerja? Lokasi terakhir akan dikunci.")) return;
    stopTracking();
  }
  // Kembali ke menu awal (pilih unit) setelah lihat ringkasan sesi.
  function mulaiLagi() { setSummary(null); setEquipmentId(""); }

  return (
    <div style={{ ...sty.card, maxWidth: 480, margin: "0 auto", padding: 18 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: C.text }}>Sesi Kerja</h2>
      <p style={{ margin: "0 0 18px", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
        Mulai sesi saat mengoperasikan unit — rute &amp; jarak tempuh tercatat otomatis.
      </p>

      {!units.length && (
        <div style={{ padding: 14, borderRadius: 14, background: "#fef3c7", color: "#92400e", fontSize: 13 }}>
          Belum ada unit alat berat yang diaktifkan untuk sesi kerja di UPT Anda.
        </div>
      )}

      {!!units.length && !summary && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={sty.label}>{equipmentId ? "Unit dipilih" : "Pilih unit"}</div>
            {equipmentId && !moving && (
              <button type="button" onClick={() => setEquipmentId("")} style={{ background: "none", border: "none", color: C.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 4 }}>Ganti unit</button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {(equipmentId && !moving ? units.filter(u => u.id === equipmentId) : units).map(u => {
              const selected = u.id === equipmentId;
              const icon = CATEGORY_ICON[getEquipmentCategory(u)] || "🔧";
              return (
                <button
                  key={u.id}
                  type="button"
                  disabled={moving && !selected}
                  onClick={() => setEquipmentId(u.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                    padding: 12, borderRadius: 14, cursor: moving && !selected ? "not-allowed" : "pointer",
                    background: selected ? `${C.accent}14` : C.surface,
                    border: `2px solid ${selected ? C.accent : C.border}`,
                    opacity: moving && !selected ? 0.5 : 1,
                    minHeight: 44,
                  }}
                >
                  <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 12, overflow: "hidden", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                    {u.foto ? <img src={u.foto} alt={u.nama} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{u.nama}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: `${C.accent}1a`, color: C.accent, textTransform: "capitalize" }}>{getEquipmentCategory(u)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {[u.merkType, u.kapasitas, u.nomorSeri].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  {selected && <span style={{ fontSize: 18, color: C.accent }}>✓</span>}
                </button>
              );
            })}
          </div>

          {geoError && <div style={{ margin: "8px 0", padding: 10, borderRadius: 12, background: "#fee2e2", color: "#991b1b", fontSize: 13 }}>{geoError}</div>}

          {!moving && equipmentId && (
            <>
              <div style={sty.label}>Checklist inspeksi pra-kerja</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {INSPEKSI_ALAT.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleCheck(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                      padding: "10px 12px", borderRadius: 12, cursor: "pointer", minHeight: 44,
                      background: checks[i] ? "#dcfce7" : C.surface,
                      border: `1.5px solid ${checks[i] ? "#16a34a" : C.border}`,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{checks[i] ? "✓" : "○"}</span>
                    <span style={{ fontSize: 13, color: C.text }}>{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {!moving ? (equipmentId && (
            <button disabled={!allChecked} style={{ ...sty.btn("primary"), width: "100%", minHeight: 48, borderRadius: 14, fontSize: 15, opacity: allChecked ? 1 : 0.5, cursor: allChecked ? "pointer" : "not-allowed" }} onClick={startTracking}>▶ Berangkat</button>
          )) : (
            <>
              <div style={{ margin: "12px 0", padding: 10, borderRadius: 12, background: "#dcfce7", color: "#166534", fontSize: 13 }}>🟢 Aktif</div>
              <div ref={mapDivRef} style={{ height: 260, borderRadius: 14, overflow: "hidden", marginBottom: 12 }} />
              <p style={{ margin: "0 0 12px", fontSize: 12, color: C.muted }}>
                {/* ponytail: batasan web — background beneran = native app, ditunda */}
                Biarkan layar &amp; app tetap terbuka selama bekerja.
              </p>
              <button style={{ ...sty.btn("danger"), width: "100%", minHeight: 48, borderRadius: 14, fontSize: 15 }} onClick={handleStopClick}>⏹ Stop</button>
            </>
          )}
        </>
      )}

      {summary && (
        <>
          <div style={{ padding: 16, borderRadius: 14, background: "#eff6ff", color: "#1e3a8a", fontSize: 14, lineHeight: 1.9, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>✅</div>
            <strong style={{ fontSize: 16 }}>Sesi selesai</strong>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8 }}>
              Durasi: <b>{Math.round(summary.durationMs / 60000)} menit</b><br />
              Jarak tempuh: <b>{summary.distanceKm.toFixed(2)} km</b><br />
              Titik terekam: <b>{summary.pointCount}</b>
            </div>
          </div>
          <button style={{ ...sty.btn("primary"), width: "100%", minHeight: 48, borderRadius: 14, fontSize: 15, marginTop: 12 }} onClick={mulaiLagi}>Mulai Pekerjaan Lagi</button>
        </>
      )}
    </div>
  );
}
