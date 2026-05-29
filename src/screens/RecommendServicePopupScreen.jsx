// CERGIO-GUARD (2026-05-29): the old 2-path Recommend popup was confusing
// — Tarik flagged that "Recommend from contacts" sent users to a picker
// that looked like it was asking them to pick a SERVICE, not a recipient.
// The "Write a recommendation" path was redundant.
//
// New model: there is ONE unified Recommend flow at /invite/recommend
// (RecommendServiceFormScreen) that supports both picking from contacts
// AND typing the recipient info manually. This file is kept only as a
// redirect so any deep link or cached URL still works.
import { Navigate } from 'react-router-dom';

export function RecommendServicePopupScreen() {
  return <Navigate to="/invite/recommend" replace />;
}
