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
