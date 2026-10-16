import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { ScanLine, Camera, CameraOff, Keyboard, CheckCircle2, XCircle, AlertTriangle, Banknote } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { toast } from '../../utils/toast';
import useFetch from '../../hooks/useFetch';
import { PageHeader, inputCls, btnPrimary, btnGhost, Badge } from '../../components/ui';
import { PAYMENT_LABEL, methodLabel } from '../../utils/coachPayment';

const RESULT = {
  VALID: { tone: 'border-primary/50 bg-primary-soft text-link', icon: CheckCircle2, title: 'VALID' },
  ALREADY_USED: { tone: 'border-danger/50 bg-danger-soft text-danger', icon: XCircle, title: 'ALREADY USED' },
  CANCELLED: { tone: 'border-danger/50 bg-danger-soft text-danger', icon: XCircle, title: 'CANCELLED' },
  NOT_FOUND: { tone: 'border-danger/50 bg-danger-soft text-danger', icon: XCircle, title: 'NOT FOUND' },
  EXPIRED: { tone: 'border-warning/50 bg-warning-soft text-warning', icon: AlertTriangle, title: 'EXPIRED' },
  WRONG_TRIP: { tone: 'border-warning/50 bg-warning-soft text-warning', icon: AlertTriangle, title: 'WRONG TRIP' }
};

