import { useEffect, useRef, useState } from "react";
import { UPT } from "../constants.js";
import { uid } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";
import { normalizeKatalog, totalQtyForKatalog, itemCounted, allBloksSelesai, stockSapLabel } from "../lib/sap.js";
import { loadMasterTable } from "../lib/masterSync.js";
import { normalizeOpnamePhotos, missingRequiredOpnamePhotos } from "../lib/stockOpnamePhotoSecurity.js";
import { approveStockOpnameAtomically } from "../lib/stockOpnameApproval.js";
import { mergeOpnameForSave } from "../lib/stockOpnameFlow.js";
import { mapStockScopeRow } from "../lib/stockScope.js";

function readCachedList(key) {
  try { return JSON.parse(localStorage.getItem('warnoto_' + key) || "null"); } catch { return null; }
}

// Domain Stock Opname & Stock Count: sesi opname fisik (draft->submit->approve Asman->approve
// Manager, termasuk temuan material baru/Non-Stock) + Stock Count (banding SAP vs Aplikasi,
// read-only, approval temuan selisih per item). saveToCloud/uploadStockFoto diakses lewat
// stateRef.current / param langsung (hoisted function) — sama pola dgn hook lain, lihat
// useHeavyEquipment.js untuk penjelasan lengkap TDZ.
export function useStockOpname({ currentUser, stockScopeUptIds, showToast, stateRef, logApprovalHistory, katalogList, setKatalogList, stocks, setStocks, uploadStockFoto, supabaseClient }) {
  const [opnameList, setOpnameList] = useState(() => readCachedList("pln_opname_v1") ?? []);
  const opnameListRef = useRef(opnameList);
  const commitOpnameList = next => { opnameListRef.current = next; setOpnameList(next); };
  useEffect(() => { opnameListRef.current = opnameList; }, [opnameList]);
  const [stockCountList, setStockCountList] = useState(() => readCachedList("pln_stockcount_v1") ?? []); // riwayat sesi Stock Count (banding SAP vs Aplikasi)
  const [opnameExpanded, setOpnameExpanded] = useState(false); // sidebar accordion state for Stock Opname & Stock Count (digabung 1 menu)
  const [opnameSubTab, setOpnameSubTab] = useState("opname"); // "opname" | "stockCount"
  const pendingSaveIdsRef = useRef(new Set());

  // Supabase Realtime is RLS-scoped. Keep only newer rows so reconnect/focus
  // resync cannot roll back a newer local/server session.
  const mergeIncomingRows = rows => {
    if (!Array.isArray(rows) || !rows.length) return;
    const current = opnameListRef.current;
    let changed = false;
    const next = current.map(local => {
      const incoming = rows.find(row => row?.id === local?.id);
      if (!incoming || pendingSaveIdsRef.current.has(incoming.id)) return local;
      if (Number(incoming.updatedAt || 0) < Number(local.updatedAt || 0)) return local;
      if (JSON.stringify(incoming) === JSON.stringify(local)) return local;
      changed = true;
      return incoming;
    });
    rows.forEach(incoming => {
      if (!incoming?.id || pendingSaveIdsRef.current.has(incoming.id) || next.some(row => row.id === incoming.id)) return;
      next.push(incoming); changed = true;
    });
    if (changed) commitOpnameList(next);
  };

  useEffect(() => {
    if (!supabaseClient || !currentUser?.id) return undefined;
    let disposed = false;
    const resync = async () => {
      const rows = await loadMasterTable("stock_opname", { uptIds: stockScopeUptIds });
      if (!disposed && Array.isArray(rows)) mergeIncomingRows(rows);
    };
    const config = { event: "*", schema: "public", table: "stock_opname" };
    if (Array.isArray(stockScopeUptIds) && stockScopeUptIds.length === 1) {
      config.filter = `upt_id=eq.${stockScopeUptIds[0]}`;
    }
    const channel = supabaseClient.channel(`stock-opname-${currentUser.id}`)
      .on("postgres_changes", config, payload => {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id;
          if (!id || pendingSaveIdsRef.current.has(id)) return;
          commitOpnameList(opnameListRef.current.filter(row => row.id !== id));
          return;
        }
        const incoming = payload.new ? {
          ...payload.new.data,
          id: payload.new.id,
          ...(payload.new.upt_id !== undefined ? { uptId: payload.new.upt_id } : {}),
          ...(payload.new.updated_at ? { updatedAt: new Date(payload.new.updated_at).getTime() } : {}),
        } : null;
        if (incoming) mergeIncomingRows([incoming]);
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") resync();
      });
    const onVisibility = () => { if (document.visibilityState === "visible") resync(); };
    document.addEventListener("visibilitychange", onVisibility);
    resync();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      supabaseClient.removeChannel(channel);
    };
  }, [supabaseClient, currentUser?.id, Array.isArray(stockScopeUptIds) ? stockScopeUptIds.join(",") : "*"]);
  // Fase 1d: sesi bisa diedit dari >1 perangkat/tab sekaligus (per blok/lokasi berbeda) — dulu
  // saveOpname menimpa SELURUH sesi (last-write-wins), blok yang barusan disimpan perangkat lain
  // bisa hilang. Kalau caller kasih touchedLokasiIds (blok yang BENAR disentuh perangkat ini),
  // ambil versi sesi terbaru dari server dulu, lalu tulis balik cuma blok itu — sisanya dari
  // server. Gagal ambil (offline) → simpan LOKAL saja, jangan menimpa server dgn data parsial.
  async function saveOpname(opn, touchedLokasiIds, { silent = false, forceMerge = false, failClosed = false, touchedPhotoItemKeys = [] } = {}) {
    if (opn?.id) pendingSaveIdsRef.current.add(opn.id);
    let toSave;
    try { toSave = await normalizeOpnamePhotos(opn, uploadStockFoto); }
    catch (error) {
      if (opn?.id) pendingSaveIdsRef.current.delete(opn.id);
      showToast(error?.message || "Gagal menyimpan foto opname.", "error");
      return false;
    }
    let syncPending = false;
    const currentList = opnameListRef.current;
    const previousList = currentList;
    const shouldMerge = forceMerge || (Array.isArray(touchedLokasiIds) && touchedLokasiIds.length);
    if (shouldMerge) {
      try {
        const serverList = await loadMasterTable("stock_opname", { uptIds: stockScopeUptIds }); // null = fetch gagal (lihat masterSync.js)
        if (!Array.isArray(serverList)) { syncPending = true; }
        else {
          const serverOpn = serverList.find(o=>o.id===opn.id);
          // serverOpn undefined = sesi memang belum pernah tersimpan di server (draft baru pertama
          // kali) — bukan kegagalan, lanjut simpan opn apa adanya seperti biasa.
          // Merge the normalized payload so uploaded photo URLs are not replaced by local data URLs.
          // mergeOpnameForSave(toSave, serverOpn, touchedLokasiIds) remains the canonical merge boundary.
          if (serverOpn) toSave = mergeOpnameForSave(toSave, serverOpn, touchedLokasiIds, { touchedPhotoItemKeys });
        }
      } catch {
        syncPending = true;
      }
    }
    // Version the JSON session itself so a recovery cache from another/older device
    // cannot silently replace a newer server result.
    toSave = { ...toSave, updatedAt: Math.max(Date.now(), Number(toSave.updatedAt || 0) + 1) };
    const exists = currentList.find(o=>o.id===toSave.id);
    const nl = exists ? currentList.map(o=>o.id===toSave.id?toSave:o) : [...currentList, toSave];
    commitOpnameList(nl);
    if (syncPending) {
      pendingSaveIdsRef.current.delete(toSave.id);
      if (failClosed) commitOpnameList(previousList);
      if (failClosed) showToast("Submit Stock Opname gagal mengambil versi server. Status tetap Draft; coba lagi.", "error");
      else showToast("⚠️ Disimpan lokal — sinkronisasi ke server tertunda (offline/gagal ambil versi terbaru). Coba \"Simpan Draft\" lagi setelah online.", "error");
      return false;
    }
    // Satu sesi saja yang berubah. Upsert baris ini tanpa reconciliation-delete agar
    // perangkat dengan cache lama tidak menghapus sesi baru milik perangkat lain.
    let saved;
    let canonical = null;
    try {
      saved = await stateRef.current.saveToCloud({opnameList: nl}, {opnameChangedRows: [toSave]});
      if (saved !== false && supabaseClient) {
        try {
          const { data: row, error } = await supabaseClient.from("stock_opname").select("*").eq("id", toSave.id).maybeSingle();
          if (!error && row) canonical = mapStockScopeRow(row);
        } catch {}
      }
    } finally {
      pendingSaveIdsRef.current.delete(toSave.id);
    }
    if (saved === false) {
      commitOpnameList(previousList);
      showToast(failClosed
        ? "Submit Stock Opname gagal disimpan ke server. Status tetap Draft; coba lagi."
        : "Gagal menyimpan Stock Opname ke server. Perubahan dibatalkan; coba lagi.", "error");
      return false;
    }
    if (canonical) {
      toSave = canonical;
      commitOpnameList(opnameListRef.current.map(row => row.id === canonical.id ? canonical : row));
    }
    if (!silent) showToast("✅ Data opname disimpan!");
    return toSave;
  }

  async function submitOpname(opn, touchedLokasiIds) {
    if (opn?.flowVersion === 2 && !allBloksSelesai(opn)) {
      showToast("Belum bisa submit: semua material harus selesai dihitung.", "error");
      return false;
    }
    let normalized;
    try { normalized = await normalizeOpnamePhotos(opn, uploadStockFoto); }
    catch (error) { showToast(error?.message || "Submit diblokir: foto belum berhasil diunggah.", "error"); return false; }
    const missing = missingRequiredOpnamePhotos(normalized);
    if (missing.length) { showToast(`Submit diblokir: ${missing.length} item dengan qty fisik > 0 wajib memiliki Foto Keseluruhan.`, "error"); return false; }
    const updated = {...normalized, status:"PENDING_ASMAN", submittedAt:Date.now()};
    const saved = await saveOpname(updated, touchedLokasiIds, { silent: true, forceMerge: true, failClosed: true });
    if (saved === false) return false;
    showToast("📋 Opname disubmit! Menunggu approval Asman.");
    return true;
  }
  async function approveOpname_Asman(opn, catatan) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman yang bisa approve.","error"); return false; }
    if (opn?.flowVersion === 2 && !allBloksSelesai(opn)) {
      showToast("Belum bisa approve: semua material harus selesai dihitung.", "error");
      return false;
    }
    let preparedOpn;
    try { preparedOpn = await normalizeOpnamePhotos(opn, uploadStockFoto); }
    catch (error) {
      showToast(error?.message || "Approval diblokir: foto belum berhasil diunggah.", "error");
      return false;
    }
    opn = preparedOpn;
    const missing = missingRequiredOpnamePhotos(opn);
    if (missing.length) { showToast(`Approval diblokir: ${missing.length} item dengan qty fisik > 0 belum memiliki Foto Keseluruhan.`, "error"); return false; }
    let newStocks = [...stocks];
    // Material baru dari SAP (item.katalogId null — belum ada di Master Katalog saat upload)
    // sekarang IKUT approval sesi ini (Asman->Manager), TIDAK ada approval TL terpisah (keputusan
    // user 2026-07-07, supaya tidak ada 2 alur approval yang membingungkan). Cuma diproses kalau
    // qty fisik benar-benar terisi (>0) — dibiarkan 0/kosong dianggap belum sempat dihitung fisik,
    // diabaikan total (tidak dibuatkan Master Katalog/Data Stok apa pun). No. Katalog dari SAP
    // dicek dulu via normalizeKatalog (bukan match string mentah, SAP kadang beda zero-padding) —
    // kalau bentrok dengan katalog yang SUDAH ADA, baris itu di-skip + Manager diberi tahu lewat
    // toast, TIDAK PERNAH menimpa diam-diam (pola sama seperti aturan keamanan Migrasi Data).
    let newKatalogList = [...katalogList];
    const materialBaruDibuat = [];
    const materialBaruKonflik = [];
    const materialBaruKatalogByCode = new Map();
    const newStockIdByCode = new Map();
    const nowOpn = Date.now();
    const sessionUptId = opn.uptId || opn.upt_id;
    (opn.items||[]).filter(item => !item.katalogId && Number(item.qtsFisik)>0).forEach(item => {
      const noKatalog = String(item.noKatalog||"").trim();
      const namaBarang = String(item.namaBarang||"").trim();
      if (!noKatalog || !namaBarang) return;
      const konflik = newKatalogList.find(k => normalizeKatalog(k.katalog) === normalizeKatalog(noKatalog));
      if (konflik) { materialBaruKonflik.push(`${namaBarang} (No. Katalog ${noKatalog} sudah dipakai "${konflik.name}")`); return; }
      const jenisBarangBaru = /^\d{10}$/.test(noKatalog) ? "Cadang" : /^\d{7,8}$/.test(noKatalog) ? "Persediaan" : "Cadang";
      const newKatalogId = "KAT-OPN-" + noKatalog;
      newKatalogList = [...newKatalogList, {
        id: newKatalogId, katalog: noKatalog, name: namaBarang,
        category: namaBarang.split(";")[0].trim() || "Material",
        jenisBarang: jenisBarangBaru, satuan: item.satuan || "-",
        keterangan: `Material baru terdeteksi dari Stock Opname ${opn.semester} (${opn.jenisAlur})`,
        createdAt: nowOpn,
      }];
      materialBaruKatalogByCode.set(noKatalog, newKatalogId);
      const newStockId = "STK-OPN-" + noKatalog + "-" + nowOpn;
      newStockIdByCode.set(noKatalog, newStockId);
      newStocks = [...newStocks, {
        id: newStockId,
        katalogId: newKatalogId, lokasiId: null,
        uptId: sessionUptId,
        qty: Number(item.qtsFisik), price: 0, minQty: 0, unit: item.satuan || "-",
        jenisBarang: jenisBarangBaru, name: namaBarang, katalog: noKatalog,
        category: namaBarang.split(";")[0].trim() || "Material",
        sapBaselineQty: Number(item.qtsFisik), sapBaselineAt: nowOpn, createdAt: nowOpn, updatedAt: nowOpn,
      }];
      materialBaruDibuat.push(`${namaBarang} (${noKatalog})`);
    });

    (opn.items||[]).filter(item=>item.selisih!==0 && item.katalogId).forEach(item => {
      const stockRows = newStocks.filter(s=>s.katalogId===item.katalogId);
      if (!stockRows.length) return;
      // Fase 1c: sesi baru bawa hitungPerLokasi → tulis qty PER lokasi sesuai angka nyata yang
      // dihitung (bukan porsi proporsional). Lokasi yang tidak dihitung dibiarkan (tidak diubah).
      if (item.hitungPerLokasi && Object.keys(item.hitungPerLokasi).length) {
        Object.entries(item.hitungPerLokasi).forEach(([lokKey, entry]) => {
          // Input desktop tunggal utk item multi-blok kolaps ke "_TANPA_LOKASI" (lihat itemLokasiKey
          // di StockOpnameTab.jsx) walau semua baris stoknya sebenarnya beralamat — tak ada baris
          // "_TANPA_LOKASI" yang cocok. Jangan buang qty-nya: tulis ke baris pertama sbg fallback
          // (ponytail: kasar tapi aman, per-blok asli menyusul di Fase 2 field mode).
          const row = stockRows.find(s => (s.lokasiId || "_TANPA_LOKASI") === lokKey) || stockRows[0];
          if (row) newStocks = newStocks.map(s=>s.id===row.id?{...s,qty:Number(entry.qty)||0}:s);
        });
        return;
      }
      // Fallback (sesi lama tanpa hitungPerLokasi) — distribusi proporsional seperti sebelumnya.
      const totalSistem = stockRows.reduce((a,s)=>a+(s.qty||0),0);
      if (totalSistem===0) {
        newStocks = newStocks.map(s=>s.id===stockRows[0].id?{...s,qty:item.qtsFisik}:s);
        return;
      }
      let remaining = item.qtsFisik;
      stockRows.forEach((sr,idx)=>{
        if (idx===stockRows.length-1) {
          newStocks = newStocks.map(s=>s.id===sr.id?{...s,qty:Math.max(0,remaining)}:s);
        } else {
          const portion = Math.round((sr.qty/totalSistem)*item.qtsFisik);
          newStocks = newStocks.map(s=>s.id===sr.id?{...s,qty:Math.max(0,portion)}:s);
          remaining -= portion;
        }
      });
    });
    // Material Non-Stock yang ditemukan saat opname fisik (Opsi A) — katalog & stok-nya
    // SUDAH dibuat sejak "Simpan" di lapangan (lihat addNonStockFoundItem), bukan di sini.
    // Approve Manager di sini cuma melepas flag pendingOpnameId (mengonfirmasi), tidak bikin
    // baris baru — beda dari material baru SAP di atas yang memang baru dibuat saat ini.
    let konfirmasiNonStock = 0;
    newKatalogList = newKatalogList.map(k => k.pendingOpnameId === opn.id ? { ...k, pendingOpnameId: null } : k);
    newStocks = newStocks.map(s => {
      if (s.pendingOpnameId === opn.id) { konfirmasiNonStock++; return { ...s, pendingOpnameId: null }; }
      return s;
    });

    // Fase E — Non-SAP diusulkan pindah kategori stok (Cadang/Persediaan/Pre Memory), dicatat
    // sebagai notulen Berita Acara. sapStatus TIDAK diubah (integrasi SAP eksternal ditunda).
    const notulenList = [];
    (opn.items||[]).filter(item => item.pindahJenis && item.katalogId).forEach(item => {
      const stockBefore = newStocks.find(s=>s.katalogId===item.katalogId);
      const dari = stockBefore?.jenisBarang || "Non-Stock";
      newStocks = newStocks.map(s => s.katalogId===item.katalogId ? { ...s, jenisBarang: item.pindahJenis } : s);
      newKatalogList = newKatalogList.map(k => k.id===item.katalogId ? { ...k, jenisBarang: item.pindahJenis } : k);
      notulenList.push({ katalog: item.noKatalog, nama: item.namaBarang, dari, ke: item.pindahJenis, catatan: "Diusulkan masuk SAP" });
    });

    // Fase D — riwayat Stock Opname per katalog (Kartu Gantung) + foto opname auto-update
    // ke Data Stok kalau ADA foto baru (base64 → Storage; kalau tak ada, foto lama dipertahankan).
    const nowHist = Date.now();
    const histEntry = { opnameId: opn.id, tanggal: nowHist, tahun: new Date(nowHist).getFullYear(), semester: opn.semester || "" };
    const countedKatalogIds = new Set();
    const fotoByStockId = {};
    const fotoByKatalog = {};
    for (const item of (opn.items||[])) {
      if (!itemCounted(item)) continue;
      const resolvedKatalogId = item.katalogId || materialBaruKatalogByCode.get(String(item.noKatalog || "").trim());
      if (resolvedKatalogId) countedKatalogIds.add(resolvedKatalogId);
      if (Number(item.qtsFisik) <= 0) continue;
      const photoTarget = item.stockId || newStockIdByCode.get(String(item.noKatalog || "").trim());
      for (const field of ["fotoKeseluruhan","fotoNameplate"]) {
        const val = item[field];
        if (typeof val === "string" && val.startsWith("data:")) throw new Error("Foto legacy belum dinormalisasi.");
        if (typeof val === "string" && val && !val.startsWith("data:")) {
          if (photoTarget) fotoByStockId[photoTarget] = { ...(fotoByStockId[photoTarget] || {}), [field]: val };
          else if (resolvedKatalogId) fotoByKatalog[resolvedKatalogId] = { ...(fotoByKatalog[resolvedKatalogId] || {}), [field]: val };
        }
      }
    }
    newStocks = newStocks.map(s => {
      if (!countedKatalogIds.has(s.katalogId)) return s;
      const hist = Array.isArray(s.opnameHistory) ? s.opnameHistory : [];
      const already = hist.some(h => h.opnameId === opn.id);
      const sameCatalogRows = newStocks.filter(row => row.katalogId === s.katalogId);
      const foto = fotoByStockId[s.id] || (sameCatalogRows.length === 1 ? fotoByKatalog[s.katalogId] : {}) || {};
      return { ...s,
        opnameHistory: already ? hist : [...hist, histEntry],
        ...(foto.fotoKeseluruhan ? { fotoKeseluruhan: foto.fotoKeseluruhan } : {}),
        ...(foto.fotoNameplate ? { fotoNameplate: foto.fotoNameplate } : {}),
        updatedAt: nowHist,
      };
    });

    const approvedItems = (opn.items || []).map(item => {
      const code = String(item.noKatalog || "").trim();
      const stampedKatalogId = materialBaruKatalogByCode.get(code);
      const stampedStockId = newStockIdByCode.get(code);
      return stampedKatalogId ? { ...item, katalogId: stampedKatalogId, ...(stampedStockId ? { stockId: stampedStockId } : {}) } : item;
    });
    const updated = {...opn, items: approvedItems, status:"SELESAI", approvedByAsman:currentUser.id, approvedAtAsman:Date.now(), catatanAsman:catatan||"", notulen: notulenList.length ? notulenList : (opn.notulen||[])};
    const changedKatalogRows = katalogList.filter(previous => {
      const next = newKatalogList.find(row => row.id === previous.id);
      return next && JSON.stringify(previous) !== JSON.stringify(next);
    }).concat(newKatalogList.filter(next => !katalogList.some(previous => previous.id === next.id)));
    const changedStockRows = stocks.filter(previous => {
      const next = newStocks.find(row => row.id === previous.id);
      return next && JSON.stringify(previous) !== JSON.stringify(next);
    }).concat(newStocks.filter(next => !stocks.some(previous => previous.id === next.id)));
    const rpcStockRows = changedStockRows.map(row => ({ ...row, uptId: row.uptId || sessionUptId }));
    const atomic = await approveStockOpnameAtomically({
      supabase: supabaseClient,
      opnameId: opn.id,
      opnameData: updated,
      katalogRows: changedKatalogRows,
      stockRows: rpcStockRows,
    });
    if (!atomic.ok) {
      showToast(`Approval Stock Opname gagal disimpan ke server. Status tetap menunggu Asman; ${atomic.error?.message || "coba lagi"}.`, "error");
      return false;
    }
    const nl = opnameListRef.current.map(o=>o.id===opn.id?updated:o);
    commitOpnameList(nl); setStocks(newStocks); setKatalogList(newKatalogList);
    // Ditemukan 2026-07-07: approve/reject Opname tidak pernah lapor ke logApprovalHistory
    // (beda dari semua jenis approval lain — Lokasi, Stock Move/Edit/Delete, Alat Berat,
    // Stock Count), jadi keputusannya tidak pernah muncul di "Riwayat Approval" terpusat.
    await logApprovalHistory({type:"OPNAME", decision:"APPROVED", title:`Stock Opname ${opn.semester} (${opn.jenisAlur})`, items:(opn.items||[]).filter(i=>i.selisih!==0).map(i=>({label:i.nama, qty:i.selisih})), requestedBy:opn.dibuatOleh, requestedAt:opn.dibuatAt});
    let msg = "✅ Stock Opname SELESAI! Data Stok disesuaikan.";
    if (materialBaruDibuat.length) msg += ` ${materialBaruDibuat.length} material baru ditambahkan ke Master Katalog.`;
    if (materialBaruKonflik.length) msg += ` ⚠️ ${materialBaruKonflik.length} material baru TIDAK ditambahkan (bentrok No. Katalog): ${materialBaruKonflik.slice(0,2).join("; ")}${materialBaruKonflik.length>2?"...":""}.`;
    if (konfirmasiNonStock) msg += ` ${konfirmasiNonStock} material Non-Stock hasil opname dikonfirmasi aktif.`;
    if (notulenList.length) msg += ` + ${notulenList.length} material Non-SAP diusulkan pindah kategori.`;
    showToast(msg, materialBaruKonflik.length ? "error" : "success");
    return true;
  }
  async function rejectOpname(opn, reason) {
    const updated = {...opn, status:"DITOLAK", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    commitOpnameList(nl); await stateRef.current.saveToCloud({opnameList: nl});
    await logApprovalHistory({type:"OPNAME", decision:"REJECTED", title:`Stock Opname ${opn.semester} (${opn.jenisAlur})`, items:(opn.items||[]).filter(i=>i.selisih!==0).map(i=>({label:i.nama, qty:i.selisih})), requestedBy:opn.dibuatOleh, requestedAt:opn.dibuatAt});
    showToast("❌ Opname ditolak.", "error");
  }
  async function deleteOpname(id) {
    if (!window.confirm("Hapus sesi opname ini?")) return;
    const nl = opnameListRef.current.filter(o=>o.id!==id);
    commitOpnameList(nl); await stateRef.current.saveToCloud({opnameList: nl});
    showToast("Opname dihapus.");
  }

  // Kode fallback untuk material Non-Stock yang TIDAK ketemu padanan MARA-nya —
  // format NS-<UPT singkat>-<urut 4 digit>, jelas beda dari kode SAP/MARA asli
  // (yang selalu angka murni) supaya tidak ada yang salah kira ini kode resmi.
  function generateNonStockFallbackCode() {
    const uptShort = (String(UPT || "").replace(/^UPT\s+/i, "").trim().slice(0, 3) || "UPT").toUpperCase();
    const prefix = `NS-${uptShort}-`;
    let maxN = 0;
    katalogList.forEach(k => {
      const m = String(k.katalog || "").match(new RegExp(`^${prefix}(\\d+)$`));
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    return `${prefix}${String(maxN + 1).padStart(4, "0")}`;
  }

  // Material Non-Stock yang ditemukan SAAT opname fisik (bukan dari upload SAP) —
  // KEPUTUSAN SENGAJA (Opsi A, disepakati user): katalog + stok dibuat LANGSUNG di
  // sini (bukan menunggu Manager approve seperti material baru SAP), berstatus
  // "pendingOpnameId" terisi, supaya QR/label bisa langsung dicetak & ditempel ke
  // barang selagi Admin/TL masih di depannya — tidak perlu balik ke gudang lagi
  // nanti. QR encode `katalog.id` (bukan field `katalog` yang bisa dikoreksi
  // belakangan kalau kandidat MARA ditemukan susulan), jadi label fisik tetap
  // valid walau kode katalognya diperbarui.
  async function addNonStockFoundItem({ opnameId, nama, katalogCode, satuan, qty, lokasiId, foto, belumDicocokkanMara }) {
    const code = katalogCode || generateNonStockFallbackCode();
    const newKatalogId = "KAT-" + code;
    if (katalogList.some(k => k.id === newKatalogId)) {
      showToast(`Kode katalog "${code}" sudah dipakai. Coba lagi.`, "error");
      return null;
    }
    // Foto ke Storage dulu (sama alasannya dengan updateStockFoto/saveStock — JANGAN
    // base64 mentah masuk jsonb stocks.data, insiden 2026-07-23 & 2026-07-28).
    let fotoUrl = null;
    const opnameSession = opnameListRef.current.find(opn => opn.id === opnameId);
    const sessionUptId = opnameSession?.uptId || opnameSession?.upt_id;
    if (foto && !sessionUptId) {
      showToast("Sesi opname tidak memiliki UPT. Foto tidak disimpan.", "error");
      return null;
    }
    try { fotoUrl = await uploadStockFoto(newKatalogId, "fotoKeseluruhan", foto, sessionUptId); }
    catch (e) {
      console.warn("Upload foto material baru (opname) gagal:", newKatalogId, e?.message||e);
      showToast("Gagal upload foto ke server, coba lagi.","error"); return null;
    }
    const now = Date.now();
    const newKatalog = {
      id: newKatalogId, katalog: code, name: nama,
      category: nama.split(";")[0].trim() || "Material",
      jenisBarang: "Non-Stock", satuan: satuan || "-", sapStatus: "Non-SAP",
      keterangan: `Ditemukan saat Stock Opname Non-SAP (menunggu approval sesi ${opnameId})`,
      pendingOpnameId: opnameId, belumDicocokkanMara: !!belumDicocokkanMara,
      createdAt: now,
    };
    const newStock = {
      id: "STK-OPN-" + code + "-" + now,
      katalogId: newKatalogId, lokasiId: lokasiId || null,
      uptId: sessionUptId || null,
      qty: Number(qty) || 0, price: 0, minQty: 0, unit: satuan || "-",
      jenisBarang: "Non-Stock", name: nama, katalog: code,
      category: nama.split(";")[0].trim() || "Material",
      fotoKeseluruhan: fotoUrl,
      pendingOpnameId: opnameId,
      createdAt: now, updatedAt: now,
    };
    const previousKatalogList = katalogList;
    const previousStocks = stocks;
    const nk = [...previousKatalogList, newKatalog];
    const ns = [...previousStocks, newStock];
    setKatalogList(nk); setStocks(ns);
    // Cuma 1 baris katalog & 1 baris stok baru ditambah — sync ringan baris itu saja.
    const saved = await stateRef.current.saveToCloud({ katalogList: nk, stocks: ns }, {katalogChangedRows: [newKatalog], stocksChangedRows: [newStock]});
    if (saved === false) {
      setKatalogList(previousKatalogList); setStocks(previousStocks);
      showToast("Material baru gagal disimpan ke server. Perubahan dibatalkan; coba lagi.", "error");
      return null;
    }
    return { ...newKatalog, fotoKeseluruhan: fotoUrl };
  }

  // ── STOCK COUNT (banding SAP vs Aplikasi) — read-only, TIDAK mengubah
  // Data Stok/Master Katalog sama sekali (beda dari "Import dari SAP" yang
  // memang sengaja mengganti Data Stok). Cuma membandingkan qty per material
  // ber-status SAP, lalu setiap temuan selisih menunggu approval Asman
  // (per item, bukan bulk — konsisten dengan aturan approval lain di app
  // ini). Approval di sini TIDAK memicu aksi otomatis apa pun (tidak bikin
  // draft TUG / tidak bikin Data Stok baru) — cuma menandai temuan itu valid
  // atau tidak, rekomendasi tindak lanjutnya tetap teks saran saja.
  function computeStockCountItems(sapRows) {
    const TOL_PCT = 5; // toleransi sama dengan widget "Akurasi Material" sebelumnya
    return (sapRows||[]).filter(r=>r.katalog).map(row => {
      const rk = normalizeKatalog(row.katalog);
      const kat = katalogList.find(k => normalizeKatalog(k.katalog) === rk);
      const qtyApp = kat
        ? stocks.filter(s => s.katalogId === kat.id && stockSapLabel(s) !== "Non-SAP")
                .reduce((a, s) => a + (s.qty || 0), 0)
        : 0;
      const qtySap = row.qty || 0;
      const selisih = qtyApp - qtySap;
      const selisihPct = qtySap===0 ? (qtyApp===0?0:100) : Math.round(Math.abs(selisih)/qtySap*1000)/10;
      let status = "AKURAT", rekomendasi = null;
      if (selisihPct > TOL_PCT) {
        if (selisih < 0) { status = "APP_KURANG"; rekomendasi = "TAMBAH_STOK"; }
        else { status = "APP_LEBIH"; rekomendasi = "BUAT_TUG_KELUAR"; }
      }
      return {
        id: `SCI-${uid().slice(-8)}`,
        katalogId: kat?.id || null,
        katalogKode: row.katalog,
        nama: row.nama || kat?.name || "(tidak ada di Master Katalog)",
        satuan: row.satuan || kat?.satuan || "-",
        qtySap, qtyApp, selisih, selisihPct, status, rekomendasi,
        approval: status==="AKURAT" ? null : "PENDING",
        approvedBy: null, approvedAt: null, catatan: null,
      };
    });
  }
  // Upload CSV/XLSX hanya menghasilkan DRAFT (dihitung di memori, belum
  // disimpan/belum terlihat siapa pun) — Admin me-review tiap item satu per
  // satu (termasuk material baru yang belum ada di Master Katalog) dan boleh
  // mencoret item yang tidak relevan, baru tombol "Simpan & Kirim ke Asman"
  // di review yang benar-benar membuat sesi dan memunculkan approval Asman.
  function previewStockCount(sapRows) {
    return computeStockCountItems(sapRows);
  }
  async function saveStockCountSession(items) {
    const akuratCount = items.filter(i=>i.status==="AKURAT").length;
    const session = {
      id: `SC-${uid().slice(-8)}`,
      uploadedAt: Date.now(), uploadedBy: currentUser.id,
      items,
      summary: { totalItem: items.length, akuratCount, akuratPct: items.length ? Math.round(akuratCount/items.length*100) : 0 },
    };
    const nsc = [session, ...stockCountList].slice(0, 50); // riwayat dibatasi 50 sesi terakhir
    setStockCountList(nsc);
    await stateRef.current.saveToCloud({ stockCountList: nsc });
    showToast(`✅ Stock Count disimpan: ${items.length} item, ${akuratCount} akurat.`);
    return session;
  }
  async function approveStockCountItem(sessionId, itemId, catatan) {
    const session = stockCountList.find(s=>s.id===sessionId);
    const item = session?.items.find(i=>i.id===itemId);
    if (!item) return;
    const nsc = stockCountList.map(s=>s.id!==sessionId ? s : {
      ...s, items: s.items.map(it=>it.id!==itemId?it:{...it, approval:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now(), catatan:catatan||it.catatan})
    });
    setStockCountList(nsc); await stateRef.current.saveToCloud({stockCountList: nsc});
    await logApprovalHistory({type:"STOCK_COUNT", decision:"APPROVED", title:`Temuan Stock Count: ${item.nama} (selisih ${item.selisih>0?"+":""}${item.selisih} ${item.satuan})`, items:[{label:item.nama, qty:item.selisih}], requestedBy:null, requestedAt:session.uploadedAt});
    showToast("✅ Temuan Stock Count disetujui.");
  }
  // Approval borongan — 1 setStockCountList + 1 saveToCloud utk semua item terpilih
  // (bisa lintas sesi, pairs = [{sessionId,itemId}]), bukan loop approveStockCountItem
  // per item (mahal ke self-host, lihat catatan tug3-base64-bloat-perf).
  async function approveStockCountItems(pairs, catatan) {
    if (!pairs || !pairs.length) return;
    const approvedItems = pairs.map(({sessionId, itemId}) => stockCountList.find(s=>s.id===sessionId)?.items.find(i=>i.id===itemId)).filter(Boolean);
    const bySession = new Map();
    pairs.forEach(({sessionId, itemId}) => {
      if (!bySession.has(sessionId)) bySession.set(sessionId, new Set());
      bySession.get(sessionId).add(itemId);
    });
    const now = Date.now();
    const nsc = stockCountList.map(s => {
      const itemIds = bySession.get(s.id);
      if (!itemIds) return s;
      return { ...s, items: s.items.map(it => itemIds.has(it.id)
        ? { ...it, approval:"APPROVED", approvedBy:currentUser.id, approvedAt:now, catatan:catatan||it.catatan }
        : it) };
    });
    setStockCountList(nsc);
    await stateRef.current.saveToCloud({stockCountList: nsc});
    // ponytail: log ringkas per-batch; pecah per-item bila audit trail per-barang diperlukan
    await logApprovalHistory({type:"STOCK_COUNT", decision:"APPROVED", title:`Temuan Stock Count: ${pairs.length} item disetujui`, items:approvedItems.map(i=>({label:i.nama, qty:i.selisih})), requestedBy:null, requestedAt:now});
    showToast(`✅ ${pairs.length} temuan Stock Count disetujui.`);
  }
  async function rejectStockCountItem(sessionId, itemId, catatan) {
    const session = stockCountList.find(s=>s.id===sessionId);
    const item = session?.items.find(i=>i.id===itemId);
    if (!item) return;
    const nsc = stockCountList.map(s=>s.id!==sessionId ? s : {
      ...s, items: s.items.map(it=>it.id!==itemId?it:{...it, approval:"REJECTED", approvedBy:currentUser.id, approvedAt:Date.now(), catatan:catatan||it.catatan})
    });
    setStockCountList(nsc); await stateRef.current.saveToCloud({stockCountList: nsc});
    await logApprovalHistory({type:"STOCK_COUNT", decision:"REJECTED", title:`Temuan Stock Count: ${item.nama} (selisih ${item.selisih>0?"+":""}${item.selisih} ${item.satuan})`, items:[{label:item.nama, qty:item.selisih}], requestedBy:null, requestedAt:session.uploadedAt});
    showToast("❌ Temuan Stock Count ditolak.");
  }
  async function deleteStockCountSession(id) {
    if (!window.confirm("Hapus sesi Stock Count ini?")) return;
    const nsc = stockCountList.filter(s=>s.id!==id);
    setStockCountList(nsc); await stateRef.current.saveToCloud({stockCountList: nsc});
    showToast("Sesi Stock Count dihapus.");
  }

  return {
    opnameList, setOpnameList,
    stockCountList, setStockCountList,
    opnameExpanded, setOpnameExpanded,
    opnameSubTab, setOpnameSubTab,
    saveOpname, submitOpname, approveOpname_Asman, rejectOpname, deleteOpname,
    addNonStockFoundItem,
    computeStockCountItems, previewStockCount, saveStockCountSession,
    approveStockCountItem, approveStockCountItems, rejectStockCountItem, deleteStockCountSession,
  };
}
