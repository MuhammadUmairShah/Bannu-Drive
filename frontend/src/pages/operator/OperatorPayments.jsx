import { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCw, CheckCircle2, XCircle, Clock, Eye, Settings2 } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { toast, promptReason } from '../../utils/toast';
import { useSocketEvent } from '../../context/RealtimeContext';
import ReceiptViewer from '../../components/ReceiptViewer';

const TABS = [['pending', 'To verify'], ['approved', 'Approved'], ['rejected', 'Rejected']];

// ---------- the operator's own EasyPaisa / JazzCash accounts (what customers are asked to pay into) ----------
function AccountsCard() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get('/coach/operator/me').then((r) => {
      const a = r.data.operator?.paymentAccounts || {};
      setForm({
        easypaisa: { number: a.easypaisa?.number || '', title: a.easypaisa?.title || '', enabled: !!a.easypaisa?.enabled },
        jazzcash: { number: a.jazzcash?.number || '', title: a.jazzcash?.title || '', enabled: !!a.jazzcash?.enabled }
      });
    }).catch(() => {});
  }, []);

  if (!form) return null;
  const set = (w, k, v) => setForm((f) => ({ ...f, [w]: { ...f[w], [k]: v } }));
  const anyOn = form.easypaisa.enabled || form.jazzcash.enabled;

  async function save() {
    try {
      setSaving(true);
      await api.patch('/coach/operator/me', { paymentAccounts: form });
      toast.success('Payment accounts saved');
      setOpen(false);
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <div className="card space-y-3 p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-fg"><Settings2 className="h-4 w-4 text-link" /> My payment accounts</span>
        <span className={`text-xs font-semibold ${anyOn ? 'text-link' : 'text-warning'}`}>{anyOn ? 'Customers can pay by wallet' : 'Not set up: customers cannot pay by wallet yet'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line pt-3">
          {[['easypaisa', 'EasyPaisa'], ['jazzcash', 'JazzCash']].map(([w, label]) => (
            <div key={w} className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-fg">
                <input type="checkbox" checked={form[w].enabled} onChange={(e) => set(w, 'enabled', e.target.checked)} /> Accept {label}
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={form[w].number} onChange={(e) => set(w, 'number', e.target.value)} inputMode="tel" maxLength={16} placeholder={`${label} number (03001234567)`} className="rounded-xl border border-field-line bg-surface px-3 py-2 text-sm text-fg" />
                <input value={form[w].title} onChange={(e) => set(w, 'title', e.target.value)} maxLength={60} placeholder="Account title (name)" className="rounded-xl border border-field-line bg-surface px-3 py-2 text-sm text-fg" />
              </div>
            </div>
          ))}
          <button type="button" disabled={saving} onClick={save} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">{saving ? 'Saving...' : 'Save accounts'}</button>
        </div>
      )}
    </div>
  );
}