export default function OperatorScan() {
  const trips = useFetch('/coach/operator/schedules', { upcoming: 'true', status: 'scheduled' });
  const [scheduleId, setScheduleId] = useState('');
  const [manual, setManual] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const video = useRef(null);
  const canvas = useRef(null);
  const stream = useRef(null);
  const raf = useRef(0);
  const last = useRef({ code: '', at: 0 }); // the same QR stays in view for seconds: scan it once
  const lock = useRef(false);
  const scheduleRef = useRef('');
  scheduleRef.current = scheduleId;

  const submit = useCallback(async (code, action = 'VERIFY', source = 'camera') => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const res = await api.post('/coach/operator/scan', { code, action, source, scheduleId: scheduleRef.current || undefined });
      setResult({ ...res.data, code, at: Date.now() });
      if (navigator.vibrate) navigator.vibrate(res.data.result === 'VALID' ? 60 : [120, 60, 120]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Scan failed'));
    } finally { lock.current = false; setBusy(false); }
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) return setCameraError('This browser cannot use the camera. Type the booking code instead.');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const v = video.current;
      v.srcObject = stream.current;
      await v.play();
      setCameraOn(true);

      const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null; // native when available
      const ctx = canvas.current.getContext('2d', { willReadFrequently: true });
      let busyFrame = false;
      const tick = async () => {
        if (!stream.current) return;
        if (!busyFrame && v.readyState === v.HAVE_ENOUGH_DATA && !lock.current) {
          busyFrame = true;
          try {
            let text = '';
            if (detector) {
              const found = await detector.detect(v);
              text = found[0]?.rawValue || '';
            } else {
              canvas.current.width = v.videoWidth; canvas.current.height = v.videoHeight;
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.current.width, canvas.current.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || '';
            }
            const now = Date.now();
            if (text && (text !== last.current.code || now - last.current.at > 4000)) {
              last.current = { code: text, at: now };
              await submit(text, 'VERIFY', 'camera');
            }
          } catch { /* a bad frame is not an error */ }
          busyFrame = false;
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (err) {
      stopCamera();
      setCameraError(err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, or type the booking code.' : 'Could not start the camera. Type the booking code instead.');
    }
  }, [submit, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]); // the camera must never stay on after leaving the page

  const t = result?.ticket;
  const R = result ? RESULT[result.result] : null;

  // The id of the booking, needed by the cash endpoint. Comes from the scan response.
  const bookingId = t?._id || t?.id || t?.bookingId || '';
  const cashDue = !!t && t.paymentMethod === 'CASH' && t.paymentStatus === 'CASH_DUE' && result.result !== 'CANCELLED';
  const canCollect = cashDue && !!bookingId;
  const working = busy || collecting;

  // Records the cash (same endpoint as the seat map), then optionally boards the passenger in one tap.
  async function collectCash(alsoBoard = false) {
    if (!canCollect || working || lock.current) return;
    setCollecting(true);
    try {
      const res = await api.patch(`/coach/operator/bookings/${bookingId}/collect-cash`);
      toast.success(res.data?.message || 'Cash recorded');
      setResult((prev) => (prev ? { ...prev, ticket: { ...prev.ticket, paymentStatus: 'PAID' } } : prev));
      if (alsoBoard) await submit(result.code, 'BOARD', 'manual');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not record the cash'));
    } finally { setCollecting(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader icon={ScanLine} title="Scan ticket" subtitle="Check passengers in and board them. The server decides if a ticket is valid." />

      <div className="card space-y-3 p-4">
        <label className="block text-xs font-semibold text-fg">Trip you are boarding (recommended)
          <select className={`${inputCls} mt-1`} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">Any trip (don't check)</option>
            {(trips.data?.schedules || []).map((x) => <option key={x._id} value={x._id}>{x.fromCity} → {x.toCity} • {fmtDate(x.departureAt)} {fmtTime(x.departureAt)}</option>)}
          </select>
        </label>

        <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-2xl bg-black">
          <video ref={video} muted playsInline className="h-full w-full object-cover" aria-label="Camera preview" />
          <canvas ref={canvas} className="hidden" />
          {!cameraOn && <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">Camera is off</div>}
          {cameraOn && <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/70" />}
        </div>
        {cameraError && <p className="text-xs text-danger" role="alert">{cameraError}</p>}
        <div className="flex justify-center">
          {cameraOn
            ? <button type="button" className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={stopCamera}><CameraOff className="h-4 w-4" /> Stop camera</button>
            : <button type="button" className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={startCamera}><Camera className="h-4 w-4" /> Start camera</button>}
        </div>

        <form className="flex gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) submit(manual.trim(), 'VERIFY', 'manual'); }}>
          <div className="relative flex-1"><Keyboard className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-subtle" />
            <input className={`${inputCls} pl-9 uppercase`} placeholder="Booking code, e.g. BD-7K2PX9" value={manual} maxLength={40} onChange={(e) => setManual(e.target.value)} aria-label="Booking code" /></div>
          <button className={btnPrimary} disabled={busy || !manual.trim()}>Check</button>
        </form>
      </div>

      {result && R && (
        <div className={`rounded-2xl border-2 p-5 ${R.tone}`} role="status" aria-live="assertive">
          <div className="flex items-center gap-3"><R.icon className="h-9 w-9" /><div><p className="text-2xl font-extrabold">{R.title}</p><p className="text-sm">{result.message}</p></div></div>
          {t && (
            <div className="mt-4 space-y-3 rounded-xl bg-surface p-4 text-fg">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-lg font-bold">{t.passenger}</p><p className="text-xs text-muted">{t.phone}</p></div>
                <p className="text-3xl font-extrabold">Seat {t.seat}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted">Booking</dt><dd className="font-mono font-bold">{t.bookingCode}</dd>
                <dt className="text-muted">Route</dt><dd className="font-semibold">{t.route}</dd>
                <dt className="text-muted">Departure</dt><dd className="font-semibold">{fmtDate(t.departureAt)} {fmtTime(t.departureAt)}</dd>
                <dt className="text-muted">Payment</dt><dd className="font-semibold">{methodLabel(t.paymentMethod)} • {PAYMENT_LABEL[t.paymentStatus] || t.paymentStatus}</dd>
                <dt className="text-muted">Status</dt><dd><Badge tone={t.checkInStatus === 'BOARDED' ? 'green' : 'slate'}>{t.checkInStatus === 'NONE' ? 'not boarded' : t.checkInStatus.replace('_', ' ').toLowerCase()}</Badge></dd>
              </dl>

              {cashDue && (
                <p className="rounded-lg bg-warning-soft p-2 text-xs font-semibold text-warning">
                  {canCollect
                    ? `Cash is due: collect ${formatCurrency(t.fare)} from the passenger, then press "Cash received".`
                    : `Cash is due: collect ${formatCurrency(t.fare)}, then record it on the seat map.`}
                </p>
              )}

              {/* cash still due: record it here (boarding is blocked until then) */}
              {canCollect && (
                <div className="flex flex-wrap gap-2">
                  {result.result === 'VALID' && t.checkInStatus === 'NONE' && (
                    <button type="button" disabled={working} className={btnGhost} onClick={() => submit(result.code, 'CHECK_IN', 'manual')}>Check in</button>
                  )}
                  {result.result === 'VALID' && t.checkInStatus !== 'BOARDED' ? (
                    <>
                      <button type="button" disabled={working} className={`${btnPrimary} inline-flex flex-1 items-center justify-center gap-1.5`} onClick={() => collectCash(true)}>
                        <Banknote className="h-4 w-4" /> {collecting ? 'Recording...' : 'Cash received & board'}
                      </button>
                      <button type="button" disabled={working} className={btnGhost} onClick={() => collectCash(false)}>Cash received only</button>
                    </>
                  ) : (
                    <button type="button" disabled={working} className={`${btnPrimary} inline-flex flex-1 items-center justify-center gap-1.5`} onClick={() => collectCash(false)}>
                      <Banknote className="h-4 w-4" /> {collecting ? 'Recording...' : `Cash received (${formatCurrency(t.fare)})`}
                    </button>
                  )}
                </div>
              )}

              {/* cash is due but the scan response has no booking id: boarding stays blocked, cash goes on the seat map */}
              {cashDue && !canCollect && result.result === 'VALID' && t.checkInStatus !== 'BOARDED' && (
                <div className="flex gap-2">
                  {t.checkInStatus === 'NONE' && <button type="button" disabled={working} className={btnGhost} onClick={() => submit(result.code, 'CHECK_IN', 'manual')}>Check in</button>}
                  <button type="button" disabled className={`${btnPrimary} flex-1`}>Board passenger (record cash first)</button>
                </div>
              )}

              {/* normal case: nothing owed */}
              {!cashDue && result.result === 'VALID' && t.checkInStatus !== 'BOARDED' && (
                <div className="flex gap-2">
                  {t.checkInStatus === 'NONE' && <button type="button" disabled={working} className={btnGhost} onClick={() => submit(result.code, 'CHECK_IN', 'manual')}>Check in</button>}
                  <button type="button" disabled={working} className={`${btnPrimary} flex-1`} onClick={() => submit(result.code, 'BOARD', 'manual')}>Board passenger</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}