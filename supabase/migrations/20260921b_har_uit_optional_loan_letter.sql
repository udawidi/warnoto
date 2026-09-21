-- HAR_UIT loan letter is optional. Existing RPC signatures and legacy paths stay intact.
-- The preceding HAR_UIT migration already owns these functions; this migration
-- only replaces the validation rules so upgraded production keeps one contract.
do $migration$
declare
  v_sql text;
  v_before text;
begin
  select pg_get_functiondef('public.checkout_heavy_equipment_batch(text[],jsonb,jsonb,text)'::regprocedure) into v_sql;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$old$,
    $new$  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 then raise exception 'Alat wajib dipilih.' using errcode = '23514'; end if;
  if v_type <> 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch validation tidak ditemukan.'; end if;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;$old$,
    $new$  if nullif(trim(p_pickup_evidence_path), '') is not null and left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is not null and p_pickup_evidence_path !~ ('^' || v_owner_id || '/' || v_batch_id || '/loan-letter[.](pdf|jpg|jpeg|png|webp)$') then raise exception 'Path surat peminjaman tidak valid.' using errcode = '42501'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch path guard tidak ditemukan.'; end if;
  execute v_sql;

  select pg_get_functiondef('public.checkout_heavy_equipment_batch_v2(jsonb,jsonb,jsonb,text)'::regprocedure) into v_sql;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat, jumlah, dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$old$,
    $new$  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Alat dan jumlah wajib diisi.' using errcode = '23514'; end if;
  if v_type <> 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch_v2 validation tidak ditemukan.'; end if;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;$old$,
    $new$  if nullif(trim(p_pickup_evidence_path), '') is not null and left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is not null and p_pickup_evidence_path !~ ('^' || v_owner_id || '/' || v_batch_id || '/loan-letter[.](pdf|jpg|jpeg|png|webp)$') then raise exception 'Path surat peminjaman tidak valid.' using errcode = '42501'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch_v2 path guard tidak ditemukan.'; end if;
  execute v_sql;
end
$migration$;

notify pgrst, 'reload schema';
