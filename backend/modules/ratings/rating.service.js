import mongoose from "mongoose";
import ratingModel from "./rating.model.js";
import { sumField, sumByKey, countByKey } from "../../shared/utils/aggregate.js";

const toId = (id) => new mongoose.Types.ObjectId(id.toString());
const round = (n) => Number(n.toFixed(2));

export async function getDriverRatingSummary(driverId) {
  const match = { driver: toId(driverId) };
  const [count, total] = await Promise.all([ratingModel.countDocuments(match), sumField(ratingModel, match, "rating")]);

  return { average: count ? round(total / count) : 0, count };
}

// Map of driverId -> { average, count } for many drivers
export async function getDriverRatingMap(driverIds) {
  const ids = [...new Set(driverIds.filter(Boolean).map((d) => d.toString()))].map(toId);

  if (!ids.length) return {};

  const match = { driver: { $in: ids } };
  const [totals, counts] = await Promise.all([
    sumByKey(ratingModel, match, "driver", "rating"),
    countByKey(ratingModel, match, "driver")
  ]);

  return Object.fromEntries(
    Object.keys(counts).map((id) => [id, { average: round(totals[id] / counts[id]), count: counts[id] }])
  );
}
