import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Clock, CheckCircle2, XCircle, Banknote, CreditCard, RefreshCw, TimerReset, Smartphone, Copy, Upload, Hourglass, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { toast } from '../../utils/toast';
import { getSocket } from '../../utils/socket';
import { fmtCountdown } from '../../utils/seatSync';
import useCountdown from '../../hooks/useCountdown';
import BookingTicket from '../../components/BookingTicket';
import ReceiptViewer from '../../components/ReceiptViewer';
import { Loading, ErrorBox } from '../../components/ui';

const btn = 'rounded-xl px-5 py-3 text-sm font-semibold transition-colors disabled:opacity-60';

// Hands the customer to the payment provider as described by the server (never built from client data).
function continueToProvider(checkout, navigate) {
  if (!checkout) return false;
  if (checkout.kind === 'mock') { navigate(new URL(checkout.url).pathname); return true; }
  if (checkout.kind === 'redirect') { window.location.assign(checkout.url); return true; }
  if (checkout.kind === 'form') {
    const form = document.createElement('form');
    form.method = checkout.method || 'POST';
    form.action = checkout.url;
    Object.entries(checkout.fields || {}).forEach(([k, v]) => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = k; input.value = v;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    return true;
  }
  return false;
}

const WALLET_LABEL = { easypaisa: 'EasyPaisa', jazzcash: 'JazzCash' };
const MAX_RECEIPT = 2 * 1024 * 1024;

function copyText(text, what) {
  navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`)).catch(() => toast.info(text));
}

// Manual EasyPaisa / JazzCash payment: shows the operator's number, then collects Transaction ID + receipt.
function ManualPayPanel({ order, pay, busy, locked, onSwitch, onSubmit }) {
  const [tid, setTid] = useState('');
  const [sender, setSender] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [fileError, setFileError] = useState('');
  const [viewing, setViewing] = useState(false);
  const acct = pay.checkout;
  const options = order.manualOptions || [];

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(''); return undefined; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function pickFile(e) {
    const f = e.target.files?.[0];
    setFileError('');
    if (!f) { setFile(null); return; }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type)) { setFileError('Please choose a JPG, PNG, WebP or PDF file.'); setFile(null); return; }
    if (f.size > MAX_RECEIPT) { setFileError('This file is too large (max 2 MB). Please send a smaller screenshot.'); setFile(null); return; }
    setFile(f);
  }

  // ---- proof already sent: waiting for the operator ----
  if (pay.status === 'PROCESSING') {
    return (
      <div className="card space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-warning"><Hourglass className="h-4 w-4" /> Waiting for the operator to verify your payment</div>
        <p className="text-xs text-muted">The operator checks the receipt and confirms your booking. This page updates by itself. You will also get a notification.</p>
        <div className="space-y-1 rounded-xl bg-surface-2 p-3 text-sm">
          <p><span className="text-muted">Method:</span> <b>{WALLET_LABEL[pay.wallet] || 'Wallet'}</b></p>
          <p><span className="text-muted">Transaction ID:</span> <b className="font-mono">{pay.tid}</b></p>
          <p><span className="text-muted">Amount:</span> <b>{formatCurrency(pay.amount)}</b></p>
        </div>
        {pay.hasReceipt && <button type="button" onClick={() => setViewing(true)} className="text-xs font-semibold text-link">View my receipt</button>}
        <p className="text-[11px] text-subtle">Sent the wrong ID or receipt? Contact the operator, they can reject it so you can send it again.</p>
        {viewing && <ReceiptViewer paymentId={pay.id} onClose={() => setViewing(false)} />}
      </div>
    );
  }

  const canSubmit = tid.trim().length >= 6 && sender.trim().length >= 10 && !!file && !busy && !locked;
  return (
    <div className="card space-y-4 p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-fg"><Smartphone className="h-4 w-4" /> Pay with your mobile wallet</p>

      {options.length > 1 && (
        <div className="flex gap-2" role="radiogroup" aria-label="Payment method">
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={pay.wallet === o.id} disabled={!!busy || locked} onClick={() => pay.wallet !== o.id && onSwitch(o.id)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${pay.wallet === o.id ? 'border-primary bg-primary-soft text-link' : 'border-field-line text-fg hover:border-primary'}`}>{o.label}</button>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-primary/30 bg-primary-soft p-4">
        <p className="text-xs font-semibold text-link">1. Send exactly {formatCurrency(acct.amount)} to this {acct.walletLabel} account</p>
        <div className="flex items-center justify-between gap-2">
          <div><p className="text-lg font-extrabold tracking-wide text-fg">{acct.number}</p><p className="text-xs text-muted">Account title: <b>{acct.title}</b></p></div>
          <button type="button" onClick={() => copyText(acct.number, 'Number')} className="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-2 py-1 text-xs font-semibold text-link"><Copy className="h-3.5 w-3.5" /> Copy</button>
        </div>
        <p className="text-[11px] text-muted">Write <b className="font-mono">{acct.note}</b> in the payment note if your app has one.</p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-fg">2. Send us the proof</p>
        <label className="block text-xs text-muted">Transaction ID
          <input value={tid} onChange={(e) => setTid(e.target.value.toUpperCase())} maxLength={24} autoComplete="off" placeholder="e.g. 31234567890" className="mt-1 w-full rounded-xl border border-field-line bg-surface px-3 py-2 font-mono text-sm text-fg" />
        </label>
        <label className="block text-xs text-muted">The mobile number you paid from
          <input value={sender} onChange={(e) => setSender(e.target.value)} inputMode="tel" maxLength={16} placeholder="03001234567" className="mt-1 w-full rounded-xl border border-field-line bg-surface px-3 py-2 text-sm text-fg" />
        </label>
        <div className="text-xs text-muted">Receipt (screenshot or PDF, max 2 MB)
          <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-field-line px-3 py-3 text-sm font-semibold text-fg hover:border-primary">
            <Upload className="h-4 w-4" /> {file ? file.name : 'Choose file'}
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={pickFile} className="sr-only" />
          </label>
          {fileError && <p className="mt-1 text-danger">{fileError}</p>}
          {preview && <img src={preview} alt="Receipt preview" className="mt-2 max-h-48 rounded-lg border border-line" />}
        </div>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit({ tid: tid.trim(), sender: sender.trim(), file })} className={`${btn} w-full bg-primary text-on-primary hover:bg-primary-hover`}>{busy === 'proof' ? 'Sending...' : 'Submit Payment Proof'}</button>
        <p className="text-[11px] text-subtle">Your seats stay held while the operator checks the payment. Only submit a real receipt: fake proofs are rejected and may block your account.</p>
      </div>
    </div>
  );
}

