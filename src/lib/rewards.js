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
// (10+ friends booking per month). Strong local network that drives growth.
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
  // 200-friend Connector milestone bonus — independent of per-friend
  // stack; paid as a top-up once you cross the threshold. If we ever
  // change the threshold or the bonus, update both fields together.
  milestoneFriends:        200,
  milestoneBonus:          10000, // dollars on top of per-friend earnings
  // CERGIO-GUARD (2026-05-28): Friend-of-friend bonus — 5% of the
  // per-friend reward. When YOUR invited friend invites ANOTHER
  // friend who joins + books, you get $12.50. Compounds across
  // the network, locks viral momentum. Keep the % in sync with
  // perFriend so the math stays clean if perFriend ever moves.
  friendOfFriendPercent:   5,
  friendOfFriendBonus:     12.5,  // dollars = perFriend × percent / 100
  // CERGIO-GUARD (2026-05-28): Connector barter — providers offer
  // Connectors free services worth this much per month in exchange
  // for IG/TikTok spotlights. The range is canonical: the animation,
  // RainmakerApply, and any barter-themed surface pulls from here so
  // we never hand-write the numbers. Adjust both ends together.
  connectorBarterMin:      1000,
  connectorBarterMax:      10000,
  // CERGIO-GUARD (2026-05-28): Cergio Super User threshold —
  // 10 friends booking per month. This is the social-graph path to
  // Connector status (alongside influencer or local-biz paths).
  superUserFriendsPerMonth: 10,
  // CERGIO-GUARD (2026-05-29): canonical economics — Cergio's platform
  // fee is 10% of every booking. We share 7% with the referrer (the
  // person who invited the booking customer), until they've earned
  // $250 from that friend. Cap window: 6 months from the friend's
  // signup. After that the friend is "settled" — no further per-
  // booking accrual. These three numbers MUST stay in sync with the
  // legal/payments documents — never hardcode them in copy or in the
  // animation. Source of truth, full stop.
  platformFeePercent:      10,
  referrerSharePercent:    7,
  friendCapWindowMonths:   6,
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

  // Friend-of-friend bonus — second-tier kicker that makes the network
  // compound on its own. Same phrasing everywhere it appears so users
  // see one consistent number.
  friendOfFriendOneLine: `Plus ${REWARDS.friendOfFriendPercent}% when your friend invites a friend who joins + books — $${REWARDS.friendOfFriendBonus} per second-tier signup. The chain pays you.`,
  friendOfFriendShort:   `+${REWARDS.friendOfFriendPercent}% ($${REWARDS.friendOfFriendBonus}) when your friends bring in friends`,

  // Connector barter — providers trade free services for IG/TikTok
  // spotlights. Always quoted as a range so users see the upside.
  connectorBarterShort:  `$${(REWARDS.connectorBarterMin/1000)}K–$${(REWARDS.connectorBarterMax/1000)}K/mo in free services`,
  connectorBarterOneLine: `Providers trade $${(REWARDS.connectorBarterMin/1000)}K–$${(REWARDS.connectorBarterMax/1000)}K/month in free services for Instagram + TikTok spotlights — barter, not cash.`,

  // Who is a Connector — one line definition.
  connectorWhoOneLine:   `Influencers (5K+ on IG/TikTok) or super-users with strong local networks.`,

  // Growth Participation Income — legally safe one-liner. Never use
  // the words "convert", "stock", "equity", or "shares" — see legal note.
  gpiOneLine:            `Growth Participation Income — your earnings drive a higher participation bonus as Cergio grows. Loyalty-style, not a security.`,

  // Mission tagline — footer / closing line on prosperity-themed surfaces.
  missionLine:           `Cergio's mission: human-powered AI that enables shared prosperity.`,
};
