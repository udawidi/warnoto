// Komponen ScanPublicView — dipindah dari App.jsx (refactor Fase 4d).
import { useState, useEffect } from "react";
import { ArrowDown, ArrowUp, ClockCounterClockwise, MapPin, Package, Warning } from "@phosphor-icons/react";
import { SUPABASE_URL, SUPABASE_KEY } from "../supabaseClient.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { fmtDateOnly } from "../lib/utils.js";

// Dibuka lewat URL "?scan=<katalogId>&upt=<uptId>". Ambil data melalui RPC
// (anon key, read-only) — TIDAK butuh login/state aplikasi, supaya siapa pun
// yang scan QR fisik di rak bisa langsung lihat riwayat material itu dari HP.
export function ScanPublicView({ katalogId, uptId = null }) {
  const isLocalPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1";
  const [activeUptId, setActiveUptId] = useState(uptId || null);
  const [state, setState] = useState({ loading:true, error:"", status:"", katalog:null, upt:null, uptOptions:[], qty:0, locations:[], history:[] });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (isLocalPreview) {
        setState({ loading:false, error:"", status:"OK", katalog:{ name:"Kabel NYY 4x35 mm²", katalog:"DEMO-PBG", satuan:"m", jenisBarang:"Kabel", merk:"Demo PLN", type:"NYY", keterangan:"Data contoh untuk tinjauan lokal." }, upt:{ id:"UPT-PBG", nama:"UPT Probolinggo" }, uptOptions:[], qty:240, locations:[{ gudang:"Gudang UPT Probolinggo", subGudang:"Material Utama", blok:"B-07", qty:240 }], history:[{ jenis_transaksi:"MASUK", qty:300, sisa:300, tanggal:"2026-10-20T08:00:00.000Z", no_bon:"DEMO-MASUK-001", lokasi_kode:"B-07", doc_type:"TUG3", catatan:"Penerimaan contoh" }, { jenis_transaksi:"KELUAR", qty:60, sisa:240, tanggal:"2026-10-21T10:00:00.000Z", no_bon:"DEMO-KELUAR-001", lokasi_kode:"B-07", catatan:"Pemakaian contoh" }] });
        return;
      }
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        setState({ loading:false, error:"Supabase belum dikonfigurasi.", status:"", katalog:null, upt:null, uptOptions:[], qty:0, locations:[], history:[] });
        return;
      }
      const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
      try {
        const scanRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_material_scan`, {
          method: "POST", headers: { ...headers, "Content-Type":"application/json" },
          body: JSON.stringify({ p_katalog_id: katalogId, p_upt_id: activeUptId || null }),
        });
        if (!scanRes.ok) throw new Error("Gagal ambil data dari server.");
        const payload = await scanRes.json();
        if (cancelled) return;
        if (!payload || payload.status === "NOT_FOUND") {
          setState({ loading:false, error:"Material dengan kode ini tidak ditemukan.", status:"NOT_FOUND", katalog:null, upt:null, uptOptions:[], qty:0, locations:[], history:[] });
          return;
        }
        if (payload.status === "INVALID_UPT") {
          setState({ loading:false, error:"UPT pada QR tidak cocok dengan material ini.", status:payload.status, katalog:payload.katalog || null, upt:null, uptOptions:payload.uptOptions || [], qty:0, locations:[], history:[] });
          return;
        }
        setState({ loading:false, error:"", status:payload.status, katalog:payload.katalog || null, upt:payload.upt || null, uptOptions:payload.uptOptions || [], qty:Number(payload.qty)||0, locations:Array.isArray(payload.locations) ? payload.locations : [], history:Array.isArray(payload.history) ? payload.history : [] });

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
  }, [katalogId, activeUptId, isLocalPreview]);

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

  if (state.status === "SELECT_UPT") {
    return <div style={page}><div style={shell}>
      <div style={{...card,padding:20}}>
        <div style={{fontSize:16,fontWeight:800,color:"#0f172a"}}>Pilih UPT</div>
        <div style={{fontSize:13,color:"#64748b",marginTop:5,lineHeight:1.5}}>QR lama belum membawa UPT. Pilih unit untuk melihat stok dan lokasi yang sesuai.</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:14}}>
          {state.uptOptions.map(option => <button key={option.id} type="button" onClick={() => setActiveUptId(option.id)} style={{textAlign:"left",padding:"11px 12px",border:"1px solid #cbd5e1",borderRadius:10,background:"#fff",fontSize:13,fontWeight:700,color:"#0f172a",cursor:"pointer"}}>{option.nama}</button>)}
        </div>
      </div>
    </div></div>;
  }

  const { katalog, upt, qty, locations, history } = state;
  const uptDisplayName = upt?.nama ? (/^UPT\b/i.test(upt.nama) ? upt.nama : `UPT ${upt.nama}`) : "UPT";
  const newest = [...history].reverse();
  const totalMasuk = history.reduce((a,h)=>a+(h.jenis_transaksi==="MASUK"?Number(h.qty)||0:0),0);
  const totalKeluar = history.reduce((a,h)=>a+(h.jenis_transaksi==="KELUAR"?Number(h.qty)||0:0),0);
  const saldoAwalTersirat = Number(qty || 0) - totalMasuk + totalKeluar;
  const last = newest[0];
  const rakTerakhir = locations[0]?.blok || "-";
  const satuan = katalog.satuan || "";
  const hariSejakMutasi = history.length ? Math.floor((Date.now() - new Date(history[history.length-1].tanggal).getTime()) / 86400000) : null;
  const masukTerakhir = newest.find(h=>h.jenis_transaksi==="MASUK");
  const asalDok = { TUG3:"Penerimaan dari pengadaan (TUG-3)", TUG10:"Pengembalian dari pekerjaan (TUG-10)" }[masukTerakhir?.doc_type] || (masukTerakhir ? "Penerimaan barang" : "");
  // Kalimat ringkasan bahasa awam — pembaca halaman ini bukan petugas gudang,
  // jadi jawaban "ada berapa, di mana, kapan terakhir bergerak" ditulis sebagai
  // kalimat, bukan cuma angka dan kode blok.
  const posisiTeks = locations[0]
    ? [locations[0].gudang, locations[0].blok && `Blok ${locations[0].blok}`].filter(Boolean).join(" – ") : "";
  const ringkasan = (qty > 0
    ? `Tersedia ${fmtNum(qty)} ${satuan}${posisiTeks ? `, disimpan di ${posisiTeks}` : ""}.`
    : "Stok kosong — barang ini sedang tidak tersedia di gudang.")
    + (last
      ? ` Terakhir ${last.jenis_transaksi==="MASUK" ? "masuk" : "keluar"} ${fmtNum(last.qty)} ${satuan} pada ${fmtDateOnly(last.tanggal)}.`
      : " Belum ada catatan keluar-masuk barang.");
  const lokasiRows = locations.map(l => ({ gudang:l.gudang, subGudang:l.subGudang, blok:l.blok, qty:l.qty, note:null, perkiraan:false }));
  const blokUtama = locations[0]?.blok || "";
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
          {isLocalPreview && <div style={{padding:"7px 16px",background:"#fbbf24",color:"#422006",fontSize:12,fontWeight:800,textAlign:"center"}}>Data contoh / pratinjau lokal</div>}
          <div style={{padding:"14px 16px 0",display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:700,letterSpacing:".6px",opacity:.85}}>
            <Package size={16} weight="fill"/> PT PLN (PERSERO) {uptDisplayName} · WARNOTO
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
            <span style={{display:"inline-flex",alignItems:"center",gap:4}}><MapPin size={14} weight="fill" color="#64748b"/> {blokUtama ? `Blok ${blokUtama}` : "Lokasi belum diisi"}</span>
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
          {saldoAwalTersirat > 0 && <div style={{fontSize:12,color:"#64748b",textAlign:"center",marginTop:9}}>Saldo awal / migrasi: {fmtNum(saldoAwalTersirat)} {satuan}</div>}
          {saldoAwalTersirat < 0 && <div style={{fontSize:12,color:"#b45309",textAlign:"center",marginTop:9}}>Riwayat belum cocok dengan stok saat ini. Periksa catatan transaksi.</div>}
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
            </div>
          ) : (
            <div style={{fontSize:13,color: "#64748b",lineHeight:1.55}}>
              Lokasi belum diisi.
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
            <div style={{fontSize:13,color:"#64748b",textAlign:"center",padding:"18px 0",lineHeight:1.55}}>Belum ada catatan keluar-masuk untuk barang ini.<br/>Stok yang tercatat berasal dari saldo awal atau migrasi data gudang.</div>
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
          {qty > 0 && history.length === 0 && <div style={{fontSize:12,color:"#64748b",background:"#f8fafc",borderRadius:10,padding:"9px 10px",marginTop:10}}>Total masuk hanya menghitung transaksi yang tercatat. Saldo awal atau migrasi tidak dihitung sebagai transaksi masuk.</div>}
        </div>

        {/* Pembaca halaman ini sering bukan orang gudang — jelaskan halamannya apa. */}
        <div style={{...card,padding:"14px",background:"#f8fafc"}}>
          <div style={{fontSize:13,fontWeight:800,color:"#0f172a",marginBottom:6}}>Apa arti halaman ini?</div>
          <div style={{fontSize:13,color: "#64748b",lineHeight:1.6}}>
            Halaman ini muncul setelah Anda memindai QR pada kartu gantung barang. Isinya data resmi gudang
            PT PLN (Persero) {uptDisplayName}: jumlah barang yang tersisa, tempat penyimpanannya, dan catatan
            keluar-masuk barang. Data diperbarui otomatis oleh sistem WARNOTO setiap ada transaksi disetujui.
          </div>
        </div>

        <div style={{textAlign:"center",lineHeight:1.5,padding:"2px 8px"}}>
          <div style={{height:1,background:"#dbe3ee",margin:"2px auto 10px",maxWidth:180}}/>
          <div style={{fontSize:12,fontWeight:800,color: "#64748b",letterSpacing:".5px"}}>WARNOTO · GUDANG {uptDisplayName}</div>
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
