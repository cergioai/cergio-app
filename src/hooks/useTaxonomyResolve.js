// Debounced helper that runs a free-text provider input ("Drain unclog",
// "fix leaks", "wedding planning") through the same chat-parse resolver
// the consumer side uses. Returns the matched taxonomy_offering_id +
// provider_type so the listing flow can save a deterministic taxonomy
// link instead of relying on text-category matching.
//
// Calls are debounced (default 500 ms) and cache-keyed by the latest
// non-empty trimmed input so a single user typing fast doesn't fan out
// into a dozen network calls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveOffering } from '../lib/api';

const DEFAULT_DEBOUNCE_MS = 500;
const MIN_QUERY_LEN = 3;

export function useTaxonomyResolve(input, { debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  const [resolving, setResolving] = useState(false);
  const [result,    setResult]    = useState(null);
  const lastQueryRef = useRef(null);
  const timerRef     = useRef(null);
  const cacheRef     = useRef(new Map());

  // The function the screen calls when it's time to commit (e.g. Next
  // button). Bypasses the debounce so we always have a resolution before
  // the listing draft gets saved.
  const resolveNow = useCallback(async () => {
    const trimmed = (input || '').trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setResult(null);
      return null;
    }
    if (cacheRef.current.has(trimmed)) {
      const cached = cacheRef.current.get(trimmed);
      setResult(cached);
      return cached;
    }
    setResolving(true);
    const { data } = await resolveOffering(trimmed);
    setResolving(false);
    cacheRef.current.set(trimmed, data);
    setResult(data);
    return data;
  }, [input]);

  // Debounced auto-resolve as the user types.
  useEffect(() => {
    const trimmed = (input || '').trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setResult(null);
      return;
    }
    if (lastQueryRef.current === trimmed) return;
    lastQueryRef.current = trimmed;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (cacheRef.current.has(trimmed)) {
        setResult(cacheRef.current.get(trimmed));
        return;
      }
      setResolving(true);
      const { data } = await resolveOffering(trimmed);
      setResolving(false);
      // Bail if the input changed under us — only commit the result for
      // the latest query the user actually typed.
      if (lastQueryRef.current !== trimmed) return;
      cacheRef.current.set(trimmed, data);
      setResult(data);
    }, debounceMs);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [input, debounceMs]);

  return { resolving, result, resolveNow };
}
