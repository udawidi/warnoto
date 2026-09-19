export async function approveStockOpnameAtomically({ supabase, opnameId, opnameData, katalogRows, stockRows }) {
  if (!supabase) return { ok: false, error: new Error("Koneksi server Stock Opname tidak tersedia.") };
  const { data, error } = await supabase.rpc("approve_stock_opname_asman", {
    p_opname_id: opnameId,
    p_opname_data: opnameData,
    p_katalog_rows: katalogRows || [],
    p_stock_rows: stockRows || [],
  });
  if (error) return { ok: false, error };
  return { ok: data?.ok === true, data, error: data?.ok === true ? null : new Error("Server tidak mengonfirmasi approval Stock Opname.") };
}
