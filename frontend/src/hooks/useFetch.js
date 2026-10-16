import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';

// GET helper with loading / error / retry. `params` changes re-fetch (debounced for typing).
export default function useFetch(url, params = {}, { debounce = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const key = JSON.stringify(params);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    try {
      if (!silent) { setLoading(true); setError(''); }
      const clean = Object.fromEntries(Object.entries(JSON.parse(key)).filter(([, v]) => v !== '' && v != null));
      const response = await api.get(url, { params: clean });
      if (mine === seq.current) setData(response.data);
    } catch (err) {
      if (mine === seq.current && !silent) setError(getErrorMessage(err, 'Could not load data'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [url, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(load, debounce);
    return () => clearTimeout(t);
  }, [load, debounce, enabled]);

  return { data, loading, error, reload: load, setData };
}
