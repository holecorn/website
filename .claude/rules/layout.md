---
paths:
  - "src/App.css"
  - "src/Stats.css"
  - "src/Tournament.css"
  - "src/Display.css"
  - "src/Panel.css"
  - "src/Lineup.css"
  - "src/GameStats.css"
  - "src/Positions.css"
  - "src/Chip.css"
  - "src/FormPips.css"
  - "src/index.css"
  - "src/Logo.jsx"
  - "src/Logo.test.js"
  - "src/App.jsx"
  - "src/main.jsx"
  - "src/css.test.js"
  - "tools/verify-lanes.mjs"
  - "tools/verify-schemes.mjs"
---

# Layout, responsive tiers and the wordmark

Detail behind **Conventions & gotchas** in the root `CLAUDE.md`, which holds the
source-order traps themselves — read those first, they bite hardest.

## The scoring lanes

- **Nothing in the scoring lanes stretches, and three caps enforce it.** The bag
  token is square (`aspect-ratio`, sized off the tier band's height, since that's
  the tight dimension), a lane track caps at 72px, and `.main` caps at 408px —
  which is exactly what the lanes need, so the header and buttons can't grow past
  the cards they sit above. **The landscape tier has to lift the `.main` cap**:
  there the two team cards sit side by side, and 408px between them collapses the
  lanes to about 28px. The token is centred with auto margins rather than a
  `translateX`, because the vibrate animation owns `transform`.
- **`tools/verify-lanes.mjs` is what holds all of those numbers**, because none of
  them is reachable from a unit test. The one worth understanding: it asserts the
  lane *reaches* 72px where there's room, not merely that nothing overflows. The
  408px cap spends its remainder on the `auto` tier-label column, so widening
  those labels or changing their font takes it out of the lanes and breaks nothing
  visible — measured, `hole · 3 points` instead of `hole · 3` silently costs 9px
  per lane. Overflow checks pass throughout; only the reaches-the-cap assertion
  fails.

## The wide and landscape tiers

- **The wide tier's grid is opt-in — `.app.play-screen` — and that is the fix for a trap
  that fired twice.** It was written as `.app:not(.setup):not(.stats-screen):not(.tournament-screen)`:
  the play screen described by naming every screen that isn't it. Every screen is an
  `.app`, so a new one inherited the grid by *default* and had to be excluded after the
  fact. Both times the symptom was the same and neither was caught before shipping — the
  content drops into the 408px first column while 340px stays reserved for a rail that
  never renders. Measured on an 11" iPad the stats screen sat **196px left of centre**
  with its ten-column career table in a 408px scroller, and it read as a slight offset
  rather than a broken layout because the mostly-empty box was itself perfectly centred;
  the tournament screen then drew its bracket in two of the four columns it wanted. It
  only misbehaves at iPad-class sizes, which is why every phone test passed. Opting in
  costs one class in `App.jsx` and defends itself: `verify-lanes.mjs` asserts the rail
  and the grid agree, and dropping the class fails it on all three wide devices, because
  `wideLayout` still renders the rail's panels with nothing to lay them out.
- **The wide tier and the landscape tier must not both match**, which is what the
  wide tier's `min-height: 451px` is for — the exact complement of the landscape
  tier's `max-height: 450px`. A big phone on its side (932x430 on an iPhone Pro
  Max) satisfies `min-width: 900px` *and* `max-height: 450px`, so before the guard
  both applied: the landscape tier put the two cards in a row and the wide tier,
  being later in source order, capped the column they shared. That is the lane
  collapse the point above says the lift prevents — 26px lanes, measured, on a
  phone. **The query is also duplicated in `App.jsx`** (`wideLayout`), because CSS
  decides where the rail's panels go and JS decides whether they render at all;
  they have to say the same thing or the panels appear with nothing laying them
  out and no toggle to dismiss them.
