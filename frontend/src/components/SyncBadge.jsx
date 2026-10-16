import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

// Honest connection indicator for live seat data. It never says "live" unless the socket is really connected and watching.
export default function SyncBadge({ conn, lastSync, onRefresh }) {
  const live = conn === 'live';
  const ago = lastSync ? Math.max(0, Math.round((Date.now() - lastSync) / 1000)) : null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status" aria-live="polite">
      {live ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 font-semibold text-link"><Wifi className="h-3.5 w-3.5" /> Live</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 font-semibold text-warning">
          <WifiOff className="h-3.5 w-3.5" /> {conn === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
        </span>
      )}
      {!live && <span className="text-muted">Seat availability may be out of date{ago !== null ? ` (checked ${ago}s ago)` : ''}.</span>}
      {onRefresh && (
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 text-link font-semibold" aria-label="Refresh seat map">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      )}
    </div>
  );
}
