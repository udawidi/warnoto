// Komponen ScanPublicView — dipindah dari App.jsx (refactor Fase 4d).
import { useState, useEffect } from "react";
import { C } from "../theme.js";
import { SUPABASE_URL, SUPABASE_KEY } from "../supabaseClient.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { fmtDateOnly } from "../lib/utils.js";

// Dibuka lewat URL "?scan=<katalogId>". Ambil data langsung dari Supabase
// (anon key, read-only) — TIDAK butuh login/state aplikasi, supaya siapa pun
// yang scan QR fisik di rak bisa langsung lihat riwayat material itu dari HP.
export function ScanPublicView({ katalogId }) {
  const [state, setState] = useState({ loading:true, error:"", katalog:null, qty:0, history:[] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        setState({ loading:false, error:"Supabase belum dikonfigurasi.", katalog:null, qty:0, history:[] });
        return;
      }
      const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
      try {
        const [katRes, histRes, stockRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/katalog?id=eq.${encodeURIComponent(katalogId)}&select=*`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/tug15_history?katalog_id=eq.${encodeURIComponent(katalogId)}&select=*&order=tanggal.asc,id.asc`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/stock_current?katalog_id=eq.${encodeURIComponent(katalogId)}&select=qty`, { headers }),
        ]);
        if (!katRes.ok || !histRes.ok || !stockRes.ok) throw new Error("Gagal ambil data dari server.");
        const [katArr, histArr, stockArr] = await Promise.all([katRes.json(), histRes.json(), stockRes.json()]);
        if (cancelled) return;
        if (katArr.length === 0) {
          setState({ loading:false, error:"Material dengan kode ini tidak ditemukan.", katalog:null, qty:0, history:[] });
          return;
        }
        // Hitung Sisa MUNDUR dari qty stok nyata saat ini (stock_current, ground
        // truth), sama seperti buildKartuGantungHistory di web — bukan dijumlah
        // maju dari 0, supaya baris terbaru selalu pas dengan qty sebenarnya.
        const currentQty = stockArr[0]?.qty || 0;
        const historyWithSisa = new Array(histArr.length); // histArr sudah urut tanggal.asc,id.asc
        let running = currentQty;
        for (let i = histArr.length - 1; i >= 0; i--) {
          const h = histArr[i];
          historyWithSisa[i] = { ...h, sisa: running };
          running -= (h.jenis_transaksi === "MASUK" ? h.qty : -h.qty);
        }
        const katRow = katArr[0];
        const katFlat = { ...(katRow.data||{}), id: katRow.id };
        setState({ loading:false, error:"", katalog:katFlat, qty:currentQty, history:historyWithSisa });

        // Log scan ke stock_scan_log — fire-and-forget, tidak menunggu/menghalangi
        // tampilan (kalau gagal, cukup diam, jangan ganggu pengalaman user yang
        // cuma mau lihat stok). Mendukung banyak orang scan barcode berbeda-beda
        // secara bersamaan di gudang (2026-07-03) — device_id membedakan tiap HP
        // karena halaman ini sengaja tanpa login.
        try {
          let deviceId = localStorage.getItem("warnoto_scan_device_id");
          if (!deviceId) {
            deviceId = "DEV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
            localStorage.setItem("warnoto_scan_device_id", deviceId);
          }
          fetch(`${SUPABASE_URL}/rest/v1/stock_scan_log`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify([{ katalog_id: katalogId, device_id: deviceId }]),
          }).catch(() => {});
        } catch {}
      } catch (err) {
        if (!cancelled) setState({ loading:false, error:err.message, katalog:null, qty:0, history:[] });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [katalogId]);

  const wrap = { minHeight:"100vh", background:"#f1f5f9", fontFamily:"'Inter',system-ui,sans-serif", padding:16 };
  const card = { background:"white", borderRadius:14, padding:18, boxShadow:"0 4px 16px rgba(0,0,0,0.08)", maxWidth:560, margin:"0 auto" };

  if (state.loading) return <div style={wrap}><div style={card}>⏳ Memuat riwayat...</div></div>;
  if (state.error) return <div style={wrap}><div style={card}><b style={{color:"#dc2626"}}>⚠️ {state.error}</b></div></div>;

  const { katalog, qty, history } = state;
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{fontSize:12,color:"#6b7280",fontWeight:700,letterSpacing:.5}}>PT PLN (PERSERO) UPT SURABAYA — WARNOTO</div>
        <h2 style={{fontSize:17,fontWeight:800,margin:"4px 0 2px"}}>🏷️ {katalog.name}</h2>
        <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>No. Katalog: {katalog.katalog||"-"} • Satuan: {katalog.satuan||"-"} • {katalog.jenisBarang||"-"}</div>
        {katalog.fotoKeseluruhanUrl && (
          <img src={katalog.fotoKeseluruhanUrl} alt="Foto Material Keseluruhan" style={{width:"100%",maxHeight:220,objectFit:"cover",borderRadius:10,marginBottom:14,border:"1px solid #e5e7eb"}}/>
        )}
        <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:10,padding:"10px 14px",marginBottom:16,textAlign:"center"}}>
          <div style={{fontSize:12,color:"#047857",fontWeight:700}}>QTY STOK SAAT INI</div>
          <div style={{fontSize:26,fontWeight:800,color:"#047857"}}>{fmtNum(qty)}</div>
        </div>
        <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8}}>📋 Riwayat Mutasi (TUG-2)</div>
        {history.length===0 && <div style={{fontSize:12,color:"#9ca3af",textAlign:"center",padding:14}}>Belum ada riwayat mutasi untuk material ini.</div>}
        {history.length>0 && (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5}}>
              <thead>
                <tr style={{background:C.sidebar,color:"white"}}>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>TGL</th>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>NO. BON</th>
                  <th style={{padding:"5px 6px",textAlign:"center"}}>MASUK</th>
                  <th style={{padding:"5px 6px",textAlign:"center"}}>KELUAR</th>
                  <th style={{padding:"5px 6px",textAlign:"center"}}>SISA</th>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>RAK</th>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>CATATAN</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #f1f5f9"}}>
                    <td style={{padding:"4px 6px"}}>{fmtDateOnly(h.tanggal)}</td>
                    <td style={{padding:"4px 6px"}}>{h.no_bon||"-"}</td>
                    <td style={{padding:"4px 6px",textAlign:"center",color:"#16a34a",fontWeight:700}}>{h.jenis_transaksi==="MASUK"?fmtNum(h.qty):""}</td>
                    <td style={{padding:"4px 6px",textAlign:"center",color:"#dc2626",fontWeight:700}}>{h.jenis_transaksi==="KELUAR"?fmtNum(h.qty):""}</td>
                    <td style={{padding:"4px 6px",textAlign:"center",fontWeight:700}}>{fmtNum(h.sisa)}</td>
                    <td style={{padding:"4px 6px"}}>{h.lokasi_kode||"-"}</td>
                    <td style={{padding:"4px 6px",color:"#6b7280"}}>{h.catatan||"-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
