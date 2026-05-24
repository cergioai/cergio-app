// Inline badge that surfaces what the taxonomy resolver thinks about the
// provider's typed service / offering name. Three states:
//   - hidden       (input empty or too short — nothing to show yet)
//   - resolving    (we're calling the edge function)
//   - matched      (green: "✓ Maps to <name> (<provider_type>)")
//   - new          (amber: "🆕 New offering — we'll review and add it")
//
// Tap the X on the matched badge to "override" — provider can claim this
// is something different. Override flips it to `new` state and we save
// taxonomy_override=true on submit.

export function TaxonomyMatchBadge({ resolving, result, overridden, onOverride, onUndoOverride }) {
  if (resolving && !result) {
    return (
      <p className="text-[11px] text-b3 mt-1.5 leading-snug">
        <span className="inline-block w-2 h-2 bg-bdr rounded-full mr-1.5 animate-pulse" />
        Checking our catalog…
      </p>
    );
  }
  if (!result) return null;

  const showMatched = result.ok && !overridden;
  const showNew = !result.ok || overridden;

  if (showMatched) {
    return (
      <div className="flex items-center gap-2 mt-1.5 bg-gl rounded-pill px-3 py-1.5 w-fit">
        <span className="text-[11px] font-extrabold text-gd flex items-center gap-1">
          <span className="text-[14px]">✓</span>
          Maps to <span className="font-extrabold">{result.offering_name}</span>
          {result.provider_type && (
            <span className="text-gd/70 font-bold">· {result.provider_type}</span>
          )}
        </span>
        {onOverride && (
          <button
            type="button"
            onClick={onOverride}
            className="text-[10px] text-gd/70 font-bold underline underline-offset-2 ml-1"
            aria-label="Override — this is something different"
          >
            Not this
          </button>
        )}
      </div>
    );
  }

  if (showNew) {
    return (
      <div className="mt-1.5 bg-warnBg border border-warn/40 rounded-[10px] px-3 py-2 leading-snug">
        <p className="text-[11px] font-extrabold text-warnText">
          🆕 New offering — we'll review &amp; add it to our catalog
        </p>
        <p className="text-[10px] text-warnText/85 mt-0.5">
          Your listing goes live now. We'll fine-tune the matching so future
          searches find you faster.
        </p>
        {overridden && onUndoOverride && (
          <button
            type="button"
            onClick={onUndoOverride}
            className="text-[10px] text-warnText font-bold underline underline-offset-2 mt-1"
          >
            Undo — use the suggested match
          </button>
        )}
      </div>
    );
  }

  return null;
}
