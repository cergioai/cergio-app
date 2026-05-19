// ─── Cergio Mock Data ────────────────────────────────────────────────────────
// Swap these out for real API responses. Shape is the contract.

export const providers = [
  {
    id: '1',
    name: 'Jamie Hall',
    category: 'Housekeeper',
    description: 'Post Party Cleaning Specialist · ex 4 Seasons',
    price: 170,
    savings: 65,
    recoCount: 111,
    isCergioPick: true,
    imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&q=80',
    recoLine: { lead: 'Jennifer Hu', otherFriends: 3, rainmakers: 21 },
    avatars: [
      { initials: 'JH', bg: '#c8dff5', color: '#2a6496' },
      { initials: 'SA', bg: '#f5c8c8', color: '#a02020' },
      { initials: 'MK', bg: '#d4f5c8', color: '#20a040' },
    ],
  },
  {
    id: '2',
    name: 'Maria Santos',
    category: 'Housekeeper',
    description: 'Deep clean expert · 6 yrs exp',
    price: 145,
    savings: 40,
    recoCount: 84,
    isCergioPick: false,
    imageUrl: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=300&q=80',
    recoLine: { lead: 'Claudia B', otherFriends: 0, rainmakers: 8 },
    avatars: [
      { initials: 'CL', bg: '#e8d5f5', color: '#6a2a96' },
    ],
  },
  {
    id: '3',
    name: 'Priya Mehta',
    category: 'Housekeeper',
    description: 'Move-in/out specialist · eco products',
    price: 155,
    overBudget: 20,
    recoCount: 62,
    isCergioPick: false,
    imageUrl: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80',
    recoLine: { lead: 'James H', otherFriends: 0, rainmakers: 14 },
    avatars: [
      { initials: 'JH', bg: '#c8dff5', color: '#2a6496' },
    ],
  },
  {
    id: '4',
    name: 'Ana Flores',
    category: 'Housekeeper',
    description: 'Weekly & bi-weekly packages',
    price: 160,
    savings: 25,
    recoCount: 47,
    isCergioPick: false,
    imageUrl: 'https://images.unsplash.com/photo-1600880292089-90a7e086ee0c?w=300&q=80',
    recoLine: { lead: 'Sara K', otherFriends: 0, rainmakers: 5 },
    avatars: [
      { initials: 'SA', bg: '#f5c8c8', color: '#a02020' },
      { initials: 'MK', bg: '#d4f5c8', color: '#20a040' },
    ],
  },
];

export const inboxRequests = [
  {
    id: '1',
    sender: 'Reyna D',
    preview: "Hi Andrea, my name is Gerv. I've been...",
    date: 'Feb 3',
    appointmentTime: 'Tue, Feb 27 – 10:00 AM',
    isFreeForRainmakers: true,
    needsResponse: true,
    isUnread: true,
    avatarUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=100&q=80',
  },
  {
    id: '2',
    sender: 'Sofia M',
    preview: "Hey! I'd love to feature your cleaning...",
    date: 'Jan 29',
    appointmentTime: 'Fri, Feb 2 – 2:00 PM',
    isFreeForRainmakers: true,
    needsResponse: false,
    isUnread: false,
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80',
  },
  {
    id: '3',
    sender: 'Mia K',
    preview: 'Just moved to your area and saw your...',
    date: 'Jan 25',
    appointmentTime: 'Mon, Jan 29 – 9:00 AM',
    isFreeForRainmakers: true,
    needsResponse: true,
    isUnread: true,
    avatarUrl: 'https://images.unsplash.com/photo-1499952127939-9bbf5af6c51c?w=100&q=80',
  },
];

export const rainmakerRequest = {
  id: '1',
  rainmakerName: 'Reyna',
  instagramHandle: 'ReynaReynolds',
  followerCount: 6974,
  instagramBenefitText: "Gervon's network on Instagram",
  verificationBenefitText: "Your profile will be public on Cergio's search",
  avatarUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=280&q=80',
};

export const requestDetail = {
  id: '1',
  rainmakerName: 'Reyna',
  serviceType: 'Housekeeper request',
  jobDescription: 'Apartment Clean – 1 BD / 2 BA (+ extras)',
  appointmentTime: 'Tue, Feb 27 – 10:00 AM',
  instagramHandle: 'ReynaReynolds',
  followerCount: 6974,
  message: "Hi, my name is Gervon , I'm eager to try out your service and blast it on socials. Looking forward the house clean. Should be light :)",
  messageSentDate: 'Feb 13',
  acceptedDate: 'Fri, Feb 13 - 12:10 pm',
  photos: [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=150&q=80',
    'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=150&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=150&q=80',
  ],
  extraPhotoCount: 7,
};

export const jobDetails = {
  id: '1',
  jobType: 'Housekeeper Job',
  provider: {
    name: 'Jennifer',
    category: 'Housekeeper',
    imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=100&q=80',
    clientName: 'David',
  },
  earnings: 'Instagram marketing',
  requestedTime: '10:00 AM @ Fri, Feb 15',
  location: { line1: '1145 Broadway St.', line2: 'New York, NY 10001' },
  requestDetails: {
    type: 'Apartment / House Clean',
    items: ['2 Bedrooms', '2 Baths', '1000+ Sq Ft.'],
    extras: ['+ (2) Laundry Bags', '+ Deep Cleaning', '+ Needs cleaning supplies'],
  },
};

export const socialPosts = [
  {
    id: '1',
    providerName: 'Sabir',
    followerCount: 45414,
    category: 'Housekeeper',
    location: 'Miami, FL',
    sharedBy: 'Jennifer Driver',
    avatarUrl: 'https://images.unsplash.com/photo-1552374196-c4e7ffc6e126?w=100&q=80',
    photos: [
      'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&q=80',
      'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&q=80',
      'https://images.unsplash.com/photo-1550547660-d9450f859349?w=200&q=80',
    ],
  },
  {
    id: '2',
    providerName: 'Jackie',
    followerCount: 135572,
    category: 'Housekeeper',
    location: 'Los Angeles, CA',
    sharedBy: 'Jennifer Driver',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80',
    photos: [
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&q=80',
    ],
  },
  {
    id: '3',
    providerName: 'Johnathan',
    followerCount: 45414,
    category: 'Personal Driver',
    location: 'New York, NY',
    sharedBy: 'Jennifer Driver',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80',
    photos: [
      'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=200&q=80',
      'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=200&q=80',
      'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=200&q=80',
    ],
  },
];

export const completionData = {
  followerCount: 23735,
  ratedBy: 'Lydia',
  stars: 5,
};

export const ratingJob = {
  provider: {
    name: 'Jennifer L',
    category: 'Housekeeper',
    imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=120&q=80',
  },
  requestDetails: {
    type: 'Apartment / House Clean',
    items: ['2 Bedrooms', '2 Baths', '1000+ Sq Ft.'],
    extras: ['+ (2) Laundry Bags', '+ Deep Cleaning', '+ Needs cleaning supplies'],
  },
};
