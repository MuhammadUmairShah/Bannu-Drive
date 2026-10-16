import { settingsModel } from "../../modules/payments/payment.model.js";

// ==========================================
// PLATFORM SETTINGS (singleton, created on demand)
// ==========================================
export async function getPlatformSettings() {
  let settings = await settingsModel.findOne();

  if (!settings) {
    settings = await settingsModel.create({});
  }

  return settings;
}

// ==========================================
// GEO HELPERS
// ==========================================
export function isValidCoords(point) {
  return (
    point &&
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

// ==========================================
// FARE CALCULATION (backend is authoritative)
// ==========================================
export function calculateFare(settings, distanceKm, kind) {
  const key = ["bike", "rickshaw", "car", "delivery"].includes(kind) ? kind : "rickshaw";
  const multiplier = settings.multipliers?.[key] ?? 1;

  const raw = (settings.baseFare + settings.perKmRate * distanceKm) * multiplier;
  const rounded = Math.round(raw / 10) * 10;

  return Math.max(settings.minimumFare, rounded);
}

// ==========================================
// BUILD TRIP DATA FROM A REQUEST BODY
// Validates coordinates, sanity-checks client routing values and
// computes the authoritative distance / duration / fare.
// kind: "bike" | "rickshaw" | "car" | "delivery"
// ==========================================
export async function buildTripData(body, kind) {
  const { pickupCoords, destinationCoords } = body;

  if (!isValidCoords(pickupCoords) || !isValidCoords(destinationCoords)) {
    return { error: "Pickup and destination must be selected on the map" };
  }

  const straight = haversineKm(pickupCoords, destinationCoords);

  if (straight < 0.05) {
    return { error: "Pickup and destination are too close to each other" };
  }

  if (straight > 100) {
    return { error: "Destination is too far for a local trip" };
  }

  // Client sends the OSRM road distance. Accept it only if it is plausible
  // compared to the straight-line distance, otherwise fall back to an estimate.
  const clientDistance = Number(body.distanceKm);
  const clientDuration = Number(body.durationMin);

  const distancePlausible =
    Number.isFinite(clientDistance) &&
    clientDistance >= straight * 0.95 &&
    clientDistance <= straight * 3 + 1;

  const distanceKm = Number(
    (distancePlausible ? clientDistance : straight * 1.3).toFixed(2)
  );

  const durationPlausible =
    Number.isFinite(clientDuration) && clientDuration > 0 && clientDuration < 600;

  const durationMin = Math.max(
    1,
    Math.round(durationPlausible ? clientDuration : (distanceKm / 25) * 60)
  );

  const settings = await getPlatformSettings();
  const estimatedFare = calculateFare(settings, distanceKm, kind);

  return {
    data: {
      pickupCoords: {
        latitude: pickupCoords.latitude,
        longitude: pickupCoords.longitude
      },
      destinationCoords: {
        latitude: destinationCoords.latitude,
        longitude: destinationCoords.longitude
      },
      distanceKm,
      durationMin,
      estimatedFare
    }
  };
}
