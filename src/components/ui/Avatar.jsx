// src/components/ui/Avatar.jsx
export function Avatar({ url, name, size = 50 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 bg-gl text-gd font-extrabold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : initials}
    </span>
  );
}
