// ─── PROVIDERS ────────────────────────────────────────────────────────────────
// Later: replace with GET /api/providers?service=&lat=&lng=&budget=
export const PROVIDERS = [
  {
    id: 'jamie-hall',
    name: 'Jamie Hall',
    category: 'Housekeeper',
    bio: 'Post Party Cleaning Specialist · ex 4 Seasons',
    price: 170,
    recos: 111,
    connectors: 21,
    friends: ['Jennifer Hu', '3 other friends'],
    savings: 65,       // vs budget — calculated at runtime in production
    pick: true,
    photoClass: 'fv-jamie',
  },
  {
    id: 'john-ferrari',
    name: 'John Ferrari',
    category: 'Housekeeper',
    bio: 'Experienced apartment & condo cleaner and organizer',
    price: 250,
    recos: 184,
    connectors: 0,
    friends: ['Claudia B', '1 other friend'],
    savings: -15,      // negative = over budget
    pick: false,
    photoClass: 'fv-john',
  },
  {
    id: 'steve-martin',
    name: 'Steve Martin',
    category: 'Housekeeper',
    bio: 'Budget-friendly general cleaning',
    price: 35,
    recos: 31,
    connectors: 0,
    friends: [],
    savings: 200,
    pick: false,
    photoClass: 'fv-steve',
  },
];

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
export const CATEGORIES = [
  { id: 'cleaning', label: 'Cleaning', icon: '🧹' },
  { id: 'handyman', label: 'Handyman', icon: '🔧' },
  { id: 'beauty',   label: 'Beauty',   icon: '💅' },
  { id: 'fitness',  label: 'Fitness',  icon: '💪' },
  { id: 'catering', label: 'Catering', icon: '🍽️' },
  { id: 'events',   label: 'Events',   icon: '🎉' },
  { id: 'tutoring', label: 'Tutoring', icon: '📚' },
];

// ─── FRIEND ACTIVITY ──────────────────────────────────────────────────────────
export const FEED = [
  { id: 1, name: 'Stephanie K.', action: 'booked', service: 'Jamie Hall — Deep Cleaning', time: '2 hours ago', saved: '$85' },
  { id: 2, name: 'Marcus T.',    action: 'booked', service: 'Carlos M. — TV Installation', time: 'Yesterday',  saved: null },
];

// ─── MANAGED SERVICES (provider's listed services) ────────────────────────────
export const MANAGED_SERVICES = {
  unpublished: [
    {
      id: 'svc-u1',
      title: 'Handyman in New York City',
      photoClass: 'fv-john',
      progress: 0.5,
      progressLabel: 'Finish your listing',
      progressSub: 'Your service profile is 50% complete',
    },
  ],
  listed: [
    {
      id: 'svc-l1',
      title: 'Dog Walker in New York City',
      sub: 'Dog walker',
      photoClass: 'fv-steve',
      hourly: '$30 per hour',
      bookings: 14,
      rating: 4.9,
    },
    {
      id: 'svc-l2',
      title: 'Boxing Coach in New York City',
      sub: 'Boxing pro',
      photoClass: 'fv-jamie',
      hourly: '$80 per session',
      bookings: 22,
      rating: 5.0,
    },
  ],
};

// ─── CALENDAR (provider view: dates + bookings) ───────────────────────────────
// Mocked around a "today" anchor. Status: available | request_only | unavailable.
export const CALENDAR_DAYS = [
  { id: '24', month: 'Jun', day: 24, status: 'available',    bookings: 1 },
  { id: '25', month: 'Jun', day: 25, status: 'available',    bookings: 0 },
  { id: '26', month: 'Jun', day: 26, status: 'request_only', bookings: 2 },
  { id: '27', month: 'Jun', day: 27, status: 'unavailable',  bookings: 0 },
  { id: '28', month: 'Jun', day: 28, status: 'available',    bookings: 0 },
  { id: '29', month: 'Jun', day: 29, status: 'available',    bookings: 3 }, // today (active)
  { id: '30', month: 'Jun', day: 30, status: 'available',    bookings: 1 },
  { id: '01', month: 'Jul', day:  1, status: 'request_only', bookings: 0 },
  { id: '02', month: 'Jul', day:  2, status: 'available',    bookings: 2 },
];

// Today's hourly schedule (Jun 29). Slot { hour: 0-23, booking: null | {…} }
export const CALENDAR_BOOKINGS = [
  { hour: 10, title: 'Dog walk — Gerardo Yanez',  duration: 1,   color: 'g' },
  { hour: 13, title: 'Boxing session — Jamie L.', duration: 1,   color: 'gd' },
  { hour: 16, title: 'Handyman — Sara K.',        duration: 2,   color: 'g' },
];

