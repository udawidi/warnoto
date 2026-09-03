import { useState } from "react";
import { UPT } from "../constants.js";
import { uid } from "../lib/utils.js";
import { hasRole } from "../lib/roles.js";
import { normalizeKatalog, totalQtyForKatalog, sumHitungPerLokasi, itemCounted } from "../lib/sap.js";
import { loadMasterTable } from "../lib/masterSync.js";

function readCachedList(key) {
  try { return JSON.parse(localStorage.getItem('warnoto_' + key) || "null"); } catch { return null; }
}

// Domain Stock Opname & Stock Count: sesi opname fisik (draft->submit->approve Asman->approve
// Manager, termasuk temuan material baru/Non-Stock) + Stock Count (banding SAP vs Aplikasi,
// read-only, approval temuan selisih per item). saveToCloud/uploadStockFoto diakses lewat
// stateRef.current / param langsung (hoisted function) — sama pola dgn hook lain, lihat
// useHeavyEquipment.js untuk penjelasan lengkap TDZ.
export function useStockOpname({ currentUser, showToast, stateRef, logApprovalHistory, katalogList, setKatalogList, stocks, setStocks, uploadStockFoto }) {
  const [opnameList, setOpnameList] = useState(() => readCachedList("pln_opname_v1") ?? []);
  const [stockCountList, setStockCountList] = useState(() => readCachedList("pln_stockcount_v1") ?? []); // riwayat sesi Stock Count (banding SAP vs Aplikasi)
  const [opnameExpanded, setOpnameExpanded] = useState(false); // sidebar accordion state for Stock Opname & Stock Count (digabung 1 menu)
  const [opnameSubTab, setOpnameSubTab] = useState("opname"); // "opname" | "stockCount"

  // Fase 1d: sesi bisa diedit dari >1 perangkat/tab sekaligus (per blok/lokasi berbeda) — dulu
  // saveOpname menimpa SELURUH sesi (last-write-wins), blok yang barusan disimpan perangkat lain
  // bisa hilang. Kalau caller kasih touchedLokasiIds (blok yang BENAR disentuh perangkat ini),
  // ambil versi sesi terbaru dari server dulu, lalu tulis balik cuma blok itu — sisanya dari
  // server. Gagal ambil (offline) → simpan LOKAL saja, jangan menimpa server dgn data parsial.
  async function saveOpname(opn, touchedLokasiIds) {
    let toSave = opn;
    let syncPending = false;
    if (Array.isArray(touchedLokasiIds) && touchedLokasiIds.length) {
      try {
        const serverList = await loadMasterTable("stock_opname"); // null = fetch gagal (lihat masterSync.js)
        if (!Array.isArray(serverList)) { syncPending = true; }
        else {
          const serverOpn = serverList.find(o=>o.id===opn.id);
          // serverOpn undefined = sesi memang belum pernah tersimpan di server (draft baru pertama
          // kali) — bukan kegagalan, lanjut simpan opn apa adanya seperti biasa.
          if (serverOpn) toSave = mergeOpnameForSave(opn, serverOpn, touchedLokasiIds);
        }
      } catch {
        syncPending = true;
      }
    }
    const exists = opnameList.find(o=>o.id===toSave.id);
    const nl = exists ? opnameList.map(o=>o.id===toSave.id?toSave:o) : [...opnameList, toSave];
    setOpnameList(nl);
    if (syncPending) {
      showToast("⚠️ Disimpan lokal — sinkronisasi ke server tertunda (offline/gagal ambil versi terbaru). Coba \"Simpan Draft\" lagi setelah online.", "error");
      return false;
    }
    await stateRef.current.saveToCloud({opnameList: nl});
    showToast("✅ Data opname disimpan!");
    return true;
  }

  // Merge per-item: blok (hitungPerLokasi) yang TIDAK disentuh perangkat ini diambil dari versi
  // server (punya perangkat lain), blok yang disentuh diambil dari versi lokal. Item lokal yang
  // tidak ada di server (mis. temuan Non-Stock baru) tetap dipakai. Item yang ada di server tapi
  // hilang di lokal (device ini belum sempat load versi terbaru) TIDAK dibuang — ikut ditambahkan.
  function mergeOpnameForSave(localOpn, serverOpn, touchedLokasiIds) {
    const touched = new Set(touchedLokasiIds);
    const serverByKey = new Map((serverOpn.items||[]).map(it=>[it.katalogId || it.noKatalog, it]));
    const items = (localOpn.items||[]).map(item => {
      const key = item.katalogId || item.noKatalog;
      const serverItem = serverByKey.get(key);
      if (!serverItem) return item;
      const mergedHitung = { ...(serverItem.hitungPerLokasi||{}) };
      touched.forEach(lokKey => {
        const localEntry = (item.hitungPerLokasi||{})[lokKey];
        if (localEntry) mergedHitung[lokKey] = localEntry; else delete mergedHitung[lokKey];
      });
      const qtsFisik = sumHitungPerLokasi(mergedHitung);
      return { ...serverItem, ...item, hitungPerLokasi: mergedHitung, qtsFisik, selisih: qtsFisik - (serverItem.qtySistem ?? item.qtySistem ?? 0) };
    });
    const localKeys = new Set(items.map(it=>it.katalogId || it.noKatalog));
    const onlyOnServer = (serverOpn.items||[]).filter(it=>!localKeys.has(it.katalogId||it.noKatalog));
    return { ...serverOpn, ...localOpn, items: [...items, ...onlyOnServer] };
  }
  async function submitOpname(opn) {
    const updated = {...opn, status:"PENDING_ASMAN", submittedAt:Date.now()};
    // Sesi baru yang langsung di-submit tanpa pernah "Simpan Draft" dulu belum ada di
    // opnameList sama sekali (startOpname cuma setActiveOpname, tidak append ke list) —
    // pakai pola exists?map:append sama seperti saveOpname, supaya tidak silently dropped.
    const exists = opnameList.find(o=>o.id===opn.id);
    const nl = exists ? opnameList.map(o=>o.id===opn.id?updated:o) : [...opnameList, updated];
    setOpnameList(nl);
    await stateRef.current.saveToCloud({opnameList: nl});
    showToast("📋 Opname disubmit! Menunggu approval Asman.");
  }
  async function approveOpname_Asman(opn, catatan) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman yang bisa approve.","error"); return; }
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
    const nowOpn = Date.now();
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
      newStocks = [...newStocks, {
        id: "STK-OPN-" + noKatalog + "-" + nowOpn,
        katalogId: newKatalogId, lokasiId: null,
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
    const fotoByKatalog = {};
    for (const item of (opn.items||[])) {
      if (!itemCounted(item) || !item.katalogId) continue;
      countedKatalogIds.add(item.katalogId);
      for (const field of ["fotoKeseluruhan","fotoNameplate"]) {
        const val = item[field];
        if (typeof val === "string" && val.startsWith("data:")) {
          try {
            const url = await uploadStockFoto(item.katalogId, field, val, currentUser?.uptId);
            fotoByKatalog[item.katalogId] = { ...(fotoByKatalog[item.katalogId]||{}), [field]: url };
          } catch (e) { console.warn("Upload foto opname gagal", item.katalogId, field, e?.message||e); }
        }
      }
    }
    newStocks = newStocks.map(s => {
      if (!countedKatalogIds.has(s.katalogId)) return s;
      const hist = Array.isArray(s.opnameHistory) ? s.opnameHistory : [];
      const already = hist.some(h => h.opnameId === opn.id);
      const foto = fotoByKatalog[s.katalogId] || {};
      return { ...s,
        opnameHistory: already ? hist : [...hist, histEntry],
        ...(foto.fotoKeseluruhan ? { fotoKeseluruhan: foto.fotoKeseluruhan } : {}),
        ...(foto.fotoNameplate ? { fotoNameplate: foto.fotoNameplate } : {}),
        updatedAt: nowHist,
      };
    });

    // Opname selesai = otomatis unfreeze (kalau masih freeze aktif) — tidak perlu langkah manual.
    const freezeOnFinish = opn.freeze?.aktif ? { ...opn.freeze, aktif:false, unfrozenAt: Date.now() } : opn.freeze;
    const updated = {...opn, status:"SELESAI", approvedByAsman:currentUser.id, approvedAtAsman:Date.now(), catatanAsman:catatan||"", freeze: freezeOnFinish, notulen: notulenList.length ? notulenList : (opn.notulen||[])};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl); setStocks(newStocks); setKatalogList(newKatalogList);
    await stateRef.current.saveToCloud({opnameList: nl, stocks: newStocks, katalogList: newKatalogList});
    // Ditemukan 2026-07-07: approve/reject Opname tidak pernah lapor ke logApprovalHistory
    // (beda dari semua jenis approval lain — Lokasi, Stock Move/Edit/Delete, Alat Berat,
    // Stock Count), jadi keputusannya tidak pernah muncul di "Riwayat Approval" terpusat.
    await logApprovalHistory({type:"OPNAME", decision:"APPROVED", title:`Stock Opname ${opn.semester} (${opn.jenisAlur})`, requestedBy:opn.dibuatOleh, requestedAt:opn.dibuatAt});
    let msg = "✅ Stock Opname SELESAI! Data Stok disesuaikan.";
    if (materialBaruDibuat.length) msg += ` ${materialBaruDibuat.length} material baru ditambahkan ke Master Katalog.`;
    if (materialBaruKonflik.length) msg += ` ⚠️ ${materialBaruKonflik.length} material baru TIDAK ditambahkan (bentrok No. Katalog): ${materialBaruKonflik.slice(0,2).join("; ")}${materialBaruKonflik.length>2?"...":""}.`;
    if (konfirmasiNonStock) msg += ` ${konfirmasiNonStock} material Non-Stock hasil opname dikonfirmasi aktif.`;
    if (notulenList.length) msg += ` + ${notulenList.length} material Non-SAP diusulkan pindah kategori.`;
    showToast(msg, materialBaruKonflik.length ? "error" : "success");
  }
  // Fase 3 — freeze/unfreeze gudang selama sesi opname berjalan. Mode PERINGATAN saja
  // (lihat useTugTransactions.commitNewTxn): transaksi TUG dari/ke gudang yang di-freeze
  // tetap boleh jalan, cuma dikonfirmasi dulu. Disimpan di jsonb (field opname), TANPA
  // migration/skema baru. Sesi lama (freeze:null) aman lewat optional chaining di semua pembaca.
  async function setOpnameFreeze(opn, { aktif, gudangIds }) {
    if (!hasRole(currentUser, "ADMIN", "TL", "ASMAN")) { showToast("Role kamu tidak bisa mengubah status freeze.","error"); return; }
    const now = Date.now();
    const freeze = aktif
      ? { aktif: true, gudangIds: gudangIds||[], at: now, by: currentUser.id, unfrozenAt: null }
      : { ...(opn.freeze||{}), aktif: false, unfrozenAt: now };
    const updated = { ...opn, freeze };
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl);
    await stateRef.current.saveToCloud({ opnameList: nl });
    showToast(aktif ? "🧊 Gudang di-freeze untuk sesi opname ini." : "Freeze gudang dinonaktifkan.");
  }
  async function rejectOpname(opn, reason) {
    // Fase A — sesi ditolak = lepas freeze juga (kalau masih aktif), sama seperti selesai
    // di approveOpname_Asman: gudang tidak boleh nyangkut freeze dari sesi yang sudah mati.
    const freezeOnReject = opn.freeze?.aktif ? { ...opn.freeze, aktif:false, unfrozenAt: Date.now() } : opn.freeze;
    const updated = {...opn, status:"DITOLAK", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason, freeze: freezeOnReject};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl); await stateRef.current.saveToCloud({opnameList: nl});
    await logApprovalHistory({type:"OPNAME", decision:"REJECTED", title:`Stock Opname ${opn.semester} (${opn.jenisAlur})`, requestedBy:opn.dibuatOleh, requestedAt:opn.dibuatAt});
    showToast("❌ Opname ditolak.", "error");
  }
  async function deleteOpname(id) {
    if (!window.confirm("Hapus sesi opname ini?")) return;
    const nl = opnameList.filter(o=>o.id!==id);
    setOpnameList(nl); await stateRef.current.saveToCloud({opnameList: nl});
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
    try { fotoUrl = await uploadStockFoto(newKatalogId, "fotoKeseluruhan", foto, currentUser?.uptId); }
    catch (e) {
      console.warn("Upload foto material baru (opname) gagal:", newKatalogId, e?.message||e);
      showToast("Gagal upload foto ke server, coba lagi.","error"); return null;
    }
    const now = Date.now();
    const newKatalog = {
      id: newKatalogId, katalog: code, name: nama,
      category: nama.split(";")[0].trim() || "Material",
      jenisBarang: "Non-Stock", satuan: satuan || "-",
      keterangan: `Ditemukan saat Stock Opname Non-SAP (menunggu approval sesi ${opnameId})`,
      pendingOpnameId: opnameId, belumDicocokkanMara: !!belumDicocokkanMara,
      createdAt: now,
    };
    const newStock = {
      id: "STK-OPN-" + code + "-" + now,
      katalogId: newKatalogId, lokasiId: lokasiId || null,
      uptId: currentUser?.uptId || null,
      qty: Number(qty) || 0, price: 0, minQty: 0, unit: satuan || "-",
      jenisBarang: "Non-Stock", name: nama, katalog: code,
      category: nama.split(";")[0].trim() || "Material",
      fotoKeseluruhan: fotoUrl,
      pendingOpnameId: opnameId,
      createdAt: now, updatedAt: now,
    };
    const nk = [...katalogList, newKatalog];
    const ns = [...stocks, newStock];
    setKatalogList(nk); setStocks(ns);
    // Cuma 1 baris katalog & 1 baris stok baru ditambah — sync ringan baris itu saja.
    await stateRef.current.saveToCloud({ katalogList: nk, stocks: ns }, {katalogChangedRows: [newKatalog], stocksChangedRows: [newStock]});
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
      const kat = katalogList.find(k=>k.katalog===row.katalog);
      const qtyApp = kat ? totalQtyForKatalog(kat.id, stocks) : 0;
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
    await logApprovalHistory({type:"STOCK_COUNT", decision:"APPROVED", title:`Temuan Stock Count: ${item.nama} (selisih ${item.selisih>0?"+":""}${item.selisih} ${item.satuan})`, requestedBy:null, requestedAt:session.uploadedAt});
    showToast("✅ Temuan Stock Count disetujui.");
  }
  async function rejectStockCountItem(sessionId, itemId, catatan) {
    const session = stockCountList.find(s=>s.id===sessionId);
    const item = session?.items.find(i=>i.id===itemId);
    if (!item) return;
    const nsc = stockCountList.map(s=>s.id!==sessionId ? s : {
      ...s, items: s.items.map(it=>it.id!==itemId?it:{...it, approval:"REJECTED", approvedBy:currentUser.id, approvedAt:Date.now(), catatan:catatan||it.catatan})
    });
    setStockCountList(nsc); await stateRef.current.saveToCloud({stockCountList: nsc});
    await logApprovalHistory({type:"STOCK_COUNT", decision:"REJECTED", title:`Temuan Stock Count: ${item.nama} (selisih ${item.selisih>0?"+":""}${item.selisih} ${item.satuan})`, requestedBy:null, requestedAt:session.uploadedAt});
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
    setOpnameFreeze,
    addNonStockFoundItem,
    computeStockCountItems, previewStockCount, saveStockCountSession,
    approveStockCountItem, rejectStockCountItem, deleteStockCountSession,
  };
}
