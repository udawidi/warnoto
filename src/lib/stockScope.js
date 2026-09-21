// Scope Stock Opname/Count ke UPT. Kolom typed dibaca/dikirim hanya setelah
// kedua tabel benar-benar memilikinya; sebelum migration, payload lama tetap utuh.

let schemaProbe = null;

export function deriveStockUptId(row, { profiles = [], currentUser = null } = {}) {
  if (row?.upt_id !== undefined) return row.upt_id || null;
  if (row?.uptId !== undefined) return row.uptId || null;
  const actorId = row?.dibuatOleh || row?.uploadedBy || row?.createdBy || row?.created_by;
  const actor = actorId && profiles.find(profile => profile?.id === actorId);
  return actor?.uptId || actor?.upt_id || (actorId && actorId === currentUser?.id
    ? (currentUser.uptId || currentUser.upt_id || null)
    : null);
}

export function stockScopeExtraCols(row, context, enabled) {
  if (!enabled) return {};
  return { upt_id: deriveStockUptId(row, context) };
}

export function mapStockScopeRow(row) {
  const data = row?.data || {};
  const uptId = row && Object.prototype.hasOwnProperty.call(row, "upt_id")
    ? row.upt_id
    : data.uptId;
  const updatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : data.updatedAt;
  return { ...data, id: row?.id, ...(uptId !== undefined ? { uptId } : {}), ...(updatedAt ? { updatedAt } : {}) };
}

export function resetStockScopeSchemaProbe() { schemaProbe = null; }

export async function stockScopeColumnsAvailable(client) {
  if (!client) return false;
  if (!schemaProbe) {
    schemaProbe = Promise.all([
      client.from("stock_opname").select("upt_id").limit(1),
      client.from("stock_count").select("upt_id").limit(1),
    ]).then(results => results.every(result => !result?.error)).catch(() => false);
  }
  return schemaProbe;
}
