alter table public.warehouse_capacity
  drop constraint if exists warehouse_capacity_bounds_check;

alter table public.warehouse_capacity
  add constraint warehouse_capacity_bounds_check check (
    luas_lahan_m2 >= 0 and luas_terpakai_m2 >= 0
    and luas_terpakai_m2 <= luas_lahan_m2 + 0.000001
    and abs(sisa_luas_m2 - (luas_lahan_m2 - luas_terpakai_m2)) <= 0.000001
    and persentase_terpakai between 0 and 1
    and abs(persentase_terpakai - case when luas_lahan_m2 = 0 then 0 else luas_terpakai_m2 / luas_lahan_m2 end) <= 0.000001
    and coalesce(persediaan_pct, 0) between 0 and 1
    and coalesce(cadang_pct, 0) between 0 and 1
    and coalesce(pre_memory_pct, 0) between 0 and 1
    and coalesce(attb_pct, 0) between 0 and 1
    and coalesce(lainnya_pct, 0) between 0 and 1
    and coalesce(persediaan_pct, 0) + coalesce(cadang_pct, 0) + coalesce(pre_memory_pct, 0) + coalesce(attb_pct, 0) + coalesce(lainnya_pct, 0) <= 1.000001
    and status_kapasitas = case when persentase_terpakai >= 0.90 then 'KRITIS' when persentase_terpakai >= 0.75 then 'WASPADA' else 'AMAN' end
  );
