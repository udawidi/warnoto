-- Rollback for 20260912_mtu_khs_sheet_sync_backend.sql.
-- Refuses to drop queued work; drain or explicitly inspect it first.
begin;
do $$ begin
  if exists (select 1 from public.mtu_khs_sheet_sync_jobs where status in ('PENDING','SYNCING','FAILED','CONFLICT')) then
    raise exception 'MTU_KHS_SHEET_SYNC_ROLLBACK_BLOCKED: pending jobs exist';
  end if;
end $$;

with protected as (
  select id, data->'_mtuKhsSheetSyncRollback' as backup
  from public.mtu_khs_records
  where data->'_mtuKhsSheetSyncRollback'->>'migrationKey' = 'MTU-KHS-SHEET-SYNC-20260912'
)
update public.mtu_khs_records r
set data = (r.data - 'contractDetailNumber' - 'contractDetailUrl' - '_mtuKhsSheetSyncRollback')
  || case when (p.backup->>'hadContractDetailNumber')::boolean then jsonb_build_object('contractDetailNumber',p.backup->'contractDetailNumber') else '{}'::jsonb end
  || case when (p.backup->>'hadContractDetailUrl')::boolean then jsonb_build_object('contractDetailUrl',p.backup->'contractDetailUrl') else '{}'::jsonb end
from protected p where p.id = r.id;

-- Restore the pre-migration approval function before removing its queue table.
create or replace function public.mtu_khs_decide_change(p_change_id text, p_decision text, p_note text default '')
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare c public.mtu_khs_change_requests; r public.mtu_khs_records; p public.profiles; result public.mtu_khs_change_requests;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Keputusan approval tidak valid'; end if;
  select * into c from public.mtu_khs_change_requests where id = p_change_id and status = 'PENDING' for update;
  if not found then raise exception 'Perubahan MTU tidak ditemukan atau sudah diputus'; end if;
  select * into r from public.mtu_khs_records where id = c.record_id;
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN' and not (p.role = 'ASMAN' and p.upt_id = c.approver_upt_id) then raise exception 'Bukan ASMAN UPT tujuan'; end if;
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN_LOG_UIT' and not (p.role = 'ASMAN_LOG_UIT' and p.uit_id = c.approver_uit_id) then raise exception 'Bukan ASMAN_LOG_UIT tujuan'; end if;
  update public.mtu_khs_change_requests set status = p_decision, decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = c.id returning * into result;
  if p_decision = 'APPROVED' then
    update public.mtu_khs_records set data = data || (c.patch - '_idempotency_key'), updated_at = now(), version = version + 1, lifecycle_status = case when c.patch ? 'lifecycleStatus' then nullif(c.patch->>'lifecycleStatus','') else lifecycle_status end, gardu_induk_id = case when c.patch ? 'garduIndukId' then nullif(c.patch->>'garduIndukId','') else gardu_induk_id end, bay_id = case when c.patch ? 'bayId' then nullif(c.patch->>'bayId','') else bay_id end, gudang_id = case when c.patch ? 'gudangId' then nullif(c.patch->>'gudangId','') else gudang_id end where id = r.id and version = r.version;
    if not found then raise exception 'MTU_VERSION_CONFLICT'; end if;
  end if;
  return result;
end;
$$;
revoke all on function public.mtu_khs_decide_change(text,text,text) from public;
grant execute on function public.mtu_khs_decide_change(text,text,text) to authenticated;

drop function if exists public.mtu_khs_list_records(integer,text,text,text,text,integer,integer);
drop table if exists public.mtu_khs_sheet_sync_jobs;
commit;
