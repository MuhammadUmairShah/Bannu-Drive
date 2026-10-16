import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, Eye, Check, X, RotateCcw, Clock, Search } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import Modal from '../../components/Modal';
import { PageHeader, DataTable, Badge, Loading, ErrorBox, inputCls, btnGhost, btnPrimary, btnDanger } from '../../components/ui';
import DocumentViewer from '../../components/verification/DocumentViewer';
import { STATUS_LABEL, STATUS_TONE, typeLabel, fmtDate } from '../../components/verification/docUtils';

function ReasonModal({ ask, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); }, [ask]);

  async function submit(e) {
    e.preventDefault();
    if (reason.trim().length < 3) return toast.error('Please write a reason (at least 3 characters)');
    setBusy(true);
    try { await onSubmit(reason.trim()); } finally { setBusy(false); }
  }

  return (
    <Modal isOpen={!!ask} onClose={onClose} title={ask?.title || ''}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted">The user will see this message. Be specific so they know what to fix.</p>
        <textarea className={inputCls} rows={3} maxLength={300} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Photo is blurry, the licence number is not readable" />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnDanger} disabled={busy}>{busy ? 'Saving...' : ask?.confirm}</button>
        </div>
      </form>
    </Modal>
  );
}

function CaseReview({ userId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/verification/admin/cases/${userId}`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function review(doc, decision, reason) {
    setBusy(doc.id);
    try {
      const res = await api.patch(`/verification/admin/documents/${doc.id}/review`, { decision, reason });
      toast.success(res.data.message || 'Updated');
      await load();
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const current = data?.documents.filter((d) => d.isCurrent) || [];
  const older = data?.documents.filter((d) => !d.isCurrent) || [];
  const reqByType = Object.fromEntries((data?.requirements || []).map((r) => [r.type, r]));

  return (
    <Modal isOpen onClose={onClose} title="Verification review" maxWidth="max-w-4xl">
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-base font-bold text-fg">{data.user.name}</p>
              <p className="text-xs text-muted">{data.user.email} • {data.user.phone || 'no phone'} • <span className="capitalize">{data.user.role}</span></p>
              {data.user.role === 'driver' && <p className="text-xs text-muted">{data.user.vehicleType} {data.user.vehicleModel} • {data.user.vehicleNumber} • Licence {data.user.licenseNumber}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[data.case?.status]}>{STATUS_LABEL[data.case?.status]}</Badge>
              {data.user.isVerified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">not verified</Badge>}
            </div>
          </div>

          {data.documentsRequired && <p className="rounded-xl bg-surface-2 px-3 py-2 text-[11px] text-muted">The account becomes verified automatically once every required document is approved.</p>}

          <ul className="divide-y divide-line rounded-xl border border-line">
            {data.requirements.map((req) => {
              const doc = current.find((d) => d.type === req.type);
              return (
                <li key={req.type} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fg">{req.label} {req.required && <span className="text-danger">*</span>}</p>
                    {doc ? <p className="text-[11px] text-subtle">Uploaded {fmtDate(doc.uploadedAt)}{doc.reviewedAt ? ` • reviewed ${fmtDate(doc.reviewedAt)}` : ''}</p> : <p className="text-[11px] text-subtle">Not uploaded</p>}
                    {doc?.status === 'REJECTED' && <p className="text-xs text-danger">{doc.reuploadRequested ? 'Re-upload requested: ' : 'Rejected: '}{doc.rejectionReason}</p>}
                  </div>
                  {doc && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
                      <button className={btnGhost} onClick={() => setViewing({ doc, label: req.label })}><span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />View</span></button>
                      {doc.status === 'PENDING' && <button className={btnGhost} disabled={busy === doc.id} onClick={() => review(doc, 'UNDER_REVIEW')}><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Start review</span></button>}
                      {doc.status !== 'APPROVED' && <button className={btnPrimary} disabled={busy === doc.id} onClick={() => review(doc, 'APPROVED')}><span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Approve</span></button>}
                      {doc.status !== 'REJECTED' && <button className={btnDanger} disabled={busy === doc.id} onClick={() => setAsk({ doc, decision: 'REJECTED', title: `Reject ${req.label}`, confirm: 'Reject document' })}><span className="inline-flex items-center gap-1"><X className="h-3.5 w-3.5" />Reject</span></button>}
                      <button className={btnGhost} disabled={busy === doc.id} onClick={() => setAsk({ doc, decision: 'REUPLOAD', title: `Ask for a new ${req.label}`, confirm: 'Request re-upload' })}><span className="inline-flex items-center gap-1"><RotateCcw className="h-3.5 w-3.5" />Re-upload</span></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div>
            <p className="mb-1 text-xs font-semibold text-fg">History</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-[11px] text-muted">
              {[...(data.case?.history || [])].reverse().map((h, i) => (
                <li key={i}>{fmtDate(h.at)} • <b>{STATUS_LABEL[h.status] || h.status}</b> {h.note ? `• ${h.note}` : ''}</li>
              ))}
              {older.map((d) => (
                <li key={d.id}>{fmtDate(d.uploadedAt)} • earlier version of <b>{typeLabel(d.type)}</b> ({reqByType[d.type] ? STATUS_LABEL[d.status] : d.status}){d.rejectionReason ? ` • ${d.rejectionReason}` : ''}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <DocumentViewer doc={viewing?.doc} title={viewing?.label} onClose={() => setViewing(null)} />
      <ReasonModal
        ask={ask}
        onClose={() => setAsk(null)}
        onSubmit={async (reason) => { const a = ask; setAsk(null); await review(a.doc, a.decision, reason); }}
      />
    </Modal>
  );
}

export default function AdminVerification() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ status: 'UNDER_REVIEW', role: '', q: '' });
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const openId = params.get('user');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/verification/admin/cases', { params: { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page } });
      setRows(res.data.items.map((i) => ({ ...i, _id: i.user._id })));
      setPages(res.data.pages);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const set = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldCheck} title="Verification" subtitle="Review driver and operator documents. Documents are private and every view is logged." />

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs font-semibold text-fg">Status
          <select className={`${inputCls} mt-1`} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-fg">Type
          <select className={`${inputCls} mt-1`} value={filters.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="">Drivers & operators</option>
            <option value="driver">Drivers</option>
            <option value="operator">Operators</option>
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-xs font-semibold text-fg">Search
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-subtle" />
            <input className={`${inputCls} pl-9`} placeholder="Name, email or phone" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
          </div>
        </label>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{ title: 'No cases found', hint: 'Cases appear when drivers and operators upload documents.' }}
        columns={[
          { label: 'Applicant', render: (r) => (<div><p className="font-semibold">{r.user.name}</p><p className="text-[11px] text-muted">{r.user.email} • {r.user.phone}</p></div>) },
          { label: 'Type', render: (r) => <span className="capitalize">{r.user.role}</span> },
          { label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
          { label: 'Documents', render: (r) => `${r.documents} uploaded${r.awaitingReview ? `, ${r.awaitingReview} awaiting` : ''}` },
          { label: 'Verified', render: (r) => (r.user.isVerified ? <Badge tone="green">yes</Badge> : <Badge tone="amber">no</Badge>) },
          { label: 'Updated', render: (r) => fmtDate(r.updatedAt) },
          { label: '', render: (r) => <button className={btnPrimary} onClick={() => setParams({ user: r.user._id })}>Review</button> }
        ]}
      />

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <button className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-muted">Page {page} of {pages}</span>
          <button className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {openId && <CaseReview userId={openId} onClose={() => setParams({})} onChanged={load} />}
    </div>
  );
}
