
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prev  text;
  v_remaining integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_ride_id IS NULL THEN
    RAISE EXCEPTION 'Argumentos invalidos';
  END IF;

  -- Lock the ride row
  BEGIN
    SELECT r.status
      INTO STRICT v_prev
      FROM public.rides r
     WHERE r.ride_id = p_ride_id
       FOR UPDATE;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'El viaje no existe';
  END;

  -- Only driver can complete
  IF NOT EXISTS (
    SELECT 1
      FROM public.driver_profiles dp
      JOIN public.rides rr ON rr.driver_id = dp.driver_id
     WHERE rr.ride_id = p_ride_id
       AND dp.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Solo el conductor puede finalizar el viaje';
  END IF;

  -- Idempotent
  IF v_prev = 'completed' THEN
    RETURN;
  END IF;

  -- Validate transition
  PERFORM public.validate_ride_transition(v_prev, 'completed');

  -- Check remaining active bookings
  SELECT COUNT(*)::integer
    INTO v_remaining
    FROM public.bookings b
   WHERE b.ride_id = p_ride_id
     AND b.status IN ('confirmed', 'in_progress');

  -- Force-complete any remaining active bookings
  IF v_remaining > 0 THEN
    UPDATE public.bookings b
       SET status = 'completed'
     WHERE b.ride_id = p_ride_id
       AND b.status IN ('confirmed', 'in_progress');
  END IF;

  -- Complete the ride
  UPDATE public.rides SET status = 'completed' WHERE ride_id = p_ride_id;

  -- Close chat
  UPDATE public.chats c
     SET closed_at = timezone('utc', now())
   WHERE c.ride_id = p_ride_id
     AND c.closed_at IS NULL;

  -- History
  INSERT INTO public.ride_status_history (
    ride_id, status, previous_status, actor_id, reason
  )
  VALUES (
    p_ride_id, 'completed', v_prev, v_actor, 'manual_complete_by_driver'
  );
END;
$$;
