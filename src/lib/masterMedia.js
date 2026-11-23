const fields = { stocks: ["img"], gudang: ["fotoGudang", "denahImageData"], sub_gudang: ["denahImageData"] };
export const compactMasterTables = new Map(Object.keys(fields).map(table => [table, null]));

export function masterMediaRef(value) {
  if (typeof value !== "string") return null;
  const match = /^(wmedia|wcache):([^:]+):([^:]+):([0-9a-f]{32}|current):(.+)$/.exec(value);
  if (!match || !Object.hasOwn(fields, match[2]) || !fields[match[2]].includes(match[3])) return null;
  return { table: match[2], field: match[3], id: match[5] };
}

export function cachedMasterMedia(table, row) {
  if (!row.id || !fields[table]) return row;
  let result = row;
  for (const field of fields[table]) {
    if (typeof row[field] === "string" && row[field].startsWith("data:image/")) {
      if (result === row) result = { ...row };
      result[field] = `wcache:${table}:${field}:current:${row.id}`;
    }
  }
  return result;
}

export function hasUnwritableMedia(table, rows) {
  const compactAvailable = compactMasterTables.get(table) === true;
  return fields[table]?.some(field => rows.some(row => {
    const value = row[field];
    return typeof value === "string" && (value.startsWith("wcache:") || (!compactAvailable && value.startsWith("wmedia:")));
  })) || false;
}