export default function OperatorPayments() {
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) { setLoading(true); setError(''); }
      const res = await api.get('/coach/operator/payments', { params: { tab } });
      setItems(res.data.payments);
    } catch (err) {
      if (!silent) setError(getErrorMessage(err, 'Could not load payments'));
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  // a customer just sent proof (or an order changed): refresh the list
  useSocketEvent('notification:new', (n) => { if (n.serviceType === 'coach_booking') load(true); });

  async function approve(p) {
    if (busy) return;
    if (!window.confirm(`Approve ${formatCurrency(p.amount)} from ${p.customer?.name || 'the customer'}?\nCheck that this money is really in your ${p.wallet} account (Transaction ID ${p.tid}).`)) return;
    try {
      setBusy(p._id);
      const res = await api.patch(`/coach/operator/payments/${p._id}/approve`);
      toast.success(res.data.message);
      load(true);
    } catch (err) { toast.error(getErrorMessage(err)); load(true); } finally { setBusy(null); }
  }

  async function reject(p) {
    if (busy) return;
    const reason = await promptReason({
      title: `Reject payment for ${p.orderCode}?`,
      message: 'The customer will see this reason and can send new proof.',
      reasons: ['Money not received', 'Wrong amount', 'Transaction ID does not match', 'Receipt is not clear', 'Other'],
      confirmText: 'Reject payment'
    });
    if (reason === null) return;
    try {
      setBusy(p._id);
      const res = await api.patch(`/coach/operator/payments/${p._id}/reject`, { reason });
      toast.success(res.data.message);
      load(true);
    } catch (err) { toast.error(getErrorMessage(err)); load(true); } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-fg"><Wallet className="h-6 w-6 text-link" /> Wallet payments</h1>
          <p className="text-xs text-muted">Check the receipt and your wallet, then approve or reject</p>
        </div>
        <button type="button" onClick={() => load()} className="inline-flex items-center gap-1 rounded-xl border border-field-line px-3 py-2 text-xs font-semibold text-fg"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      <AccountsCard />

      <div className="flex gap-2 border-b border-line" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === key ? 'border-primary text-link' : 'border-transparent text-muted hover:text-fg'}`}>{label}</button>
        ))}
      </div>

      {loading ? <p className="py-12 text-center text-sm text-muted">Loading...</p>
        : error ? <div className="space-y-2 p-6 text-center"><p className="text-sm text-danger">{error}</p><button type="button" onClick={() => load()} className="rounded-xl bg-fg px-4 py-2 text-xs font-semibold text-bg">Try again</button></div>
        : items.length === 0 ? <div className="card p-10 text-center"><p className="text-sm font-semibold text-fg">{tab === 'pending' ? 'Nothing to verify right now' : `No ${tab} payments`}</p></div>
        : (
          <div className="space-y-3">
            {items.map((p) => (
              <div key={p._id} className="card space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-fg">Booking <span className="font-mono">{p.orderCode}</span></p>
                    {p.trip && <p className="text-xs text-muted">{p.trip.fromCity} → {p.trip.toCity} • {fmtDate(p.trip.departureAt)} {fmtTime(p.trip.departureAt)}{p.trip.coach ? ` • ${p.trip.coach}` : ''}</p>}
                  </div>
                  <p className="text-lg font-extrabold text-fg">{formatCurrency(p.amount)}</p>
                </div>

                <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <p><span className="text-muted">Passenger:</span> {p.passengers.map((x) => x.name).filter(Boolean).join(', ') || p.customer?.name || '-'}</p>
                  <p><span className="text-muted">Seat:</span> {p.seats.join(', ')}</p>
                  <p><span className="text-muted">Customer:</span> {p.customer?.name}{p.customer?.phone ? ` (${p.customer.phone})` : ''}</p>
                  <p><span className="text-muted">Method:</span> <b>{p.wallet}</b></p>
                  <p><span className="text-muted">Transaction ID:</span> <b className="font-mono">{p.tid || '-'}</b></p>
                  <p><span className="text-muted">Paid from:</span> {p.senderNumber || '-'}</p>
                  <p className="sm:col-span-2 text-xs text-muted">Sent {fmtDate(p.submittedAt)} {fmtTime(p.submittedAt)}</p>
                </div>

                {tab === 'pending' && (
                  <p className="flex items-center gap-1 text-xs font-bold text-warning"><Clock className="h-3.5 w-3.5" /> Pending verification</p>
                )}
                {p.late && tab === 'pending' && (
                  <p className="rounded-lg border border-warning/40 bg-warning-soft p-2 text-xs text-warning">The seat hold ended before you checked. If you approve and the seats are still free, the booking is confirmed. If they were taken, the customer is refunded.</p>
                )}
                {tab === 'approved' && <p className="flex items-center gap-1 text-xs font-bold text-link"><CheckCircle2 className="h-3.5 w-3.5" /> Approved</p>}
                {tab === 'rejected' && <p className="flex items-center gap-1 text-xs font-bold text-danger"><XCircle className="h-3.5 w-3.5" /> Rejected: {p.rejectReason}</p>}

                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  {p.hasReceipt && <button type="button" onClick={() => setViewing(p._id)} className="inline-flex items-center gap-1 rounded-xl border border-field-line px-4 py-2 text-xs font-semibold text-fg"><Eye className="h-4 w-4" /> View Receipt</button>}
                  {tab === 'pending' && (
                    <>
                      <button type="button" disabled={busy === p._id} onClick={() => approve(p)} className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">Approve Payment</button>
                      <button type="button" disabled={busy === p._id} onClick={() => reject(p)} className="rounded-xl border border-danger/40 px-4 py-2 text-xs font-semibold text-danger hover:bg-danger-soft disabled:opacity-60">Reject Payment</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      {viewing && <ReceiptViewer paymentId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
