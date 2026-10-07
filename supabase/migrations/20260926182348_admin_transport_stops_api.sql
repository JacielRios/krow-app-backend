create or replace function private.is_current_admin()
returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$$;
revoke all on function private.is_current_admin()
  from public, anon, authenticated;

create or replace function public.admin_upsert_transport_stop(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_stop_id uuid := nullif(p_payload->>'stop_id', '')::uuid;
  v_external_id text := btrim(coalesce(p_payload->>'external_id', ''));
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_address text := nullif(btrim(coalesce(p_payload->>'address', '')), '');
  v_municipality text := nullif(
    btrim(coalesce(p_payload->>'municipality', '')), ''
  );
  v_latitude double precision := (p_payload->>'latitude')::double precision;
  v_longitude double precision := (p_payload->>'longitude')::double precision;
  v_stop_type text := coalesce(p_payload->>'stop_type', 'general');
  v_active boolean := coalesce((p_payload->>'active')::boolean, true);
begin
  if not private.is_current_admin() then
    raise exception 'Acceso administrativo requerido';
  end if;
  if v_external_id = '' or v_name = '' then
    raise exception 'External ID y nombre son requeridos';
  end if;
  if v_latitude not between -90 and 90
     or v_longitude not between -180 and 180 then
    raise exception 'Coordenadas no validas';
  end if;
  if v_stop_type not in ('general', 'official_boarding_zone') then
    raise exception 'Tipo de parada no valido';
  end if;

  if v_stop_id is null then
    insert into public.transport_stops (
      external_id, name, address, municipality,
      latitude, longitude, source, active, stop_type
    ) values (
      v_external_id, v_name, v_address, v_municipality,
      v_latitude, v_longitude, 'krow_admin', v_active, v_stop_type
    )
    returning stop_id into v_stop_id;
  else
    update public.transport_stops
    set external_id = v_external_id,
        name = v_name,
        address = v_address,
        municipality = v_municipality,
        latitude = v_latitude,
        longitude = v_longitude,
        active = v_active,
        stop_type = v_stop_type,
        updated_at = now()
    where stop_id = v_stop_id;
    if not found then raise exception 'Parada no encontrada'; end if;
  end if;
  return v_stop_id;
end;
$$;

revoke all on function public.admin_upsert_transport_stop(jsonb)
  from public, anon;
grant execute on function public.admin_upsert_transport_stop(jsonb)
  to authenticated;
