alter table krow_admin.audit_log drop constraint audit_log_entity_type_check;
alter table krow_admin.audit_log add constraint audit_log_entity_type_check check(entity_type in('driver','vehicle','document','transport_stop','incident'));

create unique index if not exists transport_stops_active_corridor_order_idx
on public.transport_stops(corridor_id,corridor_order) where active and corridor_id is not null;

create or replace function public.admin_upsert_transport_stop(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p_payload->>'stop_id','')::uuid;
  v_previous public.transport_stops%rowtype;
  v_corridor uuid;
  v_order integer;
  v_direction text;
  v_active boolean := coalesce((p_payload->>'active')::boolean,true);
  v_lat double precision := (p_payload->>'latitude')::double precision;
  v_lng double precision := (p_payload->>'longitude')::double precision;
begin
  if not private.is_current_admin() then raise exception 'Acceso administrativo requerido'; end if;
  if v_id is not null then
    select * into v_previous from public.transport_stops where stop_id=v_id for update;
    if not found then raise exception 'Parada no encontrada'; end if;
  end if;
  v_corridor:=case when p_payload ? 'corridor_id' then nullif(p_payload->>'corridor_id','')::uuid else v_previous.corridor_id end;
  v_order:=case when p_payload ? 'corridor_order' then (p_payload->>'corridor_order')::integer else v_previous.corridor_order end;
  v_direction:=case when p_payload ? 'direction' then nullif(btrim(p_payload->>'direction'),'') else v_previous.direction end;
  if nullif(btrim(p_payload->>'external_id'),'') is null or nullif(btrim(p_payload->>'name'),'') is null then
    raise exception 'External ID y nombre son requeridos';
  end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then raise exception 'Coordenadas no validas'; end if;
  if coalesce(p_payload->>'stop_type','general') not in ('general','official_boarding_zone') then raise exception 'Tipo de parada no valido'; end if;
  if v_corridor is not null then
    perform 1 from public.transport_corridors where corridor_id=v_corridor and active for share;
    if not found then raise exception 'Selecciona una avenida activa'; end if;
    if v_order is null or v_order not between 1 and 10000 then raise exception 'Indica el orden de la parada en la avenida'; end if;
  else
    v_order:=null;
  end if;
  if not v_active and exists(
    select 1 from public.ride_stops s join public.bookings b on b.pickup_stop_id=s.stop_id or b.dropoff_stop_id=s.stop_id
    join public.rides r on r.ride_id=b.ride_id
    where s.transport_stop_id=v_id and r.status in ('scheduled','full','in_progress') and b.status in ('pending','confirmed','in_progress')
  ) then raise exception 'La parada tiene reservas pendientes. Atiende esos viajes antes de desactivarla'; end if;
  begin
    if v_id is null then
      insert into public.transport_stops(external_id,name,address,municipality,latitude,longitude,source,active,stop_type,corridor_id,corridor_order,direction)
      values(btrim(p_payload->>'external_id'),btrim(p_payload->>'name'),nullif(btrim(p_payload->>'address'),''),nullif(btrim(p_payload->>'municipality'),''),v_lat,v_lng,'krow_admin',v_active,coalesce(p_payload->>'stop_type','general'),v_corridor,v_order,v_direction)
      returning stop_id into v_id;
    else
      update public.transport_stops set external_id=btrim(p_payload->>'external_id'),name=btrim(p_payload->>'name'),address=nullif(btrim(p_payload->>'address'),''),municipality=nullif(btrim(p_payload->>'municipality'),''),latitude=v_lat,longitude=v_lng,active=v_active,stop_type=coalesce(p_payload->>'stop_type','general'),corridor_id=v_corridor,corridor_order=v_order,direction=v_direction,updated_at=now() where stop_id=v_id;
    end if;
  exception when unique_violation then raise exception 'El identificador o el orden de la parada ya están en uso'; end;
  insert into krow_admin.audit_log(actor_id,action,entity_type,entity_id,changes)
  values(auth.uid(),'saved','transport_stop',v_id,jsonb_build_object('before',case when v_previous.stop_id is not null then to_jsonb(v_previous) end,'after',p_payload));
  return v_id;
end;
$$;
revoke all on function public.admin_upsert_transport_stop(jsonb) from public,anon;
grant execute on function public.admin_upsert_transport_stop(jsonb) to authenticated;
