// Abstraksi penyimpanan cloud/local (window.storage atau localStorage) — dipindah dari App.jsx Fase 5h.

import { cachedMasterMedia } from "./masterMedia.js";

export const CLOUD = {
  async get(key) {
    try {
      if (typeof window.storage !== 'undefined') {
        const r = await window.storage.get(key);
        return r ? JSON.parse(r.value) : null;
      } else {
        const val = localStorage.getItem('warnoto_' + key);
        return val ? JSON.parse(val) : null;
      }
    } catch { return null; }
  },
  async set(key, val) {
    try {
      const table = { pln_gudang_v1: "gudang", pln_sub_gudang_v1: "sub_gudang" }[key];
      if (table && Array.isArray(val)) val = val.map(row => cachedMasterMedia(table, row));
      if (typeof window.storage !== 'undefined') {
        await window.storage.set(key, JSON.stringify(val));
      } else {
        localStorage.setItem('warnoto_' + key, JSON.stringify(val));
      }
      return true;
    } catch { return false; }
  },
};

// Bind the cache to the verified account. The previous key is imported only
// for the account that owned the cached profile at startup.
export function txnCacheKey(user) {
  if (!user?.id) throw new Error("Akun cache transaksi belum tersedia.");
  return `pln_txns_v3_${JSON.stringify([user.id, user.role, user.uptId, user.uitId, user.ultgId, [...(user.gudangIds || [])].sort()])}`;
}

export async function readTxnCache(owner, previousOwner) {
  const scoped = await CLOUD.get(owner);
  if (scoped || previousOwner !== owner) return scoped;
  const legacy = await CLOUD.get("pln_txns_v3");
  if (!Array.isArray(legacy)) return null;
  // Claim the old cache before the profile can be overwritten by a new login.
  let legacyOwner;
  try {
    legacyOwner = localStorage.getItem("warnoto_legacy_txn_owner");
    if (!legacyOwner) localStorage.setItem("warnoto_legacy_txn_owner", owner);
  } catch { return null; }
  if (legacyOwner && legacyOwner !== owner) return null;
  await CLOUD.set(owner, legacy);
  return legacy;
}
