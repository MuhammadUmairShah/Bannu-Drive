import { Loader2 } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

// Shows the backend's estimate next to the customer's own offer.
export default function FareSummary({ estimate, loading, error, offered, hasPoints }) {
  return (
    <div className="p-4 bg-surface-2 border border-line rounded-xl text-xs space-y-2">
      <span className="font-bold text-fg">Fare Summary</span>

      {!hasPoints ? (
        <p className="text-muted">Select pickup and destination to see the estimated fare.</p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Calculating fare...
        </p>
      ) : error ? (
        <p className="text-danger">{error}</p>
      ) : estimate ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-muted">Distance</p>
            <p className="font-bold text-fg">{estimate.distanceKm} km</p>
          </div>
          <div>
            <p className="text-muted">Estimated Fare</p>
            <p className="font-bold text-link">{formatCurrency(estimate.estimatedFare)}</p>
          </div>
          <div>
            <p className="text-muted">Your Offer</p>
            <p className="font-bold text-fg">{formatCurrency(Number(offered) || 0)}</p>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-subtle">Payment is cash to the driver on completion.</p>
    </div>
  );
}
