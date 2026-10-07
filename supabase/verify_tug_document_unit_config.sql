-- Read-only verification for the TUG document-unit seed and targeted repairs.
\set ON_ERROR_STOP on

do $$
declare
  v_expected record;
  v_unit text;
  v_last bigint;
begin
  for v_expected in
    select * from (values
      ('UPT-SBY', 'SBYA'), ('UPT-PBG', 'PBLG'), ('UPT-MLG', 'MLG'),
      ('UPT-MDN', 'MDN'), ('UPT-BLI', 'BLI'), ('UPT-GRS', 'GRS')
    ) as units(upt_id, document_unit_code)
  loop
    select document_unit_code, last_value
      into v_unit, v_last
    from public.tug_global_document_counters
    where upt_id = v_expected.upt_id;

    if v_unit is null then
      raise exception 'VERIFY_TUG_DOCUMENT_UNIT_CONFIG_MISSING: %', v_expected.upt_id;
    end if;
    if v_unit <> v_expected.document_unit_code then
      raise exception 'VERIFY_TUG_DOCUMENT_UNIT_CODE_INVALID: %', v_expected.upt_id;
    end if;
    if v_last < 0 then
      raise exception 'VERIFY_TUG_DOCUMENT_COUNTER_INVALID: %', v_expected.upt_id;
    end if;
  end loop;

  if exists (
    select 1 from public.tug3_transactions
    where upt_id <> 'UPT-SBY'
      and (
        coalesce(doc_number, '') like '%/UPT-SBYA/%'
        or coalesce(data->'docNumbers'->>'tug3', '') like '%/UPT-SBYA/%'
        or coalesce(data->'docNumbers'->>'tug4', '') like '%/UPT-SBYA/%'
      )
  ) then
    raise exception 'VERIFY_TUG3_NON_SBY_SURABAYA_UNIT';
  end if;

  if exists (
    select 1 from public.tug10_transactions
    where upt_id <> 'UPT-SBY'
      and (
        coalesce(doc_number, '') like '%/UPT-SBYA/%'
        or coalesce(data->'docNumbers'->>'tug10', '') like '%/UPT-SBYA/%'
      )
  ) then
    raise exception 'VERIFY_TUG10_NON_SBY_SURABAYA_UNIT';
  end if;
end $$;

select 'TUG_DOCUMENT_UNIT_CONFIG_OK' as result,
       upt_id,
       document_unit_code,
       last_value,
       updated_at
from public.tug_global_document_counters
where upt_id in ('UPT-SBY', 'UPT-PBG', 'UPT-MLG', 'UPT-MDN', 'UPT-BLI', 'UPT-GRS')
order by upt_id;
