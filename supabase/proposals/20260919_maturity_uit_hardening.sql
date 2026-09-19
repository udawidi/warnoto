-- PROPOSAL ONLY. Jangan apply ke production tanpa review dan konfirmasi user.
-- Scope target: maturity audits/history/5S/aspect reviews/legacy assessments.

begin;

create or replace function public.can_access_maturity_upt(p_upt_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles actor
    where actor.id = auth.uid()
      and (
        (p_upt_id is null and actor.role in ('SUPERADMIN', 'ADMIN_LOG_PUSAT'))
        or (p_upt_id is not null and actor.role in ('SUPERADMIN', 'ADMIN_LOG_PUSAT'))
        or (p_upt_id is not null and actor.role in ('ADMIN_UIT', 'ASMAN_LOG_UIT', 'MGR_LOGISTIK_UIT')
            and exists (select 1 from public.upt unit where unit.id = p_upt_id and unit.uit_id = actor.uit_id))
        or (p_upt_id is not null and actor.role not in ('SUPERADMIN', 'ADMIN_LOG_PUSAT', 'ADMIN_UIT', 'ASMAN_LOG_UIT', 'MGR_LOGISTIK_UIT')
            and actor.upt_id = p_upt_id)
      )
  );
$$;
revoke all on function public.can_access_maturity_upt(text) from public;
grant execute on function public.can_access_maturity_upt(text) to authenticated;

alter table public.maturity_assessments add column if not exists upt_id text;
update public.maturity_assessments a
set upt_id = p.upt_id
from public.profiles p
where a.upt_id is null and a.created_by = p.id;
update public.maturity_assessments
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{_migration}', jsonb_build_object(
  'scope', 'PUSAT_LEGACY_UNSCOPED',
  'reason', 'created_by tidak memiliki profile owner UPT; ownership tidak ditebak',
  'migratedAt', now()
), true)
where upt_id is null;
do $$ begin
  if exists (select 1 from public.maturity_assessments where upt_id is null) then
    raise notice 'MATURITY_ASSESSMENT_ORPHAN: ownership remains unresolved and is fail-closed by RLS';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maturity_assessments_upt_id_fkey') then
    alter table public.maturity_assessments add constraint maturity_assessments_upt_id_fkey
      foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
end $$;

create or replace function public.enforce_maturity_review_upt()
returns trigger language plpgsql security definer set search_path = public
as $$
declare audit_upt text;
begin
  select upt_id into audit_upt from public.maturity_audits where id = new.audit_id;
  if audit_upt is null or new.upt_id is distinct from audit_upt then
    raise exception 'MATURITY_REVIEW_UPT_MISMATCH';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_maturity_review_upt on public.maturity_aspect_reviews;
create trigger trg_maturity_review_upt
before insert or update on public.maturity_aspect_reviews
for each row execute function public.enforce_maturity_review_upt();

alter table public.maturity_audits enable row level security;
drop policy if exists "Authenticated read maturity_audits" on public.maturity_audits;
drop policy if exists "Authenticated write maturity_audits" on public.maturity_audits;
drop policy if exists "Maturity audits read chain" on public.maturity_audits;
drop policy if exists "Maturity audits insert upt" on public.maturity_audits;
drop policy if exists "Maturity audits update by stage" on public.maturity_audits;
drop policy if exists "Maturity audits read scoped final" on public.maturity_audits;
drop policy if exists "Maturity audits insert own" on public.maturity_audits;
drop policy if exists "Maturity audits update scoped stage" on public.maturity_audits;
create policy "Maturity audits read scoped final" on public.maturity_audits for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity audits insert own" on public.maturity_audits for insert to authenticated
  with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));
