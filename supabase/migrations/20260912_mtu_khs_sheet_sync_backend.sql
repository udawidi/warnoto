-- MTU KHS: database-canonical Sheet mirror, paginated read RPC, and safe sync queue.
-- Applied to self-hosted production on 2026-09-12 after backup verification.

begin;

-- TUG usage links are intentionally not mirrored to `KETERANGAN (TUG)` in v1.
-- That source column is a free-form operational note; mapping it safely needs a
-- dedicated idempotency key and column-level contract. No speculative overwrite.

create table if not exists public.mtu_khs_sheet_sync_jobs (
  id text primary key,
  change_request_id text not null references public.mtu_khs_change_requests(id) on delete restrict,
  record_id text not null references public.mtu_khs_records(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING','SYNCING','SYNCED','CONFLICT','FAILED','SKIPPED')),
  attempts integer not null default 0 check (attempts >= 0),
  sheet_id text not null,
  sheet_name text not null,
  source_row integer,
  source_row_sha256 text not null default '',
  source_key jsonb not null default '{}'::jsonb,
  patch jsonb not null default '{}'::jsonb,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  before_sheet jsonb not null default '{}'::jsonb,
  after_sheet jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_request_id)
);

create index if not exists idx_mtu_khs_sheet_jobs_status on public.mtu_khs_sheet_sync_jobs(status, updated_at);
create index if not exists idx_mtu_khs_sheet_jobs_record on public.mtu_khs_sheet_sync_jobs(record_id);

alter table public.mtu_khs_sheet_sync_jobs enable row level security;
drop policy if exists "MTU KHS sheet sync scoped" on public.mtu_khs_sheet_sync_jobs;
create policy "MTU KHS sheet sync scoped" on public.mtu_khs_sheet_sync_jobs
  for select using (exists (
    select 1 from public.mtu_khs_records r
    where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)
  ));

grant select on public.mtu_khs_sheet_sync_jobs to authenticated;
revoke insert, update, delete on public.mtu_khs_sheet_sync_jobs from authenticated;

-- Keep the original source values so rollback cannot destroy a value that existed before this migration.
with candidates as (
  select r.id,
    (select e.key from jsonb_each_text(coalesce(r.data->'rawData','{}'::jsonb)) e
      where upper(e.key) like 'KONTRAK RINCI%' and not e.key like '%__href'
        and nullif(btrim(e.value),'') is not null order by e.key limit 1) as number_key,
    (select e.value from jsonb_each_text(coalesce(r.data->'rawData','{}'::jsonb)) e
      where upper(e.key) like 'KONTRAK RINCI%' and not e.key like '%__href'
        and nullif(btrim(e.value),'') is not null order by e.key limit 1) as number_value,
    (select e.value from jsonb_each_text(coalesce(r.data->'rawData','{}'::jsonb)) e
      where e.key = ((select e2.key from jsonb_each_text(coalesce(r.data->'rawData','{}'::jsonb)) e2
        where upper(e2.key) like 'KONTRAK RINCI%' and not e2.key like '%__href'
          and nullif(btrim(e2.value),'') is not null order by e2.key limit 1) || '__href') limit 1) as url_value
  from public.mtu_khs_records r
  where (r.data ? 'rawData')
    and (not (r.data ? 'contractDetailNumber') or not (r.data ? 'contractDetailUrl'))
)
update public.mtu_khs_records r
set data = r.data || jsonb_build_object(
  'contractDetailNumber', coalesce(nullif(c.number_value,''), r.data->>'contractDetailNumber',''),
  'contractDetailUrl', coalesce(nullif(c.url_value,''), r.data->>'contractDetailUrl',''),
  '_mtuKhsSheetSyncRollback', jsonb_build_object(
    'migrationKey','MTU-KHS-SHEET-SYNC-20260912',
    'hadContractDetailNumber', r.data ? 'contractDetailNumber',
    'hadContractDetailUrl', r.data ? 'contractDetailUrl',
    'contractDetailNumber', r.data->'contractDetailNumber',
    'contractDetailUrl', r.data->'contractDetailUrl'
  )
)
from candidates c
where c.id = r.id and c.number_value is not null;

