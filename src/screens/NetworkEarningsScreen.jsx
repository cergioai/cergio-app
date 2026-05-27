// CERGIO-GUARD: this screen previously rendered the NETWORK_EARNINGS
// mock feed (Sabir / Jackie / Johnathan with fabricated "+$141.52"
// amounts). The route /earnings/network is now redirected at the
// App-level to /earnings (the real ledger). This file is kept as a
// neutered fallback in case anything still imports the component
// directly — it just funnels to /earnings instead of rendering the
// lie. Ship-criteria for restoring the real feature: ROADMAP.md #5.
import { Navigate } from 'react-router-dom';

export function NetworkEarningsScreen() {
  return <Navigate to="/earnings" replace />;
}
