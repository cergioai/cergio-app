// CERGIO-GUARD: this screen previously rendered NETWORK_EARNINGS
// mock feed + BREAKDOWN hardcoded counts (fabricated friend-invite
// rows under a real user's name). The route /earnings/track is now
// redirected at the App-level to /earnings which already shows the
// real invite-kind earnings rows. Component neutered so the mock
// imports can't re-grow. Ship-criteria for the real tracker:
// ROADMAP.md #5.
import { Navigate } from 'react-router-dom';

export function TrackInvitesScreen() {
  return <Navigate to="/earnings" replace />;
}
