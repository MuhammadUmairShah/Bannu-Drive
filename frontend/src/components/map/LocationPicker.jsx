import { useState, useId } from 'react';
import { Search, MapPin, Loader2, LocateFixed } from 'lucide-react';
import { reverseGeocode } from '../../utils/geo';
import usePlaceSearch from '../../hooks/usePlaceSearch';

// Search box + result list for choosing a single location.
// value: { address, latitude, longitude } | null
// onChange: (location) => void
// The parent owns the map and calls onChange when the user clicks it too.
export default function LocationPicker({
  label,
  color = 'emerald',
  value,
  onChange,
  active,
  onActivate
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const listId = useId();
  const { results, searching, error: searchError } = usePlaceSearch(query, { enabled: open });

  const ring = color === 'emerald' ? 'ring-primary border-primary' : 'ring-danger/30 border-danger/30';
  const badge = color === 'emerald' ? 'bg-primary text-on-primary' : 'bg-danger-solid text-on-danger';

  function choose(result) {
    onChange(result);
    setOpen(false);
    setQuery('');
    setHighlight(-1);
    setMessage('');
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1)); }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); choose(results[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage('Your browser does not support location access');
      return;
    }

    setLocating(true);
    setMessage('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const address = await reverseGeocode(latitude, longitude);
        onChange({ address, latitude, longitude });
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setMessage('Location permission denied. Search or click the map instead.');
        } else if (error.code === error.TIMEOUT) {
          setMessage('Getting your location timed out. Try again.');
        } else {
          setMessage('Your location is unavailable right now.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  return (
    <div
      onClick={onActivate}
      className={`p-3 rounded-xl border bg-surface space-y-2 transition-all ${
        active ? `ring-2 ${ring}` : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-fg  flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${badge}`}>
            {color === 'emerald' ? 'A' : 'B'}
          </span>
          {label}
        </p>
        {label.toLowerCase().includes('pickup') && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="text-xs font-semibold text-link hover:text-link inline-flex items-center gap-1 disabled:opacity-60"
          >
            {locating ? <Loader2 className="w-3 h-3 animate-spin" /> : <LocateFixed className="w-3 h-3" />}
            Use my location
          </button>
        )}
      </div>

      <div className="text-xs">
        {value ? (
          <p className="flex items-start gap-1 text-fg">
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted" />
            <span className="font-semibold">{value.address}</span>
          </p>
        ) : (
          <p className="text-subtle">
            {active ? 'Search below or click the map to set this point' : 'Not selected yet'}
          </p>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-subtle" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={`${label}: search a place`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(-1); }}
          onFocus={onActivate}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
          placeholder="Search a place in Bannu..."
          className="w-full min-w-0 text-xs border border-field-line rounded-xl pl-8 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg"
        />
        {searching && <Loader2 className="absolute right-3 top-2.5 h-3.5 w-3.5 animate-spin text-subtle" aria-hidden="true" />}
      </div>

      {(message || searchError) && <p className="text-xs text-warning" role="status">{message || searchError}</p>}
      {open && !searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs text-muted">No matches. Try another name, or click the map to place the point.</p>
      )}

      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="border border-line rounded-xl divide-y divide-line max-h-48 overflow-y-auto bg-surface">
          {results.map((r, i) => (
            <li key={`${r.latitude}-${r.longitude}-${i}`} role="option" aria-selected={i === highlight}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)} className={`w-full text-left text-xs px-3 py-2 hover:bg-surface-2 text-fg ${i === highlight ? 'bg-surface-2' : ''}`}>
                {r.address}
                {r.approximate && <span className="ml-1 text-[10px] text-warning">(approximate area)</span>}
                {typeof r.distanceKm === 'number' && r.distanceKm > 25 && <span className="ml-1 text-[10px] text-subtle">{Math.round(r.distanceKm)} km away</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
