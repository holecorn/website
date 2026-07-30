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
**Start**.

The names carry over from the last game, so there's usually nothing to fill in.
Typing in a name field offers everyone your history already knows — worth picking
from, because a player is only ever identified by their name, so a fresh spelling
of a familiar one is a new person as far as the stats are concerned.

For the same reason, **everyone needs a name and no two of them can be the same**.
Nobody plays themselves or partners themselves — to the stats that's one person
credited with both the win and the loss — and an unnamed player is credited with
nothing at all, so their throws would vanish from a match that still got saved.
**Start** stays off until it's sorted, saying what's wrong and underlining the
fields in red. If you really do have two Neils, give one of them an initial; the
stats can't tell them apart otherwise either.

In **doubles**, each team has two players who share the team's colour, standing at
opposite boards. Since each end is scored as its own round, the throwing partner
alternates every round; the scoreboard highlights whoever's up and dims the
benched partner. Scoring is otherwise identical to singles.

Turn on **Guests** for a pickup game with people passing by: no names are taken and
nothing is recorded. The name fields go away and each team is simply its bag colour
— "Blue" against "Red" — on the phone, on the external scoreboard and in the winner
announcement. Everything else works exactly as usual, including the court diagram
and the in-game stats, but the match is never filed, so it can't drag your averages
around or leave a stranger in your player list. Pick the colours to match the bags
you hand out and press **Start**.

It stays on until you turn it off, since guests tend to arrive in runs, and the
toggle sits beside **Start** so it's in front of you every time you begin a game.
While one is in play the score reads **not recorded** under the running total. In
doubles the two partners share the one label, so which of them is up is shown by
the court diagram rather than by name.

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

A small bag beside a team's name marks who throws first this round — the same
marker used on the setup screen and in the court diagram. It's set before the game
begins and then moves automatically to whichever team scored in the previous
round, staying put on a wash.

**The play screen only does scoring.** Names, colours, who throws first and where
everyone stands are all fixed once you press **Start**, because finished
matches are credited to players by name and by the board they stood at. If you
need to change any of it, **New game** takes you back to setup — and a name you
only notice is wrong after the game can be put right on the stats screen, which
moves that player's numbers with it.

Both teams stay on screen with live running totals and each team's points so far
this round, so you can read the score mid-round. **End round** stays disabled
until every bag has been placed (a bag on the floor counts); a hint shows how
many are still to place. Press it to commit the round and update the totals.
**Undo round** rolls back the last committed round and restores its bags to the
lanes so you can correct and re-commit it. **New game** returns to the setup
screen, keeping the same teams (names and colours); if a game is still in
progress it asks for confirmation first, but once someone has won it just goes —
the result is already saved to your stats. The two teams can't share a colour.

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
is outlined in their team colour, with a bag marking the box that throws first,
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

The starting arrangement is set on the **name fields**, on the players it
describes, and the diagram just reports the result. Each name gets a bag on its
left — filled for whoever throws the opening bag, dashed for everyone else — and
tapping one hands that player the opening throw. In doubles each name also carries
the board it stands at, **start board** or **far board**; pressing it swaps that
pair over without changing which team leads. Because the partner at the starting
board is the one who opens, giving the opening bag to somebody at the far board
brings them down to the starting board too — the two aren't separate settings.

The one adjustment that isn't a property of a name is which side of the court each
team takes, so it lives on the diagram: the small **⇄** on the starting board
mirrors the whole thing.

It's all fixed once the game starts, because past rounds are credited to players
by the board they were standing at. During play the first thrower can still be
corrected by tapping a team's bag beside the score, which changes only which team
leads the round.

These are the conventions this group plays, not a rulebook: in particular, when
singles players walk down they each keep their own side of the court.

The in-progress game is saved to the browser's `localStorage`, so it survives a
refresh. There is no backend and no account — everything runs client-side.

## Stats

Finishing a game files it away, and the **Stats** button on the setup screen
reports what has built up. Only completed matches count — walking away from a
game part-way leaves nothing behind, so a three-round fragment can't drag the
averages around. Undoing a winning round takes the match back out again. A
A **Guests** game is never filed at all, however it ends.

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
and "Neil " are the same person. In doubles both partners share the match result,
while bag stats go to whoever actually threw that round.

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

### Fixing a name

