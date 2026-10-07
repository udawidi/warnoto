-- Seed the canonical document unit for UPT Probolinggo.
-- Deliberately do not overwrite an existing counter or unit-code configuration.
insert into public.tug_global_document_counters (upt_id, document_unit_code, last_value)
values ('UPT-PBG', 'PBLG', 0)
on conflict (upt_id) do nothing;
