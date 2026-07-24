// The Hole Corn wordmark: two chalky, boxed, angled words forming a shallow V,
// coloured to match the two teams. A stylised take on a chalk-on-tarmac drawing.

// Tint a colour toward white so it reads as powdery chalk and stays legible on
// the dark background.
function chalk(hex, amount = 0.28) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export default function Logo({ colorA = '#2f80ed', colorB = '#eb5757', className }) {
  const chalkA = chalk(colorA);
  const chalkB = chalk(colorB);
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="80 28 280 100"
      role="img"
      aria-label="Hole Corn"
    >
      <defs>
        <filter id="holecorn-chalk" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="4" xChannelSelector="R" yChannelSelector="G" result="wob" />
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" seed="3" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.0 1.1" result="grainA" />
          <feComposite in="wob" in2="grainA" operator="in" />
        </filter>
      </defs>
      <g
        filter="url(#holecorn-chalk)"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        fontFamily="'Bebas Neue',sans-serif"
        fontWeight="400"
        fontSize="44"
        letterSpacing="7"
        textAnchor="middle"
      >
        <g transform="translate(156 78) rotate(15)">
          <rect x="-58" y="-24" width="116" height="48" rx="3" stroke={chalkA} strokeWidth="4" />
          <text x="3" y="2" dominantBaseline="central" fill={chalkA} stroke="none">
            HOLE
          </text>
        </g>
        <g transform="translate(284 78) rotate(-15)">
          <rect x="-58" y="-24" width="116" height="48" rx="3" stroke={chalkB} strokeWidth="4" />
          <text x="3" y="2" dominantBaseline="central" fill={chalkB} stroke="none">
            CORN
          </text>
        </g>
      </g>
    </svg>
  );
}
