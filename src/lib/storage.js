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

/**
 * Upload an optional support screenshot to the `support-screenshots` bucket.
 * Used by the Help widget. Best-effort: if the bucket isn't provisioned yet (or
 * anything fails), we return { url: null, error } and the caller submits the
 * ticket WITHOUT a screenshot (marked as a follow-up) — the text ticket must
 * never be blocked by an image upload.
 *
 *   const { url, error } = await uploadSupportScreenshot(file)
 */
export async function uploadSupportScreenshot(file) {
  if (!supabaseReady) return { url: null, error: { message: 'Supabase not configured' } };
  if (!file)         return { url: null, error: { message: 'No file selected' } };
  if (!file.type?.startsWith('image/')) {
    return { url: null, error: { message: 'That file isn\'t an image.' } };
  }

  // Best-effort resize (same canvas trick as covers); fall back to the original.
  let bodyBlob;
  try {
    const img = await fileToImage(file);
    bodyBlob = img ? (await resizeToBlob(img, MAX_DIM_PX, JPEG_QUALITY)) || file : file;
  } catch { bodyBlob = file; }

  // Namespace by user when signed in, else an anon folder. A timestamp keeps
  // multiple screenshots from colliding.
  const { data: userRes } = await supabase.auth.getUser();
  const uid  = userRes?.user?.id || 'anon';
  const path = `${uid}/${Date.now()}.jpg`;

  const { error: upErr } = await supabase.storage
    .from('support-screenshots')
    .upload(path, bodyBlob, { cacheControl: '3600', contentType: 'image/jpeg', upsert: true });
  if (upErr) return { url: null, error: upErr };

  const { data: pub } = supabase.storage.from('support-screenshots').getPublicUrl(path);
  if (!pub?.publicUrl) return { url: null, error: { message: 'Uploaded but no public URL.' } };
  return { url: pub.publicUrl, error: null };
}

/**
 * FW-18 — service gallery media (photos AND videos on a listed service).
 * Path is `<uid>/<serviceId>/<uuid>-<name>` in the public `service-media`
 * bucket (RLS pins the uid folder prefix). Images go through the same canvas
 * resize as covers; videos upload as-is (the canvas trick can't touch them —
 * Supabase rejects oversize files with a clear error the UI surfaces).
 * On success a `service_media` row records the file so the PDP gallery and
 * the provider's manage list render it in sort_order.
 *
 *   const { row, error } = await uploadServiceMedia(file, serviceId, sortOrder)
 */
