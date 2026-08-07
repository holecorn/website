import { useEffect } from 'react';

// A screen that sleeps mid-game is useless: a tablet propped against a fence, and a
// phone the scorer would otherwise unlock once a round. One request isn't enough — the
// lock is dropped whenever the page is hidden, and the system can take it back on its
// own (low battery), so it has to be re-taken.
//
// `active` is an argument rather than a conditional call because a hook cannot be one.
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;

    let sentinel = null;
    let retry = null;
    let stopped = false;
    // Guards the await, not just the result: the retry timer can fire while a
    // visibilitychange request is still in flight, and two requests that both
    // pass a `sentinel === null` check would orphan the first lock.
    let acquiring = false;

    const acquire = async () => {
      if (stopped || acquiring || sentinel || document.visibilityState !== 'visible') return;

      let held;
      acquiring = true;
      try {
        held = await navigator.wakeLock.request('screen');
      } catch {
        // Unsupported or refused outright. The board still works, it just dims,
        // and asking again immediately would only be refused again.
        return;
      } finally {
        acquiring = false;
      }

      if (stopped) {
        held.release().catch(() => {});
        return;
      }
      sentinel = held;

      held.addEventListener('release', () => {
        if (sentinel === held) sentinel = null;
        // Delayed, so a system that won't hold the lock degrades to a slow retry
        // rather than spinning. Hidden pages are filtered out by acquire().
        clearTimeout(retry);
        retry = setTimeout(acquire, 1000);
      });
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
      stopped = true;
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', acquire);
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}
