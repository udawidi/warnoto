-- Pool kuantitas alat bantu: saldo atomik, return parsial, dan history append-only.

alter table public.heavy_equipment
  add column if not exists tracking_mode text not null default 'UNIT',
  add column if not exists quantity_total integer not null default 1;
alter table public.heavy_equipment_loans
  add column if not exists quantity_borrowed integer not null default 1,
  add column if not exists quantity_returned_good integer not null default 0,
  add column if not exists quantity_returned_damaged integer not null default 0,
  add column if not exists quantity_returned_lost integer not null default 0;

update public.heavy_equipment
set tracking_mode = case when upper(coalesce(data->>'trackingMode', data->>'tracking_mode', tracking_mode)) = 'QUANTITY' then 'QUANTITY' else 'UNIT' end,
    quantity_total = case when (data->>'quantityTotal') ~ '^[0-9]+$' and (data->>'quantityTotal')::integer > 0 then (data->>'quantityTotal')::integer else greatest(1, quantity_total) end;
update public.heavy_equipment_loans
set quantity_borrowed = case when (data->>'quantityBorrowed') ~ '^[0-9]+$' and (data->>'quantityBorrowed')::integer > 0 then (data->>'quantityBorrowed')::integer else greatest(1, quantity_borrowed) end,
    quantity_returned_good = case when (data->>'quantityReturnedGood') ~ '^[0-9]+$' then greatest(0, (data->>'quantityReturnedGood')::integer) when status = 'SELESAI' then 1 else quantity_returned_good end,
    quantity_returned_damaged = case when (data->>'quantityReturnedDamaged') ~ '^[0-9]+$' then greatest(0, (data->>'quantityReturnedDamaged')::integer) else quantity_returned_damaged end,
    quantity_returned_lost = case when (data->>'quantityReturnedLost') ~ '^[0-9]+$' then greatest(0, (data->>'quantityReturnedLost')::integer) else quantity_returned_lost end;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_tracking_mode_check') then
    alter table public.heavy_equipment add constraint heavy_equipment_tracking_mode_check check (tracking_mode in ('UNIT', 'QUANTITY'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_quantity_total_check') then
    alter table public.heavy_equipment add constraint heavy_equipment_quantity_total_check check (quantity_total > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_unit_quantity_check') then
    alter table public.heavy_equipment add constraint heavy_equipment_unit_quantity_check check (tracking_mode = 'QUANTITY' or quantity_total = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_borrowed_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_borrowed_check check (quantity_borrowed > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_good_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_good_check check (quantity_returned_good >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_damaged_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_damaged_check check (quantity_returned_damaged >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_lost_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_lost_check check (quantity_returned_lost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_sum_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_sum_check check (quantity_returned_good + quantity_returned_damaged + quantity_returned_lost <= quantity_borrowed);
  end if;
end $$;

create or replace function public.lock_heavy_equipment_quantity_definition()
returns trigger language plpgsql as $$
begin
  if old.tracking_mode = 'UNIT' and new.tracking_mode = 'QUANTITY'
     and exists (select 1 from public.heavy_equipment_loans where equipment_id = old.id) then
    raise exception 'Aset dengan riwayat peminjaman tidak dapat dikonversi menjadi pool.' using errcode = '23514';
  end if;
  if old.tracking_mode = 'QUANTITY' and (new.tracking_mode is distinct from old.tracking_mode or new.quantity_total is distinct from old.quantity_total) then
    raise exception 'Mode dan total pool kuantitas tidak dapat diubah setelah dibuat.' using errcode = '23514';
  end if;
  if old.tracking_mode = 'UNIT' and new.tracking_mode = 'UNIT' and new.quantity_total is distinct from old.quantity_total then
    raise exception 'Total alat individual tidak dapat diubah.' using errcode = '23514';
  end if;
  if new.tracking_mode = 'UNIT' and new.quantity_total <> 1 then
    raise exception 'Alat individual wajib memiliki total 1.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_heavy_equipment_quantity_definition on public.heavy_equipment;
create trigger trg_lock_heavy_equipment_quantity_definition
before update on public.heavy_equipment
for each row execute function public.lock_heavy_equipment_quantity_definition();

create index if not exists idx_heavy_equipment_tracking_mode on public.heavy_equipment(tracking_mode);
create index if not exists idx_heavy_equipment_loans_quantity_equipment on public.heavy_equipment_loans(equipment_id, status);

-- Recompute only the typed quantity snapshot. UNIT keeps the existing binary state.
create or replace function public.refresh_heavy_equipment_quantity_state(p_equipment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_equipment heavy_equipment%rowtype;
  v_reserved integer := 0;
  v_damaged integer := 0;
  v_lost integer := 0;
  v_available integer := 0;
begin
  select * into v_equipment from public.heavy_equipment where id = p_equipment_id for update;
  if not found then return; end if;
  if v_equipment.tracking_mode = 'QUANTITY' then
    select coalesce(sum(case when l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE') then greatest(0, l.quantity_borrowed - l.quantity_returned_good - l.quantity_returned_damaged - l.quantity_returned_lost) else 0 end), 0),
           coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_damaged else 0 end), 0),
           coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_lost else 0 end), 0)
      into v_reserved, v_damaged, v_lost
      from public.heavy_equipment_loans l where l.equipment_id = p_equipment_id;
    v_available := greatest(0, v_equipment.quantity_total - v_reserved - v_damaged - v_lost);
    update public.heavy_equipment
       set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
         'trackingMode', tracking_mode, 'quantityTotal', quantity_total,
         'quantityAvailable', v_available, 'quantityReserved', v_reserved,
         'quantityDamaged', v_damaged, 'quantityLost', v_lost,
         'availabilityStatus', case when v_available > 0 then 'TERSEDIA' else 'DIPINJAM' end)
     where id = p_equipment_id;
  else
    select count(*) into v_reserved
      from public.heavy_equipment_loans l
     where l.equipment_id = p_equipment_id
       and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE');
    update public.heavy_equipment
       set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
         'trackingMode', 'UNIT', 'quantityTotal', 1,
         'availabilityStatus', case when v_reserved > 0 then 'DIPINJAM' else 'TERSEDIA' end)
     where id = p_equipment_id;
  end if;
end $$;
revoke all on function public.refresh_heavy_equipment_quantity_state(text) from public;

-- Return evidence may be nested in append-only loan.data.returnEvents.
drop policy if exists "Heavy equipment evidence read" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = (storage.foldername(name))[1]
      or exists (select 1 from public.heavy_equipment_loans l where (
        l.data->>'pickupEvidencePath' = name
        or l.data->>'returnEvidencePath' = name
        or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
      ) and actor.upt_id = l.requester_upt_id)
    ))
  );

-- Referenced evidence is immutable. Orphan uploads remain deletable so a failed
-- upload/RPC transaction can clean up its object.
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence update" on storage.objects
  for update to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
    and not exists (select 1 from public.heavy_equipment_loans l where (
      l.data->>'pickupEvidencePath' = name
      or l.data->>'returnEvidencePath' = name
      or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
    ))
  ) with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
    and not exists (select 1 from public.heavy_equipment_loans l where (
      l.data->>'pickupEvidencePath' = name
      or l.data->>'returnEvidencePath' = name
      or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
    ))
  );

