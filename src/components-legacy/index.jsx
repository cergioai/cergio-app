// ─── StatusBar ───────────────────────────────────────────────────────────────
export function StatusBar() {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px 0' }}>
      <span style={{ fontSize:15, fontWeight:700, color:'#000' }}>9:41</span>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12"><rect x="0" y="3" width="3" height="9" rx="1" fill="#000"/><rect x="4.5" y="2" width="3" height="10" rx="1" fill="#000"/><rect x="9" y="0.5" width="3" height="11.5" rx="1" fill="#000"/><rect x="13.5" y="0" width="3" height="12" rx="1" fill="#000" opacity="0.3"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.4C10.8 2.4 13.3 3.6 15 5.6L16 4.4C14 2 11.1.6 8 .6S2 2 0 4.4L1 5.6C2.7 3.6 5.2 2.4 8 2.4z" fill="#000"/><path d="M8 5.2c1.8 0 3.5.8 4.7 2l1-1.2C12.2 4.4 10.2 3.4 8 3.4S3.8 4.4 2.3 6L3.3 7.2C4.5 6 6.2 5.2 8 5.2z" fill="#000"/><circle cx="8" cy="11" r="1.2" fill="#000"/></svg>
        <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0" y="1" width="22" height="10" rx="2.5" stroke="#000" strokeWidth="1" fill="none"/><rect x="1.5" y="2.5" width="17" height="7" rx="1.5" fill="#000"/><rect x="22.5" y="4" width="2" height="4" rx="1" fill="#000" opacity="0.4"/></svg>
      </div>
    </div>
  );
}

// ─── HomeIndicator ────────────────────────────────────────────────────────────
export function HomeIndicator() {
  return (
    <div style={{ display:'flex', justifyContent:'center', paddingBottom:10 }}>
      <div style={{ width:130, height:5, background:'#1a1a1a', borderRadius:3, opacity:0.15 }} />
    </div>
  );
}

// ─── CategoryPill ─────────────────────────────────────────────────────────────
// Props: label (string), size ('sm'|'md')
export function CategoryPill({ label, size = 'md' }) {
  const sm = size === 'sm';
  return (
    <span style={{
      display: 'inline-block',
      background: '#eaf7d0',
      borderRadius: 999,
      padding: sm ? '2px 9px' : '3px 10px',
      fontSize: sm ? 11 : 12,
      fontWeight: 600,
      color: '#4bab01',
    }}>
      {label}
    </span>
  );
}

// ─── RecosBadge ───────────────────────────────────────────────────────────────
// Props: count (number), size ('sm'|'md')
export function RecosBadge({ count, size = 'md' }) {
  const sm = size === 'sm';
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
      <svg width={sm?11:13} height={sm?11:13} viewBox="0 0 24 24" fill="none" stroke="#4bab01" strokeWidth="2.2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      <span style={{ fontSize: sm?11:12, fontWeight:600, color:'#4bab01' }}>{count} Recos</span>
    </div>
  );
}

// ─── AvatarStack ──────────────────────────────────────────────────────────────
// Props: avatars [{ initials, bg, color, imageUrl }], size (number, default 22)
export function AvatarStack({ avatars = [], size = 22 }) {
  return (
    <div style={{ display:'flex' }}>
      {avatars.map((av, i) => (
        <div key={i} style={{
          width: size, height: size, borderRadius:'50%',
          background: av.bg || '#e0e0e0',
          border: '2px solid white',
          marginLeft: i > 0 ? -6 : 0,
          overflow: 'hidden',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize: size * 0.38, fontWeight:700, color: av.color || '#333',
          flexShrink: 0,
        }}>
          {av.imageUrl
            ? <img src={av.imageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            : av.initials}
        </div>
      ))}
    </div>
  );
}

// ─── RecoRow ──────────────────────────────────────────────────────────────────
// Props: lead (string), otherFriends (number), rainmakers (number), avatars []
export function RecoRow({ lead, otherFriends, rainmakers, avatars = [] }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:9, borderTop:'0.5px solid #ebebeb' }}>
      <AvatarStack avatars={avatars} size={22} />
      <p style={{ fontSize:12, color:'#9c9895', lineHeight:1.35 }}>
        Reco'd by{' '}
        <span style={{ color:'#4bab01', fontWeight:600 }}>{lead}</span>
        {otherFriends > 0 && `, ${otherFriends} other friend${otherFriends > 1 ? 's' : ''}`}
        {rainmakers > 0 && <> and <span style={{ color:'#4bab01', fontWeight:600 }}>{rainmakers} Rainmakers</span></>}
      </p>
    </div>
  );
}

// ─── BenefitItem ──────────────────────────────────────────────────────────────
// Props: title (string), subtitle (string)
export function BenefitItem({ title, subtitle }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:16 }}>
      <div style={{ width:44, minWidth:44, height:44, borderRadius:'50%', background:'#eaf7d0', display:'flex', alignItems:'center', justifyContent:'center', marginTop:1 }}>
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="#4bab01"/>
        </svg>
      </div>
      <div>
        <p style={{ fontSize:16, fontWeight:700, color:'#484745', marginBottom:4, lineHeight:1.3 }}>{title}</p>
        <p style={{ fontSize:14, color:'#4bab01', fontWeight:500, lineHeight:1.5 }}>{subtitle}</p>
      </div>
    </div>
  );
}

