# Holecorn

A mobile-first webapp for scoring games of Cornhole. Tap directly on a picture of
the board to record where bags land; Holecorn handles the cancellation scoring and
running totals for you.

## How scoring works

Holecorn uses standard **cancellation scoring**:

- A bag on the board = 1 point, a bag in the hole = 3 points.
- Each round, only the difference between the two teams' points is scored — the
  trailing team nets nothing that round.
- First team to reach the target (default **21**, win by 1) wins.

## Using it

A new game starts on a **setup screen** where you pick **Singles** or **Doubles**,
set each team's name(s) and colour (red, blue, green, yellow — so the on-screen
colours can match your physical bag sets) and the target score to play to, then
press **Start game**.

In **doubles**, each team has two players who share the team's colour. Since each
end is scored as its own round, the throwing partner alternates every round; the
scoreboard highlights whoever's up and dims the benched partner. Scoring is
otherwise identical to singles.

Each team has one **lane per bag**. A lane is a vertical track with three stops:

- **Hole** (top) — 3 points
- **Board** (middle) — 1 point
- **Floor** (bottom) — 0 points

Bags start **unthrown**, shown greyed out on the floor. Tap the stop where each
bag landed to throw it there. Dropping a bag in the hole sets off a sparkle burst
in the team's colour and a short haptic buzz (on devices that support vibration).
While *every* bag a team has thrown is in the hole (a **four-bagger** still on),
those bags jitter — starting at two in the hole and ramping up at three. The
jitter stops the moment any bag lands on the board or floor. If a team ends the
round with all four in the hole, committing it sets off the four-bagger
celebration (a sparkle explosion and flash) over that team. Because a bag on the
board can still be knocked into the hole or off onto the floor, you can move a
thrown bag between those stops at any time during the round — but once a bag has
been thrown it can't return to the unthrown state.

Committing a round can flash a cornhole callout: **WASH** on a tied round, and,
on the winning throw, **GAME** (or **SKUNK** when the loser is left on zero) with
a confetti burst in the winner's colours.

A small bag beside a team's name marks who throws first this round. Tap either
team's marker to set it (the opening coin toss, or a correction); after that it
moves automatically to whichever team scored in the previous round, and stays put
on a wash.

Both teams stay on screen with live running totals and each team's points so far
this round, so you can read the score mid-round. **End round** stays disabled
until every bag has been placed (a bag on the floor counts); a hint shows how
many are still to place. Press it to commit the round and update the totals.
**Undo round** rolls back the last committed round and restores its bags to the
lanes so you can correct and re-commit it. **New game** returns to the setup
screen, keeping the same teams (names and colours); if a game is in progress it
asks for confirmation first. During play, tapping a team's name reopens the name
and colour fields in a modal so you can adjust them without resetting the score.
The two teams can't share a colour.

The **round history** is a toggle on phones and portrait; on wide landscape
screens (e.g. an iPad in landscape) it's shown permanently as a right-hand
column instead.

The in-progress game is saved to the browser's `localStorage`, so it survives a
refresh. There is no backend and no account — everything runs client-side.

## Development

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173/)
npm run build    # production build to dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

## Deployment

Hosted on GitHub Pages at `holecorn.com`. Pushing to `main` triggers
`.github/workflows/deploy.yml`, which builds and publishes `dist/`. The custom
domain is pinned by `public/CNAME`; because the site is served from the domain
root, Vite's `base` stays `/` (so the PWA `scope`/`start_url` need no change).

## Tech

React 19 + Vite. Scoring rules live as pure functions in `src/scoring.js`
(framework-independent and easy to test); the per-bag scoring lanes are in
`src/Board.jsx`.

The brand is the two words "HOLE" and "CORN" in chalky, boxed outlines angled
into a shallow V — a stylised version of a chalk-on-tarmac family joke. The
in-app wordmark is `src/Logo.jsx`, which tints itself to the two teams' current
colours (so the setup screen recolours as you pick). `public/logo.svg` is a
static default-coloured copy of the same mark, and `public/icon.svg` is a clean
square version (no chalk texture, legible when tiny) used as the favicon.

The wordmark is set in [Bebas Neue](https://github.com/dharmatype/Bebas-Neue),
bundled at `public/fonts/BebasNeue-Regular.ttf` under the SIL Open Font License
(see `public/fonts/OFL.txt`).
