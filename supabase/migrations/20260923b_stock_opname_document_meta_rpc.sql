-- PROPOSAL ONLY. Apply to production self-host only after explicit approval.
-- Fixes: cetak BA/TUG-15 saves documentMeta into a SELESAI opname via plain
-- client upsert, blocked by the DRAFT-only UPDATE policy from
-- 20260922_stock_opname_approval_fail_closed.sql. This RPC lets warehouse
-- roles attach documentMeta to an already-finalized opname without reopening
-- draft-write access.
begin;

create or replace function public.update_stock_opname_document_meta(
  p_opname_id text,
  p_document_meta jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opname public.stock_opname%rowtype;
  v_role text;
  v_new_data jsonb;
begin
  if auth.uid() is null then raise exception 'OPNAME_DOCUMENT_META_AUTH_REQUIRED'; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if coalesce(v_role, '') not in ('ADMIN','TL','SUPERADMIN') then raise exception 'OPNAME_DOCUMENT_META_ROLE_DENIED'; end if;
  select * into v_opname from public.stock_opname where id = p_opname_id for update;
  if not found then raise exception 'OPNAME_DOCUMENT_META_NOT_FOUND'; end if;
  if not public.can_access_upt(v_opname.upt_id) then raise exception 'OPNAME_DOCUMENT_META_SCOPE_DENIED'; end if;
  if v_opname.status <> 'SELESAI' then raise exception 'OPNAME_DOCUMENT_META_STATUS_INVALID'; end if;
  if jsonb_typeof(p_document_meta) <> 'object' then raise exception 'OPNAME_DOCUMENT_META_PAYLOAD_INVALID'; end if;
  v_new_data := jsonb_set(v_opname.data, '{documentMeta}', p_document_meta, true);
  update public.stock_opname set data = v_new_data, updated_at = clock_timestamp() where id = p_opname_id;
  return jsonb_build_object('ok', true, 'id', p_opname_id, 'opname', v_new_data);
end;
$$;

revoke all on function public.update_stock_opname_document_meta(text, jsonb) from public;
grant execute on function public.update_stock_opname_document_meta(text, jsonb) to authenticated;
commit;
