// Per design-spec.md — choose how to add photos/videos.
import { useNavigate } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';

export function ServiceListPhotosIntroScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Last step, add some photos and videos to your profile!"
        minHeight={420}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32">
        <button
          onClick={() => navigate('/list-service/photos-pick')}
          className="w-full bg-white border border-bdr rounded-[18px] py-5 px-4
                     flex items-center gap-4 mb-3 hover:border-g/40 transition-colors"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
            <path d="M5 21h14" />
          </svg>
          <span className="text-body-lg font-extrabold text-black">Upload photos and video</span>
        </button>

        <button
          onClick={() => navigate('/list-service/photos-pick')}
          className="w-full bg-white border border-bdr rounded-[18px] py-5 px-4
                     flex items-center gap-4 hover:border-g/40 transition-colors"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-body-lg font-extrabold text-black">Take new photos and videos</span>
        </button>
      </div>

      <RegFooter
        progress={0.65}
        onNext={() => navigate('/list-service/photos-pick')}
      />
    </div>
  );
}
