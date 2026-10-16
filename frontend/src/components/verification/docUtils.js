export const STATUS_TONE = { PENDING: 'amber', UNDER_REVIEW: 'violet', APPROVED: 'green', REJECTED: 'red' };
export const STATUS_LABEL = { PENDING: 'Pending', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', REJECTED: 'Rejected' };
export const MAX_DOC_MB = 5;
export const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export const typeLabel = (type) => String(type || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Returns an error message, or '' when the file looks acceptable (the server re-checks everything)
export function checkFile(file) {
  if (!file) return 'Please choose a file';
  const okType = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type);
  if (!okType) return 'Only JPG, PNG, WEBP or PDF files are allowed';
  if (file.size > MAX_DOC_MB * 1024 * 1024) return `File is too large (max ${MAX_DOC_MB} MB)`;
  return '';
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '');
