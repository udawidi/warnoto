-- Public material QR scan, scoped to the UPT encoded in the label when present.
-- Read-only and deliberately returns a curated payload because this function is
-- callable with the anonymous key.
begin;

create or replace function public.public_material_scan(p_katalog_id text, p_upt_id text default null)
returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  with
  params as (
    select nullif(btrim(p_katalog_id), '') as katalog_id,
           nullif(btrim(p_upt_id), '') as upt_id
  ),
  kat as (
    select k.id, k.data
    from public.katalog k, params p
    where k.id = p.katalog_id
    limit 1
  ),
  stock_base as (
    select s.id, s.katalog_id, s.upt_id as explicit_upt_id,
           nullif(g.upt_id, '') as location_upt_id,
           coalesce(nullif(s.upt_id, ''), nullif(g.upt_id, '')) as effective_upt_id,
           case when coalesce(s.data->>'qty', '') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$'
             then (s.data->>'qty')::numeric else 0 end as qty,
           s.lokasi_id,
           g.id as gudang_id, g.data as gudang_data,
           sg.data as subgudang_data, l.data as lokasi_data
    from public.stocks s
    left join public.lokasi l on l.id = s.lokasi_id
    left join public.gudang g on g.id = l.gudang_id
    left join public.sub_gudang sg on sg.id = nullif(l.data->>'subGudangId', '') and sg.gudang_id = g.id
    join params p on p.katalog_id = s.katalog_id
    where nullif(s.upt_id, '') is null or nullif(g.upt_id, '') is null or nullif(s.upt_id, '') = nullif(g.upt_id, '')
  ),
  upt_options as (
    select sb.effective_upt_id as id,
           coalesce(nullif(u.data->>'nama', ''), nullif(u.data->>'kode', ''), u.id) as nama
    from stock_base sb
    left join public.upt u on u.id = sb.effective_upt_id
    where sb.effective_upt_id is not null
    group by sb.effective_upt_id, u.id, u.data
  ),
  decision as (
    select case
      when not exists (select 1 from kat) then 'NOT_FOUND'
      when (select count(*) from upt_options) = 0 then 'NOT_FOUND'
      when p.upt_id is not null and not exists (select 1 from upt_options o where o.id = p.upt_id) then 'INVALID_UPT'
      when p.upt_id is null and (select count(*) from upt_options) > 1 then 'SELECT_UPT'
      else 'READY'
    end as status,
    p.upt_id as requested_upt_id
    from params p
  ),
  chosen as (
    select d.status,
      case when d.status = 'READY' then coalesce(
        d.requested_upt_id,
        (select o.id from upt_options o limit 1)
      ) end as upt_id
    from decision d
  ),
  scoped_stock as (
    select sb.*
    from stock_base sb, chosen c
    where c.status = 'READY' and c.upt_id is not null and sb.effective_upt_id = c.upt_id
  ),
  location_rows as (
    select ss.gudang_id,
           ss.lokasi_id,
           coalesce(nullif(ss.gudang_data->>'nama', ''), nullif(ss.gudang_data->>'kode', ''), ss.gudang_id) as gudang,
           coalesce(nullif(ss.subgudang_data->>'nama', ''), nullif(ss.subgudang_data->>'kode', ''), '') as "subGudang",
           coalesce(nullif(ss.lokasi_data->>'kode', ''), nullif(ss.lokasi_data->>'nama', ''), ss.lokasi_id) as blok,
           sum(ss.qty) as qty
    from scoped_stock ss
    where ss.lokasi_id is not null and ss.gudang_id is not null and ss.lokasi_data is not null
    group by ss.gudang_id, ss.lokasi_id, ss.gudang_data, ss.subgudang_data, ss.lokasi_data
    having sum(ss.qty) > 0
  ),
  history_rows as (
    select h.id, h.tanggal, h.jenis_transaksi, h.qty, h.lokasi_kode,
           h.doc_type, h.no_bon, h.catatan,
           (coalesce((select sum(ss.qty) from scoped_stock ss), 0)
            - coalesce(sum(case when h.jenis_transaksi = 'MASUK' then h.qty else -h.qty end)
                over (order by h.tanggal desc, h.id desc rows between unbounded preceding and 1 preceding), 0)) as sisa
    from public.tug15_history h
    join public.lokasi l on l.id = h.lokasi_id
    join public.gudang g on g.id = l.gudang_id
    join chosen c on c.status = 'READY' and g.upt_id = c.upt_id
    join params p on p.katalog_id = h.katalog_id
    where c.upt_id is not null
  )
  select case
    when not exists (select 1 from kat) then jsonb_build_object('status', 'NOT_FOUND')
    else jsonb_build_object(
      'status', c.status,
      'katalog', (select jsonb_build_object(
        'id', k.id,
        'katalog', k.data->>'katalog',
        'name', coalesce(k.data->>'name', k.data->>'nama', '-'),
        'satuan', coalesce(k.data->>'satuan', k.data->>'unit', ''),
        'jenisBarang', coalesce(k.data->>'jenisBarang', ''),
        'merk', coalesce(k.data->>'merk', ''),
        'type', coalesce(k.data->>'type', ''),
        'category', coalesce(k.data->>'category', ''),
        'keterangan', coalesce(k.data->>'keterangan', ''),
        'fotoKeseluruhanUrl', coalesce(k.data->>'fotoKeseluruhanUrl', k.data->>'foto_keseluruhan_url', '')
      ) from kat k),
      'uptOptions', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nama', o.nama) order by o.nama) from upt_options o), '[]'::jsonb),
      'upt', (select jsonb_build_object('id', o.id, 'nama', o.nama) from upt_options o where o.id = c.upt_id),
      'qty', coalesce((select sum(ss.qty) from scoped_stock ss), 0),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('gudang', lr.gudang, 'subGudang', lr."subGudang", 'blok', lr.blok, 'qty', lr.qty) order by lr.gudang, lr."subGudang", lr.blok) from location_rows lr), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('id', hr.id, 'tanggal', hr.tanggal, 'jenis_transaksi', hr.jenis_transaksi, 'qty', hr.qty, 'lokasi_kode', hr.lokasi_kode, 'doc_type', hr.doc_type, 'no_bon', hr.no_bon, 'catatan', hr.catatan, 'sisa', hr.sisa) order by hr.tanggal, hr.id) from history_rows hr), '[]'::jsonb)
    )
  end
  from chosen c;
$$;

revoke all on function public.public_material_scan(text, text) from public;
grant execute on function public.public_material_scan(text, text) to anon, authenticated;
commit;