- **The landscape tier's 84px lane gives 28px tap zones, and the "79px of unused screen"
  that would pay for a taller one is a headless figure.** The 2026-08-06 review measured
  the play screen ending at y=351 in a 430px viewport and concluded the band was laid out
  short rather than squeezed. It is right about the cause — nothing spends the surplus,
  because 84px has to suit the shortest phone the tier covers — and wrong about the size
  of it, because a browser with no chrome and no safe area is the *installed* case.
  Measured on an iPhone 17 Pro: landscape is **874x402 installed and 874x292 in a Safari
  tab**, `svh` 292 against `lvh` 402, so the toolbars cost **110px**.
  - **Installed there is 38.8px spare, not 79**, since the screen is 402 tall rather than
    the review's 430 and the content is 363. Spending all of it reaches **40.9px** — still
    under the 44 every touch guideline agrees on. Dropping `Made with ♥` in landscape as
    well reaches **52.3px**, and is the only version that clears it.
  - **In a tab there is no surplus at all**: 363px of content into 292 is a **71px
    deficit**. The screen already scrolls and the secondary row is already below the fold,
    so `Undo round` needs a scroll — which is arguably the worse fault and is not in the
    review either. `End round` stays visible throughout, at y=259.
  - **Not built, because this group scores in portrait**, and portrait is healthy: 56px
    zones with the whole button row above the fold at 402x874. **Don't re-derive the 79px
    from the review** — the figure only exists on a device nobody is holding.
  - **If it is ever built:** `dvh`, not the `svh` the rest of the app uses. `svh` would
    pin the layout to 292 for ever and forfeit the 110px even after the toolbars have
    retracted; `dvh` follows, and a `minmax(84px, 1fr)` floor on the lane row is what
    makes that safe — at 292 every variant falls back to today's 84px lane and today's
    scroll rather than clipping.
  - **`verify-lanes.mjs`'s `MIN_LANE = 44` is on the lane's *width*, and the tap target's
    tight dimension is its height.** Nothing measures the zone's height, which is how 28px
    shipped past a check whose whole subject is the lane's geometry. Worth fixing before
    the layout is, if it ever is.
- **The landscape tier has no horizontal `env()`, and `viewport-fit=cover` is set.**
  Measured on the same phone, landscape safe-area insets are **T 0, R 62, B 20, L 62**, and
  `.app` carries 14px of side padding — so each team card paints 48px into a region the
  rounded corner and the Dynamic Island are in. Portrait is unaffected, and not by luck:
  `apple-mobile-web-app-status-bar-style` is **`black`** rather than `black-translucent`, so
  iOS starts the web view below the status bar and `safe-area-inset-top` reports 0. Only
  `.footer` reads an inset at all, and only the bottom one. Rides with the point above —
  landscape-only, so unfixed for the same reason.

## The wordmark

- **The wordmark's geometry lives in two files, and `src/Logo.test.js` holds them
  together.** `src/Logo.jsx` draws it in the app; `public/logo.svg` is what
  `firmware/hub75/generate_logo.mjs` bakes for the LED panel. They can't be merged — the
  component takes the team colours as props, the generator needs a file to hand a browser —
  so a divergence would leave the panel showing the shape the SVG last held, visible only
  as a splash that looks slightly wrong next to the phone.
  - **The tilt and the viewBox are pinned as a pair.** The mark leans 8°, not the 15° it
    was drawn at, and the viewBox is sized to that: a rotated box is much taller than its
    content, so easing the tilt gave the setup screen **13px** of height back. Easing the
    tilt without re-deriving the box spends that on empty space; re-deriving the box
    without the tilt clips the mark. The test fails either way round — measured, a box
    trimmed to the painted mark gives an aspect of 4.00 at 8° and 3.37 at 15°, and the
    bound sits between them.
  - **The viewBox is trimmed to what the mark *paints*, not to `getBBox`.** A `<text>`
    bbox includes the font's descender space, so deriving the box from it left 8.7 units
    of dead space above the mark and 11.0 below — on screen, **50px of gap above the mark
    and 37px below against `.setup`'s 20px rhythm**, since the margins sat on top of it.
    Trimmed, the element is 80px rather than 101px and `.setup-logo` needs no vertical
    margin at all: below the mark you get the flex gap, above it the screen's own
    `padding-top`. Adding margin back, or re-deriving the box from `getBBox`, brings the
    gap back with it.
  - **The text's `x` is an optical centring — don't "correct" it to the box centre.**
    Measured, the original `x=3` had the glyph run within 1.5 units of dead centre (gaps of
    17.4 and 17.8 units for HOLE) and still read as sitting right; `x=1` balances it and
    `x=-1` overshoots into looking left-biased. Two other criteria disagree with the eye
    here and both are wrong: bounding-box centring wants 3.5, and centre-of-mass wants 6.2
    for HOLE against 1.7 for CORN, because `H` is heavy where `L` and `E` are light. The
    panel's copy is centred *geometrically* instead — `generate_logo.mjs` fits each box to
    its own letters, and at 5 mm pitch the quantisation swamps a nudge this size.
  - **`public/icon.svg` and `public/app-icon.svg` are still at 15°**, deliberately. They
    are an abstract pair of filled boxes rather than the wordmark, and changing them means
    re-rasterising three committed PNGs and moving everyone's installed home-screen icon.

