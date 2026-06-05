// 5-tab unified nav. Consumer view: Search · Inbox · Earnings · Activity · Profile.
// Provider view: Home · Inbox · Calendar · Earnings · Profile (their outgoing
// spotlight requests live INSIDE Inbox as a second tab, see JobsInboxScreen).
//
// CERGIO-GUARD (2026-06-05 v2): Help removed from the tab bar per Tarik
// ("remove help from nav bar and place alongside company etc in the
// search"). Help now lives as a footer link alongside About · Contact ·
// Terms on Splash/Auth/Home — same destination (/contact), just less
// real estate.
//
// CERGIO-GUARD (2026-06-04 v8): guest-mode teaser. Inbox / Earnings /
// Activity / Profile have nothing to show for a logged-out guest, but
// they still navigate (and the screens have their own "Sign in" cards).
// Adding a tiny lock dot on guest-restricted tabs so the brand signals
// "sign in unlocks this" rather than promising content that's gated.
// Tarik: rigorous UX testing, queued recommendations.
import { useNavigate, useLocation } from 'react-router-dom';
import { useActivityUnread } from '../../hooks/useActivityUnread';

// Tabs that need a real account to be useful — guest sees a small
// lock dot so the brand doesn't promise content it can't show.
const GUEST_GATED = new Set(['inbox', 'earnings', 'activity', 'profile']);

const NAV_CONSUMER = [
  { id: 'search',   label: 'Search',   path: '/home' },
  { id: 'inbox',    label: 'Inbox',    path: '/inbox' },
  { id: 'earnings', label: 'Earnings', path: '/earnings' },
  { id: 'activity', label: 'Activity', path: '/activity' },
  { id: 'profile',  label: 'Profile',  path: '/profile' },
];

const NAV_PROVIDER = [
  { id: 'search',   label: 'Home',     path: '/home' },
  { id: 'inbox',    label: 'Inbox',    path: '/inbox' },
  { id: 'calendar', label: 'Calendar', path: '/calendar' },
  { id: 'earnings', label: 'Earnings', path: '/earnings' },
  { id: 'profile',  label: 'Profile',  path: '/profile' },
];

const ACTIVE_MAP = {
  '/home':              'search',
  '/intake':            'search',
  '/results':           'search',
  '/inbox':             'inbox',
  '/request':           'inbox',
  '/job':               'inbox',
  '/rate':              'inbox',
  '/complete':          'inbox',
  '/share':             'inbox',
  '/profile-shared':    'inbox',
  '/notification':      'inbox',
  '/social-posts':      'inbox',
  '/rainmaker-request': 'inbox',
  '/earnings':          'earnings',
  '/activity':          'activity',
  '/profile':           'profile',
  '/rainmakers':        'profile',
  '/benefits':          'profile',
  '/calendar':          'calendar',
  '/services/manage':   'profile',
  '/services':          'profile',
};

// Longest-prefix match so dynamic segments (/request/:id, /services/:id) still highlight.
function resolveActive(pathname) {
  let best = null;
  for (const key of Object.keys(ACTIVE_MAP)) {
    if (pathname === key || pathname.startsWith(key + '/')) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? ACTIVE_MAP[best] : 'search';
}

const ICONS = {
  search:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>,
  inbox:    () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7"/><path d="M3 7l3-4h12l3 4"/><path d="M3 13h6l1 2h4l1-2h6"/></svg>,
  earnings: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" strokeLinecap="round"/></svg>,
  activity: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M5 21c0-3 3-5 7-5s7 2 7 5"/></svg>,
  calendar: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>,
  profile:  () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>,
};

export function BottomNav({ serviceMode = false, isSignedIn = true }) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = resolveActive(location.pathname);
  const nav = serviceMode ? NAV_PROVIDER : NAV_CONSUMER;
  // CERGIO-GUARD (2026-06-05 v3): unread Activity badge for signed-in
  // users. Hook polls listSocialFeed every 90s and compares the most
  // recent event's `created_at` against the localStorage stamp set
  // by ActivityScreen on mount. Hidden when signed out, when the
  // Activity tab is gated, or when the user is already on /activity.
  const activityUnread = useActivityUnread({ enabled: isSignedIn });

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                 bg-white border-t border-bdr flex items-center px-1 pt-2 pb-4 shadow-up z-50"
    >
      {nav.map(item => {
        const Icon = ICONS[item.id];
        const isActive = active === item.id;
        // CERGIO-GUARD (2026-06-04 v8): guest sees gated tabs dimmed
        // with a tiny lock dot — promise calibrated to what they'll
        // see when they tap (sign-in cue card on the destination).
        const isGated = !isSignedIn && GUEST_GATED.has(item.id);
        const showUnread = item.id === 'activity' && !isGated && !isActive && activityUnread;
        return (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            className={`relative flex-1 flex flex-col items-center gap-1 py-1
                        ${isActive ? 'text-black' : isGated ? 'text-b3/55' : 'text-b3'}`}
            title={isGated ? 'Sign in to unlock' : (showUnread ? 'New activity' : undefined)}
          >
            <Icon />
            {isGated && (
              <span
                aria-hidden="true"
                className="absolute top-0.5 right-1/2 translate-x-3.5 w-3 h-3 rounded-full bg-bg5 border border-bdr flex items-center justify-center"
              >
                <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2"/>
                  <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
                </svg>
              </span>
            )}
            {showUnread && (
              <span
                aria-hidden="true"
                className="absolute top-0.5 right-1/2 translate-x-3.5 w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-white"
              />
            )}
            <span className={`text-[10px] tracking-wide ${isActive ? 'font-extrabold' : 'font-medium'}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
