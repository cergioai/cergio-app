// CERGIO-GUARD: this screen previously rendered the TRANSACTIONS
// mock list (fake names + txn IDs + Paid/In transit statuses).
// /earnings/transactions is redirected at the App-level to
// /earnings. Component neutered so the mock import can't re-grow.
// Ship-criteria for the real Stripe-backed transaction history:
// add listMyTransactions() in lib/api.js + rewrite this screen.
import { Navigate } from 'react-router-dom';

export function TransactionsScreen() {
  return <Navigate to="/earnings" replace />;
}
