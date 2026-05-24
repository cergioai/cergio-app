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

import { BottomNav }    from './components/ui/BottomNav';
import { Toast }        from './components/ui/Toast';
import { PaymentSheet } from './components/ui/PaymentSheet';

import { SplashScreen }     from './screens/SplashScreen';
import { OnboardScreen }    from './screens/OnboardScreen';
import { HomeScreen }       from './screens/HomeScreen';
import { IntakeScreen }     from './screens/IntakeScreen';
import { IntakeFormScreen } from './screens/IntakeFormScreen';
import { ResultsScreen }    from './screens/ResultsScreen';
import { BookingScreen }    from './screens/BookingScreen';
import { RainmakersScreen } from './screens/RainmakersScreen';
import { BrowseConnectorsScreen } from './screens/BrowseConnectorsScreen';
import { ConnectorRequestsScreen } from './screens/ConnectorRequestsScreen';
import { FindFriendsScreen } from './screens/FindFriendsScreen';
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

const HIDE_NAV_PATHS    = ['/', '/onboard', '/auth'];
const HIDE_NAV_PREFIXES = ['/rainmaker/apply', '/list-service', '/invite', '/messages']; // focused linear flows
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

  const { toast, showToast } = useToast();
  const chat                 = useChat();
  const auth                 = useSession();
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
  });
  const resetListingDraft = useCallback(() => setListingDraft({
    category: '', location: '', description: '',
    pricingMode: null, offerings: [], photoClass: 'fv-jamie',
    taxonomy_category: null, taxonomy_provider_type: null, taxonomy_offering_id: null,
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
    setBooking({ name: provider.name, price: `$${provider.price}` });

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
      showToast('Booked!');
      navigate('/booking');
      return;
    }

    // (c) Paid booking — fetch a PaymentIntent and open the PaymentSheet.
    const { data: pi, error: piErr } = await createPaymentIntent(row.id);
    if (piErr || !pi?.client_secret) {
      showToast(`Couldn't start payment: ${piErr?.message || 'unknown error'}`);
      return;
    }
    setPaymentSheet({
      clientSecret: pi.client_secret,
      bookingId:    row.id,
      totalCents:   row.total_cents,
      providerName: provider.name,
    });
  }, [navigate, showToast]);

  const handlePaymentSuccess = useCallback(() => {
    setPaymentSheet(null);
    showToast('Payment confirmed!');
    navigate('/booking');
  }, [navigate, showToast]);

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
        <Toast msg={toast.msg} show={toast.show} />

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
          <Route path="/inbox"             element={<JobsInboxScreen />} />
          <Route path="/complete"          element={<ServiceCompleteScreen />} />
          <Route path="/share"             element={<SharePromptScreen />} />
          <Route path="/benefits"          element={<FreeBenefitsScreen />} />
          <Route path="/rainmaker-request" element={<RainmakerRequestScreen />} />
          <Route path="/request/:id?"      element={<RequestDetailScreen />} />
          <Route path="/job"               element={<JobDetailsScreen />} />
          <Route path="/rate"              element={<RateConfirmScreen />} />
          <Route path="/social-posts"      element={<SocialPostsScreen />} />
          <Route path="/profile-shared"    element={<ProfileSharedScreen />} />
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
          <Route path="/earnings/network"      element={<NetworkEarningsScreen />} />
          <Route path="/earnings/transactions" element={<TransactionsScreen />} />
          <Route path="/earnings/how"          element={<EarnExplainerScreen />} />
          <Route path="/earnings/track"        element={<TrackInvitesScreen />} />
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

          <Route path="*"                            element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
