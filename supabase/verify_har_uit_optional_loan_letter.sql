do $verify$
declare
  v_batch text := pg_get_functiondef('public.checkout_heavy_equipment_batch(text[],jsonb,jsonb,text)'::regprocedure);
  v_batch_v2 text := pg_get_functiondef('public.checkout_heavy_equipment_batch_v2(jsonb,jsonb,jsonb,text)'::regprocedure);
  v_return_batch text := pg_get_functiondef('public.complete_heavy_equipment_batch(text[],text,text)'::regprocedure);
  v_return_quantity text := pg_get_functiondef('public.complete_heavy_equipment_quantity_loan(text,integer,integer,integer,text,text)'::regprocedure);
begin
  if position($needle$v_type <> 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is null$needle$ in v_batch) = 0
    or position($needle$v_type <> 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is null$needle$ in v_batch_v2) = 0 then
    raise exception 'HAR_UIT optional loan letter guard missing.';
  end if;

  if position($needle$/loan-letter[.](pdf|jpg|jpeg|png|webp)$needle$ in v_batch) = 0
    or position($needle$/loan-letter[.](pdf|jpg|jpeg|png|webp)$needle$ in v_batch_v2) = 0 then
    raise exception 'HAR_UIT loan letter path guard missing.';
  end if;

  if position($needle$nullif(trim(p_pickup_evidence_path), '') is not null and left(p_pickup_evidence_path$needle$ in v_batch) = 0
    or position($needle$nullif(trim(p_pickup_evidence_path), '') is not null and left(p_pickup_evidence_path$needle$ in v_batch_v2) = 0 then
    raise exception 'Owner UPT evidence guard missing.';
  end if;

  if position($needle$Loan dan bukti pengembalian wajib diisi.$needle$ in v_return_batch) = 0
    or position($needle$Bukti pengembalian wajib berada pada folder UPT pemilik.$needle$ in v_return_quantity) = 0 then
    raise exception 'Return evidence requirement changed unexpectedly.';
  end if;

  raise notice 'HAR_UIT optional loan letter contract verified.';
end
$verify$;
