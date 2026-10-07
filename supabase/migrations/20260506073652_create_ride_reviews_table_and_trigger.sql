
-- Table for ride reviews / ratings
CREATE TABLE public.ride_reviews (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(ride_id),
  reviewer_id uuid NOT NULL REFERENCES public.users(uuid),
  reviewee_id uuid NOT NULL REFERENCES public.users(uuid),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ride_id, reviewer_id, reviewee_id)
);

ALTER TABLE public.ride_reviews ENABLE ROW LEVEL SECURITY;

-- RLS: users can insert their own reviews
CREATE POLICY ride_reviews_insert_own
  ON public.ride_reviews FOR INSERT
  WITH CHECK (reviewer_id = auth.uid());

-- RLS: users can read reviews involving them
CREATE POLICY ride_reviews_select_involved
  ON public.ride_reviews FOR SELECT
  USING (reviewer_id = auth.uid() OR reviewee_id = auth.uid());

-- Index for efficient avg queries
CREATE INDEX idx_ride_reviews_reviewee ON public.ride_reviews(reviewee_id);

-- Trigger function: update users.rating with cumulative average
CREATE OR REPLACE FUNCTION public.update_user_rating_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_avg numeric;
  v_is_driver boolean;
BEGIN
  -- Calculate new average for the reviewee
  SELECT AVG(r.rating)::numeric(3,2)
    INTO v_avg
    FROM public.ride_reviews r
   WHERE r.reviewee_id = NEW.reviewee_id;

  -- Update users.rating
  UPDATE public.users
     SET rating = v_avg,
         updated_at = now()
   WHERE uuid = NEW.reviewee_id;

  -- Check if reviewee is a driver, update driver_profiles.rating too
  SELECT EXISTS (
    SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = NEW.reviewee_id
  ) INTO v_is_driver;

  IF v_is_driver THEN
    UPDATE public.driver_profiles
       SET rating = v_avg
     WHERE user_id = NEW.reviewee_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_user_rating
  AFTER INSERT OR UPDATE ON public.ride_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_rating_on_review();