// ─── RainmakerBadge (shield icon) ─────────────────────────────────────────────
// Props: size (number, default 44), borderColor (string)
export function RainmakerBadge({ size = 44, borderColor = 'white' }) {
  return (
    <div style={{
      width: size, height: size,
      background: '#4bab01',
      borderRadius: '50%',
      border: `3px solid ${borderColor}`,
      display:'flex', alignItems:'center', justifyContent:'center',
    }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="rgba(255,255,255,0.2)" stroke="white" strokeWidth="1.5"/>
        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ─── NeedsResponseBanner ──────────────────────────────────────────────────────
export function NeedsResponseBanner() {
  return (
    <div style={{ background:'#00a3e8', display:'flex', alignItems:'center', gap:8, padding:'9px 20px' }}>
      <div style={{ width:20, height:20, borderRadius:'50%', background:'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <span style={{ fontSize:12, fontWeight:800, color:'#00a3e8' }}>!</span>
      </div>
      <span style={{ fontSize:14, fontWeight:600, color:'white' }}>Needs Response</span>
    </div>
  );
}

// ─── GreenCTA ─────────────────────────────────────────────────────────────────
// Props: label (string), onClick (fn), disabled (bool)
export function GreenCTA({ label, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        width:'100%',
        background: disabled ? '#a8afb9' : '#4bab01',
        border: 'none',
        borderRadius: 14,
        padding: 18,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s',
      }}
    >
      <span style={{ fontSize:17, fontWeight:700, color:'white' }}>{label}</span>
    </button>
  );
}

// ─── StarRating ───────────────────────────────────────────────────────────────
// Props: value (0–5), onChange (fn), size (number, default 48)
export function StarRating({ value = 0, onChange, size = 48 }) {
  const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'];
  const labelColors = ['','#e05a3a','#f0a030','#4bab01','#4bab01','#4bab01'];
  return (
    <div>
      <div style={{ display:'flex', gap:12, marginBottom:8 }}>
        {[1,2,3,4,5].map(i => (
          <svg
            key={i}
            width={size} height={size} viewBox="0 0 24 24"
            style={{ cursor:'pointer', flexShrink:0 }}
            onClick={() => onChange && onChange(i)}
          >
            <path
              d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
              fill={i <= value ? '#4bab01' : '#dcdcdc'}
            />
          </svg>
        ))}
      </div>
      {value > 0 && (
        <p style={{ fontSize:15, fontWeight:700, color:labelColors[value] }}>{labels[value]}</p>
      )}
    </div>
  );
}

// ─── AvatarCluster (hero cluster used across cream screens) ───────────────────
// Props: mainImageUrl (string), satelliteImages [string], showBadge (bool)
export function AvatarCluster({ mainImageUrl, satelliteImages = [], showBadge = true }) {
  const satellites = [
    { top:46, left:64, w:64, img: satelliteImages[0] },
    { bottom:52, left:78, w:58, img: satelliteImages[1] },
    { top:40, right:66, w:62, img: satelliteImages[2] },
    { top:120, right:52, w:56, img: satelliteImages[3] },
  ];
  return (
    <div style={{ position:'relative', height:260, display:'flex', alignItems:'center', justifyContent:'center' }}>
      {/* Dots */}
      {[
        { top:24, left:96, size:30, color:'#4bab01' },
        { top:68, left:58, size:15, color:'#faeee0' },
        { top:148, left:40, size:13, color:'#4bab01' },
        { bottom:42, left:108, size:11, color:'#faeee0' },
        { top:32, right:80, size:17, color:'#4bab01' },
        { top:108, right:50, size:20, color:'#faeee0' },
        { bottom:38, right:68, size:13, color:'#4bab01' },
      ].map((d, i) => (
        <div key={i} style={{ position:'absolute', top:d.top, bottom:d.bottom, left:d.left, right:d.right, width:d.size, height:d.size, borderRadius:'50%', background:d.color }} />
      ))}
      {/* Satellite avatars */}
      {satellites.map((s, i) => s.img && (
        <div key={i} style={{ position:'absolute', top:s.top, bottom:s.bottom, left:s.left, right:s.right, width:s.w, height:s.w, borderRadius:'50%', overflow:'hidden', border:'3px solid #fffbf2' }}>
          <img src={s.img} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
        </div>
      ))}
      {/* Main avatar */}
      <div style={{ position:'relative', width:144, height:144, zIndex:2 }}>
        <div style={{ width:144, height:144, borderRadius:'50%', overflow:'hidden', border:'4px solid #fffbf2' }}>
          <img src={mainImageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
        </div>
        {showBadge && (
          <div style={{ position:'absolute', bottom:4, right:4 }}>
            <RainmakerBadge size={44} borderColor="#fffbf2" />
          </div>
        )}
      </div>
    </div>
  );
}
