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
        ARRAY['in_progress', 'cancelled', 'completed']::text[]
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
