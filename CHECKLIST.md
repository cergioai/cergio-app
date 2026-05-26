# Cergio — Critical-Path Checklist

Run through this list after **any** non-trivial change to Home /
Results / List-Service. These are the surfaces that regressed
repeatedly and the rules that fixed them. Each item has a matching
`CERGIO-GUARD:` comment in the source — search for that string when
touching one of these areas.

---

## 1. Search & SRP

- [ ] Submitting on Home routes to **/results** (not /intake, not /roaming)
      once `chat.phase === 'ready'`.
      _Guard: HomeScreen.jsx near `navigate('/results', …)`_

- [ ] `ResultsScreen` queries Supabase via `listServices()` and
      **never** falls back to the `PROVIDERS` mock array.
      Zero rows → **EmptyState** block, not fake cards.
      _Guard: ResultsScreen.jsx top of file + near `providers = …`._

- [ ] Status reel on Results uses the **shared LeafLogo with
      `working={true}`** — not a spinner, not the legacy `Logo`
      component.

- [ ] Title is neutral (`Showing N matches` / `Here are your matches`).
      Never `"… providers providers"` or any taxonomy noun echo.

- [ ] Matching pipeline filters by **all four signals** the user gives:
      category/provider_type/offering_id (taxonomy), distance (proximity
      RPC), **budget**, and **free-only toggle**. The budget pill and
      Free toggle MUST influence what comes back from `listServices` —
      not just the rendering. Previously both were cosmetic.
      _Guard: api.js `applyMatchingFilters` + ResultsScreen passes
      `maxBudgetCents` + `freeOnly` to listServices._

- [ ] Provider cards owned by people the signed-in user follows
      (network table) sort **above** strangers. The "Reco'd by …"
      label MUST match the ordering — if no card has a friend, all
      cards show "No mutual friends yet".
      _Guard: ResultsScreen.jsx `friendOwnerIds` + post-sort `pick`
      reassignment._

- [ ] ProviderCard renders the real `cover_url` image when set;
      falls back to the gradient palette only when no photo exists.
      `listServices` must SELECT `cover_url`.
      _Guard: ProviderCard.jsx + api.js select list._

## 2. Taxonomy is routing-only

- [ ] Chat bot never echoes offering names like _"Drain unclogging ✓"_.
      It only asks the next missing question.
      _Guard: useChat.js `applyParseResult` builds a clean local reply._

- [ ] `provider_type`, `offering_id`, `category` stay in chat state for
      internal routing — never surface in user-visible copy.

- [ ] **List-service** screens (`ServiceListAboutScreen`,
      `ServiceListAddOfferingScreen`, `ServiceListAddNewOfferingScreen`)
      do **not** render `TaxonomyMatchBadge`. The provider's typed text
      is the source of truth. Taxonomy resolves silently for routing.

- [ ] `chatState.originalQuery` is set on the user's first message and
      is the SINGLE source of truth for any user-visible display of the
      service (Results title, share message, "No X yet…" headline).
      Never use parser-derived `what` for display. Cloud parser has been
      observed flipping `"personal chef"` → `"Weekly meal prep service"`
      and `"Spanish-speaking babysitter"` → `"Bundle coordinator"`.
      _Guard: useChat.js INITIAL_STATE + ResultsScreen.jsx `userNoun`._

- [ ] Generic / catch-all `provider_type` values from the parser
      ("service provider", "professional", "expert", "worker", etc.)
      are dropped before display so we never render
      _"Looking for service providers"_ instead of the user's actual ask.
      _Guard: useChat.js `GENERIC_PROVIDER_TYPES` + same set in ResultsScreen._

- [ ] Parser drift: if cloud `parsed.what` shares no meaningful word
      with the user's typed input, prefer the local `SERVICE_MAP` hit
      or null `what` out so display falls back to `originalQuery`.
      _Guard: useChat.js `sharesWordsWith` check._

## 3. Location persistence

- [ ] Saved address (Supabase default OR localStorage) paints **at
      first render** via the `useState` lazy initializer — no flash of
      empty chip for returning users.

- [ ] Address typed without picking a Google Places suggestion still
      persists via the mirror `useEffect` (`locationText` →
      localStorage on every change).

- [ ] On login, if Supabase has no default but localStorage does, we
      promote it to Supabase via `saveAddress(makeDefault: true)`.

- [ ] Chat parser doesn't re-ask "Where?" when `locationText` is set —
      `chat.init` seeds `state.where = defaultAddress`.

- [ ] Google Maps failures are instrumented — `lib/google.js`
      captures `gm_authFailure`, script `onerror`, and geocoder
      `REQUEST_DENIED` / `OVER_QUERY_LIMIT` codes via `recordError()`.
      `SetupCheckBanner` subscribes to `onGoogleMapsStatusChange` and
      surfaces the actual remediation (referrer allowlist, billing,
      Places + Geocoding APIs). NEVER swallow Google errors silently.
      _Guard: lib/google.js + SetupCheckBanner.jsx_

- [ ] `AddressAutocomplete` falls back to Nominatim **at runtime** when
      Google's key is rejected — not just when the key is missing.
      Previously the user got "no autocomplete + cryptic error" if the
      GCP key had referrer / billing / API-enabled issues.
      _Guard: AddressAutocomplete.jsx `googleReady` state._

- [ ] `verifyAddress` falls through to Nominatim when Google fails so
      the user is never locked out of adding an address. Result
      payload carries `verified: 'google' | 'osm'` so callers can
      label / warn.
      _Guard: lib/google.js `verifyAddress`._

## 4. Brand mark

- [ ] **LeafLogo** is the canonical brand mark wherever "Cergio is
      working" or the small logo appears. Do not replace it with the
      legacy spinner `Logo`.

- [ ] Leaf only rotates (`.cg-leaf-think`) while the engine is
      actually searching — not during chat ask phase, not after
      results land.

## 6. List-service flow

- [ ] **Next** on `ServiceListAboutScreen` ALWAYS advances, even when
      the geocode or taxonomy resolver hangs. Each external call is
      raced against a 2s timeout; whatever resolves first wins.
      _Guard: ServiceListAboutScreen.jsx onNext._

- [ ] Service-type quick-suggest chips below the field are
      **provider-type level only** (Plumber / Cleaner / Driver / …),
      never specific offering names (no "Drain unclogging" chips).

- [ ] Address field uses `AddressAutocomplete` (Google Places when
      `VITE_GOOGLE_MAPS_KEY` is set, degrades to a plain text input
      otherwise). The form must still submit cleanly when the key is
      missing.

## 5. Home polish (cosmetic regressions to watch)

- [ ] "Hi, I'm Cergio" toast plays **once per session**
      (sessionStorage `cergio.toastShown`).

- [ ] Example overlays inside the box rotate **once** then freeze on
      the last (3 examples per mode, 6.75s each).

- [ ] Footer tagline `Cergio is human-powered AI for shared prosperity`
      pinned `bottom-[72px] z-[60]` so it never gets hidden under
      BottomNav.

- [ ] Reply input is a **3-row textarea** with `minHeight: 96px`, not
      a single-line input.

- [ ] House ads use the soft `bg-gl` palette, never solid `bg-g` with
      white text.

---

## How the guards work

Critical code paths carry `// CERGIO-GUARD:` comments naming the rule
they enforce. When refactoring:

1. `grep -r "CERGIO-GUARD" cergio-app/src` — list every guard.
2. For each guard your change touches, run through the matching
   bullet above before committing.
3. If a guard rule is genuinely outdated, **update this file in the
   same commit** as the guard removal — never silently drop one.