export async function uploadServiceMedia(file, serviceId, sortOrder = 0) {
  if (!supabaseReady) return { row: null, error: { message: 'Supabase not configured' } };
  if (!file)          return { row: null, error: { message: 'No file selected' } };
  if (!serviceId)     return { row: null, error: { message: 'serviceId required' } };
  const isVideo = file.type?.startsWith('video/');
  const isImage = file.type?.startsWith('image/');
  if (!isVideo && !isImage) {
    return { row: null, error: { message: 'That file isn\'t a photo or video.' } };
  }
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return { row: null, error: { message: 'Sign in to upload media.' } };

  let body = file;
  let contentType = file.type;
  if (isImage) {
    try {
      const img = await fileToImage(file);
      if (img) {
        const blob = await resizeToBlob(img, MAX_DIM_PX, JPEG_QUALITY);
        if (blob) { body = blob; contentType = 'image/jpeg'; }
      }
    } catch { /* fall through with the original file */ }
  }

  const safeName = (file.name || 'media').replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `${uid}/${serviceId}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from('service-media')
    .upload(path, body, { cacheControl: '3600', contentType, upsert: false });
  if (upErr) return { row: null, error: upErr };

  const { data: row, error: dbErr } = await supabase
    .from('service_media')
    .insert({
      service_id:   serviceId,
      uploader_id:  uid,
      storage_path: path,
      kind:         isVideo ? 'video' : 'image',
      sort_order:   sortOrder,
    })
    .select()
    .single();
  return { row, error: dbErr };
}

/** Public URL for a service_media storage path (bucket is public-read). */
export function serviceMediaPublicUrl(storagePath) {
  if (!supabaseReady || !storagePath) return null;
  const { data } = supabase.storage.from('service-media').getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

/** Delete one gallery item: the storage object AND its service_media row.
 *  RLS enforces ownership on both. */
export async function deleteServiceMedia(row) {
  if (!supabaseReady || !row?.id) return { error: { message: 'Nothing to delete' } };
  await supabase.storage.from('service-media').remove([row.storage_path]);
  const { error } = await supabase.from('service_media').delete().eq('id', row.id);
  return { error };
}

/**
 * PR 5 — request attachments (redesign handoff PATCHES §2). Photos/video a
 * requester attaches to a booking request. Bucket `request-media` is PRIVATE
 * (reads are signed: requester + responding providers per the RLS join on
 * request_responses); path `${uid}/${requestId}/<uuid>-<name>`. Each upload
 * records a request_attachments row (kind + sort_order). Best-effort batch:
 * per-file failures are collected, the successes stand — a broken photo
 * upload must never kill a sent request.
 *
 *   const { uploaded, failed } = await uploadRequestAttachments(files, requestId)
 */
export async function uploadRequestAttachments(files, requestId) {
  if (!supabaseReady || !requestId || !files?.length) return { uploaded: [], failed: [] };
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return { uploaded: [], failed: files.map(f => ({ file: f, message: 'not signed in' })) };

  const uploaded = [], failed = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isVideo = file.type?.startsWith('video/');
    const isImage = file.type?.startsWith('image/');
    if (!isVideo && !isImage) { failed.push({ file, message: 'not a photo or video' }); continue; }

    let body = file;
    let contentType = file.type;
    if (isImage) {
      try {
        const img = await fileToImage(file);
        if (img) {
          const blob = await resizeToBlob(img, MAX_DIM_PX, JPEG_QUALITY);
          if (blob) { body = blob; contentType = 'image/jpeg'; }
        }
      } catch { /* upload the original */ }
    }

    const safeName = (file.name || 'media').replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${uid}/${requestId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from('request-media')
      .upload(path, body, { cacheControl: '3600', contentType, upsert: false });
    if (upErr) { failed.push({ file, message: upErr.message }); continue; }

    const { error: dbErr } = await supabase.from('request_attachments').insert({
      request_id:   requestId,
      uploader_id:  uid,
      storage_path: path,
      kind:         isVideo ? 'video' : 'image',
      sort_order:   i,
    });
    if (dbErr) { failed.push({ file, message: dbErr.message }); continue; }
    uploaded.push(path);
  }
  return { uploaded, failed };
}

/**
 * FW-19 — profile avatar upload (redesign handoff PATCHES §1 upload path).
 * Path is `<uid>/avatar.jpg` in the public `avatars` bucket — the RLS policy
 * (20260805120000_profile_avatars.sql) requires the first folder segment to
 * be the uploader's UUID, and the stable filename means re-uploads overwrite
 * instead of accumulating cruft. On success the public URL (cache-busted) is
 * written to profiles.avatar_url so every Avatar primitive renders it.
 *
 *   const { url, error } = await uploadAndPersistAvatar(file)
 */
export async function uploadAndPersistAvatar(file) {
  if (!supabaseReady) return { url: null, error: { message: 'Supabase not configured' } };
  if (!file)          return { url: null, error: { message: 'No file selected' } };
  if (!file.type?.startsWith('image/')) {
    return { url: null, error: { message: 'That file isn\'t an image.' } };
  }
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return { url: null, error: { message: 'Sign in to upload a photo.' } };

  // Same canvas resize as covers; avatars render ≤100px so 512 is plenty.
  let body;
  try {
    const img = await fileToImage(file);
    body = img ? (await resizeToBlob(img, 512, JPEG_QUALITY)) || file : file;
  } catch { body = file; }

  const path = `${uid}/avatar.jpg`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, body, { cacheControl: '3600', contentType: 'image/jpeg', upsert: true });
  if (upErr) return { url: null, error: upErr };

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  if (!pub?.publicUrl) return { url: null, error: { message: 'Uploaded but no public URL.' } };
  const url = `${pub.publicUrl}?t=${Date.now()}`;

  const { error: dbErr } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', uid);
  return { url, error: dbErr };
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
