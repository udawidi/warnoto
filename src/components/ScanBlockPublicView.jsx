// Halaman baca-saja stok satu blok gudang dari QR publik.
// Token ada di URL fragment (#t=...), jadi tidak dikirim ke server sebagai query/referrer.
import { useEffect, useState } from "react";
import { MapPin, Package, Warning, ArrowClockwise } from "@phosphor-icons/react";
import { SUPABASE_KEY, SUPABASE_URL, fetchSupabase } from "../supabaseClient.js";
import { sapBadgeStyleForLabel } from "../lib/sap.js";

export function getPublicBlockScanParams(search = "", hash = "") {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  return { lokasiId: query.get("loc") || "", token: fragment.get("t") || "" };
}

function formatQty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(n) : "-";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ScanBlockPublicView({ lokasiId: lokasiIdProp, token: tokenProp } = {}) {
  const [state, setState] = useState({ loading: true, error: "", block: null });
  const [reloadKey, setReloadKey] = useState(0);
  const params = typeof window !== "undefined" ? getPublicBlockScanParams(window.location.search, window.location.hash) : { lokasiId: "", token: "" };
  const lokasiId = lokasiIdProp || params.lokasiId;
  const token = tokenProp || params.token;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!lokasiId || !token) {
        setState({ loading: false, error: "QR blok tidak lengkap. Gunakan QR terbaru dari Master Gudang.", block: null });
        return;
      }
      if (!UUID_RE.test(token)) {
        setState({ loading: false, error: "Token QR blok tidak valid. Gunakan QR terbaru dari Master Gudang.", block: null });
        return;
      }
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        setState({ loading: false, error: "Supabase belum dikonfigurasi.", block: null });
        return;
      }
      try {
        const response = await fetchSupabase(`${SUPABASE_URL}/rest/v1/rpc/public_block_stock`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_lokasi_id: lokasiId, p_token: token }),
        });
        if (!response.ok) {
          if (response.status === 404) throw new Error("Fitur QR publik belum aktif. Terapkan migrasi database terlebih dahulu.");
          throw new Error("Server tidak dapat membaca data blok.");
        }
        const raw = await response.json();
        const block = Array.isArray(raw) ? raw[0] : raw;
        if (cancelled) return;
        if (!block) {
          setState({ loading: false, error: "QR blok tidak valid atau sudah tidak berlaku.", block: null });
          return;
        }
        setState({ loading: false, error: "", block: { ...block, materials: Array.isArray(block.materials) ? block.materials : [] } });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error?.message || "Data blok tidak dapat ditampilkan.", block: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [lokasiId, token, reloadKey]);

  const page = { minHeight: "100dvh", background: "#eef2f7", fontFamily: "Inter,system-ui,sans-serif", padding: "14px 12px calc(40px + env(safe-area-inset-bottom))" };
  const shell = { maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 };
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 6px 20px -12px rgba(15,23,42,.35)" };

  if (state.loading) return <div style={page}><div style={shell}><div style={{ ...card, padding: 20, textAlign: "center", color: "#64748b", fontSize: 13 }}>Memuat stok blok…</div></div></div>;
  if (state.error) return (
    <div style={page}><div style={shell}>
      <div style={{ ...card, padding: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Warning size={22} weight="fill" color="#dc2626" />
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>Data blok tidak tersedia</div><div style={{ marginTop: 4, color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>{state.error}</div><button type="button" onClick={() => { setState({ loading: true, error: "", block: null }); setReloadKey(value => value + 1); }} style={{ marginTop: 14, minHeight: 44, border: "1px solid #bfdbfe", borderRadius: 10, background: "#eff6ff", color: "#1d4ed8", padding: "8px 12px", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}><ArrowClockwise size={16} weight="bold" /> Coba lagi</button></div>
      </div>
    </div></div>
  );

  const { block } = state;
  return (
    <div style={page}>
      <div style={shell}>
        <section style={{ ...card, padding: "18px 16px", background: "linear-gradient(120deg,#0b2559,#1d4ed8)", color: "#fff", border: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, opacity: .86 }}><MapPin size={17} weight="fill" /> LOKASI BLOK GUDANG</div>
          <h1 style={{ margin: "10px 0 4px", fontSize: 22, lineHeight: 1.2 }}>{block.blok || "Blok"}</h1>
          <div style={{ fontSize: 14, fontWeight: 700, opacity: .92 }}>{block.gudang || "Gudang"}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: .82 }}>{[block.upt, block.subgudang].filter(Boolean).join(" · ") || "Lokasi gudang"}</div>
          <div style={{ marginTop: 14, fontSize: 12, opacity: .78 }}>Data live · baca-saja · diperbarui dari server</div>
        </section>
        <section style={{ ...card, padding: "14px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 14, fontWeight: 800, color: "#0f172a" }}><Package size={17} weight="fill" color="#1d4ed8" /> Stok positif di blok ini</div>
          {block.materials.length === 0 ? <div style={{ padding: "16px 8px", color: "#64748b", fontSize: 13, textAlign: "center" }}>Belum ada stok positif di blok ini.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {block.materials.map((material, index) => (
                <div key={`${material.katalog || "material"}-${index}`} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 11px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.35, color: "#0f172a", overflowWrap: "anywhere" }}>{material.nama || "Material"}</div><div style={{ marginTop: 3, fontSize: 11, color: "#64748b" }}>{material.katalog || "-"}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>{(() => { const label = material.sapLabel || "Belum tersedia"; const bs = sapBadgeStyleForLabel(label); return <><span style={{ background: bs.bg, color: bs.fg, borderRadius: 999, padding: "2px 7px", fontSize: 10, fontWeight: 800 }}>Status: {label}</span><span style={{ background: "#f1f5f9", color: "#475569", borderRadius: 999, padding: "2px 7px", fontSize: 10, fontWeight: 700 }}>Jenis: {material.jenisBarang || "-"}</span></>; })()}</div></div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}><div style={{ fontSize: 17, fontWeight: 800, color: "#047857", fontVariantNumeric: "tabular-nums" }}>{formatQty(material.qty)}</div><div style={{ fontSize: 11, color: "#64748b" }}>{material.satuan || "unit"}</div></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
