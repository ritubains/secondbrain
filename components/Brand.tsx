// Second Brain mark: a ring of thoughts linked through the middle, on a teal tile — the app links
// what you say. Same drawing as app/icon.svg (the browser tab icon).
export const BRAND_NAME = "Second Brain";

export default function Brand({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center shrink-0 rounded-[30%] brand-gradient shadow-[0_6px_16px_-8px_rgb(var(--primary-rgb)/.6)]"
      style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24" fill="none">
        {/* a ring of thoughts, each linked through the middle — what the app does with what you say */}
        <path d="M12 3.6 4.2 9.2 6.8 19h10.4l2.6-9.8L12 3.6M12 3.6v8.6M4.2 9.2l7.8 3M19.8 9.2 12 12.2M6.8 19l5.2-6.8 5.2 6.8"
          stroke="#fff" strokeOpacity=".7" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
        {[[12, 3.6, 2], [4.2, 9.2, 2], [6.8, 19, 2], [17.2, 19, 2], [19.8, 9.2, 2], [12, 12.2, 2.6]].map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#fff" />
        ))}
      </svg>
    </span>
  );
}
