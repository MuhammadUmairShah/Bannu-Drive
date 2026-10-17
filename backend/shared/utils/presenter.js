import { getDriverRatingMap } from "../../modules/ratings/rating.service.js";

const ACTIVE = ["accepted", "started"];

/**
 * Prepare one or multiple trip documents before sending
 * them to the frontend.
 */
export async function presentTrips(input) {
  const isArray = Array.isArray(input);

  const list = (
    isArray
      ? input
      : [input]
  )
    .filter(Boolean)
    .map((trip) => {
      return trip?.toObject
        ? trip.toObject()
        : trip;
    });

  /*
  |--------------------------------------------------------------------------
  | Get unique driver IDs
  |--------------------------------------------------------------------------
  |
  | Before:
  |
  | [driver1, driver1, driver2, driver2]
  |
  | could result in unnecessary processing.
  |
  */

  const driverIds = [
    ...new Set(
      list
        .map((trip) => {
          const driver = trip?.driver;

          if (!driver) {
            return null;
          }

          if (typeof driver === "object") {
            return driver._id?.toString();
          }

          return driver.toString();
        })
        .filter(Boolean)
    ),
  ];

  /*
  |--------------------------------------------------------------------------
  | Get ratings only when drivers exist
  |--------------------------------------------------------------------------
  */

  const ratingMap = driverIds.length
    ? await getDriverRatingMap(driverIds)
    : {};

  /*
  |--------------------------------------------------------------------------
  | Prepare response
  |--------------------------------------------------------------------------
  */

  const output = list.map((trip) => {
    if (
      trip.driver &&
      typeof trip.driver === "object"
    ) {
      const driver = {
        ...trip.driver,
      };

      /*
      |--------------------------------------------------------------------------
      | Current location
      |--------------------------------------------------------------------------
      |
      | Only active trips should expose driver's live location.
      |
      */

      if (!ACTIVE.includes(trip.status)) {
        delete driver.currentLocation;
      }

      /*
      |--------------------------------------------------------------------------
      | Internal field
      |--------------------------------------------------------------------------
      */

      delete driver.driverStatus;

      /*
      |--------------------------------------------------------------------------
      | Rating
      |--------------------------------------------------------------------------
      */

      const driverId =
        driver._id?.toString();

      driver.rating =
        (driverId && ratingMap[driverId]) || {
          average: 0,
          count: 0,
        };

      trip.driver = driver;
    }

    return trip;
  });

  return isArray
    ? output
    : output[0] || null;
}

/**
 * Hide sensitive information before
 * a trip is accepted.
 */
export function hidePreAcceptDetails(trip) {
  const t = trip?.toObject
    ? trip.toObject()
    : {
        ...trip,
      };

  if (
    t.customer &&
    typeof t.customer === "object"
  ) {
    t.customer = {
      _id: t.customer._id,
      name: t.customer.name,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Receiver phone should not be visible
  | before the delivery is accepted.
  |--------------------------------------------------------------------------
  */

  delete t.receiverPhone;

  return t;
}