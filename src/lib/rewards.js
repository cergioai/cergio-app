// Canonical rewards values + copy. The HERO number is $250 per friend.
// EVERY user-visible mention of invite / refer / connect / spotlight
// rewards MUST come from REWARD_COPY here — do NOT hand-write reward
// copy in screens. This is the single source of truth so the same
// dual-tier story reads consistently across:
//   - Home invite house ad
//   - Earnings empty state + active state
//   - Profile Invite & Earn section
//   - EarnExplainerScreen ("How earnings work")
//   - RainmakerApplyScreen (Become a Connector)
//   - InviteFriendsModal
//   - Reco share cards
//
// The dual-tier model:
//   USER ($250 CREDIT)     · per friend who joins + books · free services credit · Growth Participation Income
//   CONNECTOR ($250 CASH)  · per friend who joins + books · free services (providers pay in spotlights)
//                          · Growth Participation Income — higher score · spotlight rate card
//
// Connector = Influencer (5K+ on IG/TikTok) OR Local business OR Cergio Super User
// (5+ friends invited and booking in 30 days). Strong local network that drives growth.
//
// Jamie example: 50 friends × $250 = $12,500. Compounds when those friends
// recommend services that get booked — those bookings add to your pool too.

export const REWARDS = {
  perFriend:               250,   // dollars — HERO number per friend
  perFriendUser:           250,   // user mode — credit, not cash
  perFriendConnector:      250,   // connector mode — cash payout
  // Detail breakdown surfaced only inside the "How earnings work" panel:
  friendJoinCredit:        25,    // when invited friend signs up
  friendFirstBookingBonus: 125,   // when invited friend completes first booking
  serviceRecoCredit:       100,   // per successful service recommendation that books
  maxPerInvite:            250,   // alias for backwards-compat
  exampleFriends:          50,    // Jamie compounding example
  exampleTotal:            12500, // 50 × $250 = $12,500
};

// ─── Hero one-liners (every CTA pulls from here) ───────────────────────────
export const REWARD_COPY = {
  // Used wherever we mention the dollar amount as a short headline:
  perFriendShort:        `Earn $${REWARDS.perFriend} per friend`,
  perFriendUserShort:    `$${REWARDS.perFriendUser} credit per friend`,
  perFriendConnectorShort: `$${REWARDS.perFriendConnector} cash per friend`,

  // Hero card headlines:
  perFriendHero:         `Refer & earn — $${REWARDS.perFriend} per friend who joins + books`,
  maxPerInviteHero:      `Refer & earn — $${REWARDS.perFriend} per friend`,

  // Recommend (reco) flow:
  recoShort:             `Recommend a service — $${REWARDS.perFriend} per friend who books`,
  recoHero:              `Get $${REWARDS.perFriend} when a friend books from your reco`,

  // Connector unlock:
  connectorUnlockShort:  `Become a Connector — earn cash, not just credit`,
  connectorUnlockSub:    `Influencers + local super-users earn $${REWARDS.perFriendConnector} cash + free services + Growth Participation Income.`,

  // Dual-tier one-liner — use on any side-by-side comparison surface.
  userTierOneLine:       `Users earn $${REWARDS.perFriendUser} credit per friend who joins + books.`,
  connectorTierOneLine:  `Connectors earn $${REWARDS.perFriendConnector} cash + free services + Growth Participation Income + free spotlights (barter).`,

  // Compounding example — use as a single line in marketing/explainer surfaces.
  compoundingExample:    `Bring ${REWARDS.exampleFriends} friends → $${REWARDS.exampleTotal.toLocaleString()}. Your network does the work; you earn the upside.`,

  // Who is a Connector — one line definition.
  connectorWhoOneLine:   `Influencers (5K+ on IG/TikTok) or super-users with strong local networks.`,

  // Growth Participation Income — legally safe one-liner. Never use
  // the words "convert", "stock", "equity", or "shares" — see legal note.
  gpiOneLine:            `Growth Participation Income — your earnings drive a higher participation bonus as Cergio grows. Loyalty-style, not a security.`,

  // Mission tagline — footer / closing line on prosperity-themed surfaces.
  missionLine:           `Cergio's mission: human-powered AI that enables shared prosperity.`,
};
