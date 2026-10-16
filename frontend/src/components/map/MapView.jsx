import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BANNU_CENTER, getMapConfig } from '../../utils/geo';
import { useTheme } from '../../context/ThemeContext';

// Light theme keeps the standard OpenStreetMap tiles; dark theme uses CARTO's dark basemap
// (built on OpenStreetMap data), so the map never glares against dark surfaces.
// The light basemap comes from the server's map configuration (so the provider can change without a code change).
const TILES = {
  light: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  }
};
const PATH_COLOR = { light: '#2563eb', dark: '#5aa2ff' };

// Colored circle markers (no image assets needed, avoids bundler icon issues)
function pinIcon(color, label) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:12px;font-weight:700">${label}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });
}

function dotIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px ${color}66,0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

const isPoint = (p) => p && typeof p.latitude === 'number' && typeof p.longitude === 'number';

// Generic OpenStreetMap map. Everything is optional:
//   pickup / destination : { latitude, longitude }
//   driver               : { latitude, longitude }  (live position)
//   path                 : [[lat, lng], ...]        (route polyline)
//   onMapClick           : (latitude, longitude) => void
export default function MapView({
  pickup,
  destination,
  driver,
  path,
  onMapClick,
  onMarkerDrag,
  stops,
  vehicle,
  height = 320,
  className = ''
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ pickup: null, destination: null, driver: null, path: null, stops: null, vehicle: null });
  const clickRef = useRef(onMapClick);
  const dragRef = useRef(onMarkerDrag);
  dragRef.current = onMarkerDrag;
  const tileRef = useRef(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  clickRef.current = onMapClick;

  // Create the map once
  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [BANNU_CENTER.latitude, BANNU_CENTER.longitude],
      13
    );

    map.on('click', (event) => {
      if (clickRef.current) {
        clickRef.current(event.latlng.lat, event.latlng.lng);
      }
    });

    mapRef.current = map;

    // Container may not have its final size yet (tabs, layouts)
    const timer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layersRef.current = { pickup: null, destination: null, driver: null, path: null, stops: null, vehicle: null };
    };
  }, []);

  // Swap the basemap when the theme changes (and add it on first mount)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let layer = null;
    let cancelled = false;
    const add = (cfg) => { if (!cancelled && mapRef.current) { layer = L.tileLayer(cfg.url, cfg.options).addTo(map); tileRef.current = layer; } };
    if (theme === 'dark') add(TILES.dark);
    else {
      getMapConfig().then((c) => {
        const t = c?.tiles;
        add(t?.url ? { url: t.url, options: { maxZoom: t.maxZoom || 19, attribution: t.attribution } } : TILES.light);
      });
    }
    return () => {
      cancelled = true;
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
      tileRef.current = null;
    };
  }, [theme]);

  // Route line colour follows the theme without re-fitting the map
  useEffect(() => {
    layersRef.current.path?.setStyle({ color: PATH_COLOR[theme] || PATH_COLOR.light });
  }, [theme]);

  // Helper to add/update/remove a single marker layer
  function syncMarker(name, point, icon, title, draggable = false) {
    const map = mapRef.current;
    if (!map) return;

    const layers = layersRef.current;

    if (isPoint(point)) {
      const latlng = [point.latitude, point.longitude];

      if (layers[name]) {
        layers[name].setLatLng(latlng);
      } else {
        layers[name] = L.marker(latlng, { icon, title, draggable: draggable && !!dragRef.current, keyboard: true, alt: title }).addTo(map);
        if (draggable) layers[name].on('dragend', (e) => { const p = e.target.getLatLng(); dragRef.current?.(name, p.lat, p.lng); });
      }
    } else if (layers[name]) {
      map.removeLayer(layers[name]);
      layers[name] = null;
    }
  }

  const pLat = pickup?.latitude;
  const pLng = pickup?.longitude;
  const dLat = destination?.latitude;
  const dLng = destination?.longitude;

  // Pickup / destination markers + route + fit
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    syncMarker('pickup', pickup, pinIcon('#059669', 'A'), 'Pickup', true);
    syncMarker('destination', destination, pinIcon('#dc2626', 'B'), 'Destination', true);

    const layers = layersRef.current;

    if (layers.path) {
      map.removeLayer(layers.path);
      layers.path = null;
    }

    if (path && path.length > 1) {
      layers.path = L.polyline(path, { color: PATH_COLOR[themeRef.current] || PATH_COLOR.light, weight: 5, opacity: 0.85 }).addTo(map);
    }

    const bounds = [];
    if (isPoint(pickup)) bounds.push([pickup.latitude, pickup.longitude]);
    if (isPoint(destination)) bounds.push([destination.latitude, destination.longitude]);
    if (path && path.length > 1) path.forEach((pt) => bounds.push(pt));

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 16);
    }
     
  }, [pLat, pLng, dLat, dLng, path]);

  // Driver marker updates on its own (does not re-fit the map every poll)
  const drLat = driver?.latitude;
  const drLng = driver?.longitude;

  useEffect(() => {
    syncMarker('driver', driver, dotIcon('#2563eb'), 'Driver');
     
  }, [drLat, drLng]);

  // Route stops (coach tracking): numbered dots, passed stops greyed
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    layersRef.current.stops?.remove();
    layersRef.current.stops = null;
    if (stops?.length) {
      const group = L.layerGroup();
      stops.forEach((st) => {
        if (!isPoint(st)) return;
        L.marker([st.latitude, st.longitude], { icon: dotIcon(st.passed ? '#94a3b8' : st.kind === 'dropping' ? '#dc2626' : '#059669'), title: st.name, alt: st.name })
          .bindTooltip(st.name, { direction: 'top', offset: [0, -8] }).addTo(group);
      });
      group.addTo(map);
      layersRef.current.stops = group;
    }
    return undefined;
  }, [stops]);

  // Live vehicle marker: only drawn when a REAL position is supplied; a stale position is drawn greyed out
  const vLat = vehicle?.latitude, vLng = vehicle?.longitude, vStale = vehicle?.stale;
  useEffect(() => {
    syncMarker('vehicle', vehicle, dotIcon(vStale ? '#94a3b8' : '#2563eb'), vStale ? 'Last known position (not live)' : 'Live position');
  }, [vLat, vLng, vStale]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={`w-full rounded-2xl border border-line-strong overflow-hidden z-0 ${className}`}
    />
  );
}
