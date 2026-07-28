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
colours can match your physical bag sets) and the target score to play to (up to
99, which is what the external scoreboard can display), then press
**Start game**.

In **doubles**, each team has two players who share the team's colour, standing at
opposite boards. Since each end is scored as its own round, the throwing partner
alternates every round; the scoreboard highlights whoever's up and dims the
benched partner. Scoring is otherwise identical to singles.

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
screen, keeping the same teams (names and colours); if a game is still in
progress it asks for confirmation first, but once someone has won it just goes —
the result is already saved to your stats. During play, tapping a team's name reopens the name
and colour fields in a modal so you can adjust them without resetting the score.
The two teams can't share a colour.

The **round history** is a toggle on phones and portrait; on wide landscape
screens (e.g. an iPad in landscape) it's shown permanently in a right-hand
column instead, below the court diagram.

**Game stats** sits above the history in that column, and is a toggle on phones.
It reports this game only, per player: rounds thrown, PPR (raw bag
points per round), the share of bags in the hole and in play, the best round, and
a four-bagger count beside anyone who has thrown one. Under the table is the
round, wash and four-bagger count for the game. In doubles each partner is
credited only the rounds they actually threw, so their round counts are about
half the game's. There's no win/loss or streak, because the game isn't over.

The history comes last in that column because it's the panel that grows with the
game: the court and the stats keep their size and the history takes whatever
height is left, scrolling rather than running off the bottom.

## Where everyone stands

**Positions** draws the court from above — both boards, each flanked by its two
pitcher's boxes — and shows who is standing where this round. Whoever is throwing
is outlined in their team colour, with a dot marking the box that throws first,
an arrow pointing at the board they're aiming at, and anyone waiting their turn
dimmed. It's a toggle on phones, opening just below the buttons; on wide landscape
screens it's permanently on show at the top of the right-hand column, above the
round history.

In **singles** both players walk down to the other board after every round,
keeping to their own side of the court, so only the end they throw from changes.
In **doubles** nobody walks — partners keep their board for the whole game — but
the two players at a board trade pitcher's boxes each time they throw, which
comes round every second round. Waiting players are drawn in the box they'll
throw from next, not the one being used this round.

The starting arrangement is set on the setup screen, underneath the team names:
**Swap sides** mirrors the whole court, and in doubles each team gets a button to
swap which partner stands at which board. Swapping a pair over also swaps **who
throws first** for that team, because the partner at the starting board is the one
who opens — the two aren't separate settings. It's all fixed once the game starts,
because past rounds are credited to players by the board they were standing at.

These are the conventions this group plays, not a rulebook: in particular, when
singles players walk down they each keep their own side of the court.

The in-progress game is saved to the browser's `localStorage`, so it survives a
refresh. There is no backend and no account — everything runs client-side.

## Stats

Finishing a game files it away, and the **Stats** button on the setup screen
reports what has built up. Only completed matches count — walking away from a
game part-way leaves nothing behind, so a three-round fragment can't drag the
averages around. Undoing a winning round takes the match back out again.

Per player you get matches played, won and lost, **rounds thrown**, **PPR** (raw
bag points per round, before cancellation — the number cornhole players quote),
the share of bags that went in the hole and the share that stayed in play,
four-baggers, best single round, and the current win streak. Rounds sits next to
PPR because it's the number PPR is averaged over — and in doubles it's the more
honest measure of how much someone actually played, since partners alternate and
only throw half the rounds of a match. Alongside that there's a head-to-head
record for everyone who has played each other, and totals for washes, skunks and
average match length.

Players are matched up by name, ignoring capitals and stray spaces, so "neil"
and "Neil " are the same person — but renaming someone starts a new history for
them. In doubles both partners share the match result, while bag stats go to
whoever actually threw that round.

**Tap a row under Recent matches** to open it up round by round: how each team's
four bags landed, what the round netted after cancellation, and the score as it
stood after it — so you can see where a game turned, which round the four-bagger
came in, and which rounds washed. In doubles it also names whichever partner was
throwing. Tap again to close it. Underneath, it says how many rounds it went and
how long it took (older games saved before Holecorn started timing them just
leave that out).

Each row also has a **×** to delete that match — handy for a game that was
mis-scored, or for clearing out test games. Deleting is immediate, with an
**Undo** offered at the top of the screen until you leave it.

### Keeping the history

There's no account and no server, so the history lives in the browser on the
device that did the scoring. That means a few things worth knowing:

- It's **per browser**, not per device — Safari and Chrome on the same phone
  keep separate histories.
- On iOS, the **home-screen app and a Safari tab don't share storage either**,
  so pick one and stick to it. The home screen is the one to pick.
- In a plain Safari tab, iOS **deletes the history after about a week** of not
  opening the site. Adding Holecorn to your home screen exempts it from that.

The stats screen tells you which of those you're in: it asks the browser whether
it will keep the data and shows the answer, so you're not guessing. If it says
it won't, add Holecorn to your home screen.

**Export as JSON** writes the whole history to a file, and the screen nudges you
when there are matches you haven't exported since. **Import JSON** reads one
back — that's how you move to a new phone, restore after clearing your browser,
or fold in a history that was scored on someone else's device. Importing merges
by match, so re-importing the same file, or one that overlaps what you already
have, adds nothing and can't create duplicates.

## External scoreboard

Holecorn can mirror the score onto a second screen — a spare tablet or laptop
propped up where everyone can see it, standing in for a physical seven-segment
board. The display shows the **logged** score (committed rounds only), so it
moves once a round rather than flickering as bags are tapped.

