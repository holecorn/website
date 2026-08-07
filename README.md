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
need to change any of it, the button at the foot of the screen takes you back to
setup — and a name you
only notice is wrong after the game can be put right on the stats screen, which
moves that player's numbers with it.

Both teams stay on screen with live running totals and each team's points so far
this round, so you can read the score mid-round. **End round** stays disabled
until every bag has been placed (a bag on the floor counts); a hint shows how
many are still to place. Press it to commit the round and update the totals.
**Undo round** rolls back the last committed round and restores its bags to the
lanes so you can correct and re-commit it. The last button returns to the setup
screen, keeping the same teams (names and colours), and says which of the two
things it is about to do: while a game is in progress it reads **Abandon game**
in red and asks for confirmation, and once someone has won it reads **New game**
and just goes — the result is already saved to your stats. The two teams can't
share a colour.

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

If nobody wants to decide, **Toss for first** below the two cards picks for you.
It chooses between the two players at the **starting board** — in singles that's
both of them, in doubles it's whoever is holding the bags — so it never moves
anybody: it only hands over the opening throw. Press it and the answer beside the
button disappears for half a second while it decides, then comes back with whoever
has it and the bag lands to match. That pause is deliberate: it's a two-way toss,
so half the time it lands where it already was, and without it those presses would
look like nothing happened.

The one adjustment that isn't a property of a name is which side of the court each
team takes, so it lives on the diagram: the small **⇄** on the starting board
mirrors the whole thing.

It's all fixed once the game starts, because past rounds are credited to players
by the board they were standing at. The bag beside the score is then only an
indicator: after the first round it follows whoever scored last.

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
four-baggers, best single round, their **last five results** as a row of pips
(oldest first, filled for a win), and the current win streak — which is worth
keeping alongside the pips because it catches a run longer than five. Rounds sits next to
PPR because it's the number PPR is averaged over — and in doubles it's the more
honest measure of how much someone actually played, since partners alternate and
only throw half the rounds of a match. There are also totals for washes, skunks
and average match length.

**Tap a player's name** to see how they get on against everyone else. The list is
theirs — every row is an opponent, and the score is that player's won–lost against
them — so you never have to hunt for your own name down a column of pairs. It runs
worst first, with the two ends of it called out: their **nemesis** — the opponent
with the biggest gap between losses and wins — and whoever they **dominate**, the
same thing the other way round. Both need at least three meetings, so one bad
afternoon doesn't make a rivalry. Either can be missing, which is different from
having played nobody.

**Recent matches** narrows to that player at the same time, which puts their own
games on the first page however long ago they last played — and it is why every
date carries its year. Tap the name again to put both back.

Players are matched up by name, ignoring capitals and stray spaces, so "neil"
and "Neil " are the same person. In doubles both partners share the match result,
while bag stats go to whoever actually threw that round.

**Recent matches shows a dozen at a time**, newest first, with the range and the
arrows under the list — one step at a time, or straight to the newest or oldest.
That is the only route to an older game, because everything you can do to a match
is inside its row.

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

**Rename**, in the panel that opens when you tap a player, changes that name
everywhere — every match they appear in, and the lineup waiting on the setup
screen so the typo can't walk into the next game. It's the only way to rename
somebody, deliberately: with no rename control in the table itself, tapping a row
can only ever select it.

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

### Players who have stopped playing

People move away or drop out, and after a few years the name suggestions are
mostly people who won't be back. **Mark inactive**, in the same panel as
**Rename**, takes somebody out of the lists without touching a thing they did:
every match, every number and every rivalry stays exactly as it is, and their row
stays in the Players table, just dimmed.

What it changes is only what gets *offered*. They stop appearing in the name
suggestions on the setup screen and in the tournament draw's tap-to-add roster. If
they turn up anyway you just type the name as usual — nothing is ever refused —
and playing a game puts them back in both lists on their own. There's a **Mark
active** button too, for one marked by mistake.

Who is marked travels with **Export as JSON**, so a new phone doesn't start
offering everybody again. Older export files are read as before; they simply have
nobody marked. As with a deleted match, *un*-marking somebody doesn't propagate —
importing an older file will mark them again.

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

