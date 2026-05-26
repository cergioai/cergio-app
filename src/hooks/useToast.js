import { useState, useCallback, useRef } from 'react';

// CERGIO-GUARD: showToast accepts an optional second argument:
//   showToast('Saved ✓')                       // 2.6s default
//   showToast('Couldn't save', { duration: 6000 })
//   showToast('Action needed', { sticky: true }) // stays until dismissed
// Use sticky for actionable errors — the 2.6s default is too short for
// the user to read + react to anything that needs them to do something.
export function useToast() {
  const [toast, setToast] = useState({ msg: '', show: false, sticky: false });
  const timer = useRef(null);

  const showToast = useCallback((msg, opts = {}) => {
    clearTimeout(timer.current);
    const sticky   = !!opts.sticky;
    const duration = Math.max(1500, opts.duration ?? 2600);
    setToast({ msg, show: true, sticky });
    if (!sticky) {
      timer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), duration);
    }
  }, []);

  const dismissToast = useCallback(() => {
    clearTimeout(timer.current);
    setToast(t => ({ ...t, show: false }));
  }, []);

  return { toast, showToast, dismissToast };
}
