import { searchPlaces, reversePlace, routeBetween, mapConfig } from "./maps.service.js";
import { MapsError } from "./maps.errors.js";

function send(res, error, label) {
  if (error instanceof MapsError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  console.error(`${label}:`, error);
  return res.status(500).json({ success: false, message: "Something went wrong" });
}

export const config = (req, res) => res.json({ success: true, ...mapConfig() });

export async function search(req, res) {
  try {
    const results = await searchPlaces(req.query.q, { latitude: req.query.lat, longitude: req.query.lng });
    return res.json({ success: true, results });
  } catch (error) { return send(res, error, "Maps search error"); }
}

export async function reverse(req, res) {
  try {
    return res.json({ success: true, ...(await reversePlace(req.query.lat, req.query.lng)) });
  } catch (error) { return send(res, error, "Maps reverse error"); }
}

export async function route(req, res) {
  try {
    const q = req.query;
    const r = await routeBetween({ latitude: q.fromLat, longitude: q.fromLng }, { latitude: q.toLat, longitude: q.toLng });
    return res.json({ success: true, ...r });
  } catch (error) { return send(res, error, "Maps route error"); }
}
