// Props for every field somebody types a person's name into.
//
// **`autoComplete: 'off'` is here to stop the browser's own contact autofill.** On macOS
// both Safari and Chrome guess a name field from its label — and every one of these is
// labelled "player name", "Entrant 3" or "New name for Rho" — then offer the machine's
// address book on top of the app's own suggestions. Two popups fight, and the useless one
// wins: the archive's list of people who have actually played is the only completion
// worth having here.
//
// **Safari ignores it for contact autofill and always will.** WebKit treats the address
// book as the user's choice rather than the page's, so `off` suppresses it in Chrome and
// not in Safari. The only lever left on the page is the heuristic itself, which reads the
// field's label — so none of these say "name" any more (`Team A player`, `Entrant 3`).
// Whether that is enough is Safari's business and cannot be checked from here; the
// reliable fix is the one in Safari's own AutoFill settings.
//
// It does **not** turn off the `datalist`. Autofill and `<datalist>` are different
// mechanisms; `list` still binds and still offers `knownNames`. That is worth knowing
// before anyone "fixes" this by removing the attribute.
//
// `spellCheck: false` for the same reason in a different guise: a name is not prose, and
// a red underline beneath every one of them is noise about nothing.
//
// Shared as an object rather than repeated inline because the reasoning is not obvious
// and there are five of these fields across three files — the failure this guards is a
// sixth being added without it and the address book coming back.
// The `name` is deliberately not a word any autofill heuristic matches — they look for
// `name`, `fname`, `lname`, `fullname` and the like, and an input with no `name` at all
// leaves the label as the only thing to go on. Nothing submits a form here, so one shared
// value is fine and its only job is to be unhelpful to the guesser.
export const NAME_FIELD = {
  autoComplete: 'off',
  spellCheck: false,
  name: 'holecorn-slot',
};
