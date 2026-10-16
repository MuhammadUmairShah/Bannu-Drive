export class MapsError extends Error {
  constructor(code, status, message) { super(message); this.name = "MapsError"; this.code = code; this.status = status; }
}
export const Unavailable = (m = "Map service is unavailable right now") => new MapsError("MAPS_UNAVAILABLE", 503, m);
export const BadRequest = (m) => new MapsError("BAD_REQUEST", 400, m);
export const OutOfRegion = () => new MapsError("OUT_OF_REGION", 422, "This location is outside Pakistan");