create or replace function public.mtu_khs_list_records(
  p_year integer default null,
  p_upt_id text default null,
  p_vendor text default null,
  p_lifecycle_status text default null,
  p_search text default '',
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb
language sql stable security definer set search_path = public
as $$
with scoped as (
  select r.id, r.upt_id, r.ultg_id, r.gardu_induk_id, r.bay_id, r.gudang_id,
    r.mtu_spec_id, r.katalog_id, r.supplier_id, r.procurement_year,
    r.lifecycle_status, r.sifat_pekerjaan, r.qty, r.version, r.updated_at, r.data,
    coalesce(nullif(r.data->>'vendor',''), nullif(r.data->>'provider','')) as vendor,
    coalesce(nullif(r.data->>'materialDescription',''), nullif(r.data->>'materialName','')) as material_description,
    coalesce(nullif(r.data->>'mtuCode',''), nullif(r.data->'rawData'->>'JENIS MTU','')) as mtu_code,
    nullif(r.data->>'uptName','') as upt_name,
    nullif(r.data->>'ultgName','') as ultg_name,
    nullif(r.data->>'giName','') as gi_name,
    nullif(r.data->>'bayName','') as bay_name
  from public.mtu_khs_records r
  where public.mtu_khs_can_access_upt(r.upt_id)
    and (p_year is null or r.procurement_year = p_year)
    and (p_upt_id is null or r.upt_id = p_upt_id)
    and (p_vendor is null or upper(coalesce(r.data->>'vendor', r.data->>'provider','')) = upper(p_vendor))
    and (p_lifecycle_status is null or r.lifecycle_status = p_lifecycle_status)
    and (nullif(btrim(coalesce(p_search,'')),'') is null or concat_ws(' ',
      r.data->>'materialDescription', r.data->>'materialName', r.data->>'mtuCode',
      r.data->>'catalogNumber', r.data->>'noKontrak', r.data->>'contractDetailNumber',
      r.data->>'vendor', r.data->>'provider', r.data->>'uptName', r.data->>'ultgName',
      r.data->>'giName', r.data->>'bayName', r.data->'rawData'->>'GARDU INDUK',
      r.data->'rawData'->>'GI/GITET', r.data->'rawData'->>'BAY') ilike '%' || btrim(p_search) || '%')
), args as (
  select case when p_limit in (20,50) then p_limit else 20 end as lim,
         greatest(coalesce(p_offset,0),0) as off
)
select jsonb_build_object(
  'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.procurement_year desc, x.id)
    from (select s.* from scoped s cross join args a order by s.procurement_year desc, s.id limit (select lim from args) offset (select off from args)) x), '[]'::jsonb),
  'total', (select count(*) from scoped),
  'metrics', jsonb_build_object(
    'qty', coalesce((select sum(qty) from scoped),0),
    'onsite', coalesce((select count(*) from scoped where lifecycle_status in ('ON_SITE','INSTALLED')),0),
    'installed', coalesce((select count(*) from scoped where lifecycle_status = 'INSTALLED'),0),
    'pendingSheetSync', coalesce((select count(*) from public.mtu_khs_sheet_sync_jobs j join scoped s on s.id = j.record_id where j.status in ('PENDING','SYNCING','FAILED','CONFLICT')),0)
  ),
  'vendors', coalesce((select jsonb_agg(v.vendor order by v.vendor) from (select distinct nullif(vendor,'') vendor from scoped where nullif(vendor,'') is not null) v), '[]'::jsonb)
);
$$;

revoke all on function public.mtu_khs_list_records(integer,text,text,text,text,integer,integer) from public;
grant execute on function public.mtu_khs_list_records(integer,text,text,text,text,integer,integer) to authenticated;

create or replace function public.mtu_khs_decide_change(p_change_id text, p_decision text, p_note text default '')
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare c public.mtu_khs_change_requests; r public.mtu_khs_records; p public.profiles; result public.mtu_khs_change_requests;
  new_data jsonb; source_row integer; source_hash text; source_key jsonb; sheet_name text;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Keputusan approval tidak valid'; end if;
  select * into c from public.mtu_khs_change_requests where id = p_change_id and status = 'PENDING' for update;
  if not found then raise exception 'Perubahan MTU tidak ditemukan atau sudah diputus'; end if;
  select * into r from public.mtu_khs_records where id = c.record_id for update;
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN' and not (p.role = 'ASMAN' and p.upt_id = c.approver_upt_id) then raise exception 'Bukan ASMAN UPT tujuan'; end if;
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN_LOG_UIT' and not (p.role = 'ASMAN_LOG_UIT' and p.uit_id = c.approver_uit_id) then raise exception 'Bukan ASMAN_LOG_UIT tujuan'; end if;
  update public.mtu_khs_change_requests set status = p_decision, decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = c.id returning * into result;
  if p_decision = 'APPROVED' then
    new_data := r.data || (c.patch - '_idempotency_key');
    update public.mtu_khs_records set data = new_data, updated_at = now(), version = version + 1,
      lifecycle_status = case when c.patch ? 'lifecycleStatus' then nullif(c.patch->>'lifecycleStatus','') else lifecycle_status end,
      gardu_induk_id = case when c.patch ? 'garduIndukId' then nullif(c.patch->>'garduIndukId','') else gardu_induk_id end,
      bay_id = case when c.patch ? 'bayId' then nullif(c.patch->>'bayId','') else bay_id end,
      gudang_id = case when c.patch ? 'gudangId' then nullif(c.patch->>'gudangId','') else gudang_id end
    where id = r.id and version = r.version;
    if not found then raise exception 'MTU_VERSION_CONFLICT'; end if;
    source_row := nullif(r.data->'_migration'->>'sourceRow','')::integer;
    source_hash := coalesce(r.data->'_migration'->>'rawRowSha256','');
    source_key := jsonb_build_object(
      'procurementYear', r.procurement_year,
      'provider', coalesce(r.data->>'vendor',r.data->>'provider',''),
      'uptName', coalesce(r.data->>'uptName',''), 'ultgName', coalesce(r.data->>'ultgName',''),
      'giName', coalesce(r.data->>'giName',''), 'bayName', coalesce(r.data->>'bayName',''),
      'mtuCode', coalesce(r.data->>'mtuCode',''), 'sifatPekerjaan', r.sifat_pekerjaan
    );
    sheet_name := case when r.procurement_year = 2024 then 'Input KHS 2024' when r.procurement_year = 2026 then 'Input KHS 2026' else '' end;
    insert into public.mtu_khs_sheet_sync_jobs(id, change_request_id, record_id, sheet_id, sheet_name, source_row, source_row_sha256, source_key, patch, before_data, after_data)
    values ('MTU-SHEET-' || gen_random_uuid()::text, c.id, r.id, '1Fd978ThcVpCmGEbADILLbjpsGfpWtdKlJdnNdvnzOiw', sheet_name, source_row, source_hash, source_key, c.patch - '_idempotency_key', to_jsonb(r.data), new_data)
    on conflict (change_request_id) do nothing;
  end if;
  return result;
end;
$$;

revoke all on function public.mtu_khs_decide_change(text,text,text) from public;
grant execute on function public.mtu_khs_decide_change(text,text,text) to authenticated;

commit;