**Before a tournament tie the panel counts the cup instead**, and says so: the heading
reads *Form in Hole Corn* and every number under it is that series' — every edition of
it, this year's and the ones before. That is the question you are actually asking at a
cup, and one bracket cannot answer it: inside a single knockout everybody still in has
won every tie they have played. Early on there may be very little to show, and the panel
stays away entirely until somebody in the tie has played in the cup before — the first
tie of a first edition has nothing to say, so it says nothing rather than quietly
counting Sunday afternoons instead.

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

### Games played before the app

Results written down somewhere else can be brought in, so a career doesn't start
from zero. All that's needed per game is the date, who played and the final
score. Put them in a text file, one per line:

```
# seafront, summer 2024
2024-05-18  Neil v Sigma  21-13
2024-05-18  Neil & Rho v Sigma & Tau  21-9
2024-06-02  Neil v Rho  9-15  to 15
```

Partners are separated by `&` or a comma, and `to N` covers a game that wasn't
played to 21. The loser's score has to be below the target — both sides reaching
it isn't a game that could have been played, since the match ends the moment the
first one gets there. The winner's may exceed it, because a round scores up to
12 at once. A draw is rejected too: somebody has to have finished, and a match
with no winner would put a loss against both names. Then:

```bash
node tools/import-legacy.mjs games.txt > legacy.json
```

and **Import JSON** on the stats screen. Running it again produces the same file,
so importing twice adds nothing.

These count as matches in every way that only needs the result — win–loss, win
rate, streaks, form and head to head all include them, and the score shows in
Recent matches. What they can't do is contribute to anything measured off the
bags themselves. PPR, hole rate, in-play rate, best round and four baggers all
need to know where each bag landed, and that isn't recoverable from a final
score, so those are left out rather than guessed at. A game with no rounds shows
a dash where a rate would be, and the average round length ignores it. Someone
whose whole history is imported results shows a record and dashes; play one
scored game and the rates start from that game alone.

### Tournaments played before the app

Ties from a past tournament go in the same file, under a `tournament` header.
Everything below one belongs to that tournament until the next header or a line
reading `friendlies`:

```
tournament Hole Corn V
2024-08-03  Rho v Tau     21-11
2024-08-03  Sigma v Phi   21-16
2024-08-10  Chi v Rho     21-19
2024-08-10  Sigma v Psi   21-7
2024-08-17  Chi v Sigma   21-20

friendlies
2024-09-08  Neil v Rho  21-16
```

**The draw doesn't have to be transcribed.** It is worked out from the results:
the last tie is the final, each finalist's previous tie is a semi-final, and so
on back to the entrants — so the bracket that comes out is the one that was
played, byes and preliminaries included. It is checked before anything is
written, so a section that doesn't add up is refused with a reason rather than
importing as a half-filled bracket.

What that means for the file: every tie of the tournament has to be in it,
exactly once, all played to the same target and all singles or all doubles. An
ordinary game left under the header by mistake shows up as an entrant count that
can't be a knockout, and is reported.

A tournament whose sheet is gone can still be recorded as its result. It carries
the date and the winner, the runner-up if that's remembered, and — after `from`
— everybody who took part, separated by commas with a doubles pair joined by
`&`:

```
tournament Hole Corn I   won 2019-08-30 by Rho
tournament Hole Corn II  won 2020-08-29 by Rho beating Tau
tournament Hole Corn III won 2021-09-04 by Rho beating Tau from Neil, Rho, Sigma, Tau
```

These sit under **Completed** with the year's winner named. There is no bracket
behind them and nothing in anybody's record counts towards them — the ties
themselves are lost. Nothing else can produce one of these; a tournament played
in the app always has its ties.

The field is worth listing where anybody remembers it: opening the row names
everyone who was there, and a series counts them as having entered that year
rather than only its two finalists — so somebody who played four cups and won
none appears at all. Listing it is optional and the winner doesn't have to be in
the list, though you'll get a warning if they aren't, since that's usually a
misspelling.

Re-importing is safe: tournaments are keyed by name and matches by content, so
running the file again adds nothing. Ties are the one thing that will overwrite
a record already on the phone, because that's how the tag reaches games imported
before any of this existed — so correct a tie's names in the file rather than in
the app.

### Sample history for testing

`tools/fixtures/sample-archive.json` is a made-up history — three years, 156
matches, singles and doubles, all four colours, nine tournaments and somebody who
has stopped playing — to **Import JSON** when you want the stats screens populated
without playing a hundred games. It mixes both kinds of record, so the result-only
behaviour above is visible in it, and the cup runs to six editions so the series
panel has years to add up.

