-- Maturity self-host canonical storage. Apply manually to the self-host DB;
-- this repository change intentionally does not execute SQL remotely.
create table if not exists maturity_assessments (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  assessment_at bigint,
  level smallint not null check (level between 1 and 5),
  created_by uuid references profiles(id) on delete set null
);
create index if not exists idx_maturity_assessments_assessment_at on maturity_assessments(assessment_at desc);

alter table maturity_assessments enable row level security;
drop policy if exists "Authenticated read maturity_assessments" on maturity_assessments;
drop policy if exists "Authenticated write maturity_assessments" on maturity_assessments;
create policy "Authenticated read maturity_assessments" on maturity_assessments for select using (auth.role() = 'authenticated');
create policy "Authenticated write maturity_assessments" on maturity_assessments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on maturity_assessments to authenticated;
grant all on maturity_assessments to service_role;

create table if not exists maturity_audits (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint,
  upt text not null,
  status text not null check (status in ('DRAFT', 'SELF_ASSESSMENT', 'REVIEW_UIT', 'REVISION', 'FINAL')),
  level smallint not null check (level between 1 and 5),
  updated_by uuid references profiles(id) on delete set null
);
create index if not exists idx_maturity_audits_upt_updated_at on maturity_audits(upt, updated_at desc);
create index if not exists idx_maturity_audits_status on maturity_audits(status);

alter table maturity_audits enable row level security;
drop policy if exists "Authenticated read maturity_audits" on maturity_audits;
drop policy if exists "Authenticated write maturity_audits" on maturity_audits;
create policy "Authenticated read maturity_audits" on maturity_audits for select using (auth.role() = 'authenticated');
create policy "Authenticated write maturity_audits" on maturity_audits for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on maturity_audits to authenticated;
grant all on maturity_audits to service_role;
