import React from 'react';
import { StatusBar, CategoryPill, RecosBadge, RecoRow, AvatarStack } from '../components';

// ─── SRP Hero Card (Cergio Pick) ──────────────────────────────────────────────
function HeroCard({ provider }) {
  const { name, category, description, price, savings, recoCount, imageUrl, recoLine, avatars } = provider;
  return (
    <div style={{ background:'#fff', borderRadius:16, overflow:'hidden', border:'2px solid #4bab01', boxShadow:'0 2px 16px rgba(72,168,0,0.10)' }}>
      <div style={{ position:'relative', width:'100%', height:190, overflow:'hidden' }}>
        <img src={imageUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
        <button style={{ position:'absolute', top:12, left:12, background:'rgba(255,255,255,0.88)', border:'none', borderRadius:'50%', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9c9895" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div style={{ padding:'13px 15px 15px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
          <div>
            <p style={{ fontSize:17, fontWeight:700, color:'#1a1a1a', letterSpacing:'-0.02em' }}>{name}</p>
            <div style={{ marginTop:4, display:'flex', alignItems:'center', gap:8 }}>
              <CategoryPill label={category} />
              <RecosBadge count={recoCount} />
            </div>
          </div>
          <div style={{ textAlign:'right', paddingTop:2 }}>
            <p style={{ fontSize:17, fontWeight:700, color:'#1a1a1a' }}>${price}</p>
            {savings && <p style={{ fontSize:12, color:'#4bab01', fontWeight:600, marginTop:2 }}>Saves ${savings}</p>}
          </div>
        </div>
        <p style={{ fontSize:13, color:'#9c9895', lineHeight:1.4, margin:'8px 0 10px' }}>{description}</p>
        <RecoRow lead={recoLine.lead} otherFriends={recoLine.otherFriends} rainmakers={recoLine.rainmakers} avatars={avatars} />
      </div>
    </div>
  );
}

// ─── SRP Secondary Card ───────────────────────────────────────────────────────
function SecondaryCard({ provider }) {
  const { name, category, description, price, savings, overBudget, recoCount, imageUrl, recoLine, avatars } = provider;
  return (
    <div style={{ background:'#fff', borderRadius:14, overflow:'hidden', border:'0.5px solid #ebebeb', display:'flex' }}>
      <div style={{ width:110, minWidth:110, height:130, overflow:'hidden' }}>
        <img src={imageUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
      </div>
      <div style={{ padding:'11px 13px', flex:1, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <p style={{ fontSize:15, fontWeight:700, color:'#1a1a1a' }}>{name}</p>
            <CategoryPill label={category} size="sm" />
          </div>
          <div style={{ textAlign:'right' }}>
            <p style={{ fontSize:15, fontWeight:700, color:'#1a1a1a' }}>${price}</p>
            {savings  && <p style={{ fontSize:11, color:'#4bab01', fontWeight:600, marginTop:2 }}>Saves ${savings}</p>}
            {overBudget && <p style={{ fontSize:11, color:'#e05a3a', fontWeight:600, marginTop:2 }}>${overBudget} over budget</p>}
          </div>
        </div>
        <RecosBadge count={recoCount} size="sm" />
        <p style={{ fontSize:12, color:'#9c9895', lineHeight:1.3, margin:'4px 0' }}>{description}</p>
        <div style={{ display:'flex', alignItems:'center', gap:6, paddingTop:7, borderTop:'0.5px solid #ebebeb' }}>
          <AvatarStack avatars={avatars} size={22} />
          <p style={{ fontSize:11, color:'#9c9895' }}>
            Reco'd by <span style={{ color:'#4bab01', fontWeight:600 }}>{recoLine.lead}</span>
            {recoLine.rainmakers > 0 && <> + <span style={{ color:'#4bab01', fontWeight:600 }}>{recoLine.rainmakers} Rainmakers</span></>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── SRP Screen ───────────────────────────────────────────────────────────────
// Props: providers []  (first item is Cergio Pick, rest are secondary)
export default function SRPScreen({ providers = [] }) {
  const [pick, ...secondary] = providers;
  return (
    <div style={{ background:'#f8f8f8', maxWidth:390, margin:'0 auto', padding:16, display:'flex', flexDirection:'column', gap:12 }}>
      <StatusBar />
      {/* Cergio Pick label */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, background:'#4bab01', borderRadius:20, padding:'5px 12px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z" fill="white"/></svg>
          <span style={{ fontSize:12, fontWeight:700, color:'white', letterSpacing:'0.05em' }}>CERGIO PICK</span>
        </div>
        <span style={{ fontSize:12, color:'#9c9895' }}>Best match for you</span>
      </div>
      {pick && <HeroCard provider={pick} />}
      <p style={{ fontSize:12, fontWeight:600, color:'#9c9895', letterSpacing:'0.05em', textTransform:'uppercase', marginTop:4 }}>Other great matches</p>
      {secondary.map(p => <SecondaryCard key={p.id} provider={p} />)}
    </div>
  );
}
