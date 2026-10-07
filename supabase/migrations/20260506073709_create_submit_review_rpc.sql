
CREATE OR REPLACE FUNCTION public.submit_review(
  p_ride_id uuid,
  p_reviewee_id uuid,
  p_rating smallint,
  p_comment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ride_status text;
  v_review_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_ride_id IS NULL OR p_reviewee_id IS NULL OR p_rating IS NULL THEN
    RAISE EXCEPTION 'Argumentos invalidos';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'La calificacion debe estar entre 1 y 5';
  END IF;

  IF v_actor = p_reviewee_id THEN
    RAISE EXCEPTION 'No puedes calificarte a ti mismo';
  END IF;

  -- Verify ride is completed
  SELECT r.status INTO v_ride_status
    FROM public.rides r
   WHERE r.ride_id = p_ride_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_ride_status <> 'completed' THEN
    RAISE EXCEPTION 'Solo se pueden calificar viajes completados';
  END IF;

  -- Verify reviewer participated in the ride (as driver or passenger with completed booking)
  IF NOT EXISTS (
    -- Is the driver of this ride
    SELECT 1
      FROM public.driver_profiles dp
      JOIN public.rides rr ON rr.driver_id = dp.driver_id
     WHERE rr.ride_id = p_ride_id
       AND dp.user_id = v_actor
  ) AND NOT EXISTS (
    -- Has a completed booking on this ride
    SELECT 1
      FROM public.bookings b
     WHERE b.ride_id = p_ride_id
       AND b.user_id = v_actor
       AND b.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'No participaste en este viaje';
  END IF;

  -- Verify reviewee participated in the ride
  IF NOT EXISTS (
    SELECT 1
      FROM public.driver_profiles dp
      JOIN public.rides rr ON rr.driver_id = dp.driver_id
     WHERE rr.ride_id = p_ride_id
       AND dp.user_id = p_reviewee_id
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.ride_id = p_ride_id
       AND b.user_id = p_reviewee_id
       AND b.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'La persona a calificar no participo en este viaje';
  END IF;

  -- Upsert review
  INSERT INTO public.ride_reviews (
    ride_id, reviewer_id, reviewee_id, rating, comment
  ) VALUES (
    p_ride_id, v_actor, p_reviewee_id, p_rating, p_comment
  )
  ON CONFLICT (ride_id, reviewer_id, reviewee_id)
  DO UPDATE SET
    rating = EXCLUDED.rating,
    comment = EXCLUDED.comment,
    created_at = now()
  RETURNING review_id INTO v_review_id;

  RETURN v_review_id;
END;
$$;
