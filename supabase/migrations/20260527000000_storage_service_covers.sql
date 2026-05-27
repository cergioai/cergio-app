-- Storage bucket for service cover images. Public-read so the
-- <img cover_url=...> tag works without signed URLs. Write/update/delete
-- restricted by RLS to the owner (path prefix must be the user's UUID).
--
-- Apply once via the Supabase Dashboard SQL editor or the
-- `Run Migrations.command` script. Safe to re-run — every statement
-- is idempotent.

BEGIN;

-- Create the bucket if it doesn't already exist.
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-covers', 'service-covers', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read policy. Anyone (including anonymous) can SELECT objects
-- in this bucket — they're cover photos meant to render on listings.
DROP POLICY IF EXISTS "service-covers public read"
  ON storage.objects;
CREATE POLICY "service-covers public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'service-covers');

-- Insert policy — only authenticated users, and only into a folder
-- named after their own UUID. e.g. <user_id>/service-<svc>/cover.jpg
DROP POLICY IF EXISTS "service-covers owner insert"
  ON storage.objects;
CREATE POLICY "service-covers owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'service-covers'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update policy — same ownership check.
DROP POLICY IF EXISTS "service-covers owner update"
  ON storage.objects;
CREATE POLICY "service-covers owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'service-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete policy — same.
DROP POLICY IF EXISTS "service-covers owner delete"
  ON storage.objects;
CREATE POLICY "service-covers owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'service-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
