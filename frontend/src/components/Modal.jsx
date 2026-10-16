import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="flex min-h-screen items-center justify-center p-4 text-center sm:p-0">
        <div className="fixed inset-0 bg-scrim backdrop-blur-[2px] transition-opacity" onClick={onClose} />

        <div className={`relative w-full transform overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-pop transition-all sm:my-8 ${maxWidth}`}>
          <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
            <h3 className="font-display text-lg font-bold text-fg">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
