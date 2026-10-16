import { useEffect, useRef, useState } from 'react';
import { searchPlaces } from '../utils/geo';

// Autocomplete: waits for a pause in typing, cancels the previous request, and ignores any answer that is no longer
// the latest (an old response can never overwrite a newer one).
export default function usePlaceSearch(query, { delay = 300, minLength = 2, enabled = true } = {}) {
  const [state, setState] = useState({ results: [], searching: false, error: '' });
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < minLength) {
      seq.current++;
      setState({ results: [], searching: false, error: '' });
      return undefined;
    }
    const id = ++seq.current;
    const controller = new AbortController();
    setState((s) => ({ ...s, searching: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlaces(q, { signal: controller.signal });
        if (id === seq.current) setState({ results, searching: false, error: '' });
      } catch (error) {
        if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return;
        if (id === seq.current) setState({ results: [], searching: false, error: 'Search is unavailable right now. Your text is kept: you can still pick the point on the map.' });
      }
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, delay, minLength, enabled]);

  return state;
}
