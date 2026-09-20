-- Alat Bantu Kerja: typed UPT boundary, private evidence, and atomic batch lifecycle.
-- Proposal only. Apply to self-host after explicit approval and backup.

alter table public.heavy_equipment
  add column if not exists upt_id text,
  add column if not exists is_cross_upt_borrowable boolean not null default false;
alter table public.heavy_equipment_loans
  add column if not exists owner_upt_id text,
  add column if not exists requester_upt_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_upt_id_fkey') then
    alter table public.heavy_equipment add constraint heavy_equipment_upt_id_fkey foreign key (upt_id) references public.upt(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_owner_upt_id_fkey') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loans_owner_upt_id_fkey foreign key (owner_upt_id) references public.upt(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_requester_upt_id_fkey') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loans_requester_upt_id_fkey foreign key (requester_upt_id) references public.upt(id);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from public.heavy_equipment e
    where (select count(*) from public.upt u where regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '') = regexp_replace(upper(trim(coalesce(e.upt, e.data->>'upt', ''))), '^UPT[[:space:]]+', '')) <> 1
  ) then raise exception 'heavy_equipment: snapshot nama UPT tidak unik atau tidak ditemukan'; end if;
  if exists (
    select 1 from public.heavy_equipment_loans l
    where (select count(*) from public.upt u where regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '') = regexp_replace(upper(trim(coalesce(l.owner_upt, l.data->>'ownerUpt', ''))), '^UPT[[:space:]]+', '')) <> 1
  ) then raise exception 'heavy_equipment_loans: snapshot owner UPT tidak unik atau tidak ditemukan'; end if;
  if exists (
    select 1 from public.heavy_equipment_loans l
    where nullif(trim(coalesce(l.requester_upt, l.data->>'requesterUpt', '')), '') is not null
      and coalesce(l.data->>'borrowerType', 'UPT') = 'UPT'
      and (select count(*) from public.upt u where regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '') = regexp_replace(upper(trim(coalesce(l.requester_upt, l.data->>'requesterUpt', ''))), '^UPT[[:space:]]+', '')) <> 1
  ) then raise exception 'heavy_equipment_loans: snapshot requester UPT tidak unik atau tidak ditemukan'; end if;
end $$;

-- Existing rows store a display-name snapshot. Resolve it exactly once to the typed
-- master id; ambiguous/unmapped legacy data must stop the migration.
-- Before this flag existed the registry was intentionally readable lintas-UPT.
-- Preserve that behavior only for legacy rows; new rows keep the private default.
update public.heavy_equipment
set is_cross_upt_borrowable = true
where upt_id is null;

update public.heavy_equipment e
set upt_id = u.id
from public.upt u
where e.upt_id is null
  and regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '')
    = regexp_replace(upper(trim(coalesce(e.upt, e.data->>'upt', ''))), '^UPT[[:space:]]+', '');

update public.heavy_equipment_loans l
set owner_upt_id = u.id
from public.upt u
where l.owner_upt_id is null
  and regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '')
    = regexp_replace(upper(trim(coalesce(l.owner_upt, l.data->>'ownerUpt', ''))), '^UPT[[:space:]]+', '');

update public.heavy_equipment_loans l
set requester_upt_id = u.id
from public.upt u
where l.requester_upt_id is null
  and coalesce(l.data->>'borrowerType', 'UPT') = 'UPT'
  and regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '')
    = regexp_replace(upper(trim(coalesce(l.requester_upt, l.data->>'requesterUpt', ''))), '^UPT[[:space:]]+', '');

do $$
begin
  if exists (select 1 from public.heavy_equipment where upt_id is null) then
    raise exception 'heavy_equipment: ada upt_id yang tidak dapat dipetakan secara unik';
  end if;
  if exists (select 1 from public.heavy_equipment_loans where owner_upt_id is null) then
    raise exception 'heavy_equipment_loans: ada owner_upt_id yang tidak dapat dipetakan secara unik';
  end if;
end $$;

alter table public.heavy_equipment alter column upt_id set not null;
alter table public.heavy_equipment_loans alter column owner_upt_id set not null;
create index if not exists idx_heavy_equipment_upt_id on public.heavy_equipment(upt_id);
create index if not exists idx_heavy_equipment_loans_owner_upt_id on public.heavy_equipment_loans(owner_upt_id);
create index if not exists idx_heavy_equipment_loans_requester_upt_id on public.heavy_equipment_loans(requester_upt_id);

