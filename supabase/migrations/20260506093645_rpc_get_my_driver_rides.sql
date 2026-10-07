
CREATE OR REPLACE FUNCTION public.get_my_driver_rides(p_limit int DEFAULT 10)
RETURNS TABLE(
  ride_id uuid,
  status text,
  departure_time timestamptz,
  origin_lat numeric,
  origin_lng numeric,
  destination_lat numeric,
  destination_lng numeric,
  origin_address text,
  destination_address text,
  available_seats int,
  price_per_seat numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_driver_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT dp.driver_id INTO v_driver_id
  FROM driver_profiles dp
  WHERE dp.user_id = v_user_id AND dp.status = 'approved'
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN; -- No es conductor, devuelve vacío
  END IF;

  RETURN QUERY
  SELECT r.ride_id, r.status, r.departure_time,
         r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng,
         r.origin_address, r.destination_address,
         r.available_seats, r.price_per_seat
  FROM rides r
  WHERE r.driver_id = v_driver_id
  ORDER BY r.departure_time DESC
  LIMIT p_limit;
END;
$$;
