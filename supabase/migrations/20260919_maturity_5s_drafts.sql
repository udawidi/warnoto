-- Proposal only. Apply to self-host production only after explicit user confirmation.
-- Form 5S drafts are private to the author and scoped to the active UPT.

create table if not exists public.maturity_5s_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  upt_id text not null references public.upt(id) on delete restrict,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maturity_5s_drafts_owner_upt_key unique (owner_id, upt_id)
);

create index if not exists idx_maturity_5s_drafts_owner_updated
  on public.maturity_5s_drafts(owner_id, updated_at desc);
create index if not exists idx_maturity_5s_drafts_upt
  on public.maturity_5s_drafts(upt_id);

create or replace function public.touch_maturity_5s_draft_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists maturity_5s_drafts_touch_updated_at on public.maturity_5s_drafts;
create trigger maturity_5s_drafts_touch_updated_at
  before update on public.maturity_5s_drafts
  for each row execute function public.touch_maturity_5s_draft_updated_at();

create or replace function public.can_manage_maturity_5s_draft(
  p_owner_id uuid,
  p_upt_id text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_write_maturity_upt(p_upt_id)
    and p_owner_id = auth.uid()
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (actor.role = 'SUPERADMIN' or actor.upt_id = p_upt_id)
    );
$$;
revoke all on function public.can_manage_maturity_5s_draft(uuid, text) from public;
grant execute on function public.can_manage_maturity_5s_draft(uuid, text) to authenticated;

alter table public.maturity_5s_drafts enable row level security;
grant select, insert, update, delete on public.maturity_5s_drafts to authenticated;
grant all on public.maturity_5s_drafts to service_role;

drop policy if exists "Maturity 5s drafts owner read" on public.maturity_5s_drafts;
drop policy if exists "Maturity 5s drafts owner insert" on public.maturity_5s_drafts;
drop policy if exists "Maturity 5s drafts owner update" on public.maturity_5s_drafts;
drop policy if exists "Maturity 5s drafts owner delete" on public.maturity_5s_drafts;
create policy "Maturity 5s drafts owner read" on public.maturity_5s_drafts
  for select to authenticated
  using (public.can_manage_maturity_5s_draft(owner_id, upt_id));
create policy "Maturity 5s drafts owner insert" on public.maturity_5s_drafts
  for insert to authenticated
  with check (public.can_manage_maturity_5s_draft(owner_id, upt_id));
create policy "Maturity 5s drafts owner update" on public.maturity_5s_drafts
  for update to authenticated
  using (public.can_manage_maturity_5s_draft(owner_id, upt_id))
  with check (public.can_manage_maturity_5s_draft(owner_id, upt_id));
create policy "Maturity 5s drafts owner delete" on public.maturity_5s_drafts
  for delete to authenticated
  using (public.can_manage_maturity_5s_draft(owner_id, upt_id));
