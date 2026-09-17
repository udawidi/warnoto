import { useState } from "react";
import { recognize as ocrRecognize } from "tesseract.js";
import { uid } from "../lib/utils.js";
import { CLOUD } from "../lib/cloud.js";

// Domain OCR/denah + koordinat blok: baca teks/label blok yang tergambar di PNG denah
// (Gudang & Sub Gudang) via OCR supaya sistem bisa mengusulkan kode blok otomatis, lalu
// assign/reset koordinat blok (mapX/mapY, subMapX/subMapY) via klik di gambar denah.
export function useDenahOcr({ stateRef, setGudangList, setSubGudangList, lokasiList, setLokasiList, syncGudang, syncSubGudang, syncLokasi, showToast }) {
  // usulan blok batch dari OCR denah: [{id,kode,xPct,yPct,checked}]
  const [ocrSuggestions, setOcrSuggestions] = useState([]);
  // gudang mana yang usulannya sedang tampil
  const [ocrSuggestGudangId, setOcrSuggestGudangId] = useState(null);
  // non-null = usulan berasal dari denah Sub Gudang, bukan denah Gudang keseluruhan
  const [ocrSuggestSubGudangId, setOcrSuggestSubGudangId] = useState(null);
  const [denahLoading, setDenahLoading] = useState(false);
  const [denahSubLoading, setDenahSubLoading] = useState(false);

  // Baca teks/label blok yang sudah tergambar di PNG denah (OCR) supaya
  // sistem bisa mengusulkan kode blok otomatis saat user klik titik di peta.
  async function runOcrOnDenah(gudangId, imgData) {
    if (stateRef.current.gudangList.find(g => g.id === gudangId)?.__gi) { showToast("Denah GI dikelola dari Master GI.", "error"); return; }
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Gagal membaca dimensi gambar"));
        im.src = imgData;
      });
      const { data } = await ocrRecognize(imgData, "eng");
      const words = (data.words || [])
        .filter(w => w.text && w.text.trim().length > 0)
        .map(w => ({
          text: w.text.trim(),
          xPct: Number((((w.bbox.x0 + w.bbox.x1) / 2) / img.naturalWidth * 100).toFixed(1)),
          yPct: Number((((w.bbox.y0 + w.bbox.y1) / 2) / img.naturalHeight * 100).toFixed(1)),
        }));
      // Pakai stateRef.current.gudangList (selalu terkini), bukan closure `gudangList` yang
      // sudah usang setelah OCR (proses beberapa detik) — kalau pakai closure lama, hasilnya
      // menimpa balik denahImageData yang baru diset di uploadDenahGudang sehingga gambar hilang.
      const prevList2 = stateRef.current.gudangList;
      const ng2 = prevList2.map(g => g.id === gudangId ? { ...g, denahOcrWords: words } : g);
      setGudangList(ng2);
      const ok2 = await syncGudang(ng2);
      if (!ok2) { setGudangList(prevList2); showToast("Gagal menyimpan hasil OCR ke server. Coba lagi.","error"); return; }
      CLOUD.set("pln_gudang_v1", ng2);

      // Usulkan blok batch dari semua label yang terbaca (filter noise teks pendek/simbol)
      const suggestions = words
        .filter(w => w.text.replace(/[^A-Za-z0-9]/g,"").length >= 2)
        .slice(0, 40)
        .map(w => ({ id: uid(), kode: w.text.toUpperCase().replace(/[^A-Z0-9]/g,""), jenisArea:"Rak Tertutup", luasan:"", xPct: w.xPct, yPct: w.yPct, checked: true }));
      setOcrSuggestions(suggestions);
      setOcrSuggestGudangId(gudangId);

      showToast(words.length > 0 ? `🔎 OCR selesai: ${words.length} label terbaca, ${suggestions.length} diusulkan jadi blok.` : "🔎 OCR selesai, tidak ada teks terbaca di denah.");
    } catch (e) {
      showToast("OCR gagal membaca label di denah: " + e.message, "error");
    }
  }

  async function runOcrOnDenahSub(subGudangId, gudangId, imgData) {
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Gagal membaca dimensi gambar"));
        im.src = imgData;
      });
      const { data } = await ocrRecognize(imgData, "eng");
      const words = (data.words || [])
        .filter(w => w.text && w.text.trim().length > 0)
        .map(w => ({
          text: w.text.trim(),
          xPct: Number((((w.bbox.x0 + w.bbox.x1) / 2) / img.naturalWidth * 100).toFixed(1)),
          yPct: Number((((w.bbox.y0 + w.bbox.y1) / 2) / img.naturalHeight * 100).toFixed(1)),
        }));
      const prevList2 = stateRef.current.subGudangList;
      const nsg2 = prevList2.map(sg => sg.id === subGudangId ? { ...sg, denahOcrWords: words } : sg);
      setSubGudangList(nsg2);
      const ok2 = await syncSubGudang(nsg2);
      if (!ok2) { setSubGudangList(prevList2); showToast("Gagal menyimpan hasil OCR ke server. Coba lagi.","error"); return; }
      CLOUD.set("pln_sub_gudang_v1", nsg2);

      const suggestions = words
        .filter(w => w.text.replace(/[^A-Za-z0-9]/g,"").length >= 2)
        .slice(0, 40)
        .map(w => ({ id: uid(), kode: w.text.toUpperCase().replace(/[^A-Z0-9]/g,""), jenisArea:"Rak Tertutup", luasan:"", xPct: w.xPct, yPct: w.yPct, checked: true }));
      setOcrSuggestions(suggestions);
      setOcrSuggestGudangId(gudangId);
      setOcrSuggestSubGudangId(subGudangId);

      showToast(words.length > 0 ? `🔎 OCR selesai: ${words.length} label terbaca, ${suggestions.length} diusulkan jadi blok.` : "🔎 OCR selesai, tidak ada teks terbaca di denah.");
    } catch (e) {
      showToast("OCR gagal membaca label di denah: " + e.message, "error");
    }
  }

  // Cari label OCR terdekat dari titik klik untuk diusulkan sebagai kode blok.
  function suggestKodeFromOcr(gudang, xPct, yPct) {
    const words = gudang?.denahOcrWords || [];
    if (words.length === 0) return "";
    let best = null, bestDist = Infinity;
    words.forEach(w => {
      const dx = w.xPct - xPct, dy = w.yPct - yPct;
      const dist = dx*dx + dy*dy;
      if (dist < bestDist) { bestDist = dist; best = w; }
    });
    return best ? best.text.toUpperCase().replace(/[^A-Z0-9]/g,"") : "";
  }

  // Assign koordinat blok via klik di gambar denah
  async function assignLokasiKoordinat(lokasiId, xPct, yPct, gudangId) {
    if (lokasiList.find(l => l.id === lokasiId)?.__gi) { showToast("Koordinat blok GI dikelola dari Master GI.", "error"); return; }
    const prevList = lokasiList;
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, mapX:xPct, mapY:yPct, gudangId} : l);
    setLokasiList(nl);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan koordinat ke server. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    showToast(`📍 Koordinat Blok disimpan!`);
  }

  async function resetLokasiKoordinat(lokasiId) {
    if (lokasiList.find(l => l.id === lokasiId)?.__gi) { showToast("Koordinat blok GI dikelola dari Master GI.", "error"); return; }
    const prevList = lokasiList;
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, mapX:null, mapY:null, gudangId:null} : l);
    setLokasiList(nl);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal reset koordinat di server. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    showToast("Koordinat blok direset.");
  }

  // Assign koordinat blok via klik di denah Sub Gudang (terpisah dari mapX/mapY denah Gudang keseluruhan)
  async function assignLokasiKoordinatSub(lokasiId, xPct, yPct, subGudangId, gudangId) {
    if (lokasiList.find(l => l.id === lokasiId)?.__gi) { showToast("Koordinat blok GI dikelola dari Master GI.", "error"); return; }
    const prevList = lokasiList;
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, subMapX:xPct, subMapY:yPct, subGudangId, gudangId} : l);
    setLokasiList(nl);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal menyimpan koordinat ke server. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    showToast(`📍 Koordinat Blok (Sub Gudang) disimpan!`);
  }

  // Reset hanya koordinat pin di denah Sub Gudang — assignment subGudangId (pengelompokan) tidak ikut dihapus
  async function resetLokasiKoordinatSub(lokasiId) {
    if (lokasiList.find(l => l.id === lokasiId)?.__gi) { showToast("Koordinat blok GI dikelola dari Master GI.", "error"); return; }
    const prevList = lokasiList;
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, subMapX:null, subMapY:null} : l);
    setLokasiList(nl);
    const ok = await syncLokasi(nl);
    if (!ok) { setLokasiList(prevList); showToast("Gagal reset koordinat di server. Coba lagi.","error"); return; }
    CLOUD.set("pln_lokasi_v4", nl);
    showToast("Koordinat blok (Sub Gudang) direset.");
  }

  function dismissOcrSuggestions() {
    setOcrSuggestions([]); setOcrSuggestGudangId(null); setOcrSuggestSubGudangId(null);
  }

  return {
    ocrSuggestions, setOcrSuggestions,
    ocrSuggestGudangId, setOcrSuggestGudangId,
    ocrSuggestSubGudangId, setOcrSuggestSubGudangId,
    denahLoading, setDenahLoading,
    denahSubLoading, setDenahSubLoading,
    runOcrOnDenah, runOcrOnDenahSub,
    suggestKodeFromOcr,
    assignLokasiKoordinat, assignLokasiKoordinatSub,
    resetLokasiKoordinat, resetLokasiKoordinatSub,
    dismissOcrSuggestions,
  };
}
