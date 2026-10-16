import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Star } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';

export default function AdminRatings() {
  const [ratings, setRatings] = useState([]);
  const [summary, setSummary] = useState({ average: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ rating: '', serviceType: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const response = await api.get('/admin/ratings', { params });
      if (response.data.success) {
        setRatings(response.data.ratings);
        setSummary({ average: response.data.average, count: response.data.count });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Ratings</h1>
          <p className="text-xs text-muted">
            {summary.count} rating{summary.count === 1 ? '' : 's'} shown{summary.count ? ` • average ${summary.average} / 5` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <select value={filters.rating} onChange={(e) => setFilters({ ...filters, rating: e.target.value })} className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
            <option value="">All stars</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
          </select>
          <select value={filters.serviceType} onChange={(e) => setFilters({ ...filters, serviceType: e.target.value })} className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
            <option value="">Rides & deliveries</option>
            <option value="ride">Rides</option>
            <option value="delivery">Deliveries</option>
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center"><RefreshCw className="w-6 h-6 animate-spin text-link mx-auto" /></div>
        ) : error ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-danger">{error}</p>
            <button type="button" onClick={load} className="text-xs font-semibold text-link">Try again</button>
          </div>
        ) : ratings.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">No ratings found.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
              <tr><th className="px-5 py-3">Driver</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Rating</th><th className="px-5 py-3">Comment</th><th className="px-5 py-3">Date</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ratings.map((r) => (
                <tr key={r._id}>
                  <td className="px-5 py-3 font-semibold text-fg">{r.driver?.name || '-'}</td>
                  <td className="px-5 py-3">{r.customer?.name || '-'}</td>
                  <td className="px-5 py-3 capitalize">{r.serviceType}</td>
                  <td className="px-5 py-3"><span className="inline-flex items-center gap-0.5 font-bold text-warning">{r.rating}<Star className="w-3 h-3 fill-warning text-warning" /></span></td>
                  <td className="px-5 py-3 text-muted max-w-xs break-words">{r.review || '-'}</td>
                  <td className="px-5 py-3 text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
