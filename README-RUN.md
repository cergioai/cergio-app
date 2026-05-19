# Cergio Web App — Delivery 3 (sample re-skin)

This is the merged Cergio app: the **consumer-side** flow (splash → onboard →
home → AI chat → results → booking confirm → Rainmakers info), built on the
new design system (forest green `#1D9E75` + salmon + DM Sans + cream) and
React Router with real URLs.

**Delivery 3 in progress:** the 12 provider/Rainmaker-side screens from
delivery 1 are being re-skinned to the new design language one at a time.
**Currently re-skinned: 1 of 12 — Jobs Inbox.** The other 11 are still
parked under `src/screens-legacy/` and will be done in batches once
Tarik validates the design direction on this first one.

To preview the re-skinned Jobs Inbox: open **http://localhost:5173/inbox**
once the dev server is running. (No nav link to it yet — type the URL
directly. We'll wire navigation properly once more provider screens
are re-skinned.)

---

## Run it locally

Same as before — double-click `Start Cergio.command` in the parent folder,
or:

```bash
cd cergio-app
npm install   # only first time, or after deleting node_modules
npm run dev
```

Open the URL it prints (usually http://localhost:5173).

---

## The active routes

| URL            | Screen              | What it does                                                |
| -------------- | ------------------- | ----------------------------------------------------------- |
| `/`            | Splash              | Logo animation, 2.5s auto-advance to onboard, or tap CTA    |
| `/onboard`     | Onboard             | 3-slide carousel: AI matches, friend trust, Rainmaker pitch |
| `/home`        | Home                | Search bar, service categories, bundles, friend feed        |
| `/intake`      | AI Chat             | Cergio AI asks what you need; parses service/date/budget/address from one message |
| `/results`     | Results             | Provider cards (Cergio Pick + alternates), "wait 24h" deal  |
| `/booking`     | Booking confirmed   | Confirmation summary, share buttons                         |
| `/rainmakers`  | Rainmakers info     | Marketing page for the Rainmaker program                    |
| `/inbox`       | **Jobs Inbox** ✨    | Re-skinned in delivery 3 — provider's view of incoming Rainmaker requests |

The bottom nav (Home · Search · Rainmakers · Profile) is shown on every
screen except Splash and Onboard. Profile is intentionally a "coming soon"
toast for now.

---

## Navigation flows that work

- **Splash → Onboard** (auto after 2.5s, or tap "Get started")
- **Splash → Home** (tap "Continue as guest")
- **Onboard → Home** (tap "Get started" on the last slide, or "Skip")
- **Home tap a service category or bundle → Intake** with that task already pre-filled
- **Home tap the search bar → Intake** (empty)
- **Home tap Rainmaker banner → Rainmakers**
- **Intake AI chat → Results** (after providing service + location, tap "Find my options")
- **Results tap any card OR Book button → Booking confirm**
- **Booking → Home** (either CTA returns home)
- **Bottom nav tabs** — switches between Home, Intake, Rainmakers
- **Back arrow / browser back button** — works on every screen, thanks to React Router

---

## How the AI chat (intake) works

The chatbot is rule-based, not a real LLM yet. `src/hooks/useChat.js`
contains regex-based parsers for service, date, budget, and address. If the
user types one big message like *"need a deep cleaning tomorrow under $200
at my home"*, it extracts all four fields at once and skips ahead.
Otherwise it asks them one by one.

Two required fields: **service** and **address**. The "3 / 3 required"
progress indicator at the top of the chat fills in as fields arrive.

When you click a service category on Home (e.g. "Cleaning"), the chat is
seeded with that service — so it skips the "what" question and asks where.
That's wired through React Router's route state (`navigate('/intake', {
state: { seedTask } })`).

---

## What's NOT in this delivery (saved for delivery 3 and 4)

- **The 12 provider/Rainmaker-side screens** (parked in `src/screens-legacy/`).
  They're still in the lime-green design from delivery 1. Delivery 3 will
  re-skin them to forest green + DM Sans and merge them back in.
- **A canonical Provider data shape** that works for both consumer-side
  (Results) and provider-side (Job Details) screens. Right now the legacy
  screens use a different shape (`recoCount`, `recoLine.lead`, etc.) than
  the consumer-side screens (`recos`, `friends[]`, `bio`, etc.). Delivery 4
  will reconcile.
- **The bridge from Booking confirm → provider-side Job Details.** Once
  the legacy screens are re-skinned, we'll wire the booking flow to hand
  off into the provider's inbox view.
- **Real APIs.** Still using `src/data/mock.js`.

---

## Folder layout

```
cergio-app/
├── package.json
├── vite.config.js
├── tailwind.config.js          ← new design system (g, gd, p, pl, cr…)
├── postcss.config.js
├── index.html
├── README-RUN.md               ← this file
└── src/
    ├── main.jsx
    ├── index.css               ← DM Sans import, splash glow, photo gradients
    ├── App.jsx                 ← BrowserRouter + Layout + 7 routes
    ├── hooks/
    │   ├── useToast.js
    │   └── useChat.js          ← rule-based intake parser
    ├── components/
    │   └── ui/
    │       ├── Logo.jsx        ← animated dual-ring spinner
    │       ├── BottomNav.jsx   ← Home · Search · Rainmakers · Profile
    │       ├── Toast.jsx
    │       └── ProviderCard.jsx
    ├── data/
    │   └── mock.js             ← PROVIDERS, CATEGORIES, FEED, RAINMAKER_OFFERS
    ├── screens/
    │   ├── SplashScreen.jsx
    │   ├── OnboardScreen.jsx
    │   ├── HomeScreen.jsx
    │   ├── IntakeScreen.jsx
    │   ├── ResultsScreen.jsx
    │   ├── BookingScreen.jsx
    │   └── RainmakersScreen.jsx
    │
    ├── screens-legacy/         ← parked: 12 provider-side screens (delivery 3)
    ├── components-legacy/      ← parked: shared components used by legacy screens
    └── data-legacy/            ← parked: old mockData.js
```

---

## What changed since delivery 1

- `Screens ▾` dev-picker overlay is gone — navigation now happens through
  the actual UI (bottom nav, in-screen buttons, browser back).
- Tailwind config completely replaced. Lime green (`cergio-dark #4bab01`)
  is gone; forest green (`g #1D9E75`) is the new primary.
- `useNav` hook from the upload was dropped in favor of React Router URLs.
- All 12 delivery-1 screens are in `screens-legacy/`. They still compile
  if imported, but nothing imports them right now.
