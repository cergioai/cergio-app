export function Logo({ size = 36 }) {
  const r = size * 0.44;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {/* outer ring — soft mint */}
      <svg className="absolute inset-0 animate-spin-slow" width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#9ED375"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${r * 0.87} ${r * 2.2}`}
        />
      </svg>
      {/* inner ring — kelly green */}
      <svg className="absolute inset-0 animate-spin-rev" width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#4AA901"
          strokeWidth={size * 0.06}
          strokeLinecap="round"
          strokeDasharray={`${r * 1.6} ${r * 1.5}`}
        />
      </svg>
      {/* centre — light mint cushion + green dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="rounded-full bg-gl flex items-center justify-center animate-pulse-ball"
          style={{ width: size * 0.55, height: size * 0.55 }}
        >
          <div
            className="rounded-full bg-g"
            style={{ width: size * 0.19, height: size * 0.19 }}
          />
        </div>
      </div>
    </div>
  );
}
