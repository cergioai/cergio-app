// Per design-spec.md — feed of Rainmaker posts that promoted services.
import { useNavigate, useOutletContext } from 'react-router-dom';

const POSTS = [
  { id: '1', providerName: 'Sabir',     followerCount: 45414,  category: 'Housekeeper',     location: 'Miami, FL',       sharedBy: 'Jennifer Driver', count: 3 },
  { id: '2', providerName: 'Jackie',    followerCount: 135572, category: 'Housekeeper',     location: 'Los Angeles, CA', sharedBy: 'Jennifer Driver', count: 1 },
  { id: '3', providerName: 'Johnathan', followerCount: 45414,  category: 'Personal Driver', location: 'New York, NY',    sharedBy: 'Jennifer Driver', count: 3 },
];

const PHOTO_BG = ['fv-jamie', 'fv-john', 'fv-steve'];

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function SocialPostsScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();

  return (
    <div className="flex-1 flex flex-col bg-cr pb-32 overflow-y-auto">
      {/* hero */}
      <div className="flex flex-col items-center pt-8 pb-4">
        <div className="w-24 h-24 rounded-full bg-g flex items-center justify-center
                        shadow-card mb-3">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z"
                  fill="rgba(255,255,255,0.18)" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
      </div>

      {/* headline */}
      <div className="px-7 text-center pb-6">
        <h1 className="text-[20px] font-extrabold text-black leading-tight mb-2">
          Rainmakers have shared their go-to services on Cergio to 2M+ followers.
        </h1>
        <p className="text-[14px] font-extrabold text-g">#cergiorainmakers</p>
      </div>

      {/* posts */}
      {POSTS.map((post, i) => (
        <div key={post.id} className="px-5 py-5 border-t border-bdr">
          {/* header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#4478aa] to-[#2a5070]
                            flex items-center justify-center text-white font-extrabold text-[13px]">
              {getInitials(post.providerName)}
            </div>
            <div>
              <p className="text-[14px] text-black leading-tight">
                <span className="font-extrabold">{post.providerName}</span> was shared to {post.followerCount.toLocaleString()} followers
              </p>
              <p className="text-[12px] text-g font-bold mt-0.5">
                {post.category} <span className="text-b3 font-medium">· {post.location}</span>
              </p>
            </div>
          </div>

          {/* photo placeholder using gradient */}
          {post.count === 1 ? (
            <div className={`h-[180px] rounded-[14px] overflow-hidden relative ${PHOTO_BG[i % 3]}`} />
          ) : (
            <div className="grid grid-cols-3 gap-1 rounded-[14px] overflow-hidden">
              {Array.from({ length: post.count }).map((_, j) => (
                <div key={j} className={`h-[100px] relative ${PHOTO_BG[(i + j) % 3]}`} />
              ))}
            </div>
          )}

          {/* shared by */}
          <p className="text-[12px] text-g font-bold mt-3">Shared by {post.sharedBy}, Rainmaker</p>
        </div>
      ))}

      {/* sticky CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr px-5 pt-3 pb-6 border-t border-bdr">
        <button
          onClick={() => navigate('/rainmaker-request')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Review Gervon's request
        </button>
      </div>
    </div>
  );
}