alter table public.heavy_equipment enable row level security;
alter table public.heavy_equipment_loans enable row level security;
drop policy if exists "Authenticated read heavy_equipment" on public.heavy_equipment;
drop policy if exists "Authenticated write heavy_equipment" on public.heavy_equipment;
drop policy if exists "Read heavy_equipment authenticated" on public.heavy_equipment;
drop policy if exists "Scoped read heavy_equipment" on public.heavy_equipment;
drop policy if exists "Scoped write heavy_equipment" on public.heavy_equipment;
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
drop policy if exists "Heavy equipment TL insert" on public.heavy_equipment;
drop policy if exists "Heavy equipment TL update" on public.heavy_equipment;
drop policy if exists "Heavy equipment TL delete" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = heavy_equipment.upt_id
          or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
        )
    )
  );
create policy "Heavy equipment TL insert" on public.heavy_equipment
  for insert to authenticated with check (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  );
create policy "Heavy equipment TL update" on public.heavy_equipment
  for update to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  ) with check (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  );
create policy "Heavy equipment TL delete" on public.heavy_equipment
  for delete to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  );

drop policy if exists "Authenticated read heavy_equipment_loans" on public.heavy_equipment_loans;
drop policy if exists "Authenticated write heavy_equipment_loans" on public.heavy_equipment_loans;
drop policy if exists "Scoped all heavy_equipment_loans" on public.heavy_equipment_loans;
drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (exists (
    select 1 from public.profiles actor where actor.id = auth.uid()
      and (actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = owner_upt_id or actor.upt_id = requester_upt_id)
  ));
-- Loan state changes happen only in security-definer RPCs. No authenticated direct insert/update/delete policy is intentional.

insert into storage.buckets (id, name, public)
values ('heavy-equipment-evidence', 'heavy-equipment-evidence', false)
on conflict (id) do update set public = false;
drop policy if exists "Heavy equipment evidence read" on storage.objects;
drop policy if exists "Heavy equipment evidence insert" on storage.objects;
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = (storage.foldername(name))[1]
      or exists (select 1 from public.heavy_equipment_loans l where (l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name) and actor.upt_id = l.requester_upt_id)
    ))
  );
create policy "Heavy equipment evidence insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence update" on storage.objects
  for update to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  ) with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );

create or replace function public.checkout_heavy_equipment_batch(
  p_equipment_ids text[], p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type = 'UPT' then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  select e.upt_id into v_owner_id from heavy_equipment e where e.id = p_equipment_ids[1];
  if v_owner_id is null then raise exception 'Alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if (select count(*) from heavy_equipment where id = any(p_equipment_ids)) <> (select count(distinct x) from unnest(p_equipment_ids) x) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  for v_equipment in select * from heavy_equipment where id = any(p_equipment_ids) order by id for update loop
    v_count := v_count + 1;
    if v_equipment.upt_id <> v_owner_id or v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Semua alat harus tersedia dan milik satu UPT.' using errcode = '40001'; end if;
    if v_type = 'UPT' and not v_equipment.is_cross_upt_borrowable then raise exception 'Ada alat yang tidak diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
    if exists (select 1 from heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
  end loop;
  if v_count <> array_length(p_equipment_ids, 1) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type <> 'UPT' and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  for v_equipment in select * from heavy_equipment where id = any(p_equipment_ids) order by id loop
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id)
    values (v_loan_id, jsonb_build_object(
      'id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id,
      'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id, 'ownerUpt', v_equipment.upt,
      'requesterUpt', coalesce((select u.data->>'nama' from upt u where u.id = v_requester_id), p_borrower->>'borrowerName'),
      'borrowerType', v_type, 'borrowerName', p_borrower->>'borrowerName', 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact',
      'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan',
      'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status
    ), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, coalesce((select u.data->>'nama' from upt u where u.id = v_requester_id), p_borrower->>'borrowerName'), v_owner_id, v_requester_id);
    select data || jsonb_build_object('id', id) into v_row from heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    update heavy_equipment set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('availabilityStatus', 'DIPINJAM', 'activeLoanId', v_loan_id, 'loanBatchId', v_batch_id) where id = v_equipment.id returning data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) into v_row;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) to authenticated;

