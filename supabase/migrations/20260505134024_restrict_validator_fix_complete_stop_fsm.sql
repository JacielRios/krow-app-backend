CREATE OR REPLACE FUNCTION public.validate_booking_transition(
  current_status text,
  new_status text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    (
      current_status = 'pending'
      AND new_status = ANY (
        ARRAY['confirmed', 'rejected', 'cancelled']::text[]
      )
    )
    OR (
      current_status = 'confirmed'
      AND new_status = ANY (
        ARRAY['in_progress', 'cancelled']::text[]
      )
    )
    OR (
      current_status = 'in_progress'
      AND new_status = ANY (
        ARRAY['completed', 'cancelled']::text[]
      )
    )
  ) THEN
    RAISE EXCEPTION 'Transición inválida de booking: % → %',
                  current_status,
                  new_status;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_booking_transition(text, text) FROM PUBLIC;

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

  IF v_booking.status = 'confirmed' THEN
    PERFORM public.validate_booking_transition('confirmed', 'in_progress');
    UPDATE public.bookings b
       SET status = 'in_progress'
     WHERE b.booking_id = p_booking_id;

    SELECT b.*
      INTO v_booking
      FROM public.bookings b
     WHERE b.booking_id = p_booking_id;
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