## The name fields' row

- **The name fields' row is `.field-row`, not `.name-row`, and that is the
  `.app.stats-screen` trap again.** The play screen's header already owns
  `.name-row` further down `App.css`, with a different `gap` and no `width`, so at
  equal specificity source order would have silently won and the fields' rows would
  have run at the header's spacing. Caught before it shipped only because the class
  was grepped; **a new row-shaped surface needs a new class or the two-class form.**
  The `.first-bag` glyph *is* shared on purpose — nothing redeclares it, only
  `.field-row .first-bag::before` adds a target.

## The two colour schemes

The app was dark-only, and the phone is the thing held in the sun. Measured before this,
the play screen's mean luminance was **33.6/255** with 0.4% of pixels above mid-grey —
about 13% of what a light UI emits at the same backlight, where outdoors the limit is
emitted light against reflected glare. It is 230.7 on the light scheme now.

- **There is no in-app toggle, and that is the design rather than a stage it hasn't
  reached.** The trigger for this is sunlight, and the OS already has the control: on iOS
  the Appearance switch sits under the brightness slider in Control Centre, which is the
  same gesture as putting sunglasses on. A second switch in the app is a preference to
  persist, a place on a screen to put it, and a frame of the wrong scheme on every load,
  all to duplicate something people already know how to do. `prefers-color-scheme` covers
  both the person who runs their phone light and the person who flips it in the field.
- **Every colour is one `light-dark(light, dark)` declaration in `index.css`, and nothing
  re-declares a palette anywhere.** That is what lets the board opt out for free — see
  below — where a `@media (prefers-color-scheme: light)` block would have to be undone
  with a second copy of the dark values.
