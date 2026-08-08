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
  - "tools/verify-lanes.mjs"
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

## The stats screen's caps

- **The stats screen caps at 1040px, the same number the play screen's wide tier uses**, so
  it fills an iPad rather than sitting in 237px gutters. It is capped *at all* because the
  components stop reading well well before a monitor's full width — the seven summary chips
  would inflate to 265px each, and a Recent match row would put the score a foot from the
  name. **`.stat-chips` is an auto-fit grid, so whether the seven chips orphan is a
  function of the width available**, and 720px missed fitting all seven by *four pixels*
  (`7 x 92 + 6 x 8 = 692` against 688), stranding SKUNKS on its own row.
- **The durability paragraph is capped separately, in `ch`.** Line length is a property of
  the text, not of the layout: at 1040px it runs to 136 characters against the 45-75 that
  reads comfortably. Don't fold it into the screen width — capping the screen for the sake
  of one paragraph is what kept this screen narrow in the first place.
  `verify-stats.mjs` covers all of the above, and two of those assertions were worthless
  when first written: centring measured `.stats-screen` itself, whose gutters were correct
  throughout, and the prose bound was a pixel threshold looser than the container's own
  padding. Both now measure the drawn sections and the rendered character count.

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
