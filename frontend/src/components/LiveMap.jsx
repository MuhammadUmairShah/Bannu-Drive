import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const BANNU = [32.99, 70.6];

const busIcon = L.divIcon({
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  html: '<div style="width:40px;height:40px;border-radius:9999px;background:#00a86b;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:20px">🚌</div>'
});

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Map with one moving bus marker and the route stops.
 * position = { latitude, longitude }   stops = [{ name, latitude, longitude, passed }]
 * Tiles: OpenStreetMap (free, no key).
 */
export default function LiveMap({ position, stops = [], className = 'h-80' }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const stopLayer = useRef(null);
  const following = useRef(true);
  const fitted = useRef(false);
  const [detached, setDetached] = useState(false);

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true }).setView(BANNU, 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current);
    stopLayer.current = L.layerGroup().addTo(map.current);
    map.current.on('dragstart', () => { following.current = false; setDetached(true); });
    return () => { map.current?.remove(); map.current = null; marker.current = null; stopLayer.current = null; fitted.current = false; };
  }, []);

  // stops: small dots, grey once the coach has passed them
  const stopsKey = JSON.stringify(stops.map((s) => [s.name, s.latitude, s.longitude, !!s.passed]));
  useEffect(() => {
    if (!map.current || !stopLayer.current) return;
    stopLayer.current.clearLayers();
    const pts = [];
    stops.forEach((s) => {
      const la = num(s.latitude); const ln = num(s.longitude);
      if (la === null || ln === null) return;
      pts.push([la, ln]);
      L.circleMarker([la, ln], { radius: 6, weight: 2, color: s.passed ? '#9ca3af' : '#00a86b', fillColor: s.passed ? '#9ca3af' : '#ffffff', fillOpacity: 1 })
        .bindTooltip(s.name, { direction: 'top' }).addTo(stopLayer.current);
    });
    if (pts.length > 1) L.polyline(pts, { color: '#00a86b', weight: 3, opacity: 0.35, dashArray: '6 8' }).addTo(stopLayer.current);
    if (!fitted.current && !marker.current && pts.length) { map.current.fitBounds(pts, { padding: [30, 30] }); fitted.current = true; }
  }, [stopsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const la = num(position?.latitude); const ln = num(position?.longitude);
  useEffect(() => {
    if (!map.current || la === null || ln === null) return;
    const ll = [la, ln];
    if (!marker.current) {
      marker.current = L.marker(ll, { icon: busIcon, zIndexOffset: 1000 }).addTo(map.current);
      map.current.setView(ll, 13);
    } else {
      marker.current.setLatLng(ll);
      if (following.current) map.current.panTo(ll, { animate: true });
    }
  }, [la, ln]);

  function recenter() {
    following.current = true; setDetached(false);
    if (marker.current) map.current.panTo(marker.current.getLatLng());
  }

  return (
    <div className={`relative ${className}`}>
      <div ref={el} className="h-full w-full overflow-hidden rounded-2xl border border-line" aria-label="Live map" />
      {detached && marker.current && (
        <button type="button" onClick={recenter} className="absolute bottom-3 left-3 z-[500] rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-fg shadow-lg ring-1 ring-line">Re-center on coach</button>
      )}
    </div>
  );
}