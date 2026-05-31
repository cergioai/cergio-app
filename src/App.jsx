import { useState, useCallback, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useLocation,
  useOutletContext,
} from 'react-router-dom';

import { useToast }   from './hooks/useToast';
import { useChat }    from './hooks/useChat';
import { useSession } from './hooks/useSession';
import { captureRefFromUrl, creditInviterOnFirstBooking } from './lib/referral';

import { BottomNav }    from './components/ui/BottomNav';
import { Toast }        from './components/ui/Toast';
import { SetupCheckBanner } from './components/ui/SetupCheckBanner';
import { PaymentSheet } from './components/ui/PaymentSheet';
import { BuildVersionPill } from './components/ui/BuildVersionPill';

import { SplashScreen }     from './screens/SplashScreen';
import { OnboardScreen }    from './screens/OnboardScreen';
import { HomeScreen }       from './screens/HomeScreen';
import { IntakeScreen }     from './screens/IntakeScreen';
import { IntakeFormScreen } from './screens/IntakeFormScreen';
import { ResultsScreen }    from './screens/ResultsScreen';
import { ServiceDetailScreen } from './screens/ServiceDetailScreen';
import { BookingScreen }    from './screens/BookingScreen';
import { RainmakersScreen } from './screens/RainmakersScreen';
import { BrowseConnectorsScreen } from './screens/BrowseConnectorsScreen';
import { ConnectorRequestsScreen } from './screens/ConnectorRequestsScreen';
import { FindFriendsScreen } from './screens/FindFriendsScreen';
import { PrivacyPolicyScreen } from './screens/PrivacyPolicyScreen';
import { DataDeletionScreen } from './screens/DataDeletionScreen';
import { JobsInboxScreen }       from './screens/JobsInboxScreen';
import { ServiceCompleteScreen }  from './screens/ServiceCompleteScreen';
import { SharePromptScreen }      from './screens/SharePromptScreen';
import { FreeBenefitsScreen }     from './screens/FreeBenefitsScreen';
import { RainmakerRequestScreen } from './screens/RainmakerRequestScreen';
import { RequestDetailScreen }    from './screens/RequestDetailScreen';
import { JobDetailsScreen }       from './screens/JobDetailsScreen';
import { RateConfirmScreen }      from './screens/RateConfirmScreen';
import { SocialPostsScreen }      from './screens/SocialPostsScreen';
import { ProfileSharedScreen }    from './screens/ProfileSharedScreen';
import { RecoNotificationScreen } from './screens/RecoNotificationScreen';
import { RainmakerApplyScreen }     from './screens/RainmakerApplyScreen';
import { RainmakerDetailsScreen }   from './screens/RainmakerDetailsScreen';
import { RainmakerInstagramScreen } from './screens/RainmakerInstagramScreen';
import { RainmakerSubmittedScreen } from './screens/RainmakerSubmittedScreen';
import { ServiceListWelcomeScreen }         from './screens/ServiceListWelcomeScreen';
import { ServiceListAboutScreen }           from './screens/ServiceListAboutScreen';
import { ServiceListHourlyOrSessionScreen } from './screens/ServiceListHourlyOrSessionScreen';
import { ServiceListAddOfferingScreen }        from './screens/ServiceListAddOfferingScreen';
import { ServiceListAddSessionOfferingScreen } from './screens/ServiceListAddSessionOfferingScreen';
import { ServiceListAddNewOfferingScreen }     from './screens/ServiceListAddNewOfferingScreen';
import { ServiceListMoreOfferingsScreen }   from './screens/ServiceListMoreOfferingsScreen';
import { ServiceListPhotosIntroScreen }     from './screens/ServiceListPhotosIntroScreen';
import { ServiceListPhotosPickScreen }      from './screens/ServiceListPhotosPickScreen';
import { ServiceListPhotosArrangeScreen }   from './screens/ServiceListPhotosArrangeScreen';
import { ServiceListSetupScreen }           from './screens/ServiceListSetupScreen';
import { ServiceListVerifyScreen }          from './screens/ServiceListVerifyScreen';
import { EnableFreeOffersPopupScreen }      from './screens/EnableFreeOffersPopupScreen';
import { ConfirmSubmitScreen }              from './screens/ConfirmSubmitScreen';
import { RoamingForOffersScreen }           from './screens/RoamingForOffersScreen';
import { EarningsScreen }                   from './screens/EarningsScreen';
import { ActivityScreen }                   from './screens/ActivityScreen';
import { ProfileScreen }                    from './screens/ProfileScreen';
import { LogoLabScreen }                    from './screens/LogoLabScreen';
import { EarningsBreakdownScreen }          from './screens/EarningsBreakdownScreen';
import { NetworkEarningsScreen }            from './screens/NetworkEarningsScreen';
import { TransactionsScreen }               from './screens/TransactionsScreen';
import { EarnExplainerScreen }              from './screens/EarnExplainerScreen';
import { TrackInvitesScreen }               from './screens/TrackInvitesScreen';
import { InviteFriendPopupScreen }          from './screens/InviteFriendPopupScreen';
import { RecommendServicePopupScreen }      from './screens/RecommendServicePopupScreen';
import { InviteFriendsScreen }              from './screens/InviteFriendsScreen';
import { InviteSelectedReviewScreen }       from './screens/InviteSelectedReviewScreen';
import { RecommendServiceFormScreen }       from './screens/RecommendServiceFormScreen';
import { CalendarScreen }                   from './screens/CalendarScreen';
import { AvailabilityScreen }               from './screens/AvailabilityScreen';
import { ManageServicesScreen }             from './screens/ManageServicesScreen';
import { ServiceDetailProviderScreen }      from './screens/ServiceDetailProviderScreen';
import { AuthScreen }                       from './screens/AuthScreen';
import { MessagesScreen }                   from './screens/MessagesScreen';
import { PublicProfileScreen }              from './screens/PublicProfileScreen';
import { AboutScreen }                      from './screens/AboutScreen';
import { ContactScreen }                    from './screens/ContactScreen';
import { TermsScreen }                      from './screens/TermsScreen';

