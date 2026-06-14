# SVP Flow Map — "Accepting a Free Service Request"  (design-accurate)

**Source of truth:** Figma "Romio – Product File (Fall 2024)" → page *GOAT EXPERIENCE → Free Services*,
SVP Flow column. Read frame-by-frame via Chrome. Layout is solid; **translate old terms when building.**

**Terminology map (apply to every frame):** Romio → **Cergio** · GOAT → **Connector** ·
Go-To / Go-Tos → **Reco'd / Recommendations** · "Free for GOATs" → "Free for Connectors".

**Method per frame:** read Figma → build screen → deploy → screenshot live → put beside the Figma
frame for your approve/redline → **freeze (spec + test)** → **quarantine the duplicates it replaces.**

Legend: ✅ matches · 🟡 built, needs alignment · 🔴 wrong/mock · ⚪ not built yet

---

## The flow (the 6 real frames, left → right)

| # | Figma frame | What it shows | App screen | Status | Gap to close |
|---|---|---|---|---|---|
| 1 | **Jobs (User) – Requests** | Inbox list: Requests/Upcoming/Past tabs, Filter/Status, request row ("{Connector}… Free for Connectors… Needs Response") | `/inbox` JobsInboxScreen | ✅ real data | card opens frame 3 |
| 2 | **"{Connector} wants to market your services"** | Pre-accept intro: who they are, follower reach, "Let's start!" | — | 🔴 **not built** | new screen, or fold into frame 3 top — **your call** |
| 3 | **Message (Essential Details)** | The accept screen: back / {name} / ••• ; Needs Response · View Details; "Housekeeper request"; 🛡 Free for Connectors; job details (rooms/baths/extras + time); approximate map; IG block (handle, followers, photos +more); message; "You'll get free marketing…"; **Accept free request / Decline** | `/inbound/:reqId` RequestFromConnectorScreen | 🟡 built | align header to Figma (••• + "View Details"); IG photo grid (reserved, no Meta media); real map vs card; friends-in-common needs data |
| 4 | **Message (Essential Details)** #2 | Same screen, scrolled / photos expanded — **not a separate screen** | `/inbound/:reqId` (scroll state) | 🟡 | confirm it's just the scrolled state |
| 5 | **Jobs (Service) – Job Details** | After accept: map, "Your earnings: Instagram marketing", requested time, job location, Request Details (rooms/baths/sqft/extras), CTA | `/job` JobDetailsScreen | 🔴 **100% mock** (Jennifer/David/Broadway) | rebuild on the real booking |
| 6 | **Free Service Benefits** + **"Connectors have shared their reco'd services on Cergio to 2M+ followers"** feed | Confirmation / benefits + social-proof feed | `/benefits` + ActivityScreen | ⚪ verify | confirm these are the screens + real data |

*(Adjacent SVP columns mapped, next sprints: **Confirm Instagram Post** → already the SPEC-47 barter loop in `/inbox` Upcoming; **Opt in / out** → not located yet.)*

---

## Quarantine plan — make this repo the source of truth

A `src/_quarantine/` folder. **When a frame's screen is approved + frozen**, the duplicate/corrupted
files it replaces move there and their routes are deleted. A qa test (`#49`) enforces:
**nothing under `src/screens/` or `src/App.jsx` may import from `_quarantine/`.** Quarantined files
stay for reference but can never render.

| Duplicate to quarantine | Why it's spaghetti | Quarantine after… |
|---|---|---|
| PublicProfile `?reqId` sticky bar | old 1-line response surface, now orphaned | frame 3 approved |
| `/request/:id` RequestDetailScreen | parallel request screen (direct bookings) — caused wrong-screen work | you confirm every request is a Connector request (else keep, scoped) |
| `/job` JobDetailsScreen mock | real frame (5) but hardcoded data | after frame 5 rebuilt |
| `/complete` ServiceCompleteScreen mock | fake "rated by Lydia / 23,735" | after frame 6 rebuilt |

---

## 3 decisions that unblock the build

1. **Frame 2** ("{Connector} wants to market your services" intro): build it as its own screen, or fold it into the top of frame 3?
2. **`/request/:id`:** is every request a Connector request (→ quarantine it), or do direct paid bookings still use it (→ keep, scoped)?
3. **Frame 3 header:** match Figma exactly (••• menu + "View Details"), and keep my "See full profile" link, or replace it?

---

## Build order (each: build → live screenshot → approve → freeze → quarantine)

1. **Frame 3** — align `/inbound` to the Figma (header, layout); it's 80% there.
2. **Frame 5** — rebuild `/job` on the real booking (kill the mock).
3. **Frame 6** — confirm + wire benefits/feed on real data.
4. **Frame 2** — build the intro (after decision #1).
5. Quarantine the duplicates as each is approved.

*Verified against the live deploy + Figma this session.*
