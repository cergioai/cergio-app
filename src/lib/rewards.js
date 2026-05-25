// Canonical rewards values. The HERO number is $250 per friend — that's
// the figure surfaced on every invite / recommend / refer-and-earn CTA.
// The internal $25/$125/$100 breakdown still exists (it's how the $250
// stacks up), but it's only shown in the detail breakdown panel — NOT in
// hero copy. Keeping copy on a single number prevents the $25-vs-$100-vs-$250
// mismatch that lived in too many places.
export const REWARDS = {
  perFriend:               250,   // dollars — HERO number, max per friend
  // Detail breakdown — surface only inside the "How earnings work" panel:
  friendJoinCredit:        25,    // dollars — when invited friend signs up
  friendFirstBookingBonus: 125,   // dollars — when invited friend completes first booking
  serviceRecoCredit:       100,   // dollars — per successful service recommendation that books
  maxPerInvite:            250,   // alias kept for backwards-compat — same as perFriend
};

export const REWARD_COPY = {
  // The ONE phrase used across invite / refer / recommend CTAs.
  perFriendShort:   `Earn $${REWARDS.perFriend} per friend`,
  perFriendHero:    `Refer & earn — $${REWARDS.perFriend} per friend who joins`,
  recoShort:        `Recommend a service — $${REWARDS.perFriend} per friend`,
  maxPerInviteHero: `Refer & earn — $${REWARDS.perFriend} per friend`,
};
