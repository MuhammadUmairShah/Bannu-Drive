// Tiny event-based toast + confirm helpers. No hook needed, callable from anywhere.
// <ToastHost /> (mounted once in App) renders them.
const listeners = new Set();

function emit(event) {
  listeners.forEach((fn) => fn(event));
}

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let nextId = 1;

function push(type, message) {
  if (!message) return;
  emit({ kind: 'toast', id: nextId++, type, message: String(message) });
}

export const toast = {
  success: (message) => push('success', message),
  error: (message) => push('error', message),
  info: (message) => push('info', message)
};

// Promise based confirmation dialog: const ok = await confirmDialog({ title, message })
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    emit({ kind: 'confirm', id: nextId++, title, message, confirmText, danger, resolve });
  });
}

// Asks for a cancellation reason. Resolves to the chosen reason (string) or null if dismissed.
export function promptReason({ title = 'Cancel?', message = '', reasons = [], confirmText = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    emit({ kind: 'reason', id: nextId++, title, message, reasons, confirmText, resolve });
  });
}
