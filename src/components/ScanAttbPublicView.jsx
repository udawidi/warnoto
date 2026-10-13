import { useEffect, useState } from "react";
import { Warning, ArrowClockwise, QrCode } from "@phosphor-icons/react";
import { SUPABASE_KEY, SUPABASE_URL, fetchSupabase } from "../supabaseClient.js";
import { attbPhotoUrl, parseAttbPublicParams } from "../lib/attbTrace.js";

export function ScanAttbPublicView({ attbId: idProp, token: tokenProp } = {}) {
  const params = typeof window === "undefined" ? { attbId: "", token: "" } : parseAttbPublicParams(window.location.search, window.location.hash);
  const attbId = idProp || params.attbId; const token = tokenProp || params.token;
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const load = () => { setState({ loading: true, error: "", data: null });
    if (!attbId || !token || !SUPABASE_URL || !SUPABASE_KEY) { setState({ loading: false, error: "QR ATTB tidak lengkap atau Supabase belum dikonfigurasi.", data: null }); return; }
    fetchSupabase(`${SUPABASE_URL}/rest/v1/rpc/public_attb_material`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_attb_id: attbId, p_token: token }) })
      .then(async r => { if (!r.ok) throw new Error("QR ATTB tidak dapat dibaca."); return r.json(); }).then(raw => { const data = Array.isArray(raw) ? raw[0] : raw; setState(data ? { loading: false, error: "", data } : { loading: false, error: "QR ATTB tidak valid atau sudah tidak berlaku.", data: null }); }).catch(e => setState({ loading: false, error: e.message, data: null }));
  };
  useEffect(load, [attbId, token]);
  const s = { maxWidth: 560, margin: "0 auto", padding: 16, fontFamily: "Inter,system-ui,sans-serif" };
  if (state.loading) return <main style={s}>Memuat data ATTB…</main>;
  if (state.error) return <main style={s}><section><Warning size={22} color="#dc2626" /> <b>Data ATTB tidak tersedia</b><p>{state.error}</p><button onClick={load}><ArrowClockwise size={15} /> Coba lagi</button></section></main>;
  const d = state.data; const m = d.material || {}; const loc = d.location || {}; const photos = d.photos || {};
  return <main style={s}><header style={{ background: "#0b2559", color: "white", padding: 18, borderRadius: 14 }}><QrCode size={20} /><h1 style={{ fontSize: 22, margin: "8px 0" }}>{d.trackingCode || "ATTB"}</h1><div>{d.status || "-"}</div></header><section><h2>{m.name || "Material"}</h2><p>Katalog: {m.catalog || "-"} · Satuan: {m.unit || "-"}</p><p>Seri: {m.serial || "-"} · Aset: {m.assetNo || "-"}</p><p>Lokasi: {[loc.upt, loc.gudang, loc.subGudang, loc.blok].filter(Boolean).join(" / ") || "-"}</p>{[attbPhotoUrl(photos.overall, SUPABASE_URL), attbPhotoUrl(photos.nameplate, SUPABASE_URL)].filter(Boolean).map((p,i)=><img key={p} src={p} alt={i ? "Nameplate" : "Material"} style={{ width: "48%", maxHeight: 220, objectFit: "cover", marginRight: 6 }} />)}</section><section><h3>Riwayat unit</h3>{(d.timeline || []).map((e,i)=><div key={`${e.at}-${i}`} style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>{e.label || "Perubahan"}<small style={{ display: "block", color: "#64748b" }}>{e.at ? new Date(e.at).toLocaleString("id-ID") : "-"}</small></div>)}</section></main>;
}
