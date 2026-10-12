-- Narrow, idempotent repair for the benchmarked SAP legacy-code orphan.
-- Fail closed unless the exact MARA candidate remains unique and unchanged.
do $migration$
declare
  v_mara public.mara_catalog;
  v_candidate_count integer;
  v_catalog_count integer;
  v_stock_count integer;
  v_category text;
begin
  select count(*) into v_candidate_count
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = '4160255';
  if v_candidate_count <> 1 then
    raise exception 'MARA_ORPHAN_REPAIR_CANDIDATE_INVALID: expected one MARA key 4160255, found %', v_candidate_count;
  end if;

  select * into v_mara
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = '4160255';
  if btrim(coalesce(v_mara.kode_material, '')) <> '000000004160255'
     or btrim(coalesce(v_mara.nama, '')) <> 'CABLE CTRL;NYY;1X50mm2;0.6/1kV;UG'
     or btrim(coalesce(v_mara.satuan, '')) <> 'M'
     or btrim(coalesce(v_mara.material_group_desc, '')) <> 'CABLE CONTROL(<10MM)' then
    raise exception 'MARA_ORPHAN_REPAIR_CANDIDATE_CHANGED';
  end if;
  v_category := btrim(v_mara.material_group_desc);

  select count(*) into v_catalog_count
  from public.katalog
  where id = 'KAT-1004160255';
  if v_catalog_count <> 1 then
    raise exception 'MARA_ORPHAN_REPAIR_CATALOG_INVALID: expected KAT-1004160255';
  end if;

  select count(*) into v_stock_count
  from public.stocks
  where id = 'STK-SAP-3615-1004160255';
  if v_stock_count <> 1 then
    raise exception 'MARA_ORPHAN_REPAIR_STOCK_INVALID: expected STK-SAP-3615-1004160255';
  end if;

  update public.katalog
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'katalog', btrim(v_mara.kode_material),
    'name', btrim(v_mara.nama),
    'satuan', btrim(v_mara.satuan),
    'unit', btrim(v_mara.satuan),
    'category', v_category,
    'maraCode', btrim(v_mara.kode_material),
    '_maraLocked', true
  )
  where id = 'KAT-1004160255';

  update public.stocks
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'katalog', btrim(v_mara.kode_material),
    'name', btrim(v_mara.nama),
    'satuan', btrim(v_mara.satuan),
    'unit', btrim(v_mara.satuan),
    'category', v_category,
    'maraCode', btrim(v_mara.kode_material),
    '_maraLocked', true
  )
  where id = 'STK-SAP-3615-1004160255';
end;
$migration$;
