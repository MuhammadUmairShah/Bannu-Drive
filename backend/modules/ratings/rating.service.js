import mongoose from "mongoose";
import ratingModel from "./rating.model.js";

const toObjectId = (id) => {
  if (!id) return null;

  if (id instanceof mongoose.Types.ObjectId) {
    return id;
  }

  const value = id.toString();

  if (!mongoose.Types.ObjectId.isValid(value)) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
};

const round = (number) => Number(Number(number || 0).toFixed(2));

/**
 * Get rating summary for one driver.
 *
 * Old version:
 * - countDocuments()
 * - sum aggregation
 *
 * New version:
 * - one aggregation only
 */
export async function getDriverRatingSummary(driverId) {
  const driverObjectId = toObjectId(driverId);

  if (!driverObjectId) {
    return {
      average: 0,
      count: 0,
    };
  }

  const [result] = await ratingModel.aggregate([
    {
      $match: {
        driver: driverObjectId,
      },
    },
    {
      $group: {
        _id: "$driver",
        count: { $sum: 1 },
        total: { $sum: "$rating" },
      },
    },
  ]);

  if (!result || !result.count) {
    return {
      average: 0,
      count: 0,
    };
  }

  return {
    average: round(result.total / result.count),
    count: result.count,
  };
}

/**
 * Get rating summaries for multiple drivers.
 *
 * Returns:
 *
 * {
 *   "driverId1": {
 *      average: 4.5,
 *      count: 20
 *   },
 *   "driverId2": {
 *      average: 4.8,
 *      count: 35
 *   }
 * }
 */
export async function getDriverRatingMap(driverIds = []) {
  // Remove empty/invalid IDs and duplicates
  const uniqueIds = [
    ...new Set(
      driverIds
        .filter(Boolean)
        .map((id) => id?.toString())
        .filter(Boolean)
    ),
  ];

  if (!uniqueIds.length) {
    return {};
  }

  const ids = uniqueIds
    .map(toObjectId)
    .filter(Boolean);

  if (!ids.length) {
    return {};
  }

  /**
   * IMPORTANT:
   *
   * Old implementation performed TWO database operations:
   *
   * 1. sumByKey()
   * 2. countByKey()
   *
   * Now MongoDB calculates both values in ONE aggregation.
   */
  const results = await ratingModel.aggregate([
    {
      $match: {
        driver: {
          $in: ids,
        },
      },
    },
    {
      $group: {
        _id: "$driver",
        count: {
          $sum: 1,
        },
        total: {
          $sum: "$rating",
        },
      },
    },
  ]);

  const ratingMap = {};

  for (const item of results) {
    const driverId = item._id?.toString();

    if (!driverId) {
      continue;
    }

    const count = Number(item.count || 0);
    const total = Number(item.total || 0);

    ratingMap[driverId] = {
      average: count > 0 ? round(total / count) : 0,
      count,
    };
  }

  return ratingMap;
}