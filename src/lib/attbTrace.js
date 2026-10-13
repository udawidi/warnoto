export const ATTB_SOURCE_PREFIX = "TUG10";

export function attbSourceKey(txnId, itemIndex) {
  if (!txnId || !Number.isInteger(Number(itemIndex)) || Number(itemIndex) < 0) return "";
  return `${ATTB_SOURCE_PREFIX}|${txnId}|${Number(itemIndex)}`;
}

export function attbPublicUrl(attbId, token, origin = "") {
  if (!attbId || !token) return "";
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return `/?attb=${encodeURIComponent(attbId)}#t=${encodeURIComponent(token)}`;
  return `${base.replace(/\/$/, "")}/?attb=${encodeURIComponent(attbId)}#t=${encodeURIComponent(token)}`;
}

export function parseAttbPublicParams(search = "", hash = "") {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ""));
  return { attbId: query.get("attb") || "", token: fragment.get("t") || "" };
}

export function isAttbUnit(item) { return item?.statusMaterial === "Bongkaran ATTB (MTU)"; }
export function isAttbUnitValid(item) {
  return isAttbUnit(item) && Number(item.qty) === 1 && (!!item.noSeri?.trim() || !!item.noAsset?.trim());
}

export function safeAttbPhotoPath(value) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || /^https?:\/\//i.test(path) || path.includes("\\")) return "";
  return path;
}

export function attbPhotoUrl(value, supabaseUrl) {
  const path = safeAttbPhotoPath(value);
  if (!path || !supabaseUrl) return "";
  return `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/tug-photos/${path}`;
}