export default function CoachCheckout() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const lock = useRef(false); // double-click guard: one action at a time
  const orderRef = useRef(null);
  orderRef.current = order;

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/coach/orders/${orderId}`);
      setOrder(res.data.order);
      setError('');
    } catch (err) {
      if (!orderRef.current) setError(getErrorMessage(err, 'Could not load this booking'));
    }
  }, [orderId]);

  useEffect(() => { load(); api.get('/coach/payment-options').then((r) => setOptions(r.data)).catch(() => {}); }, [load]);

  // Recovery: realtime update from the server, polling while a payment is in flight, and re-check on focus / network return
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (p) => { if (p.orderId === orderId) load(); };
    socket.on('coach:order-updated', onUpdate);
    const refetch = () => document.visibilityState !== 'hidden' && load();
    window.addEventListener('focus', refetch);
    window.addEventListener('online', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      socket.off('coach:order-updated', onUpdate);
      window.removeEventListener('focus', refetch);
      window.removeEventListener('online', refetch);
      document.removeEventListener('visibilitychange', refetch);
    };
  }, [orderId, load]);

  useEffect(() => {
    if (order?.status !== 'PENDING_PAYMENT') return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [order?.status, load]);

  const left = useCountdown(order?.holdExpiresAt, order?.serverTime);
  useEffect(() => { if (order?.holdExpiresAt && left === 0 && ['HOLD', 'PENDING_PAYMENT'].includes(order.status)) { const t = setTimeout(load, 4000); return () => clearTimeout(t); } return undefined; }, [left, order, load]);

  async function act(name, fn) {
    if (lock.current) return;
    lock.current = true; setBusy(name);
    try { await fn(); } catch (err) { toast.error(getErrorMessage(err)); await load(); } finally { lock.current = false; setBusy(''); }
  }

  const payCash = () => act('cash', async () => {
    const res = await api.post(`/coach/orders/${orderId}/pay`, { method: 'CASH' });
    setOrder(res.data.order); toast.success('Booking confirmed!');
  });
  const payOnline = (provider, retry = false) => act('online', async () => {
    const res = await api.post(`/coach/orders/${orderId}/pay`, { method: 'ONLINE', provider, retry });
    setOrder(res.data.order);
    if (!continueToProvider(res.data.order.payment?.checkout, navigate)) toast.info('Payment started. Follow the instructions from your provider.');
  });
  const payManual = (wallet) => act('online', async () => {
    const res = await api.post(`/coach/orders/${orderId}/pay`, { method: 'MANUAL', provider: wallet });
    setOrder(res.data.order);
  });
  const submitProof = ({ tid, sender, file }) => act('proof', async () => {
    const fd = new FormData();
    fd.append('tid', tid); fd.append('senderNumber', sender); fd.append('receipt', file);
    const res = await api.post(`/coach/orders/${orderId}/payment-proof`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    setOrder(res.data.order); toast.success('Payment proof sent. The operator will check it.');
  });
  const extend = () => act('extend', async () => { const res = await api.post(`/coach/orders/${orderId}/extend`); setOrder(res.data.order); toast.success('We added more time.'); });
  const release = () => act('release', async () => {
    if (!window.confirm('Release these seats? Someone else may book them.')) return;
    const res = await api.post(`/coach/orders/${orderId}/release`); setOrder(res.data.order);
  });
  const check = () => act('check', async () => {
    const res = await api.post(`/coach/orders/${orderId}/sync`); setOrder(res.data.order);
    toast.info(res.data.order.status === 'CONFIRMED' ? 'Payment confirmed!' : 'No payment received yet. If you paid, please wait a minute and check again.');
  });

  if (error) return <div className="mx-auto max-w-md py-16"><ErrorBox message={error} onRetry={load} /><div className="mt-3 text-center"><Link to="/customer/intercity" className="text-xs font-semibold text-link">Back to search</Link></div></div>;
  if (!order) return <Loading text="Loading your booking..." />;

  const trip = order.trip;
  const online = options?.online || [];
  const cashOn = options?.cash?.enabled;
  const pay = order.payment;

  // ------------- CONFIRMED -------------
  if (order.status === 'CONFIRMED' || order.status === 'COMPLETED') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center gap-2 font-bold text-link"><CheckCircle2 className="h-6 w-6" /> Booking confirmed</div>
        {order.lateConfirmed && <p className="rounded-xl border border-primary/30 bg-primary-soft p-3 text-xs text-link">Your payment arrived after the hold timer ended, but your seats were still free, so we confirmed them.</p>}
        {order.bookings.map((b) => <BookingTicket key={b._id} booking={b} />)}
        <p className="text-right text-sm font-semibold text-fg">Total: {formatCurrency(order.amount)} • {order.paymentMethod === 'CASH' ? 'pay cash to the operator when you travel' : 'paid online'}</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => navigate('/customer/bookings')} className={`${btn} flex-1 bg-primary text-on-primary hover:bg-primary-hover`}>My Bookings</button>
          <button type="button" onClick={() => navigate('/customer/intercity')} className={`${btn} flex-1 border border-field-line text-fg hover:bg-surface-2`}>Book another trip</button>
        </div>
      </div>
    );
  }

  // ------------- EXPIRED / CANCELLED -------------
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
    const expired = order.status === 'EXPIRED';
    return (
      <div className="mx-auto max-w-md space-y-4 py-10 text-center">
        <XCircle className="mx-auto h-10 w-10 text-danger" />
        <h1 className="text-lg font-bold text-fg">{expired ? 'Your seat hold expired' : 'This booking was cancelled'}</h1>
        <p className="text-sm text-muted">{expired ? 'The seats were released so other passengers can book them.' : (order.cancelReason || 'The seats were released.')}</p>
        {expired && pay && pay.manual && pay.submittedAt && (
          <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs text-warning">You already sent payment proof. If the operator approves it and your seats are still free, the booking is confirmed automatically. Otherwise the money is refunded. Please contact the operator if you are unsure.</div>
        )}
        {expired && pay && !pay.manual && (
          <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs text-warning">
            Already paid? Money that arrives late is matched to your booking automatically (or refunded if the seats were taken).
            <button type="button" onClick={check} disabled={!!busy} className="mt-2 block w-full rounded-lg border border-warning/40 py-1.5 font-semibold">{busy === 'check' ? 'Checking...' : 'Check my payment'}</button>
          </div>
        )}
        <Link to={`/customer/intercity/${order.scheduleId}`} className={`${btn} inline-block bg-primary text-on-primary`}>Choose seats again</Link>
      </div>
    );
  }

  // ------------- HOLD / PENDING_PAYMENT -------------
  const urgent = left > 0 && left < 60;
  const manualOptions = order.manualOptions || [];
  const manualPay = pay?.manual && order.status === 'PENDING_PAYMENT';
  const proofSent = manualPay && pay.status === 'PROCESSING';
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${urgent ? 'border-danger/40 bg-danger-soft text-danger' : 'border-warning/40 bg-warning-soft text-warning'}`} role="timer" aria-live="off">
        <span className="flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4" /> {proofSent ? 'Seats held while the operator verifies' : order.status === 'PENDING_PAYMENT' ? 'Finish your payment within' : 'Your seats are held for'}</span>
        <span className="font-mono text-2xl font-extrabold">{fmtCountdown(left)}</span>
      </div>

      <div className="card space-y-1 p-5">
        <p className="text-lg font-bold text-fg">{trip?.fromCity} → {trip?.toCity}</p>
        <p className="text-xs text-muted">{trip?.operator} • {fmtDate(trip?.departureAt)} • {fmtTime(trip?.departureAt)} → {fmtTime(trip?.arrivalAt)}</p>
        <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
          <div><p className="text-xs text-muted">Seat{order.seatCount > 1 ? 's' : ''} {order.seats.join(', ')} • Booking {order.orderCode}</p><p className="text-2xl font-extrabold text-fg">{formatCurrency(order.amount)}</p></div>
        </div>
      </div>

      {order.status === 'HOLD' ? (
        <div className="card space-y-3 p-5">
          <p className="text-sm font-bold text-fg">How would you like to pay?</p>
          {order.rejection && (
            <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-xs text-danger" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" /><span><b>Your last payment proof was rejected:</b> {order.rejection.reason}</span></div>
          )}
          {online.length === 0 && manualOptions.length === 0 && !cashOn && <p className="text-sm text-danger">No payment method is available right now. Please try again later.</p>}
          {/* {online.map((p) => (
            <button key={p.id} type="button" disabled={!!busy || left === 0} onClick={() => payOnline(p.id)} className={`${btn} flex w-full items-center justify-between border border-field-line text-fg hover:border-primary hover:bg-primary-soft`}>
              <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Pay online: {p.label}</span>
              {p.mode === 'sandbox' && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold text-warning">TEST</span>}
            </button>
          ))} */}
          {manualOptions.map((o) => (
            <button key={o.id} type="button" disabled={!!busy || left === 0} onClick={() => payManual(o.id)} className={`${btn} flex w-full items-center gap-2 border border-field-line text-fg hover:border-primary hover:bg-primary-soft`}>
              <Smartphone className="h-4 w-4" /> Pay with {o.label} (send to the operator, upload receipt)
            </button>
          ))}
          {cashOn && (
            <button type="button" disabled={!!busy || left === 0} onClick={payCash} className={`${btn} flex w-full items-center gap-2 border border-field-line text-fg hover:border-primary hover:bg-primary-soft`}>
              <Banknote className="h-4 w-4" /> {busy === 'cash' ? 'Confirming...' : 'Pay cash to the operator when I travel'}
            </button>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-3 text-xs">
            {order.canExtend && <button type="button" onClick={extend} disabled={!!busy} className="inline-flex items-center gap-1 font-semibold text-link"><TimerReset className="h-3.5 w-3.5" /> I need more time</button>}
            <button type="button" onClick={release} disabled={!!busy} className="ml-auto font-semibold text-danger">Release seats</button>
          </div>
        </div>
      ) : manualPay && pay.checkout ? (
        <>
          <ManualPayPanel order={order} pay={pay} busy={busy} locked={left === 0} onSwitch={payManual} onSubmit={submitProof} />
          {!proofSent && <div className="text-right text-xs"><button type="button" onClick={release} disabled={!!busy} className="font-semibold text-danger">Cancel and release seats</button></div>}
        </>
      ) : (
        <div className="card space-y-3 p-5">
          <p className="text-sm font-bold text-fg">Payment in progress{pay ? ` (${pay.provider})` : ''}</p>
          <p className="text-xs text-muted">Complete the payment with your provider. This page updates by itself. If you already paid, press “Check payment”.</p>
          <div className="flex flex-wrap gap-2">
            {pay?.checkout && <button type="button" onClick={() => continueToProvider(pay.checkout, navigate)} className={`${btn} bg-primary text-on-primary hover:bg-primary-hover`}>Continue to payment</button>}
            <button type="button" onClick={check} disabled={!!busy} className={`${btn} inline-flex items-center gap-2 border border-field-line text-fg hover:bg-surface-2`}><RefreshCw className={`h-4 w-4 ${busy === 'check' ? 'animate-spin' : ''}`} /> Check payment</button>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-line pt-3 text-xs">
            {pay && <button type="button" onClick={() => payOnline(pay.provider, true)} disabled={!!busy} className="font-semibold text-link">Start the payment again</button>}
            <button type="button" onClick={release} disabled={!!busy} className="ml-auto font-semibold text-danger">Cancel and release seats</button>
          </div>
        </div>
      )}
    </div>
  );
}
