-- Extend public block QR payload with canonical SAP status and material type.
begin;

create or replace function public.public_block_stock(p_lokasi_id text, p_token uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select case
    when l.id is null or l.public_token is distinct from p_token then null::jsonb
    else jsonb_build_object(
      'upt', coalesce(u.data->>'nama', u.data->>'kode', u.id),
      'gudang', coalesce(g.data->>'nama', g.data->>'kode', g.id),
      'subgudang', coalesce(sg.data->>'nama', sg.data->>'kode', ''),
      'blok', coalesce(l.data->>'kode', l.data->>'nama', l.id),
      'materials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'katalog', coalesce(k.data->>'katalog', k.data->>'kode', k.id),
          'nama', coalesce(k.data->>'name', k.data->>'nama', '-'),
          'satuan', coalesce(k.data->>'satuan', k.data->>'unit', ''),
          'qty', q.qty,
          'sapLabel', q.sap_label,
          'jenisBarang', q.jenis_barang
        ) order by coalesce(k.data->>'name', k.data->>'nama', k.id))
        from (
          select classified.katalog_id, classified.sap_label, classified.jenis_barang, sum(classified.qty) as qty
          from (
            select s.katalog_id,
              case
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) = 'Non-SAP' then 'Non-SAP'
                when coalesce(nullif(s.data->>'jenisBarang',''), nullif(k0.data->>'jenisBarang','')) = 'Pre Memory' then 'SAP — Pre Memory'
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) in ('SAP — Persediaan','SAP — Cadang') then coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus',''))
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) = 'SAP' then
                  case
                    when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) = 10 then 'SAP — Cadang'
                    when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) between 7 and 8 then 'SAP — Persediaan'
                    else 'SAP — Persediaan'
                  end
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) is null and s.id like 'STK-PREMEM-%' then 'Non-SAP'
                when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) = 10 then 'SAP — Cadang'
                when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) between 7 and 8 then 'SAP — Persediaan'
                else 'Non-SAP'
              end as sap_label,
              coalesce(nullif(s.data->>'jenisBarang',''), nullif(k0.data->>'jenisBarang',''), '-') as jenis_barang,
              case
                when coalesce(s.data->>'qty', '') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$' then (s.data->>'qty')::numeric
                else 0
              end as qty
            from public.stocks s
            join public.katalog k0 on k0.id = s.katalog_id
            where s.lokasi_id = l.id
          ) classified
          group by classified.katalog_id, classified.sap_label, classified.jenis_barang
        ) q
        join public.katalog k on k.id = q.katalog_id
        where q.qty > 0
      ), '[]'::jsonb)
    )
  end
  from public.lokasi l
  left join public.gudang g on g.id = l.gudang_id
  left join public.upt u on u.id = g.upt_id
  left join public.sub_gudang sg on sg.id = nullif(l.data->>'subGudangId', '')
  where l.id = p_lokasi_id;
$$;

revoke all on function public.public_block_stock(text, uuid) from public;
grant execute on function public.public_block_stock(text, uuid) to anon, authenticated;
commit;
