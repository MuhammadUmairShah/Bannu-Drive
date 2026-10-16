import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribeToasts } from '../utils/toast';

const STYLES = {
  success: { box: 'border-primary/30 bg-surface', bar: 'bg-primary', Icon: CheckCircle2, icon: 'text-link' },
  error: { box: 'border-danger/30 bg-surface', bar: 'bg-danger-solid', Icon: AlertCircle, icon: 'text-danger' },
  info: { box: 'border-line-strong bg-surface', bar: 'bg-info', Icon: Info, icon: 'text-info' }
};

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [reasonDialog, setReasonDialog] = useState(null);
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');

  useEffect(() => {
    return subscribeToasts((event) => {
      if (event.kind === 'confirm') {
        setDialog(event);
        return;
      }

      if (event.kind === 'reason') {
        setReason(event.reasons[0] || '');
        setCustom('');
        setReasonDialog(event);
        return;
      }

      setToasts((current) => [...current.slice(-3), event]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== event.id)), 4500);
    });
  }, []);

  function closeDialog(result) {
    dialog?.resolve(result);
    setDialog(null);
  }

  function closeReason(ok) {
    const value = reason === 'Other' ? custom.trim() || 'Other' : reason;
    reasonDialog?.resolve(ok ? value || 'No reason given' : null);
    setReasonDialog(null);
  }

  return (
    <>
      <div className="fixed top-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const { box, bar, Icon, icon } = STYLES[t.type] || STYLES.info;
          return (
            <div key={t.id} className={`relative flex items-start gap-2.5 overflow-hidden rounded-xl border py-3 pl-4 pr-3 text-sm text-fg shadow-pop ${box}`}>
              <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden="true" />
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} />
              <p className="flex-1">{t.message}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}
                className="rounded text-subtle transition-colors hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {reasonDialog && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-pop">
            <h3 className="font-display text-lg font-bold text-fg">{reasonDialog.title}</h3>
            {reasonDialog.message && <p className="mt-1.5 text-sm text-muted">{reasonDialog.message}</p>}
            <div className="mt-4 space-y-2">
              {reasonDialog.reasons.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm text-fg">
                  <input type="radio" className="h-4 w-4 accent-primary" name="cancel-reason" checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
              {reason === 'Other' && (
                <input
                  type="text" maxLength={150} value={custom} onChange={(e) => setCustom(e.target.value)}
                  placeholder="Tell us why (optional)"
                  className="field"
                />
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => closeReason(false)} className="rounded-xl border border-field-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-primary hover:bg-primary-soft">
                Keep it
              </button>
              <button type="button" onClick={() => closeReason(true)} className="rounded-xl bg-danger-solid px-4 py-2 text-sm font-semibold text-on-danger transition-colors hover:bg-danger-solid-hover">
                {reasonDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-pop">
            <h3 className="font-display text-lg font-bold text-fg">{dialog.title}</h3>
            {dialog.message && <p className="mt-1.5 text-sm text-muted">{dialog.message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeDialog(false)}
                className="rounded-xl border border-field-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-primary hover:bg-primary-soft"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => closeDialog(true)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  dialog.danger
                    ? 'bg-danger-solid text-on-danger hover:bg-danger-solid-hover'
                    : 'bg-primary text-on-primary hover:bg-primary-hover'
                }`}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