const HIDE_NAV_PATHS    = ['/', '/onboard', '/auth'];
// CERGIO-GUARD (2026-05-30): /service/ added — the PDP has a fixed-
// bottom "Request {offering} ($N)" button that the BottomNav was
// covering, so users on Tarik's screenshot saw the Book CTA hidden.
// PDP is a focused booking flow anyway; nav is wrong on it.
const HIDE_NAV_PREFIXES = ['/rainmaker/apply', '/list-service', '/invite', '/messages', '/u/', '/service/']; // focused linear flows
const HIDE_NAV_PATHS_EXTRA = [
  '/intake',                          // chat composer at bottom — nav was covering it
  '/intake-form',                     // structured form fallback — same reason
  '/enable-free-offers', '/confirm-submit', '/roaming',
  '/earnings/breakdown', '/earnings/network', '/earnings/transactions',
  '/earnings/how', '/earnings/track',
];

// Re-exported so screens can grab shared state with one named import.
export { useOutletContext };

// ─── Layout: holds chat + toast + booking state, renders BottomNav ──────────
function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const { toast, showToast, dismissToast } = useToast();
  const chat                 = useChat();
  const auth                 = useSession();

  // CERGIO-GUARD: capture ?ref=<inviter_uuid> on first paint and stash it
  // in localStorage with a 30-day TTL. Without this, every invite link
  // shared via Web Share API or the Copy-link button silently fails to
  // attribute. The ref is then read by useSession.signUp() to write
  // the invites row + by the booking flow to credit the inviter on
  // first booking. See src/lib/referral.js.
  useEffect(() => {
    const captured = captureRefFromUrl();
    if (captured && typeof window !== 'undefined') {
      // Strip ?ref= from the URL so it doesn't keep firing on every reload
      // (the localStorage entry is the persistent state).
      const u = new URL(window.location.href);
      u.searchParams.delete('ref');
      const clean = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash;
      try { window.history.replaceState({}, '', clean); } catch { /* ignore */ }
    }
  }, []);
  const [booking, setBooking]           = useState(null);
  const [paymentSheet, setPaymentSheet] = useState(null); // {clientSecret, bookingId, totalCents, providerName} | null
  const [freeServices, setFreeServices] = useState(true); // Connector default
  const [serviceMode, setServiceMode]   = useState(false); // false=consumer, true=provider
  // Default saved address — loaded on sign-in so the chat can pre-fill
  // "your home, right?" and bypass re-typing. Refreshable by screens that
  // save a new address (Profile → manage, IntakeScreen label prompt).
  const [defaultAddress, setDefaultAddress] = useState(null);
  const refreshDefaultAddress = useCallback(async () => {
    if (!auth?.isSignedIn) { setDefaultAddress(null); return; }
    const { getDefaultAddress } = await import('./lib/api');
    const { data } = await getDefaultAddress();
    setDefaultAddress(data || null);
  }, [auth?.isSignedIn]);
  useEffect(() => { refreshDefaultAddress(); }, [refreshDefaultAddress]);
  const [listingDraft, setListingDraft] = useState({
    category: '', location: '', description: '',
    pricingMode: null,            // 'hourly' | 'session'
    offerings: [],
    photoClass: 'fv-jamie',
    // Taxonomy linkage populated by the list-service flow when the
    // provider's typed text resolved through chat-parse with confidence
    // ≥ 0.60. Null when they overrode or we couldn't match — we then
    // mark the matching offering rows with taxonomy_override=true.
    taxonomy_category:      null,
    taxonomy_provider_type: null,
    taxonomy_offering_id:   null,
    // CERGIO-GUARD (2026-05-30): provider-drawn coverage polygon
    // (GeoJSON Polygon). Optional — null means "use the radius default".
    serviceAreaGeoJson:     null,
  });
  const resetListingDraft = useCallback(() => setListingDraft({
    category: '', location: '', description: '',
    pricingMode: null, offerings: [], photoClass: 'fv-jamie',
    taxonomy_category: null, taxonomy_provider_type: null, taxonomy_offering_id: null,
    serviceAreaGeoJson: null,
  }), []);
  const updateListingDraft = useCallback((patch) => setListingDraft(d => ({ ...d, ...patch })), []);
  const addOffering = useCallback((offering) => setListingDraft(d => ({ ...d, offerings: [...d.offerings, offering] })), []);

  // Helper: triggered from Home category/bundle taps. Navigates to /intake
  // and seeds the chat with a pre-filled task.
  const startTask = useCallback((task) => {
    navigate('/intake', { state: { seedTask: task } });
  }, [navigate]);

  // Helper: triggered from Results when the user taps a provider card.
  //
  // Three branches:
  //  (a) Mock/demo provider (no ownerId) → just navigate to /booking, no DB.
  //  (b) Real provider, free Connector booking ($0) → insert booking, mark
  //      confirmed immediately, navigate. Skips Stripe entirely (per Phase B
  //      decision).
  //  (c) Real provider, paid booking → insert booking (pending), open the
  //      PaymentSheet modal. The sheet flips status to 'confirmed' on Stripe
  //      success, then navigates.
  const handleBook = useCallback(async (provider) => {
    // CERGIO-GUARD: BookingScreen used to render hard-coded mock data
    // ("Deep Cleaning / Jamie Hall / Tuesday 2:00 PM / 123 Main St")
    // when fields were missing. A user paying real $$ would see a
    // confirmation screen describing a completely different booking.
    // Fix: pass everything BookingScreen needs from the live chat
    // state + the provider record. Missing fields render as a dash
    // (BookingScreen handles this) — never as fabricated mock data.
    setBooking({
      name:     provider.name,
      price:    `$${provider.price}`,
      service:  provider.title || provider.taxonomy_provider_type || chat?.state?.originalQuery || chat?.state?.what || '',
      when:     chat?.state?.when || '',
      where:    chat?.state?.where || '',
    });

    // (a) Demo path — keep the existing UX where mock cards just navigate.
    if (!provider.ownerId) {
      navigate('/booking');
      return;
    }

    const { createBooking, updateBookingStatus, createPaymentIntent } = await import('./lib/api');

    // Insert booking in pending state.
    const { data: row, error } = await createBooking({
      service:    { id: provider.id, owner_id: provider.ownerId },
      offeringId: provider.offeringId,
      totalCents: provider.priceCents || 0,
      isFreeForRainmaker: !!provider.isFree,
    });
    if (error || !row) {
      showToast(`Booking failed: ${error?.message || 'unknown error'}`);
      return;
    }

    // (b) Free Connector booking — skip payment, confirm directly.
    if (row.is_free_for_rainmaker || (row.total_cents ?? 0) === 0) {
      const { error: confirmErr } = await updateBookingStatus(row.id, 'confirmed');
      if (confirmErr) {
        showToast(`Couldn't confirm booking: ${confirmErr.message}`);
        return;
      }
      // CERGIO-GUARD: if this consumer was invited by someone, credit
      // the inviter on their first booking. Best-effort; failure here
      // doesn't change the booking outcome.
      creditInviterOnFirstBooking(row.consumer_id, row.id).catch(() => {});
      showToast('Booked!');
      navigate('/booking');
      return;
    }

    // (c) Paid booking — fetch a PaymentIntent and open the PaymentSheet.
    // CERGIO-GUARD (2026-05-30): if createPaymentIntent fails (Stripe
    // not configured in test mode), gracefully fall through to a
    // confirmed booking + a "demo mode" toast so the user can still
    // exercise the booking flow end-to-end. Tarik: "offerings on the
    // services should be clickable (and when selected... together
    // with book, it goes to CC form and confirm (currently disabled)".
    // Was previously dead-ending with "Couldn't start payment"; now it
    // confirms + lands on /booking.
    const { data: pi, error: piErr } = await createPaymentIntent(row.id);
    if (piErr || !pi?.client_secret) {
      const { error: confirmErr } = await updateBookingStatus(row.id, 'confirmed');
      if (confirmErr) {
        showToast(`Couldn't confirm booking: ${confirmErr.message}`);
        return;
      }
      creditInviterOnFirstBooking(row.consumer_id, row.id).catch(() => {});
      showToast('Booked (demo mode — no card charged). Finish Stripe setup to take live payments.', { sticky: true });
      navigate('/booking');
      return;
    }
    setPaymentSheet({
      clientSecret: pi.client_secret,
      bookingId:    row.id,
      consumerId:   row.consumer_id,
      totalCents:   row.total_cents,
      providerName: provider.name,
    });
  }, [navigate, showToast]);

  const handlePaymentSuccess = useCallback(() => {
    // CERGIO-GUARD: credit the inviter on the invitee's first paid
    // booking. Reads the booking + consumer from the closed-over sheet
    // state. Best-effort — no UI impact on failure.
    if (paymentSheet?.consumerId) {
      creditInviterOnFirstBooking(paymentSheet.consumerId, paymentSheet.bookingId).catch(() => {});
    }
    setPaymentSheet(null);
    showToast('Payment confirmed!');
    navigate('/booking');
  }, [navigate, showToast, paymentSheet]);

  const handlePaymentCancel = useCallback(() => {
    setPaymentSheet(null);
    // Booking row stays in 'pending' — user can retry from Results or it'll
    // get cleaned up later. For now we just close the sheet.
    showToast('Payment cancelled');
  }, [showToast]);

  const showNav =
    !HIDE_NAV_PATHS.includes(location.pathname) &&
    !HIDE_NAV_PATHS_EXTRA.includes(location.pathname) &&
    !HIDE_NAV_PREFIXES.some(p => location.pathname.startsWith(p));

  return (
    <div className="min-h-screen bg-cr flex items-center justify-center">
      <div className="w-full max-w-[390px] min-h-screen bg-cr flex flex-col relative overflow-hidden">
        {/* Setup-check banner — appears at the top when migrations or
            env vars are missing, with the exact remediation. Dismissible
            per session. CERGIO-GUARD: keep this mounted at root. */}
        <SetupCheckBanner />
        <Outlet
          context={{
            chat,
            showToast,
            booking,
            startTask,
            handleBook,
            freeServices,
            setFreeServices,
            serviceMode,
            setServiceMode,
            auth,
            defaultAddress,
            refreshDefaultAddress,
            listingDraft, updateListingDraft, addOffering, resetListingDraft,
          }}
        />

        {showNav && <BottomNav serviceMode={serviceMode} />}
        <Toast msg={toast.msg} show={toast.show} sticky={toast.sticky} onDismiss={dismissToast} />
        {/* CERGIO-GUARD: build version pill — shows current short SHA
            so HMR-stale-closure bugs are immediately observable. */}
        <BuildVersionPill />

        {paymentSheet && (
          <PaymentSheet
            clientSecret={paymentSheet.clientSecret}
            bookingId={paymentSheet.bookingId}
            totalCents={paymentSheet.totalCents}
            providerName={paymentSheet.providerName}
            onSuccess={handlePaymentSuccess}
            onClose={handlePaymentCancel}
          />
        )}
      </div>
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/"            element={<SplashScreen />} />
          <Route path="/onboard"     element={<OnboardScreen />} />
          <Route path="/auth"        element={<AuthScreen />} />
          <Route path="/home"        element={<HomeScreen />} />
          <Route path="/intake"      element={<IntakeScreen />} />
          <Route path="/intake-form" element={<IntakeFormScreen />} />
          <Route path="/results"     element={<ResultsScreen />} />
          <Route path="/service/:serviceId" element={<ServiceDetailScreen />} />
          <Route path="/booking"     element={<BookingScreen />} />
          <Route path="/rainmakers"  element={<RainmakersScreen />} />
          {/* Service-side: providers browse Connectors who set a spotlight
              rate card. Phase 2 will add request + counter-offer flow. */}
          <Route path="/connectors/browse" element={<BrowseConnectorsScreen />} />
          {/* Two-tab inbox for spotlight requests — inbound for Connectors,
              outbound for providers. Counter-offer modal lives inside. */}
          <Route path="/connectors/requests" element={<ConnectorRequestsScreen />} />
          {/* Find friends: phone contacts / Google / share-to-social / search */}
          <Route path="/find-friends" element={<FindFriendsScreen />} />
          {/* Legal pages — required for Meta App Review + Google OAuth verification */}
          <Route path="/privacy"        element={<PrivacyPolicyScreen />} />
          <Route path="/data-deletion"  element={<DataDeletionScreen />} />
          <Route path="/inbox"             element={<JobsInboxScreen />} />
          <Route path="/complete"          element={<ServiceCompleteScreen />} />
          {/* CERGIO-GUARD: /share, /social-posts, /profile-shared,
              /notification are legacy demo routes left over from the
              v1 walkthrough. The screen files still contain hard-coded
              fake-user data (Gervon, Reyna, fabricated follower
              counts). Nothing in the live UI navigates to them, but a
              direct URL hit would render that fake data. We redirect
              to /home instead. Re-enable the routes only after the
              screens are rewritten to read real data. */}
          <Route path="/share"             element={<Navigate to="/home" replace />} />
          <Route path="/benefits"          element={<FreeBenefitsScreen />} />
          <Route path="/rainmaker-request" element={<RainmakerRequestScreen />} />
          <Route path="/request/:id?"      element={<RequestDetailScreen />} />
          <Route path="/job"               element={<JobDetailsScreen />} />
          <Route path="/rate"              element={<RateConfirmScreen />} />
          <Route path="/social-posts"      element={<Navigate to="/home" replace />} />
          <Route path="/profile-shared"    element={<Navigate to="/home" replace />} />
          {/* /notification was rewritten to a clean empty state that
              points users at /inbox; safe to keep the route live. */}
          <Route path="/notification"               element={<RecoNotificationScreen />} />
          <Route path="/rainmaker/apply"             element={<RainmakerApplyScreen />} />
          <Route path="/rainmaker/apply/details"     element={<RainmakerDetailsScreen />} />
          <Route path="/rainmaker/apply/instagram"   element={<RainmakerInstagramScreen />} />
          <Route path="/rainmaker/apply/submitted"   element={<RainmakerSubmittedScreen />} />

          <Route path="/list-service"                   element={<ServiceListWelcomeScreen />} />
          <Route path="/list-service/about"             element={<ServiceListAboutScreen />} />
          <Route path="/list-service/hourly-or-session" element={<ServiceListHourlyOrSessionScreen />} />
          <Route path="/list-service/add-offering"      element={<ServiceListAddOfferingScreen />} />
          <Route path="/list-service/add-session"       element={<ServiceListAddSessionOfferingScreen />} />
          <Route path="/list-service/add-new-offering"  element={<ServiceListAddNewOfferingScreen />} />
          <Route path="/list-service/more-offerings"    element={<ServiceListMoreOfferingsScreen />} />
          <Route path="/list-service/photos-intro"      element={<ServiceListPhotosIntroScreen />} />
          <Route path="/list-service/photos-pick"       element={<ServiceListPhotosPickScreen />} />
          <Route path="/list-service/photos-arrange"    element={<ServiceListPhotosArrangeScreen />} />
          <Route path="/list-service/setup"             element={<ServiceListSetupScreen />} />
          <Route path="/list-service/verify"            element={<ServiceListVerifyScreen />} />

          <Route path="/enable-free-offers" element={<EnableFreeOffersPopupScreen />} />
          <Route path="/confirm-submit"     element={<ConfirmSubmitScreen />} />
          <Route path="/roaming"            element={<RoamingForOffersScreen />} />

          <Route path="/earnings"              element={<EarningsScreen />} />
          <Route path="/earnings/breakdown"    element={<EarningsBreakdownScreen />} />
          {/* CERGIO-GUARD: /earnings/network rendered a NETWORK_EARNINGS
              mock feed with hardcoded names and amounts ($141.52
              duplicates etc.). Nothing in live UI navigates here.
              Redirect to the real /earnings ledger until the screen
              is rewritten to read from getMyEarnings. */}
          <Route path="/earnings/network"      element={<Navigate to="/earnings" replace />} />
          {/* CERGIO-GUARD: /earnings/transactions rendered the mock
              TRANSACTIONS feed with fake names + txn IDs. Only
              reachable from /earnings/track (now redirected) so
              effectively orphan. Redirect to /earnings until a
              real Stripe-backed transactions list ships. */}
          <Route path="/earnings/transactions" element={<Navigate to="/earnings" replace />} />
          <Route path="/earnings/how"          element={<EarnExplainerScreen />} />
          {/* CERGIO-GUARD: /earnings/track rendered the NETWORK_EARNINGS
              mock feed + BREAKDOWN.friendsInvited (hardcoded number).
              A user with $0 real earnings would see imaginary "+$141.52"
              rows under a "Track my invites" headline. Until the screen
              is rewritten to read from the real earnings ledger
              filtered by kind='invite', redirect to /earnings which
              already shows real invite earnings. EarningsBreakdownScreen
              link still works because it lands on a real page. */}
          <Route path="/earnings/track"        element={<Navigate to="/earnings" replace />} />
          <Route path="/invite/friends-popup"  element={<InviteFriendPopupScreen />} />
          <Route path="/invite/recommend-popup" element={<RecommendServicePopupScreen />} />
          <Route path="/invite/friends"        element={<InviteFriendsScreen />} />
          <Route path="/invite/review"         element={<InviteSelectedReviewScreen />} />
          <Route path="/invite/recommend"      element={<RecommendServiceFormScreen />} />
          <Route path="/activity"              element={<ActivityScreen />} />
          <Route path="/profile"               element={<ProfileScreen />} />

          <Route path="/calendar"              element={<CalendarScreen />} />
          <Route path="/calendar/availability" element={<AvailabilityScreen />} />
          <Route path="/services/manage"       element={<ManageServicesScreen />} />
          <Route path="/services/:id"          element={<ServiceDetailProviderScreen />} />
          <Route path="/messages/:id"          element={<MessagesScreen />} />

          {/* CERGIO-GUARD (2026-05-30): public profile view — every
              avatar across the app links here via /u/{profileId}. */}
          <Route path="/u/:profileId"          element={<PublicProfileScreen />} />

          {/* CERGIO-GUARD (2026-05-31): company surfaces — About,
              Contact (single form, ?subject= pre-fills), Terms of
              Use. Reached via the new footer link row on Splash /
              Auth / Home. */}
          <Route path="/about"                 element={<AboutScreen />} />
          <Route path="/contact"               element={<ContactScreen />} />
          <Route path="/terms"                 element={<TermsScreen />} />

          <Route path="/logo-lab"              element={<LogoLabScreen />} />

          <Route path="*"                            element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
