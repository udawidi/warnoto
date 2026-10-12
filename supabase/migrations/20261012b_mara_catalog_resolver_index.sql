-- Keep the exact MARA resolver predicate indexable without blocking writes.
-- This migration must run outside a transaction because CREATE INDEX CONCURRENTLY
-- cannot run inside one.
create index concurrently if not exists idx_mara_catalog_resolver_code
  on public.mara_catalog ((nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '')));

analyze public.mara_catalog;
