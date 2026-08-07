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
export default function Modal({ children, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog className="modal" ref={dialog} onClose={onClose}>
      {children}
    </dialog>
  );
}
