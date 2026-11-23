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
