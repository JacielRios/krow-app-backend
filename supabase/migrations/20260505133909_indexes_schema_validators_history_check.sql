CREATE INDEX IF NOT EXISTS idx_bookings_ride_status
  ON public.bookings(ride_id, status);

CREATE INDEX IF NOT EXISTS idx_rides_driver_status_departure
  ON public.rides(driver_id, status, departure_time);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created
  ON public.chat_messages(chat_id, sent_at);

ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_status_check,
  DROP CONSTRAINT IF EXISTS rides_status_chk,
  ADD CONSTRAINT rides_status_check
    CHECK (
      status = ANY (
        ARRAY[
          'scheduled',
          'full',
          'in_progress',
          'completed',
          'cancelled'
        ]::text[]
      )
    );

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check,
  ADD CONSTRAINT bookings_status_check
    CHECK (
      status = ANY (
        ARRAY[
          'pending',
          'confirmed',
          'rejected',
          'cancelled',
          'in_progress',
          'completed'
        ]::text[]
      )
    );

ALTER TABLE public.ride_status_history
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE public.ride_status_history
  DROP CONSTRAINT IF EXISTS ride_status_history_status_check;

ALTER TABLE public.ride_status_history
  ADD CONSTRAINT ride_status_history_status_check
    CHECK (
      status = ANY (
        ARRAY[
          'created',
          'scheduled',
          'full',
          'in_progress',
          'completed',
          'cancelled'
        ]::text[]
      )
    );

CREATE OR REPLACE FUNCTION public.validate_ride_transition(
  current_status text,
  new_status text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    (
      current_status = 'scheduled'
      AND new_status = ANY (
        ARRAY['full', 'in_progress', 'cancelled']::text[]
      )
    )
    OR (
      current_status = 'full'
      AND new_status = ANY (
        ARRAY['scheduled', 'in_progress', 'cancelled']::text[]
      )
    )
    OR (
      current_status = 'in_progress'
      AND new_status = ANY (
        ARRAY['completed', 'cancelled']::text[]
      )
    )
  ) THEN
    RAISE EXCEPTION 'Transición inválida de ride: % → %',
                  current_status,
                  new_status;
  END IF;
END;
$$;

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

REVOKE ALL ON FUNCTION public.validate_ride_transition(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_booking_transition(text, text) FROM PUBLIC;
