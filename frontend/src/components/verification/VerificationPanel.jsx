import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Upload, Eye, Lock, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import { Badge, Loading, ErrorBox, btnGhost, btnPrimary } from '../ui';
import DocumentViewer from './DocumentViewer';
import { ACCEPT, STATUS_LABEL, STATUS_TONE, MAX_DOC_MB, checkFile, fmtDate } from './docUtils';

const CASE_COPY = {
  PENDING: 'Upload all required documents to start your verification.',
  UNDER_REVIEW: 'Your documents are being reviewed by our team. You will be notified.',
  APPROVED: 'Your account is verified.',
  REJECTED: 'Some documents were not accepted. Please fix them and upload again.'
};

// Self-service document upload for drivers and operators.
export default function VerificationPanel() {
  const { refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyType, setBusyType] = useState('');
  const [viewing, setViewing] = useState(null);
  const inputs = useRef({});

  const load = useCallback(async () => {
    try {
      const res = await api.get('/verification/me');
      setData(res.data);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your verification status'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function upload(type, file) {
    const problem = checkFile(file);
    if (problem) return toast.error(problem);

    const form = new FormData();
    form.append('type', type);
    form.append('file', file);

    setBusyType(type);
    try {
      const res = await api.post('/verification/documents', form);
      toast.success(res.data.message || 'Uploaded');
      await load();
      refreshUser(); // verification may have changed the account state
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setBusyType('');
      if (inputs.current[type]) inputs.current[type].value = '';
    }
  }

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading text="Loading verification..." />;

  const byType = Object.fromEntries(data.documents.map((d) => [d.type, d]));
  const status = data.case?.status || 'PENDING';

  return (
    <section className="card p-5 space-y-4" aria-label="Account verification">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-link" />
          <h2 className="font-display text-base font-bold text-fg">Verification documents</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          <button type="button" className={btnGhost} onClick={load} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <p className="text-xs text-muted">{CASE_COPY[status]}</p>
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[11px] text-muted">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Your documents are stored privately. Only you and the Bannu Drive verification team can see them. JPG, PNG, WEBP or PDF, up to {MAX_DOC_MB} MB.
      </p>

      <ul className="divide-y divide-line">
        {data.requirements.map((req) => {
          const doc = byType[req.type];
          const locked = doc?.status === 'APPROVED';
          return (
            <li key={req.type} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  {req.label} {req.required ? <span className="text-danger">*</span> : <span className="text-[11px] font-normal text-subtle">(optional)</span>}
                </p>
                <p className="text-[11px] text-muted">{req.hint}</p>
                {doc?.status === 'REJECTED' && (
                  <p className="mt-1 text-xs font-semibold text-danger">
                    {doc.reuploadRequested ? 'Please upload again: ' : 'Rejected: '}{doc.rejectionReason}
                  </p>
                )}
                {doc && <p className="mt-0.5 text-[11px] text-subtle">Uploaded {fmtDate(doc.uploadedAt)}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {doc ? <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge> : <Badge>Missing</Badge>}
                {doc && (
                  <button type="button" className={btnGhost} onClick={() => setViewing({ doc, label: req.label })} aria-label={`View ${req.label}`}>
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                {!locked && (
                  <>
                    <input
                      ref={(el) => { inputs.current[req.type] = el; }}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={(e) => e.target.files[0] && upload(req.type, e.target.files[0])}
                    />
                    <button type="button" className={btnPrimary} disabled={busyType === req.type} onClick={() => inputs.current[req.type]?.click()}>
                      <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" />{busyType === req.type ? 'Uploading...' : doc ? 'Replace' : 'Upload'}</span>
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <DocumentViewer doc={viewing?.doc} title={viewing?.label} onClose={() => setViewing(null)} />
    </section>
  );
}
