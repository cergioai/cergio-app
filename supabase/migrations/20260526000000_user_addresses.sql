-- THE FIX for address persistence across logins.
--
-- The user_addresses table was defined in db/schema-v5.sql but never made
-- it into supabase/migrations/, so any Supabase project that was set up
-- via `supabase db push --linked` (Run Migrations.command) never got the
-- table created. Every saveAddress() call from the frontend was hitting
-- a non-existent table and the chat-persistence useEffect was silently
-- catching the error — which is exactly why addresses kept "disappearing"
-- after fresh logins despite six rounds of client-side fixes.
--
-- This migration is idempotent — safe to re-run, and safe on environments
-- where the table was already created by hand.

BEGIN;

-- ─── 1. Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_addresses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  label              text NOT NULL,
  formatted_address  text NOT NULL,
  lat                double precision,
  lng                double precision,
  place_id           text,
  is_default         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_addresses_profile_idx
  ON public.user_addresses (profile_id);

CREATE INDEX IF NOT EXISTS user_addresses_place_idx
  ON public.user_addresses (profile_id, place_id);

-- At most one default per user.
CREATE UNIQUE INDEX IF NOT EXISTS user_addresses_one_default
  ON public.user_addresses (profile_id) WHERE is_default = true;

-- ─── 2. RLS — owner only ────────────────────────────────────────────────────
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_addresses_owner_select ON public.user_addresses;
CREATE POLICY user_addresses_owner_select
  ON public.user_addresses FOR SELECT
  USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS user_addresses_owner_insert ON public.user_addresses;
CREATE POLICY user_addresses_owner_insert
  ON public.user_addresses FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS user_addresses_owner_update ON public.user_addresses;
CREATE POLICY user_addresses_owner_update
  ON public.user_addresses FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS user_addresses_owner_delete ON public.user_addresses;
CREATE POLICY user_addresses_owner_delete
  ON public.user_addresses FOR DELETE
  USING (auth.uid() = profile_id);

-- ─── 3. updated_at trigger (function added in v3) ──────────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON public.user_addresses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_addresses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ─── 4. Helper RPC: atomically promote one address to default ──────────────
-- Sets is_default=true on the target row AND clears it on every other row
-- for the same profile. Used by the saveAddress(makeDefault:true) flow.
CREATE OR REPLACE FUNCTION public.set_default_address(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  owner_id uuid;
BEGIN
  SELECT profile_id INTO owner_id
    FROM public.user_addresses
   WHERE id = target_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'address % not found', target_id;
  END IF;
  IF owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your address';
  END IF;

  UPDATE public.user_addresses
     SET is_default = (id = target_id)
   WHERE profile_id = owner_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.set_default_address(uuid) TO authenticated;

COMMIT;
