\set ON_ERROR_STOP on

-- Read/rollback verifier for the production return RPC. This exercises both
-- tenant denial and the successful atomic transition without retaining changes.
begin;

do $verify$
declare
  v_loan public.heavy_equipment_loans%rowtype;
  v_owner_actor public.profiles%rowtype;
  v_other_actor public.profiles%rowtype;
  v_result jsonb;
  v_denied boolean := false;
  v_status text;
  v_availability text;
begin
  select * into v_loan
  from public.heavy_equipment_loans
  where status in ('DIPINJAM', 'APPROVED', 'OVERDUE')
  order by created_at desc nulls last
  limit 1;

  if not found then
    raise exception 'Verifier membutuhkan satu peminjaman aktif.';
  end if;

  select p.* into v_owner_actor
  from public.profiles p
  join public.upt u on u.id = p.upt_id
  where p.role in ('ADMIN', 'TL')
    and regexp_replace(upper(trim(coalesce(u.data->>'nama', ''))), '^UPT[[:space:]]+', '')
      = regexp_replace(upper(trim(v_loan.owner_upt)), '^UPT[[:space:]]+', '')
  order by case when p.role = 'TL' then 0 else 1 end
  limit 1;

  if not found then
    raise exception 'ADMIN/TL UPT pemilik tidak ditemukan.';
  end if;

  select p.* into v_other_actor
  from public.profiles p
  where p.role in ('ADMIN', 'TL')
    and p.upt_id is distinct from v_owner_actor.upt_id
  order by p.upt_id, p.role
  limit 1;

  if not found then
    raise exception 'Actor lintas-UPT tidak ditemukan.';
  end if;

  perform set_config('request.jwt.claim.sub', v_other_actor.id::text, true);
  begin
    perform public.complete_heavy_equipment_loan(v_loan.id);
  exception when insufficient_privilege then
    v_denied := true;
  end;

  if not v_denied then
    raise exception 'Actor lintas-UPT tidak ditolak.';
  end if;

  select status into v_status from public.heavy_equipment_loans where id = v_loan.id;
  if v_status <> v_loan.status then
    raise exception 'Penolakan lintas-UPT mengubah status loan.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_actor.id::text, true);
  v_result := public.complete_heavy_equipment_loan(v_loan.id);

  select status into v_status from public.heavy_equipment_loans where id = v_loan.id;
  select data->>'availabilityStatus' into v_availability
  from public.heavy_equipment where id = v_loan.equipment_id;

  if v_status <> 'SELESAI'
     or v_availability <> 'TERSEDIA'
     or v_result #>> '{loan,status}' <> 'SELESAI'
     or v_result #>> '{equipment,availabilityStatus}' <> 'TERSEDIA' then
    raise exception 'Transisi atomik atau respons canonical tidak valid.';
  end if;

  raise notice 'PASS loan %, owner %, cross-UPT denial, atomic transition, canonical response',
    v_loan.id, v_owner_actor.username;
end;
$verify$;

rollback;
