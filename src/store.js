// One whole JSON document under one localStorage key. Three of them hold one — the
// archive, the draw, and the inactive marks — and each of those modules keeps its pure
// helpers and hands the storage end to this, the same split they already followed.
//
// **Absent and unreadable are different answers, and all three used to give the same
// one.** A value this bundle could not parse read as "nothing stored yet", and the next
// write went out unconditionally. Measured against a `{format: 2, matches: [...]}`
// envelope — the shape a later version would plausibly write, the way the export file
// already carries one — winning a single game took **296,012 characters holding 300
// matches down to 990 holding 1**, and one import of a one-match file did that *and*
// replaced the tournaments and the inactive marks. Reading alone was always safe; it is
// the first write after a bad read that destroys.
//
// This is a forward-compatibility hazard rather than a corruption one, and the project
// walks towards it deliberately: merge-on-load is preferred over bumping a key, so a
// newer shape lands under the same name, and the PWA precaches bundles, so an older one
// is still running somewhere. **Refusing costs a phone the ability to record until it
// updates, which it does by itself; writing costs the history outright, and the archive
// is the one thing here with no backstop but an export.** The game is unaffected either
// way — it lives under its own key and is still playable, scoreable and winnable.
//
// **The game key is deliberately not one of these.** It holds *this tab's* whole state,
// so overwriting a shape the app cannot play is the recovery rather than the loss — see
// `validGame` in `scoring.js`, which refuses the value on the way *in* instead.

export const NO_ROOM = 'no-room';
export const UNREADABLE = 'unreadable';

export function jsonStore(key, readable, empty) {
  // `null` means present and unreadable, which is the one thing `save` will not
  // overwrite. Absent has to be answered before the parse rather than after it:
  // `getItem` gives `null` for a key that was never written and `JSON.parse(null)` is
  // `null` rather than a throw, so a first run would otherwise look like the failure.
  const read = () => {
    const raw = localStorage.getItem(key);
    if (raw === null) return empty();
    try {
      const parsed = JSON.parse(raw);
      return readable(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const load = () => {
    try {
      return read() ?? empty();
    } catch {
      return empty();
    }
  };

  // What is in storage now, and whether this write got through. Nothing deletes to make
  // room and nothing overwrites what it could not read, so `stored` is always what is
  // really there and `reason` is what lets the caller say which refusal it was — the
  // advice differs, since a full archive is on screen to export and delete and an
  // unreadable one is not.
  const save = (value) => {
    try {
      if (read() === null) return { saved: false, reason: UNREADABLE, stored: empty() };
      localStorage.setItem(key, JSON.stringify(value));
      return { saved: true, stored: value };
    } catch {
      return { saved: false, reason: NO_ROOM, stored: load() };
    }
  };

  return { load, save };
}

// The marks are a plain object where the other two are arrays, and an array under that
// key is as unreadable as a string is.
export function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