create policy "Maturity audits update scoped stage" on public.maturity_audits for update to authenticated
  using (public.can_access_maturity_upt(upt_id) and (
    (public.can_write_maturity_upt(upt_id) and status in ('DRAFT','SELF_ASSESSMENT','REVISION'))
    or (public.can_review_maturity_uit() and status in ('SELF_ASSESSMENT','REVISION','REVIEW_UIT'))
    or (public.can_review_maturity_pusat() and status in ('REVIEW_PUSAT','FINAL'))
  ))
  with check (public.can_access_maturity_upt(upt_id));

alter table public.maturity_audit_history enable row level security;
drop policy if exists "Authenticated read maturity_audit_history" on public.maturity_audit_history;
drop policy if exists "Authenticated write maturity_audit_history" on public.maturity_audit_history;
drop policy if exists "Maturity history read scoped" on public.maturity_audit_history;
drop policy if exists "Maturity history insert admin tl" on public.maturity_audit_history;
drop policy if exists "Maturity history update unlocked" on public.maturity_audit_history;
drop policy if exists "Maturity history read scoped final" on public.maturity_audit_history;
drop policy if exists "Maturity history update target scoped" on public.maturity_audit_history;
revoke update on public.maturity_audit_history from authenticated;
grant update (target, updated_at, updated_by) on public.maturity_audit_history to authenticated;
create policy "Maturity history read scoped final" on public.maturity_audit_history for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity history update target scoped" on public.maturity_audit_history for update to authenticated
  using (public.can_access_maturity_upt(upt_id) and (public.can_review_maturity_uit() or public.can_review_maturity_pusat() or public.is_maturity_superadmin()))
  with check (public.can_access_maturity_upt(upt_id));

alter table public.maturity_5s_assessments enable row level security;
drop policy if exists "Authenticated read maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Authenticated insert maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s read scoped" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s insert admin tl" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s read scoped final" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s insert own" on public.maturity_5s_assessments;
create policy "Maturity 5s read scoped final" on public.maturity_5s_assessments for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity 5s insert own" on public.maturity_5s_assessments for insert to authenticated
  with check (public.can_write_maturity_upt(upt_id));

alter table public.maturity_aspect_reviews enable row level security;
drop policy if exists "Aspect reviews read scoped" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews insert by reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews update by reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews read scoped final" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews insert scoped reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews update scoped reviewer" on public.maturity_aspect_reviews;
create policy "Aspect reviews read scoped final" on public.maturity_aspect_reviews for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Aspect reviews insert scoped reviewer" on public.maturity_aspect_reviews for insert to authenticated
  with check (public.can_access_maturity_upt(upt_id) and (public.can_review_maturity_uit() or public.can_review_maturity_pusat()));
create policy "Aspect reviews update scoped reviewer" on public.maturity_aspect_reviews for update to authenticated
  using (public.can_access_maturity_upt(upt_id) and (public.can_review_maturity_uit() or public.can_review_maturity_pusat()))
  with check (public.can_access_maturity_upt(upt_id));

alter table public.maturity_assessments enable row level security;
drop policy if exists "Authenticated read maturity_assessments" on public.maturity_assessments;
drop policy if exists "Authenticated write maturity_assessments" on public.maturity_assessments;
drop policy if exists "Maturity assessments read" on public.maturity_assessments;
drop policy if exists "Maturity assessments insert admin tl" on public.maturity_assessments;
drop policy if exists "Maturity assessments update admin tl" on public.maturity_assessments;
drop policy if exists "Maturity assessments read scoped final" on public.maturity_assessments;
drop policy if exists "Maturity assessments insert own" on public.maturity_assessments;
drop policy if exists "Maturity assessments update own" on public.maturity_assessments;
create policy "Maturity assessments read scoped final" on public.maturity_assessments for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity assessments insert own" on public.maturity_assessments for insert to authenticated
  with check (public.can_write_maturity_upt(upt_id));
create policy "Maturity assessments update own" on public.maturity_assessments for update to authenticated
  using (public.can_write_maturity_upt(upt_id)) with check (public.can_write_maturity_upt(upt_id));

commit;
