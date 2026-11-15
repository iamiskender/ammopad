export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ammopad-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4d6d" />
          <stop offset="1" stopColor="#ff8fa3" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#ammopad-g)" />
      <path d="M7 24c5 0 7-3 9-8s4-8 9-8" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="25" cy="8" r="2.4" fill="#2ed3a0" />
    </svg>
  );
}
