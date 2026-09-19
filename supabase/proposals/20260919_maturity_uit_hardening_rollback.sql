-- PROPOSAL ONLY. Recovery migration; do not apply without review.
-- This intentionally does NOT drop can_access_maturity_upt, upt_id, the FK,
-- or the review trigger. A structural rollback would reintroduce cross-UPT
-- access and is therefore unsafe. It only replaces policy names with an
-- equivalent fail-closed scoped set and preserves the minimal history grant.

begin;

-- Remove proposal policy names and any pre-existing legacy/scoped names before
-- recreating a single explicit fail-closed policy set.
drop policy if exists "Maturity audits read scoped final" on public.maturity_audits;
drop policy if exists "Maturity audits insert own" on public.maturity_audits;
drop policy if exists "Maturity audits update scoped stage" on public.maturity_audits;
drop policy if exists "Maturity audits read chain" on public.maturity_audits;
drop policy if exists "Maturity audits insert upt" on public.maturity_audits;
drop policy if exists "Maturity audits update by stage" on public.maturity_audits;
drop policy if exists "Maturity history read scoped final" on public.maturity_audit_history;
drop policy if exists "Maturity history update target scoped" on public.maturity_audit_history;
drop policy if exists "Maturity history read scoped" on public.maturity_audit_history;
drop policy if exists "Maturity history insert admin tl" on public.maturity_audit_history;
drop policy if exists "Maturity history update unlocked" on public.maturity_audit_history;
drop policy if exists "Maturity 5s read scoped final" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s insert own" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s read scoped" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s insert admin tl" on public.maturity_5s_assessments;
drop policy if exists "Aspect reviews read scoped final" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews insert scoped reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews update scoped reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews read scoped" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews insert by reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews update by reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Maturity assessments read scoped final" on public.maturity_assessments;
drop policy if exists "Maturity assessments insert own" on public.maturity_assessments;
drop policy if exists "Maturity assessments update own" on public.maturity_assessments;
drop policy if exists "Maturity assessments read" on public.maturity_assessments;
drop policy if exists "Maturity assessments insert admin tl" on public.maturity_assessments;
drop policy if exists "Maturity assessments update admin tl" on public.maturity_assessments;
drop policy if exists "Authenticated read maturity_audits" on public.maturity_audits;
drop policy if exists "Authenticated write maturity_audits" on public.maturity_audits;
drop policy if exists "Authenticated read maturity_audit_history" on public.maturity_audit_history;
drop policy if exists "Authenticated write maturity_audit_history" on public.maturity_audit_history;
drop policy if exists "Authenticated read maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Authenticated write maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Authenticated insert maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Authenticated read maturity_assessments" on public.maturity_assessments;
drop policy if exists "Authenticated write maturity_assessments" on public.maturity_assessments;
drop policy if exists "Maturity audits recovery scoped" on public.maturity_audits;
drop policy if exists "Maturity audits recovery insert" on public.maturity_audits;
drop policy if exists "Maturity audits recovery update" on public.maturity_audits;
drop policy if exists "Maturity history recovery scoped" on public.maturity_audit_history;
drop policy if exists "Maturity history recovery insert" on public.maturity_audit_history;
drop policy if exists "Maturity history recovery target" on public.maturity_audit_history;
drop policy if exists "Maturity 5s recovery scoped" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s recovery insert" on public.maturity_5s_assessments;
drop policy if exists "Aspect reviews recovery scoped" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews recovery insert" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews recovery update" on public.maturity_aspect_reviews;
drop policy if exists "Maturity assessments recovery scoped" on public.maturity_assessments;
drop policy if exists "Maturity assessments recovery insert" on public.maturity_assessments;
drop policy if exists "Maturity assessments recovery update" on public.maturity_assessments;

-- Keep the helper/column/trigger in place. Row access remains UPT-scoped.
create policy "Maturity audits recovery scoped" on public.maturity_audits
  for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity audits recovery insert" on public.maturity_audits
  for insert to authenticated
  with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));
create policy "Maturity audits recovery update" on public.maturity_audits
  for update to authenticated
  using (
    public.can_access_maturity_upt(upt_id)
    and (
      (public.can_write_maturity_upt(upt_id) and status in ('DRAFT','SELF_ASSESSMENT','REVISION'))
      or (public.can_review_maturity_uit() and status in ('SELF_ASSESSMENT','REVISION','REVIEW_UIT'))
      or (public.can_review_maturity_pusat() and status in ('REVIEW_PUSAT','FINAL'))
    )
  )
  with check (public.can_access_maturity_upt(upt_id));

revoke update on public.maturity_audit_history from authenticated;
grant update (target, updated_at, updated_by) on public.maturity_audit_history to authenticated;
create policy "Maturity history recovery scoped" on public.maturity_audit_history
  for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity history recovery insert" on public.maturity_audit_history
  for insert to authenticated
  with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));
create policy "Maturity history recovery target" on public.maturity_audit_history
  for update to authenticated
  using (
    public.can_access_maturity_upt(upt_id)
    and (public.can_review_maturity_uit() or public.can_review_maturity_pusat() or public.is_maturity_superadmin())
  )
  with check (public.can_access_maturity_upt(upt_id));

create policy "Maturity 5s recovery scoped" on public.maturity_5s_assessments
  for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity 5s recovery insert" on public.maturity_5s_assessments
  for insert to authenticated
  with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));

create policy "Aspect reviews recovery scoped" on public.maturity_aspect_reviews
  for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Aspect reviews recovery insert" on public.maturity_aspect_reviews
  for insert to authenticated
  with check (
    public.can_access_maturity_upt(upt_id)
    and (public.can_review_maturity_uit() or public.can_review_maturity_pusat())
  );
create policy "Aspect reviews recovery update" on public.maturity_aspect_reviews
  for update to authenticated
  using (
    public.can_access_maturity_upt(upt_id)
    and (public.can_review_maturity_uit() or public.can_review_maturity_pusat())
  )
  with check (public.can_access_maturity_upt(upt_id));

create policy "Maturity assessments recovery scoped" on public.maturity_assessments
  for select to authenticated
  using (public.can_access_maturity_upt(upt_id));
create policy "Maturity assessments recovery insert" on public.maturity_assessments
  for insert to authenticated
  with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));
create policy "Maturity assessments recovery update" on public.maturity_assessments
  for update to authenticated
  using (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id))
  with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));

commit;
