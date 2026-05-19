import React from 'react';
import { StatusBar, HomeIndicator, NeedsResponseBanner, RainmakerBadge, AvatarCluster, BenefitItem, GreenCTA, StarRating } from '../components';

// ─────────────────────────────────────────────────────────────────────────────
// JOBS INBOX SCREEN
// Props: requests [], badgeCount (number)
// ─────────────────────────────────────────────────────────────────────────────
export function JobsInboxScreen({ requests = [], badgeCount = 0 }) {
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto' }}>
      <StatusBar />
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 20px 14px' }}>
        <h1 style={{ fontSize:32, fontWeight:800, color:'#000', letterSpacing:'-0.03em', flexShrink:0 }}>Jobs</h1>
        <div style={{ flex:1, background:'#eaebef', borderRadius:12, display:'flex', alignItems:'center', gap:8, padding:'10px 14px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <span style={{ fontSize:15, color:'#aaa' }}>Search jobs and requests</span>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ display:'flex', alignItems:'center', padding:'0 20px', borderBottom:'0.5px solid #e5e5e5' }}>
        <div style={{ flex:1, display:'flex', gap:24 }}>
          <div style={{ position:'relative', paddingBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'#000' }}>Requests</span>
              {badgeCount > 0 && (
                <div style={{ background:'#4bab01', borderRadius:10, minWidth:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 5px' }}>
                  <span style={{ fontSize:11, fontWeight:700, color:'white' }}>{badgeCount}</span>
                </div>
              )}
            </div>
            <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2.5, background:'#4bab01', borderRadius:2 }}/>
          </div>
          {['Upcoming','Past'].map(t => (
            <div key={t} style={{ paddingBottom:12 }}>
              <span style={{ fontSize:15, color:'#aaa' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Filters */}
      <div style={{ display:'flex', gap:10, padding:'14px 20px' }}>
        {['Filter (All)','Status'].map(f => (
          <div key={f} style={{ border:'1.5px solid #c8c8cc', borderRadius:20, padding:'7px 16px' }}>
            <span style={{ fontSize:14, color:'#000', fontWeight:500 }}>{f}</span>
          </div>
        ))}
      </div>
      {/* Request rows */}
      {requests.map((req, i) => (
        <div key={req.id} style={{ borderTop: i > 0 ? '0.5px solid #e5e5e5' : 'none' }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 20px 14px 16px' }}>
            <div style={{ width:8, minWidth:8, marginTop:18 }}>
              {req.isUnread && <div style={{ width:8, height:8, borderRadius:'50%', background:'#f0484a' }}/>}
            </div>
            <div style={{ width:52, minWidth:52, height:52, borderRadius:'50%', overflow:'hidden' }}>
              <img src={req.avatarUrl} alt={req.sender} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:15, fontWeight:700, color:'#000' }}>{req.sender}</span>
                <span style={{ fontSize:13, color:'#aaa' }}>{req.date}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                <span style={{ fontSize:14, color:'#aaa', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:220 }}>{req.preview}</span>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1l6 6-6 6" stroke="#c0c0c0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:13, color:'#aaa' }}>{req.appointmentTime}</span>
                {req.isFreeForRainmakers && (
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="#4bab01"/></svg>
                    <span style={{ fontSize:13, color:'#4bab01', fontWeight:600 }}>Free for Rainmakers</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {req.needsResponse && <NeedsResponseBanner />}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RAINMAKER REQUEST SCREEN (provider sees Rainmaker offer)
// Props: request { rainmakerName, instagramHandle, followerCount, ... }
// ─────────────────────────────────────────────────────────────────────────────
export function RainmakerRequestScreen({ request = {} }) {
  const { rainmakerName, instagramHandle, followerCount, instagramBenefitText, verificationBenefitText, avatarUrl } = request;
  const satellites = [
    'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=120&q=80',
    'https://images.unsplash.com/photo-1499952127939-9bbf5af6c51c?w=120&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
  ];
  return (
    <div style={{ background:'#fffbf2', maxWidth:390, margin:'0 auto', minHeight:'100vh', display:'flex', flexDirection:'column', paddingBottom:32 }}>
      <StatusBar />
      <AvatarCluster mainImageUrl={avatarUrl} satelliteImages={satellites} showBadge />
      <div style={{ padding:'0 28px', flex:1, display:'flex', flexDirection:'column' }}>
        <h1 style={{ fontSize:28, fontWeight:800, color:'#484745', textAlign:'center', lineHeight:1.25, letterSpacing:'-0.02em', marginBottom:16 }}>
          {rainmakerName} wants to market your services
        </h1>
        <p style={{ fontSize:16, color:'#84807d', textAlign:'center', lineHeight:1.6, marginBottom:32 }}>
          {rainmakerName} is a <span style={{ color:'#4bab01', fontWeight:700 }}>Cergio Rainmaker</span>.&nbsp; Offer a free service in exchange for the following benefits:
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:28, marginBottom:40 }}>
          <BenefitItem title={`Instagram post to ${followerCount?.toLocaleString()} followers`} subtitle={instagramBenefitText} />
          <BenefitItem title="Instant verification" subtitle={verificationBenefitText} />
        </div>
      </div>
      <div style={{ padding:'0 24px 32px' }}>
        <GreenCTA label="Let's do it" />
        <div style={{ textAlign:'center', marginTop:18 }}>
          <span style={{ fontSize:15, color:'#4bab01', fontWeight:500 }}>See recent posts by Rainmakers</span>
        </div>
      </div>
      <HomeIndicator />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST DETAIL SCREEN (message thread + accept/decline)
// Props: request { rainmakerName, serviceType, ... }
// ─────────────────────────────────────────────────────────────────────────────
export function RequestDetailScreen({ request = {} }) {
  const { rainmakerName, serviceType, jobDescription, appointmentTime, instagramHandle, followerCount, message, messageSentDate, acceptedDate, photos = [], extraPhotoCount } = request;
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto' }}>
      <StatusBar />
      {/* Nav */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 20px 12px' }}>
        <div style={{ width:36, height:36, borderRadius:'50%', border:'1.5px solid #ebebeb', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M8 1L1.5 7.5 8 14" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <span style={{ fontSize:17, fontWeight:600, color:'#1a1a1a' }}>{rainmakerName}</span>
        <div style={{ display:'flex', gap:6 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#1a1a1a' }}/>)}
        </div>
      </div>
      {/* Needs Response bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 20px', borderTop:'0.5px solid #ebebeb', borderBottom:'0.5px solid #ebebeb' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:20, height:20, borderRadius:'50%', background:'#00a3e8', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ fontSize:11, fontWeight:800, color:'white' }}>!</span>
          </div>
          <span style={{ fontSize:14, fontWeight:600, color:'#00a3e8' }}>Needs Response</span>
        </div>
        <span style={{ fontSize:14, color:'#1a1a1a', fontWeight:500 }}>View Details</span>
      </div>
      {/* Service info */}
      <div style={{ padding:'20px 20px 0' }}>
        <h2 style={{ fontSize:22, fontWeight:800, color:'#1a1a1a', marginBottom:6, letterSpacing:'-0.02em' }}>{serviceType}</h2>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="#4bab01"/></svg>
          <span style={{ fontSize:15, fontWeight:700, color:'#4bab01' }}>Free for Rainmakers</span>
        </div>
        <p style={{ fontSize:15, color:'#1a1a1a', marginBottom:4 }}>{jobDescription}</p>
        <p style={{ fontSize:15, color:'#1a1a1a', marginBottom:20 }}>{appointmentTime}</p>
      </div>
      {/* Map placeholder */}
      <div style={{ margin:'0 20px 6px', borderRadius:16, overflow:'hidden', background:'#f9f5ea', height:120, display:'flex', alignItems:'flex-end', padding:12 }}>
        <div style={{ background:'white', borderRadius:12, padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%' }}>
          <div>
            <p style={{ fontSize:13, fontWeight:600, color:'#1a1a1a', marginBottom:2 }}>Map shows approximate location</p>
            <p style={{ fontSize:11, color:'#8a8a8a', lineHeight:1.4 }}>Exact address shared after user confirms booking.</p>
          </div>
        </div>
      </div>
      <p style={{ fontSize:13, color:'#8a8a8a', textAlign:'center', padding:'10px 0 16px' }}>Scroll down for messages</p>
      {/* Instagram card */}
      <div style={{ margin:'0 20px 10px', background:'#fff', borderRadius:14, border:'0.5px solid #ebebeb', padding:'14px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#1a1a1a" stroke="none"/></svg>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:14, fontWeight:700, color:'#1a1a1a' }}>{instagramHandle}</p>
            <p style={{ fontSize:12, color:'#8a8a8a' }}>{followerCount?.toLocaleString()} followers</p>
          </div>
          <button style={{ background:'#ff512f', border:'none', borderRadius:10, padding:'9px 14px', cursor:'pointer' }}>
            <span style={{ fontSize:13, fontWeight:700, color:'white' }}>See Instagram</span>
          </button>
        </div>
      </div>
      {/* Photos */}
      {photos.length > 0 && (
        <div style={{ margin:'0 20px 16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:4, borderRadius:14, overflow:'hidden', border:'0.5px solid #ebebeb' }}>
          {photos.slice(0,3).map((p,i) => (
            <div key={i} style={{ height:82, overflow:'hidden' }}><img src={p} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/></div>
          ))}
          <div style={{ height:82, width:82, background:'#1a1a1a', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column' }}>
            <span style={{ fontSize:18, fontWeight:700, color:'white', lineHeight:1 }}>+{extraPhotoCount}</span>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)' }}>more</span>
          </div>
        </div>
      )}
      {/* Message bubble */}
      <div style={{ margin:'0 20px 16px', background:'#f4f5f7', borderRadius:16, padding:16 }}>
        <p style={{ fontSize:15, color:'#1a1a1a', lineHeight:1.55, marginBottom:10 }}>{message}</p>
        <p style={{ fontSize:12, color:'#8a8a8a' }}>Sent - {messageSentDate}</p>
      </div>
      {/* Accepted system msg */}
      <div style={{ margin:'0 20px 24px', display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:'50%', overflow:'hidden', flexShrink:0 }}>
          <img src="https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=80&q=80" alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
        </div>
        <div>
          <p style={{ fontSize:14, color:'#8a8a8a' }}>You accepted this request for free</p>
          <p style={{ fontSize:13, color:'#8a8a8a' }}>{acceptedDate}</p>
        </div>
      </div>
      {/* Accept section */}
      <div style={{ padding:'20px 20px 16px', textAlign:'center', borderTop:'0.5px solid #ebebeb' }}>
        <p style={{ fontSize:16, fontWeight:700, color:'#1a1a1a', marginBottom:4 }}>You'll get free marketing</p>
        <p style={{ fontSize:14, color:'#8a8a8a', marginBottom:18 }}>and service verification with a 4+ star rating</p>
        <GreenCTA label="Accept free request" />
        <p style={{ fontSize:15, fontWeight:600, color:'#4bab01', marginTop:14, cursor:'pointer' }}>Decline</p>
      </div>
      {/* Message input */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px 20px', borderTop:'0.5px solid #ebebeb' }}>
        <span style={{ fontSize:15, color:'#8a8a8a' }}>Write a message</span>
        <span style={{ fontSize:15, color:'#c0c0c0', fontWeight:500 }}>Send</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB DETAILS SCREEN (map + bottom sheet)
// Props: job { jobType, provider, earnings, requestedTime, location, requestDetails }
// ─────────────────────────────────────────────────────────────────────────────
export function JobDetailsScreen({ job = {} }) {
  const { jobType, provider, earnings, requestedTime, location, requestDetails } = job;
  const rows = [
    { label:'Your earnings', sub: earnings, action:'Free Benefits' },
    { label:'Requested time', sub: requestedTime, action:'Change' },
    { label:'Job location', sub: location ? `${location.line1}\n${location.line2}` : '', action:'Get Directions' },
  ];
  return (
    <div style={{ background:'#e8ede0', maxWidth:390, margin:'0 auto' }}>
      <StatusBar />
      {/* Map */}
      <div style={{ position:'relative', height:260, overflow:'hidden' }}>
        <svg width="100%" height="260" viewBox="0 0 390 260" preserveAspectRatio="xMidYMid slice" style={{ position:'absolute', inset:0 }}>
          <rect width="390" height="260" fill="#e8ede0"/>
          {[60,110,155,210].map(y => <line key={y} x1="0" y1={y} x2="390" y2={y} stroke="#fff" strokeWidth="7"/>)}
          {[70,160,250,330].map(x => <line key={x} x1={x} y1="0" x2={x} y2="260" stroke="#fff" strokeWidth="6"/>)}
          <circle cx="195" cy="148" r="48" fill="#d2e5a5" opacity="0.85"/>
          <circle cx="195" cy="148" r="48" fill="none" stroke="#3e8d00" strokeWidth="2.5"/>
        </svg>
        <button style={{ position:'absolute', top:50, left:16, width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.92)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div style={{ position:'absolute', bottom:20, left:16, background:'#3e8d00', borderRadius:20, padding:'8px 16px', display:'flex', alignItems:'center', gap:7 }}>
          <div style={{ width:20, height:20, borderRadius:'50%', background:'rgba(255,255,255,0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ fontSize:11, fontWeight:800, color:'white' }}>$</span>
          </div>
          <span style={{ fontSize:14, fontWeight:700, color:'white' }}>Booked</span>
        </div>
      </div>
      {/* Bottom sheet */}
      <div style={{ background:'#fff', borderRadius:'24px 24px 0 0', marginTop:-16, padding:'0 20px 32px' }}>
        <div style={{ width:36, height:4, background:'#eaeaea', borderRadius:2, margin:'12px auto 20px' }}/>
        <h1 style={{ fontSize:24, fontWeight:800, color:'#1a1a1a', letterSpacing:'-0.02em', marginBottom:20 }}>{jobType}</h1>
        {/* Provider */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 0', borderBottom:'1px solid #eaeaea' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:50, height:50, borderRadius:'50%', overflow:'hidden' }}>
              <img src={provider?.imageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            </div>
            <div>
              <p style={{ fontSize:16, fontWeight:700, color:'#1a1a1a', marginBottom:3 }}>{provider?.name}</p>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3e8d00"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                <span style={{ fontSize:13, color:'#3e8d00', fontWeight:600 }}>{provider?.category}</span>
              </div>
            </div>
          </div>
          <span style={{ fontSize:15, fontWeight:600, color:'#3e8d00' }}>Call {provider?.clientName}</span>
        </div>
        {/* Info rows */}
        {rows.map((row, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'18px 0', borderBottom:'1px solid #eaeaea' }}>
            <div>
              <p style={{ fontSize:16, fontWeight:700, color:'#1a1a1a', marginBottom:4 }}>{row.label}</p>
              {row.sub.split('\n').map((line, j) => <p key={j} style={{ fontSize:14, color:'#909090' }}>{line}</p>)}
            </div>
            <span style={{ fontSize:15, fontWeight:600, color:'#3e8d00', whiteSpace:'nowrap', paddingTop:2 }}>{row.action}</span>
          </div>
        ))}
        {/* Request details */}
        {requestDetails && (
          <div style={{ paddingTop:18 }}>
            <p style={{ fontSize:16, fontWeight:700, color:'#1a1a1a', marginBottom:10 }}>Request Details</p>
            <p style={{ fontSize:14, color:'#909090', marginBottom:10 }}>{requestDetails.type}</p>
            <div style={{ display:'flex', flexDirection:'column', gap:7, marginBottom:16 }}>
              {requestDetails.items.map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ width:5, height:5, borderRadius:'50%', background:'#1a1a1a' }}/>
                  <span style={{ fontSize:14, color:'#1a1a1a' }}>{item}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize:14, color:'#909090', marginBottom:10 }}>Extras</p>
            <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
              {requestDetails.extras.map((e, i) => (
                <span key={i} style={{ fontSize:14, color:'#1a1a1a' }}>{e}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FREE BENEFITS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
export function FreeBenefitsScreen() {
  const satellites = [
    'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=120&q=80',
    'https://images.unsplash.com/photo-1499952127939-9bbf5af6c51c?w=120&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
  ];
  return (
    <div style={{ background:'#fffbf2', maxWidth:390, margin:'0 auto', minHeight:'100vh', display:'flex', flexDirection:'column', paddingBottom:32 }}>
      <StatusBar />
      <div style={{ padding:'12px 20px 0' }}>
        <div style={{ width:38, height:38, borderRadius:'50%', border:'1.5px solid #ddd8ce', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="#484745" strokeWidth="2" strokeLinecap="round"/></svg>
        </div>
      </div>
      <AvatarCluster mainImageUrl={satellites[0]} satelliteImages={satellites} showBadge />
      <h1 style={{ fontSize:30, fontWeight:800, color:'#484745', textAlign:'center', letterSpacing:'-0.02em', lineHeight:1.2, padding:'0 28px 32px' }}>Free Service Benefits</h1>
      <div style={{ padding:'0 28px', display:'flex', flexDirection:'column', gap:32 }}>
        <div>
          <BenefitItem title="Mega-exposure on social media" subtitle="" />
          <p style={{ fontSize:15, color:'#84807d', lineHeight:1.65, marginTop:10, marginLeft:60 }}>Rainmakers that book a free service are required to share positive booking experiences with their social network and add to their Reco list.</p>
          <p style={{ fontSize:15, color:'#84807d', lineHeight:1.65, marginTop:12, marginLeft:60 }}>Get your Cergio profile seen by thousands of potential clients on social apps like Instagram.</p>
        </div>
        <div>
          <BenefitItem title="Instant verification" subtitle="" />
          <p style={{ fontSize:15, color:'#84807d', lineHeight:1.65, marginTop:10, marginLeft:60 }}>Complete a free service with a Cergio expert and become instantly verified when you are rated 4+ stars.</p>
          <p style={{ fontSize:15, color:'#84807d', lineHeight:1.65, marginTop:12, marginLeft:60 }}>Your verified service will be visible to users browsing through search. Verified services get more business and earn more money.</p>
        </div>
      </div>
      <HomeIndicator />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL POSTS SCREEN
// Props: posts [], onReviewRequest (fn), requesterName (string)
// ─────────────────────────────────────────────────────────────────────────────
export function SocialPostsScreen({ posts = [], onReviewRequest, requesterName = 'Gervon' }) {
  const satellites = [
    'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=120&q=80',
    'https://images.unsplash.com/photo-1499952127939-9bbf5af6c51c?w=120&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
  ];
  return (
    <div style={{ background:'#fffbf2', maxWidth:390, margin:'0 auto', paddingBottom:90 }}>
      <StatusBar />
      {/* Hero badge cluster */}
      <div style={{ position:'relative', height:210, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {[{t:22,l:108,s:26,c:'#4bab01'},{t:70,l:66,s:13,c:'#faeee0'},{b:36,l:82,s:11,c:'#faeee0'},{t:28,r:84,s:15,c:'#4bab01'},{t:90,r:54,s:18,c:'#faeee0'},{b:30,r:74,s:11,c:'#4bab01'}].map((d,i)=>(
          <div key={i} style={{ position:'absolute', top:d.t, bottom:d.b, left:d.l, right:d.r, width:d.s, height:d.s, borderRadius:'50%', background:d.c }}/>
        ))}
        {satellites.slice(0,4).map((url, i) => {
          const pos = [{top:42,left:60,s:60},{bottom:44,left:76,s:54},{top:36,right:68,s:58},{top:106,right:56,s:50}][i];
          return <div key={i} style={{ position:'absolute', ...pos, width:pos.s, height:pos.s, borderRadius:'50%', overflow:'hidden', border:'3px solid #fffbf2' }}><img src={url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/></div>;
        })}
        <div style={{ width:100, height:100, background:'#4bab01', borderRadius:'50%', border:'4px solid #fffbf2', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2 }}>
          <RainmakerBadge size={100} borderColor="#fffbf2" />
        </div>
      </div>
      {/* Headline */}
      <div style={{ padding:'4px 28px 6px', textAlign:'center' }}>
        <h1 style={{ fontSize:24, fontWeight:800, color:'#2a2a2a', lineHeight:1.3, letterSpacing:'-0.02em', marginBottom:8 }}>Rainmakers have shared their go-to services on Cergio to 2M+ followers.</h1>
        <p style={{ fontSize:15, fontWeight:600, color:'#4bab01' }}>#cergiorainmakers</p>
      </div>
      {/* Posts */}
      {posts.map((post, i) => (
        <div key={post.id} style={{ padding:'20px 20px 24px', borderBottom: i < posts.length-1 ? '1px solid #ede8df' : 'none' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <div style={{ width:44, height:44, borderRadius:'50%', overflow:'hidden' }}>
              <img src={post.avatarUrl} alt={post.providerName} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            </div>
            <div>
              <p style={{ fontSize:15, color:'#2a2a2a', lineHeight:1.4 }}><span style={{ fontWeight:700 }}>{post.providerName}</span> was shared to {post.followerCount?.toLocaleString()} followers</p>
              <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:2 }}>
                <svg width="13" height="13" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#4bab01"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                <span style={{ fontSize:13, color:'#4bab01', fontWeight:600 }}>{post.category}</span>
                <span style={{ fontSize:13, color:'#84807d' }}>· {post.location}</span>
              </div>
            </div>
          </div>
          {post.photos.length === 1
            ? <div style={{ borderRadius:12, overflow:'hidden', height:200 }}><img src={post.photos[0]} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/></div>
            : <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, borderRadius:12, overflow:'hidden' }}>{post.photos.map((p,j)=><div key={j} style={{ height:100, overflow:'hidden' }}><img src={p} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/></div>)}</div>
          }
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:12 }}>
            <div style={{ width:26, height:26, borderRadius:'50%', overflow:'hidden', border:'2px solid #fffbf2' }}><img src="https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=60&q=80" alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/></div>
            <p style={{ fontSize:13, color:'#4bab01', fontWeight:600 }}>Shared by {post.sharedBy}, Rainmaker</p>
          </div>
        </div>
      ))}
      {/* Sticky CTA */}
      <div style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:390, background:'#fffbf2', padding:'16px 20px 28px', borderTop:'0.5px solid #ede8df' }}>
        <GreenCTA label={`Review ${requesterName}'s request`} onClick={onReviewRequest} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE SHARED SCREEN
// Props: rainmakerName, instagramHandle, followerCount, postImageUrl
// ─────────────────────────────────────────────────────────────────────────────
export function ProfileSharedScreen({ rainmakerName='Reyna', instagramHandle='ReynaReynolds', followerCount=6974, postImageUrl, onLooksAmazing, onSomethingWrong }) {
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto', minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <div style={{ padding:'12px 20px 0' }}>
        <div style={{ width:36, height:36, borderRadius:'50%', border:'1.5px solid #ebebeb', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="9" height="15" viewBox="0 0 9 15" fill="none"><path d="M8 1L1.5 7.5 8 14" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </div>
      <div style={{ padding:'20px 24px 28px' }}>
        <h1 style={{ fontSize:26, fontWeight:800, color:'#1a1a1a', letterSpacing:'-0.02em', lineHeight:1.2, marginBottom:10 }}>{rainmakerName} shared your profile!</h1>
        <p style={{ fontSize:15, color:'#848484', lineHeight:1.6 }}>Your profile has been shared to 6,375 followers on Gervon's Instagram feed!</p>
      </div>
      {/* Wave + card */}
      <div style={{ position:'relative', flex:1 }}>
        <svg viewBox="0 0 390 40" style={{ display:'block', width:'100%' }}><path d="M0 40 C60 10, 130 0, 195 20 C260 40, 330 30, 390 10 L390 40 Z" fill="#78c100"/></svg>
        <div style={{ background:'#78c100', padding:'0 20px' }}>
          <div style={{ background:'#fff', borderRadius:20, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#1a1a1a" stroke="none"/></svg>
                <div>
                  <p style={{ fontSize:15, fontWeight:700, color:'#1a1a1a' }}>{instagramHandle}</p>
                  <p style={{ fontSize:13, color:'#848484' }}>{followerCount?.toLocaleString()} followers</p>
                </div>
              </div>
              <div style={{ position:'relative', width:46, height:46 }}>
                <div style={{ width:46, height:46, borderRadius:'50%', overflow:'hidden' }}>
                  <img src="https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=100&q=80" alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                </div>
                <div style={{ position:'absolute', bottom:-2, right:-2, width:18, height:18, background:'#4bab01', borderRadius:'50%', border:'2px solid white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" stroke="white" strokeWidth="2.5" fill="none"/><path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
            </div>
            <div style={{ position:'relative', width:'100%', height:280, overflow:'hidden' }}>
              <img src={postImageUrl || 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&q=80'} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              <button style={{ position:'absolute', bottom:16, right:16, background:'#ff512f', border:'none', borderRadius:24, padding:'11px 20px', cursor:'pointer' }}>
                <span style={{ fontSize:15, fontWeight:700, color:'white' }}>See Instagram</span>
              </button>
            </div>
          </div>
        </div>
        <svg viewBox="0 0 390 40" style={{ display:'block', width:'100%' }}><path d="M0 0 C60 30, 130 40, 195 20 C260 0, 330 10, 390 30 L390 0 Z" fill="#78c100"/></svg>
      </div>
      <div style={{ padding:'16px 20px 32px', display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
        <GreenCTA label="Looks amazing" onClick={onLooksAmazing} />
        <span style={{ fontSize:15, color:'#848484', fontWeight:500, cursor:'pointer' }} onClick={onSomethingWrong}>Something's wrong</span>
      </div>
      <HomeIndicator />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE COMPLETE SCREEN
// Props: followerCount, ratedBy, stars, onDone
// ─────────────────────────────────────────────────────────────────────────────
export function ServiceCompleteScreen({ followerCount=23735, ratedBy='Lydia', stars=5, onDone }) {
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto', minHeight:'100vh', display:'flex', flexDirection:'column', paddingBottom:32 }}>
      <StatusBar />
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'48px 28px 40px' }}>
        <div style={{ width:72, height:72, borderRadius:'50%', border:'2.5px solid #4bab01', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:24 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#4bab01" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <h1 style={{ fontSize:28, fontWeight:800, color:'#1a1a1a', textAlign:'center', lineHeight:1.25, letterSpacing:'-0.02em' }}>Thanks for completing a free service!</h1>
      </div>
      <div style={{ padding:'0 28px', display:'flex', flexDirection:'column', gap:28, flex:1 }}>
        <BenefitItem title="Free marketing worth up to $1,000+" subtitle={`Your profile was shared to ${followerCount?.toLocaleString()} followers`} />
        <BenefitItem title="Instant verification" subtitle="Your profile is now public on Cergio's search" />
        <BenefitItem title={`A recommendation from ${ratedBy}`} subtitle={`${ratedBy} rated you ${stars} stars on Cergio`} />
      </div>
      <div style={{ padding:'32px 20px 0' }}>
        <GreenCTA label="Perfect!" onClick={onDone} />
      </div>
      <HomeIndicator />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECO NOTIFICATION SCREEN
// Props: senderName, badgeCount, requests []
// ─────────────────────────────────────────────────────────────────────────────
export function RecoNotificationScreen({ senderName='Gervon', badgeCount=3, requests=[] }) {
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto', minHeight:'100vh' }}>
      <StatusBar />
      {/* Dark banner */}
      <div style={{ margin:'4px 16px 0', background:'#101a19', borderRadius:18, padding:'18px 16px', display:'flex', alignItems:'center', gap:14, cursor:'pointer' }}>
        <div style={{ width:44, minWidth:44, height:44, borderRadius:'50%', border:'1.5px solid rgba(75,171,1,0.5)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#4bab01" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 8l1.09 2.26L15.5 10.5l-1.73 1.68.41 2.37L12 13.25l-2.18 1.3.41-2.37L8.5 10.5l2.41-.24L12 8z" fill="#4bab01"/>
          </svg>
        </div>
        <p style={{ flex:1, fontSize:16, fontWeight:700, color:'#fff', lineHeight:1.35 }}>You received a recommendation from {senderName}!</p>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1l6 6-6 6" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      {/* Tabs */}
      <div style={{ display:'flex', alignItems:'center', padding:'18px 20px 0', borderBottom:'0.5px solid #e5e5e5' }}>
        <div style={{ flex:1, display:'flex', gap:24 }}>
          <div style={{ position:'relative', paddingBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'#000' }}>Requests</span>
              {badgeCount > 0 && <div style={{ background:'#4bab01', borderRadius:10, minWidth:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 5px' }}><span style={{ fontSize:11, fontWeight:700, color:'white' }}>{badgeCount}</span></div>}
            </div>
            <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2.5, background:'#4bab01', borderRadius:2 }}/>
          </div>
          {['Upcoming','Past'].map(t=><div key={t} style={{ paddingBottom:12 }}><span style={{ fontSize:15, color:'#aaa' }}>{t}</span></div>)}
        </div>
      </div>
      <div style={{ display:'flex', gap:10, padding:'14px 20px' }}>
        {['Filter (All)','Status'].map(f=><div key={f} style={{ border:'1.5px solid #c8c8cc', borderRadius:20, padding:'7px 16px' }}><span style={{ fontSize:14, color:'#000', fontWeight:500 }}>{f}</span></div>)}
      </div>
      {requests.length === 0 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 40px', textAlign:'center' }}>
          <p style={{ fontSize:15, color:'#aaa', lineHeight:1.6 }}>No pending requests right now.<br/>New Rainmaker requests will appear here.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE & CONFIRM SCREEN
// Props: job { provider, requestDetails }, onConfirm
// ─────────────────────────────────────────────────────────────────────────────
export function RateConfirmScreen({ job = {}, onConfirm }) {
  const [rating, setRating] = React.useState(0);
  const { provider, requestDetails } = job;
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto', minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <div style={{ padding:'12px 20px 0' }}>
        <div style={{ width:38, height:38, borderRadius:'50%', border:'1.5px solid #ddd', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="#2a2828" strokeWidth="2" strokeLinecap="round"/></svg>
        </div>
      </div>
      <div style={{ padding:'20px 24px 24px' }}>
        <h1 style={{ fontSize:28, fontWeight:800, color:'#2a2828', letterSpacing:'-0.02em', lineHeight:1.2 }}>Rate and confirm completion</h1>
      </div>
      {provider && (
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'0 24px 20px' }}>
          <div style={{ width:52, height:52, borderRadius:'50%', overflow:'hidden' }}>
            <img src={provider.imageUrl} alt={provider.name} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
          </div>
          <div>
            <p style={{ fontSize:17, fontWeight:700, color:'#2a2828', marginBottom:4 }}>{provider.name}</p>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#4bab01"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
              <span style={{ fontSize:14, color:'#4bab01', fontWeight:600 }}>{provider.category}</span>
            </div>
          </div>
        </div>
      )}
      <div style={{ padding:'0 24px 10px' }}>
        <StarRating value={rating} onChange={setRating} size={48} />
      </div>
      <div style={{ height:1, background:'#ebebeb', margin:'16px 24px' }}/>
      {requestDetails && (
        <div style={{ padding:'0 24px', flex:1 }}>
          <p style={{ fontSize:17, fontWeight:700, color:'#2a2828', marginBottom:12 }}>{requestDetails.type}</p>
          <div style={{ display:'flex', flexDirection:'column', gap:7, marginBottom:24 }}>
            {requestDetails.items.map((item,i)=>(
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:5, height:5, borderRadius:'50%', background:'#a8afb9' }}/>
                <span style={{ fontSize:15, color:'#a8afb9' }}>{item}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize:17, fontWeight:700, color:'#2a2828', marginBottom:12 }}>Extras</p>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {requestDetails.extras.map((e,i)=><span key={i} style={{ fontSize:15, color:'#a8afb9' }}>{e}</span>)}
          </div>
        </div>
      )}
      <div style={{ borderTop:'1px solid #ebebeb', padding:'16px 20px 28px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div>
            <p style={{ fontSize:14, fontWeight:700, color:'#2a2828', marginBottom:3 }}>Marking a job complete is final</p>
            <p style={{ fontSize:13, color:'#a8afb9' }}>This action cannot be reversed.</p>
          </div>
          <div style={{ width:48, height:48, border:'1.5px solid #ebebeb', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="17" rx="3" stroke="#dcdcdc" strokeWidth="1.8"/>
              <path d="M3 9h18" stroke="#dcdcdc" strokeWidth="1.8"/>
              <path d="M8 2v4M16 2v4" stroke="#dcdcdc" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="12" cy="15" r="4" fill="#4bab01"/>
              <path d="M10 15l1.5 1.5 3-3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <GreenCTA label="Confirm" onClick={rating > 0 ? onConfirm : null} disabled={rating === 0} />
      </div>
      <HomeIndicator />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE PROMPT SCREEN (post-service, Rainmaker side)
// Props: providerName, onLetsDoIt
// ─────────────────────────────────────────────────────────────────────────────
export function SharePromptScreen({ providerName='Gervon', followerCount=6974, onLetsDoIt }) {
  return (
    <div style={{ background:'#fff', maxWidth:390, margin:'0 auto', minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <div style={{ padding:'28px 24px 32px' }}>
        <h1 style={{ fontSize:28, fontWeight:800, color:'#1a1a1a', letterSpacing:'-0.02em', lineHeight:1.25 }}>We're glad you enjoyed your free service!</h1>
      </div>
      {/* Instagram hero */}
      <div style={{ margin:'0 24px 36px', background:'#fffbf2', borderRadius:24, padding:'32px 24px', display:'flex', flexDirection:'column', alignItems:'center', gap:20, position:'relative', overflow:'hidden' }}>
        {[{t:16,r:20,s:18,c:'#4bab01',o:0.4},{t:36,r:10,s:10,c:'#ff512f',o:0.5},{b:20,l:14,s:14,c:'#4bab01',o:0.35},{t:20,l:10,s:10,c:'#ff512f',o:0.3}].map((d,i)=>(
          <div key={i} style={{ position:'absolute', top:d.t, bottom:d.b, left:d.l, right:d.r, width:d.s, height:d.s, borderRadius:'50%', background:d.c, opacity:d.o }}/>
        ))}
        <div style={{ width:96, height:96, borderRadius:26, background:'#ff512f', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 24px rgba(255,81,47,0.28)' }}>
          <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5"/>
            <circle cx="12" cy="12" r="4.5"/>
            <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none"/>
          </svg>
        </div>
        <div style={{ background:'#4bab01', borderRadius:20, padding:'7px 18px' }}>
          <span style={{ fontSize:13, fontWeight:700, color:'white' }}>Reaches {followerCount?.toLocaleString()} followers</span>
        </div>
      </div>
      <div style={{ padding:'0 24px', flex:1 }}>
        <p style={{ fontSize:19, fontWeight:800, color:'#1a1a1a', marginBottom:12, letterSpacing:'-0.01em' }}>Now it's your turn!</p>
        <p style={{ fontSize:16, color:'#848484', lineHeight:1.65, marginBottom:16 }}>Share your experience to social media and leave a nice recommendation.</p>
        <p style={{ fontSize:16, color:'#848484', lineHeight:1.65 }}>Once {providerName} confirms your Instagram post, you'll be able to book more free services!</p>
      </div>
      <div style={{ padding:'28px 20px 28px' }}>
        <GreenCTA label="Let's do it" onClick={onLetsDoIt} />
      </div>
      <HomeIndicator />
    </div>
  );
}
