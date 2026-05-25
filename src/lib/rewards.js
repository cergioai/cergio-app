// Canonical rewards values. Surface these as constants so the UI never
// disagrees with itself (the old $25 vs $250 mismatch in FindFriends vs
// EarningsScreen lived for too long because copy was hard-coded in three
// different spots).
//
// Reward model:
//   - $25 per friend who SIGNS UP from your invite
//   - $100 per service recommendation that gets BOOKED
//   - +$125 milestone bonus when an invited friend completes their first
//     booking — combined max per friend = $25 + $125 + $100 (if they also
//     become a Provider you recommended) = $250 total potential
// So "Earn up to $250 per invite" is true if you stack all the bonuses,
// while "$25 credit per friend (joins)" is the immediate base. Surface both.
export const REWARDS = {
  friendJoinCredit:        25,    // dollars — when invited friend signs up
  friendFirstBookingBonus: 125,   // dollars — when invited friend completes first booking
  serviceRecoCredit:       100,   // dollars — per successful service recommendation that books
  maxPerInvite:            250,   // dollars — stacked ceiling
};

export const REWARD_COPY = {
  // Used on Invite Friends button row, share buttons, etc — the immediate base.
  friendJoinShort:  `Earn $${REWARDS.friendJoinCredit} per friend who joins`,
  // Used on hero / "Earn up to" callouts — the stacked ceiling.
  maxPerInviteHero: `Earn up to $${REWARDS.maxPerInvite} per invite`,
  // Used on Recommend Service row.
  recoShort:        `Earn $${REWARDS.serviceRecoCredit} per service recommendation`,
};
