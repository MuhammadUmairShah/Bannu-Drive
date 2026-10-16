import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Download, ExternalLink, RotateCw, ZoomIn, ZoomOut, RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isCanceled = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError';

// With responseType "blob", an error body arrives as a Blob too, so read the server's message out of it.
async function readableError(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.message) return parsed.message;
    } catch { /* not JSON, fall through */ }
  }
  return getErrorMessage(err, 'Could not load the receipt');
}

const iconBtn = 'inline-flex items-center gap-1.5 rounded-xl border border-field-line px-3 py-2 text-xs font-semibold text-fg transition-colors hover:border-primary hover:bg-primary-soft disabled:opacity-50';

/**
 * Popup that shows a payment receipt (image or PDF).
 * The file is fetched with the user's login (never a public link) and shown from memory.
 *
 * Props
 *  - paymentId  id of the payment (used to build the default endpoint)
 *  - onClose    called when the popup should close
 *  - endpoint   optional: override the receipt URL (e.g. for other payment types)
 *  - title      optional heading (default "Payment receipt")
 *  - subtitle   optional line under the heading (e.g. "Booking BO-69FQ9DKR")
 */
export default function ReceiptViewer({ paymentId, onClose, endpoint, title = 'Payment receipt', subtitle }) {
  const [url, setUrl] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ---- load the receipt (cancelled if the popup closes, retried when "Try again" is pressed) ----
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    let alive = true;

    setLoading(true); setError(''); setUrl(''); setType('');
    setZoomed(false); setRotation(0); setImageFailed(false);

    api.get(endpoint || `/coach/manual-payments/${paymentId}/receipt`, { responseType: 'blob', signal: controller.signal })
      .then((res) => {
        if (!alive) return;
        const blob = res.data;
        const mime = (blob.type || res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
        objectUrl = URL.createObjectURL(blob);
        setType(mime);
        setUrl(objectUrl);
      })
      .catch(async (err) => {
        if (!alive || isCanceled(err)) return;
        const message = await readableError(err);
        if (alive) setError(message);
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [paymentId, endpoint, attempt]);

  // ---- page behind the popup: no scrolling, and focus returns to where it was ----
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, []);

  // ---- keyboard: Esc closes, Tab stays inside the popup ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const isPdf = type === 'application/pdf';
  const isImage = type.startsWith('image/') && !imageFailed;
  const fileName = `receipt-${paymentId || 'payment'}.${EXTENSION[type] || 'file'}`;
  const ready = !!url && !loading && !error;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-viewer-title"
        className="card relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl p-0 sm:rounded-2xl"
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p id="receipt-viewer-title" className="text-sm font-bold text-fg">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close receipt" className="rounded-lg p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* content */}
        <div className="min-h-[240px] flex-1 overflow-auto bg-surface-2 p-3">
          {loading && (
            <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted" role="status" aria-live="polite">
              <RefreshCw className="h-6 w-6 animate-spin text-link" />
              Loading receipt...
            </div>
          )}

          {!loading && error && (
            <div className="flex h-60 flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
              <AlertTriangle className="h-7 w-7 text-danger" />
              <p className="text-sm text-danger">{error}</p>
              <button type="button" onClick={retry} className={iconBtn}><RefreshCw className="h-3.5 w-3.5" /> Try again</button>
            </div>
          )}

          {ready && isImage && (
            <div className="flex min-h-full items-center justify-center">
              <img
                src={url}
                alt="Payment receipt"
                onError={() => setImageFailed(true)}
                onClick={() => setZoomed((z) => !z)}
                style={{ transform: `rotate(${rotation}deg)` }}
                className={`rounded-lg border border-line bg-surface transition-transform duration-200 ${zoomed ? 'max-w-none cursor-zoom-out' : 'max-h-[60vh] max-w-full cursor-zoom-in object-contain'}`}
              />
            </div>
          )}

          {ready && isPdf && (
            <iframe title="Payment receipt (PDF)" src={url} className="h-[60vh] w-full rounded-lg border border-line bg-surface" />
          )}

          {ready && !isImage && !isPdf && (
            <div className="flex h-60 flex-col items-center justify-center gap-3 px-4 text-center">
              <FileText className="h-8 w-8 text-muted" />
              <p className="text-sm text-muted">This file can't be previewed here. You can still open or download it.</p>
            </div>
          )}
        </div>

        {/* toolbar */}
        {ready && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            {isImage && (
              <>
                <button type="button" onClick={() => setZoomed((z) => !z)} className={iconBtn}>
                  {zoomed ? <><ZoomOut className="h-3.5 w-3.5" /> Fit to screen</> : <><ZoomIn className="h-3.5 w-3.5" /> Zoom in</>}
                </button>
                <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className={iconBtn}><RotateCw className="h-3.5 w-3.5" /> Rotate</button>
              </>
            )}
            <a href={url} target="_blank" rel="noreferrer" className={`${iconBtn} ml-auto`}><ExternalLink className="h-3.5 w-3.5" /> Open in new tab</a>
            <a href={url} download={fileName} className={iconBtn}><Download className="h-3.5 w-3.5" /> Download</a>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}