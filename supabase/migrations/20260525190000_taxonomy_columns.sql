-- Adds the taxonomy_* columns the application has been writing to all
-- along but were never created in the live schema. The
-- ServiceListSetup → publish flow was failing with
--   "Could not find the 'taxonomy_category' column of 'services' in
--    the schema cache"
-- because the client tried to write these columns and Postgres
-- couldn't see them.
--
-- The application code in src/lib/api.js (createService) now retries
-- without the taxonomy_* columns when the schema doesn't have them, so
-- this migration is the "do-it-right" companion: once applied, the
-- taxonomy fields persist and taxonomy-based routing/filtering on the
-- SRP starts working again.

BEGIN;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS taxonomy_category      text,
  ADD COLUMN IF NOT EXISTS taxonomy_provider_type text,
  ADD COLUMN IF NOT EXISTS taxonomy_offering_id   text;

ALTER TABLE offerings
  ADD COLUMN IF NOT EXISTS taxonomy_offering_id text,
  ADD COLUMN IF NOT EXISTS taxonomy_override    boolean DEFAULT false;

-- Indexes for the most-used filter paths in listServices().
CREATE INDEX IF NOT EXISTS services_taxonomy_offering_id_idx
  ON services (taxonomy_offering_id);
CREATE INDEX IF NOT EXISTS services_taxonomy_provider_type_idx
  ON services (taxonomy_provider_type);
CREATE INDEX IF NOT EXISTS offerings_taxonomy_offering_id_idx
  ON offerings (taxonomy_offering_id);

COMMIT;