There is a second, deliberately unreasonable one for finding where the layout
stops coping: `node tools/make-stress-archive.mjs` writes `tools/out/` with ~970
matches, 77 players and 17 tournaments including a 64-entrant bracket and a cup
played nine times. It isn't checked in — it runs to megabytes — so generate it
when you want it.

Regenerate with `node tools/make-sample-archive.mjs`. It's a fixture, not real
history: importing it into a browser you actually score in will mix it into your
own career, so use a separate browser or clear it afterwards.

## Tournaments

The **Tournaments** button on the setup screen runs a knockout: enter everyone
playing, the app makes the draw, and it tells you which ties can be played. Each
tie is scored exactly like any other game and lands in your history.

The form opens on the roster with no boxes to fill in. Enter the field by tapping
names from your archive — anyone the app already knows is a chip you tap to add,
tap again to remove. **Select all** enters everybody at once, which is usually the
field, and then you tap off whoever isn't here; it only adds people who aren't in
yet, so anything already typed stays put. **Add new entrant** gives you a box for
somebody the app has never seen. Give the tournament a name — several can run at
once and the lists show nothing but the name and a date, so a blank one is refused
and so is one you have used before, however you capitalise it. Then
**Make the draw**. The draw is random and final: it puts the excess into
preliminary ties so the rest of the bracket is a power of two, and gives everyone
else a bye. For eleven entrants that's three preliminaries and five byes.

Who has the harder path isn't something the draw decides. For eleven, six people
must win four ties and five must win three — in *every* possible arrangement, so
no draw is kinder than another.

### Pulling the names out of the hat

**Make the draw** doesn't show you the bracket. It hands you a hat: press **Pull a
name** and, after a beat, one name comes out and lands where it landed — *Tau
plays Rho*, *Kappa plays the winner of Omega v Iota*. Press again for the next.
The phone is meant to be passed to whoever normally does the pulling.

If the external scoreboard is on, the board follows every press, so everyone
watching sees the draw being made rather than being told about it afterwards. It
puts the cup's name up as soon as the ceremony opens — *Hole Corn VI · Draw* —
so the board says what everyone is standing around for before the first name is
out. The tablet view also counts down — *9 of 11 drawn*.

Sometimes a name comes out with nobody to meet yet. That always sorts itself out
on the very next press, so it is never more than one press of waiting, and the
draw always ends on a completed pairing rather than trailing off.

**Skip** ends the ceremony and goes straight to the bracket. Nothing is lost by
it: the draw is made and stored the moment you press **Make the draw**, and the
ceremony only plays back what is already decided. Leaving the screen part-way
through has the same effect.

There is one tie no press announces — the one between two preliminary winners,
where neither side is known yet. The bracket draws it.

### Playing a tie

The bracket draws as columns, preliminaries on the left through to the final on
the right. A tie you can play now is outlined in green with a **▶**; tap the box
to start it. Several are usually playable at once, and there is no required
order — play whoever is there, which is how it actually goes.

A tie loads with the names, the mode and the target fixed by the draw, and a line
saying which tournament and round it is. **Play something else** puts it back if you
tapped the wrong one — the tie stays on the bracket, and nothing about the tournament
changes. Everything else works as normal: the toss, the colours, who throws
first.

On a phone the bracket shows one round at a time with **‹ ›** to step between
them, and it opens on the round the live ties are in rather than at the outer
edge. On an iPad the whole bracket fits at once.

Beside the tabs of an open tournament is what it is played to — **Play to 26** —
because the scores it holds cannot be read without it. A winning 35 is somebody
squeaking over the line to 35, or a rout that overshot a line at 26, and the
bracket cannot tell you which. Every tie in one is played to the same target, so
it is said once rather than in every box.

### After the game

Winning a tie advances the bracket; undoing the winning round takes it back out
again. Nothing about the bracket's progress is stored — it is worked out from the
results — so there is never a bracket that disagrees with the games behind it.

Ties count in everyone's career exactly like any other game. On the stats screen
a tournament tie carries a green mark in the recent matches list, and opening it
names the tournament and the round.

Finished tournaments move to **Completed** with their winner and the runner-up
beneath, and the row still opens to the whole bracket — which is the thing the
paper sheets were kept for.

### The Stats tab

