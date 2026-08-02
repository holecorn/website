// A summary figure with its label under it, and the grid that lays a row of them out.
//
// Shared by the career screen's totals and a tournament's, rather than drawn twice —
// the `FormPips` precedent, and the same reasoning: two copies of what a chip looks
// like is the drift with no symptom. Its own stylesheet for the same reason that one
// has, so nothing has to be appended to `Stats.css`.

import './Chip.css';

export function Chips({ children }) {
  return <div className="stat-chips">{children}</div>;
}

export default function Chip({ label, value }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip-value">{value}</span>
      <span className="stat-chip-label">{label}</span>
    </div>
  );
}
