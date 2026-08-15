// Komponen ScanPublicView — dipindah dari App.jsx (refactor Fase 4d).
import { useState, useEffect } from "react";
import { ArrowDown, ArrowUp, ClockCounterClockwise, MapPin, Package, Warning } from "@phosphor-icons/react";
import { SUPABASE_URL, SUPABASE_KEY } from "../supabaseClient.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { fmtDateOnly } from "../lib/utils.js";

// Dibuka lewat URL "?scan=<katalogId>". Ambil data langsung dari Supabase
// (anon key, read-only) — TIDAK butuh login/state aplikasi, supaya siapa pun
// yang scan QR fisik di rak bisa langsung lihat riwayat material itu dari HP.
export function ScanPublicView({ katalogId }) {
  const [state, setState] = useState({ loading:true, error:"", katalog:null, qty:0, history:[] });
  const [showAll, setShowAll] = useState(false);

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

  // Tampilan sengaja mobile-first: halaman ini hampir selalu dibuka dari HP di
  // depan rak sesudah scan QR fisik. Riwayat dirender kartu, bukan tabel 7 kolom —
  // di layar HP tabel itu terpaksa 10.5px dan tetap harus digeser ke samping.
  const page = { minHeight:"100dvh", background:"#eef2f7", fontFamily:"'Inter',system-ui,sans-serif", padding:"14px 12px calc(84px + env(safe-area-inset-bottom))" };
  const shell = { maxWidth:560, margin:"0 auto", display:"flex", flexDirection:"column", gap:12 };
  const card = { background:"#fff", border:"1px solid #e2e8f0", borderRadius: 14, boxShadow:"0 6px 20px -12px rgba(15,23,42,.35)" };

  if (state.loading) {
    return <div style={page}><div style={shell}><div style={{...card,padding:20,fontSize:13,color: "#64748b",textAlign:"center"}}>Memuat data material…</div></div></div>;
  }
  if (state.error) {
    return (
      <div style={page}><div style={shell}>
        <div style={{...card,padding:20,display:"flex",gap:10,alignItems:"flex-start"}}>
          <Warning size={22} weight="fill" color="#dc2626"/>
          <div>
            <div style={{fontSize:13,fontWeight:800,color:"#0f172a"}}>Data tidak bisa ditampilkan</div>
            <div style={{fontSize:13,color: "#64748b",marginTop:2}}>{state.error}</div>
          </div>
        </div>
      </div></div>
    );
  }

  const { katalog, qty, history } = state;
  const newest = [...history].reverse();
  const totalMasuk = history.reduce((a,h)=>a+(h.jenis_transaksi==="MASUK"?Number(h.qty)||0:0),0);
  const totalKeluar = history.reduce((a,h)=>a+(h.jenis_transaksi==="KELUAR"?Number(h.qty)||0:0),0);
  const last = newest[0];
  const rakTerakhir = newest.find(h=>h.lokasi_kode)?.lokasi_kode || "-";
  const satuan = katalog.satuan || "";
  // lokasiPublik dititipkan ke katalog.data waktu sinkron (supabaseSync.js) — tabel
  // gudang/lokasi sendiri tidak bisa dibaca tanpa login. Kalau belum tersinkron,
  // jatuh ke kode rak dari riwayat mutasi.
  const lokasiPublik = Array.isArray(katalog.lokasiPublik) ? katalog.lokasiPublik : [];
  // Cadangan kalau lokasiPublik belum tersinkron: rekap posisi dari riwayat
  // mutasi yang memang dibaca publik — net masuk-keluar per kode blok. Angkanya
  // perkiraan (dilabeli begitu di UI), tapi jauh lebih berguna daripada satu
  // baris "belum tersinkron".
  const lokasiRiwayat = [];
  if (lokasiPublik.length === 0) {
    const map = new Map();
    history.forEach(h => {                       // history urut tanggal.asc
      if (!h.lokasi_kode) return;
      const cur = map.get(h.lokasi_kode) || { blok:h.lokasi_kode, qty:0, terakhir:h.tanggal };
      cur.qty += (h.jenis_transaksi==="MASUK" ? 1 : -1) * (Number(h.qty)||0);
      cur.terakhir = h.tanggal;
      map.set(h.lokasi_kode, cur);
    });
    lokasiRiwayat.push(...[...map.values()].filter(l=>l.qty>0).sort((a,b)=>b.qty-a.qty));
  }
  const hariSejakMutasi = history.length ? Math.floor((Date.now() - new Date(history[history.length-1].tanggal).getTime()) / 86400000) : null;
  const masukTerakhir = newest.find(h=>h.jenis_transaksi==="MASUK");
  const asalDok = { TUG3:"Penerimaan dari pengadaan (TUG-3)", TUG10:"Pengembalian dari pekerjaan (TUG-10)" }[masukTerakhir?.doc_type] || (masukTerakhir ? "Penerimaan barang" : "");
  // Kalimat ringkasan bahasa awam — pembaca halaman ini bukan petugas gudang,
  // jadi jawaban "ada berapa, di mana, kapan terakhir bergerak" ditulis sebagai
  // kalimat, bukan cuma angka dan kode blok.
  const posisiTeks = lokasiPublik[0]
    ? [lokasiPublik[0].gudang, lokasiPublik[0].blok && `Blok ${lokasiPublik[0].blok}`].filter(Boolean).join(" – ")
    : lokasiRiwayat[0] ? `Blok ${lokasiRiwayat[0].blok}` : "";
  const ringkasan = (qty > 0
    ? `Tersedia ${fmtNum(qty)} ${satuan}${posisiTeks ? `, disimpan di ${posisiTeks}` : ""}.`
    : "Stok kosong — barang ini sedang tidak tersedia di gudang.")
    + (last
      ? ` Terakhir ${last.jenis_transaksi==="MASUK" ? "masuk" : "keluar"} ${fmtNum(last.qty)} ${satuan} pada ${fmtDateOnly(last.tanggal)}.`
      : " Belum ada catatan keluar-masuk barang.");
  const lokasiRows = lokasiPublik.length
    ? lokasiPublik.map(l => ({ gudang:l.gudang, subGudang:l.subGudang, blok:l.blok, qty:l.qty, note:null, perkiraan:false }))
    : lokasiRiwayat.map(l => ({ gudang:null, subGudang:null, blok:l.blok, qty:l.qty, note:`Pergerakan terakhir ${fmtDateOnly(l.terakhir)}`, perkiraan:true }));
  const blokUtama = lokasiPublik[0]?.blok || lokasiRiwayat[0]?.blok || (rakTerakhir!=="-" ? rakTerakhir : "");
  const rowLabel = { fontSize:12, color:"#64748b", fontWeight:700 };
  const chips = [katalog.katalog||"-", satuan||"-", katalog.jenisBarang||"-"];
  const shown = showAll ? newest : newest.slice(0,15);

  return (
    <div style={page}>
      <div style={shell}>
        {/* Kepala navy — gradient sama dengan .kpi-banner di aplikasi utama.
            Foto jadi thumbnail di sini (bukan banner besar) supaya identitas,
            foto, dan status stok kebaca dalam satu layar HP tanpa scroll. */}
        <div style={{...card,background:"linear-gradient(120deg,#0b2559 0%,#123d83 58%,#1d4ed8 100%)",border:"none",padding:0,color:"#fff",overflow:"hidden"}}>
          <div style={{padding:"14px 16px 0",display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:700,letterSpacing:".6px",opacity:.85}}>
            <Package size={16} weight="fill"/> PT PLN (PERSERO) UPT SURABAYA · WARNOTO
          </div>
          <div style={{display:"flex",gap:12,alignItems:"center",padding:"10px 16px 14px"}}>
            {katalog.fotoKeseluruhanUrl && (
              <a href={katalog.fotoKeseluruhanUrl} target="_blank" rel="noreferrer" style={{flexShrink:0,lineHeight:0}}>
                <img src={katalog.fotoKeseluruhanUrl} alt={`Foto material ${katalog.name}`} style={{width:76,height:76,objectFit:"cover",borderRadius: 14,border:"1px solid rgba(255,255,255,.3)"}}/>
              </a>
            )}
            <div style={{minWidth:0}}>
              <h1 style={{fontSize:17,fontWeight:800,lineHeight:1.25,margin:"0 0 8px"}}>{katalog.name}</h1>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {chips.map((c,i)=>(
                  <span key={i} style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:999,background:"rgba(255,255,255,.16)",border:"1px solid rgba(255,255,255,.22)"}}>{c}</span>
                ))}
              </div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"9px 16px",background:"rgba(0,0,0,.16)",fontSize:12,fontWeight:700,letterSpacing:".4px"}}>
            <span style={{opacity:.85}}>KARTU MATERIAL DIGITAL</span>
            <span style={{padding:"3px 10px",borderRadius:999,background: qty>0 ? "rgba(34,197,94,.22)" : "rgba(248,113,113,.24)",border:`1px solid ${qty>0 ? "rgba(134,239,172,.5)" : "rgba(252,165,165,.55)"}`}}>
              {qty>0 ? "TERSEDIA" : "STOK KOSONG"}
            </span>
          </div>
        </div>

        {/* Angka utama: yang dicari orang di depan rak adalah sisa stok. */}
        <div style={{...card,padding:"18px 16px",textAlign:"center"}}>
          <div style={{fontSize:12,fontWeight:800,letterSpacing:".6px",color:"#64748b"}}>SISA BARANG SAAT INI</div>
          <div style={{fontSize:32,fontWeight:800,lineHeight:1.1,color: qty>0 ? "#047857" : "#b91c1c",margin:"2px 0 6px"}}>
            {fmtNum(qty)} <span style={{fontSize:15,fontWeight:700,color:"#64748b"}}>{satuan}</span>
          </div>
          <div style={{display:"flex",justifyContent:"center",flexWrap:"wrap",gap:"4px 14px",fontSize:12,color: "#64748b",borderTop:"1px solid #e2e8f0",paddingTop:10}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:4}}><MapPin size={14} weight="fill" color="#64748b"/> Blok {rakTerakhir}</span>
            {last && (
              <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                <ClockCounterClockwise size={14} color="#64748b"/> Mutasi terakhir {fmtDateOnly(last.tanggal)}
                {hariSejakMutasi>0 ? ` (${fmtNum(hariSejakMutasi)} hari lalu)` : hariSejakMutasi===0 ? " (hari ini)" : ""}
              </span>
            )}
          </div>
          <div style={{fontSize:13,color: "#64748b",lineHeight:1.55,textAlign:"left",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius: 14,padding:"10px 12px",marginTop:12}}>
            {ringkasan}
          </div>
        </div>

        {/* Tiga angka dijadikan satu kartu bergaris pemisah — tiga kotak terpisah
            bikin halaman terasa kotak-kotak/kaku di layar HP. */}
        <div style={{...card,padding:"12px 4px"}}>
          <div style={{display:"flex",alignItems:"stretch"}}>
            {[
              { label:"Total masuk", val:`+${fmtNum(totalMasuk)}`, warna:"#16a34a" },
              { label:"Total keluar", val:`-${fmtNum(totalKeluar)}`, warna:"#dc2626" },
              { label:"Jumlah mutasi", val:fmtNum(history.length), warna:"#0f172a" },
            ].map((s,i)=>(
              <div key={s.label} style={{flex:1,textAlign:"center",padding:"0 6px",borderLeft:i?"1px solid #e2e8f0":"none"}}>
                <div style={{fontSize:12,color:"#64748b",fontWeight:700}}>{s.label}</div>
                <div style={{fontSize:17,fontWeight:800,color:s.warna,fontVariantNumeric:"tabular-nums"}}>{s.val}</div>
              </div>
            ))}
          </div>
          {(totalMasuk+totalKeluar) > 0 && (
            <div style={{display:"flex",height:5,borderRadius:999,overflow:"hidden",background:"#e2e8f0",margin:"10px 12px 2px"}}>
              <div style={{width:`${totalMasuk/(totalMasuk+totalKeluar)*100}%`,background:"#16a34a"}}/>
              <div style={{flex:1,background:"#dc2626"}}/>
            </div>
          )}
        </div>

        <div style={{...card,padding:"14px 14px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:800,color:"#0f172a",marginBottom:10}}>
            <MapPin size={16} weight="fill" color="#1d4ed8"/> Lokasi Penyimpanan
          </div>
          {lokasiRows.length > 0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {lokasiRows.map((l,i)=>(
                <div key={i} style={{border:"1px solid #e2e8f0",borderLeft:`3px solid ${l.perkiraan?"#94a3b8":"#1d4ed8"}`,borderRadius: 14,padding:"10px 12px"}}>
                  {/* Jalur gudang ditulis bertingkat, blok dicetak paling besar —
                      itu yang dicari orang sambil berdiri di depan rak. */}
                  <div tabIndex={0} className="info-note" style={{fontSize:12,color:"#64748b",fontWeight:700}}>
                    {[l.gudang, l.subGudang && `Sub Gudang ${l.subGudang}`].filter(Boolean).join(" › ") || "Jalur gudang belum tersinkron"}
                  </div>
                  <div style={{display:"flex",alignItems:"baseline",gap:8,marginTop:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:20,fontWeight:800,color:"#0f172a",letterSpacing:".3px"}}>{l.blok ? `Blok ${l.blok}` : "Blok belum diisi"}</span>
                    <span style={{marginLeft:"auto",fontSize:13,fontWeight:800,color:"#1d4ed8",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{fmtNum(l.qty)} {satuan}</span>
                  </div>
                  {l.note && <div style={{fontSize:12,color:"#64748b",marginTop:3}}>{l.note}</div>}
                </div>
              ))}
              {lokasiRows[0]?.perkiraan && (
                <div tabIndex={0} className="info-note" style={{fontSize:12,color:"#64748b"}}>Perkiraan posisi dihitung dari riwayat keluar-masuk barang; rincian gudang menyusul setelah sinkronisasi berikutnya.</div>
              )}
            </div>
          ) : (
            <div style={{fontSize:13,color: "#64748b",lineHeight:1.55}}>
              Rincian gudang untuk barang ini belum tersinkron ke halaman publik.{rakTerakhir!=="-" && <> Posisi terakhir tercatat: <b style={{color:"#0f172a"}}>Blok {rakTerakhir}</b>.</>} Tanyakan ke petugas gudang bila perlu dipastikan.
            </div>
          )}
        </div>

        <div style={{...card,padding:"14px"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:800,color:"#0f172a",marginBottom:10}}>
            <Package size={16} weight="fill" color="#1d4ed8"/> Asal & Keterangan Barang
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div>
              <div style={rowLabel}>Asal barang</div>
              <div style={{fontSize:13,color:"#0f172a"}}>
                {masukTerakhir ? asalDok : "Belum ada catatan penerimaan."}
                {masukTerakhir?.catatan && masukTerakhir.catatan!=="-" ? ` — ${masukTerakhir.catatan}` : ""}
              </div>
              {masukTerakhir && (
                <div style={{fontSize:12,color:"#64748b",marginTop:2}}>
                  {fmtDateOnly(masukTerakhir.tanggal)} · No. Bon {masukTerakhir.no_bon||"-"} · {fmtNum(masukTerakhir.qty)} {satuan}
                </div>
              )}
            </div>
            {katalog.merk && <div><div style={rowLabel}>Merk / Type</div><div style={{fontSize:13,color:"#0f172a"}}>{[katalog.merk,katalog.type].filter(Boolean).join(" / ")}</div></div>}
            {katalog.category && <div><div style={rowLabel}>Kategori</div><div style={{fontSize:13,color:"#0f172a"}}>{katalog.category}</div></div>}
            {katalog.keterangan && <div><div style={rowLabel}>Keterangan</div><div style={{fontSize:13,color:"#0f172a",overflowWrap:"anywhere"}}>{katalog.keterangan}</div></div>}
          </div>
        </div>

        <div style={{...card,padding:"14px 14px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
            <ClockCounterClockwise size={16} weight="fill" color="#1d4ed8"/>
            <span style={{fontSize:13,fontWeight:800,color:"#0f172a"}}>Riwayat Keluar-Masuk Barang</span>
            <span style={{fontSize:12,color: "#64748b",fontWeight:700}}>(TUG-2)</span>
            {history.length>0 && <span style={{marginLeft:"auto",fontSize:12,fontWeight:700,color: "#64748b",background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:999,padding:"2px 9px"}}>{fmtNum(history.length)} baris</span>}
          </div>
          {history.length===0 ? (
            <div style={{fontSize:13,color:"#64748b",textAlign:"center",padding:"18px 0",lineHeight:1.55}}>Belum ada catatan keluar-masuk untuk barang ini.<br/>Stok yang tercatat berasal dari data awal gudang.</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {shown.map((h,i)=>{
                const masuk = h.jenis_transaksi==="MASUK";
                const warna = masuk ? "#16a34a" : "#dc2626";
                return (
                  <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",border:"1px solid #e2e8f0",borderLeft:`3px solid ${warna}`,borderRadius: 14,padding:"10px 12px"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,fontSize:13,fontWeight:800,color:warna}}>
                        {masuk ? <ArrowDown size={14} weight="bold"/> : <ArrowUp size={14} weight="bold"/>}
                        {masuk ? "Barang Masuk" : "Barang Keluar"}
                      </div>
                      <div style={{fontSize:12,color:"#64748b",marginTop:2}}>
                        {fmtDateOnly(h.tanggal)} · No. Bon {h.no_bon||"-"}{h.lokasi_kode ? ` · Rak ${h.lokasi_kode}` : ""}
                      </div>
                      {h.catatan && h.catatan!=="-" && (
                        <div style={{fontSize:12,color:"#64748b",marginTop:2,overflowWrap:"anywhere"}}>{h.catatan}</div>
                      )}
                    </div>
                    <div style={{textAlign:"right",whiteSpace:"nowrap"}}>
                      <div style={{fontSize:13,fontWeight:800,color:warna}}>{masuk?"+":"-"}{fmtNum(h.qty)} {satuan}</div>
                      <div style={{fontSize:12,color:"#64748b",marginTop:2}}>sisa {fmtNum(h.sisa)}</div>
                    </div>
                  </div>
                );
              })}
              {!showAll && newest.length>15 && (
                <button type="button" onClick={()=>setShowAll(true)} style={{minHeight:44,border:"1px solid #cbd5e1",borderRadius: 14,background:"#fff",color:"#1d4ed8",fontSize:13,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>
                  Tampilkan semua ({newest.length})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pembaca halaman ini sering bukan orang gudang — jelaskan halamannya apa. */}
        <div style={{...card,padding:"14px",background:"#f8fafc"}}>
          <div style={{fontSize:13,fontWeight:800,color:"#0f172a",marginBottom:6}}>Apa arti halaman ini?</div>
          <div style={{fontSize:13,color: "#64748b",lineHeight:1.6}}>
            Halaman ini muncul setelah Anda memindai QR pada kartu gantung barang. Isinya data resmi gudang
            PT PLN (Persero) UPT Surabaya: jumlah barang yang tersisa, tempat penyimpanannya, dan catatan
            keluar-masuk barang. Data diperbarui otomatis oleh sistem WARNOTO setiap ada transaksi disetujui.
          </div>
        </div>

        <div style={{textAlign:"center",lineHeight:1.5,padding:"2px 8px"}}>
          <div style={{height:1,background:"#dbe3ee",margin:"2px auto 10px",maxWidth:180}}/>
          <div style={{fontSize:12,fontWeight:800,color: "#64748b",letterSpacing:".5px"}}>WARNOTO · GUDANG UPT SURABAYA</div>
          <div style={{fontSize:12,color:"#64748b",marginTop:3}}>
            Data langsung dari sistem, tanpa perlu login. Dibuka {fmtDateOnly(new Date().toISOString())}.<br/>
            Hubungi petugas gudang bila angka di rak berbeda dengan halaman ini.
          </div>
        </div>
      </div>

      {/* Bar melayang: informasi inti tetap kebaca sejauh apa pun halaman digulir. */}
      <div style={{position:"fixed",left:0,right:0,bottom:0,background:"linear-gradient(120deg,#0b2559 0%,#123d83 58%,#1d4ed8 100%)",color:"#fff",boxShadow:"0 -6px 20px -12px rgba(15,23,42,.6)",padding:"10px 14px calc(10px + env(safe-area-inset-bottom))"}}>
        <div style={{maxWidth:560,margin:"0 auto",display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:12,fontWeight:700,opacity:.85}}>Sisa</div>
          <div style={{fontSize:15,fontWeight:800,fontVariantNumeric:"tabular-nums"}}>{fmtNum(qty)} {satuan}</div>
          <div style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:5,fontSize:13,fontWeight:800}}>
            <MapPin size={15} weight="fill"/> {blokUtama ? `Blok ${blokUtama}` : "Blok belum tercatat"}
          </div>
        </div>
      </div>
    </div>
  );
}
