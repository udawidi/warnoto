-- PROPOSAL ONLY: correct lifecycle and catalog mapping for the known live MTU KHS batches.
-- Apply only after review. Records outside these batch keys are not changed.
begin;

alter table public.mtu_khs_records drop constraint if exists mtu_khs_records_lifecycle_status_check;
alter table public.mtu_khs_records add constraint mtu_khs_records_lifecycle_status_check check (lifecycle_status in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','PLANNED_ARRIVAL','CANCELLED'));
alter table public.mtu_khs_units drop constraint if exists mtu_khs_units_lifecycle_status_check;
alter table public.mtu_khs_units add constraint mtu_khs_units_lifecycle_status_check check (lifecycle_status in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','PLANNED_ARRIVAL','CANCELLED'));

create or replace function pg_temp.mtu_khs_date_list(p_value text)
returns date[] language plpgsql immutable as $function$
declare result date[] := '{}'; part text; token text; fallback_year integer; bits text[]; d integer; m integer; y integer;
begin
  if nullif(btrim(coalesce(p_value,'')),'') is null or btrim(p_value)='-' then return result; end if;
  fallback_year := nullif(substring(p_value from '(20[0-9]{2})'),'')::integer;
  foreach part in array regexp_split_to_array(replace(p_value,chr(13),''),E'\\s*(&|\\n)\\s*') loop
    token := upper(regexp_replace(btrim(part),'\\s+',' ','g')); d:=null; m:=null; y:=null;
    begin
      if token ~ '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$' then bits:=regexp_split_to_array(token,'[-/]'); y:=bits[1]::integer; m:=bits[2]::integer; d:=bits[3]::integer;
      elsif token ~ '^[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4}$' then bits:=regexp_split_to_array(token,'[-/]'); d:=bits[1]::integer; m:=bits[2]::integer; y:=bits[3]::integer;
      elsif token ~ '^[0-9]{1,2} [A-Z]+( [0-9]{4})?$' then
        bits:=regexp_split_to_array(token,' '); d:=bits[1]::integer; y:=coalesce(nullif(bits[3],'')::integer,fallback_year);
        m:=case bits[2]
          when 'JAN' then 1 when 'JANUARY' then 1 when 'JANUARI' then 1 when 'FEB' then 2 when 'FEBRUARY' then 2 when 'FEBRUARI' then 2
          when 'MAR' then 3 when 'MARCH' then 3 when 'MARET' then 3 when 'APR' then 4 when 'APRIL' then 4 when 'MAY' then 5 when 'MEI' then 5
          when 'JUN' then 6 when 'JUNE' then 6 when 'JUNI' then 6 when 'JUL' then 7 when 'JULY' then 7 when 'JULI' then 7
          when 'AUG' then 8 when 'AUGUST' then 8 when 'AGUSTUS' then 8 when 'SEP' then 9 when 'SEPT' then 9 when 'SEPTEMBER' then 9
          when 'OCT' then 10 when 'OCTOBER' then 10 when 'OKT' then 10 when 'OKTOBER' then 10 when 'NOV' then 11 when 'NOVEMBER' then 11
          when 'DEC' then 12 when 'DECEMBER' then 12 when 'DES' then 12 when 'DESEMBER' then 12 end;
      end if;
      if d is not null and m is not null and y is not null then result:=array_append(result,make_date(y,m,d)); end if;
    exception when others then continue; end;
  end loop;
  return result;
end $function$;

with source_specs as (
  select * from jsonb_to_recordset($spec$[{"code":"CB70-001","description":"CB;K;66kV;2000A;31.5KA;SPRING;1P;SF6","noSapStok":"2010620","noSapCadang":"1002010620"},{"code":"CB70-002","description":"CB;K;70kV;3150A;31.5KA;MTR SPRING;1P;SF6","noSapStok":"2010629","noSapCadang":"1002010629"},{"code":"CB70-004","description":"CB;K;66kV;1250A;31.5KA;SPRING;3P;SF6","noSapStok":"2010557","noSapCadang":"1002010557"},{"code":"CB70-005","description":"CB;K;70kV;3150A;31.5kA;SPRING;3P;SF6","noSapStok":"2010171","noSapCadang":"1002010171"},{"code":"CB150-002","description":"CB;K;150kV;3150A;40KA;SPRING;1P;SF6","noSapStok":"2010015","noSapCadang":"1002010015"},{"code":"CB150-004","description":"CB;K;150kV;4000A;50KA;SPRING;1P;SF6","noSapStok":"2010021","noSapCadang":"1002010021"},{"code":"CB150-005","description":"CB;K;150kV;1250A;40KA;SPRING;3P;SF6","noSapStok":"2010002","noSapCadang":"1002010002"},{"code":"CB150-007","description":"CB;K;150kV;3150A;40KA;SPRING;3P;SF6","noSapStok":"2010016","noSapCadang":"1002010016"},{"code":"CB150-008","description":"CB;K;150kV;4000A;40KA;SPRING;3P;SF6","noSapStok":"2010114","noSapCadang":"1002010114"},{"code":"CB150-009","description":"CB;K;150kV;4000A;50kA;SPRING;3P;SF6","noSapStok":"2010022","noSapCadang":"1002010022"},{"code":"CB150-011","description":"CB;K;150kV;1250A;40KA;SPRING;1P;SF6","noSapStok":"2010001","noSapCadang":"1002010001"},{"code":"CB500-001","description":"CB;K-CR;500kV;4KA;50KA;SPRING;1P-1.3;SF6","noSapStok":"2010627","noSapCadang":"1002010627"},{"code":"CB500-002","description":"CB;K-CR;500kV;4000A;50KA;SPRING;1P-2;SF6","noSapStok":"2010628","noSapCadang":"1002010628"},{"code":"DS70-001","description":"DS;K;66kV;3P;1250A;31.5KA;;OD","noSapStok":"2030552","noSapCadang":"1002030552"},{"code":"DS70-002","description":"DS;K;70kV;3P;1250A;40KA;;OD","noSapStok":"2030017","noSapCadang":"1002030017"},{"code":"DS70-003","description":"DS;K;66kV;3P;2000A;31.5KA;;OD","noSapStok":"2030553","noSapCadang":"1002030553"},{"code":"DSE70-002","description":"DS;K;66kV;3P;2000A;31.5KA;ES;OD","noSapStok":"2030557","noSapCadang":"1002030557"},{"code":"DS150-001","description":"DS;K;150kV;3P;1250A;40KA;;OD","noSapStok":"2030570","noSapCadang":"1002030570"},{"code":"DS150-002","description":"DS;K;150kV;3P;2000A;40KA;OD","noSapStok":"2030005","noSapCadang":"1002030005"},{"code":"DS150-004","description":"DS;K;150kV;3P;2000A;50KA;OD","noSapStok":"2030200","noSapCadang":"1002030200"},{"code":"DS150-005","description":"DS;K;150kV;3P;2000A;40KA;OD","noSapStok":"2030005","noSapCadang":"1002030005"},{"code":"DS150-006","description":"DS;K;150kV;3P;2500A;40KA;;OD","noSapStok":"2030006","noSapCadang":"1002030006"},{"code":"DS150-007","description":"DS;K;150kV;3P;3150A;50KA;OD","noSapStok":"2030339","noSapCadang":"1002030300"},{"code":"DS150-008","description":"DS;K;150kV;3P;4000A;40KA;OD","noSapStok":"2030168","noSapCadang":"1002030168"},{"code":"DS150-009","description":"DS;K;150kV;3P;4000A;50KA;;OD","noSapStok":"2030343","noSapCadang":"1002030295"},{"code":"DSE150-002","description":"DS;K;150kV;3P;2000A;40KA;ES;OD","noSapStok":"2030162","noSapCadang":"1002030162"},{"code":"DSE150-003","description":"DS;K;150kV;3P;2500A;40kA;ES;OD","noSapStok":"2030007","noSapCadang":"1002030007"},{"code":"DSE150-004","description":"DS;K;150kV;3P;3150A;40KA;ES;OD","noSapStok":"2030036","noSapCadang":"1002030036"},{"code":"DSE150-006","description":"DS;K;150kV;3P;4000A;40KA;ES;OD","noSapStok":"2030169","noSapCadang":"1002030169"},{"code":"LA70-001","description":"LA;66kV;K;10KA;MOV;SM;72.5kV","noSapStok":"2090505","noSapCadang":"1002090505"},{"code":"LA150-001","description":"LA;150kV;K;20KA;MOV;SM;104kV","noSapStok":"2090509","noSapCadang":"1002090509"},{"code":"LA150-002","description":"LA;150kV;K;20KA;MOV;SH;104kV","noSapStok":"2090510","noSapCadang":"1002090510"},{"code":"CVT70-002","description":"PT;70kV;K;CAP;70/V3-100/V3;0.2;60VA","noSapStok":"2070920","noSapCadang":"1002070920"},{"code":"CVT70-008","description":"PT;70kV;K;CAP;66/V3-110/V3;0.2;60VA","noSapStok":"2070924","noSapCadang":"1002070924"},{"code":"CVT70-010","description":"PT;70kV;K;CAP;70/V3-110/V3;0.2;60VA","noSapStok":"2070925","noSapCadang":"1002070925"},{"code":"CVT150-002","description":"PT;150kV;K;CAP;150/V3-100/V3;0.2;60VA","noSapStok":"2070968","noSapCadang":"1002070769"},{"code":"CVT150-003","description":"PT;150kV;K;CAP;150/V3-100/V3;0.5;60VA","noSapStok":"2070970","noSapCadang":"1002070755"},{"code":"CVT150-004","description":"PT;150kV;K;CAP;150/V3-110/V3;0.2;60VA","noSapStok":"2070971","noSapCadang":"1002070725"},{"code":"CVT150-006","description":"PT;150kV;K;CAP;150/V3-110/V3;0.5;60VA","noSapStok":"2070957","noSapCadang":"1002070957"},{"code":"CVT150-007","description":"PT;150kV;K;CAP;154/V3-110/V3;0.2;60VA","noSapStok":"2070973","noSapCadang":"1002070973"},{"code":"CVT500-003","description":"PT;500kV;K;CAP;500/V3-100/V3;3P-3P-.2;60","noSapStok":"2070991","noSapCadang":"1002070991"},{"code":"CT70-002","description":"CT;66;K;1.2-2K/5X4;PX-5P20-.5;40-35;P","noSapStok":"2055009","noSapCadang":"1002055009"},{"code":"CT70-003","description":"CT;66;K;1-2K/1X4;PX-5P20-.5;20-15;P","noSapStok":"2055002","noSapCadang":"1002055002"},{"code":"CT70-005","description":"CT;66;K;1.2-2K/5X4;PX-5P20-.2S;40-35;M","noSapStok":"2055008","noSapCadang":"1002055008"},{"code":"CT70-007","description":"CT;66;K;2K/5X2;PX-5P20+.5;40-35;P","noSapStok":"2055026","noSapCadang":"1002055026"},{"code":"CT70-008","description":"CT;66;K;2K/5X3;PX-5P20+.5;40-35;P","noSapStok":"2055028","noSapCadang":"1002055028"},{"code":"CT150-001","description":"CT;150;K;0.3-4K/1X5;PX-5P20-.5;20-15;P","noSapStok":"2055061","noSapCadang":"1002055061"},{"code":"CT150-002","description":"CT;150;K;0.3-4K/5X5;PX-5P20-.5;40-35;P","noSapStok":"2055102","noSapCadang":"1002054913"},{"code":"CT150-003","description":"CT;150kV;K;300-4K/5X1A;5P20PX0.2S;15VA;U","noSapStok":"2054625","noSapCadang":"1002054625"},{"code":"CT150-004","description":"CT;150kV;K;150-300-2000/5;5P20;50VA;U","noSapStok":"2053679","noSapCadang":"1002053679"},{"code":"CT150-005","description":"CT;150kV;K;400/1;1-5P20;40VA;U","noSapStok":"2052850","noSapCadang":"1002052850"},{"code":"CT150-006","description":"CT;150kV;K;200-400/1;0.5-5P20;40VA;U","noSapStok":"2054950","noSapCadang":"1002053163"},{"code":"CT150-007","description":"CT;150kV;K;200-400/5;0.2-5P20;70VA;U","noSapStok":"2054951","noSapCadang":"1002053155"},{"code":"CT150-012","description":"CT;150;K;1.2-4K/5X5;PX-5P20-.2S;40-35;M","noSapStok":"2055044","noSapCadang":"1002055044"},{"code":"CT150-014","description":"CT;150kV;K;800-1600-4000/1;5P20;40VA;U","noSapStok":"2052377","noSapCadang":"1002052377"},{"code":"CT150-015","description":"CT;150;K;2-4K/5X5;PX-5P20-.2S;40-35;M","noSapStok":"2055049","noSapCadang":"1002055049"},{"code":"CT150-017","description":"CT;150kV;K;2000-4000/5X1A;PX-0.2S;20VA;U","noSapStok":"2054938","noSapCadang":"1002054938"},{"code":"CT150-018","description":"CT;150;K;2-4K/1X5;PX-5P20-.5;20-15;P","noSapStok":"2054909","noSapCadang":"1002054909"},{"code":"CT150-019","description":"CT;150kV;K;1000-2000/5;0.5-5P20;40VA;U","noSapStok":"2054962","noSapCadang":"1002053822"},{"code":"CT150-020","description":"CT;150;K;2-4K/5X5;PX-5P20-.5;40-35;P","noSapStok":"2054244","noSapCadang":"1002054914"},{"code":"CT150-025","description":"CT;150kV;K;2000-4000/2X1A;5P20-PX;20VA;P","noSapStok":"2054396","noSapCadang":"1002054396"},{"code":"CT150-026","description":"CT;150kV;K;2000-4000/1;5P20;20VA;OD","noSapStok":"2054570","noSapCadang":"1002054570"},{"code":"CT150-027","description":"CT;150kV;K;2K-4K/5X1A;5P20PX-0.2S;15VA;U","noSapStok":"2054663","noSapCadang":"1002054663"},{"code":"CT150-028","description":"CT;150;K;4K/1X5;PX-5P20-.5;20-15;P","noSapStok":"2055057","noSapCadang":"1002055057"},{"code":"CT150-029","description":"CT;150;K;4K/5X5;PX-5P20-.5;40-35;P","noSapStok":"2055059","noSapCadang":"1002055059"},{"code":"CT150-030","description":"CT;150kV;K;2000-4000/1-1-1-1-1;PX;50VA;P","noSapStok":"2054221","noSapCadang":"1002054221"},{"code":"CT150-031","description":"CT;150;K;4K/5X5;PX-5P20-.2S;40-35;M","noSapStok":"2055058","noSapCadang":"1002055058"},{"code":"CT500-001","description":"CT;500;K;4K/1X5;TPX-5P20;20;P","noSapStok":"2055079","noSapCadang":"1002055079"},{"code":"CT500-002","description":"CT;500;K;4K/1X5;TP2XY-.5;15;P","noSapStok":"2055075","noSapCadang":"1002055075"}]$spec$::jsonb) as x(code text,description text,"noSapStok" text,"noSapCadang" text)
)
update public.mtu_khs_specs s set data=coalesce(s.data,'{}'::jsonb)||jsonb_build_object(
  'description',source_specs.description,'noSapStok',source_specs."noSapStok",'noSapCadang',source_specs."noSapCadang",'catalogSource','KHS_SPESIFIKASI_2024')
from source_specs where s.procurement_year=2024 and upper(btrim(s.mtu_code))=upper(btrim(source_specs.code));

do $guard$ begin
  if exists(select 1 from public.katalog where id='KAT-1004190948' and coalesce(data->>'katalog','') not in ('','1004190948')) then raise exception 'MTU_KATALOG_ID_CONFLICT:KAT-1004190948'; end if;
end $guard$;
insert into public.katalog(id,data,created_at) values(
  'KAT-1004190948',
  jsonb_build_object('id','KAT-1004190948','katalog','1004190948','name','UNIV ACC;SF6 REGULATOR','category','Lainnya','jenisBarang','Cadang','source','MTU_KHS_SPEC','migrationKey','MTU-LIFECYCLE-CATALOG-20260912E'),
  (extract(epoch from clock_timestamp())*1000)::bigint) on conflict(id) do nothing;

do $migration$
declare batch_keys text[]:=array['MTU-BATCH-2024-7b82bcf3f73c66e4','MTU-BATCH-2026-7b82bcf3f73c66e4'];
begin
  with source_values as (
    select r.id,r.procurement_year,r.qty,
      nullif(btrim(coalesce(nullif(r.data->>'onsiteDate',''),nullif(r.data->'rawData'->>'TANGGAL MATERIAL ON SITE',''))),'') onsite,
      nullif(btrim(coalesce(nullif(r.data->>'installationDate',''),nullif(r.data->'rawData'->>'REALISASI PASANG',''))),'') installation,
      case when btrim(coalesce(r.data->'rawData'->>'JUMLAH TERPASANG',''))~'^[0-9]+([.,][0-9]+)?$' then replace(btrim(r.data->'rawData'->>'JUMLAH TERPASANG'),',','.')::numeric end installed_qty,
      case when btrim(coalesce(r.data->'rawData'->>'SISA',''))~'^[0-9]+([.,][0-9]+)?$' then replace(btrim(r.data->'rawData'->>'SISA'),',','.')::numeric end remaining_qty,
      pg_temp.mtu_khs_date_list(coalesce(nullif(r.data->>'onsiteDate',''),r.data->'rawData'->>'TANGGAL MATERIAL ON SITE')) onsite_dates,
      pg_temp.mtu_khs_date_list(coalesce(nullif(r.data->>'installationDate',''),r.data->'rawData'->>'REALISASI PASANG')) installation_dates
    from public.mtu_khs_records r where r.data->'_migration'->>'batchKey'=any(batch_keys)
  ), parsed as (
    select source_values.*,onsite_dates[array_length(onsite_dates,1)] onsite_date,installation_dates[array_length(installation_dates,1)] installation_date from source_values
  ), derived as (
    select parsed.*,
      case when procurement_year=2026 then 'PLANNED_ARRIVAL'
        when (qty>0 and installed_qty>=qty) or (installed_qty>0 and remaining_qty=0) then 'INSTALLED'
        when installation_date is not null or installed_qty>0 or (qty>0 and remaining_qty<qty) then 'ON_SITE'
        when onsite_date<=date '2026-09-12' then 'ON_SITE' when onsite_date is not null then 'PLANNED_ARRIVAL' else 'VENDOR' end lifecycle,
      case when installed_qty>0 and installed_qty<qty then 'SEBAGIAN TERPASANG' end installation_status
    from parsed
  )
  update public.mtu_khs_records r set
    data=coalesce(r.data,'{}'::jsonb)
      ||jsonb_build_object('_lifecycleCatalogRollback',coalesce(r.data->'_lifecycleCatalogRollback',jsonb_strip_nulls(jsonb_build_object(
        'lifecycleStatus',r.data->'lifecycleStatus','lifecycleSource',r.data->'lifecycleSource',
        'onsiteDate',r.data->'onsiteDate','onsiteDates',r.data->'onsiteDates','onsiteDateOriginal',r.data->'onsiteDateOriginal',
        'installationDate',r.data->'installationDate','installationDates',r.data->'installationDates','installationDateOriginal',r.data->'installationDateOriginal',
        'installedQty',r.data->'installedQty','remainingQty',r.data->'remainingQty','installationStatus',r.data->'installationStatus',
        'katalogId',r.data->'katalogId','catalogNumber',r.data->'catalogNumber','materialDescription',r.data->'materialDescription',
        'catalogType',r.data->'catalogType','catalogWarning',r.data->'catalogWarning',
        '_columnLifecycleStatus',to_jsonb(r.lifecycle_status),'_columnKatalogId',to_jsonb(r.katalog_id)))))
      ||jsonb_build_object('onsiteDate',coalesce(to_char(d.onsite_date,'YYYY-MM-DD'),''),
        'onsiteDates',to_jsonb(coalesce(d.onsite_dates,'{}'::date[])),'onsiteDateOriginal',coalesce(d.onsite,''),
        'installationDate',coalesce(to_char(d.installation_date,'YYYY-MM-DD'),''),
        'installationDates',to_jsonb(coalesce(d.installation_dates,'{}'::date[])),'installationDateOriginal',coalesce(d.installation,''),
        'installedQty',to_jsonb(d.installed_qty),'remainingQty',to_jsonb(d.remaining_qty),'installationStatus',to_jsonb(d.installation_status),
        'lifecycleStatus',d.lifecycle,'lifecycleSource','KHS_SOURCE_RULES'),
    lifecycle_status=d.lifecycle,updated_at=now()
  from derived d where r.id=d.id;
end $migration$;

do $catalog$
declare batch_key constant text:='MTU-BATCH-2024-7b82bcf3f73c66e4';
begin
  if exists(
    with codes as (
      select distinct case when upper(replace(coalesce(r.data->>'mtuCode',''),'-',' ')) like 'SF6 REGULATOR%' then '4190948'
        when upper(btrim(coalesce(r.data->'rawData'->>'BAY',r.data->>'bayName','')))='SPARE' then nullif(s.data->>'noSapCadang','')
        else nullif(s.data->>'noSapStok','') end no_sap
      from public.mtu_khs_records r left join public.mtu_khs_specs s on s.id=r.mtu_spec_id where r.data->'_migration'->>'batchKey'=batch_key
    ) select 1 from codes c join public.katalog k on ltrim(coalesce(k.data->>'katalog',''),'0')=ltrim(c.no_sap,'0') where c.no_sap is not null group by c.no_sap having count(*)>1
  ) then raise exception 'MTU_KATALOG_CODE_AMBIGUOUS'; end if;

  with candidates as (
    select r.id,case when upper(replace(coalesce(r.data->>'mtuCode',''),'-',' ')) like 'SF6 REGULATOR%' then '4190948'
      when upper(btrim(coalesce(r.data->'rawData'->>'BAY',r.data->>'bayName','')))='SPARE' then nullif(s.data->>'noSapCadang','')
      else nullif(s.data->>'noSapStok','') end no_sap,
      case when upper(replace(coalesce(r.data->>'mtuCode',''),'-',' ')) like 'SF6 REGULATOR%' then 'UNIV ACC;SF6 REGULATOR' else coalesce(nullif(s.data->>'description',''),r.data->>'materialName','MTU KHS') end description,
      case when upper(btrim(coalesce(r.data->'rawData'->>'BAY',r.data->>'bayName','')))='SPARE' then 'Cadang' else 'Persediaan' end jenis_barang
    from public.mtu_khs_records r left join public.mtu_khs_specs s on s.id=r.mtu_spec_id where r.data->'_migration'->>'batchKey'=batch_key
  ), usable as (select distinct on(no_sap) no_sap,description,jenis_barang from candidates where no_sap is not null order by no_sap,id)
  insert into public.katalog(id,data,created_at)
  select 'KAT-'||ltrim(no_sap,'0'),jsonb_build_object('id','KAT-'||ltrim(no_sap,'0'),'katalog',ltrim(no_sap,'0'),'name',description,'category','Lainnya','jenisBarang',jenis_barang,'source','MTU_KHS_SPEC','migrationKey','MTU-LIFECYCLE-CATALOG-20260912E'),(extract(epoch from clock_timestamp())*1000)::bigint
  from usable u where not exists(select 1 from public.katalog k where ltrim(coalesce(k.data->>'katalog',''),'0')=ltrim(u.no_sap,'0')) on conflict(id) do nothing;

  with candidates as (
    select r.id,case when upper(replace(coalesce(r.data->>'mtuCode',''),'-',' ')) like 'SF6 REGULATOR%' then '4190948'
      when upper(btrim(coalesce(r.data->'rawData'->>'BAY',r.data->>'bayName','')))='SPARE' then nullif(s.data->>'noSapCadang','')
      else nullif(s.data->>'noSapStok','') end no_sap,
      case when upper(replace(coalesce(r.data->>'mtuCode',''),'-',' ')) like 'SF6 REGULATOR%' then 'UNIV ACC;SF6 REGULATOR' else coalesce(nullif(s.data->>'description',''),r.data->>'materialName') end description,
      case when upper(btrim(coalesce(r.data->'rawData'->>'BAY',r.data->>'bayName','')))='SPARE' then 'Cadang' else 'Persediaan' end catalog_type
    from public.mtu_khs_records r left join public.mtu_khs_specs s on s.id=r.mtu_spec_id where r.data->'_migration'->>'batchKey'=batch_key
  ), resolved as (
    select c.*,k.id katalog_id from candidates c left join public.katalog k on ltrim(coalesce(k.data->>'katalog',''),'0')=ltrim(c.no_sap,'0')
  )
  update public.mtu_khs_records r set katalog_id=x.katalog_id,
    data=r.data||jsonb_build_object('katalogId',x.katalog_id,'catalogNumber',x.no_sap,'materialDescription',x.description,'catalogType',x.catalog_type,
      'catalogWarning',case when x.katalog_id is null then case when upper(coalesce(r.data->>'mtuCode','')) like 'STR%' then 'KATALOG_UNMAPPED_STR' else 'KATALOG_UNMAPPED' end else null end)
  from resolved x where r.id=x.id;

  update public.mtu_khs_import_rows ir set
    normalized_data=normalized_data||jsonb_build_object('katalogId',r.katalog_id,'catalogNumber',r.data->>'catalogNumber','materialDescription',r.data->>'materialDescription','catalogType',r.data->>'catalogType'),
    validation_warnings=case when r.data->>'catalogWarning' is not null then jsonb_build_array(r.data->>'catalogWarning') else '[]'::jsonb end
  from public.mtu_khs_records r where r.data->'_migration'->>'batchKey'=batch_key
    and ir.source_row=(r.data->'_migration'->>'sourceRow')::integer and ir.batch_id=batch_key;
end $catalog$;

do $verify$
begin
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4')<>713 then raise exception 'MTU_2024_RECORD_COUNT'; end if;
  if (select coalesce(sum(qty),0) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4')<>1501 then raise exception 'MTU_2024_QTY'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4' and katalog_id is not null)<>676 then raise exception 'MTU_2024_CATALOG_LINKS'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4' and katalog_id is null)<>37 then raise exception 'MTU_2024_CATALOG_UNMAPPED'; end if;
  if exists(select 1 from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2026-7b82bcf3f73c66e4' and katalog_id is not null) then raise exception 'MTU_2026_CATALOG_CHANGED'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4' and lifecycle_status='INSTALLED')<>265 then raise exception 'MTU_2024_INSTALLED'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4' and lifecycle_status='ON_SITE')<>385 then raise exception 'MTU_2024_ONSITE'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4' and lifecycle_status='PLANNED_ARRIVAL')<>3 then raise exception 'MTU_2024_PLANNED'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2024-7b82bcf3f73c66e4' and lifecycle_status='VENDOR')<>60 then raise exception 'MTU_2024_VENDOR'; end if;
  if (select count(*) from public.mtu_khs_records where data->'_migration'->>'batchKey'='MTU-BATCH-2026-7b82bcf3f73c66e4' and lifecycle_status='PLANNED_ARRIVAL')<>357 then raise exception 'MTU_2026_PLANNED'; end if;
end $verify$;
commit;
