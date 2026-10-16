import { getDriverRatingMap } from "../../modules/ratings/rating.service.js";

const ACTIVE = ["accepted", "started"];

// Shapes ride/delivery documents before they leave the API:
//  - driver live location only while the trip is active (never after / before)
//  - driver rating summary attached for the customer's driver card
//  - internal driver fields the client does not need are dropped
export async function presentTrips(input) {
  const list = (Array.isArray(input) ? input : [input]).filter(Boolean).map((t) => (t.toObject ? t.toObject() : t));

  const ratingMap = await getDriverRatingMap(list.map((t) => t.driver?._id));

  const out = list.map((trip) => {
    if (trip.driver && typeof trip.driver === "object") {
      const driver = { ...trip.driver };

      if (!ACTIVE.includes(trip.status)) delete driver.currentLocation;
      delete driver.driverStatus;

      driver.rating = ratingMap[driver._id?.toString()] || { average: 0, count: 0 };
      trip.driver = driver;
    }
    return trip;
  });

  return Array.isArray(input) ? out : out[0] || null;
}

// Customers may see the receiver phone only on their own bookings; drivers see it after accepting.
export function hidePreAcceptDetails(trip) {
  const t = trip.toObject ? trip.toObject() : { ...trip };
  if (t.customer && typeof t.customer === "object") t.customer = { _id: t.customer._id, name: t.customer.name };
  delete t.receiverPhone;
  return t;
}
