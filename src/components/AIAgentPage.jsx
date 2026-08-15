import { useState } from "react";
import { fmtDate } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";
import { AIFaqPanel } from "./AIFaqPanel.jsx";
import { TelegramWhitelistPanel } from "./TelegramWhitelistPanel.jsx";

// Render teks jawaban Pak War: **bold** → <strong>, baris "- " berurutan
// dikelompokkan jadi <ul class="ai-richlist">, baris lain jadi <p>.
function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}
function renderAIText(text) {
  const lines = String(text).split("\n");
  const nodes = [];
  let list = null;
  const flush = () => {
    if (list) { nodes.push(<ul key={`l${nodes.length}`} className="ai-richlist">{list}</ul>); list = null; }
  };
  lines.forEach((line, i) => {
    if (line.startsWith("- ")) {
      (list ||= []).push(<li key={i}>{renderInline(line.slice(2))}</li>);
    } else {
      flush();
      if (line.trim()) nodes.push(<p key={`p${i}`}>{renderInline(line)}</p>);
    }
  });
  flush();
  return nodes;
}

export function AIAgentPage({
  chatHistory, setChatHistory, chatInput, setChatInput,
  chatLoading, chatEndRef, sendChat, syncRagChunks, syncWarnotoState,
  syncStocksSnapshot, ragSyncing, ragLastSync, currentUser, uptList, C, sty, uptNama,
}) {
  const [view, setView] = useState("chat");
  const [syncPct, setSyncPct] = useState(null);
  const isWelcome = chatHistory.length<=1;
  const suggested = [
    {title:"Prioritas stok hari ini",question:"Analisa kondisi stok sekarang dan material yang perlu perhatian"},
    {title:"Dokumen yang tertunda",question:"Ada berapa TUG yang masih pending approval?"},
    {title:"Material hampir habis",question:"Material apa yang stoknya hampir habis?"},
    {title:"Proyeksi tiga bulan",question:"Forecast kebutuhan material 3 bulan ke depan"},
  ];

  async function handleSync() {
    try {
      setSyncPct(5);
      await syncStocksSnapshot();
      setSyncPct(15);
      await syncRagChunks(false, (done,total)=>setSyncPct(15+Math.round((done/total)*75)));
      setSyncPct(95);
      await syncWarnotoState();
      setSyncPct(100);
    } finally {
      setTimeout(()=>setSyncPct(null), 1500);
    }
  }

  function handleKeyDown(event) {
    if (event.key==="Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!chatLoading && chatInput.trim()) sendChat();
    }
  }

  return (
    <div className="ai-agent-page">
      <section className={`ai-conversation${isWelcome?" is-welcome":""}`} aria-label="Percakapan dengan Pak War">
        <header className="ai-conversation__header">
          <div className="ai-conversation__identity">
            <div className="ai-conversation__avatar" aria-hidden="true">PW</div>
            <div><span>Asisten operasional WARNOTO</span><strong>Pak War</strong><small>Terhubung dengan data Gudang {uptNama}</small></div>
          </div>
          {hasRole(currentUser,"ADMIN","ADMIN_LOG_PUSAT","ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT") && <div className="ai-conversation__admin">
            <button disabled={syncPct!==null} onClick={handleSync}>{syncPct!==null?`Sinkron ${syncPct}%`:"Sinkron data"}</button>
            {syncPct!==null && <span className="ai-sync-mini"><i style={{width:`${syncPct}%`}}/></span>}
            <button className={view==="faq"?"is-active":""} onClick={()=>setView(value=>value==="faq"?"chat":"faq")}>FAQ</button>
            <button className={view==="telegram"?"is-active":""} onClick={()=>setView(value=>value==="telegram"?"chat":"telegram")}>Telegram</button>
            {ragLastSync && <span>Sync {fmtDate(ragLastSync)}</span>}
          </div>}
        </header>

        {view==="faq" && <div className="ai-conversation__config">
          <button className="ai-config-back" onClick={()=>setView("chat")}>← Kembali ke percakapan</button>
          <AIFaqPanel sty={sty} C={C} onSaved={async()=>{await syncRagChunks(true);}}/>
        </div>}
        {view==="telegram" && <div className="ai-conversation__config">
          <button className="ai-config-back" onClick={()=>setView("chat")}>← Kembali ke percakapan</button>
          <TelegramWhitelistPanel sty={sty} C={C} currentUser={currentUser} uptList={uptList}/>
        </div>}

        {view==="chat" && (isWelcome ? (
          <div className="ai-start">
            <div className="ai-start__intro">
              <span>Mulai percakapan</span>
              <h2>Apa yang perlu diperiksa hari ini?</h2>
              <p tabIndex={0} className="info-note">Pak War membantu merangkum stok, transaksi, approval, dan forecast. Pilih pertanyaan cepat atau tulis pertanyaan sendiri.</p>
              <div className="ai-start__status"><i></i><span>Siap membaca data gudang terbaru</span></div>
            </div>
            <div className="ai-quick-prompts">
              <span>Pertanyaan cepat</span>
              <div>
                {suggested.map((item,index)=><button key={index} onClick={()=>sendChat(item.question)}>
                  <span>{item.title}</span><small>{item.question}</small><b aria-hidden="true">→</b>
                </button>)}
              </div>
            </div>
          </div>
        ) : (
          <div className="ai-chat-history">
            {chatHistory.map((message,index)=><div key={index} className={`ai-message is-${message.role}`}>
              <div className="ai-message__avatar" aria-hidden="true">{message.role==="user"?"U":"PW"}</div>
              <div className="ai-message__content"><span>{message.role==="user"?"Anda":"Pak War"}</span>{message.role==="user"?<p>{message.text}</p>:<div className="ai-message__bubble">{renderAIText(message.text)}</div>}</div>
            </div>)}
            {chatLoading && <div className="ai-message is-ai is-loading"><div className="ai-message__avatar" aria-hidden="true">PW</div><div className="ai-message__content"><span>Pak War</span><p>Sedang membaca dan menganalisis data gudang...</p></div></div>}
            <div ref={chatEndRef}/>
          </div>
        ))}

        {view==="chat" && <div className="ai-composer">
          <label className="ai-composer__field">
            <span>Tanyakan kepada Pak War</span>
            <textarea rows={2} placeholder="Contoh: Berapa stok material trafo dan mana yang perlu segera ditindaklanjuti?" value={chatInput} onChange={event=>setChatInput(event.target.value)} onKeyDown={handleKeyDown}/>
          </label>
          <div className="ai-composer__actions">
            <div>
              {!isWelcome && <button className="ai-composer__reset" title="Mulai percakapan baru" onClick={()=>setChatHistory([{role:"ai",text:`Halo, saya Pak War. Apa yang ingin Anda ketahui tentang data Gudang ${uptNama}?`}])}>Percakapan baru</button>}
              <span className="ai-composer__hint">Enter untuk kirim · Shift + Enter untuk baris baru</span>
            </div>
            <button className="ai-composer__send" onClick={()=>sendChat()} disabled={chatLoading||!chatInput.trim()}>{chatLoading?"Menganalisis...":"Kirim pertanyaan"}</button>
          </div>
        </div>}
      </section>
    </div>
  );
}
