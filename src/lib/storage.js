// Client-side helpers for uploading service cover photos to Supabase
// Storage. Caller passes a File (from <input type="file" />) and the
// service UUID; we resize + compress to a sensible web size, push to
// the `service-covers` bucket under `<user_id>/<service_id>/cover.jpg`,
// and return the public URL ready to write into services.cover_url.
//
// CERGIO-GUARD: this is the ONLY upload path for service covers. Don't
// hand-roll bucket calls in screens — go through uploadServiceCover()
// so the bucket name, path scheme, and resize logic stay consistent
// (and the storage RLS migration in 20260527000000 keeps matching the
// path format).

import { supabase, supabaseReady } from './supabase';

const BUCKET = 'service-covers';
const MAX_DIM_PX = 1600;     // cap the longer edge — plenty for cards
const JPEG_QUALITY = 0.85;   // visually indistinguishable from full-q

/**
 * Read a File into an HTMLImageElement so we can draw + resize it.
 * Returns null when the browser can't decode the image (e.g. HEIC on
 * non-Safari).
 */
async function fileToImage(file) {
  if (typeof window === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('decode-failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resize via canvas, return a JPEG Blob. */
async function resizeToBlob(img, maxDim, quality) {
  const { width: w0, height: h0 } = img;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Upload a cover image for a service.
 *
 *   const { url, error } = await uploadServiceCover(file, serviceId)
 *
 * - file:       File from <input type="file"> or drag-drop
 * - serviceId:  UUID of the service the cover belongs to
 *
 * Returns { url, error }. On success, `url` is the public URL you can
 * write straight to services.cover_url. On failure, `error.message`
 * names the problem so the UI can surface it.
 */
export async function uploadServiceCover(file, serviceId) {
  if (!supabaseReady) return { url: null, error: { message: 'Supabase not configured' } };
  if (!file)         return { url: null, error: { message: 'No file selected' } };
  if (!serviceId)    return { url: null, error: { message: 'serviceId required' } };

  // Reject non-image MIME types up front — the canvas trick won't work
  // and we don't want to waste a round-trip on a bad upload.
  if (!file.type.startsWith('image/')) {
    return { url: null, error: { message: 'That file isn\'t an image.' } };
  }

  // Owner check — the RLS policy will reject anyway but a friendlier
  // error here is cheaper than a 401.
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) {
    return { url: null, error: { message: 'Sign in to upload a photo.' } };
  }

  // Resize. If decoding fails (HEIC on non-Safari, broken file, etc.)
  // we fall back to uploading the original — better some image than no
  // image. Storage caps at 5MB on the free tier; we don't enforce here
  // because Supabase will reject with a clear error on the upload.
  let body;
  try {
    const img = await fileToImage(file);
    if (img) {
      const blob = await resizeToBlob(img, MAX_DIM_PX, JPEG_QUALITY);
      body = blob || file;
    } else {
      body = file;
    }
  } catch {
    body = file;
  }

  // Stable filename within the service folder so re-uploads overwrite
  // the previous cover instead of accumulating cruft. `upsert: true`
  // makes the overwrite explicit.
  const path = `${uid}/${serviceId}/cover.jpg`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, {
      cacheControl: '3600',
      contentType:  'image/jpeg',
      upsert:       true,
    });
  if (upErr) return { url: null, error: upErr };

  // Append a cache-buster so the new image immediately replaces the old
  // one in <img src=…> tags. Without this, the previous cover sticks
  // around until the cache TTL expires.
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return { url: null, error: { message: 'Upload succeeded but no public URL returned.' } };
  }
  const url = `${pub.publicUrl}?t=${Date.now()}`;

  return { url, error: null };
}

/** Convenience: upload + immediately write the URL to services.cover_url.
 *  Returns { url, error } from the storage upload AND the DB update
 *  combined — if the upload succeeded but the DB write failed, you'll
 *  still get the url so you can retry the row update. */
export async function uploadAndPersistServiceCover(file, serviceId) {
  const { url, error } = await uploadServiceCover(file, serviceId);
  if (error || !url) return { url, error };

  const { error: dbErr } = await supabase
    .from('services')
    .update({ cover_url: url, updated_at: new Date().toISOString() })
    .eq('id', serviceId);
  return { url, error: dbErr };
}
