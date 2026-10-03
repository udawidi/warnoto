-- PROPOSAL ONLY. Do not apply before production dry-run confirms zero unresolved UPTs.
-- Stock photo embeddings must be tenant-scoped by canonical UPT id, not display name
-- or catalog alone. Existing `upt` is retained for compatibility during rollout.

alter table public.stock_photo_embeddings
  add column if not exists upt_id text;

-- Exact backfill from a canonical UPT master identity. Catalog is not a tenant
-- key: it is deliberately not used to resolve a row. Display name and the
-- stable `spe_<upt-slug>_...` id are accepted only when each maps 1:1 to master.
with canonical_upt as (
  select id,
         lower(trim(data->>'nama')) as name_norm,
         lower(regexp_replace(trim(data->>'nama'), '[^a-zA-Z0-9]+', '-', 'g')) as slug_norm
  from public.upt
  where coalesce(trim(data->>'nama'), '') <> ''
), unique_names as (
  select name_norm, min(id) as upt_id
  from canonical_upt
  group by name_norm
  having count(*) = 1
), unique_slugs as (
  select slug_norm, min(id) as upt_id
  from canonical_upt
  group by slug_norm
  having count(*) = 1
), candidates as (
  select e.id, n.upt_id
  from public.stock_photo_embeddings e
  join unique_names n on n.name_norm = lower(trim(e.upt))
  where e.upt_id is null
  union
  select e.id, s.upt_id
  from public.stock_photo_embeddings e
  join unique_slugs s on s.slug_norm = lower(split_part(e.id, '_', 2))
  where e.upt_id is null
), unique_candidates as (
  select id, min(upt_id) as upt_id
  from candidates
  group by id
  having count(distinct upt_id) = 1
)
update public.stock_photo_embeddings e
set upt_id = c.upt_id
from unique_candidates c
where e.id = c.id and e.upt_id is null;

do $$
begin
  if exists (select 1 from public.stock_photo_embeddings where upt_id is null) then
    raise exception 'stock_photo_embeddings.upt_id masih NULL; selesaikan dry-run exact mapping sebelum NOT NULL';
  end if;
end $$;

alter table public.stock_photo_embeddings
  alter column upt_id set not null;
create index if not exists idx_spe_upt_id_katalog on public.stock_photo_embeddings(upt_id, katalog);

alter table public.stock_photo_embeddings enable row level security;
drop policy if exists "Authenticated read spe" on public.stock_photo_embeddings;
drop policy if exists "Authenticated write spe" on public.stock_photo_embeddings;
drop policy if exists "Scoped read stock photo embeddings" on public.stock_photo_embeddings;
create policy "Scoped read stock photo embeddings"
  on public.stock_photo_embeddings for select to authenticated
  using (public.can_access_upt(upt_id));

revoke insert, update, delete on public.stock_photo_embeddings from anon, authenticated;
grant select on public.stock_photo_embeddings to authenticated;
grant all on public.stock_photo_embeddings to service_role;

create or replace function public.match_stock_photos_scoped(
  query_embedding vector(1024),
  p_upt_ids text[] default null,
  match_count int default 10,
  min_similarity float default 0.6
)
returns table(upt_id text, katalog text, similarity float)
language sql stable
as $$
  select e.upt_id, e.katalog, max(1 - (e.embedding <=> query_embedding))::float as similarity
  from public.stock_photo_embeddings e
  where e.embedding is not null
    and public.can_access_upt(e.upt_id)
    and (p_upt_ids is null or e.upt_id = any(p_upt_ids))
  group by e.upt_id, e.katalog
  having max(1 - (e.embedding <=> query_embedding)) >= min_similarity
  order by similarity desc
  limit greatest(0, least(coalesce(match_count, 10), 100));
$$;
revoke all on function public.match_stock_photos_scoped(vector(1024), text[], int, float) from public;
grant execute on function public.match_stock_photos_scoped(vector(1024), text[], int, float) to authenticated;
