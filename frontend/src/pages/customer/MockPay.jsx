import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { toast } from '../../utils/toast';
import { Loading, ErrorBox } from '../../components/ui';

// SANDBOX GATEWAY PAGE: stands in for JazzCash / Easypaisa while developing. The backend only serves it when the
// mock provider is enabled (never in production). No real money is involved.
export default function MockPay() {
  const { ref } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => { api.get(`/coach/payments/mock/${ref}`).then((r) => setInfo(r.data)).catch((e) => setError(getErrorMessage(e, 'Payment not found'))); }, [ref]);

  async function complete(outcome, deliver = true) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      await api.post(`/coach/payments/mock/${ref}/complete`, { outcome, deliver });
      navigate(`/customer/checkout/${info.payment.orderId}`);
    } catch (err) { toast.error(getErrorMessage(err)); } finally { lock.current = false; setBusy(false); }
  }

  if (error) return <div className="mx-auto max-w-md py-16"><ErrorBox message={error} /></div>;
  if (!info) return <Loading />;

  return (
    <div className="mx-auto max-w-sm space-y-4 py-10">
      <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-xs font-bold text-warning"><FlaskConical className="h-4 w-4" /> Sandbox payment page: no real money</div>
      <div className="card space-y-1 p-5 text-center">
        <p className="text-xs text-muted">Booking {info.payment.orderCode}</p>
        <p className="text-3xl font-extrabold text-fg">{formatCurrency(info.payment.amount)}</p>
        <p className="font-mono text-[11px] text-subtle">{info.payment.reference}</p>
      </div>
      <button type="button" disabled={busy} onClick={() => complete('PAID')} className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60">Pay (success)</button>
      <button type="button" disabled={busy} onClick={() => complete('FAILED')} className="w-full rounded-xl border border-danger/40 py-3 text-sm font-semibold text-danger disabled:opacity-60">Fail the payment</button>
      <button type="button" disabled={busy} onClick={() => complete('PAID', false)} className="w-full rounded-xl border border-field-line py-2 text-xs font-semibold text-muted">Pay, but lose the callback (tests recovery)</button>
    </div>
  );
}
