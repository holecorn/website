// The Hole Corn wordmark: two chalky, boxed, angled words forming a shallow V,
// coloured to match the two teams. A stylised take on a chalk-on-tarmac drawing.
//
// The geometry here is duplicated in public/logo.svg, which is what the LED panel's
// wordmark is generated from — src/Logo.test.js holds the two together.
//
// The tilt is 8 degrees rather than the 15 it was drawn at, and it matches the panel, which
// needed the shallower angle to fit 32 rows at a legible size. A rotated box is much taller
// than its content, so easing the tilt gives back 13px of the setup screen's height at the
// 320px the logo is capped to.
//
// The viewBox is trimmed to what the mark **paints**, which is not what getBBox reports: a
// <text> bbox includes the font's descender space, and deriving the box from it left 8.7
// units of dead space above the mark and 11.0 below. On screen that was 50px of gap above
// the mark and 37px below against the setup screen's 20px rhythm. Trimmed, the element is
// 80px tall rather than 101px and .setup-logo needs no margin at all. So don't re-derive
// this box from getBBox, and don't add margin back.
//
// The text's x is an *optical* centring, not a geometric one, so don't "correct" it to the
// box centre. Measured, x=3 put the glyph run within 1.5 units of dead centre — gaps of
// 17.4 and 17.8 units for HOLE — and still read as sitting right. Two units left balances
// it; -1 overshoots into looking left-biased. The panel's copy is centred geometrically
// instead: generate_logo.mjs fits each box to its own letters, and at 5 mm pitch the
// quantisation swamps a nudge this size.

// The chalk tint — a colour softened toward white so it reads as powder rather than ink —
// lives in `App.css` as `--chalk` now, because it only works one way round. Tinting toward
// white is what keeps the mark legible on the dark scheme and is exactly what erased it on
// the light one, where the same wordmark measured 1.19:1 against the page. So each word
// carries its team colour as `--team` and the stylesheet decides, the way every other
// team-coloured surface in the app does.

import { DEFAULT_COLORS } from './scoring.js';

export default function Logo({
  colorA = DEFAULT_COLORS.a,
  colorB = DEFAULT_COLORS.b,
  className,
}) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="82 44 276 69"
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
        <g className="logo-word" style={{ '--team': colorA }} transform="translate(156 78) rotate(8)">
          <rect x="-58" y="-24" width="116" height="48" rx="3" strokeWidth="4" />
          <text x="1" y="2" dominantBaseline="central" stroke="none">
            HOLE
          </text>
        </g>
        <g className="logo-word" style={{ '--team': colorB }} transform="translate(284 78) rotate(-8)">
          <rect x="-58" y="-24" width="116" height="48" rx="3" strokeWidth="4" />
          <text x="1" y="2" dominantBaseline="central" stroke="none">
            CORN
          </text>
        </g>
      </g>
    </svg>
  );
}
