// Pure mapper/reducer for Supabase Realtime events from public.stocks.
// The UI contract deliberately mirrors loadMasterTable(): `{ ...row.data, id: row.id }`.

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStockId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && valuesEqual(left[key], right[key]));
}

export function mapRealtimeStockRow(row) {
  if (!isRecord(row) || !isStockId(row.id) || !isRecord(row.data)) return null;
  return { ...row.data, id: row.id };
}

export function stockListsEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((stock, index) => valuesEqual(stock, right[index]));
}

// INSERT and UPDATE both replace the canonical object by ID. Replacing rather
// than merging prevents fields removed in the database from surviving in UI state.
export function applyStockRealtimeEvent(stocks, payload) {
  if (!Array.isArray(stocks) || !isRecord(payload)) return stocks;
  const eventType = payload.eventType;
  if (eventType === "INSERT" || eventType === "UPDATE") {
    const nextStock = mapRealtimeStockRow(payload.new);
    if (!nextStock) return stocks;
    const index = stocks.findIndex(stock => stock?.id === nextStock.id);
    if (index === -1) return [...stocks, nextStock];
    if (valuesEqual(stocks[index], nextStock)) return stocks;
    const next = [...stocks];
    next[index] = nextStock;
    return next;
  }
  if (eventType === "DELETE") {
    const id = payload.old?.id;
    if (!isStockId(id)) return stocks;
    const index = stocks.findIndex(stock => stock?.id === id);
    return index === -1 ? stocks : stocks.filter(stock => stock?.id !== id);
  }
  return stocks;
}

export function applyStockRealtimeEvents(stocks, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return stocks;
  return payloads.reduce((current, payload) => applyStockRealtimeEvent(current, payload), stocks);
}
