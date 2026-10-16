// How payment state is described to people. Keep wording plain: this is what customers and operators read.
export const PAYMENT_LABEL = {
  UNPAID: 'Not paid',
  CASH_DUE: 'Cash: pay the operator',
  PENDING: 'Payment in progress',
  PAID: 'Paid',
  FAILED: 'Payment failed',
  EXPIRED: 'Payment expired',
  REFUND_REQUIRED: 'Refund pending',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled'
};

export const PAYMENT_TONE = {
  PAID: 'green', REFUNDED: 'slate', CASH_DUE: 'amber', PENDING: 'amber', UNPAID: 'slate',
  FAILED: 'red', EXPIRED: 'red', REFUND_REQUIRED: 'amber', CANCELLED: 'slate'
};

export const methodLabel = (m) => (m === 'CASH' ? 'Cash' : m === 'ONLINE' ? 'Online' : '');

export const paymentSummary = (b) => {
  if (!b?.paymentMethod && (!b?.paymentStatus || b.paymentStatus === 'UNPAID')) return '';
  return `${methodLabel(b.paymentMethod)}${b.paymentMethod ? ' • ' : ''}${PAYMENT_LABEL[b.paymentStatus] || b.paymentStatus}`;
};
