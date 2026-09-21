-- HAR_UIT direct borrower for heavy equipment.
-- Proposal only. Apply to self-host after explicit approval and backup.

alter table public.heavy_equipment_loans
  add column if not exists requester_uit_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_requester_uit_id_fkey') then
    alter table public.heavy_equipment_loans
      add constraint heavy_equipment_loans_requester_uit_id_fkey
      foreign key (requester_uit_id) references public.uit(id);
  end if;
end $$;

create index if not exists idx_heavy_equipment_loans_requester_uit_id
  on public.heavy_equipment_loans(requester_uit_id);

-- HAR_UIT sees canonical registry rows for UPTs in its UIT. Existing UPT
-- cross-borrow visibility remains unchanged.
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = heavy_equipment.upt_id
          or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (select 1 from public.upt owner_upt where owner_upt.id = heavy_equipment.upt_id and owner_upt.uit_id = actor.uit_id)
          )
        )
    )
  );

drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = owner_upt_id
          or actor.upt_id = requester_upt_id
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and (
              requester_uit_id = actor.uit_id
              or exists (select 1 from public.upt scoped_upt where scoped_upt.id = owner_upt_id and scoped_upt.uit_id = actor.uit_id)
              or exists (select 1 from public.upt scoped_upt where scoped_upt.id = requester_upt_id and scoped_upt.uit_id = actor.uit_id)
            )
          )
        )
    )
  );

drop policy if exists "Heavy equipment evidence read" on storage.objects;
drop policy if exists "Heavy equipment evidence insert" on storage.objects;
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = (storage.foldername(name))[1]
          or exists (
            select 1 from public.heavy_equipment_loans l
            where (
              l.data->>'pickupEvidencePath' = name
              or l.data->>'returnEvidencePath' = name
              or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
            )
            and (
              actor.upt_id = l.requester_upt_id
              or (actor.role = 'HAR_UIT' and actor.uit_id = l.requester_uit_id)
              or (actor.role = 'HAR_UIT' and exists (select 1 from public.upt scoped_upt where scoped_upt.id = l.owner_upt_id and scoped_upt.uit_id = actor.uit_id))
            )
          )
        )
    )
  );
create policy "Heavy equipment evidence insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          (actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (select 1 from public.upt scoped_upt where scoped_upt.id = (storage.foldername(name))[1] and scoped_upt.uit_id = actor.uit_id)
          )
        )
    )
  );
-- Referenced evidence is immutable. Only orphan cleanup is allowed.
create policy "Heavy equipment evidence update" on storage.objects
  for update to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
    and not exists (select 1 from public.heavy_equipment_loans l where l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name))
  ) with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and owner_id = auth.uid()::text
    and not exists (select 1 from public.heavy_equipment_loans l where l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name))
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          (actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (select 1 from public.upt scoped_upt where scoped_upt.id = (storage.foldername(name))[1] and scoped_upt.uit_id = actor.uit_id)
          )
        )
    )
  );

-- Keep the established RPC signatures. TL validation stays the same; HAR_UIT
-- is a separate server-derived branch and cannot spoof it.
create or replace function public.checkout_heavy_equipment_batch(
  p_equipment_ids text[], p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_requester_uit_id text;
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type in ('UPT','HAR_UIT') then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or (v_actor.role <> 'TL' and v_actor.role <> 'HAR_UIT') then raise exception 'Hanya TL UPT pemilik atau HAR UIT yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN','HAR_UIT') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if v_actor.role = 'HAR_UIT' and v_type <> 'HAR_UIT' then raise exception 'Akun HAR UIT hanya dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_actor.role = 'TL' and v_type = 'HAR_UIT' then raise exception 'TL tidak dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and v_actor.role <> 'HAR_UIT' then raise exception 'Hanya akun HAR UIT yang dapat membuat peminjaman HAR_UIT.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and (v_actor.uit_id is null or nullif(trim(p_borrower->>'borrowerUitId'), '') <> v_actor.uit_id) then raise exception 'UIT peminjam tidak valid.' using errcode = '42501'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  select e.upt_id into v_owner_id from public.heavy_equipment e where e.id = p_equipment_ids[1];
  if v_owner_id is null then raise exception 'Alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_actor.role = 'TL' and v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if v_actor.role = 'HAR_UIT' and not exists (select 1 from public.upt owner_upt where owner_upt.id = v_owner_id and owner_upt.uit_id = v_actor.uit_id) then raise exception 'UPT pemilik berada di luar UIT akun.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if (select count(*) from public.heavy_equipment where id = any(p_equipment_ids)) <> (select count(distinct x) from unnest(p_equipment_ids) x) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  for v_equipment in select * from public.heavy_equipment where id = any(p_equipment_ids) order by id for update loop
    v_count := v_count + 1;
    if v_equipment.upt_id <> v_owner_id or v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Semua alat harus tersedia dan milik satu UPT.' using errcode = '40001'; end if;
    if v_type in ('UPT','HAR_UIT') and not v_equipment.is_cross_upt_borrowable then raise exception 'Ada alat yang belum diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
    if exists (select 1 from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
  end loop;
  if v_count <> array_length(p_equipment_ids, 1) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and (v_requester_id is not null or v_actor.uit_id is null) then raise exception 'Requester UPT HAR_UIT tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and (nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'PIC dan kontak HAR_UIT wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','HAR_UIT') and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  v_requester_uit_id := case when v_type = 'HAR_UIT' then v_actor.uit_id else null end;
  for v_equipment in select * from public.heavy_equipment where id = any(p_equipment_ids) order by id loop
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id, requester_uit_id)
    values (v_loan_id, jsonb_build_object(
      'id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id, 'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id, 'requesterUitId', v_requester_uit_id,
      'ownerUpt', v_equipment.upt, 'requesterUpt', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end,
      'borrowerType', v_type, 'borrowerName', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else p_borrower->>'borrowerName' end, 'borrowerUitId', v_requester_uit_id, 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact',
      'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan',
      'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status
    ), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end, v_owner_id, v_requester_id, v_requester_uit_id);
    select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'requesterUitId', requester_uit_id) into v_row from public.heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    update public.heavy_equipment set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('availabilityStatus', 'DIPINJAM', 'activeLoanId', v_loan_id, 'loanBatchId', v_batch_id) where id = v_equipment.id returning data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) into v_row;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) to authenticated;

