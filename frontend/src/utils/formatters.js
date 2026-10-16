export const formatCurrency = (amount) => {
  return `PKR ${Number(amount || 0).toLocaleString('en-PK')}`;
};

export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

export const formatTime = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatDateTime = (dateString) => {
  if (!dateString) return 'N/A';
  return `${formatDate(dateString)} at ${formatTime(dateString)}`;
};