Names are the only thing identifying a player, so a typo invents somebody. There
are two ways to put one right, and which one you want depends on how far the typo
spread.

**Edit names**, inside an expanded match, changes that match and nothing else.
Use it for a name that was already wrong when you pressed **Start**, or when
the wrong partner got credited for an end — in doubles the fields say which board
each player threw from all game, and swapping them swaps who is credited with
which rounds. The rounds themselves aren't touched; players are credited by the
slot they stood in, so correcting the name is all it takes to move the numbers.

**Tapping a player's name in the Players table** renames them everywhere: in
every match they appear in, and in the lineup waiting on the setup screen, so the
old spelling doesn't come straight back with the next game. This is also how you
tidy up after the fact:

- A typo that created a phantom player — rename it to the real spelling and the
  two fold into one history. The screen says whose history you're about to merge
  into, and how many matches it has, because it can't be split again afterwards.
- Two players who share a first name — rename one of them to something that
  tells them apart ("Neil P"), and every past match follows. Bear in mind the
  external scoreboard has room for about eight or nine characters.

Neither one touches a game in progress, and neither is reachable from the play
screen, so there's no way to move rounds around under a game you're scoring.

### Form, before a game starts

Once the names are in, a **Form** panel appears on the setup screen — below
**Start**, so it never gets between you and the game — listing everyone about
to play with their won–lost record, their last five results as dots, their PPR and
their hole rate. Above it, if these two sides have finished a match before, is the
record between them: in doubles that's this pair against that pair, not four
separate rivalries.

Anyone the history has never seen says **first game** rather than showing a row of
zeroes, and if nobody in the lineup has played before the panel doesn't appear at
all. It uses the same name matching as the stats screen, so a typo makes someone a
newcomer. A genuinely dismal run still gets its numbers — a PPR of 0.0 means every
bag went on the floor, and it says so. A **Guests** game has no panel, on the phone
or on the board: there are no names to look anybody up by.

If you have the external scoreboard running, it shows this too — see below.

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
have, adds nothing and can't create duplicates. Where both sides hold the same
match, whichever copy had its names corrected most recently is the one kept — so
an export taken before a rename can't undo it.

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

### Form on the board

Before the first bag is thrown there's no score worth a scoreboard, so the board
and the display show the **Form** table instead — the same rosters and records as
the setup screen. It appears on its own once the names are in and disappears the
moment the first bag lands, with no button to press; it also overrides whichever
score layout you picked, and gives it straight back afterwards.

The two screens deliberately differ in what they can fit. The tablet display shows
the record, the last five and PPR, sized to fill the screen — on a 13" iPad in
landscape that's around 108px of text using 85% of the height and the full width,
with room for a nine-character name even once records reach double figures. Anything
longer ellipsises rather than shrinking everything else. The LED panel shows the same, but its rows are
5x7 text — 35 mm tall, so it reads from a few metres rather than the ~11 m the
score does. That's the right trade for something you look at while standing around,
but don't expect to read it from across the court. Names are cut to **eight
characters** there when records are short, dropping to 8 or 6 as the won-lost
figures grow into two and three digits — the number columns take what they need and
the name gets the rest.

Doubles fills the panel exactly — four rows is all 32 pixels of height — so there's
no heading on it. Singles centres its two rows.

### The wordmark at switch-on

For a couple of seconds after the board is powered up it shows the Holecorn logo,
in **two of the four team colours picked at random** — so it's a different pair each
time — with a small square in the top-right corner saying how far it has got:
**red** for no WiFi yet, **amber** for WiFi but no broker, **green** once it's
listening. Nothing is waiting for the logo; the board connects behind it, and
without it those seconds would be spent showing four dashes.

It's the app's own wordmark, and the app now shares its tilt: the mark was drawn leaning
15° and the panel needed 8° to fit 32 rows at a legible size, so the setup screen adopted
that too — which also gave it 13px of height back, since a tilted box is much taller than
what's inside it. What the panel does differently is spread the letters further apart,
which it needs and the app doesn't, and smooth the diagonals with part-brightness LEDs so
they don't read as staircases. The chalk texture is left off — at 5 mm pitch a stroke is
one or two LEDs wide, with no room inside it for a texture to show.

The panel emulator shows it too, so you can see it without the hardware: open a
display link with `&panel=1` and reload.

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
