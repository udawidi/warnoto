-- Applied to self-host production on 2026-09-19 after explicit user approval.
-- Pengembalian alat berat atomik: satu RPC mengubah loan dan master alat.

create or replace function public.complete_heavy_equipment_loan(p_loan_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_actor_upt text;
  v_owner_upt text;
  v_equipment_upt text;
  v_other_active integer;
  v_returned_at bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception 'Tidak terautentikasi.' using errcode = '42501';
  end if;

  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role not in ('ADMIN', 'TL') then
    raise exception 'Hanya ADMIN/TL pemilik alat yang boleh menandai pengembalian.' using errcode = '42501';
  end if;

  -- Lock loan first, then equipment. Semua jalur pengembalian memakai urutan ini
  -- supaya dua klik bersamaan tidak menghasilkan transisi ganda atau deadlock.
  select * into v_loan
  from heavy_equipment_loans
  where id = nullif(trim(p_loan_id), '')
  for update;
  if not found then
    raise exception 'Peminjaman alat tidak ditemukan.' using errcode = 'P0002';
  end if;
  if coalesce(v_loan.status, '') not in ('DIPINJAM', 'APPROVED', 'OVERDUE') then
    raise exception 'Peminjaman alat sudah tidak aktif.' using errcode = 'P0001';
  end if;
  if nullif(trim(v_loan.equipment_id), '') is null then
    raise exception 'Peminjaman tidak memiliki referensi alat.' using errcode = '23514';
  end if;

  select * into v_equipment
  from heavy_equipment
  where id = v_loan.equipment_id
  for update;
  if not found then
    raise exception 'Alat pada peminjaman tidak ditemukan.' using errcode = 'P0002';
  end if;

  select regexp_replace(upper(trim(coalesce((select u.data->>'nama' from upt u where u.id = v_actor.upt_id), v_actor.upt_id, ''))), '^UPT[[:space:]]+', '')
    into v_actor_upt;
  v_owner_upt := regexp_replace(upper(trim(coalesce(v_loan.owner_upt, ''))), '^UPT[[:space:]]+', '');
  v_equipment_upt := regexp_replace(upper(trim(coalesce(v_equipment.upt, v_equipment.data->>'upt', ''))), '^UPT[[:space:]]+', '');

  if v_actor_upt = '' or v_owner_upt = '' or v_actor_upt <> v_owner_upt then
    raise exception 'Pengembalian hanya boleh dilakukan ADMIN/TL UPT pemilik alat.' using errcode = '42501';
  end if;
  if v_equipment_upt <> '' and v_equipment_upt <> v_owner_upt then
    raise exception 'UPT pemilik pada alat dan peminjaman tidak cocok.' using errcode = '23514';
  end if;
  if nullif(v_equipment.data->>'activeLoanId', '') is not null
     and v_equipment.data->>'activeLoanId' <> v_loan.id then
    raise exception 'Alat sedang terkait peminjaman aktif lain.' using errcode = '40001';
  end if;

  -- Legacy rows mungkin tidak punya activeLoanId. Tetap aman selama tidak ada
  -- loan aktif lain untuk alat yang sama.
  select count(*) into v_other_active
  from heavy_equipment_loans
  where equipment_id = v_loan.equipment_id
    and id <> v_loan.id
    and status in ('DIPINJAM', 'APPROVED', 'OVERDUE');
  if v_other_active > 0 then
    raise exception 'Alat memiliki peminjaman aktif lain.' using errcode = '40001';
  end if;

  update heavy_equipment_loans
  set status = 'SELESAI',
      data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'status', 'SELESAI',
        'returnedBy', auth.uid()::text,
        'returnedAt', v_returned_at
      )
  where id = v_loan.id
  returning * into v_loan;

  update heavy_equipment
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'availabilityStatus', 'TERSEDIA',
    'activeLoanId', null,
    'borrowedToUpt', null,
    'borrowedJobName', null,
    'borrowedUntil', null
  )
  where id = v_equipment.id
  returning * into v_equipment;

  return jsonb_build_object(
    'loan', coalesce(v_loan.data, '{}'::jsonb) || jsonb_build_object('id', v_loan.id),
    'equipment', coalesce(v_equipment.data, '{}'::jsonb) || jsonb_build_object('id', v_equipment.id)
  );
end;
$$;

revoke all on function public.complete_heavy_equipment_loan(text) from public;
grant execute on function public.complete_heavy_equipment_loan(text) to authenticated;

notify pgrst, 'reload schema';