create or replace function public.checkout_heavy_equipment_batch_v2(
  p_items jsonb, p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_item jsonb;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type = 'UPT' then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_quantity integer;
  v_available integer;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat, jumlah, dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(p_items) x) <> (select count(distinct x.value->>'equipmentId') from jsonb_array_elements(p_items) x) then raise exception 'Daftar alat tidak boleh duplikat.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  v_owner_id := (select e.upt_id from public.heavy_equipment e where e.id = p_items->0->>'equipmentId');
  if v_owner_id is null or v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  for v_equipment in
    select e.* from public.heavy_equipment e
    where e.id in (select x.value->>'equipmentId' from jsonb_array_elements(p_items) x)
    order by e.id for update
  loop
    v_count := v_count + 1;
    v_quantity := (select nullif(trim(x.value->>'quantity'), '')::integer from jsonb_array_elements(p_items) x where x.value->>'equipmentId' = v_equipment.id);
    if v_equipment.upt_id <> v_owner_id or v_quantity is null or v_quantity < 1 then raise exception 'Alat dan jumlah tidak valid.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'UNIT' and v_quantity <> 1 then raise exception 'Alat individual hanya dapat dipinjam dengan jumlah 1.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'QUANTITY' then
      select greatest(0, v_equipment.quantity_total - coalesce(sum(case when l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE') then greatest(0, l.quantity_borrowed - l.quantity_returned_good - l.quantity_returned_damaged - l.quantity_returned_lost) else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_damaged else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_lost else 0 end), 0))
        into v_available from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id;
      if v_quantity > v_available then raise exception 'Saldo alat bantu tidak mencukupi.' using errcode = '40001'; end if;
    else
      if v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or exists (select 1 from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
    end if;
    if v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Alat tidak layak dipinjam.' using errcode = '40001'; end if;
    if v_type = 'UPT' and not v_equipment.is_cross_upt_borrowable then raise exception 'Alat belum diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
  end loop;
  if v_count <> (select count(*) from jsonb_array_elements(p_items)) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type <> 'UPT' and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'equipmentId' loop
    select * into v_equipment from public.heavy_equipment where id = v_item->>'equipmentId' for update;
    v_quantity := (v_item->>'quantity')::integer;
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id, quantity_borrowed, quantity_returned_good, quantity_returned_damaged, quantity_returned_lost)
    values (v_loan_id, jsonb_build_object(
      'id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id, 'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id,
      'ownerUpt', v_equipment.upt, 'requesterUpt', coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName'),
      'borrowerType', v_type, 'borrowerName', p_borrower->>'borrowerName', 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact',
      'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan',
      'quantityBorrowed', v_quantity, 'quantityReturnedGood', 0, 'quantityReturnedDamaged', 0, 'quantityReturnedLost', 0, 'returnEvents', '[]'::jsonb,
      'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status
    ), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName'), v_owner_id, v_requester_id, v_quantity, 0, 0, 0);
    perform public.refresh_heavy_equipment_quantity_state(v_equipment.id);
    select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) into v_row from public.heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    select data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) into v_row from public.heavy_equipment where id = v_equipment.id;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) to authenticated;

create or replace function public.approve_heavy_equipment_batch(p_loan_id text, p_decision text default 'APPROVED', p_catatan text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_batch_loan heavy_equipment_loans%rowtype;
  v_status text := upper(coalesce(p_decision, 'APPROVED'));
  v_batch_id text;
  v_loans jsonb;
  v_assets jsonb;
  v_equipment_id text;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role <> 'ASMAN' then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  select * into v_loan from public.heavy_equipment_loans where id = p_loan_id for update;
  if not found or v_loan.status <> 'PENDING_OWNER_ASMAN' then raise exception 'Peminjaman tidak menunggu approval.' using errcode = 'P0001'; end if;
  if v_actor.upt_id <> v_loan.owner_upt_id then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  if v_status not in ('APPROVED','REJECTED') then raise exception 'Keputusan approval tidak valid.' using errcode = '22023'; end if;
  v_batch_id := nullif(v_loan.data->>'loanBatchId', '');
  if v_batch_id is null then raise exception 'Batch peminjaman tidak valid.' using errcode = '23514'; end if;
  for v_batch_loan in select * from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id order by id for update loop
    if v_batch_loan.status <> 'PENDING_OWNER_ASMAN' or v_batch_loan.owner_upt_id <> v_loan.owner_upt_id then raise exception 'Status atau UPT dalam batch tidak konsisten.' using errcode = '40001'; end if;
  end loop;
  update public.heavy_equipment_loans set status = case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, data = data || jsonb_build_object('status', case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, 'approvedBy', case when v_status = 'APPROVED' then auth.uid()::text else null end, 'approvedAt', case when v_status = 'APPROVED' then floor(extract(epoch from clock_timestamp()) * 1000)::bigint else null end, 'rejectReason', case when v_status = 'REJECTED' then p_catatan else null end, 'catatanApproval', p_catatan) where data->>'loanBatchId' = v_batch_id;
  for v_equipment_id in select distinct equipment_id from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id order by equipment_id loop perform public.refresh_heavy_equipment_quantity_state(v_equipment_id); end loop;
  select jsonb_agg(data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) order by id) into v_loans from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id;
  select jsonb_agg(data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) order by id) into v_assets from public.heavy_equipment where id in (select equipment_id from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id);
  return jsonb_build_object('loans', coalesce(v_loans,'[]'::jsonb), 'equipment', coalesce(v_assets,'[]'::jsonb));
