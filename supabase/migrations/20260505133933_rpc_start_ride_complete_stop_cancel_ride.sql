CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prev  text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_ride_id IS NULL THEN
    RAISE EXCEPTION 'Argumentos invalidos';
  END IF;

  SELECT status INTO STRICT v_prev FROM public.rides WHERE ride_id = p_ride_id FOR UPDATE;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
END;
$$;
