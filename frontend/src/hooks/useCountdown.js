import { useEffect, useMemo, useState } from 'react';
import { clockOffset, secondsLeft } from '../utils/seatSync';

// Seconds until `expiresAt`, ticking every second, measured against the SERVER's clock (serverTime from the same response).
export default function useCountdown(expiresAt, serverTime) {
  const offset = useMemo(() => clockOffset(serverTime), [serverTime]);
  const [left, setLeft] = useState(() => secondsLeft(expiresAt, offset));

  useEffect(() => {
    setLeft(secondsLeft(expiresAt, offset));
    if (!expiresAt) return undefined;
    const t = setInterval(() => setLeft(secondsLeft(expiresAt, offset)), 1000);
    return () => clearInterval(t);
  }, [expiresAt, offset]);

  return left;
}