end $$;

create or replace function public.complete_heavy_equipment_quantity_loan(
  p_loan_id text, p_good integer, p_damaged integer, p_lost integer, p_return_evidence_path text, p_condition_note text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_owner text;
  v_remaining integer;
  v_new_remaining integer;
  v_occurred_at bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_event jsonb;
  v_loan_json jsonb;
  v_equipment_json jsonb;
  v_balance jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh menandai pengembalian.' using errcode = '42501'; end if;
  select * into v_loan from public.heavy_equipment_loans where id = p_loan_id for update;
  if not found then raise exception 'Peminjaman alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_loan.status not in ('DIPINJAM','APPROVED','OVERDUE') then raise exception 'Peminjaman alat sudah tidak aktif.' using errcode = 'P0001'; end if;
  select * into v_equipment from public.heavy_equipment where id = v_loan.equipment_id for update;
  if not found or v_equipment.tracking_mode <> 'QUANTITY' then raise exception 'Loan bukan pool kuantitas.' using errcode = '23514'; end if;
  v_owner := v_loan.owner_upt_id;
  if v_actor.upt_id <> v_owner then raise exception 'Pengembalian harus dilakukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if nullif(trim(p_return_evidence_path), '') is null or left(p_return_evidence_path, length(v_owner) + 1) <> v_owner || '/' then raise exception 'Bukti pengembalian wajib berada pada folder UPT pemilik.' using errcode = '42501'; end if;
  if coalesce(p_good, 0) < 0 or coalesce(p_damaged, 0) < 0 or coalesce(p_lost, 0) < 0 then raise exception 'Jumlah pengembalian tidak valid.' using errcode = '23514'; end if;
  v_remaining := greatest(0, v_loan.quantity_borrowed - v_loan.quantity_returned_good - v_loan.quantity_returned_damaged - v_loan.quantity_returned_lost);
  if coalesce(p_good, 0) + coalesce(p_damaged, 0) + coalesce(p_lost, 0) < 1 or coalesce(p_good, 0) + coalesce(p_damaged, 0) + coalesce(p_lost, 0) > v_remaining then raise exception 'Jumlah pengembalian melebihi sisa pinjaman.' using errcode = '40001'; end if;
  if (coalesce(p_damaged, 0) + coalesce(p_lost, 0)) > 0 and nullif(trim(coalesce(p_condition_note, '')), '') is null then raise exception 'Catatan kondisi wajib untuk barang rusak atau hilang.' using errcode = '23514'; end if;
  v_new_remaining := v_remaining - coalesce(p_good, 0) - coalesce(p_damaged, 0) - coalesce(p_lost, 0);
  v_event := jsonb_build_object('id', 'HRETURN-' || replace(gen_random_uuid()::text, '-', ''), 'good', coalesce(p_good, 0), 'damaged', coalesce(p_damaged, 0), 'lost', coalesce(p_lost, 0), 'remainingAfter', v_new_remaining, 'evidencePath', p_return_evidence_path, 'conditionNote', coalesce(p_condition_note, ''), 'actorId', auth.uid()::text, 'occurredAt', v_occurred_at);
  update public.heavy_equipment_loans
     set quantity_returned_good = quantity_returned_good + coalesce(p_good, 0), quantity_returned_damaged = quantity_returned_damaged + coalesce(p_damaged, 0), quantity_returned_lost = quantity_returned_lost + coalesce(p_lost, 0),
         status = case when v_new_remaining = 0 then 'SELESAI' else status end,
         data = data || jsonb_build_object('quantityReturnedGood', quantity_returned_good + coalesce(p_good, 0), 'quantityReturnedDamaged', quantity_returned_damaged + coalesce(p_damaged, 0), 'quantityReturnedLost', quantity_returned_lost + coalesce(p_lost, 0), 'returnEvents', coalesce(data->'returnEvents', '[]'::jsonb) || jsonb_build_array(v_event), 'status', case when v_new_remaining = 0 then 'SELESAI' else status end)
   where id = p_loan_id;
  perform public.refresh_heavy_equipment_quantity_state(v_equipment.id);
  select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) into v_loan_json from public.heavy_equipment_loans where id = p_loan_id;
  select data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) into v_equipment_json from public.heavy_equipment where id = v_equipment.id;
  v_balance := jsonb_build_object('total', v_equipment.quantity_total, 'available', (v_equipment_json->>'quantityAvailable')::integer, 'reserved', (v_equipment_json->>'quantityReserved')::integer, 'damaged', (v_equipment_json->>'quantityDamaged')::integer, 'lost', (v_equipment_json->>'quantityLost')::integer);
  return jsonb_build_object('loan', v_loan_json, 'equipment', v_equipment_json, 'balance', v_balance);
end $$;
revoke all on function public.complete_heavy_equipment_quantity_loan(text, integer, integer, integer, text, text) from public;
grant execute on function public.complete_heavy_equipment_quantity_loan(text, integer, integer, integer, text, text) to authenticated;

notify pgrst, 'reload schema';
