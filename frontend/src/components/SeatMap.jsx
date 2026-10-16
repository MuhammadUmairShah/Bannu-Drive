import { Disc3 } from 'lucide-react';

// Customer states come from the server: AVAILABLE | HELD | BOOKED | BLOCKED. SELECTED is local.
// Operator mode shows the same map with who is in each booked seat and whether it is paid.
const STYLE = {
  AVAILABLE: 'bg-surface border-field-line text-fg hover:border-primary hover:bg-primary-soft cursor-pointer',
  SELECTED: 'bg-primary border-primary text-on-primary ring-2 ring-primary/30 cursor-pointer',
  HELD: 'bg-warning-soft border-warning/60 text-warning cursor-not-allowed',
  MINE: 'bg-primary-soft border-primary text-link ring-2 ring-primary/30 cursor-default',
  BOOKED: 'bg-surface-3 border-field-line text-subtle cursor-not-allowed line-through',
  BLOCKED: 'bg-surface-2 border-dashed border-field-line text-subtle cursor-not-allowed',
  // operator
  PAID: 'bg-primary border-primary text-on-primary cursor-pointer',
  DUE: 'bg-primary-soft border-primary text-link cursor-pointer'
};

const LEGEND = {
  customer: [['AVAILABLE', 'Available'], ['SELECTED', 'Selected'], ['HELD', 'Held by someone'], ['BOOKED', 'Booked'], ['BLOCKED', 'Not for sale']],
  operator: [['AVAILABLE', 'Available'], ['HELD', 'On hold'], ['PAID', 'Booked, paid'], ['DUE', 'Booked, payment due'], ['BLOCKED', 'Blocked']]
};

const firstName = (n = '') => String(n).trim().split(/\s+/)[0].slice(0, 7);

function stateOf(seat, selected, operator) {
  if (operator) {
    if (seat.status === 'BOOKED') return seat.booking?.paymentStatus === 'PAID' ? 'PAID' : 'DUE';
    return seat.status;
  }
  if (selected.includes(seat.label) && seat.status === 'AVAILABLE') return 'SELECTED';
  if (seat.mine && (seat.status === 'HELD' || seat.status === 'BOOKED')) return 'MINE';
  return seat.status;
}

export default function SeatMap({ layout, seats, selected = [], onToggle, readOnly = false, operator = false, activeSeat = null, onSeatClick }) {
  const rows = Array.from({ length: layout.rows }, (_, r) => seats.filter((s) => s.row === r));
  const legend = LEGEND[operator ? 'operator' : 'customer'];

  return (
    <div className={`mx-auto w-full ${operator ? 'max-w-md' : 'max-w-xs sm:max-w-sm'}`}>
      <div className="rounded-t-3xl border-2 border-field-line bg-surface-2 px-3 sm:px-5 pt-3 pb-4">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-line text-xs font-bold text-subtle">
          <span>Front</span>
          <span className="flex items-center gap-1"><Disc3 className="w-4 h-4" /> Driver</span>
        </div>

        <div className="space-y-2" role="group" aria-label="Seat map">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-center gap-2">
              <div className="flex gap-2">
                {row.filter((s) => s.side === 'left').map((s) => <Seat key={s.label} seat={s} selected={selected} onToggle={onToggle} readOnly={readOnly} operator={operator} active={activeSeat === s.label} onSeatClick={onSeatClick} />)}
              </div>
              <div className="w-6 sm:w-8" aria-hidden="true" />
              <div className="flex gap-2">
                {row.filter((s) => s.side === 'right').map((s) => <Seat key={s.label} seat={s} selected={selected} onToggle={onToggle} readOnly={readOnly} operator={operator} active={activeSeat === s.label} onSeatClick={onSeatClick} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {legend.map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`inline-block w-4 h-4 rounded border ${STYLE[k].split(' ').filter((c) => !/^(hover|cursor|line-through|ring)/.test(c)).join(' ')}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Seat({ seat, selected, onToggle, readOnly, operator, active, onSeatClick }) {
  const state = stateOf(seat, selected, operator);
  const clickable = operator ? true : !readOnly && (state === 'AVAILABLE' || state === 'SELECTED');
  const label = operator && seat.status === 'BOOKED'
    ? `Seat ${seat.label}, booked by ${seat.booking?.passenger?.name || 'passenger'}, ${seat.booking?.paymentStatus === 'PAID' ? 'paid' : 'payment due'}`
    : `Seat ${seat.label}, ${seat.mine && seat.status === 'HELD' ? 'held for you' : seat.mine && seat.status === 'BOOKED' ? 'your booking' : state.toLowerCase()}`;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => (operator ? onSeatClick?.(seat) : onToggle?.(seat.label))}
      aria-pressed={operator ? active : state === 'SELECTED'}
      aria-label={label}
      title={operator && seat.status === 'BOOKED' ? seat.booking?.passenger?.name : undefined}
      className={`${operator ? 'w-14 h-14 sm:w-16 sm:h-16 flex-col leading-tight' : 'w-10 h-10 sm:w-11 sm:h-11'} flex items-center justify-center rounded-xl border text-xs font-bold transition-colors ${STYLE[state]} ${active ? 'outline outline-2 outline-offset-2 outline-fg' : ''}`}
    >
      <span>{seat.label}</span>
      {operator && seat.status === 'BOOKED' && <span className="block max-w-full truncate px-0.5 text-[9px] font-semibold opacity-90">{firstName(seat.booking?.passenger?.name)}</span>}
      {operator && seat.status === 'HELD' && <span className="block text-[9px] font-semibold">hold</span>}
    </button>
  );
}
