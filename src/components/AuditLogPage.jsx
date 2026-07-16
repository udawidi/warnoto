// Viewer Audit Log (ADMIN only) — baca-saja dari tabel append-only audit_log
// (lihat src/lib/audit.js untuk penulisannya). Query langsung ke Supabase,
// pagination server-side (pola .range() sama seperti dipakai di MigrasiDataTab).
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { fmtDate } from "../lib/utils.js";

const PAGE_SIZE = 50;
const ACTIONS = ["ALL","LOGIN","CREATE","UPDATE","DELETE","APPROVE","REJECT","IMPORT"];

function actionBadgeStyle(action) {
  if (action==="APPROVE"||action==="CREATE") return { bg:"#dcfce7", fg:"#166534" };
  if (action==="REJECT"||action==="DELETE") return { bg:"#fee2e2", fg:"#991b1b" };
  if (action==="LOGIN"||action==="UPDATE") return { bg:"#dbeafe", fg:"#1d4ed8" };
  if (action==="IMPORT") return { bg:"#ede9fe", fg:"#6d28d9" };
  return { bg:"#f3f4f6", fg:"#6b7280" };
}

// Ringkasan 1 baris dari `detail` jsonb — ambil field yang paling informatif
// biar tabel tidak perlu ditampilkan sebagai JSON mentah; JSON lengkapnya tetap
// ada di <details> collapsible untuk yang butuh detail penuh.
function summarizeDetail(detail) {
  if (!detail || typeof detail !== "object") return "-";
  const keys = ["nama","kode","title","docType","rows","sourceFile","note"];
  const parts = keys.filter(k => detail[k]!=null && detail[k]!=="").map(k => `${k}: ${detail[k]}`);
  return parts.length ? parts.slice(0,3).join(" • ") : "-";
}

export function AuditLogPage({ sty, C }) {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Debounce pencarian nama user 400ms — query ini hit Supabase langsung,
  // jangan fetch tiap ketikan huruf.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [actionFilter, search, dateFrom, dateTo]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase.from("audit_log").select("*", { count:"exact" }).order("at", { ascending:false });
      if (actionFilter !== "ALL") q = q.eq("action", actionFilter);
      if (search) q = q.ilike("user_name", `%${search}%`);
      if (dateFrom) q = q.gte("at", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) q = q.lte("at", new Date(`${dateTo}T23:59:59`).toISOString());
      const from = (page-1)*PAGE_SIZE;
      const { data, error, count: total } = await q.range(from, from+PAGE_SIZE-1);
      if (cancelled) return;
      if (error) { console.error("AuditLogPage:", error.message); setRows([]); setCount(0); }
      else { setRows(data||[]); setCount(total||0); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [actionFilter, search, dateFrom, dateTo, page]);

  const totalPages = Math.max(1, Math.ceil(count/PAGE_SIZE));

  return (
    <div style={sty.card}>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14,alignItems:"flex-end"}}>
        <div>
          <label style={sty.label}>Aksi</label>
          <select style={sty.select} value={actionFilter} onChange={e=>setActionFilter(e.target.value)}>
            {ACTIONS.map(a=><option key={a} value={a}>{a==="ALL"?"Semua":a}</option>)}
          </select>
        </div>
        <div style={{flex:"1 1 200px"}}>
          <label style={sty.label}>Cari User</label>
          <input style={sty.input} placeholder="Nama user..." value={searchInput} onChange={e=>setSearchInput(e.target.value)}/>
        </div>
        <div>
          <label style={sty.label}>Dari Tanggal</label>
          <input type="date" style={sty.input} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
        </div>
        <div>
          <label style={sty.label}>Sampai Tanggal</label>
          <input type="date" style={sty.input} value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
        </div>
      </div>

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{borderBottom:`2px solid ${C.border}`,textAlign:"left"}}>
              <th style={{padding:"8px 6px",whiteSpace:"nowrap"}}>Waktu</th>
              <th style={{padding:"8px 6px"}}>User</th>
              <th style={{padding:"8px 6px"}}>Aksi</th>
              <th style={{padding:"8px 6px"}}>Entitas</th>
              <th style={{padding:"8px 6px"}}>ID</th>
              <th style={{padding:"8px 6px"}}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{padding:20,textAlign:"center",color:C.muted}}>Memuat...</td></tr>
            ) : rows.length===0 ? (
              <tr><td colSpan={6} style={{padding:20,textAlign:"center",color:C.muted}}>Tidak ada entri audit log untuk filter ini.</td></tr>
            ) : rows.map(r=>{
              const badge = actionBadgeStyle(r.action);
              return (
                <tr key={r.id} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:"8px 6px",whiteSpace:"nowrap",color:C.muted}}>{fmtDate(r.at)}</td>
                  <td style={{padding:"8px 6px"}}>
                    <div style={{fontWeight:700}}>{r.user_name||"-"}</div>
                    {r.role && <div style={{fontSize:12,color:C.muted}}>{r.role}</div>}
                  </td>
                  <td style={{padding:"8px 6px"}}>
                    <span style={{padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700,background:badge.bg,color:badge.fg}}>{r.action}</span>
                  </td>
                  <td style={{padding:"8px 6px"}}>{r.entity||"-"}</td>
                  <td style={{padding:"8px 6px",color:C.muted}}>{r.entity_id||"-"}</td>
                  <td style={{padding:"8px 6px",maxWidth:320}}>
                    <div>{summarizeDetail(r.detail)}</div>
                    {r.detail && (
                      <details>
                        <summary style={{cursor:"pointer",color:C.muted,fontSize:12}}>JSON</summary>
                        <pre style={{fontSize:12,whiteSpace:"pre-wrap",wordBreak:"break-word",background:"#f9fafb",padding:8,borderRadius:6,marginTop:4}}>{JSON.stringify(r.detail,null,2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {count>0 && (
        <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginTop:12}}>
          <button style={sty.btn("ghost","sm")} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
          <span style={{fontSize:12,color:C.muted,padding:"0 4px"}}>Halaman {page} / {totalPages} ({count} entri)</span>
          <button style={sty.btn("ghost","sm")} disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya →</button>
        </div>
      )}
    </div>
  );
}
