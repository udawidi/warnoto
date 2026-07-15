// Panel Kelola FAQ Bot (Admin) — kurasi jawaban dari log Telegram. Dipindah Fase 4b.
import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";

const BAD_ANSWER_KEYWORDS = ["maaf","tidak ada data","tidak bisa","tidak tersedia","kendala","tidak ditemukan"];

export function AIFaqPanel({ sty, C, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [badLogs, setBadLogs] = useState([]);
  const [faqList, setFaqList] = useState([]);
  const [answeringId, setAnsweringId] = useState(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [{data: tgLogs}, {data: faq}] = await Promise.all([
        supabase.from("tg_agent_logs").select("*").eq("intent","rag_query").order("created_at",{ascending:false}).limit(100),
        supabase.from("ai_faq_curated").select("*").eq("is_active",true).order("created_at",{ascending:false}),
      ]);
      const combined = [
        ...(tgLogs||[]).map(l=>({...l, _table:"tg_agent_logs", _channel:"Telegram"})),
      ];
      const bad = combined.filter(l=>
        l.feedback==="down" ||
        BAD_ANSWER_KEYWORDS.some(kw=>(l.answer_summary||"").toLowerCase().includes(kw))
      ).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      setBadLogs(bad);
      setFaqList(faq||[]);
    } catch (e) {
      console.error("Gagal load data FAQ panel:", e);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function saveFaq(log) {
    if (!answerDraft.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("ai_faq_curated").insert({
        pertanyaan: log.message_in,
        jawaban: answerDraft.trim(),
        source_log_table: log._table,
        source_log_id: log.id,
        created_by: "web-admin",
      });
      if (error) throw error;
      setAnsweringId(null); setAnswerDraft("");
      await loadData();
      if (onSaved) await onSaved();
    } catch (e) {
      alert("Gagal simpan FAQ: " + e.message);
    }
    setSaving(false);
  }

  async function deactivateFaq(id) {
    await supabase.from("ai_faq_curated").update({is_active:false}).eq("id", id);
    loadData();
  }

  return (
    <div style={{...sty.card, marginBottom:16}}>
      <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>🧠 Kelola FAQ Bot</div>
      <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Pertanyaan nyata dari bot Telegram yang dijawab kurang baik — tulis jawaban resmi supaya besok bot langsung tahu.</p>

      {loading ? <div style={{fontSize:12,color:C.muted}}>Memuat...</div> : (
        <>
          <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>⚠️ Perlu Jawaban Resmi ({badLogs.length})</div>
          {badLogs.length===0 && <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Tidak ada pertanyaan yang perlu diperbaiki saat ini. 👍</div>}
          {badLogs.slice(0,20).map(log=>(
            <div key={`${log._table}_${log.id}`} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:8,background:"#fffbeb"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:4}}>
                <div style={{fontSize:12,fontWeight:700}}>{log.message_in}</div>
                <span style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{log._channel} • {log.display_name||log.telegram_username||log.phone_number||"-"}</span>
              </div>
              <div style={{fontSize:12,color:C.muted,marginBottom:6}}>Jawaban bot: "{(log.answer_summary||"").slice(0,150)}{(log.answer_summary||"").length>150?"...":""}"{log.feedback==="down" && " (ditandai 👎 oleh user)"}</div>
              {answeringId===`${log._table}_${log.id}` ? (
                <div>
                  <textarea style={{...sty.input,minHeight:70,marginBottom:6}} placeholder="Tulis jawaban resmi yang benar..." value={answerDraft} onChange={e=>setAnswerDraft(e.target.value)}/>
                  <div style={{display:"flex",gap:6}}>
                    <button style={sty.btn("success","sm")} disabled={saving} onClick={()=>saveFaq(log)}>{saving?"Menyimpan...":"💾 Simpan Jawaban Resmi"}</button>
                    <button style={sty.btn("ghost","sm")} onClick={()=>{setAnsweringId(null);setAnswerDraft("");}}>Batal</button>
                  </div>
                </div>
              ) : (
                <button style={sty.btn("ghost","sm")} onClick={()=>{setAnsweringId(`${log._table}_${log.id}`);setAnswerDraft("");}}>✏️ Tulis Jawaban Resmi</button>
              )}
            </div>
          ))}

          <div style={{fontSize:12,fontWeight:700,marginTop:16,marginBottom:8}}>📚 FAQ Terkurasi ({faqList.length})</div>
          {faqList.length===0 && <div style={{fontSize:12,color:C.muted}}>Belum ada FAQ yang dikurasi.</div>}
          {faqList.map(f=>(
            <div key={f.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:12,fontWeight:700}}>{f.pertanyaan}</div>
                <div style={{fontSize:12,color:C.muted}}>{f.jawaban}</div>
              </div>
              <button style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>deactivateFaq(f.id)}>🗑️ Nonaktifkan</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
