CREATE OR REPLACE FUNCTION public.update_booking_status(
  p_booking_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_booking   public.bookings%ROWTYPE;
  v_ride      public.rides%ROWTYPE;
  v_prev_ride text;
  v_is_driver boolean;
  v_is_owner  boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_booking_id IS NULL OR p_new_status IS NULL THEN
    RAISE EXCEPTION 'Argumentos invalidos';
  END IF;

  SELECT *
    INTO v_booking
    FROM public.bookings b
   WHERE b.booking_id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe';
  END IF;

  SELECT *
    INTO v_ride
    FROM public.rides r
   WHERE r.ride_id = v_booking.ride_id
     FOR UPDATE;

  SELECT *
    INTO v_booking
    FROM public.bookings b
   WHERE b.booking_id = p_booking_id
     FOR UPDATE;

  IF v_booking.status = p_new_status THEN
    RETURN;
  END IF;

  v_prev_ride := v_ride.status;

  SELECT EXISTS (
           SELECT 1
             FROM public.driver_profiles dp
            WHERE dp.driver_id = v_ride.driver_id
              AND dp.user_id = v_actor
         )
    INTO v_is_driver;

  v_is_owner := v_booking.user_id = v_actor;

  IF NOT (v_is_driver OR v_is_owner) THEN
    RAISE EXCEPTION 'No tienes permiso para modificar esta reserva';
  END IF;

  IF v_is_driver THEN
    IF p_new_status NOT IN ('confirmed', 'rejected') THEN
      RAISE EXCEPTION 'Estado no permitido para el conductor';
    END IF;
  ELSIF p_new_status <> 'cancelled' THEN
    RAISE EXCEPTION 'Solo el pasajero puede cancelar desde el cliente';
  END IF;

  PERFORM public.validate_booking_transition(v_booking.status, p_new_status);

  IF p_new_status = 'confirmed' THEN
    IF v_booking.status <> 'pending' THEN
      RAISE EXCEPTION 'Solo se pueden confirmar reservas pendientes';
    END IF;

    IF v_ride.available_seats < v_booking.seats_reserved THEN
      RAISE EXCEPTION 'Ya no hay suficientes asientos disponibles';
    END IF;

    UPDATE public.bookings b
       SET status = 'confirmed'
     WHERE b.booking_id = p_booking_id;

    UPDATE public.rides r
       SET available_seats = r.available_seats - v_booking.seats_reserved
     WHERE r.ride_id = v_booking.ride_id
    RETURNING * INTO v_ride;

    IF v_ride.available_seats = 0 THEN
      IF v_prev_ride IS DISTINCT FROM 'full' THEN
        PERFORM public.validate_ride_transition(v_prev_ride, 'full');
        UPDATE public.rides r SET status = 'full' WHERE r.ride_id = v_booking.ride_id;
        INSERT INTO public.ride_status_history (
          ride_id,
          status,
          previous_status,
          actor_id,
          reason
        )
        VALUES (
          v_booking.ride_id,
          'full',
          v_prev_ride,
          v_actor,
          p_reason
        );
      END IF;
    END IF;

    RETURN;
  END IF;

  IF p_new_status = 'rejected' THEN
    UPDATE public.bookings b
       SET status = 'rejected'
     WHERE b.booking_id = p_booking_id;
    RETURN;
  END IF;

  IF p_new_status = 'cancelled' THEN
    IF v_booking.status = 'confirmed' THEN
      UPDATE public.rides r
         SET available_seats = r.available_seats + v_booking.seats_reserved
       WHERE r.ride_id = v_booking.ride_id;

      IF v_prev_ride = 'full' THEN
        PERFORM public.validate_ride_transition('full', 'scheduled');
        UPDATE public.rides r
           SET status = 'scheduled'
         WHERE r.ride_id = v_booking.ride_id;
        INSERT INTO public.ride_status_history (
          ride_id,
          status,
          previous_status,
          actor_id,
          reason
        )
        VALUES (
          v_booking.ride_id,
          'scheduled',
          'full',
          v_actor,
          p_reason
        );
      END IF;
    END IF;

    UPDATE public.bookings b
       SET status = 'cancelled'
     WHERE b.booking_id = p_booking_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Estado de destino no soportado';
END;
$$;
