import { useCallback, useEffect, useState } from 'react';
import { Wallet, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDateTime } from '../../utils/dates';
import { toast } from '../../utils/toast';
import Modal from '../../components/Modal';
import { PageHeader, DataTable, Badge, Stat, inputCls, btnGhost, btnPrimary } from '../../components/ui';

const TONE = { PAID: 'green', REFUNDED: 'slate', PENDING: 'amber', PROCESSING: 'amber', FAILED: 'red', EXPIRED: 'red', CANCELLED: 'slate' };
const KIND = { CANCELLATION: 'Cancellation', LATE_PAYMENT_CONFLICT: 'Late payment, seats taken', DUPLICATE_PAYMENT: 'Duplicate payment', ORDER_CLOSED: 'Order already closed' };

export default function CoachPayments() {
  const [tab, setTab] = useState('refunds');
  const [status, setStatus] = useState('');
  const [payments, setPayments] = useState({ payments: [], summary: { received: 0, refunded: 0, refundsRequired: 0 } });
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([api.get('/coach/admin/payments', { params: status ? { status } : {} }), api.get('/coach/admin/refunds')]);
      setPayments(p.data); setRefunds(r.data.refunds); setError('');
    } catch (err) { setError(getErrorMessage(err)); } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function markProcessed(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/coach/admin/refunds/${processing._id}/processed`, { reference: reference.trim() });
      toast.success('Refund marked as processed');
      setProcessing(null); setReference(''); load();
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setBusy(false); }
  }

  const sm = payments.summary;
  return (
    <div className="space-y-5">
      <PageHeader icon={Wallet} title="Coach payments & refunds" subtitle="Online payments for coach bookings. Provider credentials never appear here." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Received (online)" value={formatCurrency(sm.received)} tone="green" />
        <Stat label="Refunded" value={formatCurrency(sm.refunded)} />
        <Stat label="Refunds waiting" value={sm.refundsRequired} tone={sm.refundsRequired ? 'amber' : undefined} />
      </div>

      <div className="flex gap-2" role="tablist">
        {[['refunds', `Refunds to process (${refunds.length})`], ['payments', 'All payments']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-xs font-semibold ${tab === k ? 'bg-primary text-on-primary' : 'border border-field-line text-fg'}`}>{l}</button>
        ))}
      </div>

      {tab === 'refunds' ? (
        <DataTable rows={refunds} loading={loading} error={error} onRetry={load} empty={{ title: 'No refunds waiting', hint: 'Refunds the payment provider cannot send automatically appear here.' }}
          columns={[
            { label: 'Customer', render: (r) => <div><p className="font-semibold">{r.customer?.name}</p><p className="text-[11px] text-muted">{r.customer?.phone}</p></div> },
            { label: 'Booking', render: (r) => <span className="font-mono">{r.order?.orderCode}</span> },
            { label: 'Why', render: (r) => <div><p>{KIND[r.kind] || r.kind}</p><p className="text-[11px] text-muted">{r.reason}</p></div> },
            { label: 'Amount', render: (r) => <b>{formatCurrency(r.amount)}</b> },
            { label: 'Paid with', render: (r) => <span className="text-[11px]">{r.payment?.provider}<br /><span className="font-mono">{r.payment?.providerRef}</span></span> },
            { label: '', render: (r) => <button className={btnPrimary} onClick={() => setProcessing(r)}>Mark refunded</button> }
          ]} />
      ) : (
        <>
          <select className={`${inputCls} max-w-[12rem]`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>{Object.keys(TONE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <DataTable rows={payments.payments} loading={loading} error={error} onRetry={load} empty={{ title: 'No payments yet' }}
            columns={[
              { label: 'When', render: (p) => <span className="whitespace-nowrap">{fmtDateTime(p.createdAt)}</span> },
              { label: 'Customer', render: (p) => p.customer?.name },
              { label: 'Booking', render: (p) => <span className="font-mono">{p.order?.orderCode}</span> },
              { label: 'Provider', render: (p) => <span>{p.provider} {p.mode === 'sandbox' && <Badge tone="amber">test</Badge>}</span> },
              { label: 'Amount', render: (p) => <b>{formatCurrency(p.amount)}</b> },
              { label: 'Status', render: (p) => <span className="flex flex-wrap items-center gap-1"><Badge tone={TONE[p.status]}>{p.status}</Badge>{p.lateSuccess && <Badge tone="amber">late</Badge>}{p.needsAttention && <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-label="Needs attention" />}</span> }
            ]} />
        </>
      )}

      <Modal isOpen={!!processing} onClose={() => setProcessing(null)} title="Mark refund as processed">
        <form onSubmit={markProcessed} className="space-y-3">
          <p className="text-xs text-muted">Send {processing && formatCurrency(processing.amount)} back to {processing?.customer?.name} through {processing?.payment?.provider}, then enter the reference you received.</p>
          <input className={inputCls} autoFocus placeholder="Refund reference / transaction id" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={() => setProcessing(null)}>Cancel</button><button className={btnPrimary} disabled={busy || reference.trim().length < 3}>{busy ? 'Saving...' : 'Confirm'}</button></div>
        </form>
      </Modal>
    </div>
  );
}
