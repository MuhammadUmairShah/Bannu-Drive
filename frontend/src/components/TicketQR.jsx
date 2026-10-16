import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders the ticket QR as an inline SVG (crisp when printed). The payload is an opaque token: no personal data.
export default function TicketQR({ value, size = 132 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    if (!value) return undefined;
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((s) => alive && setSvg(s)).catch(() => alive && setSvg(''));
    return () => { alive = false; };
  }, [value]);
  if (!svg) return <div style={{ width: size, height: size }} className="rounded-lg bg-surface-2" aria-hidden="true" />;
  return <div role="img" aria-label="Ticket QR code" style={{ width: size, height: size }} className="rounded-lg bg-white p-1 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
