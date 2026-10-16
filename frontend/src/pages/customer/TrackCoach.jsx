import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, WifiOff, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { getSocket } from '../../utils/socket';
import LiveMap from '../../components/LiveMap';
import { Loading, ErrorBox, Badge } from '../../components/ui';
import { fmtDate, fmtTime } from '../../utils/dates';

const STATUS_BADGE = { live: ['green', 'Live'], stale: ['amber', 'Last known position'], offline: ['slate', 'Offline'], waiting: ['amber', 'Waiting for GPS'], not_started: ['slate', 'Not started'], ended: ['slate', 'Trip ended'], cancelled: ['red', 'Cancelled'] };

export default function TrackCoach() {
  const { bookingId } = useParams(); // the track API is per booking: only the customer's own confirmed ticket
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (silent = false) => {
    try { const res = await api.get(`/coach/bookings/${bookingId}/track`); setData(res.data); setError(''); }
    catch (err) { if (!silent) setError(getErrorMessage(err, 'Could not load the live location')); }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const scheduleId = data?.scheduleId ? String(data.scheduleId) : null;

  // realtime: watch this trip, apply new positions, reload on status changes. Polling is the safety net.
  useEffect(() => {
    if (!scheduleId) return undefined;
    const socket = getSocket();
    const watch = () => socket.emit('coach:track-watch', scheduleId, () => {});
    const onLoc = (p) => {
      if (String(p.scheduleId) !== scheduleId) return;
      setData((d) => d && ({
        ...d,
        status: p.status || 'live',
        position: { ...(d.position || {}), latitude: p.latitude, longitude: p.longitude, at: p.at, speed: p.speed, heading: p.heading },
        trip: { ...d.trip, state: p.tripState || d.trip?.state },
        progress: p.progress ?? d.progress,
        locationLabel: p.locationLabel ?? d.locationLabel
      }));
    };
    const onState = (p) => { if (String(p.scheduleId) === scheduleId) load(true); };
    socket.on('connect', watch);
    socket.on('coach:location', onLoc);
    socket.on('coach:trip-state', onState);
    if (socket.connected) watch();
    const poll = setInterval(() => load(true), 20000);
    return () => { clearInterval(poll); socket.emit('coach:track-unwatch', scheduleId); socket.off('connect', watch); socket.off('coach:location', onLoc); socket.off('coach:trip-state', onState); };
  }, [scheduleId, load]);

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  if (error) return <div className="mx-auto max-w-md py-12"><ErrorBox message={error} onRetry={load} /><div className="mt-3 text-center"><Link to="/customer/bookings" className="text-xs font-semibold text-link">Back to my bookings</Link></div></div>;
  if (!data) return <Loading text="Finding your coach..." />;

  const { route = {}, trip = {}, status, position, stops = [] } = data;
  const [tone, label] = STATUS_BADGE[status] || STATUS_BADGE.not_started;
  const ageS = position?.at ? Math.max(0, Math.round((now - new Date(position.at).getTime()) / 1000)) : null;
  const ageText = ageS === null ? '' : ageS < 60 ? `${ageS}s ago` : `${Math.round(ageS / 60)} min ago`;
  const delay = trip.delayMin || 0;
  const showMap = ['live', 'stale', 'offline', 'waiting', 'ended'].includes(status);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/customer/bookings" className="rounded-xl border border-line bg-surface p-2 text-muted hover:bg-surface-2" aria-label="Back to bookings"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-fg">{route.fromCity} → {route.toCity}</h1>
          <p className="text-xs text-muted">{fmtDate(route.departureAt)} {fmtTime(route.departureAt)} → {fmtTime(route.arrivalAt)}</p>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>

      {delay > 0 && status !== 'ended' && <p className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs font-semibold text-warning"><Clock className="h-4 w-4 shrink-0" /> The operator says the coach is running about {delay} minutes late.</p>}
      {status === 'cancelled' && <p className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-xs font-semibold text-danger"><AlertTriangle className="h-4 w-4 shrink-0" /> This trip was cancelled.</p>}

      {status === 'not_started' && (
        <div className="card space-y-2 p-8 text-center">
          <Clock className="mx-auto h-8 w-8 text-subtle" />
          <p className="font-semibold text-fg">The coach has not left yet</p>
          <p className="text-xs text-muted">You can follow it here once it departs. You will get a notification, and this page updates by itself.</p>
        </div>
      )}

      {showMap && (
        <>
          <LiveMap position={position} stops={stops} className="h-96" />
          <div className="card space-y-1 p-4 text-sm">
            {status === 'waiting' ? (
              <p className="text-muted">The coach has departed. Waiting for its first GPS position...</p>
            ) : status === 'ended' ? (
              <p className="font-semibold text-fg">This trip has ended.</p>
            ) : (
              <>
                <p className="font-semibold text-fg">{data.locationLabel || 'Coach is on the way'}</p>
                <p className="text-xs text-muted">Updated {ageText}{position?.speed != null && status === 'live' ? ` • ${Math.round(position.speed * 3.6)} km/h` : ''}{data.etaMinutes != null ? ` • about ${data.etaMinutes} min to ${route.toCity} (approximate)` : ''}</p>
              </>
            )}
          </div>
          {['stale', 'offline'].includes(status) && <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs text-warning"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /> The coach has not sent a location for a while (poor signal, or the phone is off). The map shows its last known position.</p>}
        </>
      )}

      {stops.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-sm font-bold text-fg">Stops</p>
          <ol className="space-y-2">
            {stops.map((s) => (
              <li key={`${s.order}-${s.name}`} className="flex items-center gap-2 text-sm">
                {s.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-link" /> : <Circle className="h-4 w-4 shrink-0 text-subtle" />}
                <span className={s.passed ? 'text-muted line-through' : 'text-fg'}>{s.name}</span>
                {s.arrivalAt && <span className="ml-auto text-xs text-subtle">{fmtTime(s.arrivalAt)}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}