An open tournament has a **Stats** tab beside its bracket, covering that cup only:
how many ties are in, how long the games ran, and a table of everyone who entered
with how far they got. In doubles a pair is one row, because a pair is one entrant.

Tapping an entrant in that table shows their way through the draw — who they beat
and who knocked them out — and lights that route on the **Bracket** tab, with
everything else faded. **Clear** puts the bracket back. Selecting the winner is
how you read the champion's route.

A cup transcribed from an old written-down score has results and no bag-by-bag
detail behind them, so those tabs show the record, how far everyone got and the
widest and closest ties, and say plainly that there are no rates to show.
Several tournaments can run at once; a singles cup and a doubles cup in the same
summer is an ordinary thing to want. Both lists show the most recent draw first,
and every row carries its dates — when it was drawn and how recently a tie was
played, or the span from the draw to the final once it is finished. One played
out in an afternoon just shows the day.

Abandoning a tournament takes only the bracket — its played ties stay in your
history and keep counting. It is also not final: importing a file that carries
the draw brings the bracket back, results and all, because those ties never went
anywhere.

A tournament runs over weeks rather than an evening, which is worth knowing for
one reason: **whichever device takes the draw has to score every tie**, because
the history is per-browser. Add Holecorn to your home screen before you start —
see **Keeping the history**.

### The same cup, every year

Play a cup twice and its editions gather into a **Series** section between the two
lists. Nothing sets this up: the app reads the numeral or year off the end of the
name, so *Hole Corn V* and *Hole Corn VI* are two editions of *Hole Corn*, and every
tournament you have already played groups itself — including one that survives only
as a recorded result.

A series row names who holds the cup, how many editions it has run to and the span
they cover. Opening it gives the roll of honour — every edition newest first, with
both finalists and the day it was decided — and a table of everyone who has entered:
how many editions, how many titles, and their tie record across all the years.

Those last two are the point of it. Inside a single knockout everybody who is still
in has won every tie they have played and no two people meet twice, so form and
head-to-heads say nothing. Across editions they do, and *how many has she won* has no
single-cup answer at all. It's the same reason the **Form** panel before a tie counts
the series rather than everything you've ever played.

When you draw a new one, the form offers the next edition by name — **Hole Corn VII**
— along with the mode and target the last one used. Tap it and the name is filled in
correctly, which matters because the name is what does the grouping: a cup typed as
*Holecorn VII* starts a series of its own. It only offers a cup whose latest edition
is finished, and it skips a name already in use. It doesn't enter the field — who
plays changes year to year, and **Select all** is one press.

Two things worth knowing. A numeral has to be in capitals: *Hole Corn VI* groups and
*Hole Corn vi* does not, because read loosely an ordinary word like *Mix* is a Roman
numeral too and would quietly become edition 1009. And a cup played once is not a
series — it is just a tournament, in the list it was always in.

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

### Tournament ties on the board

If the game is a tie picked off a bracket, the board says which one instead of showing
form:

```
     HOLE CORN V                        HOLE CORN V
      SEMI-FINAL                          FINAL
     NEIL & RHO
     SIGMA & TAU                     NEIL  V  SIGMA
```

Form is left out on purpose, and it isn't a matter of space. A knockout only puts
unbeaten sides in a tie — anyone who has lost is out — so before a tie both sides have
won every game they've played in the tournament, and a form line reads as five wins for
everybody. Which round it is changes; how they got there doesn't.

Short names go on one row either side of a **V** and the card spreads out; longer ones
stack, and keep the "&" they were typed with — a whole row fits far more than half of
one, so a name that would be cut to nine characters beside the score fits at its full
length here. It appears when you tap a tie and goes when the first bag lands, like the
form screen, and **Play something else** takes it off too.

Who throws first isn't marked here — there's a single pixel between the rows and a line
in it reads as an underline on the name. The score screen marks it a few seconds later.

The tablet display keeps its form table and puts the cup and the round above it, since
it has the room the LED panel doesn't. That table is the *series'* form, the same numbers
the setup screen shows for the tie. It's also the one place a *first* tournament shows
anything: with no ties behind the cup there's no form to publish, so the display names
the two sides instead.

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

The two buttons on the controller are **brightness, up and down**: five steps from
a dim evening setting up to full for bright sun. It starts at the dim end every
time it is switched on. Nothing else about the board is adjustable from the board
itself — the score, the names and which layout it draws all come from the phone.

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