create or replace function public.checkout_heavy_equipment_batch_v2(
  p_items jsonb, p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_item jsonb;
  v_equipment heavy_equipment%rowtype;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_requester_uit_id text;
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type in ('UPT','HAR_UIT') then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_quantity integer;
  v_available integer;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or (v_actor.role <> 'TL' and v_actor.role <> 'HAR_UIT') then raise exception 'Hanya TL UPT pemilik atau HAR UIT yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat, jumlah, dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(p_items) x) <> (select count(distinct x.value->>'equipmentId') from jsonb_array_elements(p_items) x) then raise exception 'Daftar alat tidak boleh duplikat.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN','HAR_UIT') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if v_actor.role = 'HAR_UIT' and v_type <> 'HAR_UIT' then raise exception 'Akun HAR UIT hanya dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_actor.role = 'TL' and v_type = 'HAR_UIT' then raise exception 'TL tidak dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and (v_actor.role <> 'HAR_UIT' or v_actor.uit_id is null or nullif(trim(p_borrower->>'borrowerUitId'), '') <> v_actor.uit_id) then raise exception 'UIT peminjam tidak valid.' using errcode = '42501'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  v_owner_id := (select e.upt_id from public.heavy_equipment e where e.id = p_items->0->>'equipmentId');
  if v_owner_id is null then raise exception 'Alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_actor.role = 'TL' and v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if v_actor.role = 'HAR_UIT' and not exists (select 1 from public.upt owner_upt where owner_upt.id = v_owner_id and owner_upt.uit_id = v_actor.uit_id) then raise exception 'UPT pemilik berada di luar UIT akun.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  for v_equipment in select e.* from public.heavy_equipment e where e.id in (select x.value->>'equipmentId' from jsonb_array_elements(p_items) x) order by e.id for update loop
    v_count := v_count + 1;
    v_quantity := (select nullif(trim(x.value->>'quantity'), '')::integer from jsonb_array_elements(p_items) x where x.value->>'equipmentId' = v_equipment.id);
    if v_equipment.upt_id <> v_owner_id or v_quantity is null or v_quantity < 1 then raise exception 'Alat dan jumlah tidak valid.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'UNIT' and v_quantity <> 1 then raise exception 'Alat individual hanya dapat dipinjam dengan jumlah 1.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'QUANTITY' then
      select greatest(0, v_equipment.quantity_total - coalesce(sum(case when l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE') then greatest(0, l.quantity_borrowed - l.quantity_returned_good - l.quantity_returned_damaged - l.quantity_returned_lost) else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_damaged else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_lost else 0 end), 0)) into v_available from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id;
      if v_quantity > v_available then raise exception 'Saldo alat bantu tidak mencukupi.' using errcode = '40001'; end if;
    else
      if v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or exists (select 1 from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
    end if;
    if v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Alat tidak layak dipinjam.' using errcode = '40001'; end if;
    if v_type in ('UPT','HAR_UIT') and not v_equipment.is_cross_upt_borrowable then raise exception 'Alat belum diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
  end loop;
  if v_count <> (select count(*) from jsonb_array_elements(p_items)) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and v_requester_id is not null then raise exception 'Requester UPT HAR_UIT tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and (nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'PIC dan kontak HAR_UIT wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','HAR_UIT') and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  v_requester_uit_id := case when v_type = 'HAR_UIT' then v_actor.uit_id else null end;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'equipmentId' loop
    select * into v_equipment from public.heavy_equipment where id = v_item->>'equipmentId' for update;
    v_quantity := (v_item->>'quantity')::integer;
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id, requester_uit_id, quantity_borrowed, quantity_returned_good, quantity_returned_damaged, quantity_returned_lost)
    values (v_loan_id, jsonb_build_object('id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id, 'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id, 'requesterUitId', v_requester_uit_id, 'ownerUpt', v_equipment.upt, 'requesterUpt', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end, 'borrowerType', v_type, 'borrowerName', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else p_borrower->>'borrowerName' end, 'borrowerUitId', v_requester_uit_id, 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact', 'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan', 'quantityBorrowed', v_quantity, 'quantityReturnedGood', 0, 'quantityReturnedDamaged', 0, 'quantityReturnedLost', 0, 'returnEvents', '[]'::jsonb, 'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end, v_owner_id, v_requester_id, v_requester_uit_id, v_quantity, 0, 0, 0);
    perform public.refresh_heavy_equipment_quantity_state(v_equipment.id);
    select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'requesterUitId', requester_uit_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) into v_row from public.heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    select data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) into v_row from public.heavy_equipment where id = v_equipment.id;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