- **A team colour is *derived* for the light scheme, not re-picked.** `PALETTE` is chosen
  to be read on a dark panel and all four are too pale for a white one: measured as text
  on `--panel`, green is **2.61:1** and yellow **1.44:1** against the 4.5 small text needs.
  `--team-accent` scales OKLCH lightness by 0.62, which keeps the hue and clears it — 4.8
  at worst — so there is no second palette, no second constant to mirror into the
  firmware, and archived records keep meaning what they said. Chrome's painted output
  matches the arithmetic in `css.test.js` to within one channel step.
  - **Scaled and not clamped, and that distinction is the whole of it.** `min(l, 0.5)` was
    the obvious form and shipped first: it flattens all four to one lightness, which is
    the only channel a red-green dichromat has left. Measured as CIEDE2000 under
    deuteranopia, **red against yellow fell from 17.1 to 2.6** — closer than the red/green
    pair this file's two-channel note already calls "the same colour" — while in normal
    vision the two stayed 32 apart, so nothing looked wrong. Scaling keeps the ordering
    (yellow stays lightest, L 0.53 to red's 0.41) and puts red/yellow back to 10.2.
  - **Some loss is structural and is accepted.** A light page forces every colour *down*,
    so the range the four can spread over is smaller: the worst pair is **5.5 against the
    dark scheme's own 7.5**, and matching 7.5 needs a factor near 0.72, which drops the
    contrast floor to 3.4:1. 0.62 is the largest factor clearing 4.5:1 on `--bg` — 4.81
    against 4.49 at 0.64 — so the four are as far apart as legibility allows. Both bounds
    are asserted, and they pull against each other: loosen one and the other fails.
  - **The separation floor is 5, and it is set to catch a collapse rather than the
    squeeze.** Asserting light ≥ dark was the first form and is unreachable for the reason
    above. `css.test.js` carries CIEDE2000 and the Brettel/Viénot dichromat projections
    for this; the factor is read out of `index.css` rather than written down twice, and
    both the scale and the clamp forms are parsed, so putting the clamp back fails the
    floor by name instead of killing the file at import.
  - **Yellow becomes a dark gold and that is accepted.** The four stay well apart in hue,
    and per the two-channel rule the *name* carries the meaning everywhere anyway.
  - **Declared on `*`, not on a list of the classes that set `--team`.** Such a list is a
    thing to keep in step and this is not: an element handed `--team` simply has
    `--team-accent`, and its descendants inherit it. Where `--team` is unset the
    declaration is invalid at computed-value time, so `var(--team-accent, …)` takes its
    fallback — `FormPips` relies on exactly that for the career table, which has no teams.
- **An inline style beats every stylesheet, so a team colour written into `color` or
  `background` could never be re-derived** — which is how all of this stood before, at
  ~25 sites across six components. They hand the raw value over as `--team` and
  `.team-ink`/`.team-fill` (or the element's own rule) derive from it.
  `css.test.js` refuses a `style={{ … }}` that names a paint at all, in any of its three
  shapes; the one real miss when this was written was `style={cond ? { background } : …}`,
  which is not `style={{` and had survived a grep.
- **`--on-accent` flips with the fill it lands on.** Near-black on the dark scheme, where
  white clears none of the four; white on the light one, where every accent has darkened
  to reach the page and near-black would clear none of them. One rule either way round:
  an accent fill takes `--on-accent` and never a colour of its own.
- **The three UI accents became variables here** — `--go`, `--warn`, `--caution`, which
  were 28 loose literals across four stylesheets. They are ink as often as fill, so each
  clears 4.5:1 as text on both `--bg` and `--panel` *and* carries `--on-accent` at 4.5:1
  when filled. They share hexes with `PALETTE`'s red and green on the dark scheme **by
  coincidence** and must not be made to move with them.
- **A surface tint has one base, `--lift`, and each site keeps its own alpha.** White on
  the dark scheme and black on the light one, mixed with `color-mix(… , transparent)`, so
  only the direction is themed. Note that a tint mixed towards `transparent` is not a
  fill: the panel behind it is what ink actually lands on, which is why `css.test.js`
  resolves such a value to null rather than measuring against a solid white.
- **The lane's three bands needed their own light values, and the reason is the bag.**
  The bands are a wash over the card, so on a light page they can only go *down*, and the
  dark scheme's alphas are a far bigger step on white than on `--panel`: measured, they
  took the worst bag-against-its-band contrast to **2.73:1**, under the 3:1 a graphic that
  size wants, with the hole band spending it. 0.14/0.02/0.09 puts it back to 3.91 against
  the dark scheme's own 4.11, with the track still clearly a track at 1.38:1.
- **The wordmark's chalk tint only works one way round.** Tinting toward white is what
  makes it read as powder on the dark scheme and is exactly what erased it on the light
  one — measured, **1.19:1** against `--bg`. So `--chalk` drops the tint on light rather
  than reversing it: the derived team colour is already a mid-dark pigment, and mixing
  toward black instead just reads as a different, muddier ink. This is why `Logo.jsx` no
  longer computes `chalk()` itself.
- **The board opts back out, in `main.jsx`, by pinning `color-scheme: dark`.** A tablet
  propped against a fence is emissive and is not held in the sun, and `Display.css` paints
  its own near-black either way — so what a light scheme actually does there is flip
  `--text` and `--muted` to near-black *on* that near-black. **Measure that as contrast,
  never as luminance:** dropping the pin barely moves the mean, so a luminance bound
  passes while the board reads blank. Verified by mutation.
- **Lightning CSS rewrites `light-dark()` unless `build.cssTarget` says otherwise, and the
  rewrite is silently one-way.** At the default target every `light-dark(a, b)` becomes a
  `--lightningcss-light`/`--lightningcss-dark` pair switched by a `prefers-color-scheme`
  media query. The app still follows the phone and looks exactly right — and nothing
  answers to `color-scheme` any more, so the board's pin stopped working with nothing
  failing. The target is named in `vite.config.js` now. It is **not** a new floor:
  `--team-accent` uses relative colour syntax, which Lightning CSS cannot downlevel and
  passes straight through, so an older browser was already going to lose the team colours
  entirely. `tools/verify-schemes.mjs` is what caught it, and holds it.
- **Playwright defaults to `colorScheme: 'light'`, so every other browser check now
  measures the light scheme.** Harmless for the geometry ones — layout is scheme
  independent — but it is why a check may not compare a colour against a literal hex. Two
  did and both went red on rules that were working; they read the variable through a probe
  element instead. See `.claude/rules/testing.md`.

## Ink on a fill

- **`--on-accent` is the only ink a filled accent may take, and white is never it.**
  Measured against the four colours the app fills with: white is **2.87:1** on `#27ae60`,
  **3.48:1** on `#eb5757` and **1.59:1** on `#f2c94c`, where small text needs 4.5:1.
  `#0b1116` clears all four (6.61, 5.46, 4.91, 11.97). Seven rules were affected —
  `.start-game`, `.end-round`, `.confirm-primary`, `.confirm-danger`, `.draw-go`,
  `.ceremony-pull` and `.winner-banner` — and the review that found it named two, because
  the other five are on screens it sampled less.
  - **`Display.css` reached the same value first and held it as a literal**, which is how
    the phone and the board came to disagree about the same fact: the board's banner was
    11.97:1 on yellow while the phone's was 1.59:1. It reads through the variable now.
  - **Darkening the green instead was measured and rejected.** White reaches 4.5:1 only at
    about `#1d8348`, which drops the button's own contrast against the page from 6.44:1 to
    **3.87:1** — a primary button starting to sink into the background — and gives the app
    a second green, since `#27ae60` is also the `.recent-mark` bar and the
    `.tie.is-playable` border, where darkening costs contrast rather than buying it.
  - **The winner banner is the rule nothing in the stylesheets can see.** Its fill is an
    inline style off `colors[winner]`, so the CSS holds an ink with no background beside
    it and the pairing exists only at runtime — and it is the rule with the worst figure,
    because it wears the yellow whenever the yellow team wins.
- **`PALETTE`'s blue is set by contrast, not by taste.** A team colour is text as well as
  fill — the lane header, the name input, the history cells, the toss line — at 10–13px,
  so it needs 4.5:1 on `--panel`. `#2f80ed` sat at **4.15**; `#448def` is **4.81** and is
  the smallest step that clears it. The other three already did. **Changing one costs a
  matching edit to `SPLASH_PALETTE` in `hub75.ino`**, which the mirrored-constants step in
  `npm run test:firmware` will not let you skip, and it raises that colour's LED duty
  (0.539 → 0.586 channel-mean) — well inside `DUTY_CEILING`, but not free.
  - **Existing saves and archived records keep the old hex.** Nothing breaks: a stored
    `#2f80ed` simply matches no swatch and, in a *casual* game only, falls back to
    `Team A` rather than `Blue`. `New game` resets it. Worth knowing before assuming a
    fixture with the old blue is stale.

## The celebration paints behind the result

- **`.scoreboard` and `.winner-banner` carry a `z-index` and the confetti carries a lower
  one, because the celebration was covering the thing it celebrates.** 70 pieces fall on a
  skunk and half of them are the winning team's own colour, over a 56px figure in that same
  colour. Measured at 390x844 on the worst case the app can make — four in the hole twice,
  24–0, so a skunk *and* a four bagger: a peak of **34 pieces over the header band and 6 on
  the winning digits' own ink, covering 24.9% of it**, for about 350ms of the 1.7s fall.
  - **The 2026-08-06 review counted 27 of 70 over "the score band" and that overstates it.**
    The band is mostly empty: at the worst frame only 6 of those 27 are anywhere near a
    glyph, which is why the fix is paint order rather than fewer or slower pieces. The band
    figure is still the right one for the *header*, and the two numbers are not in conflict.
  - **Neither element gains a background, so nothing is hidden.** They are transparent but
    for the winner card's `--lift 6%` wash, so the pieces still fall visibly across the
    band and simply lose where they meet the text. Thinning the confetti or steering it
    round the header buys the same legibility and costs the celebration; a band the pieces
    visibly avoid is also a rectangle nobody drew.
  - **The markup is half of it, and neither half is visible in the other.** `Confetti` used
    to be a *child* of `.callout`, which is `z-index: 10` — from in there no z-index can put
    it behind anything, so the lift only works with the component moved out to a sibling.
    That is also why `.confetti` is `position: fixed` rather than `absolute`: outside
    `.callout` there is no positioned ancestor, so `absolute` would measure the document
    where the pieces' `vh` fall assumes the viewport.
  - **The two siblings must not share a key.** Both are keyed off `callout.key` and React
    reads them as one children set, so the obvious split gives a duplicate-key warning —
    which is a `console.error` in `npm run dev` and **nothing at all** in the production
    build the browser checks run against. Verified by mutation: the duplicate passes
    `verify-celebration.mjs` clean.
  - **`.four-bagger` at `z-index: 4` deliberately still wins.** It is `inset: 0` inside
    `.team-lanes`, so it cannot reach the header, and `.callout`'s own text has to stay
    above everything — the ordering is confetti 1, result 2, four bagger 4, callout 10. The
    two no longer coincide, per the next section, so nothing is stacked at 4 and 10 at once.

## The two big overlays are anchored to different boxes

- **`.four-bagger` is `inset: 0` inside a lane card and `.callout` is `inset: 0` on the
  viewport, so where they land relative to each other is whatever the layout says — and
  nothing held them apart.** They fire on the same commit, at 44px and 72px of Bebas.
  Measured on a four-bagger skunk: at 390x844 the two boxes sit **12px apart** (no overlap,
  but two lines of display type stacked), at 1024x768 the callout is centred on the
  *viewport* so half of it lands on the side rail's history table, and at 874x402 the cards
  are side by side and they **overlap by 17.1%** — the `S` of SKUNK! sitting on the `R!` of
  FOUR BAGGER!, which is the one case where a word is actually lost.
  - **So the callout carries the words and the reveal stands down**, rather than the two
    being positioned around each other. Which round that applies to, and why nothing is
    lost by it, is in `.claude/rules/scoring.md` — this is only the geometry.
  - **Re-anchoring the callout was the alternative and it fixes the narrower fault.**
    Centring it on `.main` instead of the viewport would take it off the rail at 1024px and
    stop it straddling the gap between the cards — but it puts it *on* the lane cards, which
    is where `.four-bagger` already is, so the landscape overlap gets worse rather than
    better. It also needs a positioned ancestor, which is the trap `.confetti` is `fixed`
    to avoid. Two overlays arranged more carefully is still two overlays; the review's
    complaint was that four things fire at once.
  - **The callout straddling the card gap is left alone deliberately.** Measured at 390x844
    its centre sits in the 14px between the two cards, which the review reads as
    "belongs to neither" — but it is the *game's* announcement rather than a team's, the
    banner directly above it names the winner full-width in their own colour, and the text
    is legible throughout. A full-screen flash centred on the screen is the design.
  - **`.callout-four` sits inside `.callout-text` so one animation scales both lines**, and
    it is 30px against the outcome's 72px because the outcome is the headline. **That size
    is a width budget, not taste:** nothing clips or wraps a callout — `.callout` has no
    `overflow` and the text no `nowrap` — and the widest wording is `FOUR BAGGERS!`, which
    only a double-four-bagger wash produces. At 30px it is **212px at the animation's 1.2
    peak, inside a 320px screen with 52px either side**; at the outcome's own 72px it runs
    **68px past both edges**. `verify-celebration.mjs` measures exactly that, on the wash,
    at 320px — verified by mutation, dropping the `font-size` fails that assertion and only
    that one, and passes all 64 of `css.test.js`.
  - **Unlike almost every other measured width here, this one is not a Mac figure.** The
    callouts are Bebas Neue, which `index.css` self-hosts and `vite.config.js` precaches, so
    the deploy runner and a phone draw the same file — measured, Bebas is 139px against the
    fallback's 250px for `FOUR BAGGERS!` at 30px, so a miss would be obvious rather than
    marginal. The `system-ui` caveat that applies to `.setup-top` and `.end-round` does not
    reach anything inside `.callout`.

## The stats screen's caps

- **The stats screen caps at 1040px, the same number the play screen's wide tier uses**, so
  it fills an iPad rather than sitting in 237px gutters. It is capped *at all* because the
  components stop reading well well before a monitor's full width — the seven summary chips
  would inflate to 265px each. **`.stat-chips` is an auto-fit grid, so whether the seven
  chips orphan is a function of the width available**, and 720px missed fitting all seven by
  *four pixels* (`7 x 92 + 6 x 8 = 692` against 688), stranding SKUNKS on its own row.
  - **This note used to credit the cap with the Recent match row as well, and it never
    bought that.** Measured with the sample archive loaded, the gap between the last name
    and the score is 139px at 390px, 517px at 768px and **789px at the cap** — a foot,
    which is what the 2026-08-06 review found. A cap cannot fix it, because the row is a
    *line of text* and 1040px of it is ~114 characters at 14px `system-ui`; the same
    line-length argument the durability paragraph is capped by, one section down. So it is
    fixed on the row — see the next section — and what the cap still earns is the chips and
    the gutters.
- **The durability paragraph is capped separately, in `ch`.** Line length is a property of
  the text, not of the layout: at 1040px it runs to 136 characters against the 45-75 that
  reads comfortably. Don't fold it into the screen width — capping the screen for the sake
  of one paragraph is what kept this screen narrow in the first place.
  `verify-stats.mjs` covers all of the above, and two of those assertions were worthless
  when first written: centring measured `.stats-screen` itself, whose gutters were correct
  throughout, and the prose bound was a pixel threshold looser than the container's own
  padding. Both now measure the drawn sections and the rendered character count.

## The Recent match row holds its score against the matchup

- **`.recent-teams` shrink-to-fits and `.recent-chevron` takes `margin-left: auto`**, so the
  slack a wide screen leaves lands between the score and the disclosure marker rather than
  between the matchup and its score. The gap is 10px — the row's own `gap` — at every width
  from 320 to 1920px, against 139–789px before.
- **The alignment that was given up carried no information, which is the whole argument.**
  Growing the names box right-aligned the score into a column, and that column cannot be
  read down: `22–8` is team a first, so which side won depends on the *names* beside it. The
  rivals list is the same shape one section up and is right to keep it — a `W–L` from the
  subject's point of view genuinely compares down the column, which is also why it carries a
  caption and this row does not. **Don't unify the two.**
- **A column also cannot close the gap even when capped**, because it has to be as wide as
  the widest row: measured over all 156 records in the sample archive, the widest matchup is
  201px (`Neil & Rho v Omega & Omicron`) against a **median of 76px**, so the typical row
  would still sit 125px short of its own score.
- **The phone is where this cost something, and it is a small aesthetic cost.** Clipping does
  not move at all — 2 of 12 rows clip at 320px, 1 at 360px, none at 390px and above, before
  and after — because the names box was already the only shrinkable item on the row. What
  changes at 390px is that the score's left edge is ragged and the marker sits up to 138px
  right of it, which is the gap the score used to sit at. A trailing disclosure marker on the
  row's own edge is the ordinary pattern, and the rows read as sentences.
- **Three alternatives, all measured, all rejected:**
  - **Cap the card** (`.recent { max-width: 560px }`) — one declaration, provably a no-op
    below the cap, and it reads exactly like the phone. But it leaves a 560px card under a
    1008px table with 448px of dead space beside it, which reads as unfinished. Capping the
    element rather than the screen is the right instinct; here the content can fill the width
    once the score travels with the name.
  - **Cap the names box** (`max-width` on `.recent-teams`) — keeps the column, but the score
    then sits *left*-aligned at a fixed x with the row's right third empty, and a matchup
    longer than the cap clips at 1194px where 800px is spare. Clipping a name where there is
    room for it is what the sticky career column taught, in miniature.
  - **A media query, so the phone keeps its column** — works, and buys an aesthetic at the
    price of a breakpoint and of the row meaning two different things at two widths.
- **`verify-stats.mjs`'s wide block holds both halves**, measured off the text's ink rather
  than the box — the box is what used to grow, so reading the box reports no gap however far
  the score has drifted. Restoring `flex: 1` fails the gap assertion at 770px and nothing
  else; dropping the chevron's anchor fails the marker assertion at 774px and nothing else.
  Both mutations pass all 770 unit tests.

## The side rail

- **The court and the history are wrapped in one `.side-rail`, which is
  `display: contents` until the wide tier.** They have to be a single grid item:
  placed separately in column 2 they auto-place into *different rows*, and row 1
  is as tall as `.main`, so the history lands level with the footer instead of
  under the court. `contents` is what keeps the wrapper from changing anything on
  a phone — both panels stay direct flex children of `.app`, so they keep its gap
  and `.history-panel:empty` still collapses a hidden history. The rail is capped
  at `100vh - 32px` and the history shrinks and scrolls inside it, rather than the
  history carrying a `max-height` that would have to know the height of the panels
  above it. **The history is last in the rail because it's the panel whose height
  varies with the game**, so it absorbs what the court and the stats leave instead
  of being moved by them — measured down to a squeezed 900x440, the other two keep
  their size and the rail never overflows. That panel is `flex-direction: column`
  rather than the default row: in a row its empty-state paragraph sizes to its
  text and reads as a half-width card next to two full-width ones.
