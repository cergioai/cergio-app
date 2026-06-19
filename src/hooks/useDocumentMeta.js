// CERGIO-GUARD (2026-06-19, Tarik — SEO): per-record document metadata for the
// SPA. Sets <title>, description, canonical, and Open Graph / Twitter tags from
// the record being viewed (profiles, services). This is SEO foundation Part 1:
// Googlebot renders JS, so per-page titles/descriptions/canonical materially
// help ranking + give correct browser-tab + in-app-share titles.
//
// Part 2 (separate, build-verified pass): server-side rendering / prerender so
// non-JS social scrapers (Facebook/LinkedIn/iMessage) also get the cards — that
// needs an SSR layer (Vike) and can't be done with client-side tags alone.
//
// Zero deps, idempotent: creates the meta/link tags once, updates them on
// change, and restores the previous <title> on unmount.
import { useEffect } from 'react';

const DEFAULT_TITLE = 'Cergio';
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai';

function setMeta(attr, key, content) {
  if (typeof document === 'undefined') return;
  if (content == null || content === '') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', String(content));
}

function setCanonical(href) {
  if (typeof document === 'undefined' || !href) return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * @param {object} meta
 * @param {string} meta.title       — page title (we append " · Cergio")
 * @param {string} [meta.description]
 * @param {string} [meta.image]     — absolute or relative og:image URL
 * @param {string} [meta.path]      — canonical path (defaults to current)
 * @param {boolean} [meta.ready]    — skip until the record has loaded
 */
export function useDocumentMeta({ title, description, image, path, ready = true } = {}) {
  useEffect(() => {
    if (typeof document === 'undefined' || !ready || !title) return;
    const prevTitle = document.title;
    const fullTitle = `${title} · Cergio`;
    const url = `${ORIGIN}${path || (typeof window !== 'undefined' ? window.location.pathname : '')}`;
    const img = image ? (image.startsWith('http') ? image : `${ORIGIN}${image}`) : null;

    document.title = fullTitle;
    setMeta('name', 'description', description);
    setCanonical(url);
    // Open Graph
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', img);
    setMeta('property', 'og:site_name', 'Cergio');
    // Twitter
    setMeta('name', 'twitter:card', img ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', img);

    return () => { document.title = prevTitle || DEFAULT_TITLE; };
  }, [title, description, image, path, ready]);
}
