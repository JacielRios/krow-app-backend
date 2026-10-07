CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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

  IF NOT EXISTS (
    SELECT 1
      FROM public.driver_profiles dp
      JOIN public.rides rr ON rr.driver_id = dp.driver_id
     WHERE rr.ride_id = p_ride_id
       AND dp.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Solo el conductor puede iniciar el viaje';
  END IF;

  IF v_prev = 'in_progress' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.ride_id = p_ride_id
       AND b.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Se requiere al menos una reserva confirmada';
  END IF;

  PERFORM public.validate_ride_transition(v_prev, 'in_progress');

  UPDATE public.rides SET status = 'in_progress' WHERE ride_id = p_ride_id;

  UPDATE public.bookings b
     SET status = 'rejected'
   WHERE b.ride_id = p_ride_id
     AND b.status = 'pending';

  INSERT INTO public.chats AS c (ride_id)
  VALUES (p_ride_id)
  ON CONFLICT (ride_id) DO NOTHING;

  INSERT INTO public.ride_status_history (
    ride_id,
    status,
    previous_status,
    actor_id,
    reason
  )
  VALUES (p_ride_id, 'in_progress', v_prev, v_actor, NULL);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.complete_stop(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor     uuid := auth.uid();
  v_booking   public.bookings%ROWTYPE;
  v_ride_id   uuid;
  v_prev_ride text;
  v_remain    integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Argumentos invalidos';
  END IF;

  SELECT b.*
    INTO v_booking
    FROM public.bookings b
   WHERE b.booking_id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe';
  END IF;

  v_ride_id := v_booking.ride_id;

  SELECT r.status
    INTO STRICT v_prev_ride
    FROM public.rides r
   WHERE r.ride_id = v_ride_id
     FOR UPDATE;

  SELECT b.*
    INTO v_booking
    FROM public.bookings b
   WHERE b.booking_id = p_booking_id
     FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
      FROM public.driver_profiles dp
      JOIN public.rides rr ON rr.driver_id = dp.driver_id
     WHERE rr.ride_id = v_ride_id
       AND dp.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Solo el conductor puede completar paradas';
  END IF;

  IF v_booking.status = 'completed' THEN
    RETURN;
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'in_progress') THEN
    RAISE EXCEPTION 'Estado de reserva invalido para esta accion';
  END IF;

  PERFORM public.validate_booking_transition(v_booking.status, 'completed');

  UPDATE public.bookings b
     SET status = 'completed'
   WHERE b.booking_id = p_booking_id;

  SELECT COUNT(*)::integer
    INTO v_remain
    FROM public.bookings b
   WHERE b.ride_id = v_ride_id
     AND b.status IN ('confirmed', 'in_progress');

  IF v_remain = 0 THEN
    PERFORM public.validate_ride_transition(v_prev_ride, 'completed');
    UPDATE public.rides SET status = 'completed' WHERE ride_id = v_ride_id;

    INSERT INTO public.ride_status_history (
      ride_id,
      status,
      previous_status,
      actor_id,
      reason
    )
    VALUES (
      v_ride_id,
      'completed',
      v_prev_ride,
      v_actor,
      NULL
    );

    UPDATE public.chats c
       SET closed_at = timezone('utc', now())
     WHERE c.ride_id = v_ride_id
       AND c.closed_at IS NULL;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_ride(
  p_ride_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_prev  text;
  v_seats integer;
  v_hist_reason text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_ride_id IS NULL THEN
    RAISE EXCEPTION 'Argumentos invalidos';
  END IF;

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

  IF NOT EXISTS (
    SELECT 1
      FROM public.driver_profiles dp
      JOIN public.rides rr ON rr.driver_id = dp.driver_id
     WHERE rr.ride_id = p_ride_id
       AND dp.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Solo el conductor puede cancelar el viaje';
  END IF;

  IF v_prev = 'cancelled' THEN
    RETURN;
  END IF;

  PERFORM public.validate_ride_transition(v_prev, 'cancelled');

  SELECT COALESCE(SUM(b.seats_reserved), 0)::integer
    INTO v_seats
    FROM public.bookings b
   WHERE b.ride_id = p_ride_id
     AND b.status = 'confirmed';

  UPDATE public.bookings b
     SET status = 'cancelled'
   WHERE b.ride_id = p_ride_id
     AND b.status IN ('pending', 'confirmed');

  UPDATE public.rides r
     SET status = 'cancelled',
         available_seats = r.available_seats + v_seats
   WHERE r.ride_id = p_ride_id;

  UPDATE public.chats c
     SET closed_at = timezone('utc', now())
   WHERE c.ride_id = p_ride_id
     AND c.closed_at IS NULL;

  v_hist_reason
    := COALESCE(
       NULLIF(btrim(COALESCE(p_reason, '')), ''),
       'ride_cancelled_by_driver'
     );

  INSERT INTO public.ride_status_history (
    ride_id,
    status,
    previous_status,
    actor_id,
    reason
  )
  VALUES (
    p_ride_id,
    'cancelled',
    v_prev,
    v_actor,
    v_hist_reason
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.start_ride(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride(uuid, text) TO authenticated;
