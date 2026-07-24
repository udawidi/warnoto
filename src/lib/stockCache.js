// Cache helpers for Data Stok. Keep only durable remote photo URLs; data/blob
// URLs are either too large or invalid after a page reload.
export function keepRemoteStockPhoto(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return /^https?:\/\//i.test(value) ? value : undefined;
}

// Browser image requests do not use the Supabase client's development fetch
// proxy.  Keep canonical URLs in state/cache, but route self-hosted Storage
// assets through Vite's same-origin proxy during local development so a local
// certificate cannot break <img> rendering.  Other origins and production are
// intentionally left untouched.
export function resolveStockPhotoUrl(value) {
  if (typeof value !== "string" || !value.trim()) return value;
  if (!import.meta.env.DEV) return value;
  try {
    const url = new URL(value);
    if (url.origin !== "https://warnoto.com") return value;
    return `/supabase${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

export function leanStocksForCache(list) {
  return (Array.isArray(list) ? list : []).map(s => ({
    ...s,
    fotoKeseluruhan: keepRemoteStockPhoto(s.fotoKeseluruhan),
    fotoNameplate: keepRemoteStockPhoto(s.fotoNameplate),
  }));
}