Because the app is served over HTTPS it can't talk directly to something on your
local network, so the two ends meet at an MQTT broker instead. You'll need one
that accepts WebSocket connections — [HiveMQ
Cloud](https://www.hivemq.com/mqtt-cloud-broker/) and
[EMQX](https://www.emqx.com/en/cloud) both have free tiers. For a quick try
without signing up, the public test broker `wss://broker.emqx.io:8084/mqtt`
works with no username or password (it's public, so pick an obscure game code).

On the setup screen, open **External scoreboard** and fill in the broker URL,
credentials and a **game code** (the **New** button generates one), then tick
**Publish the score**. **Copy display link** gives you a URL that opens the
display already configured — send it to the tablet and open it there, or press
**QR code** and scan it with the tablet's camera instead. The
display keeps its own screen awake where the browser allows it, and tapping
anywhere on it toggles fullscreen (browser chrome otherwise eats the height the
digits want; iOS Safari won't fullscreen a page, so it does nothing there).

The digits are sized for reading across a pitch: roughly 75mm tall on a 10"
tablet and 185mm on a 24" monitor, against the ~35mm that a 4m viewing distance
needs. Brightness, not size, is the limit outdoors — a tablet is very readable in
shade and washed out in direct sun, so site it accordingly rather than buying a
brighter screen.

When a game is won, the winner's digits flash — hollowing out to a bright rim
rather than blanking, so the score stays readable throughout. That's skipped for
anyone who has asked for reduced motion.

The display dims itself whenever the score might be stale, so a phone that has
wandered out of signal shows as dim rather than as a confident wrong score. Both
ends need internet; a phone hotspot is enough, though note ESP32-class hardware
is 2.4GHz-only, so a hotspot serving one needs **Maximize Compatibility** on.

Anyone who knows your broker details and game code can post to your scoreboard,
so treat the display link as a shared secret — note it carries your broker
**password** in the query string, so it ends up in browser history and in
whatever you paste it into. Use a broker user you can revoke.

### Watching the LED panel

Adding `&panel=1` to a display link opens the **panel emulator** instead: the
128x32 LED matrix in `firmware/hub75/`, one dot per LED, following the same live
game. It draws through the firmware's own layout, so what you see is what the
board will show — including the dimming, the four dashes before the first score
and the winner blink.

It is small on purpose. The panel is 128x32 whatever you view it on, and being
able to judge the real thing — whether the names are worth their nine characters,
say — is the point of looking at it. Use `?display=1` for a scoreboard you
actually want to read across a garden. The emulator has no wake lock and no
fullscreen tap, so a tablet left showing it will sleep.

### Choosing what the panel shows

Two arrangements fit a 128x32 panel, picked under **Panel layout** in the
**External scoreboard** settings:

| | shows | digits |
| --- | --- | --- |
| **Names + score** | both team names, the score, the round and the target | 100 mm — reads to ~11 m, names to 4–9 m |
| **Score only, bigger** | the score, the round and the target | **150 mm** — reads to ~17 m |

Giving up the names buys half again the digit height, because the names and the
digits are competing for the same 32 rows. Whoever throws next is still marked
either way — under their name in the first, under their score in the second.

The choice reaches the board **immediately, mid-game included**, so you can flip
between them while someone is scoring and see which you prefer. On the play
screen there's a **Panel:** button that cycles them without leaving the game.
It's remembered per browser and survives **New game**, and because it's held on
the broker rather than sent with each score, a panel that reboots comes back on
the layout you chose.

### Hardware board

The firmware subscribes to the same topic and holds no game rules of its own —
every message carries the whole state.

[`firmware/hub75/`](firmware/hub75/README.md) drives a 640 x 160 mm RGB LED
panel showing the score in each team's colour, both names, the round, the
target, and a rule under whoever throws next. This is the one being built. It
runs off a USB power bank rather than mains — the layout draws a few watts, so a
10,000 mAh bank covers a session several times over.

It is the only firmware target. A seven-segment build that ran in the
[Wokwi](https://wokwi.com/) simulator was removed in July 2026, once it had
drifted far enough from this one that simulating it no longer said anything about
the code that ships.

## Development

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173/)
npm run build    # production build to dist/
npm run preview  # serve the production build
npm run lint     # oxlint
npm test         # unit tests
npm run test:browser  # browser checks (needs: npm install --no-save playwright)
```

## Deployment

Hosted on GitHub Pages at `holecorn.com`. Pushing to `main` triggers
`.github/workflows/deploy.yml`, which builds and publishes `dist/`. The custom
domain is pinned by `public/CNAME`; because the site is served from the domain
root, Vite's `base` stays `/` (so the PWA `scope`/`start_url` need no change).

## Tech

React 19 + Vite. Scoring rules live as pure functions in `src/scoring.js`
(framework-independent and easy to test); the per-bag scoring lanes are in
`src/Board.jsx`. The external scoreboard uses [MQTT.js](https://github.com/mqttjs/MQTT.js),
loaded on demand so installs that never use it don't pay for it.

The brand is the two words "HOLE" and "CORN" in chalky, boxed outlines angled
into a shallow V — a stylised version of a chalk-on-tarmac family joke. The
in-app wordmark is `src/Logo.jsx`, which tints itself to the two teams' current
colours (so the setup screen recolours as you pick). `public/logo.svg` is a
static default-coloured copy of the same mark, and `public/icon.svg` is a clean
square version (no chalk texture, legible when tiny) used as the favicon.

The wordmark is set in [Bebas Neue](https://github.com/dharmatype/Bebas-Neue),
bundled at `public/fonts/BebasNeue-Regular.ttf` under the SIL Open Font License
(see `public/fonts/OFL.txt`).
