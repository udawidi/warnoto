-- Seed every canonical UPT document-unit counter without rewriting existing values.
insert into public.tug_global_document_counters (upt_id, document_unit_code, last_value)
values
  ('UPT-SBY', 'SBYA', 225),
  ('UPT-PBG', 'PBLG', 0),
  ('UPT-MLG', 'MLG', 0),
  ('UPT-MDN', 'MDN', 0),
  ('UPT-BLI', 'BLI', 0),
  ('UPT-GRS', 'GRS', 0)
on conflict (upt_id) do nothing;

-- Targeted repair of known dedicated TUG-3/4 data. Exact id, UPT, and old
-- suffix guards make reruns safe and preserve sequence/date/stage/status.
update public.tug3_transactions
set doc_number = replace(doc_number, '/UPT-SBYA/', '/UPT-PBLG/'),
    data = jsonb_set(
      data,
      '{docNumbers,tug3}',
      to_jsonb(replace(data->'docNumbers'->>'tug3', '/UPT-SBYA/', '/UPT-PBLG/')),
      false
    )
where id = 'TUG3-WKZ833'
  and upt_id = 'UPT-PBG'
  and doc_number like '%/UPT-SBYA/%'
  and data->'docNumbers'->>'tug3' like '%/UPT-SBYA/%';

update public.tug3_transactions
set data = jsonb_set(
      data,
      '{docNumbers,tug4}',
      to_jsonb(replace(data->'docNumbers'->>'tug4', '/UPT-SBYA/', '/UPT-PBLG/')),
      false
    )
where id = 'TUG3-WKZ833'
  and upt_id = 'UPT-PBG'
  and data->'docNumbers'->>'tug4' like '%/UPT-SBYA/%';

-- Targeted repair of the known dedicated TUG-10 record.
update public.tug10_transactions
set doc_number = replace(doc_number, '/UPT-SBYA/', '/UPT-GRS/'),
    data = jsonb_set(
      data,
      '{docNumbers,tug10}',
      to_jsonb(replace(data->'docNumbers'->>'tug10', '/UPT-SBYA/', '/UPT-GRS/')),
      false
    )
where id = 'TUG10-PHJ4JC'
  and upt_id = 'UPT-GRS'
  and doc_number like '%/UPT-SBYA/%'
  and data->'docNumbers'->>'tug10' like '%/UPT-SBYA/%';
