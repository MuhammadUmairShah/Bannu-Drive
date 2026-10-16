import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Radio, AlertTriangle, Clock } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import useTripSharing from '../../hooks/useTripSharing';
import LiveMap from '../../components/LiveMap';
import { Loading, ErrorBox, Badge, btnPrimary, btnGhost, btnDanger } from '../../components/ui';
import { fmtDate, fmtTime } from '../../utils/dates';

const STATE_LABEL = { SCHEDULED: 'Scheduled', BOARDING: 'Boarding', DEPARTED: 'Departed', IN_TRANSIT: 'On the road', ARRIVED: 'Arrived', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
// Next steps offered per state. The server decides what is really allowed and explains when it is not.
const NEXT = {
  SCHEDULED: [['BOARDING', 'Start boarding', 'primary']],
  BOARDING: [['DEPARTED', 'Coach has departed', 'primary'], ['SCHEDULED', 'Pause boarding', 'ghost']],
  DEPARTED: [['IN_TRANSIT', 'Mark as on the road', 'ghost'], ['ARRIVED', 'Coach has arrived', 'primary']],
  IN_TRANSIT: [['ARRIVED', 'Coach has arrived', 'primary']],
  ARRIVED: [['COMPLETED', 'Complete trip', 'primary']]
};
const CONFIRM = {
  DEPARTED: 'Mark the coach as departed? Passengers are notified, and seats that are still on hold are released.',
  ARRIVED: 'Mark the coach as arrived? Passengers are notified.',
  COMPLETED: 'Complete this trip? Confirmed bookings become completed.'
};
const SHARE_STATES = ['DEPARTED', 'IN_TRANSIT'];
const DELAYS = [0, 15, 30, 60, 120];
const ago = (d) => { if (!d) return 'not yet'; const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };

export default function OperatorTripTracking() {
  const { id } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const t = useTripSharing(id);

  const load = useCallback(async (silent = false) => {
    try { const r = await api.get(`/coach/operator/schedules/${id}/track`); setInfo(r.data); setError(''); }
    catch (err) { if (!silent) setError(getErrorMessage(err, 'Could not load this trip')); }
  }, [id]);

  useEffect(() => { load(); const i = setInterval(() => load(true), 15000); return () => clearInterval(i); }, [load]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);

  const state = info?.trip?.state || 'SCHEDULED';
  const canShare = SHARE_STATES.includes(state);
  // sharing stops by itself when the trip leaves DEPARTED / IN_TRANSIT
  useEffect(() => { if (info && !canShare && t.sharing) t.stop(); }, [info, canShare]); // eslint-disable-line react-hooks/exhaustive-deps

  async function move(to) {
    if (CONFIRM[to] && !window.confirm(CONFIRM[to])) return;
    try {
      setBusy(true);
      await api.patch(`/coach/operator/schedules/${id}/trip-state`, { state: to });
      toast.success(`Trip is now ${STATE_LABEL[to] || to}`);
      await load(true);
      if (to === 'DEPARTED') t.start(); // the coach is on the road: begin sharing the GPS right away
    } catch (err) { toast.error(getErrorMessage(err)); load(true); } finally { setBusy(false); }
  }

  async function setDelay(minutes) {
    try { setBusy(true); await api.patch(`/coach/operator/schedules/${id}/delay`, { minutes }); toast.success(minutes ? `Passengers told: about ${minutes} min late` : 'Marked as on time'); load(true); }
    catch (err) { toast.error(getErrorMessage(err)); } finally { setBusy(false); }
  }

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!info) return <Loading text="Loading trip..." />;

  const r = info.route || {};
  const delay = info.trip?.delayMin || 0;
  const mapPos = t.position || info.position;
  const nextSteps = NEXT[state] || [];
  const btn = (kind) => (kind === 'primary' ? btnPrimary : btnGhost);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/operator/schedules" className="rounded-xl border border-line bg-surface p-2 text-muted hover:bg-surface-2" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-fg">Trip control: {r.fromCity} → {r.toCity}</h1>
          <p className="text-xs text-muted">{fmtDate(r.departureAt)} {fmtTime(r.departureAt)}{delay ? ` • running about ${delay} min late` : ''}</p>
        </div>
        <Badge tone={canShare ? 'green' : 'slate'}>{STATE_LABEL[state] || state}</Badge>
      </div>

      <LiveMap position={mapPos} stops={info.stops} className="h-72" />

      <div className="card space-y-3 p-4">
        <p className="text-sm font-bold text-fg">1. Trip status</p>
        {nextSteps.length === 0 ? <p className="text-xs text-muted">No more steps for this trip.</p> : (
          <div className="flex flex-wrap gap-2">{nextSteps.map(([to, label, kind]) => <button key={to} type="button" disabled={busy} onClick={() => move(to)} className={btn(kind)}>{label}</button>)}</div>
        )}
        <p className="text-[11px] text-subtle">Each change notifies the passengers who have a confirmed seat.</p>
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-bold text-fg">2. Share the coach's location</p>
        {!canShare ? (
          <p className="text-xs text-muted">Live location starts after the coach has departed. Set the status to "Coach has departed" first.</p>
        ) : t.sharing ? (
          <>
            <p className="flex items-center gap-2 text-xs font-semibold text-link"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Sharing. Last sent: {ago(t.lastSentAt)}{t.accuracy ? ` • GPS accuracy about ${t.accuracy} m` : ''}</p>
            <button type="button" onClick={t.stop} className={`${btnDanger} w-full`}>Stop sharing</button>
          </>
        ) : (
          <button type="button" disabled={t.starting} onClick={t.start} className={`${btnPrimary} inline-flex w-full items-center justify-center gap-2`}><Radio className="h-4 w-4" /> Start sharing location</button>
        )}
        {t.error && <p className="flex items-start gap-2 rounded-lg bg-danger-soft p-2 text-xs text-danger" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.error}</p>}
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Keep this page open on the phone inside the coach. The screen stays awake while sharing.</li>
          <li>Keep the phone charging and the mobile data on. If you reload the page, press "Start sharing location" again.</li>
        </ul>
      </div>

      {!['COMPLETED', 'ARRIVED', 'CANCELLED'].includes(state) && (
        <div className="card space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-fg"><Clock className="h-4 w-4" /> 3. Running late?</p>
          <div className="flex flex-wrap gap-2">
            {DELAYS.map((m) => <button key={m} type="button" disabled={busy || delay === m} onClick={() => setDelay(m)} className={`${btnGhost} ${delay === m ? '!border-primary !text-link' : ''}`}>{m === 0 ? 'On time' : `${m} min late`}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}