-- Approval/return RPCs are intentionally separate from direct table writes. They lock
-- the full batch in stable id order and return canonical JSON for server-first UI state.
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
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'ASMAN' then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  select * into v_loan from heavy_equipment_loans where id = p_loan_id;
  if not found or v_loan.status <> 'PENDING_OWNER_ASMAN' then raise exception 'Peminjaman tidak menunggu approval.' using errcode = 'P0001'; end if;
  if v_actor.upt_id <> v_loan.owner_upt_id then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  if v_status not in ('APPROVED','REJECTED') then raise exception 'Keputusan approval tidak valid.' using errcode = '22023'; end if;
  v_batch_id := nullif(v_loan.data->>'loanBatchId', '');
  if v_batch_id is null then raise exception 'Batch peminjaman tidak valid.' using errcode = '23514'; end if;
  for v_batch_loan in select * from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id order by id for update loop
    if v_batch_loan.status <> 'PENDING_OWNER_ASMAN' or v_batch_loan.owner_upt_id <> v_loan.owner_upt_id then raise exception 'Status atau UPT dalam batch tidak konsisten.' using errcode = '40001'; end if;
  end loop;
  perform 1 from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id) order by id for update;
  update heavy_equipment_loans set status = case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, data = data || jsonb_build_object('status', case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, 'approvedBy', case when v_status = 'APPROVED' then auth.uid()::text else null end, 'approvedAt', case when v_status = 'APPROVED' then floor(extract(epoch from clock_timestamp()) * 1000)::bigint else null end, 'rejectReason', case when v_status = 'REJECTED' then p_catatan else null end, 'catatanApproval', p_catatan) where data->>'loanBatchId' = v_batch_id;
  select jsonb_agg(data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id) order by id) into v_loans from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id;
  if v_status = 'REJECTED' then update heavy_equipment e set data = e.data || jsonb_build_object('availabilityStatus','TERSEDIA','activeLoanId',null,'loanBatchId',null) where e.id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id); else update heavy_equipment e set data = e.data || jsonb_build_object('availabilityStatus','DIPINJAM') where e.id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id); end if;
  select jsonb_agg(data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) order by id) into v_assets from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id);
  return jsonb_build_object('loans', coalesce(v_loans,'[]'::jsonb), 'equipment', coalesce(v_assets,'[]'::jsonb));
end $$;
revoke all on function public.approve_heavy_equipment_batch(text, text, text) from public;
grant execute on function public.approve_heavy_equipment_batch(text, text, text) to authenticated;

create or replace function public.complete_heavy_equipment_batch(p_loan_ids text[], p_return_evidence_path text, p_condition_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_owner text;
  v_count integer := 0;
  v_loans jsonb;
  v_assets jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh menandai pengembalian.' using errcode = '42501'; end if;
  if nullif(trim(p_return_evidence_path), '') is null or coalesce(array_length(p_loan_ids,1),0) = 0 then raise exception 'Loan dan bukti pengembalian wajib diisi.' using errcode = '23514'; end if;
  if array_length(p_loan_ids,1) <> (select count(distinct x) from unnest(p_loan_ids) x) then raise exception 'Daftar loan tidak valid.' using errcode = '23514'; end if;
  for v_loan in select * from heavy_equipment_loans where id = any(p_loan_ids) order by id for update loop
    v_count := v_count + 1;
    if v_loan.status not in ('DIPINJAM','APPROVED','OVERDUE') then raise exception 'Peminjaman sudah tidak aktif.' using errcode = 'P0001'; end if;
    v_owner := coalesce(v_owner, v_loan.owner_upt_id);
    if v_actor.upt_id <> v_loan.owner_upt_id or v_loan.owner_upt_id <> v_owner then raise exception 'Pengembalian harus dilakukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  end loop;
  if v_count <> array_length(p_loan_ids,1) then raise exception 'Ada loan yang tidak ditemukan.' using errcode = 'P0002'; end if;
  if left(p_return_evidence_path, length(v_owner) + 1) <> v_owner || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  perform 1 from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where id = any(p_loan_ids)) order by id for update;
  update heavy_equipment_loans set status='SELESAI', data=data || jsonb_build_object('status','SELESAI','returnEvidencePath',p_return_evidence_path,'conditionNote',p_condition_note,'returnedBy',auth.uid()::text,'returnedAt',floor(extract(epoch from clock_timestamp()) * 1000)::bigint) where id = any(p_loan_ids);
  update heavy_equipment e set data=e.data || jsonb_build_object('availabilityStatus','TERSEDIA','activeLoanId',null,'loanBatchId',null) where id in (select equipment_id from heavy_equipment_loans where id = any(p_loan_ids));
  select jsonb_agg(data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id) order by id) into v_loans from heavy_equipment_loans where id = any(p_loan_ids);
  select jsonb_agg(data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) order by id) into v_assets from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where id = any(p_loan_ids));
  return jsonb_build_object('loans', coalesce(v_loans,'[]'::jsonb), 'equipment', coalesce(v_assets,'[]'::jsonb));
end $$;
revoke all on function public.complete_heavy_equipment_batch(text[], text, text) from public;
grant execute on function public.complete_heavy_equipment_batch(text[], text, text) to authenticated;

-- Pengembalian baru wajib membawa bukti foto melalui RPC batch.
revoke execute on function public.complete_heavy_equipment_loan(text) from authenticated;

notify pgrst, 'reload schema';