// ─── CONTACTS (for Invite from contacts) ──────────────────────────────────────
export const CONTACTS = [
  { id:'c1',  name:'Angel Smith',    phone:'(367) 434-4200', initial:'A', hasPhoto:true,  avatarBg:'from-[#4478aa] to-[#2a5070]' },
  { id:'c2',  name:'Aaron Cole',     phone:'(367) 434-4201', initial:'A', hasPhoto:false, avatarBg:'from-[#b06090] to-[#703050]' },
  { id:'c3',  name:'Ava Reeves',     phone:'(367) 434-4202', initial:'A', hasPhoto:false, avatarBg:'from-g to-gd' },
  { id:'c4',  name:'Beatrice Lin',   phone:'(367) 434-4203', initial:'B', hasPhoto:true,  avatarBg:'from-[#c07050] to-[#903828]' },
  { id:'c5',  name:'Carlos Mendez',  phone:'(367) 434-4204', initial:'C', hasPhoto:true,  avatarBg:'from-[#885088] to-[#5a3060]' },
  { id:'c6',  name:'Dana Kim',       phone:'(367) 434-4205', initial:'D', hasPhoto:false, avatarBg:'from-[#4478aa] to-[#2a5070]' },
  { id:'c7',  name:'Emily Carter',   phone:'(367) 434-4206', initial:'E', hasPhoto:true,  avatarBg:'from-[#b06090] to-[#703050]' },
  { id:'c8',  name:'Felix Ortega',   phone:'(367) 434-4207', initial:'F', hasPhoto:false, avatarBg:'from-g to-gd' },
  { id:'c9',  name:'Gina Park',      phone:'(367) 434-4208', initial:'G', hasPhoto:true,  avatarBg:'from-[#c07050] to-[#903828]' },
  { id:'c10', name:'Henry Watts',    phone:'(367) 434-4209', initial:'H', hasPhoto:false, avatarBg:'from-[#885088] to-[#5a3060]' },
  { id:'c11', name:'Iris Brennan',   phone:'(367) 434-4210', initial:'I', hasPhoto:true,  avatarBg:'from-[#4478aa] to-[#2a5070]' },
  { id:'c12', name:'Jamie Spears',   phone:'(367) 434-4211', initial:'J', hasPhoto:true,  avatarBg:'from-[#b06090] to-[#703050]' },
  { id:'c13', name:'Jessica Wu',     phone:'(367) 434-4212', initial:'J', hasPhoto:true,  avatarBg:'from-g to-gd' },
  { id:'c14', name:'Kai Mendoza',    phone:'(367) 434-4213', initial:'K', hasPhoto:false, avatarBg:'from-[#c07050] to-[#903828]' },
  { id:'c15', name:'Lydia Park',     phone:'(367) 434-4214', initial:'L', hasPhoto:true,  avatarBg:'from-[#885088] to-[#5a3060]' },
];

// ─── NETWORK EARNINGS (activity feed for Earnings tab) ────────────────────────
export const NETWORK_EARNINGS = [
  { id:'n1', who:'Ricky',   action:'completed a booking with',         what:'Jason, Housekeeper',         amount:'+$25.00', avatarBg:'from-[#4478aa] to-[#2a5070]' },
  { id:'n2', who:'Jamie',   action:'completed a booking with',         what:'Arthur, Hairstylist',         amount:'+$25.00', avatarBg:'from-[#b06090] to-[#703050]' },
  { id:'n3', who:'Jessica', action:'completed a',                       what:'Runner service request',      amount:'+$25.00', avatarBg:'from-[#c07050] to-[#903828]' },
  { id:'n4', who:'Cergio',  action:'added Cergio Coin to your account', what:'',                            amount:'+$25.00', isSystem:true },
  { id:'n5', who:'Tarik',   action:'gifted $25 in',                     what:'Cergio Coin',                 amount:'+$25.00', isSystem:true },
];

// ─── BALANCE BREAKDOWN ────────────────────────────────────────────────────────
export const BREAKDOWN = {
  balance:        '$430',
  balanceUnit:    'RC',
  rows: [
    { label: "Services you've reco'd",  amount: '+ $150.00' },
    { label: "Friends you've invited",  amount: '+ $120.00' },
    { label: 'Your extended network',   amount: '+ $30.00'  },
    { label: 'Cergio Coin spent',       amount: '- $99.58'  },
  ],
  friendsInvited:  17,
  servicesRecoed:  22,
};

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
export const TRANSACTIONS = {
  completed: [
    { id:'t1', name:'Jonathan', date:'May 5, 2026', txnId:'TXN-001A', amount:'$254.00 USD', status:'Paid' },
    { id:'t2', name:'Jonathan', date:'May 1, 2026', txnId:'TXN-002B', amount:'$254.00 USD', status:'Paid' },
    { id:'t3', name:'Jonathan', date:'Apr 28, 2026', txnId:'TXN-003C', amount:'$254.00 USD', status:'Paid' },
    { id:'t4', name:'Jonathan', date:'Apr 25, 2026', txnId:'TXN-004D', amount:'$254.00 USD', status:'In transit (3–5 days)' },
    { id:'t5', name:'Jonathan', date:'Apr 22, 2026', txnId:'TXN-005E', amount:'$254.00 USD', status:'In transit (3–5 days)' },
    { id:'t6', name:'Jonathan', date:'Apr 19, 2026', txnId:'TXN-006F', amount:'$254.00 USD', status:'Paid' },
  ],
  pending: [
    { id:'p1', name:'Marcus T.', date:'May 8, 2026', txnId:'TXN-010A', amount:'$120.00 USD', status:'Awaiting completion' },
  ],
};

