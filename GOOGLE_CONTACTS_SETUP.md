# Connect Gmail (desktop contacts import) — setup

The "Connect Gmail" button on the invite screen imports a user's Google contacts
via the **People API**. It's already built and live, but stays hidden/disabled
until you set one environment variable: `VITE_GOOGLE_CLIENT_ID`.

Until then, desktop users still get the **CSV/vCard upload** fallback, and mobile
users get the **native phone-contact picker** — nothing is broken.

## One-time Google Cloud setup (~10 min)

1. **Google Cloud Console → APIs & Services → Enable APIs** → enable **People API**.
2. **OAuth consent screen**
   - User type: **External**.
   - App name: Cergio. Support email: t@cergio.ai.
   - **Scopes** → add `.../auth/contacts.readonly` (Google marks this *sensitive* — fine for testing; **production needs verification**, same process you're doing for Meta/TikTok).
   - **Test users**: add your test emails so you can use it before verification.
3. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add
     - `https://cergio.ai`
     - `http://localhost:5173` (local dev)
   - (No redirect URI needed — we use the GIS token flow, not a redirect.)
   - Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`).

## Wire it into Cergio

- **Vercel** → Project → Settings → Environment Variables → add
  `VITE_GOOGLE_CLIENT_ID = <your client id>` (Production + Preview) → redeploy.
- **Local** → add the same line to `.env` and restart `vite`.

That's it. On the next deploy the green **Connect Gmail** button activates on
desktop; clicking it opens Google's consent popup, and the user's contacts merge
into the invite picker (real rows only — name/email/phone).

## Notes
- Scope is **read-only** (`contacts.readonly`); Cergio never writes to Google.
- We use the short-lived **GIS token** flow (no refresh tokens stored) — minimal
  surface, no server secrets.
- Production verification: until Google verifies the app, non-test users see an
  "unverified app" screen. Submit for verification when you submit Meta/TikTok.
