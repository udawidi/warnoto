-- Restore only the known MTU KHS batches changed by 20260912e.
begin;
do $rollback$
declare batch_keys text[]:=array['MTU-BATCH-2024-7b82bcf3f73c66e4','MTU-BATCH-2026-7b82bcf3f73c66e4'];
begin
  update public.mtu_khs_records r set
    data=(r.data-'_lifecycleCatalogRollback'-'onsiteDate'-'onsiteDates'-'onsiteDateOriginal'-'installationDate'-'installationDates'-'installationDateOriginal'
      -'installedQty'-'remainingQty'-'installationStatus'-'lifecycleStatus'-'lifecycleSource'-'katalogId'-'catalogNumber'-'materialDescription'-'catalogType'-'catalogWarning')
      ||(coalesce(r.data->'_lifecycleCatalogRollback','{}'::jsonb)-'_columnLifecycleStatus'-'_columnKatalogId'),
    katalog_id=nullif(r.data->'_lifecycleCatalogRollback'->>'_columnKatalogId',''),
    lifecycle_status=coalesce(nullif(r.data->'_lifecycleCatalogRollback'->>'_columnLifecycleStatus',''),'VENDOR'),updated_at=now()
  where r.data->'_migration'->>'batchKey'=any(batch_keys);

  update public.mtu_khs_import_rows ir set
    normalized_data=normalized_data-'katalogId'-'catalogNumber'-'materialDescription'-'catalogType',
    validation_warnings='[]'::jsonb
  where ir.batch_id=any(batch_keys);

  update public.mtu_khs_specs s set data=data-'description'-'noSapStok'-'noSapCadang'-'catalogSource'
  where s.procurement_year=2024 and data->>'catalogSource'='KHS_SPESIFIKASI_2024';

  delete from public.katalog k where k.data->>'migrationKey'='MTU-LIFECYCLE-CATALOG-20260912E'
    and not exists(select 1 from public.mtu_khs_records r where r.katalog_id=k.id)
    and not exists(select 1 from public.stock_current s where s.katalog_id=k.id);
end $rollback$;

alter table public.mtu_khs_records drop constraint if exists mtu_khs_records_lifecycle_status_check;
alter table public.mtu_khs_records add constraint mtu_khs_records_lifecycle_status_check check(lifecycle_status in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','CANCELLED'));
alter table public.mtu_khs_units drop constraint if exists mtu_khs_units_lifecycle_status_check;
alter table public.mtu_khs_units add constraint mtu_khs_units_lifecycle_status_check check(lifecycle_status in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','CANCELLED'));
commit;
