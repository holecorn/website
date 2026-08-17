import { useEffect, useRef } from 'react';

// A dialog that opens by being mounted, so the screen owns *what* is being confirmed or
// edited and there is no ref to toggle. `showModal`, not `show`: the match list underneath
// must not stay live, because an open row holds Delete.
//
// Deliberately no backdrop-click dismissal, unlike App.jsx's confirm. Every use of this so
// far either holds a name that has been typed or is a destructive confirmation, and losing
// either to a stray tap is worse than one more press on Cancel. Don't unify the two.
//
// Its own file because two screens use it now. The styling lives in App.css (`.modal`,
// `.modal-title`, `.modal-body`, `.confirm-actions`) and is deliberately *not* redeclared
// in either screen's stylesheet: both are bundled before App.css, so a redeclaration would
// lose at equal specificity.
// `focus` is a selector for the control that should hold focus on opening, for a dialog
// whose first focusable descendant is not the one to land on. **It has to be done here
// and it cannot be done with `autoFocus`.** `showModal` runs the platform's own focusing
// algorithm, which looks for the `autofocus` *attribute* — and React does not render one,
// it calls `.focus()` during commit instead, which `showModal` then overrides a moment
// later. Measured: `autoFocus` on a child of this is simply a no-op.
//
// Left off by every caller whose first control is already the right one — the two editors
// open on their first field, and the confirms open on `Cancel` by having it first in the
// row.
export default function Modal({ children, focus, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    if (focus) dialog.current?.querySelector(focus)?.focus();
  }, [focus]);
  return (
    <dialog className="modal" ref={dialog} onClose={onClose}>
      {children}
    </dialog>
  );
}