// ─── ACTIVITY FEED (Activity tab) ─────────────────────────────────────────────
// Mixed feed: bookings made (consumer), jobs done (provider), Connector shares.
export const ACTIVITY = [
  { id: 'a1', type: 'booked',     title: 'You booked Jamie Hall',           sub: 'Housekeeper · Tomorrow 10:00 AM', time: '2h ago' },
  { id: 'a2', type: 'completed',  title: 'You completed a free service',    sub: 'Earned a 5-star rating from Lydia', time: 'Yesterday' },
  { id: 'a3', type: 'shared',     title: 'Reyna shared your profile',       sub: 'Reached 6,974 followers on Instagram', time: '3 days ago' },
  { id: 'a4', type: 'reco',       title: 'You received a recommendation',   sub: 'Gervon recommended Jamie Hall', time: '4 days ago' },
  { id: 'a5', type: 'invite',     title: 'You invited 1 friend',            sub: 'Sara K. — pending booking', time: '1 week ago' },
];

// ─── EARNINGS DATA (Earnings tab) ─────────────────────────────────────────────
export const EARNINGS_SUMMARY = {
  total:           '$1,240',
  thisMonth:       '$340',
  pending:         '$85',
  cergioCoin:      '$50',
  recentPayouts: [
    { id: 'p1', label: 'Service · Apt clean',     amount: '+$120', date: 'Tue, May 5' },
    { id: 'p2', label: 'Connector referral · Sara', amount: '+$25',  date: 'Mon, May 4' },
    { id: 'p3', label: 'Cergio Coin top-up',      amount: '+$50',  date: 'Sun, May 3' },
  ],
};

// ─── PROFILE (Profile tab) ────────────────────────────────────────────────────
export const PROFILE = {
  name:           'Tarik',
  handle:         '@tarik.s',
  joinedDate:     'May 2026',
  isRainmaker:    false,
  isProvider:     false,
  avatarGradient: 'from-g to-gd',
  initials:       'T',
};

// ─── INBOX REQUESTS ───────────────────────────────────────────────────────────
// Provider-side: incoming Connector requests waiting to be accepted/declined.
// Later: replace with GET /api/jobs/inbox?providerId=
export const INBOX_REQUESTS = [
  {
    id: '1',
    sender: 'Reyna D',
    preview: "Hi Andrea, my name is Gerv. I've been...",
    date: 'Feb 3',
    appointmentTime: 'Tue, Feb 27 — 10:00 AM',
    isFreeForRainmakers: true,
    needsResponse: true,
    isUnread: true,
  },
  {
    id: '2',
    sender: 'Sofia M',
    preview: "Hey! I'd love to feature your cleaning...",
    date: 'Jan 29',
    appointmentTime: 'Fri, Feb 2 — 2:00 PM',
    isFreeForRainmakers: true,
    needsResponse: false,
    isUnread: false,
  },
  {
    id: '3',
    sender: 'Mia K',
    preview: 'Just moved to your area and saw your...',
    date: 'Jan 25',
    appointmentTime: 'Mon, Jan 29 — 9:00 AM',
    isFreeForRainmakers: true,
    needsResponse: true,
    isUnread: true,
  },
  {
    id: '4',
    sender: 'Jess W',
    preview: 'Looking for a one-time deep clean before...',
    date: 'Jan 22',
    appointmentTime: 'Sat, Feb 10 — 11:00 AM',
    isFreeForRainmakers: false,
    needsResponse: false,
    isUnread: false,
  },
];

// ─── RAINMAKER OFFERS ─────────────────────────────────────────────────────────
export const RAINMAKER_OFFERS = [
  {
    id: 'rm-1',
    icon: '🧹',
    title: 'Deep cleaning — Full home',
    desc: 'Get a complete deep clean in exchange for one authentic Instagram post. 3,000+ followers required.',
    posts: 1,
    provider: { name: 'Jamie Hall', category: 'Housekeeper' },
  },
  {
    id: 'rm-2',
    icon: '💅',
    title: 'Luxury nail art session',
    desc: 'Full nail art session worth $120. Share 2 posts tagging the salon. 5,000+ followers required.',
    posts: 2,
    provider: { name: 'Nails by Sofia', category: 'Beauty · Nails' },
  },
  {
    id: 'rm-3',
    icon: '💪',
    title: 'Personal training — 5 sessions',
    desc: '5 personal training sessions ($375 value) for 3 posts documenting your journey. 8,000+ followers required.',
    posts: 3,
    provider: { name: 'FitPro Max', category: 'Fitness · PT' },
  },
];
